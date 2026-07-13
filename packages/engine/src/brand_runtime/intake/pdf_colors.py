"""Extração de paleta de cores de PDFs de diretrizes de marca (PyMuPDF)."""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

import pymupdf

from brand_runtime.colors import dedupe_colors, delta_e, normalize_color
from brand_runtime.intake.base import Candidate
from brand_runtime.ir.models import Evidence

_VECTOR_CONFIDENCE = 0.9
_TEXT_CONFIDENCE = 0.7
_DEDUPE_THRESHOLD = 6.0
_HEX_DECLARATION = re.compile(r"(?i)(?P<label>\bHEX\s*)?#(?P<hex>[0-9a-f]{6}|[0-9a-f]{3})\b")
_PERCENTAGE = re.compile(r"(?P<value>\d{1,3})\s*%")

_PRIMARY_WORDS = ("primaria", "grafite", "tinta", "ambar", "acento")
_BACKGROUND_WORDS = ("fundo", "papel", "background", "surface")
_TEXT_WORDS = ("texto", "tinta", "grafite", "leitura", "corpo")


def _rgb_floats_to_hex(rgb: tuple[float, ...]) -> str:
    r, g, b = (round(channel * 255) for channel in rgb[:3])
    return normalize_color(f"#{r:02X}{g:02X}{b:02X}")


def _srgb_int_to_hex(value: int) -> str:
    return normalize_color(f"#{value & 0xFFFFFF:06X}")


def _searchable(value: str) -> str:
    """Normaliza texto extraído para comparar rótulos editoriais com robustez."""
    decomposed = unicodedata.normalize("NFKD", value)
    without_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", without_marks.casefold()).strip()


def _nearest_semantic_label(before: str) -> str:
    """Encontra o rótulo curto imediatamente associado a uma amostra de paleta."""
    words = (*_PRIMARY_WORDS, *_BACKGROUND_WORDS, *_TEXT_WORDS)
    lines = [
        line
        for line in before.splitlines()
        if line.strip()
        and "file:///" not in line.casefold()
        and ".html" not in line.casefold()
        and not re.fullmatch(r"\s*\d{1,2}/\d{1,2}\s*", line)
        and not re.match(r"\s*\d{1,2}/\d{1,2}/\d{4}", line)
    ]
    for line in reversed(lines[-3:]):
        normalized = _searchable(line)
        if len(normalized) <= 80 and any(word in normalized for word in words):
            return normalized
    return ""


def _label_score(label: str, words: tuple[str, ...]) -> float:
    return 12.0 * sum(word in label for word in words)


def extract_pdf_declared_colors(pdf_path: Path) -> dict[str, list[Candidate]]:
    """Extrai cores HEX declaradas e as ranqueia pelos papéis descritos no texto.

    Manuais reais frequentemente escrevem a paleta como ``HEX #RRGGBB``. Essa
    declaração é mais informativa do que a área ocupada por uma cor na página.
    O contexto anterior associa termos como ``grafite/tinta``, ``papel/fundo``
    e ``texto/leitura`` aos papéis usados pelo wizard. O retorno mantém listas
    independentes porque uma mesma cor pode ser, legitimamente, primária e de
    texto.
    """
    pages: list[tuple[int, str]] = []
    with pymupdf.open(pdf_path) as doc:
        pages = [(index + 1, page.get_text()) for index, page in enumerate(doc)]

    # Marcador preserva a página sem impedir que um rótulo no fim de uma página
    # qualifique o HEX que abre a seguinte (caso comum em PDFs impressos do web).
    full_text = "\n".join(text for _, text in pages)
    page_offsets: list[tuple[int, int]] = []
    offset = 0
    for page_number, text in pages:
        page_offsets.append((offset, page_number))
        offset += len(text) + 1

    by_role: dict[str, dict[str, tuple[float, list[Evidence]]]] = {
        "primary": {},
        "background": {},
        "text": {},
    }
    for match in _HEX_DECLARATION.finditer(full_text):
        value = normalize_color(f"#{match['hex']}")
        before = full_text[max(0, match.start() - 320) : match.start()]
        label = _nearest_semantic_label(before)
        compact_before = _searchable(before).replace(" ", "")
        page_number = 1
        for start, candidate_page in page_offsets:
            if start > match.start():
                break
            page_number = candidate_page

        explicit_bonus = 24.0 if match["label"] else 0.25
        percentages = list(_PERCENTAGE.finditer(before[-120:]))
        percentage_bonus = 0.0
        if percentages:
            percentage_bonus = min(float(percentages[-1]["value"]), 100.0) / 10.0

        role_scores = {
            "primary": explicit_bonus
            + percentage_bonus
            + _label_score(label, _PRIMARY_WORDS)
            + (5.0 if "primaria" in compact_before and match["label"] else 0.0),
            "background": explicit_bonus + _label_score(label, _BACKGROUND_WORDS),
            "text": explicit_bonus + _label_score(label, _TEXT_WORDS),
        }
        role_relevance = {
            "primary": any(word in label for word in _PRIMARY_WORDS)
            or bool(match["label"] and "primaria" in compact_before),
            "background": any(word in label for word in _BACKGROUND_WORDS),
            "text": any(word in label for word in _TEXT_WORDS),
        }
        evidence = Evidence(
            source_type="pdf-guideline",
            path=str(pdf_path),
            page=page_number,
            detail=f"cor HEX declarada no texto: {value}",
            confidence=0.98,
        )
        for role, score in role_scores.items():
            if not role_relevance[role]:
                continue
            previous_score, previous_evidence = by_role[role].get(value, (0.0, []))
            by_role[role][value] = (previous_score + score, [*previous_evidence, evidence])

    result: dict[str, list[Candidate]] = {}
    for role, values in by_role.items():
        ordered = sorted(values.items(), key=lambda item: item[1][0], reverse=True)
        if not ordered:
            result[role] = []
            continue
        maximum = ordered[0][1][0]
        result[role] = [
            Candidate(value=value, score=score / maximum, evidence=evidence)
            for value, (score, evidence) in ordered
        ]
    return result


def extract_pdf_colors(pdf_path: Path) -> list[Candidate]:
    """Extrai cores de desenhos vetoriais e de texto de um PDF, com evidência por página.

    Peso de vetores = área do retângulo delimitador (pt²) / área da página;
    peso de texto = caracteres do span / caracteres totais da página. Pesos são
    somados por cor normalizada, cores próximas são fundidas com ``dedupe_colors``
    e os scores finais são normalizados para máximo 1.0.
    """
    weights: dict[str, float] = {}
    evidence_by_color: dict[str, dict[tuple[int, float], Evidence]] = {}

    def add(hex_color: str, weight: float, page_number: int, confidence: float) -> None:
        weights[hex_color] = weights.get(hex_color, 0.0) + weight
        key = (page_number, confidence)
        evidence_by_color.setdefault(hex_color, {}).setdefault(
            key,
            Evidence(
                source_type="pdf-guideline",
                path=str(pdf_path),
                page=page_number,
                confidence=confidence,
            ),
        )

    with pymupdf.open(pdf_path) as doc:
        for page_index, page in enumerate(doc):
            page_number = page_index + 1
            page_area = page.rect.width * page.rect.height
            if page_area <= 0:
                continue

            for drawing in page.get_drawings():
                rect = drawing["rect"]
                weight = (rect.width * rect.height) / page_area
                for color_key in ("fill", "color"):  # fills e strokes
                    rgb = drawing.get(color_key)
                    if rgb is None:
                        continue
                    add(_rgb_floats_to_hex(rgb), weight, page_number, _VECTOR_CONFIDENCE)

            spans = [
                span
                for block in page.get_text("dict")["blocks"]
                if block["type"] == 0
                for line in block["lines"]
                for span in line["spans"]
            ]
            total_chars = sum(len(span["text"]) for span in spans)
            if total_chars == 0:
                continue
            for span in spans:
                weight = len(span["text"]) / total_chars
                add(_srgb_int_to_hex(span["color"]), weight, page_number, _TEXT_CONFIDENCE)

    merged = dedupe_colors(list(weights.items()), threshold=_DEDUPE_THRESHOLD)
    if not merged:
        return []

    max_score = merged[0][1]
    candidates: list[Candidate] = []
    assigned: set[str] = set()
    for representative, score in merged:
        evidence: list[Evidence] = []
        for original, evidence_map in evidence_by_color.items():
            if original in assigned:
                continue
            if delta_e(original, representative) < _DEDUPE_THRESHOLD:
                assigned.add(original)
                evidence.extend(evidence_map.values())
        # max_score == 0 ⇒ todos os pesos são 0 (ex.: só strokes com rect de área
        # zero); cores empatadas normalizam para 1.0, como no caso não degenerado.
        normalized = score / max_score if max_score > 0 else 1.0
        candidates.append(Candidate(value=representative, score=normalized, evidence=evidence))
    return candidates
