export interface RenderPayload {
  brandIr: unknown
  layoutSpec: unknown
  contentSpec: unknown
  assetsBaseUrl: string
}

export interface GuardReport {
  overflows: Array<{ slotId: string; contentPx: number; boxPx: number }>
  fontFallbacks: Array<{
    slotId: string
    token: string
    family: string
    reason: "referenced-only" | "configured-fallback" | "load-failed"
  }>
}

type MountRecord = { el: HTMLElement; payloads: RenderPayload[] }

interface RenderTestGlobal {
  __brandRuntimeRenderMounts__?: MountRecord[]
}

const renderTestGlobal = globalThis as typeof globalThis & RenderTestGlobal
export const mounts = (renderTestGlobal.__brandRuntimeRenderMounts__ ??= [])

export function renderDocument(el: HTMLElement, payload: RenderPayload): GuardReport {
  const record = mounts.find((mount) => mount.el === el)
  if (record) {
    record.payloads.push(payload)
  } else {
    mounts.push({ el, payloads: [payload] })
  }
  el.setAttribute("data-render-stub", "1")
  return { overflows: [], fontFallbacks: [] }
}

export function parsePayload(raw: unknown): RenderPayload {
  return raw as RenderPayload
}

export async function renderDocumentStable(
  el: HTMLElement,
  payload: RenderPayload,
  _options?: { signal?: AbortSignal },
): Promise<GuardReport> {
  return renderDocument(el, payload)
}
