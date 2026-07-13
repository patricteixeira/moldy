"""Leitura autenticada de revisões imutáveis, kits e seus assets."""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from brand_api.auth import require_token
from brand_api.media import asset_response, content_type_for, sniff_content_type
from brand_api.models import BrandRevision

router = APIRouter(prefix="/v1", dependencies=[Depends(require_token)])

_FONT_PATH = re.compile(r"^fonts/([0-9a-f]{64})$")
_BLOB_PATH = re.compile(r"^sha256/([0-9a-f]{2})/([0-9a-f]{2})/([0-9a-f]{64})$")


def _revision_or_404(request: Request, revision_id: str) -> BrandRevision:
    """Carrega uma revisão e padroniza sua ausência em PT-BR."""
    with request.app.state.session_factory() as session:
        revision = session.get(BrandRevision, revision_id)
        if revision is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Revisão de marca não encontrada.",
            )
        session.expunge(revision)
        return revision


def _storage_bytes(request: Request, sha256: str) -> bytes:
    """Lê um hash íntegro do storage ou responde como asset ausente."""
    try:
        return request.app.state.storage.get(sha256)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset não encontrado.",
        ) from exc


@router.get("/brand-revisions/{revision_id}")
def get_revision(revision_id: str, request: Request) -> dict[str, Any]:
    """Devolve o Brand IR persistido verbatim em camelCase."""
    return _revision_or_404(request, revision_id).ir


@router.get("/brand-revisions/{revision_id}/kit")
def get_revision_kit(revision_id: str, request: Request) -> list[dict[str, Any]]:
    """Devolve os layouts persistidos da revisão sem regenerá-los."""
    return _revision_or_404(request, revision_id).kit


@router.get("/brand-revisions/{revision_id}/assets/{path:path}")
def get_revision_asset(revision_id: str, path: str, request: Request):
    """Resolve fonte, blob ou manifest sem concatenar input ao filesystem."""
    revision = _revision_or_404(request, revision_id)
    font_match = _FONT_PATH.fullmatch(path)
    if font_match is not None:
        data = _storage_bytes(request, font_match.group(1))
        return asset_response(data, "application/octet-stream")

    blob_match = _BLOB_PATH.fullmatch(path)
    if blob_match is not None:
        first, second, sha256 = blob_match.groups()
        if first != sha256[:2] or second != sha256[2:4]:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Asset não encontrado.",
            )
        data = _storage_bytes(request, sha256)
        return asset_response(data, sniff_content_type(data))

    sha256 = revision.manifest.get(path)
    if sha256 is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset não encontrado.")
    data = _storage_bytes(request, sha256)
    return asset_response(data, content_type_for(path))
