"""Export dos JSON Schemas publicados pelo motor.

Tarefas futuras registram modelos adicionais em `_SCHEMAS`.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel

from brand_runtime._io import publish_file_set
from brand_runtime.guard.static_checks import GuardVerdict
from brand_runtime.ir.models import BrandIR
from brand_runtime.kit.models import ContentSpec, LayoutSpec
from brand_runtime.roundtrip.fix import FixPlan, FixResult
from brand_runtime.roundtrip.lint import RoundtripReport
from brand_runtime.roundtrip.models import DocumentGraph

_SCHEMAS: list[tuple[str, type[BaseModel]]] = [
    ("brand-ir.schema.json", BrandIR),
    ("layout-spec.schema.json", LayoutSpec),
    ("content-spec.schema.json", ContentSpec),
    ("guard-verdict.schema.json", GuardVerdict),
    ("document-graph.schema.json", DocumentGraph),
    ("roundtrip-report.schema.json", RoundtripReport),
    ("fix-plan.schema.json", FixPlan),
    ("fix-result.schema.json", FixResult),
]


def export_schemas(out_dir: Path) -> list[Path]:
    """Escreve os JSON Schemas (camelCase) em `out_dir` e retorna os paths."""
    payloads = {
        filename: (
            json.dumps(model.model_json_schema(by_alias=True), ensure_ascii=False, indent=2) + "\n"
        )
        for filename, model in _SCHEMAS
    }
    return publish_file_set(out_dir, payloads, preserve={"LICENSE"})
