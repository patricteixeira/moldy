import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

from brand_runtime.ir.models import (
    AccentRule,
    BrandIR,
    BrandInfo,
    ColorToken,
    CompositionMode,
    CompositionModes,
    CompositionRules,
    Evidence,
    FontAxis,
    FontResource,
    FontToken,
    LogoAsset,
    RevisionInfo,
    SemanticRole,
)
from brand_runtime.ir.schema import export_schemas


def _minimal_ir() -> BrandIR:
    ev = Evidence(
        source_type="wizard-confirmation",
        confidence=1.0,
        authoritative=True,
        confirmed_at=datetime(2026, 7, 11, tzinfo=timezone.utc),
    )
    return BrandIR(
        brand=BrandInfo(name="ACME"),
        revision=RevisionInfo(
            id="brandrev_abc123", created_at=datetime(2026, 7, 11, tzinfo=timezone.utc)
        ),
        colors={"color.primary": ColorToken(value="#1a4d8f", evidence=[ev])},
        fonts={
            "font.heading": FontToken(
                family="Archivo", weight=700, source="referenced-only", evidence=[ev]
            )
        },
        roles={
            "heading": SemanticRole(
                font="font.heading",
                color="color.primary",
                min_size_px=40,
                max_size_px=96,
                line_height=1.1,
            )
        },
        assets={
            "logo.primary": LogoAsset(
                path="assets/logos/a.svg",
                sha256="0" * 64,
                format="svg",
                evidence=[ev],
            )
        },
    )


def test_color_value_is_normalized():
    ir = _minimal_ir()
    assert ir.colors["color.primary"].value == "#1A4D8F"


def test_json_is_camel_case_and_round_trips():
    ir = _minimal_ir()
    data = json.loads(ir.model_dump_json(by_alias=True))
    assert data["schemaVersion"] == "0.3.0"
    assert data["colors"]["color.primary"]["evidence"][0]["sourceType"] == "wizard-confirmation"
    assert BrandIR.model_validate(data) == ir


@pytest.mark.parametrize("version", ["0.1.0", "0.2.0"])
def test_reader_keeps_accepting_older_brand_ir_without_composition(version):
    data = _minimal_ir().model_dump(mode="json", by_alias=True)
    data["schemaVersion"] = version
    data["fonts"]["font.heading"].pop("resource")
    data.pop("compositionRules")

    assert BrandIR.model_validate(data).schema_version == version


def test_composition_rules_are_03_only_and_references_must_exist():
    ir = _minimal_ir()
    rules = CompositionRules(
        modes=CompositionModes(
            light=CompositionMode(
                background_color_token="color.primary",
                foreground_color_token="color.primary",
                logo_asset_token="logo.primary",
            )
        ),
        accent=AccentRule(color_token="color.primary", max_ratio=0.1),
    )
    assert ir.model_copy(update={"composition_rules": rules}).composition_rules == rules

    with pytest.raises(ValidationError, match="0.3.0"):
        BrandIR.model_validate(
            {
                **ir.model_dump(mode="json", by_alias=True),
                "schemaVersion": "0.2.0",
                "compositionRules": rules.model_dump(mode="json", by_alias=True),
            }
        )

    without_explicit_version = {
        **ir.model_dump(mode="json", by_alias=True),
        "compositionRules": rules.model_dump(mode="json", by_alias=True),
    }
    without_explicit_version.pop("schemaVersion")
    with pytest.raises(ValidationError, match="explícita"):
        BrandIR.model_validate(without_explicit_version)

    bad = rules.model_copy(deep=True)
    bad.modes.light.background_color_token = "color.missing"
    with pytest.raises(ValidationError, match="backgroundColorToken"):
        BrandIR.model_validate(
            {
                **ir.model_dump(mode="json", by_alias=True),
                "compositionRules": bad.model_dump(mode="json", by_alias=True),
            }
        )


def test_font_resource_normalizes_coverage_and_axes():
    resource = FontResource(
        provider="google-fonts",
        format="ttf",
        upstream_ref="google/fonts@abc:ofl/example/example.ttf",
        license_id="OFL-1.1",
        license_sha256="a" * 64,
        usage_policy="redistributable",
        coverage_profile="pt-BR-ui-v1",
        missing_codepoints=[233, 65, 233],
        axes=[
            FontAxis(tag="wght", minimum=100, default=400, maximum=900),
            FontAxis(tag="opsz", minimum=9, default=14, maximum=144),
        ],
    )

    assert resource.missing_codepoints == [65, 233]
    assert [axis.tag for axis in resource.axes] == ["opsz", "wght"]
    serialized = resource.model_dump(mode="json", by_alias=True)
    assert serialized["upstreamRef"].startswith("google/fonts@")
    assert serialized["licenseSha256"] == "a" * 64
    assert serialized["missingCodepoints"] == [65, 233]


@pytest.mark.parametrize("codepoint", [-1, 0xD800, 0x110000])
def test_font_resource_rejects_invalid_unicode_scalars(codepoint):
    with pytest.raises(ValidationError, match="escalares Unicode"):
        FontResource(
            provider="package-upload",
            format="otf",
            coverage_profile="pt-BR-ui-v1",
            missing_codepoints=[codepoint],
        )


def test_font_axis_rejects_invalid_interval():
    with pytest.raises(ValidationError, match="minimum <= default <= maximum"):
        FontAxis(tag="wght", minimum=700, default=400, maximum=900)


def test_confidence_bounds_enforced():
    with pytest.raises(Exception):
        Evidence(source_type="manual-entry", confidence=1.5)


def test_font_catalog_is_a_structured_evidence_source():
    evidence = Evidence(
        source_type="font-catalog",
        path="resolved-fonts/example.ttf",
        detail="google/fonts@abc:ofl/example/example.ttf",
        confidence=1,
    )

    assert evidence.source_type == "font-catalog"


def test_public_contract_rejects_unknown_fields_at_every_level():
    payload = _minimal_ir().model_dump(mode="json", by_alias=True)
    payload["unexpected"] = True

    with pytest.raises(ValidationError, match="unexpected"):
        BrandIR.model_validate(payload)

    payload.pop("unexpected")
    payload["brand"]["unexpected"] = True

    with pytest.raises(ValidationError, match="unexpected"):
        BrandIR.model_validate(payload)


def test_export_schemas(tmp_path):
    paths = export_schemas(tmp_path)
    names = {p.name for p in paths}
    assert "brand-ir.schema.json" in names
    schema = json.loads((tmp_path / "brand-ir.schema.json").read_text(encoding="utf-8"))
    assert "schemaVersion" in schema["properties"]
    font_token = schema["$defs"]["FontToken"]
    assert font_token["properties"]["resource"]["anyOf"][0]["$ref"] == "#/$defs/FontResource"
    assert "resource" not in font_token["required"]
    assert set(schema["properties"]["schemaVersion"]["enum"]) == {
        "0.1.0",
        "0.2.0",
        "0.3.0",
    }
    assert schema["allOf"][0]["then"]["required"] == ["schemaVersion"]

    committed = Path(__file__).resolve().parents[3] / "schemas" / "brand-ir.schema.json"
    assert committed.read_text(encoding="utf-8") == (tmp_path / "brand-ir.schema.json").read_text(
        encoding="utf-8"
    )
