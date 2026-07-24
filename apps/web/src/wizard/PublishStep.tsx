import { type FormEvent, useEffect, useRef, useState } from "react"
import { useApi } from "../api/context"

interface Props {
  draftId: string
  answers: Record<string, unknown>
  onPublished(brandRevisionId: string): void
  onBack(): void
}

export function PublishStep({ draftId, answers, onPublished, onBack }: Props) {
  const api = useApi()
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  useEffect(() => () => {
    generation.current += 1
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const brandName = name.trim()
    if (!brandName || busy) return
    setBusy(true)
    setError(null)
    const current = ++generation.current
    try {
      const result = await api.compileDraft(draftId, answers, brandName)
      if (generation.current === current) onPublished(result.brandRevisionId)
    } catch (cause) {
      if (generation.current !== current) return
      setError(
        typeof cause === "object" && cause !== null && "messagePt" in cause
          ? String(cause.messagePt)
          : "Não foi possível salvar a marca.",
      )
    } finally {
      if (generation.current === current) setBusy(false)
    }
  }

  return (
    <form className="publish-step" onSubmit={submit}>
      <p className="wizard-progress">Última etapa</p>
      <h2>Digite o nome da marca.</h2>
      <label htmlFor="brand-name">Nome da marca</label>
      <input
        id="brand-name"
        name="brand-name"
        data-testid="wizard-brand-name"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        autoComplete="organization"
        disabled={busy}
      />
      {error && <p role="alert">{error}</p>}
      <div className="action-row">
        <button
          data-testid="wizard-voltar"
          className="secondary-action"
          type="button"
          disabled={busy}
          onClick={onBack}
        >
          Voltar
        </button>
        <button data-testid="wizard-publicar" type="submit" disabled={!name.trim() || busy}>
          {busy ? "Salvando…" : "Salvar marca"}
        </button>
      </div>
    </form>
  )
}
