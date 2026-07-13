"""Contratos puros do export, executáveis sem Playwright instalado."""

from __future__ import annotations

import hashlib

import pytest

from brand_runtime.export import ExportError, build_payload, normalize_pdf, stage_site
from brand_runtime.kit.generator import generate_kit
from brand_runtime.kit.models import ContentSpec, TextValue
from tests.test_generator import _ir


def _statement(brand_package):
    """Monta a tripla mínima usada nos testes de payload."""
    ir = _ir(brand_package)
    layout = next(item for item in generate_kit(ir) if item.id == "statement-post-1x1")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={"headline": TextValue(text="Olá, marca")},
    )
    return ir, layout, content


def test_build_payload_tem_as_quatro_chaves_camel_case(brand_package):
    """O browser recebe somente as quatro raízes estáveis e camelCase."""
    ir, layout, content = _statement(brand_package)
    payload = build_payload(ir, layout, content, "http://127.0.0.1:9/pkg")
    assert set(payload) == {"brandIr", "layoutSpec", "contentSpec", "assetsBaseUrl"}
    assert payload["layoutSpec"]["canvas"]["widthPx"] == 1080
    assert payload["brandIr"]["fonts"]["font.heading"]["fileSha256"]
    assert payload["contentSpec"]["layoutId"] == "statement-post-1x1"
    assert payload["assetsBaseUrl"] == "http://127.0.0.1:9/pkg"


def test_stage_site_monta_dist_pkg_e_fontes_por_hash(brand_package, tmp_path):
    """Dist e assets são cópias locais, com alias content-addressed de fonte."""
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "render.html").write_text("<!doctype html>", encoding="utf-8")
    (dist / "assets" / "page.js").write_text("//js", encoding="utf-8")
    staging = stage_site(dist, brand_package, tmp_path / "staging")
    assert (staging / "render.html").is_file()
    assert (staging / "assets" / "page.js").is_file()
    assert (staging / "pkg" / "assets" / "logos" / "logo.svg").is_file()
    font = brand_package / "fonts" / "fixture-sans-bold.ttf"
    sha256 = hashlib.sha256(font.read_bytes()).hexdigest()
    assert (staging / "pkg" / "fonts" / sha256).is_file()


def test_stage_site_sobrescreve_colisao_no_alias_sha(tmp_path):
    """Nome de origem não pode usurpar o alias content-addressed legítimo."""
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "render.html").write_text("<!doctype html>", encoding="utf-8")
    assets = tmp_path / "assets"
    fonts = assets / "fonts"
    fonts.mkdir(parents=True)
    legitimate = b"fonte-legitima"
    digest = hashlib.sha256(legitimate).hexdigest()
    (fonts / digest).write_bytes(b"bytes-impostores")
    (fonts / "legitima.ttf").write_bytes(legitimate)

    staging = stage_site(dist, assets, tmp_path / "staging")

    assert (staging / "pkg" / "fonts" / digest).read_bytes() == legitimate


def test_stage_site_sem_build_falha_com_instrucao(brand_package, tmp_path):
    """A ausência do build orienta explicitamente como materializá-lo."""
    with pytest.raises(ExportError, match="npm run build"):
        stage_site(tmp_path / "nao-existe", brand_package, tmp_path / "staging")


def test_stage_site_recusa_symlink_de_asset(brand_package, tmp_path):
    """Nenhum symlink do pacote pode atravessar a fronteira do staging."""
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "render.html").write_text("<!doctype html>", encoding="utf-8")
    target = tmp_path / "segredo.txt"
    target.write_text("segredo", encoding="utf-8")
    link = brand_package / "escape.png"
    try:
        link.symlink_to(target)
    except OSError:
        pytest.skip("criação de symlink indisponível neste ambiente")
    with pytest.raises(ExportError, match="link"):
        stage_site(dist, brand_package, tmp_path / "staging")


def test_normalize_pdf_zera_datas_e_id_preservando_tamanho():
    """A neutralização mantém offsets, é idempotente e cobre hex alfabético."""
    raw = (
        b"%PDF-1.7\n"
        b"/CreationDate (D:20260711120000+00'00')\n"
        b"/ModDate (D:20260711120000+00'00')\n"
        b"/ID [<AABB01> <CCDD02>]\ntrailer"
    )
    out = normalize_pdf(raw)
    assert len(out) == len(raw)
    assert b"20260711" not in out
    assert b"/CreationDate (D:00000000000000+00'00')" in out
    assert b"/ID [<000000> <000000>]" in out
    assert normalize_pdf(out) == out
