"""Adapters de export desacoplados do processo HTTP da API."""

from __future__ import annotations

import os
import stat
import tempfile
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Literal, Protocol

from PIL import Image

from brand_api.native_templates import (
    CURRENT_NATIVE_TEMPLATE_VERSION,
    NativeTemplateRegistry,
)
from brand_runtime import (
    BrandIR,
    ContentSpec,
    GuardCheck,
    LayoutSpec,
    derive_branded_template,
    render_docx,
    render_pptx,
    run_static_checks,
    materialize_content_layout,
    validate_ooxml,
)

ExportFormat = Literal["png", "pdf", "pptx", "docx"]


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
        fmt: ExportFormat,
        out_path: Path,
        native_template_version: str | None = None,
    ) -> ExportOutcome:
        """Exporta um documento ou levanta ``ExportRejected``."""
        ...


def _is_link(path: Path) -> bool:
    is_junction = getattr(os.path, "isjunction", None)
    return path.is_symlink() or bool(is_junction and is_junction(path))


def _regular_contained_asset(assets_dir: Path, raw_path: str) -> Path:
    """Resolve um asset do IR sem permitir links ou escapes do workdir."""
    relative = Path(raw_path)
    if relative.is_absolute():
        raise ValueError("O path de asset nativo precisa ser relativo ao workdir.")
    root = assets_dir.resolve(strict=True)
    candidate = assets_dir / relative
    try:
        mode = candidate.stat(follow_symlinks=False).st_mode
        resolved = candidate.resolve(strict=True)
    except OSError as exc:
        raise ValueError(f"O asset nativo «{raw_path}» não foi encontrado.") from exc
    current = candidate
    while current != assets_dir:
        if _is_link(current):
            raise ValueError("Assets nativos não podem atravessar links.")
        if current == current.parent:
            raise ValueError("O asset nativo escapou do workdir.")
        current = current.parent
    if not stat.S_ISREG(mode) or not resolved.is_relative_to(root):
        raise ValueError("O asset nativo precisa ser um arquivo regular do workdir.")
    return candidate


def _rasterize_svg(source: Path, target: Path) -> None:
    """Converte o SVG sanitizado do intake em PNG compatível com Office."""
    import fitz

    try:
        with fitz.open(stream=source.read_bytes(), filetype="svg") as document:
            page = document.load_page(0)
            longest = max(page.rect.width, page.rect.height, 1)
            scale = min(4.0, max(1.0, 1024.0 / longest))
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=True)
            pixmap.save(target)
    except (OSError, RuntimeError, ValueError) as exc:
        raise ValueError(f"O SVG «{source.name}» não pôde ser rasterizado.") from exc


def _office_compatible_ir(ir: BrandIR, assets_dir: Path, work_dir: Path) -> BrandIR:
    """Deriva paths raster para logos SVG sem alterar o Brand IR persistido."""
    converted_assets = dict(ir.assets)
    raster_dir: Path | None = None
    for token, asset in ir.assets.items():
        if asset.format != "svg":
            continue
        source = _regular_contained_asset(assets_dir, asset.path)
        if raster_dir is None:
            raster_dir = Path(tempfile.mkdtemp(prefix=".native-assets-", dir=work_dir))
        target = raster_dir / f"{sha256(token.encode('utf-8')).hexdigest()[:16]}.png"
        _rasterize_svg(source, target)
        digest = sha256(target.read_bytes()).hexdigest()
        converted_assets[token] = asset.model_copy(
            update={"path": str(target.resolve()), "format": "png", "sha256": digest}
        )
    return ir.model_copy(update={"assets": converted_assets}, deep=True)


class NativeOfficeExporter:
    """Exporta PPTX/DOCX por template-fill e valida o pacote antes de publicar."""

    def __init__(self, registry: NativeTemplateRegistry | None = None) -> None:
        """Registra e valida os templates disponíveis antes do primeiro job."""
        self.registry = registry or NativeTemplateRegistry()
        self.registry.validate_all()

    def export(
        self,
        *,
        ir: BrandIR,
        layout: LayoutSpec,
        content: ContentSpec,
        assets_dir: Path,
        fmt: ExportFormat,
        out_path: Path,
        native_template_version: str | None = None,
    ) -> ExportOutcome:
        """Deriva o tema, preenche o template e falha fechado em diagnóstico OOXML."""
        if fmt not in {"pptx", "docx"}:
            raise ValueError("O exportador Office aceita apenas pptx ou docx.")
        if out_path.suffix.casefold() != f".{fmt}":
            raise ValueError("A extensão do arquivo de saída não corresponde ao formato.")
        if out_path.exists() or _is_link(out_path):
            raise ValueError("O destino do arquivo Office já existe no workdir.")
        checks = run_static_checks(ir, layout, content, assets_dir)
        if any(check.status == "blocked" for check in checks):
            raise ExportRejected(checks)
        active_layout = materialize_content_layout(layout, content)

        version = native_template_version or CURRENT_NATIVE_TEMPLATE_VERSION
        template = self.registry.resolve(fmt, active_layout, version=version)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        handle, temporary_name = tempfile.mkstemp(
            prefix=f".template-{template.version}-",
            suffix=f".{fmt}",
            dir=out_path.parent,
        )
        os.close(handle)
        branded_template = Path(temporary_name)
        try:
            native_ir = _office_compatible_ir(ir, assets_dir, out_path.parent)
            derive_branded_template(template.path, branded_template, native_ir)
            if fmt == "pptx":
                render_pptx(
                    branded_template,
                    out_path,
                    native_ir,
                    active_layout,
                    content,
                    asset_root=assets_dir,
                    native_layout_name=template.native_layout_name,
                )
            else:
                render_docx(
                    branded_template,
                    out_path,
                    native_ir,
                    active_layout,
                    content,
                    asset_root=assets_dir,
                )
        finally:
            branded_template.unlink(missing_ok=True)
        blocking = [diagnostic for diagnostic in validate_ooxml(out_path) if diagnostic.blocking]
        if blocking:
            out_path.unlink(missing_ok=True)
            raise RuntimeError(
                f"O arquivo Office gerado possui {len(blocking)} erro(s) estrutural(is)."
            )
        return ExportOutcome(path=out_path, checks=checks)


class FakeExporter:
    """Exporter de teste sem Chromium; formatos Office usam o adapter real."""

    def __init__(self, native: NativeOfficeExporter | None = None) -> None:
        """Mantém PNG/PDF mínimos e injeta o adapter Office validado."""
        self.native = native or NativeOfficeExporter()

    def export(
        self,
        *,
        ir: BrandIR,
        layout: LayoutSpec,
        content: ContentSpec,
        assets_dir: Path,
        fmt: ExportFormat,
        out_path: Path,
        native_template_version: str | None = None,
    ) -> ExportOutcome:
        """Gera uma prova mínima no formato pedido e executa o Guard estático."""
        if fmt in {"pptx", "docx"}:
            return self.native.export(
                ir=ir,
                layout=layout,
                content=content,
                assets_dir=assets_dir,
                fmt=fmt,
                out_path=out_path,
                native_template_version=native_template_version,
            )
        if fmt not in {"png", "pdf"}:
            raise ValueError("O formato de export precisa ser png, pdf, pptx ou docx.")
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
        fmt: ExportFormat,
        out_path: Path,
        native_template_version: str | None = None,
    ) -> ExportOutcome:
        """Delega ao motor e converte seu bloqueio no contrato da API."""
        # Este import precisa permanecer local: o processo HTTP e a suíte fake não
        # devem exigir a dependência opcional Playwright.
        from brand_runtime.export import ExportBlocked, export_document

        if fmt not in {"png", "pdf"}:
            raise ValueError("O exportador Chromium aceita apenas png ou pdf.")
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


class DispatchingExporter:
    """Encaminha cada formato ao adapter responsável sem duplicar o worker."""

    def __init__(self, web: PlaywrightExporter, native: NativeOfficeExporter) -> None:
        """Recebe os dois adapters já inicializados e prontos para uso."""
        self.web = web
        self.native = native

    def export(
        self,
        *,
        ir: BrandIR,
        layout: LayoutSpec,
        content: ContentSpec,
        assets_dir: Path,
        fmt: ExportFormat,
        out_path: Path,
        native_template_version: str | None = None,
    ) -> ExportOutcome:
        """Preserva um único contrato de saída para os quatro formatos."""
        exporter = self.native if fmt in {"pptx", "docx"} else self.web
        return exporter.export(
            ir=ir,
            layout=layout,
            content=content,
            assets_dir=assets_dir,
            fmt=fmt,
            out_path=out_path,
            native_template_version=native_template_version,
        )
