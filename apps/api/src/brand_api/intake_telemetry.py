"""Métricas leves e sem conteúdo sensível para o intake de marca."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from time import perf_counter

_MIB = 1024 * 1024


def _resident_bytes() -> int | None:
    """Lê o RSS atual no Linux sem adicionar uma dependência de observabilidade."""
    try:
        resident_pages = int(Path("/proc/self/statm").read_text(encoding="ascii").split()[1])
        return resident_pages * int(os.sysconf("SC_PAGE_SIZE"))
    except (IndexError, OSError, TypeError, ValueError):
        return None


@dataclass
class IntakeTelemetry:
    """Registra duração incremental e RSS por estágio de uma única importação."""

    draft_id: str
    logger: logging.Logger
    started_at: float = field(default_factory=perf_counter)
    last_mark_at: float = field(init=False)
    initial_rss: int | None = field(default_factory=_resident_bytes)
    timings_ms: list[tuple[str, float]] = field(default_factory=list)

    def __post_init__(self) -> None:
        """Inicializa o marco incremental no mesmo instante do início."""
        self.last_mark_at = self.started_at

    def mark(self, stage: str) -> None:
        """Fecha um estágio e emite uma linha pesquisável sem nomes de arquivos."""
        now = perf_counter()
        duration_ms = (now - self.last_mark_at) * 1000
        elapsed_ms = (now - self.started_at) * 1000
        rss = _resident_bytes()
        self.timings_ms.append((stage, duration_ms))
        self.last_mark_at = now
        self.logger.info(
            "brand_intake draft=%s stage=%s duration_ms=%.1f elapsed_ms=%.1f "
            "rss_mib=%s rss_delta_mib=%s",
            self.draft_id,
            stage,
            duration_ms,
            elapsed_ms,
            f"{rss / _MIB:.1f}" if rss is not None else "unknown",
            (
                f"{(rss - self.initial_rss) / _MIB:+.1f}"
                if rss is not None and self.initial_rss is not None
                else "unknown"
            ),
        )

    def server_timing(self) -> str:
        """Serializa os estágios no formato padrão consumido pelo DevTools."""
        return ", ".join(f"{stage};dur={duration_ms:.1f}" for stage, duration_ms in self.timings_ms)
