import json
from datetime import datetime, timezone
from brand_runtime.ir.models import (
    BrandIR, BrandInfo, ColorToken, Evidence, FontToken, LogoAsset,
    RevisionInfo, SemanticRole,
)
from brand_runtime.ir.schema import export_schemas


def _minimal_ir() -> BrandIR:
    ev = Evidence(source_type="wizard-confirmation", confidence=1.0, authoritative=True,
                  confirmed_at=datetime(2026, 7, 11, tzinfo=timezone.utc))
    return BrandIR(
        brand=BrandInfo(name="ACME"),
        revision=RevisionInfo(id="brandrev_abc123", created_at=datetime(2026, 7, 11, tzinfo=timezone.utc)),
        colors={"color.primary": ColorToken(value="#1a4d8f", evidence=[ev])},
        fonts={"font.heading": FontToken(family="Archivo", weight=700, source="referenced-only", evidence=[ev])},
        roles={"heading": SemanticRole(font="font.heading", color="color.primary",
                                       min_size_px=40, max_size_px=96, line_height=1.1)},
        assets={"logo.primary": LogoAsset(path="assets/logos/a.svg", sha256="0" * 64, format="svg")},
    )


def test_color_value_is_normalized():
    ir = _minimal_ir()
    assert ir.colors["color.primary"].value == "#1A4D8F"


def test_json_is_camel_case_and_round_trips():
    ir = _minimal_ir()
    data = json.loads(ir.model_dump_json(by_alias=True))
    assert data["schemaVersion"] == "0.1.0"
    assert data["colors"]["color.primary"]["evidence"][0]["sourceType"] == "wizard-confirmation"
    assert BrandIR.model_validate(data) == ir


def test_confidence_bounds_enforced():
    import pytest
    with pytest.raises(Exception):
        Evidence(source_type="manual-entry", confidence=1.5)


def test_export_schemas(tmp_path):
    paths = export_schemas(tmp_path)
    names = {p.name for p in paths}
    assert "brand-ir.schema.json" in names
    schema = json.loads((tmp_path / "brand-ir.schema.json").read_text(encoding="utf-8"))
    assert "schemaVersion" in schema["properties"]
