"""Testes da espera pelos checks remotos da release."""

from __future__ import annotations

import unittest
from unittest.mock import Mock, patch

from tools.verify_release_checks import (
    REQUIRED_CHECKS,
    fetch_checks,
    wait_for_required_checks,
)


class VerifyReleaseChecksTests(unittest.TestCase):
    """Garante que ausência, espera e falha remota não sejam tratadas como sucesso."""

    @patch("tools.verify_release_checks.fetch_checks")
    def test_accepts_only_when_every_required_check_passed(self, fetch_checks) -> None:
        fetch_checks.return_value = {name: "success" for name in REQUIRED_CHECKS}
        self.assertEqual(wait_for_required_checks("owner/repo", "abc", attempts=1), [])

    @patch("tools.verify_release_checks.fetch_checks")
    def test_reports_a_terminal_failure_immediately(self, fetch_checks) -> None:
        checks = {name: "success" for name in REQUIRED_CHECKS}
        checks["Stack Docker (smoke)"] = "failure"
        fetch_checks.return_value = checks
        self.assertEqual(
            wait_for_required_checks("owner/repo", "abc", attempts=1),
            ["Stack Docker (smoke): failure"],
        )

    @patch("tools.verify_release_checks.fetch_checks")
    def test_reports_a_missing_check_after_the_wait_budget(self, fetch_checks) -> None:
        fetch_checks.return_value = {}
        errors = wait_for_required_checks("owner/repo", "abc", attempts=1)
        self.assertEqual(len(errors), len(REQUIRED_CHECKS))
        self.assertTrue(all("ausente ou inconclusivo" in error for error in errors))

    @patch("tools.verify_release_checks.subprocess.run")
    def test_latest_rerun_wins_when_a_check_name_repeats(self, run) -> None:
        """Uma execução verde mais nova não é sobrescrita por tentativa antiga."""
        run.return_value = Mock(
            stdout=(
                '{"check_runs": ['
                '{"id": 20, "name": "Stack Docker (smoke)", "conclusion": "success"},'
                '{"id": 10, "name": "Stack Docker (smoke)", "conclusion": "failure"}'
                "]}"
            )
        )
        self.assertEqual(
            fetch_checks("owner/repo", "abc")["Stack Docker (smoke)"], "success"
        )


if __name__ == "__main__":
    unittest.main()
