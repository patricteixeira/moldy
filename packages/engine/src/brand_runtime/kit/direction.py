"""Aplicação determinística da direção criativa a uma instância de conteúdo."""

from __future__ import annotations

from brand_runtime.ir.models import BrandIR
from brand_runtime.kit.models import (
    AssetLayer,
    ContentSpec,
    LayerOverride,
    LayoutSpec,
    Slot,
    SurfaceStyle,
)


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def suggested_surface(ir: BrandIR) -> SurfaceStyle | None:
    """Materializa a superfície explicável da direção, sem depender do editor web."""
    direction = ir.creative_direction
    if direction is None or direction.surface == "none":
        return None
    color_token = next(
        (
            token
            for token in ("color.primary", "color.text", *ir.colors.keys())
            if token in ir.colors
        ),
        None,
    )
    if color_token is None:  # pragma: no cover - IR válido sempre contém cores
        return None
    return SurfaceStyle(
        kind=direction.surface,
        color_token=color_token,
        opacity=_clamp(0.05 + direction.surface_density * 0.13, 0.04, 0.2),
        scale_px=round(_clamp(104 - direction.surface_density * 78, 16, 112)),
        weight_px=round(_clamp(0.8 + direction.surface_density * 2.2, 0.8, 3), 1),
        angle_deg=round(_clamp(18 + direction.energy.value * 42, -24, 60)),
    )


def apply_creative_direction(ir: BrandIR, layout: LayoutSpec, content: ContentSpec) -> ContentSpec:
    """Transforma escala, ritmo e marca da peça a partir da identidade confirmada.

    A operação só cria overrides declarativos já suportados por preview, Guard e
    exportadores. Assim a campanha não recebe uma aparência exclusiva do navegador.
    """
    direction = ir.creative_direction
    if direction is None or layout.profile == "doc-a4":
        return content

    width = layout.canvas.width_px
    height = layout.canvas.height_px
    safe = layout.canvas.safe_area_px
    headline = next(
        (
            slot
            for slot in layout.slots
            if slot.id in {"headline", "title", "quote"} and slot.kind == "text"
        ),
        next((slot for slot in layout.slots if slot.kind == "text"), None),
    )
    logo: Slot | AssetLayer | None = next(
        (slot for slot in layout.slots if slot.kind == "logo"),
        next(
            (layer for layer in layout.locked_layers if isinstance(layer, AssetLayer)),
            None,
        ),
    )
    overrides = dict(content.overrides)

    if headline is not None:
        role = ir.roles.get(headline.role or "")
        base_size = role.max_size_px if role is not None else 72
        if direction.composition == "contemplative":
            override = LayerOverride(
                area=(
                    round(width * 0.15),
                    round(height * 0.28),
                    round(width * 0.7),
                    round(height * 0.34),
                ),
                text_align="center",
                font_size_px=round(base_size * 0.86),
            )
        elif direction.composition == "modular":
            override = LayerOverride(
                area=(safe, round(height * 0.18), round(width * 0.58), round(height * 0.46)),
                text_align="left",
                font_size_px=round(base_size * (1 + direction.scale_contrast * 0.18)),
            )
        elif direction.composition == "expansive":
            override = LayerOverride(
                area=(safe, round(height * 0.2), width - safe, round(height * 0.5)),
                text_align="left",
                font_size_px=round(base_size * (1.08 + direction.scale_contrast * 0.35)),
            )
        elif direction.composition == "layered":
            override = LayerOverride(
                area=(
                    round(width * 0.1),
                    round(height * 0.3),
                    round(width * 0.78),
                    round(height * 0.42),
                ),
                text_align="left",
                font_size_px=round(base_size * (1 + direction.scale_contrast * 0.24)),
                z_index=12,
            )
        else:
            override = LayerOverride(
                area=(safe, round(height * 0.24), round(width * 0.74), round(height * 0.44)),
                text_align="left",
                font_size_px=round(base_size * (0.95 + direction.scale_contrast * 0.2)),
            )
        overrides[headline.id] = override

    if logo is not None:
        _, _, logo_width, logo_height = logo.area
        ratio = logo_height / logo_width
        if direction.composition in {"expansive", "layered"}:
            oversized_width = round(width * (0.92 + direction.bleed * 0.55))
            oversized_height = round(oversized_width * ratio)
            logo_override = LayerOverride(
                area=(
                    -round(width * (0.12 + direction.bleed * 0.22)),
                    round(height - oversized_height * 0.72),
                    oversized_width,
                    oversized_height,
                ),
                opacity=0.12 if direction.composition == "layered" else 0.18,
                z_index=0,
            )
        elif direction.composition == "contemplative":
            calm_width = round(width * 0.14)
            logo_override = LayerOverride(
                area=(
                    round((width - calm_width) / 2),
                    round(height * 0.82),
                    calm_width,
                    round(calm_width * ratio),
                ),
                opacity=1,
            )
        elif direction.composition == "modular":
            modular_width = round(width * 0.16)
            logo_override = LayerOverride(
                area=(
                    width - safe - modular_width,
                    safe,
                    modular_width,
                    round(modular_width * ratio),
                ),
                opacity=1,
            )
        else:
            asymmetric_width = round(width * 0.3)
            logo_override = LayerOverride(
                area=(
                    width - round(asymmetric_width * 0.72),
                    round(height * 0.72),
                    asymmetric_width,
                    round(asymmetric_width * ratio),
                ),
                opacity=0.72,
            )
        overrides[logo.id] = logo_override

    return ContentSpec(
        layout_id=content.layout_id,
        brand_revision_id=content.brand_revision_id,
        values=content.values,
        overrides=overrides,
        surface=content.surface or suggested_surface(ir),
        added_slots=content.added_slots,
        added_layers=content.added_layers,
    )
