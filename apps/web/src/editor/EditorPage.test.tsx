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
  await userEvent.type(input, "Olá mundo")
  await waitFor(() =>
    expect(lastPayload().contentSpec.values["headline"]).toEqual({ kind: "text", text: "Olá mundo" }),
  )
})

it("oferece destaque leigo no arquétipo editorial e o preserva ao editar a frase", async () => {
  renderEditor(
    fakeClient({ getKit: vi.fn(async () => [fakeEditorialLayout()]) }),
    "editorial-light-post-4x5",
  )

  const headline = await screen.findByRole("textbox", { name: "Frase principal" })
  expect(screen.getByRole("textbox", { name: "Trecho em destaque" })).toBeDisabled()

  await userEvent.type(headline, "A ideia vira forma")
  const emphasis = screen.getByRole("textbox", { name: "Trecho em destaque" })
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
  await userEvent.type(headline, "Uma ideia")
  const emphasis = screen.getByRole("textbox", { name: "Trecho em destaque" })
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

it("nomeia os campos editoriais em PT-BR sem expor o contrato técnico", async () => {
  renderEditor(
    fakeClient({ getKit: vi.fn(async () => [fakeEditorialLayout()]) }),
    "editorial-light-post-4x5",
  )

  await screen.findByRole("textbox", { name: "Frase principal" })
  expect(
    screen.getByRole("textbox", { name: "Frase de apoio (opcional)" }),
  ).toBeInTheDocument()
  expect(screen.getByRole("textbox", { name: "Número" })).toBeInTheDocument()
  expect(screen.getByRole("textbox", { name: "Assinatura (opcional)" })).toBeInTheDocument()

  const visible = document.body.textContent ?? ""
  expect(visible).not.toMatch(/#[0-9A-Fa-f]{6}/)
  expect(visible).not.toMatch(/\bpx\b/i)
  expect(visible).not.toMatch(/token|compositionMode|lockedLayers/i)
})

it("layout legado não ganha o campo de destaque", async () => {
  renderEditor(kitClient())
  await screen.findByTestId("slot-input-headline")
  expect(screen.queryByRole("textbox", { name: "Trecho em destaque" })).not.toBeInTheDocument()
})

it("contador marca excesso sem truncar o texto", async () => {
  renderEditor(kitClient())
  const input = await screen.findByTestId("slot-input-headline")
  await userEvent.click(input)
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

it("o leigo nunca vê jargão: hex, px, nome de fonte ou token", async () => {
  renderEditor(kitClient())
  await screen.findByTestId("slot-input-headline")
  const visible = document.body.textContent ?? ""
  expect(visible).not.toMatch(/#[0-9A-Fa-f]{6}/)
  expect(visible).not.toMatch(/\bpx\b/i)
  expect(visible).not.toMatch(/token/i)
  expect(visible).not.toContain("Fixture Sans") // fonte do FAKE_IR
})
