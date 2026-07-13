"""Introspecção de arquivos de fonte (TTF/OTF) com fontTools."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Literal

from fontTools.ttLib import TTFont

from brand_runtime.ir.models import CamelModel


class FontInfo(CamelModel):
    """Fonte identificada: família legível, peso numérico e estilo."""

    family: str
    weight: int = 400
    style: Literal["normal", "italic"] = "normal"


_NAME_ID_FAMILY = 1
_NAME_ID_SUBFAMILY = 2
_NAME_ID_TYPOGRAPHIC_FAMILY = 16
_FS_SELECTION_ITALIC = 0b1  # bit 0 da OS/2.fsSelection
_FAMILY_STYLE_SUFFIX = re.compile(
    r"\s+(?:thin|extra\s*light|light|book|regular|medium|semi\s*bold|demi\s*bold|"
    r"bold|extra\s*bold|black|heavy)(?:\s+(?:italic|oblique))?$",
    re.IGNORECASE,
)


def _normalized_family(value: str) -> str:
    """Remove do nome de família um peso que já está representado em OS/2."""
    normalized = re.sub(r"\s+", " ", value).strip()
    stripped = _FAMILY_STYLE_SUFFIX.sub("", normalized).strip()
    return stripped or normalized


def font_info_from_ttfont(font: TTFont, *, source: str = "fonte") -> FontInfo:
    """Lê família, peso e estilo de uma instância ``TTFont`` já validada."""
    name_table = font["name"]
    family = name_table.getDebugName(_NAME_ID_TYPOGRAPHIC_FAMILY) or name_table.getDebugName(
        _NAME_ID_FAMILY
    )
    if not family:
        msg = f"Arquivo de fonte sem nome de família na tabela name: {source}"
        raise ValueError(msg)
    os2 = font["OS/2"]
    subfamily = name_table.getDebugName(_NAME_ID_SUBFAMILY) or ""
    italic = bool(os2.fsSelection & _FS_SELECTION_ITALIC) or any(
        token in subfamily.casefold() for token in ("italic", "oblique")
    )
    return FontInfo(
        family=_normalized_family(family),
        weight=os2.usWeightClass,
        style="italic" if italic else "normal",
    )


def introspect_font(font_path: Path) -> FontInfo:
    """Lê família, peso e estilo diretamente das tabelas de um arquivo de fonte.

    Regras: família = nameID 16 se existir, senão nameID 1; peso =
    ``OS/2.usWeightClass``; estilo itálico se o bit 0 de ``OS/2.fsSelection``
    estiver ligado ou o nameID 2 (subfamília) contiver "Italic".
    """
    with TTFont(font_path) as font:
        return font_info_from_ttfont(font, source=str(font_path))
