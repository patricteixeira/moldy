"""Valida o contrato estático de uma release pública do Molda."""

from __future__ import annotations

import argparse
import json
import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")

REQUIRED_PUBLIC_FILES = (
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "SECURITY.md",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    ".env.example",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/ISSUE_TEMPLATE/bug.yml",
    ".github/ISSUE_TEMPLATE/feature.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
    ".github/dependabot.yml",
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
    "docs/LICENSE",
    "schemas/LICENSE",
    "examples/LICENSE",
    "packages/adapter-sdk-python/LICENSE",
)


def _toml_version(path: Path) -> str:
    with path.open("rb") as stream:
        return str(tomllib.load(stream)["project"]["version"])


def _json_version(path: Path) -> str:
    return str(json.loads(path.read_text(encoding="utf-8"))["version"])


def _python_version(path: Path) -> str:
    match = re.search(
        r'^__version__\s*=\s*["\']([^"\']+)["\']',
        path.read_text(encoding="utf-8"),
        flags=re.MULTILINE,
    )
    if match is None:
        raise ValueError(f"{path} não declara __version__.")
    return match.group(1)


def declared_versions(root: Path) -> dict[str, str]:
    """Lê todas as versões públicas que devem avançar juntas."""
    return {
        "packages/engine/pyproject.toml": _toml_version(
            root / "packages/engine/pyproject.toml"
        ),
        "apps/api/pyproject.toml": _toml_version(root / "apps/api/pyproject.toml"),
        "packages/adapter-sdk-python/pyproject.toml": _toml_version(
            root / "packages/adapter-sdk-python/pyproject.toml"
        ),
        "packages/render/package.json": _json_version(
            root / "packages/render/package.json"
        ),
        "apps/web/package.json": _json_version(root / "apps/web/package.json"),
        "packages/engine/src/brand_runtime/__init__.py": _python_version(
            root / "packages/engine/src/brand_runtime/__init__.py"
        ),
        "apps/api/src/brand_api/__init__.py": _python_version(
            root / "apps/api/src/brand_api/__init__.py"
        ),
        "packages/adapter-sdk-python/src/brand_runtime_adapter/__init__.py": _python_version(
            root / "packages/adapter-sdk-python/src/brand_runtime_adapter/__init__.py"
        ),
    }


def validate_release(root: Path, version: str) -> list[str]:
    """Retorna todos os desvios encontrados, sem parar no primeiro erro."""
    errors: list[str] = []
    if SEMVER.fullmatch(version) is None:
        errors.append(f"A versão {version!r} não é SemVer estável no formato X.Y.Z.")
        return errors

    for relative in REQUIRED_PUBLIC_FILES:
        if not (root / relative).is_file():
            errors.append(f"Arquivo público obrigatório ausente: {relative}")

    try:
        versions = declared_versions(root)
    except (
        KeyError,
        OSError,
        ValueError,
        tomllib.TOMLDecodeError,
        json.JSONDecodeError,
    ) as exc:
        errors.append(f"Não foi possível ler as versões declaradas: {exc}")
    else:
        for relative, declared in versions.items():
            if declared != version:
                errors.append(f"{relative} declara {declared}; esperado {version}.")

    changelog_path = root / "CHANGELOG.md"
    if changelog_path.is_file():
        changelog = changelog_path.read_text(encoding="utf-8")
        dated_header = re.compile(
            rf"^## \[{re.escape(version)}\] - \d{{4}}-\d{{2}}-\d{{2}}$", re.MULTILINE
        )
        if dated_header.search(changelog) is None:
            errors.append(f"CHANGELOG.md não possui uma seção datada para [{version}].")

    notes = root / f"docs/releases/v{version}.md"
    if not notes.is_file():
        errors.append(f"Notas públicas ausentes: docs/releases/v{version}.md")

    root_license = root / "LICENSE"
    if (
        root_license.is_file()
        and "GNU AFFERO GENERAL PUBLIC LICENSE"
        not in root_license.read_text(encoding="utf-8")
    ):
        errors.append("LICENSE não contém o texto da GNU AGPL.")
    for relative in (
        "schemas/LICENSE",
        "examples/LICENSE",
        "packages/adapter-sdk-python/LICENSE",
    ):
        path = root / relative
        if path.is_file() and not path.read_text(encoding="utf-8").startswith(
            "MIT License"
        ):
            errors.append(f"{relative} não contém a licença MIT esperada.")

    docs_license = root / "docs/LICENSE"
    if docs_license.is_file() and "CC BY 4.0" not in docs_license.read_text(
        encoding="utf-8"
    ):
        errors.append("docs/LICENSE não declara CC BY 4.0.")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", help="Versão SemVer sem o prefixo v")
    args = parser.parse_args()
    version = args.version or _toml_version(ROOT / "packages/engine/pyproject.toml")
    errors = validate_release(ROOT, version)
    if errors:
        for error in errors:
            print(f"ERRO: {error}", file=sys.stderr)
        return 1
    print(f"Contrato da release v{version} validado.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
