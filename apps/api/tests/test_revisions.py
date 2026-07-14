def test_get_ir_verbatim(client, compiled):
    response = client.get(f"/v1/brand-revisions/{compiled['brandRevisionId']}")
    assert response.status_code == 200
    ir = response.json()
    assert ir["schemaVersion"] == "0.3.0"
    assert ir["brand"]["name"] == "ACME"
    assert ir["revision"]["id"] == compiled["brandRevisionId"]
    assert "color.primary" in ir["colors"]


def test_get_kit_dez_layouts(client, compiled):
    response = client.get(f"/v1/brand-revisions/{compiled['brandRevisionId']}/kit")
    assert response.status_code == 200
    kit = response.json()
    assert len(kit) == 10
    assert len({layout["id"] for layout in kit}) == 10
    assert all("canvas" in layout and "slots" in layout for layout in kit)


def test_get_asset_do_pacote_sanitizado(client, compiled):
    revision = compiled["brandRevisionId"]
    response = client.get(f"/v1/brand-revisions/{revision}/assets/assets/logos/logo.svg")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/svg+xml")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert b"<script" not in response.content


def test_get_asset_sanitizado_do_draft_para_wizard(client, imported):
    draft_id = imported["draftId"]
    response = client.get(f"/v1/drafts/{draft_id}/assets/assets/logos/logo.svg")
    assert response.status_code == 200
    assert response.headers["x-content-type-options"] == "nosniff"
    assert b"<script" not in response.content


def test_get_fonte_por_sha(client, compiled):
    revision = compiled["brandRevisionId"]
    ir = client.get(f"/v1/brand-revisions/{revision}").json()
    sha256 = ir["fonts"]["font.heading"]["fileSha256"]
    assert sha256 and len(sha256) == 64
    response = client.get(f"/v1/brand-revisions/{revision}/assets/fonts/{sha256}")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/octet-stream"
    assert len(response.content) > 0


def test_404s(client, compiled):
    revision = compiled["brandRevisionId"]
    assert client.get("/v1/brand-revisions/brandrev_inexistente").status_code == 404
    assert client.get("/v1/brand-revisions/brandrev_inexistente/kit").status_code == 404
    assert client.get(f"/v1/brand-revisions/{revision}/assets/nao/existe.png").status_code == 404
