import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pymupdf
import pytest

from brand_runtime.intake.compile import Answers, CompileError, compile_ir
from brand_runtime.intake.draft import build_draft

FIXED = datetime(2026, 7, 11, 12, 0, 0, tzinfo=timezone.utc)


def _font_resource(upstream_ref="google/fonts@abc:ofl/fixture/fixture.ttf"):
    return {
        "provider": "google-fonts",
        "format": "ttf",
        "upstreamRef": upstream_ref,
        "licenseId": "OFL-1.1",
        "licenseSha256": "a" * 64,
        "usagePolicy": "redistributable",
        "coverageProfile": "pt-BR-ui-v1",
        "missingCodepoints": [],
        "axes": [
            {"tag": "wght", "minimum": 100, "default": 400, "maximum": 900},
        ],
    }


def _answers(draft):
    def first(qid):
        q = next(q for q in draft.questions if q.id == qid)
        return q.candidates[0].value

    def first_referenced(qid):
        q = next(q for q in draft.questions if q.id == qid)
        return next(candidate.value for candidate in q.candidates if "path" not in candidate.value)

    return Answers(
        values={
            "color.primary": first("color.primary"),
            "color.background": "#FFFFFF",
            "color.text": "#1A1A1A",
            "font.heading": first("font.heading"),
            # Exercita no walking skeleton os dois caminhos do renderer:
            # heading com arquivo local e body apenas referenciada no PDF.
            "font.body": first_referenced("font.body"),
            "logo.primary": first("logo.primary"),
        }
    )


def _composition_draft(brand_package):
    """Monta um pacote autoral equivalente sem depender dos arquivos em exemplo/."""
    manual = brand_package / "manual.pdf"
    manual.unlink()
    with pymupdf.open() as document:
        page = document.new_page(width=595, height=842)
        page.insert_textbox(
            pymupdf.Rect(40, 40, 555, 800),
            """FUNDO CLARO - POSITIVO
FUNDO ESCURO - NEGATIVO
Grafite - tinta
60%
HEX #1F232A
Ambar - o ponto
10%
HEX #CA6B0B
Papel - fundo
30%
HEX #FCFBF8
O ambar deve ficar abaixo de 10% da composicao.
PADRAO DIAGONAL - FUNDOS E CAPAS
Numeracao sempre com zero a esquerda.
MINIMO DIGITAL
24 px (simbolo)
AREA DE PROTECAO = 1/4 DA ALTURA
""",
            fontname="helv",
            fontsize=11,
        )
        document.save(manual)

    logos = brand_package / "assets" / "logos"
    (logos / "logo.svg").unlink()
    (logos / "brand-positive.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<rect width="100" height="100" fill="#1F232A"/></svg>',
        encoding="utf-8",
    )
    (logos / "brand-negative.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<rect width="100" height="100" fill="#FCFBF8"/></svg>',
        encoding="utf-8",
    )
    return build_draft(brand_package)


def _composition_ir(brand_package):
    draft = _composition_draft(brand_package)
    answers = _answers(draft)
    answers.values.update(
        {
            "color.primary": "#1F232A",
            "color.background": "#FCFBF8",
            "color.text": "#1F232A",
            "color.secondary": "#CA6B0B",
        }
    )
    return compile_ir(draft, answers, "Digital Artisan", created_at=FIXED)


def test_missing_required_raises(brand_package):
    draft = build_draft(brand_package)
    with pytest.raises(CompileError) as exc:
        compile_ir(draft, Answers(values={}), "ACME")
    assert "color.primary" in str(exc.value)


def test_happy_path_produces_valid_ir(brand_package):
    draft = build_draft(brand_package)
    ir = compile_ir(draft, _answers(draft), "ACME", created_at=FIXED)
    assert ir.brand.name == "ACME"
    assert ir.colors["color.primary"].value == "#1A4D8F"
    ev_types = [e.source_type for e in ir.colors["color.primary"].evidence]
    assert "wizard-confirmation" in ev_types and "svg-asset" in ev_types
    assert ir.fonts["font.heading"].source == "file"
    assert ir.roles["heading"].font == "font.heading"
    assert ir.assets["logo.primary"].sha256 and len(ir.assets["logo.primary"].sha256) == 64
    logo_evidence = [e.source_type for e in ir.assets["logo.primary"].evidence]
    assert "svg-asset" in logo_evidence and "wizard-confirmation" in logo_evidence


def test_composition_rules_and_logo_variants_compile_with_precise_provenance(brand_package):
    ir = _composition_ir(brand_package)

    assert ir.schema_version == "0.3.0"
    assert set(ir.assets) == {"logo.primary", "logo.onLight", "logo.onDark"}
    assert ir.assets["logo.onLight"].path.endswith("brand-positive.svg")
    assert ir.assets["logo.onDark"].path.endswith("brand-negative.svg")
    assert all(asset.min_width_px == 24 for asset in ir.assets.values())
    assert all(asset.clear_space_ratio == 0.25 for asset in ir.assets.values())
    assert any(
        item.source_type == "wizard-confirmation" for item in ir.assets["logo.primary"].evidence
    )
    assert all(
        item.source_type != "wizard-confirmation"
        for token in ("logo.onLight", "logo.onDark")
        for item in ir.assets[token].evidence
    )

    rules = ir.composition_rules
    assert rules is not None
    assert rules.modes.light is not None and rules.modes.dark is not None
    assert rules.modes.light.model_dump(mode="json", by_alias=True) | {"evidence": []} == {
        "backgroundColorToken": "color.background",
        "foregroundColorToken": "color.text",
        "logoAssetToken": "logo.onLight",
        "evidence": [],
    }
    assert rules.modes.dark.background_color_token == "color.primary"
    assert rules.modes.dark.foreground_color_token == "color.background"
    assert rules.modes.dark.logo_asset_token == "logo.onDark"
    assert [(item.color_token, item.ratio) for item in rules.color_ratios] == [
        ("color.primary", 0.6),
        ("color.background", 0.3),
        ("color.secondary", 0.1),
    ]
    assert rules.accent is not None
    assert (rules.accent.color_token, rules.accent.max_ratio) == ("color.secondary", 0.1)
    assert [item.kind for item in rules.motifs] == ["diagonal-lines"]
    assert rules.numbering is not None
    assert (rules.numbering.style, rules.numbering.min_digits) == ("zero-padded", 2)
    assert set(ir.roles) >= {"display", "label", "index", "signature"}
    assert (ir.roles["display"].min_size_px, ir.roles["display"].max_size_px) == (56, 84)
    assert (ir.roles["index"].min_size_px, ir.roles["index"].max_size_px) == (240, 460)
    assert all(
        evidence.path == "manual.pdf"
        for evidence in rules.modes.light.evidence
        if evidence.path is not None
    )


def test_revision_id_is_deterministic(brand_package):
    draft = build_draft(brand_package)
    a = compile_ir(draft, _answers(draft), "ACME", created_at=FIXED)
    b = compile_ir(draft, _answers(draft), "ACME", created_at=FIXED)
    assert a.revision.id == b.revision.id
    assert a.revision.id.startswith("brandrev_")


def test_revision_id_ignores_audit_timestamp(brand_package):
    draft = build_draft(brand_package)
    a = compile_ir(draft, _answers(draft), "ACME", created_at=FIXED)
    b = compile_ir(draft, _answers(draft), "ACME", created_at=FIXED + timedelta(days=1))

    assert a.revision.created_at != b.revision.created_at
    assert a.revision.id == b.revision.id


def test_revision_id_is_portable_between_package_roots(brand_package, tmp_path):
    copied_package = tmp_path / "copied-package"
    shutil.copytree(brand_package, copied_package)
    a_draft = build_draft(brand_package)
    b_draft = build_draft(copied_package)

    a = compile_ir(a_draft, _answers(a_draft), "ACME", created_at=FIXED)
    b = compile_ir(b_draft, _answers(b_draft), "ACME", created_at=FIXED)

    assert a.revision.id == b.revision.id
    assert all(
        not Path(evidence.path).is_absolute()
        for token in [*a.colors.values(), *a.fonts.values()]
        for evidence in token.evidence
        if evidence.path is not None
    )


def test_unanswered_secondary_yields_diagnostic(brand_package):
    draft = build_draft(brand_package)
    ir = compile_ir(draft, _answers(draft), "ACME", created_at=FIXED)
    assert any(d.code == "UNDETERMINED" and d.target == "color.secondary" for d in ir.diagnostics)


def test_missing_error_lists_every_required_answer(brand_package):
    draft = build_draft(brand_package)
    with pytest.raises(CompileError) as exc:
        compile_ir(draft, Answers(values={}), "ACME")
    message = str(exc.value)
    for question_id in (
        "color.primary",
        "color.background",
        "color.text",
        "font.heading",
        "font.body",
        "logo.primary",
    ):
        assert question_id in message


def test_equivalent_css_color_inherits_evidence_and_revision(brand_package):
    draft = build_draft(brand_package)
    canonical = _answers(draft)
    equivalent = Answers(values={**canonical.values, "color.primary": "rgb(26, 77, 143)"})

    a = compile_ir(draft, canonical, "ACME", created_at=FIXED)
    b = compile_ir(draft, equivalent, "ACME", created_at=FIXED)

    assert b.colors["color.primary"].value == "#1A4D8F"
    assert any(e.source_type == "svg-asset" for e in b.colors["color.primary"].evidence)
    assert a.revision.id == b.revision.id


def test_compile_does_not_mutate_draft_or_answers(brand_package):
    draft = build_draft(brand_package)
    answers = _answers(draft)
    before_draft = draft.model_dump(mode="json")
    before_answers = answers.model_dump(mode="json")

    compile_ir(draft, answers, "ACME", created_at=FIXED)
    compile_ir(draft, answers, "ACME", created_at=FIXED)

    assert draft.model_dump(mode="json") == before_draft
    assert answers.model_dump(mode="json") == before_answers


def test_unknown_answer_does_not_change_revision(brand_package):
    draft = build_draft(brand_package)
    answers = _answers(draft)
    with_unknown = Answers(values={**answers.values, "future.unknown": "ignorado"})

    a = compile_ir(draft, answers, "ACME", created_at=FIXED)
    b = compile_ir(draft, with_unknown, "ACME", created_at=FIXED)

    assert a.revision.id == b.revision.id


def test_manual_font_cannot_inject_file_path(brand_package, tmp_path):
    outside = tmp_path / "outside.ttf"
    outside.write_bytes(b"nao e uma fonte")
    draft = build_draft(brand_package)
    answers = _answers(draft)
    answers.values["font.heading"] = {
        "family": "Fonte Manual",
        "weight": 700,
        "style": "normal",
        "path": str(outside),
        "resource": _font_resource("forged"),
    }

    ir = compile_ir(draft, answers, "ACME", created_at=FIXED)

    assert ir.fonts["font.heading"].source == "referenced-only"
    assert ir.fonts["font.heading"].file_sha256 is None
    assert ir.fonts["font.heading"].resource is None


def test_font_resource_is_inherited_only_from_matched_candidate(brand_package):
    draft = build_draft(brand_package)
    heading = next(question for question in draft.questions if question.id == "font.heading")
    file_candidate = next(
        candidate for candidate in heading.candidates if "path" in candidate.value
    )
    file_candidate.value["resource"] = _font_resource()
    answers = _answers(draft)
    answers.values["font.heading"] = file_candidate.value

    ir = compile_ir(draft, answers, "ACME", created_at=FIXED)

    resource = ir.fonts["font.heading"].resource
    assert resource is not None
    assert resource.provider == "google-fonts"
    assert resource.upstream_ref == "google/fonts@abc:ofl/fixture/fixture.ttf"
    assert resource.axes[0].tag == "wght"


def test_font_match_requires_the_same_style_as_the_file_candidate(brand_package):
    draft = build_draft(brand_package)
    answers = _answers(draft)
    heading = next(question for question in draft.questions if question.id == "font.heading")
    file_candidate = next(
        candidate for candidate in heading.candidates if "path" in candidate.value
    )
    answers.values["font.heading"] = {**file_candidate.value, "style": "italic"}

    ir = compile_ir(draft, answers, "ACME", created_at=FIXED)

    assert ir.fonts["font.heading"].style == "italic"
    assert ir.fonts["font.heading"].source == "referenced-only"
    assert ir.fonts["font.heading"].file_sha256 is None


def test_font_resource_participates_in_revision_identity(brand_package):
    first_draft = build_draft(brand_package)
    second_draft = first_draft.model_copy(deep=True)
    first_heading = next(q for q in first_draft.questions if q.id == "font.heading")
    second_heading = next(q for q in second_draft.questions if q.id == "font.heading")
    first_file = next(
        candidate for candidate in first_heading.candidates if "path" in candidate.value
    )
    second_file = next(
        candidate for candidate in second_heading.candidates if "path" in candidate.value
    )
    first_file.value["resource"] = _font_resource("google/fonts@aaa:fixture.ttf")
    second_file.value["resource"] = _font_resource("google/fonts@bbb:fixture.ttf")

    first = compile_ir(first_draft, _answers(first_draft), "ACME", created_at=FIXED)
    second = compile_ir(second_draft, _answers(second_draft), "ACME", created_at=FIXED)

    assert first.revision.id != second.revision.id


def test_file_candidate_wins_tie_when_its_path_was_selected(brand_package):
    (brand_package / "tokens.json").write_text(
        """{
          "font": {
            "$type": "fontFamily",
            "heading": {"$value": "Fixture Sans"}
          },
          "weight": {
            "$type": "fontWeight",
            "heading": {"$value": 700}
          }
        }""",
        encoding="utf-8",
    )
    draft = build_draft(brand_package)
    answers = _answers(draft)
    heading = next(question for question in draft.questions if question.id == "font.heading")
    file_candidate = next(
        candidate for candidate in heading.candidates if "path" in candidate.value
    )
    answers.values["font.heading"] = file_candidate.value

    ir = compile_ir(draft, answers, "ACME", created_at=FIXED)

    assert ir.fonts["font.heading"].source == "file"
    assert ir.fonts["font.heading"].file_sha256 is not None


def test_dtcg_font_is_bound_to_compatible_file_by_default(brand_package):
    (brand_package / "tokens.json").write_text(
        """{
          "font": {
            "heading": {
              "family": {"$type": "fontFamily", "$value": "Fixture Sans"},
              "weight": {"$type": "fontWeight", "$value": 700}
            }
          }
        }""",
        encoding="utf-8",
    )
    draft = build_draft(brand_package)
    heading = next(question for question in draft.questions if question.id == "font.heading")
    selected = heading.candidates[0]

    assert selected.value["path"] == "fonts/fixture-sans-bold.ttf"
    assert [evidence.source_type for evidence in selected.evidence] == [
        "dtcg-tokens",
        "dtcg-tokens",
        "font-file",
    ]

    ir = compile_ir(draft, _answers(draft), "ACME", created_at=FIXED)

    assert ir.fonts["font.heading"].source == "file"
    assert ir.fonts["font.heading"].file_sha256 is not None
    assert {evidence.source_type for evidence in ir.fonts["font.heading"].evidence} >= {
        "dtcg-tokens",
        "font-file",
        "wizard-confirmation",
    }


def test_logo_path_cannot_escape_package(brand_package):
    draft = build_draft(brand_package)
    answers = _answers(draft)
    answers.values["logo.primary"] = "../fora.svg"

    with pytest.raises(CompileError, match="dentro do pacote"):
        compile_ir(draft, answers, "ACME", created_at=FIXED)


def test_logo_must_be_a_valid_candidate_from_the_draft(brand_package):
    draft = build_draft(brand_package)
    extra = brand_package / "assets" / "logos" / "extra.svg"
    extra.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
        '<rect width="10" height="10" fill="#000"/></svg>',
        encoding="utf-8",
    )
    answers = _answers(draft)
    answers.values["logo.primary"] = "assets/logos/extra.svg"

    with pytest.raises(CompileError, match="opções válidas"):
        compile_ir(draft, answers, "ACME", created_at=FIXED)


def test_logo_candidate_is_revalidated_as_self_contained_at_compile_time(brand_package):
    draft = build_draft(brand_package)
    answers = _answers(draft)
    logo = brand_package / str(answers.values["logo.primary"])
    logo.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
        '<rect class="ink" width="10" height="10"/></svg>',
        encoding="utf-8",
    )

    with pytest.raises(CompileError, match="estilos externos"):
        compile_ir(draft, answers, "ACME", created_at=FIXED)


def test_invalid_answers_are_reported_as_compile_errors(brand_package):
    draft = build_draft(brand_package)
    answers = _answers(draft)
    answers.values["color.primary"] = "isto-nao-e-cor"
    with pytest.raises(CompileError, match="color.primary"):
        compile_ir(draft, answers, "ACME", created_at=FIXED)

    answers = _answers(draft)
    answers.values["font.heading"] = {
        "family": "Fixture Sans",
        "weight": 950,
        "style": "normal",
    }
    with pytest.raises(CompileError, match="font.heading"):
        compile_ir(draft, answers, "ACME", created_at=FIXED)
