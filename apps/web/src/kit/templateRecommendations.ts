import type { LayoutSpec } from "../api/types"
import type { TemplateRecommendationContext } from "../create/creationBrief"

export type TemplateCatalogMode = "recommended" | "all"
export type TemplatePurpose = "cover" | "content" | "closing"

export interface TemplateRecommendationGroup {
  purpose: TemplatePurpose
  label: string
  eyebrow: string
  description: string
  layouts: LayoutSpec[]
}

const PURPOSE_META: Record<
  TemplatePurpose,
  Omit<TemplateRecommendationGroup, "purpose" | "layouts">
> = {
  cover: {
    label: "Abrir a mensagem",
    eyebrow: "01 · Primeiro contato",
    description: "Apresente o assunto com clareza.",
  },
  content: {
    label: "Explicar",
    eyebrow: "02 · Informação",
    description: "Organize detalhes, argumentos ou etapas.",
  },
  closing: {
    label: "Encerrar",
    eyebrow: "03 · Próxima ação",
    description: "Conclua a mensagem e indique o que fazer.",
  },
}

const PURPOSE_ORDER: TemplatePurpose[] = ["cover", "content", "closing"]
const PURPOSE_TERMS: Record<TemplatePurpose, string[]> = {
  cover: [
    "capa",
    "cover",
    "hero",
    "manifesto",
    "monument",
    "impacto",
    "primeiro plano",
  ],
  content: [
    "annotation",
    "benefit",
    "comparison",
    "dashboard",
    "diptych",
    "ecosystem",
    "flow",
    "gallery",
    "objeto anotado",
    "página",
    "retrato",
    "spread",
  ],
  closing: [
    "broadcast",
    "closing",
    "contact",
    "fechamento",
    "launch",
    "lançamento",
    "pulse",
    "pulso",
    "signal",
    "sinal",
  ],
}

function baseCompositionId(layout: LayoutSpec): string {
  return layout.id.replace(/-alternative$/, "")
}

function preferredCompositionVariants(layouts: LayoutSpec[]): LayoutSpec[] {
  const byComposition = new Map<string, LayoutSpec>()
  for (const layout of layouts) {
    const key = baseCompositionId(layout)
    const current = byComposition.get(key)
    const currentRank = current?.recommendationRank ?? Number.MAX_SAFE_INTEGER
    const candidateRank = layout.recommendationRank ?? Number.MAX_SAFE_INTEGER
    if (
      current == null ||
      candidateRank < currentRank ||
      (candidateRank === currentRank &&
        current.id.endsWith("-alternative") &&
        !layout.id.endsWith("-alternative"))
    ) {
      byComposition.set(key, layout)
    }
  }
  return [...byComposition.values()]
}

function headlineAreaRatio(layout: LayoutSpec): number {
  const headline = layout.slots
    .filter(
      (slot) =>
        slot.kind === "text" &&
        (slot.role === "heading" ||
          slot.role === "display" ||
          /headline|title|quote|echo/.test(slot.id)),
    )
    .sort((left, right) => right.area[2] * right.area[3] - left.area[2] * left.area[3])[0]
  if (headline == null) return 0
  return (
    (headline.area[2] * headline.area[3]) /
    (layout.canvas.widthPx * layout.canvas.heightPx)
  )
}

function purposeScore(layout: LayoutSpec, purpose: TemplatePurpose): number {
  const searchable = `${layout.id} ${layout.namePt}`.toLocaleLowerCase("pt-BR")
  const termScore = PURPOSE_TERMS[purpose].some((term) => searchable.includes(term))
    ? 32
    : 0
  const bodyCount = layout.slots.filter(
    (slot) => slot.kind === "text" && (slot.role === "body" || slot.id.startsWith("body")),
  ).length
  const textCount = layout.slots.filter((slot) => slot.kind === "text").length
  const imageCount = layout.slots.filter((slot) => slot.kind === "image").length
  const hasCta = layout.slots.some(
    (slot) => slot.kind === "text" && (slot.id === "cta" || slot.role === "cta"),
  )
  const headlineRatio = headlineAreaRatio(layout)

  if (purpose === "cover") {
    return termScore + headlineRatio * 80 + (bodyCount === 0 ? 10 : 0) - bodyCount * 3
  }
  if (purpose === "content") {
    return (
      termScore +
      Math.min(bodyCount, 3) * 18 +
      Math.min(textCount, 7) * 1.5 +
      Math.min(imageCount, 2) * 4 -
      Math.max(0, headlineRatio - 0.28) * 24
    )
  }
  return termScore + (hasCta ? 28 : 0) + headlineRatio * 24 + (bodyCount <= 1 ? 4 : 0)
}

function bestPurpose(layout: LayoutSpec): TemplatePurpose {
  return PURPOSE_ORDER.reduce((best, purpose) =>
    purposeScore(layout, purpose) > purposeScore(layout, best) ? purpose : best,
  )
}

function briefScore(
  layout: LayoutSpec,
  context: TemplateRecommendationContext,
): number {
  const searchable = `${layout.id} ${layout.namePt}`.toLocaleLowerCase("pt-BR")
  const bodyCount = layout.slots.filter(
    (slot) => slot.kind === "text" && (slot.role === "body" || slot.id.startsWith("body")),
  ).length
  const imageCount = layout.slots.filter((slot) => slot.kind === "image").length
  const hasCta = layout.slots.some(
    (slot) => slot.kind === "text" && (slot.id === "cta" || slot.role === "cta"),
  )
  const headlineRatio = headlineAreaRatio(layout)
  let score = 0

  if (context.objective === "sell") {
    score += hasCta ? 26 : 0
    score += imageCount ? 10 : 0
    if (/produto|product|oferta|offer|launch|lançamento/.test(searchable)) score += 18
  } else if (context.objective === "announce") {
    score += headlineRatio * 42
    if (/launch|lançamento|signal|sinal|broadcast|anúncio|announcement/.test(searchable)) {
      score += 20
    }
  } else if (context.objective === "inform") {
    score += Math.min(bodyCount, 3) * 18
    if (/evidence|dados|comparison|comparação|flow|processo|benefit|benefício/.test(searchable)) {
      score += 18
    }
  } else if (context.objective === "engage") {
    if (/quote|citação|pergunta|question|retrato|portrait|pulse|pulso/.test(searchable)) {
      score += 20
    }
    score += bodyCount > 0 ? 6 : 0
  } else if (context.objective === "brand") {
    score += layout.recommendationBasis === "brand" ? 20 : 0
  }

  if (context.action && context.action !== "none") score += hasCta ? 22 : -4
  if (context.visualPreference === "image") score += imageCount ? 24 : -18
  if (context.visualPreference === "no-image") score += imageCount ? -14 * imageCount : 20
  return score
}

function recommendationScore(
  layout: LayoutSpec,
  purpose: TemplatePurpose,
  context: TemplateRecommendationContext,
): number {
  const brandAffinity =
    layout.recommendationRank == null ? 0 : Math.max(0, 40 - layout.recommendationRank)
  return purposeScore(layout, purpose) + brandAffinity + briefScore(layout, context)
}

export function recommendedTemplateGroups(
  layouts: LayoutSpec[],
  limitPerGroup = 3,
  context: TemplateRecommendationContext = {},
): TemplateRecommendationGroup[] {
  if (limitPerGroup <= 0) {
    return PURPOSE_ORDER.map((purpose) => ({
      purpose,
      ...PURPOSE_META[purpose],
      layouts: [],
    }))
  }

  const candidates = preferredCompositionVariants(layouts)
  const assigned = new Map<TemplatePurpose, LayoutSpec[]>(
    PURPOSE_ORDER.map((purpose) => [purpose, []]),
  )
  for (const layout of candidates) assigned.get(bestPurpose(layout))?.push(layout)

  const selected = new Set<string>()
  const groups = PURPOSE_ORDER.map((purpose) => {
    const ranked = [...(assigned.get(purpose) ?? [])].sort(
      (left, right) =>
        recommendationScore(right, purpose, context) -
          recommendationScore(left, purpose, context) ||
        left.id.localeCompare(right.id),
    )
    const chosen = ranked.slice(0, limitPerGroup)
    for (const layout of chosen) selected.add(layout.id)
    return { purpose, ...PURPOSE_META[purpose], layouts: chosen }
  })

  for (const group of groups) {
    if (group.layouts.length >= limitPerGroup) continue
    const fallbacks = candidates
      .filter((layout) => !selected.has(layout.id))
      .sort(
        (left, right) =>
          recommendationScore(right, group.purpose, context) -
            recommendationScore(left, group.purpose, context) ||
          left.id.localeCompare(right.id),
      )
    for (const layout of fallbacks.slice(0, limitPerGroup - group.layouts.length)) {
      group.layouts.push(layout)
      selected.add(layout.id)
    }
  }

  return groups
}

export function recommendedTemplateLayouts(
  layouts: LayoutSpec[],
  limit = 8,
): LayoutSpec[] {
  const ranked = layouts
    .filter((layout) => layout.recommendationRank != null)
    .sort(
      (left, right) =>
        (left.recommendationRank ?? Number.MAX_SAFE_INTEGER) -
        (right.recommendationRank ?? Number.MAX_SAFE_INTEGER),
    )
  return (ranked.length > 0 ? ranked : layouts).slice(0, limit)
}

export function recommendationIsBrandLed(layouts: LayoutSpec[]): boolean {
  return layouts.some((layout) => layout.recommendationBasis === "brand")
}
