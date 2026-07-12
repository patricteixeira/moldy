"""CLI operacional da API HTTP do brand-runtime."""

from __future__ import annotations

import typer
import uvicorn

from brand_api.app import create_app
from brand_api.auth import mint_token
from brand_api.config import Settings
from brand_api.db import make_engine, make_session_factory
from brand_api.models import Base
from brand_api.worker import run_worker

app = typer.Typer(
    add_completion=False,
    no_args_is_help=True,
    help="Opera a API HTTP do brand-runtime.",
)


@app.command("serve")
def serve_command(
    host: str = typer.Option("127.0.0.1", "--host", help="Host local de escuta."),
    port: int = typer.Option(8000, "--port", help="Porta HTTP de escuta."),
) -> None:
    """Inicia o servidor HTTP com a configuração do ambiente."""
    uvicorn.run(create_app(Settings.from_env()), host=host, port=port)


@app.command("create-token")
def create_token_command(
    label: str | None = typer.Option(None, "--label", help="Rótulo opcional do convite."),
) -> None:
    """Cria um convite e imprime seu segredo somente nesta execução."""
    settings = Settings.from_env()
    engine = make_engine(settings.database_url)
    Base.metadata.create_all(engine)
    session_factory = make_session_factory(engine)
    try:
        with session_factory() as session:
            token = mint_token(session, label)
    finally:
        engine.dispose()
    typer.echo(token)


@app.command("worker")
def worker_command(
    poll_seconds: float = typer.Option(
        1.0,
        "--poll-seconds",
        help="Intervalo de polling quando a fila está vazia.",
    ),
    once: bool = typer.Option(
        False,
        "--once",
        help="Processa no máximo um job e encerra.",
    ),
) -> None:
    """Executa o processo separado que consome a fila de exports."""
    run_worker(Settings.from_env(), poll_seconds=poll_seconds, once=once)


if __name__ == "__main__":  # pragma: no cover - entry point instalado cobre este caminho
    app()
