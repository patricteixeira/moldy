from tests.conftest import TEST_DB_URL


def test_healthz_sem_token(anon):
    r = anon.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_ping_sem_token_401(anon):
    r = anon.get("/v1/ping")
    assert r.status_code == 401
    assert "token" in r.json()["detail"].lower()


def test_ping_token_invalido_401(anon):
    r = anon.get("/v1/ping", headers={"Authorization": "Bearer nao-existe"})
    assert r.status_code == 401


def test_ping_com_token_ok(client):
    r = client.get("/v1/ping")
    assert r.status_code == 200
    assert r.json() == {"pong": True}


def test_token_por_query_param_e_recusado(anon):
    r = anon.get("/v1/ping", params={"token": "test-token"})
    assert r.status_code == 401


def test_settings_from_env(monkeypatch, tmp_path):
    from brand_api.config import Settings

    monkeypatch.setenv("BRANDRT_DATABASE_URL", TEST_DB_URL)
    monkeypatch.setenv("BRANDRT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("BRANDRT_FAKE_EXPORTER", "1")
    settings = Settings.from_env()
    assert settings.data_dir == tmp_path
    assert settings.fake_exporter is True
    assert settings.storage_dir == tmp_path / "storage"


def test_settings_from_env_exige_database_url(monkeypatch):
    import pytest

    from brand_api.config import Settings

    monkeypatch.delenv("BRANDRT_DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError):
        Settings.from_env()


def test_settings_oculta_segredos_e_recusa_limite_nao_positivo(monkeypatch):
    import pytest

    from brand_api.config import Settings

    settings = Settings(
        database_url="postgresql+psycopg://usuario:senha@localhost/db",
        bootstrap_token="convite-secreto",
    )
    representation = repr(settings)
    assert "senha" not in representation
    assert "convite-secreto" not in representation

    monkeypatch.setenv("BRANDRT_DATABASE_URL", "postgresql+psycopg://localhost/db")
    monkeypatch.setenv("BRANDRT_MAX_UPLOAD_BYTES", "0")
    with pytest.raises(RuntimeError, match="positivos"):
        Settings.from_env()


def test_create_token_cli(pg_engine, db, tmp_path, monkeypatch):
    from typer.testing import CliRunner

    from brand_api.auth import hash_token
    from brand_api.cli import app as cli_app
    from brand_api.models import InviteToken

    monkeypatch.setenv("BRANDRT_DATABASE_URL", TEST_DB_URL)
    monkeypatch.setenv("BRANDRT_DATA_DIR", str(tmp_path / "var"))
    result = CliRunner().invoke(cli_app, ["create-token", "--label", "amiga"])
    assert result.exit_code == 0, result.output
    token = result.output.strip().splitlines()[-1]
    row = db.get(InviteToken, hash_token(token))
    assert row is not None and row.label == "amiga"


def test_bootstrap_concorrente_e_idempotente(pg_engine, db):
    from concurrent.futures import ThreadPoolExecutor

    from sqlalchemy import func, select

    from brand_api.app import _seed_bootstrap_token
    from brand_api.db import make_session_factory
    from brand_api.models import InviteToken

    session_factory = make_session_factory(pg_engine)
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [
            executor.submit(_seed_bootstrap_token, session_factory, "convite-concorrente")
            for _ in range(16)
        ]
        for future in futures:
            future.result()

    db.expire_all()
    count = db.scalar(select(func.count()).select_from(InviteToken))
    assert count == 1


def test_app_remove_bootstrap_token_do_estado(make_client):
    client = make_client()
    assert client.app.state.settings.bootstrap_token is None
    assert client.app.state.engine is not None
