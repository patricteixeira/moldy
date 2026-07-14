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
_TEXT_INK_COVERAGE = 0.1


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


def _reference_checks(ir: BrandIR, layout: LayoutSpec) -> list[GuardCheck]:
    """Falha fechado quando o layout aponta para tokens ausentes da revisão."""
    checks: list[GuardCheck] = []

    if layout.background.kind == "color" and layout.background.color_token not in ir.colors:
        checks.append(
            _blocked(
                "layout-reference",
                "A cor de fundo prevista por este layout não está disponível na marca.",
                detail={
                    "referenceType": "backgroundColor",
                    "colorToken": layout.background.color_token,
                },
            )
        )

    composition_mode = getattr(layout, "composition_mode", None)
    if composition_mode is not None:
        rules = ir.composition_rules
        mode = getattr(rules.modes, composition_mode, None) if rules is not None else None
        if mode is None:
            checks.append(
                _blocked(
                    "layout-reference",
                    "O modo visual previsto por este layout não está disponível na marca.",
                    detail={"referenceType": "compositionMode", "mode": composition_mode},
                )
            )
        else:
            if (
                layout.background.kind != "color"
                or layout.background.color_token != mode.background_color_token
            ):
                checks.append(
                    _blocked(
                        "layout-reference",
                        "O fundo deste layout não corresponde ao modo visual escolhido.",
                        detail={
                            "referenceType": "compositionModeBackground",
                            "compositionMode": composition_mode,
                            "expectedColorToken": mode.background_color_token,
                            "actualColorToken": layout.background.color_token,
                        },
                    )
                )
            for field, color_token in (
                ("backgroundColorToken", mode.background_color_token),
                ("foregroundColorToken", mode.foreground_color_token),
            ):
                if color_token not in ir.colors:
                    checks.append(
                        _blocked(
                            "layout-reference",
                            "Uma cor do modo visual deste layout não está disponível na marca.",
                            detail={
                                "referenceType": field,
                                "compositionMode": composition_mode,
                                "colorToken": color_token,
                            },
                        )
                    )
            if mode.logo_asset_token is not None and mode.logo_asset_token not in ir.assets:
                checks.append(
                    _blocked(
                        "layout-reference",
                        "O logo previsto pelo modo visual não está disponível na marca.",
                        detail={
                            "referenceType": "compositionModeLogo",
                            "compositionMode": composition_mode,
                            "assetToken": mode.logo_asset_token,
                        },
                    )
                )

    for layer in getattr(layout, "locked_layers", []):
        if layer.kind == "asset":
            asset = ir.assets.get(layer.asset_token)
            if asset is None:
                checks.append(
                    _blocked(
                        "layout-reference",
                        "Um elemento fixo deste layout não está disponível na marca.",
                        detail={
                            "referenceType": "lockedLayerAsset",
                            "layerId": layer.id,
                            "assetToken": layer.asset_token,
                        },
                    )
                )
            else:
                _, _, width, height = layer.area
                if width < asset.min_width_px:
                    checks.append(
                        _blocked(
                            "asset-size",
                            "Um elemento fixo da marca está menor do que o uso permitido.",
                            detail={
                                "layerId": layer.id,
                                "assetToken": layer.asset_token,
                                "width": width,
                                "height": height,
                                "minWidth": asset.min_width_px,
                            },
                        )
                    )
            continue
        if layer.kind == "motif":
            rules = ir.composition_rules
            declared_motifs = {item.kind for item in rules.motifs} if rules is not None else set()
            if layer.motif not in declared_motifs:
                checks.append(
                    _blocked(
                        "layout-reference",
                        "Um motivo fixo deste layout não pertence ao sistema da marca.",
                        detail={
                            "referenceType": "lockedLayerMotif",
                            "layerId": layer.id,
                            "motif": layer.motif,
                        },
                    )
                )
        if layer.color_token not in ir.colors:
            checks.append(
                _blocked(
                    "layout-reference",
                    "Uma cor de uma camada fixa não está disponível na marca.",
                    detail={
                        "referenceType": "lockedLayerColor",
                        "layerId": layer.id,
                        "colorToken": layer.color_token,
                    },
                )
            )

    for slot in layout.slots:
        for field, color_token in (
            ("colorToken", getattr(slot, "color_token", None)),
            ("strokeColorToken", getattr(slot, "stroke_color_token", None)),
            ("emphasisColorToken", getattr(slot, "emphasis_color_token", None)),
        ):
            if color_token is not None and color_token not in ir.colors:
                checks.append(
                    _blocked(
                        "layout-reference",
                        f"Uma cor prevista para «{slot.id}» não está disponível na marca.",
                        slot_id=slot.id,
                        detail={"referenceType": field, "colorToken": color_token},
                    )
                )
        asset_token = getattr(slot, "asset_token", None)
        if asset_token is not None and asset_token not in ir.assets:
            checks.append(
                _blocked(
                    "layout-reference",
                    f"O elemento de marca previsto para «{slot.id}» não está disponível.",
                    slot_id=slot.id,
                    detail={"referenceType": "slotAsset", "assetToken": asset_token},
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


def _exact_occurrence_count(text: str, excerpt: str) -> int:
    """Conta ocorrências exatas, inclusive as sobrepostas, para um binding inequívoco."""
    if not excerpt:
        return 0
    return sum(1 for index in range(len(text)) if text.startswith(excerpt, index))


def _emphasis_checks(layout: LayoutSpec, content: ContentSpec) -> list[GuardCheck]:
    """Exige um único trecho literal quando o layout prevê destaque editorial."""
    checks: list[GuardCheck] = []
    for slot in layout.slots:
        if slot.kind != "text":
            continue
        value = content.values.get(slot.id)
        if not isinstance(value, TextValue) or not value.text.strip():
            continue

        emphasis_color = getattr(slot, "emphasis_color_token", None)
        emphasis = getattr(value, "emphasis", None)
        if emphasis_color is None:
            if emphasis is not None and emphasis.strip():
                checks.append(
                    _blocked(
                        "emphasis",
                        f"Este layout não prevê um trecho em destaque em «{slot.id}».",
                        slot_id=slot.id,
                    )
                )
            continue

        if emphasis is None or not emphasis.strip():
            checks.append(
                _blocked(
                    "emphasis",
                    f"Escolha um trecho da frase de «{slot.id}» para destacar.",
                    slot_id=slot.id,
                    detail={"occurrences": 0},
                )
            )
            continue

        occurrences = _exact_occurrence_count(value.text, emphasis)
        detail = {"occurrences": occurrences, "emphasisChars": len(emphasis)}
        if occurrences == 0:
            checks.append(
                _blocked(
                    "emphasis",
                    "O trecho em destaque precisa ser copiado exatamente da frase principal.",
                    slot_id=slot.id,
                    detail=detail,
                )
            )
        elif occurrences > 1:
            checks.append(
                _blocked(
                    "emphasis",
                    "Escolha um trecho que apareça apenas uma vez na frase principal.",
                    slot_id=slot.id,
                    detail=detail,
                )
            )
        else:
            checks.append(
                _passed(
                    "emphasis",
                    "O trecho em destaque está ligado à frase principal.",
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


def _accent_usage_checks(
    ir: BrandIR,
    layout: LayoutSpec,
    content: ContentSpec,
) -> list[GuardCheck]:
    """Estima a tinta do acento por área, fração textual e cobertura tipográfica."""
    rules = ir.composition_rules
    accent = rules.accent if rules is not None else None
    if accent is None:
        return []

    canvas_area = layout.canvas.width_px * layout.canvas.height_px
    locked_ratio = 0.0
    locked_ids: list[str] = []
    for layer in getattr(layout, "locked_layers", []):
        if getattr(layer, "color_token", None) != accent.color_token:
            continue
        _, _, width, height = layer.area
        locked_ratio += (width * height / canvas_area) * layer.opacity
        locked_ids.append(layer.id)

    emphasis_ratio = 0.0
    emphasis_slots: list[str] = []
    for slot in layout.slots:
        if slot.kind != "text" or getattr(slot, "emphasis_color_token", None) != accent.color_token:
            continue
        value = content.values.get(slot.id)
        emphasis = getattr(value, "emphasis", None) if isinstance(value, TextValue) else None
        if (
            not isinstance(value, TextValue)
            or not value.text
            or emphasis is None
            or not emphasis
            or _exact_occurrence_count(value.text, emphasis) != 1
        ):
            continue
        _, _, width, height = slot.area
        emphasis_ratio += (
            (width * height / canvas_area)
            * (len(emphasis) / len(value.text))
            * slot.opacity
            * _TEXT_INK_COVERAGE
        )
        emphasis_slots.append(slot.id)

    if not locked_ids and not emphasis_slots:
        return []

    estimated_ratio = locked_ratio + emphasis_ratio
    detail = {
        "estimatedRatio": round(estimated_ratio, 6),
        "maxRatio": accent.max_ratio,
        "lockedLayersRatio": round(locked_ratio, 6),
        "emphasisRatio": round(emphasis_ratio, 6),
        "textInkCoverage": _TEXT_INK_COVERAGE,
        "lockedLayerIds": locked_ids,
        "emphasisSlotIds": emphasis_slots,
    }
    if estimated_ratio > accent.max_ratio + 1e-6:
        return [
            _blocked(
                "accent-ratio",
                "O destaque ocupa mais espaço do que este sistema de marca permite.",
                detail=detail,
            )
        ]
    return [
        _passed(
            "accent-ratio",
            "A presença do destaque respeita o limite deste sistema de marca.",
            detail=detail,
        )
    ]


def _contrast_check(
    *,
    check_id: str,
    slot: Slot,
    foreground: str | None,
    background: str | None,
    threshold: float,
    emphasis: bool = False,
) -> GuardCheck:
    """Avalia uma combinação de texto sem expor a razão na mensagem leiga."""
    subject = "trecho em destaque" if emphasis else "texto"
    if foreground is None or background is None:
        return _blocked(
            check_id,
            f"Não foi possível avaliar o contraste do {subject} de «{slot.id}».",
            slot_id=slot.id,
            detail={"missingReference": True, "threshold": threshold},
        )
    ratio = wcag_contrast(foreground, background)
    detail = {"ratio": round(ratio, 2), "threshold": threshold}
    if ratio < threshold:
        return _blocked(
            check_id,
            f"O contraste do {subject} de «{slot.id}» com o fundo é insuficiente para leitura.",
            slot_id=slot.id,
            detail=detail,
        )
    return _passed(
        check_id,
        f"O contraste do {subject} de «{slot.id}» é suficiente para leitura.",
        slot_id=slot.id,
        detail=detail,
    )


def _contrast_checks(ir: BrandIR, layout: LayoutSpec) -> list[GuardCheck]:
    """Avalia texto base e destaque sobre fundo sólido com limiar por tamanho."""
    if layout.background.kind != "color" or layout.background.color_token is None:
        return []
    checks: list[GuardCheck] = []
    background_token = ir.colors.get(layout.background.color_token)
    for slot in layout.slots:
        if slot.kind != "text":
            continue
        role = ir.roles.get(slot.role or "")
        threshold = 3.0 if role is not None and role.min_size_px >= 24 else 4.5
        foreground_ref = getattr(slot, "color_token", None) or (
            role.color if role is not None else None
        )
        foreground_token = ir.colors.get(foreground_ref) if foreground_ref is not None else None
        checks.append(
            _contrast_check(
                check_id="contrast",
                slot=slot,
                foreground=foreground_token.value if foreground_token is not None else None,
                background=background_token.value if background_token is not None else None,
                threshold=threshold,
            )
        )

        emphasis_ref = getattr(slot, "emphasis_color_token", None)
        if emphasis_ref is not None:
            emphasis_token = ir.colors.get(emphasis_ref)
            checks.append(
                _contrast_check(
                    check_id="emphasis-contrast",
                    slot=slot,
                    foreground=emphasis_token.value if emphasis_token is not None else None,
                    background=background_token.value if background_token is not None else None,
                    threshold=threshold,
                    emphasis=True,
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
        *_reference_checks(ir, layout),
        *_presence_and_type_checks(layout, content),
        *_text_length_checks(layout, content),
        *_emphasis_checks(layout, content),
        *_image_resolution_checks(layout, content, assets_dir),
        *_accent_usage_checks(ir, layout, content),
        *_contrast_checks(ir, layout),
    ]
