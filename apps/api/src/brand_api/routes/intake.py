"""Rotas autenticadas de importação, compilação e assets de draft."""

from __future__ import annotations

import hashlib
import shutil
from io import BytesIO
from pathlib import Path
from struct import error as StructError
from typing import Annotated, Any

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
from brand_api.media import asset_response, content_type_for
from brand_api.models import Brand, BrandRevision, Draft
from brand_api.unzip import UnzipError, safe_unpack
from brand_runtime import (
    Answers,
    BrandDraft,
    CompileError,
    build_draft,
    compile_ir,
    generate_kit,
)
from brand_runtime.intake.draft import DraftQuestion
from brand_runtime.intake.dtcg import DtcgError
from brand_runtime.intake.svg_logo import SvgInvalid, sanitize_svg
from brand_runtime.ir.models import Diagnostic
from brand_runtime.kit.generator import KitGenerationError

router = APIRouter(prefix="/v1", dependencies=[Depends(require_token)])


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
        draft = build_draft(package_dir)
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
            answers = Answers.model_validate(body.answers)
            ir = compile_ir(draft, answers, body.brand_name)
        except CompileError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=str(exc),
            ) from exc
        except (ValidationError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="As respostas informadas são inválidas.",
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
