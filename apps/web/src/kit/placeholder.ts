import type { ContentSpec, ContentValue, LayoutSpec } from "../api/types"

export const PLACEHOLDER_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNoaGj4DwAFhAKAjM1mJgAAAABJRU5ErkJggg=="

const TEXT_BY_ROLE: Record<string, string> = {
  heading: "Sua mensagem aqui",
  body: "Um exemplo de texto corrido para visualizar este layout.",
  caption: "Legenda",
}

const EDITORIAL_TEXT_BY_SLOT: Record<string, string> = {
  kicker: "PRINCÍPIO 01",
  headline: "O OFÍCIO PEDE INTENÇÃO.",
  index: "01",
  signature: "@sua-marca",
}

export function placeholderContent(layout: LayoutSpec, brandRevisionId: string): ContentSpec {
  const values: Record<string, ContentValue> = {}
  const isEditorial =
    layout.compositionMode != null ||
    (layout.lockedLayers?.length ?? 0) > 0 ||
    layout.slots.some((slot) => slot.emphasisColorToken != null)

  for (const slot of layout.slots) {
    if (slot.kind === "logo") continue

    if (slot.kind === "image") {
      values[slot.id] = { kind: "image", path: PLACEHOLDER_IMAGE }
      continue
    }

    const sample =
      (isEditorial ? EDITORIAL_TEXT_BY_SLOT[slot.id] : undefined) ??
      TEXT_BY_ROLE[slot.role ?? ""] ??
      TEXT_BY_ROLE.body
    const text = slot.maxChars == null ? sample : sample.slice(0, Math.max(0, slot.maxChars))
    const emphasis =
      slot.id === "headline" && slot.emphasisColorToken && text.includes("INTENÇÃO")
        ? "INTENÇÃO"
        : undefined
    values[slot.id] = { kind: "text", text, ...(emphasis ? { emphasis } : {}) }
  }

  return { layoutId: layout.id, brandRevisionId, values }
}
