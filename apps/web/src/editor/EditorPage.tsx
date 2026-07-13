import { useEffect, useMemo, useState, type JSX } from "react"
import { Link, useParams } from "react-router-dom"
import { ApiError } from "../api/client"
import { useApi } from "../api/context"
import type { BrandIr, ContentSpec, LayoutSpec, SlotValue } from "../api/types"
import { Preview } from "../render/Preview"
import { ExportControls } from "./ExportControls"
import { SlotForm } from "./SlotForm"

interface EditorPageProps {
  pollIntervalMs?: number
}

interface EditorData {
  brandIr: BrandIr
  layouts: LayoutSpec[]
}

export function EditorPage({ pollIntervalMs = 1000 }: EditorPageProps): JSX.Element {
  const api = useApi()
  const { revisionId, layoutId } = useParams()
  const [data, setData] = useState<EditorData | null>(null)
  const [values, setValues] = useState<Record<string, SlotValue>>({})
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let active = true
    setData(null)
    setError(null)
    setValues({})
    setUploading(false)
    setExporting(false)

    if (!revisionId) {
      setError("Revisão de marca não encontrada.")
      return () => {
        active = false
      }
    }

    void Promise.all([api.getBrandRevision(revisionId), api.getKit(revisionId)])
      .then(([brandIr, layouts]) => {
        if (active) setData({ brandIr, layouts })
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(
          caught instanceof ApiError
            ? caught.messagePt
            : "Não foi possível abrir o editor.",
        )
      })

    return () => {
      active = false
    }
  }, [api, revisionId])

  const layout = useMemo(
    () => data?.layouts.find((candidate) => candidate.id === layoutId) ?? null,
    [data, layoutId],
  )

  const contentSpec = useMemo<ContentSpec | null>(
    () =>
      revisionId && layout
        ? { layoutId: layout.id, brandRevisionId: revisionId, values }
        : null,
    [layout, revisionId, values],
  )

  if (error) {
    return (
      <main id="main-content" className="editor-page">
        <p role="alert">{error}</p>
      </main>
    )
  }

  if (!data) {
    return (
      <main id="main-content" className="editor-page">
        <p className="loading-note" role="status">Abrindo a mesa de prova…</p>
      </main>
    )
  }

  if (!layout || !contentSpec || !revisionId) {
    return (
      <main id="main-content" className="editor-page">
        <p role="alert">Layout não encontrado neste kit.</p>
      </main>
    )
  }

  const changeValue = (slotId: string, value: SlotValue | null): void => {
    setValues((current) => {
      if (value === null) {
        const { [slotId]: _removed, ...remaining } = current
        return remaining
      }
      return { ...current, [slotId]: value }
    })
  }

  return (
    <main id="main-content" className="editor-page">
      <header className="editor-heading">
        <Link to={`/marcas/${encodeURIComponent(revisionId)}/kit`}>← Voltar ao kit</Link>
        <p className="eyebrow">Mesa de prova</p>
        <h1>{layout.namePt}</h1>
      </header>

      <div className="editor-workbench">
        <section className="editor-preview" aria-label="Prova da peça">
          <p className="eyebrow">Prova ao vivo</p>
          <Preview
            brandIr={data.brandIr}
            layoutSpec={layout}
            contentSpec={contentSpec}
            assetsBaseUrl={api.revisionAssetsBaseUrl(revisionId)}
            maxWidthPx={480}
          />
        </section>

        <SlotForm
          layout={layout}
          values={values}
          onChange={changeValue}
          onUploadingChange={setUploading}
          disabled={exporting}
        />
      </div>

      <div className="editor-guard-export" data-testid="editor-guard-export">
        <ExportControls
          disabled={uploading}
          layout={layout}
          pollIntervalMs={pollIntervalMs}
          revisionId={revisionId}
          values={values}
          onPendingChange={setExporting}
        />
      </div>
    </main>
  )
}
