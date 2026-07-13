"""Adapters de export desacoplados do processo HTTP da API."""

from __future__ import annotations

import os
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

from PIL import Image

from brand_runtime import BrandIR, ContentSpec, GuardCheck, LayoutSpec, run_static_checks


@dataclass(frozen=True)
class ExportOutcome:
    """Arquivo produzido e conjunto completo de checks do Brand Guard."""

    path: Path
    checks: list[GuardCheck]


class ExportRejected(Exception):
    """Recusa esperada do renderer acompanhada dos checks que a motivaram."""

    def __init__(self, checks: list[GuardCheck]) -> None:
        """Preserva os checks medidos sem convertê-los em texto opaco."""
        self.checks = checks
        super().__init__("O render encontrou pendências do Brand Guard.")


class Exporter(Protocol):
    """Contrato injetável compartilhado pelo exporter fake e pelo real."""

    def export(
        self,
        *,
        ir: BrandIR,
        layout: LayoutSpec,
        content: ContentSpec,
        assets_dir: Path,
        fmt: Literal["png", "pdf"],
        out_path: Path,
    ) -> ExportOutcome:
        """Exporta um documento ou levanta ``ExportRejected``."""
        ...


class FakeExporter:
    """Exporter determinístico de teste que não inicializa Chromium."""

    def export(
        self,
        *,
        ir: BrandIR,
        layout: LayoutSpec,
        content: ContentSpec,
        assets_dir: Path,
        fmt: Literal["png", "pdf"],
        out_path: Path,
    ) -> ExportOutcome:
        """Gera uma prova mínima no formato pedido e executa o Guard estático."""
        if fmt not in {"png", "pdf"}:
            raise ValueError("O formato de export precisa ser png ou pdf.")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        if fmt == "png":
            Image.new("RGB", (4, 4), "#1A4D8F").save(out_path, format="PNG")
        else:
            out_path.write_bytes(b"%PDF-1.4\n% brand-runtime fake export\n%%EOF\n")
        return ExportOutcome(
            path=out_path,
            checks=run_static_checks(ir, layout, content, assets_dir),
        )


class PlaywrightExporter:
    """Adapter lazy para o exporter Chromium do motor do Plano 2."""

    def __init__(self, render_dist: Path) -> None:
        """Registra o build do renderer sem importar ou iniciar Playwright."""
        is_junction = getattr(os.path, "isjunction", None)
        entrypoint = render_dist / "render.html"
        try:
            entrypoint_mode = entrypoint.stat(follow_symlinks=False).st_mode
        except OSError as exc:
            raise RuntimeError("O build do renderer não existe ou não contém render.html.") from exc
        if (
            render_dist.is_symlink()
            or bool(is_junction and is_junction(render_dist))
            or not render_dist.is_dir()
            or entrypoint.is_symlink()
            or bool(is_junction and is_junction(entrypoint))
            or not stat.S_ISREG(entrypoint_mode)
        ):
            raise RuntimeError("O build do renderer precisa conter um render.html regular.")
        self.render_dist = render_dist

    def export(
        self,
        *,
        ir: BrandIR,
        layout: LayoutSpec,
        content: ContentSpec,
        assets_dir: Path,
        fmt: Literal["png", "pdf"],
        out_path: Path,
    ) -> ExportOutcome:
        """Delega ao motor e converte seu bloqueio no contrato da API."""
        # Este import precisa permanecer local: o processo HTTP e a suíte fake não
        # devem exigir a dependência opcional Playwright.
        from brand_runtime.export import ExportBlocked, export_document

        if out_path.suffix.casefold() != f".{fmt}":
            raise ValueError("A extensão do arquivo de saída não corresponde ao formato.")
        try:
            result = export_document(
                ir=ir,
                layout=layout,
                content=content,
                assets_dir=assets_dir,
                render_dist=self.render_dist,
                out_path=out_path,
            )
        except ExportBlocked as exc:
            raise ExportRejected(list(exc.verdict.checks)) from exc
        return ExportOutcome(
            path=result.out_path,
            checks=list(result.guard_verdict.checks),
        )
