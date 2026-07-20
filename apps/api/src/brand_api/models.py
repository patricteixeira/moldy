"""Modelos relacionais do contrato persistente da API."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base declarativa compartilhada pelos contratos persistentes do produto."""


def _created_at() -> Mapped[datetime]:
    """Declara o timestamp operacional padrão gerenciado pelo Postgres."""
    return mapped_column(DateTime(timezone=True), server_default=func.now())


class Brand(Base):
    """Identidade nominal estável de uma marca."""

    __tablename__ = "brands"

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True)
    created_at: Mapped[datetime] = _created_at()


class Draft(Base):
    """Rascunho extraído de um pacote ainda não confirmado."""

    __tablename__ = "drafts"

    id: Mapped[str] = mapped_column(primary_key=True)
    draft: Mapped[dict[str, Any]] = mapped_column(JSONB)
    manifest: Mapped[dict[str, str]] = mapped_column(JSONB)
    ignored: Mapped[list[str]] = mapped_column(JSONB)
    package_path: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()


class BrandRevision(Base):
    """Brand IR e kit imutáveis produzidos por uma confirmação do wizard."""

    __tablename__ = "brand_revisions"

    id: Mapped[str] = mapped_column(primary_key=True)
    brand_id: Mapped[str] = mapped_column(ForeignKey("brands.id"))
    ir: Mapped[dict[str, Any]] = mapped_column(JSONB)
    kit: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    manifest: Mapped[dict[str, str]] = mapped_column(JSONB)
    package_path: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()


class Document(Base):
    """Conteúdo ligado a um layout e seu último conjunto de checks."""

    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(primary_key=True)
    brand_revision_id: Mapped[str] = mapped_column(ForeignKey("brand_revisions.id"))
    layout_id: Mapped[str] = mapped_column(Text)
    content: Mapped[dict[str, Any]] = mapped_column(JSONB)
    checks: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _created_at()


class Campaign(Base):
    """Fonte única de mensagem propagada para várias peças da mesma revisão."""

    __tablename__ = "campaigns"
    __table_args__ = (Index("ix_campaigns_brand_revision", "brand_revision_id"),)

    id: Mapped[str] = mapped_column(primary_key=True)
    brand_revision_id: Mapped[str] = mapped_column(ForeignKey("brand_revisions.id"))
    name: Mapped[str] = mapped_column(Text)
    fields: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class CampaignPiece(Base):
    """Vínculo estável entre um layout, seu documento e os campos da campanha."""

    __tablename__ = "campaign_pieces"
    __table_args__ = (
        UniqueConstraint("campaign_id", "layout_id", name="uq_campaign_piece_layout"),
        Index("ix_campaign_pieces_campaign", "campaign_id"),
    )

    id: Mapped[str] = mapped_column(primary_key=True)
    campaign_id: Mapped[str] = mapped_column(ForeignKey("campaigns.id"))
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), unique=True)
    layout_id: Mapped[str] = mapped_column(Text)
    bindings: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _created_at()


class Carousel(Base):
    """Sequência editorial de formato único com papéis de abertura e fechamento."""

    __tablename__ = "carousels"
    __table_args__ = (Index("ix_carousels_brand_revision", "brand_revision_id"),)

    id: Mapped[str] = mapped_column(primary_key=True)
    brand_revision_id: Mapped[str] = mapped_column(ForeignKey("brand_revisions.id"))
    name: Mapped[str] = mapped_column(Text)
    profile: Mapped[str] = mapped_column(Text)
    signature: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _created_at()


class CarouselSlide(Base):
    """Posição imutável de um documento dentro de um carrossel."""

    __tablename__ = "carousel_slides"
    __table_args__ = (
        UniqueConstraint("carousel_id", "position", name="uq_carousel_slide_position"),
        Index("ix_carousel_slides_carousel", "carousel_id"),
    )

    id: Mapped[str] = mapped_column(primary_key=True)
    carousel_id: Mapped[str] = mapped_column(ForeignKey("carousels.id"))
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), unique=True)
    position: Mapped[int]
    role: Mapped[str] = mapped_column(Text)
    source: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _created_at()


class Job(Base):
    """Unidade persistente da fila mínima de export."""

    __tablename__ = "jobs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued','running','succeeded','failed')",
            name="ck_jobs_status",
        ),
        Index("ix_jobs_status", "status"),
    )

    id: Mapped[str] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(Text, default="export")
    document_id: Mapped[str | None] = mapped_column(
        ForeignKey("documents.id"),
        nullable=True,
    )
    params: Mapped[dict[str, Any]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(Text, default="queued", server_default="queued")
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    checks: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB,
        default=list,
        server_default="[]",
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = _created_at()
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )


class InviteToken(Base):
    """Hash persistido de um convite cujo segredo nunca é armazenado."""

    __tablename__ = "invite_tokens"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    label: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = _created_at()
