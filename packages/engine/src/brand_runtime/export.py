"""Render e export determinísticos por Chromium, sem acesso externo à rede."""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import stat
import tempfile
import threading
from contextlib import contextmanager, suppress
from dataclasses import dataclass
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterator, Literal
from urllib.parse import urlsplit

from pydantic import Field, ValidationError

from brand_runtime.guard.static_checks import GuardCheck, GuardVerdict, run_static_checks
from brand_runtime.ir.models import BrandIR, CamelModel
from brand_runtime.kit.models import ContentSpec, LayoutSpec, TextValue

if TYPE_CHECKING:
    from playwright.sync_api import Page

DEFAULT_LAUNCH_ARGS: tuple[str, ...] = ("--force-color-profile=srgb",)
_RENDER_TIMEOUT_MS = 30_000
_PDF_DATE_RE = re.compile(rb"/(?:CreationDate|ModDate)\s*\(D:[^)]*\)")
_PDF_ID_RE = re.compile(rb"/ID\s*\[\s*<[^>]*>\s*<[^>]*>\s*\]")


class ExportError(Exception):
    """Falha operacional de render/export comunicada em PT-BR."""


class ExportBlocked(ExportError):
    """Export recusado pelo Brand Guard; expõe ``verdict`` para API/CLI."""

    def __init__(self, verdict: GuardVerdict) -> None:
        """Retém o verdict estruturado além da mensagem operacional."""
        self.verdict = verdict
        super().__init__("A exportação foi bloqueada pelo Brand Guard.")


@dataclass(frozen=True)
class ExportResult:
    """Arquivo publicado e verdict completo usado para autorizar a publicação."""

    out_path: Path
    guard_verdict: GuardVerdict


class MeasuredOverflow(CamelModel):
    """Overflow vertical medido pelo renderer para um slot textual."""

    slot_id: str = Field(min_length=1)
    content_px: int = Field(ge=0)
    box_px: int = Field(ge=0)


class MeasuredFontFallback(CamelModel):
    """Substituição de fonte efetivamente usada durante o render."""

    slot_id: str = Field(min_length=1)
    token: str = Field(min_length=1)
    family: str = Field(min_length=1)
    reason: Literal["referenced-only", "configured-fallback", "load-failed"]


class MeasuredGuardReport(CamelModel):
    """Relatório medido e estritamente validado antes de alcançar o Guard."""

    overflows: list[MeasuredOverflow]
    font_fallbacks: list[MeasuredFontFallback]


def build_payload(
    ir: BrandIR,
    layout: LayoutSpec,
    content: ContentSpec,
    assets_base_url: str,
) -> dict[str, Any]:
    """Projeta os três contratos Pydantic no payload camelCase da página."""
    return {
        "brandIr": ir.model_dump(mode="json", by_alias=True),
        "layoutSpec": layout.model_dump(mode="json", by_alias=True),
        "contentSpec": content.model_dump(mode="json", by_alias=True),
        "assetsBaseUrl": assets_base_url,
    }


def _is_link(path: Path) -> bool:
    """Detecta links simbólicos e junctions sem depender da plataforma."""
    is_junction = getattr(os.path, "isjunction", None)
    return path.is_symlink() or bool(is_junction and is_junction(path))


def _copy_assets_without_links(source: Path, destination: Path) -> list[Path]:
    """Materializa somente diretórios e arquivos regulares contidos na raiz."""
    try:
        root = source.resolve(strict=True)
    except OSError as exc:
        raise ExportError("O diretório de assets informado não existe.") from exc
    if not root.is_dir() or _is_link(source):
        raise ExportError("O diretório de assets deve ser uma pasta regular, sem links.")

    copied: list[Path] = []
    pending: list[tuple[Path, Path]] = [(root, destination)]
    while pending:
        current, target = pending.pop()
        target.mkdir(parents=True, exist_ok=True)
        try:
            with os.scandir(current) as scan:
                entries = sorted(scan, key=lambda entry: entry.name)
        except OSError as exc:
            raise ExportError("Não foi possível ler o diretório de assets.") from exc
        for entry in entries:
            path = Path(entry.path)
            if _is_link(path) or entry.is_symlink():
                raise ExportError(f"O pacote contém um link não permitido: «{path.name}».")
            try:
                resolved = path.resolve(strict=True)
                metadata = path.stat(follow_symlinks=False)
            except OSError as exc:
                raise ExportError(f"Não foi possível validar o asset «{path.name}».") from exc
            if not resolved.is_relative_to(root):
                raise ExportError(f"O asset «{path.name}» escapa da raiz autorizada.")
            child_target = target / entry.name
            if stat.S_ISDIR(metadata.st_mode):
                pending.append((path, child_target))
            elif stat.S_ISREG(metadata.st_mode):
                child_target.parent.mkdir(parents=True, exist_ok=True)
                try:
                    shutil.copyfile(path, child_target)
                except OSError as exc:
                    raise ExportError(f"Não foi possível copiar o asset «{path.name}».") from exc
                copied.append(child_target)
            else:
                raise ExportError(f"O pacote contém um arquivo não regular: «{path.name}».")
    return copied


def _sha256(path: Path) -> str:
    """Calcula o SHA-256 de um arquivo regular em streaming."""
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise ExportError(f"Não foi possível ler o asset «{path.name}».") from exc
    return digest.hexdigest()


def stage_site(render_dist: Path, assets_dir: Path, staging_dir: Path) -> Path:
    """Monta dist e assets locais num staging isolado, sem seguir links do pacote."""
    if not (render_dist / "render.html").is_file():
        raise ExportError("O build do renderer está ausente; rode `npm run build`.")
    if staging_dir.exists():
        raise ExportError("O diretório temporário de staging já existe.")
    try:
        shutil.copytree(render_dist, staging_dir)
    except OSError as exc:
        raise ExportError("Não foi possível copiar o build do renderer para o staging.") from exc

    copied = _copy_assets_without_links(assets_dir, staging_dir / "pkg")
    hashed_fonts = staging_dir / "pkg" / "fonts"
    for source in copied:
        if source.is_relative_to(hashed_fonts):
            digest = _sha256(source)
            destination = hashed_fonts / digest
            if source == destination:
                continue
            try:
                # O alias content-addressed deve sempre conter os mesmos bytes
                # que produziram o digest, mesmo se o pacote trouxer um arquivo
                # arbitrário já nomeado com esse SHA-256. A cópia parte do
                # snapshot no staging para não reabrir a origem mutável.
                shutil.copyfile(source, destination)
            except OSError as exc:
                raise ExportError(
                    f"Não foi possível materializar a fonte «{source.name}» por hash."
                ) from exc
    return staging_dir


def _zero_date(match: re.Match[bytes]) -> bytes:
    """Zera somente os dígitos da data, preservando offsets do PDF."""
    value = match.group(0)
    marker = value.find(b"D:")
    prefix = value[: marker + 2]
    suffix = re.sub(rb"[0-9]", b"0", value[marker + 2 :])
    return prefix + suffix


def _zero_pdf_id(match: re.Match[bytes]) -> bytes:
    """Zera os dois identificadores hexadecimais sem alterar o tamanho."""
    value = match.group(0)
    return re.sub(
        rb"<([^>]*)>",
        lambda item: b"<" + re.sub(rb"[0-9A-Fa-f]", b"0", item.group(1)) + b">",
        value,
    )


def normalize_pdf(data: bytes) -> bytes:
    """Neutraliza datas e IDs variáveis do Chromium preservando o comprimento."""
    normalized = _PDF_DATE_RE.sub(_zero_date, data)
    normalized = _PDF_ID_RE.sub(_zero_pdf_id, normalized)
    if len(normalized) != len(data):  # defesa contra regressão nos callbacks
        raise ExportError("A normalização do PDF alterou o tamanho do arquivo.")
    return normalized


class _SilentHandler(SimpleHTTPRequestHandler):
    """Handler local sem ruído no stderr da CLI e dos testes."""

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        """Silencia o log HTTP; falhas continuam observáveis pelo Playwright."""


@contextmanager
def serve_directory(root: Path) -> Iterator[str]:
    """Serve uma raiz confiável numa porta efêmera de 127.0.0.1."""
    handler = partial(_SilentHandler, directory=str(root))
    try:
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    except OSError as exc:
        raise ExportError("Não foi possível iniciar o servidor local de render.") from exc
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, name="brandrt-render", daemon=True)
    thread.start()
    port = int(server.server_address[1])
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def _same_origin(url: str, expected: tuple[str, str, int]) -> bool:
    """Compara esquema, host e porta, sem aceitar equivalências implícitas."""
    try:
        parsed = urlsplit(url)
        return (parsed.scheme, parsed.hostname or "", parsed.port or -1) == expected
    except ValueError:
        return False


@contextmanager
def open_render_page(
    ir: BrandIR,
    layout: LayoutSpec,
    content: ContentSpec,
    assets_dir: Path,
    render_dist: Path,
) -> Iterator["Page"]:
    """Abre a página estável em Chromium isolado e limitado à origem efêmera."""
    try:
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise ExportError(
            "O extra de export não está instalado; instale `.[export]` e o Chromium."
        ) from exc

    with tempfile.TemporaryDirectory(prefix="brandrt-render-") as temporary:
        staging = stage_site(render_dist, assets_dir, Path(temporary) / "site")
        with serve_directory(staging) as base:
            origin = urlsplit(base)
            expected_origin = (origin.scheme, origin.hostname or "", origin.port or -1)
            browser = None
            context = None
            page = None
            try:
                with sync_playwright() as playwright:
                    browser = playwright.chromium.launch(args=list(DEFAULT_LAUNCH_ARGS))
                    context = browser.new_context(
                        viewport={
                            "width": layout.canvas.width_px,
                            "height": layout.canvas.height_px,
                        },
                        device_scale_factor=1,
                    )
                    page = context.new_page()
                    page.set_default_timeout(_RENDER_TIMEOUT_MS)

                    def route_request(route: Any) -> None:
                        if _same_origin(route.request.url, expected_origin):
                            route.continue_()
                        else:
                            route.abort()

                    page.route("**/*", route_request)
                    payload = build_payload(ir, layout, content, f"{base}/pkg")

                    # A API Python de add_init_script não recebe argumento. O
                    # payload cruza o protocolo pelo argumento serializado de
                    # evaluate e fica no sessionStorage da mesma origem; o init
                    # script apenas o lê antes de qualquer script do renderer.
                    page.goto(base, wait_until="load", timeout=_RENDER_TIMEOUT_MS)
                    page.evaluate(
                        "payload => sessionStorage.setItem('__brandrt_payload__', "
                        "JSON.stringify(payload))",
                        payload,
                    )
                    page.add_init_script(
                        "window.__PAYLOAD__ = JSON.parse("
                        "sessionStorage.getItem('__brandrt_payload__'));"
                    )
                    page.goto(
                        f"{base}/render.html",
                        wait_until="load",
                        timeout=_RENDER_TIMEOUT_MS,
                    )
                    page.wait_for_function(
                        "() => window.__RENDER_DONE__ === true || "
                        "typeof window.__RENDER_ERROR__ === 'string'",
                        timeout=_RENDER_TIMEOUT_MS,
                    )
                    render_error = page.evaluate("window.__RENDER_ERROR__")
                    if render_error is not None:
                        raise ExportError(f"O renderer recusou o payload: {render_error}")
                    yield page
            except ExportError:
                raise
            except (PlaywrightTimeoutError, PlaywrightError, OSError) as exc:
                raise ExportError(
                    "O Chromium não conseguiu concluir o render local em até 30 segundos."
                ) from exc
            finally:
                if page is not None:
                    with suppress(Exception):
                        page.close()
                if context is not None:
                    with suppress(Exception):
                        context.close()
                if browser is not None:
                    with suppress(Exception):
                        browser.close()


def _read_guard_report(page: "Page") -> MeasuredGuardReport:
    """Valida o report publicado pela página, recusando dicts livres."""
    try:
        raw = page.evaluate("window.__GUARD_REPORT__")
        return MeasuredGuardReport.model_validate(raw)
    except (ValidationError, TypeError, ValueError) as exc:
        raise ExportError("O renderer publicou um relatório medido inválido.") from exc


def measure_guard_report(
    ir: BrandIR,
    layout: LayoutSpec,
    content: ContentSpec,
    assets_dir: Path,
    render_dist: Path,
) -> MeasuredGuardReport:
    """Executa o renderer e devolve somente medições tipadas e validadas."""
    with open_render_page(ir, layout, content, assets_dir, render_dist) as page:
        return _read_guard_report(page)


def _validated_measurements(
    ir: BrandIR,
    layout: LayoutSpec,
    content: ContentSpec,
    report: MeasuredGuardReport,
) -> tuple[dict[str, MeasuredOverflow], dict[str, MeasuredFontFallback]]:
    """Vincula cada medição a um único slot textual efetivamente preenchido."""
    eligible = {
        slot.id: slot
        for slot in layout.slots
        if slot.kind == "text" and isinstance(content.values.get(slot.id), TextValue)
    }
    overflows: dict[str, MeasuredOverflow] = {}
    for overflow in report.overflows:
        if overflow.slot_id not in eligible:
            raise ExportError(
                f"O report medido referencia o slot textual inválido «{overflow.slot_id}»."
            )
        if overflow.slot_id in overflows:
            raise ExportError(f"O report medido repete o overflow do slot «{overflow.slot_id}».")
        slot = eligible[overflow.slot_id]
        expected_box_px = slot.area[3]
        if overflow.box_px != expected_box_px or overflow.content_px <= overflow.box_px:
            raise ExportError(
                f"A medição de overflow do slot «{overflow.slot_id}» é inconsistente."
            )
        overflows[overflow.slot_id] = overflow

    fallbacks: dict[str, MeasuredFontFallback] = {}
    for fallback in report.font_fallbacks:
        if fallback.slot_id not in eligible:
            raise ExportError(
                f"O report medido referencia o slot textual inválido «{fallback.slot_id}»."
            )
        if fallback.slot_id in fallbacks:
            raise ExportError(f"O report medido repete o fallback do slot «{fallback.slot_id}».")
        slot = eligible[fallback.slot_id]
        role = ir.roles.get(slot.role or "")
        if role is None:
            raise ExportError(
                f"O report medido não pode resolver o papel do slot «{fallback.slot_id}»."
            )
        expected_token = role.font
        font = ir.fonts.get(expected_token)
        expected_reason = {
            "referenced-only": "referenced-only",
            "fallback": "configured-fallback",
            "file": "load-failed",
        }.get(font.source if font is not None else "")
        if (
            font is None
            or fallback.token != expected_token
            or fallback.family != font.family
            or fallback.reason != expected_reason
        ):
            raise ExportError(
                f"A medição de fallback do slot «{fallback.slot_id}» é inconsistente."
            )
        fallbacks[fallback.slot_id] = fallback
    for slot_id, slot in eligible.items():
        role = ir.roles.get(slot.role or "")
        font = ir.fonts.get(role.font) if role is not None else None
        if font is not None and font.source in {"referenced-only", "fallback"}:
            if slot_id not in fallbacks:
                raise ExportError(
                    f"O report medido omite o fallback obrigatório do slot «{slot_id}»."
                )
    return overflows, fallbacks


def build_guard_verdict(
    ir: BrandIR,
    layout: LayoutSpec,
    content: ContentSpec,
    assets_dir: Path,
    report: MeasuredGuardReport,
) -> GuardVerdict:
    """Combina checks estáticos e medições na ordem declarada dos slots."""
    checks = list(run_static_checks(ir, layout, content, assets_dir))
    overflows, fallbacks = _validated_measurements(ir, layout, content, report)
    for slot in layout.slots:
        overflow = overflows.get(slot.id)
        if overflow is not None:
            checks.append(
                GuardCheck(
                    id="text-overflow",
                    slot_id=slot.id,
                    status="blocked",
                    message_pt=f"O texto de «{slot.id}» ultrapassa a altura disponível.",
                    detail={
                        "contentPx": overflow.content_px,
                        "boxPx": overflow.box_px,
                    },
                )
            )
        fallback = fallbacks.get(slot.id)
        if fallback is not None:
            blocked = fallback.reason == "load-failed"
            checks.append(
                GuardCheck(
                    id="font-fallback",
                    slot_id=slot.id,
                    status="blocked" if blocked else "fixed",
                    message_pt=(
                        f"A fonte de «{slot.id}» não pôde ser carregada."
                        if blocked
                        else f"A fonte de «{slot.id}» foi substituída de forma controlada."
                    ),
                    detail={
                        "token": fallback.token,
                        "family": fallback.family,
                        "reason": fallback.reason,
                    },
                )
            )
    return GuardVerdict(checks=checks)


def _has_blocked(verdict: GuardVerdict) -> bool:
    """Informa se o verdict contém ao menos uma regra bloqueante."""
    return any(check.status == "blocked" for check in verdict.checks)


def _atomic_write_bytes(path: Path, data: bytes) -> None:
    """Publica bytes por fsync e replace no mesmo diretório do destino."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, raw_temporary = tempfile.mkstemp(
            prefix=f".{path.name}.",
            suffix=".tmp",
            dir=path.parent,
        )
    except OSError as exc:
        raise ExportError("Não foi possível preparar o destino da exportação.") from exc
    temporary = Path(raw_temporary)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except OSError as exc:
        raise ExportError("Não foi possível publicar o arquivo exportado.") from exc
    finally:
        with suppress(OSError):
            temporary.unlink()


def export_document(
    ir: BrandIR,
    layout: LayoutSpec,
    content: ContentSpec,
    assets_dir: Path,
    render_dist: Path,
    out_path: Path,
) -> ExportResult:
    """Autoriza, renderiza e publica um PNG ou PDF de modo atômico."""
    suffix = out_path.suffix.casefold()
    if suffix not in {".png", ".pdf"}:
        raise ValueError("O arquivo de saída precisa terminar em .png ou .pdf.")
    if suffix == ".pdf" and layout.profile != "doc-a4":
        raise ValueError("Export em PDF é exclusivo do perfil doc-a4.")

    static_verdict = GuardVerdict(checks=run_static_checks(ir, layout, content, assets_dir))
    if _has_blocked(static_verdict):
        raise ExportBlocked(static_verdict)

    with open_render_page(ir, layout, content, assets_dir, render_dist) as page:
        report = _read_guard_report(page)
        verdict = build_guard_verdict(ir, layout, content, assets_dir, report)
        if _has_blocked(verdict):
            raise ExportBlocked(verdict)
        try:
            if suffix == ".png":
                data = page.locator("#canvas").screenshot(
                    type="png",
                    animations="disabled",
                    caret="hide",
                    scale="css",
                )
            else:
                data = normalize_pdf(
                    page.pdf(
                        format="A4",
                        print_background=True,
                        margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
                    )
                )
        except Exception as exc:
            raise ExportError("O Chromium não conseguiu gerar o arquivo exportado.") from exc

    _atomic_write_bytes(out_path, data)
    return ExportResult(out_path=out_path, guard_verdict=verdict)
