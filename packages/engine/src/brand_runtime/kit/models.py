"""Contratos de layout e conteúdo consumidos pelo renderer e pelo Brand Guard."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import ConfigDict, Field, model_validator

from brand_runtime.ir.models import CamelModel

Profile = Literal["post-1x1", "post-4x5", "story-9x16", "doc-a4"]
PositiveInt = Annotated[int, Field(gt=0)]
NonNegativeInt = Annotated[int, Field(ge=0)]
NonBlankString = Annotated[str, Field(min_length=1, pattern=r".*\S.*")]
Area = tuple[NonNegativeInt, NonNegativeInt, PositiveInt, PositiveInt]
Resolution = tuple[PositiveInt, PositiveInt]

PROFILES: dict[Profile, tuple[int, int, int]] = {
    "post-1x1": (1080, 1080, 48),
    "post-4x5": (1080, 1350, 48),
    "story-9x16": (1080, 1920, 64),
    "doc-a4": (794, 1123, 76),
}

_PROFILE_CANVAS_SCHEMA = [
    {
        "if": {"properties": {"profile": {"const": profile}}, "required": ["profile"]},
        "then": {
            "properties": {
                "canvas": {
                    "properties": {
                        "widthPx": {"const": width},
                        "heightPx": {"const": height},
                        "safeAreaPx": {"const": safe_area},
                    },
                    "required": ["widthPx", "heightPx", "safeAreaPx"],
                }
            }
        },
    }
    for profile, (width, height, safe_area) in PROFILES.items()
]


class Canvas(CamelModel):
    """Dimensões e margem segura de um perfil de saída, em pixels."""

    width_px: PositiveInt
    height_px: PositiveInt
    safe_area_px: NonNegativeInt


class Slot(CamelModel):
    """Região editável de um layout, com limites para adaptação e validação."""

    model_config = ConfigDict(
        json_schema_extra={
            "allOf": [
                {
                    "if": {"properties": {"kind": {"const": "text"}}, "required": ["kind"]},
                    "then": {
                        "required": ["role"],
                        "properties": {"role": {"type": "string", "minLength": 1}},
                    },
                }
            ]
        }
    )

    id: NonBlankString
    kind: Literal["text", "image", "logo"]
    role: NonBlankString | None = None
    max_chars: PositiveInt | None = None
    min_resolution: Resolution | None = None
    area: Area
    fit: Literal["shrink-within-role-range", "fixed"] = "shrink-within-role-range"
    required: bool = True

    @model_validator(mode="after")
    def _text_requires_role(self) -> Slot:
        """Exige papel semântico para que texto use tokens tipográficos do IR."""
        if self.kind == "text" and (self.role is None or not self.role.strip()):
            raise ValueError("Slots de texto precisam informar um papel semântico.")
        return self


class Background(CamelModel):
    """Fundo sólido por token de cor ou fornecido por um slot de imagem."""

    model_config = ConfigDict(
        json_schema_extra={
            "allOf": [
                {
                    "if": {"properties": {"kind": {"const": "color"}}, "required": ["kind"]},
                    "then": {
                        "required": ["colorToken"],
                        "properties": {"colorToken": {"type": "string", "minLength": 1}},
                    },
                }
            ]
        }
    )

    kind: Literal["color", "image-slot"]
    color_token: NonBlankString | None = None

    @model_validator(mode="after")
    def _color_requires_token(self) -> Background:
        """Exige a referência ao token quando o fundo é uma cor sólida."""
        if self.kind == "color" and (self.color_token is None or not self.color_token.strip()):
            raise ValueError("Fundos de cor precisam informar um token de cor.")
        return self


class LayoutSpec(CamelModel):
    """Layout declarativo adaptado para um dos perfis publicados pelo motor."""

    model_config = ConfigDict(json_schema_extra={"allOf": _PROFILE_CANVAS_SCHEMA})

    id: NonBlankString
    profile: Profile
    name_pt: NonBlankString
    canvas: Canvas
    background: Background
    slots: list[Slot]

    @model_validator(mode="after")
    def _validate_geometry(self) -> LayoutSpec:
        """Vincula perfil, canvas e slots às dimensões canônicas do contrato mestre."""
        actual = (self.canvas.width_px, self.canvas.height_px, self.canvas.safe_area_px)
        expected = PROFILES[self.profile]
        if actual != expected:
            raise ValueError(
                f"O canvas do perfil {self.profile} deve ser {expected[0]}×{expected[1]}px "
                f"com área segura de {expected[2]}px."
            )
        slot_ids = [slot.id for slot in self.slots]
        if len(slot_ids) != len(set(slot_ids)):
            raise ValueError("Os identificadores de slot precisam ser únicos no layout.")
        width, height = self.canvas.width_px, self.canvas.height_px
        for slot in self.slots:
            x, y, slot_width, slot_height = slot.area
            if x + slot_width > width or y + slot_height > height:
                raise ValueError(f"O slot «{slot.id}» ultrapassa os limites do canvas.")
        if self.background.kind == "image-slot" and not any(
            slot.kind == "image" for slot in self.slots
        ):
            raise ValueError("Fundos de imagem precisam de um slot de imagem no layout.")
        return self


class TextValue(CamelModel):
    """Conteúdo textual fornecido para um slot."""

    kind: Literal["text"] = "text"
    text: str


class ImageValue(CamelModel):
    """Imagem fornecida para um slot, opcionalmente acompanhada de seu hash."""

    kind: Literal["image"] = "image"
    path: NonBlankString
    sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")] | None = None


class ContentSpec(CamelModel):
    """Conteúdo de uma peça ligado a um layout e a uma revisão de marca."""

    layout_id: NonBlankString
    brand_revision_id: NonBlankString
    values: dict[str, TextValue | ImageValue]
