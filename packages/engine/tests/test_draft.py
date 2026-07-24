import json

import pymupdf

from brand_runtime.intake.base import Candidate
from brand_runtime.intake.draft import (
    BrandDraft,
    _bind_dtcg_fonts_to_files,
    _diagnostics,
    build_draft,
)
from brand_runtime.ir.models import Evidence


def test_question_set(brand_package):
    draft = build_draft(brand_package)
    ids = [q.id for q in draft.questions]
    for required in [
        "identity.expression",
        "color.primary",
        "color.background",
        "color.text",
        "font.heading",
        "font.body",
        "logo.primary",
    ]:
        assert required in ids
    identity = next(
        question for question in draft.questions if question.id == "identity.expression"
    )
    assert identity.automatic is True
    assert identity.required is False


def test_identity_question_preserves_manual_meaning_as_editable_evidence(tmp_path):
    package = tmp_path / "meaning-package"
    package.mkdir()
    manual = package / "manual.pdf"
    with pymupdf.open() as document:
        page = document.new_page(width=595, height=842)
        page.insert_textbox(
            pymupdf.Rect(40, 40, 555, 180),
            "PROPÓSITO\nExistimos para devolver intenção e autoria à criação digital.",
            fontname="helv",
            fontsize=12,
        )
        page.insert_textbox(
            pymupdf.Rect(40, 220, 555, 380),
            "PERSONALIDADE E VALORES\nHumana, artesanal, precisa e radical.",
            fontname="helv",
            fontsize=12,
        )
        page.insert_textbox(
            pymupdf.Rect(40, 420, 555, 560),
            "TOM DE VOZ\nDireto, acessível e confiante.",
            fontname="helv",
            fontsize=12,
        )
        document.save(manual)

    draft = build_draft(package)
    question = next(item for item in draft.questions if item.id == "identity.expression")
    value = question.candidates[0].value

    assert question.kind == "review-identity"
    assert "devolver intenção" in value["essence"]
    assert "artesanal" in value["personality"]
    assert "Direto" in value["voice"]
    assert {item.page for item in question.candidates[0].evidence} == {1}


def test_identity_question_reads_english_letterspaced_sections_and_their_following_blocks(
    tmp_path,
):
    package = tmp_path / "english-brand-package"
    package.mkdir()
    manual = package / "manual.pdf"
    with pymupdf.open() as document:
        essence = document.new_page(width=595, height=842)
        essence.insert_text((40, 60), "E S S E N C E & P O S I T I O N I N G", fontsize=12)
        essence.insert_textbox(
            pymupdf.Rect(40, 90, 555, 210),
            "A quiet architectural house built on tension between light and shadow.",
            fontname="helv",
            fontsize=12,
        )
        essence.insert_text((40, 250), "T H E R E G I S T E R", fontsize=12)
        essence.insert_textbox(
            pymupdf.Rect(40, 280, 555, 400),
            "Sophisticated, intellectual and monumental; never maximalist.",
            fontname="helv",
            fontsize=12,
        )

        voice = document.new_page(width=595, height=842)
        voice.insert_text((40, 60), "V O I C E & T O N E", fontsize=12)
        voice.insert_textbox(
            pymupdf.Rect(40, 90, 555, 210),
            "Short declarative sentences. Material-first and atmospheric.",
            fontname="helv",
            fontsize=12,
        )
        voice.insert_text((40, 250), "N E V E R", fontsize=12)
        voice.insert_textbox(
            pymupdf.Rect(40, 280, 555, 400),
            "Exclamation marks, emoji, urgency or discount language.",
            fontname="helv",
            fontsize=12,
        )
        document.save(manual)

    draft = build_draft(package)
    question = next(item for item in draft.questions if item.id == "identity.expression")
    value = question.candidates[0].value

    assert "quiet architectural" in value["essence"]
    assert "Sophisticated" in value["personality"]
    assert "Material-first" in value["voice"]
    assert "discount language" in value["avoid"]
    assert {item.page for item in question.candidates[0].evidence} == {1, 2}


def test_identity_question_ignores_contents_page_and_editorial_scaffolding(tmp_path):
    package = tmp_path / "manual-with-contents"
    package.mkdir()
    manual = package / "manual.pdf"
    with pymupdf.open() as document:
        contents = document.new_page(width=595, height=842)
        contents.insert_textbox(
            pymupdf.Rect(40, 40, 555, 220),
            "CONTENTS\nESSENCE & POSITIONING 01\nTHE LOGO SYSTEM 02\n"
            "COLOUR 03\nVOICE & TONE 04\nUSAGE & MISUSE 05",
            fontname="helv",
            fontsize=12,
        )
        essence = document.new_page(width=595, height=842)
        essence.insert_textbox(
            pymupdf.Rect(40, 40, 555, 100),
            "0 1 — E S S E N C E & P O S I T I O N I N G\nA QUIET HOUSE",
            fontname="helv",
            fontsize=12,
        )
        essence.insert_textbox(
            pymupdf.Rect(40, 120, 555, 220),
            "The house is controlled, silent and sophisticated.",
            fontname="helv",
            fontsize=12,
        )
        essence.insert_text((40, 260), "T H E R E G I S T E R", fontsize=12)
        essence.insert_textbox(
            pymupdf.Rect(40, 290, 555, 390),
            "Monumental, not maximalist: few elements, elevated impact.",
            fontname="helv",
            fontsize=12,
        )
        document.save(manual)

    draft = build_draft(package)
    question = next(item for item in draft.questions if item.id == "identity.expression")
    value = question.candidates[0].value

    assert "THE LOGO SYSTEM" not in value["essence"]
    assert "A QUIET HOUSE" in value["essence"]
    assert "controlled, silent" in value["essence"]
    assert "T H E R E G I S T E R" not in value["personality"]
    assert "Monumental, not maximalist" in value["personality"]


def test_legacy_draft_without_recommended_count_remains_valid(brand_package):
    payload = build_draft(brand_package).model_dump(mode="json", by_alias=True)
    for question in payload["questions"]:
        question.pop("recommendedCount")

    restored = BrandDraft.model_validate(payload)

    assert all(question.recommended_count == 0 for question in restored.questions)


def test_primary_candidates_are_non_neutral_and_svg_weighted(brand_package):
    draft = build_draft(brand_package)
    q = next(q for q in draft.questions if q.id == "color.primary")
    assert q.candidates[0].value == "#1A4D8F"  # aparece no SVG (peso 3) e no PDF
    assert all(c.value != "#333333" for c in q.candidates[: q.recommended_count])
    assert any(c.value == "#333333" for c in q.candidates[q.recommended_count :])
    assert q.model_dump(by_alias=True)["recommendedCount"] == q.recommended_count


def test_background_has_white_default_last(brand_package):
    draft = build_draft(brand_package)
    q = next(q for q in draft.questions if q.id == "color.background")
    assert q.candidates[q.recommended_count - 1].value == "#FFFFFF"
    assert {"#1A4D8F", "#F4A300", "#333333"}.issubset(
        {candidate.value for candidate in q.candidates}
    )


def test_every_color_role_offers_the_complete_extracted_palette(brand_package):
    draft = build_draft(brand_package)
    questions = {question.id: question for question in draft.questions}
    extracted = {"#1A4D8F", "#F4A300", "#333333"}

    for question_id in ("color.primary", "color.background", "color.text", "color.secondary"):
        assert extracted.issubset(
            {candidate.value for candidate in questions[question_id].candidates}
        )
        for candidate in questions[question_id].candidates:
            serialized_evidence = [
                evidence.model_dump(mode="json") for evidence in candidate.evidence
            ]
            assert len(serialized_evidence) == len(
                {str(sorted(evidence.items())) for evidence in serialized_evidence}
            )


def test_secondary_is_offered_for_a_two_color_palette(tmp_path):
    package = tmp_path / "two-color-package"
    logos = package / "assets" / "logos"
    logos.mkdir(parents=True)
    (logos / "logo.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#1A4D8F" d="M0 0h50v100H0z"/>'
        '<path fill="#F4A300" d="M50 0h50v100H50z"/></svg>',
        encoding="utf-8",
    )

    draft = build_draft(package)
    secondary = next(question for question in draft.questions if question.id == "color.secondary")

    assert secondary.required is False
    assert secondary.recommended_count == 1
    assert {candidate.value for candidate in secondary.candidates} == {"#1A4D8F", "#F4A300"}


def test_heading_candidates_prefer_font_files(brand_package):
    draft = build_draft(brand_package)
    q = next(q for q in draft.questions if q.id == "font.heading")
    first = q.candidates[0]
    assert first.value["family"] == "Fixture Sans"
    assert first.evidence[0].source_type == "font-file"


def test_complete_authoritative_tokens_avoid_redundant_pdf_scans(
    brand_package,
    monkeypatch,
):
    import brand_runtime.intake.draft as draft_module

    (brand_package / "tokens.json").write_text(
        json.dumps(
            {
                "color": {
                    "primary": {"$type": "color", "$value": "#C05518"},
                    "secondary": {"$type": "color", "$value": "#202025"},
                    "background": {"$type": "color", "$value": "#F2EFE7"},
                    "text": {"$type": "color", "$value": "#202025"},
                },
                "font": {
                    "heading": {
                        "family": {"$type": "fontFamily", "$value": "Fixture Sans"},
                        "weight": {"$type": "fontWeight", "$value": 700},
                    },
                    "body": {
                        "family": {"$type": "fontFamily", "$value": "Fixture Sans"},
                        "weight": {"$type": "fontWeight", "$value": 700},
                    },
                },
            }
        ),
        encoding="utf-8",
    )

    def redundant_scan_called(_path):
        raise AssertionError("evidência autoritativa completa não deve reler o PDF")

    monkeypatch.setattr(draft_module, "extract_pdf_colors", redundant_scan_called)
    monkeypatch.setattr(draft_module, "extract_pdf_declared_colors", redundant_scan_called)
    monkeypatch.setattr(draft_module, "extract_pdf_fonts", redundant_scan_called)
    monkeypatch.setattr(draft_module, "extract_pdf_declared_fonts", redundant_scan_called)

    draft = build_draft(brand_package)
    questions = {question.id: question for question in draft.questions}

    assert questions["color.primary"].candidates[0].value == "#C05518"
    assert questions["color.background"].candidates[0].value == "#F2EFE7"
    assert questions["font.heading"].candidates[0].value["path"].endswith("fixture-sans-bold.ttf")
    assert questions["font.body"].candidates[0].value["path"].endswith("fixture-sans-bold.ttf")


def test_incomplete_materials_keep_pdf_inference_path(brand_package, monkeypatch):
    import brand_runtime.intake.draft as draft_module

    calls = {"colors": 0, "declaredColors": 0, "fonts": 0, "declaredFonts": 0}
    original_colors = draft_module.extract_pdf_colors
    original_declared_colors = draft_module.extract_pdf_declared_colors
    original_fonts = draft_module.extract_pdf_fonts
    original_declared_fonts = draft_module.extract_pdf_declared_fonts

    def colors(path):
        calls["colors"] += 1
        return original_colors(path)

    def declared_colors(path):
        calls["declaredColors"] += 1
        return original_declared_colors(path)

    def fonts(path):
        calls["fonts"] += 1
        return original_fonts(path)

    def declared_fonts(path):
        calls["declaredFonts"] += 1
        return original_declared_fonts(path)

    monkeypatch.setattr(draft_module, "extract_pdf_colors", colors)
    monkeypatch.setattr(draft_module, "extract_pdf_declared_colors", declared_colors)
    monkeypatch.setattr(draft_module, "extract_pdf_fonts", fonts)
    monkeypatch.setattr(draft_module, "extract_pdf_declared_fonts", declared_fonts)

    build_draft(brand_package)

    assert calls == {"colors": 1, "declaredColors": 1, "fonts": 1, "declaredFonts": 1}


def test_dtcg_binding_preserves_font_resource_metadata():
    dtcg = Candidate(
        value={"family": "Example Sans", "weight": 700, "style": "normal"},
        score=5,
        evidence=[Evidence(source_type="dtcg-tokens", confidence=1)],
    )
    resource = {
        "provider": "google-fonts",
        "format": "ttf",
        "upstreamRef": "google/fonts@abc:ofl/example/example.ttf",
        "licenseId": "OFL-1.1",
        "licenseSha256": "a" * 64,
        "usagePolicy": "redistributable",
        "coverageProfile": "pt-BR-ui-v1",
        "missingCodepoints": [],
        "axes": [],
    }
    file_candidate = Candidate(
        value={
            "family": "example sans",
            "weight": 700,
            "style": "normal",
            "path": "fonts/example.ttf",
            "resource": resource,
        },
        score=1,
        evidence=[Evidence(source_type="font-file", confidence=1)],
    )

    bound = _bind_dtcg_fonts_to_files([dtcg], [file_candidate])

    assert bound[0].value["path"] == "fonts/example.ttf"
    assert bound[0].value["resource"] == resource
    assert "path" not in dtcg.value


def test_font_missing_diagnostic_uses_family_weight_and_style(tmp_path):
    normal_file = Candidate(
        value={"family": "Example Sans", "weight": 400, "style": "normal"},
        score=1,
        evidence=[],
    )
    italic_reference = Candidate(
        value={"family": "example sans", "weight": 400, "style": "italic"},
        score=1,
        evidence=[],
    )
    logo = Candidate(value="assets/logos/example.svg", score=1, evidence=[])

    diagnostics = _diagnostics(
        [tmp_path / "manual.pdf"],
        [logo],
        [normal_file],
        [italic_reference],
        [],
        tmp_path,
    )

    missing = [item for item in diagnostics if item.code == "FONT_FILE_MISSING"]
    assert len(missing) == 1
    assert "italic" in missing[0].message


def test_logo_question_and_prompt(brand_package):
    draft = build_draft(brand_package)
    q = next(q for q in draft.questions if q.id == "logo.primary")
    assert q.prompt_pt == "Este é o logo principal da marca?"
    assert q.candidates[0].value.endswith("logo.svg")


def test_extensoes_sao_case_insensitive_em_toda_plataforma(brand_package, tmp_path):
    import json
    import shutil

    package = tmp_path / "uppercase"
    shutil.copytree(brand_package, package)
    renames = (
        (package / "manual.pdf", package / "MANUAL.PDF"),
        (package / "assets" / "logos" / "logo.svg", package / "assets" / "logos" / "LOGO.SVG"),
        (
            package / "fonts" / "fixture-sans-bold.ttf",
            package / "fonts" / "FIXTURE-SANS-BOLD.TTF",
        ),
    )
    for source, destination in renames:
        temporary = source.with_name(f"rename-{source.name}")
        source.rename(temporary)
        temporary.rename(destination)
    (package / "TOKENS.JSON").write_text(
        json.dumps({"color": {"brand": {"$type": "color", "$value": "#00FF88"}}}),
        encoding="utf-8",
    )

    draft = build_draft(package)

    assert not any(item.code == "NO_PDF_FOUND" for item in draft.diagnostics)
    assert (
        next(q for q in draft.questions if q.id == "color.primary").candidates[0].value == "#00FF88"
    )
    assert (
        next(q for q in draft.questions if q.id == "font.heading").candidates[0].value["family"]
        == "Fixture Sans"
    )
    assert (
        next(q for q in draft.questions if q.id == "logo.primary")
        .candidates[0]
        .value.endswith("LOGO.SVG")
    )


def test_semantic_pdf_declarations_drive_color_and_font_roles(tmp_path):
    package = tmp_path / "semantic-package"
    package.mkdir()
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_textbox(
            pymupdf.Rect(40, 40, 500, 700),
            "PRIMARIAS\nGrafite - tinta\n60%\nHEX #1F232A\n"
            "Ambar - o ponto\n10%\nHEX #CA6B0B\nPapel - fundo\n30%",
            fontsize=12,
        )
        page = doc.new_page()
        page.insert_textbox(
            pymupdf.Rect(40, 40, 500, 700),
            "HEX #FCFBF8\nESTRUTURA & IMPACTO\nClash Display\nAa Gg\n"
            "ACENTO AUTORAL\nFraunces\nAa Gg\nLEITURA & UI\nGeneral Sans\nAa Gg\n"
            "FUNCIONAIS\nSucesso #4F7D5F\nErro #B1492F",
            fontsize=12,
        )
        doc.save(package / "manual.pdf")

    draft = build_draft(package)
    questions = {question.id: question for question in draft.questions}

    assert questions["color.primary"].candidates[0].value == "#1F232A"
    assert questions["color.background"].candidates[0].value == "#FCFBF8"
    assert questions["color.text"].candidates[0].value == "#1F232A"
    assert [
        candidate.value
        for candidate in questions["color.primary"].candidates[
            : questions["color.primary"].recommended_count
        ]
    ] == ["#1F232A", "#CA6B0B"]
    assert [
        candidate.value
        for candidate in questions["color.background"].candidates[
            : questions["color.background"].recommended_count
        ]
    ] == ["#FCFBF8"]
    assert [
        candidate.value
        for candidate in questions["color.text"].candidates[
            : questions["color.text"].recommended_count
        ]
    ] == ["#1F232A"]
    assert [
        candidate.value
        for candidate in questions["color.secondary"].candidates[
            : questions["color.secondary"].recommended_count
        ]
    ] == ["#CA6B0B"]
    for question_id in ("color.primary", "color.background", "color.text", "color.secondary"):
        assert {"#4F7D5F", "#B1492F"}.issubset(
            {candidate.value for candidate in questions[question_id].candidates}
        )
    assert questions["font.heading"].candidates[0].value["family"] == "Clash Display"
    assert questions["font.heading"].candidates[1].value["family"] == "Fraunces"
    assert questions["font.body"].candidates[0].value["family"] == "General Sans"
    assert [candidate.value["family"] for candidate in questions["font.heading"].candidates] == [
        "Clash Display",
        "Fraunces",
    ]
    assert [candidate.value["family"] for candidate in questions["font.body"].candidates] == [
        "General Sans"
    ]
    missing_targets = {
        diagnostic.target
        for diagnostic in draft.diagnostics
        if diagnostic.code == "FONT_FILE_MISSING"
    }
    assert missing_targets == {"Clash Display", "Fraunces", "General Sans"}


def test_declared_brand_primary_becomes_text_fallback_instead_of_default_black(tmp_path):
    package = tmp_path / "vita-style-package"
    package.mkdir()
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_textbox(
            pymupdf.Rect(40, 40, 500, 700),
            "Verde institucional, creme como papel, ouro medicinal como tempero.\n"
            "Verde floresta\n--green-800 : #1C382A\n"
            "Creme\n--cream-200 : #F4F1E8\n"
            "Ouro medicinal\n--gold-500 : #C89C40\n",
            fontsize=12,
        )
        page.draw_line((40, 760), (500, 760), color=(0, 0, 0), width=1)
        doc.save(package / "manual.pdf")

    draft = build_draft(package)
    questions = {question.id: question for question in draft.questions}

    assert questions["color.primary"].candidates[0].value == "#1C382A"
    assert questions["color.background"].candidates[0].value == "#F4F1E8"
    assert questions["color.text"].candidates[0].value == "#1C382A"
    assert questions["color.secondary"].candidates[0].value == "#C89C40"
    assert "#000000" not in {candidate.value for candidate in draft.palette_candidates}


def test_observed_pdf_fonts_remain_fallback_without_semantic_declaration(brand_package):
    draft = build_draft(brand_package)
    heading = next(question for question in draft.questions if question.id == "font.heading")
    body = next(question for question in draft.questions if question.id == "font.body")

    assert {"Times", "Helvetica"}.issubset(
        {candidate.value["family"] for candidate in heading.candidates}
    )
    assert {"Times", "Helvetica"}.issubset(
        {candidate.value["family"] for candidate in body.candidates}
    )


def test_external_style_svg_is_diagnostic_and_not_a_logo_candidate(tmp_path):
    package = tmp_path / "external-svg"
    logos = package / "assets" / "logos"
    logos.mkdir(parents=True)
    (logos / "logo.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path class="ink" d="M0 0h100v100H0z"/></svg>',
        encoding="utf-8",
    )

    draft = build_draft(package)
    logo_question = next(question for question in draft.questions if question.id == "logo.primary")

    assert logo_question.candidates == []
    diagnostic = next(
        item for item in draft.diagnostics if item.code == "SVG_EXTERNAL_STYLE_MISSING"
    )
    assert diagnostic.target == "assets/logos/logo.svg"
    assert "fill e stroke embutidos" in diagnostic.message


def test_identical_logo_files_are_deduplicated_by_hash(tmp_path):
    package = tmp_path / "duplicate-logos"
    logos = package / "assets" / "logos"
    logos.mkdir(parents=True)
    data = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#1F232A" d="M0 0h100v100H0z"/></svg>'
    )
    (logos / "logo-a.svg").write_text(data, encoding="utf-8")
    (logos / "logo-b.svg").write_text(data, encoding="utf-8")

    draft = build_draft(package)
    logo_question = next(question for question in draft.questions if question.id == "logo.primary")

    assert len(logo_question.candidates) == 1
    assert logo_question.candidates[0].value == "assets/logos/logo-a.svg"


def test_logo_variants_are_reviewed_separately_when_package_has_more_than_one(tmp_path):
    package = tmp_path / "logo-variants"
    logos = package / "assets" / "logos"
    logos.mkdir(parents=True)
    (logos / "brand-positive.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#161616" d="M0 0h100v100H0z"/></svg>',
        encoding="utf-8",
    )
    (logos / "brand-negative.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#FAFAFA" d="M0 0h100v100H0z"/></svg>',
        encoding="utf-8",
    )

    draft = build_draft(package)
    on_light = next(question for question in draft.questions if question.id == "logo.onLight")
    on_dark = next(question for question in draft.questions if question.id == "logo.onDark")

    assert on_light.required is False
    assert on_dark.required is False
    assert on_light.candidates[0].value.endswith("brand-positive.svg")
    assert on_dark.candidates[0].value.endswith("brand-negative.svg")
    assert on_light.recommended_count == 1
    assert on_dark.recommended_count == 1
