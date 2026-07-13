import pytest

from brand_runtime.intake.svg_logo import (
    SvgInvalid,
    extract_svg_colors,
    sanitize_svg,
    svg_canvas_size,
    svg_external_style_missing,
)

MALICIOUS = b"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <script>alert(1)</script>
  <rect width="60" height="100" fill="#1A4D8F" onclick="evil()"/>
  <circle r="20" fill="#F4A300" stroke="#1A4D8F"/>
  <image href="https://evil.example/x.png"/>
  <use href="#ok"/>
</svg>"""

# Bomba de expansão de entidades (billion laughs): ~400 bytes que expandem para
# 100 KB — cada nível extra de entidade multiplica por 10 (DoS de memória).
ENTITY_BOMB = b"""<?xml version="1.0"?>
<!DOCTYPE svg [
  <!ENTITY a "0123456789">
  <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">
  <!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">
  <!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">
  <!ENTITY e "&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;">
]>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#1A4D8F" data-bomb="&e;"/>
</svg>"""


def test_sanitize_strips_dangerous_content():
    clean = sanitize_svg(MALICIOUS)
    text = clean.decode("utf-8")
    assert "<script" not in text
    assert "onclick" not in text
    assert "evil.example" not in text
    assert 'href="#ok"' in text  # referência local preservada


def test_extract_colors_counts_fills_and_strokes(tmp_path):
    p = tmp_path / "logo.svg"
    p.write_bytes(MALICIOUS)
    cands = extract_svg_colors(p)
    scores = {c.value: c.score for c in cands}
    assert scores["#1A4D8F"] == 1.0  # 2 ocorrências (fill + stroke), normalizado
    assert scores["#F4A300"] == 0.5  # 1 ocorrência


def test_canvas_size_from_viewbox(tmp_path):
    p = tmp_path / "logo.svg"
    p.write_bytes(MALICIOUS)
    assert svg_canvas_size(p) == (100.0, 100.0)


def test_sanitize_rejects_entity_expansion_bomb():
    with pytest.raises(SvgInvalid):
        sanitize_svg(ENTITY_BOMB)


def test_detects_geometry_that_depends_on_missing_external_class_styles(tmp_path):
    path = tmp_path / "logo-externo.svg"
    path.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<defs><mask id="cut"><rect width="100" height="100" fill="#fff"/></mask></defs>'
        '<path class="ink" d="M0 0h100v100H0z"/>'
        '<circle class="sun" cx="50" cy="50" r="5"/>'
        "</svg>",
        encoding="utf-8",
    )

    assert svg_external_style_missing(path) is True
    assert extract_svg_colors(path) == []  # branco técnico da máscara não vira paleta


def test_internal_class_styles_are_self_contained_and_extracted(tmp_path):
    path = tmp_path / "logo-interno.svg"
    path.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        "<style>.ink { fill: #1F232A } .sun { fill: #CA6B0B }</style>"
        '<path class="ink" d="M0 0h100v100H0z"/>'
        '<circle class="sun" cx="50" cy="50" r="5"/>'
        "</svg>",
        encoding="utf-8",
    )

    assert svg_external_style_missing(path) is False
    assert {candidate.value for candidate in extract_svg_colors(path)} == {"#1F232A", "#CA6B0B"}


def test_mask_paints_do_not_contaminate_self_contained_logo_palette(tmp_path):
    path = tmp_path / "logo.svg"
    path.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<defs><mask id="cut"><rect width="100" height="100" fill="#fff"/>'
        '<path d="M0 0h20v20H0z" fill="#000"/></mask></defs>'
        '<g fill="none" stroke="#1F232A"><path d="M0 0h100v100H0z"/>'
        '<circle cx="50" cy="50" r="5" fill="#CA6B0B" stroke="none"/></g>'
        "</svg>",
        encoding="utf-8",
    )

    assert svg_external_style_missing(path) is False
    assert {candidate.value for candidate in extract_svg_colors(path)} == {"#1F232A", "#CA6B0B"}


def test_fill_none_does_not_hide_missing_external_stroke_class(tmp_path):
    path = tmp_path / "linha-externa.svg"
    path.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<g fill="none"><path class="line" d="M0 0h100"/></g></svg>',
        encoding="utf-8",
    )

    assert svg_external_style_missing(path) is True


@pytest.mark.parametrize("paint", ["currentColor", "var(--brand-ink)", "inherit"])
def test_unresolved_dynamic_paints_are_not_self_contained(tmp_path, paint):
    path = tmp_path / "dinamico.svg"
    path.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        f'<path class="ink" fill="{paint}" d="M0 0h100v100H0z"/></svg>',
        encoding="utf-8",
    )

    assert svg_external_style_missing(path) is True


def test_current_color_is_self_contained_when_color_is_internal(tmp_path):
    path = tmp_path / "current-color.svg"
    path.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" color="#1F232A">'
        '<path class="ink" fill="currentColor" d="M0 0h100v100H0z"/></svg>',
        encoding="utf-8",
    )

    assert svg_external_style_missing(path) is False
    assert [candidate.value for candidate in extract_svg_colors(path)] == ["#1F232A"]


def test_safe_internal_compound_css_is_supported(tmp_path):
    path = tmp_path / "css-composto.svg"
    path.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        "<style>svg .line, path.ink.active { fill: none; stroke: #1F232A }</style>"
        '<path class="line" d="M0 0h100"/>'
        '<path class="ink active" d="M0 10h100"/>'
        "</svg>",
        encoding="utf-8",
    )

    assert svg_external_style_missing(path) is False
    assert [candidate.value for candidate in extract_svg_colors(path)] == ["#1F232A"]


@pytest.mark.parametrize(
    "svg",
    [
        '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.test/x.css);</style></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg"><style>.x{fill:url(https://evil.test/x.svg)}</style></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg"><path style="fill:url(https://evil.test/x.svg)"/></svg>',
    ],
)
def test_sanitize_rejects_external_css_references(svg):
    with pytest.raises(SvgInvalid, match="CSS contém referência externa"):
        sanitize_svg(svg.encode())


def test_sanitize_keeps_local_css_fragment_reference():
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg"><style>.x{fill:url(#gradient)}</style>'
        '<path class="x" d="M0 0h10v10H0z"/></svg>'
    )

    clean = sanitize_svg(svg.encode()).decode()

    assert "url(#gradient)" in clean
