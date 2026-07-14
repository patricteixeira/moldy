"""API pública do motor de marca do brand-runtime."""

from brand_runtime.guard.static_checks import GuardCheck, GuardVerdict, run_static_checks
from brand_runtime.intake.compile import Answers, CompileError, compile_ir
from brand_runtime.intake.draft import BrandDraft, build_draft
from brand_runtime.ir.models import BrandIR
from brand_runtime.ir.schema import export_schemas
from brand_runtime.kit.generator import KitGenerationError, generate_kit
from brand_runtime.kit.models import ContentSpec, LayoutSpec
from brand_runtime.native import (
    canonical_ooxml_manifest,
    derive_branded_template,
    inspect_semantic_shapes,
    render_docx,
    render_native_preview,
    render_pptx,
    validate_ooxml,
)
from brand_runtime.roundtrip import (
    DocumentGraph,
    FixPlan,
    FixResult,
    RoundtripReport,
    apply_pptx_fix_plan,
    build_fix_plan,
    lint_roundtrip,
    parse_pptx_document_graph,
)

__version__ = "0.1.0"

__all__ = [
    "Answers",
    "BrandDraft",
    "BrandIR",
    "CompileError",
    "ContentSpec",
    "DocumentGraph",
    "FixPlan",
    "FixResult",
    "GuardCheck",
    "GuardVerdict",
    "KitGenerationError",
    "LayoutSpec",
    "RoundtripReport",
    "apply_pptx_fix_plan",
    "build_draft",
    "build_fix_plan",
    "canonical_ooxml_manifest",
    "compile_ir",
    "derive_branded_template",
    "export_schemas",
    "generate_kit",
    "inspect_semantic_shapes",
    "lint_roundtrip",
    "parse_pptx_document_graph",
    "render_docx",
    "render_native_preview",
    "render_pptx",
    "run_static_checks",
    "validate_ooxml",
]
