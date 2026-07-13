"""Compilação das confirmações do wizard em uma revisão do Brand IR."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from brand_runtime.colors import normalize_color
from brand_runtime.intake.base import Candidate
from brand_runtime.intake.draft import BrandDraft, DraftQuestion
from brand_runtime.intake.svg_logo import SvgInvalid, svg_external_style_missing
from brand_runtime.ir.models import (
    BrandIR,
    BrandInfo,
    CamelModel,
    ColorToken,
    Diagnostic,
    Evidence,
    FontToken,
    LogoAsset,
    RevisionInfo,
    SemanticRole,
)

_REQUIRED_ANSWERS = (
    "color.primary",
    "color.background",
    "color.text",
    "font.heading",
    "font.body",
    "logo.primary",
)
_HASH_CHUNK_SIZE = 1024 * 1024
_IDENTITY_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


class Answers(CamelModel):
    """Valores confirmados no wizard, indexados pelo identificador da pergunta."""

    values: dict[str, Any]


class CompileError(Exception):
    """Erro de compilação que pode ser apresentado diretamente em PT-BR."""


def _question(draft: BrandDraft, question_id: str) -> DraftQuestion | None:
    """Localiza uma pergunta sem pressupor que as opcionais existam."""
    return next((item for item in draft.questions if item.id == question_id), None)


def _match_color(question: DraftQuestion | None, value: Any) -> Candidate | None:
    """Casa cores por seu valor CSS normalizado."""
    normalized = normalize_color(str(value))
    if question is None:
        return None
    for candidate in question.candidates:
        try:
            if normalize_color(str(candidate.value)) == normalized:
                return candidate
        except ValueError:
            continue
    return None


def _font_identity(value: Any) -> tuple[str, int]:
    """Extrai a identidade normativa de uma resposta de fonte."""
    if not isinstance(value, dict):
        raise CompileError("A resposta de fonte deve informar família e peso.")
    family = value.get("family")
    weight = value.get("weight", 400)
    if not isinstance(family, str) or not family.strip():
        raise CompileError("A resposta de fonte deve informar uma família válida.")
    if isinstance(weight, bool) or not isinstance(weight, int):
        raise CompileError("A resposta de fonte deve informar um peso numérico válido.")
    return family, weight


def _match_font(question: DraftQuestion | None, value: Any) -> Candidate | None:
    """Casa fontes por família e peso, usando o path apenas para desempatar."""
    identity = _font_identity(value)
    if question is None:
        return None
    matches: list[Candidate] = []
    for candidate in question.candidates:
        if not isinstance(candidate.value, dict):
            continue
        try:
            if _font_identity(candidate.value) == identity:
                matches.append(candidate)
        except CompileError:
            continue
    if not matches:
        return None
    # DTCG tem autoridade maior e por isso aparece antes, mas uma família/peso
    # pode existir tanto nos tokens quanto como arquivo. Quando o valor escolhido
    # veio do candidato file-backed, seu path relativo identifica essa escolha.
    # O path nunca é aceito isoladamente: precisa existir em um candidato casado.
    selected_path = value.get("path") if isinstance(value, dict) else None
    if selected_path is not None:
        try:
            selected_path = _portable_relative_path(selected_path)
        except CompileError:
            selected_path = None
        if selected_path is not None:
            for candidate in matches:
                candidate_path = candidate.value.get("path")
                if (
                    candidate_path is not None
                    and _portable_relative_path(candidate_path) == selected_path
                ):
                    return candidate
    return matches[0]


def _portable_relative_path(value: Any) -> str:
    """Normaliza um path relativo para a representação portátil do IR."""
    if not isinstance(value, str) or not value.strip():
        raise CompileError("O caminho do asset confirmado é inválido.")
    path = Path(value)
    if path.is_absolute() or ".." in path.parts:
        raise CompileError("O caminho do asset deve permanecer dentro do pacote da marca.")
    return path.as_posix()


def _match_logo(question: DraftQuestion | None, value: Any) -> Candidate | None:
    """Casa o logo pelo path relativo ao pacote."""
    relative = _portable_relative_path(value)
    if question is None:
        return None
    return next(
        (
            candidate
            for candidate in question.candidates
            if isinstance(candidate.value, str)
            and _portable_relative_path(candidate.value) == relative
        ),
        None,
    )


def _confirmation(created_at: datetime) -> Evidence:
    """Cria a evidência autoritativa comum a toda escolha confirmada."""
    return Evidence(
        source_type="wizard-confirmation",
        confidence=1.0,
        authoritative=True,
        confirmed_at=created_at,
    )


def _portable_evidence(item: Evidence, package_dir: Path) -> Evidence:
    """Copia uma evidência e torna seu path relativo à raiz do pacote."""
    if item.path is None:
        return item.model_copy(deep=True)
    try:
        base = package_dir.resolve(strict=True)
        raw = Path(item.path)
        resolved = (
            raw.resolve(strict=True) if raw.is_absolute() else (base / raw).resolve(strict=True)
        )
    except OSError as exc:
        raise CompileError(f"A origem da evidência não foi encontrada: {item.path}.") from exc
    if not resolved.is_file() or not resolved.is_relative_to(base):
        raise CompileError("A origem da evidência precisa permanecer dentro do pacote da marca.")
    return item.model_copy(update={"path": resolved.relative_to(base).as_posix()}, deep=True)


def _confirmed_evidence(
    candidate: Candidate | None,
    created_at: datetime,
    package_dir: Path,
) -> list[Evidence]:
    """Copia evidências portáveis e confirma a escolha sem mutar o draft."""
    inherited = (
        [_portable_evidence(item, package_dir) for item in candidate.evidence]
        if candidate is not None
        else []
    )
    return [*inherited, _confirmation(created_at)]


def _package_file(package_dir: Path, relative: str) -> Path:
    """Resolve um arquivo do pacote e bloqueia traversal e symlinks externos."""
    try:
        base = package_dir.resolve(strict=True)
        resolved = (base / relative).resolve(strict=True)
    except OSError as exc:
        raise CompileError(f"O arquivo confirmado não foi encontrado: {relative}.") from exc
    if not resolved.is_file() or not resolved.is_relative_to(base):
        raise CompileError("O asset confirmado precisa ser um arquivo dentro do pacote da marca.")
    return resolved


def _sha256(path: Path) -> str:
    """Calcula SHA-256 em streaming para não carregar uploads inteiros em memória."""
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(_HASH_CHUNK_SIZE), b""):
                digest.update(chunk)
    except OSError as exc:
        raise CompileError(f"Não foi possível ler o arquivo confirmado: {path.name}.") from exc
    return digest.hexdigest()


def _compile_color(
    draft: BrandDraft, token_id: str, value: Any, created_at: datetime
) -> ColorToken:
    """Compila um token de cor e sua cadeia de evidências."""
    try:
        normalized = normalize_color(str(value))
    except ValueError as exc:
        raise CompileError(f"A cor confirmada para {token_id} é inválida.") from exc
    candidate = _match_color(_question(draft, token_id), normalized)
    return ColorToken(
        value=normalized,
        evidence=_confirmed_evidence(candidate, created_at, Path(draft.package_dir)),
    )


def _compile_font(
    draft: BrandDraft,
    token_id: str,
    value: Any,
    created_at: datetime,
    diagnostics: list[Diagnostic],
) -> FontToken:
    """Compila uma fonte confirmada e liga o arquivo apenas quando ele veio no pacote."""
    family, weight = _font_identity(value)
    candidate = _match_font(_question(draft, token_id), value)
    candidate_value = candidate.value if candidate is not None else {}
    style = value.get("style", candidate_value.get("style", "normal"))
    relative_path = candidate_value.get("path")
    file_sha256: str | None = None
    source = "referenced-only"
    if relative_path is not None:
        relative_path = _portable_relative_path(relative_path)
        file_sha256 = _sha256(_package_file(Path(draft.package_dir), relative_path))
        source = "file"
    else:
        diagnostics.append(
            Diagnostic(
                code="FONT_FILE_MISSING",
                target=token_id,
                message=f"A fonte «{family}» foi confirmada, mas o arquivo dela não veio no pacote.",
                resolution="render-fallback",
            )
        )
    try:
        return FontToken(
            family=family,
            weight=weight,
            style=style,
            source=source,
            file_sha256=file_sha256,
            evidence=_confirmed_evidence(candidate, created_at, Path(draft.package_dir)),
        )
    except ValidationError as exc:
        raise CompileError(f"A fonte confirmada para {token_id} é inválida.") from exc


def _compile_logo(draft: BrandDraft, value: Any, created_at: datetime) -> LogoAsset:
    """Compila o logo primário com path portátil, formato e hash do arquivo real."""
    relative = _portable_relative_path(value)
    candidate = _match_logo(_question(draft, "logo.primary"), relative)
    if candidate is None:
        raise CompileError("O logo confirmado precisa ser uma das opções válidas do rascunho.")
    suffix = Path(relative).suffix.casefold().removeprefix(".")
    if suffix not in {"svg", "png"}:
        raise CompileError("O logo confirmado deve estar em formato SVG ou PNG.")
    logo_path = _package_file(Path(draft.package_dir), relative)
    if suffix == "svg":
        try:
            if svg_external_style_missing(logo_path):
                raise CompileError(
                    "O logo confirmado depende de estilos externos; use um SVG autocontido."
                )
        except SvgInvalid as exc:
            raise CompileError("O logo confirmado não é um SVG válido e autocontido.") from exc
    return LogoAsset(
        path=relative,
        sha256=_sha256(logo_path),
        format=suffix,
        evidence=_confirmed_evidence(candidate, created_at, Path(draft.package_dir)),
    )


def _revision_id(ir: BrandIR) -> str:
    """Deriva o id do conteúdo, neutralizando metadados temporais da revisão."""
    identity = ir.model_copy(deep=True)
    identity.revision = RevisionInfo(id="", created_at=_IDENTITY_EPOCH)
    evidence_groups = [
        *(token.evidence for token in identity.colors.values()),
        *(token.evidence for token in identity.fonts.values()),
        *(asset.evidence for asset in identity.assets.values()),
    ]
    for evidence in evidence_groups:
        for item in evidence:
            if item.confirmed_at is not None:
                item.confirmed_at = _IDENTITY_EPOCH
    payload = identity.model_dump_json(by_alias=True).encode("utf-8")
    return f"brandrev_{hashlib.sha256(payload).hexdigest()[:12]}"


def compile_ir(
    draft: BrandDraft,
    answers: Answers,
    brand_name: str,
    created_at: datetime | None = None,
) -> BrandIR:
    """Transforma um draft confirmado em uma revisão determinística do Brand IR."""
    missing = [answer_id for answer_id in _REQUIRED_ANSWERS if answer_id not in answers.values]
    if missing:
        raise CompileError("Responda às perguntas obrigatórias: " + ", ".join(missing) + ".")

    timestamp = created_at if created_at is not None else datetime.now(timezone.utc)
    diagnostics = [item.model_copy(deep=True) for item in draft.diagnostics]

    colors = {
        token_id: _compile_color(draft, token_id, answers.values[token_id], timestamp)
        for token_id in ("color.primary", "color.background", "color.text")
    }
    if "color.secondary" in answers.values:
        colors["color.secondary"] = _compile_color(
            draft,
            "color.secondary",
            answers.values["color.secondary"],
            timestamp,
        )
    else:
        diagnostics.append(
            Diagnostic(
                code="UNDETERMINED",
                target="color.secondary",
                message="A cor secundária da marca não foi determinada.",
            )
        )

    fonts = {
        token_id: _compile_font(
            draft,
            token_id,
            answers.values[token_id],
            timestamp,
            diagnostics,
        )
        for token_id in ("font.heading", "font.body")
    }
    roles = {
        "heading": SemanticRole(
            font="font.heading",
            color="color.primary",
            min_size_px=40,
            max_size_px=96,
            line_height=1.1,
        ),
        "body": SemanticRole(
            font="font.body",
            color="color.text",
            min_size_px=16,
            max_size_px=24,
            line_height=1.5,
        ),
        "caption": SemanticRole(
            font="font.body",
            color="color.text",
            min_size_px=12,
            max_size_px=16,
            line_height=1.4,
        ),
    }

    ir = BrandIR(
        brand=BrandInfo(name=brand_name),
        revision=RevisionInfo(id="", created_at=timestamp),
        colors=colors,
        fonts=fonts,
        roles=roles,
        assets={
            "logo.primary": _compile_logo(
                draft,
                answers.values["logo.primary"],
                timestamp,
            )
        },
        diagnostics=diagnostics,
    )
    return ir.model_copy(
        update={
            "revision": RevisionInfo(
                id=_revision_id(ir),
                created_at=timestamp,
            )
        }
    )
