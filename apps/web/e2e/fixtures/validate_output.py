"""Valida dimensões e estrutura dos arquivos exportados no E2E."""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image
from pypdf import PdfReader


def main() -> None:
    """Valida PNG 1080 quadrado ou PDF A4 de uma página."""
    kind, raw_path = sys.argv[1:3]
    path = Path(raw_path)
    if kind == "png":
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            assert image.format == "PNG"
            assert image.size == (1080, 1080)
        return

    if kind == "pdf":
        reader = PdfReader(path)
        assert len(reader.pages) == 1
        box = reader.pages[0].mediabox
        width = float(box.width)
        height = float(box.height)
        assert abs(width - 595) <= 2
        assert abs(height - 842) <= 2
        return

    raise ValueError(f"Formato desconhecido: {kind}")


if __name__ == "__main__":
    main()
