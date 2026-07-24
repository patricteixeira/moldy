import { surfacePaint } from "@brand-runtime/render"
import { useMemo, useState, type CSSProperties } from "react"
import type { BrandIr, SurfaceKind, SurfaceStyle } from "../api/types"
import {
  recommendationReason,
  recommendedSurfaces,
  SURFACE_CATALOG,
  SURFACE_FAMILIES,
  surfaceForBrand,
  type SurfaceDefinition,
  type SurfaceFamily,
} from "./surfaceCatalog"

interface Props {
  brandIr: BrandIr
  surface: SurfaceStyle | null
  disabled?: boolean
  onSurfaceChange(surface: SurfaceStyle | null): void
}

type SurfaceFilter = "all" | SurfaceFamily

function previewStyle(item: SurfaceDefinition, brandIr: BrandIr): CSSProperties {
  const colorToken = brandIr.colors["color.primary"]
    ? "color.primary"
    : Object.keys(brandIr.colors)[0]
  const color = colorToken ? brandIr.colors[colorToken]?.value : "#111111"
  return {
    ...surfacePaint(
      item.kind,
      color ?? "#111111",
      item.defaults.scalePx,
      item.defaults.weightPx,
      item.defaults.angleDeg,
    ),
  }
}

function SurfaceOption({
  item,
  brandIr,
  selected,
  recommended,
  disabled,
  onChoose,
}: {
  item: SurfaceDefinition
  brandIr: BrandIr
  selected: boolean
  recommended: boolean
  disabled: boolean
  onChoose(kind: SurfaceKind): void
}) {
  return (
    <button
      type="button"
      className="surface-option"
      data-testid="surface-option"
      data-surface-kind={item.kind}
      data-recommended={recommended || undefined}
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onChoose(item.kind)}
    >
      <span className="surface-option-preview" style={previewStyle(item, brandIr)} aria-hidden="true" />
      <span className="surface-option-copy">
        <strong>{item.name}</strong>
        <small>{recommended ? recommendationReason(item, brandIr) : item.description}</small>
      </span>
      <span className="surface-option-state" aria-hidden="true">
        {selected ? "em uso" : "+"}
      </span>
    </button>
  )
}

export function SurfaceBrowser({ brandIr, surface, disabled = false, onSurfaceChange }: Props) {
  const recommendations = useMemo(() => recommendedSurfaces(brandIr), [brandIr])
  const recommendsCleanBackground = brandIr.creativeDirection?.surface === "none"
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [filter, setFilter] = useState<SurfaceFilter>("all")
  const visibleCatalog = useMemo(
    () =>
      filter === "all"
        ? SURFACE_CATALOG
        : SURFACE_CATALOG.filter((item) => item.family === filter),
    [filter],
  )
  const choose = (kind: SurfaceKind) => {
    const item = SURFACE_CATALOG.find((candidate) => candidate.kind === kind)
    if (!item) return
    const next = surfaceForBrand(item, brandIr)
    if (next) onSurfaceChange(next)
  }

  return (
    <section className="surface-browser" aria-labelledby="surface-browser-title">
      <div className="surface-browser-heading">
        <div>
          <p className="panel-kicker">Texturas</p>
          <h4 id="surface-browser-title">
            {recommendsCleanBackground
              ? "Se quiser usar uma textura"
              : recommendations.length > 0
                ? "Para esta marca"
                : "Escolha livremente"}
          </h4>
        </div>
        <span>{SURFACE_CATALOG.length} opções</span>
      </div>
      <p className="surface-browser-intro">
        {recommendsCleanBackground
          ? "Os arquivos da marca indicam um fundo sem textura. Você ainda pode escolher uma opção abaixo."
          : recommendations.length > 0
            ? "Estas opções correspondem melhor às cores e formas encontradas nos arquivos. Todas as outras continuam disponíveis."
          : "Ainda não há informação suficiente para recomendar uma textura. Todas continuam disponíveis."}
      </p>

      {recommendations.length > 0 ? (
        <div className="surface-recommendations" aria-label="Texturas sugeridas para esta marca">
          {recommendations.map((item) => (
            <SurfaceOption
              key={item.kind}
              item={item}
              brandIr={brandIr}
              selected={surface?.kind === item.kind}
              recommended
              disabled={disabled}
              onChoose={choose}
            />
          ))}
        </div>
      ) : null}

      <button
        type="button"
        className="surface-catalog-toggle"
        aria-expanded={catalogOpen}
        aria-controls="surface-catalog"
        onClick={() => setCatalogOpen((current) => !current)}
      >
        {catalogOpen ? "Fechar todas as texturas" : `Ver todas as ${SURFACE_CATALOG.length} texturas`}
      </button>

      {catalogOpen ? (
        <div id="surface-catalog" className="surface-catalog">
          <div className="surface-filters" role="group" aria-label="Filtrar texturas">
            <button
              type="button"
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              Todas
            </button>
            {SURFACE_FAMILIES.map((family) => (
              <button
                key={family.id}
                type="button"
                aria-pressed={filter === family.id}
                onClick={() => setFilter(family.id)}
              >
                {family.name}
              </button>
            ))}
          </div>
          <p className="surface-result-count" role="status">
            {visibleCatalog.length} {visibleCatalog.length === 1 ? "textura" : "texturas"}
          </p>
          <div className="surface-catalog-grid" aria-label="Todas as texturas">
            {visibleCatalog.map((item) => (
              <SurfaceOption
                key={item.kind}
                item={item}
                brandIr={brandIr}
                selected={surface?.kind === item.kind}
                recommended={recommendations.some((candidate) => candidate.kind === item.kind)}
                disabled={disabled}
                onChoose={choose}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}
