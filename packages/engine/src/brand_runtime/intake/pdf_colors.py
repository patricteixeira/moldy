"""Extração de paleta de cores de PDFs de diretrizes de marca (PyMuPDF)."""

from __future__ import annotations

from pathlib import Path

import pymupdf

from brand_runtime.colors import dedupe_colors, delta_e, normalize_color
from brand_runtime.intake.base import Candidate
from brand_runtime.ir.models import Evidence

_VECTOR_CONFIDENCE = 0.9
_TEXT_CONFIDENCE = 0.7
_DEDUPE_THRESHOLD = 6.0


def _rgb_floats_to_hex(rgb: tuple[float, ...]) -> str:
    r, g, b = (round(channel * 255) for channel in rgb[:3])
    return normalize_color(f"#{r:02X}{g:02X}{b:02X}")


def _srgb_int_to_hex(value: int) -> str:
    return normalize_color(f"#{value & 0xFFFFFF:06X}")


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
        candidates.append(
            Candidate(value=representative, score=normalized, evidence=evidence)
        )
    return candidates
