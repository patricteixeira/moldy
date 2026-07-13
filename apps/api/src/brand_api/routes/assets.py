"""Upload autenticado e leitura de blobs content-addressed."""

from __future__ import annotations

import re
import warnings
from io import BytesIO
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from PIL import Image, UnidentifiedImageError

from brand_api.auth import require_token
from brand_api.media import asset_response, sniff_content_type

router = APIRouter(prefix="/v1", dependencies=[Depends(require_token)])

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_IMAGE_FORMATS = {"PNG", "JPEG"}
_INVALID_IMAGE_DETAIL = "Envie uma imagem PNG ou JPEG."
_ANIMATED_IMAGE_DETAIL = "Envie uma imagem estática em PNG ou JPEG."
_IMAGE_TOO_LARGE_DETAIL = "A imagem é grande demais."
_UPLOAD_TOO_LARGE_DETAIL = "O arquivo enviado excede o tamanho máximo permitido."


def _validate_image(data: bytes, max_image_pixels: int) -> None:
    """Valida formato, estrutura e dimensões sem alterar os bytes originais."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format not in _IMAGE_FORMATS:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=_INVALID_IMAGE_DETAIL,
                    )
                if getattr(image, "is_animated", False) or getattr(image, "n_frames", 1) != 1:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=_ANIMATED_IMAGE_DETAIL,
                    )
                if image.width * image.height > max_image_pixels:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=_IMAGE_TOO_LARGE_DETAIL,
                    )
                image.verify()
    except HTTPException:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_IMAGE_TOO_LARGE_DETAIL,
        ) from exc
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_INVALID_IMAGE_DETAIL,
        ) from exc


@router.post("/assets", status_code=status.HTTP_201_CREATED)
async def upload_asset(
    request: Request,
    file: Annotated[UploadFile, File()],
) -> dict[str, Any]:
    """Valida e publica os bytes originais de uma imagem PNG ou JPEG."""
    limit = request.app.state.settings.max_upload_bytes
    try:
        data = await file.read(limit + 1)
    finally:
        await file.close()
    if len(data) > limit:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=_UPLOAD_TOO_LARGE_DETAIL,
        )

    _validate_image(data, request.app.state.settings.max_image_pixels)
    sha256 = request.app.state.storage.put(data)
    return {"sha256": sha256, "size": len(data)}


@router.get("/assets/{sha256}")
def download_asset(sha256: str, request: Request):
    """Serve um blob íntegro por hash, sem enumerar o storage."""
    if _SHA256_RE.fullmatch(sha256) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset não encontrado.")
    try:
        data = request.app.state.storage.get(sha256)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset não encontrado.",
        ) from exc
    return asset_response(data, sniff_content_type(data))
