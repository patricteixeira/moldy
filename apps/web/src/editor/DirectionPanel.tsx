import type { BrandIr, SurfaceStyle } from "../api/types"
import { SurfaceBrowser } from "./SurfaceBrowser"
import { SURFACE_CATALOG } from "./surfaceCatalog"

interface Props {
  brandIr: BrandIr
  surface: SurfaceStyle | null
  disabled?: boolean
  onSurfaceChange(surface: SurfaceStyle | null): void
  onApplyDirection(): void
}

const compositionNames = {
  contemplative: "Mais espaço entre os elementos",
  asymmetric: "Composição assimétrica",
  modular: "Organização em grade",
  expansive: "Títulos maiores",
  layered: "Elementos em camadas",
} as const

function surfaceName(kind: SurfaceStyle["kind"]): string {
  return SURFACE_CATALOG.find((item) => item.kind === kind)?.name ?? "Textura"
}

export function DirectionPanel({
  brandIr,
  surface,
  disabled = false,
  onSurfaceChange,
  onApplyDirection,
}: Props) {
  const direction = brandIr.creativeDirection
  const update = (patch: Partial<SurfaceStyle>) => {
    if (surface) onSurfaceChange({ ...surface, ...patch })
  }

  return (
    <section className="direction-panel" aria-labelledby="direction-panel-title">
      <p className="panel-kicker">Sugestão para esta marca</p>
      <h3 id="direction-panel-title">
        {direction ? compositionNames[direction.composition] : "Ainda não há uma sugestão"}
      </h3>
      {direction ? (
        <>
          <p className="direction-summary">
            {direction.surface === "none"
              ? "Pelos arquivos e respostas, esta marca funciona melhor sem uma textura acrescentada."
              : surfaceName(direction.surface) + " sugerida a partir dos arquivos e respostas da marca."}
          </p>
          <ul className="direction-rationale">
            {direction.rationalePt.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
          <button type="button" disabled={disabled} onClick={onApplyDirection}>
            Aplicar esta sugestão
          </button>
        </>
      ) : (
        <p className="direction-summary">
          Ainda faltam dados para gerar uma sugestão.
        </p>
      )}

      <SurfaceBrowser
        brandIr={brandIr}
        surface={surface}
        disabled={disabled}
        onSurfaceChange={onSurfaceChange}
      />

      {surface ? (
        <details className="surface-controls">
          <summary>Ajustar {surfaceName(surface.kind)}</summary>
          <label>
            <span>Cor</span>
            <select
              name="surface-color"
              value={surface.colorToken}
              disabled={disabled}
              onChange={(event) => update({ colorToken: event.currentTarget.value })}
            >
              {Object.entries(brandIr.colors).map(([token, color]) => (
                <option key={token} value={token}>{color.value}</option>
              ))}
            </select>
          </label>
          <div className="inspector-grid inspector-grid-two">
            <label>
              <span>Transparência</span>
              <input
                name="surface-opacity"
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={surface.opacity}
                disabled={disabled}
                onChange={(event) => update({ opacity: Number(event.currentTarget.value) })}
              />
            </label>
            <label>
              <span>Tamanho</span>
              <input
                name="surface-scale"
                type="number"
                min="4"
                max="512"
                value={surface.scalePx}
                disabled={disabled}
                onChange={(event) => update({ scalePx: Number(event.currentTarget.value) })}
              />
            </label>
            <label>
              <span>Espessura</span>
              <input
                name="surface-weight"
                type="number"
                min="0.1"
                max="32"
                step="0.1"
                value={surface.weightPx}
                disabled={disabled}
                onChange={(event) => update({ weightPx: Number(event.currentTarget.value) })}
              />
            </label>
            <label>
              <span>Rotação</span>
              <input
                name="surface-angle"
                type="number"
                min="-180"
                max="180"
                value={surface.angleDeg}
                disabled={disabled}
                onChange={(event) => update({ angleDeg: Number(event.currentTarget.value) })}
              />
            </label>
          </div>
          <button
            className="inspector-reset"
            type="button"
            disabled={disabled}
            onClick={() => onSurfaceChange(null)}
          >
            Remover textura
          </button>
        </details>
      ) : null}
    </section>
  )
}
