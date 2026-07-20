"""Carrosséis editoriais com quantidade, papéis e assinatura explícitos."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel
from sqlalchemy import select

from brand_api.auth import require_token
from brand_api.db import new_id
from brand_api.layout_catalog import resolve_layout
from brand_api.models import BrandRevision, Carousel, CarouselSlide, Document, Job
from brand_api.routes.documents import DocumentBody, _validated_content
from brand_runtime import BrandIR, generate_carousel_layouts, run_static_checks, suggested_surface
from brand_runtime.kit.models import LayerOverride, LayoutSpec

router = APIRouter(prefix="/v1", dependencies=[Depends(require_token)])

CarouselProfile = Literal["post-1x1", "post-4x5"]
VerticalPosition = Literal["top", "bottom"]
HorizontalPosition = Literal["left", "center", "right"]
SlideRole = Literal["cover", "content", "closing"]


class CarouselSignature(BaseModel):
    """Assinatura repetida em posição consistente ao longo da sequência."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    text: str = Field(default="", max_length=80)
    vertical: VerticalPosition = "bottom"
    horizontal: HorizontalPosition = "left"


class CarouselSlideInput(BaseModel):
    """Conteúdo autoral de um slide; o servidor determina seu papel pela posição."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    kicker: str = Field(default="", max_length=80)
    headline: str = Field(min_length=1, max_length=180)
    text_blocks: list[str] = Field(default_factory=list, max_length=6)
    cta: str = Field(default="", max_length=240)
    background_color_token: str | None = Field(default=None, min_length=1)
    logo_asset_token: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _non_blank_content(self) -> CarouselSlideInput:
        if not self.headline.strip():
            raise ValueError("Todo slide precisa de um título ou mensagem principal.")
        if any(not block.strip() for block in self.text_blocks):
            raise ValueError("Blocos de texto vazios devem ser removidos.")
        if any(len(block) > 520 for block in self.text_blocks):
            raise ValueError("Cada bloco de texto pode ter no máximo 520 caracteres.")
        return self


class CarouselCreateBody(BaseModel):
    """Contrato integral de uma sequência social."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    brand_revision_id: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=160)
    profile: CarouselProfile = "post-4x5"
    signature: CarouselSignature = Field(default_factory=CarouselSignature)
    slides: list[CarouselSlideInput] = Field(min_length=3, max_length=20)


class CarouselExportBody(BaseModel):
    """Carrosséis são publicados como uma série de PNGs em ZIP."""

    model_config = ConfigDict(extra="forbid")

    format: Literal["png"] = "png"


def _slide_role(position: int, total: int) -> SlideRole:
    if position == 1:
        return "cover"
    if position == total:
        return "closing"
    return "content"


def _layout_for_position(
    layouts: dict[str, LayoutSpec],
    profile: CarouselProfile,
    position: int,
    total: int,
) -> LayoutSpec:
    role = _slide_role(position, total)
    if role == "content":
        variant = "a" if position % 2 == 0 else "b"
        return layouts[f"carousel-content-{variant}-{profile}"]
    return layouts[f"carousel-{role}-{profile}"]


def _signature_override(
    layout: LayoutSpec,
    signature: CarouselSignature,
) -> LayerOverride:
    width = 420
    x = {
        "left": 80,
        "center": round((layout.canvas.width_px - width) / 2),
        "right": layout.canvas.width_px - 80 - width,
    }[signature.horizontal]
    y = 80 if signature.vertical == "top" else layout.canvas.height_px - 112
    return LayerOverride(
        area=(x, y, width, 32),
        text_align=signature.horizontal,
    )


def _content_overrides(
    ir: BrandIR,
    layout: LayoutSpec,
    slide: CarouselSlideInput,
    signature: CarouselSignature,
) -> dict[str, LayerOverride]:
    overrides: dict[str, LayerOverride] = {
        "signature": _signature_override(layout, signature),
    }
    logo = next((slot for slot in layout.slots if slot.id == "logo"), None)
    if (
        logo is not None
        and signature.vertical == "bottom"
        and signature.horizontal == "right"
        and layout.id.find("closing") < 0
    ):
        overrides["logo"] = LayerOverride(
            area=(
                layout.canvas.width_px - 80 - logo.area[2],
                80,
                logo.area[2],
                logo.area[3],
            )
        )

    body_slots = [slot for slot in layout.slots if slot.id.startswith("body-")]
    if not body_slots or not slide.text_blocks:
        return overrides
    first = body_slots[0]
    headline = next(slot for slot in layout.slots if slot.id == "headline")
    top = max(first.area[1], headline.area[1] + headline.area[3] + 38)
    bottom = layout.canvas.height_px - 168
    gap = 18
    count = len(slide.text_blocks)
    block_height = max(46, round((bottom - top - gap * (count - 1)) / count))
    role = ir.roles.get("body")
    font_size = None
    if role is not None and count >= 4:
        font_size = max(role.min_size_px, round(role.max_size_px * (0.66 if count >= 6 else 0.78)))
    for index in range(count):
        overrides[f"body-{index + 1}"] = LayerOverride(
            area=(first.area[0], top + index * (block_height + gap), first.area[2], block_height),
            font_size_px=font_size,
        )
    return overrides


def _document_body(
    revision_id: str,
    ir: BrandIR,
    layout: LayoutSpec,
    slide: CarouselSlideInput,
    signature: CarouselSignature,
    position: int,
    total: int,
) -> DocumentBody:
    values: dict[str, Any] = {
        "index": {"kind": "text", "text": f"{position:02d} / {total:02d}"},
        "headline": {"kind": "text", "text": slide.headline.strip()},
    }
    if signature.text.strip():
        values["signature"] = {"kind": "text", "text": signature.text.strip()}
    if slide.kicker.strip() and any(slot.id == "kicker" for slot in layout.slots):
        values["kicker"] = {"kind": "text", "text": slide.kicker.strip()}

    role = _slide_role(position, total)
    if role == "cover" and slide.text_blocks:
        values["deck"] = {"kind": "text", "text": slide.text_blocks[0].strip()}
    elif role == "content":
        for index, block in enumerate(slide.text_blocks, start=1):
            values[f"body-{index}"] = {"kind": "text", "text": block.strip()}
    elif role == "closing" and slide.cta.strip():
        values["cta"] = {"kind": "text", "text": slide.cta.strip()}

    return DocumentBody(
        layout_id=layout.id,
        brand_revision_id=revision_id,
        values=values,
        background_color_token=slide.background_color_token,
        asset_bindings={"logo": slide.logo_asset_token} if slide.logo_asset_token else {},
        overrides=_content_overrides(ir, layout, slide, signature),
        surface=suggested_surface(ir),
    )


def _carousel_response(session, carousel: Carousel) -> dict[str, Any]:
    revision = session.get(BrandRevision, carousel.brand_revision_id)
    if revision is None:  # pragma: no cover - garantido pela FK
        raise RuntimeError("O carrossel perdeu sua revisão de marca.")
    slides = list(
        session.scalars(
            select(CarouselSlide)
            .where(CarouselSlide.carousel_id == carousel.id)
            .order_by(CarouselSlide.position)
        )
    )
    serialized = []
    for slide in slides:
        document = session.get(Document, slide.document_id)
        if document is None:  # pragma: no cover - garantido pela FK
            raise RuntimeError("O slide perdeu seu documento.")
        layout = resolve_layout(revision, document.layout_id)
        if layout is None:  # pragma: no cover - documento criado pelo próprio endpoint
            raise RuntimeError("O slide perdeu seu layout interno.")
        serialized.append(
            {
                "id": slide.id,
                "documentId": document.id,
                "position": slide.position,
                "role": slide.role,
                "source": slide.source,
                "layoutId": document.layout_id,
                "layout": layout.model_dump(mode="json", by_alias=True),
                "content": document.content,
                "checks": document.checks,
            }
        )
    return {
        "id": carousel.id,
        "brandRevisionId": carousel.brand_revision_id,
        "name": carousel.name,
        "profile": carousel.profile,
        "signature": carousel.signature,
        "createdAt": carousel.created_at.isoformat(),
        "slides": serialized,
    }


@router.get("/brand-revisions/{revision_id}/carousels")
def list_carousels(revision_id: str, request: Request) -> list[dict[str, Any]]:
    """Lista sequências já geradas para uma revisão."""
    with request.app.state.session_factory() as session:
        if session.get(BrandRevision, revision_id) is None:
            raise HTTPException(status_code=404, detail="Revisão de marca não encontrada.")
        carousels = list(
            session.scalars(
                select(Carousel)
                .where(Carousel.brand_revision_id == revision_id)
                .order_by(Carousel.created_at.desc(), Carousel.id)
            )
        )
        return [_carousel_response(session, carousel) for carousel in carousels]


@router.get("/carousels/{carousel_id}")
def get_carousel(carousel_id: str, request: Request) -> dict[str, Any]:
    """Recupera uma sequência com todos os documentos na ordem editorial."""
    with request.app.state.session_factory() as session:
        carousel = session.get(Carousel, carousel_id)
        if carousel is None:
            raise HTTPException(status_code=404, detail="Carrossel não encontrado.")
        return _carousel_response(session, carousel)


@router.post("/carousels", status_code=status.HTTP_201_CREATED)
def create_carousel(body: CarouselCreateBody, request: Request) -> dict[str, Any]:
    """Materializa capa, miolo e fechamento em uma única transação."""
    with request.app.state.session_factory() as session:
        revision = session.get(BrandRevision, body.brand_revision_id)
        if revision is None:
            raise HTTPException(status_code=404, detail="Revisão de marca não encontrada.")
        ir = BrandIR.model_validate(revision.ir)
        generated = generate_carousel_layouts(ir, body.profile)
        layouts = {layout.id: layout for layout in generated}
        carousel = Carousel(
            id=new_id("carousel"),
            brand_revision_id=revision.id,
            name=body.name.strip(),
            profile=body.profile,
            signature=body.signature.model_dump(mode="json", by_alias=True),
        )
        session.add(carousel)
        session.flush()
        total = len(body.slides)
        for position, source in enumerate(body.slides, start=1):
            layout = _layout_for_position(layouts, body.profile, position, total)
            content = _validated_content(
                _document_body(
                    revision.id,
                    ir,
                    layout,
                    source,
                    body.signature,
                    position,
                    total,
                ),
                request,
            )
            checks = run_static_checks(
                ir,
                layout,
                content,
                request.app.state.settings.storage_dir,
            )
            serialized_checks = [item.model_dump(mode="json", by_alias=True) for item in checks]
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
                CarouselSlide(
                    id=new_id("slide"),
                    carousel_id=carousel.id,
                    document_id=document.id,
                    position=position,
                    role=_slide_role(position, total),
                    source=source.model_dump(mode="json", by_alias=True),
                )
            )
        session.commit()
        session.refresh(carousel)
        return _carousel_response(session, carousel)


@router.post(
    "/carousels/{carousel_id}/exports",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=None,
)
def enqueue_carousel_export(
    carousel_id: str,
    body: CarouselExportBody,
    request: Request,
) -> Any:
    """Enfileira um ZIP ordenado quando nenhum slide está bloqueado."""
    with request.app.state.session_factory() as session:
        carousel = session.get(Carousel, carousel_id)
        if carousel is None:
            raise HTTPException(status_code=404, detail="Carrossel não encontrado.")
        revision = session.get(BrandRevision, carousel.brand_revision_id)
        if revision is None:  # pragma: no cover - garantido pela FK
            raise HTTPException(status_code=404, detail="Revisão de marca não encontrada.")
        ir = BrandIR.model_validate(revision.ir)
        slides = list(
            session.scalars(
                select(CarouselSlide)
                .where(CarouselSlide.carousel_id == carousel.id)
                .order_by(CarouselSlide.position)
            )
        )
        all_checks: list[dict[str, Any]] = []
        for slide in slides:
            document = session.get(Document, slide.document_id)
            if document is None:  # pragma: no cover - garantido pela FK
                raise RuntimeError("O slide perdeu seu documento.")
            layout = resolve_layout(revision, document.layout_id)
            if layout is None:  # pragma: no cover - documento criado pelo próprio endpoint
                raise RuntimeError("O layout do carrossel não pôde ser resolvido.")
            from brand_runtime import ContentSpec

            checks = run_static_checks(
                ir,
                layout,
                ContentSpec.model_validate(document.content),
                request.app.state.settings.storage_dir,
            )
            serialized = [item.model_dump(mode="json", by_alias=True) for item in checks]
            all_checks.extend(serialized)
            document.checks = serialized
        if any(item["status"] == "blocked" for item in all_checks):
            return JSONResponse(
                status_code=status.HTTP_409_CONFLICT,
                content={
                    "detail": "O carrossel tem pendências — corrija antes de exportar.",
                    "checks": all_checks,
                },
            )
        job = Job(
            id=new_id("job"),
            kind="carousel-export",
            document_id=None,
            params={"format": body.format, "carouselId": carousel.id},
            status="queued",
            checks=all_checks,
        )
        session.add(job)
        session.commit()
        return {"jobId": job.id}
