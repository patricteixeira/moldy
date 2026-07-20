"""Leitura textual compartilhada de PDFs, com OCR local como fallback."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import pymupdf

_MIN_NATIVE_ALNUM = 24
_OCR_DPI = 150
_OCR_LANGUAGES = "por+eng"


@dataclass(frozen=True)
class PdfPageText:
    """Texto e blocos de uma página, preservando se vieram de OCR."""

    page_number: int
    text: str
    blocks: tuple[tuple[Any, ...], ...]
    used_ocr: bool = False


def _meaningful_length(value: str) -> int:
    return sum(character.isalnum() for character in value)


def _page_content(page: Any, page_number: int) -> PdfPageText:
    """Prefere a camada textual; páginas achatadas usam Tesseract local."""
    native_text = str(page.get_text("text"))
    native_blocks = tuple(tuple(block) for block in page.get_text("blocks"))
    if _meaningful_length(native_text) >= _MIN_NATIVE_ALNUM:
        return PdfPageText(page_number, native_text, native_blocks)

    try:
        textpage = page.get_textpage_ocr(
            language=_OCR_LANGUAGES,
            dpi=_OCR_DPI,
            full=True,
        )
        ocr_text = str(page.get_text("text", textpage=textpage))
        ocr_blocks = tuple(tuple(block) for block in page.get_text("blocks", textpage=textpage))
    except (OSError, RuntimeError, ValueError):
        return PdfPageText(page_number, native_text, native_blocks)

    if _meaningful_length(ocr_text) <= _meaningful_length(native_text):
        return PdfPageText(page_number, native_text, native_blocks)
    return PdfPageText(page_number, ocr_text, ocr_blocks, used_ocr=True)


@lru_cache(maxsize=64)
def _cached_pdf_text(
    resolved_path: str,
    size: int,
    modified_ns: int,
) -> tuple[PdfPageText, ...]:
    """Executa OCR no máximo uma vez por versão imutável do arquivo."""
    del size, modified_ns
    with pymupdf.open(resolved_path) as document:
        return tuple(
            _page_content(document.load_page(index), index + 1) for index in range(len(document))
        )


def extract_pdf_text_pages(pdf_path: Path) -> tuple[PdfPageText, ...]:
    """Devolve a melhor leitura local disponível para cada página do PDF."""
    resolved = pdf_path.resolve()
    stat = resolved.stat()
    return _cached_pdf_text(str(resolved), stat.st_size, stat.st_mtime_ns)
