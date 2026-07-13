declare module "@brand-runtime/render" {
  export interface Payload {
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

  export function renderDocument(
    container: HTMLElement,
    payload: Payload,
    options?: unknown,
  ): GuardReport
  export function renderDocumentStable(
    container: HTMLElement,
    payload: Payload,
    options?: { signal?: AbortSignal },
  ): Promise<GuardReport>
  export function parsePayload(raw: unknown): Payload
}
