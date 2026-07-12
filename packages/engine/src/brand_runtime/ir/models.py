"""Modelos Pydantic do Brand IR.

Todos os modelos serializam em camelCase (`by_alias=True`) e aceitam tanto
camelCase quanto snake_case na entrada (`populate_by_name=True`). Chaves de
token com ponto (ex.: "color.primary") são chaves de dict, não atributos.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from brand_runtime.colors import normalize_color

SourceType = Literal[
    "pdf-guideline",
    "svg-asset",
    "raster-asset",
    "font-file",
    "dtcg-tokens",
    "wizard-confirmation",
    "manual-entry",
]


class CamelModel(BaseModel):
    """Base comum: aliases camelCase gerados automaticamente."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


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
    value: str  # sempre "#RRGGBB" maiúsculo (normalizado no validator)
    evidence: list[Evidence]

    @field_validator("value")
    @classmethod
    def _normalize(cls, value: str) -> str:
        return normalize_color(value)


class FontToken(CamelModel):
    family: str
    weight: int = Field(default=400, ge=100, le=900)
    style: Literal["normal", "italic"] = "normal"
    source: Literal["file", "referenced-only", "fallback"]
    file_sha256: str | None = None
    evidence: list[Evidence]


class LogoAsset(CamelModel):
    path: str
    sha256: str
    format: Literal["svg", "png"]
    min_width_px: int = 96
    clear_space_ratio: float = 0.25


class SemanticRole(CamelModel):
    font: str  # chave em BrandIR.fonts
    color: str  # chave em BrandIR.colors
    min_size_px: int
    max_size_px: int
    line_height: float


class RevisionInfo(CamelModel):
    id: str
    created_at: datetime


class Diagnostic(CamelModel):
    code: str
    target: str
    message: str  # PT-BR
    resolution: str | None = None


class BrandInfo(CamelModel):
    name: str


class BrandIR(CamelModel):
    schema_version: Literal["0.1.0"] = "0.1.0"
    brand: BrandInfo
    revision: RevisionInfo
    colors: dict[str, ColorToken]
    fonts: dict[str, FontToken]
    roles: dict[str, SemanticRole]
    assets: dict[str, LogoAsset]
    format_profiles: list[str] = ["post-1x1", "post-4x5", "story-9x16", "doc-a4"]
    diagnostics: list[Diagnostic] = []
