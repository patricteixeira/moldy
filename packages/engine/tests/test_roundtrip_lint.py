from brand_runtime.roundtrip.fix import build_fix_plan
from brand_runtime.roundtrip.lint import lint_roundtrip
from brand_runtime.roundtrip.models import (
    BoundsPt,
    DocumentGraph,
    DocumentNode,
    DocumentSource,
)


def _node(slot: str, role: str, shape_id: int) -> DocumentNode:
    return DocumentNode(
        id=f"slide-1/shape-{shape_id}",
        slide_index=1,
        shape_id=shape_id,
        kind="picture" if role == "logo" else "text",
        name=f"br:{role}:{slot}",
        role=role,
        slot_id=slot,
        brand_revision_id="brandrev_test",
        semantic_source="name",
        text=None if role == "logo" else "Texto",
        font_family=None if role == "logo" else "Arial",
        font_size_pt=None if role == "logo" else 24,
        color=None if role == "logo" else "#111111",
        bounds_pt=BoundsPt(x=10, y=20, width=100, height=50),
    )


def _graph(digest: str, nodes: list[DocumentNode]) -> DocumentGraph:
    return DocumentGraph(
        source=DocumentSource(
            filename="proof.pptx",
            sha256=digest * 64,
            size_bytes=100,
            slide_count=1,
        ),
        nodes=nodes,
        diagnostics=[],
    )


def test_roundtrip_lint_passes_when_semantic_document_is_unchanged():
    baseline = _graph("a", [_node("headline", "heading", 2)])
    edited = _graph("b", [baseline.nodes[0].model_copy(update={"shape_id": 84})])

    report = lint_roundtrip(baseline, edited)

    assert report.summary.status == "pass"
    assert report.summary.total == 0
    assert report.findings == []


def test_roundtrip_lint_blocks_removed_node_and_revision_switch():
    heading = _node("headline", "heading", 2)
    baseline = _graph("a", [heading, _node("logo", "logo", 4)])
    edited_heading = heading.model_copy(
        update={"shape_id": 84, "brand_revision_id": "brandrev_other"}
    )
    unexpected = _node("caption", "body", 90)
    edited = _graph("b", [edited_heading, unexpected])

    report = lint_roundtrip(baseline, edited)

    assert [item.code for item in report.findings] == [
        "brand-revision",
        "missing-node",
        "unexpected-node",
    ]
    assert report.summary.status == "blocked"
    assert report.summary.locked == 2
    assert report.summary.warning == 1


def test_fix_plan_deduplicates_properties_and_defers_text():
    heading = _node("headline", "heading", 2)
    baseline = _graph("a", [heading])
    edited = _graph(
        "b",
        [
            heading.model_copy(
                update={
                    "text": "Texto aprovado pela pessoa",
                    "color": "#E57900",
                    "bounds_pt": BoundsPt(x=12, y=20, width=100, height=50),
                }
            )
        ],
    )
    report = lint_roundtrip(baseline, edited)

    plan = build_fix_plan(edited, report)

    assert [operation.property for operation in plan.operations] == ["boundsPt", "color"]
    assert plan.operations[0].expected == heading.bounds_pt
    assert plan.operations[1].expected == "#111111"
    assert plan.deferred_finding_codes == ["text-changed"]
