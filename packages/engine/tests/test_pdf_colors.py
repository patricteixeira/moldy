import pymupdf

from brand_runtime.intake.pdf_colors import extract_pdf_colors, extract_pdf_declared_colors


def test_extracts_the_three_colors(brand_pdf):
    cands = extract_pdf_colors(brand_pdf)
    values = [c.value for c in cands]
    assert "#1A4D8F" in values
    assert "#F4A300" in values
    assert "#333333" in values


def test_big_rect_outranks_small_rect(brand_pdf):
    cands = extract_pdf_colors(brand_pdf)
    by_value = {c.value: c.score for c in cands}
    assert by_value["#1A4D8F"] > by_value["#F4A300"]


def test_evidence_carries_page_and_source(brand_pdf):
    cands = extract_pdf_colors(brand_pdf)
    ev = cands[0].evidence[0]
    assert ev.source_type == "pdf-guideline"
    assert ev.page == 1


def test_stroke_only_pdf_with_zero_area_rect_does_not_crash(tmp_path):
    """Linha horizontal com stroke: rect delimitador tem área zero → todos os pesos 0."""
    pdf_path = tmp_path / "linha.pdf"
    with pymupdf.open() as doc:
        page = doc.new_page(width=595, height=842)
        page.draw_line((50, 100), (500, 100), color=(1, 0, 0))
        doc.save(pdf_path)

    cands = extract_pdf_colors(pdf_path)

    values = [c.value for c in cands]
    assert "#FF0000" in values
    assert all(0.0 <= c.score <= 1.0 for c in cands)


def test_declared_hex_colors_are_ranked_by_semantic_role_across_pages(tmp_path):
    pdf_path = tmp_path / "manual-declarativo.pdf"
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_textbox(
            pymupdf.Rect(40, 40, 500, 700),
            "PRIMARIAS\nGrafite - tinta\n60%\nHEX #1F232A\n"
            "Ambar - o ponto\n10%\nHEX #CA6B0B\nPapel - fundo\n30%",
            fontsize=12,
        )
        page = doc.new_page()
        page.insert_text((40, 40), "HEX #FCFBF8", fontsize=12)
        doc.save(pdf_path)

    roles = extract_pdf_declared_colors(pdf_path)

    assert roles["primary"][0].value == "#1F232A"
    assert roles["background"][0].value == "#FCFBF8"
    assert roles["text"][0].value == "#1F232A"
    assert roles["primary"][0].evidence[0].detail == "cor HEX declarada no texto: #1F232A"


def test_functional_hex_colors_are_not_promoted_to_background_or_text(tmp_path):
    pdf_path = tmp_path / "cores-funcionais.pdf"
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_textbox(
            pymupdf.Rect(40, 40, 500, 700),
            "Papel - fundo\nHEX #FCFBF8\nGrafite - tinta\nHEX #1F232A\n"
            "FUNCIONAIS - apenas interface\nSucesso\n#4F7D5F\nErro\n#B1492F\nInformacao\n#5A6F88",
            fontsize=12,
        )
        doc.save(pdf_path)

    roles = extract_pdf_declared_colors(pdf_path)
    background = {candidate.value for candidate in roles["background"]}
    text = {candidate.value for candidate in roles["text"]}

    assert background == {"#FCFBF8"}
    assert text == {"#1F232A"}
