"""Equivalência de pixels preview/export e contenção exata da origem local."""

from __future__ import annotations

import os

import pytest

if os.environ.get("BRANDRT_REQUIRE_RENDER_TESTS") == "1":
    import playwright.sync_api  # noqa: F401
else:
    pytest.importorskip("playwright.sync_api", reason="extra [export] não instalado")

from PIL import Image, ImageChops  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

from brand_runtime.export import (  # noqa: E402
    DEFAULT_LAUNCH_ARGS,
    build_payload,
    export_document,
    open_render_page,
    serve_directory,
    stage_site,
)
from brand_runtime.kit.generator import generate_kit  # noqa: E402
from brand_runtime.kit.models import ContentSpec, TextValue  # noqa: E402
from tests.test_generator import _ir  # noqa: E402


def _statement(brand_package):
    """Monta a mesma entrada para os dois harnesses públicos."""
    ir = _ir(brand_package)
    layout = next(item for item in generate_kit(ir) if item.id == "statement-post-1x1")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={"headline": TextValue(text="Olá, marca")},
    )
    return ir, layout, content


def _install_payload(page, base, payload):
    """Replica o transporte serializado e pré-script usado pelo export."""
    page.goto(base, wait_until="load", timeout=30_000)
    page.evaluate(
        "payload => sessionStorage.setItem('__brandrt_payload__', JSON.stringify(payload))",
        payload,
    )
    page.add_init_script(
        "window.__PAYLOAD__ = JSON.parse(sessionStorage.getItem('__brandrt_payload__'));"
    )


def test_preview_e_export_sao_rgba_identicos(brand_package, render_dist, tmp_path):
    """Os harnesses públicos produzem pixels idênticos sem tolerância."""
    ir, layout, content = _statement(brand_package)
    exported = export_document(
        ir, layout, content, brand_package, render_dist, tmp_path / "export.png"
    )
    staging = stage_site(render_dist, brand_package, tmp_path / "preview-site")
    preview_path = tmp_path / "preview.png"
    with serve_directory(staging) as base, sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=list(DEFAULT_LAUNCH_ARGS))
        try:
            page = browser.new_page(
                viewport={"width": layout.canvas.width_px, "height": layout.canvas.height_px},
                device_scale_factor=1,
            )
            _install_payload(page, base, build_payload(ir, layout, content, f"{base}/pkg"))
            page.goto(f"{base}/preview.html", wait_until="load", timeout=30_000)
            page.wait_for_function(
                "() => window.__PREVIEW_DONE__ === true || "
                "typeof window.__PREVIEW_ERROR__ === 'string'",
                timeout=30_000,
            )
            assert page.evaluate("window.__PREVIEW_ERROR__") is None
            page.locator("#canvas").screenshot(
                path=str(preview_path),
                type="png",
                animations="disabled",
                caret="hide",
                scale="css",
            )
        finally:
            browser.close()

    expected = Image.open(exported.out_path).convert("RGBA")
    actual = Image.open(preview_path).convert("RGBA")
    assert ImageChops.difference(expected, actual).getbbox() is None


def test_runtime_aborta_url_externa_e_outra_porta_loopback(brand_package, render_dist, tmp_path):
    """Nem internet nem outro serviço local atravessam a política de origem."""
    ir, layout, content = _statement(brand_package)
    other_root = tmp_path / "other"
    other_root.mkdir()
    (other_root / "probe.txt").write_text("não deveria chegar", encoding="utf-8")
    with serve_directory(other_root) as other_base:
        with open_render_page(ir, layout, content, brand_package, render_dist) as page:
            failures = {}
            page.on(
                "requestfailed",
                lambda request: failures.__setitem__(request.url, request.failure),
            )
            urls = ["https://externo.invalid/probe", f"{other_base}/probe.txt"]
            results = page.evaluate(
                """async (urls) => Promise.all(urls.map(async (url) => {
                    try { await fetch(url); return true; } catch { return false; }
                }))""",
                urls,
            )
    assert results == [False, False]
    assert set(failures) == set(urls)
    assert all("ERR_FAILED" in (failure or "") for failure in failures.values())
