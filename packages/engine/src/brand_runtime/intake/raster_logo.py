"""Extração de cores dominantes de logos raster (PNG) com Pillow."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from brand_runtime.colors import dedupe_colors
from brand_runtime.intake.base import Candidate
from brand_runtime.ir.models import Evidence

_CONFIDENCE = 0.85
_OPAQUE_ALPHA_MIN = 128
_MIN_FRACTION = 0.02


def extract_raster_colors(img_path: Path, max_colors: int = 8) -> list[Candidate]:
    """Extrai cores dominantes de um logo raster com paleta adaptativa.

    A imagem é convertida para RGBA e pixels com alpha < 128 são descartados;
    só os pixels opacos são quantizados (paleta adaptativa) para ``max_colors``
    cores. Score = fração dos pixels opacos com a cor; cores perceptualmente
    próximas são fundidas com ``dedupe_colors`` e frações abaixo de 0.02 são
    ignoradas.
    """
    with Image.open(img_path) as img:
        rgba = img.convert("RGBA")
    # tobytes() em vez de getdata(): funciona igual em todo Pillow >= 10.4
    # (getdata está deprecado e some no Pillow 14).
    data = rgba.tobytes()
    opaque = [
        (data[i], data[i + 1], data[i + 2])
        for i in range(0, len(data), 4)
        if data[i + 3] >= _OPAQUE_ALPHA_MIN
    ]
    if not opaque:
        return []

    # Quantizar só o que é visível: os pixels opacos viram uma imagem RGB 1×N,
    # para que a transparência não ocupe entradas da paleta adaptativa.
    flat = Image.new("RGB", (len(opaque), 1))
    flat.putdata(opaque)
    quantized = flat.quantize(colors=max_colors, dither=Image.Dither.NONE)

    palette = quantized.getpalette()
    fractions: dict[str, float] = {}
    for count, index in quantized.getcolors():
        r, g, b = palette[index * 3 : index * 3 + 3]
        hex_color = f"#{r:02X}{g:02X}{b:02X}"
        fractions[hex_color] = fractions.get(hex_color, 0.0) + count / len(opaque)

    return [
        Candidate(
            value=color,
            score=fraction,
            evidence=[
                Evidence(source_type="raster-asset", path=str(img_path), confidence=_CONFIDENCE)
            ],
        )
        for color, fraction in dedupe_colors(list(fractions.items()))
        if fraction >= _MIN_FRACTION
    ]
