"""Rotas autenticadas de importação, compilação e assets de draft."""

from __future__ import annotations

import hashlib
import logging
import shutil
from io import BytesIO
from pathlib import Path
from struct import error as StructError
from typing import Annotated, Any, Literal

import pymupdf
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fontTools.ttLib import TTFont, TTLibError
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from pydantic.alias_generators import to_camel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from brand_api.auth import require_token
from brand_api.db import new_id
from brand_api.fonts import (
    MAX_FONT_RESOLUTION_CANDIDATES,
    MAX_RESOLVED_FONTS,
    preferred_font_request,
    reconcile_resolved_font_diagnostics,
    resolve_draft_fonts,
    resolve_font_candidate,
)
from brand_api.fonts.catalog import normalize_family
from brand_api.fonts.intake import FontCandidateResolution
from brand_api.media import asset_response, content_type_for
from brand_api.models import Brand, BrandRevision, Draft
from brand_api.unzip import UnzipError, safe_unpack
from brand_runtime import (
    Answers,
    BrandDraft,
    CompileError,
    PackageValidationError,
    build_draft,
    compile_ir,
    generate_kit,
    validate_brand_package,
)
from brand_runtime.ecosystem import MANIFEST_FILENAME
from brand_runtime.intake.draft import DraftQuestion
from brand_runtime.intake.base import Candidate
from brand_runtime.intake.dtcg import DtcgError
from brand_runtime.intake.svg_logo import SvgInvalid, sanitize_svg
from brand_runtime.ir.models import Diagnostic, Evidence
from brand_runtime.kit.generator import KitGenerationError

router = APIRouter(prefix="/v1", dependencies=[Depends(require_token)])
logger = logging.getLogger(__name__)


class InvalidBrandMedia(Exception):
    """Indica mídia de marca estruturalmente inválida, sem expor o parser."""


class CompileBody(BaseModel):
    """Confirmações do wizard e nome exato da marca a compilar."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    answers: dict[str, Any]
    brand_name: str = Field(min_length=1, pattern=r".*\S.*")


class ImportResponse(BaseModel):
    """Draft extraído e lacunas que precisam de ação antes do wizard."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    draft_id: str
    questions: list[DraftQuestion]
    diagnostics: list[Diagnostic]
    ignored_entries: list[str]


class ResolveFontBody(BaseModel):
    """Nome tipográfico explícito informado durante uma pergunta do wizard."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    question_id: Literal["font.heading", "font.body"]
    family: str = Field(min_length=1, max_length=128, pattern=r".*\S.*")


class ResolveFontResponse(BaseModel):
    """Candidato persistido e capacidade real encontrada para a prévia."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    candidate: Candidate
    status: FontCandidateResolution


def _manifest_file(package_dir: Path, relative: str) -> Path:
    """Converte um path já validado pelo unpacker em path local contido."""
    return package_dir.joinpath(*relative.split("/"))


def _sanitize_svgs(package_dir: Path, manifest: dict[str, str]) -> None:
    """Substitui todo SVG por bytes sanitizados e atualiza seu hash."""
    for relative in sorted(manifest):
        if Path(relative).suffix.casefold() != ".svg":
            continue
        path = _manifest_file(package_dir, relative)
        sanitized = sanitize_svg(path.read_bytes())
        path.write_bytes(sanitized)
        manifest[relative] = hashlib.sha256(sanitized).hexdigest()


def _store_manifest(request: Request, package_dir: Path, manifest: dict[str, str]) -> None:
    """Publica cada arquivo sanitizado no storage e reafirma seu hash real."""
    for relative in sorted(manifest):
        path = _manifest_file(package_dir, relative)
        manifest[relative] = request.app.state.storage.put(path.read_bytes())


def _store_new_manifest_entries(
    request: Request,
    package_dir: Path,
    manifest: dict[str, str],
    previous_manifest: dict[str, str],
) -> None:
    """Publica somente novos blobs hash-derived sem reler o pacote original."""
    if any(manifest.get(relative) != sha256 for relative, sha256 in previous_manifest.items()):
        raise RuntimeError("A resolução tipográfica tentou alterar o manifest existente.")
    for relative in sorted(set(manifest).difference(previous_manifest)):
        path = _manifest_file(package_dir, relative)
        stored_sha256 = request.app.state.storage.put(path.read_bytes())
        if stored_sha256 != manifest[relative]:
            raise RuntimeError("Um novo recurso tipográfico perdeu integridade no storage.")


def _files_with_suffixes(directory: Path, suffixes: set[str]) -> list[Path]:
    """Enumera arquivos por extensão com a mesma semântica em Linux e Windows."""
    if not directory.is_dir():
        return []
    return sorted(
        (
            path
            for path in directory.iterdir()
            if path.is_file() and path.suffix.casefold() in suffixes
        ),
        key=lambda path: (path.name.casefold(), path.name),
    )


def _validate_media_files(package_dir: Path, *, max_image_pixels: int) -> None:
    """Valida mídia hostil em memória antes de o motor abrir paths no Windows."""
    try:
        pdfs = [
            *_files_with_suffixes(package_dir, {".pdf"}),
            *_files_with_suffixes(package_dir / "references", {".pdf"}),
        ]
        for path in pdfs:
            with pymupdf.open(stream=path.read_bytes(), filetype="pdf") as document:
                if document.needs_pass:
                    raise pymupdf.FileDataError("PDF protegido por senha")

        for path in _files_with_suffixes(package_dir / "assets" / "logos", {".png"}):
            with Image.open(BytesIO(path.read_bytes())) as image:
                if image.width * image.height > max_image_pixels:
                    raise ValueError("Imagem acima do limite de pixels")
                image.verify()

        fonts_dir = package_dir / "fonts"
        for path in _files_with_suffixes(fonts_dir, {".otf", ".ttf"}):
            with TTFont(BytesIO(path.read_bytes()), lazy=False) as font:
                # O intake depende destas tabelas; acessá-las aqui transforma
                # ausência estrutural em erro de entrada antes do build.
                font["name"]
                font["OS/2"]
    except (
        AssertionError,
        EOFError,
        Image.DecompressionBombError,
        KeyError,
        OSError,
        StructError,
        SyntaxError,
        TTLibError,
        UnidentifiedImageError,
        ValueError,
        pymupdf.FileDataError,
    ) as exc:
        raise InvalidBrandMedia from exc


def _upsert_brand(session: Session, name: str) -> Brand:
    """Insere uma marca por nome sem corrida e devolve a linha vencedora."""
    statement = (
        insert(Brand)
        .values(id=new_id("brand"), name=name)
        .on_conflict_do_nothing(index_elements=[Brand.name])
    )
    session.execute(statement)
    return session.execute(select(Brand).where(Brand.name == name)).scalar_one()


def _insert_revision_once(
    session: Session,
    *,
    revision_id: str,
    brand_id: str,
    ir: dict[str, Any],
    kit: list[dict[str, Any]],
    manifest: dict[str, str],
    package_path: str,
) -> None:
    """Persiste uma revisão write-once, ignorando concorrente com o mesmo id."""
    statement = (
        insert(BrandRevision)
        .values(
            id=revision_id,
            brand_id=brand_id,
            ir=ir,
            kit=kit,
            manifest=manifest,
            package_path=package_path,
        )
        .on_conflict_do_nothing(index_elements=[BrandRevision.id])
    )
    session.execute(statement)


@router.post(
    "/brands/imports",
    status_code=status.HTTP_201_CREATED,
    response_model=ImportResponse,
)
async def import_brand(
    request: Request,
    package: Annotated[UploadFile, File()],
) -> ImportResponse:
    """Converte um pacote ZIP hostil em draft sanitizado e persistido."""
    limit = request.app.state.settings.max_upload_bytes
    try:
        uploaded = await package.read(limit + 1)
    finally:
        await package.close()
    if len(uploaded) > limit:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="O arquivo enviado excede o tamanho máximo permitido.",
        )

    draft_id = new_id("draft")
    package_dir = request.app.state.settings.packages_dir / draft_id
    try:
        unpacked = safe_unpack(uploaded, package_dir)
    except UnzipError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    manifest = dict(unpacked.manifest)
    if MANIFEST_FILENAME in manifest:
        try:
            if unpacked.ignored:
                raise PackageValidationError(
                    "FILE_UNSUPPORTED",
                    "O Brand Package declarado contém arquivo não suportado.",
                    path=unpacked.ignored[0],
                )
            validate_brand_package(package_dir)
        except PackageValidationError as exc:
            shutil.rmtree(package_dir, ignore_errors=True)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    try:
        _sanitize_svgs(package_dir, manifest)
    except (SvgInvalid, OSError) as exc:
        shutil.rmtree(package_dir, ignore_errors=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O pacote contém um SVG inválido.",
        ) from exc

    try:
        # O pacote inteiro precisa ser interpretável antes de qualquer publicação
        # no storage. Assim, entrada hostil não produz blobs órfãos.
        _validate_media_files(
            package_dir,
            max_image_pixels=request.app.state.settings.max_image_pixels,
        )
        draft = build_draft(
            package_dir,
            translator=request.app.state.identity_translator,
        )
        await resolve_draft_fonts(
            draft,
            package_dir,
            manifest,
            request.app.state.font_resolver,
        )
        _store_manifest(request, package_dir, manifest)
        serialized = draft.model_dump(mode="json", by_alias=True)
        with request.app.state.session_factory() as session:
            session.add(
                Draft(
                    id=draft_id,
                    draft=serialized,
                    manifest=manifest,
                    ignored=list(unpacked.ignored),
                    package_path=str(package_dir),
                )
            )
            session.commit()
    except (
        DtcgError,
        InvalidBrandMedia,
        Image.DecompressionBombError,
        KeyError,
        TTLibError,
        UnidentifiedImageError,
        ValueError,
        pymupdf.FileDataError,
    ) as exc:
        shutil.rmtree(package_dir, ignore_errors=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O pacote contém um arquivo de marca inválido.",
        ) from exc
    except Exception:
        # O draft só existe se pacote, storage e banco concluírem. Blobs CAS já
        # publicados são imutáveis e podem ser reaproveitados ou coletados depois.
        shutil.rmtree(package_dir, ignore_errors=True)
        raise

    return ImportResponse(
        draft_id=draft_id,
        questions=draft.questions,
        diagnostics=draft.diagnostics,
        ignored_entries=list(unpacked.ignored),
    )


def _manual_font_candidate(draft: BrandDraft, body: ResolveFontBody) -> Candidate:
    """Reutiliza a família detectada ou cria uma escolha explícita para o papel."""
    normalized = normalize_family(body.family)
    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Informe um nome de fonte válido.",
        )
    question = next((item for item in draft.questions if item.id == body.question_id), None)
    if question is None or question.kind != "pick-font":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A pergunta de fonte não existe neste rascunho.",
        )

    candidate = next(
        (
            item
            for item in question.candidates
            if isinstance(item.value, dict)
            and isinstance(item.value.get("family"), str)
            and normalize_family(item.value["family"]) == normalized
        ),
        None,
    )
    if candidate is None:
        manual_candidates = sum(
            1
            for item_question in draft.questions
            if item_question.kind == "pick-font"
            for item in item_question.candidates
            if any(evidence.source_type == "manual-entry" for evidence in item.evidence)
        )
        if manual_candidates >= MAX_FONT_RESOLUTION_CANDIDATES:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Este rascunho atingiu o limite de escolhas tipográficas manuais. "
                    "Troque os materiais para continuar."
                ),
            )
    evidence = Evidence(
        source_type="manual-entry",
        detail=f"família informada no wizard para {body.question_id}",
        confidence=1.0,
    )
    if candidate is None:
        preferred = preferred_font_request(
            body.family,
            700 if body.question_id == "font.heading" else 400,
        )
        candidate = Candidate(
            value={
                "family": preferred.family,
                "weight": preferred.weight,
                "style": preferred.style,
            },
            score=1.0,
            evidence=[evidence],
        )
    elif not any(
        item.source_type == "manual-entry" and item.detail == evidence.detail
        for item in candidate.evidence
    ):
        candidate.evidence.append(evidence)

    question.candidates = [
        candidate,
        *(item for item in question.candidates if item is not candidate),
    ]
    return candidate


def _draft_package_dir(request: Request, row: Draft) -> Path:
    """Revalida o diretório persistido antes de materializar um novo recurso."""
    try:
        base = request.app.state.settings.packages_dir.resolve(strict=True)
        package_dir = Path(row.package_path).resolve(strict=True)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Os materiais deste rascunho não estão mais disponíveis.",
        ) from exc
    if not package_dir.is_dir() or not package_dir.is_relative_to(base):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="O diretório persistido do rascunho é inválido.",
        )
    return package_dir


def _resolved_font_count(draft: BrandDraft) -> int:
    """Conta somente arquivos adquiridos pelo sistema, sem duplicar papéis."""
    return len(
        {
            candidate.value["path"]
            for question in draft.questions
            if question.kind == "pick-font"
            for candidate in question.candidates
            if isinstance(candidate.value, dict)
            and isinstance(candidate.value.get("path"), str)
            and candidate.value["path"].startswith("resolved-fonts/")
        }
    )


@router.post(
    "/drafts/{draft_id}/fonts/resolve",
    response_model=ResolveFontResponse,
)
async def resolve_draft_font(
    draft_id: str,
    body: ResolveFontBody,
    request: Request,
) -> ResolveFontResponse:
    """Registra um nome digitado e tenta resolvê-lo sem novo upload."""
    with request.app.state.session_factory() as session:
        row = session.execute(
            select(Draft).where(Draft.id == draft_id).with_for_update()
        ).scalar_one_or_none()
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Rascunho não encontrado.",
            )
        try:
            draft = BrandDraft.model_validate(row.draft)
        except ValidationError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="O rascunho persistido não pode mais ser editado.",
            ) from exc
        package_dir = _draft_package_dir(request, row)
        previous_manifest = dict(row.manifest)
        manifest = dict(previous_manifest)
        candidate = _manual_font_candidate(draft, body)
        resolution = await resolve_font_candidate(
            candidate,
            package_dir,
            manifest,
            request.app.state.font_resolver,
            allow_local_materialization=_resolved_font_count(draft) < MAX_RESOLVED_FONTS,
        )
        if resolution == "local-ready":
            _store_new_manifest_entries(
                request,
                package_dir,
                manifest,
                previous_manifest,
            )
            reconcile_resolved_font_diagnostics(draft)
        row.draft = draft.model_dump(mode="json", by_alias=True)
        row.manifest = manifest
        session.commit()
    return ResolveFontResponse(candidate=candidate, status=resolution)


@router.post("/drafts/{draft_id}/compile", status_code=status.HTTP_201_CREATED)
def compile_draft(draft_id: str, body: CompileBody, request: Request) -> dict[str, str]:
    """Compila confirmações em revisão e kit imutáveis e idempotentes."""
    with request.app.state.session_factory() as session:
        row = session.get(Draft, draft_id)
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Rascunho não encontrado.",
            )
        try:
            draft = BrandDraft.model_validate(row.draft)
        except ValidationError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="O rascunho salvo não pode mais ser publicado. Importe os materiais novamente.",
            ) from exc
        try:
            answers = Answers.model_validate(body.answers)
        except ValidationError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    "As escolhas salvas não puderam ser lidas. "
                    "Volte uma etapa e confirme a última resposta novamente."
                ),
            ) from exc
        try:
            ir = compile_ir(draft, answers, body.brand_name)
        except CompileError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=str(exc),
            ) from exc
        except (ValidationError, ValueError) as exc:
            logger.exception("Falha interna ao compilar o rascunho %s", draft_id)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=(
                    "O Molda encontrou uma inconsistência interna ao publicar. "
                    "Suas escolhas continuam salvas; tente novamente."
                ),
            ) from exc

        brand = _upsert_brand(session, body.brand_name)

        revision = session.get(BrandRevision, ir.revision.id)
        if revision is None:
            try:
                kit = generate_kit(ir)
            except KitGenerationError as exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=str(exc),
                ) from exc
            _insert_revision_once(
                session,
                revision_id=ir.revision.id,
                brand_id=brand.id,
                ir=ir.model_dump(mode="json", by_alias=True),
                kit=[item.model_dump(mode="json", by_alias=True) for item in kit],
                manifest=dict(row.manifest),
                package_path=row.package_path,
            )
        session.commit()
    return {"brandRevisionId": ir.revision.id}


@router.get("/drafts/{draft_id}/assets/{path:path}")
def get_draft_asset(draft_id: str, path: str, request: Request):
    """Serve um asset sanitizado por lookup exato no manifest do draft."""
    with request.app.state.session_factory() as session:
        draft = session.get(Draft, draft_id)
        if draft is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Rascunho não encontrado.",
            )
        sha256 = draft.manifest.get(path)
    if sha256 is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset não encontrado.")
    try:
        data = request.app.state.storage.get(sha256)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset não encontrado.",
        ) from exc
    return asset_response(data, content_type_for(path))
