"""Carregamento fechado de pacotes declarativos exclusivos da instância hospedada."""

from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import Path

from brand_runtime.ir.models import BrandIR
from brand_runtime.kit.models import LayoutSpec
from brand_runtime.templates.models import TemplatePackage
from pydantic import ValidationError

PRIVATE_TEMPLATE_DIR_ENV = "BRANDRT_PRIVATE_TEMPLATE_DIR"
_MAX_PACKAGE_COUNT = 64
_MAX_PACKAGE_BYTES = 2 * 2**20
_MAX_CATALOG_BYTES = 16 * 2**20
_PACKAGE_NAME = re.compile(r"^[a-z0-9][a-z0-9.-]*\.json$")


class PrivateTemplateCatalogError(RuntimeError):
    """Indica que o catálogo privado configurado não pode ser publicado com segurança."""


def _is_link(path: Path) -> bool:
    is_junction = getattr(os.path, "isjunction", None)
    return path.is_symlink() or bool(is_junction and is_junction(path))


def _configured_directory() -> Path | None:
    raw = os.environ.get(PRIVATE_TEMPLATE_DIR_ENV, "").strip()
    if not raw:
        return None
    configured = Path(raw)
    try:
        resolved = configured.resolve(strict=True)
    except OSError as exc:
        raise PrivateTemplateCatalogError(
            f"{PRIVATE_TEMPLATE_DIR_ENV} não aponta para uma pasta existente."
        ) from exc
    if _is_link(configured) or not resolved.is_dir():
        raise PrivateTemplateCatalogError(
            f"{PRIVATE_TEMPLATE_DIR_ENV} precisa apontar para uma pasta regular."
        )
    return resolved


def _catalog_signature(directory: Path) -> tuple[tuple[str, int, int], ...]:
    files = sorted(directory.iterdir(), key=lambda item: item.name)
    package_files = [item for item in files if item.suffix == ".json"]
    if len(package_files) > _MAX_PACKAGE_COUNT:
        raise PrivateTemplateCatalogError(
            f"O catálogo privado aceita no máximo {_MAX_PACKAGE_COUNT} pacotes."
        )

    signature: list[tuple[str, int, int]] = []
    total = 0
    for path in package_files:
        if not _PACKAGE_NAME.fullmatch(path.name):
            raise PrivateTemplateCatalogError(
                f"O pacote privado {path.name!r} precisa usar um nome portável em minúsculas."
            )
        if _is_link(path) or not path.is_file():
            raise PrivateTemplateCatalogError(
                f"O pacote privado {path.name!r} precisa ser um arquivo regular."
            )
        stat = path.stat()
        if stat.st_size > _MAX_PACKAGE_BYTES:
            raise PrivateTemplateCatalogError(
                f"O pacote privado {path.name!r} excede {_MAX_PACKAGE_BYTES} bytes."
            )
        total += stat.st_size
        signature.append((path.name, stat.st_size, stat.st_mtime_ns))
    if total > _MAX_CATALOG_BYTES:
        raise PrivateTemplateCatalogError(f"O catálogo privado excede {_MAX_CATALOG_BYTES} bytes.")
    return tuple(signature)


@lru_cache(maxsize=16)
def _load_packages(
    directory_value: str,
    signature: tuple[tuple[str, int, int], ...],
) -> tuple[TemplatePackage, ...]:
    directory = Path(directory_value)
    packages: list[TemplatePackage] = []
    package_ids: set[str] = set()
    composition_ids: set[str] = set()

    for filename, expected_size, _mtime_ns in signature:
        path = directory / filename
        data = path.read_bytes()
        if len(data) != expected_size:
            raise PrivateTemplateCatalogError(
                f"O pacote privado {filename!r} mudou durante a leitura."
            )
        try:
            package = TemplatePackage.model_validate_json(data)
        except ValidationError as exc:
            raise PrivateTemplateCatalogError(
                f"O pacote privado {filename!r} não atende ao contrato TemplatePackage."
            ) from exc
        if package.id in package_ids:
            raise PrivateTemplateCatalogError(
                f"O id de pacote privado {package.id!r} está repetido."
            )
        package_ids.add(package.id)
        for composition in package.compositions:
            if composition.layout.id != composition.id:
                raise PrivateTemplateCatalogError(
                    f"A composição privada {composition.id!r} precisa usar o mesmo id no layout."
                )
            if composition.id in composition_ids:
                raise PrivateTemplateCatalogError(
                    f"O id de composição privada {composition.id!r} está repetido."
                )
            composition_ids.add(composition.id)
        packages.append(package)
    return tuple(packages)


def private_template_layouts(ir: BrandIR) -> list[LayoutSpec]:
    """Retorna layouts privados compatíveis, sem executar código vindo do pacote."""
    directory = _configured_directory()
    if directory is None:
        return []
    signature = _catalog_signature(directory)
    packages = _load_packages(str(directory), signature)
    available_roles = set(ir.roles)
    available_colors = set(ir.colors)
    layouts: list[LayoutSpec] = []

    for package in packages:
        missing_roles = set(package.required_roles) - available_roles
        missing_colors = set(package.required_color_tokens) - available_colors
        if missing_roles or missing_colors:
            missing = sorted((*missing_roles, *missing_colors))
            raise PrivateTemplateCatalogError(
                f"O pacote privado {package.id!r} exige tokens ausentes: {', '.join(missing)}."
            )
        layouts.extend(composition.layout for composition in package.compositions)
    return layouts
