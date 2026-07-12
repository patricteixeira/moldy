"""Operações de cor do motor: normalização, distância, dedupe, contraste e neutralidade."""

from __future__ import annotations

from coloraide import Color

_NEUTRAL_CHROMA_MAX = 12.0


def normalize_color(value: str) -> str:
    """Normaliza qualquer cor CSS parseável para "#RRGGBB" maiúsculo.

    Levanta ValueError se o valor não for uma cor válida.
    """
    try:
        color = Color(value)
    except ValueError as exc:
        raise ValueError(f"Cor inválida: {value!r}") from exc
    srgb = color.convert("srgb").fit()
    srgb[3] = 1.0  # descarta alpha: contrato é sempre #RRGGBB
    return srgb.to_string(hex=True, upper=True)


def delta_e(hex_a: str, hex_b: str) -> float:
    """Distância perceptual CIEDE2000 entre duas cores."""
    return Color(hex_a).delta_e(hex_b, method="2000")


def dedupe_colors(
    items: list[tuple[str, float]], threshold: float = 6.0
) -> list[tuple[str, float]]:
    """Agrupa cores perceptualmente próximas (delta_e < threshold).

    Representante do grupo = cor de maior score individual; score do grupo = soma.
    Retorno ordenado por score do grupo, decrescente.
    """
    groups: list[tuple[str, float]] = []  # (representante, score acumulado)
    for value, score in sorted(items, key=lambda item: item[1], reverse=True):
        for i, (rep, total) in enumerate(groups):
            if delta_e(value, rep) < threshold:
                groups[i] = (rep, total + score)
                break
        else:
            groups.append((value, score))
    return sorted(groups, key=lambda group: group[1], reverse=True)


def wcag_contrast(fg_hex: str, bg_hex: str) -> float:
    """Razão de contraste WCAG 2.1 entre texto e fundo (1..21)."""
    return Color(fg_hex).contrast(bg_hex, method="wcag21")


def lightness(hex_color: str) -> float:
    """Luminosidade L do espaço Lab (0..100)."""
    return Color(hex_color).convert("lab")["lightness"]


def is_neutral(hex_color: str) -> bool:
    """Cor neutra = croma C do LCh abaixo de 12."""
    return Color(hex_color).convert("lch")["chroma"] < _NEUTRAL_CHROMA_MAX
