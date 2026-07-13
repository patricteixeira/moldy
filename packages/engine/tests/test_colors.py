import pytest
from brand_runtime.colors import (
    normalize_color,
    delta_e,
    dedupe_colors,
    wcag_contrast,
    lightness,
    is_neutral,
)


def test_normalize_variants():
    assert normalize_color("#1a4d8f") == "#1A4D8F"
    assert normalize_color("#abc") == "#AABBCC"
    assert normalize_color("rgb(26, 77, 143)") == "#1A4D8F"
    assert normalize_color("navy") == "#000080"


def test_normalize_invalid():
    with pytest.raises(ValueError):
        normalize_color("isto-nao-e-cor")


def test_delta_e_identical_is_zero():
    assert delta_e("#1A4D8F", "#1A4D8F") == pytest.approx(0.0, abs=1e-6)


def test_dedupe_merges_near_colors():
    result = dedupe_colors([("#1A4D8F", 5.0), ("#1B4E90", 3.0), ("#F4A300", 2.0)])
    assert result[0] == ("#1A4D8F", 8.0)  # vizinhas fundidas, score somado
    assert result[1] == ("#F4A300", 2.0)


def test_wcag_contrast_black_on_white():
    assert wcag_contrast("#000000", "#FFFFFF") == pytest.approx(21.0, abs=0.1)


def test_lightness_and_neutral():
    assert lightness("#FFFFFF") > 99
    assert lightness("#000000") < 1
    assert is_neutral("#808080") is True
    assert is_neutral("#F4A300") is False
