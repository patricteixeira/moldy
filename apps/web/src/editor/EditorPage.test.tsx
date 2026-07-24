import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { ApiProvider } from "../api/context"
import { ApiError } from "../api/client"
import type { ApiClient, BrandIr, ContentSpec } from "../api/types"
import {
  FAKE_IR,
  fakeCarousel,
  fakeClient,
  fakeEditorialLayout,
  fakeOnePagerLayout,
  fakeQuoteLayout,
  fakeStatementLayout,
} from "../test/fakeApi"
import { mounts } from "../test/renderStub"
import { EditorPage } from "./EditorPage"

function renderEditor(
  client: ApiClient,
  layoutId = "statement-post-1x1",
  initialPath = `/marcas/brandrev_test/editor/${layoutId}`,
) {
  render(
    <ApiProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
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

it("mantém o canvas antes dos painéis na ordem de leitura", async () => {
  renderEditor(kitClient())

  const canvas = await screen.findByRole("region", { name: "Área da peça" })
  const layers = screen.getByRole("complementary", { name: "Itens da peça" })

  expect(canvas.compareDocumentPosition(layers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
  await userEvent.click(screen.getByRole("button", { name: "Desfazer todos os ajustes" }))

  expect(screen.getByTestId("slot-input-headline")).toHaveValue("Novidade da ACME.")
  await waitFor(() =>
    expect(JSON.parse(window.localStorage.getItem(key) ?? "{}")).toMatchObject({
      version: 5,
      values: { headline: { kind: "text", text: "Novidade da ACME." } },
      backgroundColorToken: null,
      assetBindings: {},
    }),
  )
})

it("adiciona, edita, duplica e remove elementos livres da peça individual", async () => {
  renderEditor(kitClient())
  await screen.findByTestId("slot-input-headline")

  await userEvent.click(screen.getByText("+ Adicionar elemento"))
  const menu = screen.getByRole("group", { name: "Elementos disponíveis" })
  await userEvent.click(within(menu).getByRole("button", { name: "Adicionar texto" }))

  const customText = await screen.findByRole("textbox", { name: "Bloco de texto" })
  expect(customText).toHaveValue("Novo bloco de texto")
  await userEvent.clear(customText)
  await userEvent.type(customText, "Uma segunda voz na composição")
  await waitFor(() =>
    expect(lastPayload().contentSpec).toMatchObject({
      values: {
        "user-text-1": { kind: "text", text: "Uma segunda voz na composição" },
      },
      addedSlots: [{ id: "user-kicker-1" }, { id: "user-signature-1" }, { id: "user-support-1" }, { id: "user-text-1" }],
    }),
  )

  await userEvent.click(screen.getByRole("button", { name: "Duplicar" }))
  await waitFor(() =>
    expect(lastPayload().contentSpec.addedSlots?.some((slot) => slot.id === "user-text-2")).toBe(true),
  )
  await userEvent.click(screen.getByRole("button", { name: "Remover" }))
  await waitFor(() =>
    expect(lastPayload().contentSpec.addedSlots?.some((slot) => slot.id === "user-text-2")).toBe(false),
  )

  await userEvent.click(within(menu).getByRole("button", { name: "Adicionar forma ou linha" }))
  await waitFor(() =>
    expect(lastPayload().contentSpec.addedLayers?.some((layer) => layer.id === "user-shape-1")).toBe(true),
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
    "Modelo não encontrado neste kit.",
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

it("troca o fundo por qualquer cor da marca e permite voltar ao modelo", async () => {
  renderEditor(kitClient())
  await screen.findByTestId("slot-input-headline")

  const colorChoices = screen.getByRole("group", { name: "Cor de fundo da peça" })
  expect(within(colorChoices).getAllByRole("button")).toHaveLength(
    Object.keys(FAKE_IR.colors).length,
  )
  await userEvent.click(
    within(colorChoices).getByRole("button", { name: "Fundo: Principal, #1A4D8F" }),
  )
  await waitFor(() =>
    expect(lastPayload().contentSpec.backgroundColorToken).toBe("color.primary"),
  )
  expect(
    within(colorChoices).getByRole("button", { name: "Fundo: Principal, #1A4D8F" }),
  ).toHaveAttribute("aria-pressed", "true")

  await userEvent.click(screen.getByRole("button", { name: "Usar o fundo do modelo" }))
  await waitFor(() => expect(lastPayload().contentSpec.backgroundColorToken).toBeNull())
  expect(
    within(colorChoices).getByRole("button", { name: "Fundo: Fundo, #FFFFFF" }),
  ).toHaveAttribute("aria-pressed", "true")
})

it("abre o conteúdo gerado de um slide e salva a edição de volta no carrossel", async () => {
  const carousel = fakeCarousel()
  const slide = carousel.slides[0]
  const updateCarouselSlide = vi.fn(async (_carouselId, _slideId, content: ContentSpec) => ({
    ...slide,
    content,
  }))
  renderEditor(
    kitClient({
      getCarousel: vi.fn(async () => carousel),
      updateCarouselSlide,
    }),
    slide.layoutId,
    `/marcas/${FAKE_IR.revision.id}/editor/${slide.layoutId}?carouselId=${carousel.id}&slideId=${slide.id}`,
  )

  const headline = await screen.findByTestId("slot-input-headline")
  expect(headline).toHaveValue("Capa")
  expect(screen.getByRole("link", { name: /Carrossel/ })).toHaveAttribute(
    "href",
    `/marcas/${FAKE_IR.revision.id}/carrossel?carouselId=${carousel.id}`,
  )

  await userEvent.clear(headline)
  await userEvent.type(headline, "Capa refinada")
  await userEvent.click(screen.getByRole("button", { name: "Salvar no carrossel" }))

  await waitFor(() =>
    expect(updateCarouselSlide).toHaveBeenCalledWith(
      carousel.id,
      slide.id,
      expect.objectContaining({
        values: expect.objectContaining({
          headline: { kind: "text", text: "Capa refinada" },
        }),
      }),
    ),
  )
  expect(await screen.findByRole("button", { name: "Salvo no carrossel" })).toBeInTheDocument()
})

it("salva o slide atual e navega para o próximo ou o anterior dentro do editor", async () => {
  const user = userEvent.setup()
  const carousel = fakeCarousel()
  const updateCarouselSlide = vi.fn(async (_carouselId, slideId, content: ContentSpec) => {
    const slide = carousel.slides.find((candidate) => candidate.id === slideId)
    if (!slide) throw new Error("Slide ausente")
    return { ...slide, content }
  })
  renderEditor(
    kitClient({
      getCarousel: vi.fn(async () => carousel),
      updateCarouselSlide,
    }),
    carousel.slides[0].layoutId,
    `/marcas/${FAKE_IR.revision.id}/editor/${carousel.slides[0].layoutId}?carouselId=${carousel.id}&slideId=${carousel.slides[0].id}`,
  )

  expect(await screen.findByTestId("slot-input-headline")).toHaveValue("Capa")
  expect(screen.getByLabelText("Slide 1 de 3")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Slide anterior" })).toBeDisabled()

  await user.click(screen.getByRole("button", { name: "Próximo slide" }))

  await waitFor(() =>
    expect(updateCarouselSlide).toHaveBeenCalledWith(
      carousel.id,
      carousel.slides[0].id,
      expect.any(Object),
    ),
  )
  await waitFor(() =>
    expect(screen.getByTestId("slot-input-headline")).toHaveValue("Conteúdo"),
  )
  expect(screen.getByLabelText("Slide 2 de 3")).toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: "Slide anterior" }))
  await waitFor(() => expect(screen.getByTestId("slot-input-headline")).toHaveValue("Capa"))
  expect(updateCarouselSlide).toHaveBeenCalledWith(
    carousel.id,
    carousel.slides[1].id,
    expect.any(Object),
  )
})

it("troca somente a cor do texto selecionado e mantém a troca global de logo", async () => {
  renderEditor(kitClient())
  await screen.findByTestId("slot-input-headline")

  const textChoices = screen.getByRole("group", { name: "Cor do item: Frase principal" })
  await userEvent.click(
    within(textChoices).getByRole("button", { name: "Frase principal: Principal, #1A4D8F" }),
  )
  await waitFor(() => {
    const overrides = lastPayload().contentSpec.overrides ?? {}
    expect(overrides.headline?.colorToken).toBe("color.primary")
  })
  expect(screen.queryByText("Todos os textos")).not.toBeInTheDocument()

  await userEvent.selectOptions(screen.getByLabelText("Versão da logo"), "logo.onLight")
  await waitFor(() =>
    expect(lastPayload().contentSpec.assetBindings).toEqual({ logo: "logo.onLight" }),
  )

  await userEvent.click(
    screen.getByRole("button", { name: "Usar a cor do modelo para Frase principal" }),
  )
  await waitFor(() => {
    const overrides = lastPayload().contentSpec.overrides ?? {}
    expect(overrides.headline?.colorToken).toBeNull()
  })
})

it("permite escolher uma variante de logo por slot e restaurar o automático", async () => {
  renderEditor(kitClient())
  await screen.findByTestId("slot-input-headline")
  await userEvent.click(screen.getByRole("button", { name: "Logo" }))

  const selector = screen.getByRole("combobox", { name: "Logo usada neste item" })
  expect(selector).toHaveValue("")
  expect(
    within(selector).getByRole("option", { name: "Automática para o fundo" }),
  ).toBeInTheDocument()
  expect(within(selector).getByRole("option", { name: "Principal" })).toBeInTheDocument()
  expect(
    within(selector).getByRole("option", { name: "Escura · para fundo claro" }),
  ).toBeInTheDocument()
  expect(
    within(selector).getByRole("option", { name: "Clara · para fundo escuro" }),
  ).toBeInTheDocument()

  await userEvent.selectOptions(selector, "logo.onLight")
  await waitFor(() =>
    expect(lastPayload().contentSpec.assetBindings).toEqual({ logo: "logo.onLight" }),
  )
  await userEvent.selectOptions(selector, "")
  await waitFor(() => expect(lastPayload().contentSpec.assetBindings).toEqual({}))
})

it("mostra todas as logos carregadas mesmo sem um par semântico claro e escuro", async () => {
  const brandIr: BrandIr = {
    ...FAKE_IR,
    assets: {
      "logo.primary": FAKE_IR.assets["logo.primary"],
      "logo.variant.creme": {
        ...FAKE_IR.assets["logo.primary"],
        path: "assets/logos/vetor_v3_creme_geo_grossa_4096.png",
        sha256: "c".repeat(64),
        format: "png",
      },
      "logo.variant.verde": {
        ...FAKE_IR.assets["logo.primary"],
        path: "assets/logos/vetor_v3_verde_geo_grossa_4096.png",
        sha256: "d".repeat(64),
        format: "png",
      },
    },
  }
  renderEditor(kitClient({ getBrandRevision: vi.fn(async () => brandIr) }))
  await screen.findByTestId("slot-input-headline")
  await userEvent.click(screen.getByRole("button", { name: "Logo" }))

  const selector = screen.getByRole("combobox", { name: "Logo usada neste item" })
  expect(within(selector).getByRole("option", { name: "Principal" })).toBeInTheDocument()
  expect(
    within(selector).getByRole("option", { name: "Vetor v3 creme geo grossa 4096" }),
  ).toBeInTheDocument()
  expect(
    within(selector).getByRole("option", { name: "Vetor v3 verde geo grossa 4096" }),
  ).toBeInTheDocument()
  expect(screen.getByText(/Você carregou 3 versões/)).toBeInTheDocument()
  expect(screen.queryByText(/Esta revisão tem apenas uma versão/)).not.toBeInTheDocument()

  await userEvent.selectOptions(selector, "logo.variant.verde")
  await waitFor(() =>
    expect(lastPayload().contentSpec.assetBindings).toEqual({ logo: "logo.variant.verde" }),
  )
})

it("edita a logo estrutural de um template como qualquer outra camada", async () => {
  renderEditor(
    fakeClient({ getKit: vi.fn(async () => [fakeEditorialLayout()]) }),
    "editorial-light-post-4x5",
  )
  await screen.findByRole("textbox", { name: "Frase principal" })

  await userEvent.click(screen.getByRole("button", { name: "Logo" }))
  const selector = screen.getByRole("combobox", { name: "Logo usada neste item" })
  expect(selector).toHaveValue("")
  expect(
    within(selector).getByRole("option", { name: "Escura · para fundo claro" }),
  ).toBeInTheDocument()
  expect(screen.getByLabelText("X")).toBeInTheDocument()
  expect(screen.getByLabelText("Opacidade")).toBeInTheDocument()
  expect(screen.getByLabelText("Visível")).toBeInTheDocument()

  await userEvent.selectOptions(selector, "logo.onDark")
  await waitFor(() =>
    expect(lastPayload().contentSpec.assetBindings).toEqual({ "brand-mark": "logo.onDark" }),
  )
})

it("oferece edição para textos, formas, grafismos e assets estruturais", async () => {
  renderEditor(
    fakeClient({ getKit: vi.fn(async () => [fakeEditorialLayout()]) }),
    "editorial-light-post-4x5",
  )
  await screen.findByRole("textbox", { name: "Frase principal" })

  await userEvent.click(screen.getByRole("button", { name: "Linha de destaque" }))
  expect(
    screen.getByRole("group", { name: "Cor do item: Linha de destaque" }),
  ).toBeInTheDocument()
  expect(screen.getByLabelText("L")).toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: "Campo diagonal" }))
  expect(screen.getByLabelText("Traço")).toBeInTheDocument()
  expect(screen.getByLabelText("Intervalo")).toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: "Frase principal" }))
  expect(screen.getByRole("textbox", { name: "Frase principal" })).toBeInTheDocument()
  expect(screen.getByLabelText("Fonte")).toBeInTheDocument()
})

it("expõe os controles gráficos completos pedidos para a camada de texto", async () => {
  renderEditor(kitClient())
  await screen.findByTestId("slot-input-headline")
  expect(screen.getByLabelText("Fonte")).toBeInTheDocument()
  expect(screen.getByLabelText("Peso")).toBeInTheDocument()
  expect(screen.getByLabelText("Tamanho")).toBeInTheDocument()
  expect(screen.getByLabelText("Opacidade")).toBeInTheDocument()
  expect(screen.getByLabelText("X")).toBeInTheDocument()
  expect(screen.getByLabelText("L")).toBeInTheDocument()
})

it("explica e aplica uma estrutura derivada da identidade, não um preset cromático", async () => {
  const brandIr: BrandIr = {
    ...FAKE_IR,
    schemaVersion: "0.4.0",
    identity: {
      essence: "Tecnologia precisa para uma criação radical e dinâmica.",
      personality: "Geométrica, modular e rigorosa.",
      voice: "Direta e enfática.",
      avoid: "Decoração sem função.",
      evidence: [],
    },
    creativeDirection: {
      energy: { value: 0.75, confidence: 0.75, evidenceTerms: ["dinamica", "radical"] },
      geometry: { value: 1, confidence: 0.75, evidenceTerms: ["geometrica", "modular"] },
      density: { value: 0, confidence: 0, evidenceTerms: [] },
      formality: { value: 0.5, confidence: 0.5, evidenceTerms: ["rigorosa"] },
      materiality: { value: 1, confidence: 0.25, evidenceTerms: ["tecnologia"] },
      contrast: { value: 1, confidence: 0.5, evidenceTerms: ["radical", "enfatica"] },
      composition: "expansive" as const,
      surface: "technical-grid" as const,
      scaleContrast: 0.9,
      negativeSpace: 0.35,
      bleed: 0.85,
      surfaceDensity: 0.52,
      rationalePt: [
        "A identidade se declara expansiva; sinais confirmados: “dinâmica”, “radical”.",
        "A identidade se declara geométrica; sinais confirmados: “geométrica”, “modular”.",
        "A estrutura usa contraste de escala e sangria como parte da expressão.",
      ],
    },
  }
  renderEditor(kitClient({ getBrandRevision: vi.fn(async () => brandIr) }))

  expect(await screen.findByText("Títulos maiores")).toBeInTheDocument()
  expect(screen.getByText(/sinais confirmados: “dinâmica”, “radical”/i)).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Aplicar esta sugestão" }))

  await waitFor(() => {
    const content = lastPayload().contentSpec
    expect(content.surface).toMatchObject({
      kind: "technical-grid",
      colorToken: "color.primary",
    })
    expect(content.overrides?.logo?.area?.[0]).toBeLessThan(0)
    expect(content.overrides?.logo?.area?.[2]).toBeGreaterThan(1080)
  })
  expect(screen.getByText("Ajustar Grade técnica")).toBeInTheDocument()
})

it("recomenda texturas pela marca e mantém o catálogo completo disponível", async () => {
  const brandIr: BrandIr = {
    ...FAKE_IR,
    creativeDirection: {
      energy: { value: 0.75, confidence: 0.75, evidenceTerms: ["dinamica"] },
      geometry: { value: 1, confidence: 0.75, evidenceTerms: ["geometrica"] },
      density: { value: 0.25, confidence: 0.5, evidenceTerms: ["camadas"] },
      formality: { value: 0.7, confidence: 0.5, evidenceTerms: ["rigorosa"] },
      materiality: { value: 0.8, confidence: 0.5, evidenceTerms: ["digital"] },
      contrast: { value: 0.8, confidence: 0.5, evidenceTerms: ["impacto"] },
      composition: "modular",
      surface: "technical-grid",
      scaleContrast: 0.8,
      negativeSpace: 0.4,
      bleed: 0.5,
      surfaceDensity: 0.55,
      rationalePt: ["A marca se declara precisa."],
    },
  }
  renderEditor(kitClient({ getBrandRevision: vi.fn(async () => brandIr) }))

  expect(await screen.findByRole("heading", { name: "Para esta marca" })).toBeInTheDocument()
  expect(screen.getByLabelText("Texturas sugeridas para esta marca").children).toHaveLength(4)
  await userEvent.click(screen.getByRole("button", { name: "Ver todas as 20 texturas" }))

  const catalog = screen.getByLabelText("Todas as texturas")
  expect(within(catalog).getAllByTestId("surface-option")).toHaveLength(20)
  await userEvent.click(within(catalog).getByRole("button", { name: /Trama têxtil/ }))
  await waitFor(() => expect(lastPayload().contentSpec.surface?.kind).toBe("woven"))

  await userEvent.click(screen.getByRole("button", { name: "Pontos e impressão" }))
  expect(screen.getByText("2 texturas")).toBeInTheDocument()
  expect(within(catalog).getAllByTestId("surface-option")).toHaveLength(2)
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
  fireEvent.change(screen.getByLabelText("X"), { target: { value: "-180" } })
  fireEvent.change(screen.getByLabelText("Y"), { target: { value: "760" } })
  fireEvent.change(screen.getByLabelText("L"), { target: { value: "1600" } })
  fireEvent.change(screen.getByLabelText("A"), { target: { value: "900" } })
  fireEvent.change(screen.getByLabelText("Rotação"), { target: { value: "37" } })
  fireEvent.change(screen.getByLabelText("Opacidade"), { target: { value: "44" } })

  await waitFor(() =>
    expect(lastPayload().contentSpec.overrides?.logo).toMatchObject({
      area: [-180, 760, 1600, 900],
      rotationDeg: 37,
      opacity: 0.44,
    }),
  )
})

it("arrasta com o ponteiro a camada de texto que já está selecionada", async () => {
  renderEditor(kitClient())
  await screen.findByTestId("slot-input-headline")

  const selection = screen.getByTestId("canvas-selection")
  expect(selection).toHaveAccessibleName(
    "Item Frase principal selecionado. Arraste para mover, use as oito alças para redimensionar ou o ponto circular para girar.",
  )

  fireEvent(selection, new MouseEvent("pointerdown", {
    bubbles: true,
    button: 0,
    clientX: 120,
    clientY: 240,
  }))
  fireEvent(selection, new MouseEvent("pointermove", {
    bubbles: true,
    clientX: 155,
    clientY: 260,
  }))

  expect(selection).toHaveStyle({ left: "118px", top: "367px" })
  expect(screen.getByTestId("preview-canvas")).toHaveAttribute("data-dragging", "true")

  fireEvent(selection, new MouseEvent("pointerup", {
    bubbles: true,
    clientX: 155,
    clientY: 260,
  }))

  await waitFor(() =>
    expect(lastPayload().contentSpec.overrides?.headline?.area).toEqual([118, 367, 984, 432]),
  )
  expect(screen.getByTestId("canvas-selection")).toHaveAttribute("data-layer", "headline")
  expect(screen.getByTestId("preview-canvas")).not.toHaveAttribute("data-dragging")
})

it("abre o editor com o título testado na lista de modelos", async () => {
  renderEditor(
    kitClient(),
    "statement-post-1x1",
    "/marcas/brandrev_test/editor/statement-post-1x1?headline=Nova%20cole%C3%A7%C3%A3o",
  )

  expect(await screen.findByTestId("slot-input-headline")).toHaveValue("Nova coleção")
})

it("preserva o rascunho salvo mesmo quando o endereço contém um título de teste", async () => {
  window.localStorage.setItem(
    "brand-runtime:editor-draft:v1:brandrev_test:statement-post-1x1",
    JSON.stringify({
      version: 1,
      values: { headline: { kind: "text", text: "Rascunho já salvo" } },
    }),
  )

  renderEditor(
    kitClient(),
    "statement-post-1x1",
    "/marcas/brandrev_test/editor/statement-post-1x1?headline=Outro%20t%C3%ADtulo",
  )

  expect(await screen.findByTestId("slot-input-headline")).toHaveValue("Rascunho já salvo")
})

it("redimensiona a seleção por qualquer uma das oito alças", async () => {
  renderEditor(kitClient())
  await screen.findByTestId("slot-input-headline")

  const selection = screen.getByTestId("canvas-selection")
  const handles = selection.querySelectorAll("[data-resize-handle]")
  expect(Array.from(handles, (handle) => handle.getAttribute("data-resize-handle"))).toEqual([
    "nw",
    "n",
    "ne",
    "e",
    "se",
    "s",
    "sw",
    "w",
  ])

  const northwest = selection.querySelector<HTMLElement>('[data-resize-handle="nw"]')!
  fireEvent(northwest, new MouseEvent("pointerdown", {
    bubbles: true,
    button: 0,
    clientX: 83,
    clientY: 324,
  }))
  fireEvent(selection, new MouseEvent("pointermove", {
    bubbles: true,
    altKey: true,
    clientX: 63,
    clientY: 314,
  }))

  expect(selection).toHaveStyle({
    left: "8px",
    top: "304px",
    width: "1024px",
    height: "452px",
  })

  fireEvent(selection, new MouseEvent("pointerup", {
    bubbles: true,
    clientX: 63,
    clientY: 314,
  }))

  await waitFor(() =>
    expect(lastPayload().contentSpec.overrides?.headline?.area).toEqual([8, 304, 1024, 452]),
  )
})

it("gira a seleção diretamente no canvas e preserva a rotação no conteúdo", async () => {
  renderEditor(kitClient())
  await screen.findByTestId("slot-input-headline")

  const selection = screen.getByTestId("canvas-selection")
  const rotationHandle = screen.getByRole("button", { name: /Girar Frase principal/ })
  fireEvent(rotationHandle, new MouseEvent("pointerdown", {
    bubbles: true,
    button: 0,
    clientX: 270,
    clientY: 210,
  }))
  fireEvent(selection, new MouseEvent("pointermove", {
    bubbles: true,
    clientX: 330,
    clientY: 270,
  }))

  expect(selection).toHaveStyle({ transform: "rotate(90deg)" })
  expect(screen.getByTestId("preview-canvas")).toHaveAttribute("data-transforming", "rotate")

  fireEvent(selection, new MouseEvent("pointerup", {
    bubbles: true,
    clientX: 330,
    clientY: 270,
  }))

  await waitFor(() =>
    expect(lastPayload().contentSpec.overrides?.headline?.rotationDeg).toBe(90),
  )
  expect(screen.getByLabelText("Rotação")).toHaveValue(90)
})

it("encaixa e mostra uma referência quando a camada alinha com a peça", async () => {
  renderEditor(kitClient())
  await screen.findByTestId("slot-input-headline")

  const selection = screen.getByTestId("canvas-selection")
  fireEvent(selection, new MouseEvent("pointerdown", {
    bubbles: true,
    button: 0,
    clientX: 120,
    clientY: 240,
  }))
  fireEvent(selection, new MouseEvent("pointermove", {
    bubbles: true,
    clientX: 145,
    clientY: 240,
  }))

  expect(selection).toHaveStyle({ left: "96px" })
  expect(screen.getByTestId("alignment-guide-x")).toHaveAttribute("data-target", "canvas")
  expect(screen.getByTestId("preview-canvas")).toHaveAttribute("data-aligning", "true")
  expect(within(screen.getByTestId("preview-canvas")).getByRole("status")).toHaveTextContent(
    "Direita · peça",
  )

  fireEvent(selection, new MouseEvent("pointerup", {
    bubbles: true,
    clientX: 145,
    clientY: 240,
  }))

  await waitFor(() =>
    expect(lastPayload().contentSpec.overrides?.headline?.area).toEqual([96, 324, 984, 432]),
  )
  expect(screen.queryByTestId("alignment-guide-x")).not.toBeInTheDocument()
  expect(screen.getByTestId("preview-canvas")).not.toHaveAttribute("data-aligning")
})

it("mantém movimento livre quando Alt está pressionado", async () => {
  renderEditor(kitClient())
  await screen.findByTestId("slot-input-headline")

  const selection = screen.getByTestId("canvas-selection")
  fireEvent(selection, new MouseEvent("pointerdown", {
    bubbles: true,
    button: 0,
    clientX: 120,
    clientY: 240,
  }))
  fireEvent(selection, new MouseEvent("pointermove", {
    bubbles: true,
    altKey: true,
    clientX: 145,
    clientY: 240,
  }))

  expect(selection).toHaveStyle({ left: "98px" })
  expect(screen.queryByTestId("alignment-guide-x")).not.toBeInTheDocument()

  fireEvent(selection, new MouseEvent("pointercancel", {
    bubbles: true,
    clientX: 145,
    clientY: 240,
  }))
})
