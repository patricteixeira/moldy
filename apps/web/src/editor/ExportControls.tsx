import { useEffect, useMemo } from "react"
import { useApi } from "../api/context"
import type { GuardCheck, LayoutSpec, SlotValue } from "../api/types"
import { GuardPanel } from "./GuardPanel"
import { useExportFlow } from "./useExportFlow"

interface ExportControlsProps {
  disabled?: boolean
  layout: LayoutSpec
  pollIntervalMs: number
  revisionId: string
  values: Record<string, SlotValue>
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
  onPendingChange,
}: ExportControlsProps) {
  const client = useApi()
  const format = layout.profile === "doc-a4" ? "pdf" : "png"
  const content = useMemo(
    () => ({ brandRevisionId: revisionId, layoutId: layout.id, values }),
    [layout.id, revisionId, values],
  )
  const flow = useExportFlow(client, content, format, pollIntervalMs)
  const testId = format === "pdf" ? "exportar-pdf" : "exportar-png"

  useEffect(() => {
    onPendingChange?.(flow.pending)
    return () => onPendingChange?.(false)
  }, [flow.pending, onPendingChange])

  return (
    <div className="editor-export-controls" data-testid="editor-export-controls">
      <GuardPanel checks={flow.checks} onAction={focusCheckField} />
      {flow.error ? <p className="export-error" role="alert">{flow.error}</p> : null}
      <button
        type="button"
        data-testid={testId}
        disabled={disabled || flow.pending}
        onClick={() => void flow.run()}
      >
        Exportar {format.toUpperCase()}
      </button>
      {flow.status ? (
        <p className="export-status" data-testid="export-status" role="status" aria-live="polite">
          {flow.status}
        </p>
      ) : null}
      {flow.download ? (
        <a className="download-link" data-testid="download-link" href={flow.download.url} download>
          Baixar arquivo
        </a>
      ) : null}
    </div>
  )
}
