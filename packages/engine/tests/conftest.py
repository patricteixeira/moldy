"""Fixtures compartilhadas — assets de marca gerados programaticamente (sem binários commitados)."""

from __future__ import annotations

import os
import shutil
from pathlib import Path

import pymupdf
import pytest
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib.tables._g_l_y_f import Glyph

_PARAGRAPH = (
    "A marca ACME existe para simplificar o dia a dia de quem cria. "
    "Estas diretrizes reunem as cores, as fontes e os usos corretos do logo, "
    "para que qualquer material mantenha a mesma identidade em todos os canais."
)
RENDER_DIST = Path(__file__).resolve().parents[2] / "render" / "dist"


@pytest.fixture(scope="session")
def render_dist() -> Path:
    """Build do renderer; no gate obrigatório, ausência é falha e não skip."""
    if not (RENDER_DIST / "render.html").is_file():
        if os.environ.get("BRANDRT_REQUIRE_RENDER_TESTS") == "1":
            pytest.fail("render dist obrigatório ausente — rode npm ci && npm run build")
        pytest.skip("rode `npm run build` em packages/render antes dos testes de export")
    return RENDER_DIST


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


@pytest.fixture(scope="session")
def fixture_font(tmp_path_factory) -> Path:
    """TTF determinística com cmap e outlines para os textos reais dos testes."""
    codepoints = [*range(32, 127), *(ord(char) for char in "áíóãçé")]
    names = {codepoint: f"uni{codepoint:04X}" for codepoint in codepoints}
    glyph_order = [".notdef", *names.values()]
    glyphs: dict[str, Glyph] = {}
    metrics: dict[str, tuple[int, int]] = {}

    notdef_pen = TTGlyphPen(None)
    notdef_pen.moveTo((50, 0))
    notdef_pen.lineTo((450, 0))
    notdef_pen.lineTo((450, 700))
    notdef_pen.lineTo((50, 700))
    notdef_pen.closePath()
    glyphs[".notdef"] = notdef_pen.glyph()
    metrics[".notdef"] = (500, 50)

    for codepoint, name in names.items():
        advance = 300 if codepoint == 32 else 600
        pen = TTGlyphPen(None)
        if codepoint != 32:
            inset = 60 + codepoint % 40
            pen.moveTo((inset, 0))
            pen.lineTo((advance - inset, 0))
            pen.lineTo((advance - inset, 700))
            pen.lineTo((inset, 700))
            pen.closePath()
        glyphs[name] = pen.glyph()
        metrics[name] = (advance, 0)

    fb = FontBuilder(1000)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap(names)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": "Fixture Sans", "styleName": "Bold"})
    fb.setupOS2(usWeightClass=700)
    fb.setupPost()
    font_path = tmp_path_factory.mktemp("fixture-font") / "fixture-sans-bold.ttf"
    fb.save(font_path)
    return font_path


# Mesmo SVG hostil da Task 6 (tests/test_svg_logo.py, constante MALICIOUS),
# duplicado aqui porque conftest não deve importar módulos de teste: o pacote
# de fixture prova que o pipeline de draft sanitiza uploads antes de extrair.
_MALICIOUS_SVG = b"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <script>alert(1)</script>
  <rect width="60" height="100" fill="#1A4D8F" onclick="evil()"/>
  <circle r="20" fill="#F4A300" stroke="#1A4D8F"/>
  <image href="https://evil.example/x.png"/>
  <use href="#ok"/>
</svg>"""


@pytest.fixture
def brand_package(tmp_path_factory, brand_pdf, fixture_font) -> Path:
    """Pacote informal de marca completo, na convenção de ``brand_runtime.intake.draft``.

    Contém ``manual.pdf`` (cópia de ``brand_pdf``), ``assets/logos/logo.svg``
    (o SVG hostil da Task 6 — passa pela sanitização) e
    ``fonts/fixture-sans-bold.ttf``. Reutilizada pelas Tasks 10 a 15.

    Escopo de função (não de sessão): testes escrevem no pacote — ex.:
    ``tokens.json`` em ``test_dtcg.py`` — e um diretório compartilhado
    contaminaria os testes seguintes; cada teste recebe uma cópia isolada
    (barata: três arquivos pequenos, gerados uma vez por sessão).
    """
    package = tmp_path_factory.mktemp("brand-package")
    shutil.copyfile(brand_pdf, package / "manual.pdf")
    logos_dir = package / "assets" / "logos"
    logos_dir.mkdir(parents=True)
    (logos_dir / "logo.svg").write_bytes(_MALICIOUS_SVG)
    fonts_dir = package / "fonts"
    fonts_dir.mkdir()
    shutil.copyfile(fixture_font, fonts_dir / "fixture-sans-bold.ttf")
    return package
