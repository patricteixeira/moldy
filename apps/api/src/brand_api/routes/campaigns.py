"""Campanhas com uma fonte de conteúdo propagada para documentos vinculados."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel
from sqlalchemy import select

from brand_api.auth import require_token
from brand_api.db import new_id
from brand_api.models import BrandRevision, Campaign, CampaignPiece, Document
from brand_api.routes.documents import DocumentBody, _layout_from_revision, _validated_content
from brand_runtime import BrandIR, LayoutSpec, apply_creative_direction, run_static_checks
from brand_runtime.kit.models import Slot

router = APIRouter(prefix="/v1", dependencies=[Depends(require_token)])

CampaignTextSource = Literal["headline", "body", "body-meta", "meta", "all"]
_IMAGE_MISSING_DETAIL = "A imagem da campanha não foi encontrada — envie-a novamente."
_DIRECTION_MISSING_DETAIL = (
    "Esta revisão ainda não tem uma direção criativa confiável. "
    "Revise a leitura da identidade antes de gerar uma campanha."
)


class CampaignFields(BaseModel):
    """Mensagem canônica editada uma vez e reutilizada por todas as peças."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    headline: str = Field(default="", max_length=500)
    body: str = Field(default="", max_length=10_000)
    cta: str = Field(default="", max_length=500)
    date: str = Field(default="", max_length=300)
    image_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def _has_message(self) -> CampaignFields:
        if not any(value.strip() for value in (self.headline, self.body, self.cta, self.date)):
            raise ValueError("A campanha precisa ter ao menos um campo de texto.")
        return self


class CampaignCreateBody(BaseModel):
    """Seleção inicial de formatos para uma campanha persistente."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    brand_revision_id: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=160)
    fields: CampaignFields
    layout_ids: list[str] = Field(min_length=1, max_length=16)

    @model_validator(mode="after")
    def _unique_layouts(self) -> CampaignCreateBody:
        if len(self.layout_ids) != len(set(self.layout_ids)):
            raise ValueError("Cada formato pode ser vinculado apenas uma vez.")
        return self


class CampaignUpdateBody(BaseModel):
    """Atualização integral da fonte compartilhada, nunca de uma peça isolada."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    fields: CampaignFields


def _text_source(slot: Slot) -> CampaignTextSource | None:
    slot_id = slot.id.casefold()
    role = (slot.role or "").casefold()
    if slot.kind != "text":
        return None
    if any(token in slot_id for token in ("headline", "title", "quote")) or role in {
        "heading",
        "display",
        "index",
    }:
        return "headline"
    if any(token in slot_id for token in ("signature", "caption", "label", "meta")) or role in {
        "signature",
        "caption",
        "label",
    }:
        return "meta"
    return "body"


def _bindings_for_layout(layout: LayoutSpec) -> dict[str, dict[str, str]]:
    """Mapeia a semântica do layout para fontes fechadas e persistidas na peça."""
    text_slots = [slot for slot in layout.slots if slot.kind == "text"]
    bindings: dict[str, dict[str, str]] = {}
    has_meta = any(_text_source(slot) == "meta" for slot in text_slots)
    if len(text_slots) == 1:
        bindings[text_slots[0].id] = {"kind": "text", "source": "all"}
    else:
        for slot in text_slots:
            source = _text_source(slot) or "body"
            if source == "body" and not has_meta:
                source = (
                    "body-meta"
                    if any(_text_source(candidate) == "headline" for candidate in text_slots)
                    else "all"
                )
            bindings[slot.id] = {"kind": "text", "source": source}
    for slot in layout.slots:
        if slot.kind == "image":
            bindings[slot.id] = {"kind": "image", "source": "image"}
    return bindings


def _meta_text(fields: CampaignFields) -> str:
    return " · ".join(value.strip() for value in (fields.date, fields.cta) if value.strip())


def _render_source(source: CampaignTextSource, fields: CampaignFields) -> str:
    if source == "headline":
        return fields.headline.strip()
    if source == "body":
        return fields.body.strip()
    if source == "body-meta":
        return "\n\n".join(value for value in (fields.body.strip(), _meta_text(fields)) if value)
    if source == "meta":
        return _meta_text(fields)
    return "\n\n".join(
        value
        for value in (fields.headline.strip(), fields.body.strip(), _meta_text(fields))
        if value
    )


def _content_from_bindings(
    revision_id: str,
    layout: LayoutSpec,
    fields: CampaignFields,
    bindings: dict[str, dict[str, str]],
) -> DocumentBody:
    values: dict[str, Any] = {}
    for slot_id, binding in bindings.items():
        if binding["kind"] == "image":
            if fields.image_sha256 is not None:
                values[slot_id] = {
                    "kind": "image",
                    "path": "campaign-image",
                    "sha256": fields.image_sha256,
                }
            continue
        source = binding["source"]
        if source not in {"headline", "body", "body-meta", "meta", "all"}:
            raise RuntimeError("A campanha persistiu um binding de texto desconhecido.")
        text = _render_source(source, fields)
        if text:
            values[slot_id] = {"kind": "text", "text": text}
    return DocumentBody(
        layout_id=layout.id,
        brand_revision_id=revision_id,
        values=values,
    )


def _checks(ir: BrandIR, layout: LayoutSpec, content, request: Request) -> list[dict]:
    return [
        item.model_dump(mode="json", by_alias=True)
        for item in run_static_checks(
            ir,
            layout,
            content,
            request.app.state.settings.storage_dir,
        )
    ]


def _validate_campaign_image(fields: CampaignFields, request: Request) -> None:
    if fields.image_sha256 is not None and not request.app.state.storage.has(fields.image_sha256):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=_IMAGE_MISSING_DETAIL,
        )


def _validate_campaign_layout(ir: BrandIR, layout: LayoutSpec, fields: CampaignFields) -> None:
    """Impede a materialização de uma peça que já nasce estruturalmente vazia."""
    if ir.creative_direction is None and layout.profile != "doc-a4":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=_DIRECTION_MISSING_DETAIL,
        )
    requires_image = any(slot.kind == "image" and slot.required for slot in layout.slots)
    if requires_image and fields.image_sha256 is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"O modelo «{layout.name_pt}» precisa de uma imagem. "
                "Envie uma foto ou escolha um modelo sem imagem."
            ),
        )


def _campaign_response(session, campaign: Campaign) -> dict[str, Any]:
    pieces = list(
        session.scalars(
            select(CampaignPiece)
            .where(CampaignPiece.campaign_id == campaign.id)
            .order_by(CampaignPiece.created_at, CampaignPiece.id)
        )
    )
    serialized_pieces = []
    for piece in pieces:
        document = session.get(Document, piece.document_id)
        if document is None:  # pragma: no cover - garantido pela FK
            raise RuntimeError("A peça da campanha perdeu seu documento.")
        serialized_pieces.append(
            {
                "id": piece.id,
                "documentId": piece.document_id,
                "layoutId": piece.layout_id,
                "bindings": piece.bindings,
                "content": document.content,
                "checks": document.checks,
            }
        )
    return {
        "id": campaign.id,
        "brandRevisionId": campaign.brand_revision_id,
        "name": campaign.name,
        "fields": campaign.fields,
        "createdAt": campaign.created_at.isoformat(),
        "updatedAt": campaign.updated_at.isoformat(),
        "pieces": serialized_pieces,
    }


@router.get("/brand-revisions/{revision_id}/campaigns")
def list_campaigns(revision_id: str, request: Request) -> list[dict[str, Any]]:
    """Lista campanhas reutilizáveis da revisão mais recente primeiro."""
    with request.app.state.session_factory() as session:
        if session.get(BrandRevision, revision_id) is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Revisão de marca não encontrada.",
            )
        campaigns = list(
            session.scalars(
                select(Campaign)
                .where(Campaign.brand_revision_id == revision_id)
                .order_by(Campaign.updated_at.desc(), Campaign.id)
            )
        )
        return [_campaign_response(session, campaign) for campaign in campaigns]


@router.get("/campaigns/{campaign_id}")
def get_campaign(campaign_id: str, request: Request) -> dict[str, Any]:
    """Retorna a fonte e os documentos ligados à campanha."""
    with request.app.state.session_factory() as session:
        campaign = session.get(Campaign, campaign_id)
        if campaign is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Campanha não encontrada.",
            )
        return _campaign_response(session, campaign)


@router.post("/campaigns", status_code=status.HTTP_201_CREATED)
def create_campaign(body: CampaignCreateBody, request: Request) -> dict[str, Any]:
    """Cria todos os documentos vinculados em uma única transação."""
    _validate_campaign_image(body.fields, request)
    with request.app.state.session_factory() as session:
        revision = session.get(BrandRevision, body.brand_revision_id)
        if revision is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Revisão de marca não encontrada.",
            )
        ir = BrandIR.model_validate(revision.ir)
        campaign = Campaign(
            id=new_id("campaign"),
            brand_revision_id=revision.id,
            name=body.name.strip(),
            fields=body.fields.model_dump(mode="json", by_alias=True),
        )
        session.add(campaign)
        session.flush()
        for layout_id in body.layout_ids:
            layout = _layout_from_revision(revision, layout_id)
            _validate_campaign_layout(ir, layout, body.fields)
            bindings = _bindings_for_layout(layout)
            content = apply_creative_direction(
                ir,
                layout,
                _validated_content(
                    _content_from_bindings(revision.id, layout, body.fields, bindings),
                    request,
                ),
            )
            serialized_checks = _checks(ir, layout, content, request)
            document = Document(
                id=new_id("doc"),
                brand_revision_id=revision.id,
                layout_id=layout.id,
                content=content.model_dump(mode="json", by_alias=True),
                checks=serialized_checks,
            )
            session.add(document)
            session.flush()
            session.add(
                CampaignPiece(
                    id=new_id("piece"),
                    campaign_id=campaign.id,
                    document_id=document.id,
                    layout_id=layout.id,
                    bindings=bindings,
                )
            )
        session.commit()
        return _campaign_response(session, campaign)


@router.patch("/campaigns/{campaign_id}")
def update_campaign(
    campaign_id: str,
    body: CampaignUpdateBody,
    request: Request,
) -> dict[str, Any]:
    """Propaga a nova mensagem para todas as peças sem trocar seus documentos."""
    _validate_campaign_image(body.fields, request)
    with request.app.state.session_factory() as session:
        campaign = session.get(Campaign, campaign_id)
        if campaign is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Campanha não encontrada.",
            )
        revision = session.get(BrandRevision, campaign.brand_revision_id)
        if revision is None:  # pragma: no cover - garantido pela FK
            raise RuntimeError("A campanha perdeu sua revisão de marca.")
        ir = BrandIR.model_validate(revision.ir)
        pieces = list(
            session.scalars(select(CampaignPiece).where(CampaignPiece.campaign_id == campaign.id))
        )
        for piece in pieces:
            layout = _layout_from_revision(revision, piece.layout_id)
            _validate_campaign_layout(ir, layout, body.fields)
            bindings = dict(piece.bindings)
            content = apply_creative_direction(
                ir,
                layout,
                _validated_content(
                    _content_from_bindings(revision.id, layout, body.fields, bindings),
                    request,
                ),
            )
            document = session.get(Document, piece.document_id)
            if document is None:  # pragma: no cover - garantido pela FK
                raise RuntimeError("A peça da campanha perdeu seu documento.")
            document.content = content.model_dump(mode="json", by_alias=True)
            document.checks = _checks(ir, layout, content, request)
        campaign.name = body.name.strip()
        campaign.fields = body.fields.model_dump(mode="json", by_alias=True)
        campaign.updated_at = datetime.now(UTC)
        session.commit()
        return _campaign_response(session, campaign)
