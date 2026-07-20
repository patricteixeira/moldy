import json

import pytest

from brand_runtime.ir.schema import export_schemas
from brand_runtime.kit.models import (
    PROFILES,
    AssetLayer,
    Background,
    Canvas,
    ContentSpec,
    LayerOverride,
    LayoutSpec,
    MotifLayer,
    ShapeLayer,
    Slot,
    SURFACE_KINDS,
    SurfaceStyle,
    TextValue,
    materialize_content_layout,
)


def test_profiles_match_master_contract():
    assert PROFILES["post-1x1"] == (1080, 1080, 48)
    assert PROFILES["doc-a4"] == (794, 1123, 76)


def test_text_slot_requires_role():
    with pytest.raises(Exception):
        Slot(id="t", kind="text", area=(0, 0, 10, 10))  # sem role


def test_closed_editorial_slot_properties_are_typed_and_scoped():
    legacy = Slot(id="image", kind="image", area=(0, 0, 10, 10))
    assert legacy.z_index is None

    outlined = Slot(
        id="index",
        kind="text",
        role="index",
        area=(0, 0, 100, 100),
        fill_mode="stroke",
        stroke_color_token="color.text",
        stroke_width_px=2.5,
        text_format="zero-padded",
        letter_spacing_em=-0.04,
    )
    assert outlined.fill_mode == "stroke"

    with pytest.raises(Exception, match="tipográficas"):
        Slot(
            id="image",
            kind="image",
            area=(0, 0, 10, 10),
            text_transform="uppercase",
        )
    with pytest.raises(Exception, match="exige token"):
        Slot(
            id="index",
            kind="text",
            role="index",
            area=(0, 0, 10, 10),
            fill_mode="stroke",
        )


def test_text_emphasis_is_nonblank_but_can_temporarily_differ_during_editing():
    assert TextValue(text="Texto novo", emphasis="trecho antigo").emphasis == "trecho antigo"
    with pytest.raises(Exception):
        TextValue(text="Texto", emphasis="   ")


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


def test_document_can_materialize_editable_user_elements_without_mutating_layout():
    layout = _layout()
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id="brandrev_abc",
        values={
            "headline": TextValue(text="Original"),
            "user-text-1": TextValue(text="Bloco adicional"),
        },
        added_slots=[
            Slot(
                id="user-text-1",
                kind="text",
                role="body",
                area=(48, 800, 500, 120),
                required=False,
            )
        ],
        added_layers=[
            ShapeLayer(
                id="user-shape-1",
                shape="rectangle",
                area=(48, 760, 200, 4),
                color_token="color.primary",
            )
        ],
    )

    active = materialize_content_layout(layout, content)

    assert [slot.id for slot in layout.slots] == ["headline"]
    assert [slot.id for slot in active.slots] == ["headline", "user-text-1"]
    assert [layer.id for layer in active.locked_layers] == ["user-shape-1"]
    assert content.model_dump(mode="json", by_alias=True)["addedSlots"][0]["id"] == "user-text-1"


def test_document_owned_elements_require_user_prefix_and_unique_ids():
    with pytest.raises(Exception, match="user-"):
        ContentSpec(
            layout_id="statement-post-1x1",
            brand_revision_id="brandrev_abc",
            values={},
            added_slots=[Slot(id="free-text", kind="text", role="body", area=(0, 0, 100, 100))],
        )

    shared = "user-element-1"
    with pytest.raises(Exception, match="únicos"):
        ContentSpec(
            layout_id="statement-post-1x1",
            brand_revision_id="brandrev_abc",
            values={},
            added_slots=[Slot(id=shared, kind="text", role="body", area=(0, 0, 100, 100))],
            added_layers=[
                ShapeLayer(
                    id=shared,
                    shape="rectangle",
                    area=(0, 0, 10, 10),
                    color_token="color.primary",
                )
            ],
        )


@pytest.mark.parametrize("kind", SURFACE_KINDS)
def test_surface_catalog_is_typed_and_portable(kind):
    surface = SurfaceStyle(kind=kind, color_token="color.primary")
    assert surface.kind == kind


def test_layer_override_accepts_negative_position_and_oversized_dimensions():
    override = LayerOverride(area=(-540, -120, 2160, 2700))
    assert override.area == (-540, -120, 2160, 2700)

    with pytest.raises(Exception):
        LayerOverride(area=(-32769, 0, 100, 100))


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


def test_locked_layers_are_discriminated_ordered_and_inside_canvas():
    layers = [
        MotifLayer(
            id="pattern",
            motif="diagonal-lines",
            area=(0, 0, 1080, 1080),
            color_token="color.text",
            opacity=0.06,
            stroke_width_px=2,
            spacing_px=28,
        ),
        ShapeLayer(
            id="rule",
            shape="rectangle",
            area=(48, 48, 56, 4),
            color_token="color.secondary",
        ),
        AssetLayer(
            id="mark",
            asset_token="logo.onLight",
            area=(920, 104, 52, 52),
        ),
    ]
    layout = _layout(locked_layers=layers, composition_mode="light")
    serialized = layout.model_dump(mode="json", by_alias=True)
    assert [item["kind"] for item in serialized["lockedLayers"]] == [
        "motif",
        "shape",
        "asset",
    ]

    with pytest.raises(Exception, match="ultrapassa"):
        _layout(
            locked_layers=[
                ShapeLayer(
                    id="outside",
                    shape="circle",
                    area=(1070, 1070, 20, 20),
                    color_token="color.secondary",
                )
            ]
        )


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
