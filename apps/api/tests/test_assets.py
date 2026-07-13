import hashlib

from tests.conftest import _png_bytes


def test_upload_e_download_png(client):
    data = _png_bytes()
    response = client.post("/v1/assets", files={"file": ("foto.png", data, "image/png")})
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["sha256"] == hashlib.sha256(data).hexdigest()
    assert body["size"] == len(data)

    downloaded = client.get(f"/v1/assets/{body['sha256']}")
    assert downloaded.status_code == 200
    assert downloaded.content == data
    assert downloaded.headers["content-type"] == "image/png"
    assert downloaded.headers["x-content-type-options"] == "nosniff"


def test_upload_nao_imagem_400(client):
    response = client.post(
        "/v1/assets",
        files={"file": ("x.png", b"MZ\x90\x00nada", "image/png")},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Envie uma imagem PNG ou JPEG."


def test_upload_jpeg_aceito_e_gif_recusado(client):
    import io

    from PIL import Image

    jpeg = io.BytesIO()
    Image.new("RGB", (8, 6), "navy").save(jpeg, format="JPEG")
    accepted = client.post(
        "/v1/assets",
        files={"file": ("foto.jpg", jpeg.getvalue(), "image/jpeg")},
    )
    assert accepted.status_code == 201

    gif = io.BytesIO()
    Image.new("RGB", (8, 6), "navy").save(gif, format="GIF")
    rejected = client.post(
        "/v1/assets",
        files={"file": ("foto.gif", gif.getvalue(), "image/gif")},
    )
    assert rejected.status_code == 400
    assert rejected.json()["detail"] == "Envie uma imagem PNG ou JPEG."


def test_upload_apng_animado_e_recusado_antes_do_storage(client):
    import io

    from PIL import Image

    buffer = io.BytesIO()
    first = Image.new("RGB", (8, 8), "blue")
    second = Image.new("RGB", (8, 8), "red")
    first.save(
        buffer,
        format="PNG",
        save_all=True,
        append_images=[second],
        duration=10,
        loop=0,
    )

    response = client.post(
        "/v1/assets",
        files={"file": ("animacao.png", buffer.getvalue(), "image/png")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Envie uma imagem estática em PNG ou JPEG."
    assert list(client.app.state.settings.storage_dir.rglob("*")) == []


def test_upload_pixels_demais_400(make_client):
    client = make_client(max_image_pixels=10_000)
    response = client.post(
        "/v1/assets",
        files={"file": ("g.png", _png_bytes(200, 200), "image/png")},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "A imagem é grande demais."


def test_upload_grande_demais_413(make_client):
    client = make_client(max_upload_bytes=10)
    response = client.post(
        "/v1/assets",
        files={"file": ("g.png", _png_bytes(2, 2), "image/png")},
    )
    assert response.status_code == 413
    assert response.json()["detail"] == "O arquivo enviado excede o tamanho máximo permitido."


def test_upload_bomba_do_pillow_400(make_client, monkeypatch):
    from PIL import Image

    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 10)
    client = make_client(max_image_pixels=10_000)
    response = client.post(
        "/v1/assets",
        files={"file": ("g.png", _png_bytes(20, 20), "image/png")},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "A imagem é grande demais."


def test_download_pdf_sniffado(client, tmp_path):
    from brand_api.storage import Storage

    storage = Storage(tmp_path / "var" / "storage")
    sha256 = storage.put(b"%PDF-1.4\nfake")
    downloaded = client.get(f"/v1/assets/{sha256}")
    assert downloaded.status_code == 200
    assert downloaded.headers["content-type"] == "application/pdf"
    assert downloaded.headers["x-content-type-options"] == "nosniff"


def test_download_404(client):
    assert client.get("/v1/assets/" + "0" * 64).status_code == 404
    assert client.get("/v1/assets/nao-e-um-sha").status_code == 404


def test_assets_exigem_token(anon):
    response = anon.post(
        "/v1/assets",
        files={"file": ("foto.png", _png_bytes(2, 2), "image/png")},
    )
    assert response.status_code == 401
