from typer.testing import CliRunner

from brand_api.models import Document, Job
from tests.conftest import _png_bytes


def _make_doc(
    client,
    compiled,
    text="Lançamento em agosto",
    layout="statement-post-1x1",
    values=None,
):
    payload = {
        "layoutId": layout,
        "brandRevisionId": compiled["brandRevisionId"],
        "values": values or {"headline": {"kind": "text", "text": text}},
    }
    response = client.post("/v1/documents", json=payload)
    assert response.status_code == 201, response.text
    return response.json()["documentId"]


def _run_one(client):
    from brand_api.worker import run_next_job

    state = client.app.state
    return run_next_job(
        state.session_factory,
        storage=state.storage,
        exporter=state.exporter,
        settings=state.settings,
    )


def test_export_png_do_queued_ao_succeeded(client, compiled):
    document_id = _make_doc(client, compiled)
    response = client.post(f"/v1/documents/{document_id}/exports", json={"format": "png"})
    assert response.status_code == 202, response.text
    job_id = response.json()["jobId"]

    body = client.get(f"/v1/jobs/{job_id}").json()
    assert set(body) == {"id", "status", "result", "checks", "error"}
    assert body["status"] == "queued" and body["result"] is None
    assert body["checks"]

    assert _run_one(client) is True
    body = client.get(f"/v1/jobs/{job_id}").json()
    assert body["status"] == "succeeded"
    assert body["checks"]
    assert body["result"]["url"] == f"/v1/assets/{body['result']['sha256']}"

    png = client.get(body["result"]["url"])
    assert png.status_code == 200
    assert png.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_export_bloqueado_409_com_shape_raiz_exato_e_sem_job(client, compiled):
    document_id = _make_doc(client, compiled, text="A" * 200)
    response = client.post(f"/v1/documents/{document_id}/exports", json={"format": "png"})

    assert response.status_code == 409
    body = response.json()
    assert set(body) == {"detail", "checks"}
    assert body["detail"] == "O documento tem pendências do guard — corrija antes de exportar."
    assert any(
        check["id"] == "text-length" and check["status"] == "blocked" for check in body["checks"]
    )
    with client.app.state.session_factory() as session:
        assert session.query(Job).count() == 0


def test_enqueue_reexecuta_guard_em_vez_de_confiar_nos_checks_persistidos(client, compiled):
    document_id = _make_doc(client, compiled)
    with client.app.state.session_factory() as session:
        document = session.get(Document, document_id)
        assert document is not None
        document.content = {
            **document.content,
            "values": {"headline": {"kind": "text", "text": "A" * 200}},
        }
        document.checks = []
        session.commit()

    response = client.post(f"/v1/documents/{document_id}/exports", json={"format": "png"})

    assert response.status_code == 409
    assert any(check["status"] == "blocked" for check in response.json()["checks"])


def test_enqueue_descarta_check_bloqueado_obsoleto_quando_conteudo_passou(client, compiled):
    document_id = _make_doc(client, compiled)
    with client.app.state.session_factory() as session:
        document = session.get(Document, document_id)
        assert document is not None
        document.checks = [
            {
                "id": "obsoleto",
                "slotId": "headline",
                "status": "blocked",
                "messagePt": "Este check não corresponde mais ao conteúdo.",
                "detail": {},
            }
        ]
        session.commit()

    response = client.post(f"/v1/documents/{document_id}/exports", json={"format": "png"})

    assert response.status_code == 202
    assert set(response.json()) == {"jobId"}
    with client.app.state.session_factory() as session:
        job = session.get(Job, response.json()["jobId"])
        assert job is not None
        assert all(check["status"] != "blocked" for check in job.checks)


def test_pdf_so_para_doc_a4(client, compiled):
    document_id = _make_doc(client, compiled)
    response = client.post(f"/v1/documents/{document_id}/exports", json={"format": "pdf"})
    assert response.status_code == 422
    assert response.json()["detail"] == "Exporte PDF apenas para documentos (A4)."


def test_export_pdf_do_one_pager(client, compiled):
    document_id = _make_doc(
        client,
        compiled,
        layout="one-pager-doc-a4",
        values={
            "title": {"kind": "text", "text": "Relatório"},
            "body": {"kind": "text", "text": "Corpo do documento."},
        },
    )
    job_id = client.post(f"/v1/documents/{document_id}/exports", json={"format": "pdf"}).json()[
        "jobId"
    ]
    assert _run_one(client) is True
    body = client.get(f"/v1/jobs/{job_id}").json()
    assert body["status"] == "succeeded"
    pdf = client.get(body["result"]["url"])
    assert pdf.content[:4] == b"%PDF"
    assert pdf.headers["content-type"] == "application/pdf"


def test_job_que_estoura_vira_failed(client, compiled):
    from brand_api.worker import run_next_job

    class Boom:
        def export(self, **kwargs):
            raise RuntimeError("chromium sumiu")

    document_id = _make_doc(client, compiled)
    job_id = client.post(f"/v1/documents/{document_id}/exports", json={"format": "png"}).json()[
        "jobId"
    ]
    state = client.app.state
    assert run_next_job(
        state.session_factory,
        storage=state.storage,
        exporter=Boom(),
        settings=state.settings,
    )
    body = client.get(f"/v1/jobs/{job_id}").json()
    assert body["status"] == "failed"
    assert body["result"] is None
    assert "Falha no export" in body["error"]


def test_overflow_medido_vira_failed_com_checks_sem_blob(client, compiled):
    from brand_api.exporters import ExportRejected
    from brand_api.worker import run_next_job
    from brand_runtime.guard.static_checks import GuardCheck

    class MeasuredBlocker:
        def export(self, **kwargs):
            raise ExportRejected(
                [
                    GuardCheck(
                        id="text-overflow",
                        slot_id="headline",
                        status="blocked",
                        message_pt="O texto ultrapassa a área disponível.",
                        detail={"contentPx": 500, "boxPx": 432},
                    )
                ]
            )

    document_id = _make_doc(client, compiled)
    job_id = client.post(f"/v1/documents/{document_id}/exports", json={"format": "png"}).json()[
        "jobId"
    ]
    state = client.app.state
    assert run_next_job(
        state.session_factory,
        storage=state.storage,
        exporter=MeasuredBlocker(),
        settings=state.settings,
    )
    body = client.get(f"/v1/jobs/{job_id}").json()
    assert body["status"] == "failed" and body["result"] is None
    assert any(
        check["id"] == "text-overflow" and check["status"] == "blocked" for check in body["checks"]
    )


def test_fila_vazia_retorna_false(client):
    assert _run_one(client) is False


def test_workdir_materializa_as_duas_raizes(client, compiled):
    from brand_api.exporters import ExportOutcome
    from brand_api.worker import run_next_job
    from brand_runtime.guard.static_checks import run_static_checks

    seen = {}

    class Spy:
        def export(self, *, assets_dir, out_path, **kwargs):
            seen["paths"] = sorted(
                path.relative_to(assets_dir).as_posix()
                for path in assets_dir.rglob("*")
                if path.is_file()
            )
            out_path.write_bytes(b"\x89PNG\r\n\x1a\nfake")
            return ExportOutcome(
                out_path,
                run_static_checks(kwargs["ir"], kwargs["layout"], kwargs["content"], assets_dir),
            )

    sha256 = client.post(
        "/v1/assets",
        files={"file": ("foto.png", _png_bytes(1200, 1200), "image/png")},
    ).json()["sha256"]
    document_id = _make_doc(
        client,
        compiled,
        layout="quote-post-1x1",
        values={
            "quote": {"kind": "text", "text": "Frase"},
            "photo": {"kind": "image", "path": "foto.png", "sha256": sha256},
        },
    )
    client.post(f"/v1/documents/{document_id}/exports", json={"format": "png"})
    state = client.app.state
    assert run_next_job(
        state.session_factory,
        storage=state.storage,
        exporter=Spy(),
        settings=state.settings,
    )

    ir = client.get(f"/v1/brand-revisions/{compiled['brandRevisionId']}").json()
    font_sha = ir["fonts"]["font.heading"]["fileSha256"]
    assert "manual.pdf" in seen["paths"]
    assert "assets/logos/logo.svg" in seen["paths"]
    assert f"fonts/{font_sha}" in seen["paths"]
    assert f"sha256/{sha256[:2]}/{sha256[2:4]}/{sha256}" in seen["paths"]


def test_exports_documento_ausente_e_job_ausente_retornam_404(client):
    assert (
        client.post("/v1/documents/doc_000000000000/exports", json={"format": "png"}).status_code
        == 404
    )
    assert client.get("/v1/jobs/job_000000000000").status_code == 404


def test_format_invalido_e_campos_extras_retornam_422(client, compiled):
    document_id = _make_doc(client, compiled)
    assert (
        client.post(f"/v1/documents/{document_id}/exports", json={"format": "svg"}).status_code
        == 422
    )
    assert (
        client.post(
            f"/v1/documents/{document_id}/exports",
            json={"format": "png", "path": "fora.png"},
        ).status_code
        == 422
    )


def test_rotas_de_export_exigem_auth(anon, compiled, client):
    document_id = _make_doc(client, compiled)
    response = client.post(f"/v1/documents/{document_id}/exports", json={"format": "png"})
    job_id = response.json()["jobId"]

    assert (
        anon.post(f"/v1/documents/{document_id}/exports", json={"format": "png"}).status_code == 401
    )
    assert anon.get(f"/v1/jobs/{job_id}").status_code == 401


def test_app_expoe_exporter_fake_somente_quando_configurado(client, tmp_path):
    from fastapi.testclient import TestClient

    from brand_api.app import create_app

    assert client.app.state.exporter is not None
    settings = client.app.state.settings.model_copy(
        update={"data_dir": tmp_path / "real", "fake_exporter": False}
    )
    real_client = TestClient(create_app(settings))
    try:
        assert "exporter" not in real_client.app.state._state
    finally:
        real_client.close()
        real_client.app.state.engine.dispose()


def test_cli_worker_repassa_once_e_poll(monkeypatch, client):
    from brand_api import cli

    calls = []
    monkeypatch.setattr(cli.Settings, "from_env", lambda: client.app.state.settings)
    monkeypatch.setattr(
        cli,
        "run_worker",
        lambda settings, *, poll_seconds, once: calls.append((settings, poll_seconds, once)),
    )

    result = CliRunner().invoke(cli.app, ["worker", "--poll-seconds", "0.25", "--once"])

    assert result.exit_code == 0, result.output
    assert calls == [(client.app.state.settings, 0.25, True)]
