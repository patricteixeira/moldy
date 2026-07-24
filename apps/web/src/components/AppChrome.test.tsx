import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"
import { AppChrome } from "./AppChrome"

function renderChrome(pathname: string): void {
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <AppChrome>
        <main>Conteúdo</main>
      </AppChrome>
    </MemoryRouter>,
  )
}

describe("AppChrome", () => {
  it("orienta o carrossel dentro do kit e usa o nome público do produto", () => {
    renderChrome("/marcas/brandrev_test/carrossel")

    expect(screen.getByRole("link", { name: "Molda, início" })).toHaveAttribute("href", "/")
    expect(screen.getByRole("link", { name: "Modelos" })).toHaveAttribute(
      "href",
      "/marcas/brandrev_test/kit",
    )
    expect(screen.getByRole("link", { name: "Carrossel" })).toHaveAttribute(
      "aria-current",
      "page",
    )
  })

  it("nomeia a área de Word sem parecer uma página inexistente", () => {
    renderChrome("/marcas/brandrev_test/word")

    expect(screen.getByRole("link", { name: "Word" })).toHaveAttribute("aria-current", "page")
    expect(screen.queryByText("404")).not.toBeInTheDocument()
  })

  it("mostra as tarefas principais e marca a etapa atual", () => {
    renderChrome("/marcas/brandrev_test/criar")

    expect(screen.getByRole("link", { name: "Modelos" })).toHaveAttribute(
      "href",
      "/marcas/brandrev_test/kit",
    )
    expect(screen.getByRole("link", { name: "Nova peça" })).toHaveAttribute(
      "aria-current",
      "page",
    )
  })
})
