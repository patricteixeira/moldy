"""Exports reais PNG/PDF pelo renderer autoritativo."""

from __future__ import annotations

import os
import shutil
from contextlib import contextmanager

import pytest

if os.environ.get("BRANDRT_REQUIRE_RENDER_TESTS") == "1":
    import playwright.sync_api  # noqa: F401
else:
    pytest.importorskip("playwright.sync_api", reason="extra [export] não instalado")

from PIL import Image  # noqa: E402

from brand_runtime.export import ExportBlocked, export_document, normalize_pdf  # noqa: E402
from brand_runtime.kit.generator import generate_kit  # noqa: E402
from brand_runtime.kit.models import ContentSpec, ImageValue, TextValue  # noqa: E402
from tests.test_generator import _ir  # noqa: E402


def _statement(brand_package, text="Olá, marca"):
    """Monta um statement válido com texto variável."""
    ir = _ir(brand_package)
    layout = next(item for item in generate_kit(ir) if item.id == "statement-post-1x1")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={"headline": TextValue(text=text)},
    )
    return ir, layout, content


def test_png_tem_dimensoes_do_perfil_e_fundo_da_marca(brand_package, render_dist, tmp_path):
    """Screenshot cobre exatamente o canvas e aplica color.background."""
    ir, layout, content = _statement(brand_package)
    result = export_document(ir, layout, content, brand_package, render_dist, tmp_path / "post.png")
    image = Image.open(result.out_path).convert("RGB")
    assert image.size == (1080, 1080)
    assert image.getpixel((5, 5)) == (255, 255, 255)
    assert all(check.status == "pass" for check in result.guard_verdict.checks)


def test_png_deterministico_bytes_identicos(brand_package, render_dist, tmp_path):
    """Duas execuções do mesmo payload geram PNG byte a byte idêntico."""
    ir, layout, content = _statement(brand_package)
    first = export_document(ir, layout, content, brand_package, render_dist, tmp_path / "a.png")
    second = export_document(ir, layout, content, brand_package, render_dist, tmp_path / "b.png")
    assert first.out_path.read_bytes() == second.out_path.read_bytes()


def test_png_renderiza_slot_de_imagem_servido_localmente(brand_package, render_dist, tmp_path):
    """Imagem de conteúdo só é lida do staging na origem autorizada."""
    package = tmp_path / "pkg"
    shutil.copytree(brand_package, package)
    Image.new("RGB", (1080, 410), (10, 200, 30)).save(package / "foto.png")
    ir = _ir(package)
    layout = next(item for item in generate_kit(ir) if item.id == "announce-post-1x1")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={
            "headline": TextValue(text="Olá"),
            "body": TextValue(text="Corpo do anúncio."),
            "photo": ImageValue(path="foto.png"),
        },
    )
    result = export_document(ir, layout, content, package, render_dist, tmp_path / "announce.png")
    image = Image.open(result.out_path).convert("RGB")
    assert image.getpixel((5, 1075)) == (10, 200, 30)
    assert image.getpixel((5, 5)) == (255, 255, 255)


def test_pdf_doc_a4_uma_pagina_deterministico(brand_package, render_dist, tmp_path):
    """PDF A4 tem uma página, metadados neutros e bytes estáveis."""
    from pypdf import PdfReader

    ir = _ir(brand_package)
    layout = next(item for item in generate_kit(ir) if item.id == "one-pager-doc-a4")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={
            "title": TextValue(text="Relatório"),
            "body": TextValue(text="Um parágrafo simples de documento."),
        },
    )
    first = export_document(ir, layout, content, brand_package, render_dist, tmp_path / "a.pdf")
    second = export_document(ir, layout, content, brand_package, render_dist, tmp_path / "b.pdf")
    data = first.out_path.read_bytes()
    assert data[:5] == b"%PDF-"
    assert data == second.out_path.read_bytes()
    assert normalize_pdf(data) == data
    reader = PdfReader(str(first.out_path))
    assert len(reader.pages) == 1
    box = reader.pages[0].mediabox
    # Chromium 149 quantiza format="A4" para 595.91998×842.88 pt. O
    # contrato é o formato A4 autoritativo do browser, não clipping manual;
    # a tolerância cobre menos de 1,1 pt ante o A4 matemático.
    assert abs(float(box.width) - 595.276) <= 1.1
    assert abs(float(box.height) - 841.890) <= 1.1


def test_pdf_fora_do_doc_a4_recusado(brand_package, render_dist, tmp_path):
    """Posts não podem ser publicados como PDF."""
    ir, layout, content = _statement(brand_package)
    with pytest.raises(ValueError, match="doc-a4"):
        export_document(ir, layout, content, brand_package, render_dist, tmp_path / "x.pdf")


def test_sufixo_desconhecido_recusado(brand_package, render_dist, tmp_path):
    """A extensão é a única seleção de formato aceita pela API."""
    ir, layout, content = _statement(brand_package)
    with pytest.raises(ValueError, match=r"\.png ou \.pdf"):
        export_document(ir, layout, content, brand_package, render_dist, tmp_path / "x.gif")


def test_overflow_medido_bloqueia_sem_publicar_arquivo(brand_package, render_dist, tmp_path):
    """Arquivo só nasce depois do gate medido."""
    ir, layout, content = _statement(brand_package, "A\n" * 40)
    output = tmp_path / "x.png"
    with pytest.raises(ExportBlocked) as caught:
        export_document(ir, layout, content, brand_package, render_dist, output)
    assert any(
        check.id == "text-overflow" and check.status == "blocked"
        for check in caught.value.verdict.checks
    )
    assert not output.exists()


def test_preflight_estatico_preserva_destino_e_nao_abre_chromium(
    brand_package, tmp_path, monkeypatch
):
    """Bloqueio estático encerra antes do runtime e não altera arquivo anterior."""
    import brand_runtime.export as export_mod

    ir, layout, _content = _statement(brand_package)
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={},
    )
    output = tmp_path / "post.png"
    output.write_bytes(b"versao-anterior")

    @contextmanager
    def forbidden_runtime(*args, **kwargs):
        raise AssertionError("o Chromium não poderia abrir no preflight")
        yield  # pragma: no cover

    monkeypatch.setattr(export_mod, "open_render_page", forbidden_runtime)
    with pytest.raises(ExportBlocked):
        export_document(ir, layout, content, brand_package, tmp_path / "dist", output)
    assert output.read_bytes() == b"versao-anterior"


def test_falha_de_publicacao_preserva_destino_e_remove_temporario(
    brand_package, tmp_path, monkeypatch
):
    """Falha de replace mantém o arquivo anterior e não deixa parcial visível."""
    import brand_runtime.export as export_mod

    ir, layout, content = _statement(brand_package)
    output = tmp_path / "post.png"
    output.write_bytes(b"versao-anterior")

    class FakeLocator:
        """Locator mínimo que devolve bytes já renderizados."""

        def screenshot(self, **kwargs):
            return b"nova-versao"

    class FakePage:
        """Página mínima com report válido e screenshot."""

        def evaluate(self, expression):
            return {"overflows": [], "fontFallbacks": []}

        def locator(self, selector):
            assert selector == "#canvas"
            return FakeLocator()

    @contextmanager
    def fake_runtime(*args, **kwargs):
        yield FakePage()

    def fail_replace(source, destination):
        raise OSError("replace indisponível")

    monkeypatch.setattr(export_mod, "open_render_page", fake_runtime)
    monkeypatch.setattr(export_mod.os, "replace", fail_replace)
    with pytest.raises(export_mod.ExportError, match="publicar"):
        export_document(ir, layout, content, brand_package, tmp_path / "dist", output)
    assert output.read_bytes() == b"versao-anterior"
    assert list(tmp_path.glob(".post.png.*.tmp")) == []
