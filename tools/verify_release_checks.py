"""Espera os gates remotos obrigatórios antes de permitir uma GitHub Release."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time

REQUIRED_CHECKS = {
    "Contrato de release",
    "App web (apps/web)",
    "API Python (apps/api)",
    "Motor Python (packages/engine)",
    "SDK de adapters (packages/adapter-sdk-python)",
    "Stack Docker (smoke)",
    "Analyze (actions)",
    "Analyze (javascript-typescript)",
    "Analyze (python)",
}
TERMINAL_FAILURES = {"action_required", "cancelled", "failure", "stale", "timed_out"}


def fetch_checks(repository: str, commit_sha: str) -> dict[str, str | None]:
    """Obtém a conclusão mais recente de cada check run do commit."""
    process = subprocess.run(
        [
            "gh",
            "api",
            "--method",
            "GET",
            f"repos/{repository}/commits/{commit_sha}/check-runs",
            "-f",
            "per_page=100",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(process.stdout)
    ordered = sorted(payload["check_runs"], key=lambda item: item["id"])
    return {item["name"]: item.get("conclusion") for item in ordered}


def wait_for_required_checks(
    repository: str, commit_sha: str, *, attempts: int = 60, interval_seconds: int = 10
) -> list[str]:
    """Espera os checks e retorna mensagens de erro se algum gate não fechar."""
    for attempt in range(1, attempts + 1):
        checks = fetch_checks(repository, commit_sha)
        failed = sorted(
            name for name in REQUIRED_CHECKS if checks.get(name) in TERMINAL_FAILURES
        )
        if failed:
            return [f"{name}: {checks[name]}" for name in failed]
        if all(checks.get(name) == "success" for name in REQUIRED_CHECKS):
            print("CI, stack Docker e CodeQL estão verdes no commit da release.")
            return []
        pending = sorted(
            name for name in REQUIRED_CHECKS if checks.get(name) != "success"
        )
        print(
            f"Tentativa {attempt}/{attempts}: aguardando {', '.join(pending)}.",
            flush=True,
        )
        if attempt < attempts:
            time.sleep(interval_seconds)
    return [f"{name}: ausente ou inconclusivo" for name in pending]


def main() -> int:
    repository = os.environ.get("REPOSITORY", "").strip()
    commit_sha = os.environ.get("COMMIT_SHA", "").strip()
    if not repository or not commit_sha:
        print("REPOSITORY e COMMIT_SHA são obrigatórios.", file=sys.stderr)
        return 2
    errors = wait_for_required_checks(repository, commit_sha)
    for error in errors:
        print(f"ERRO: {error}", file=sys.stderr)
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())
