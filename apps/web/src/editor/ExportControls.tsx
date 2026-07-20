import { useEffect, useMemo, useState } from "react"
import { useApi } from "../api/context"
import type {
  ExportFormat,
  GuardCheck,
  LayerOverride,
  LayoutSpec,
  ShapeLayer,
  Slot,
  SlotValue,
  SurfaceStyle,
} from "../api/types"
import { GuardPanel } from "./GuardPanel"
import { RoundtripPanel } from "./RoundtripPanel"
import { useExportFlow } from "./useExportFlow"

interface ExportControlsProps {
  disabled?: boolean
  layout: LayoutSpec
  pollIntervalMs: number
  revisionId: string
  values: Record<string, SlotValue>
  overrides: Record<string, LayerOverride>
  addedSlots?: Slot[]
  addedLayers?: ShapeLayer[]
  surface?: SurfaceStyle | null
  onPendingChange?(pending: boolean): void
}

function focusCheckField(check: GuardCheck) {
  if (!check.slotId) return

  const textTestId = `slot-input-${check.slotId}`
  const imageTestId = `slot-image-input-${check.slotId}`
  const field = [...document.querySelectorAll<HTMLElement>("[data-testid]")].find((element) => {
    const testId = element.dataset.testid
    return testId === textTestId || testId === imageTestId
  })
  field?.focus()
}

export function ExportControls({
  disabled = false,
  layout,
  pollIntervalMs,
  revisionId,
  values,
  overrides,
  addedSlots = [],
  addedLayers = [],
  surface = null,
  onPendingChange,
}: ExportControlsProps) {
  const client = useApi()
  const primaryFormat: ExportFormat = layout.profile === "doc-a4" ? "pdf" : "png"
  const editableFormat: ExportFormat = layout.profile === "doc-a4" ? "docx" : "pptx"
  const isDocument = layout.profile === "doc-a4"
  const content = useMemo(
    () => ({
      brandRevisionId: revisionId,
      layoutId: layout.id,
      values,
      overrides,
      surface,
      addedSlots,
      addedLayers,
    }),
    [addedLayers, addedSlots, layout.id, overrides, revisionId, surface, values],
  )
  const primaryFlow = useExportFlow(client, content, primaryFormat, pollIntervalMs)
  const editableFlow = useExportFlow(client, content, editableFormat, pollIntervalMs)
  const [activeFormat, setActiveFormat] = useState<ExportFormat>(primaryFormat)
  const [roundtripPending, setRoundtripPending] = useState(false)
  const activeFlow = activeFormat === editableFormat ? editableFlow : primaryFlow
  const pending = primaryFlow.pending || editableFlow.pending || roundtripPending

  useEffect(() => {
    onPendingChange?.(pending)
    return () => onPendingChange?.(false)
  }, [onPendingChange, pending])

  return (
    <div className="editor-export-controls" data-testid="editor-export-controls">
      <GuardPanel checks={activeFlow.checks} onAction={focusCheckField} />
      {activeFlow.error ? <p className="export-error" role="alert">{activeFlow.error}</p> : null}
      <div className="export-actions" role="group" aria-label="Formatos de exportação">
        <button
          className="export-option export-option-primary"
          type="button"
          data-testid={`exportar-${primaryFormat}`}
          disabled={disabled || pending}
          onClick={() => {
            setActiveFormat(primaryFormat)
            void primaryFlow.run()
          }}
        >
          <span className="export-option-kicker">Arquivo final</span>
          <span className="export-option-title">Exportar {primaryFormat.toUpperCase()}</span>
          <span className="export-option-description">
            {isDocument ? "Pronto para compartilhar" : "Pronto para publicar"}
          </span>
        </button>
        <button
          className="export-option export-option-editable"
          type="button"
          data-testid={`exportar-${editableFormat}`}
          disabled={disabled || pending}
          onClick={() => {
            setActiveFormat(editableFormat)
            void editableFlow.run()
          }}
        >
          <span className="export-option-kicker">Arquivo editável</span>
          <span className="export-option-title">Exportar {editableFormat.toUpperCase()}</span>
          <span className="export-option-description">
            {isDocument
              ? "Edite no Word ou Google Docs"
              : "Edite no PowerPoint ou Google Slides"}
          </span>
        </button>
      </div>
      {activeFlow.status ? (
        <p className="export-status" data-testid="export-status" role="status" aria-live="polite">
          {activeFlow.status}
        </p>
      ) : null}
      {activeFlow.download ? (
        <a
          className="download-link"
          data-testid="download-link"
          href={activeFlow.download.url}
          download={activeFlow.download.filename}
        >
          Baixar {activeFlow.download.format.toUpperCase()}
        </a>
      ) : null}
      {!isDocument &&
      activeFormat === "pptx" &&
      editableFlow.download?.format === "pptx" &&
      editableFlow.jobId ? (
        <RoundtripPanel
          key={editableFlow.jobId}
          exportJobId={editableFlow.jobId}
          pollIntervalMs={pollIntervalMs}
          disabled={disabled || primaryFlow.pending || editableFlow.pending}
          onPendingChange={setRoundtripPending}
        />
      ) : null}
    </div>
  )
}
