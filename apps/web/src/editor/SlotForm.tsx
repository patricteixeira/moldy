import { useEffect, useRef, useState, type ChangeEvent, type JSX } from "react"
import { useApi } from "../api/context"
import { ApiError, contentAddressedPath } from "../api/client"
import type { LayoutSpec, SlotValue } from "../api/types"
import { exactOccurrenceCount } from "./emphasis"
import { slotLabel } from "./labels"

interface SlotFormProps {
  layout: LayoutSpec
  values: Record<string, SlotValue>
  onChange(slotId: string, value: SlotValue | null): void
  disabled?: boolean
  onUploadingChange?(uploading: boolean): void
}

type UploadState =
  | { phase: "idle" }
  | { phase: "uploading" }
  | { phase: "ready" }
  | { phase: "error"; message: string }

const IDLE_UPLOAD: UploadState = { phase: "idle" }

export function SlotForm({
  layout,
  values,
  onChange,
  disabled = false,
  onUploadingChange,
}: SlotFormProps): JSX.Element {
  const api = useApi()
  const mountedRef = useRef(true)
  const uploadGenerationRef = useRef<Record<string, number>>({})
  const activeUploadsRef = useRef(new Set<string>())
  const onUploadingChangeRef = useRef(onUploadingChange)
  const [uploadStates, setUploadStates] = useState<Record<string, UploadState>>({})

  useEffect(() => {
    onUploadingChangeRef.current = onUploadingChange
  }, [onUploadingChange])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      activeUploadsRef.current.clear()
      onUploadingChangeRef.current?.(false)
    }
  }, [])

  const reportUploading = (): void => {
    onUploadingChangeRef.current?.(activeUploadsRef.current.size > 0)
  }

  const handleImage = async (slotId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ""
    if (!file) return

    const generation = (uploadGenerationRef.current[slotId] ?? 0) + 1
    uploadGenerationRef.current[slotId] = generation
    activeUploadsRef.current.add(slotId)
    reportUploading()
    setUploadStates((current) => ({ ...current, [slotId]: { phase: "uploading" } }))

    try {
      const uploaded = await api.uploadAsset(file)
      if (!mountedRef.current || uploadGenerationRef.current[slotId] !== generation) return
      onChange(slotId, {
        kind: "image",
        path: contentAddressedPath(uploaded.sha256),
        sha256: uploaded.sha256,
      })
      setUploadStates((current) => ({ ...current, [slotId]: { phase: "ready" } }))
    } catch (error) {
      if (!mountedRef.current || uploadGenerationRef.current[slotId] !== generation) return
      const message =
        error instanceof ApiError ? error.messagePt : "Não foi possível enviar a foto."
      setUploadStates((current) => ({ ...current, [slotId]: { phase: "error", message } }))
    } finally {
      if (mountedRef.current && uploadGenerationRef.current[slotId] === generation) {
        activeUploadsRef.current.delete(slotId)
        reportUploading()
      }
    }
  }

  return (
    <form className="slot-form" onSubmit={(event) => event.preventDefault()}>
      <div className="slot-form-heading">
        <h2>Preencha a peça</h2>
        <p>Escreva e escolha imagens. A prova ao lado acompanha cada mudança.</p>
      </div>

      {layout.slots
        .filter((slot) => slot.kind !== "logo")
        .map((slot) => {
          const currentValue = values[slot.id]
          if (slot.kind === "text") {
            const text = currentValue?.kind === "text" ? currentValue.text : ""
            const emphasis = currentValue?.kind === "text" ? (currentValue.emphasis ?? "") : ""
            const isOver = slot.maxChars !== null && slot.maxChars !== undefined && text.length > slot.maxChars
            const label = `${slotLabel(slot.id)}${slot.required ? "" : " (opcional)"}`
            const allowsEmphasis = Boolean(slot.emphasisColorToken)
            const emphasisHintId = `slot-emphasis-hint-${slot.id}`
            const emphasisGuidanceId = `slot-emphasis-guidance-${slot.id}`
            const emphasisIsAmbiguous =
              emphasis.length > 0 && exactOccurrenceCount(text, emphasis) !== 1

            return (
              <div className="slot-field" key={slot.id}>
                <div className="slot-field-label">
                  <label htmlFor={`slot-input-${slot.id}`}>{label}</label>
                  {slot.maxChars !== null && slot.maxChars !== undefined ? (
                    <span
                      className="char-counter"
                      data-over={isOver ? "true" : undefined}
                      data-testid={`char-counter-${slot.id}`}
                      aria-live={isOver ? "polite" : undefined}
                    >
                      {text.length}/{slot.maxChars}
                    </span>
                  ) : null}
                </div>
                <textarea
                  id={`slot-input-${slot.id}`}
                  name={slot.id}
                  data-testid={`slot-input-${slot.id}`}
                  autoComplete="off"
                  disabled={disabled}
                  value={text}
                  onChange={(event) =>
                    onChange(
                      slot.id,
                      event.currentTarget.value === ""
                        ? null
                        : {
                            kind: "text",
                            text: event.currentTarget.value,
                            ...(emphasis ? { emphasis } : {}),
                          },
                    )
                  }
                />
                {allowsEmphasis ? (
                  <div className="slot-emphasis-field">
                    <label htmlFor={`slot-emphasis-input-${slot.id}`}>Trecho em destaque</label>
                    <p id={emphasisHintId} className="field-hint">
                      Copie exatamente uma parte da frase principal.
                    </p>
                    <input
                      id={`slot-emphasis-input-${slot.id}`}
                      name={`${slot.id}-emphasis`}
                      data-testid={`slot-emphasis-input-${slot.id}`}
                      type="text"
                      autoComplete="off"
                      aria-describedby={
                        emphasisIsAmbiguous
                          ? `${emphasisHintId} ${emphasisGuidanceId}`
                          : emphasisHintId
                      }
                      aria-invalid={emphasisIsAmbiguous || undefined}
                      aria-required="true"
                      required
                      disabled={disabled || text.length === 0}
                      value={emphasis}
                      onChange={(event) => {
                        const nextEmphasis = event.currentTarget.value
                        onChange(slot.id, {
                          kind: "text",
                          text,
                          ...(nextEmphasis ? { emphasis: nextEmphasis } : {}),
                        })
                      }}
                    />
                    {emphasisIsAmbiguous ? (
                      <p id={emphasisGuidanceId} className="field-guidance" aria-live="polite">
                        Use um trecho que apareça exatamente uma vez na frase principal.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          }

          const uploadState = uploadStates[slot.id] ?? IDLE_UPLOAD
          const uploading = uploadState.phase === "uploading"
          return (
            <div className="slot-field slot-image-field" key={slot.id}>
              <label htmlFor={`slot-image-input-${slot.id}`}>{slotLabel(slot.id)}</label>
              <input
                id={`slot-image-input-${slot.id}`}
                name={slot.id}
                data-testid={`slot-image-input-${slot.id}`}
                type="file"
                accept="image/png,image/jpeg"
                disabled={disabled || uploading}
                onChange={(event) => void handleImage(slot.id, event)}
              />
              {uploadState.phase === "uploading" ? <p role="status">Enviando foto…</p> : null}
              {uploadState.phase === "ready" ? <p role="status">Foto pronta.</p> : null}
              {uploadState.phase === "error" ? <p role="alert">{uploadState.message}</p> : null}
            </div>
          )
        })}
    </form>
  )
}
