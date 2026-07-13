"""Checks estáticos do Brand Guard para conteúdo, assets e contraste."""

from __future__ import annotations

import warnings
import hashlib
from pathlib import Path
from typing import Any, Literal

from PIL import Image, UnidentifiedImageError
from pydantic import Field

from brand_runtime.colors import wcag_contrast
from brand_runtime.ir.models import BrandIR, CamelModel
from brand_runtime.kit.models import ContentSpec, ImageValue, LayoutSpec, Slot, TextValue

_RASTER_FORMATS = {"PNG", "JPEG"}


class GuardCheck(CamelModel):
    """Resultado serializável de uma regra do Brand Guard."""

    id: str
    slot_id: str | None = None
    status: Literal["pass", "fixed", "blocked"]
    message_pt: str
    detail: dict[str, Any] = Field(default_factory=dict)


class GuardVerdict(CamelModel):
    """Artefato compartilhado que envolve a sequência ordenada de checks."""

    checks: list[GuardCheck]


def _blocked(
    check_id: str,
    message: str,
    *,
    slot_id: str | None = None,
    detail: dict[str, Any] | None = None,
) -> GuardCheck:
    """Monta um bloqueio sem compartilhar o dicionário de detalhes."""
    return GuardCheck(
        id=check_id,
        slot_id=slot_id,
        status="blocked",
        message_pt=message,
        detail=detail or {},
    )


def _passed(
    check_id: str,
    message: str,
    *,
    slot_id: str | None = None,
    detail: dict[str, Any] | None = None,
) -> GuardCheck:
    """Monta um resultado aprovado sem sugerir correção automática."""
    return GuardCheck(
        id=check_id,
        slot_id=slot_id,
        status="pass",
        message_pt=message,
        detail=detail or {},
    )


def _contract_checks(ir: BrandIR, layout: LayoutSpec, content: ContentSpec) -> list[GuardCheck]:
    """Valida os bindings do documento e rejeita ids de slot desconhecidos."""
    checks: list[GuardCheck] = []
    if content.layout_id != layout.id:
        checks.append(
            _blocked(
                "document-contract",
                (
                    f"O conteúdo pertence ao layout «{content.layout_id}», "
                    f"mas este documento usa «{layout.id}»."
                ),
                detail={"expectedLayoutId": layout.id, "actualLayoutId": content.layout_id},
            )
        )
    if content.brand_revision_id != ir.revision.id:
        checks.append(
            _blocked(
                "document-contract",
                "O conteúdo pertence a outra revisão da marca.",
                detail={
                    "expectedBrandRevisionId": ir.revision.id,
                    "actualBrandRevisionId": content.brand_revision_id,
                },
            )
        )
    # O logo é controlado pelo Brand IR e não pode ser sobrescrito por ContentSpec.
    known = {slot.id for slot in layout.slots if slot.kind != "logo"}
    for slot_id in sorted(set(content.values) - known):
        checks.append(
            _blocked(
                "unknown-slot",
                f"O conteúdo informa o campo desconhecido «{slot_id}».",
                slot_id=slot_id,
            )
        )
    return checks


def _is_blank_required_text(slot: Slot, value: TextValue | ImageValue | None) -> bool:
    """Trata texto obrigatório vazio como ausência de conteúdo."""
    return slot.kind == "text" and isinstance(value, TextValue) and not value.text.strip()


def _presence_and_type_checks(layout: LayoutSpec, content: ContentSpec) -> list[GuardCheck]:
    """Valida presença e compatibilidade entre cada slot e seu valor."""
    checks: list[GuardCheck] = []
    for slot in layout.slots:
        if slot.kind == "logo":
            continue
        value = content.values.get(slot.id)
        if slot.required and (value is None or _is_blank_required_text(slot, value)):
            checks.append(
                _blocked(
                    "required-slot",
                    f"Preencha o campo obrigatório «{slot.id}».",
                    slot_id=slot.id,
                )
            )
            continue
        if value is None:
            continue
        expected_type = TextValue if slot.kind == "text" else ImageValue
        if not isinstance(value, expected_type):
            checks.append(
                _blocked(
                    "content-type",
                    f"O campo «{slot.id}» tem um tipo de conteúdo incompatível com este layout.",
                    slot_id=slot.id,
                    detail={"expectedKind": slot.kind, "actualKind": value.kind},
                )
            )
    return checks


def _text_length_checks(layout: LayoutSpec, content: ContentSpec) -> list[GuardCheck]:
    """Compara textos válidos com o limite editorial do slot, sem truncar."""
    checks: list[GuardCheck] = []
    for slot in layout.slots:
        value = content.values.get(slot.id)
        if (
            slot.kind != "text"
            or slot.max_chars is None
            or not isinstance(value, TextValue)
            or not value.text.strip()
        ):
            continue
        chars = len(value.text)
        detail = {"chars": chars, "maxChars": slot.max_chars}
        if chars > slot.max_chars:
            checks.append(
                _blocked(
                    "text-length",
                    (
                        f"O texto de «{slot.id}» tem {chars} caracteres; "
                        f"o máximo deste layout é {slot.max_chars}."
                    ),
                    slot_id=slot.id,
                    detail=detail,
                )
            )
        else:
            checks.append(
                _passed(
                    "text-length",
                    f"O texto de «{slot.id}» está dentro do limite deste layout.",
                    slot_id=slot.id,
                    detail=detail,
                )
            )
    return checks


def _resolve_asset(assets_dir: Path, value_path: str) -> Path | None:
    """Resolve um asset regular sem permitir path absoluto, traversal ou symlink externo."""
    raw = Path(value_path)
    if raw.is_absolute() or raw.drive or ".." in raw.parts:
        return None
    try:
        base = assets_dir.resolve(strict=True)
        resolved = (base / raw).resolve(strict=True)
    except OSError:
        return None
    if not resolved.is_file() or not resolved.is_relative_to(base):
        return None
    return resolved


def _image_size(path: Path) -> tuple[int, int] | None:
    """Lê e valida por completo um PNG/JPEG, convertendo falhas do Pillow em ausência."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as image:
                if image.format not in _RASTER_FORMATS:
                    return None
                image.load()
                return image.size
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        UnidentifiedImageError,
        OSError,
        ValueError,
    ):
        return None


def _file_sha256(path: Path) -> str | None:
    """Calcula a integridade do asset em streaming; falha fechada em erro de leitura."""
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError:
        return None
    return digest.hexdigest()


def _image_resolution_checks(
    layout: LayoutSpec,
    content: ContentSpec,
    assets_dir: Path,
) -> list[GuardCheck]:
    """Valida formato, contenção e resolução mínima das imagens de conteúdo."""
    checks: list[GuardCheck] = []
    for slot in layout.slots:
        value = content.values.get(slot.id)
        if slot.kind != "image" or not isinstance(value, ImageValue):
            continue
        resolved = _resolve_asset(assets_dir, value.path)
        if resolved is None:
            checks.append(
                _blocked(
                    "image-resolution",
                    f"A imagem de «{slot.id}» não foi encontrada.",
                    slot_id=slot.id,
                )
            )
            continue
        size = _image_size(resolved)
        if size is None:
            checks.append(
                _blocked(
                    "image-resolution",
                    f"A imagem de «{slot.id}» não pôde ser lida como PNG ou JPEG.",
                    slot_id=slot.id,
                )
            )
            continue
        if value.sha256 is not None:
            actual_sha256 = _file_sha256(resolved)
            if actual_sha256 != value.sha256:
                checks.append(
                    _blocked(
                        "asset-integrity",
                        f"A imagem de «{slot.id}» não corresponde ao arquivo enviado.",
                        slot_id=slot.id,
                        detail={"expectedSha256": value.sha256, "actualSha256": actual_sha256},
                    )
                )
                continue
            checks.append(
                _passed(
                    "asset-integrity",
                    f"A integridade da imagem de «{slot.id}» foi confirmada.",
                    slot_id=slot.id,
                    detail={"sha256": actual_sha256},
                )
            )
        width, height = size
        if slot.min_resolution is None:
            checks.append(
                _passed(
                    "image-resolution",
                    f"A imagem de «{slot.id}» é um arquivo raster válido.",
                    slot_id=slot.id,
                    detail={"width": width, "height": height},
                )
            )
            continue
        min_width, min_height = slot.min_resolution
        detail = {
            "width": width,
            "height": height,
            "minWidth": min_width,
            "minHeight": min_height,
        }
        if width < min_width or height < min_height:
            checks.append(
                _blocked(
                    "image-resolution",
                    (
                        f"A imagem de «{slot.id}» tem {width}×{height}px; "
                        f"o mínimo para este formato é {min_width}×{min_height}px."
                    ),
                    slot_id=slot.id,
                    detail=detail,
                )
            )
        else:
            checks.append(
                _passed(
                    "image-resolution",
                    f"A imagem de «{slot.id}» atende à resolução mínima deste formato.",
                    slot_id=slot.id,
                    detail=detail,
                )
            )
    return checks


def _contrast_checks(ir: BrandIR, layout: LayoutSpec) -> list[GuardCheck]:
    """Avalia contraste de todo texto sobre fundo sólido da marca."""
    if layout.background.kind != "color" or layout.background.color_token is None:
        return []
    checks: list[GuardCheck] = []
    background_token = ir.colors.get(layout.background.color_token)
    for slot in layout.slots:
        if slot.kind != "text":
            continue
        role = ir.roles.get(slot.role or "")
        foreground_token = ir.colors.get(role.color) if role is not None else None
        if role is None or foreground_token is None or background_token is None:
            checks.append(
                _blocked(
                    "contrast",
                    f"Não foi possível avaliar o contraste do texto de «{slot.id}».",
                    slot_id=slot.id,
                    detail={"missingReference": True},
                )
            )
            continue
        ratio = wcag_contrast(foreground_token.value, background_token.value)
        detail = {"ratio": round(ratio, 2)}
        if ratio < 4.5:
            checks.append(
                _blocked(
                    "contrast",
                    (
                        f"O contraste entre o texto de «{slot.id}» "
                        "e o fundo é insuficiente para leitura."
                    ),
                    slot_id=slot.id,
                    detail=detail,
                )
            )
        else:
            checks.append(
                _passed(
                    "contrast",
                    f"O contraste do texto de «{slot.id}» é suficiente para leitura.",
                    slot_id=slot.id,
                    detail=detail,
                )
            )
    return checks


def run_static_checks(
    ir: BrandIR,
    layout: LayoutSpec,
    content: ContentSpec,
    assets_dir: Path,
) -> list[GuardCheck]:
    """Executa o verdict estático em ordem estável sem mutar nenhuma entrada."""
    return [
        *_contract_checks(ir, layout, content),
        *_presence_and_type_checks(layout, content),
        *_text_length_checks(layout, content),
        *_image_resolution_checks(layout, content, assets_dir),
        *_contrast_checks(ir, layout),
    ]
