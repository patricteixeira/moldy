"""Modelos Pydantic do Brand IR.

Todos os modelos serializam em camelCase (`by_alias=True`) e aceitam tanto
camelCase quanto snake_case na entrada (`populate_by_name=True`). Chaves de
token com ponto (ex.: "color.primary") são chaves de dict, não atributos.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from brand_runtime.colors import normalize_color

SourceType = Literal[
    "pdf-guideline",
    "svg-asset",
    "raster-asset",
    "font-file",
    "font-catalog",
    "dtcg-tokens",
    "wizard-confirmation",
    "manual-entry",
]


class CamelModel(BaseModel):
    """Base comum: aliases camelCase gerados automaticamente."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


class Evidence(CamelModel):
    """Rastro de origem de um valor da marca, com confiança e autoridade."""

    source_type: SourceType
    path: str | None = None
    page: int | None = None
    detail: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    authoritative: bool = False
    confirmed_at: datetime | None = None


class ColorToken(CamelModel):
    """Cor semântica normalizada com sua cadeia de evidências."""

    value: str  # sempre "#RRGGBB" maiúsculo (normalizado no validator)
    evidence: list[Evidence]

    @field_validator("value")
    @classmethod
    def _normalize(cls, value: str) -> str:
        return normalize_color(value)


class FontAxis(CamelModel):
    """Intervalo de um eixo OpenType variável, preservado para reprodução."""

    tag: str = Field(min_length=4, max_length=4, pattern=r"^[A-Za-z0-9]{4}$")
    minimum: float = Field(allow_inf_nan=False)
    default: float = Field(allow_inf_nan=False)
    maximum: float = Field(allow_inf_nan=False)

    @model_validator(mode="after")
    def _ordered_interval(self) -> Self:
        if not self.minimum <= self.default <= self.maximum:
            raise ValueError("O eixo de fonte deve respeitar minimum <= default <= maximum.")
        return self


class FontResource(CamelModel):
    """Binário de fonte resolvido com origem, licença e cobertura verificáveis."""

    provider: str = Field(min_length=1)
    format: Literal["ttf", "otf", "woff2"]
    upstream_ref: str | None = None
    license_id: str | None = None
    license_sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")] | None = None
    usage_policy: Literal["redistributable", "embeddable", "restricted", "unknown"] = "unknown"
    coverage_profile: str | None = None
    missing_codepoints: list[int] = Field(default_factory=list)
    axes: list[FontAxis] = Field(default_factory=list)

    @field_validator("missing_codepoints")
    @classmethod
    def _normalize_missing_codepoints(cls, values: list[int]) -> list[int]:
        normalized = sorted(set(values))
        if any(value < 0 or value > 0x10FFFF or 0xD800 <= value <= 0xDFFF for value in normalized):
            raise ValueError("Os codepoints ausentes devem ser valores escalares Unicode válidos.")
        return normalized

    @field_validator("axes")
    @classmethod
    def _normalize_axes(cls, values: list[FontAxis]) -> list[FontAxis]:
        ordered = sorted(values, key=lambda axis: axis.tag)
        if len({axis.tag for axis in ordered}) != len(ordered):
            raise ValueError("Os eixos de uma fonte devem ter tags únicas.")
        return ordered

    @model_validator(mode="after")
    def _coherent_metadata(self) -> Self:
        if self.missing_codepoints and self.coverage_profile is None:
            raise ValueError("Codepoints ausentes exigem um perfil de cobertura.")
        if self.usage_policy in {"redistributable", "embeddable"} and (
            self.license_id is None or self.license_sha256 is None
        ):
            raise ValueError(
                "Uma fonte utilizável exige licença identificada e registrada por SHA-256."
            )
        return self


class FontToken(CamelModel):
    """Fonte semântica confirmada, ligada ou não a um arquivo local."""

    family: str
    weight: int = Field(default=400, ge=100, le=900)
    style: Literal["normal", "italic"] = "normal"
    source: Literal["file", "referenced-only", "fallback"]
    file_sha256: str | None = None
    resource: FontResource | None = None
    evidence: list[Evidence]


class LogoAsset(CamelModel):
    """Asset de logo publicado com integridade e proveniência confirmada."""

    path: str
    sha256: str
    format: Literal["svg", "png"]
    evidence: list[Evidence]
    min_width_px: int = 96
    clear_space_ratio: float = 0.25


class SemanticRole(CamelModel):
    """Papel tipográfico que referencia tokens de fonte e cor do Brand IR."""

    font: str  # chave em BrandIR.fonts
    color: str  # chave em BrandIR.colors
    min_size_px: int
    max_size_px: int
    line_height: float


class RevisionInfo(CamelModel):
    """Identidade determinística e instante de auditoria de uma revisão."""

    id: str
    created_at: datetime


class Diagnostic(CamelModel):
    """Lacuna ou decisão pendente comunicada em linguagem orientada à ação."""

    code: str
    target: str
    message: str  # PT-BR
    resolution: str | None = None


class BrandInfo(CamelModel):
    """Metadados essenciais da marca compilada."""

    name: str


class CompositionMode(CamelModel):
    """Combinação semântica fechada para uma peça clara ou escura."""

    background_color_token: str
    foreground_color_token: str
    logo_asset_token: str | None = None
    evidence: list[Evidence] = Field(default_factory=list)


class CompositionModes(CamelModel):
    """Modos editoriais explicitamente declarados pelo sistema de marca."""

    light: CompositionMode | None = None
    dark: CompositionMode | None = None


class ColorRatioRule(CamelModel):
    """Participação declarada de um token na composição cromática."""

    color_token: str
    ratio: float = Field(gt=0.0, le=1.0, allow_inf_nan=False)
    evidence: list[Evidence] = Field(default_factory=list)


class AccentRule(CamelModel):
    """Limite de presença da cor de acento na área total da peça."""

    color_token: str
    max_ratio: float = Field(gt=0.0, le=1.0, allow_inf_nan=False)
    evidence: list[Evidence] = Field(default_factory=list)


class MotifRule(CamelModel):
    """Motivo gráfico pertencente ao vocabulário fechado do renderer."""

    kind: Literal["diagonal-lines"]
    evidence: list[Evidence] = Field(default_factory=list)


class NumberingRule(CamelModel):
    """Tratamento editorial fechado para índices e sequências."""

    style: Literal["zero-padded"]
    min_digits: int = Field(default=2, ge=2, le=8)
    evidence: list[Evidence] = Field(default_factory=list)


class CompositionRules(CamelModel):
    """Gramática editorial extraída de declarações explícitas das diretrizes."""

    modes: CompositionModes = Field(default_factory=CompositionModes)
    color_ratios: list[ColorRatioRule] = Field(default_factory=list)
    accent: AccentRule | None = None
    motifs: list[MotifRule] = Field(default_factory=list)
    numbering: NumberingRule | None = None

    @model_validator(mode="after")
    def _unique_closed_rules(self) -> Self:
        tokens = [item.color_token for item in self.color_ratios]
        if len(tokens) != len(set(tokens)):
            raise ValueError("Cada token pode ter apenas uma proporção cromática.")
        motif_kinds = [item.kind for item in self.motifs]
        if len(motif_kinds) != len(set(motif_kinds)):
            raise ValueError("Cada motivo pode aparecer apenas uma vez nas regras.")
        return self


class BrandIR(CamelModel):
    """Contrato imutável da marca consumido pelo kit, guard e renderer."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        json_schema_extra={
            "allOf": [
                {
                    "if": {
                        "required": ["compositionRules"],
                        "properties": {
                            "compositionRules": {"not": {"type": "null"}},
                        },
                    },
                    "then": {
                        "required": ["schemaVersion"],
                        "properties": {"schemaVersion": {"const": "0.3.0"}},
                    },
                }
            ]
        },
    )

    schema_version: Literal["0.1.0", "0.2.0", "0.3.0"] = "0.3.0"
    brand: BrandInfo
    revision: RevisionInfo
    colors: dict[str, ColorToken]
    fonts: dict[str, FontToken]
    roles: dict[str, SemanticRole]
    assets: dict[str, LogoAsset]
    composition_rules: CompositionRules | None = None
    format_profiles: list[str] = ["post-1x1", "post-4x5", "story-9x16", "doc-a4"]
    diagnostics: list[Diagnostic] = []

    @model_validator(mode="after")
    def _composition_references_exist(self) -> Self:
        rules = self.composition_rules
        if rules is None:
            return self
        if "schema_version" not in self.model_fields_set:
            raise ValueError("compositionRules exige schemaVersion 0.3.0 explícita.")
        if self.schema_version != "0.3.0":
            raise ValueError("compositionRules pertence apenas ao Brand IR 0.3.0.")

        missing: list[str] = []
        for name, mode in (("light", rules.modes.light), ("dark", rules.modes.dark)):
            if mode is None:
                continue
            if mode.background_color_token not in self.colors:
                missing.append(f"modes.{name}.backgroundColorToken")
            if mode.foreground_color_token not in self.colors:
                missing.append(f"modes.{name}.foregroundColorToken")
            if mode.logo_asset_token is not None and mode.logo_asset_token not in self.assets:
                missing.append(f"modes.{name}.logoAssetToken")
        for index, ratio in enumerate(rules.color_ratios):
            if ratio.color_token not in self.colors:
                missing.append(f"colorRatios.{index}.colorToken")
        if rules.accent is not None and rules.accent.color_token not in self.colors:
            missing.append("accent.colorToken")
        if missing:
            raise ValueError(
                "compositionRules referencia tokens ausentes: " + ", ".join(missing) + "."
            )
        return self
