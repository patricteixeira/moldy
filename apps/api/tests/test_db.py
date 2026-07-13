import pytest
from sqlalchemy import inspect, select
from sqlalchemy.exc import IntegrityError

from brand_api.db import new_id
from brand_api.models import Draft, Job

CONTRACT_TABLES = {"brands", "drafts", "brand_revisions", "documents", "jobs", "invite_tokens"}


def test_create_all_cria_tabelas_do_contrato(pg_engine):
    assert CONTRACT_TABLES <= set(inspect(pg_engine).get_table_names())


def test_new_id_prefixo_e_unicidade():
    a, b = new_id("doc"), new_id("doc")
    assert a.startswith("doc_") and len(a) == len("doc_") + 12
    assert a != b


def test_status_de_job_invalido_rejeitado(db):
    db.add(
        Job(
            id=new_id("job"),
            kind="export",
            document_id=None,
            params={"format": "png"},
            status="estranho",
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_jsonb_round_trip(db):
    did = new_id("draft")
    payload = {"questions": [{"id": "color.primary", "candidates": [{"value": "#1A4D8F"}]}]}
    db.add(
        Draft(
            id=did,
            draft=payload,
            manifest={"manual.pdf": "0" * 64},
            ignored=[],
            package_path="var/packages/x",
        )
    )
    db.commit()
    db.expire_all()
    row = db.execute(select(Draft).where(Draft.id == did)).scalar_one()
    assert row.draft == payload
    assert row.manifest["manual.pdf"] == "0" * 64
