from pathlib import Path

from brand_api.translation import LocalBrazilianPortugueseTranslator


def test_contexto_de_proibicao_nao_inverte_regras_do_manual():
    translator = LocalBrazilianPortugueseTranslator(Path("modelo-nao-carregado"))

    units, shape = translator._units(
        "Exclamation marks or emojis.\n\nAdd gradients. Recolour the emblem.",
        "avoid",
    )

    assert units == [
        "Avoid exclamation marks or emojis.",
        "Do not add gradients.",
        "Do not recolour the emblem.",
    ]
    assert shape == ["\0" + "0", "\n\n", "\0" + "1", "\0" + "2"]


def test_limpa_marcadores_do_tokenizer_e_termos_de_marca_conhecidos():
    assert (
        LocalBrazilianPortugueseTranslator._clean_decoded(
            "▁Não ache a marca ou use▁a marca da palavra com▁solte sombras."
        )
        == "Não sobrecarregue a marca ou use o logotipo com sombras projetadas."
    )
