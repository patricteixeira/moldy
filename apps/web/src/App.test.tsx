import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { expect, it } from "vitest"
import App from "./App"
import { ApiProvider } from "./api/context"
import { fakeClient } from "./test/fakeApi"

it("rota inicial mostra o assistente de instalação", () => {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <ApiProvider client={fakeClient()}>
        <App />
      </ApiProvider>
    </MemoryRouter>,
  )
  expect(screen.getByRole("heading", { name: "Instalar marca" })).toBeInTheDocument()
})

it("rota desconhecida oferece retorno ao início", () => {
  render(
    <MemoryRouter initialEntries={["/endereco-inexistente"]}>
      <ApiProvider client={fakeClient()}>
        <App />
      </ApiProvider>
    </MemoryRouter>,
  )

  expect(screen.getByRole("heading", { name: "Página não encontrada" })).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Voltar ao início" })).toHaveAttribute("href", "/")
  expect(document.getElementById("main-content")).toBeInTheDocument()
})
