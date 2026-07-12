"""Fixtures compartilhadas — assets de marca gerados programaticamente (sem binários commitados)."""

from __future__ import annotations

from pathlib import Path

import pymupdf
import pytest

_PARAGRAPH = (
    "A marca ACME existe para simplificar o dia a dia de quem cria. "
    "Estas diretrizes reunem as cores, as fontes e os usos corretos do logo, "
    "para que qualquer material mantenha a mesma identidade em todos os canais."
)


@pytest.fixture(scope="session")
def brand_pdf(tmp_path_factory) -> Path:
    """PDF de 1 página A4 gerado com PyMuPDF.

    Contém: retângulo grande preenchido #1A4D8F (200×200 pt), retângulo pequeno
    #F4A300 (50×50 pt), parágrafo de ~200 caracteres em #333333 (fonte builtin
    "helv") e um título curto em Times-Bold (builtin "tibo").
    Reutilizada pelas Tasks 5 e 9.
    """
    pdf_path = tmp_path_factory.mktemp("brand-pdf") / "manual.pdf"
    with pymupdf.open() as doc:
        page = doc.new_page(width=595, height=842)  # A4 em pt
        page.draw_rect(
            pymupdf.Rect(50, 40, 250, 240),
            fill=(26 / 255, 77 / 255, 143 / 255),  # #1A4D8F
            color=None,
        )
        page.draw_rect(
            pymupdf.Rect(300, 40, 350, 90),
            fill=(244 / 255, 163 / 255, 0.0),  # #F4A300
            color=None,
        )
        page.insert_text(
            (50, 300),
            "Manual da Marca",
            fontname="tibo",  # Times-Bold builtin
            fontsize=24,
            color=(0.2, 0.2, 0.2),  # #333333
        )
        page.insert_textbox(
            pymupdf.Rect(50, 340, 545, 700),
            _PARAGRAPH,
            fontname="helv",
            fontsize=12,
            color=(0.2, 0.2, 0.2),  # #333333
        )
        doc.save(pdf_path)
    return pdf_path
