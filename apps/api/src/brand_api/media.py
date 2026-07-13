"""Tipos de mídia e respostas seguras para blobs servidos pela API."""

from __future__ import annotations

from pathlib import PurePosixPath

from fastapi import Response

EXT_TYPES: dict[str, str] = {
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".pdf": "application/pdf",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".json": "application/json",
}


def content_type_for(path: str) -> str:
    """Resolve o content type por extensão conhecida, sem confiar no cliente."""
    return EXT_TYPES.get(PurePosixPath(path).suffix.casefold(), "application/octet-stream")


def sniff_content_type(data: bytes) -> str:
    """Reconhece PNG, JPEG e PDF por assinatura binária mínima."""
    if data.startswith(b"\x89PNG"):
        return "image/png"
    if data.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if data.startswith(b"%PDF"):
        return "application/pdf"
    return "application/octet-stream"


def asset_response(data: bytes, content_type: str) -> Response:
    """Monta uma resposta sem sniffing e isola SVG em defesa adicional."""
    headers = {"X-Content-Type-Options": "nosniff"}
    if content_type == "image/svg+xml":
        headers["Content-Security-Policy"] = "default-src 'none'"
    return Response(content=data, media_type=content_type, headers=headers)
