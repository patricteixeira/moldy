import json
import hashlib

import pytest
from PIL import Image

from brand_runtime.guard.static_checks import GuardCheck, GuardVerdict
from brand_runtime.guard.static_checks import run_static_checks
from brand_runtime.ir.schema import export_schemas
from brand_runtime.kit.generator import generate_kit
from brand_runtime.kit.models import ContentSpec, ImageValue, TextValue
from tests.test_compile import _composition_ir
from tests.test_generator import _ir


def _layout(ir, layout_id):
    return next(layout for layout in generate_kit(ir) if layout.id == layout_id)


def _editorial_content(ir, layout, *, text="O OFÍCIO PEDE INTENÇÃO.", emphasis="INTENÇÃO"):
    values = {
        "index": TextValue(text="01"),
        "kicker": TextValue(text="PRINCÍPIO 01"),
        "headline": TextValue(text=text, emphasis=emphasis),
    }
    return ContentSpec(layout_id=layout.id, brand_revision_id=ir.revision.id, values=values)


def test_text_within_limit_passes(brand_package):
    ir = _ir(brand_package)
    layout = _layout(ir, "statement-post-1x1")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={"headline": TextValue(text="A" * 90)},
    )
    checks = run_static_checks(ir, layout, content, brand_package)
    by_id = {(check.id, check.slot_id): check.status for check in checks}
    assert by_id[("text-length", "headline")] == "pass"
    assert by_id[("contrast", "headline")] == "pass"


def test_text_overflow_blocked_with_counts(brand_package):
    ir = _ir(brand_package)
    layout = _layout(ir, "statement-post-1x1")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={"headline": TextValue(text="A" * 91)},
    )
    checks = run_static_checks(ir, layout, content, brand_package)
    check = next(check for check in checks if check.id == "text-length")
    assert check.status == "blocked"
    assert check.detail == {"chars": 91, "maxChars": 90}
    assert "91" in check.message_pt


def test_missing_required_slot_blocked(brand_package):
    ir = _ir(brand_package)
    layout = _layout(ir, "statement-post-1x1")
    content = ContentSpec(layout_id=layout.id, brand_revision_id=ir.revision.id, values={})
    checks = run_static_checks(ir, layout, content, brand_package)
    assert any(check.id == "required-slot" and check.status == "blocked" for check in checks)


def test_low_resolution_image_blocked(brand_package, tmp_path):
    from PIL import Image

    ir = _ir(brand_package)
    layout = _layout(ir, "quote-post-1x1")
    small = tmp_path / "small.png"
    Image.new("RGB", (200, 200), (10, 10, 10)).save(small)
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={"photo": ImageValue(path="small.png"), "quote": TextValue(text="Frase")},
    )
    checks = run_static_checks(ir, layout, content, tmp_path)
    check = next(check for check in checks if check.id == "image-resolution")
    assert check.status == "blocked"


def test_raster_sem_extensao_e_validado_pelo_conteudo(brand_package, tmp_path):
    ir = _ir(brand_package)
    layout = _layout(ir, "quote-post-1x1")
    image_path = tmp_path / ("a" * 64)
    Image.new("RGB", (1080, 1080), (10, 10, 10)).save(image_path, format="PNG")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={
            "photo": ImageValue(path=image_path.name),
            "quote": TextValue(text="Frase"),
        },
    )

    check = next(
        check
        for check in run_static_checks(ir, layout, content, tmp_path)
        if check.id == "image-resolution"
    )

    assert check.status == "pass"
    assert check.detail == {
        "width": 1080,
        "height": 1080,
        "minWidth": 1080,
        "minHeight": 1080,
    }


def test_bad_contrast_detected_with_doctored_ir(brand_package):
    ir = _ir(brand_package)
    ir = ir.model_copy(deep=True)
    ir.colors["color.primary"].value = "#FEFEFE"  # quase branco sobre fundo branco
    layout = _layout(ir, "statement-post-1x1")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={"headline": TextValue(text="Olá")},
    )
    checks = run_static_checks(ir, layout, content, brand_package)
    contrast = [check for check in checks if check.id == "contrast" and check.slot_id == "headline"]
    assert contrast and contrast[0].status == "blocked"


def test_guard_check_contract_accepts_fixed_and_has_isolated_details():
    fixed = GuardCheck(id="measured-overflow", status="fixed", message_pt="Ajustado.")
    other = GuardCheck(id="contrast", status="pass", message_pt="Aprovado.")
    fixed.detail["x"] = 1
    assert other.detail == {}
    data = json.loads(GuardVerdict(checks=[fixed]).model_dump_json(by_alias=True))
    assert data == {
        "checks": [
            {
                "id": "measured-overflow",
                "slotId": None,
                "status": "fixed",
                "messagePt": "Ajustado.",
                "detail": {"x": 1},
            }
        ]
    }


def test_statement_check_order_is_stable(brand_package):
    ir = _ir(brand_package)
    layout = _layout(ir, "statement-post-1x1")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={"headline": TextValue(text="Texto")},
    )
    first = run_static_checks(ir, layout, content, brand_package)
    second = run_static_checks(ir, layout, content, brand_package)
    assert [(check.id, check.slot_id) for check in first] == [
        ("text-length", "headline"),
        ("contrast", "headline"),
    ]
    assert [check.model_dump_json(by_alias=True) for check in first] == [
        check.model_dump_json(by_alias=True) for check in second
    ]
    assert all(check.status == "pass" for check in first)


def test_required_whitespace_is_blocked_but_contrast_is_still_evaluated(brand_package):
    ir = _ir(brand_package)
    layout = _layout(ir, "statement-post-1x1")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={"headline": TextValue(text="   ")},
    )
    checks = run_static_checks(ir, layout, content, brand_package)
    assert [(check.id, check.slot_id) for check in checks] == [
        ("required-slot", "headline"),
        ("contrast", "headline"),
    ]


def test_quote_complete_checks_text_and_raster_only(brand_package, tmp_path):
    ir = _ir(brand_package)
    layout = _layout(ir, "quote-post-1x1")
    Image.new("RGB", (1080, 1080), (10, 10, 10)).save(tmp_path / "photo.jpg")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={
            "photo": ImageValue(path="photo.jpg"),
            "quote": TextValue(text="Frase"),
        },
    )
    checks = run_static_checks(ir, layout, content, tmp_path)
    assert [(check.id, check.slot_id) for check in checks] == [
        ("text-length", "quote"),
        ("image-resolution", "photo"),
    ]
    assert all(check.status == "pass" for check in checks)


def test_contract_unknown_slot_and_wrong_kind_are_blocked(brand_package):
    ir = _ir(brand_package)
    layout = _layout(ir, "statement-post-1x1")
    content = ContentSpec(
        layout_id="outro-layout",
        brand_revision_id="brandrev_outro",
        values={
            "headline": ImageValue(path="photo.png"),
            "fantasma": TextValue(text="não existe"),
        },
    )
    checks = run_static_checks(ir, layout, content, brand_package)
    assert [check.id for check in checks[:4]] == [
        "document-contract",
        "document-contract",
        "unknown-slot",
        "content-type",
    ]
    assert all(check.status == "blocked" for check in checks[:4])


@pytest.mark.parametrize("unsafe", ["../outside.png", "C:/outside.png"])
def test_image_path_cannot_escape_assets_dir(brand_package, tmp_path, unsafe):
    ir = _ir(brand_package)
    layout = _layout(ir, "quote-post-1x1")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={
            "photo": ImageValue(path=unsafe),
            "quote": TextValue(text="Frase"),
        },
    )
    check = next(
        check
        for check in run_static_checks(ir, layout, content, tmp_path)
        if check.id == "image-resolution"
    )
    assert check.status == "blocked"
    assert check.message_pt == "A imagem de «photo» não foi encontrada."


def test_svg_corrupt_raster_and_image_bomb_are_blocked(brand_package, tmp_path, monkeypatch):
    ir = _ir(brand_package)
    layout = _layout(ir, "quote-post-1x1")

    (tmp_path / "photo.svg").write_text("<svg/>", encoding="utf-8")
    (tmp_path / "corrupt.png").write_bytes(b"nao e png")
    Image.new("RGB", (10, 10), (0, 0, 0)).save(tmp_path / "bomb.png")

    def verdict(path):
        content = ContentSpec(
            layout_id=layout.id,
            brand_revision_id=ir.revision.id,
            values={"photo": ImageValue(path=path), "quote": TextValue(text="Frase")},
        )
        return next(
            check
            for check in run_static_checks(ir, layout, content, tmp_path)
            if check.id == "image-resolution"
        )

    assert verdict("photo.svg").status == "blocked"
    assert verdict("corrupt.png").status == "blocked"
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1)
    assert verdict("bomb.png").status == "blocked"


def test_guard_never_mutates_inputs(brand_package, tmp_path):
    ir = _ir(brand_package)
    layout = _layout(ir, "quote-post-1x1")
    Image.new("RGB", (1080, 1080), (10, 10, 10)).save(tmp_path / "photo.png")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={
            "photo": ImageValue(path="photo.png"),
            "quote": TextValue(text="Frase integral"),
        },
    )
    before = tuple(item.model_dump(mode="json") for item in (ir, layout, content))
    run_static_checks(ir, layout, content, tmp_path)
    after = tuple(item.model_dump(mode="json") for item in (ir, layout, content))
    assert after == before


def test_every_image_is_validated_even_without_minimum(brand_package, tmp_path):
    ir = _ir(brand_package)
    layout = _layout(ir, "quote-post-1x1").model_copy(deep=True)
    photo = next(slot for slot in layout.slots if slot.id == "photo")
    photo.min_resolution = None
    Image.new("RGB", (10, 10), (0, 0, 0)).save(tmp_path / "photo.png")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={"photo": ImageValue(path="photo.png"), "quote": TextValue(text="Frase")},
    )
    check = next(
        check
        for check in run_static_checks(ir, layout, content, tmp_path)
        if check.id == "image-resolution"
    )
    assert check.status == "pass"
    assert check.detail == {"width": 10, "height": 10}


def test_optional_sha256_is_verified(brand_package, tmp_path):
    ir = _ir(brand_package)
    layout = _layout(ir, "quote-post-1x1")
    image_path = tmp_path / "photo.png"
    Image.new("RGB", (1080, 1080), (0, 0, 0)).save(image_path)
    actual = hashlib.sha256(image_path.read_bytes()).hexdigest()

    def integrity(expected):
        content = ContentSpec(
            layout_id=layout.id,
            brand_revision_id=ir.revision.id,
            values={
                "photo": ImageValue(path="photo.png", sha256=expected),
                "quote": TextValue(text="Frase"),
            },
        )
        return next(
            check
            for check in run_static_checks(ir, layout, content, tmp_path)
            if check.id == "asset-integrity"
        )

    assert integrity(actual).status == "pass"
    assert integrity("0" * 64).status == "blocked"


@pytest.mark.parametrize(
    ("text", "emphasis", "expected_message"),
    [
        ("O OFÍCIO PEDE INTENÇÃO.", None, "Escolha um trecho"),
        ("O OFÍCIO PEDE INTENÇÃO.", "PROPÓSITO", "copiado exatamente"),
        ("ECO ENCONTRA ECO", "ECO", "apareça apenas uma vez"),
        ("AAA", "AA", "apareça apenas uma vez"),
    ],
)
def test_editorial_emphasis_must_be_present_and_unambiguous(
    brand_package,
    text,
    emphasis,
    expected_message,
):
    ir = _composition_ir(brand_package)
    layout = _layout(ir, "editorial-light-post-4x5")
    content = _editorial_content(ir, layout, text=text, emphasis=emphasis)

    check = next(
        item
        for item in run_static_checks(ir, layout, content, brand_package)
        if item.id == "emphasis" and item.slot_id == "headline"
    )

    assert check.status == "blocked"
    assert expected_message in check.message_pt


def test_valid_editorial_content_passes_every_static_guard(brand_package):
    ir = _composition_ir(brand_package)
    layout = _layout(ir, "editorial-light-post-4x5")

    checks = run_static_checks(ir, layout, _editorial_content(ir, layout), brand_package)

    assert not [check for check in checks if check.status == "blocked"]


@pytest.mark.parametrize(
    ("mode", "index", "kicker", "headline", "emphasis"),
    [
        (
            "light",
            "01",
            "SER ARTESÃO NÃO É REJEITAR A TECNOLOGIA.",
            "É RECUSAR QUE ELA APAGUE A INTENÇÃO HUMANA.",
            "INTENÇÃO HUMANA",
        ),
        (
            "dark",
            "02",
            "MINIMALISMO NÃO É SIMPLIFICAR POR ESTÉTICA.",
            "É REMOVER O QUE NÃO SUSTENTA A EXPERIÊNCIA.",
            "EXPERIÊNCIA",
        ),
        (
            "light",
            "03",
            "UM FORMULÁRIO DE LOGIN",
            "MERECE O MESMO CUIDADO QUE A PÁGINA PRINCIPAL.",
            "O MESMO CUIDADO",
        ),
        (
            "dark",
            "04",
            "SEGURANÇA NÃO É O OPOSTO DE ESTÉTICA.",
            "É UMA DISCIPLINA INVISÍVEL.",
            "DISCIPLINA INVISÍVEL",
        ),
        (
            "light",
            "05",
            None,
            "ESTÉTICA, CÓDIGO, SEGURANÇA E PERFORMANCE PERTENCEM À MESMA ARQUITETURA.",
            "ARQUITETURA",
        ),
    ],
)
def test_five_real_principles_pass_without_rewriting_content(
    brand_package,
    mode,
    index,
    kicker,
    headline,
    emphasis,
):
    ir = _composition_ir(brand_package)
    layout = _layout(ir, f"editorial-{mode}-post-4x5")
    values = {
        "index": TextValue(text=index),
        "headline": TextValue(text=headline, emphasis=emphasis),
        "signature": TextValue(text="@digitalartisanbr"),
    }
    if kicker is not None:
        values["kicker"] = TextValue(text=kicker)
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values=values,
    )

    checks = run_static_checks(ir, layout, content, brand_package)

    assert not [check for check in checks if check.status == "blocked"]


def test_emphasis_is_rejected_when_layout_does_not_offer_it(brand_package):
    ir = _ir(brand_package)
    layout = _layout(ir, "statement-post-1x1")
    content = ContentSpec(
        layout_id=layout.id,
        brand_revision_id=ir.revision.id,
        values={"headline": TextValue(text="Uma ideia", emphasis="ideia")},
    )

    check = next(
        item
        for item in run_static_checks(ir, layout, content, brand_package)
        if item.id == "emphasis"
    )

    assert check.status == "blocked"
    assert "não prevê" in check.message_pt


def test_editorial_accent_estimate_combines_locked_layers_text_and_opacity(brand_package):
    ir = _composition_ir(brand_package)
    layout = _layout(ir, "editorial-light-post-4x5")
    content = _editorial_content(ir, layout)

    check = next(
        item
        for item in run_static_checks(ir, layout, content, brand_package)
        if item.id == "accent-ratio"
    )

    assert check.status == "pass"
    assert check.detail["lockedLayerIds"] == ["accent-rule"]
    assert check.detail["emphasisSlotIds"] == ["headline"]
    assert check.detail["textInkCoverage"] == 0.1
    assert check.detail["estimatedRatio"] <= check.detail["maxRatio"]

    headline = next(slot for slot in layout.slots if slot.id == "headline")
    headline.opacity = 0.25
    faded = next(
        item
        for item in run_static_checks(ir, layout, content, brand_package)
        if item.id == "accent-ratio"
    )
    assert faded.detail["emphasisRatio"] < check.detail["emphasisRatio"]


def test_editorial_accent_above_declared_limit_is_blocked(brand_package):
    ir = _composition_ir(brand_package)
    layout = _layout(ir, "editorial-light-post-4x5")
    ir.composition_rules.accent.max_ratio = 0.001
    content = _editorial_content(ir, layout, text="INTENÇÃO", emphasis="INTENÇÃO")

    check = next(
        item
        for item in run_static_checks(ir, layout, content, brand_package)
        if item.id == "accent-ratio"
    )

    assert check.status == "blocked"
    assert check.detail["estimatedRatio"] > check.detail["maxRatio"]
    assert "%" not in check.message_pt


def test_long_reference_emphasis_stays_below_pixel_coverage_limit(brand_package):
    ir = _composition_ir(brand_package)
    layout = _layout(ir, "editorial-light-post-4x5")
    content = _editorial_content(
        ir,
        layout,
        text="SISTEMAS BONS NASCEM DE DISCIPLINA INVISÍVEL.",
        emphasis="DISCIPLINA INVISÍVEL",
    )

    check = next(
        item
        for item in run_static_checks(ir, layout, content, brand_package)
        if item.id == "accent-ratio"
    )

    assert check.status == "pass"
    assert check.detail["estimatedRatio"] < 0.1


def test_locked_asset_reference_and_minimum_size_are_guarded(brand_package):
    ir = _composition_ir(brand_package)
    layout = _layout(ir, "editorial-light-post-4x5")
    content = _editorial_content(ir, layout)
    brand_mark = next(layer for layer in layout.locked_layers if layer.id == "brand-mark")
    accent_rule = next(layer for layer in layout.locked_layers if layer.id == "accent-rule")

    accent_rule.color_token = "color.inexistente"
    missing_color = next(
        item
        for item in run_static_checks(ir, layout, content, brand_package)
        if item.id == "layout-reference" and item.detail.get("layerId") == "accent-rule"
    )
    assert missing_color.status == "blocked"
    assert "color.inexistente" not in missing_color.message_pt
    accent_rule.color_token = "color.secondary"

    brand_mark.asset_token = "logo.inexistente"
    missing = next(
        item
        for item in run_static_checks(ir, layout, content, brand_package)
        if item.id == "layout-reference" and item.detail.get("layerId") == "brand-mark"
    )
    assert missing.status == "blocked"
    assert "logo.inexistente" not in missing.message_pt

    brand_mark.asset_token = "logo.onLight"
    brand_mark.area = (920, 104, 12, 52)
    undersized = next(
        item
        for item in run_static_checks(ir, layout, content, brand_package)
        if item.id == "asset-size"
    )
    assert undersized.status == "blocked"
    assert undersized.detail["minWidth"] == 24
    assert "px" not in undersized.message_pt

    brand_mark.area = (918, 116, 58, 12)
    assert not [
        item
        for item in run_static_checks(ir, layout, content, brand_package)
        if item.id == "asset-size"
    ]


def test_composition_background_and_motif_must_match_brand_rules(brand_package):
    ir = _composition_ir(brand_package)
    layout = _layout(ir, "editorial-light-post-4x5")
    content = _editorial_content(ir, layout)

    layout.background.color_token = "color.primary"
    background = next(
        item
        for item in run_static_checks(ir, layout, content, brand_package)
        if item.detail.get("referenceType") == "compositionModeBackground"
    )
    assert background.status == "blocked"

    layout.background.color_token = "color.background"
    ir.composition_rules.motifs = []
    motif = next(
        item
        for item in run_static_checks(ir, layout, content, brand_package)
        if item.detail.get("referenceType") == "lockedLayerMotif"
    )
    assert motif.status == "blocked"


def test_slot_color_override_and_large_text_threshold_drive_contrast(brand_package):
    ir = _composition_ir(brand_package)
    layout = _layout(ir, "editorial-light-post-4x5")
    content = _editorial_content(ir, layout)

    headline_checks = {
        item.id: item
        for item in run_static_checks(ir, layout, content, brand_package)
        if item.slot_id == "headline" and item.id in {"contrast", "emphasis-contrast"}
    }
    assert headline_checks["contrast"].status == "pass"
    assert headline_checks["emphasis-contrast"].status == "pass"
    assert headline_checks["emphasis-contrast"].detail["threshold"] == 3.0

    kicker = next(slot for slot in layout.slots if slot.id == "kicker")
    kicker.color_token = "color.secondary"
    small_text = next(
        item
        for item in run_static_checks(ir, layout, content, brand_package)
        if item.id == "contrast" and item.slot_id == "kicker"
    )
    assert small_text.status == "blocked"
    assert small_text.detail["threshold"] == 4.5

    headline = next(slot for slot in layout.slots if slot.id == "headline")
    headline.color_token = layout.background.color_token
    overridden = next(
        item
        for item in run_static_checks(ir, layout, content, brand_package)
        if item.id == "contrast" and item.slot_id == "headline"
    )
    assert overridden.status == "blocked"
    assert overridden.detail["ratio"] == 1.0


def test_guard_verdict_schema_is_published(tmp_path):
    names = {path.name for path in export_schemas(tmp_path)}
    assert "guard-verdict.schema.json" in names
    schema = json.loads((tmp_path / "guard-verdict.schema.json").read_text(encoding="utf-8"))
    assert schema["properties"]["checks"]["items"]["$ref"].endswith("/$defs/GuardCheck")
