import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { expect, it, vi } from "vitest"
import { ApiProvider } from "../api/context"
import type { ApiClient, BrandIr, LayoutSpec } from "../api/types"
import { FAKE_IR, fakeCampaign, fakeClient, fakeStatementLayout } from "../test/fakeApi"
import { CampaignPage } from "./CampaignPage"

const axis = { value: 0.5, confidence: 0.75, evidenceTerms: ["precisa", "ousada"] }
const DIRECTED_IR: BrandIr = {
  ...FAKE_IR,
  schemaVersion: "0.4.0",
  identity: {
    essence: "Clareza para criar.",
    personality: "Precisa e ousada.",
    voice: "Direta.",
    avoid: "Ruído.",
    evidence: [],
  },
  creativeDirection: {
    energy: axis,
    geometry: axis,
    density: axis,
    formality: axis,
    materiality: axis,
    contrast: axis,
    composition: "expansive",
    surface: "linear-rhythm",
    scaleContrast: 0.7,
    negativeSpace: 0.4,
    bleed: 0.6,
    surfaceDensity: 0.45,
    rationalePt: ["A marca pede contraste de escala."],
  },
}

function campaignClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return fakeClient({ getBrandRevision: vi.fn(async () => DIRECTED_IR), ...overrides })
}

function fakePhotoLayout(): LayoutSpec {
  return {
    ...fakeStatementLayout(),
    id: "announce-post-1x1",
    namePt: "Anúncio com foto",
    slots: [
      ...fakeStatementLayout().slots,
      {
        id: "photo",
        kind: "image",
        required: true,
        area: [0, 700, 1080, 380],
        fit: "fixed",
        minResolution: [1080, 380],
      },
    ],
  }
}

function renderCampaign(client: ApiClient) {
  render(
    <ApiProvider client={client}>
      <MemoryRouter initialEntries={["/marcas/brandrev_x/campanhas"]}>
        <Routes>
          <Route path="/marcas/:revisionId/campanhas" element={<CampaignPage />} />
        </Routes>
      </MemoryRouter>
    </ApiProvider>,
  )
}

it("cria uma fonte única e exibe a peça vinculada", async () => {
  const createCampaign = vi.fn(async (input) => ({
    ...fakeCampaign(),
    name: input.name,
    fields: input.fields,
  }))
  renderCampaign(
    campaignClient({
      getKit: vi.fn(async () => [fakeStatementLayout()]),
      createCampaign,
    }),
  )

  await screen.findByRole("heading", { name: "Modo Campanha" })
  fireEvent.change(screen.getByLabelText("Nome da campanha"), {
    target: { value: "Semana de lançamento" },
  })
  fireEvent.change(screen.getByLabelText("Título principal"), {
    target: { value: "Uma mensagem para todos" },
  })
  fireEvent.change(screen.getByLabelText("Mensagem"), {
    target: { value: "O mesmo conteúdo em cada formato." },
  })
  fireEvent.change(screen.getByLabelText("Data ou período"), {
    target: { value: "24 de julho" },
  })
  fireEvent.change(screen.getByLabelText("Chamada para ação"), {
    target: { value: "Conheça agora" },
  })
  await userEvent.click(screen.getByRole("button", { name: /Criar campanha com 1 formato/ }))

  await waitFor(() => expect(createCampaign).toHaveBeenCalledTimes(1))
  expect(createCampaign).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "Semana de lançamento",
      layoutIds: ["statement-post-1x1"],
      fields: expect.objectContaining({
        headline: "Uma mensagem para todos",
        date: "24 de julho",
        cta: "Conheça agora",
      }),
    }),
  )
  expect(await screen.findByRole("status")).toHaveTextContent(
    "1 peça(s) atualizada(s) a partir da mesma mensagem.",
  )
  expect(screen.getByTestId("campaign-piece")).toBeInTheDocument()
})

it("reabre uma campanha e atualiza os mesmos documentos", async () => {
  const existing = fakeCampaign()
  const updateCampaign = vi.fn(async (_id, input) => ({
    ...existing,
    name: input.name,
    fields: input.fields,
  }))
  renderCampaign(
    campaignClient({
      getKit: vi.fn(async () => [fakeStatementLayout()]),
      listCampaigns: vi.fn(async () => [existing]),
      updateCampaign,
    }),
  )

  await userEvent.click(await screen.findByRole("button", { name: /Lançamento/ }))
  const headline = screen.getByLabelText("Título principal")
  fireEvent.change(headline, { target: { value: "Título atualizado" } })
  await userEvent.click(screen.getByRole("button", { name: /Salvar e atualizar 1 peça/ }))

  await waitFor(() => expect(updateCampaign).toHaveBeenCalledTimes(1))
  expect(updateCampaign).toHaveBeenCalledWith(
    "campaign_x",
    expect.objectContaining({
      fields: expect.objectContaining({ headline: "Título atualizado" }),
    }),
  )
})

it("não oferece layout com foto enquanto a campanha não tem imagem", async () => {
  renderCampaign(
    campaignClient({
      getKit: vi.fn(async () => [fakePhotoLayout(), fakeStatementLayout()]),
    }),
  )

  const photoLayout = await screen.findByRole("checkbox", { name: /Anúncio com foto/i })
  expect(photoLayout).toBeDisabled()
  expect(screen.getByText(/precisa de imagem/i)).toBeInTheDocument()

  await userEvent.upload(
    screen.getByLabelText("Imagem da campanha"),
    new File(["imagem"], "campanha.png", { type: "image/png" }),
  )

  expect(photoLayout).toBeEnabled()
})

it("interrompe campanhas quando a revisão não tem direção criativa", async () => {
  renderCampaign(fakeClient())

  expect(
    await screen.findByText("Esta marca ainda não está pronta para gerar campanhas."),
  ).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /Criar campanha/ })).toBeDisabled()
  expect(screen.getByRole("link", { name: "Refazer leitura da marca" })).toHaveAttribute(
    "href",
    "/",
  )
})
