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
from pydantic import Field

from brand_runtime.colors import dedupe_colors, delta_e, is_neutral, lightness, wcag_contrast
from brand_runtime.intake.base import Candidate
from brand_runtime.intake.dtcg import load_dtcg
from brand_runtime.intake.fonts import introspect_font
from brand_runtime.intake.identity import identity_candidate
from brand_runtime.intake.translation import IdentityTranslator, translate_identity_candidate
from brand_runtime.intake.pdf_colors import extract_pdf_colors, extract_pdf_declared_colors
from brand_runtime.intake.pdf_composition import (
    CompositionDeclarations,
    extract_pdf_composition,
    merge_composition_declarations,
)
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
_FONT_ROLE_TERMS = {
    "heading": {"heading", "title", "display"},
    "body": {"body", "text", "reading", "paragraph"},
}
_OTHER_FONT_ROLE_TERMS = {"accent", "decorative", "editorial"}

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
    "identity.expression": "Como é a sua marca?",
    "color.primary": "Qual destas é a cor principal da marca?",
    "color.background": "Qual cor aparece mais nos fundos?",
    "color.text": "Qual cor aparece nos textos?",
    "color.secondary": "A marca usa outra cor de destaque?",
    "font.heading": "Qual fonte aparece nos títulos?",
    "font.body": "Qual fonte aparece nos textos?",
    "logo.primary": "Este é o logo principal da marca?",
    "logo.onLight": "Qual versão do logo deve aparecer em fundos claros?",
    "logo.onDark": "Qual versão do logo deve aparecer em fundos escuros?",
}


class DraftQuestion(CamelModel):
    """Pergunta do wizard com candidatos ordenados do mais provável ao menos."""

    id: str  # "color.primary", "font.heading", "logo.primary", ...
    kind: Literal["pick-color", "pick-font", "confirm-logo", "review-identity"]
    prompt_pt: str
    candidates: list[Candidate]
    # ``0`` mantém drafts persistidos antes deste campo compiláveis. Novos
    # drafts sempre recebem a contagem explícita por ``_question``.
    recommended_count: int = 0
    required: bool
    # Decisões visuais que o intake já consegue sustentar com evidência não
    # devem virar trabalho de configuração para o usuário. Elas permanecem no
    # draft para rastreabilidade e compatibilidade, mas a API só as expõe se o
    # pacote não trouxer nenhum candidato utilizável.
    automatic: bool = False


class BrandDraft(CamelModel):
    """Resultado da extração de um pacote: perguntas a confirmar e diagnósticos."""

    package_dir: str
    questions: list[DraftQuestion]
    palette_candidates: list[Candidate] = Field(default_factory=list)
    diagnostics: list[Diagnostic]
    composition_declarations: CompositionDeclarations | None = None


def _question(
    question_id: str,
    kind: Literal["pick-color", "pick-font", "confirm-logo", "review-identity"],
    candidates: list[Candidate],
    *,
    required: bool,
    recommended_count: int | None = None,
    automatic: bool = False,
) -> DraftQuestion:
    """Monta uma pergunta e explicita o prefixo recomendado do ranking.

    Quando ``recommended_count`` não é informado, todos os candidatos são
    recomendações. Perguntas de cor usam o campo para separar a curadoria por
    papel das demais cores encontradas no pacote sem esconder alternativas.
    """
    visible_recommendations = len(candidates) if recommended_count is None else recommended_count
    if not 0 <= visible_recommendations <= len(candidates):
        raise ValueError("recommended_count deve estar entre zero e o total de candidatos")
    return DraftQuestion(
        id=question_id,
        kind=kind,
        prompt_pt=_PROMPTS[question_id],
        candidates=candidates,
        recommended_count=visible_recommendations,
        required=required,
        automatic=automatic,
    )


def _logo_name_appearance(relative: str) -> Literal["dark", "light"] | None:
    """Lê convenções explícitas de variante sem adivinhar pelo nome da marca."""
    stem = Path(relative).stem.casefold()
    if any(marker in stem for marker in ("on-light", "on_light", "positivo", "positive")):
        return "dark"
    if any(marker in stem for marker in ("on-dark", "on_dark", "negativo", "negative")):
        return "light"
    return None


def _logo_candidate_appearance(
    package_dir: Path,
    candidate: Candidate,
) -> Literal["dark", "light"] | None:
    """Classifica uma variante quando nome ou tinta visível são inequívocos."""
    if not isinstance(candidate.value, str):
        return None
    relative = candidate.value
    named = _logo_name_appearance(relative)
    if named is not None:
        return named
    path = package_dir / relative
    suffix = path.suffix.casefold()
    if suffix == ".svg":
        colors = extract_svg_colors(path)
    elif suffix == ".png":
        colors = extract_raster_colors(path)
    else:
        return None
    total = sum(item.score for item in colors)
    if total <= 0:
        return None
    weighted_lightness = sum(lightness(item.value) * item.score for item in colors) / total
    if weighted_lightness <= 40:
        return "dark"
    if weighted_lightness >= 60:
        return "light"
    return None


def _variant_logo_candidates(
    package_dir: Path,
    candidates: list[Candidate],
    *,
    surface: Literal["light", "dark"],
) -> tuple[list[Candidate], int]:
    """Ordena o logo de maior contraste primeiro e informa se a sugestão é segura."""
    desired_appearance = "dark" if surface == "light" else "light"
    preferred = [
        item
        for item in candidates
        if _logo_candidate_appearance(package_dir, item) == desired_appearance
    ]
    remaining = [item for item in candidates if item not in preferred]
    return [*preferred, *remaining], len(preferred)


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
        "secondary": ("secondary",),
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
    own = _FONT_ROLE_TERMS[role]
    opposite = set().union(*(terms for name, terms in _FONT_ROLE_TERMS.items() if name != role))
    all_typed_terms = own | opposite | _OTHER_FONT_ROLE_TERMS
    selected: list[Candidate] = []
    for key, candidate in dtcg.items():
        if not key.startswith("font."):
            continue
        parts = _semantic_key_parts(key)
        if parts & own or not parts & all_typed_terms:
            selected.append(candidate)
    return selected


def _explicit_dtcg_fonts_for_role(dtcg: dict[str, Candidate], role: str) -> list[Candidate]:
    """Seleciona apenas tokens que nomeiam inequivocamente um papel tipográfico."""
    role_terms = _FONT_ROLE_TERMS[role]
    return [
        candidate
        for key, candidate in dtcg.items()
        if key.startswith("font.") and _semantic_key_parts(key) & role_terms
    ]


def _all_explicit_font_tokens_are_bound(
    dtcg: dict[str, Candidate],
    bound_by_original_id: dict[int, Candidate],
) -> bool:
    """Confirma que título e corpo têm intenção DTCG ligada a binários locais."""
    for role in ("heading", "body"):
        explicit = _explicit_dtcg_fonts_for_role(dtcg, role)
        if not explicit:
            return False
        if any(
            not isinstance(bound_by_original_id[id(candidate)].value, dict)
            or not bound_by_original_id[id(candidate)].value.get("path")
            for candidate in explicit
        ):
            return False
    return True


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
    merged: dict[str, dict[str, Candidate]] = {
        "primary": {},
        "background": {},
        "text": {},
        "accent": {},
        "all": {},
    }
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


def _font_value_identity(value: dict) -> tuple[str, int, str]:
    """Identidade completa de variante usada em binding, dedupe e diagnóstico."""
    return (
        value["family"].strip().casefold(),
        value["weight"],
        value.get("style", "normal"),
    )


def _bind_dtcg_fonts_to_files(
    dtcg_candidates: list[Candidate], file_candidates: list[Candidate]
) -> list[Candidate]:
    """Liga intenção DTCG ao binário local compatível sem perder sua autoridade."""
    by_identity: dict[tuple[str, int, str], Candidate] = {}
    for candidate in file_candidates:
        by_identity.setdefault(_font_value_identity(candidate.value), candidate)

    bound: list[Candidate] = []
    for candidate in dtcg_candidates:
        file_candidate = by_identity.get(_font_value_identity(candidate.value))
        copied = candidate.model_copy(deep=True)
        if file_candidate is not None:
            inherited = {
                key: file_candidate.value[key]
                for key in ("path", "resource")
                if key in file_candidate.value
            }
            copied.value = {**copied.value, **inherited}
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
            existing.evidence.extend(
                evidence.model_copy(deep=True)
                for evidence in candidate.evidence
                if evidence not in existing.evidence
            )
    return output


def _font_key(candidate: Candidate) -> tuple[str, int, str, str | None]:
    value = candidate.value
    return (*_font_value_identity(value), value.get("path"))


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
    available = {_font_value_identity(candidate.value) for candidate in file_fonts}
    reported: set[tuple[str, int, str]] = set()
    for candidate in referenced_fonts:
        family = candidate.value["family"]
        weight = candidate.value["weight"]
        style = candidate.value.get("style", "normal")
        key = _font_value_identity(candidate.value)
        if key in available or key in reported:
            continue
        reported.add(key)
        diagnostics.append(
            Diagnostic(
                code="FONT_FILE_MISSING",
                target=family,
                message=(
                    f"A fonte «{family}» ({weight}, {style}) aparece nas diretrizes, "
                    "mas o arquivo dela não veio no pacote."
                ),
                resolution="render-fallback",
            )
        )
    return diagnostics


def build_draft(
    package_dir: Path,
    *,
    translator: IdentityTranslator | None = None,
) -> BrandDraft:
    """Extrai evidências do pacote informal e monta as perguntas do wizard.

    Convenção do pacote: PDFs de diretrizes em ``*.pdf`` na raiz ou em
    ``references/*.pdf``; logos em ``assets/logos/*.svg`` e
    ``assets/logos/*.png``; arquivos de fonte em ``fonts/*.ttf`` e
    ``fonts/*.otf``; tokens DTCG em ``tokens.json`` ou ``*.tokens.json``
    na raiz.

    Candidatos DTCG entram com o maior peso de fonte (5.0, acima do SVG) e
    ficam primeiros no ranking — garantido pela camada de autoridade, não pela
    soma de pesos (que é aditiva por arquivo). Cores, fontes e logos são
    compilados automaticamente a partir do primeiro candidato sustentado por
    essa hierarquia. O editor continua oferecendo todas as alternativas.
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
    composition_declarations = merge_composition_declarations(
        [extract_pdf_composition(path) for path in pdfs]
    )
    expression_candidate = translate_identity_candidate(identity_candidate(pdfs), translator)

    dtcg = _dtcg_candidates(package_dir)
    dtcg_colors = [c for key, c in dtcg.items() if key.startswith("color.")]
    dtcg_fonts = [c for key, c in dtcg.items() if key.startswith("font.")]

    dtcg_primary = _dtcg_colors_for_role(dtcg, "primary")
    dtcg_secondary = _dtcg_colors_for_role(dtcg, "secondary")
    dtcg_background = _dtcg_colors_for_role(dtcg, "background")
    dtcg_text = _dtcg_colors_for_role(dtcg, "text")
    # Um pacote que declara todos os quatro papéis cromáticos já contém a
    # decisão que os extratores visuais e textuais do PDF tentariam reconstruir.
    # Entradas mínimas, sem essa cobertura, continuam usando o caminho completo.
    has_complete_dtcg_palette = bool(
        dtcg_primary and dtcg_secondary and dtcg_background and dtcg_text
    )
    color_pdfs = [] if has_complete_dtcg_palette else pdfs
    colors = _color_candidates(color_pdfs, svg_logos, png_logos, dtcg_colors)
    logo_colors = _color_candidates([], svg_logos, png_logos, [])
    declared_colors = _declared_color_candidates(color_pdfs)
    # Quando o manual declara uma paleta em texto ou tokens, ela é a fronteira
    # autoritativa. Tintas vetoriais incidentais do próprio PDF (marcas de corte,
    # linhas técnicas e sombras) não devem reaparecer como cores da marca.
    has_declared_palette = bool(dtcg_colors or declared_colors["all"])
    explicit_palette = _unique_colors(
        dtcg_colors,
        declared_colors["all"],
        logo_colors,
    )
    all_document_colors = explicit_palette if has_declared_palette else colors

    non_neutral = [c for c in all_document_colors if not is_neutral(c.value)]
    light_neutrals = [
        c
        for c in all_document_colors
        if is_neutral(c.value) and lightness(c.value) > _BACKGROUND_MIN_LIGHTNESS
    ]
    dark_neutrals = [
        c
        for c in all_document_colors
        if is_neutral(c.value) and lightness(c.value) < _TEXT_MAX_LIGHTNESS
    ]

    # Declarações semânticas podem existir apenas como texto (por exemplo,
    # ``HEX #CA6B0B``), sem uma área pintada que o extrator visual encontre.
    # Elas também pertencem à paleta completa oferecida em cada papel.
    primary_semantic = _unique_colors(
        dtcg_primary,
        declared_colors["primary"],
    )
    primary_recommended = (primary_semantic if primary_semantic else _unique_colors(non_neutral))[
        :_PRIMARY_TOP
    ]
    primary_candidates = _unique_colors(primary_recommended, all_document_colors)

    background_semantic = _unique_colors(
        dtcg_background,
        declared_colors["background"],
    )
    background_recommended = (
        background_semantic
        if background_semantic
        else _plus_default(_unique_colors(light_neutrals), _DEFAULT_BACKGROUND)
    )
    background_candidates = _unique_colors(background_recommended, all_document_colors)

    text_semantic = _unique_colors(
        dtcg_text,
        declared_colors["text"],
    )
    background_reference = (
        background_recommended[0].value if background_recommended else _DEFAULT_BACKGROUND
    )
    primary_text_fallback = [
        candidate
        for candidate in primary_recommended[:1]
        if wcag_contrast(candidate.value, background_reference) >= 4.5
    ]
    text_recommended = (
        text_semantic
        if text_semantic
        else _plus_default(
            _unique_colors(dark_neutrals, primary_text_fallback),
            _DEFAULT_TEXT,
        )
    )
    text_candidates = _unique_colors(text_recommended, all_document_colors)

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
    # Só evita a varredura tipográfica do PDF quando ambos os papéis foram
    # declarados e ligados a arquivos reais. Uma família apenas citada ou um
    # pacote incompleto ainda recebe toda a investigação e os fallbacks.
    font_pdfs = [] if _all_explicit_font_tokens_are_bound(dtcg, bound_by_original_id) else pdfs
    pdf_fonts = _pdf_font_candidates(font_pdfs)
    declared_fonts = _declared_font_candidates(font_pdfs)
    # Uma declaração semântica ou token DTCG exprime intenção. As fontes
    # meramente usadas para compor o PDF (Arial, Segoe UI etc.) só entram como
    # fallback quando o papel não possui nenhuma fonte declarada.
    heading_pdf_fallback = (
        []
        if dtcg_heading_fonts or declared_fonts["heading"]
        else _weight_partitioned(pdf_fonts, heavy_first=True)
    )
    body_pdf_fallback = (
        []
        if dtcg_body_fonts or declared_fonts["body"]
        else _weight_partitioned(pdf_fonts, heavy_first=False)
    )
    logo_candidates = _logo_candidates(svg_logos, png_logos, package_dir)

    questions = [
        _question(
            "identity.expression",
            "review-identity",
            [expression_candidate],
            required=False,
            recommended_count=1,
            automatic=True,
        ),
        _question(
            "color.primary",
            "pick-color",
            primary_candidates,
            required=True,
            recommended_count=len(primary_recommended),
            automatic=True,
        ),
        _question(
            "color.background",
            "pick-color",
            background_candidates,
            required=True,
            recommended_count=len(background_recommended),
            automatic=True,
        ),
        _question(
            "color.text",
            "pick-color",
            text_candidates,
            required=True,
            recommended_count=len(text_recommended),
            automatic=True,
        ),
    ]
    if len(all_document_colors) > 1:
        likely_primary = primary_candidates[0].value if primary_candidates else None
        secondary_pool = [
            candidate for candidate in all_document_colors if candidate.value != likely_primary
        ]
        secondary_semantic = _unique_colors(
            [candidate for candidate in dtcg_secondary if candidate.value != likely_primary],
            [
                candidate
                for candidate in declared_colors["accent"]
                if candidate.value != likely_primary
            ],
            [
                candidate
                for candidate in declared_colors["primary"]
                if candidate.value != likely_primary
            ],
        )
        secondary_recommended = (
            secondary_semantic
            if secondary_semantic
            else _unique_colors(
                [candidate for candidate in non_neutral if candidate.value != likely_primary],
                secondary_pool,
            )
        )[:_SECONDARY_TOP]
        secondary_candidates = _unique_colors(secondary_recommended, all_document_colors)
        questions.append(
            _question(
                "color.secondary",
                "pick-color",
                secondary_candidates,
                required=False,
                recommended_count=len(secondary_recommended),
                automatic=True,
            )
        )
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
                heading_pdf_fallback,
            ),
            required=True,
            automatic=True,
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
                body_pdf_fallback,
            ),
            required=True,
            automatic=True,
        )
    )
    questions.append(
        _question(
            "logo.primary",
            "confirm-logo",
            logo_candidates,
            required=True,
            automatic=True,
        )
    )
    if len(logo_candidates) > 1:
        on_light, on_light_recommended = _variant_logo_candidates(
            package_dir,
            logo_candidates,
            surface="light",
        )
        on_dark, on_dark_recommended = _variant_logo_candidates(
            package_dir,
            logo_candidates,
            surface="dark",
        )
        questions.extend(
            (
                _question(
                    "logo.onLight",
                    "confirm-logo",
                    on_light,
                    required=False,
                    recommended_count=on_light_recommended,
                    automatic=True,
                ),
                _question(
                    "logo.onDark",
                    "confirm-logo",
                    on_dark,
                    required=False,
                    recommended_count=on_dark_recommended,
                    automatic=True,
                ),
            )
        )

    return BrandDraft(
        package_dir=str(package_dir),
        questions=questions,
        palette_candidates=_unique_colors(
            dtcg_colors,
            declared_colors["all"],
            all_document_colors,
        )[:24],
        composition_declarations=(
            composition_declarations if composition_declarations.has_rules() else None
        ),
        diagnostics=_diagnostics(
            pdfs,
            logo_candidates,
            file_fonts,
            [
                *bound_dtcg_fonts,
                *declared_fonts["heading"],
                *declared_fonts["body"],
                *heading_pdf_fallback,
                *body_pdf_fallback,
            ],
            invalid_svg_logos,
            package_dir,
        ),
    )
