"""Agregação do pacote informal de marca em ``BrandDraft`` com perguntas de wizard.

Convenção do pacote informal:

- PDFs de diretrizes: ``*.pdf`` na raiz do pacote ou em ``references/*.pdf``;
- logos: ``assets/logos/*.svg`` e ``assets/logos/*.png``;
- arquivos de fonte: ``fonts/*.ttf`` e ``fonts/*.otf``;
- tokens DTCG (atalho estruturado): ``tokens.json`` ou ``*.tokens.json`` na raiz.

A extração nunca decide sozinha: cada valor agregado vira candidato de uma
pergunta de wizard, porque a autoridade final é a confirmação da pessoa
(spec §5.3). Scores são normalizados por extrator, ponderados pela
confiabilidade da fonte (DTCG > SVG > raster > PDF) e fundidos
perceptualmente. Tokens DTCG ficam primeiros no ranking, mas continuam
passando pelo wizard.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Literal

from PIL import Image

from brand_runtime.colors import dedupe_colors, delta_e, is_neutral, lightness
from brand_runtime.intake.base import Candidate
from brand_runtime.intake.dtcg import load_dtcg
from brand_runtime.intake.fonts import introspect_font
from brand_runtime.intake.pdf_colors import extract_pdf_colors, extract_pdf_declared_colors
from brand_runtime.intake.pdf_fonts import extract_pdf_declared_fonts, extract_pdf_fonts
from brand_runtime.intake.raster_logo import extract_raster_colors
from brand_runtime.intake.svg_logo import (
    extract_svg_colors,
    svg_canvas_size,
    svg_external_style_missing,
)
from brand_runtime.ir.models import CamelModel, Diagnostic, Evidence

# Pesos por fonte de evidência (regra 1): tokens DTCG são intenção declarada,
# acima de qualquer extração; o logo vetorial é a amostra mais fiel das cores
# da marca; o raster perde detalhe para anti-aliasing/compressão; o PDF
# mistura cores da marca com cores editoriais do próprio documento.
# Os pesos são aditivos por arquivo (dois SVGs concordando somam 6.0), então o
# peso sozinho não garante DTCG em primeiro: o ranking ordena por camada de
# autoridade antes do score (ver _color_candidates).
_DTCG_WEIGHT = 5.0
_SVG_WEIGHT = 3.0
_RASTER_WEIGHT = 2.0
_PDF_WEIGHT = 1.0
_DEDUPE_THRESHOLD = 6.0  # mesmo limiar perceptual padrão de dedupe_colors

_PRIMARY_TOP = 6  # regra 2
_SECONDARY_TOP = 4  # regra 5
_BACKGROUND_MIN_LIGHTNESS = 85.0  # regra 3: neutras claras servem de fundo
_TEXT_MAX_LIGHTNESS = 30.0  # regra 4: neutras escuras servem de texto

# Candidatos padrão (regras 3 e 4): sempre oferecidos por último, com score
# baixo e evidência manual-entry — são sugestão do sistema, não extração.
_DEFAULT_SCORE = 0.1
_DEFAULT_CONFIDENCE = 0.5
_DEFAULT_BACKGROUND = "#FFFFFF"
_DEFAULT_TEXT = "#1A1A1A"

_HEAVY_MIN_WEIGHT = 600  # regras 6 e 7: divisor entre fonte de título e de corpo

# Mesmas confianças dos extratores de cor correspondentes (svg_logo/raster_logo).
_SVG_LOGO_CONFIDENCE = 0.95
_RASTER_LOGO_CONFIDENCE = 0.85


def _files_with_suffixes(directory: Path, suffixes: set[str]) -> list[Path]:
    """Enumera arquivos por extensão sem depender do filesystem ou plataforma."""
    if not directory.is_dir():
        return []
    return sorted(
        (
            path
            for path in directory.iterdir()
            if path.is_file() and path.suffix.casefold() in suffixes
        ),
        key=lambda path: (path.name.casefold(), path.name),
    )


# Prompts exatos da regra 9 — strings visíveis ao usuário, PT-BR.
_PROMPTS = {
    "color.primary": "Qual destas é a cor principal da marca?",
    "color.background": "Qual é a cor de fundo mais comum nos materiais?",
    "color.text": "Qual cor é usada para textos longos?",
    "color.secondary": "A marca tem uma cor de destaque secundária?",
    "font.heading": "Qual fonte é usada em títulos?",
    "font.body": "Qual fonte é usada em textos corridos?",
    "logo.primary": "Este é o logo oficial da marca?",
}


class DraftQuestion(CamelModel):
    """Pergunta do wizard com candidatos ordenados do mais provável ao menos."""

    id: str  # "color.primary", "font.heading", "logo.primary", ...
    kind: Literal["pick-color", "pick-font", "confirm-logo"]
    prompt_pt: str
    candidates: list[Candidate]
    required: bool


class BrandDraft(CamelModel):
    """Resultado da extração de um pacote: perguntas a confirmar e diagnósticos."""

    package_dir: str
    questions: list[DraftQuestion]
    diagnostics: list[Diagnostic]


def _question(
    question_id: str,
    kind: Literal["pick-color", "pick-font", "confirm-logo"],
    candidates: list[Candidate],
    *,
    required: bool,
) -> DraftQuestion:
    """Monta uma pergunta com o prompt PT-BR exato da regra 9."""
    return DraftQuestion(
        id=question_id,
        kind=kind,
        prompt_pt=_PROMPTS[question_id],
        candidates=candidates,
        required=required,
    )


def _dtcg_candidates(package_dir: Path) -> dict[str, Candidate]:
    """Carrega os tokens DTCG do pacote (``tokens.json`` e ``*.tokens.json`` na raiz).

    Vários arquivos são fundidos por chave semântica; para chaves repetidas,
    vence o primeiro arquivo (``tokens.json`` antes dos ``*.tokens.json``,
    estes em ordem alfabética).
    """
    root_json = _files_with_suffixes(package_dir, {".json"})
    canonical = [path for path in root_json if path.name.casefold() == "tokens.json"]
    token_files = [
        *canonical,
        *(
            path
            for path in root_json
            if path.name.casefold().endswith(".tokens.json") and path not in canonical
        ),
    ]
    merged: dict[str, Candidate] = {}
    for token_file in token_files:
        for key, candidate in load_dtcg(token_file).items():
            merged.setdefault(key, candidate)
    return merged


def _is_dtcg_backed(candidate: Candidate) -> bool:
    """Candidato sustentado por tokens DTCG — a camada de maior autoridade (spec §5.3)."""
    return any(ev.source_type == "dtcg-tokens" for ev in candidate.evidence)


def _semantic_key_parts(key: str) -> set[str]:
    """Separa caminhos DTCG incluindo camelCase, kebab-case e snake_case."""
    expanded = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", key)
    return {part.casefold() for part in re.split(r"[^A-Za-z0-9]+", expanded) if part}


def _dtcg_colors_for_role(dtcg: dict[str, Candidate], role: str) -> list[Candidate]:
    """Seleciona tokens DTCG cujo nome exprime o papel, sem perder ``brand`` como primária."""
    terms = {
        "primary": ("primary", "brand", "accent"),
        "background": ("background", "surface", "paper", "canvas"),
        "text": ("text", "foreground", "ink"),
    }[role]
    return [
        candidate
        for key, candidate in dtcg.items()
        if key.startswith("color.") and any(term in _semantic_key_parts(key) for term in terms)
    ]


def _dtcg_fonts_for_role(dtcg: dict[str, Candidate], role: str) -> list[Candidate]:
    """Respeita ``font.heading``/``font.body`` e compartilha só tokens não tipados."""
    role_terms = {
        "heading": {"heading", "title", "display"},
        "body": {"body", "text", "reading", "paragraph"},
    }
    own = role_terms[role]
    opposite = set().union(*(terms for name, terms in role_terms.items() if name != role))
    selected: list[Candidate] = []
    for key, candidate in dtcg.items():
        if not key.startswith("font."):
            continue
        parts = _semantic_key_parts(key)
        if parts & own or not parts & (own | opposite):
            selected.append(candidate)
    return selected


def _color_candidates(
    pdfs: list[Path],
    svg_logos: list[Path],
    png_logos: list[Path],
    dtcg_colors: list[Candidate],
) -> list[Candidate]:
    """Funde as cores de todos os extratores em um ranking único (regra 1).

    Cada chamada de extrator é normalizada para máx=1.0, multiplicada pelo peso
    da fonte e somada por cor; cores perceptualmente próximas são fundidas com
    ``dedupe_colors`` e as evidências do grupo são concatenadas. Tokens DTCG
    entram como um "extrator" a mais, com o maior peso de fonte — e, como os
    pesos são aditivos por arquivo, o ranking final ordena por camada de
    autoridade antes do score: candidatos com evidência DTCG vêm primeiro
    (spec §5.3), preservando a ordem por score dentro de cada camada.
    """
    runs: list[tuple[list[Candidate], float]] = [
        *((extract_pdf_colors(path), _PDF_WEIGHT) for path in pdfs),
        *((extract_svg_colors(path), _SVG_WEIGHT) for path in svg_logos),
        *((extract_raster_colors(path), _RASTER_WEIGHT) for path in png_logos),
        (dtcg_colors, _DTCG_WEIGHT),
    ]
    weights: dict[str, float] = {}
    evidence: dict[str, list[Evidence]] = {}
    for candidates, source_weight in runs:
        if not candidates:
            continue
        run_max = max(c.score for c in candidates)
        for candidate in candidates:
            normalized = candidate.score / run_max if run_max > 0 else 1.0
            weighted = normalized * source_weight
            weights[candidate.value] = weights.get(candidate.value, 0.0) + weighted
            evidence.setdefault(candidate.value, []).extend(candidate.evidence)

    merged: list[Candidate] = []
    assigned: set[str] = set()
    for representative, score in dedupe_colors(list(weights.items()), threshold=_DEDUPE_THRESHOLD):
        group_evidence: list[Evidence] = []
        for original, original_evidence in evidence.items():
            if original in assigned or delta_e(original, representative) >= _DEDUPE_THRESHOLD:
                continue
            assigned.add(original)
            group_evidence.extend(original_evidence)
        merged.append(Candidate(value=representative, score=score, evidence=group_evidence))
    # Camada de autoridade antes do score: sort estável mantém a ordem por
    # score (de dedupe_colors) dentro de cada camada.
    merged.sort(key=lambda candidate: not _is_dtcg_backed(candidate))
    return merged


def _plus_default(candidates: list[Candidate], default_hex: str) -> list[Candidate]:
    """Acrescenta o candidato padrão, sempre presente e por último (regras 3 e 4).

    Se a cor padrão também foi extraída dos materiais, a evidência extraída é
    herdada pelo candidato padrão em vez de duplicar o swatch na pergunta.
    """
    matching = [candidate for candidate in candidates if candidate.value == default_hex]
    kept = [c for c in candidates if c.value != default_hex]
    inherited = [ev for candidate in matching for ev in candidate.evidence]
    authoritative = next((candidate for candidate in matching if _is_dtcg_backed(candidate)), None)
    if authoritative is not None:
        selected = authoritative.model_copy(deep=True)
        selected.evidence = inherited
        return [selected, *kept]
    default = Candidate(
        value=default_hex,
        score=_DEFAULT_SCORE,
        evidence=[
            Evidence(
                source_type="manual-entry",
                detail="padrão",
                confidence=_DEFAULT_CONFIDENCE,
            ),
            *inherited,
        ],
    )
    return [*kept, default]


def _file_font_candidates(font_files: list[Path], package_dir: Path) -> list[Candidate]:
    """Fontes entregues como arquivo: a evidência mais forte de fonte (regra 6).

    O ``value`` inclui ``"path"`` (relativo ao pacote, separadores POSIX) para a
    compilação poder ligar o token ao arquivo e calcular o hash dele.
    """
    candidates: list[Candidate] = []
    for path in font_files:
        info = introspect_font(path)
        value = info.model_dump(by_alias=True)
        value["path"] = path.relative_to(package_dir).as_posix()
        candidates.append(
            Candidate(
                value=value,
                # Arquivo presente é evidência máxima; a ordem fina entre
                # arquivos vem da partição por peso das regras 6 e 7.
                score=1.0,
                evidence=[Evidence(source_type="font-file", path=str(path), confidence=1.0)],
            )
        )
    return candidates


def _pdf_font_candidates(pdfs: list[Path]) -> list[Candidate]:
    """Fontes citadas nos PDFs, fundidas por (família, peso, estilo) entre documentos."""
    scores: dict[tuple[str, int, str], float] = {}
    values: dict[tuple[str, int, str], dict] = {}
    evidence: dict[tuple[str, int, str], list[Evidence]] = {}
    for pdf in pdfs:
        for candidate in extract_pdf_fonts(pdf):
            key = (candidate.value["family"], candidate.value["weight"], candidate.value["style"])
            scores[key] = scores.get(key, 0.0) + candidate.score
            values.setdefault(key, candidate.value)
            evidence.setdefault(key, []).extend(candidate.evidence)
    candidates = [
        Candidate(value=values[key], score=scores[key], evidence=evidence[key]) for key in values
    ]
    candidates.sort(key=lambda c: c.score, reverse=True)
    return candidates


def _declared_color_candidates(pdfs: list[Path]) -> dict[str, list[Candidate]]:
    """Funde por papel as declarações HEX encontradas em todos os PDFs."""
    merged: dict[str, dict[str, Candidate]] = {"primary": {}, "background": {}, "text": {}}
    for pdf in pdfs:
        for role, candidates in extract_pdf_declared_colors(pdf).items():
            for candidate in candidates:
                existing = merged[role].get(candidate.value)
                if existing is None:
                    merged[role][candidate.value] = candidate.model_copy(deep=True)
                else:
                    existing.score += candidate.score
                    existing.evidence.extend(candidate.evidence)
    return {
        role: sorted(candidates.values(), key=lambda candidate: candidate.score, reverse=True)
        for role, candidates in merged.items()
    }


def _declared_font_candidates(pdfs: list[Path]) -> dict[str, list[Candidate]]:
    """Funde famílias declaradas, preservando a primeira ordem editorial."""
    merged: dict[str, dict[tuple[str, int, str], Candidate]] = {"heading": {}, "body": {}}
    for pdf in pdfs:
        for role, candidates in extract_pdf_declared_fonts(pdf).items():
            for candidate in candidates:
                value = candidate.value
                key = (value["family"].casefold(), value["weight"], value["style"])
                existing = merged[role].get(key)
                if existing is None:
                    merged[role][key] = candidate.model_copy(deep=True)
                else:
                    existing.score += candidate.score
                    existing.evidence.extend(candidate.evidence)
    return {role: list(candidates.values()) for role, candidates in merged.items()}


def _bind_dtcg_fonts_to_files(
    dtcg_candidates: list[Candidate], file_candidates: list[Candidate]
) -> list[Candidate]:
    """Liga intenção DTCG ao binário local compatível sem perder sua autoridade."""
    by_identity: dict[tuple[str, int, str], Candidate] = {}
    for candidate in file_candidates:
        value = candidate.value
        identity = (
            value["family"].strip().casefold(),
            value["weight"],
            value.get("style", "normal"),
        )
        by_identity.setdefault(identity, candidate)

    bound: list[Candidate] = []
    for candidate in dtcg_candidates:
        value = candidate.value
        identity = (
            value["family"].strip().casefold(),
            value["weight"],
            value.get("style", "normal"),
        )
        file_candidate = by_identity.get(identity)
        copied = candidate.model_copy(deep=True)
        if file_candidate is not None:
            copied.value = {**copied.value, "path": file_candidate.value["path"]}
            copied.evidence.extend(item.model_copy(deep=True) for item in file_candidate.evidence)
        bound.append(copied)
    return bound


def _unique_colors(*groups: list[Candidate]) -> list[Candidate]:
    """Concatena rankings sem repetir o mesmo HEX, preservando a autoridade."""
    output: list[Candidate] = []
    by_value: dict[str, Candidate] = {}
    for candidate in (item for group in groups for item in group):
        existing = by_value.get(candidate.value)
        if existing is None:
            copied = candidate.model_copy(deep=True)
            output.append(copied)
            by_value[candidate.value] = copied
        else:
            existing.evidence.extend(candidate.evidence)
    return output


def _font_key(candidate: Candidate) -> tuple[str, int, str, str | None]:
    value = candidate.value
    return (
        value["family"].casefold(),
        value["weight"],
        value.get("style", "normal"),
        value.get("path"),
    )


def _unique_fonts(*groups: list[Candidate]) -> list[Candidate]:
    """Concatena rankings de fonte sem repetir família/peso/estilo."""
    output: list[Candidate] = []
    seen: set[tuple[str, int, str, str | None]] = set()
    for candidate in (item for group in groups for item in group):
        key = _font_key(candidate)
        if key in seen:
            continue
        seen.add(key)
        output.append(candidate)
    return output


def _weight_partitioned(candidates: list[Candidate], *, heavy_first: bool) -> list[Candidate]:
    """Ordena um grupo de fontes: partição por peso, depois score desc (regras 6 e 7)."""
    heavy = sorted(
        (c for c in candidates if c.value["weight"] >= _HEAVY_MIN_WEIGHT),
        key=lambda c: c.score,
        reverse=True,
    )
    light = sorted(
        (c for c in candidates if c.value["weight"] < _HEAVY_MIN_WEIGHT),
        key=lambda c: c.score,
        reverse=True,
    )
    return [*heavy, *light] if heavy_first else [*light, *heavy]


def _dedupe_paths_by_hash(paths: list[Path]) -> list[Path]:
    """Preserva o primeiro arquivo de cada conteúdo binário idêntico."""
    unique: list[Path] = []
    seen_hashes: set[str] = set()
    for path in paths:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in seen_hashes:
            continue
        seen_hashes.add(digest)
        unique.append(path)
    return unique


def _logo_candidates(
    svg_logos: list[Path], png_logos: list[Path], package_dir: Path
) -> list[Candidate]:
    """Logos como candidatos de confirmação (regra 8): SVGs primeiro, por área.

    SVGs são ordenados pela área do canvas (``svg_canvas_size``) e PNGs pela
    área em pixels; o ``value`` é o path relativo ao pacote (POSIX).
    """
    unique_svg = _dedupe_paths_by_hash(svg_logos)
    svg_hashes = {hashlib.sha256(path.read_bytes()).hexdigest() for path in unique_svg}
    unique_png = [
        path
        for path in _dedupe_paths_by_hash(png_logos)
        if hashlib.sha256(path.read_bytes()).hexdigest() not in svg_hashes
    ]

    svg_entries: list[tuple[Path, float, str, float]] = []
    for path in unique_svg:
        width, height = svg_canvas_size(path)
        svg_entries.append((path, width * height, "svg-asset", _SVG_LOGO_CONFIDENCE))
    png_entries: list[tuple[Path, float, str, float]] = []
    for path in unique_png:
        with Image.open(path) as img:
            area = float(img.width * img.height)
        png_entries.append((path, area, "raster-asset", _RASTER_LOGO_CONFIDENCE))
    svg_entries.sort(key=lambda entry: entry[1], reverse=True)
    png_entries.sort(key=lambda entry: entry[1], reverse=True)

    entries = [*svg_entries, *png_entries]
    if not entries:
        return []
    max_area = max(area for _, area, _, _ in entries)
    return [
        Candidate(
            value=path.relative_to(package_dir).as_posix(),
            score=area / max_area if max_area > 0 else 1.0,
            evidence=[Evidence(source_type=source_type, path=str(path), confidence=confidence)],
        )
        for path, area, source_type, confidence in entries
    ]


def _diagnostics(
    pdfs: list[Path],
    logo_candidates: list[Candidate],
    file_fonts: list[Candidate],
    referenced_fonts: list[Candidate],
    invalid_svg_logos: list[Path],
    package_dir: Path,
) -> list[Diagnostic]:
    """Diagnósticos de lacunas do pacote (regra 10) — códigos exatos, mensagens PT-BR.

    ``referenced_fonts`` são as famílias apenas citadas (PDFs e tokens DTCG):
    cada uma sem arquivo correspondente gera um ``FONT_FILE_MISSING``.
    """
    diagnostics: list[Diagnostic] = []
    for path in invalid_svg_logos:
        diagnostics.append(
            Diagnostic(
                code="SVG_EXTERNAL_STYLE_MISSING",
                target=path.relative_to(package_dir).as_posix(),
                message=(
                    f"O SVG «{path.name}» depende de estilos externos e não pode ser usado "
                    "isoladamente como logo. Exporte-o novamente com fill e stroke embutidos."
                ),
                resolution="embed-svg-paints",
            )
        )
    if not pdfs:
        diagnostics.append(
            Diagnostic(
                code="NO_PDF_FOUND",
                target="package",
                message="Nenhum PDF de diretrizes foi encontrado no pacote.",
            )
        )
    if not logo_candidates:
        diagnostics.append(
            Diagnostic(
                code="NO_LOGO_FOUND",
                target="package",
                message="Nenhum logo foi encontrado em assets/logos (SVG ou PNG).",
            )
        )
    available = {c.value["family"].casefold() for c in file_fonts}
    reported: set[str] = set()
    for candidate in referenced_fonts:
        family = candidate.value["family"]
        key = family.casefold()
        if key in available or key in reported:
            continue
        reported.add(key)
        diagnostics.append(
            Diagnostic(
                code="FONT_FILE_MISSING",
                target=family,
                message=(
                    f"A fonte «{family}» aparece nas diretrizes, "
                    "mas o arquivo dela não veio no pacote."
                ),
                resolution="render-fallback",
            )
        )
    return diagnostics


def build_draft(package_dir: Path) -> BrandDraft:
    """Extrai evidências do pacote informal e monta as perguntas do wizard.

    Convenção do pacote: PDFs de diretrizes em ``*.pdf`` na raiz ou em
    ``references/*.pdf``; logos em ``assets/logos/*.svg`` e
    ``assets/logos/*.png``; arquivos de fonte em ``fonts/*.ttf`` e
    ``fonts/*.otf``; tokens DTCG em ``tokens.json`` ou ``*.tokens.json``
    na raiz.

    Candidatos DTCG entram com o maior peso de fonte (5.0, acima do SVG) e
    ficam primeiros no ranking — garantido pela camada de autoridade, não pela
    soma de pesos (que é aditiva por arquivo). Mas continuam passando pelo
    wizard: a autoridade final permanece na confirmação (spec §5.3).

    Perguntas obrigatórias: ``color.primary``, ``color.background``,
    ``color.text``, ``font.heading``, ``font.body`` e ``logo.primary``;
    ``color.secondary`` é opcional e omitida quando não sobram candidatas
    não-neutras além das oferecidas em ``color.primary``.
    """
    pdfs = [
        *_files_with_suffixes(package_dir, {".pdf"}),
        *_files_with_suffixes(package_dir / "references", {".pdf"}),
    ]
    logos_dir = package_dir / "assets" / "logos"
    all_svg_logos = _files_with_suffixes(logos_dir, {".svg"})
    invalid_svg_logos = [path for path in all_svg_logos if svg_external_style_missing(path)]
    svg_logos = _dedupe_paths_by_hash(
        [path for path in all_svg_logos if path not in invalid_svg_logos]
    )
    png_logos = _dedupe_paths_by_hash(_files_with_suffixes(logos_dir, {".png"}))
    fonts_dir = package_dir / "fonts"
    font_files = _files_with_suffixes(fonts_dir, {".otf", ".ttf"})

    dtcg = _dtcg_candidates(package_dir)
    dtcg_colors = [c for key, c in dtcg.items() if key.startswith("color.")]
    dtcg_fonts = [c for key, c in dtcg.items() if key.startswith("font.")]

    colors = _color_candidates(pdfs, svg_logos, png_logos, dtcg_colors)
    declared_colors = _declared_color_candidates(pdfs)
    dtcg_primary = _dtcg_colors_for_role(dtcg, "primary")
    dtcg_background = _dtcg_colors_for_role(dtcg, "background")
    dtcg_text = _dtcg_colors_for_role(dtcg, "text")
    non_neutral = [c for c in colors if not is_neutral(c.value)]
    light_neutrals = [
        c for c in colors if is_neutral(c.value) and lightness(c.value) > _BACKGROUND_MIN_LIGHTNESS
    ]
    dark_neutrals = [
        c for c in colors if is_neutral(c.value) and lightness(c.value) < _TEXT_MAX_LIGHTNESS
    ]

    file_fonts = _file_font_candidates(font_files, package_dir)
    bound_dtcg_fonts = _bind_dtcg_fonts_to_files(dtcg_fonts, file_fonts)
    bound_by_original_id = {
        id(original): bound for original, bound in zip(dtcg_fonts, bound_dtcg_fonts, strict=True)
    }
    dtcg_heading_fonts = [
        bound_by_original_id[id(candidate)] for candidate in _dtcg_fonts_for_role(dtcg, "heading")
    ]
    dtcg_body_fonts = [
        bound_by_original_id[id(candidate)] for candidate in _dtcg_fonts_for_role(dtcg, "body")
    ]
    pdf_fonts = _pdf_font_candidates(pdfs)
    declared_fonts = _declared_font_candidates(pdfs)
    logo_candidates = _logo_candidates(svg_logos, png_logos, package_dir)

    questions = [
        _question(
            "color.primary",
            "pick-color",
            _unique_colors(
                dtcg_primary,
                declared_colors["primary"],
                non_neutral,
            )[:_PRIMARY_TOP],
            required=True,
        ),
        _question(
            "color.background",
            "pick-color",
            _plus_default(
                _unique_colors(
                    dtcg_background,
                    declared_colors["background"],
                    light_neutrals,
                ),
                _DEFAULT_BACKGROUND,
            ),
            required=True,
        ),
        _question(
            "color.text",
            "pick-color",
            _plus_default(
                _unique_colors(dtcg_text, declared_colors["text"], dark_neutrals),
                _DEFAULT_TEXT,
            ),
            required=True,
        ),
    ]
    secondary = non_neutral[_PRIMARY_TOP : _PRIMARY_TOP + _SECONDARY_TOP]
    if secondary:  # regra 5: pergunta opcional é omitida quando não há candidatas
        questions.append(_question("color.secondary", "pick-color", secondary, required=False))
    # Grupos de candidatos de fonte, do mais ao menos confiável (spec §5.3):
    # tokens DTCG (intenção declarada) > arquivos de fonte > citações em PDF.
    questions.append(
        _question(
            "font.heading",
            "pick-font",
            _unique_fonts(
                _weight_partitioned(dtcg_heading_fonts, heavy_first=True),
                _weight_partitioned(file_fonts, heavy_first=True),
                declared_fonts["heading"],
                _weight_partitioned(pdf_fonts, heavy_first=True),
            ),
            required=True,
        )
    )
    questions.append(
        _question(
            "font.body",
            "pick-font",
            _unique_fonts(
                _weight_partitioned(dtcg_body_fonts, heavy_first=False),
                _weight_partitioned(file_fonts, heavy_first=False),
                declared_fonts["body"],
                _weight_partitioned(pdf_fonts, heavy_first=False),
            ),
            required=True,
        )
    )
    questions.append(_question("logo.primary", "confirm-logo", logo_candidates, required=True))

    return BrandDraft(
        package_dir=str(package_dir),
        questions=questions,
        diagnostics=_diagnostics(
            pdfs,
            logo_candidates,
            file_fonts,
            [
                *bound_dtcg_fonts,
                *declared_fonts["heading"],
                *declared_fonts["body"],
                *pdf_fonts,
            ],
            invalid_svg_logos,
            package_dir,
        ),
    )
