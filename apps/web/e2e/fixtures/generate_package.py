"""Gera o pacote de marca e as fotos do E2E, sem binários versionados."""

from __future__ import annotations

import shutil
from pathlib import Path

import fitz
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw

BASE = Path(__file__).resolve().parent.parent / ".fixtures"
PKG = BASE / "acme-package"
PHOTOS = BASE / "photos"

LOGO_SVG = b"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <rect width="120" height="72" fill="#1A4D8F"/>
  <circle cx="60" cy="96" r="20" fill="#F4A300"/>
</svg>
"""


def make_pdf(path: Path) -> None:
    """Cria um manual A4 com cores e texto suficientes para o intake."""
    document = fitz.open()
    page = document.new_page(width=595, height=842)
    page.draw_rect(
        fitz.Rect(50, 50, 250, 250),
        fill=(26 / 255, 77 / 255, 143 / 255),
        color=None,
    )
    page.draw_rect(
        fitz.Rect(300, 50, 350, 100),
        fill=(244 / 255, 163 / 255, 0 / 255),
        color=None,
    )
    page.insert_textbox(
        fitz.Rect(50, 300, 545, 360),
        "Manual da marca ACME",
        fontname="tibo",
        fontsize=24,
        color=(26 / 255, 77 / 255, 143 / 255),
    )
    body = "A marca ACME é aplicada com consistência em todos os materiais. " * 4
    page.insert_textbox(
        fitz.Rect(50, 400, 545, 700),
        body,
        fontname="helv",
        fontsize=12,
        color=(0.2, 0.2, 0.2),
    )
    document.save(str(path))
    document.close()


def _rectangular_glyph(inset: int, advance: int):
    pen = TTGlyphPen(None)
    pen.moveTo((inset, 0))
    pen.lineTo((advance - inset, 0))
    pen.lineTo((advance - inset, 700))
    pen.lineTo((inset, 700))
    pen.closePath()
    return pen.glyph()


def make_font(path: Path) -> None:
    """Cria TTF válido com cmap e contornos para ASCII e acentos usados."""
    codepoints = [*range(32, 127), *(ord(char) for char in "áíóãçéêúÁÉÍÓÚÇ")]
    names = {codepoint: f"uni{codepoint:04X}" for codepoint in codepoints}
    glyph_order = [".notdef", *names.values()]
    glyphs = {".notdef": _rectangular_glyph(50, 500)}
    metrics = {".notdef": (500, 50)}

    for codepoint, name in names.items():
        advance = 300 if codepoint == 32 else 600
        glyphs[name] = (
            TTGlyphPen(None).glyph()
            if codepoint == 32
            else _rectangular_glyph(60 + codepoint % 40, advance)
        )
        metrics[name] = (advance, 0)

    builder = FontBuilder(1000)
    builder.setupGlyphOrder(glyph_order)
    builder.setupCharacterMap(names)
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics(metrics)
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable({"familyName": "Fixture Sans", "styleName": "Bold"})
    builder.setupOS2(usWeightClass=700)
    builder.setupPost()
    builder.save(str(path))

    with TTFont(path) as font:
        cmap = font.getBestCmap() or {}
        assert all(codepoint in cmap for codepoint in codepoints)
        assert font["glyf"][names[ord("A")]].numberOfContours > 0


def make_photos() -> None:
    """Semeia uma foto inválida e outra suficiente para o layout quadrado."""
    Image.new("RGB", (200, 200), (120, 120, 120)).save(PHOTOS / "low.png")
    ok = Image.new("RGB", (1200, 1200), (26, 77, 143))
    ImageDraw.Draw(ok).rectangle([0, 600, 1200, 1200], fill=(244, 163, 0))
    ok.save(PHOTOS / "ok.png")


def main() -> None:
    """Recria todas as fixtures de modo determinístico."""
    if BASE.exists():
        shutil.rmtree(BASE)
    (PKG / "assets" / "logos").mkdir(parents=True)
    (PKG / "fonts").mkdir(parents=True)
    PHOTOS.mkdir(parents=True)
    make_pdf(PKG / "manual.pdf")
    (PKG / "assets" / "logos" / "logo.svg").write_bytes(LOGO_SVG)
    make_font(PKG / "fonts" / "fixture-sans-bold.ttf")
    make_photos()
    print(f"Fixtures E2E geradas em {BASE}")


if __name__ == "__main__":
    main()
