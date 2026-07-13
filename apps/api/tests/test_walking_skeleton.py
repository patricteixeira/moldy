from tests.conftest import _answers, _png_bytes


def _run_one(client):
    from brand_api.worker import run_next_job

    state = client.app.state
    return run_next_job(
        state.session_factory,
        storage=state.storage,
        exporter=state.exporter,
        settings=state.settings,
    )


def test_walking_skeleton_api(client, package_zip):
    imported = client.post(
        "/v1/brands/imports",
        files={"package": ("marca.zip", package_zip, "application/zip")},
    ).json()
    revision_id = client.post(
        f"/v1/drafts/{imported['draftId']}/compile",
        json={"answers": _answers(imported), "brandName": "ACME"},
    ).json()["brandRevisionId"]
    ir = client.get(f"/v1/brand-revisions/{revision_id}").json()
    assert ir["revision"]["id"] == revision_id

    kit = client.get(f"/v1/brand-revisions/{revision_id}/kit").json()
    assert len(kit) == 10

    bad = client.post(
        "/v1/documents",
        json={
            "layoutId": "statement-post-1x1",
            "brandRevisionId": revision_id,
            "values": {"headline": {"kind": "text", "text": "A" * 200}},
        },
    ).json()
    assert any(check["status"] == "blocked" for check in bad["checks"])
    response = client.post(f"/v1/documents/{bad['documentId']}/exports", json={"format": "png"})
    assert response.status_code == 409

    low_resolution_sha = client.post(
        "/v1/assets",
        files={"file": ("low.png", _png_bytes(200, 200), "image/png")},
    ).json()["sha256"]
    bad_image = client.post(
        "/v1/documents",
        json={
            "layoutId": "quote-post-1x1",
            "brandRevisionId": revision_id,
            "values": {
                "quote": {"kind": "text", "text": "Frase"},
                "photo": {
                    "kind": "image",
                    "path": "low.png",
                    "sha256": low_resolution_sha,
                },
            },
        },
    ).json()
    assert any(
        check["id"] == "image-resolution" and check["status"] == "blocked"
        for check in bad_image["checks"]
    )

    document = client.post(
        "/v1/documents",
        json={
            "layoutId": "statement-post-1x1",
            "brandRevisionId": revision_id,
            "values": {"headline": {"kind": "text", "text": "Lançamento em agosto"}},
        },
    ).json()
    assert all(check["status"] == "pass" for check in document["checks"])
    job_id = client.post(
        f"/v1/documents/{document['documentId']}/exports", json={"format": "png"}
    ).json()["jobId"]
    assert _run_one(client) is True
    result = client.get(f"/v1/jobs/{job_id}").json()
    assert result["status"] == "succeeded"
    assert client.get(result["result"]["url"]).content[:8] == b"\x89PNG\r\n\x1a\n"

    document_pdf = client.post(
        "/v1/documents",
        json={
            "layoutId": "one-pager-doc-a4",
            "brandRevisionId": revision_id,
            "values": {
                "title": {"kind": "text", "text": "Relatório"},
                "body": {"kind": "text", "text": "Corpo do documento."},
            },
        },
    ).json()
    pdf_job_id = client.post(
        f"/v1/documents/{document_pdf['documentId']}/exports",
        json={"format": "pdf"},
    ).json()["jobId"]
    assert _run_one(client) is True
    pdf_result = client.get(f"/v1/jobs/{pdf_job_id}").json()
    pdf = client.get(pdf_result["result"]["url"])
    assert pdf.content[:4] == b"%PDF"
