from brand_runtime.intake.compile import compile_ir
from brand_runtime.intake.draft import build_draft
from brand_runtime.kit.direction import apply_creative_direction
from brand_runtime.kit.generator import generate_kit
from brand_runtime.kit.models import ContentSpec, TextValue
from tests.test_compile import FIXED, _answers


def _ir(brand_package):
    draft = build_draft(brand_package)
    return compile_ir(draft, _answers(draft), "ACME", created_at=FIXED)


def test_direction_changes_social_composition_and_surface(brand_package):
    ir = _ir(brand_package)
    layout = next(item for item in generate_kit(ir) if item.id == "statement-post-1x1")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={"headline": TextValue(text="Uma mensagem com direção")},
    )

    directed = apply_creative_direction(ir, layout, content)

    assert ir.creative_direction is not None
    assert directed.overrides["headline"].area != next(
        slot.area for slot in layout.slots if slot.id == "headline"
    )
    assert directed.overrides["logo"].area is not None
    assert directed.surface is not None
    assert directed.surface.kind == ir.creative_direction.surface


def test_direction_does_not_restyle_document_profile(brand_package):
    ir = _ir(brand_package)
    layout = next(item for item in generate_kit(ir) if item.id == "one-pager-doc-a4")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={"title": TextValue(text="Documento")},
    )

    assert apply_creative_direction(ir, layout, content) == content
