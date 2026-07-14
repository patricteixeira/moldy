"""Extração conservadora de regras editoriais declaradas em PDFs de marca.

Este extrator não tenta deduzir estilo a partir da aparência da página. Uma
regra só existe quando o texto da própria diretriz contém a declaração
correspondente. Assim, grafismos incidentais do manual não viram instruções de
composição por acidente.
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path
from typing import Literal, cast

import pymupdf
from pydantic import Field

from brand_runtime.ir.models import CamelModel, Evidence

DeclaredColorRole = Literal["primary", "background", "accent"]
DeclaredMotif = Literal["diagonal-lines"]

_MODE_LIGHT = re.compile(r"\bfundo\s+claro\b.{0,24}\bpositivo\b", re.DOTALL)
_MODE_DARK = re.compile(r"\bfundo\s+escuro\b.{0,24}\bnegativo\b", re.DOTALL)
_ACCENT_LIMIT = re.compile(
    r"\bambar\b.{0,600}?(?:abaixo\s+de|menor\s+que|<)\s*10\s*%",
    re.DOTALL,
)
_DIAGONAL = re.compile(r"\bpadrao\s+diagonal\b")
_ZERO_PADDED = re.compile(r"\bzero\s+a\s+esquerda\b")
_LOGO_MINIMUM = re.compile(r"\bminimo\s+digital\b.{0,40}?(?P<value>\d{1,3})\s*px", re.DOTALL)
_CLEAR_SPACE_COMPACT = re.compile(r"areadeprotecao=(?:1[/⁄]4|¼)daaltura")
_RATIO_PATTERNS: dict[DeclaredColorRole, re.Pattern[str]] = {
    "primary": re.compile(r"\bgrafite\b[^\n]{0,80}\n\s*(?P<value>\d{1,3})\s*%"),
    "background": re.compile(r"\bpapel\b[^\n]{0,80}\n\s*(?P<value>\d{1,3})\s*%"),
    "accent": re.compile(r"\bambar\b[^\n]{0,80}\n\s*(?P<value>\d{1,3})\s*%"),
}


class DeclaredColorRatio(CamelModel):
    """Proporção literal associada a um papel cromático declarado."""

    role: DeclaredColorRole
    ratio: float = Field(gt=0.0, le=1.0, allow_inf_nan=False)
    evidence: list[Evidence]


class DeclaredAccentLimit(CamelModel):
    """Limite literal de uso do acento."""

    max_ratio: float = Field(gt=0.0, le=1.0, allow_inf_nan=False)
    evidence: list[Evidence]


class DeclaredMotifRule(CamelModel):
    """Motivo nomeado explicitamente pelas diretrizes."""

    kind: DeclaredMotif
    evidence: list[Evidence]


class DeclaredLogoGeometry(CamelModel):
    """Limites dimensionais declarados para preservar a marca."""

    min_width_px: int | None = Field(default=None, ge=1, le=4096)
    min_width_evidence: list[Evidence] = Field(default_factory=list)
    clear_space_ratio: float | None = Field(default=None, gt=0.0, le=1.0, allow_inf_nan=False)
    clear_space_evidence: list[Evidence] = Field(default_factory=list)


class CompositionDeclarations(CamelModel):
    """Fatos editoriais extraídos antes do binding aos tokens do Brand IR."""

    light_mode_evidence: list[Evidence] = Field(default_factory=list)
    dark_mode_evidence: list[Evidence] = Field(default_factory=list)
    color_ratios: list[DeclaredColorRatio] = Field(default_factory=list)
    accent: DeclaredAccentLimit | None = None
    motifs: list[DeclaredMotifRule] = Field(default_factory=list)
    numbering_evidence: list[Evidence] = Field(default_factory=list)
    logo_geometry: DeclaredLogoGeometry | None = None

    def has_rules(self) -> bool:
        """Informa se ao menos uma declaração explícita foi encontrada."""
        return bool(
            self.light_mode_evidence
            or self.dark_mode_evidence
            or self.color_ratios
            or self.accent
            or self.motifs
            or self.numbering_evidence
            or self.logo_geometry
        )


def _searchable(value: str) -> str:
    """Remove acentos e normaliza espaços sem perder quebras de linha."""
    decomposed = unicodedata.normalize("NFKD", value)
    without_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    lines = [re.sub(r"[ \t\r\f\v]+", " ", line).strip() for line in without_marks.splitlines()]
    return "\n".join(lines).casefold()


def _evidence(pdf_path: Path, page: int, detail: str) -> Evidence:
    return Evidence(
        source_type="pdf-guideline",
        path=str(pdf_path),
        page=page,
        detail=detail,
        confidence=0.98,
        authoritative=True,
    )


def extract_pdf_composition(pdf_path: Path) -> CompositionDeclarations:
    """Extrai somente modos, proporções, motivo e numeração textualmente declarados."""
    result = CompositionDeclarations()
    ratio_by_role: dict[DeclaredColorRole, DeclaredColorRatio] = {}

    with pymupdf.open(pdf_path) as document:
        pages = [
            (
                page_index + 1,
                _searchable(cast(str, document.load_page(page_index).get_text("text"))),
            )
            for page_index in range(len(document))
        ]

    for page_number, text in pages:
        compact = text.replace(" ", "").replace("\n", "")
        if _MODE_LIGHT.search(text):
            result.light_mode_evidence.append(
                _evidence(pdf_path, page_number, "modo declarado: fundo claro · positivo")
            )
        if _MODE_DARK.search(text):
            result.dark_mode_evidence.append(
                _evidence(pdf_path, page_number, "modo declarado: fundo escuro · negativo")
            )
        if result.accent is None and _ACCENT_LIMIT.search(text):
            result.accent = DeclaredAccentLimit(
                max_ratio=0.1,
                evidence=[
                    _evidence(
                        pdf_path,
                        page_number,
                        "limite declarado: âmbar abaixo de 10% da composição",
                    )
                ],
            )
        if _DIAGONAL.search(text) and not result.motifs:
            result.motifs.append(
                DeclaredMotifRule(
                    kind="diagonal-lines",
                    evidence=[
                        _evidence(pdf_path, page_number, "motivo declarado: padrão diagonal")
                    ],
                )
            )
        if _ZERO_PADDED.search(text) and not result.numbering_evidence:
            result.numbering_evidence.append(
                _evidence(pdf_path, page_number, "numeração declarada: zero à esquerda")
            )
        minimum_match = _LOGO_MINIMUM.search(text)
        clear_space_match = _CLEAR_SPACE_COMPACT.search(compact)
        if minimum_match is not None or clear_space_match is not None:
            if result.logo_geometry is None:
                result.logo_geometry = DeclaredLogoGeometry()
            if minimum_match is not None and result.logo_geometry.min_width_px is None:
                minimum = int(minimum_match["value"])
                if minimum > 0:
                    result.logo_geometry.min_width_px = minimum
                    result.logo_geometry.min_width_evidence.append(
                        _evidence(
                            pdf_path,
                            page_number,
                            f"mínimo digital declarado para o símbolo: {minimum}px",
                        )
                    )
            if clear_space_match is not None and result.logo_geometry.clear_space_ratio is None:
                result.logo_geometry.clear_space_ratio = 0.25
                result.logo_geometry.clear_space_evidence.append(
                    _evidence(
                        pdf_path,
                        page_number,
                        "área de proteção declarada: 1/4 da altura",
                    )
                )

        page_ratios: dict[DeclaredColorRole, float] = {}
        for role, pattern in _RATIO_PATTERNS.items():
            match = pattern.search(text)
            if match is None:
                continue
            percentage = int(match["value"])
            if 0 < percentage <= 100:
                page_ratios[role] = percentage / 100
        # Só aceitamos a tríade completa e coerente. Percentuais isolados em
        # páginas de aplicação não são uma proporção global da marca.
        if set(page_ratios) == set(_RATIO_PATTERNS) and abs(sum(page_ratios.values()) - 1) < 1e-9:
            for role, ratio in page_ratios.items():
                ratio_by_role.setdefault(
                    role,
                    DeclaredColorRatio(
                        role=role,
                        ratio=ratio,
                        evidence=[
                            _evidence(
                                pdf_path,
                                page_number,
                                f"proporção cromática declarada: {round(ratio * 100)}% ({role})",
                            )
                        ],
                    ),
                )

    result.color_ratios = [
        ratio_by_role[role] for role in ("primary", "background", "accent") if role in ratio_by_role
    ]
    return result


def merge_composition_declarations(
    declarations: list[CompositionDeclarations],
) -> CompositionDeclarations:
    """Funde documentos preservando a primeira regra e acumulando evidências concordantes."""
    merged = CompositionDeclarations()
    ratios: dict[DeclaredColorRole, DeclaredColorRatio] = {}
    motifs: dict[DeclaredMotif, DeclaredMotifRule] = {}
    for declaration in declarations:
        merged.light_mode_evidence.extend(declaration.light_mode_evidence)
        merged.dark_mode_evidence.extend(declaration.dark_mode_evidence)
        merged.numbering_evidence.extend(declaration.numbering_evidence)
        if declaration.logo_geometry is not None:
            if merged.logo_geometry is None:
                merged.logo_geometry = declaration.logo_geometry.model_copy(deep=True)
            else:
                source = declaration.logo_geometry
                target = merged.logo_geometry
                if target.min_width_px is None and source.min_width_px is not None:
                    target.min_width_px = source.min_width_px
                    target.min_width_evidence.extend(source.min_width_evidence)
                elif target.min_width_px == source.min_width_px:
                    target.min_width_evidence.extend(source.min_width_evidence)
                if target.clear_space_ratio is None and source.clear_space_ratio is not None:
                    target.clear_space_ratio = source.clear_space_ratio
                    target.clear_space_evidence.extend(source.clear_space_evidence)
                elif target.clear_space_ratio == source.clear_space_ratio:
                    target.clear_space_evidence.extend(source.clear_space_evidence)
        if declaration.accent is not None:
            if merged.accent is None:
                merged.accent = declaration.accent.model_copy(deep=True)
            elif merged.accent.max_ratio == declaration.accent.max_ratio:
                merged.accent.evidence.extend(declaration.accent.evidence)
        for ratio in declaration.color_ratios:
            current = ratios.get(ratio.role)
            if current is None:
                ratios[ratio.role] = ratio.model_copy(deep=True)
            elif current.ratio == ratio.ratio:
                current.evidence.extend(ratio.evidence)
        for motif in declaration.motifs:
            current_motif = motifs.get(motif.kind)
            if current_motif is None:
                motifs[motif.kind] = motif.model_copy(deep=True)
            else:
                current_motif.evidence.extend(motif.evidence)
    merged.color_ratios = [
        ratios[role] for role in ("primary", "background", "accent") if role in ratios
    ]
    merged.motifs = list(motifs.values())
    return merged
