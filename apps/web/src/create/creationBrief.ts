import type { LayoutSpec } from "../api/types"

export type CreationObjective = "sell" | "announce" | "inform" | "engage" | "brand"
export type CreationPieceType = "individual" | "carousel"
export type CreationChannel =
  | "instagram"
  | "linkedin"
  | "facebook"
  | "tiktok"
  | "pinterest"
  | "other"
export type CreationProfile = "post-1x1" | "post-4x5" | "story-9x16"
export type CreationAction = "none" | "save" | "share" | "respond" | "contact" | "buy"
export type CreationVisualPreference = "either" | "image" | "no-image"

export interface CreationBrief {
  objective: CreationObjective
  pieceType: CreationPieceType
  channel: CreationChannel
  customChannel: string
  profile: CreationProfile
  action: CreationAction
  visualPreference: CreationVisualPreference
}

export interface TemplateRecommendationContext {
  objective?: CreationObjective | null
  action?: CreationAction | null
  visualPreference?: CreationVisualPreference | null
}

export interface CreationLayoutSelection {
  layouts: LayoutSpec[]
  match: "unfiltered" | "exact" | "fallback" | "unavailable"
}

export const OBJECTIVE_OPTIONS: Array<{
  value: CreationObjective
  label: string
  description: string
}> = [
  {
    value: "sell",
    label: "Vender ou divulgar uma oferta",
    description: "Produto, serviço, condição comercial ou chamada para compra.",
  },
  {
    value: "announce",
    label: "Anunciar uma novidade",
    description: "Lançamento, evento, mudança, agenda ou comunicado.",
  },
  {
    value: "inform",
    label: "Explicar ou ensinar",
    description: "Conteúdo educativo, passo a passo, dados ou orientação.",
  },
  {
    value: "engage",
    label: "Gerar conversa ou interação",
    description: "Pergunta, opinião, compartilhamento ou resposta do público.",
  },
  {
    value: "brand",
    label: "Divulgar a marca",
    description: "Apresentação, bastidores ou mensagem institucional.",
  },
]

export const CHANNEL_OPTIONS: Array<{ value: CreationChannel; label: string }> = [
  { value: "instagram", label: "Instagram" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "pinterest", label: "Pinterest" },
  { value: "other", label: "Outra rede" },
]

export const ACTION_OPTIONS: Array<{ value: CreationAction; label: string }> = [
  { value: "none", label: "Só transmitir a mensagem" },
  { value: "save", label: "Salvar" },
  { value: "share", label: "Compartilhar" },
  { value: "respond", label: "Comentar ou responder" },
  { value: "contact", label: "Entrar em contato ou acessar um link" },
  { value: "buy", label: "Comprar ou reservar" },
]

export const PROFILE_OPTIONS: Array<{
  value: CreationProfile
  label: string
  dimensions: string
  individualOnly?: boolean
}> = [
  {
    value: "post-4x5",
    label: "Feed vertical",
    dimensions: "4:5 · 1080 × 1350",
  },
  {
    value: "post-1x1",
    label: "Feed quadrado",
    dimensions: "1:1 · 1080 × 1080",
  },
  {
    value: "story-9x16",
    label: "Story ou tela vertical",
    dimensions: "9:16 · 1080 × 1920",
    individualOnly: true,
  },
]

const OBJECTIVE_LABELS = Object.fromEntries(
  OBJECTIVE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<CreationObjective, string>
const CHANNEL_LABELS = Object.fromEntries(
  CHANNEL_OPTIONS.map((option) => [option.value, option.label]),
) as Record<CreationChannel, string>
const PROFILE_LABELS = Object.fromEntries(
  PROFILE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<CreationProfile, string>

function enumValue<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && allowed.includes(value as T) ? (value as T) : null
}

export function creationBriefFromSearch(search: URLSearchParams): Partial<CreationBrief> {
  return {
    objective:
      enumValue(search.get("objective"), [
        "sell",
        "announce",
        "inform",
        "engage",
        "brand",
      ] as const) ?? undefined,
    pieceType:
      enumValue(search.get("piece"), ["individual", "carousel"] as const) ?? undefined,
    channel:
      enumValue(search.get("channel"), [
        "instagram",
        "linkedin",
        "facebook",
        "tiktok",
        "pinterest",
        "other",
      ] as const) ?? undefined,
    customChannel: search.get("customChannel")?.trim() || undefined,
    profile:
      enumValue(search.get("profile"), [
        "post-1x1",
        "post-4x5",
        "story-9x16",
      ] as const) ?? undefined,
    action:
      enumValue(search.get("action"), [
        "none",
        "save",
        "share",
        "respond",
        "contact",
        "buy",
      ] as const) ?? undefined,
    visualPreference:
      enumValue(search.get("visual"), ["either", "image", "no-image"] as const) ??
      undefined,
  }
}

export function creationBriefSearch(brief: CreationBrief): string {
  const search = new URLSearchParams({
    objective: brief.objective,
    piece: brief.pieceType,
    channel: brief.channel,
    profile: brief.profile,
    action: brief.action,
    visual: brief.visualPreference,
  })
  if (brief.channel === "other" && brief.customChannel.trim()) {
    search.set("customChannel", brief.customChannel.trim())
  }
  return search.toString()
}

export function creationTarget(revisionId: string, brief: CreationBrief): string {
  const route = brief.pieceType === "carousel" ? "carrossel" : "kit"
  return `/marcas/${encodeURIComponent(revisionId)}/${route}?${creationBriefSearch(brief)}`
}

export function creationBriefSummary(brief: Partial<CreationBrief>): string | null {
  const parts = [
    brief.channel
      ? brief.channel === "other"
        ? brief.customChannel || "Outra rede"
        : CHANNEL_LABELS[brief.channel]
      : null,
    brief.profile ? PROFILE_LABELS[brief.profile] : null,
    brief.objective ? OBJECTIVE_LABELS[brief.objective] : null,
  ].filter((value): value is string => Boolean(value))
  return parts.length ? parts.join(" · ") : null
}

export function layoutsForCreationBrief(
  layouts: LayoutSpec[],
  brief: Partial<CreationBrief>,
): LayoutSpec[] {
  return selectLayoutsForCreationBrief(layouts, brief).layouts
}

export function selectLayoutsForCreationBrief(
  layouts: LayoutSpec[],
  brief: Partial<CreationBrief>,
): CreationLayoutSelection {
  if (!brief.profile) return { layouts, match: "unfiltered" }

  const exactLayouts = layouts.filter((layout) => layout.profile === brief.profile)
  if (exactLayouts.length > 0) return { layouts: exactLayouts, match: "exact" }

  const socialLayouts = layouts.filter(
    (layout) =>
      layout.profile === "post-1x1" ||
      layout.profile === "post-4x5" ||
      layout.profile === "story-9x16",
  )
  if (socialLayouts.length > 0) return { layouts: socialLayouts, match: "fallback" }

  return { layouts: [], match: "unavailable" }
}
