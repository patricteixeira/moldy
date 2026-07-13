import type { ContentSpec, ContentValue, LayoutSpec } from "../api/types"

export const PLACEHOLDER_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNoaGj4DwAFhAKAjM1mJgAAAABJRU5ErkJggg=="

const TEXT_BY_ROLE: Record<string, string> = {
  heading: "Sua mensagem aqui",
  body: "Um exemplo de texto corrido para visualizar este layout.",
  caption: "Legenda",
}

export function placeholderContent(layout: LayoutSpec, brandRevisionId: string): ContentSpec {
  const values: Record<string, ContentValue> = {}

  for (const slot of layout.slots) {
    if (slot.kind === "logo") continue

    if (slot.kind === "image") {
      values[slot.id] = { kind: "image", path: PLACEHOLDER_IMAGE }
      continue
    }

    const sample = TEXT_BY_ROLE[slot.role ?? ""] ?? TEXT_BY_ROLE.body
    const text = slot.maxChars == null ? sample : sample.slice(0, Math.max(0, slot.maxChars))
    values[slot.id] = { kind: "text", text }
  }

  return { layoutId: layout.id, brandRevisionId, values }
}
