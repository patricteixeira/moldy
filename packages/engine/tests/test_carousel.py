import pytest

from brand_runtime import generate_carousel_layouts
from tests.test_generator import _ir


@pytest.mark.parametrize(
    ("profile", "height"),
    [("post-1x1", 1080), ("post-4x5", 1350)],
)
def test_carousel_has_cover_two_content_variants_and_closing(
    brand_package,
    profile,
    height,
):
    layouts = generate_carousel_layouts(_ir(brand_package), profile)

    assert [layout.id for layout in layouts] == [
        f"carousel-cover-{profile}",
        f"carousel-content-a-{profile}",
        f"carousel-content-b-{profile}",
        f"carousel-closing-{profile}",
    ]
    assert all(layout.profile == profile for layout in layouts)
    assert all(layout.canvas.height_px == height for layout in layouts)


def test_content_slides_reserve_six_optional_blocks_and_signature(brand_package):
    layouts = generate_carousel_layouts(_ir(brand_package), "post-4x5")

    for layout in layouts[1:3]:
        slots = {slot.id: slot for slot in layout.slots}
        assert all(f"body-{index}" in slots for index in range(1, 7))
        assert all(slots[f"body-{index}"].required is False for index in range(1, 7))
        assert slots["signature"].required is False
        assert slots["logo"].kind == "logo"


def test_carousel_roles_have_different_information_density(brand_package):
    cover, content_a, content_b, closing = generate_carousel_layouts(
        _ir(brand_package),
        "post-4x5",
    )

    assert {slot.id for slot in cover.slots} == {
        "index",
        "kicker",
        "headline",
        "deck",
        "signature",
        "logo",
    }
    assert content_a.locked_layers != content_b.locked_layers
    assert {slot.id for slot in closing.slots} == {
        "index",
        "logo",
        "headline",
        "cta",
        "signature",
    }


def test_content_b_reserves_height_for_the_complete_editorial_counter(brand_package):
    layouts = generate_carousel_layouts(_ir(brand_package), "post-4x5")
    content_b = layouts[2]
    index = next(slot for slot in content_b.slots if slot.id == "index")

    assert index.role == "heading"
    assert index.area == (80, 86, 190, 232)
