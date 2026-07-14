import pymupdf

from brand_runtime.intake.pdf_composition import extract_pdf_composition


def _manual(tmp_path, text):
    path = tmp_path / "manual.pdf"
    with pymupdf.open() as document:
        page = document.new_page(width=595, height=842)
        page.insert_textbox(
            pymupdf.Rect(40, 40, 555, 800),
            text,
            fontname="helv",
            fontsize=11,
        )
        document.save(path)
    return path


def test_extracts_only_explicit_editorial_declarations(tmp_path):
    path = _manual(
        tmp_path,
        """FUNDO CLARO - POSITIVO
FUNDO ESCURO - NEGATIVO
Grafite - tinta
60%
Ambar - o ponto
10%
Papel - fundo
30%
O ambar deve ficar abaixo de 10% da composicao.
PADRAO DIAGONAL - FUNDOS E CAPAS
Numeracao sempre com zero a esquerda.
MINIMO DIGITAL
24 px
AREA DE PROTECAO = 1/4 DA ALTURA
""",
    )

    declarations = extract_pdf_composition(path)

    assert declarations.light_mode_evidence[0].page == 1
    assert declarations.dark_mode_evidence[0].page == 1
    assert [(item.role, item.ratio) for item in declarations.color_ratios] == [
        ("primary", 0.6),
        ("background", 0.3),
        ("accent", 0.1),
    ]
    assert declarations.accent is not None
    assert declarations.accent.max_ratio == 0.1
    assert [item.kind for item in declarations.motifs] == ["diagonal-lines"]
    assert declarations.numbering_evidence[0].detail == ("numeração declarada: zero à esquerda")
    assert declarations.logo_geometry is not None
    assert declarations.logo_geometry.min_width_px == 24
    assert declarations.logo_geometry.clear_space_ratio == 0.25
    assert all(
        evidence.source_type == "pdf-guideline"
        for evidence in (
            *declarations.light_mode_evidence,
            *declarations.dark_mode_evidence,
            *declarations.numbering_evidence,
        )
    )


def test_does_not_infer_rules_from_incidental_visual_language(tmp_path):
    path = _manual(
        tmp_path,
        """A pagina usa algumas linhas diagonais como ilustracao.
Uma amostra ocupa 60% deste quadro e outra ocupa 10%.
O numero 01 aparece em um exemplo de post.
""",
    )

    declarations = extract_pdf_composition(path)

    assert not declarations.has_rules()
