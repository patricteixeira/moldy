"""Sanitização de SVG hostil e extração de cores de logos vetoriais.

Uploads são tratados como hostis: todo SVG passa por ``sanitize_svg`` antes de
qualquer parse de cor ou de geometria (spec §5.3).
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

# defusedxml é dependência de runtime obrigatória (pyproject): endurece o parse
# contra bombas de expansão de entidades (billion laughs) e referências externas
# (XXE). Import direto e sem fallback — cair no parser stdlib silenciosamente
# deixaria uploads hostis sem proteção (spec §5.3).
from defusedxml.ElementTree import fromstring as _fromstring

from brand_runtime.colors import normalize_color
from brand_runtime.intake.base import Candidate
from brand_runtime.ir.models import Evidence

_SVG_NS = "http://www.w3.org/2000/svg"
_XLINK_NS = "http://www.w3.org/1999/xlink"
_HREF_ATTRS = ("href", f"{{{_XLINK_NS}}}href")
_FORBIDDEN_TAGS = {"script", "foreignobject"}
_IGNORED_PAINTS = {"none", "currentcolor", "transparent"}
_ALLOWED_IMAGE_DATA = re.compile(r"^data:image/(png|jpeg)[;,]", re.IGNORECASE)
_STYLE_DECL = re.compile(r"(?P<prop>[-\w]+)\s*:\s*(?P<value>[^;]+)")
_STYLE_RULE = re.compile(r"(?P<selectors>[^{}]+)\{(?P<body>[^{}]*)\}")
_SIMPLE_SELECTOR = re.compile(r"^(?P<tag>[A-Za-z][\w-]*)?(?P<classes>(?:\.[A-Za-z_][\w-]*)+)$")
_CSS_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_CSS_IMPORT = re.compile(r"@\s*import\b", re.IGNORECASE)
_CSS_URL = re.compile(r"url\(\s*(?P<quote>['\"]?)(?P<target>.*?)\1\s*\)", re.IGNORECASE)
_LENGTH = re.compile(r"^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$", re.IGNORECASE)
_CONFIDENCE = 0.95
_PAINT_PROPS = frozenset({"color", "fill", "stroke"})
_DRAWABLE_TAGS = frozenset(
    {"circle", "ellipse", "line", "path", "polygon", "polyline", "rect", "text", "use"}
)
_NON_RENDERED_CONTAINERS = frozenset(
    {"clippath", "defs", "lineargradient", "mask", "marker", "pattern", "radialgradient", "symbol"}
)

ET.register_namespace("", _SVG_NS)
ET.register_namespace("xlink", _XLINK_NS)


class SvgInvalid(Exception):
    """SVG com XML não parseável."""


@dataclass(frozen=True)
class _CssRule:
    tag: str | None
    classes: frozenset[str]
    declarations: dict[str, str]


def _parse(data: bytes) -> ET.Element:
    try:
        return _fromstring(data)
    except Exception as exc:  # defusedxml levanta ParseError e DefusedXmlException
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


def _css_has_external_reference(value: str) -> bool:
    """Detecta importações e ``url()`` que não apontem a fragmentos locais."""
    inspected = _CSS_COMMENT.sub("", value)
    if _CSS_IMPORT.search(inspected):
        return True
    matches = list(_CSS_URL.finditer(inspected))
    if "url(" in inspected.casefold() and not matches:
        return True  # sintaxe truncada ou ofuscada: falhar fechado
    return any(not match["target"].strip().startswith("#") for match in matches)


def _assert_safe_css(value: str) -> None:
    if _css_has_external_reference(value):
        raise SvgInvalid("SVG inválido: CSS contém referência externa.")


def sanitize_svg(data: bytes) -> bytes:
    """Remove conteúdo executável e referências externas de um SVG.

    Remove elementos ``<script>`` e ``<foreignObject>``, todo atributo ``on*``,
    atributos ``href``/``xlink:href`` cujo valor não comece com ``#`` e
    elementos ``<image>`` com referência externa (qualquer coisa além de
    referência local ``#`` ou ``data:image/png|jpeg``). Nada é executado:
    o parse XML usa defusedxml, que rejeita declarações de entidade (bombas de
    expansão como billion laughs) e referências externas com ``SvgInvalid``.
    """
    root = _parse(data)
    parent_of = {child: parent for parent in root.iter() for child in parent}

    removals: list[ET.Element] = []
    for element in root.iter():
        tag = _local_name(element.tag)
        if tag in _FORBIDDEN_TAGS or (tag == "image" and not _image_is_safe(element)):
            removals.append(element)
            continue
        if tag == "style" and element.text:
            _assert_safe_css(element.text)
        for attr in list(element.attrib):
            if _local_name(attr).startswith("on"):
                del element.attrib[attr]
            elif attr in _HREF_ATTRS and not _href_is_safe(tag, element.attrib[attr]):
                del element.attrib[attr]
            elif _local_name(attr) in {"fill", "stroke", "style"}:
                _assert_safe_css(element.attrib[attr])

    for element in removals:
        parent = parent_of.get(element)
        if parent is not None:
            parent.remove(element)
    return ET.tostring(root, encoding="utf-8")


def _load_sanitized(svg_path: Path) -> ET.Element:
    return _parse(sanitize_svg(svg_path.read_bytes()))


def _style_declarations(value: str | None) -> dict[str, str]:
    if not value:
        return {}
    return {
        match["prop"].casefold(): match["value"].strip()
        for match in _STYLE_DECL.finditer(value)
        if match["prop"].casefold() in _PAINT_PROPS
    }


def _internal_css_rules(root: ET.Element) -> list[_CssRule]:
    """Compila seletores internos comuns sem executar um motor CSS completo."""
    result: list[_CssRule] = []
    for element in root.iter():
        if _local_name(element.tag) != "style" or not element.text:
            continue
        for rule in _STYLE_RULE.finditer(_CSS_COMMENT.sub("", element.text)):
            declarations = _style_declarations(rule["body"])
            if not declarations:
                continue
            for selector in rule["selectors"].split(","):
                # Suporta ``.line``, ``path.line.active`` e o último composto de
                # ``svg .mark``/``g > path.ink``. Pseudo-classes e seletores de
                # atributo são ignorados de forma conservadora.
                terminal = re.split(r"\s+|>", selector.strip())[-1]
                match = _SIMPLE_SELECTOR.fullmatch(terminal)
                if match is None:
                    continue
                classes = frozenset(re.findall(r"\.([A-Za-z_][\w-]*)", match["classes"]))
                result.append(
                    _CssRule(
                        tag=match["tag"].casefold() if match["tag"] else None,
                        classes=classes,
                        declarations=declarations,
                    )
                )
    return result


def _matching_css_declarations(
    element: ET.Element, rules: list[_CssRule]
) -> tuple[dict[str, str], bool]:
    tag = _local_name(element.tag)
    classes = frozenset(element.attrib.get("class", "").split())
    declarations: dict[str, str] = {}
    matched_paint = False
    for rule in rules:
        if rule.tag not in {None, tag} or not rule.classes.issubset(classes):
            continue
        declarations.update(rule.declarations)
        matched_paint = matched_paint or bool(rule.declarations.keys() & {"fill", "stroke"})
    return declarations, matched_paint


def _resolve_paint_value(
    raw: str | None, inherited: str | None, resolved_color: str | None
) -> tuple[str | None, bool]:
    if raw is None:
        return inherited, False
    normalized = raw.strip()
    folded = normalized.casefold()
    if folded == "inherit":
        return inherited, inherited is None
    if folded == "currentcolor":
        return resolved_color, resolved_color is None
    if "var(" in folded:
        return None, True
    return normalized, False


def _resolved_elements(root: ET.Element):
    """Percorre geometria com fill/stroke/color resolvidos e CSS interno aplicado."""
    rules = _internal_css_rules(root)

    def visit(
        element: ET.Element,
        inherited: dict[str, str | None],
        hidden: bool,
    ):
        tag = _local_name(element.tag)
        hidden = hidden or tag in _NON_RENDERED_CONTAINERS
        declarations = {
            prop: element.attrib[prop] for prop in _PAINT_PROPS if prop in element.attrib
        }
        css_declarations, matched_class_paint = _matching_css_declarations(element, rules)
        declarations.update(css_declarations)
        declarations.update(_style_declarations(element.attrib.get("style")))

        color, unresolved_color = _resolve_paint_value(
            declarations.get("color"), inherited.get("color"), inherited.get("color")
        )
        fill, unresolved_fill = _resolve_paint_value(
            declarations.get("fill"), inherited.get("fill"), color
        )
        stroke, unresolved_stroke = _resolve_paint_value(
            declarations.get("stroke"), inherited.get("stroke"), color
        )
        resolved = {"color": color, "fill": fill, "stroke": stroke}
        unresolved = unresolved_color or unresolved_fill or unresolved_stroke
        if not hidden:
            yield element, resolved, unresolved, matched_class_paint
        for child in element:
            yield from visit(child, resolved, hidden)

    yield from visit(root, {"color": None, "fill": None, "stroke": None}, False)


def _visible_paint(value: str | None) -> bool:
    return value is not None and value.strip().casefold() not in {"none", "transparent"}


def svg_external_style_missing(svg_path: Path) -> bool:
    """Detecta geometria que depende de classes de pintura não definidas no SVG.

    Uma classe pode ser usada para metadados ou scripts; por isso ela só torna o
    arquivo inválido quando o elemento geométrico também não possui pintura
    própria, herdada de um ancestral ou declarada em ``<style>`` interno.
    """
    root = _load_sanitized(svg_path)
    for element, resolved, unresolved, matched_class_paint in _resolved_elements(root):
        if _local_name(element.tag) not in _DRAWABLE_TAGS:
            continue
        classes = element.attrib.get("class", "").split()
        visible = _visible_paint(resolved["fill"]) or _visible_paint(resolved["stroke"])
        if unresolved or (classes and not visible and not matched_class_paint):
            return True
        if classes and not visible:
            return True
    return False


def extract_svg_colors(svg_path: Path) -> list[Candidate]:
    """Extrai cores de ``fill``/``stroke`` (atributos e ``style`` inline) de um SVG.

    O SVG é sanitizado antes do parse. Valores ``none``, ``currentColor`` e
    ``transparent`` são ignorados; score = ocorrências normalizadas para máx=1.0.
    """
    root = _load_sanitized(svg_path)
    counts: dict[str, int] = {}
    for element, resolved, _unresolved, _matched_class_paint in _resolved_elements(root):
        if _local_name(element.tag) not in _DRAWABLE_TAGS:
            continue
        paints = [resolved["fill"], resolved["stroke"]]
        if paints == [None, None] and not element.attrib.get("class"):
            paints[0] = "#000000"  # fill inicial do SVG para geometria sem classe
        for paint in paints:
            if paint is None or paint.strip().casefold() in _IGNORED_PAINTS:
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
