from brand_runtime.intake.fonts import introspect_font


def test_reads_family_weight_style(fixture_font):
    info = introspect_font(fixture_font)
    assert info.family == "Fixture Sans"
    assert info.weight == 700
    assert info.style == "normal"
