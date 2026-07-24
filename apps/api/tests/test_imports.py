import hashlib
import io
import json
import zipfile


def _post_zip(client, data: bytes):
    return client.post(
        "/v1/brands/imports",
        files={"package": ("marca.zip", data, "application/zip")},
    )


def _english_identity_package() -> bytes:
    import pymupdf

    with pymupdf.open() as document:
        page = document.new_page(width=595, height=842)
        page.insert_text((40, 60), "E S S E N C E & P O S I T I O N I N G", fontsize=12)
        page.insert_textbox(
            pymupdf.Rect(40, 90, 555, 190),
            "A quiet house. The brand exists to make complex things clear.",
            fontname="helv",
            fontsize=12,
        )
        page.insert_text((40, 230), "V O I C E & T O N E", fontsize=12)
        page.insert_textbox(
            pymupdf.Rect(40, 260, 555, 360),
            "Short, declarative sentences. Never use urgency or discount language.",
            fontname="helv",
            fontsize=12,
        )
        pdf = document.tobytes()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("manual.pdf", pdf)
    return output.getvalue()


def _declared_package(package_zip: bytes, *, bad_hash: bool = False) -> bytes:
    source = io.BytesIO(package_zip)
    output = io.BytesIO()
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(output, "w") as declared:
        files = []
        for info in original.infolist():
            data = original.read(info)
            declared.writestr(info, data)
            if info.filename.endswith(".pdf"):
                role, media_type = "guideline", "application/pdf"
            elif info.filename.endswith(".svg"):
                role, media_type = "logo", "image/svg+xml"
            else:
                role, media_type = "font", "font/ttf"
            digest = hashlib.sha256(data).hexdigest()
            files.append(
                {
                    "path": info.filename,
                    "role": role,
                    "mediaType": media_type,
                    "size": len(data),
                    "sha256": "0" * 64 if bad_hash and role == "guideline" else digest,
                }
            )
        declared.writestr(
            "brand-package.json",
            json.dumps(
                {
                    "schemaVersion": "0.1.0",
                    "adapter": {
                        "id": "org.brandruntime.reference",
                        "name": "Adapter de referência",
                        "version": "0.1.0",
                    },
                    "source": {"kind": "reference", "label": "Fixture ACME"},
                    "files": files,
                }
            ),
        )
    return output.getvalue()


def test_import_expoe_apenas_decisoes_que_realmente_pedem_revisao(client, package_zip):
    response = _post_zip(client, package_zip)
    assert response.status_code == 201, response.text
    server_timing = response.headers["server-timing"]
    assert "unpack;dur=" in server_timing
    assert "draft-analysis;dur=" in server_timing
    assert "persistence;dur=" in server_timing
    body = response.json()
    assert body["draftId"].startswith("draft_")
    assert set(body) == {"draftId", "questions", "diagnostics", "ignoredEntries"}
    assert all(question["id"] != "identity.expression" for question in body["questions"])
    assert all(not question["required"] or question["candidates"] for question in body["questions"])
    assert body["ignoredEntries"] == []

    from brand_runtime.intake.pdf_text import _cached_pdf_text

    assert _cached_pdf_text.cache_info().currsize == 0


def test_import_traduz_identidade_localmente_e_persiste_original(make_client):
    from brand_api.models import Draft

    class FakeLocalTranslator:
        identifier = "fake-local"

        def translate(self, text: str, *, field: str) -> str:
            return f"PT: {text}"

    client = make_client(identity_translator=FakeLocalTranslator())
    response = _post_zip(client, _english_identity_package())

    assert response.status_code == 201, response.text
    body = response.json()
    with client.app.state.session_factory() as session:
        stored = session.get(Draft, body["draftId"])
        stored_question = next(
            item for item in stored.draft["questions"] if item["id"] == "identity.expression"
        )
    value = stored_question["candidates"][0]["value"]
    assert value["translationStatus"] == "translated"
    assert value["sourceLanguage"] == "en"
    assert value["displayLanguage"] == "pt-BR"
    assert value["essence"].startswith("PT: ")
    assert value["original"]["essence"].startswith("A quiet house")

    assert stored_question["candidates"][0]["value"] == value


def test_import_aceita_brand_package_de_adapter_com_integridade(client, package_zip):
    response = _post_zip(client, _declared_package(package_zip))

    assert response.status_code == 201, response.text
    assert response.json()["draftId"].startswith("draft_")
    assert response.json()["ignoredEntries"] == []


def test_import_recusa_brand_package_com_hash_divergente_sem_deixar_estado(client, package_zip):
    response = _post_zip(client, _declared_package(package_zip, bad_hash=True))

    assert response.status_code == 400
    assert "SHA-256" in response.json()["detail"]
    assert list(client.app.state.settings.packages_dir.iterdir()) == []


def test_import_expoe_contrato_tipado_no_openapi(client):
    schema = client.app.openapi()["components"]["schemas"]["ImportResponse"]

    assert set(schema["required"]) == {
        "draftId",
        "questions",
        "diagnostics",
        "ignoredEntries",
    }


def test_import_incompleto_retorna_diagnosticos_acionaveis(client, package_zip):
    import io
    import zipfile

    def subset(*suffixes: str) -> bytes:
        source = io.BytesIO(package_zip)
        destination = io.BytesIO()
        with zipfile.ZipFile(source) as original, zipfile.ZipFile(destination, "w") as reduced:
            for info in original.infolist():
                if info.filename.endswith(suffixes):
                    reduced.writestr(info, original.read(info))
        return destination.getvalue()

    logo_only = _post_zip(client, subset(".svg"))
    assert logo_only.status_code == 201, logo_only.text
    logo_body = logo_only.json()
    assert any(item["code"] == "NO_PDF_FOUND" for item in logo_body["diagnostics"])
    assert any(
        question["required"] and not question["candidates"] for question in logo_body["questions"]
    )

    pdf_only = _post_zip(client, subset(".pdf"))
    assert pdf_only.status_code == 201, pdf_only.text
    pdf_body = pdf_only.json()
    assert any(item["code"] == "NO_LOGO_FOUND" for item in pdf_body["diagnostics"])
    logo_question = next(
        question for question in pdf_body["questions"] if question["id"] == "logo.primary"
    )
    assert logo_question["required"] is True
    assert logo_question["candidates"] == []


def test_import_sanitiza_svg_e_armazena_blobs(client, package_zip, tmp_path):
    body = _post_zip(client, package_zip).json()
    package = tmp_path / "var" / "packages" / body["draftId"]
    svg = (package / "assets" / "logos" / "logo.svg").read_bytes()
    assert b"<script" not in svg
    assert b"evil.example" not in svg
    sha256 = hashlib.sha256(svg).hexdigest()
    blob = tmp_path / "var" / "storage" / "sha256" / sha256[:2] / sha256[2:4] / sha256
    assert blob.is_file()


def test_import_zip_invalido_400(client):
    response = _post_zip(client, b"isto nao e um zip")
    assert response.status_code == 400
    assert "ZIP" in response.json()["detail"]


def test_import_grande_demais_413(make_client, package_zip):
    client = make_client(max_upload_bytes=10)
    response = _post_zip(client, package_zip)
    assert response.status_code == 413


def test_import_exige_token(anon, package_zip):
    response = anon.post(
        "/v1/brands/imports",
        files={"package": ("marca.zip", package_zip, "application/zip")},
    )
    assert response.status_code == 401


def test_fixture_font_tem_cmap_e_outlines_reais(package_zip):
    import io
    import zipfile

    from fontTools.ttLib import TTFont

    with zipfile.ZipFile(io.BytesIO(package_zip)) as archive:
        font_bytes = archive.read("fonts/fixture-sans-bold.ttf")
    font = TTFont(io.BytesIO(font_bytes))
    cmap = font.getBestCmap()
    assert all(ord(character) in cmap for character in "Olá, Lançamento Relatório")
    assert font["glyf"][cmap[ord("á")]].numberOfContours > 0


def test_svg_invalido_falha_sem_draft_pacote_ou_blob(client, db):
    import io
    import zipfile

    from sqlalchemy import func, select

    from brand_api.models import Draft

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(
            "assets/logos/logo.svg",
            b'<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///segredo">]><svg>&xxe;</svg>',
        )
    response = _post_zip(client, buffer.getvalue())
    assert response.status_code == 400
    assert response.json()["detail"] == "O pacote contém um SVG inválido."
    assert db.scalar(select(func.count()).select_from(Draft)) == 0
    assert list(client.app.state.settings.packages_dir.iterdir()) == []
    assert list(client.app.state.settings.storage_dir.rglob("*")) == []


def test_tokens_invalidos_falham_sem_estado_parcial(client, db):
    import io
    import zipfile

    from sqlalchemy import func, select

    from brand_api.models import Draft

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("tokens.json", b'{"color":')

    response = _post_zip(client, buffer.getvalue())

    assert response.status_code == 400
    assert response.json()["detail"] == "O pacote contém um arquivo de marca inválido."
    assert db.scalar(select(func.count()).select_from(Draft)) == 0
    assert list(client.app.state.settings.packages_dir.iterdir()) == []
    assert list(client.app.state.settings.storage_dir.rglob("*")) == []


def test_midia_invalida_falha_sem_estado_parcial(client, db):
    import io
    import zipfile

    from sqlalchemy import func, select

    from brand_api.models import Draft

    for path in ("manual.pdf", "assets/logos/logo.png", "fonts/quebrada.ttf"):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr(path, b"conteudo propositalmente invalido")

        response = _post_zip(client, buffer.getvalue())

        assert response.status_code == 400, (path, response.text)
        assert response.json()["detail"] == "O pacote contém um arquivo de marca inválido."
        assert db.scalar(select(func.count()).select_from(Draft)) == 0
        assert list(client.app.state.settings.packages_dir.iterdir()) == []
        assert list(client.app.state.settings.storage_dir.rglob("*")) == []


def test_logo_raster_acima_do_limite_falha_antes_do_build(make_client, db):
    import io
    import zipfile

    from PIL import Image
    from sqlalchemy import func, select

    from brand_api.models import Draft

    image_buffer = io.BytesIO()
    Image.new("RGB", (11, 10), "red").save(image_buffer, format="PNG")
    package_buffer = io.BytesIO()
    with zipfile.ZipFile(package_buffer, "w") as archive:
        archive.writestr("assets/logos/logo.png", image_buffer.getvalue())
    client = make_client(max_image_pixels=100)

    response = _post_zip(client, package_buffer.getvalue())

    assert response.status_code == 400
    assert response.json()["detail"] == "O pacote contém um arquivo de marca inválido."
    assert db.scalar(select(func.count()).select_from(Draft)) == 0
    assert list(client.app.state.settings.packages_dir.iterdir()) == []
    assert list(client.app.state.settings.storage_dir.rglob("*")) == []


def test_png_truncado_falha_como_entrada_invalida(client, db):
    import io
    import zipfile

    from PIL import Image
    from sqlalchemy import func, select

    from brand_api.models import Draft

    image_buffer = io.BytesIO()
    Image.new("RGB", (10, 10), "red").save(image_buffer, format="PNG")
    package_buffer = io.BytesIO()
    with zipfile.ZipFile(package_buffer, "w") as archive:
        archive.writestr("assets/logos/logo.png", image_buffer.getvalue()[:-10])

    response = _post_zip(client, package_buffer.getvalue())

    assert response.status_code == 400
    assert response.json()["detail"] == "O pacote contém um arquivo de marca inválido."
    assert db.scalar(select(func.count()).select_from(Draft)) == 0
    assert list(client.app.state.settings.packages_dir.iterdir()) == []
    assert list(client.app.state.settings.storage_dir.rglob("*")) == []


def test_ttf_truncado_falha_como_entrada_invalida(client, db, package_zip):
    import io
    import zipfile

    from sqlalchemy import func, select

    from brand_api.models import Draft

    with zipfile.ZipFile(io.BytesIO(package_zip)) as original:
        truncated = original.read("fonts/fixture-sans-bold.ttf")[:-1131]
    package_buffer = io.BytesIO()
    with zipfile.ZipFile(package_buffer, "w") as archive:
        archive.writestr("fonts/quebrada.ttf", truncated)

    response = _post_zip(client, package_buffer.getvalue())

    assert response.status_code == 400
    assert response.json()["detail"] == "O pacote contém um arquivo de marca inválido."
    assert db.scalar(select(func.count()).select_from(Draft)) == 0
    assert list(client.app.state.settings.packages_dir.iterdir()) == []
    assert list(client.app.state.settings.storage_dir.rglob("*")) == []


def test_import_reconhece_extensoes_uppercase(client, package_zip):
    import io
    import zipfile
    from pathlib import PurePosixPath

    source = io.BytesIO(package_zip)
    destination = io.BytesIO()
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(destination, "w") as uppercase:
        for info in original.infolist():
            path = PurePosixPath(info.filename)
            renamed = path.with_suffix(path.suffix.upper()).as_posix()
            uppercase.writestr(renamed, original.read(info))

    response = _post_zip(client, destination.getvalue())

    assert response.status_code == 201, response.text
    body = response.json()
    compiled = client.post(
        f"/v1/drafts/{body['draftId']}/compile",
        json={
            "answers": {"values": {}},
            "brandName": "ACME",
        },
    )
    assert compiled.status_code == 201, compiled.text
    ir = client.get(f"/v1/brand-revisions/{compiled.json()['brandRevisionId']}").json()
    assert ir["fonts"]["font.heading"]["family"] == "Fixture Sans"
    assert ir["assets"]["logo.primary"]["path"].endswith("logo.SVG")
