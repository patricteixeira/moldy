import { beforeEach, expect, it, vi } from "vitest"

const renderer = vi.hoisted(() => ({
  parsePayload: vi.fn((payload: unknown) => payload),
  renderDocumentStable: vi.fn(),
}))

vi.mock("@brand-runtime/render", () => renderer)

import { mountRender, type RenderPayload } from "./mount"

const payload = (id: string): RenderPayload => ({
  brandIr: { id },
  layoutSpec: {},
  contentSpec: {},
  assetsBaseUrl: "/v1/assets",
})

beforeEach(() => {
  renderer.parsePayload.mockImplementation((value: unknown) => value)
  renderer.renderDocumentStable.mockReset()
  renderer.renderDocumentStable.mockResolvedValue({ overflows: [], fontFallbacks: [] })
})

it("aborta a geração anterior ao atualizar e limpa tudo ao destruir", () => {
  const signals: AbortSignal[] = []
  renderer.renderDocumentStable.mockImplementation(
    (_element: HTMLElement, _payload: unknown, options: { signal: AbortSignal }) => {
      signals.push(options.signal)
      return new Promise(() => undefined)
    },
  )
  const element = document.createElement("div")
  element.append("conteúdo anterior")
  const handle = mountRender(element, payload("a"))

  handle.update(payload("b"))
  expect(signals).toHaveLength(2)
  expect(signals[0].aborted).toBe(true)
  expect(signals[1].aborted).toBe(false)

  handle.destroy()
  expect(signals[1].aborted).toBe(true)
  expect(element).toBeEmptyDOMElement()
  handle.update(payload("c"))
  expect(renderer.renderDocumentStable).toHaveBeenCalledTimes(2)
})

it("ignora a falha tardia de uma geração substituída", async () => {
  let rejectOld: ((reason: unknown) => void) | undefined
  renderer.renderDocumentStable
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject
        }),
    )
    .mockResolvedValueOnce({ overflows: [], fontFallbacks: [] })
  const element = document.createElement("div")
  const handle = mountRender(element, payload("a"))
  handle.update(payload("b"))
  rejectOld?.(new Error("falha antiga"))
  await Promise.resolve()
  expect(element.querySelector('[role="alert"]')).toBeNull()
})

it("mostra em PT-BR uma falha ativa de validação ou render", async () => {
  renderer.renderDocumentStable.mockRejectedValueOnce(new Error("quebrou"))
  const element = document.createElement("div")
  mountRender(element, payload("a"))
  await Promise.resolve()
  expect(element.querySelector('[role="alert"]')).toHaveTextContent(
    "Não foi possível renderizar esta prévia. Tente novamente.",
  )
})
