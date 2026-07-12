import threading
import time
from datetime import UTC, datetime, timedelta

from brand_api.db import new_id
from brand_api.exporters import ExportOutcome
from brand_api.models import BrandRevision, Document, Job
from brand_api.config import Settings
from brand_api.worker import build_export_workdir, run_next_job, run_worker
from brand_runtime import BrandIR, ContentSpec, LayoutSpec, run_static_checks
from brand_runtime.guard.static_checks import GuardCheck


def _queue_job(client, compiled, *, manifest=None):
    state = client.app.state
    with state.session_factory() as session:
        revision = session.get(BrandRevision, compiled["brandRevisionId"])
        assert revision is not None
        if manifest is not None:
            revision.manifest = manifest
        ir = BrandIR.model_validate(revision.ir)
        layout = LayoutSpec.model_validate(
            next(item for item in revision.kit if item["id"] == "statement-post-1x1")
        )
        content = ContentSpec(
            layout_id=layout.id,
            brand_revision_id=revision.id,
            values={"headline": {"kind": "text", "text": "Lançamento em agosto"}},
        )
        checks = run_static_checks(ir, layout, content, state.settings.storage_dir)
        serialized_checks = [check.model_dump(mode="json", by_alias=True) for check in checks]
        document_id = new_id("doc")
        job_id = new_id("job")
        session.add(
            Document(
                id=document_id,
                brand_revision_id=revision.id,
                layout_id=layout.id,
                content=content.model_dump(mode="json", by_alias=True),
                checks=serialized_checks,
            )
        )
        session.add(
            Job(
                id=job_id,
                kind="export",
                document_id=document_id,
                params={"format": "png"},
                status="queued",
                checks=serialized_checks,
            )
        )
        session.commit()
    return job_id


def _job(client, job_id):
    with client.app.state.session_factory() as session:
        job = session.get(Job, job_id)
        assert job is not None
        return {
            "status": job.status,
            "checks": job.checks,
            "result": job.result,
            "error": job.error,
            "finished_at": job.finished_at,
        }


def test_build_workdir_materializa_manifest_fontes_e_imagens(client, compiled, tmp_path):
    state = client.app.state
    image_sha = state.storage.put(b"imagem")
    with state.session_factory() as session:
        revision = session.get(BrandRevision, compiled["brandRevisionId"])
        assert revision is not None
        ir = BrandIR.model_validate(revision.ir)
        manifest = revision.manifest
    content = ContentSpec(
        layout_id="quote-post-1x1",
        brand_revision_id=ir.revision.id,
        values={
            "quote": {"kind": "text", "text": "Frase"},
            "photo": {
                "kind": "image",
                "path": f"sha256/{image_sha[:2]}/{image_sha[2:4]}/{image_sha}",
                "sha256": image_sha,
            },
        },
    )

    dest = build_export_workdir(manifest, ir, content, state.storage, tmp_path / "work")

    assert (dest / "manual.pdf").read_bytes() == state.storage.get(manifest["manual.pdf"])
    font_sha = ir.fonts["font.heading"].file_sha256
    assert font_sha is not None
    assert (dest / "fonts" / font_sha).read_bytes() == state.storage.get(font_sha)
    assert (dest / "sha256" / image_sha[:2] / image_sha[2:4] / image_sha).read_bytes() == b"imagem"


def test_build_workdir_recusa_traversal_sem_escrever_fora(client, compiled, tmp_path):
    state = client.app.state
    sha = state.storage.put(b"segredo")
    with state.session_factory() as session:
        revision = session.get(BrandRevision, compiled["brandRevisionId"])
        assert revision is not None
        ir = BrandIR.model_validate(revision.ir)
    content = ContentSpec(
        layout_id="statement-post-1x1",
        brand_revision_id=ir.revision.id,
        values={"headline": {"kind": "text", "text": "Texto"}},
    )

    try:
        build_export_workdir({"../escape.txt": sha}, ir, content, state.storage, tmp_path / "work")
    except ValueError as exc:
        assert "path" in str(exc).casefold() or "diret" in str(exc).casefold()
    else:
        raise AssertionError("Traversal deveria ser recusado.")
    assert not (tmp_path / "escape.txt").exists()


def test_worker_commita_claim_e_concorrencia_nao_duplica(client, compiled):
    state = client.app.state
    job_id = _queue_job(client, compiled)
    entered = threading.Event()
    release = threading.Event()
    calls = []

    class BlockingExporter:
        def export(self, *, ir, layout, content, assets_dir, out_path, **kwargs):
            calls.append(job_id)
            entered.set()
            assert release.wait(timeout=10)
            out_path.write_bytes(b"safe-output")
            return ExportOutcome(
                out_path,
                run_static_checks(ir, layout, content, assets_dir),
            )

    result = []
    thread = threading.Thread(
        target=lambda: result.append(
            run_next_job(
                state.session_factory,
                storage=state.storage,
                exporter=BlockingExporter(),
                settings=state.settings,
            )
        )
    )
    thread.start()
    assert entered.wait(timeout=10)
    assert _job(client, job_id)["status"] == "running"
    assert (
        run_next_job(
            state.session_factory,
            storage=state.storage,
            exporter=BlockingExporter(),
            settings=state.settings,
        )
        is False
    )
    release.set()
    thread.join(timeout=10)

    assert result == [True]
    assert calls == [job_id]
    assert _job(client, job_id)["status"] == "succeeded"


def test_worker_heartbeat_impede_reclaim_de_job_ativo(client, compiled):
    state = client.app.state
    job_id = _queue_job(client, compiled)
    entered = threading.Event()
    release = threading.Event()

    class BlockingExporter:
        def export(self, *, ir, layout, content, assets_dir, out_path, **kwargs):
            entered.set()
            assert release.wait(timeout=10)
            out_path.write_bytes(b"resultado-ativo")
            return ExportOutcome(
                out_path,
                run_static_checks(ir, layout, content, assets_dir),
            )

    result = []
    thread = threading.Thread(
        target=lambda: result.append(
            run_next_job(
                state.session_factory,
                storage=state.storage,
                exporter=BlockingExporter(),
                settings=state.settings,
                lease_timeout=timedelta(milliseconds=150),
                heartbeat_seconds=0.03,
            )
        )
    )
    thread.start()
    assert entered.wait(timeout=10)
    time.sleep(0.35)

    class ShouldNotRun:
        def export(self, **kwargs):
            raise AssertionError("Um job com heartbeat recente não pode ser recuperado.")

    assert (
        run_next_job(
            state.session_factory,
            storage=state.storage,
            exporter=ShouldNotRun(),
            settings=state.settings,
            lease_timeout=timedelta(milliseconds=150),
            heartbeat_seconds=0.03,
        )
        is False
    )
    release.set()
    thread.join(timeout=10)

    assert result == [True]
    assert _job(client, job_id)["status"] == "succeeded"


def test_worker_recupera_running_expirado(client, compiled):
    state = client.app.state
    job_id = _queue_job(client, compiled)
    with state.session_factory() as session:
        job = session.get(Job, job_id)
        assert job is not None
        job.status = "running"
        job.started_at = datetime.now(UTC) - timedelta(minutes=10)
        session.commit()

    class RecoveredExporter:
        def export(self, *, ir, layout, content, assets_dir, out_path, **kwargs):
            out_path.write_bytes(b"resultado-recuperado")
            return ExportOutcome(
                out_path,
                run_static_checks(ir, layout, content, assets_dir),
            )

    assert run_next_job(
        state.session_factory,
        storage=state.storage,
        exporter=RecoveredExporter(),
        settings=state.settings,
        lease_timeout=timedelta(minutes=5),
        heartbeat_seconds=0.03,
    )
    job = _job(client, job_id)
    assert job["status"] == "succeeded"
    assert state.storage.get(job["result"]["sha256"]) == b"resultado-recuperado"


def test_worker_antigo_nao_sobrescreve_tentativa_recuperada(client, compiled):
    state = client.app.state
    job_id = _queue_job(client, compiled)
    old_entered = threading.Event()
    release_old = threading.Event()

    class OldExporter:
        def export(self, *, ir, layout, content, assets_dir, out_path, **kwargs):
            old_entered.set()
            assert release_old.wait(timeout=10)
            out_path.write_bytes(b"resultado-antigo")
            return ExportOutcome(
                out_path,
                run_static_checks(ir, layout, content, assets_dir),
            )

    old_result = []
    old_thread = threading.Thread(
        target=lambda: old_result.append(
            run_next_job(
                state.session_factory,
                storage=state.storage,
                exporter=OldExporter(),
                settings=state.settings,
                lease_timeout=timedelta(0),
                heartbeat_seconds=60,
            )
        )
    )
    old_thread.start()
    assert old_entered.wait(timeout=10)

    class NewExporter:
        def export(self, *, ir, layout, content, assets_dir, out_path, **kwargs):
            out_path.write_bytes(b"resultado-novo")
            return ExportOutcome(
                out_path,
                run_static_checks(ir, layout, content, assets_dir),
            )

    assert run_next_job(
        state.session_factory,
        storage=state.storage,
        exporter=NewExporter(),
        settings=state.settings,
        lease_timeout=timedelta(0),
        heartbeat_seconds=0.03,
    )
    release_old.set()
    old_thread.join(timeout=10)

    job = _job(client, job_id)
    assert old_result == [True]
    assert job["status"] == "succeeded"
    assert state.storage.get(job["result"]["sha256"]) == b"resultado-novo"


def test_worker_ignora_outcome_externo_e_publica_out_path(client, compiled, tmp_path):
    state = client.app.state
    job_id = _queue_job(client, compiled)
    external = tmp_path / "externo.bin"
    external.write_bytes(b"nao-publicar")

    class ExternalOutcome:
        def export(self, *, ir, layout, content, assets_dir, out_path, **kwargs):
            out_path.write_bytes(b"publicar-isto")
            return ExportOutcome(
                external,
                run_static_checks(ir, layout, content, assets_dir),
            )

    assert run_next_job(
        state.session_factory,
        storage=state.storage,
        exporter=ExternalOutcome(),
        settings=state.settings,
    )
    result = _job(client, job_id)["result"]
    assert result is not None
    assert state.storage.get(result["sha256"]) == b"publicar-isto"


def test_worker_outcome_com_blocked_falha_fechado_e_limpa_workdir(client, compiled):
    state = client.app.state
    job_id = _queue_job(client, compiled)

    class SneakyOutcome:
        def export(self, *, out_path, **kwargs):
            out_path.write_bytes(b"nao-publicar")
            return ExportOutcome(
                out_path,
                [
                    GuardCheck(
                        id="text-overflow",
                        slot_id="headline",
                        status="blocked",
                        message_pt="O texto ultrapassa a área disponível.",
                    )
                ],
            )

    assert run_next_job(
        state.session_factory,
        storage=state.storage,
        exporter=SneakyOutcome(),
        settings=state.settings,
    )
    job = _job(client, job_id)
    assert job["status"] == "failed"
    assert job["result"] is None
    assert job["checks"][0]["status"] == "blocked"
    assert job["finished_at"] is not None
    assert not (state.settings.work_dir / job_id).exists()


def test_worker_erro_operacional_vira_failed_e_limpa_workdir(client, compiled):
    state = client.app.state
    job_id = _queue_job(client, compiled)

    class Boom:
        def export(self, **kwargs):
            raise RuntimeError("chromium sumiu")

    assert run_next_job(
        state.session_factory,
        storage=state.storage,
        exporter=Boom(),
        settings=state.settings,
    )
    job = _job(client, job_id)
    assert job["status"] == "failed"
    assert job["result"] is None
    assert job["error"] == "Falha no export: chromium sumiu"
    assert job["finished_at"] is not None
    assert not (state.settings.work_dir / job_id).exists()


def test_worker_falha_na_materializacao_sem_deixar_workdir_parcial(client, compiled):
    state = client.app.state
    job_id = _queue_job(client, compiled, manifest={"ausente.bin": "0" * 64})

    class ShouldNotRun:
        def export(self, **kwargs):
            raise AssertionError("O exporter não pode rodar sem todos os blobs.")

    assert run_next_job(
        state.session_factory,
        storage=state.storage,
        exporter=ShouldNotRun(),
        settings=state.settings,
    )
    job = _job(client, job_id)
    assert job["status"] == "failed"
    assert "Falha no export" in job["error"]
    assert not (state.settings.work_dir / job_id).exists()


def test_run_worker_real_falha_cedo_quando_render_dist_invalido(tmp_path):
    settings = Settings(
        database_url="postgresql+psycopg://invalido",
        data_dir=tmp_path / "var",
        fake_exporter=False,
        render_dist=tmp_path / "render-dist-ausente",
    )

    try:
        run_worker(settings, once=True)
    except RuntimeError as exc:
        assert "render.html" in str(exc)
    else:
        raise AssertionError("O worker real deveria validar o build antes do polling.")


def test_fila_vazia_retorna_false(client):
    state = client.app.state
    assert (
        run_next_job(
            state.session_factory,
            storage=state.storage,
            exporter=object(),
            settings=state.settings,
        )
        is False
    )
