from sqlalchemy import func, select

from tests.conftest import _answers


def test_compile_cria_revisao(client, imported):
    response = client.post(
        f"/v1/drafts/{imported['draftId']}/compile",
        json={"answers": _answers(imported), "brandName": "ACME"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["brandRevisionId"].startswith("brandrev_")


def test_compile_idempotente(client, imported):
    payload = {"answers": _answers(imported), "brandName": "ACME"}
    first = client.post(f"/v1/drafts/{imported['draftId']}/compile", json=payload)
    second = client.post(f"/v1/drafts/{imported['draftId']}/compile", json=payload)
    assert first.status_code == second.status_code == 201
    assert first.json()["brandRevisionId"] == second.json()["brandRevisionId"]


def test_compile_reusa_marca_pelo_nome(client, imported, db):
    from brand_api.models import Brand

    payload = {"answers": _answers(imported), "brandName": "ACME"}
    client.post(f"/v1/drafts/{imported['draftId']}/compile", json=payload)
    client.post(f"/v1/drafts/{imported['draftId']}/compile", json=payload)
    assert db.execute(select(func.count()).select_from(Brand)).scalar_one() == 1


def test_compile_faltando_obrigatorios_422(client, imported):
    response = client.post(
        f"/v1/drafts/{imported['draftId']}/compile",
        json={"answers": {"values": {}}, "brandName": "ACME"},
    )
    assert response.status_code == 422
    assert "color.primary" in response.json()["detail"]


def test_compile_draft_inexistente_404(client):
    response = client.post(
        "/v1/drafts/draft_000000000000/compile",
        json={"answers": {"values": {}}, "brandName": "X"},
    )
    assert response.status_code == 404


def test_upserts_concorrentes_preservam_uma_marca_e_revisao(pg_engine, db):
    from concurrent.futures import ThreadPoolExecutor

    from sqlalchemy.orm import Session

    from brand_api.models import Brand, BrandRevision
    from brand_api.routes.intake import _insert_revision_once, _upsert_brand

    def write_once(_index):
        with Session(pg_engine) as session:
            brand = _upsert_brand(session, "ACME concorrente")
            _insert_revision_once(
                session,
                revision_id="brandrev_concorrente",
                brand_id=brand.id,
                ir={"revision": {"id": "brandrev_concorrente"}},
                kit=[],
                manifest={},
                package_path="var/packages/concorrente",
            )
            session.commit()
            return brand.id

    with ThreadPoolExecutor(max_workers=8) as executor:
        brand_ids = list(executor.map(write_once, range(12)))

    assert len(set(brand_ids)) == 1
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(Brand)) == 1
    assert db.scalar(select(func.count()).select_from(BrandRevision)) == 1
