"""Compilação das confirmações do wizard em uma revisão do Brand IR."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from pydantic import ValidationError

from brand_runtime.colors import lightness, normalize_color, wcag_contrast
from brand_runtime.intake.base import Candidate
from brand_runtime.intake.direction import derive_creative_direction
from brand_runtime.intake.draft import BrandDraft, DraftQuestion
from brand_runtime.intake.identity import IdentityDraftValue
from brand_runtime.intake.raster_logo import extract_raster_colors
from brand_runtime.intake.svg_logo import (
    SvgInvalid,
    extract_svg_colors,
    svg_external_style_missing,
)
from brand_runtime.ir.models import (
    AccentRule,
    BrandIdentity,
    BrandIR,
    BrandInfo,
    CamelModel,
    ColorToken,
    ColorRatioRule,
    CompositionMode,
    CompositionModes,
    CompositionRules,
    Diagnostic,
    Evidence,
    FontToken,
    LayoutStyleRule,
    LogoAsset,
    MotifRule,
    NumberingRule,
    RevisionInfo,
    SemanticRole,
)

_REQUIRED_ANSWERS = (
    "color.primary",
    "color.background",
    "color.text",
    "font.heading",
    "font.body",
    "logo.primary",
)
_HASH_CHUNK_SIZE = 1024 * 1024
_IDENTITY_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
# A revisão persiste IR e kit como um único bundle write-once. Mudanças
# semânticas no gerador precisam trocar este domínio para não ressuscitar um
# kit antigo sob o mesmo id depois de um upgrade.
_REVISION_BUNDLE_DOMAIN = b"brand-ir-0.4-kit-v7\0"


class Answers(CamelModel):
    """Valores confirmados no wizard, indexados pelo identificador da pergunta."""

    values: dict[str, Any]


class CompileError(Exception):
    """Erro de compilação que pode ser apresentado diretamente em PT-BR."""


def _question(draft: BrandDraft, question_id: str) -> DraftQuestion | None:
    """Localiza uma pergunta sem pressupor que as opcionais existam."""
    return next((item for item in draft.questions if item.id == question_id), None)


def _resolved_answers(draft: BrandDraft, answers: Answers) -> Answers:
    """Completa decisões visuais automáticas sem sobrescrever revisões legadas."""
    values = dict(answers.values)
    for question in draft.questions:
        if not question.automatic or question.id in values or not question.candidates:
            continue
        if question.id == "color.secondary" and any(
            token in answers.values for token in ("color.primary", "color.background", "color.text")
        ):
            # Em drafts já iniciados antes da automação, ausência da secundária
            # significava uma decisão explícita de pular a pergunta.
            continue
        if not question.required and question.recommended_count < 1:
            continue
        values[question.id] = question.candidates[0].value
    return Answers(values=values)


def _compile_identity(
    draft: BrandDraft,
    value: Any,
    created_at: datetime,
) -> BrandIdentity:
    """Valida a leitura revisada e preserva a origem textual do manual."""
    try:
        parsed = IdentityDraftValue.model_validate(value)
    except ValidationError as exc:
        raise CompileError("A leitura da identidade possui campos inválidos.") from exc
    placeholders = {"-", "—", ".", "...", "n/a", "na", "não sei", "nao sei"}

    def cleaned(value: str) -> str:
        text = value.strip()
        return "" if text.casefold() in placeholders else text

    essence = cleaned(parsed.essence)
    if not essence:
        raise CompileError("Explique a essência ou o propósito da marca antes de publicar.")
    question = _question(draft, "identity.expression")
    inherited = (
        [
            _portable_evidence(item, Path(draft.package_dir))
            for item in question.candidates[0].evidence
        ]
        if question is not None and question.candidates
        else []
    )
    return BrandIdentity(
        essence=essence,
        personality=cleaned(parsed.personality),
        voice=cleaned(parsed.voice),
        avoid=cleaned(parsed.avoid),
        evidence=[*inherited, _confirmation(created_at)],
    )


def _match_color(question: DraftQuestion | None, value: Any) -> Candidate | None:
    """Casa cores por seu valor CSS normalizado."""
    normalized = normalize_color(str(value))
    if question is None:
        return None
    for candidate in question.candidates:
        try:
            if normalize_color(str(candidate.value)) == normalized:
                return candidate
        except ValueError:
            continue
    return None


def _font_fields(value: Any) -> tuple[str, int, str]:
    """Valida os campos tipográficos preservando o nome editorial da família."""
    if not isinstance(value, dict):
        raise CompileError("A resposta de fonte deve informar família e peso.")
    family = value.get("family")
    weight = value.get("weight", 400)
    style = value.get("style", "normal")
    if not isinstance(family, str) or not family.strip():
        raise CompileError("A resposta de fonte deve informar uma família válida.")
    if isinstance(weight, bool) or not isinstance(weight, int):
        raise CompileError("A resposta de fonte deve informar um peso numérico válido.")
    if style not in {"normal", "italic"}:
        raise CompileError("A resposta de fonte deve informar um estilo válido.")
    return family.strip(), weight, style


def _font_identity(value: Any) -> tuple[str, int, str]:
    """Extrai a identidade completa e normalizada de uma variante de fonte."""
    family, weight, style = _font_fields(value)
    return family.casefold(), weight, style


def _match_font(question: DraftQuestion | None, value: Any) -> Candidate | None:
    """Casa família, peso e estilo, usando o path apenas para desempatar."""
    identity = _font_identity(value)
    if question is None:
        return None
    matches: list[Candidate] = []
    for candidate in question.candidates:
        if not isinstance(candidate.value, dict):
            continue
        try:
            if _font_identity(candidate.value) == identity:
                matches.append(candidate)
        except CompileError:
            continue
    if not matches:
        return None
    # DTCG tem autoridade maior e por isso aparece antes, mas uma família/peso
    # pode existir tanto nos tokens quanto como arquivo. Quando o valor escolhido
    # veio do candidato file-backed, seu path relativo identifica essa escolha.
    # O path nunca é aceito isoladamente: precisa existir em um candidato casado.
    selected_path = value.get("path") if isinstance(value, dict) else None
    if selected_path is not None:
        try:
            selected_path = _portable_relative_path(selected_path)
        except CompileError:
            selected_path = None
        if selected_path is not None:
            for candidate in matches:
                candidate_path = candidate.value.get("path")
                if (
                    candidate_path is not None
                    and _portable_relative_path(candidate_path) == selected_path
                ):
                    return candidate
    return matches[0]


def _portable_relative_path(value: Any) -> str:
    """Normaliza um path relativo para a representação portátil do IR."""
    if not isinstance(value, str) or not value.strip():
        raise CompileError("O caminho do asset confirmado é inválido.")
    path = Path(value)
    if path.is_absolute() or ".." in path.parts:
        raise CompileError("O caminho do asset deve permanecer dentro do pacote da marca.")
    return path.as_posix()


def _match_logo(question: DraftQuestion | None, value: Any) -> Candidate | None:
    """Casa o logo pelo path relativo ao pacote."""
    relative = _portable_relative_path(value)
    if question is None:
        return None
    return next(
        (
            candidate
            for candidate in question.candidates
            if isinstance(candidate.value, str)
            and _portable_relative_path(candidate.value) == relative
        ),
        None,
    )


def _confirmation(created_at: datetime) -> Evidence:
    """Cria a evidência autoritativa comum a toda escolha confirmada."""
    return Evidence(
        source_type="wizard-confirmation",
        confidence=1.0,
        authoritative=True,
        confirmed_at=created_at,
    )


def _portable_evidence(item: Evidence, package_dir: Path) -> Evidence:
    """Copia uma evidência e torna seu path relativo à raiz do pacote."""
    if item.path is None:
        return item.model_copy(deep=True)
    try:
        base = package_dir.resolve(strict=True)
        raw = Path(item.path)
        resolved = (
            raw.resolve(strict=True) if raw.is_absolute() else (base / raw).resolve(strict=True)
        )
    except OSError as exc:
        raise CompileError(f"A origem da evidência não foi encontrada: {item.path}.") from exc
    if not resolved.is_file() or not resolved.is_relative_to(base):
        raise CompileError("A origem da evidência precisa permanecer dentro do pacote da marca.")
    return item.model_copy(update={"path": resolved.relative_to(base).as_posix()}, deep=True)


def _confirmed_evidence(
    candidate: Candidate | None,
    created_at: datetime,
    package_dir: Path,
) -> list[Evidence]:
    """Copia evidências portáveis e confirma a escolha sem mutar o draft."""
    inherited = (
        [_portable_evidence(item, package_dir) for item in candidate.evidence]
        if candidate is not None
        else []
    )
    return [*inherited, _confirmation(created_at)]


def _package_file(package_dir: Path, relative: str) -> Path:
    """Resolve um arquivo do pacote e bloqueia traversal e symlinks externos."""
    try:
        base = package_dir.resolve(strict=True)
        resolved = (base / relative).resolve(strict=True)
    except OSError as exc:
        raise CompileError(f"O arquivo confirmado não foi encontrado: {relative}.") from exc
    if not resolved.is_file() or not resolved.is_relative_to(base):
        raise CompileError("O asset confirmado precisa ser um arquivo dentro do pacote da marca.")
    return resolved


def _sha256(path: Path) -> str:
    """Calcula SHA-256 em streaming para não carregar uploads inteiros em memória."""
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(_HASH_CHUNK_SIZE), b""):
                digest.update(chunk)
    except OSError as exc:
        raise CompileError(f"Não foi possível ler o arquivo confirmado: {path.name}.") from exc
    return digest.hexdigest()


def _compile_color(
    draft: BrandDraft, token_id: str, value: Any, created_at: datetime
) -> ColorToken:
    """Compila um token de cor e sua cadeia de evidências."""
    try:
        normalized = normalize_color(str(value))
    except ValueError as exc:
        raise CompileError(f"A cor confirmada para {token_id} é inválida.") from exc
    candidate = _match_color(_question(draft, token_id), normalized)
    return ColorToken(
        value=normalized,
        evidence=_confirmed_evidence(candidate, created_at, Path(draft.package_dir)),
    )


def _compile_palette_colors(
    draft: BrandDraft,
    semantic_colors: dict[str, ColorToken],
) -> dict[str, ColorToken]:
    """Preserva cores explicitamente declaradas no manual ou nos tokens DTCG."""
    known_values = {token.value for token in semantic_colors.values()}
    palette: dict[str, ColorToken] = {}
    package_dir = Path(draft.package_dir)
    for candidate in draft.palette_candidates:
        try:
            value = normalize_color(str(candidate.value))
        except ValueError:
            continue
        if value in known_values:
            continue
        known_values.add(value)
        token_id = f"color.palette.{len(palette) + 1:02d}"
        palette[token_id] = ColorToken(
            value=value,
            evidence=[_portable_evidence(item, package_dir) for item in candidate.evidence],
        )
    return palette


def _compile_font(
    draft: BrandDraft,
    token_id: str,
    value: Any,
    created_at: datetime,
    diagnostics: list[Diagnostic],
) -> FontToken:
    """Compila uma fonte confirmada e liga o arquivo apenas quando ele veio no pacote."""
    family, weight, style = _font_fields(value)
    candidate = _match_font(_question(draft, token_id), value)
    candidate_value = candidate.value if candidate is not None else {}
    relative_path = candidate_value.get("path")
    resource = candidate_value.get("resource")
    file_sha256: str | None = None
    source = "referenced-only"
    if relative_path is not None:
        relative_path = _portable_relative_path(relative_path)
        file_sha256 = _sha256(_package_file(Path(draft.package_dir), relative_path))
        source = "file"
    else:
        diagnostics.append(
            Diagnostic(
                code="FONT_FILE_MISSING",
                target=token_id,
                message=f"A fonte «{family}» foi confirmada, mas o arquivo dela não veio no pacote.",
                resolution="render-fallback",
            )
        )
    try:
        return FontToken(
            family=family,
            weight=weight,
            style=style,
            source=source,
            file_sha256=file_sha256,
            resource=resource,
            evidence=_confirmed_evidence(candidate, created_at, Path(draft.package_dir)),
        )
    except ValidationError as exc:
        raise CompileError(f"A fonte confirmada para {token_id} é inválida.") from exc


def _compile_logo(
    draft: BrandDraft,
    value: Any,
    created_at: datetime,
    *,
    question_id: str = "logo.primary",
    confirmed: bool = True,
) -> LogoAsset:
    """Compila um logo candidato com path portátil, formato e hash do arquivo real."""
    relative = _portable_relative_path(value)
    candidate = _match_logo(_question(draft, question_id), relative)
    if candidate is None:
        raise CompileError("O logo confirmado precisa ser uma das opções válidas do rascunho.")
    suffix = Path(relative).suffix.casefold().removeprefix(".")
    if suffix not in {"svg", "png"}:
        raise CompileError("O logo confirmado deve estar em formato SVG ou PNG.")
    logo_path = _package_file(Path(draft.package_dir), relative)
    if suffix == "svg":
        try:
            if svg_external_style_missing(logo_path):
                raise CompileError(
                    "O logo confirmado depende de estilos externos; use um SVG autocontido."
                )
        except SvgInvalid as exc:
            raise CompileError("O logo confirmado não é um SVG válido e autocontido.") from exc
    inherited_evidence = [
        _portable_evidence(item, Path(draft.package_dir)) for item in candidate.evidence
    ]
    logo_geometry = (
        draft.composition_declarations.logo_geometry
        if draft.composition_declarations is not None
        else None
    )
    min_width_px = 96
    clear_space_ratio = 0.25
    if logo_geometry is not None:
        if logo_geometry.min_width_px is not None:
            min_width_px = logo_geometry.min_width_px
        if logo_geometry.clear_space_ratio is not None:
            clear_space_ratio = logo_geometry.clear_space_ratio
        inherited_evidence.extend(
            _portable_evidence(item, Path(draft.package_dir))
            for item in (
                *logo_geometry.min_width_evidence,
                *logo_geometry.clear_space_evidence,
            )
        )
    if confirmed:
        inherited_evidence.append(_confirmation(created_at))
    return LogoAsset(
        path=relative,
        sha256=_sha256(logo_path),
        format=suffix,
        evidence=inherited_evidence,
        min_width_px=min_width_px,
        clear_space_ratio=clear_space_ratio,
    )


def _logo_appearance(logo_path: Path) -> Literal["dark", "light"] | None:
    """Classifica a tinta visível de SVG ou PNG sem alterar o arquivo."""
    suffix = logo_path.suffix.casefold()
    if suffix == ".svg":
        colors = extract_svg_colors(logo_path)
    elif suffix == ".png":
        colors = extract_raster_colors(logo_path)
    else:
        return None
    total = sum(candidate.score for candidate in colors)
    if total <= 0:
        return None
    weighted_lightness = (
        sum(lightness(candidate.value) * candidate.score for candidate in colors) / total
    )
    if weighted_lightness <= 40:
        return "dark"
    if weighted_lightness >= 60:
        return "light"
    return None


def _logo_name_appearance(relative: str) -> Literal["dark", "light"] | None:
    """Aceita apenas convenções de nome inequívocas como fallback à cor."""
    stem = Path(relative).stem.casefold()
    if any(marker in stem for marker in ("on-light", "on_light", "positivo", "positive")):
        return "dark"
    if any(marker in stem for marker in ("on-dark", "on_dark", "negativo", "negative")):
        return "light"
    return None


def _compile_logo_variants(
    draft: BrandDraft,
    answers: Answers,
    created_at: datetime,
    *,
    confirmed_answers: Answers | None = None,
) -> dict[str, LogoAsset]:
    """Prioriza variantes confirmadas e usa inferência inequívoca como compatibilidade."""
    explicit: dict[str, LogoAsset] = {}
    for token in ("logo.onLight", "logo.onDark"):
        variant_question = _question(draft, token)
        if token not in answers.values or variant_question is None:
            continue
        explicit[token] = _compile_logo(
            draft,
            answers.values[token],
            created_at,
            question_id=token,
            confirmed=(
                not variant_question.automatic
                or (confirmed_answers is not None and token in confirmed_answers.values)
            ),
        )

    question = _question(draft, "logo.primary")
    if question is None:
        return explicit
    by_appearance: dict[str, list[str]] = {"dark": [], "light": []}
    for candidate in question.candidates:
        if not isinstance(candidate.value, str):
            continue
        relative = _portable_relative_path(candidate.value)
        path = _package_file(Path(draft.package_dir), relative)
        appearance = _logo_appearance(path) or _logo_name_appearance(relative)
        if appearance is not None:
            by_appearance[appearance].append(relative)
    inferred: dict[str, LogoAsset] = {}
    if len(by_appearance["dark"]) == 1:
        inferred["logo.onLight"] = _compile_logo(
            draft,
            by_appearance["dark"][0],
            created_at,
            confirmed=False,
        )
    if len(by_appearance["light"]) == 1:
        inferred["logo.onDark"] = _compile_logo(
            draft,
            by_appearance["light"][0],
            created_at,
            confirmed=False,
        )
    return {**inferred, **explicit}


def _compile_logo_catalog(
    draft: BrandDraft,
    created_at: datetime,
    existing: dict[str, LogoAsset],
) -> dict[str, LogoAsset]:
    """Preserva cada arquivo de logo enviado, além dos papéis semânticos."""
    question = _question(draft, "logo.primary")
    if question is None:
        return {}
    known_hashes = {asset.sha256 for asset in existing.values()}
    catalog: dict[str, LogoAsset] = {}
    for candidate in question.candidates:
        if not isinstance(candidate.value, str):
            continue
        asset = _compile_logo(draft, candidate.value, created_at, confirmed=False)
        if asset.sha256 in known_hashes:
            continue
        catalog[f"logo.variant.{asset.sha256}"] = asset
        known_hashes.add(asset.sha256)
    return catalog


def _portable_evidence_list(items: list[Evidence], package_dir: Path) -> list[Evidence]:
    return [_portable_evidence(item, package_dir) for item in items]


def _compile_composition_rules(
    draft: BrandDraft,
    colors: dict[str, ColorToken],
    assets: dict[str, LogoAsset],
    diagnostics: list[Diagnostic],
) -> CompositionRules:
    """Preserva declarações e sempre deriva um par de superfícies utilizável."""
    declarations = draft.composition_declarations
    package_dir = Path(draft.package_dir)
    role_tokens = {
        "primary": "color.primary",
        "background": "color.background",
        "accent": "color.secondary",
    }
    for declaration in declarations.color_ratios if declarations is not None else []:
        if declaration.color_value is None:
            continue
        matching = [
            token_id
            for token_id, token in colors.items()
            if not token_id.startswith("color.palette.")
            and token.value.casefold() == declaration.color_value.casefold()
        ]
        if len(matching) == 1:
            role_tokens[declaration.role] = matching[0]

    # `color.text` pode repetir a mesma tinta de `color.primary` em pacotes
    # legados. Nesse caso, preservamos o token primário para a proporção, mas
    # usamos o token textual como primeiro plano do modo claro. Quando o manual
    # declara outra tinta para o texto, a correspondência cromática explícita
    # continua soberana.
    light_foreground_token = role_tokens["primary"]
    primary_declaration = next(
        (
            item
            for item in (declarations.color_ratios if declarations is not None else [])
            if item.role == "primary"
        ),
        None,
    )
    if (
        primary_declaration is not None
        and primary_declaration.color_value is not None
        and "color.text" in colors
        and colors["color.text"].value.casefold() == primary_declaration.color_value.casefold()
    ):
        light_foreground_token = "color.text"

    semantic_order = [
        token
        for token in ("color.background", "color.text", "color.primary", "color.secondary")
        if token in colors
    ]

    def most_contrasting(background_token: str) -> str:
        """Escolhe somente entre papéis confirmados, nunca entre tinta incidental do PDF."""
        return max(
            (token for token in semantic_order if token != background_token),
            key=lambda token: wcag_contrast(
                colors[token].value,
                colors[background_token].value,
            ),
            default=background_token,
        )

    principal_background = role_tokens["background"]
    principal_foreground = (
        light_foreground_token
        if wcag_contrast(
            colors[light_foreground_token].value,
            colors[principal_background].value,
        )
        >= 4.5
        else most_contrasting(principal_background)
    )
    primary_surface = role_tokens["primary"]
    alternative_background = (
        primary_surface
        if primary_surface != principal_background
        and wcag_contrast(
            colors[principal_background].value,
            colors[primary_surface].value,
        )
        >= 4.5
        else most_contrasting(principal_background)
    )
    alternative_foreground = (
        principal_background
        if wcag_contrast(
            colors[principal_background].value,
            colors[alternative_background].value,
        )
        >= 4.5
        else most_contrasting(alternative_background)
    )

    surfaces = sorted(
        (
            (principal_background, principal_foreground),
            (alternative_background, alternative_foreground),
        ),
        key=lambda pair: lightness(colors[pair[0]].value),
        reverse=True,
    )
    light_background, light_foreground = surfaces[0]
    dark_background, dark_foreground = surfaces[1]
    if declarations is not None and declarations.light_mode_evidence:
        light_background = role_tokens["background"]
        light_foreground = light_foreground_token
    if declarations is not None and declarations.dark_mode_evidence:
        dark_background = role_tokens["primary"]
        dark_foreground = role_tokens["background"]
    light_evidence = (
        _portable_evidence_list(declarations.light_mode_evidence, package_dir)
        if declarations is not None
        else []
    )
    dark_evidence = (
        _portable_evidence_list(declarations.dark_mode_evidence, package_dir)
        if declarations is not None
        else []
    )
    modes = CompositionModes(
        light=CompositionMode(
            background_color_token=light_background,
            foreground_color_token=light_foreground,
            logo_asset_token=("logo.onLight" if "logo.onLight" in assets else "logo.primary"),
            evidence=light_evidence,
        ),
        dark=CompositionMode(
            background_color_token=dark_background,
            foreground_color_token=dark_foreground,
            logo_asset_token="logo.onDark" if "logo.onDark" in assets else "logo.primary",
            evidence=dark_evidence,
        ),
    )

    # Uma escolha legítima do wizard pode fazer dois papéis declarados apontarem
    # para o mesmo token (por exemplo, a tinta de acento confirmada como fundo).
    # O IR admite uma proporção por token, portanto somamos as participações e
    # preservamos a evidência de cada papel em vez de rejeitar a marca inteira.
    ratio_order: list[str] = []
    ratio_values: dict[str, float] = {}
    ratio_evidence: dict[str, list[Evidence]] = {}
    ratio_roles: dict[str, list[str]] = {}
    for item in declarations.color_ratios if declarations is not None else []:
        token = role_tokens[item.role]
        if token not in colors:
            continue
        if token not in ratio_values:
            ratio_order.append(token)
            ratio_values[token] = 0.0
            ratio_evidence[token] = []
            ratio_roles[token] = []
        ratio_values[token] += item.ratio
        ratio_evidence[token].extend(_portable_evidence_list(item.evidence, package_dir))
        ratio_roles[token].append(item.role)

    collided_roles = [roles for roles in ratio_roles.values() if len(roles) > 1]
    if collided_roles:
        diagnostics.append(
            Diagnostic(
                code="COMPOSITION_ROLE_COLLISION",
                target="composition.colorRatios",
                message=(
                    "A mesma cor foi confirmada para mais de um papel de composição; "
                    "as proporções correspondentes foram combinadas."
                ),
                resolution="review-color-roles",
            )
        )

    ratios = [
        ColorRatioRule(
            color_token=token,
            ratio=ratio_values[token],
            evidence=ratio_evidence[token],
        )
        for token in ratio_order
    ]
    accent = None
    accent_ratio = next(
        (
            item
            for item in (declarations.color_ratios if declarations is not None else [])
            if item.role == "accent"
        ),
        None,
    )
    accent_token = role_tokens["accent"]
    accent_is_distinct = accent_token not in {
        role_tokens["primary"],
        role_tokens["background"],
    }
    if (
        accent_token in colors
        and accent_is_distinct
        and (
            (declarations is not None and declarations.accent is not None)
            or accent_ratio is not None
        )
    ):
        max_ratio = (
            declarations.accent.max_ratio
            if declarations is not None and declarations.accent is not None
            else accent_ratio.ratio
        )
        accent_evidence = (
            declarations.accent.evidence
            if declarations is not None and declarations.accent is not None
            else accent_ratio.evidence
        )
        accent = AccentRule(
            color_token=accent_token,
            max_ratio=max_ratio,
            evidence=_portable_evidence_list(accent_evidence, package_dir),
        )
    motifs = [
        MotifRule(
            kind=item.kind,
            evidence=_portable_evidence_list(item.evidence, package_dir),
        )
        for item in (declarations.motifs if declarations is not None else [])
    ]
    layout_style = (
        LayoutStyleRule(
            kind=declarations.layout_style.kind,
            evidence=_portable_evidence_list(declarations.layout_style.evidence, package_dir),
        )
        if declarations is not None and declarations.layout_style is not None
        else None
    )
    numbering = (
        NumberingRule(
            style="zero-padded",
            min_digits=2,
            evidence=_portable_evidence_list(declarations.numbering_evidence, package_dir),
        )
        if declarations is not None and declarations.numbering_evidence
        else None
    )
    return CompositionRules(
        modes=modes,
        color_ratios=ratios,
        accent=accent,
        motifs=motifs,
        layout_style=layout_style,
        numbering=numbering,
    )


def _revision_id(ir: BrandIR) -> str:
    """Deriva o id do conteúdo, neutralizando metadados temporais da revisão."""
    identity = ir.model_copy(deep=True)
    identity.revision = RevisionInfo(id="", created_at=_IDENTITY_EPOCH)
    evidence_groups = [
        *(token.evidence for token in identity.colors.values()),
        *(token.evidence for token in identity.fonts.values()),
        *(asset.evidence for asset in identity.assets.values()),
    ]
    if identity.identity is not None:
        evidence_groups.append(identity.identity.evidence)
    if identity.composition_rules is not None:
        rules = identity.composition_rules
        evidence_groups.extend(
            mode.evidence for mode in (rules.modes.light, rules.modes.dark) if mode is not None
        )
        evidence_groups.extend(item.evidence for item in rules.color_ratios)
        evidence_groups.extend(item.evidence for item in rules.motifs)
        if rules.layout_style is not None:
            evidence_groups.append(rules.layout_style.evidence)
        if rules.accent is not None:
            evidence_groups.append(rules.accent.evidence)
        if rules.numbering is not None:
            evidence_groups.append(rules.numbering.evidence)
    for evidence in evidence_groups:
        for item in evidence:
            if item.confirmed_at is not None:
                item.confirmed_at = _IDENTITY_EPOCH
    payload = _REVISION_BUNDLE_DOMAIN + identity.model_dump_json(by_alias=True).encode("utf-8")
    return f"brandrev_{hashlib.sha256(payload).hexdigest()[:12]}"


def compile_ir(
    draft: BrandDraft,
    answers: Answers,
    brand_name: str,
    created_at: datetime | None = None,
) -> BrandIR:
    """Transforma um draft confirmado em uma revisão determinística do Brand IR."""
    resolved_answers = _resolved_answers(draft, answers)
    required_answers = {
        *_REQUIRED_ANSWERS,
        *(question.id for question in draft.questions if question.required),
    }
    missing = sorted(
        answer_id for answer_id in required_answers if answer_id not in resolved_answers.values
    )
    if missing:
        raise CompileError("Responda às perguntas obrigatórias: " + ", ".join(missing) + ".")

    timestamp = created_at if created_at is not None else datetime.now(timezone.utc)
    diagnostics = [item.model_copy(deep=True) for item in draft.diagnostics]
    identity_question = _question(draft, "identity.expression")
    identity_answer = resolved_answers.values.get("identity.expression")
    explicit_identity_answer = "identity.expression" in answers.values
    identity = None
    if identity_question is not None and identity_answer is not None:
        # A leitura editorial pertence à marca, não ao briefing de cada peça.
        # Quando o manual oferece sinal, ele é preservado automaticamente. Um
        # pacote que só traz cores/fontes não é forçado a inventar uma essência.
        # Respostas explícitas continuam passando pelo guard estrito abaixo.
        if explicit_identity_answer:
            identity = _compile_identity(draft, identity_answer, timestamp)
        else:
            try:
                parsed_identity = IdentityDraftValue.model_validate(identity_answer)
            except ValidationError as exc:
                raise CompileError("A leitura da identidade possui campos inválidos.") from exc
            if parsed_identity.essence.strip():
                identity = _compile_identity(draft, identity_answer, timestamp)
    creative_direction = derive_creative_direction(identity) if identity is not None else None
    if identity is not None and creative_direction is None:
        diagnostics.append(
            Diagnostic(
                code="IDENTITY_SIGNAL_WEAK",
                target="identity.expression",
                message=(
                    "A identidade foi preservada, mas ainda não traz sinais suficientes "
                    "para sugerir uma direção estrutural específica."
                ),
                resolution="review-brand-expression",
            )
        )

    colors = {
        token_id: _compile_color(draft, token_id, resolved_answers.values[token_id], timestamp)
        for token_id in ("color.primary", "color.background", "color.text")
    }
    if "color.secondary" in resolved_answers.values:
        colors["color.secondary"] = _compile_color(
            draft,
            "color.secondary",
            resolved_answers.values["color.secondary"],
            timestamp,
        )
    else:
        diagnostics.append(
            Diagnostic(
                code="UNDETERMINED",
                target="color.secondary",
                message="A cor secundária da marca não foi determinada.",
            )
        )
    colors.update(_compile_palette_colors(draft, colors))

    fonts = {
        token_id: _compile_font(
            draft,
            token_id,
            resolved_answers.values[token_id],
            timestamp,
            diagnostics,
        )
        for token_id in ("font.heading", "font.body")
    }
    assets: dict[str, LogoAsset] = {
        "logo.primary": _compile_logo(
            draft,
            resolved_answers.values["logo.primary"],
            timestamp,
        ),
        **_compile_logo_variants(
            draft,
            resolved_answers,
            timestamp,
            confirmed_answers=answers,
        ),
    }
    assets.update(_compile_logo_catalog(draft, timestamp, assets))
    composition_rules = _compile_composition_rules(draft, colors, assets, diagnostics)

    roles = {
        "heading": SemanticRole(
            font="font.heading",
            color="color.primary",
            min_size_px=40,
            max_size_px=96,
            line_height=1.1,
        ),
        "body": SemanticRole(
            font="font.body",
            color="color.text",
            min_size_px=16,
            max_size_px=24,
            line_height=1.5,
        ),
        "caption": SemanticRole(
            font="font.body",
            color="color.text",
            min_size_px=12,
            max_size_px=16,
            line_height=1.4,
        ),
    }
    if composition_rules is not None:
        accent_color = "color.secondary" if "color.secondary" in colors else "color.primary"
        roles.update(
            {
                "display": SemanticRole(
                    font="font.heading",
                    color="color.primary",
                    min_size_px=56,
                    max_size_px=84,
                    line_height=0.95,
                ),
                "label": SemanticRole(
                    font="font.body",
                    color="color.text",
                    min_size_px=20,
                    max_size_px=30,
                    line_height=1.1,
                ),
                "index": SemanticRole(
                    font="font.heading",
                    color=accent_color,
                    min_size_px=240,
                    max_size_px=460,
                    line_height=0.8,
                ),
                "signature": SemanticRole(
                    font="font.body",
                    color="color.text",
                    min_size_px=14,
                    max_size_px=18,
                    line_height=1.2,
                ),
            }
        )

    ir = BrandIR(
        schema_version="0.4.0" if identity is not None else "0.3.0",
        brand=BrandInfo(name=brand_name),
        identity=identity,
        creative_direction=creative_direction,
        revision=RevisionInfo(id="", created_at=timestamp),
        colors=colors,
        fonts=fonts,
        roles=roles,
        assets=assets,
        composition_rules=composition_rules,
        diagnostics=diagnostics,
    )
    return ir.model_copy(
        update={
            "revision": RevisionInfo(
                id=_revision_id(ir),
                created_at=timestamp,
            )
        }
    )
