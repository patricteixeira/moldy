import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { expect, it, vi } from "vitest"
import { ApiProvider } from "../api/context"
import type { ApiClient } from "../api/types"
import { FAKE_IR, fakeCarousel, fakeClient, fakeEditorialLayout } from "../test/fakeApi"
import { CarouselPage } from "./CarouselPage"

function renderCarousel(client: ApiClient, initialPath = "/marcas/brandrev_x/carrossel") {
  render(
    <ApiProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/marcas/:revisionId/carrossel" element={<CarouselPage />} />
        </Routes>
      </MemoryRouter>
    </ApiProvider>,
  )
}

it("reabre uma sequência salva pela URL e mantém cada slide ligado ao editor", async () => {
  const carousel = fakeCarousel()
  const getCarousel = vi.fn(async () => carousel)
  renderCarousel(
    fakeClient({ getCarousel }),
    `/marcas/${FAKE_IR.revision.id}/carrossel?carouselId=${carousel.id}`,
  )

  expect(await screen.findByRole("heading", { name: carousel.name })).toBeInTheDocument()
  expect(getCarousel).toHaveBeenCalledWith(carousel.id)
  const editLinks = screen.getAllByRole("link", { name: /Editar slide/i })
  expect(editLinks).toHaveLength(3)
  expect(editLinks[0]).toHaveAttribute(
    "href",
    `/marcas/${FAKE_IR.revision.id}/editor/statement-post-1x1?carouselId=${carousel.id}&slideId=slide_1`,
  )
})

it("explica capa, conteúdo e fechamento e permite escolher até 20 slides", async () => {
  const user = userEvent.setup()
  renderCarousel(fakeClient())

  await screen.findByRole("heading", { name: "Modo Carrossel" })
  const count = screen.getByRole("combobox", { name: /Quantidade de slides/ })
  await user.selectOptions(count, "10")

  expect(screen.getByRole("button", { name: /01 Capa/ })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /10 Fechamento/ })).toBeInTheDocument()
  expect(screen.getAllByRole("button", { name: /Conteúdo/ })).toHaveLength(8)
})

it("adiciona e remove blocos de texto no miolo", async () => {
  const user = userEvent.setup()
  renderCarousel(fakeClient())

  await screen.findByRole("heading", { name: "Modo Carrossel" })
  await user.click(screen.getByRole("button", { name: /02 Conteúdo/ }))
  await user.click(screen.getByRole("button", { name: "+ Adicionar bloco" }))
  await user.click(screen.getByRole("button", { name: "+ Adicionar bloco" }))

  expect(screen.getByLabelText("Bloco 1")).toBeInTheDocument()
  expect(screen.getByLabelText("Bloco 2")).toBeInTheDocument()
  await user.click(screen.getAllByRole("button", { name: "Remover" })[0])
  expect(screen.queryByLabelText("Bloco 2")).not.toBeInTheDocument()
})

it("mostra os modelos individuais compatíveis e permite escolher um por slide", async () => {
  const user = userEvent.setup()
  const first = {
    ...fakeEditorialLayout(),
    id: "typographic-ledger-post-4x5",
    namePt: "Registro editorial",
    templateRef: {
      packageId: "typographic-editorial",
      version: "1.0.0",
      compositionId: "ledger",
      sceneSchemaVersion: "2.0.0" as const,
    },
  }
  const second = {
    ...fakeEditorialLayout(),
    id: "typographic-monument-post-4x5",
    namePt: "Monumento tipográfico",
    templateRef: {
      packageId: "typographic-editorial",
      version: "1.0.0",
      compositionId: "monument",
      sceneSchemaVersion: "2.0.0" as const,
    },
  }
  renderCarousel(fakeClient({ getKit: vi.fn(async () => [first, second]) }))

  await user.click(await screen.findByRole("button", { name: /Todos/ }))
  await screen.findByRole("heading", { name: "Escolha qualquer modelo do kit" })
  expect(screen.getByText(/2 modelos compatíveis com este formato/)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Usar Registro editorial" })).toBeInTheDocument()
  const secondChoice = screen.getByRole("button", { name: "Usar Monumento tipográfico" })
  await user.click(secondChoice)
  expect(secondChoice).toHaveAttribute("aria-pressed", "true")
  expect(screen.getAllByText("Tipográfico editorial").length).toBeGreaterThan(0)
})

it("usa composição inteligente por padrão e permite retomá-la depois de uma escolha manual", async () => {
  const user = userEvent.setup()
  renderCarousel(fakeClient())

  const automatic = await screen.findByRole("button", { name: "Usar composição inteligente" })
  expect(automatic).toHaveAttribute("aria-pressed", "true")

  const manual = screen.getByRole("button", { name: "Usar Editorial claro" })
  await user.click(manual)
  expect(manual).toHaveAttribute("aria-pressed", "true")
  expect(automatic).toHaveAttribute("aria-pressed", "false")

  await user.click(automatic)
  expect(automatic).toHaveAttribute("aria-pressed", "true")
  expect(screen.getByText(/Sem foto, não escolhe modelos fotográficos/)).toBeInTheDocument()
})

it("mostra o modelo completo ao passar o mouse ou focar o cartão", async () => {
  const user = userEvent.setup()
  renderCarousel(fakeClient())

  const choice = await screen.findByRole("button", { name: "Usar Editorial claro" })
  await user.hover(choice)

  expect(
    screen.getByRole("complementary", { name: "Prévia ampliada de Editorial claro" }),
  ).toBeInTheDocument()

  await user.unhover(choice)
  expect(screen.queryByTestId("carousel-template-hover-preview")).not.toBeInTheDocument()

  fireEvent.focus(choice)
  expect(screen.getByTestId("carousel-template-hover-preview")).toBeInTheDocument()
  fireEvent.blur(choice)
  expect(screen.queryByTestId("carousel-template-hover-preview")).not.toBeInTheDocument()
})

it("configura fundo, textos e logo por slide e permite repetir na sequência", async () => {
  const user = userEvent.setup()
  const brandIr = {
    ...FAKE_IR,
    assets: {
      ...FAKE_IR.assets,
      "logo.onDark": {
        ...FAKE_IR.assets["logo.onLight"],
        path: "assets/logos/logo-on-dark.svg",
      },
    },
  }
  renderCarousel(fakeClient({ getBrandRevision: vi.fn(async () => brandIr) }))

  await screen.findByRole("heading", { name: "Modo Carrossel" })
  expect(screen.getByText(/versão clara ou escura adequada/)).toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: /Fundo: Principal, #/ }))
  await user.click(screen.getByRole("button", { name: /Textos: Principal, #/ }))
  await user.selectOptions(screen.getByLabelText("Versão da marca"), "logo.onDark")
  await user.click(screen.getByRole("button", { name: "Aplicar este fundo aos 5 slides" }))
  await user.click(screen.getByRole("button", { name: "Aplicar esta cor aos 5 slides" }))
  await user.click(screen.getByRole("button", { name: "Aplicar esta escolha aos 5 slides" }))
  await user.click(screen.getByRole("button", { name: /02 Conteúdo/ }))

  expect(screen.getByRole("button", { name: /Fundo: Principal, #/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  expect(screen.getByRole("button", { name: /Textos: Principal, #/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  expect(screen.getByLabelText("Versão da marca")).toHaveValue("logo.onDark")
})

it("oferece no carrossel todas as logos preservadas no pacote", async () => {
  const brandIr = {
    ...FAKE_IR,
    assets: {
      "logo.primary": FAKE_IR.assets["logo.primary"],
      "logo.variant.creme": {
        ...FAKE_IR.assets["logo.primary"],
        path: "assets/logos/marca-creme.png",
        sha256: "c".repeat(64),
        format: "png" as const,
      },
      "logo.variant.verde": {
        ...FAKE_IR.assets["logo.primary"],
        path: "assets/logos/marca-verde.png",
        sha256: "d".repeat(64),
        format: "png" as const,
      },
    },
  }
  renderCarousel(fakeClient({ getBrandRevision: vi.fn(async () => brandIr) }))

  await screen.findByRole("heading", { name: "Modo Carrossel" })
  const selector = screen.getByLabelText("Versão da marca")
  expect(screen.getByText(/As 3 versões carregadas estão disponíveis/)).toBeInTheDocument()
  expect(within(selector).getByRole("option", { name: "Marca creme" })).toBeInTheDocument()
  expect(within(selector).getByRole("option", { name: "Marca verde" })).toBeInTheDocument()
  expect(screen.queryByText(/Esta revisão tem apenas uma versão/)).not.toBeInTheDocument()
})

it("envia quantidade, conteúdo e uma das seis posições de assinatura", async () => {
  const user = userEvent.setup()
  const createCarousel = vi.fn(async (input) => ({
    ...fakeCarousel(input.slides),
    name: input.name,
    profile: input.profile,
    signature: input.signature,
  }))
  renderCarousel(fakeClient({ createCarousel }))

  await screen.findByRole("heading", { name: "Modo Carrossel" })
  await user.type(screen.getByLabelText("Nome do carrossel"), "Três atos")
  const count = screen.getByRole("combobox", { name: /Quantidade de slides/ })
  await user.selectOptions(count, "3")

  await user.type(screen.getByLabelText("Título principal"), "Abertura")
  await user.click(screen.getByRole("button", { name: /02 Conteúdo/ }))
  await user.type(screen.getByLabelText("Título principal"), "Argumento")
  await user.click(screen.getByRole("button", { name: /03 Fechamento/ }))
  await user.type(screen.getByLabelText("Mensagem final"), "Conclusão")
  await user.type(screen.getByLabelText("Texto da assinatura"), "@acme")
  await user.click(screen.getByLabelText("Superior direita"))
  await user.click(screen.getByRole("button", { name: "Gerar 3 slides" }))

  await waitFor(() => expect(createCarousel).toHaveBeenCalledTimes(1))
  expect(createCarousel).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "Três atos",
      profile: "post-4x5",
      signature: { text: "@acme", vertical: "top", horizontal: "right" },
      slides: expect.arrayContaining([
        expect.objectContaining({
          headline: "Abertura",
          layoutId: null,
          backgroundColorToken: null,
          textColorToken: null,
          logoAssetToken: null,
        }),
        expect.objectContaining({ headline: "Argumento" }),
        expect.objectContaining({ headline: "Conclusão" }),
      ]),
    }),
  )
  expect(await screen.findByText(/3 slides gerados/)).toBeInTheDocument()
  expect(screen.getAllByRole("link", { name: /Editar slide/i })).toHaveLength(3)
})
