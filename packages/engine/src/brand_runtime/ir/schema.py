"""Export dos JSON Schemas publicados pelo motor.

Tarefas futuras registram modelos adicionais em `_SCHEMAS`.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel

from brand_runtime.ir.models import BrandIR

_SCHEMAS: list[tuple[str, type[BaseModel]]] = [
    ("brand-ir.schema.json", BrandIR),
]


def export_schemas(out_dir: Path) -> list[Path]:
    """Escreve os JSON Schemas (camelCase) em `out_dir` e retorna os paths."""
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for filename, model in _SCHEMAS:
        schema = model.model_json_schema(by_alias=True)
        target = out_dir / filename
        target.write_text(
            json.dumps(schema, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        written.append(target)
    return written
