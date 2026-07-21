"""Composição determinística de carrosséis pela marca e pelo conteúdo de cada slide."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, Literal, Sequence

from brand_runtime import BrandIR, LayoutSpec
from brand_runtime.templates import recommend_template_layouts

SlideRole = Literal["cover", "content", "closing"]
_NUMBER_RE = re.compile(
    r"(?<![\w])(?:R\$\s*)?\d+(?:[.,]\d+)?(?:\s?(?:%|x|×|mil|milhão|milhões))?",
    re.IGNORECASE,
)
_PROCESS_RE = re.compile(
    r"\b(?:passo|etapa|fase|fluxo|processo|como|primeiro|segundo|terceiro|antes|depois)\b",
    re.IGNORECASE,
)
_QUOTE_RE = re.compile(r"^[\s\"'“‘«].+[\"'”’»]\s*$")


@dataclass(frozen=True)
class CarouselCompositionInput:
    """Sinais autorais disponíveis antes de materializar o documento."""

    headline: str
    text_blocks: tuple[str, ...] = ()
    cta: str = ""
    image_sha256: str | None = None


@dataclass(frozen=True)
class CarouselCompositionChoice:
    """Layout selecionado com uma explicação curta para a interface."""

    layout: LayoutSpec
    reason_pt: str


@dataclass(frozen=True)
class _Signals:
    headline_length: int
    block_count: int
    numeric_tokens: tuple[str, ...]
    has_process: bool
    has_quote: bool
    has_image: bool
    has_cta: bool


def extract_numeric_tokens(*texts: str) -> tuple[str, ...]:
    """Extrai valores que já existem no conteúdo sem completar dados por conta própria."""
    tokens: list[str] = []
    seen: set[str] = set()
    for text in texts:
        for match in _NUMBER_RE.finditer(text):
            token = match.group(0).strip()
            normalized = token.casefold().replace(" ", "")
            if normalized in seen:
                continue
            seen.add(normalized)
            tokens.append(token)
    return tuple(tokens)


def _role(position: int, total: int) -> SlideRole:
    if position == 0:
        return "cover"
    if position == total - 1:
        return "closing"
    return "content"


def _signals(slide: CarouselCompositionInput) -> _Signals:
    texts = (slide.headline, *slide.text_blocks, slide.cta)
    joined = " ".join(texts)
    return _Signals(
        headline_length=len(slide.headline.strip()),
        block_count=len(tuple(block for block in slide.text_blocks if block.strip())),
        numeric_tokens=extract_numeric_tokens(*texts),
        has_process=bool(_PROCESS_RE.search(joined)),
        has_quote=bool(_QUOTE_RE.match(slide.headline.strip())),
        has_image=slide.image_sha256 is not None,
        has_cta=bool(slide.cta.strip()),
    )


def _package_id(layout: LayoutSpec) -> str:
    return layout.template_ref.package_id if layout.template_ref is not None else "essential"


def _body_slots(layout: LayoutSpec) -> int:
    return sum(
        slot.kind == "text" and (slot.role == "body" or slot.id.startswith("body"))
        for slot in layout.slots
    )


def _headline_area(layout: LayoutSpec) -> float:
    ids = {"headline", "title", "quote", "headline-lead", "echo-near", "echo-far"}
    slot = next((item for item in layout.slots if item.id in ids), None)
    if slot is None:
        return 0.0
    return (slot.area[2] * slot.area[3]) / (layout.canvas.width_px * layout.canvas.height_px)


def _eligible(layout: LayoutSpec, signals: _Signals) -> bool:
    image_slots = [slot for slot in layout.slots if slot.kind == "image"]
    if not signals.has_image and image_slots:
        return False
    package_id = _package_id(layout)
    if package_id == "device-mockup" and not signals.has_image:
        return False
    if package_id == "data-evidence" and len(signals.numeric_tokens) < 2:
        return False
    if package_id == "technical-diagram" and not signals.has_process:
        return False
    if signals.block_count and _body_slots(layout) < signals.block_count:
        return False
    return True


def _role_score(layout: LayoutSpec, role: SlideRole, signals: _Signals) -> float:
    score = 0.0
    body_count = _body_slots(layout)
    headline_area = _headline_area(layout)
    layout_id = layout.id.casefold()
    if role == "cover":
        score += headline_area * 36
        score -= body_count * 1.5
        if any(term in layout_id for term in ("cover", "hero", "manifesto", "monument")):
            score += 9
    elif role == "closing":
        if any(slot.id == "cta" for slot in layout.slots):
            score += 12
        if any(
            term in layout_id
            for term in ("closing", "launch", "signal", "pulse", "contact", "flow")
        ):
            score += 8
        score += headline_area * 18
    else:
        target = max(1, signals.block_count)
        score += 12 - abs(body_count - target) * 2.5
        if body_count >= signals.block_count:
            score += 4
    return score


def _content_score(layout: LayoutSpec, signals: _Signals) -> float:
    package_id = _package_id(layout)
    score = 0.0
    image_slots = sum(slot.kind == "image" for slot in layout.slots)
    if signals.has_image:
        score += 18 if image_slots else -8
    if len(signals.numeric_tokens) >= 2:
        score += 28 if package_id == "data-evidence" else 0
        score += 12 if package_id in {"swiss-system", "technical-diagram"} else 0
    if signals.has_process:
        score += 22 if package_id == "technical-diagram" else 0
        score += 8 if package_id in {"swiss-system", "constructivist-dynamics"} else 0
    if signals.has_quote or (signals.headline_length <= 72 and signals.block_count <= 1):
        score += (
            9
            if package_id in {"typographic-editorial", "minimal-luxury", "fashion-editorial"}
            else 0
        )
    if signals.block_count >= 3:
        score += 8 if package_id in {"swiss-system", "technical-diagram"} else 0
    if signals.has_cta:
        score += 5 if any(slot.id == "cta" for slot in layout.slots) else 0
    return score


def _reason(layout: LayoutSpec, role: SlideRole, signals: _Signals) -> str:
    if signals.has_image and any(slot.kind == "image" for slot in layout.slots):
        return "A imagem enviada conduz a composição sem perder a hierarquia da marca."
    if len(signals.numeric_tokens) >= 2 and _package_id(layout) == "data-evidence":
        return "Os números já presentes no conteúdo viram a estrutura visual deste slide."
    if signals.has_process and _package_id(layout) == "technical-diagram":
        return "As etapas do texto são organizadas como uma sequência visual legível."
    if role == "cover":
        return "A abertura recebe mais escala e menos distrações para iniciar a narrativa."
    if role == "closing":
        return "O fechamento reserva presença para a mensagem final e para a ação seguinte."
    if signals.block_count >= 2:
        return f"A composição acomoda os {signals.block_count} blocos sem comprimir a leitura."
    return "A composição funciona sem depender de fotografia e preserva a voz da marca."


def explain_carousel_choice(
    layout: LayoutSpec,
    role: SlideRole,
    slide: CarouselCompositionInput,
) -> str:
    """Explica uma escolha já materializada sem persistir metadados derivados."""
    return _reason(layout, role, _signals(slide))


def compose_carousel_sequence(
    ir: BrandIR,
    layouts: Iterable[LayoutSpec],
    slides: Sequence[CarouselCompositionInput],
) -> list[CarouselCompositionChoice]:
    """Escolhe uma sequência coerente, variada e explicável para o conteúdo recebido."""
    available = list(layouts)
    if not available or not slides:
        return []
    recommendations = recommend_template_layouts(
        ir,
        available,
        limit=min(24, len(available)),
    )
    brand_rank = {item.layout_id: item.rank for item in recommendations}
    choices: list[CarouselCompositionChoice] = []
    previous_layout_id: str | None = None

    for position, slide in enumerate(slides):
        signals = _signals(slide)
        role = _role(position, len(slides))
        candidates = [layout for layout in available if _eligible(layout, signals)]
        if signals.has_image:
            image_candidates = [
                layout
                for layout in candidates
                if any(slot.kind == "image" for slot in layout.slots)
            ]
            candidates = image_candidates or candidates
        elif len(signals.numeric_tokens) >= 2:
            data_candidates = [
                layout for layout in candidates if _package_id(layout) == "data-evidence"
            ]
            candidates = data_candidates or candidates
        elif signals.has_process:
            process_candidates = [
                layout for layout in candidates if _package_id(layout) == "technical-diagram"
            ]
            candidates = process_candidates or candidates
        if not candidates:
            candidates = [
                layout
                for layout in available
                if not any(slot.kind == "image" and slot.required for slot in layout.slots)
            ]
        if not candidates:
            raise ValueError("Nenhum layout compatível pôde compor este carrossel.")

        def score(layout: LayoutSpec) -> tuple[float, str]:
            rank = brand_rank.get(layout.id, 30)
            value = max(0, 34 - rank) + _role_score(layout, role, signals)
            value += _content_score(layout, signals)
            if layout.id == previous_layout_id:
                value -= 60
            if layout.id.endswith("-alternative"):
                value += 2 if position % 2 else -2
            return (value, layout.id)

        selected = max(candidates, key=score)
        choices.append(
            CarouselCompositionChoice(
                layout=selected,
                reason_pt=_reason(selected, role, signals),
            )
        )
        previous_layout_id = selected.id
    return choices
