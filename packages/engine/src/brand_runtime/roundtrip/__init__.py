"""Parser e contratos do round-trip de documentos editados externamente."""

from brand_runtime.roundtrip.fix import (
    FixPlan,
    FixResult,
    RoundtripFixError,
    apply_pptx_fix_plan,
    build_fix_plan,
)
from brand_runtime.roundtrip.lint import RoundtripReport, lint_roundtrip
from brand_runtime.roundtrip.models import DocumentGraph, DocumentNode
from brand_runtime.roundtrip.pptx import PptxParseError, parse_pptx_document_graph

__all__ = [
    "DocumentGraph",
    "DocumentNode",
    "FixPlan",
    "FixResult",
    "PptxParseError",
    "RoundtripReport",
    "RoundtripFixError",
    "apply_pptx_fix_plan",
    "build_fix_plan",
    "lint_roundtrip",
    "parse_pptx_document_graph",
]
