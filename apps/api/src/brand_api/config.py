"""Configuração explícita da API derivada de variáveis de ambiente."""

from __future__ import annotations

import os
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class Settings(BaseModel):
    """Configuração validada compartilhada pela API e pelo worker."""

    model_config = ConfigDict(extra="forbid")

    database_url: str = Field(min_length=1, repr=False)
    data_dir: Path = Path("./var")
    bootstrap_token: str | None = Field(default=None, repr=False)
    fake_exporter: bool = False
    render_dist: Path | None = None
    max_upload_bytes: int = Field(default=100 * 2**20, gt=0)
    max_image_pixels: int = Field(default=40_000_000, gt=0)

    @property
    def storage_dir(self) -> Path:
        """Retorna a raiz persistente dos blobs content-addressed."""
        return self.data_dir / "storage"

    @property
    def packages_dir(self) -> Path:
        """Retorna a raiz dos pacotes de marca descompactados."""
        return self.data_dir / "packages"

    @property
    def work_dir(self) -> Path:
        """Retorna a raiz efêmera de trabalho dos jobs."""
        return self.data_dir / "work"

    @classmethod
    def from_env(cls) -> Settings:
        """Constrói a configuração a partir do ambiente ou falha em PT-BR."""
        database_url = os.environ.get("BRANDRT_DATABASE_URL", "").strip()
        if not database_url:
            raise RuntimeError("Defina BRANDRT_DATABASE_URL para iniciar a API.")

        data_dir = Path(os.environ.get("BRANDRT_DATA_DIR", "./var"))
        bootstrap_token = os.environ.get("BRANDRT_BOOTSTRAP_TOKEN") or None
        fake_exporter = os.environ.get("BRANDRT_FAKE_EXPORTER", "").strip().casefold() in {
            "1",
            "true",
        }
        raw_render_dist = os.environ.get("BRANDRT_RENDER_DIST")
        render_dist = Path(raw_render_dist) if raw_render_dist else None
        try:
            max_upload_bytes = int(os.environ.get("BRANDRT_MAX_UPLOAD_BYTES", str(100 * 2**20)))
            max_image_pixels = int(os.environ.get("BRANDRT_MAX_IMAGE_PIXELS", "40000000"))
        except ValueError as exc:
            raise RuntimeError("Os limites configurados precisam ser números inteiros.") from exc

        try:
            return cls(
                database_url=database_url,
                data_dir=data_dir,
                bootstrap_token=bootstrap_token,
                fake_exporter=fake_exporter,
                render_dist=render_dist,
                max_upload_bytes=max_upload_bytes,
                max_image_pixels=max_image_pixels,
            )
        except ValidationError as exc:
            raise RuntimeError(
                "Os limites configurados precisam ser números inteiros positivos."
            ) from exc
