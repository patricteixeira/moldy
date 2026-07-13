from sqlalchemy import select

from brand_api.models import Document
from tests.conftest import _png_bytes


def _statement(compiled, text="Lançamento em agosto"):
    return {
        "layoutId": "statement-post-1x1",
        "brandRevisionId": compiled["brandRevisionId"],
        "values": {"headline": {"kind": "text", "text": text}},
    }


def test_cria_documento_checks_pass(client, compiled, db):
    response = client.post("/v1/documents", json=_statement(compiled))
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["documentId"].startswith("doc_")
    assert body["checks"], "guard deve rodar na criação"
    assert all(check["status"] == "pass" for check in body["checks"])

    persisted = db.scalar(select(Document).where(Document.id == body["documentId"]))
    assert persisted is not None
    assert persisted.content["layoutId"] == "statement-post-1x1"
    assert persisted.checks == body["checks"]


def test_violacao_reportada_sem_bloquear_criacao(client, compiled):
    response = client.post("/v1/documents", json=_statement(compiled, text="A" * 200))
    assert response.status_code == 201
    text_length = next(check for check in response.json()["checks"] if check["id"] == "text-length")
    assert text_length["status"] == "blocked"
    assert "200" in text_length["messagePt"]


def test_imagem_sem_upload_previo_422(client, compiled):
    payload = {
        "layoutId": "quote-post-1x1",
        "brandRevisionId": compiled["brandRevisionId"],
        "values": {
            "quote": {"kind": "text", "text": "Frase"},
            "photo": {"kind": "image", "path": "foto.png", "sha256": "0" * 64},
        },
    }
    response = client.post("/v1/documents", json=payload)
    assert response.status_code == 422
    assert response.json()["detail"] == "Imagem não encontrada — envie antes em /v1/assets."


def test_imagem_sem_sha_422(client, compiled):
    payload = {
        "layoutId": "quote-post-1x1",
        "brandRevisionId": compiled["brandRevisionId"],
        "values": {
            "quote": {"kind": "text", "text": "Frase"},
            "photo": {"kind": "image", "path": "foto.png"},
        },
    }
    response = client.post("/v1/documents", json=payload)
    assert response.status_code == 422
    assert response.json()["detail"] == "Imagem não encontrada — envie antes em /v1/assets."


def test_imagem_sem_path_e_conteudo_invalido(client, compiled):
    uploaded = client.post(
        "/v1/assets",
        files={"file": ("foto.png", _png_bytes(1200, 1200), "image/png")},
    )
    sha256 = uploaded.json()["sha256"]
    without_path = {
        "layoutId": "quote-post-1x1",
        "brandRevisionId": compiled["brandRevisionId"],
        "values": {
            "quote": {"kind": "text", "text": "Frase"},
            "photo": {"kind": "image", "sha256": sha256},
        },
    }
    response = client.post("/v1/documents", json=without_path)
    assert response.status_code == 422
    assert response.json()["detail"] == "Conteúdo inválido."


def test_imagem_enviada_passa_no_guard_e_no_preview(client, compiled, db):
    uploaded = client.post(
        "/v1/assets",
        files={"file": ("foto.png", _png_bytes(1200, 1200), "image/png")},
    )
    sha256 = uploaded.json()["sha256"]
    payload = {
        "layoutId": "quote-post-1x1",
        "brandRevisionId": compiled["brandRevisionId"],
        "values": {
            "quote": {"kind": "text", "text": "Frase"},
            "photo": {"kind": "image", "path": "../../ignorado.png", "sha256": sha256},
        },
    }
    response = client.post("/v1/documents", json=payload)
    assert response.status_code == 201, response.text
    resolution = next(
        check for check in response.json()["checks"] if check["id"] == "image-resolution"
    )
    assert resolution["status"] == "pass"

    path = f"sha256/{sha256[:2]}/{sha256[2:4]}/{sha256}"
    revision_id = compiled["brandRevisionId"]
    downloaded = client.get(f"/v1/brand-revisions/{revision_id}/assets/{path}")
    assert downloaded.status_code == 200
    assert downloaded.headers["content-type"] == "image/png"

    document_id = response.json()["documentId"]
    persisted = db.scalar(select(Document).where(Document.id == document_id))
    assert persisted is not None
    assert persisted.content["values"]["photo"]["path"] == path
    assert persisted.content["values"]["photo"]["sha256"] == sha256


def test_conteudo_invalido_422(client, compiled):
    payload = _statement(compiled)
    payload["values"]["headline"] = {"kind": "video", "path": "x.mp4"}
    response = client.post("/v1/documents", json=payload)
    assert response.status_code == 422
    assert response.json()["detail"] == "Conteúdo inválido."


def test_layout_desconhecido_422(client, compiled):
    response = client.post(
        "/v1/documents",
        json={
            "layoutId": "nao-existe",
            "brandRevisionId": compiled["brandRevisionId"],
            "values": {},
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Layout desconhecido para esta revisão."


def test_revisao_desconhecida_404(client):
    response = client.post(
        "/v1/documents",
        json={
            "layoutId": "statement-post-1x1",
            "brandRevisionId": "brandrev_nao_existe",
            "values": {},
        },
    )
    assert response.status_code == 404


def test_documents_exigem_token(anon):
    response = anon.post(
        "/v1/documents",
        json={
            "layoutId": "statement-post-1x1",
            "brandRevisionId": "brandrev_nao_existe",
            "values": {},
        },
    )
    assert response.status_code == 401
