"""Autenticação mínima por tokens de convite armazenados apenas como hash."""

from __future__ import annotations

import hashlib
import secrets
from typing import Annotated

from fastapi import Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from brand_api.models import InviteToken

_AUTH_DETAIL = "Token de convite ausente ou inválido."


def hash_token(token: str) -> str:
    """Calcula o SHA-256 hexadecimal de um segredo UTF-8."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def require_token(
    request: Request,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
) -> None:
    """Exige um convite válido fornecido exclusivamente no header Bearer."""
    if authorization is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_DETAIL)
    scheme, separator, token = authorization.partition(" ")
    if separator != " " or scheme.casefold() != "bearer" or not token or token.strip() != token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_DETAIL)

    session_factory = request.app.state.session_factory
    with session_factory() as session:
        invite = session.get(InviteToken, hash_token(token))
    if invite is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_DETAIL)


def mint_token(session: Session, label: str | None = None) -> str:
    """Gera um convite, persiste somente seu hash e devolve o segredo uma vez."""
    for _attempt in range(10):
        token = secrets.token_urlsafe(32)
        token_hash = hash_token(token)
        if session.get(InviteToken, token_hash) is None:
            session.add(InviteToken(token_hash=token_hash, label=label))
            session.commit()
            return token
    raise RuntimeError("Não foi possível gerar um token de convite único.")
