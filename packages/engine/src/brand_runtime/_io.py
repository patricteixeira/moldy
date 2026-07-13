"""Primitivas de publicação atômica para artefatos arquivo→arquivo."""

from __future__ import annotations

import os
import shutil
import tempfile
from collections.abc import Collection, Mapping
from pathlib import Path


def atomic_write_text(target: Path, text: str) -> None:
    """Substitui um arquivo UTF-8 atomicamente, com temp no mesmo volume."""
    parent = target.parent
    parent.mkdir(parents=True, exist_ok=True)
    if not parent.is_dir():
        raise ValueError(f"O destino não é um diretório: {parent}.")
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            prefix=f".{target.name}.",
            suffix=".tmp",
            dir=parent,
            delete=False,
        ) as handle:
            temp_path = Path(handle.name)
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, target)
        temp_path = None
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def _safe_remove_tree(path: Path, parent: Path) -> None:
    """Remove somente um staging/backup criado como filho direto do parent esperado."""
    if not path.exists():
        return
    resolved_parent = parent.resolve(strict=True)
    resolved = path.resolve(strict=True)
    if resolved.parent != resolved_parent or not resolved.name.startswith("."):
        raise ValueError("Recusa ao remover diretório temporário fora da raiz de publicação.")
    shutil.rmtree(resolved)


def publish_file_set(
    out_dir: Path,
    payloads: Mapping[str, str],
    *,
    preserve: Collection[str] = (),
) -> list[Path]:
    """Publica um conjunto completo por staging, swap de diretório e rollback."""
    if not payloads:
        raise ValueError("O conjunto de artefatos para publicação está vazio.")
    expected = set(payloads)
    preserved_names = set(preserve) - expected
    for filename in expected | preserved_names:
        if (
            not filename
            or filename in {".", ".."}
            or "/" in filename
            or "\\" in filename
            or Path(filename).name != filename
        ):
            raise ValueError(f"Nome de artefato inseguro: {filename}.")

    parent = out_dir.parent
    parent.mkdir(parents=True, exist_ok=True)
    if not parent.is_dir():
        raise ValueError(f"A raiz de publicação não é um diretório: {parent}.")
    if out_dir.exists():
        if not out_dir.is_dir():
            raise ValueError(f"O destino de publicação não é um diretório: {out_dir}.")
        allowed = expected | preserved_names
        unexpected = sorted(
            entry.name
            for entry in out_dir.iterdir()
            if entry.name not in allowed or not entry.is_file() or entry.is_symlink()
        )
        if unexpected:
            raise ValueError(
                "O diretório de publicação contém artefatos inesperados: "
                + ", ".join(unexpected)
                + "."
            )

    stem = out_dir.name or "artifacts"
    stage = Path(tempfile.mkdtemp(prefix=f".{stem}.stage-", dir=parent))
    backup: Path | None = None
    try:
        staged_names = set(expected)
        if out_dir.exists():
            for filename in sorted(preserved_names):
                sidecar = out_dir / filename
                if sidecar.exists():
                    shutil.copy2(sidecar, stage / filename)
                    staged_names.add(filename)
        for filename, payload in payloads.items():
            atomic_write_text(stage / filename, payload)
        if {entry.name for entry in stage.iterdir()} != staged_names:
            raise ValueError("O staging não contém o conjunto completo de artefatos.")

        if out_dir.exists():
            backup = Path(tempfile.mkdtemp(prefix=f".{stem}.backup-", dir=parent))
            backup.rmdir()  # reserva um nome único; o swap exige que o destino não exista
            os.replace(out_dir, backup)
        try:
            os.replace(stage, out_dir)
            stage = Path()
        except Exception:
            if backup is not None and backup.exists() and not out_dir.exists():
                os.replace(backup, out_dir)
                backup = None
            raise
        if backup is not None:
            _safe_remove_tree(backup, parent)
            backup = None
    finally:
        if stage != Path() and stage.exists():
            _safe_remove_tree(stage, parent)
        if backup is not None and backup.exists() and not out_dir.exists():
            os.replace(backup, out_dir)
    return [out_dir / filename for filename in payloads]
