"""Extração transacional de pacotes ZIP tratados como conteúdo hostil."""

from __future__ import annotations

import hashlib
import io
import os
import re
import shutil
import tempfile
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import BinaryIO

ALLOWED_EXTENSIONS = {".pdf", ".svg", ".png", ".jpg", ".jpeg", ".ttf", ".otf", ".json"}
_CHUNK_SIZE = 64 * 1024
_DRIVE_PREFIX = re.compile(r"^[A-Za-z]:")
_SYMLINK_MODE = 0o120000
_FILE_TYPE_MASK = 0o170000
_WINDOWS_RESERVED = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "CONIN$",
    "CONOUT$",
    *(f"COM{number}" for number in range(1, 10)),
    *(f"LPT{number}" for number in range(1, 10)),
}


class UnzipError(Exception):
    """Erro seguro e comunicável durante a validação de um pacote ZIP."""


@dataclass(frozen=True)
class UnpackResult:
    """Manifest imutável dos arquivos aceitos e nomes ignorados."""

    manifest: dict[str, str]
    ignored: list[str]


def _normalized_name(info: zipfile.ZipInfo) -> tuple[str, bool]:
    """Normaliza separadores e valida a contenção estrutural de uma entry."""
    name = info.filename.replace("\\", "/")
    is_directory = name.endswith("/")
    candidate = name.rstrip("/") if is_directory else name
    if not candidate or candidate.startswith("/") or _DRIVE_PREFIX.match(candidate):
        raise UnzipError("O pacote contém caminhos de arquivo inválidos.")
    parts = candidate.split("/")
    if any(
        part in {"", ".", ".."}
        or ":" in part
        or part.endswith((".", " "))
        or part.split(".", maxsplit=1)[0].upper() in _WINDOWS_RESERVED
        for part in parts
    ):
        raise UnzipError("O pacote contém caminhos de arquivo inválidos.")
    mode = (info.external_attr >> 16) & _FILE_TYPE_MASK
    if mode == _SYMLINK_MODE:
        raise UnzipError("O pacote contém caminhos de arquivo inválidos.")
    return "/".join(parts), is_directory


def _validated_entries(
    archive: zipfile.ZipFile,
    max_entries: int,
) -> list[tuple[zipfile.ZipInfo, str, bool]]:
    """Valida quantidade, paths e links antes de materializar qualquer byte."""
    entries = archive.infolist()
    if len(entries) > max_entries:
        raise UnzipError("O pacote contém arquivos demais.")
    validated: list[tuple[zipfile.ZipInfo, str, bool]] = []
    filesystem_keys: set[str] = set()
    for info in entries:
        name, is_directory = _normalized_name(info)
        filesystem_key = unicodedata.normalize("NFC", name).casefold()
        if filesystem_key in filesystem_keys:
            raise UnzipError("O pacote contém caminhos de arquivo inválidos.")
        filesystem_keys.add(filesystem_key)
        validated.append((info, name, is_directory))
    return validated


def safe_unpack(
    zip_source: bytes | BinaryIO,
    dest: Path,
    *,
    max_entries: int = 200,
    max_unpacked_bytes: int = 200 * 2**20,
) -> UnpackResult:
    """Extrai um ZIP validado para ``dest`` sem deixar estado parcial em falhas."""
    dest = Path(dest)
    if dest.exists():
        raise UnzipError("O diretório de destino do pacote já existe.")
    dest.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{dest.name}.", dir=dest.parent))
    manifest: dict[str, str] = {}
    ignored: list[str] = []
    unpacked_bytes = 0
    completed = False
    try:
        try:
            source = io.BytesIO(zip_source) if isinstance(zip_source, bytes) else zip_source
            source.seek(0)
            with zipfile.ZipFile(source) as archive:
                entries = _validated_entries(archive, max_entries)
                for info, name, is_directory in entries:
                    if is_directory:
                        continue
                    if PurePosixPath(name).suffix.casefold() not in ALLOWED_EXTENSIONS:
                        ignored.append(name)
                        continue
                    target = temporary.joinpath(*name.split("/"))
                    target.parent.mkdir(parents=True, exist_ok=True)
                    digest = hashlib.sha256()
                    with archive.open(info, "r") as source, target.open("wb") as output:
                        while chunk := source.read(_CHUNK_SIZE):
                            unpacked_bytes += len(chunk)
                            if unpacked_bytes > max_unpacked_bytes:
                                raise UnzipError(
                                    "O pacote descompactado excede o tamanho máximo permitido."
                                )
                            digest.update(chunk)
                            output.write(chunk)
                    manifest[name] = digest.hexdigest()
        except UnzipError:
            raise
        except (zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError, EOFError) as exc:
            raise UnzipError("O arquivo enviado não é um ZIP válido.") from exc
        os.replace(temporary, dest)
        completed = True
        return UnpackResult(manifest=manifest, ignored=ignored)
    except UnzipError:
        raise
    except OSError as exc:
        raise UnzipError("Não foi possível descompactar o pacote enviado.") from exc
    finally:
        if not completed:
            shutil.rmtree(temporary, ignore_errors=True)
