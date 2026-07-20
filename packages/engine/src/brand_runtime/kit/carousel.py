"""Layouts internos para sequências editoriais de carrossel."""

from __future__ import annotations

from typing import Literal

from brand_runtime.ir.models import BrandIR
from brand_runtime.kit.generator import KitGenerationError
from brand_runtime.kit.models import (
    PROFILES,
    Background,
    Canvas,
    LayoutSpec,
    ShapeLayer,
    Slot,
)

CarouselProfile = Literal["post-1x1", "post-4x5"]


def _canvas(profile: CarouselProfile) -> Canvas:
    width, height, safe = PROFILES[profile]
    return Canvas(width_px=width, height_px=height, safe_area_px=safe)


def _tokens(ir: BrandIR) -> tuple[str, str, str]:
    background = "color.background"
    foreground = "color.text" if "color.text" in ir.colors else ir.roles["body"].color
    accent = next(
        (token for token in ("color.secondary", "color.primary", foreground) if token in ir.colors),
        foreground,
    )
    for token in (background, foreground, accent):
        if token not in ir.colors:
            raise KitGenerationError(f"O carrossel não consegue resolver o token {token}.")
    return background, foreground, accent


def _frame(height: int, foreground: str, accent: str) -> list[ShapeLayer]:
    """Repete uma gramática discreta de moldura e registro em toda a sequência."""
    bottom = height - 52
    return [
        ShapeLayer(
            id="frame-top",
            shape="rectangle",
            area=(52, 52, 976, 2),
            color_token=foreground,
            opacity=0.12,
            z_index=1,
        ),
        ShapeLayer(
            id="frame-bottom",
            shape="rectangle",
            area=(52, bottom, 976, 2),
            color_token=foreground,
            opacity=0.12,
            z_index=1,
        ),
        ShapeLayer(
            id="register-top",
            shape="rectangle",
            area=(52, 34, 28, 3),
            color_token=accent,
            z_index=2,
        ),
        ShapeLayer(
            id="register-bottom",
            shape="rectangle",
            area=(1000, height - 37, 28, 3),
            color_token=accent,
            z_index=2,
        ),
    ]


def _signature(height: int, foreground: str) -> Slot:
    return Slot(
        id="signature",
        kind="text",
        role="caption",
        color_token=foreground,
        max_chars=80,
        area=(80, height - 112, 430, 32),
        fit="fixed",
        required=False,
        z_index=12,
        text_transform="uppercase",
        letter_spacing_em=0.12,
    )


def _logo(ir: BrandIR, height: int) -> Slot:
    minimum = ir.assets["logo.primary"].min_width_px
    size = max(minimum, 82)
    if size > 180:
        size = 180
    return Slot(
        id="logo",
        kind="logo",
        area=(1080 - 80 - size, height - 80 - size, size, size),
        fit="fixed",
        required=False,
        z_index=10,
    )


def _cover(ir: BrandIR, profile: CarouselProfile) -> LayoutSpec:
    canvas = _canvas(profile)
    height = canvas.height_px
    background, foreground, accent = _tokens(ir)
    headline_height = 360 if profile == "post-4x5" else 300
    headline_y = 330 if profile == "post-4x5" else 250
    return LayoutSpec(
        id=f"carousel-cover-{profile}",
        profile=profile,
        name_pt="Carrossel · Capa",
        canvas=canvas,
        background=Background(kind="color", color_token=background),
        locked_layers=[
            *_frame(height, foreground, accent),
            ShapeLayer(
                id="accent-rule",
                shape="rectangle",
                area=(80, headline_y - 38, 70, 5),
                color_token=accent,
                z_index=3,
            ),
            ShapeLayer(
                id="anchor-field",
                shape="rectangle",
                area=(760, 0, 320, height),
                color_token=accent,
                opacity=0.055,
                z_index=0,
            ),
        ],
        slots=[
            Slot(
                id="index",
                kind="text",
                role="caption",
                color_token=foreground,
                max_chars=12,
                area=(80, 92, 240, 34),
                fit="fixed",
                z_index=10,
                letter_spacing_em=0.14,
            ),
            Slot(
                id="kicker",
                kind="text",
                role="caption",
                color_token=accent,
                max_chars=64,
                area=(80, 185, 760, 44),
                required=False,
                z_index=10,
                text_transform="uppercase",
                letter_spacing_em=0.16,
            ),
            Slot(
                id="headline",
                kind="text",
                role="heading",
                color_token=foreground,
                emphasis_color_token=accent,
                max_chars=120,
                area=(80, headline_y, 850, headline_height),
                z_index=10,
                letter_spacing_em=-0.035,
            ),
            Slot(
                id="deck",
                kind="text",
                role="body",
                color_token=foreground,
                max_chars=220,
                area=(80, headline_y + headline_height + 44, 650, 130),
                required=False,
                z_index=10,
            ),
            _signature(height, foreground),
            _logo(ir, height),
        ],
    )


def _content(ir: BrandIR, profile: CarouselProfile, variant: Literal["a", "b"]) -> LayoutSpec:
    canvas = _canvas(profile)
    height = canvas.height_px
    background, foreground, accent = _tokens(ir)
    compact = profile == "post-1x1"
    headline_y = 188 if variant == "a" else 246
    headline_x = 80 if variant == "a" else 320
    headline_w = 760 if variant == "a" else 680
    headline_h = 220 if compact else 270
    block_top = headline_y + headline_h + (30 if compact else 56)
    block_height = 76 if compact else 104
    block_gap = 16 if compact else 20
    locked = [*_frame(height, foreground, accent)]
    if variant == "a":
        locked.append(
            ShapeLayer(
                id="side-rule",
                shape="rectangle",
                area=(80, 172, 5, max(120, height - 344)),
                color_token=accent,
                z_index=2,
            )
        )
    else:
        locked.extend(
            [
                ShapeLayer(
                    id="index-field",
                    shape="rectangle",
                    area=(0, 0, 250, height),
                    color_token=accent,
                    opacity=0.065,
                    z_index=0,
                ),
                ShapeLayer(
                    id="headline-rule",
                    shape="rectangle",
                    area=(320, headline_y - 34, 74, 5),
                    color_token=accent,
                    z_index=2,
                ),
            ]
        )

    slots: list[Slot] = [
        Slot(
            id="index",
            kind="text",
            role="heading" if variant == "b" else "caption",
            color_token=foreground,
            max_chars=12,
            # A variante B usa o contador como elemento editorial em duas linhas.
            # A altura precisa comportar o valor completo (por exemplo, 03 / 05)
            # mesmo quando a tipografia da marca tem uma escala de heading ampla.
            area=(80, 86, 190, 232 if variant == "b" else 34),
            fit="fixed",
            z_index=10,
            letter_spacing_em=-0.02 if variant == "b" else 0.14,
        ),
        Slot(
            id="kicker",
            kind="text",
            role="caption",
            color_token=accent,
            max_chars=64,
            area=(headline_x, headline_y - 82, headline_w, 40),
            required=False,
            z_index=10,
            text_transform="uppercase",
            letter_spacing_em=0.16,
        ),
        Slot(
            id="headline",
            kind="text",
            role="heading",
            color_token=foreground,
            emphasis_color_token=accent,
            max_chars=120,
            area=(headline_x, headline_y, headline_w, headline_h),
            z_index=10,
            letter_spacing_em=-0.025,
        ),
    ]
    for index in range(6):
        slots.append(
            Slot(
                id=f"body-{index + 1}",
                kind="text",
                role="body",
                color_token=foreground,
                max_chars=420,
                area=(
                    headline_x,
                    block_top + index * (block_height + block_gap),
                    headline_w,
                    block_height,
                ),
                required=False,
                z_index=10,
            )
        )
    slots.extend((_signature(height, foreground), _logo(ir, height)))
    return LayoutSpec(
        id=f"carousel-content-{variant}-{profile}",
        profile=profile,
        name_pt=f"Carrossel · Conteúdo {'A' if variant == 'a' else 'B'}",
        canvas=canvas,
        background=Background(kind="color", color_token=background),
        locked_layers=locked,
        slots=slots,
    )


def _closing(ir: BrandIR, profile: CarouselProfile) -> LayoutSpec:
    canvas = _canvas(profile)
    height = canvas.height_px
    background, foreground, accent = _tokens(ir)
    return LayoutSpec(
        id=f"carousel-closing-{profile}",
        profile=profile,
        name_pt="Carrossel · Fechamento",
        canvas=canvas,
        background=Background(kind="color", color_token=background),
        locked_layers=[
            *_frame(height, foreground, accent),
            ShapeLayer(
                id="closing-field",
                shape="rectangle",
                area=(0, round(height * 0.7), 1080, round(height * 0.3)),
                color_token=accent,
                opacity=0.07,
                z_index=0,
            ),
        ],
        slots=[
            Slot(
                id="index",
                kind="text",
                role="caption",
                color_token=foreground,
                max_chars=12,
                area=(80, 92, 240, 34),
                fit="fixed",
                z_index=10,
                letter_spacing_em=0.14,
            ),
            Slot(
                id="logo",
                kind="logo",
                area=(390, round(height * 0.22), 300, 300),
                fit="fixed",
                required=False,
                z_index=10,
            ),
            Slot(
                id="headline",
                kind="text",
                role="heading",
                color_token=foreground,
                emphasis_color_token=accent,
                max_chars=96,
                area=(140, round(height * 0.5), 800, 180),
                z_index=10,
                text_align="center",
                letter_spacing_em=-0.025,
            ),
            Slot(
                id="cta",
                kind="text",
                role="body",
                color_token=foreground,
                max_chars=180,
                area=(190, round(height * 0.66), 700, 100),
                required=False,
                z_index=10,
                text_align="center",
            ),
            _signature(height, foreground),
        ],
    )


def generate_carousel_layouts(ir: BrandIR, profile: CarouselProfile) -> list[LayoutSpec]:
    """Gera os papéis internos de uma sequência sem inflar o kit público."""
    if "logo.primary" not in ir.assets:
        raise KitGenerationError("O carrossel exige logo.primary.")
    for role in ("heading", "body", "caption"):
        if role not in ir.roles:
            raise KitGenerationError(f"O carrossel exige o papel tipográfico {role}.")
    return [
        _cover(ir, profile),
        _content(ir, profile, "a"),
        _content(ir, profile, "b"),
        _closing(ir, profile),
    ]
