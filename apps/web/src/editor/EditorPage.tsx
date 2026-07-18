import { useEffect, useMemo, useState, type JSX } from "react"
import { Link, useParams } from "react-router-dom"
import { ApiError } from "../api/client"
import { useApi } from "../api/context"
import type { BrandIr, ContentSpec, LayoutSpec, SlotValue } from "../api/types"
import { Preview } from "../render/Preview"
import { ExportControls } from "./ExportControls"
import { SlotForm } from "./SlotForm"
import { clearEditorDraft, loadEditorDraft, saveEditorDraft } from "./draftStorage"
import { exactOccurrenceCount } from "./emphasis"

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
  const [draftReady, setDraftReady] = useState(false)
  const [draftSaved, setDraftSaved] = useState(true)

  useEffect(() => {
    let active = true
    setData(null)
    setError(null)
    setValues({})
    setUploading(false)
    setExporting(false)
    setDraftReady(false)
    setDraftSaved(true)

    if (!revisionId) {
      setError("Revisão de marca não encontrada.")
      return () => {
        active = false
      }
    }

    void Promise.all([api.getBrandRevision(revisionId), api.getKit(revisionId)])
      .then(([brandIr, layouts]) => {
        if (!active) return
        const activeLayout = layouts.find((candidate) => candidate.id === layoutId)
        setData({ brandIr, layouts })
        setValues(activeLayout ? loadEditorDraft(revisionId, activeLayout) : {})
        setDraftReady(true)
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
  }, [api, layoutId, revisionId])

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

  const previewContentSpec = useMemo<ContentSpec | null>(() => {
    if (!contentSpec) return null
    const previewValues = Object.fromEntries(
      Object.entries(contentSpec.values).map(([slotId, value]) => {
        if (
          value.kind !== "text" ||
          !value.emphasis ||
          exactOccurrenceCount(value.text, value.emphasis) === 1
        ) {
          return [slotId, value]
        }
        return [slotId, { ...value, emphasis: undefined }]
      }),
    )
    return { ...contentSpec, values: previewValues }
  }, [contentSpec])

  useEffect(() => {
    if (!draftReady || !revisionId || !layout) return
    setDraftSaved(saveEditorDraft(revisionId, layout.id, values))
  }, [draftReady, layout, revisionId, values])

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

  if (!layout || !contentSpec || !previewContentSpec || !revisionId) {
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

  const clearDraft = (): void => {
    setValues({})
    setDraftSaved(clearEditorDraft(revisionId, layout.id))
  }

  return (
    <main id="main-content" className="editor-page">
      <header className="editor-heading" data-motion-enter>
        <Link className="editor-back" to={`/marcas/${encodeURIComponent(revisionId)}/kit`}>
          Voltar ao kit
        </Link>
        <div>
          <p className="product-kicker">Mesa de prova</p>
          <h1>{layout.namePt}</h1>
        </div>
        <p className="editor-intro">
          Escreva, veja a composição responder e exporte quando tudo estiver no lugar.
        </p>
      </header>

      <div className="editor-draft-bar" data-motion-enter>
        <p role="status" aria-live="polite">
          {draftSaved
            ? Object.keys(values).length > 0
              ? "Rascunho salvo neste navegador."
              : "Comece a editar: suas alterações serão salvas automaticamente."
            : "Não foi possível salvar o rascunho neste navegador."}
        </p>
        {Object.keys(values).length > 0 ? (
          <button type="button" className="secondary-action" onClick={clearDraft}>
            Limpar alterações
          </button>
        ) : null}
      </div>

      <div className="editor-workbench" data-motion-enter>
        <section className="editor-preview" aria-label="Prova da peça">
          <h2 className="preview-heading">Prévia ao vivo</h2>
          <Preview
            brandIr={data.brandIr}
            layoutSpec={layout}
            contentSpec={previewContentSpec}
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
