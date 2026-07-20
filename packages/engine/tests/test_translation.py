from brand_runtime.intake.base import Candidate
from brand_runtime.intake.identity import IdentityTextValue
from brand_runtime.intake.translation import (
    TranslationError,
    detect_identity_language,
    translate_identity_candidate,
)


class PrefixTranslator:
    identifier = "fake-local"

    def translate(self, text: str, *, field: str) -> str:
        return f"PT: {text}"


class FailingTranslator:
    identifier = "fake-failing"

    def translate(self, text: str, *, field: str) -> str:
        raise TranslationError("indisponível no teste")


def _candidate(**overrides: str) -> Candidate:
    value = {
        "essence": "A quiet house. The brand exists to make the complex clear.",
        "personality": "Controlled, silent and sophisticated.",
        "voice": "Short, declarative sentences with an atmospheric tone.",
        "avoid": "Never use emojis or discount language.",
        **overrides,
    }
    return Candidate(value=value, score=4, evidence=[])


def test_detecta_ingles_e_portugues_sem_adivinhar_texto_curto():
    assert detect_identity_language(IdentityTextValue.model_validate(_candidate().value)) == "en"
    assert (
        detect_identity_language(
            IdentityTextValue(
                essence="Existimos para devolver intenção e autoria à criação digital.",
                personality="Humana, artesanal e precisa.",
                voice="Direto, acessível e sem exagero.",
                avoid="Nunca usar urgência ou descontos.",
            )
        )
        == "pt-BR"
    )
    assert detect_identity_language(IdentityTextValue(essence="ORPHÉA")) == "unknown"


def test_traduz_ingles_sem_descartar_o_original():
    translated = translate_identity_candidate(_candidate(), PrefixTranslator())

    assert translated.value["essence"].startswith("PT: ")
    assert translated.value["original"]["essence"].startswith("A quiet house")
    assert translated.value["sourceLanguage"] == "en"
    assert translated.value["displayLanguage"] == "pt-BR"
    assert translated.value["translationStatus"] == "translated"
    assert translated.value["translator"] == "fake-local"


def test_falha_local_mantem_o_original_editavel():
    original = _candidate()
    prepared = translate_identity_candidate(original, FailingTranslator())

    assert prepared.value["essence"] == original.value["essence"]
    assert prepared.value["original"] is None
    assert prepared.value["displayLanguage"] == "en"
    assert prepared.value["translationStatus"] == "unavailable"


def test_portugues_nao_chama_o_tradutor():
    class UnexpectedTranslator:
        identifier = "unexpected"

        def translate(self, text: str, *, field: str) -> str:
            raise AssertionError("texto em português não deve ser traduzido")

    prepared = translate_identity_candidate(
        _candidate(
            essence="A marca existe para devolver intenção à criação.",
            personality="Humana, artesanal e precisa.",
            voice="Direta, acessível e sem exagero.",
            avoid="Nunca usar urgência ou descontos.",
        ),
        UnexpectedTranslator(),
    )

    assert prepared.value["translationStatus"] == "not-needed"
    assert prepared.value["sourceLanguage"] == "pt-BR"
