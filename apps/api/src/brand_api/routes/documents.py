"""Criação autenticada de documentos com Brand Guard estático."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from pydantic.alias_generators import to_camel

from brand_api.auth import require_token
from brand_api.db import new_id
from brand_api.layout_catalog import resolve_layout
from brand_api.models import BrandRevision, Document, Job
from brand_api.native_templates import CURRENT_NATIVE_TEMPLATE_VERSION
from brand_runtime import BrandIR, ContentSpec, LayoutSpec, run_static_checks
from brand_runtime.kit.models import ImageValue, ShapeLayer, Slot, SurfaceStyle

router = APIRouter(prefix="/v1", dependencies=[Depends(require_token)])

_IMAGE_MISSING_DETAIL = "Imagem não encontrada — envie antes em /v1/assets."


class DocumentBody(BaseModel):
    """Payload HTTP mínimo convertido no ``ContentSpec`` autoritativo do motor."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    layout_id: str = Field(min_length=1)
    brand_revision_id: str = Field(min_length=1)
    values: dict[str, Any]
    overrides: dict[str, Any] = Field(default_factory=dict)
    surface: SurfaceStyle | None = None
    added_slots: list[Slot] = Field(default_factory=list)
    added_layers: list[ShapeLayer] = Field(default_factory=list)


class ExportBody(BaseModel):
    """Formato fechado aceito ao enfileirar um export."""

    model_config = ConfigDict(extra="forbid")

    format: Literal["png", "pdf", "pptx", "docx"]


def _layout_from_revision(revision: BrandRevision, layout_id: str) -> LayoutSpec:
    """Seleciona e valida um layout persistido sem regenerar o kit."""
    layout = resolve_layout(revision, layout_id)
    if layout is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Layout desconhecido para esta revisão.",
        )
    return layout


def _validated_content(body: DocumentBody, request: Request) -> ContentSpec:
    """Valida o conteúdo, exige blobs e substitui paths fornecidos pelo cliente."""
    try:
        content = ContentSpec.model_validate(body.model_dump(mode="json", by_alias=True))
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Conteúdo inválido.",
        ) from exc

    serialized = content.model_dump(mode="json", by_alias=True)
    for slot_id, value in content.values.items():
        if not isinstance(value, ImageValue):
            continue
        if value.sha256 is None or not request.app.state.storage.has(value.sha256):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=_IMAGE_MISSING_DETAIL,
            )
        serialized["values"][slot_id]["path"] = (
            f"sha256/{value.sha256[:2]}/{value.sha256[2:4]}/{value.sha256}"
        )
    return ContentSpec.model_validate(serialized)


@router.post("/documents", status_code=status.HTTP_201_CREATED)
def create_document(body: DocumentBody, request: Request) -> dict[str, Any]:
    """Persiste conteúdo e checks mesmo quando o Guard encontra bloqueios."""
    with request.app.state.session_factory() as session:
        revision = session.get(BrandRevision, body.brand_revision_id)
        if revision is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Revisão de marca não encontrada.",
            )

        layout = _layout_from_revision(revision, body.layout_id)
        content = _validated_content(body, request)
        ir = BrandIR.model_validate(revision.ir)
        checks = run_static_checks(
            ir,
            layout,
            content,
            request.app.state.settings.storage_dir,
        )
        serialized_checks = [item.model_dump(mode="json", by_alias=True) for item in checks]
        document_id = new_id("doc")
        session.add(
            Document(
                id=document_id,
                brand_revision_id=revision.id,
                layout_id=layout.id,
                content=content.model_dump(mode="json", by_alias=True),
                checks=serialized_checks,
            )
        )
        session.commit()

    return {"documentId": document_id, "checks": serialized_checks}


@router.post(
    "/documents/{document_id}/exports",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=None,
)
def enqueue_export(
    document_id: str,
    body: ExportBody,
    request: Request,
) -> Any:
    """Reexecuta o Guard e enfileira somente documentos autorizados."""
    with request.app.state.session_factory() as session:
        document = session.get(Document, document_id)
        if document is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Documento não encontrado.",
            )
        revision = session.get(BrandRevision, document.brand_revision_id)
        if revision is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Revisão de marca não encontrada.",
            )

        layout = _layout_from_revision(revision, document.layout_id)
        if body.format in {"pdf", "docx"} and layout.profile != "doc-a4":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Exporte {body.format.upper()} apenas para documentos (A4).",
            )
        if body.format == "pptx" and layout.profile == "doc-a4":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Exporte PPTX apenas para layouts sociais.",
            )

        ir = BrandIR.model_validate(revision.ir)
        content = ContentSpec.model_validate(document.content)
        checks = run_static_checks(
            ir,
            layout,
            content,
            request.app.state.settings.storage_dir,
        )
        serialized_checks = [item.model_dump(mode="json", by_alias=True) for item in checks]
        if any(item.status == "blocked" for item in checks):
            return JSONResponse(
                status_code=status.HTTP_409_CONFLICT,
                content={
                    "detail": "O documento tem pendências do guard — corrija antes de exportar.",
                    "checks": serialized_checks,
                },
            )

        job_id = new_id("job")
        params = {"format": body.format}
        if body.format in {"pptx", "docx"}:
            params["nativeTemplateVersion"] = CURRENT_NATIVE_TEMPLATE_VERSION
        session.add(
            Job(
                id=job_id,
                kind="export",
                document_id=document.id,
                params=params,
                status="queued",
                checks=serialized_checks,
            )
        )
        session.commit()
    return {"jobId": job_id}
