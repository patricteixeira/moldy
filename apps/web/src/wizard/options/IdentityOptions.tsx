import { useEffect, useState } from "react"
import type { Candidate, IdentityExpressionValue, IdentityTextValue } from "../../api/types"

interface Props {
  candidates: Candidate[]
  selected: unknown
  onSelect(value: unknown): void
}

type IdentityField = keyof IdentityTextValue

const EMPTY: IdentityTextValue = {
  essence: "",
  personality: "",
  voice: "",
  avoid: "",
}

const FIELD_LIMITS: Record<IdentityField, number> = {
  essence: 360,
  personality: 320,
  voice: 300,
  avoid: 340,
}

const STRUCTURAL_PHRASES = [
  "ESSENCE & POSITIONING",
  "VOICE & TONE",
  "HOWTHEHOUSESPEAKS",
  "WHATTHEHOUSESELLS",
  "THEREGISTER",
  "THEROLEOFBLACK",
  "PERMANENTVISUALCODES",
  "PERSONALIDADE E VALORES",
  "TOM DE VOZ",
]

function collapseTrackedWords(text: string): string {
  return text.replace(/\b(?:[A-ZÀ-ÖØ-Þ]\s+){2,}[A-ZÀ-ÖØ-Þ]\b/g, (match) =>
    match.replace(/\s+/g, ""),
  )
}

function navigationSegment(text: string): boolean {
  const sectionNumbers = text.match(/(?<!\d)(?:0?[1-9]|10)(?!\d)/g)?.length ?? 0
  const normalized = collapseTrackedWords(text).toLocaleUpperCase("pt-BR")
  const headingCount = STRUCTURAL_PHRASES.filter((phrase) => normalized.includes(phrase)).length
  return sectionNumbers >= 3 || headingCount >= 3
}

function cleanManualSegment(text: string): string {
  let cleaned = collapseTrackedWords(text)
    .replace(/^\s*(?:\d\s*){1,2}[—–-]\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
  for (const phrase of STRUCTURAL_PHRASES) {
    cleaned = cleaned.replaceAll(phrase, " ")
  }
  cleaned = cleaned
    .replace(/^\s*(?:NEVER|DON\s*'\s*T|NUNCA|NÃO FAZER)\b[\s:·—–-]*/, "")
    .replace(/\s+\S*CORRESPONDENCE.*$/i, "")
    .replace(/\s+(?:BRAND\s*MANUAL|MANUAL\s+DA\s+MARCA|ÉDITION|EDIÇÃO).*$/i, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()
  return cleaned
}

function trimAtSentence(text: string, limit: number): string {
  if (text.length <= limit) return text
  const excerpt = text.slice(0, limit + 1)
  const candidates = [excerpt.lastIndexOf("."), excerpt.lastIndexOf(";"), excerpt.lastIndexOf("·")]
  const boundary = Math.max(...candidates)
  if (boundary >= Math.floor(limit * 0.58)) return excerpt.slice(0, boundary + 1).trim()
  const lastSpace = excerpt.lastIndexOf(" ")
  return `${excerpt.slice(0, lastSpace > 0 ? lastSpace : limit).trim()}…`
}

function compactManualText(text: string, field: IdentityField): string {
  if (!text.trim()) return ""
  const segments = text
    .split(/\n\s*\n/)
    .filter((segment) => segment.trim() && !navigationSegment(segment))
    .map(cleanManualSegment)
    .filter((segment) => segment.length >= 8)
  const compacted = segments.join(" ").replace(/\s{2,}/g, " ").trim()
  return trimAtSentence(compacted || cleanManualSegment(text), FIELD_LIMITS[field])
}

function identityValue(value: unknown): IdentityTextValue {
  if (typeof value !== "object" || value === null) return EMPTY
  const record = value as Record<string, unknown>
  return {
    essence: typeof record.essence === "string" ? record.essence : "",
    personality: typeof record.personality === "string" ? record.personality : "",
    voice: typeof record.voice === "string" ? record.voice : "",
    avoid: typeof record.avoid === "string" ? record.avoid : "",
  }
}

function sameIdentity(a: IdentityTextValue, b: IdentityTextValue): boolean {
  return (Object.keys(EMPTY) as IdentityField[]).every(
    (field) => a[field] === b[field],
  )
}

function initialIdentityValue(candidates: Candidate[], selected: unknown): IdentityTextValue {
  const candidate = identityValue(candidates[0]?.value)
  const current = identityValue(selected)
  const source = selected === null || selected === undefined || sameIdentity(current, candidate)
    ? candidate
    : current
  if (source !== candidate) return source
  return {
    essence: compactManualText(source.essence, "essence"),
    personality: compactManualText(source.personality, "personality"),
    voice: compactManualText(source.voice, "voice"),
    avoid: compactManualText(source.avoid, "avoid"),
  }
}

function translationMetadata(value: unknown): IdentityExpressionValue | null {
  if (typeof value !== "object" || value === null) return null
  const candidate = value as IdentityExpressionValue
  if (candidate.translationStatus !== "translated" && candidate.translationStatus !== "unavailable") {
    return null
  }
  return candidate
}

function compactIdentity(value: IdentityTextValue): IdentityTextValue {
  return {
    essence: compactManualText(value.essence, "essence"),
    personality: compactManualText(value.personality, "personality"),
    voice: compactManualText(value.voice, "voice"),
    avoid: compactManualText(value.avoid, "avoid"),
  }
}

export function IdentityOptions({ candidates, selected, onSelect }: Props) {
  const initial = initialIdentityValue(candidates, selected)
  const [value, setValue] = useState(initial)

  useEffect(() => {
    const next = initialIdentityValue(candidates, selected)
    setValue(next)
    onSelect(next)
    // O candidato pertence à pergunta montada; reinicializamos apenas quando ela muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates])

  const patch = (field: IdentityField, text: string): void => {
    const next = { ...value, [field]: text }
    setValue(next)
    onSelect(next)
  }
  const evidence = candidates[0]?.evidence ?? []
  const hasEvidence = evidence.length > 0
  const translation = translationMetadata(candidates[0]?.value)
  const original = translation?.original ? compactIdentity(identityValue(translation.original)) : null
  const translatedLocally = translation?.translationStatus === "translated" && original !== null
  const translationUnavailable = translation?.translationStatus === "unavailable"

  return (
    <div className="identity-review">
      <div className="identity-review-intro">
        <strong>
          {translatedLocally
            ? "O Molda traduziu os dados encontrados."
            : hasEvidence
              ? "Confira os dados encontrados."
              : "Esta informação não apareceu no manual."}
        </strong>
        <span>
          {hasEvidence
            ? "Corrija somente o que estiver errado."
            : "Preencha com palavras simples. Essas respostas ajudam a ordenar os modelos."}
        </span>
        {translatedLocally && (
          <span className="identity-translation-note">
            Tradução feita neste computador. Nenhum trecho do manual foi enviado para fora.
          </span>
        )}
        {translationUnavailable && (
          <span className="identity-translation-warning" role="status">
            O tradutor local não estava disponível. O texto original em inglês continua
            editável; revise-o antes de confirmar.
          </span>
        )}
      </div>

      <label className="identity-field identity-field-essence">
        <span className="identity-field-heading">
          <strong>O que a marca oferece?</strong>
          <small>Em uma frase clara</small>
        </span>
        <span className="identity-field-help">Informe o principal produto, serviço ou benefício.</span>
        <textarea
          name="brand-offer"
          aria-label="O que a marca oferece"
          autoComplete="off"
          required
          rows={3}
          value={value.essence}
          placeholder="Ex.: Roupas sob medida para o dia a dia."
          onChange={(event) => patch("essence", event.currentTarget.value)}
        />
      </label>
      <label className="identity-field">
        <span className="identity-field-heading">
          <strong>Como a marca deve parecer?</strong>
          <small>Use palavras comuns</small>
        </span>
        <span className="identity-field-help">Por exemplo: séria, próxima, ousada, tranquila ou precisa.</span>
        <textarea
          name="brand-appearance"
          aria-label="Como a marca deve parecer"
          autoComplete="off"
          rows={3}
          value={value.personality}
          placeholder="Ex.: sóbria, sofisticada e direta."
          onChange={(event) => patch("personality", event.currentTarget.value)}
        />
      </label>
      <label className="identity-field">
        <span className="identity-field-heading">
          <strong>Como a marca escreve?</strong>
          <small>Tom dos textos</small>
        </span>
        <span className="identity-field-help">Pense em uma legenda, anúncio ou resposta ao cliente.</span>
        <textarea
          name="brand-writing"
          aria-label="Como a marca escreve?"
          autoComplete="off"
          rows={3}
          value={value.voice}
          placeholder="Ex.: frases curtas, diretas e sem exagero."
          onChange={(event) => patch("voice", event.currentTarget.value)}
        />
      </label>
      <label className="identity-field identity-field-avoid">
        <span className="identity-field-heading">
          <strong>O que nunca deve aparecer</strong>
          <small>Limites da marca</small>
        </span>
        <span className="identity-field-help">Palavras, atitudes ou escolhas visuais que descaracterizam a marca.</span>
        <textarea
          name="brand-avoid"
          aria-label="O que nunca deve aparecer na marca"
          autoComplete="off"
          rows={3}
          value={value.avoid}
          placeholder="Ex.: urgência, descontos, emoji ou visual carregado."
          onChange={(event) => patch("avoid", event.currentTarget.value)}
        />
      </label>

      {translatedLocally && original && (
        <details className="identity-review-source identity-review-original">
          <summary>Ver texto original em inglês</summary>
          <div className="identity-original-grid">
            {(
              [
                ["essence", "O que a marca entrega"],
                ["personality", "Impressão desejada"],
                ["voice", "Como a marca fala"],
                ["avoid", "O que deve ser evitado"],
              ] as const
            ).map(([field, label]) =>
              original[field] ? (
                <section key={field}>
                  <strong>{label}</strong>
                  <p>{original[field]}</p>
                </section>
              ) : null,
            )}
          </div>
        </details>
      )}

      {hasEvidence && (
        <details className="identity-review-source">
          <summary>
            {"Ver origem da leitura · " + evidence.length + " trecho" +
              (evidence.length === 1 ? "" : "s")}
          </summary>
          <p>
            O Molda usou somente o manual enviado. Esta origem serve para conferência; o texto
            acima continua editável e será a versão usada pela marca.
          </p>
        </details>
      )}
    </div>
  )
}
