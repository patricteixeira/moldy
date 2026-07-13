"""Superfície CLI do export e sua distinção entre erro e bloqueio."""

from __future__ import annotations

import json
import os

import pytest
from typer.testing import CliRunner

if os.environ.get("BRANDRT_REQUIRE_RENDER_TESTS") == "1":
    import playwright.sync_api  # noqa: F401
else:
    pytest.importorskip("playwright.sync_api", reason="extra [export] não instalado")

from brand_runtime.cli import app  # noqa: E402
from brand_runtime.kit.generator import generate_kit  # noqa: E402
from tests.test_generator import _ir  # noqa: E402

runner = CliRunner()


def _write_inputs(brand_package, tmp_path, layout_id, values):
    """Materializa IR, layout e content independentes para a CLI."""
    ir = _ir(brand_package)
    layout = next(item for item in generate_kit(ir) if item.id == layout_id)
    ir_path = tmp_path / "ir.json"
    ir_path.write_text(ir.model_dump_json(by_alias=True), encoding="utf-8")
    layout_path = tmp_path / "layout.json"
    layout_path.write_text(layout.model_dump_json(by_alias=True), encoding="utf-8")
    content_path = tmp_path / "content.json"
    content_path.write_text(
        json.dumps(
            {
                "layoutId": layout_id,
                "brandRevisionId": ir.revision.id,
                "values": values,
            }
        ),
        encoding="utf-8",
    )
    return ir_path, layout_path, content_path


def _invoke(paths, brand_package, render_dist, output):
    """Invoca brandrt export com as opções normativas."""
    ir_path, layout_path, content_path = paths
    return runner.invoke(
        app,
        [
            "export",
            str(ir_path),
            str(layout_path),
            str(content_path),
            "--assets-dir",
            str(brand_package),
            "--render-dist",
            str(render_dist),
            "--out",
            str(output),
        ],
    )


def test_cli_export_png(brand_package, render_dist, tmp_path):
    """CLI publica PNG e imprime o destino."""
    paths = _write_inputs(
        brand_package,
        tmp_path,
        "statement-post-1x1",
        {"headline": {"kind": "text", "text": "Olá"}},
    )
    output = tmp_path / "post.png"
    result = _invoke(paths, brand_package, render_dist, output)
    assert result.exit_code == 0, result.output
    assert output.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_cli_export_pdf_one_pager(brand_package, render_dist, tmp_path):
    """CLI publica PDF somente para doc-a4."""
    paths = _write_inputs(
        brand_package,
        tmp_path,
        "one-pager-doc-a4",
        {
            "title": {"kind": "text", "text": "Relatório"},
            "body": {"kind": "text", "text": "Corpo."},
        },
    )
    output = tmp_path / "doc.pdf"
    result = _invoke(paths, brand_package, render_dist, output)
    assert result.exit_code == 0, result.output
    assert output.read_bytes()[:5] == b"%PDF-"


def test_cli_export_pdf_de_post_falha_com_exit_2(brand_package, render_dist, tmp_path):
    """Erro operacional usa exit 2, distinto do Guard."""
    paths = _write_inputs(
        brand_package,
        tmp_path,
        "statement-post-1x1",
        {"headline": {"kind": "text", "text": "Olá"}},
    )
    result = _invoke(paths, brand_package, render_dist, tmp_path / "x.pdf")
    assert result.exit_code == 2


def test_cli_export_bloqueado_emite_verdict_exit_3_sem_arquivo(
    brand_package, render_dist, tmp_path
):
    """Bloqueio medido retorna o GuardVerdict em stderr sem arquivo parcial."""
    paths = _write_inputs(
        brand_package,
        tmp_path,
        "statement-post-1x1",
        {"headline": {"kind": "text", "text": "A\n" * 40}},
    )
    output = tmp_path / "blocked.png"
    result = _invoke(paths, brand_package, render_dist, output)
    assert result.exit_code == 3
    assert not output.exists()
    verdict = json.loads(result.stderr)
    assert any(check["id"] == "text-overflow" for check in verdict["checks"])
