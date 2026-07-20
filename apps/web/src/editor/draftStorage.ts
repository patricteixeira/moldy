import type {
  LayerOverride,
  LayoutSpec,
  ShapeLayer,
  Slot,
  SlotValue,
  SurfaceStyle,
} from "../api/types"

const STORAGE_PREFIX = "brand-runtime:editor-draft:v1"

export interface EditorDraftState {
  values: Record<string, SlotValue>
  overrides: Record<string, LayerOverride>
  surface: SurfaceStyle | null
  addedSlots: Slot[]
  addedLayers: ShapeLayer[]
}

interface StoredEditorDraft {
  version: 4
  values: Record<string, SlotValue>
  overrides: Record<string, LayerOverride>
  surface: SurfaceStyle | null
  addedSlots: Slot[]
  addedLayers: ShapeLayer[]
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

function validArea(value: unknown): value is [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item)) &&
    value[2] > 0 &&
    value[3] > 0
  )
}

function validAddedSlot(value: unknown): value is Slot {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.startsWith("user-")) {
    return false
  }
  return (
    ["text", "image", "logo"].includes(String(value.kind)) &&
    validArea(value.area) &&
    (value.kind !== "text" || typeof value.role === "string")
  )
}

function validAddedLayer(value: unknown): value is ShapeLayer {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.startsWith("user-") &&
    value.kind === "shape" &&
    (value.shape === "rectangle" || value.shape === "circle") &&
    validArea(value.area) &&
    typeof value.colorToken === "string"
  )
}

export function loadEditorDraft(revisionId: string, layout: LayoutSpec): EditorDraftState {
  try {
    const serialized = window.localStorage.getItem(storageKey(revisionId, layout.id))
    if (!serialized) {
      return { values: {}, overrides: {}, surface: null, addedSlots: [], addedLayers: [] }
    }

    const parsed: unknown = JSON.parse(serialized)
    if (
      !isRecord(parsed) ||
      ![1, 2, 3, 4].includes(Number(parsed.version)) ||
      !isRecord(parsed.values)
    ) {
      return { values: {}, overrides: {}, surface: null, addedSlots: [], addedLayers: [] }
    }

    const addedSlots =
      parsed.version === 4 && Array.isArray(parsed.addedSlots)
        ? parsed.addedSlots.filter(validAddedSlot)
        : []
    const addedLayers =
      parsed.version === 4 && Array.isArray(parsed.addedLayers)
        ? parsed.addedLayers.filter(validAddedLayer)
        : []
    const slots = new Map(
      [...layout.slots, ...addedSlots].map((slot) => [slot.id, slot.kind]),
    )
    const restored: Record<string, SlotValue> = {}
    for (const [slotId, value] of Object.entries(parsed.values)) {
      const kind = slots.get(slotId)
      if (kind !== undefined && validValueForSlot(value, kind)) restored[slotId] = value
    }
    const elementIds = new Set([
      ...layout.slots.map((slot) => slot.id),
      ...(layout.lockedLayers ?? []).map((layer) => layer.id),
      ...addedSlots.map((slot) => slot.id),
      ...addedLayers.map((layer) => layer.id),
    ])
    const overrides: Record<string, LayerOverride> = {}
    if (
      (parsed.version === 2 || parsed.version === 3 || parsed.version === 4) &&
      isRecord(parsed.overrides)
    ) {
      for (const [elementId, value] of Object.entries(parsed.overrides)) {
        if (elementIds.has(elementId) && isRecord(value)) {
          overrides[elementId] = value as LayerOverride
        }
      }
    }
    const surface =
      (parsed.version === 3 || parsed.version === 4) &&
      (parsed.surface === null || isRecord(parsed.surface))
        ? (parsed.surface as SurfaceStyle | null)
        : null
    return { values: restored, overrides, surface, addedSlots, addedLayers }
  } catch {
    return { values: {}, overrides: {}, surface: null, addedSlots: [], addedLayers: [] }
  }
}

export function saveEditorDraft(
  revisionId: string,
  layoutId: string,
  values: Record<string, SlotValue>,
  overrides: Record<string, LayerOverride>,
  surface: SurfaceStyle | null = null,
  addedSlots: Slot[] = [],
  addedLayers: ShapeLayer[] = [],
): boolean {
  try {
    const key = storageKey(revisionId, layoutId)
    if (
      Object.keys(values).length === 0 &&
      Object.keys(overrides).length === 0 &&
      !surface &&
      addedSlots.length === 0 &&
      addedLayers.length === 0
    ) {
      window.localStorage.removeItem(key)
      return true
    }

    const payload: StoredEditorDraft = {
      version: 4,
      values,
      overrides,
      surface,
      addedSlots,
      addedLayers,
    }
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
