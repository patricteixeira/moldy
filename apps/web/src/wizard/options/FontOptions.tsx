import { useEffect } from "react"
import { useApi } from "../../api/context"
import type { Candidate } from "../../api/types"

interface Props {
  draftId: string
  candidates: Candidate[]
  selected: unknown
  onSelect(value: unknown): void
}

interface FontCandidate {
  family: string
  weight?: number
  style?: string
  path?: string
}

export function FontOptions({ draftId, candidates, selected, onSelect }: Props) {
  const api = useApi()
  useEffect(() => {
    if (typeof FontFace === "undefined" || !("fonts" in document)) return
    let disposed = false
    const loaded: FontFace[] = []
    candidates.forEach((candidate, index) => {
      const font = candidate.value as FontCandidate
      if (typeof font?.path !== "string" || typeof font.family !== "string") return
      const internalFamily = `br-preview-${index}-${font.family.replace(/[^a-z\d]+/gi, "-")}`
      const face = new FontFace(
        internalFamily,
        `url("${api.draftAssetUrl(draftId, font.path)}")`,
        { weight: String(font.weight ?? 400), style: font.style ?? "normal" },
      )
      void face
        .load()
        .then((ready) => {
          if (disposed) return
          document.fonts.add(ready)
          loaded.push(ready)
        })
        .catch(() => undefined)
    })
    return () => {
      disposed = true
      loaded.forEach((face) => document.fonts.delete(face))
    }
  }, [api, candidates, draftId])

  return (
    <div className="font-options" role="group" aria-label="Fontes propostas">
      {candidates.map((candidate, index) => {
        const font = candidate.value as FontCandidate
        const family = font.family || `Fonte ${index + 1}`
        const internalFamily = `br-preview-${index}-${family.replace(/[^a-z\d]+/gi, "-")}`
        return (
          <button
            key={`${family}-${font.weight ?? 400}-${index}`}
            type="button"
            className="font-option"
            data-testid="candidate-option"
            data-value={family}
            aria-pressed={selected === candidate.value}
            onClick={() => onSelect(candidate.value)}
          >
            <span
              data-testid="font-sample"
              className="font-sample"
              style={{
                fontFamily: `"${internalFamily}", "${family}", sans-serif`,
                fontWeight: font.weight ?? 400,
                fontStyle: font.style ?? "normal",
              }}
            >
              Aa Bb Cc
              <small>A tipografia da sua marca</small>
            </span>
            <span className="font-name">{family}</span>
            <span className="font-source">
              {font.path
                ? "Arquivo da fonte incluído"
                : "Família citada no manual · prévia aproximada"}
            </span>
          </button>
        )
      })}
    </div>
  )
}
