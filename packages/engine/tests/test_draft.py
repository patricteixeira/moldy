import pymupdf

from brand_runtime.intake.draft import build_draft


def test_question_set(brand_package):
    draft = build_draft(brand_package)
    ids = [q.id for q in draft.questions]
    for required in [
        "color.primary",
        "color.background",
        "color.text",
        "font.heading",
        "font.body",
        "logo.primary",
    ]:
        assert required in ids


def test_primary_candidates_are_non_neutral_and_svg_weighted(brand_package):
    draft = build_draft(brand_package)
    q = next(q for q in draft.questions if q.id == "color.primary")
    assert q.candidates[0].value == "#1A4D8F"  # aparece no SVG (peso 3) e no PDF
    assert all(c.value != "#333333" for c in q.candidates)  # neutra não entra em primary


def test_background_has_white_default_last(brand_package):
    draft = build_draft(brand_package)
    q = next(q for q in draft.questions if q.id == "color.background")
    assert q.candidates[-1].value == "#FFFFFF"


def test_heading_candidates_prefer_font_files(brand_package):
    draft = build_draft(brand_package)
    q = next(q for q in draft.questions if q.id == "font.heading")
    first = q.candidates[0]
    assert first.value["family"] == "Fixture Sans"
    assert first.evidence[0].source_type == "font-file"


def test_logo_question_and_prompt(brand_package):
    draft = build_draft(brand_package)
    q = next(q for q in draft.questions if q.id == "logo.primary")
    assert q.prompt_pt == "Este é o logo oficial da marca?"
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
            "ACENTO AUTORAL\nFraunces\nAa Gg\nLEITURA & UI\nGeneral Sans\nAa Gg",
            fontsize=12,
        )
        doc.save(package / "manual.pdf")

    draft = build_draft(package)
    questions = {question.id: question for question in draft.questions}

    assert questions["color.primary"].candidates[0].value == "#1F232A"
    assert questions["color.background"].candidates[0].value == "#FCFBF8"
    assert questions["color.text"].candidates[0].value == "#1F232A"
    assert questions["font.heading"].candidates[0].value["family"] == "Clash Display"
    assert questions["font.heading"].candidates[1].value["family"] == "Fraunces"
    assert questions["font.body"].candidates[0].value["family"] == "General Sans"


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
