"""Brand Guard: validações determinísticas sem alteração silenciosa de conteúdo."""

from brand_runtime.guard.static_checks import GuardCheck, GuardVerdict, run_static_checks

__all__ = ["GuardCheck", "GuardVerdict", "run_static_checks"]
