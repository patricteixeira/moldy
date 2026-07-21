"""Resolução única de layouts persistidos e layouts internos derivados."""

from __future__ import annotations

import re

from brand_api.models import BrandRevision
from brand_api.revision_ir import revision_brand_ir
from brand_runtime import (
    LayoutSpec,
    generate_carousel_layouts,
    generate_template_layouts,
)
from brand_runtime.templates import recommend_template_layouts

_CAROUSEL_LAYOUT_ID = re.compile(r"^carousel-(?:cover|content-[ab]|closing)-(post-1x1|post-4x5)$")


def current_layouts(revision: BrandRevision) -> list[LayoutSpec]:
    """Resolve o catálogo atual sem modificar o snapshot imutável da revisão."""
    persisted = list(revision.kit)
    ir = revision_brand_ir(revision)
    generated = generate_template_layouts(ir)
    generated_by_id = {layout.id: layout for layout in generated}
    current: list[LayoutSpec] = []
    known_ids: set[str] = set()
    for item in persisted:
        layout_id = item.get("id") if isinstance(item, dict) else None
        if isinstance(layout_id, str):
            known_ids.add(layout_id)
        replacement = generated_by_id.get(layout_id) if layout_id is not None else None
        try:
            current.append(replacement or LayoutSpec.model_validate(item))
        except (TypeError, ValueError):
            continue
    current.extend(layout for layout in generated if layout.id not in known_ids)
    return current


def public_kit(revision: BrandRevision) -> list[dict]:
    """Sobrepõe templates versionados e prioriza sugestões sem alterar o snapshot."""
    ir = revision_brand_ir(revision)
    current = current_layouts(revision)
    recommendations = {
        item.layout_id: item for item in recommend_template_layouts(ir, current, limit=8)
    }
    return [
        {
            **layout.model_dump(mode="json", by_alias=True),
            **(
                {
                    "recommendationRank": recommendation.rank,
                    "recommendationReasonPt": recommendation.reason_pt,
                    "recommendationBasis": recommendation.basis,
                }
                if (recommendation := recommendations.get(layout.id)) is not None
                else {}
            ),
        }
        for layout in current
    ]


def resolve_layout(revision: BrandRevision, layout_id: str) -> LayoutSpec | None:
    """Resolve um layout sem alterar o snapshot imutável da revisão."""
    ir = revision_brand_ir(revision)
    template_layout = next(
        (layout for layout in generate_template_layouts(ir) if layout.id == layout_id),
        None,
    )
    if template_layout is not None:
        return template_layout

    raw_layout = next(
        (item for item in revision.kit if isinstance(item, dict) and item.get("id") == layout_id),
        None,
    )
    if raw_layout is not None:
        return LayoutSpec.model_validate(raw_layout)

    match = _CAROUSEL_LAYOUT_ID.fullmatch(layout_id)
    if match is None:
        return None
    return next(
        (
            layout
            for layout in generate_carousel_layouts(ir, match.group(1))
            if layout.id == layout_id
        ),
        None,
    )
