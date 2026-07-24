"""Storage local imutável e endereçado pelo SHA-256 do conteúdo."""

from __future__ import annotations

import hashlib
import os
import re
import stat
import tempfile
from contextlib import suppress
from pathlib import Path

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_CHUNK_SIZE = 64 * 1024


class Storage:
    """Armazena blobs em layout content-addressed com publicação atômica."""

    def __init__(self, root: Path) -> None:
        """Inicializa o storage e cria sua raiz quando necessário."""
        self.root = root
        try:
            self.root.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise ValueError("A raiz do storage precisa ser um diretório local regular.") from exc
        if (
            any(self._is_link(component) for component in (self.root, *self.root.parents))
            or not self.root.is_dir()
        ):
            raise ValueError("A raiz do storage precisa ser um diretório local regular.")

    @staticmethod
    def _is_link(path: Path) -> bool:
        """Detecta symlinks e junctions sem seguir o destino."""
        is_junction = getattr(os.path, "isjunction", None)
        return path.is_symlink() or bool(is_junction and is_junction(path))

    @classmethod
    def _is_regular_file(cls, path: Path) -> bool:
        """Confirma que um path existente é arquivo regular e não link."""
        if cls._is_link(path):
            return False
        try:
            return stat.S_ISREG(path.stat(follow_symlinks=False).st_mode)
        except OSError:
            return False

    @staticmethod
    def _digest_file(path: Path) -> str | None:
        """Calcula o hash de um arquivo em streaming ou falha fechado."""
        digest = hashlib.sha256()
        try:
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(_CHUNK_SIZE), b""):
                    digest.update(chunk)
        except OSError:
            return None
        return digest.hexdigest()

    def _valid_blob(self, path: Path, sha256: str) -> bool:
        """Aceita somente arquivo regular cujos bytes correspondam ao endereço."""
        return self._is_regular_file(path) and self._digest_file(path) == sha256

    def _ensure_safe_parent(self, destination: Path) -> None:
        """Cria a hierarquia do blob recusando links ou componentes não diretório."""
        current = self.root
        for part in destination.parent.relative_to(self.root).parts:
            current /= part
            try:
                current.mkdir(exist_ok=True)
            except OSError as exc:
                raise ValueError("A hierarquia do storage contém um path inválido.") from exc
            if self._is_link(current) or not current.is_dir():
                raise ValueError("A hierarquia do storage contém um link não permitido.")

    def _has_safe_parent(self, destination: Path) -> bool:
        """Confirma que toda a hierarquia existente até o blob é diretório real."""
        if self._is_link(self.root) or not self.root.is_dir():
            return False
        current = self.root
        for part in destination.parent.relative_to(self.root).parts:
            current /= part
            if self._is_link(current) or not current.is_dir():
                return False
        return True

    def put(self, data: bytes) -> str:
        """Grava bytes de forma idempotente e retorna seu SHA-256 minúsculo."""
        digest = hashlib.sha256()
        view = memoryview(data)
        for offset in range(0, len(view), _CHUNK_SIZE):
            digest.update(view[offset : offset + _CHUNK_SIZE])
        sha256 = digest.hexdigest()
        destination = self.path_for(sha256)
        if self._has_safe_parent(destination) and self._valid_blob(destination, sha256):
            return sha256

        self._ensure_safe_parent(destination)
        descriptor, raw_temporary = tempfile.mkstemp(
            prefix=f".{sha256}.",
            suffix=".tmp",
            dir=destination.parent,
        )
        temporary = Path(raw_temporary)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                for offset in range(0, len(view), _CHUNK_SIZE):
                    handle.write(view[offset : offset + _CHUNK_SIZE])
                handle.flush()
                os.fsync(handle.fileno())
            if not self._has_safe_parent(destination):
                raise ValueError("A hierarquia do storage contém um link não permitido.")
            if not self._valid_blob(destination, sha256):
                os.replace(temporary, destination)
        finally:
            with suppress(OSError):
                temporary.unlink()
        return sha256

    def put_file(self, source: Path) -> str:
        """Publica um arquivo regular em streaming sem materializá-lo inteiro na RAM."""
        source = Path(source)
        if not self._is_regular_file(source):
            raise ValueError("O blob de origem precisa ser um arquivo local regular.")
        sha256 = self._digest_file(source)
        if sha256 is None:
            raise ValueError("Não foi possível ler o blob de origem.")
        destination = self.path_for(sha256)
        if self._has_safe_parent(destination) and self._valid_blob(destination, sha256):
            return sha256

        self._ensure_safe_parent(destination)
        descriptor, raw_temporary = tempfile.mkstemp(
            prefix=f".{sha256}.",
            suffix=".tmp",
            dir=destination.parent,
        )
        temporary = Path(raw_temporary)
        copied_digest = hashlib.sha256()
        try:
            with source.open("rb") as input_handle, os.fdopen(descriptor, "wb") as output_handle:
                while chunk := input_handle.read(_CHUNK_SIZE):
                    copied_digest.update(chunk)
                    output_handle.write(chunk)
                output_handle.flush()
                os.fsync(output_handle.fileno())
            if copied_digest.hexdigest() != sha256:
                raise ValueError("O blob de origem mudou durante a publicação.")
            if not self._has_safe_parent(destination):
                raise ValueError("A hierarquia do storage contém um link não permitido.")
            if not self._valid_blob(destination, sha256):
                os.replace(temporary, destination)
        finally:
            with suppress(OSError):
                temporary.unlink()
        return sha256

    def has(self, sha256: str) -> bool:
        """Informa se um hash válido já está materializado como arquivo regular."""
        if not _SHA256_RE.fullmatch(sha256):
            return False
        path = self.path_for(sha256)
        return self._has_safe_parent(path) and self._valid_blob(path, sha256)

    def get(self, sha256: str) -> bytes:
        """Lê um blob existente ou levanta ``KeyError`` quando ausente."""
        if not self.has(sha256):
            raise KeyError(sha256)
        try:
            data = self.path_for(sha256).read_bytes()
        except OSError as exc:
            raise KeyError(sha256) from exc
        if hashlib.sha256(data).hexdigest() != sha256:
            raise KeyError(sha256)
        return data

    def path_for(self, sha256: str) -> Path:
        """Retorna o caminho canônico de um SHA-256 válido, exista ou não."""
        if not _SHA256_RE.fullmatch(sha256):
            raise ValueError("O identificador do blob deve ser um SHA-256 minúsculo.")
        return self.root / "sha256" / sha256[:2] / sha256[2:4] / sha256
