import { useEffect, useState } from "react"
import type { JSX } from "react"
import { Link, useParams } from "react-router-dom"
import { ApiError } from "../api/client"
import { useApi } from "../api/context"
import type { BrandIr, LayoutSpec } from "../api/types"
import { Preview } from "../render/Preview"
import { placeholderContent } from "./placeholder"

interface KitState {
  brandIr: BrandIr
  layouts: LayoutSpec[]
}

export function KitPage(): JSX.Element {
  const { revisionId } = useParams()
  const api = useApi()
  const [kit, setKit] = useState<KitState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setKit(null)
    setError(null)

    if (!revisionId) {
      setError("A revisão da marca não foi informada.")
      return () => {
        active = false
      }
    }

    void Promise.all([api.getBrandRevision(revisionId), api.getKit(revisionId)])
      .then(([brandIr, layouts]) => {
        if (active) setKit({ brandIr, layouts })
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(
          reason instanceof ApiError
            ? reason.messagePt
            : "Não foi possível carregar o kit da marca. Tente novamente.",
        )
      })

    return () => {
      active = false
    }
  }, [api, attempt, revisionId])

  if (error) {
    return (
      <main id="main-content" className="kit-page">
        <h1>Kit da marca</h1>
        <p role="alert">{error}</p>
        <button
          type="button"
          className="secondary-action"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Tentar novamente
        </button>
      </main>
    )
  }

  if (!kit || !revisionId) {
    return (
      <main id="main-content" className="kit-page">
        <p className="loading-note" role="status">
          Carregando o kit…
        </p>
      </main>
    )
  }

  if (kit.layouts.length === 0) {
    return (
      <main id="main-content" className="kit-page">
        <h1>Kit da marca</h1>
        <p role="alert">Este kit ainda não tem layouts disponíveis.</p>
        <button
          type="button"
          className="secondary-action"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Tentar novamente
        </button>
      </main>
    )
  }

  const assetsBaseUrl = api.revisionAssetsBaseUrl(revisionId)

  return (
    <main id="main-content" className="kit-page">
      <div className="kit-layout">
        <header className="kit-heading" data-motion-enter>
          <p className="product-kicker">Aplicações publicadas</p>
          <h1>Kit da marca</h1>
          <p className="kit-intro">
            Formatos prontos para receber conteúdo sem abandonar as decisões da identidade.
          </p>
          <p className="kit-count">{kit.layouts.length} formatos disponíveis</p>
          <Link className="text-action" to="/">
            Instalar outra marca
          </Link>
        </header>

        <div
          className="kit-grid"
          data-layout-count={kit.layouts.length}
          aria-label="Layouts disponíveis"
        >
          {kit.layouts.map((layout) => (
            <Link
              key={layout.id}
              className="kit-card"
              to={`/marcas/${encodeURIComponent(revisionId)}/editor/${encodeURIComponent(layout.id)}`}
              data-layout-id={layout.id}
              data-testid="kit-card"
              aria-label={`Abrir ${layout.namePt}`}
            >
              <span className="kit-proof">
                <Preview
                  brandIr={kit.brandIr}
                  layoutSpec={layout}
                  contentSpec={placeholderContent(layout, revisionId)}
                  assetsBaseUrl={assetsBaseUrl}
                  maxWidthPx={360}
                />
              </span>
              <span className="kit-card-caption">
                <span>{layout.namePt}</span>
                <span className="kit-card-meta">
                  {layout.canvas.widthPx} × {layout.canvas.heightPx} px
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  )
}
