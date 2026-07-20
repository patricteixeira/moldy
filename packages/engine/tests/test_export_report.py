"""Adaptação tipada das medições do renderer para o Brand Guard."""

from __future__ import annotations

import os

import pytest

if os.environ.get("BRANDRT_REQUIRE_RENDER_TESTS") == "1":
    import playwright.sync_api  # noqa: F401
else:
    pytest.importorskip("playwright.sync_api", reason="extra [export] não instalado")

from brand_runtime.export import (  # noqa: E402
    ExportError,
    MeasuredGuardReport,
    build_guard_verdict,
    measure_guard_report,
    open_render_page,
)
from brand_runtime.kit.generator import generate_kit  # noqa: E402
from brand_runtime.kit.models import ContentSpec, Slot, TextValue  # noqa: E402
from tests.test_generator import _ir  # noqa: E402


def _triplet(brand_package, text):
    """Monta um statement com o texto solicitado."""
    ir = _ir(brand_package)
    layout = next(item for item in generate_kit(ir) if item.id == "statement-post-1x1")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={"headline": TextValue(text=text)},
    )
    return ir, layout, content


def test_fallback_de_fonte_usada_registrado_no_report(brand_package, render_dist):
    """Somente a fonte usada que não possui arquivo vira fallback confirmado."""
    ir = _ir(brand_package)
    layout = next(item for item in generate_kit(ir) if item.id == "one-pager-doc-a4")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={"title": TextValue(text="Título"), "body": TextValue(text="Corpo")},
    )
    report = measure_guard_report(ir, layout, content, brand_package, render_dist)
    tokens = {fallback.token for fallback in report.font_fallbacks}
    assert "font.body" in tokens
    assert "font.heading" not in tokens


def test_texto_curto_nao_tem_overflow(brand_package, render_dist):
    """Texto curto cabe no slot canônico do statement."""
    ir, layout, content = _triplet(brand_package, "Olá, marca")
    report = measure_guard_report(ir, layout, content, brand_package, render_dist)
    assert report.overflows == []


def test_overflow_medido_com_quarenta_linhas(brand_package, render_dist):
    """Altura real maior que a caixa é preservada no report."""
    ir, layout, content = _triplet(brand_package, "Linha de teste\n" * 40)
    report = measure_guard_report(ir, layout, content, brand_package, render_dist)
    overflow = {item.slot_id: item for item in report.overflows}
    assert "headline" in overflow
    assert overflow["headline"].box_px == 432
    assert overflow["headline"].content_px > 432


def test_report_vira_orientacoes_na_ordem_do_slot(brand_package):
    """Overflow e falha de carga orientam sem impedir a exportação."""
    ir, layout, content = _triplet(brand_package, "A\n" * 40)
    report = MeasuredGuardReport.model_validate(
        {
            "overflows": [{"slotId": "headline", "contentPx": 500, "boxPx": 432}],
            "fontFallbacks": [
                {
                    "slotId": "headline",
                    "token": "font.heading",
                    "family": "Fixture Sans",
                    "reason": "load-failed",
                }
            ],
        }
    )
    verdict = build_guard_verdict(ir, layout, content, brand_package, report)
    measured = [check for check in verdict.checks if check.id in {"text-overflow", "font-fallback"}]
    assert [(check.id, check.status) for check in measured] == [
        ("text-overflow", "warning"),
        ("font-fallback", "warning"),
    ]


def test_report_materializa_elemento_livre_uma_unica_vez(brand_package):
    """Elementos do documento participam do report sem colidir com o layout base."""
    ir, layout, content = _triplet(brand_package, "Olá, marca")
    content = ContentSpec(
        layout_id=content.layout_id,
        brand_revision_id=content.brand_revision_id,
        values={
            **content.values,
            "user-note-1": TextValue(text="Segunda voz"),
        },
        added_slots=[
            Slot(
                id="user-note-1",
                kind="text",
                role="heading",
                area=(48, 700, 400, 120),
                required=False,
            )
        ],
    )

    verdict = build_guard_verdict(
        ir,
        layout,
        content,
        brand_package,
        MeasuredGuardReport(overflows=[], font_fallbacks=[]),
    )

    assert all(check.id != "added-elements-contract" for check in verdict.checks)


def test_report_respeita_altura_editada_do_slot(brand_package):
    """A medição usa a caixa efetiva depois de mover ou redimensionar texto."""
    ir, layout, content = _triplet(brand_package, "A\n" * 40)
    content = ContentSpec(
        layout_id=content.layout_id,
        brand_revision_id=content.brand_revision_id,
        values=content.values,
        overrides={"headline": {"area": [48, 216, 984, 500]}},
    )
    report = MeasuredGuardReport.model_validate(
        {
            "overflows": [{"slotId": "headline", "contentPx": 640, "boxPx": 500}],
            "fontFallbacks": [],
        }
    )

    verdict = build_guard_verdict(ir, layout, content, brand_package, report)

    assert any(check.id == "text-overflow" for check in verdict.checks)


def test_fallback_confirmado_e_fixed(brand_package):
    """Fallback configurado é transparente e não bloqueia a publicação."""
    ir = _ir(brand_package)
    layout = next(item for item in generate_kit(ir) if item.id == "one-pager-doc-a4")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={"title": TextValue(text="Título"), "body": TextValue(text="Corpo")},
    )
    report = MeasuredGuardReport.model_validate(
        {
            "overflows": [],
            "fontFallbacks": [
                {
                    "slotId": "body",
                    "token": "font.body",
                    "family": "Helvetica",
                    "reason": "referenced-only",
                }
            ],
        }
    )
    verdict = build_guard_verdict(ir, layout, content, brand_package, report)
    fallback = next(check for check in verdict.checks if check.id == "font-fallback")
    assert fallback.status == "fixed"


def test_report_nao_pode_omitir_fallback_obrigatorio(brand_package):
    """Fonte sem arquivo precisa produzir uma medição explícita por slot usado."""
    ir = _ir(brand_package)
    layout = next(item for item in generate_kit(ir) if item.id == "one-pager-doc-a4")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={"title": TextValue(text="Título"), "body": TextValue(text="Corpo")},
    )
    report = MeasuredGuardReport(overflows=[], font_fallbacks=[])

    with pytest.raises(ExportError, match="omite.*fallback"):
        build_guard_verdict(ir, layout, content, brand_package, report)


@pytest.mark.parametrize(
    ("overflow", "fallback"),
    [
        ({"slotId": "headline", "contentPx": 432, "boxPx": 432}, None),
        ({"slotId": "headline", "contentPx": 500, "boxPx": 431}, None),
        (
            None,
            {
                "slotId": "headline",
                "token": "font.body",
                "family": "Fixture Sans",
                "reason": "load-failed",
            },
        ),
        (
            None,
            {
                "slotId": "headline",
                "token": "font.heading",
                "family": "Família forjada",
                "reason": "load-failed",
            },
        ),
        (
            None,
            {
                "slotId": "headline",
                "token": "font.heading",
                "family": "Fixture Sans",
                "reason": "configured-fallback",
            },
        ),
    ],
)
def test_report_forjado_e_recusado(brand_package, overflow, fallback):
    """Geometria e identidade tipográfica precisam derivar dos contratos."""
    ir, layout, content = _triplet(brand_package, "A\n" * 40)
    report = MeasuredGuardReport.model_validate(
        {
            "overflows": [] if overflow is None else [overflow],
            "fontFallbacks": [] if fallback is None else [fallback],
        }
    )
    with pytest.raises(ExportError, match="inconsistente"):
        build_guard_verdict(ir, layout, content, brand_package, report)


def test_render_error_vira_export_error(brand_package, render_dist, monkeypatch):
    """Erro publicado pela página não atravessa a API como timeout cru."""
    import brand_runtime.export as export_mod

    ir, layout, content = _triplet(brand_package, "Olá")
    monkeypatch.setattr(export_mod, "build_payload", lambda *args, **kwargs: {"brandIr": {}})
    with pytest.raises(ExportError):
        with open_render_page(ir, layout, content, brand_package, render_dist):
            pass
