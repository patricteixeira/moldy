from types import ModuleType, SimpleNamespace

import pytest

from brand_api.exporters import ExportOutcome, ExportRejected, FakeExporter, PlaywrightExporter
from brand_runtime import BrandIR, ContentSpec, LayoutSpec, run_static_checks
from brand_runtime.guard.static_checks import GuardCheck


def _contracts(client, compiled):
    from brand_api.models import BrandRevision

    with client.app.state.session_factory() as session:
        revision = session.get(BrandRevision, compiled["brandRevisionId"])
        assert revision is not None
        ir = BrandIR.model_validate(revision.ir)
        layout = LayoutSpec.model_validate(
            next(item for item in revision.kit if item["id"] == "statement-post-1x1")
        )
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={"headline": {"kind": "text", "text": "Lançamento em agosto"}},
    )
    return ir, layout, content


@pytest.mark.parametrize(
    ("fmt", "signature"),
    [("png", b"\x89PNG\r\n\x1a\n"), ("pdf", b"%PDF")],
)
def test_fake_exporter_escreve_formato_deterministico(client, compiled, tmp_path, fmt, signature):
    ir, layout, content = _contracts(client, compiled)
    out_path = tmp_path / f"out.{fmt}"

    outcome = FakeExporter().export(
        ir=ir,
        layout=layout,
        content=content,
        assets_dir=tmp_path,
        fmt=fmt,
        out_path=out_path,
    )

    assert outcome.path == out_path
    assert out_path.read_bytes().startswith(signature)
    assert outcome.checks == run_static_checks(ir, layout, content, tmp_path)


def test_export_rejected_preserva_checks():
    check = GuardCheck(
        id="text-overflow",
        slot_id="headline",
        status="blocked",
        message_pt="O texto ultrapassa a área disponível.",
    )

    error = ExportRejected([check])

    assert error.checks == [check]


def test_playwright_exporter_importa_adapter_apenas_ao_exportar(
    client, compiled, tmp_path, monkeypatch
):
    ir, layout, content = _contracts(client, compiled)
    checks = run_static_checks(ir, layout, content, tmp_path)
    calls = []
    fake_module = ModuleType("brand_runtime.export")

    class FakeBlocked(Exception):
        pass

    def fake_export_document(*args, **kwargs):
        calls.append((args, kwargs))
        kwargs["out_path"].write_bytes(b"ok")
        return SimpleNamespace(
            out_path=kwargs["out_path"],
            guard_verdict=SimpleNamespace(checks=checks),
        )

    fake_module.ExportBlocked = FakeBlocked
    fake_module.export_document = fake_export_document
    monkeypatch.setitem(__import__("sys").modules, "brand_runtime.export", fake_module)
    render_dist = tmp_path / "render-dist"
    render_dist.mkdir()
    (render_dist / "render.html").write_text("<!doctype html>", encoding="utf-8")
    exporter = PlaywrightExporter(render_dist)
    out_path = tmp_path / "out.png"

    outcome = exporter.export(
        ir=ir,
        layout=layout,
        content=content,
        assets_dir=tmp_path,
        fmt="png",
        out_path=out_path,
    )

    assert calls
    assert outcome == ExportOutcome(path=out_path, checks=checks)


def test_playwright_exporter_converte_bloqueio_sem_perder_checks(
    client, compiled, tmp_path, monkeypatch
):
    ir, layout, content = _contracts(client, compiled)
    check = GuardCheck(
        id="text-overflow",
        slot_id="headline",
        status="blocked",
        message_pt="O texto ultrapassa a área disponível.",
    )
    fake_module = ModuleType("brand_runtime.export")

    class FakeBlocked(Exception):
        def __init__(self):
            self.verdict = SimpleNamespace(checks=[check])

    def reject(*args, **kwargs):
        raise FakeBlocked

    fake_module.ExportBlocked = FakeBlocked
    fake_module.export_document = reject
    monkeypatch.setitem(__import__("sys").modules, "brand_runtime.export", fake_module)
    render_dist = tmp_path / "render-dist"
    render_dist.mkdir()
    (render_dist / "render.html").write_text("<!doctype html>", encoding="utf-8")

    with pytest.raises(ExportRejected) as raised:
        PlaywrightExporter(render_dist).export(
            ir=ir,
            layout=layout,
            content=content,
            assets_dir=tmp_path,
            fmt="png",
            out_path=tmp_path / "out.png",
        )

    assert raised.value.checks == [check]


def test_playwright_exporter_falha_cedo_sem_build_do_renderer(tmp_path):
    with pytest.raises(RuntimeError, match="render.html"):
        PlaywrightExporter(tmp_path / "render-dist-ausente")
