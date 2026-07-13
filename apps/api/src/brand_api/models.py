"""Modelos relacionais do contrato persistente da API."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base declarativa compartilhada pelas seis tabelas do M1."""


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
