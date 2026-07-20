import type { LayerOverride, LayoutSpec, LockedLayer, Slot } from "../api/types"
import { slotLabel } from "./labels"

export type EditorElement = Slot | LockedLayer

const LAYER_LABELS: Record<string, string> = {
  "diagonal-field": "Campo diagonal",
  "accent-diagonals": "Linhas de acento",
  "accent-rule": "Linha de destaque",
  "brand-mark": "Marca",
  "frame-top": "Moldura superior",
  "frame-left": "Moldura esquerda",
  "frame-right": "Moldura direita",
  "frame-bottom": "Moldura inferior",
  "register-top-left-x": "Registro superior esquerdo",
  "register-top-left-y": "Registro superior esquerdo",
  "register-top-right-x": "Registro superior direito",
  "register-top-right-y": "Registro superior direito",
  "register-bottom-left-x": "Registro inferior esquerdo",
  "register-bottom-left-y": "Registro inferior esquerdo",
  "register-bottom-right-x": "Registro inferior direito",
  "register-bottom-right-y": "Registro inferior direito",
}

export function editorElements(layout: LayoutSpec): EditorElement[] {
  return [...layout.slots, ...(layout.lockedLayers ?? [])]
}

export function findEditorElement(layout: LayoutSpec, id: string | null): EditorElement | null {
  if (!id) return null
  return editorElements(layout).find((element) => element.id === id) ?? null
}

export function elementLabel(element: EditorElement): string {
  if (element.id.startsWith("user-text-")) return "Bloco de texto"
  if (element.id.startsWith("user-signature-")) return "Assinatura"
  if (element.id.startsWith("user-kicker-")) return "Linha de contexto"
  if (element.id.startsWith("user-support-")) return "Texto de apoio"
  if (element.id.startsWith("user-index-")) return "Número"
  if (element.id.startsWith("user-image-")) return "Imagem"
  if (element.id.startsWith("user-logo-")) return "Logo"
  if (element.id.startsWith("user-shape-") || element.id.startsWith("user-rule-")) {
    return "Forma ou linha"
  }
  if (element.kind === "text" || element.kind === "image" || element.kind === "logo") {
    return slotLabel(element.id)
  }
  return LAYER_LABELS[element.id] ?? element.id.replaceAll("-", " ")
}

export function elementArea(
  element: EditorElement,
  override: LayerOverride | undefined,
): [number, number, number, number] {
  return override?.area ?? element.area
}

export function elementOpacity(element: EditorElement, override: LayerOverride | undefined): number {
  return override?.opacity ?? element.opacity ?? 1
}

export function elementZIndex(element: EditorElement, override: LayerOverride | undefined): number {
  if (override?.zIndex !== undefined && override.zIndex !== null) return override.zIndex
  if (element.zIndex !== undefined && element.zIndex !== null) return element.zIndex
  if (element.kind === "logo") return 3
  if (element.kind === "text") return 2
  if (element.kind === "image") return 1
  return 0
}

export function isStructuralElement(element: EditorElement): boolean {
  return element.id.startsWith("frame-") || element.id.startsWith("register-")
}

export function elementGlyph(element: EditorElement): string {
  if (element.kind === "text") return "T"
  if (element.kind === "image") return "IMG"
  if (element.kind === "logo" || element.kind === "asset") return "BR"
  if (element.kind === "motif") return "///"
  return "□"
}
