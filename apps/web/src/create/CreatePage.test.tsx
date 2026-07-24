import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { expect, it } from "vitest"
import { ApiProvider } from "../api/context"
import { fakeClient } from "../test/fakeApi"
import { CreatePage } from "./CreatePage"

function Target() {
  const location = useLocation()
  return <output aria-label="destino">{`${location.pathname}${location.search}`}</output>
}

it("coleta decisões operacionais e leva o briefing ao fluxo de carrossel", async () => {
  render(
    <ApiProvider client={fakeClient()}>
      <MemoryRouter initialEntries={["/marcas/brandrev_x/criar"]}>
        <Routes>
          <Route path="/marcas/:revisionId/criar" element={<CreatePage />} />
          <Route path="/marcas/:revisionId/carrossel" element={<Target />} />
        </Routes>
      </MemoryRouter>
    </ApiProvider>,
  )

  expect(
    await screen.findByRole("heading", { name: "O que você quer criar?" }),
  ).toBeInTheDocument()
  await userEvent.click(screen.getByLabelText(/Explicar ou ensinar/i))
  await userEvent.click(screen.getByLabelText(/^Carrossel/i))
  await userEvent.click(screen.getByRole("button", { name: "Escolher formato" }))
  await userEvent.click(screen.getByLabelText(/Feed quadrado/i))
  await userEvent.click(screen.getByRole("button", { name: "Definir conteúdo" }))
  await userEvent.selectOptions(screen.getByLabelText("Ação esperada do público"), "save")
  await userEvent.click(screen.getByLabelText(/Não, será só texto e formas/i))
  await userEvent.click(screen.getByRole("button", { name: "Montar carrossel" }))

  expect(await screen.findByLabelText("destino")).toHaveTextContent(
    "/marcas/brandrev_x/carrossel?objective=inform&piece=carousel&channel=instagram&profile=post-1x1&action=save&visual=no-image",
  )
})

it("exige o nome quando a pessoa escolhe outra rede", async () => {
  render(
    <ApiProvider client={fakeClient()}>
      <MemoryRouter initialEntries={["/marcas/brandrev_x/criar"]}>
        <Routes>
          <Route path="/marcas/:revisionId/criar" element={<CreatePage />} />
        </Routes>
      </MemoryRouter>
    </ApiProvider>,
  )

  await screen.findByRole("heading", { name: "O que você quer criar?" })
  await userEvent.click(screen.getByLabelText(/Anunciar uma novidade/i))
  await userEvent.click(screen.getByLabelText(/Peça individual/i))
  await userEvent.click(screen.getByRole("button", { name: "Escolher formato" }))
  await userEvent.click(screen.getByLabelText("Outra rede"))

  expect(screen.getByRole("button", { name: "Definir conteúdo" })).toBeDisabled()
  await userEvent.type(screen.getByLabelText("Qual rede ou canal?"), "Bluesky")
  expect(screen.getByRole("button", { name: "Definir conteúdo" })).toBeEnabled()
})
