import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { useApi } from "../../api/context"
import type { Candidate, FontResource, FontResolutionStatus } from "../../api/types"

interface Props {
  draftId: string
  questionId: "font.heading" | "font.body"
  candidates: Candidate[]
  selected: unknown
  onSelect(value: unknown): void
}

interface FontCandidate {
  family: string
  weight?: number
  style?: string
  path?: string
  resource?: FontResource
}

type FontLoadStatus = "idle" | "loading" | "ready" | "failed"

const FONTSHARE_LICENSE_URL = "https://www.fontshare.com/licenses/itf-ffl"

function fontFaceWeight(font: FontCandidate): string {
  const axis = font.resource?.axes.find((item) => item.tag === "wght")
  return axis ? `${axis.minimum} ${axis.maximum}` : String(font.weight ?? 400)
}

function fontVariantIdentity(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null
  const font = value as FontCandidate
  if (typeof font.family !== "string" || !font.family.trim()) return null
  return [
    font.family.trim().toLocaleLowerCase("pt-BR"),
    font.weight ?? 400,
    font.style ?? "normal",
  ].join("|")
}

function fontSourceIdentity(value: unknown): string | null {
  const variant = fontVariantIdentity(value)
  if (variant === null) return null
  const font = value as FontCandidate
  return [
    variant,
    font.path ?? "",
    font.resource?.provider ?? "",
    font.resource?.upstreamRef ?? "",
  ].join("|")
}

function hasResolvedSource(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false
  const font = value as FontCandidate
  return Boolean(font.path || font.resource?.provider)
}

function candidateKey(candidate: Candidate, index: number): string {
  const font = candidate.value as FontCandidate
  return [
    fontSourceIdentity(font) ?? "fonte",
    font.path ?? "",
    font.resource?.provider ?? "",
    font.resource?.upstreamRef ?? "",
    index,
  ].join("|")
}

function isFontshare(font: FontCandidate): boolean {
  return font.resource?.provider === "fontshare-external"
}

export function safeFontshareStylesheetUrl(font: FontCandidate): string | null {
  if (!isFontshare(font) || typeof font.resource?.upstreamRef !== "string") return null
  try {
    const url = new URL(font.resource.upstreamRef)
    const keys = [...url.searchParams.keys()]
    const familyRequests = url.searchParams.getAll("f[]")
    const displayRequests = url.searchParams.getAll("display")
    if (
      url.protocol !== "https:" ||
      url.hostname !== "api.fontshare.com" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      url.pathname !== "/v2/css" ||
      keys.length !== 2 ||
      keys.some((key) => key !== "f[]" && key !== "display") ||
      familyRequests.length !== 1 ||
      displayRequests.length !== 1 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*@[1-9]\d{0,2}$/.test(familyRequests[0]) ||
      displayRequests[0] !== "swap"
    ) {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

function loadSpec(font: FontCandidate): string {
  const style = font.style === "italic" ? "italic " : ""
  return `${style}${font.weight ?? 400} 16px "${font.family.replaceAll('"', "")}"`
}

function sourceLabel(
  candidate: Candidate,
  font: FontCandidate,
  localStatus: FontLoadStatus,
  externalStatus: FontLoadStatus,
): string {
  if (font.resource?.provider === "google-fonts" && font.path) {
    if (localStatus === "ready") return "Fonte pronta para usar · Google Fonts"
    if (localStatus === "failed") return "Fonte adicionada, mas não conseguimos mostrá-la agora"
    return "Carregando a fonte · Google Fonts"
  }
  if (font.path) {
    if (localStatus === "ready") return "Fonte pronta para usar · arquivo enviado"
    if (localStatus === "failed") return "Arquivo recebido, mas não conseguimos mostrar a fonte agora"
    return "Carregando o arquivo da fonte"
  }
  if (isFontshare(font)) {
    if (externalStatus === "ready") return "Fonte pronta para mostrar · Fontshare"
    if (externalStatus === "loading") return "Carregando a fonte · Fontshare"
    if (externalStatus === "failed") return "Não foi possível mostrar a fonte do Fontshare agora"
    return "A fonte pode ser mostrada pelo site Fontshare"
  }
  if (candidate.evidence.some((item) => item.sourceType === "manual-entry")) {
    return "Nome informado por você · o arquivo da fonte ainda não foi enviado"
  }
  return "Fonte encontrada no manual · amostra aproximada"
}

function resolutionMessage(status: FontResolutionStatus): string {
  if (status === "local-ready") return "Fonte encontrada e adicionada à marca."
  if (status === "vendor-hosted") {
    return "Fonte encontrada no Fontshare. Marque a opção abaixo para vê-la como ela realmente é."
  }
  if (status === "failed") {
    return "O nome foi salvo, mas o site da fonte não respondeu. Você ainda pode continuar com esta escolha."
  }
  if (status === "capacity-reached") {
    return "O nome foi salvo. Esta marca já tem quatro arquivos de fonte adicionados."
  }
  return "O nome foi salvo. Não encontramos um arquivo que pudesse ser carregado automaticamente."
}

export function FontOptions({ draftId, questionId, candidates, selected, onSelect }: Props) {
  const api = useApi()
  const [family, setFamily] = useState("")
  const [resolving, setResolving] = useState(false)
  const [resolutionNote, setResolutionNote] = useState<string | null>(null)
  const [resolutionError, setResolutionError] = useState<string | null>(null)
  const [fontshareEnabled, setFontshareEnabled] = useState(false)
  const [localStatuses, setLocalStatuses] = useState<Record<string, FontLoadStatus>>({})
  const [externalStatuses, setExternalStatuses] = useState<Record<string, FontLoadStatus>>({})
  const requestSequence = useRef(0)
  const consentDescriptionId = `fontshare-consent-${questionId}`
  const selectedVariantIdentity = fontVariantIdentity(selected)
  const selectedSourceIdentity = fontSourceIdentity(selected)

  useEffect(
    () => () => {
      requestSequence.current += 1
    },
    [],
  )

  const displayCandidates = useMemo(() => {
    if (selectedSourceIdentity === null || selectedVariantIdentity === null) return candidates
    const exactIndex = candidates.findIndex(
      (candidate) => fontSourceIdentity(candidate.value) === selectedSourceIdentity,
    )
    if (exactIndex >= 0) {
      return candidates.map((candidate, index) =>
        index === exactIndex ? { ...candidate, value: selected } : candidate,
      )
    }
    const unresolvedIndex = candidates.findIndex(
      (candidate) =>
        fontVariantIdentity(candidate.value) === selectedVariantIdentity &&
        !hasResolvedSource(candidate.value),
    )
    if (unresolvedIndex >= 0 && hasResolvedSource(selected)) {
      return candidates.map((candidate, index) =>
        index === unresolvedIndex ? { ...candidate, value: selected } : candidate,
      )
    }
    return [
      {
        value: selected,
        score: 1,
        evidence: [
          {
            sourceType: "manual-entry",
            confidence: 1,
            authoritative: false,
          },
        ],
      },
      ...candidates,
    ]
  }, [candidates, selected, selectedSourceIdentity, selectedVariantIdentity])

  const selectedDisplayIndex = useMemo(
    () =>
      selectedSourceIdentity === null
        ? -1
        : displayCandidates.findIndex(
            (candidate) => fontSourceIdentity(candidate.value) === selectedSourceIdentity,
          ),
    [displayCandidates, selectedSourceIdentity],
  )

  useEffect(() => {
    const entries = displayCandidates.flatMap((candidate, index) => {
      const font = candidate.value as FontCandidate
      return typeof font?.path === "string" && typeof font.family === "string"
        ? [{ candidate, font, index, key: candidateKey(candidate, index) }]
        : []
    })
    if (entries.length === 0) return
    if (typeof FontFace === "undefined" || !("fonts" in document)) {
      setLocalStatuses((current) => ({
        ...current,
        ...Object.fromEntries(entries.map(({ key }) => [key, "failed" as const])),
      }))
      return
    }
    let disposed = false
    const loaded: FontFace[] = []
    entries.forEach(({ font, index, key }) => {
      setLocalStatuses((current) => ({ ...current, [key]: "loading" }))
      const internalFamily = `br-preview-${index}-${font.family.replace(/[^a-z\d]+/gi, "-")}`
      let face: FontFace
      try {
        face = new FontFace(
          internalFamily,
          `url("${api.draftAssetUrl(draftId, font.path!)}")`,
          { weight: fontFaceWeight(font), style: font.style ?? "normal" },
        )
      } catch {
        setLocalStatuses((current) => ({ ...current, [key]: "failed" }))
        return
      }
      void face
        .load()
        .then((ready) => {
          if (disposed) return
          document.fonts.add(ready)
          loaded.push(ready)
          setLocalStatuses((current) => ({ ...current, [key]: "ready" }))
        })
        .catch(() => {
          if (!disposed) setLocalStatuses((current) => ({ ...current, [key]: "failed" }))
        })
    })
    return () => {
      disposed = true
      loaded.forEach((face) => document.fonts.delete(face))
    }
  }, [api, displayCandidates, draftId])

  useEffect(() => {
    if (!fontshareEnabled) return
    const entries = displayCandidates.flatMap((candidate, index) => {
      const font = candidate.value as FontCandidate
      const url = safeFontshareStylesheetUrl(font)
      const isSelected = fontSourceIdentity(candidate.value) === selectedSourceIdentity
      return url && isSelected
        ? [{ candidate, font, index, key: candidateKey(candidate, index), url }]
        : []
    })
    if (entries.length === 0) return
    if (!("fonts" in document)) {
      setExternalStatuses((current) => ({
        ...current,
        ...Object.fromEntries(entries.map(({ key }) => [key, "failed" as const])),
      }))
      return
    }
    const fontSet = document.fonts

    let disposed = false
    const links: HTMLLinkElement[] = []
    entries.forEach(({ font, key, url }) => {
      setExternalStatuses((current) => ({ ...current, [key]: "loading" }))
      const link = document.createElement("link")
      link.rel = "stylesheet"
      link.href = url
      link.referrerPolicy = "no-referrer"
      link.dataset.fontProvider = "fontshare"
      link.onload = () => {
        void fontSet
          .load(loadSpec(font), "A tipografia da sua marca")
          .then((faces) => {
            if (disposed) return
            const ready =
              faces.length > 0 &&
              faces.every((face) => face.status === "loaded") &&
              fontSet.check(loadSpec(font), "A tipografia da sua marca")
            setExternalStatuses((current) => ({
              ...current,
              [key]: ready ? "ready" : "failed",
            }))
          })
          .catch(() => {
            if (!disposed) {
              setExternalStatuses((current) => ({ ...current, [key]: "failed" }))
            }
          })
      }
      link.onerror = () => {
        if (!disposed) setExternalStatuses((current) => ({ ...current, [key]: "failed" }))
      }
      document.head.append(link)
      links.push(link)
    })

    return () => {
      disposed = true
      links.forEach((link) => link.remove())
    }
  }, [displayCandidates, fontshareEnabled, selectedSourceIdentity])

  const hasFontshare = displayCandidates.some((candidate) =>
    Boolean(safeFontshareStylesheetUrl(candidate.value as FontCandidate)),
  )

  async function submitManualFont(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const requestedFamily = family.trim().replace(/\s+/g, " ")
    if (!requestedFamily || resolving) return
    setResolving(true)
    setResolutionError(null)
    setResolutionNote(null)
    const requestId = ++requestSequence.current
    try {
      const result = await api.resolveDraftFont(draftId, questionId, requestedFamily)
      if (requestId !== requestSequence.current) return
      onSelect(result.candidate.value)
      const resolvedFont = result.candidate.value as FontCandidate
      setFamily(resolvedFont.family ?? requestedFamily)
      setResolutionNote(resolutionMessage(result.status))
    } catch (error) {
      if (requestId !== requestSequence.current) return
      setResolutionError(
        error instanceof Error ? error.message : "Não foi possível verificar esta fonte.",
      )
    } finally {
      if (requestId === requestSequence.current) setResolving(false)
    }
  }

  return (
    <div className="font-choice">
      <form className="manual-font" aria-busy={resolving} onSubmit={submitManualFont}>
        <label htmlFor={`manual-font-${questionId}`}>Ou digite o nome da fonte</label>
        <div className="manual-font-row">
          <input
            id={`manual-font-${questionId}`}
            name="font-family"
            type="text"
            value={family}
            disabled={resolving}
            maxLength={128}
            autoComplete="off"
            placeholder="Ex.: General Sans"
            onChange={(event) => setFamily(event.target.value)}
          />
          <button type="submit" disabled={!family.trim() || resolving}>
            {resolving ? "Procurando a fonte…" : "Usar o nome digitado"}
          </button>
        </div>
        {resolutionNote && <p className="option-note" role="status">{resolutionNote}</p>}
        {resolutionError && <p className="option-error" role="alert">{resolutionError}</p>}
      </form>

      {hasFontshare && (
        <div className="external-font-consent">
          <label>
            <input
              name={`fontshare-consent-${questionId}`}
              type="checkbox"
              checked={fontshareEnabled}
              aria-describedby={consentDescriptionId}
              onChange={(event) => {
                const enabled = event.target.checked
                setFontshareEnabled(enabled)
                if (!enabled) setExternalStatuses({})
              }}
            />
            Mostrar esta fonte como ela realmente é usando o site Fontshare
          </label>
          <p id={consentDescriptionId}>
            Para mostrar a fonte, seu navegador se conecta ao Fontshare. O site recebe dados
            básicos da conexão, como IP e navegador. Nenhum arquivo da marca é enviado. A fonte
            aparece somente nesta tela e não entra nos arquivos exportados. Consulte a{" "}
            <a href={FONTSHARE_LICENSE_URL} target="_blank" rel="noreferrer">
              licença ITF FFL 1.0
            </a>.
          </p>
        </div>
      )}

      {displayCandidates.length > 0 && (
        <div className="font-options" role="group" aria-label="Fontes encontradas">
          {displayCandidates.map((candidate, index) => {
            const font = candidate.value as FontCandidate
            const familyName = font.family || `Fonte ${index + 1}`
            const internalFamily = `br-preview-${index}-${familyName.replace(/[^a-z\d]+/gi, "-")}`
            const key = candidateKey(candidate, index)
            const localStatus = localStatuses[key] ?? "idle"
            const externalStatus =
              fontshareEnabled && index === selectedDisplayIndex
                ? (externalStatuses[key] ?? "idle")
                : "idle"
            const exactLocal = Boolean(font.path) && localStatus === "ready"
            const exactExternal = isFontshare(font) && externalStatus === "ready"
            const previewFamily = exactLocal
              ? `"${internalFamily}", sans-serif`
              : exactExternal
                ? `"${familyName}", sans-serif`
                : "sans-serif"
            return (
              <button
                key={key}
                type="button"
                className="font-option"
                data-testid="candidate-option"
                data-value={familyName}
                aria-pressed={index === selectedDisplayIndex}
                disabled={resolving}
                onClick={() => onSelect(candidate.value)}
              >
                <span
                  data-testid="font-sample"
                  className="font-sample"
                  style={{
                    fontFamily: previewFamily,
                    fontWeight: font.weight ?? 400,
                    fontStyle: font.style ?? "normal",
                  }}
                >
                  Aa Bb Cc
                  <small>A fonte da sua marca</small>
                </span>
                <span className="font-name">{familyName}</span>
                <span className="font-source" role="status" aria-live="polite">
                  {sourceLabel(candidate, font, localStatus, externalStatus)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
