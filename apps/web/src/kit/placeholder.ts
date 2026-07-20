import type {
  BrandIr,
  ContentSpec,
  ContentValue,
  LayoutSpec,
  ShapeLayer,
  Slot,
} from "../api/types"
import { directionApplication } from "../editor/direction"

export const PLACEHOLDER_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNoaGj4DwAFhAKAjM1mJgAAAABJRU5ErkJggg=="

const STRUCTURAL_COPY =
  /\b(contents?|sum[aá]rio|typography|colour|color|logo system|clearspace|correspondence|brand manual)\b/i

function brandData(brand: BrandIr | string): {
  name: string
  ir: BrandIr | null
} {
  return typeof brand === "string"
    ? { name: brand, ir: null }
    : { name: brand.brand.name, ir: brand }
}

function excerpt(raw: string | undefined, fallback: string, limit: number): string {
  const candidates = (raw ?? "")
    .replace(/([a-zà-ÿ])([A-ZÀ-Ý])/g, "$1 $2")
    .split(/\n+|(?<=[.!?])\s+/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(
      (item) =>
        item.length >= 12 &&
        !STRUCTURAL_COPY.test(item) &&
        !/^(?:0\d|never|don'?t|yes)\b/i.test(item),
    )
  const selected = candidates[0] ?? fallback
  if (selected.length <= limit) return selected
  const sliced = selected.slice(0, Math.max(1, limit - 1))
  const shortened = (limit >= 24 ? sliced.replace(/\s+\S*$/, "") : sliced).trim()
  return `${shortened || selected.slice(0, limit - 1)}…`
}

function handleFor(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, "")
  return `@${slug || "sua-marca"}`
}

function textSlot(
  id: string,
  role: string,
  area: [number, number, number, number],
  options: Partial<Slot> = {},
): Slot {
  return {
    id,
    kind: "text",
    role,
    area,
    fit: "shrink-within-role-range",
    required: false,
    zIndex: 8,
    ...options,
  }
}

function seedElements(
  layout: LayoutSpec,
  brand: BrandIr | null,
  brandName: string,
): { slots: Slot[]; layers: ShapeLayer[]; values: Record<string, ContentValue> } {
  if (layout.profile === "doc-a4" || layout.id.startsWith("editorial-")) {
    return { slots: [], layers: [], values: {} }
  }

  const { widthPx: width, heightPx: height, safeAreaPx: safe } = layout.canvas
  const captionRole = brand?.roles.caption ? "caption" : "body"
  const bodyRole = brand?.roles.body ? "body" : Object.keys(brand?.roles ?? {})[0] ?? "body"
  const accentToken =
    (brand?.colors["color.secondary"] && "color.secondary") ||
    (brand?.colors["color.primary"] && "color.primary") ||
    (brand?.colors["color.text"] && "color.text") ||
    "color.text"
  const signature = handleFor(brandName)
  const slots: Slot[] = []
  const layers: ShapeLayer[] = []
  const values: Record<string, ContentValue> = {}

  if (!layout.slots.some((slot) => slot.id === "kicker")) {
    const id = "user-kicker-1"
    slots.push(
      textSlot(id, captionRole, [safe, safe, Math.round(width * 0.62), Math.round(height * 0.06)], {
        maxChars: 54,
        textTransform: "uppercase",
        letterSpacingEm: 0.16,
        colorToken: accentToken,
      }),
    )
    values[id] = { kind: "text", text: `${brandName} — identidade em uso` }
  }

  const signatureId = "user-signature-1"
  slots.push(
    textSlot(
      signatureId,
      captionRole,
      [width - safe - Math.round(width * 0.42), safe, Math.round(width * 0.42), Math.round(height * 0.05)],
      {
        maxChars: 48,
        fit: "fixed",
        textAlign: "right",
        letterSpacingEm: 0.08,
      },
    ),
  )
  values[signatureId] = { kind: "text", text: signature }

  const ruleId = "user-rule-1"
  layers.push({
    id: ruleId,
    kind: "shape",
    shape: "rectangle",
    area: [safe, Math.round(height * 0.14), Math.round(width * 0.12), 4],
    colorToken: accentToken,
    opacity: 1,
    zIndex: 6,
  })

  if (layout.id.startsWith("statement-")) {
    const supportId = "user-support-1"
    slots.push(
      textSlot(
        supportId,
        bodyRole,
        [safe, Math.round(height * 0.74), Math.round(width * 0.58), Math.round(height * 0.12)],
        { maxChars: 180 },
      ),
    )
    values[supportId] = {
      kind: "text",
      text: excerpt(
        brand?.identity?.personality,
        "Uma segunda camada de leitura amplia a mensagem principal.",
        150,
      ),
    }
  }

  if (layout.id.startsWith("announce-")) {
    const indexId = "user-index-1"
    slots.push(
      textSlot(
        indexId,
        captionRole,
        [width - safe - Math.round(width * 0.12), Math.round(height * 0.18), Math.round(width * 0.12), Math.round(height * 0.08)],
        { maxChars: 3, fit: "fixed", textAlign: "right", colorToken: accentToken },
      ),
    )
    values[indexId] = { kind: "text", text: "01" }
  }

  return { slots, layers, values }
}

function roleFallback(role: string | null | undefined, brandName: string): string {
  if (role === "heading" || role === "display") return `${brandName} em movimento.`
  if (role === "caption" || role === "label") return brandName
  return "Edite este texto para construir a mensagem da peça."
}

export function placeholderContent(
  layout: LayoutSpec,
  brandRevisionId: string,
  brand: BrandIr | string = "Sua marca",
): ContentSpec {
  const { name: brandName, ir } = brandData(brand)
  const values: Record<string, ContentValue> = {}
  const closure = layout.id.startsWith("editorial-closure-")
  const isEditorial =
    layout.compositionMode != null ||
    (layout.lockedLayers?.length ?? 0) > 0 ||
    layout.slots.some((slot) => slot.emphasisColorToken != null)
  const essence = excerpt(ir?.identity?.essence, `${brandName} em movimento.`, 92)
  const personality = excerpt(
    ir?.identity?.personality,
    "Forma, ritmo e mensagem trabalhando como uma só ideia.",
    180,
  )
  const voice = excerpt(
    ir?.identity?.voice,
    "Uma voz reconhecível transforma presença em memória.",
    126,
  )

  for (const slot of layout.slots) {
    if (slot.kind === "logo") continue
    if (slot.kind === "image") {
      values[slot.id] = { kind: "image", path: PLACEHOLDER_IMAGE }
      continue
    }

    const bySlot: Record<string, string> = {
      kicker: `${brandName} — guia visual`,
      headline: closure ? brandName.toLocaleUpperCase("pt-BR") : essence,
      title: essence,
      quote: voice,
      author: brandName,
      body: personality,
      tagline: "Uma postura diante da inteireza do que se cria.",
      index: "06",
      signature: handleFor(brandName),
    }
    const editorialBySlot: Record<string, string> = {
      kicker: "AUTORIA NÃO É UM EFEITO.",
      headline: "É A COERÊNCIA ENTRE INTENÇÃO E FORMA.",
      index: "06",
      signature: handleFor(brandName),
    }
    const sample =
      (!closure && isEditorial ? editorialBySlot[slot.id] : undefined) ??
      bySlot[slot.id] ??
      roleFallback(slot.role, brandName)
    const text = slot.maxChars == null ? sample : excerpt(sample, sample, slot.maxChars)
    const emphasis =
      isEditorial && slot.id === "headline" && slot.emphasisColorToken
        ? text.includes("INTENÇÃO E FORMA")
          ? "INTENÇÃO E FORMA"
          : undefined
        : closure && slot.id === "tagline" && text.includes("inteireza")
          ? "inteireza"
          : undefined
    values[slot.id] = { kind: "text", text, ...(emphasis ? { emphasis } : {}) }
  }

  const seeded = seedElements(layout, ir, brandName)
  Object.assign(values, seeded.values)
  const direction = ir ? directionApplication(ir, layout) : null
  const overrides = {
    ...(closure ? { tagline: { fontSizePx: 42, fontStyle: "italic" as const, lineHeight: 1.15 } } : {}),
    ...(direction?.patches ?? {}),
  }

  return {
    layoutId: layout.id,
    brandRevisionId,
    values,
    overrides,
    surface: direction?.surface ?? null,
    addedSlots: seeded.slots,
    addedLayers: seeded.layers,
  }
}
