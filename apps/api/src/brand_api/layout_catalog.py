"""Resolução única de layouts persistidos e layouts internos derivados."""

from __future__ import annotations

import re

from brand_api.models import BrandRevision
from brand_runtime import BrandIR, LayoutSpec, generate_carousel_layouts

_CAROUSEL_LAYOUT_ID = re.compile(r"^carousel-(?:cover|content-[ab]|closing)-(post-1x1|post-4x5)$")


def resolve_layout(revision: BrandRevision, layout_id: str) -> LayoutSpec | None:
    """Resolve um layout sem alterar o snapshot imutável da revisão."""
    raw_layout = next(
        (item for item in revision.kit if isinstance(item, dict) and item.get("id") == layout_id),
        None,
    )
    if raw_layout is not None:
        return LayoutSpec.model_validate(raw_layout)

    match = _CAROUSEL_LAYOUT_ID.fullmatch(layout_id)
    if match is None:
        return None
    ir = BrandIR.model_validate(revision.ir)
    return next(
        (
            layout
            for layout in generate_carousel_layouts(ir, match.group(1))
            if layout.id == layout_id
        ),
        None,
    )
