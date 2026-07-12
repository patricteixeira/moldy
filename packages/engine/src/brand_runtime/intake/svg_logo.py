"""Sanitização de SVG hostil e extração de cores de logos vetoriais.

Uploads são tratados como hostis: todo SVG passa por ``sanitize_svg`` antes de
qualquer parse de cor ou de geometria (spec §5.3).
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path

from brand_runtime.colors import normalize_color
from brand_runtime.intake.base import Candidate
from brand_runtime.ir.models import Evidence

try:  # defusedxml, se disponível, protege contra entidades/expansões maliciosas
    from defusedxml.ElementTree import fromstring as _fromstring
except ImportError:  # pragma: no cover — depende do ambiente
    _fromstring = ET.fromstring

_SVG_NS = "http://www.w3.org/2000/svg"
_XLINK_NS = "http://www.w3.org/1999/xlink"
_HREF_ATTRS = ("href", f"{{{_XLINK_NS}}}href")
_FORBIDDEN_TAGS = {"script", "foreignobject"}
_IGNORED_PAINTS = {"none", "currentcolor", "transparent"}
_ALLOWED_IMAGE_DATA = re.compile(r"^data:image/(png|jpeg)[;,]", re.IGNORECASE)
_STYLE_DECL = re.compile(r"(?P<prop>[-\w]+)\s*:\s*(?P<value>[^;]+)")
_LENGTH = re.compile(r"^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$", re.IGNORECASE)
_CONFIDENCE = 0.95

ET.register_namespace("", _SVG_NS)
ET.register_namespace("xlink", _XLINK_NS)


class SvgInvalid(Exception):
    """SVG com XML não parseável."""


def _parse(data: bytes) -> ET.Element:
    try:
        return _fromstring(data)
    except Exception as exc:  # parser stdlib/defusedxml levanta tipos variados
        raise SvgInvalid(f"SVG inválido: XML não parseável ({exc})") from exc


def _local_name(qualified: str) -> str:
    return qualified.rsplit("}", 1)[-1].lower()


def _href_value(element: ET.Element) -> str | None:
    for attr in _HREF_ATTRS:
        if attr in element.attrib:
            return element.attrib[attr]
    return None


def _image_is_safe(element: ET.Element) -> bool:
    href = _href_value(element)
    if href is None:
        return True
    href = href.strip()
    return href.startswith("#") or bool(_ALLOWED_IMAGE_DATA.match(href))


def _href_is_safe(tag: str, value: str) -> bool:
    value = value.strip()
    if value.startswith("#"):
        return True
    return tag == "image" and bool(_ALLOWED_IMAGE_DATA.match(value))


def sanitize_svg(data: bytes) -> bytes:
    """Remove conteúdo executável e referências externas de um SVG.

    Remove elementos ``<script>`` e ``<foreignObject>``, todo atributo ``on*``,
    atributos ``href``/``xlink:href`` cujo valor não comece com ``#`` e
    elementos ``<image>`` com referência externa (qualquer coisa além de
    referência local ``#`` ou ``data:image/png|jpeg``). Nada é executado:
    apenas parse XML via ElementTree (defusedxml quando instalado).
    """
    root = _parse(data)
    parent_of = {child: parent for parent in root.iter() for child in parent}

    removals: list[ET.Element] = []
    for element in root.iter():
        tag = _local_name(element.tag)
        if tag in _FORBIDDEN_TAGS or (tag == "image" and not _image_is_safe(element)):
            removals.append(element)
            continue
        for attr in list(element.attrib):
            if _local_name(attr).startswith("on"):
                del element.attrib[attr]
            elif attr in _HREF_ATTRS and not _href_is_safe(tag, element.attrib[attr]):
                del element.attrib[attr]

    for element in removals:
        parent = parent_of.get(element)
        if parent is not None:
            parent.remove(element)
    return ET.tostring(root, encoding="utf-8")


def _load_sanitized(svg_path: Path) -> ET.Element:
    return _parse(sanitize_svg(svg_path.read_bytes()))


def extract_svg_colors(svg_path: Path) -> list[Candidate]:
    """Extrai cores de ``fill``/``stroke`` (atributos e ``style`` inline) de um SVG.

    O SVG é sanitizado antes do parse. Valores ``none``, ``currentColor`` e
    ``transparent`` são ignorados; score = ocorrências normalizadas para máx=1.0.
    """
    root = _load_sanitized(svg_path)
    counts: dict[str, int] = {}
    for element in root.iter():
        paints = [element.attrib.get("fill"), element.attrib.get("stroke")]
        style = element.attrib.get("style")
        if style:
            paints.extend(
                match["value"]
                for match in _STYLE_DECL.finditer(style)
                if match["prop"].lower() in ("fill", "stroke")
            )
        for paint in paints:
            if paint is None or paint.strip().lower() in _IGNORED_PAINTS:
                continue
            try:
                hex_color = normalize_color(paint.strip())
            except ValueError:
                continue  # url(#…), inherit etc. não são cores diretas
            counts[hex_color] = counts.get(hex_color, 0) + 1

    if not counts:
        return []
    max_count = max(counts.values())
    return [
        Candidate(
            value=color,
            score=count / max_count,
            evidence=[
                Evidence(source_type="svg-asset", path=str(svg_path), confidence=_CONFIDENCE)
            ],
        )
        for color, count in sorted(counts.items(), key=lambda item: item[1], reverse=True)
    ]


def _parse_length(value: str | None) -> float | None:
    if value is None:
        return None
    match = _LENGTH.match(value)
    return float(match.group(1)) if match else None


def svg_canvas_size(svg_path: Path) -> tuple[float, float]:
    """Tamanho do canvas do SVG: ``viewBox`` ou ``width``/``height``; (0, 0) se ausente."""
    root = _load_sanitized(svg_path)
    view_box = root.attrib.get("viewBox")
    if view_box:
        parts = re.split(r"[\s,]+", view_box.strip())
        if len(parts) == 4:
            try:
                return float(parts[2]), float(parts[3])
            except ValueError:
                pass
    width = _parse_length(root.attrib.get("width"))
    height = _parse_length(root.attrib.get("height"))
    if width is not None and height is not None:
        return width, height
    return (0.0, 0.0)
