from PIL import Image
from brand_runtime.intake.raster_logo import extract_raster_colors


def _make_logo(tmp_path):
    img = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
    for x in range(100):
        for y in range(100):
            if y < 20:
                continue  # faixa transparente
            img.putpixel((x, y), (26, 77, 143, 255) if x < 60 else (244, 163, 0, 255))
    p = tmp_path / "logo.png"
    img.save(p)
    return p


def test_extracts_two_colors_ignoring_transparency(tmp_path):
    cands = extract_raster_colors(_make_logo(tmp_path))
    values = [c.value for c in cands]
    assert values[0] == "#1A4D8F"  # 60% dos pixels opacos
    assert "#F4A300" in values
    assert len(values) == 2
