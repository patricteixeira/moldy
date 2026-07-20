"""Factory síncrona da aplicação FastAPI do M1."""

from __future__ import annotations

from fastapi import Depends, FastAPI
from sqlalchemy.dialects.postgresql import insert

from brand_api.auth import hash_token, require_token
from brand_api.config import Settings
from brand_api.db import make_engine, make_session_factory
from brand_api.exporters import FakeExporter
from brand_api.fonts import build_font_resolver
from brand_api.fonts.models import FontResolver
from brand_api.models import Base, InviteToken
from brand_api.routes.assets import router as assets_router
from brand_api.routes.campaigns import router as campaigns_router
from brand_api.routes.carousels import router as carousels_router
from brand_api.routes.documents import router as documents_router
from brand_api.routes.docx_branding import router as docx_branding_router
from brand_api.routes.intake import router as intake_router
from brand_api.routes.jobs import router as jobs_router
from brand_api.routes.revisions import router as revisions_router
from brand_api.routes.roundtrip import router as roundtrip_router
from brand_api.storage import Storage
from brand_api.translation import build_identity_translator
from brand_runtime.intake.translation import IdentityTranslator


def _create_data_directories(settings: Settings) -> None:
    """Materializa todas as raízes locais antes de atender requisições."""
    for directory in (
        settings.data_dir,
        settings.storage_dir,
        settings.packages_dir,
        settings.work_dir,
    ):
        directory.mkdir(parents=True, exist_ok=True)


def _seed_bootstrap_token(session_factory, token: str | None) -> None:
    """Semeia o convite de bootstrap uma única vez sem persistir o segredo."""
    if token is None:
        return
    token_hash = hash_token(token)
    with session_factory() as session:
        statement = (
            insert(InviteToken)
            .values(token_hash=token_hash, label="bootstrap")
            .on_conflict_do_nothing(index_elements=[InviteToken.token_hash])
        )
        session.execute(statement)
        session.commit()


def create_app(
    settings: Settings,
    *,
    font_resolver: FontResolver | None = None,
    identity_translator: IdentityTranslator | None = None,
) -> FastAPI:
    """Constrói a app, o schema conhecido, o storage e suas dependências."""
    _create_data_directories(settings)
    engine = make_engine(settings.database_url)
    session_factory = make_session_factory(engine)
    Base.metadata.create_all(engine)
    storage = Storage(settings.storage_dir)
    _seed_bootstrap_token(session_factory, settings.bootstrap_token)

    app = FastAPI(title="brand-runtime API", version="0.1.0")
    app.state.settings = settings.model_copy(update={"bootstrap_token": None})
    app.state.engine = engine
    app.state.storage = storage
    app.state.session_factory = session_factory
    app.state.font_resolver = (
        font_resolver
        if font_resolver is not None
        else build_font_resolver(settings.font_fetch_base_url)
    )
    app.state.identity_translator = (
        identity_translator
        if identity_translator is not None
        else build_identity_translator(settings.translation_model_dir)
    )
    if settings.fake_exporter:
        app.state.exporter = FakeExporter()

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        """Confirma que o processo HTTP foi construído com sucesso."""
        return {"status": "ok"}

    @app.get("/v1/ping", dependencies=[Depends(require_token)])
    def ping() -> dict[str, bool]:
        """Confirma um token de convite válido para o cliente web."""
        return {"pong": True}

    app.include_router(intake_router)
    app.include_router(revisions_router)
    app.include_router(assets_router)
    app.include_router(campaigns_router)
    app.include_router(carousels_router)
    app.include_router(documents_router)
    app.include_router(docx_branding_router)
    app.include_router(jobs_router)
    app.include_router(roundtrip_router)

    return app
