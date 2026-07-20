"""Leitura local das declarações que explicam o que uma marca é.

O extrator preserva trechos curtos do próprio manual, sem inventar uma síntese
nem depender de um serviço remoto. Sumários, cabeçalhos e rodapés editoriais
ficam de fora para que a revisão no wizard seja humana, não uma leitura do PDF
bruto.
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path
from typing import Literal

from brand_runtime.intake.base import Candidate
from brand_runtime.intake.pdf_text import extract_pdf_text_pages
from brand_runtime.ir.models import CamelModel, Evidence

IdentityField = Literal["essence", "personality", "voice", "avoid"]

_MARKERS: dict[IdentityField, tuple[str, ...]] = {
    "essence": (
        "essencia",
        "proposito",
        "manifesto",
        "missao",
        "visao",
        "posicionamento",
        "por que existimos",
        "existe para",
        "acreditamos",
        "essence",
        "positioning",
        "purpose",
        "brand identity",
        "our belief",
    ),
    "personality": (
        "personalidade",
        "atributos",
        "valores",
        "principios",
        "atitude",
        "somos",
        "personality",
        "brand character",
        "the register",
        "visual codes",
    ),
    "voice": (
        "tom de voz",
        "nossa voz",
        "linguagem",
        "como falamos",
        "comunicacao",
        "voice & tone",
        "tone of voice",
        "our voice",
        "how we speak",
        "how the house speaks",
    ),
    "avoid": (
        "nao somos",
        "nunca",
        "evitar",
        "nao deve",
        "nao usamos",
        "what not to do",
        "do not",
        "don't",
        "misuse",
    ),
}
# Títulos de manuais costumam vir em caixa-alta com tracking extremo
# (``V O I C E & T O N E``). Estes marcadores são comparados sem espaços ou
# pontuação e só em blocos curtos, evitando classificar uma frase como seção
# apenas porque ela contém, por exemplo, a palavra "never".
_HEADING_MARKERS: dict[IdentityField, tuple[str, ...]] = {
    "essence": (
        "essence",
        "positioning",
        "purpose",
        "brandidentity",
        "manifesto",
        "mission",
        "vision",
        "proposito",
        "essencia",
        "posicionamento",
    ),
    "personality": (
        "personality",
        "brandcharacter",
        "theregister",
        "visualcodes",
        "attributes",
        "values",
        "principles",
        "personalidade",
        "atributos",
        "valores",
    ),
    "voice": (
        "voice&tone",
        "toneofvoice",
        "ourvoice",
        "howwespeak",
        "howthehousespeaks",
        "tomdevoz",
        "nossavoz",
        "comofalamos",
    ),
    "avoid": (
        "never",
        "dont",
        "donot",
        "whatnottodo",
        "avoid",
        "naosomos",
        "naousamos",
        "evitar",
    ),
}
_FIELD_LIMIT = 520
_MIN_EXCERPT_LENGTH = 24
_MAX_HEADING_LENGTH = 180
_INLINE_LABEL = re.compile(
    r"(?i)(?P<label>tom\s+de\s+voz|voz|personalidade|atributos|manifesto|evitar)\s*[.:]\s*"
)
_INLINE_LABEL_FIELDS: dict[str, IdentityField] = {
    "tom de voz": "voice",
    "voz": "voice",
    "personalidade": "personality",
    "atributos": "personality",
    "manifesto": "essence",
    "evitar": "avoid",
}
_AVOID_START = re.compile(
    r"(?i)\b(?:nunca|evitar|não\s+deve|não\s+usamos|never|avoid|do\s+not|don't)\b"
)


class IdentityTextValue(CamelModel):
    """Quatro respostas editoriais que descrevem a expressão da marca."""

    essence: str = ""
    personality: str = ""
    voice: str = ""
    avoid: str = ""


class IdentityDraftValue(IdentityTextValue):
    """Texto editável e metadados de uma eventual tradução local."""

    original: IdentityTextValue | None = None
    source_language: Literal["en", "pt-BR", "unknown"] = "unknown"
    display_language: Literal["en", "pt-BR", "unknown"] = "unknown"
    translation_status: Literal["not-needed", "translated", "unavailable"] = "not-needed"
    translator: str | None = None


def _searchable(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    without_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", without_marks).strip().casefold()


def _clean(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", value).strip()
    return re.sub(
        r"(?i)\bemoji\s+nas\s+redes\s*\([^)]{0,24}\)",
        "emojis nas redes",
        cleaned,
    )


def _compact(value: str) -> str:
    return re.sub(r"[^a-z0-9&]+", "", _searchable(value))


def _heading_field(text: str) -> IdentityField | None:
    """Reconhece títulos letterspaced sem confundir prosa com taxonomia."""
    if len(_clean(text)) > _MAX_HEADING_LENGTH:
        return None
    compact = _compact(text)
    matches = [
        (field, marker)
        for field, markers in _HEADING_MARKERS.items()
        for marker in markers
        if (
            marker in compact
            and (
                field != "avoid"
                or marker not in {"never", "dont", "donot"}
                or (compact.endswith(marker) and len(compact) <= len(marker) + 4)
            )
        )
    ]
    if not matches:
        return None
    matches.sort(key=lambda item: (-len(item[1]), tuple(_HEADING_MARKERS).index(item[0])))
    return matches[0][0]


def _field_for(text: str) -> IdentityField | None:
    searchable = _searchable(text)
    matches = [
        (field, marker)
        for field, markers in _MARKERS.items()
        for marker in markers
        if marker in searchable
    ]
    if not matches:
        return None
    matches.sort(key=lambda item: (-len(item[1]), tuple(_MARKERS).index(item[0])))
    return matches[0][0]


def _is_contents_page(text: str) -> bool:
    """Descarta índices editoriais que parecem declarar todas as seções."""
    searchable = _searchable(text)
    if "contents" not in searchable and "sumario" not in searchable:
        return False
    numbered_sections = re.findall(r"(?<!\d)(?:0?[1-9]|10)(?!\d)", text)
    return len(numbered_sections) >= 3


def _is_footer(text: str) -> bool:
    compact = _compact(text)
    return any(
        marker in compact
        for marker in (
            "brandmanual",
            "manualdamarca",
            "correspondence",
            "editionmm",
            "edicaomm",
        )
    )


def _is_structural_label(text: str) -> bool:
    """Reconhece subtítulos gráficos que não são uma resposta para a pessoa."""
    cleaned = _clean(text)
    letters = [char for char in cleaned if char.isalpha()]
    if not letters or len(cleaned) > 90:
        return False
    uppercase_ratio = sum(char.isupper() for char in letters) / len(letters)
    return uppercase_ratio >= 0.86


def _block_lines(value: str) -> list[str]:
    return [cleaned for line in value.splitlines() if (cleaned := _clean(line))]


def _truncate_excerpt(value: str, limit: int = _FIELD_LIMIT) -> str:
    """Encerra o trecho em frase ou palavra, nunca no meio de um termo."""
    cleaned = _clean(value)
    if len(cleaned) <= limit:
        return cleaned
    sliced = cleaned[:limit]
    sentence_ends = [match.end() for match in re.finditer(r"[.!?](?=\s|$)", sliced)]
    viable = [position for position in sentence_ends if position >= min(80, limit // 2)]
    if viable:
        return sliced[: viable[-1]].strip()
    word_safe = sliced.rsplit(" ", 1)[0].rstrip(" ,;:—-")
    return f"{word_safe or sliced.rstrip()}…"


def _inline_labeled_excerpts(text: str) -> list[tuple[IdentityField, str]]:
    """Separa rótulos curtos mesmo quando o OCR junta colunas no mesmo bloco."""
    matches = list(_INLINE_LABEL.finditer(text))
    excerpts: list[tuple[IdentityField, str]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        excerpt = _truncate_excerpt(text[match.end() : end])
        label = _searchable(match["label"])
        if len(excerpt) >= _MIN_EXCERPT_LENGTH:
            excerpts.append((_INLINE_LABEL_FIELDS[label], excerpt))
    return excerpts


def _evidence(path: Path, page: int, field: IdentityField, excerpt: str) -> Evidence:
    return Evidence(
        source_type="pdf-guideline",
        path=str(path),
        page=page,
        detail=f"declaração de {field}: {excerpt[:240]}",
        confidence=0.9,
        authoritative=True,
    )


def _page_excerpts(path: Path) -> list[tuple[IdentityField, str, Evidence]]:
    found: list[tuple[IdentityField, str, Evidence]] = []
    for page in extract_pdf_text_pages(path):
        if _is_contents_page(page.text):
            continue
        active_field: IdentityField | None = None
        active_chunks: list[str] = []
        active_column_line: int | None = None

        def flush() -> None:
            nonlocal active_field, active_chunks, active_column_line
            excerpt = _truncate_excerpt(" ".join(active_chunks))
            if active_field is not None and len(excerpt) >= _MIN_EXCERPT_LENGTH:
                found.append(
                    (
                        active_field,
                        excerpt,
                        _evidence(path, page.page_number, active_field, excerpt),
                    )
                )
            active_field = None
            active_chunks = []
            active_column_line = None

        for block in page.blocks:
            lines = _block_lines(str(block[4]))
            if not lines:
                continue
            text = _clean(" ".join(lines))
            if _is_footer(text):
                flush()
                continue

            heading = next(
                (
                    (line_index, field)
                    for line_index, line in enumerate(lines)
                    if (field := _heading_field(line)) is not None
                ),
                None,
            )
            if heading is not None:
                line_index, heading_field = heading
                if active_field != heading_field:
                    flush()
                    active_field = heading_field
                # O mesmo bloco pode trazer um subtítulo útil logo abaixo
                # do nome da seção (por exemplo, "COMPOSED, ORACULAR").
                remainder = [
                    line
                    for line in lines[line_index + 1 :]
                    if not re.fullmatch(r"\d{1,2}", line) and not _is_footer(line)
                ]
                active_chunks.extend(remainder)
                continue

            if active_field is not None:
                continuation = (
                    [lines[active_column_line]]
                    if active_column_line is not None and active_column_line < len(lines)
                    else lines
                )
                for line in continuation:
                    if _is_structural_label(line):
                        continue
                    if sum(len(chunk) for chunk in active_chunks) < _FIELD_LIMIT:
                        active_chunks.append(line)
                continue

            inline_excerpts = _inline_labeled_excerpts(text)
            if inline_excerpts:
                found.extend(
                    (
                        field,
                        excerpt,
                        _evidence(path, page.page_number, field, excerpt),
                    )
                    for field, excerpt in inline_excerpts[:-1]
                )
                active_field, last_excerpt = inline_excerpts[-1]
                active_chunks = [last_excerpt]
                label_line = next(
                    (
                        line_index
                        for line_index, line in enumerate(lines)
                        if _INLINE_LABEL.search(line) is not None
                    ),
                    0,
                )
                active_column_line = label_line if label_line > 0 else None
                continue

            if len(text) < _MIN_EXCERPT_LENGTH or _is_structural_label(text):
                continue
            field = _field_for(text)
            if field is None:
                continue
            if field == "avoid" and (avoid_start := _AVOID_START.search(text)) is not None:
                text = text[avoid_start.start() :]
            excerpt = _truncate_excerpt(text)
            found.append(
                (
                    field,
                    excerpt,
                    _evidence(path, page.page_number, field, excerpt),
                )
            )
        flush()
    return found


def identity_candidate(pdf_paths: list[Path]) -> Candidate:
    """Agrupa declarações relevantes sem resumir ou completar lacunas."""
    values: dict[IdentityField, list[str]] = {
        "essence": [],
        "personality": [],
        "voice": [],
        "avoid": [],
    }
    evidence: list[Evidence] = []
    seen: set[tuple[IdentityField, str]] = set()
    for path in pdf_paths:
        for field, excerpt, item_evidence in _page_excerpts(path):
            key = (field, _searchable(excerpt))
            if key in seen:
                continue
            seen.add(key)
            current_length = sum(len(item) for item in values[field])
            if current_length >= _FIELD_LIMIT:
                continue
            remaining = _FIELD_LIMIT - current_length
            if values[field] and remaining < _MIN_EXCERPT_LENGTH * 3:
                continue
            values[field].append(_truncate_excerpt(excerpt, remaining))
            evidence.append(item_evidence)

    value = IdentityDraftValue(**{field: "\n\n".join(items) for field, items in values.items()})
    return Candidate(
        value=value.model_dump(mode="json", by_alias=True),
        score=float(len(evidence)),
        evidence=evidence,
    )
