import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { ApiProvider } from "../api/context"
import { ApiError } from "../api/client"
import type { ApiClient, ContentSpec } from "../api/types"
import {
  fakeClient,
  fakeEditorialLayout,
  fakeOnePagerLayout,
  fakeQuoteLayout,
  fakeStatementLayout,
} from "../test/fakeApi"
import { mounts } from "../test/renderStub"
import { EditorPage } from "./EditorPage"

function renderEditor(client: ApiClient, layoutId = "statement-post-1x1") {
  render(
    <ApiProvider client={client}>
      <MemoryRouter initialEntries={[`/marcas/brandrev_test/editor/${layoutId}`]}>
        <Routes>
          <Route
            path="/marcas/:revisionId/editor/:layoutId"
            element={<EditorPage pollIntervalMs={10} />}
          />
          <Route path="/marcas/:revisionId/kit" element={<h1>Kit da marca</h1>} />
        </Routes>
      </MemoryRouter>
    </ApiProvider>,
  )
}

const kitClient = (overrides = {}) =>
  fakeClient({
    getKit: vi.fn(async () => [fakeStatementLayout(), fakeQuoteLayout(), fakeOnePagerLayout()]),
    ...overrides,
  })

function lastPayload() {
  const m = mounts[mounts.length - 1]
  return m.payloads[m.payloads.length - 1] as { contentSpec: ContentSpec }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

it("digitar num slot atualiza o preview ao vivo", async () => {
  renderEditor(kitClient())
  const input = await screen.findByTestId("slot-input-headline")
  await userEvent.clear(input)
  await userEvent.type(input, "Olá mundo")
  await waitFor(() =>
    expect(lastPayload().contentSpec.values["headline"]).toEqual({ kind: "text", text: "Olá mundo" }),
  )
})

it("salva o rascunho e o recupera ao reabrir a peça", async () => {
  const key = "brand-runtime:editor-draft:v1:brandrev_test:statement-post-1x1"
  window.localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      values: { headline: { kind: "text", text: "Texto que continua aqui" } },
    }),
  )

  renderEditor(kitClient())

  expect(await screen.findByTestId("slot-input-headline")).toHaveValue(
    "Texto que continua aqui",
  )
  expect(screen.getByText("Salvo localmente")).toBeInTheDocument()

  await userEvent.type(screen.getByTestId("slot-input-headline"), " depois")
  await waitFor(() =>
    expect(JSON.parse(window.localStorage.getItem(key) ?? "{}")).toMatchObject({
      values: { headline: { kind: "text", text: "Texto que continua aqui depois" } },
    }),
  )
})

it("permite restaurar a composição inicial da peça", async () => {
  const key = "brand-runtime:editor-draft:v1:brandrev_test:statement-post-1x1"
  window.localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      values: { headline: { kind: "text", text: "Apagar este rascunho" } },
    }),
  )
  renderEditor(kitClient())

  expect(await screen.findByTestId("slot-input-headline")).toHaveValue("Apagar este rascunho")
  await userEvent.click(screen.getByRole("button", { name: "Restaurar composição" }))

  expect(screen.getByTestId("slot-input-headline")).toHaveValue("Sua mensagem aqui")
  await waitFor(() =>
    expect(JSON.parse(window.localStorage.getItem(key) ?? "{}")).toMatchObject({
      version: 2,
      values: { headline: { kind: "text", text: "Sua mensagem aqui" } },
    }),
  )
})

it("oferece destaque leigo no arquétipo editorial e o preserva ao editar a frase", async () => {
  renderEditor(
    fakeClient({ getKit: vi.fn(async () => [fakeEditorialLayout()]) }),
    "editorial-light-post-4x5",
  )

  const headline = await screen.findByRole("textbox", { name: "Frase principal" })
  const emphasis = screen.getByRole("textbox", { name: "Trecho em destaque" })
  await userEvent.clear(emphasis)
  await userEvent.clear(headline)
  await userEvent.type(headline, "A ideia vira forma")
  expect(emphasis).toHaveAccessibleDescription(
    "Copie exatamente uma parte da frase principal.",
  )
  expect(emphasis).toBeEnabled()
  expect(emphasis).toBeRequired()
  expect(emphasis).toHaveAttribute("aria-required", "true")

  await userEvent.type(emphasis, "ideia")
  await userEvent.type(headline, "!")

  await waitFor(() =>
    expect(lastPayload().contentSpec.values.headline).toEqual({
      kind: "text",
      text: "A ideia vira forma!",
      emphasis: "ideia",
    }),
  )
})

it("orienta um destaque inválido sem quebrar a prova ao vivo", async () => {
  renderEditor(
    fakeClient({ getKit: vi.fn(async () => [fakeEditorialLayout()]) }),
    "editorial-light-post-4x5",
  )

  const headline = await screen.findByRole("textbox", { name: "Frase principal" })
  const emphasis = screen.getByRole("textbox", { name: "Trecho em destaque" })
  await userEvent.clear(emphasis)
  await userEvent.clear(headline)
  await userEvent.type(headline, "Uma ideia")
  await userEvent.type(emphasis, "outro trecho")

  expect(emphasis).toHaveValue("outro trecho")
  expect(emphasis).toHaveAttribute("aria-invalid", "true")
  expect(screen.getByText(/apareça exatamente uma vez/i)).toBeInTheDocument()
  await waitFor(() =>
    expect(lastPayload().contentSpec.values.headline).toEqual({
      kind: "text",
      text: "Uma ideia",
      emphasis: undefined,
    }),
  )

  await userEvent.clear(emphasis)
  await userEvent.type(emphasis, "ideia")
  expect(emphasis).not.toHaveAttribute("aria-invalid")
  await waitFor(() =>
    expect(lastPayload().contentSpec.values.headline).toEqual({
      kind: "text",
      text: "Uma ideia",
      emphasis: "ideia",
    }),
  )
})

it("nomeia e seleciona cada camada editorial em PT-BR", async () => {
  renderEditor(
    fakeClient({ getKit: vi.fn(async () => [fakeEditorialLayout()]) }),
    "editorial-light-post-4x5",
  )

  await screen.findByRole("textbox", { name: "Frase principal" })
  await userEvent.click(screen.getByRole("button", { name: "Frase de apoio" }))
  expect(screen.getByRole("textbox", { name: "Frase de apoio" })).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Número" }))
  expect(screen.getByRole("textbox", { name: "Número" })).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Assinatura" }))
  expect(screen.getByRole("textbox", { name: "Assinatura" })).toBeInTheDocument()
})

it("não conta a direção tipográfica original como ajuste do usuário", async () => {
  const closure = fakeEditorialLayout()
  closure.id = "editorial-closure-dark-post-4x5"
  closure.namePt = "Fechamento editorial escuro"
  closure.slots = closure.slots.filter((slot) => slot.id === "headline" || slot.id === "signature")
  closure.slots.push({
    id: "tagline",
    kind: "text",
    required: true,
    area: [140, 780, 800, 120],
    fit: "fixed",
    role: "body",
  })
  renderEditor(fakeClient({ getKit: vi.fn(async () => [closure]) }), closure.id)

  await screen.findByRole("textbox", { name: "Frase principal" })

  expect(screen.getByText("Salvo localmente")).toBeInTheDocument()
  expect(screen.queryByText("1 ajustes")).not.toBeInTheDocument()
})

it("layout legado não ganha o campo de destaque", async () => {
  renderEditor(kitClient())
  await screen.findByTestId("slot-input-headline")
  expect(screen.queryByRole("textbox", { name: "Trecho em destaque" })).not.toBeInTheDocument()
})

it("contador marca excesso sem truncar o texto", async () => {
  renderEditor(kitClient())
  const input = await screen.findByTestId("slot-input-headline")
  await userEvent.clear(input)
  await userEvent.paste("A".repeat(95))
  const counter = screen.getByTestId("char-counter-headline")
  expect(counter).toHaveTextContent("95/90")
  expect(counter).toHaveAttribute("data-over", "true")
  expect((input as HTMLTextAreaElement).value).toHaveLength(95) // nunca truncar
})

it("upload de foto passa pela API e entra no preview com path content-addressed", async () => {
  const sha = "b".repeat(64)
  const uploadAsset = vi.fn(async () => ({ sha256: sha, size: 3 }))
  renderEditor(kitClient({ uploadAsset }), "quote-post-1x1")
  await userEvent.click(await screen.findByRole("button", { name: "Foto" }))
  const input = await screen.findByTestId("slot-image-input-photo")
  await userEvent.upload(input, new File(["png"], "foto.png", { type: "image/png" }))
  await waitFor(() => expect(uploadAsset).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(lastPayload().contentSpec.values["photo"]).toEqual({
      kind: "image",
      path: `sha256/bb/bb/${sha}`,
      sha256: sha,
    }),
  )
})

it("se dois uploads disputam o mesmo slot, somente o mais recente vence", async () => {
  const first = deferred<{ sha256: string; size: number }>()
  const second = deferred<{ sha256: string; size: number }>()
  const uploadAsset = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise)
  renderEditor(kitClient({ uploadAsset }), "quote-post-1x1")
  await userEvent.click(await screen.findByRole("button", { name: "Foto" }))
  const input = await screen.findByTestId("slot-image-input-photo")

  fireEvent.change(input, {
    target: { files: [new File(["primeira"], "primeira.png", { type: "image/png" })] },
  })
  fireEvent.change(input, {
    target: { files: [new File(["segunda"], "segunda.png", { type: "image/png" })] },
  })
  expect(uploadAsset).toHaveBeenCalledTimes(2)

  const newerSha = "c".repeat(64)
  second.resolve({ sha256: newerSha, size: 7 })
  await waitFor(() =>
    expect(lastPayload().contentSpec.values["photo"]).toMatchObject({ sha256: newerSha }),
  )

  first.resolve({ sha256: "d".repeat(64), size: 8 })
  await first.promise
  expect(lastPayload().contentSpec.values["photo"]).toMatchObject({ sha256: newerSha })
})

it("erro num novo upload mantém a foto anterior", async () => {
  const previousSha = "e".repeat(64)
  const uploadAsset = vi
    .fn()
    .mockResolvedValueOnce({ sha256: previousSha, size: 6 })
    .mockRejectedValueOnce(new ApiError(503, "A foto não pôde ser enviada."))
  renderEditor(kitClient({ uploadAsset }), "quote-post-1x1")
  await userEvent.click(await screen.findByRole("button", { name: "Foto" }))
  const input = await screen.findByTestId("slot-image-input-photo")

  await userEvent.upload(input, new File(["foto"], "foto.png", { type: "image/png" }))
  await waitFor(() =>
    expect(lastPayload().contentSpec.values["photo"]).toMatchObject({ sha256: previousSha }),
  )
  await userEvent.upload(input, new File(["falha"], "outra.png", { type: "image/png" }))

  expect(await screen.findByRole("alert")).toHaveTextContent("A foto não pôde ser enviada.")
  expect(lastPayload().contentSpec.values["photo"]).toMatchObject({ sha256: previousSha })
})

it("erro técnico de upload vira mensagem canônica em PT-BR", async () => {
  renderEditor(
    kitClient({ uploadAsset: vi.fn(async () => Promise.reject(new Error("Failed to fetch"))) }),
    "quote-post-1x1",
  )
  await userEvent.click(await screen.findByRole("button", { name: "Foto" }))
  const input = await screen.findByTestId("slot-image-input-photo")
  await userEvent.upload(input, new File(["foto"], "foto.png", { type: "image/png" }))

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Não foi possível enviar a foto.",
  )
  expect(document.body).not.toHaveTextContent("Failed to fetch")
})

it("texto vazio remove o slot do conteúdo da prévia", async () => {
  renderEditor(kitClient())
  const input = await screen.findByTestId("slot-input-headline")
  await userEvent.type(input, "Rascunho")
  await userEvent.clear(input)

  await waitFor(() =>
    expect(lastPayload().contentSpec.values).not.toHaveProperty("headline"),
  )
})

it("layout inexistente mostra o alerta normativo", async () => {
  renderEditor(kitClient(), "layout-ausente")

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Layout não encontrado neste kit.",
  )
})

it("falha técnica ao abrir o editor vira mensagem canônica em PT-BR", async () => {
  renderEditor(
    kitClient({
      getKit: vi.fn(async () => Promise.reject(new Error("Internal connection reset"))),
    }),
  )

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Não foi possível abrir o editor.",
  )
  expect(document.body).not.toHaveTextContent("Internal connection reset")
})

it("slot de logo não vira campo de formulário", async () => {
  renderEditor(kitClient())
  await screen.findByTestId("slot-input-headline")
  expect(screen.queryByTestId("slot-input-logo")).not.toBeInTheDocument()
  expect(screen.queryByTestId("slot-image-input-logo")).not.toBeInTheDocument()
})

it("expõe os controles gráficos completos pedidos para a camada de texto", async () => {
  renderEditor(kitClient())
  await screen.findByTestId("slot-input-headline")
  expect(screen.getByLabelText("Família")).toBeInTheDocument()
  expect(screen.getByLabelText("Peso")).toBeInTheDocument()
  expect(screen.getByLabelText("Tamanho")).toBeInTheDocument()
  expect(screen.getByLabelText("Opacidade")).toBeInTheDocument()
  expect(screen.getByLabelText("X")).toBeInTheDocument()
  expect(screen.getByLabelText("L")).toBeInTheDocument()
})

it("edita tipografia, posição, opacidade e escala da logo no arquivo final", async () => {
  renderEditor(kitClient())
  await screen.findByTestId("slot-input-headline")

  await userEvent.selectOptions(screen.getByLabelText("Peso"), "800")
  fireEvent.change(screen.getByLabelText("Tamanho"), { target: { value: "86" } })
  fireEvent.change(screen.getByLabelText("Opacidade"), { target: { value: "62" } })
  fireEvent.change(screen.getByLabelText("X"), { target: { value: "70" } })

  fireEvent.keyDown(screen.getByTestId("canvas-selection"), {
    key: "ArrowRight",
    code: "ArrowRight",
  })

  await waitFor(() =>
    expect(lastPayload().contentSpec.overrides?.headline).toMatchObject({
      area: [71, 324, 984, 432],
      fontSizePx: 86,
      fontWeight: 800,
      opacity: 0.62,
    }),
  )

  await userEvent.click(screen.getByRole("button", { name: "Logo" }))
  fireEvent.change(screen.getByLabelText("X"), { target: { value: "800" } })
  fireEvent.change(screen.getByLabelText("Y"), { target: { value: "800" } })
  fireEvent.change(screen.getByLabelText("L"), { target: { value: "220" } })
  fireEvent.change(screen.getByLabelText("A"), { target: { value: "180" } })
  fireEvent.change(screen.getByLabelText("Opacidade"), { target: { value: "44" } })

  await waitFor(() =>
    expect(lastPayload().contentSpec.overrides?.logo).toMatchObject({
      area: [800, 800, 220, 180],
      opacity: 0.44,
    }),
  )
})

it("arrasta com o ponteiro a camada de texto que já está selecionada", async () => {
  renderEditor(kitClient())
  await screen.findByTestId("slot-input-headline")

  const selection = screen.getByTestId("canvas-selection")
  expect(selection).toHaveAccessibleName(
    "Camada Frase principal selecionada. Arraste para mover ou use as setas do teclado.",
  )

  fireEvent(selection, new MouseEvent("pointerdown", {
    bubbles: true,
    button: 0,
    clientX: 120,
    clientY: 240,
  }))
  fireEvent(selection, new MouseEvent("pointermove", {
    bubbles: true,
    clientX: 140,
    clientY: 250,
  }))

  expect(selection).toHaveStyle({ left: "88px", top: "344px" })
  expect(screen.getByTestId("preview-canvas")).toHaveAttribute("data-dragging", "true")

  fireEvent(selection, new MouseEvent("pointerup", {
    bubbles: true,
    clientX: 140,
    clientY: 250,
  }))

  await waitFor(() =>
    expect(lastPayload().contentSpec.overrides?.headline?.area).toEqual([88, 344, 984, 432]),
  )
  expect(screen.getByTestId("canvas-selection")).toHaveAttribute("data-layer", "headline")
  expect(screen.getByTestId("preview-canvas")).not.toHaveAttribute("data-dragging")
})
