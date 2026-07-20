"""Infraestrutura de tradução local inglês → português do Brasil."""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from threading import Lock
from typing import Any

from brand_runtime.intake.identity import IdentityField
from brand_runtime.intake.translation import IdentityTranslator, TranslationError

_MODEL_FILES = (
    "sentencepiece.model",
    "model/config.json",
    "model/model.bin",
    "model/shared_vocabulary.json",
)
_PARAGRAPH_BREAK = re.compile(r"(\n+)")
_SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+(?=[\"'“‘(]*[A-Z0-9])")
_NEGATIVE_PREFIX = re.compile(r"^(?:do not|don't|never|avoid)\b", re.IGNORECASE)
_IMPERATIVE_VERBS = {
    "add",
    "alter",
    "apply",
    "change",
    "combine",
    "create",
    "crowd",
    "distort",
    "introduce",
    "multiply",
    "outline",
    "place",
    "recolor",
    "recolour",
    "rotate",
    "stretch",
    "use",
}
_TERMINOLOGY_FIXES = (
    (re.compile(r"\bsolte sombras\b", re.IGNORECASE), "sombras projetadas"),
    (re.compile(r"\ba marca da palavra\b", re.IGNORECASE), "o logotipo"),
    (re.compile(r"\bmarca da palavra\b", re.IGNORECASE), "logotipo"),
    (re.compile(r"\bnão ache a marca\b", re.IGNORECASE), "Não sobrecarregue a marca"),
    (re.compile(r"\besboce o logotipo\b", re.IGNORECASE), "contorne o logotipo"),
    (re.compile(r'"amazing"', re.IGNORECASE), '"incrível"'),
)


class LocalBrazilianPortugueseTranslator:
    """Executa o modelo OPUS-MT empacotado sem rede ou credenciais."""

    identifier = "opus-mt-en-pb-local-1.9"

    def __init__(self, model_dir: Path) -> None:
        """Guarda o caminho; o modelo pesado só é carregado no primeiro uso."""
        self._model_dir = model_dir
        self._load_lock = Lock()
        self._translate_lock = Lock()
        self._sentencepiece: Any | None = None
        self._translator: Any | None = None

    def _load(self) -> tuple[Any, Any]:
        if self._sentencepiece is not None and self._translator is not None:
            return self._sentencepiece, self._translator
        with self._load_lock:
            if self._sentencepiece is not None and self._translator is not None:
                return self._sentencepiece, self._translator
            missing = [name for name in _MODEL_FILES if not (self._model_dir / name).is_file()]
            if missing:
                raise TranslationError("O modelo local está incompleto: " + ", ".join(missing))
            try:
                import ctranslate2
                import sentencepiece
            except ImportError as exc:
                raise TranslationError(
                    "As dependências opcionais de tradução local não estão instaladas."
                ) from exc
            try:
                self._sentencepiece = sentencepiece.SentencePieceProcessor(
                    model_file=str(self._model_dir / "sentencepiece.model")
                )
                self._translator = ctranslate2.Translator(
                    str(self._model_dir / "model"),
                    device="cpu",
                )
            except (OSError, RuntimeError, ValueError) as exc:
                raise TranslationError("Não foi possível carregar o modelo local.") from exc
        return self._sentencepiece, self._translator

    @staticmethod
    def _avoid_context(unit: str) -> str:
        """Explicita a proibição que um cabeçalho DON'T pode ter carregado."""
        if _NEGATIVE_PREFIX.match(unit):
            return unit
        first_word = re.match(r"[A-Za-z]+", unit)
        lowered = unit[:1].lower() + unit[1:]
        if first_word is not None and first_word.group(0).casefold() in _IMPERATIVE_VERBS:
            return f"Do not {lowered}"
        return f"Avoid {lowered}"

    @classmethod
    def _units(cls, text: str, field: IdentityField) -> tuple[list[str], list[str]]:
        parts = _PARAGRAPH_BREAK.split(text)
        units: list[str] = []
        shape: list[str] = []
        for part in parts:
            if not part:
                continue
            if part.startswith("\n"):
                shape.append(part)
                continue
            sentences = [
                item.strip().replace(" · ", ", ")
                for item in _SENTENCE_BREAK.split(part)
                if item.strip()
            ]
            shape.extend(f"\0{len(units) + index}" for index in range(len(sentences)))
            units.extend(
                cls._avoid_context(sentence) if field == "avoid" else sentence
                for sentence in sentences
            )
        return units, shape

    @staticmethod
    def _clean_decoded(text: str) -> str:
        cleaned = text.replace("▁", " ")
        cleaned = re.sub(r"\s+([,.;:!?])", r"\1", cleaned)
        cleaned = re.sub(r"[ \t]{2,}", " ", cleaned).strip()
        for pattern, replacement in _TERMINOLOGY_FIXES:
            cleaned = pattern.sub(replacement, cleaned)
        return cleaned

    @lru_cache(maxsize=512)
    def translate(self, text: str, *, field: IdentityField) -> str:
        """Traduz uma vez por trecho e mantém quebras de parágrafo."""
        if not text.strip():
            return ""
        sentencepiece, translator = self._load()
        units, shape = self._units(text, field)
        if not units:
            return text
        try:
            token_batches = [sentencepiece.encode(unit, out_type=str) for unit in units]
            with self._translate_lock:
                results = translator.translate_batch(token_batches, beam_size=4)
            translated = [
                self._clean_decoded(sentencepiece.decode(result.hypotheses[0]))
                for result in results
            ]
        except (IndexError, OSError, RuntimeError, ValueError) as exc:
            raise TranslationError("O modelo local não conseguiu traduzir o trecho.") from exc
        if len(translated) != len(units):
            raise TranslationError("O modelo local devolveu uma resposta incompleta.")
        rendered: list[str] = []
        for part in shape:
            if part.startswith("\0"):
                rendered.append(translated[int(part[1:])])
                if rendered[-1] and not rendered[-1].endswith("\n"):
                    rendered.append(" ")
            else:
                if rendered and rendered[-1] == " ":
                    rendered.pop()
                rendered.append(part)
        return "".join(rendered).strip()


def build_identity_translator(model_dir: Path | None) -> IdentityTranslator | None:
    """Ativa a tradução somente quando há um diretório configurado."""
    return LocalBrazilianPortugueseTranslator(model_dir) if model_dir is not None else None
