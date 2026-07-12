from brand_runtime.intake.pdf_colors import extract_pdf_colors


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
