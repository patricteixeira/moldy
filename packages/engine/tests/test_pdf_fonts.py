import pymupdf
from fontTools.ttLib import TTFont

from brand_runtime.intake.pdf_fonts import (
    FontInfo,
    extract_pdf_declared_fonts,
    extract_pdf_fonts,
    parse_ps_font_name,
)


def test_parse_subset_bold():
    info = parse_ps_font_name("ABCDEF+Archivo-Bold")
    assert info == FontInfo(family="Archivo", weight=700, style="normal")


def test_parse_semibold_italic_concatenated():
    info = parse_ps_font_name("Inter-SemiBoldItalic")
    assert info.family == "Inter"
    assert info.weight == 600
    assert info.style == "italic"


def test_parse_suffix_embedded_in_family():
    assert parse_ps_font_name("TimesBold").weight == 700


def test_parse_camel_case_family_split():
    assert parse_ps_font_name("ArchivoNarrow-Regular").family == "Archivo Narrow"


def test_parse_strips_microsoft_postscript_suffix():
    assert parse_ps_font_name("ArialMT").family == "Arial"
    assert parse_ps_font_name("TimesNewRomanPSMT").family == "Times New Roman"


def test_extract_from_fixture_pdf(brand_pdf):
    cands = extract_pdf_fonts(brand_pdf)
    families = {c.value["family"] for c in cands}
    assert "Helvetica" in families  # builtin "helv"
    weights = {c.value["family"]: c.value["weight"] for c in cands}
    assert weights.get("Times", weights.get("Times New Roman", 0)) == 700  # tibo = Times-Bold


def test_extracts_families_declared_for_heading_and_body(tmp_path):
    pdf_path = tmp_path / "tipografia.pdf"
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_textbox(
            pymupdf.Rect(40, 40, 500, 700),
            "ESTRUTURA & IMPACTO\nClash Display\nAa Gg\n"
            "ACENTO AUTORAL\nFraunces\nAa Gg\n"
            "LEITURA & UI\nGeneral Sans\nAa Gg",
            fontsize=12,
        )
        doc.save(pdf_path)

    declared = extract_pdf_declared_fonts(pdf_path)

    assert [candidate.value["family"] for candidate in declared["heading"]][:2] == [
        "Clash Display",
        "Fraunces",
    ]
    assert declared["heading"][1].value["style"] == "italic"
    assert declared["body"][0].value["family"] == "General Sans"


def test_extracts_letterspaced_inline_role_declarations(tmp_path):
    pdf_path = tmp_path / "tipografia-inline.pdf"
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_textbox(
            pymupdf.Rect(40, 40, 550, 760),
            "D I S P LAY · P O P P I N S · W E I G H TS 5 0 0 – 7 0 0\n"
            "B O DY · N U N I TO S A N S · W E I G H TS 4 0 0 / 6 0 0 / 7 0 0\n"
            "ACC E N T · P LAY FA I R D I S P LAY I TA L I C · 5 0 0 – 7 0 0\n"
            "Nearest matches: Poppins, Nunito Sans, and Playfair Display.",
            fontsize=12,
        )
        doc.save(pdf_path)

    declared = extract_pdf_declared_fonts(pdf_path)
    heading = {(item.value["family"], item.value["style"]) for item in declared["heading"]}
    body = {(item.value["family"], item.value["weight"]) for item in declared["body"]}

    assert ("Poppins", "normal") in heading
    assert ("Playfair Display", "italic") in heading
    assert ("Nunito Sans", 400) in body


def test_extracts_letterspaced_families_after_em_dash_without_using_tracking_as_font(
    tmp_path,
):
    pdf_path = tmp_path / "tipografia-em-dash.pdf"
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_textbox(
            pymupdf.Rect(40, 40, 550, 760),
            "D I S P L A Y & U I — A R C H I V O\n"
            "WEIGHTS\n100–900\nUSE\nHEADLINES · WORDMARK · CAPS LABELS\n"
            "B O D Y — H A N K E N G R O T E S K\n"
            "BODY\n11.5PT / 1.6\nCAPS TRACKING\n.18EM–.32EM",
            fontsize=12,
        )
        doc.save(pdf_path)

    declared = extract_pdf_declared_fonts(pdf_path)

    assert declared["heading"][0].value["family"] == "Archivo"
    assert declared["body"][0].value["family"] == "Hanken Grotesk"
    assert all(
        candidate.value["family"] != "CAPS TRACKING"
        for candidates in declared.values()
        for candidate in candidates
    )


def test_embedded_resource_recovers_real_family_when_span_name_is_false(tmp_path, fixture_font):
    renamed_font = tmp_path / "clash-subset.ttf"
    with TTFont(fixture_font) as font:
        for record in font["name"].names:
            if record.nameID == 1:
                record.string = "Clash Display Medium".encode(record.getEncoding())
            elif record.nameID in {4, 6}:
                record.string = "false".encode(record.getEncoding())
        font["OS/2"].usWeightClass = 500
        font.save(renamed_font)

    pdf_path = tmp_path / "fonte-embutida.pdf"
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_font(fontname="false", fontfile=str(renamed_font))
        page.insert_text((40, 60), "Marca real", fontname="false", fontsize=20)
        doc.save(pdf_path)

    candidates = extract_pdf_fonts(pdf_path)
    families = {candidate.value["family"] for candidate in candidates}

    assert "Clash Display" in families
    assert "false" not in families
    assert not any(family.startswith("Type3") for family in families)
