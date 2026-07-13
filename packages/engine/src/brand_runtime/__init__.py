"""API pública do motor de marca do brand-runtime."""

from brand_runtime.guard.static_checks import GuardCheck, GuardVerdict, run_static_checks
from brand_runtime.intake.compile import Answers, CompileError, compile_ir
from brand_runtime.intake.draft import BrandDraft, build_draft
from brand_runtime.ir.models import BrandIR
from brand_runtime.ir.schema import export_schemas
from brand_runtime.kit.generator import KitGenerationError, generate_kit
from brand_runtime.kit.models import ContentSpec, LayoutSpec

__version__ = "0.1.0"

__all__ = [
    "Answers",
    "BrandDraft",
    "BrandIR",
    "CompileError",
    "ContentSpec",
    "GuardCheck",
    "GuardVerdict",
    "KitGenerationError",
    "LayoutSpec",
    "build_draft",
    "compile_ir",
    "export_schemas",
    "generate_kit",
    "run_static_checks",
]
