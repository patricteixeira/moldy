import json

import pytest

from brand_runtime.ir.schema import export_schemas
from brand_runtime.kit.models import (
    PROFILES,
    Background,
    Canvas,
    ContentSpec,
    LayoutSpec,
    Slot,
    TextValue,
)


def test_profiles_match_master_contract():
    assert PROFILES["post-1x1"] == (1080, 1080, 48)
    assert PROFILES["doc-a4"] == (794, 1123, 76)


def test_text_slot_requires_role():
    with pytest.raises(Exception):
        Slot(id="t", kind="text", area=(0, 0, 10, 10))  # sem role


def test_layout_profile_validated():
    with pytest.raises(Exception):
        LayoutSpec(
            id="x",
            profile="post-2x3",
            name_pt="X",
            canvas=Canvas(width_px=1, height_px=1, safe_area_px=0),
            background=Background(kind="color", color_token="color.primary"),
            slots=[],
        )


def test_content_spec_round_trip():
    cs = ContentSpec(
        layout_id="statement-post-1x1",
        brand_revision_id="brandrev_abc",
        values={"headline": TextValue(text="Olá")},
    )
    data = json.loads(cs.model_dump_json(by_alias=True))
    assert data["layoutId"] == "statement-post-1x1"
    assert ContentSpec.model_validate(data) == cs


def test_schemas_exported(tmp_path):
    names = {p.name for p in export_schemas(tmp_path)}
    assert {
        "brand-ir.schema.json",
        "layout-spec.schema.json",
        "content-spec.schema.json",
    } <= names


def _layout(**changes):
    data = {
        "id": "statement-post-1x1",
        "profile": "post-1x1",
        "name_pt": "Frase de impacto",
        "canvas": Canvas(width_px=1080, height_px=1080, safe_area_px=48),
        "background": Background(kind="color", color_token="color.background"),
        "slots": [
            Slot(
                id="headline",
                kind="text",
                role="heading",
                max_chars=90,
                area=(48, 324, 984, 432),
            )
        ],
    }
    data.update(changes)
    return LayoutSpec(**data)


def test_profile_requires_its_canonical_canvas():
    with pytest.raises(Exception, match="canvas do perfil"):
        _layout(canvas=Canvas(width_px=1, height_px=1, safe_area_px=0))


def test_slots_must_fit_and_have_unique_ids():
    with pytest.raises(Exception, match="ultrapassa"):
        _layout(
            slots=[Slot(id="x", kind="image", area=(1000, 1000, 100, 100))],
        )
    duplicate = Slot(id="x", kind="logo", area=(0, 0, 10, 10), fit="fixed")
    with pytest.raises(Exception, match="únicos"):
        _layout(slots=[duplicate, duplicate.model_copy(deep=True)])


def test_empty_conditional_references_are_rejected():
    with pytest.raises(Exception):
        Slot(id="t", kind="text", role=" ", area=(0, 0, 10, 10))
    with pytest.raises(Exception):
        Background(kind="color", color_token=" ")


def test_public_schema_exposes_profiles_constraints_and_logo_evidence(tmp_path):
    export_schemas(tmp_path)
    layout_schema = json.loads((tmp_path / "layout-spec.schema.json").read_text(encoding="utf-8"))
    assert set(layout_schema["properties"]["profile"]["enum"]) == set(PROFILES)
    profile_rules = layout_schema["allOf"]
    one_by_one = next(
        rule
        for rule in profile_rules
        if rule["if"]["properties"]["profile"] == {"const": "post-1x1"}
    )
    canvas_contract = one_by_one["then"]["properties"]["canvas"]["properties"]
    assert canvas_contract["widthPx"] == {"const": 1080}
    assert canvas_contract["heightPx"] == {"const": 1080}
    assert canvas_contract["safeAreaPx"] == {"const": 48}
    slot_schema = layout_schema["$defs"]["Slot"]
    assert slot_schema["properties"]["area"]["prefixItems"][2]["exclusiveMinimum"] == 0
    assert slot_schema["allOf"][0]["then"]["required"] == ["role"]
    assert "safeAreaPx" in layout_schema["$defs"]["Canvas"]["properties"]

    brand_schema = json.loads((tmp_path / "brand-ir.schema.json").read_text(encoding="utf-8"))
    logo = brand_schema["$defs"]["LogoAsset"]
    assert "evidence" in logo["properties"]
    assert "evidence" in logo["required"]
