"""Atalho DTCG: importador de tokens estruturados (Design Tokens Community Group).

Além dos materiais informais, o pacote de marca pode trazer um arquivo de
tokens no formato DTCG (``tokens.json`` ou ``*.tokens.json`` na raiz).
Tokens estruturados são intenção declarada — entram no ranking do draft
acima de qualquer extração —, mas continuam passando pelo wizard: a
autoridade final permanece na confirmação da pessoa (spec §5.3).

Suporte do walking skeleton:

- ``$type: "color"`` com ``$value`` string CSS parseável (hex, ``rgb(...)``);
- ``$type: "fontFamily"`` (``$value`` string ou lista — usa a primeira) e
  ``$type: "fontWeight"`` (número ou alias textual), combinados por nome em
  um candidato de fonte com a mesma forma de ``FontInfo``;
- ``$type`` declarado em grupo é herdado pelos descendentes;
- aliases ``"{grupo.token}"`` resolvidos recursivamente; ciclo ou alvo
  inexistente levantam :class:`DtcgError` (mensagens PT-BR).

Chaves de retorno: ``"color.<nome-do-token-folha>"`` e ``"font.<nome>"``.
Quando dois tokens produzem a mesma chave (ex.: ``palette.blue`` e
``brand.blue``), o primeiro na ordem do documento vence.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from brand_runtime.colors import normalize_color
from brand_runtime.intake.base import Candidate
from brand_runtime.intake.pdf_fonts import FontInfo
from brand_runtime.ir.models import Evidence

# Tokens declarados são fatos estruturados: confiança máxima e score uniforme
# (não existe noção de frequência como nos extratores de PDF/imagem).
_CONFIDENCE = 1.0
_SCORE = 1.0
_DEFAULT_WEIGHT = 400

# Alias DTCG: o $value inteiro é uma referência "{grupo.token}".
_ALIAS = re.compile(r"^\{([^{}]+)\}$")

# Nomes de token que são componentes de um grupo tipográfico
# (ex.: font.heading.family + font.heading.weight): o candidato recebe o nome
# do grupo ("heading"), não o do componente.
_FAMILY_COMPONENT_NAMES = frozenset({"family", "fontfamily"})
_WEIGHT_COMPONENT_NAMES = frozenset({"weight", "fontweight"})

# Aliases textuais de peso aceitos em $type "fontWeight" (DTCG §8.4),
# normalizados sem hífens/espaços e em minúsculas.
_WEIGHT_ALIASES: dict[str, int] = {
    "thin": 100,
    "hairline": 100,
    "extralight": 200,
    "ultralight": 200,
    "light": 300,
    "normal": 400,
    "regular": 400,
    "book": 400,
    "medium": 500,
    "semibold": 600,
    "demibold": 600,
    "bold": 700,
    "extrabold": 800,
    "ultrabold": 800,
    "black": 900,
    "heavy": 900,
}

_TokenIndex = dict[tuple[str, ...], tuple[dict[str, Any], str | None]]


class DtcgError(Exception):
    """Erro em tokens DTCG: JSON inválido, alias inexistente, ciclo ou valor inválido."""


def _walk(root: dict[str, Any], index: _TokenIndex) -> None:
    """Indexa todos os tokens (nós com ``$value``) com o ``$type`` efetivo.

    O ``$type`` de um grupo é herdado pelos descendentes que não declaram o
    próprio (DTCG §5.2). Chaves iniciadas em ``$`` são metadados, não filhos.
    A raiz do documento é um grupo, nunca um token nomeado: ``$value`` na raiz
    é ignorado. Iterativo com pilha explícita (preordem = ordem do documento):
    tokens.json é input hostil e aninhamento arbitrário não pode estourar a
    recursão do interpretador.
    """
    stack: list[tuple[dict[str, Any], tuple[str, ...], str | None]] = [(root, (), None)]
    while stack:
        node, path, inherited_type = stack.pop()
        node_type = node.get("$type", inherited_type)
        if "$value" in node:
            if path:
                index[path] = (node, node_type)
            continue
        children = [
            (child, (*path, key), node_type)
            for key, child in node.items()
            if not key.startswith("$") and isinstance(child, dict)
        ]
        stack.extend(reversed(children))  # pop() em LIFO devolve a ordem do documento


def _resolve(path: tuple[str, ...], index: _TokenIndex) -> tuple[Any, str | None]:
    """Resolve o valor de um token seguindo aliases; retorna (valor, $type efetivo).

    O ``$type`` declarado no próprio token vence; sem ele, herda o do alvo do
    alias (o primeiro declarado ao longo da cadeia). Ciclos e alvos
    inexistentes levantam :class:`DtcgError`. Iterativo: cadeias de aliases
    vêm de input hostil e, por mais longas que sejam (desde que sem ciclo),
    não podem estourar a recursão do interpretador.
    """
    chain: list[tuple[str, ...]] = []
    visited: set[tuple[str, ...]] = set()
    effective_type: str | None = None
    current = path
    while True:
        if current in visited:
            cycle = " -> ".join(".".join(p) for p in (*chain, current))
            raise DtcgError(f"Ciclo de aliases nos tokens DTCG: {cycle}.")
        if current not in index:
            dotted = ".".join(current)
            referrer = ".".join(chain[-1]) if chain else "?"
            raise DtcgError(
                f"O alias «{{{dotted}}}» referenciado em «{referrer}» não existe nos tokens."
            )
        chain.append(current)
        visited.add(current)
        node, node_type = index[current]
        if effective_type is None:
            effective_type = node_type
        value = node["$value"]
        if isinstance(value, str) and (match := _ALIAS.match(value.strip())):
            current = tuple(match.group(1).split("."))
            continue
        return value, effective_type


def _font_entry_name(path: tuple[str, ...], component_names: frozenset[str]) -> str:
    """Nome do candidato de fonte: o token, ou o grupo quando o token é componente."""
    leaf = path[-1].casefold().replace("-", "")
    if leaf in component_names and len(path) >= 2:
        return path[-2]
    return path[-1]


def _parse_weight(value: Any, pointer: str) -> int:
    """Converta o ``$value`` de um token ``fontWeight`` em peso numérico."""
    if isinstance(value, bool):  # bool é subclasse de int: rejeitar explicitamente
        raise DtcgError(f"O token de peso «{pointer}» tem valor inválido: {value!r}.")
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        normalized = value.strip().casefold().replace("-", "").replace(" ", "")
        if normalized in _WEIGHT_ALIASES:
            return _WEIGHT_ALIASES[normalized]
        if normalized.isdigit():
            return int(normalized)
    raise DtcgError(f"O token de peso «{pointer}» tem valor inválido: {value!r}.")


def load_dtcg(path: Path) -> dict[str, Candidate]:
    """Carrega um arquivo de tokens DTCG e devolve candidatos por chave semântica.

    Chaves de retorno: ``"color.<nome-do-token-folha>"`` para tokens de cor e
    ``"font.<nome>"`` para fontes (``fontFamily`` + ``fontWeight`` combinados
    por nome; peso ausente assume 400; ``fontWeight`` sem família é ignorado).
    Tipos fora do suporte do skeleton são ignorados. Cada candidato leva
    ``Evidence(source_type="dtcg-tokens", confidence=1.0)`` com o JSON Pointer
    do token em ``detail``.

    Levanta :class:`DtcgError` para JSON inválido, aninhamento profundo demais
    para o parser, alias inexistente, ciclo de aliases ou valor de cor/peso
    inválido — nunca deixa escapar exceções cruas de input hostil.
    """
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise DtcgError(f"O arquivo de tokens «{path.name}» não é JSON válido: {exc}.") from exc
    except RecursionError as exc:
        raise DtcgError(
            f"O arquivo de tokens «{path.name}» tem aninhamento profundo demais."
        ) from exc
    if not isinstance(raw, dict):
        raise DtcgError(f"O arquivo de tokens «{path.name}» deve conter um objeto JSON na raiz.")

    index: _TokenIndex = {}
    _walk(raw, index)

    colors: dict[str, Candidate] = {}
    families: dict[str, tuple[str, Evidence]] = {}
    weights: dict[str, tuple[int, Evidence]] = {}
    family_order: list[str] = []

    for token_path in index:  # ordem de inserção = ordem do documento
        value, value_type = _resolve(token_path, index)
        pointer = "/" + "/".join(token_path)
        evidence = Evidence(
            source_type="dtcg-tokens", path=str(path), detail=pointer, confidence=_CONFIDENCE
        )
        if value_type == "color":
            key = f"color.{token_path[-1]}"
            if key in colors:
                continue  # primeiro token com o nome vence
            if not isinstance(value, str):
                raise DtcgError(f"O token de cor «{pointer}» tem valor não suportado: {value!r}.")
            try:
                hex_value = normalize_color(value)
            except ValueError as exc:
                raise DtcgError(
                    f"O token de cor «{pointer}» tem valor inválido: {value!r}."
                ) from exc
            colors[key] = Candidate(value=hex_value, score=_SCORE, evidence=[evidence])
        elif value_type == "fontFamily":
            name = _font_entry_name(token_path, _FAMILY_COMPONENT_NAMES)
            if isinstance(value, list):
                value = value[0] if value else None  # lista = pilha de fallback: 1ª vence
            if not isinstance(value, str) or not value:
                raise DtcgError(f"O token de família «{pointer}» tem valor inválido: {value!r}.")
            if name not in families:
                families[name] = (value, evidence)
                family_order.append(name)
        elif value_type == "fontWeight":
            name = _font_entry_name(token_path, _WEIGHT_COMPONENT_NAMES)
            weights.setdefault(name, (_parse_weight(value, pointer), evidence))

    out: dict[str, Candidate] = dict(colors)
    for name in family_order:
        family, family_evidence = families[name]
        weight_entry = weights.get(name)
        info = FontInfo(
            family=family,
            weight=weight_entry[0] if weight_entry else _DEFAULT_WEIGHT,
        )
        evidence_list = [family_evidence]
        if weight_entry:
            evidence_list.append(weight_entry[1])
        out[f"font.{name}"] = Candidate(
            value=info.model_dump(by_alias=True), score=_SCORE, evidence=evidence_list
        )
    return out
