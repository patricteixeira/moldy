"""Extração e parsing de nomes de fonte de PDFs de diretrizes (PyMuPDF)."""

from __future__ import annotations

from io import BytesIO
import re
import unicodedata
from pathlib import Path

import pymupdf
from fontTools.ttLib import TTFont, TTLibError

from brand_runtime.intake.base import Candidate
from brand_runtime.intake.fonts import FontInfo, font_info_from_ttfont
from brand_runtime.ir.models import Evidence

_CONFIDENCE = 0.8
_DECLARED_CONFIDENCE = 0.95
_EMBEDDED_CONFIDENCE = 0.9

_SUBSET_PREFIX = re.compile(r"^[A-Z]{6}\+")

_WEIGHT_TOKENS: dict[str, int] = {
    "thin": 100,
    "extralight": 200,
    "light": 300,
    "regular": 400,
    "book": 400,
    "medium": 500,
    "semibold": 600,
    "demibold": 600,
    "bold": 700,
    "extrabold": 800,
    "black": 900,
    "heavy": 900,
}
_STYLE_TOKENS = ("italic", "oblique")
# Match mais longo primeiro: "semibold" antes de "bold", "extralight" antes de "light".
_ALL_TOKENS = sorted([*_WEIGHT_TOKENS, *_STYLE_TOKENS], key=len, reverse=True)
_TECHNICAL_FONT = re.compile(
    r"^(?:false|null|none|unknown|type\s*3(?:\s*\([^)]*\))?|f\d+|cidfont.*)$",
    re.IGNORECASE,
)
_FAMILY_LINE = re.compile(
    r"^[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ'’.-]*(?:\s+[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ'’.-]*){0,3}$"
)
_HEADING_LABELS = (
    "estrutura & impacto",
    "estrutura e impacto",
    "acento autoral",
    "titulos",
    "titulo",
    "display",
    "heading",
)
_BODY_LABELS = (
    "leitura & ui",
    "leitura e ui",
    "texto corrido",
    "corpo",
    "body",
)
_IGNORED_FAMILY_LINES = frozenset({"digital", "artisan", "primarias", "hex", "rgb", "cmyk"})


def _consume_tokens(text: str) -> tuple[int | None, bool, bool]:
    """Consome tokens concatenados (ex.: "SemiBoldItalic"), case-insensitive.

    Retorna (weight, italic, matched_any); o token de peso mais à direita vence.
    """
    lower = text.lower()
    weight: int | None = None
    italic = False
    matched_any = False
    pos = 0
    while pos < len(lower):
        for token in _ALL_TOKENS:
            if lower.startswith(token, pos):
                if token in _WEIGHT_TOKENS:
                    weight = _WEIGHT_TOKENS[token]
                else:
                    italic = True
                pos += len(token)
                matched_any = True
                break
        else:
            break  # trecho sem token conhecido: ignora o restante
    return weight, italic, matched_any


def _strip_trailing_tokens(name: str) -> tuple[str, int | None, bool]:
    """Remove tokens de peso/estilo colados ao fim do nome (ex.: "TimesBold")."""
    weight: int | None = None
    italic = False
    while True:
        lower = name.lower()
        for token in _ALL_TOKENS:
            if lower.endswith(token) and len(name) > len(token):
                if token in _WEIGHT_TOKENS:
                    if weight is None:  # o mais à direita vence
                        weight = _WEIGHT_TOKENS[token]
                else:
                    italic = True
                name = name[: len(name) - len(token)]
                break
        else:
            return name, weight, italic


def _split_camel_case(family: str) -> str:
    family = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", family)
    family = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", " ", family)
    return family.strip()


def parse_ps_font_name(ps_name: str) -> FontInfo:
    """Interpreta um nome PostScript de fonte (ex.: "ABCDEF+Archivo-Bold").

    Regras: remove prefixo de subset; separa família de modificadores no último
    "-"; mapeia tokens de peso/estilo (podem vir concatenados); sem sufixo,
    procura os tokens no fim do nome da família; família final tem CamelCase
    separado por espaço.
    """
    name = _SUBSET_PREFIX.sub("", ps_name)
    family_part, sep, suffix = name.rpartition("-")
    if sep:
        weight, italic, matched_any = _consume_tokens(suffix)
        if not matched_any:
            family_part = f"{family_part}{suffix}"  # sufixo sem modificadores: parte da família
    else:
        family_part, weight, italic = _strip_trailing_tokens(name)
    # Sufixos PostScript de fontes Microsoft descrevem o formato, não a família.
    family_part = re.sub(r"(?:PS)?MT$", "", family_part, flags=re.IGNORECASE)
    family = _split_camel_case(family_part.replace("-", " "))
    return FontInfo(
        family=family,
        weight=weight if weight is not None else 400,
        style="italic" if italic else "normal",
    )


def _searchable(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    without_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", without_marks.casefold()).strip()


def _valid_family(value: str) -> bool:
    normalized = re.sub(r"\s+", " ", value).strip()
    return bool(normalized) and not _TECHNICAL_FONT.fullmatch(normalized)


def _declared_family_after(lines: list[str], index: int) -> str | None:
    """Obtém a primeira linha com forma de nome de família depois de um rótulo."""
    for candidate in lines[index + 1 : index + 5]:
        stripped = re.sub(r"\s+", " ", candidate).strip()
        if not stripped:
            continue
        searchable = _searchable(stripped)
        if searchable in _IGNORED_FAMILY_LINES or stripped.startswith("Aa "):
            continue
        if _FAMILY_LINE.fullmatch(stripped):
            return stripped
    return None


def _matches_role_label(compact_line: str, labels: tuple[str, ...]) -> bool:
    """Distingue um rótulo editorial de um nome como ``Clash Display``."""
    return any(
        compact_line == label.replace(" ", "")
        or compact_line.startswith(f"{label.replace(' ', '')}:")
        for label in labels
    )


def extract_pdf_declared_fonts(pdf_path: Path) -> dict[str, list[Candidate]]:
    """Lê famílias declaradas em seções tipográficas do manual.

    O parser é deliberadamente conservador: só aceita uma linha curta com forma
    de nome próprio logo após um rótulo semântico conhecido. Isso recupera
    declarações editoriais como ``ESTRUTURA & IMPACTO / Clash Display`` e
    ``LEITURA & UI / General Sans`` sem transformar qualquer título do PDF em
    nome de fonte.
    """
    by_role: dict[str, dict[tuple[str, int, str], Candidate]] = {
        "heading": {},
        "body": {},
    }
    with pymupdf.open(pdf_path) as doc:
        for page_index, page in enumerate(doc):
            lines = [line.strip() for line in page.get_text().splitlines()]
            for index, line in enumerate(lines):
                searchable = _searchable(line)
                compact = searchable.replace(" ", "")
                role: str | None = None
                if _matches_role_label(compact, _HEADING_LABELS):
                    role = "heading"
                elif _matches_role_label(compact, _BODY_LABELS):
                    role = "body"
                if role is None:
                    continue
                family = _declared_family_after(lines, index)
                if family is None or not _valid_family(family):
                    continue
                is_authorial = "autoral" in searchable
                weight = 400 if role == "body" or is_authorial else 700
                style = "italic" if is_authorial else "normal"
                key = (family.casefold(), weight, style)
                if key in by_role[role]:
                    continue
                by_role[role][key] = Candidate(
                    value={"family": family, "weight": weight, "style": style},
                    score=1.0 / (len(by_role[role]) + 1),
                    evidence=[
                        Evidence(
                            source_type="pdf-guideline",
                            path=str(pdf_path),
                            page=page_index + 1,
                            detail=f"fonte declarada para {role}: {family}",
                            confidence=_DECLARED_CONFIDENCE,
                        )
                    ],
                )
    return {role: list(candidates.values()) for role, candidates in by_role.items()}


def _embedded_font_candidates(doc: pymupdf.Document, pdf_path: Path) -> list[Candidate]:
    """Introspecta recursos embutidos, mesmo quando o nome PostScript é inútil."""
    pages_by_xref: dict[int, set[int]] = {}
    for page_index, page in enumerate(doc):
        for resource in page.get_fonts(full=True):
            xref = int(resource[0])
            if xref > 0:
                pages_by_xref.setdefault(xref, set()).add(page_index + 1)

    by_identity: dict[tuple[str, int, str], Candidate] = {}
    page_count = max(len(doc), 1)
    for xref, pages in pages_by_xref.items():
        try:
            resource_name, extension, _font_type, data = doc.extract_font(xref)
            if not data or extension.casefold() not in {"ttf", "otf"}:
                continue
            with TTFont(BytesIO(data), lazy=False) as font:
                info = font_info_from_ttfont(font, source=f"{pdf_path}#{xref}")
        except (AssertionError, KeyError, OSError, TTLibError, ValueError):
            continue
        if not _valid_family(info.family):
            continue
        key = (info.family.casefold(), info.weight, info.style)
        evidence = [
            Evidence(
                source_type="pdf-guideline",
                path=str(pdf_path),
                page=page_number,
                detail=f"fonte embutida no PDF: {resource_name or f'xref {xref}'}",
                confidence=_EMBEDDED_CONFIDENCE,
            )
            for page_number in sorted(pages)
        ]
        score = len(pages) / page_count
        existing = by_identity.get(key)
        if existing is None:
            by_identity[key] = Candidate(
                value=info.model_dump(by_alias=True),
                score=score,
                evidence=evidence,
            )
        else:
            existing.score += score
            existing.evidence.extend(evidence)
    return list(by_identity.values())


def extract_pdf_fonts(pdf_path: Path) -> list[Candidate]:
    """Extrai fontes usadas no texto de um PDF, com score por volume de caracteres.

    Usa os spans de ``page.get_text("dict")`` (campo ``span["font"]``);
    score = caracteres com a fonte / caracteres totais do documento.
    """
    char_counts: dict[str, int] = {}  # ps_name -> caracteres
    pages_by_ps: dict[str, set[int]] = {}
    total_chars = 0

    embedded: list[Candidate] = []
    with pymupdf.open(pdf_path) as doc:
        for page_index, page in enumerate(doc):
            page_number = page_index + 1
            for block in page.get_text("dict")["blocks"]:
                if block["type"] != 0:
                    continue
                for line in block["lines"]:
                    for span in line["spans"]:
                        n_chars = len(span["text"])
                        if n_chars == 0:
                            continue
                        ps_name = span["font"]
                        char_counts[ps_name] = char_counts.get(ps_name, 0) + n_chars
                        pages_by_ps.setdefault(ps_name, set()).add(page_number)
                        total_chars += n_chars
        embedded = _embedded_font_candidates(doc, pdf_path)

    infos: dict[tuple[str, int, str], FontInfo] = {}
    chars: dict[tuple[str, int, str], int] = {}
    evidence: dict[tuple[str, int, str], list[Evidence]] = {}
    for ps_name, count in char_counts.items():
        info = parse_ps_font_name(ps_name)
        if not _valid_family(info.family):
            continue
        key = (info.family, info.weight, info.style)
        infos.setdefault(key, info)
        chars[key] = chars.get(key, 0) + count
        evidence.setdefault(key, []).extend(
            Evidence(
                source_type="pdf-guideline",
                path=str(pdf_path),
                page=page_number,
                detail=ps_name,
                confidence=_CONFIDENCE,
            )
            for page_number in sorted(pages_by_ps[ps_name])
        )

    candidates = [
        Candidate(
            value=infos[key].model_dump(by_alias=True),
            score=chars[key] / total_chars if total_chars else 0.0,
            evidence=evidence[key],
        )
        for key in infos
    ]
    by_identity = {
        (item.value["family"].casefold(), item.value["weight"], item.value["style"]): item
        for item in candidates
    }
    for item in embedded:
        key = (item.value["family"].casefold(), item.value["weight"], item.value["style"])
        existing = by_identity.get(key)
        if existing is None:
            candidates.append(item)
            by_identity[key] = item
        else:
            existing.score += item.score
            existing.evidence.extend(item.evidence)
    candidates.sort(key=lambda c: c.score, reverse=True)
    return candidates
