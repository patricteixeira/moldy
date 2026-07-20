from brand_runtime.intake.pdf_text import _page_content
from brand_runtime.intake.pdf_fonts import _ocr_labeled_font
from brand_runtime.intake.identity import _clean, _inline_labeled_excerpts


class FakePage:
    def __init__(self, native_text: str, ocr_text: str = "") -> None:
        self.native_text = native_text
        self.ocr_text = ocr_text
        self.ocr_calls = 0

    def get_text(self, kind: str, *, textpage=None):
        text = self.ocr_text if textpage is not None else self.native_text
        if kind == "blocks":
            return [(0, 0, 100, 20, text, 0, 0)] if text else []
        return text

    def get_textpage_ocr(self, **kwargs):
        self.ocr_calls += 1
        assert kwargs == {"language": "por+eng", "dpi": 150, "full": True}
        return object()


def test_preserva_texto_nativo_sem_executar_ocr():
    page = FakePage("Manifesto da marca com conteúdo textual suficiente para leitura.")

    content = _page_content(page, 2)

    assert content.page_number == 2
    assert content.text.startswith("Manifesto")
    assert content.used_ocr is False
    assert page.ocr_calls == 0


def test_aplica_ocr_local_em_pdf_achatado():
    page = FakePage("", "MANIFESTO\nAfeto em camadas.\nA marca cresce com cuidado.")

    content = _page_content(page, 3)

    assert content.page_number == 3
    assert "Afeto em camadas" in content.text
    assert content.blocks[0][4].startswith("MANIFESTO")
    assert content.used_ocr is True
    assert page.ocr_calls == 1


def test_falha_do_ocr_mantem_fallback_vazio_sem_quebrar_importacao():
    class BrokenOcrPage(FakePage):
        def get_textpage_ocr(self, **kwargs):
            raise RuntimeError("Tesseract indisponível")

    content = _page_content(BrokenOcrPage(""), 1)

    assert content.text == ""
    assert content.used_ocr is False


def test_recupera_familias_coladas_a_rotulos_pelo_ocr():
    lines = [
        "Cormorant Garamondrituios E NOMES DE PRODUTO",
        "Montserratcorro, LEGENDAS E ETIQUETAS",
        "Ambas no Google Fonts: procure por “Cormorant Garamond” e “Montserrat”.",
    ]

    assert _ocr_labeled_font(lines[0], lines) == (
        "heading",
        "Cormorant Garamond",
        700,
        "normal",
    )
    assert _ocr_labeled_font(lines[1], lines) == (
        "body",
        "Montserrat",
        400,
        "normal",
    )


def test_separa_rotulo_de_voz_quando_ocr_junta_colunas():
    excerpts = _inline_labeled_excerpts(
        "Fundos. Prefira marfim em áreas limpas. "
        "Voz. Escrita quente e próxima; emoji nas redes, nunca dentro da marca."
    )

    assert excerpts == [
        (
            "voice",
            "Escrita quente e próxima; emoji nas redes, nunca dentro da marca.",
        )
    ]


def test_remove_ruido_de_emoji_ilegivel_sem_perder_a_regra():
    assert (
        _clean("Escrita quente; emoji nas redes (@ + 99), nunca dentro da marca.")
        == "Escrita quente; emojis nas redes, nunca dentro da marca."
    )
