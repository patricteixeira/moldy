import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { expect, it, vi } from "vitest"
import { ApiError } from "../api/client"
import { ApiProvider } from "../api/context"
import type { ApiClient } from "../api/types"
import { fakeClient, fakeQuoteLayout, fakeStatementLayout } from "../test/fakeApi"
import { mounts } from "../test/renderStub"
import { KitPage } from "./KitPage"

function renderKit(client: ApiClient) {
  render(
    <ApiProvider client={client}>
      <MemoryRouter initialEntries={["/marcas/brandrev_x/kit"]}>
        <Routes>
          <Route path="/marcas/:revisionId/kit" element={<KitPage />} />
          <Route path="/marcas/:revisionId/editor/:layoutId" element={<h1>Editor</h1>} />
        </Routes>
      </MemoryRouter>
    </ApiProvider>,
  )
}

it("lista os layouts com nome PT e thumbnail renderizado pela biblioteca real", async () => {
  const getKit = vi.fn(async () => [fakeStatementLayout(), fakeQuoteLayout()])
  renderKit(fakeClient({ getKit }))
  const cards = await screen.findAllByTestId("kit-card")
  expect(cards).toHaveLength(2)
  expect(screen.getByText("Frase de impacto")).toBeInTheDocument()
  expect(screen.getByText("Citação sobre foto")).toBeInTheDocument()
  await waitFor(() => expect(mounts).toHaveLength(2))
  expect(mounts[0].payloads[0].assetsBaseUrl).toBe(
    "/v1/brand-revisions/brandrev_x/assets",
  )
  expect(screen.getAllByTestId("preview-canvas")[0]).toHaveStyle({ maxWidth: "360px" })
})

it("clicar num layout abre o editor daquele layout", async () => {
  renderKit(fakeClient({ getKit: vi.fn(async () => [fakeStatementLayout()]) }))
  await userEvent.click(await screen.findByTestId("kit-card"))
  expect(await screen.findByRole("heading", { name: "Editor" })).toBeInTheDocument()
})

it("expõe falha da API em PT-BR", async () => {
  renderKit(
    fakeClient({
      getKit: vi.fn(async () => {
        throw new ApiError(503, "O kit está temporariamente indisponível.")
      }),
    }),
  )
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "O kit está temporariamente indisponível.",
  )
})

it("oferece nova tentativa e recupera uma falha transitória", async () => {
  const getKit = vi
    .fn()
    .mockRejectedValueOnce(new ApiError(503, "O kit está temporariamente indisponível."))
    .mockResolvedValueOnce([fakeStatementLayout()])
  renderKit(fakeClient({ getKit }))

  expect(await screen.findByRole("alert")).toHaveTextContent("temporariamente indisponível")
  await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }))

  expect(await screen.findByTestId("kit-card")).toHaveAttribute(
    "data-layout-id",
    "statement-post-1x1",
  )
  expect(getKit).toHaveBeenCalledTimes(2)
})

it("explica quando o kit não tem layouts e permite tentar novamente", async () => {
  renderKit(fakeClient({ getKit: vi.fn(async () => []) }))

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Este kit ainda não tem layouts disponíveis.",
  )
  expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument()
})
