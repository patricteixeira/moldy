import type { LayoutSpec, SlotValue } from "../api/types"

const STORAGE_PREFIX = "brand-runtime:editor-draft:v1"

interface StoredEditorDraft {
  version: 1
  values: Record<string, SlotValue>
}

function storageKey(revisionId: string, layoutId: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(revisionId)}:${encodeURIComponent(layoutId)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validValueForSlot(value: unknown, kind: "text" | "image" | "logo"): value is SlotValue {
  if (!isRecord(value)) return false

  if (kind === "text") {
    return (
      value.kind === "text" &&
      typeof value.text === "string" &&
      (value.emphasis === undefined ||
        value.emphasis === null ||
        typeof value.emphasis === "string")
    )
  }

  if (kind === "image") {
    return (
      value.kind === "image" &&
      typeof value.path === "string" &&
      /^sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(value.path) &&
      (value.sha256 === undefined ||
        value.sha256 === null ||
        (typeof value.sha256 === "string" && /^[0-9a-f]{64}$/.test(value.sha256)))
    )
  }

  return false
}

export function loadEditorDraft(revisionId: string, layout: LayoutSpec): Record<string, SlotValue> {
  try {
    const serialized = window.localStorage.getItem(storageKey(revisionId, layout.id))
    if (!serialized) return {}

    const parsed: unknown = JSON.parse(serialized)
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.values)) return {}

    const slots = new Map(layout.slots.map((slot) => [slot.id, slot.kind]))
    const restored: Record<string, SlotValue> = {}
    for (const [slotId, value] of Object.entries(parsed.values)) {
      const kind = slots.get(slotId)
      if (kind !== undefined && validValueForSlot(value, kind)) restored[slotId] = value
    }
    return restored
  } catch {
    return {}
  }
}

export function saveEditorDraft(
  revisionId: string,
  layoutId: string,
  values: Record<string, SlotValue>,
): boolean {
  try {
    const key = storageKey(revisionId, layoutId)
    if (Object.keys(values).length === 0) {
      window.localStorage.removeItem(key)
      return true
    }

    const payload: StoredEditorDraft = { version: 1, values }
    window.localStorage.setItem(key, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function clearEditorDraft(revisionId: string, layoutId: string): boolean {
  try {
    window.localStorage.removeItem(storageKey(revisionId, layoutId))
    return true
  } catch {
    return false
  }
}
