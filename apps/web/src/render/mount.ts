import { parsePayload, renderDocumentStable } from "@brand-runtime/render"

export interface RenderPayload {
  brandIr: unknown
  layoutSpec: unknown
  contentSpec: unknown
  assetsBaseUrl: string
}

export interface RenderHandle {
  update(payload: RenderPayload): void
  destroy(): void
}

const RENDER_ERROR_MESSAGE = "Não foi possível renderizar esta prévia. Tente novamente."

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "AbortError"
}

function showRenderError(element: HTMLElement): void {
  const message = document.createElement("p")
  message.className = "preview-render-error"
  message.setAttribute("role", "alert")
  message.textContent = RENDER_ERROR_MESSAGE
  element.replaceChildren(message)
}

export function mountRender(element: HTMLElement, payload: RenderPayload): RenderHandle {
  let controller: AbortController | null = null
  let generation = 0
  let destroyed = false

  const render = (nextPayload: RenderPayload): void => {
    if (destroyed) return

    controller?.abort()
    controller = new AbortController()
    const activeController = controller
    const activeGeneration = ++generation

    const exposeFailure = (error: unknown): void => {
      if (
        destroyed ||
        activeGeneration !== generation ||
        activeController.signal.aborted ||
        isAbortError(error)
      ) {
        return
      }
      showRenderError(element)
    }

    try {
      const parsed = parsePayload(nextPayload)
      element.querySelector(".preview-render-error")?.remove()
      void renderDocumentStable(element, parsed, { signal: activeController.signal }).catch(
        exposeFailure,
      )
    } catch (error) {
      exposeFailure(error)
    }
  }

  render(payload)

  return {
    update: render,
    destroy() {
      if (destroyed) return
      destroyed = true
      generation += 1
      controller?.abort()
      controller = null
      element.replaceChildren()
    },
  }
}
