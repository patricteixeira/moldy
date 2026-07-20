"""Testes do contrato estático de release."""

from __future__ import annotations

import unittest
from pathlib import Path

from tools.release_check import ROOT, declared_versions, validate_release


class ReleaseCheckTests(unittest.TestCase):
    """Protege o corte público contra versões e documentação divergentes."""

    def test_current_release_contract_is_complete(self) -> None:
        """O checkout deve estar pronto para produzir os artefatos v0.1.0."""
        versions = declared_versions(ROOT)
        current = versions["packages/engine/pyproject.toml"]
        self.assertEqual(validate_release(ROOT, current), [])

    def test_all_public_packages_share_the_release_version(self) -> None:
        """Componentes distribuídos juntos avançam sob uma versão única."""
        self.assertEqual(len(set(declared_versions(ROOT).values())), 1)

    def test_prerelease_string_is_rejected_by_the_stable_release_gate(self) -> None:
        """O workflow estável não publica tags RC por engano."""
        errors = validate_release(Path("missing"), "0.1.0-rc.1")
        self.assertIn("não é SemVer estável", errors[0])


if __name__ == "__main__":
    unittest.main()
