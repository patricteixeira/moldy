"""Tipos comuns dos extratores de intake."""

from __future__ import annotations

from typing import Any

from brand_runtime.ir.models import CamelModel, Evidence


class Candidate(CamelModel):
    """Valor candidato produzido por um extrator, com score relativo e evidência."""

    value: Any  # hex str p/ cores; dict p/ fontes
    score: float  # relativo dentro do extrator
    evidence: list[Evidence]
