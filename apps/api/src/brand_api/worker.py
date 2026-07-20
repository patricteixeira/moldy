"""Worker transacional da fila de exports persistida no Postgres."""

from __future__ import annotations

import os
import re
import shutil
import stat
import threading
import time
import zipfile
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

from sqlalchemy import and_, or_, select

from brand_api.config import Settings
from brand_api.db import make_engine, make_session_factory, new_id
from brand_api.exporters import (
    DispatchingExporter,
    Exporter,
    ExportOutcome,
    ExportRejected,
    FakeExporter,
    NativeOfficeExporter,
    PlaywrightExporter,
)
from brand_api.layout_catalog import resolve_layout
from brand_api.models import BrandRevision, Carousel, CarouselSlide, Document, Job
from brand_api.storage import Storage
from brand_runtime import (
    BrandIR,
    ContentSpec,
    DocxBrandPlan,
    FixPlan,
    GuardCheck,
    LayoutSpec,
    analyze_docx_brand,
    apply_docx_brand_plan,
    apply_pptx_fix_plan,
    build_fix_plan,
    lint_roundtrip,
    parse_pptx_document_graph,
)
from brand_runtime.kit.models import ImageValue

_JOB_ID_RE = re.compile(r"^job_[0-9a-f]{12}$")
_LEASE_ID_RE = re.compile(r"^lease_[0-9a-f]{12}$")
_LEASE_KEY = "_leaseId"
_LEASE_TIMEOUT = timedelta(minutes=5)
_HEARTBEAT_SECONDS = 30.0
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{number}" for number in range(1, 10)),
    *(f"LPT{number}" for number in range(1, 10)),
}


def _is_link(path: Path) -> bool:
    """Detecta links simbólicos e junctions sem seguir seus destinos."""
    is_junction = getattr(os.path, "isjunction", None)
    return path.is_symlink() or bool(is_junction and is_junction(path))


def _validate_existing_ancestors(path: Path) -> None:
    """Recusa qualquer link na cadeia já existente de um diretório de trabalho."""
    for component in (path, *path.parents):
        if component.exists() and _is_link(component):
            raise ValueError("O diretório de trabalho não pode conter links.")


def _ensure_regular_directory(path: Path) -> None:
    """Cria uma árvore e confirma que cada componente é diretório real."""
    _validate_existing_ancestors(path)
    path.mkdir(parents=True, exist_ok=True)
    current = path
    while True:
        if _is_link(current) or not current.is_dir():
            raise ValueError("O diretório de trabalho precisa ser uma pasta regular.")
        if current == current.parent:
            break
        current = current.parent


def _safe_relative_path(raw_path: str) -> Path:
    """Converte um path POSIX relativo sem aceitar escapes ou ambiguidades Windows."""
    if not isinstance(raw_path, str) or not raw_path or "\x00" in raw_path:
        raise ValueError("O path do manifest é inválido.")
    if "\\" in raw_path or PureWindowsPath(raw_path).drive:
        raise ValueError("O path do manifest precisa ser relativo e usar '/'.")
    raw_parts = raw_path.split("/")
    if any(
        part in {"", ".", ".."}
        or part.endswith((".", " "))
        or any(ord(character) < 32 or character in '<>:"|?*' for character in part)
        or part.split(".", 1)[0].upper() in _WINDOWS_RESERVED_NAMES
        for part in raw_parts
    ):
        raise ValueError("O path do manifest contém um segmento não permitido.")
    candidate = PurePosixPath(raw_path)
    if candidate.is_absolute():
        raise ValueError("O path do manifest não pode escapar do diretório de trabalho.")
    return Path(*candidate.parts)


def _materialization_plan(
    manifest: dict[str, str],
    ir: BrandIR,
    content: ContentSpec | None,
) -> dict[Path, str]:
    """Une as raízes de asset e falha em colisões ambíguas."""
    planned: dict[Path, str] = {}
    casefolded: dict[str, Path] = {}

    def add(relative: Path, sha256: str) -> None:
        key = relative.as_posix().casefold()
        previous_path = casefolded.get(key)
        if previous_path is not None:
            if previous_path != relative or planned[previous_path] != sha256:
                raise ValueError("O workdir contém paths de asset em colisão.")
            return
        casefolded[key] = relative
        planned[relative] = sha256

    for raw_path, sha256 in manifest.items():
        add(_safe_relative_path(raw_path), sha256)

    for font in ir.fonts.values():
        if font.file_sha256 is not None:
            add(Path("fonts", font.file_sha256), font.file_sha256)

    if content is not None:
        for value in content.values.values():
            if isinstance(value, ImageValue):
                if value.sha256 is None:
                    raise ValueError("Uma imagem do documento não possui SHA-256.")
                add(
                    Path("sha256", value.sha256[:2], value.sha256[2:4], value.sha256),
                    value.sha256,
                )
    return planned


def _write_blob_safely(dest: Path, relative: Path, data: bytes) -> None:
    """Publica um blob novo recusando parents ou destinos que sejam links."""
    target = dest / relative
    current = dest
    for part in relative.parent.parts:
        current /= part
        current.mkdir(exist_ok=True)
        if _is_link(current) or not current.is_dir():
            raise ValueError("O workdir contém um link não permitido.")
    if target.exists() or _is_link(target):
        raise ValueError("O workdir já contém um arquivo no destino do asset.")
    with target.open("xb") as handle:
        handle.write(data)


def build_export_workdir(
    manifest: dict[str, str],
    ir: BrandIR,
    content: ContentSpec,
    storage: Storage,
    dest: Path,
) -> Path:
    """Materializa pacote, fontes e imagens em uma raiz efêmera segura."""
    _validate_existing_ancestors(dest)
    if dest.exists():
        if _is_link(dest) or not dest.is_dir() or any(dest.iterdir()):
            raise ValueError("O diretório de trabalho precisa estar vazio e sem links.")
    else:
        _ensure_regular_directory(dest)

    identity = dest.resolve(strict=True)
    try:
        for relative, sha256 in _materialization_plan(manifest, ir, content).items():
            # Storage.get valida tanto o endereço quanto a integridade do conteúdo.
            _write_blob_safely(dest, relative, storage.get(sha256))
    except Exception:
        # Se a materialização falhar no meio, não deixa uma árvore parcial para trás.
        with suppress(OSError, ValueError):
            _validate_existing_ancestors(dest)
            if dest.exists() and not _is_link(dest) and dest.resolve(strict=True) == identity:
                shutil.rmtree(dest)
        raise
    return dest


def build_brand_workdir(
    manifest: dict[str, str],
    ir: BrandIR,
    storage: Storage,
    dest: Path,
) -> Path:
    """Materializa somente os assets da revisão para operações sobre arquivos externos."""
    _validate_existing_ancestors(dest)
    if dest.exists():
        if _is_link(dest) or not dest.is_dir() or any(dest.iterdir()):
            raise ValueError("O diretório de trabalho precisa estar vazio e sem links.")
    else:
        _ensure_regular_directory(dest)

    identity = dest.resolve(strict=True)
    try:
        for relative, sha256 in _materialization_plan(manifest, ir, None).items():
            _write_blob_safely(dest, relative, storage.get(sha256))
    except Exception:
        with suppress(OSError, ValueError):
            _validate_existing_ancestors(dest)
            if dest.exists() and not _is_link(dest) and dest.resolve(strict=True) == identity:
                shutil.rmtree(dest)
        raise
    return dest


def _serialize_checks(checks: list[GuardCheck]) -> list[dict]:
    """Valida e serializa checks do exporter sem perder campos medidos."""
    return [
        GuardCheck.model_validate(check).model_dump(mode="json", by_alias=True) for check in checks
    ]


@dataclass(frozen=True)
class _JobLease:
    """Identifica uma tentativa de processamento e cerca workers antigos."""

    job_id: str
    lease_id: str


class _LeaseLost(RuntimeError):
    """Indica que outra tentativa recuperou o job antes desta terminar."""


def _owns_lease(job: Job, lease_id: str) -> bool:
    """Confirma que o job ainda está em execução pela tentativa informada."""
    return (
        job.status == "running"
        and isinstance(job.params, dict)
        and job.params.get(_LEASE_KEY) == lease_id
    )


def _claim_next_job(
    session_factory,
    *,
    lease_timeout: timedelta = _LEASE_TIMEOUT,
) -> _JobLease | None:
    """Reivindica um job queued ou recupera um running cujo lease expirou."""
    if lease_timeout < timedelta(0):
        raise ValueError("A duração do lease não pode ser negativa.")
    now = datetime.now(UTC)
    stale_before = now - lease_timeout
    with session_factory() as session:
        job = session.scalars(
            select(Job)
            .where(
                or_(
                    Job.status == "queued",
                    and_(
                        Job.status == "running",
                        or_(Job.started_at.is_(None), Job.started_at < stale_before),
                    ),
                )
            )
            .order_by(Job.created_at, Job.id)
            .with_for_update(skip_locked=True)
            .limit(1)
        ).first()
        if job is None:
            return None
        lease_id = new_id("lease")
        params = dict(job.params) if isinstance(job.params, dict) else {}
        params[_LEASE_KEY] = lease_id
        job.params = params
        job.status = "running"
        job.started_at = now
        job.finished_at = None
        job.error = None
        job.result = None
        session.commit()
        return _JobLease(job_id=job.id, lease_id=lease_id)


def _renew_lease(session_factory, lease: _JobLease) -> bool:
    """Renova o heartbeat somente se a tentativa ainda possuir o job."""
    with session_factory() as session:
        job = session.scalars(select(Job).where(Job.id == lease.job_id).with_for_update()).first()
        if job is None or not _owns_lease(job, lease.lease_id):
            return False
        job.started_at = datetime.now(UTC)
        session.commit()
        return True


class _LeaseHeartbeat:
    """Mantém o lease vivo durante renders longos e detecta perda de posse."""

    def __init__(self, session_factory, lease: _JobLease, interval_seconds: float) -> None:
        if interval_seconds <= 0:
            raise ValueError("O intervalo do heartbeat precisa ser positivo.")
        self._session_factory = session_factory
        self._lease = lease
        self._interval_seconds = interval_seconds
        self._stop = threading.Event()
        self._lost = threading.Event()
        self._error: Exception | None = None
        self._thread = threading.Thread(
            target=self._run,
            name=f"heartbeat-{lease.job_id}",
            daemon=True,
        )

    def _run(self) -> None:
        while not self._stop.wait(self._interval_seconds):
            try:
                if not _renew_lease(self._session_factory, self._lease):
                    self._lost.set()
                    return
            except Exception as exc:  # pragma: no cover - falha do driver varia por ambiente
                self._error = exc
                self._lost.set()
                return

    def __enter__(self) -> _LeaseHeartbeat:
        self._thread.start()
        return self

    def ensure_owned(self) -> None:
        """Falha fechado antes de publicar se o heartbeat perdeu o lease."""
        if self._lost.is_set():
            raise _LeaseLost("O lease do job foi recuperado por outro worker.") from self._error
        try:
            owned = _renew_lease(self._session_factory, self._lease)
        except Exception as exc:
            raise _LeaseLost("Não foi possível confirmar o lease do job.") from exc
        if not owned:
            self._lost.set()
            raise _LeaseLost("O lease do job foi recuperado por outro worker.")

    def __exit__(self, _exc_type, _exc, _traceback) -> None:
        self._stop.set()
        self._thread.join(timeout=min(max(self._interval_seconds * 2, 1.0), 5.0))


def _load_export_contract(session_factory, lease: _JobLease):
    """Carrega e valida o snapshot persistido necessário ao export."""
    with session_factory() as session:
        job = session.get(Job, lease.job_id)
        if job is None or not _owns_lease(job, lease.lease_id) or job.kind != "export":
            raise RuntimeError("O job reivindicado não está disponível para export.")
        document = session.get(Document, job.document_id)
        if document is None:
            raise RuntimeError("O documento do job não foi encontrado.")
        revision = session.get(BrandRevision, document.brand_revision_id)
        if revision is None:
            raise RuntimeError("A revisão de marca do documento não foi encontrada.")
        params = job.params if isinstance(job.params, dict) else {}
        fmt = params.get("format")
        if fmt not in {"png", "pdf", "pptx", "docx"}:
            raise RuntimeError("O formato persistido no job é inválido.")
        native_template_version = params.get("nativeTemplateVersion")
        if fmt in {"pptx", "docx"}:
            if not isinstance(native_template_version, str) or not native_template_version:
                raise RuntimeError("O job nativo não informa a versão do template.")
        elif native_template_version is not None:
            raise RuntimeError("Um job web não pode informar template nativo.")
        ir = BrandIR.model_validate(revision.ir)
        content = ContentSpec.model_validate(document.content)
        layout = resolve_layout(revision, document.layout_id)
        if layout is None:
            raise RuntimeError("O layout do documento não existe na revisão.")
        return (
            document.id,
            ir,
            layout,
            content,
            dict(revision.manifest),
            fmt,
            native_template_version,
        )


def _load_carousel_export_contract(
    session_factory,
    lease: _JobLease,
) -> tuple[str, BrandIR, dict[str, str], list[tuple[int, str, LayoutSpec, ContentSpec]]]:
    """Carrega a série ordenada e resolve seus layouts internos deterministicamente."""
    with session_factory() as session:
        job = session.get(Job, lease.job_id)
        if job is None or not _owns_lease(job, lease.lease_id) or job.kind != "carousel-export":
            raise RuntimeError("O job reivindicado não está disponível para o carrossel.")
        params = job.params if isinstance(job.params, dict) else {}
        carousel_id = params.get("carouselId")
        if not isinstance(carousel_id, str) or params.get("format") != "png":
            raise RuntimeError("O job do carrossel não possui parâmetros válidos.")
        carousel = session.get(Carousel, carousel_id)
        if carousel is None:
            raise RuntimeError("O carrossel do job não foi encontrado.")
        revision = session.get(BrandRevision, carousel.brand_revision_id)
        if revision is None:
            raise RuntimeError("A revisão do carrossel não foi encontrada.")
        slides = list(
            session.scalars(
                select(CarouselSlide)
                .where(CarouselSlide.carousel_id == carousel.id)
                .order_by(CarouselSlide.position)
            )
        )
        if len(slides) < 3:
            raise RuntimeError("O carrossel não possui uma sequência completa.")
        contracts: list[tuple[int, str, LayoutSpec, ContentSpec]] = []
        for slide in slides:
            document = session.get(Document, slide.document_id)
            if document is None:
                raise RuntimeError("Um documento do carrossel não foi encontrado.")
            layout = resolve_layout(revision, document.layout_id)
            if layout is None:
                raise RuntimeError("Um layout do carrossel não pôde ser resolvido.")
            contracts.append(
                (
                    slide.position,
                    document.id,
                    layout,
                    ContentSpec.model_validate(document.content),
                )
            )
        return (
            carousel.id,
            BrandIR.model_validate(revision.ir),
            dict(revision.manifest),
            contracts,
        )


def _load_job_kind(session_factory, lease: _JobLease) -> str:
    """Lê o discriminador do job somente quando o worker ainda possui o lease."""
    with session_factory() as session:
        job = session.get(Job, lease.job_id)
        if job is None or not _owns_lease(job, lease.lease_id):
            raise _LeaseLost("O job mudou de lease antes do processamento.")
        return job.kind


def _load_roundtrip_contract(
    session_factory,
    lease: _JobLease,
    expected_kind: str,
) -> tuple[str, BrandIR, str, str, FixPlan | None]:
    """Carrega hashes, marca e plano persistidos para um job de round-trip."""
    with session_factory() as session:
        job = session.get(Job, lease.job_id)
        if job is None or not _owns_lease(job, lease.lease_id) or job.kind != expected_kind:
            raise RuntimeError("O job reivindicado não está disponível para round-trip.")
        document = session.get(Document, job.document_id)
        if document is None:
            raise RuntimeError("O documento do round-trip não foi encontrado.")
        revision = session.get(BrandRevision, document.brand_revision_id)
        if revision is None:
            raise RuntimeError("A revisão de marca do round-trip não foi encontrada.")
        params = job.params if isinstance(job.params, dict) else {}
        baseline_sha256 = params.get("baselineSha256")
        edited_sha256 = params.get("editedSha256")
        if (
            not isinstance(baseline_sha256, str)
            or _SHA256_RE.fullmatch(baseline_sha256) is None
            or not isinstance(edited_sha256, str)
            or _SHA256_RE.fullmatch(edited_sha256) is None
        ):
            raise RuntimeError("O job de round-trip não possui hashes válidos.")
        plan = None
        if expected_kind == "roundtrip-fix":
            plan = FixPlan.model_validate(params.get("fixPlan"))
            if plan.baseline_sha256 != baseline_sha256 or plan.edited_sha256 != edited_sha256:
                raise RuntimeError("O plano persistido não corresponde aos blobs do job.")
        return (
            document.id,
            BrandIR.model_validate(revision.ir),
            baseline_sha256,
            edited_sha256,
            plan,
        )


def _load_docx_brand_contract(
    session_factory,
    lease: _JobLease,
    expected_kind: str,
) -> tuple[BrandIR, dict[str, str], str, str, DocxBrandPlan | None]:
    """Carrega revisão, blob e plano de uma aplicação de marca em Word."""
    with session_factory() as session:
        job = session.get(Job, lease.job_id)
        if job is None or not _owns_lease(job, lease.lease_id) or job.kind != expected_kind:
            raise RuntimeError("O job reivindicado não está disponível para o Word.")
        params = job.params if isinstance(job.params, dict) else {}
        revision_id = params.get("brandRevisionId")
        source_sha256 = params.get("sourceSha256")
        source_filename = params.get("sourceFilename")
        if (
            not isinstance(revision_id, str)
            or not isinstance(source_sha256, str)
            or _SHA256_RE.fullmatch(source_sha256) is None
            or not isinstance(source_filename, str)
            or not source_filename.casefold().endswith(".docx")
        ):
            raise RuntimeError("O job do Word não possui origem e revisão válidas.")
        revision = session.get(BrandRevision, revision_id)
        if revision is None:
            raise RuntimeError("A revisão de marca do Word não foi encontrada.")
        plan = None
        if expected_kind == "docx-brand-apply":
            plan = DocxBrandPlan.model_validate(params.get("plan"))
            if plan.source.sha256 != source_sha256 or plan.brand_revision_id != revision_id:
                raise RuntimeError("O plano do Word não corresponde ao blob e à revisão.")
        return (
            BrandIR.model_validate(revision.ir),
            dict(revision.manifest),
            source_sha256,
            source_filename,
            plan,
        )


def _safe_job_workdir(work_root: Path, lease: _JobLease) -> Path:
    """Deriva uma pasta por tentativa, sem colisão com um worker recuperado."""
    if not _JOB_ID_RE.fullmatch(lease.job_id) or not _LEASE_ID_RE.fullmatch(lease.lease_id):
        raise ValueError("O identificador do job ou do lease não é seguro para o workdir.")
    _ensure_regular_directory(work_root)
    destination = work_root / f"{lease.job_id}-{lease.lease_id}"
    if destination.exists() or _is_link(destination):
        raise ValueError("O diretório de trabalho do job já existe.")
    if destination.parent.resolve(strict=True) != work_root.resolve(strict=True):
        raise ValueError("O workdir do job escapou da raiz configurada.")
    return destination


def _read_exact_output(out_path: Path, workdir: Path, workdir_identity: Path) -> bytes:
    """Lê somente ``out.<fmt>`` regular e contido, ignorando o path do adapter."""
    _validate_existing_ancestors(out_path)
    if _is_link(out_path) or _is_link(workdir) or not workdir.is_dir():
        raise RuntimeError("O exporter produziu um link em vez de um arquivo regular.")
    try:
        mode = out_path.stat(follow_symlinks=False).st_mode
        resolved = out_path.resolve(strict=True)
        root = workdir.resolve(strict=True)
    except OSError as exc:
        raise RuntimeError("O exporter não produziu o arquivo esperado.") from exc
    if root != workdir_identity or not stat.S_ISREG(mode) or not resolved.is_relative_to(root):
        raise RuntimeError("O arquivo exportado não está contido no workdir.")
    return out_path.read_bytes()


def _materialize_roundtrip_workdir(
    storage: Storage,
    workdir: Path,
    baseline_sha256: str,
    edited_sha256: str,
) -> Path:
    """Materializa somente os dois blobs íntegros esperados pelo round-trip."""
    _ensure_regular_directory(workdir)
    identity = workdir.resolve(strict=True)
    try:
        _write_blob_safely(workdir, Path("baseline.pptx"), storage.get(baseline_sha256))
        _write_blob_safely(workdir, Path("edited.pptx"), storage.get(edited_sha256))
    except Exception:
        with suppress(OSError, ValueError):
            _validate_existing_ancestors(workdir)
            if workdir.exists() and not _is_link(workdir) and workdir.resolve() == identity:
                shutil.rmtree(workdir)
        raise
    return identity


def _finish_success(
    session_factory,
    lease: _JobLease,
    document_id: str,
    checks: list[dict],
    sha256: str,
    fmt: str,
) -> None:
    """Persiste o resultado publicado e o verdict completo em uma transação."""
    with session_factory() as session:
        job = session.scalars(select(Job).where(Job.id == lease.job_id).with_for_update()).first()
        document = session.get(Document, document_id)
        if job is None or not _owns_lease(job, lease.lease_id):
            raise _LeaseLost("O job mudou de lease antes de concluir o export.")
        if document is None:
            raise RuntimeError("O documento do job não existe ao concluir o export.")
        job.checks = checks
        document.checks = checks
        job.status = "succeeded"
        job.params = {key: value for key, value in job.params.items() if key != _LEASE_KEY}
        job.result = {
            "sha256": sha256,
            "url": f"/v1/assets/{sha256}",
            "format": fmt,
            "filename": f"{document_id}.{fmt}",
        }
        job.error = None
        job.finished_at = datetime.now(UTC)
        session.commit()


def _finish_roundtrip_success(
    session_factory,
    lease: _JobLease,
    result: dict[str, Any],
) -> None:
    """Persiste o contrato completo do round-trip sem alterar checks do documento."""
    with session_factory() as session:
        job = session.scalars(select(Job).where(Job.id == lease.job_id).with_for_update()).first()
        if job is None or not _owns_lease(job, lease.lease_id):
            raise _LeaseLost("O job mudou de lease antes de concluir o round-trip.")
        job.status = "succeeded"
        job.params = {key: value for key, value in job.params.items() if key != _LEASE_KEY}
        job.result = result
        job.error = None
        job.finished_at = datetime.now(UTC)
        session.commit()


def _finish_carousel_success(
    session_factory,
    lease: _JobLease,
    carousel_id: str,
    checks: list[dict],
    sha256: str,
) -> None:
    """Publica um ZIP único sem associá-lo artificialmente a um slide."""
    with session_factory() as session:
        job = session.scalars(select(Job).where(Job.id == lease.job_id).with_for_update()).first()
        if job is None or not _owns_lease(job, lease.lease_id):
            raise _LeaseLost("O job mudou de lease antes de concluir o carrossel.")
        job.checks = checks
        job.status = "succeeded"
        job.params = {key: value for key, value in job.params.items() if key != _LEASE_KEY}
        job.result = {
            "sha256": sha256,
            "url": f"/v1/assets/{sha256}",
            "format": "zip",
            "filename": f"{carousel_id}.zip",
        }
        job.error = None
        job.finished_at = datetime.now(UTC)
        session.commit()


def _finish_failure(
    session_factory,
    lease: _JobLease,
    *,
    error: str,
    checks: list[dict] | None = None,
    document_id: str | None = None,
) -> bool:
    """Fecha o job como falha, sem jamais associar um blob de resultado."""
    with session_factory() as session:
        job = session.scalars(select(Job).where(Job.id == lease.job_id).with_for_update()).first()
        if job is None or not _owns_lease(job, lease.lease_id):
            return False
        job.status = "failed"
        job.params = {key: value for key, value in job.params.items() if key != _LEASE_KEY}
        job.result = None
        job.error = error
        job.finished_at = datetime.now(UTC)
        if checks is not None:
            job.checks = checks
            if document_id is not None:
                document = session.get(Document, document_id)
                if document is not None:
                    document.checks = checks
        session.commit()
        return True


def run_next_job(
    session_factory,
    *,
    storage: Storage,
    exporter: Exporter,
    settings: Settings,
    lease_timeout: timedelta = _LEASE_TIMEOUT,
    heartbeat_seconds: float = _HEARTBEAT_SECONDS,
) -> bool:
    """Processa no máximo um job, persistindo sucesso ou falha e limpando o workdir."""
    if heartbeat_seconds <= 0:
        raise ValueError("O intervalo do heartbeat precisa ser positivo.")
    lease = _claim_next_job(session_factory, lease_timeout=lease_timeout)
    if lease is None:
        return False

    workdir: Path | None = None
    workdir_identity: Path | None = None
    document_id: str | None = None
    kind: str | None = None
    try:
        kind = _load_job_kind(session_factory, lease)
        if kind == "export":
            (
                document_id,
                ir,
                layout,
                content,
                manifest,
                fmt,
                native_template_version,
            ) = _load_export_contract(session_factory, lease)
            workdir = _safe_job_workdir(settings.work_dir, lease)
            with _LeaseHeartbeat(session_factory, lease, heartbeat_seconds) as heartbeat:
                build_export_workdir(manifest, ir, content, storage, workdir)
                workdir_identity = workdir.resolve(strict=True)
                out_path = workdir / f"out.{fmt}"
                if out_path.exists() or _is_link(out_path):
                    raise ValueError("O manifest colide com o destino reservado do export.")
                outcome: ExportOutcome = exporter.export(
                    ir=ir,
                    layout=layout,
                    content=content,
                    assets_dir=workdir,
                    fmt=fmt,
                    out_path=out_path,
                    native_template_version=native_template_version,
                )
                checks = _serialize_checks(outcome.checks)
                if any(check["status"] == "blocked" for check in checks):
                    raise ExportRejected([GuardCheck.model_validate(check) for check in checks])
                heartbeat.ensure_owned()
                # Deliberadamente ignora outcome.path: só o destino pré-acordado é publicado.
                sha256 = storage.put(_read_exact_output(out_path, workdir, workdir_identity))
                heartbeat.ensure_owned()
                _finish_success(session_factory, lease, document_id, checks, sha256, fmt)
        elif kind == "carousel-export":
            carousel_id, ir, manifest, contracts = _load_carousel_export_contract(
                session_factory,
                lease,
            )
            workdir = _safe_job_workdir(settings.work_dir, lease)
            with _LeaseHeartbeat(session_factory, lease, heartbeat_seconds) as heartbeat:
                build_brand_workdir(manifest, ir, storage, workdir)
                workdir_identity = workdir.resolve(strict=True)
                serialized_checks: list[dict] = []
                slide_paths: list[tuple[int, Path]] = []
                for position, slide_document_id, layout, content in contracts:
                    out_path = workdir / f"slide-{position:02d}.png"
                    outcome = exporter.export(
                        ir=ir,
                        layout=layout,
                        content=content,
                        assets_dir=workdir,
                        fmt="png",
                        out_path=out_path,
                    )
                    checks = _serialize_checks(outcome.checks)
                    if any(check["status"] == "blocked" for check in checks):
                        raise ExportRejected([GuardCheck.model_validate(check) for check in checks])
                    serialized_checks.extend(checks)
                    slide_paths.append((position, out_path))
                    heartbeat.ensure_owned()
                    with session_factory() as session:
                        document = session.get(Document, slide_document_id)
                        if document is not None:
                            document.checks = checks
                            session.commit()
                zip_path = workdir / "out.zip"
                with zipfile.ZipFile(
                    zip_path,
                    mode="x",
                    compression=zipfile.ZIP_DEFLATED,
                ) as archive:
                    for position, slide_path in slide_paths:
                        archive.write(slide_path, arcname=f"{position:02d}.png")
                heartbeat.ensure_owned()
                sha256 = storage.put(_read_exact_output(zip_path, workdir, workdir_identity))
                heartbeat.ensure_owned()
                _finish_carousel_success(
                    session_factory,
                    lease,
                    carousel_id,
                    serialized_checks,
                    sha256,
                )
        elif kind in {"roundtrip-lint", "roundtrip-fix"}:
            document_id, ir, baseline_sha256, edited_sha256, plan = _load_roundtrip_contract(
                session_factory,
                lease,
                kind,
            )
            workdir = _safe_job_workdir(settings.work_dir, lease)
            with _LeaseHeartbeat(session_factory, lease, heartbeat_seconds) as heartbeat:
                workdir_identity = _materialize_roundtrip_workdir(
                    storage,
                    workdir,
                    baseline_sha256,
                    edited_sha256,
                )
                baseline_graph = parse_pptx_document_graph(workdir / "baseline.pptx")
                if kind == "roundtrip-lint":
                    edited_graph = parse_pptx_document_graph(workdir / "edited.pptx")
                    report = lint_roundtrip(baseline_graph, edited_graph, ir)
                    fix_plan = build_fix_plan(edited_graph, report)
                    heartbeat.ensure_owned()
                    _finish_roundtrip_success(
                        session_factory,
                        lease,
                        {
                            "kind": kind,
                            "baselineGraph": baseline_graph.model_dump(mode="json", by_alias=True),
                            "documentGraph": edited_graph.model_dump(mode="json", by_alias=True),
                            "report": report.model_dump(mode="json", by_alias=True),
                            "fixPlan": fix_plan.model_dump(mode="json", by_alias=True),
                        },
                    )
                else:
                    if plan is None:  # pragma: no cover - contrato fechado pelo loader
                        raise RuntimeError("O job de correção perdeu o Fix Plan.")
                    out_path = workdir / "out.pptx"
                    fix_result = apply_pptx_fix_plan(
                        workdir / "edited.pptx",
                        out_path,
                        plan,
                        baseline_graph,
                        ir,
                    )
                    heartbeat.ensure_owned()
                    sha256 = storage.put(_read_exact_output(out_path, workdir, workdir_identity))
                    if sha256 != fix_result.fixed_sha256:
                        raise RuntimeError("O blob publicado diverge do resultado do fixer.")
                    heartbeat.ensure_owned()
                    _finish_roundtrip_success(
                        session_factory,
                        lease,
                        {
                            "kind": kind,
                            "sha256": sha256,
                            "url": f"/v1/assets/{sha256}",
                            "format": "pptx",
                            "filename": f"{document_id}-corrigido.pptx",
                            "fixResult": fix_result.model_dump(mode="json", by_alias=True),
                        },
                    )
        elif kind in {"docx-brand-analyze", "docx-brand-apply"}:
            ir, manifest, source_sha256, source_filename, docx_plan = _load_docx_brand_contract(
                session_factory, lease, kind
            )
            workdir = _safe_job_workdir(settings.work_dir, lease)
            with _LeaseHeartbeat(session_factory, lease, heartbeat_seconds) as heartbeat:
                build_brand_workdir(manifest, ir, storage, workdir)
                source_path = workdir / "source.docx"
                if source_path.exists() or _is_link(source_path):
                    raise ValueError("O pacote da marca colide com a entrada reservada do Word.")
                _write_blob_safely(workdir, Path("source.docx"), storage.get(source_sha256))
                workdir_identity = workdir.resolve(strict=True)
                if kind == "docx-brand-analyze":
                    analyzed = analyze_docx_brand(source_path, ir)
                    analyzed = analyzed.model_copy(
                        update={
                            "source": analyzed.source.model_copy(
                                update={"filename": source_filename}
                            )
                        }
                    )
                    heartbeat.ensure_owned()
                    _finish_roundtrip_success(
                        session_factory,
                        lease,
                        {
                            "kind": kind,
                            "plan": analyzed.model_dump(mode="json", by_alias=True),
                        },
                    )
                else:
                    if docx_plan is None:  # pragma: no cover - fechado pelo loader
                        raise RuntimeError("O job de aplicação perdeu o plano do Word.")
                    out_path = workdir / "out.docx"
                    brand_result = apply_docx_brand_plan(
                        source_path,
                        out_path,
                        docx_plan,
                        ir,
                        asset_root=workdir,
                    )
                    heartbeat.ensure_owned()
                    sha256 = storage.put(_read_exact_output(out_path, workdir, workdir_identity))
                    if sha256 != brand_result.branded_sha256:
                        raise RuntimeError("O blob publicado diverge do Word validado.")
                    heartbeat.ensure_owned()
                    filename = f"{Path(source_filename).stem}-com-marca.docx"
                    _finish_roundtrip_success(
                        session_factory,
                        lease,
                        {
                            "kind": kind,
                            "sha256": sha256,
                            "url": f"/v1/assets/{sha256}",
                            "format": "docx",
                            "filename": filename,
                            "brandResult": brand_result.model_dump(mode="json", by_alias=True),
                        },
                    )
        else:
            raise RuntimeError("O tipo persistido do job não é suportado pelo worker.")
    except ExportRejected as exc:
        checks = _serialize_checks(exc.checks)
        _finish_failure(
            session_factory,
            lease,
            error="O render encontrou pendências — corrija antes de exportar.",
            checks=checks,
            document_id=document_id,
        )
    except _LeaseLost:
        # Outra tentativa possui o job; este worker só limpa seu workdir isolado.
        pass
    except Exception as exc:
        operation = (
            "export"
            if kind in {"export", "carousel-export"}
            else "aplicação de marca ao Word"
            if kind in {"docx-brand-analyze", "docx-brand-apply"}
            else "round-trip"
        )
        _finish_failure(
            session_factory,
            lease,
            error=f"Falha no {operation}: {exc}",
        )
    finally:
        if workdir is not None and workdir_identity is not None:
            with suppress(OSError, ValueError):
                _validate_existing_ancestors(workdir)
                if (
                    workdir.exists()
                    and not _is_link(workdir)
                    and workdir.resolve(strict=True) == workdir_identity
                ):
                    shutil.rmtree(workdir)
    return True


def run_worker(
    settings: Settings,
    *,
    poll_seconds: float = 1.0,
    once: bool = False,
) -> None:
    """Inicializa dependências do processo worker e executa seu loop de polling."""
    if poll_seconds < 0:
        raise ValueError("O intervalo de polling não pode ser negativo.")
    exporter: Exporter
    if settings.fake_exporter:
        exporter = FakeExporter()
    else:
        if settings.render_dist is None:
            raise RuntimeError("Defina BRANDRT_RENDER_DIST para iniciar o worker de export real.")
        exporter = DispatchingExporter(
            PlaywrightExporter(settings.render_dist),
            NativeOfficeExporter(),
        )

    storage = Storage(settings.storage_dir)
    engine = make_engine(settings.database_url)
    session_factory = make_session_factory(engine)
    try:
        if once:
            run_next_job(
                session_factory,
                storage=storage,
                exporter=exporter,
                settings=settings,
            )
            return
        while True:
            processed = run_next_job(
                session_factory,
                storage=storage,
                exporter=exporter,
                settings=settings,
            )
            if not processed:
                time.sleep(poll_seconds)
    finally:
        engine.dispose()
