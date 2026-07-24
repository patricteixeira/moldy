import pymupdf
import pytest

from brand_runtime.intake.pdf_composition import (
    CompositionDeclarations,
    DeclaredLayoutStyle,
    extract_pdf_composition,
    merge_composition_declarations,
)


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


def test_extracts_positive_and_dark_logo_usage_written_as_real_brand_guidelines(tmp_path):
    declarations = extract_pdf_composition(
        _manual(
            tmp_path,
            """VARIACOES
Verde sobre claro - uso padrao
Creme sobre verde - fundos escuros
""",
        )
    )

    assert declarations.light_mode_evidence
    assert declarations.dark_mode_evidence


def test_extracts_compact_modes_ratios_and_motif_from_practical_manual(tmp_path):
    declarations = extract_pdf_composition(
        _manual(
            tmp_path,
            """MODO CLARO
Padrão. Papel de fundo, âmbar como tinta, grafite pontual.
MODO ESCURO
Carvão de fundo, corpo em papel, âmbar como acento display.
PROPORÇÃO & ACENTO
Área 60/25/15 (papel/âmbar/grafite).
MOTIVOS GRÁFICOS
Ponto âmbar, fio 1px, diagonais 135º e arcos.
""",
        )
    )

    assert declarations.light_mode_evidence
    assert declarations.dark_mode_evidence
    assert [(item.role, item.ratio) for item in declarations.color_ratios] == [
        ("primary", 0.15),
        ("background", 0.6),
        ("accent", 0.25),
    ]
    assert [item.kind for item in declarations.motifs] == ["diagonal-lines"]


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


def test_binds_declared_ratios_to_their_semantic_hex_values(tmp_path):
    declarations = extract_pdf_composition(
        _manual(
            tmp_path,
            """Grafite - tinta
60%
HEX #1F232A
Ambar - o ponto
10%
HEX #CA6B0B
Papel - fundo
30%
HEX #FCFBF8
""",
        )
    )

    assert [(item.role, item.ratio, item.color_value) for item in declarations.color_ratios] == [
        ("primary", 0.6, "#1F232A"),
        ("background", 0.3, "#FCFBF8"),
        ("accent", 0.1, "#CA6B0B"),
    ]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (
            """Two motifs recur: the lotus as a divider ornament.
Gold hairline rule
1 px gradient, dot or lotus centered.
""",
            "ornamental-divider",
        ),
        (
            """Grade base de 8px, cantos arquitetônicos e restritos,
sombras verde-escuras suaves — profundidade sugerida, não dramatizada.
""",
            "restrained-clinical-grid",
        ),
    ],
)
def test_extracts_closed_layout_style_only_from_complete_declaration(tmp_path, text, expected):
    declarations = extract_pdf_composition(_manual(tmp_path, text))

    assert declarations.layout_style is not None
    assert declarations.layout_style.kind == expected
    assert declarations.layout_style.evidence[0].authoritative is True


def test_partial_layout_language_does_not_select_an_archetype(tmp_path):
    declarations = extract_pdf_composition(
        _manual(tmp_path, "A página contém uma grade e uma linha dourada decorativa.")
    )

    assert declarations.layout_style is None


def test_conflicting_layout_styles_cancel_selection_instead_of_guessing():
    declarations = [
        CompositionDeclarations(
            layout_style=DeclaredLayoutStyle(kind="ornamental-divider", evidence=[])
        ),
        CompositionDeclarations(
            layout_style=DeclaredLayoutStyle(kind="restrained-clinical-grid", evidence=[])
        ),
    ]

    assert merge_composition_declarations(declarations).layout_style is None
