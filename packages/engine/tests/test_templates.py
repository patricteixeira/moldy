import pytest

from brand_runtime.export import export_document
from brand_runtime.intake.compile import compile_ir
from brand_runtime.intake.draft import build_draft
from brand_runtime.kit.models import ContentSpec, LayoutSpec, TextValue
from brand_runtime.templates import (
    constructivist_dynamics_package,
    data_evidence_package,
    device_mockup_package,
    editorial_collage_package,
    evaluate_template_package,
    fashion_editorial_package,
    geometric_modernism_package,
    kinetic_typography_package,
    minimal_luxury_package,
    product_campaign_package,
    swiss_system_package,
    template_packages,
    technical_diagram_package,
    typographic_brutalist_package,
    typographic_editorial_package,
)
from tests.test_compile import FIXED, _answers


def _ir(brand_package):
    draft = build_draft(brand_package)
    return compile_ir(draft, _answers(draft), "ACME", created_at=FIXED)


def _fingerprint(layout):
    return (
        tuple((slot.id, slot.area, slot.font_size_px, slot.text_align) for slot in layout.slots),
        tuple((layer.id, layer.area, layer.color_token) for layer in layout.locked_layers),
        tuple(
            (group.kind, group.area, tuple(group.children)) for group in layout.scene_graph.groups
        ),
    )


def test_typographic_editorial_publishes_three_individual_compositions(brand_package):
    package = typographic_editorial_package(_ir(brand_package))

    assert package.id == "typographic-editorial"
    assert package.version == "1.0.0"
    assert [composition.id for composition in package.compositions] == [
        "typographic-ledger-post-4x5",
        "typographic-monument-post-4x5",
        "typographic-diptych-post-4x5",
    ]
    assert all(composition.layout.scene_graph for composition in package.compositions)
    assert all(composition.export_support.pptx == "native" for composition in package.compositions)


@pytest.mark.parametrize(
    ("factory", "package_id", "composition_ids"),
    [
        (
            typographic_brutalist_package,
            "typographic-brutalist",
            [
                "brutalist-manifesto-post-4x5",
                "brutalist-collision-post-4x5",
                "brutalist-bands-post-4x5",
            ],
        ),
        (
            swiss_system_package,
            "swiss-system",
            [
                "swiss-rational-grid-post-4x5",
                "swiss-quiet-axis-post-4x5",
                "swiss-modular-field-post-4x5",
            ],
        ),
        (
            geometric_modernism_package,
            "geometric-modernism",
            [
                "geometric-orbit-post-4x5",
                "geometric-staircase-post-4x5",
                "geometric-signal-post-4x5",
            ],
        ),
        (
            kinetic_typography_package,
            "kinetic-typography",
            [
                "kinetic-echo-post-4x5",
                "kinetic-split-post-4x5",
                "kinetic-pulse-post-4x5",
            ],
        ),
        (
            constructivist_dynamics_package,
            "constructivist-dynamics",
            [
                "constructivist-wedge-post-4x5",
                "constructivist-broadcast-post-4x5",
                "constructivist-counterfield-post-4x5",
            ],
        ),
        (
            fashion_editorial_package,
            "fashion-editorial",
            [
                "fashion-cover-post-4x5",
                "fashion-spread-post-4x5",
                "fashion-portrait-post-4x5",
            ],
        ),
        (
            minimal_luxury_package,
            "minimal-luxury",
            [
                "luxury-whisper-post-4x5",
                "luxury-gallery-post-4x5",
                "luxury-column-post-4x5",
            ],
        ),
        (
            editorial_collage_package,
            "editorial-collage",
            [
                "collage-overlap-post-4x5",
                "collage-cutout-post-4x5",
                "collage-contact-sheet-post-4x5",
            ],
        ),
        (
            technical_diagram_package,
            "technical-diagram",
            [
                "technical-blueprint-post-4x5",
                "technical-annotation-post-4x5",
                "technical-flow-post-4x5",
            ],
        ),
        (
            product_campaign_package,
            "product-campaign",
            [
                "product-hero-post-4x5",
                "product-benefit-post-4x5",
                "product-launch-post-4x5",
            ],
        ),
        (
            data_evidence_package,
            "data-evidence",
            [
                "evidence-hero-metric-post-4x5",
                "evidence-comparison-post-4x5",
                "evidence-dashboard-post-4x5",
            ],
        ),
        (
            device_mockup_package,
            "device-mockup",
            [
                "device-phone-post-4x5",
                "device-browser-post-4x5",
                "device-ecosystem-post-4x5",
            ],
        ),
    ],
)
def test_next_families_publish_three_editable_compositions(
    brand_package,
    factory,
    package_id,
    composition_ids,
):
    package = factory(_ir(brand_package))

    assert package.id == package_id
    assert package.version == "1.0.0"
    assert [composition.id for composition in package.compositions] == composition_ids
    assert all(composition.layout.scene_graph for composition in package.compositions)
    assert all(composition.export_support.pptx == "native" for composition in package.compositions)
    assert all(
        {"headline", "logo"}.issubset({slot.id for slot in composition.layout.slots})
        for composition in package.compositions
    )


def test_compositions_have_distinct_structural_fingerprints(brand_package):
    package = typographic_editorial_package(_ir(brand_package))
    fingerprints = [_fingerprint(item.layout) for item in package.compositions]

    assert len(set(fingerprints)) == 3
    assert [len(item.layout.locked_layers) for item in package.compositions] == [5, 4, 4]
    assert [item.layout.scene_graph.groups[0].kind for item in package.compositions] == [
        "frame",
        "group",
        "grid",
    ]


def test_editorial_collage_empty_image_fields_keep_brand_chroma(brand_package):
    package = editorial_collage_package(_ir(brand_package))
    fallback_ids = {
        "overlap-secondary-mat",
        "cutout-photo-mat",
        "contact-frame-two",
        "contact-frame-three",
    }
    fallbacks = {
        layer.id: layer
        for composition in package.compositions
        for layer in composition.layout.locked_layers
        if layer.id in fallback_ids
    }

    assert set(fallbacks) == fallback_ids
    assert all(layer.color_token == "color.primary" for layer in fallbacks.values())
    assert all(0.1 <= layer.opacity <= 0.18 for layer in fallbacks.values())


def test_template_compilation_is_deterministic_and_does_not_share_state(brand_package):
    ir = _ir(brand_package)
    first = template_packages(ir)
    second = template_packages(ir)

    assert [package.model_dump_json(by_alias=True) for package in first] == [
        package.model_dump_json(by_alias=True) for package in second
    ]
    first[0].compositions[0].layout.slots[0].area = (0, 0, 1, 1)
    assert second[0].compositions[0].layout.slots[0].area == (80, 78, 500, 36)


def test_template_publication_quality_gates_pass(brand_package):
    for package in template_packages(_ir(brand_package)):
        report = evaluate_template_package(package)

        assert report.passed, report.findings
        assert len(set(report.structural_signatures.values())) == 3
        assert len(report.pair_distances) == 3
        assert min(report.pair_distances.values()) >= 0.35
        assert report.delegated_checks == {"no-overflow": "renderer", "contrast": "guard"}


def test_template_samples_pass_guard_and_measured_renderer(brand_package, render_dist, tmp_path):
    ir = _ir(brand_package)

    for package in template_packages(ir):
        for composition in package.compositions:
            content = ContentSpec(
                layout_id=composition.id,
                brand_revision_id=ir.revision.id,
                values={
                    slot_id: TextValue(text=text)
                    for slot_id, text in composition.sample_content_pt.items()
                },
            )
            result = export_document(
                ir,
                composition.layout,
                content,
                brand_package,
                render_dist,
                tmp_path / f"{composition.id}.png",
            )

            assert result.out_path.stat().st_size > 0
            assert not [check for check in result.guard_verdict.checks if check.status == "blocked"]


def test_scene_graph_rejects_cycles_and_unknown_references(brand_package):
    package = typographic_editorial_package(_ir(brand_package))
    serialized = package.compositions[0].layout.model_dump(mode="json", by_alias=True)
    serialized["sceneGraph"]["groups"][1]["children"] = ["message-stack"]
    serialized["sceneGraph"]["groups"][2]["children"] = ["meta-stack"]
    with pytest.raises(ValueError, match="ciclos"):
        LayoutSpec.model_validate(serialized)

    serialized = package.compositions[0].layout.model_dump(mode="json", by_alias=True)
    serialized["sceneGraph"]["groups"][0]["children"].append("unknown-node")
    with pytest.raises(ValueError, match="desconhecidos"):
        LayoutSpec.model_validate(serialized)
