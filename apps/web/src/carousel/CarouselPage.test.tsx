import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { expect, it, vi } from "vitest"
import { ApiProvider } from "../api/context"
import type { ApiClient } from "../api/types"
import { FAKE_IR, fakeCarousel, fakeClient } from "../test/fakeApi"
import { CarouselPage } from "./CarouselPage"

function renderCarousel(client: ApiClient) {
  render(
    <ApiProvider client={client}>
      <MemoryRouter initialEntries={["/marcas/brandrev_x/carrossel"]}>
        <Routes>
          <Route path="/marcas/:revisionId/carrossel" element={<CarouselPage />} />
        </Routes>
      </MemoryRouter>
    </ApiProvider>,
  )
}

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

it("configura fundo e logo por slide e permite repetir a escolha na sequência", async () => {
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

  await user.click(screen.getByRole("button", { name: /Principal, #/ }))
  await user.selectOptions(screen.getByLabelText("Versão da marca"), "logo.onDark")
  await user.click(screen.getByRole("button", { name: "Aplicar este fundo aos 5 slides" }))
  await user.click(screen.getByRole("button", { name: "Aplicar esta escolha aos 5 slides" }))
  await user.click(screen.getByRole("button", { name: /02 Conteúdo/ }))

  expect(screen.getByRole("button", { name: /Principal, #/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  expect(screen.getByLabelText("Versão da marca")).toHaveValue("logo.onDark")
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
          backgroundColorToken: null,
          logoAssetToken: null,
        }),
        expect.objectContaining({ headline: "Argumento" }),
        expect.objectContaining({ headline: "Conclusão" }),
      ]),
    }),
  )
  expect(await screen.findByText(/3 slides gerados/)).toBeInTheDocument()
})
