"""Geração determinística do kit inicial de layouts a partir do Brand IR."""

from __future__ import annotations

from collections.abc import Callable

from brand_runtime.ir.models import BrandIR
from brand_runtime.kit.models import PROFILES, Background, Canvas, LayoutSpec, Profile, Slot

_SOCIAL_PROFILES: tuple[Profile, ...] = ("post-1x1", "post-4x5", "story-9x16")


class KitGenerationError(ValueError):
    """Erro de contrato que impede gerar um kit coerente com a revisão da marca."""


def _canvas(profile: Profile) -> Canvas:
    """Materializa o canvas canônico de um perfil publicado."""
    width, height, safe_area = PROFILES[profile]
    return Canvas(width_px=width, height_px=height, safe_area_px=safe_area)


def _validate_ir(ir: BrandIR) -> None:
    """Falha explicitamente quando uma referência obrigatória não existe no IR."""
    missing: list[str] = []
    if "color.background" not in ir.colors:
        missing.append("color.background")
    for role in ("heading", "body", "caption"):
        if role not in ir.roles:
            missing.append(f"role:{role}")
            continue
        semantic_role = ir.roles[role]
        if semantic_role.font not in ir.fonts:
            missing.append(f"{role}.font:{semantic_role.font}")
        if semantic_role.color not in ir.colors:
            missing.append(f"{role}.color:{semantic_role.color}")
    if "logo.primary" not in ir.assets:
        missing.append("logo.primary")
    if missing:
        raise KitGenerationError(
            "O Brand IR não contém referências obrigatórias para o kit: " + ", ".join(missing) + "."
        )


def _logo_slot(ir: BrandIR, canvas: Canvas) -> Slot:
    """Cria o logo travado no canto inferior direito, respeitando seu mínimo."""
    minimum = ir.assets["logo.primary"].min_width_px
    size = max(minimum, round(canvas.width_px * 0.12))
    x = canvas.width_px - canvas.safe_area_px - size
    y = canvas.height_px - canvas.safe_area_px - size
    if size <= 0 or x < canvas.safe_area_px or y < canvas.safe_area_px:
        raise KitGenerationError(
            "O tamanho mínimo do logo não cabe na área segura do perfil "
            f"{canvas.width_px}×{canvas.height_px}px."
        )
    return Slot(id="logo", kind="logo", area=(x, y, size, size), fit="fixed")


def _statement(ir: BrandIR, profile: Profile) -> LayoutSpec:
    """Gera o arquétipo de frase de impacto para um perfil social."""
    canvas = _canvas(profile)
    width, height, safe = canvas.width_px, canvas.height_px, canvas.safe_area_px
    return LayoutSpec(
        id=f"statement-{profile}",
        profile=profile,
        name_pt="Frase de impacto",
        canvas=canvas,
        background=Background(kind="color", color_token="color.background"),
        slots=[
            Slot(
                id="headline",
                kind="text",
                role="heading",
                max_chars=90,
                area=(safe, round(height * 0.30), width - 2 * safe, round(height * 0.40)),
            ),
            _logo_slot(ir, canvas),
        ],
    )


def _quote(ir: BrandIR, profile: Profile) -> LayoutSpec:
    """Gera o arquétipo de citação sobre imagem para um perfil social."""
    canvas = _canvas(profile)
    width, height, safe = canvas.width_px, canvas.height_px, canvas.safe_area_px
    return LayoutSpec(
        id=f"quote-{profile}",
        profile=profile,
        name_pt="Citação sobre foto",
        canvas=canvas,
        background=Background(kind="image-slot"),
        slots=[
            Slot(
                id="photo",
                kind="image",
                min_resolution=(width, height),
                area=(0, 0, width, height),
                fit="fixed",
            ),
            Slot(
                id="quote",
                kind="text",
                role="heading",
                max_chars=140,
                area=(safe, round(height * 0.32), width - 2 * safe, round(height * 0.36)),
            ),
            Slot(
                id="author",
                kind="text",
                role="caption",
                max_chars=40,
                area=(safe, round(height * 0.72), width - 2 * safe, round(height * 0.06)),
                required=False,
            ),
            _logo_slot(ir, canvas),
        ],
    )


def _announce(ir: BrandIR, profile: Profile) -> LayoutSpec:
    """Gera o arquétipo de anúncio editorial para um perfil social."""
    canvas = _canvas(profile)
    width, height, safe = canvas.width_px, canvas.height_px, canvas.safe_area_px
    return LayoutSpec(
        id=f"announce-{profile}",
        profile=profile,
        name_pt="Anúncio com foto",
        canvas=canvas,
        background=Background(kind="color", color_token="color.background"),
        slots=[
            Slot(
                id="headline",
                kind="text",
                role="heading",
                max_chars=70,
                area=(safe, safe, width - 2 * safe, round(height * 0.22)),
            ),
            Slot(
                id="body",
                kind="text",
                role="body",
                max_chars=240,
                area=(safe, round(height * 0.30), width - 2 * safe, round(height * 0.28)),
            ),
            Slot(
                id="photo",
                kind="image",
                min_resolution=(width, round(height * 0.34)),
                area=(0, round(height * 0.62), width, round(height * 0.38)),
                fit="fixed",
            ),
            _logo_slot(ir, canvas),
        ],
    )


def _one_pager(ir: BrandIR) -> LayoutSpec:
    """Gera o documento A4 de uma página com rodapé reservado ao logo."""
    profile: Profile = "doc-a4"
    canvas = _canvas(profile)
    width, height, safe = canvas.width_px, canvas.height_px, canvas.safe_area_px
    logo = _logo_slot(ir, canvas)
    logo_size = logo.area[2]
    return LayoutSpec(
        id="one-pager-doc-a4",
        profile=profile,
        name_pt="Documento de uma página",
        canvas=canvas,
        background=Background(kind="color", color_token="color.background"),
        slots=[
            Slot(
                id="title",
                kind="text",
                role="heading",
                max_chars=80,
                area=(safe, safe, width - 2 * safe, 120),
            ),
            Slot(
                id="body",
                kind="text",
                role="body",
                max_chars=2200,
                area=(
                    safe,
                    safe + 150,
                    width - 2 * safe,
                    height - 2 * safe - 150 - logo_size,
                ),
            ),
            logo,
        ],
    )


def generate_kit(ir: BrandIR) -> list[LayoutSpec]:
    """Gera dez layouts canônicos, adaptados por perfil sem redimensionamento cego."""
    _validate_ir(ir)
    builders: tuple[Callable[[BrandIR, Profile], LayoutSpec], ...] = (
        _statement,
        _quote,
        _announce,
    )
    layouts = [builder(ir, profile) for builder in builders for profile in _SOCIAL_PROFILES]
    layouts.append(_one_pager(ir))
    return layouts
