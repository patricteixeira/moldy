"""Construção explícita do engine, sessões e identificadores operacionais."""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker


def new_id(prefix: str) -> str:
    """Gera um identificador opaco com prefixo e doze dígitos hexadecimais."""
    return f"{prefix}_{uuid4().hex[:12]}"


def make_engine(url: str) -> Engine:
    """Cria o engine SQLAlchemy para a URL Postgres configurada."""
    return create_engine(url)


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    """Cria uma fábrica de sessões síncronas sem expirar objetos no commit."""
    return sessionmaker(bind=engine, expire_on_commit=False)
