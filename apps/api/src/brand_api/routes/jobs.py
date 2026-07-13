"""Consulta autenticada do estado de jobs de export."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from brand_api.auth import require_token
from brand_api.models import Job

router = APIRouter(prefix="/v1", dependencies=[Depends(require_token)])


@router.get("/jobs/{job_id}")
def get_job(job_id: str, request: Request) -> dict[str, Any]:
    """Expõe somente o contrato público estável do estado de um job."""
    with request.app.state.session_factory() as session:
        job = session.get(Job, job_id)
        if job is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Job de export não encontrado.",
            )
        return {
            "id": job.id,
            "status": job.status,
            "result": job.result,
            "checks": job.checks,
            "error": job.error,
        }
