"""Decisão de idioma e tradução não destrutiva da leitura de identidade."""

from __future__ import annotations

import logging
import re
from typing import Literal, Protocol

from brand_runtime.intake.base import Candidate
from brand_runtime.intake.identity import IdentityDraftValue, IdentityField, IdentityTextValue

logger = logging.getLogger(__name__)

DetectedLanguage = Literal["en", "pt-BR", "unknown"]

_ENGLISH_TERMS = {
    "and",
    "are",
    "avoid",
    "brand",
    "declarative",
    "do",
    "from",
    "house",
    "how",
    "is",
    "material",
    "never",
    "not",
    "of",
    "or",
    "sentences",
    "should",
    "short",
    "the",
    "this",
    "to",
    "tone",
    "use",
    "visual",
    "voice",
    "with",
}
_PORTUGUESE_TERMS = {
    "aos",
    "como",
    "com",
    "da",
    "das",
    "de",
    "deve",
    "do",
    "dos",
    "em",
    "marca",
    "humana",
    "intencao",
    "intenção",
    "nao",
    "não",
    "nunca",
    "para",
    "pela",
    "por",
    "que",
    "sem",
    "artesanal",
    "criacao",
    "criação",
    "direta",
    "direto",
    "exagero",
    "existimos",
    "precisa",
    "tom",
    "uma",
    "usar",
    "voz",
}
_TEXT_FIELDS = ("essence", "personality", "voice", "avoid")


class TranslationError(RuntimeError):
    """Indica que a tradução local não pôde produzir um texto confiável."""


class IdentityTranslator(Protocol):
    """Porta mínima para um tradutor inglês → português executado localmente."""

    identifier: str

    def translate(self, text: str, *, field: IdentityField) -> str:
        """Traduz um trecho sem alterar sua estrutura editorial."""


def detect_identity_language(value: IdentityTextValue) -> DetectedLanguage:
    """Distingue inglês e PT-BR apenas quando há evidência lexical suficiente."""
    text = " ".join(getattr(value, field) for field in _TEXT_FIELDS)
    tokens = re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿ']+", text.casefold())
    english_score = sum(token in _ENGLISH_TERMS for token in tokens)
    portuguese_score = sum(token in _PORTUGUESE_TERMS for token in tokens)
    if english_score >= 3 and english_score >= portuguese_score + 2:
        return "en"
    if portuguese_score >= 3 and portuguese_score >= english_score + 2:
        return "pt-BR"
    return "unknown"


def translate_identity_candidate(
    candidate: Candidate,
    translator: IdentityTranslator | None,
) -> Candidate:
    """Traduz um candidato inglês e preserva integralmente o texto de origem."""
    parsed = IdentityDraftValue.model_validate(candidate.value)
    original = IdentityTextValue(**{field: getattr(parsed, field) for field in _TEXT_FIELDS})
    source_language = detect_identity_language(original)

    if source_language != "en":
        prepared = IdentityDraftValue(
            **original.model_dump(),
            source_language=source_language,
            display_language="pt-BR" if source_language == "pt-BR" else "unknown",
            translation_status="not-needed",
        )
    elif translator is None:
        prepared = IdentityDraftValue(
            **original.model_dump(),
            source_language="en",
            display_language="en",
            translation_status="unavailable",
        )
    else:
        try:
            translated = {
                field: translator.translate(text, field=field) if text.strip() else ""
                for field in _TEXT_FIELDS
                if (text := getattr(original, field)) is not None
            }
            if any(
                getattr(original, field).strip() and not translated[field].strip()
                for field in _TEXT_FIELDS
            ):
                raise TranslationError("O tradutor devolveu um campo vazio.")
        except TranslationError as exc:
            logger.warning("Tradução local da identidade indisponível: %s", exc)
            prepared = IdentityDraftValue(
                **original.model_dump(),
                source_language="en",
                display_language="en",
                translation_status="unavailable",
            )
        else:
            prepared = IdentityDraftValue(
                **translated,
                original=original,
                source_language="en",
                display_language="pt-BR",
                translation_status="translated",
                translator=translator.identifier,
            )

    output = candidate.model_copy(deep=True)
    output.value = prepared.model_dump(mode="json", by_alias=True)
    return output
