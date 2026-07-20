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
# Overrides autorais aceitam sangria real. O teto protege serialização, CSS e
# OOXML contra valores patológicos sem transformar o canvas em uma barreira
# criativa: 32.768 px cobre mais de 17 vezes o maior perfil publicado.
EditorCoordinate = Annotated[int, Field(ge=-32768, le=32768)]
EditorDimension = Annotated[int, Field(gt=0, le=32768)]
EditorArea = tuple[EditorCoordinate, EditorCoordinate, EditorDimension, EditorDimension]
Resolution = tuple[PositiveInt, PositiveInt]
Opacity = Annotated[float, Field(ge=0.0, le=1.0, allow_inf_nan=False)]
ZIndex = Annotated[int, Field(ge=0, le=20)]
LetterSpacing = Annotated[float, Field(ge=-0.1, le=0.5, allow_inf_nan=False)]
StrokeWidth = Annotated[float, Field(gt=0.0, le=20.0, allow_inf_nan=False)]
EditorLetterSpacing = Annotated[float, Field(ge=-0.25, le=1.0, allow_inf_nan=False)]
EditorFontSize = Annotated[float, Field(ge=6.0, le=1024.0, allow_inf_nan=False)]
EditorFontWeight = Annotated[int, Field(ge=100, le=900)]
EditorLineHeight = Annotated[float, Field(ge=0.5, le=3.0, allow_inf_nan=False)]
SurfaceScale = Annotated[float, Field(ge=4.0, le=512.0, allow_inf_nan=False)]
SurfaceWeight = Annotated[float, Field(gt=0.0, le=32.0, allow_inf_nan=False)]
SurfaceAngle = Annotated[float, Field(ge=-180.0, le=180.0, allow_inf_nan=False)]

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
    color_token: NonBlankString | None = None
    max_chars: PositiveInt | None = None
    min_resolution: Resolution | None = None
    area: Area
    fit: Literal["shrink-within-role-range", "fixed"] = "shrink-within-role-range"
    required: bool = True
    z_index: ZIndex | None = None
    opacity: Opacity = 1.0
    text_align: Literal["left", "center", "right"] = "left"
    text_transform: Literal["none", "uppercase"] = "none"
    letter_spacing_em: LetterSpacing = 0.0
    fill_mode: Literal["fill", "stroke"] = "fill"
    stroke_color_token: NonBlankString | None = None
    stroke_width_px: StrokeWidth | None = None
    asset_token: NonBlankString | None = None
    emphasis_color_token: NonBlankString | None = None
    text_format: Literal["plain", "zero-padded"] = "plain"

    @model_validator(mode="after")
    def _text_requires_role(self) -> Slot:
        """Exige papel semântico para que texto use tokens tipográficos do IR."""
        if self.kind == "text" and (self.role is None or not self.role.strip()):
            raise ValueError("Slots de texto precisam informar um papel semântico.")
        if self.kind != "text" and any(
            (
                self.color_token is not None,
                self.emphasis_color_token is not None,
                self.text_format != "plain",
                self.text_align != "left",
                self.text_transform != "none",
                self.letter_spacing_em != 0,
                self.fill_mode != "fill",
                self.stroke_color_token is not None,
                self.stroke_width_px is not None,
            )
        ):
            raise ValueError("Propriedades tipográficas só podem ser usadas em slots de texto.")
        if self.fill_mode == "stroke" and (
            self.stroke_color_token is None or self.stroke_width_px is None
        ):
            raise ValueError("Texto contornado exige token e largura de traço.")
        if self.fill_mode == "fill" and (
            self.stroke_color_token is not None or self.stroke_width_px is not None
        ):
            raise ValueError("Token e largura de traço exigem fillMode='stroke'.")
        if self.asset_token is not None and self.kind != "logo":
            raise ValueError("assetToken só pode ser usado em slots de logo.")
        return self


class ShapeLayer(CamelModel):
    """Forma geométrica fixa e fechada, sem estilos livres."""

    id: NonBlankString
    kind: Literal["shape"] = "shape"
    shape: Literal["rectangle", "circle"]
    area: Area
    color_token: NonBlankString
    opacity: Opacity = 1.0
    z_index: ZIndex = 0


class MotifLayer(CamelModel):
    """Aplicação fixa de um motivo pertencente ao vocabulário do Brand IR."""

    id: NonBlankString
    kind: Literal["motif"] = "motif"
    motif: Literal["diagonal-lines"]
    area: Area
    color_token: NonBlankString
    opacity: Opacity = 1.0
    stroke_width_px: StrokeWidth
    spacing_px: Annotated[float, Field(gt=0.0, le=256.0, allow_inf_nan=False)]
    z_index: ZIndex = 0


class AssetLayer(CamelModel):
    """Asset imutável do Brand IR posicionado pelo layout."""

    id: NonBlankString
    kind: Literal["asset"] = "asset"
    asset_token: NonBlankString
    area: Area
    fit: Literal["contain", "cover"] = "contain"
    opacity: Opacity = 1.0
    z_index: ZIndex = 0


LockedLayer = Annotated[ShapeLayer | MotifLayer | AssetLayer, Field(discriminator="kind")]


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
    composition_mode: Literal["light", "dark"] | None = None
    locked_layers: list[LockedLayer] = Field(default_factory=list)

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
        layer_ids = [layer.id for layer in self.locked_layers]
        element_ids = [*(slot.id for slot in self.slots), *layer_ids]
        if len(element_ids) != len(set(element_ids)):
            raise ValueError("Os identificadores de slot e camada precisam ser únicos no layout.")
        width, height = self.canvas.width_px, self.canvas.height_px
        for element in [*self.slots, *self.locked_layers]:
            x, y, element_width, element_height = element.area
            if x + element_width > width or y + element_height > height:
                noun = "slot" if isinstance(element, Slot) else "camada"
                raise ValueError(f"O {noun} «{element.id}» ultrapassa os limites do canvas.")
        if self.background.kind == "image-slot" and not any(
            slot.kind == "image" for slot in self.slots
        ):
            raise ValueError("Fundos de imagem precisam de um slot de imagem no layout.")
        return self


class TextValue(CamelModel):
    """Conteúdo textual fornecido para um slot."""

    kind: Literal["text"] = "text"
    text: str
    emphasis: NonBlankString | None = None


class ImageValue(CamelModel):
    """Imagem fornecida para um slot, opcionalmente acompanhada de seu hash."""

    kind: Literal["image"] = "image"
    path: NonBlankString
    sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")] | None = None


SURFACE_KINDS = (
    "paper-grain",
    "paper-fibers",
    "flecked-paper",
    "dry-brush",
    "linear-rhythm",
    "scanlines",
    "diagonal-hatch",
    "crosshatch",
    "woven",
    "technical-grid",
    "micro-grid",
    "isometric-grid",
    "point-field",
    "halftone",
    "checkerboard",
    "concentric-rings",
    "topographic",
    "sunburst",
    "waves",
    "terrazzo",
)


class SurfaceStyle(CamelModel):
    """Textura procedural de uma peça, editável e recortada pelo canvas."""

    kind: Literal[
        "paper-grain",
        "paper-fibers",
        "flecked-paper",
        "dry-brush",
        "linear-rhythm",
        "scanlines",
        "diagonal-hatch",
        "crosshatch",
        "woven",
        "technical-grid",
        "micro-grid",
        "isometric-grid",
        "point-field",
        "halftone",
        "checkerboard",
        "concentric-rings",
        "topographic",
        "sunburst",
        "waves",
        "terrazzo",
    ]
    color_token: NonBlankString
    opacity: Opacity = 0.12
    scale_px: SurfaceScale = 48.0
    weight_px: SurfaceWeight = 1.0
    angle_deg: SurfaceAngle = 0.0


class LayerOverride(CamelModel):
    """Ajustes autorais de uma instância sem alterar o layout publicado."""

    area: EditorArea | None = None
    opacity: Opacity | None = None
    hidden: bool = False
    z_index: ZIndex | None = None
    color_token: NonBlankString | None = None
    font_token: NonBlankString | None = None
    font_size_px: EditorFontSize | None = None
    font_weight: EditorFontWeight | None = None
    font_style: Literal["normal", "italic"] | None = None
    line_height: EditorLineHeight | None = None
    letter_spacing_em: EditorLetterSpacing | None = None
    text_align: Literal["left", "center", "right"] | None = None
    text_transform: Literal["none", "uppercase"] | None = None
    fill_mode: Literal["fill", "stroke"] | None = None
    stroke_color_token: NonBlankString | None = None
    stroke_width_px: StrokeWidth | None = None
    fit: Literal["contain", "cover"] | None = None
    spacing_px: Annotated[float, Field(gt=0.0, le=256.0, allow_inf_nan=False)] | None = None

    @model_validator(mode="after")
    def _stroke_is_complete(self) -> LayerOverride:
        """Mantém contorno determinístico mesmo durante edições persistidas."""
        if self.fill_mode == "stroke" and (
            self.stroke_color_token is None or self.stroke_width_px is None
        ):
            raise ValueError("Texto contornado exige cor e largura de traço no override.")
        if self.fill_mode == "fill" and (
            self.stroke_color_token is not None or self.stroke_width_px is not None
        ):
            raise ValueError("Cor e largura de traço exigem fillMode='stroke' no override.")
        return self


class ContentSpec(CamelModel):
    """Conteúdo de uma peça ligado a um layout e a uma revisão de marca."""

    layout_id: NonBlankString
    brand_revision_id: NonBlankString
    values: dict[str, TextValue | ImageValue]
    overrides: dict[str, LayerOverride] = Field(default_factory=dict)
    surface: SurfaceStyle | None = None
    added_slots: list[Slot] = Field(default_factory=list)
    added_layers: list[ShapeLayer] = Field(default_factory=list)

    @model_validator(mode="after")
    def _added_elements_are_owned_by_the_document(self) -> ContentSpec:
        """Mantém elementos livres identificáveis e sem colisões internas."""
        added_ids = [
            *(slot.id for slot in self.added_slots),
            *(layer.id for layer in self.added_layers),
        ]
        if len(added_ids) != len(set(added_ids)):
            raise ValueError("Os elementos adicionados precisam ter identificadores únicos.")
        if any(not element_id.startswith("user-") for element_id in added_ids):
            raise ValueError(
                "Elementos adicionados precisam usar identificadores iniciados por user-."
            )
        return self


def materialize_content_layout(layout: LayoutSpec, content: ContentSpec) -> LayoutSpec:
    """Combina o modelo publicado com elementos livres persistidos na peça."""
    if not content.added_slots and not content.added_layers:
        return layout
    serialized = layout.model_dump(mode="json", by_alias=True)
    serialized["slots"] = [
        *serialized["slots"],
        *(slot.model_dump(mode="json", by_alias=True) for slot in content.added_slots),
    ]
    serialized["lockedLayers"] = [
        *serialized.get("lockedLayers", []),
        *(layer.model_dump(mode="json", by_alias=True) for layer in content.added_layers),
    ]
    return LayoutSpec.model_validate(serialized)
