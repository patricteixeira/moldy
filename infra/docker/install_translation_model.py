"""Baixa e instala o modelo fixado de tradução local durante o build."""

from __future__ import annotations

import hashlib
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

MODEL_URL = "https://argos-net.com/v1/translate-en_pb-1_9.argosmodel"
MODEL_SHA256 = "1d1cd5e9540c6b38c258bed002a42d3b311b8a189acb74feaa311ef30d175c5b"
MAX_ARCHIVE_BYTES = 70 * 2**20
ARCHIVE_ROOT = "translate-en_pb-1_9/"
FILES = (
    "README.md",
    "metadata.json",
    "sentencepiece.model",
    "model/config.json",
    "model/model.bin",
    "model/shared_vocabulary.json",
)


def _download(target: Path) -> None:
    digest = hashlib.sha256()
    size = 0
    request = urllib.request.Request(
        MODEL_URL, headers={"User-Agent": "Molda-build/0.1"}
    )
    with (
        urllib.request.urlopen(request, timeout=60) as response,
        target.open("wb") as output,
    ):
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_ARCHIVE_BYTES:
                raise RuntimeError("O arquivo do modelo excedeu o limite fixado.")
            digest.update(chunk)
            output.write(chunk)
    if digest.hexdigest() != MODEL_SHA256:
        raise RuntimeError("O checksum do modelo de tradução não confere.")


def install(destination: Path) -> None:
    """Instala apenas os arquivos esperados depois de validar o pacote inteiro."""
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="molda-translation-") as temporary:
        archive_path = Path(temporary) / "model.argosmodel"
        _download(archive_path)
        with zipfile.ZipFile(archive_path) as archive:
            archive_names = set(archive.namelist())
            missing = [
                name for name in FILES if ARCHIVE_ROOT + name not in archive_names
            ]
            if missing:
                raise RuntimeError(
                    "O pacote do modelo está incompleto: " + ", ".join(missing)
                )
            for name in FILES:
                target = destination / name
                target.parent.mkdir(parents=True, exist_ok=True)
                with (
                    archive.open(ARCHIVE_ROOT + name) as source,
                    target.open("wb") as output,
                ):
                    shutil.copyfileobj(source, output)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("uso: install_translation_model.py DESTINO")
    install(Path(sys.argv[1]))
