import hashlib
import io
import json
import zipfile
from pathlib import Path

from brand_api.fonts.models import FontRequest, FontResolutionUnavailable, ResolvedFont
from brand_api.models import Draft
from brand_runtime.intake.draft import BrandDraft
from brand_runtime.ir.models import FontResource
from tests.conftest import _answers


class _FakeResolver:
    def __init__(self, font_data: bytes) -> None:
        self.font_data = font_data
        self.requests: list[FontRequest] = []

    async def resolve(self, request: FontRequest) -> ResolvedFont | None:
        self.requests.append(request)
        if request.family != "Fixture Sans" or request.weight != 700:
            return None
        license_data = b"SIL Open Font License 1.1\n"
        return ResolvedFont(
            family="Fixture Sans",
            weight=700,
            style="normal",
            data=self.font_data,
            license_data=license_data,
            resource=FontResource(
                provider="google-fonts",
                format="ttf",
                upstream_ref="google/fonts@" + "a" * 40 + ":ofl/fixturesans/Fixture.ttf",
                license_id="OFL-1.1",
                license_sha256=hashlib.sha256(license_data).hexdigest(),
                usage_policy="redistributable",
                coverage_profile="pt-BR-ui-v1",
            ),
        )


class _UnavailableResolver:
    async def resolve(self, request: FontRequest) -> ResolvedFont | None:
        raise FontResolutionUnavailable("offline")


class _ManualResolver:
    def __init__(self, font_data: bytes) -> None:
        self.font_data = font_data
        self.requests: list[FontRequest] = []

    async def resolve(self, request: FontRequest) -> ResolvedFont | None:
        self.requests.append(request)
        if request != FontRequest(family="Manual Sans", weight=400, style="normal"):
            return None
        license_data = b"SIL Open Font License 1.1\n"
        return ResolvedFont(
            family="Manual Sans",
            weight=400,
            style="normal",
            data=self.font_data,
            license_data=license_data,
            resource=FontResource(
                provider="google-fonts",
                format="ttf",
                upstream_ref="google/fonts@" + "b" * 40 + ":ofl/manualsans/ManualSans.ttf",
                license_id="OFL-1.1",
                license_sha256=hashlib.sha256(license_data).hexdigest(),
                usage_policy="redistributable",
                coverage_profile="pt-BR-ui-v1",
            ),
        )


class _CapacityResolver:
    def __init__(self) -> None:
        self.requests: list[FontRequest] = []

    async def resolve(self, request: FontRequest) -> ResolvedFont | None:
        self.requests.append(request)
        if not request.family.startswith("Limit Sans "):
            return None
        data = f"font-bytes:{request.family}".encode()
        license_data = b"SIL Open Font License 1.1\n"
        return ResolvedFont(
            family=request.family,
            weight=request.weight,
            style=request.style,
            data=data,
            license_data=license_data,
            resource=FontResource(
                provider="google-fonts",
                format="ttf",
                upstream_ref="google/fonts@" + "c" * 40 + ":ofl/limitsans/LimitSans.ttf",
                license_id="OFL-1.1",
                license_sha256=hashlib.sha256(license_data).hexdigest(),
                usage_policy="redistributable",
            ),
        )


def _draft_question(client, draft_id: str, question_id: str):
    """Inspeciona decisões visuais automáticas sem reexpô-las no contrato público."""
    with client.app.state.session_factory() as session:
        row = session.get(Draft, draft_id)
        draft = BrandDraft.model_validate(row.draft)
    return next(question for question in draft.questions if question.id == question_id)


def _package_without_font(
    package_zip: bytes,
    *,
    heading_family: str = "Fixture Sans",
    body_family: str = "Missing Sans",
) -> bytes:
    source = io.BytesIO(package_zip)
    destination = io.BytesIO()
    tokens = {
        "font": {
            "heading": {
                "family": {"$type": "fontFamily", "$value": heading_family},
                "weight": {"$type": "fontWeight", "$value": 700},
            },
            "body": {
                "family": {"$type": "fontFamily", "$value": body_family},
                "weight": {"$type": "fontWeight", "$value": 400},
            },
        }
    }
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(destination, "w") as output:
        for info in original.infolist():
            if not info.filename.startswith("fonts/"):
                output.writestr(info, original.read(info))
        output.writestr("tokens.json", json.dumps(tokens))
    return destination.getvalue()


def test_import_resolve_fonte_aberta_sem_upload_manual(
    make_client, package_zip, fixture_font_bytes
):
    resolver = _FakeResolver(fixture_font_bytes)
    client = make_client(font_resolver=resolver)

    response = client.post(
        "/v1/brands/imports",
        files={"package": ("marca.zip", _package_without_font(package_zip), "application/zip")},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    candidate = _draft_question(client, body["draftId"], "font.heading").candidates[0].value
    assert candidate["family"] == "Fixture Sans"
    assert candidate["path"].startswith("resolved-fonts/")
    assert candidate["resource"]["provider"] == "google-fonts"
    assert candidate["resource"]["usagePolicy"] == "redistributable"
    assert (
        client.get(f"/v1/drafts/{body['draftId']}/assets/{candidate['path']}").content
        == fixture_font_bytes
    )
    assert not any(
        item["code"] == "FONT_FILE_MISSING" and item["target"] == "Fixture Sans"
        for item in body["diagnostics"]
    )

    compiled = client.post(
        f"/v1/drafts/{body['draftId']}/compile",
        json={"answers": _answers(body), "brandName": "ACME tipografica"},
    )
    assert compiled.status_code == 201, compiled.text
    revision = client.get(f"/v1/brand-revisions/{compiled.json()['brandRevisionId']}").json()
    heading_token = revision["fonts"]["font.heading"]
    assert heading_token["source"] == "file"
    assert heading_token["fileSha256"] == hashlib.sha256(fixture_font_bytes).hexdigest()
    assert heading_token["resource"]["provider"] == "google-fonts"
    assert heading_token["resource"]["licenseId"] == "OFL-1.1"


def test_indisponibilidade_do_provedor_nao_bloqueia_import(make_client, package_zip):
    client = make_client(font_resolver=_UnavailableResolver())

    response = client.post(
        "/v1/brands/imports",
        files={"package": ("marca.zip", _package_without_font(package_zip), "application/zip")},
    )

    assert response.status_code == 201, response.text
    assert any(
        item["code"] == "FONT_AUTO_RESOLUTION_FAILED" for item in response.json()["diagnostics"]
    )


def test_fontshare_vira_previa_oficial_externa_sem_armazenar_bytes(make_client, package_zip):
    client = make_client()

    response = client.post(
        "/v1/brands/imports",
        files={
            "package": (
                "marca.zip",
                _package_without_font(
                    package_zip,
                    heading_family="Clash Display",
                    body_family="General Sans",
                ),
                "application/zip",
            )
        },
    )

    assert response.status_code == 201, response.text
    for question_id, family, code in (
        ("font.heading", "Clash Display", 700),
        ("font.body", "General Sans", 400),
    ):
        value = (
            _draft_question(
                client,
                response.json()["draftId"],
                question_id,
            )
            .candidates[0]
            .value
        )
        assert value["family"] == family
        assert "path" not in value
        assert value["resource"]["provider"] == "fontshare-external"
        assert value["resource"]["usagePolicy"] == "restricted"
        assert value["resource"]["upstreamRef"] == (
            "https://api.fontshare.com/v2/css?"
            f"f[]={family.casefold().replace(' ', '-')}@{code}&display=swap"
        )


def test_fonte_ja_fornecida_nao_dispara_resolucao(make_client, package_zip, fixture_font_bytes):
    resolver = _FakeResolver(fixture_font_bytes)
    client = make_client(font_resolver=resolver)

    response = client.post(
        "/v1/brands/imports",
        files={"package": ("marca.zip", package_zip, "application/zip")},
    )

    assert response.status_code == 201, response.text
    assert resolver.requests == []


def test_variante_nao_resolvida_preserva_diagnostico_da_familia(
    make_client, package_zip, fixture_font_bytes
):
    client = make_client(font_resolver=_FakeResolver(fixture_font_bytes))

    response = client.post(
        "/v1/brands/imports",
        files={
            "package": (
                "marca.zip",
                _package_without_font(package_zip, body_family="Fixture Sans"),
                "application/zip",
            )
        },
    )

    assert response.status_code == 201, response.text
    assert any(
        item["code"] == "FONT_FILE_MISSING"
        and item["target"] == "Fixture Sans"
        and "(400, normal)" in item["message"]
        for item in response.json()["diagnostics"]
    )


def test_nome_digitado_e_resolvido_sem_reenviar_pacote(
    make_client, package_zip, fixture_font_bytes
):
    resolver = _ManualResolver(fixture_font_bytes)
    client = make_client(font_resolver=resolver)
    imported = client.post(
        "/v1/brands/imports",
        files={"package": ("marca.zip", _package_without_font(package_zip), "application/zip")},
    )
    assert imported.status_code == 201, imported.text
    draft_id = imported.json()["draftId"]

    response = client.post(
        f"/v1/drafts/{draft_id}/fonts/resolve",
        json={"questionId": "font.body", "family": "  Manual   Sans  "},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "local-ready"
    assert body["candidate"]["value"]["family"] == "Manual Sans"
    assert body["candidate"]["value"]["path"].startswith("resolved-fonts/")
    assert any(item["sourceType"] == "manual-entry" for item in body["candidate"]["evidence"])
    asset = client.get(f"/v1/drafts/{draft_id}/assets/{body['candidate']['value']['path']}")
    assert asset.status_code == 200
    assert asset.content == fixture_font_bytes

    answers = _answers(imported.json())["values"]
    answers["font.body"] = body["candidate"]["value"]
    compiled = client.post(
        f"/v1/drafts/{draft_id}/compile",
        json={"answers": {"values": answers}, "brandName": "ACME manual"},
    )
    assert compiled.status_code == 201, compiled.text
    revision = client.get(f"/v1/brand-revisions/{compiled.json()['brandRevisionId']}").json()
    assert revision["fonts"]["font.body"]["family"] == "Manual Sans"
    assert revision["fonts"]["font.body"]["source"] == "file"


def test_nome_desconhecido_continua_como_escolha_explicita(make_client, package_zip):
    client = make_client()
    imported = client.post(
        "/v1/brands/imports",
        files={"package": ("marca.zip", _package_without_font(package_zip), "application/zip")},
    )
    draft_id = imported.json()["draftId"]

    response = client.post(
        f"/v1/drafts/{draft_id}/fonts/resolve",
        json={"questionId": "font.heading", "family": "Fonte Particular"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "not-found"
    assert response.json()["candidate"]["value"] == {
        "family": "Fonte Particular",
        "weight": 700,
        "style": "normal",
    }


def test_nome_digitado_escolhe_o_peso_catalogado_mais_proximo(make_client, package_zip):
    client = make_client()
    imported = client.post(
        "/v1/brands/imports",
        files={"package": ("marca.zip", _package_without_font(package_zip), "application/zip")},
    )
    draft_id = imported.json()["draftId"]

    response = client.post(
        f"/v1/drafts/{draft_id}/fonts/resolve",
        json={"questionId": "font.heading", "family": "Bebas Neue"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["candidate"]["value"]["family"] == "Bebas Neue"
    assert response.json()["candidate"]["value"]["weight"] == 400


def test_resolucao_manual_rejeita_campos_e_nomes_hostis(make_client, package_zip):
    client = make_client()
    imported = client.post(
        "/v1/brands/imports",
        files={"package": ("marca.zip", _package_without_font(package_zip), "application/zip")},
    )
    draft_id = imported.json()["draftId"]

    extra = client.post(
        f"/v1/drafts/{draft_id}/fonts/resolve",
        json={"questionId": "font.body", "family": "Inter", "url": "https://evil.invalid"},
    )
    control = client.post(
        f"/v1/drafts/{draft_id}/fonts/resolve",
        json={"questionId": "font.body", "family": "Inter\u0000Injected"},
    )

    assert extra.status_code == 422
    assert control.status_code == 422


def test_resolucao_manual_limita_crescimento_e_mantem_fontshare_disponivel(
    make_client, package_zip
):
    resolver = _CapacityResolver()
    client = make_client(font_resolver=resolver)
    imported = client.post(
        "/v1/brands/imports",
        files={"package": ("marca.zip", _package_without_font(package_zip), "application/zip")},
    )
    assert imported.status_code == 201, imported.text
    draft_id = imported.json()["draftId"]
    requests_after_import = len(resolver.requests)

    for index in range(4):
        response = client.post(
            f"/v1/drafts/{draft_id}/fonts/resolve",
            json={"questionId": "font.body", "family": f"Limit Sans {index}"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "local-ready"

    capped = client.post(
        f"/v1/drafts/{draft_id}/fonts/resolve",
        json={"questionId": "font.body", "family": "Limit Sans 5"},
    )
    assert capped.status_code == 200, capped.text
    assert capped.json()["status"] == "capacity-reached"
    assert len(resolver.requests) == requests_after_import + 4

    external = client.post(
        f"/v1/drafts/{draft_id}/fonts/resolve",
        json={"questionId": "font.body", "family": "General Sans"},
    )
    assert external.status_code == 200, external.text
    assert external.json()["status"] == "vendor-hosted"
    assert external.json()["candidate"]["value"]["resource"]["licenseId"] == "ITF-FFL-1.0"
    assert len(resolver.requests) == requests_after_import + 4


def test_resolucao_manual_recusa_nono_nome_novo(make_client, package_zip):
    client = make_client()
    imported = client.post(
        "/v1/brands/imports",
        files={"package": ("marca.zip", _package_without_font(package_zip), "application/zip")},
    )
    draft_id = imported.json()["draftId"]

    for index in range(8):
        response = client.post(
            f"/v1/drafts/{draft_id}/fonts/resolve",
            json={"questionId": "font.heading", "family": f"Fonte Privada {index}"},
        )
        assert response.status_code == 200, response.text

    rejected = client.post(
        f"/v1/drafts/{draft_id}/fonts/resolve",
        json={"questionId": "font.heading", "family": "Fonte Privada 9"},
    )
    assert rejected.status_code == 409
    assert "limite" in rejected.json()["detail"].casefold()


def test_retry_manual_publica_so_novos_blobs_e_remove_diagnostico(
    make_client, package_zip, fixture_font_bytes, monkeypatch
):
    client = make_client()
    imported = client.post(
        "/v1/brands/imports",
        files={
            "package": (
                "marca.zip",
                _package_without_font(package_zip, body_family="Manual Sans"),
                "application/zip",
            )
        },
    )
    assert imported.status_code == 201, imported.text
    body = imported.json()
    assert any(
        item["code"] == "FONT_FILE_MISSING" and item["target"] == "Manual Sans"
        for item in body["diagnostics"]
    )
    client.app.state.font_resolver = _ManualResolver(fixture_font_bytes)
    storage = client.app.state.storage
    original_put_file = storage.put_file
    stored_sizes: list[int] = []

    def recording_put_file(source: Path) -> str:
        stored_sizes.append(source.stat().st_size)
        return original_put_file(source)

    monkeypatch.setattr(storage, "put_file", recording_put_file)
    draft_id = body["draftId"]
    resolved = client.post(
        f"/v1/drafts/{draft_id}/fonts/resolve",
        json={"questionId": "font.body", "family": "Manual Sans"},
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "local-ready"
    assert len(stored_sizes) == 2

    stored_sizes.clear()
    repeated = client.post(
        f"/v1/drafts/{draft_id}/fonts/resolve",
        json={"questionId": "font.body", "family": "Manual Sans"},
    )
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["status"] == "local-ready"
    assert stored_sizes == []

    answers = _answers(body)["values"]
    answers["font.body"] = resolved.json()["candidate"]["value"]
    compiled = client.post(
        f"/v1/drafts/{draft_id}/compile",
        json={"answers": {"values": answers}, "brandName": "ACME retry manual"},
    )
    assert compiled.status_code == 201, compiled.text
    revision = client.get(f"/v1/brand-revisions/{compiled.json()['brandRevisionId']}").json()
    assert not any(
        item["code"] == "FONT_FILE_MISSING" and item["target"] == "Manual Sans"
        for item in revision["diagnostics"]
    )
