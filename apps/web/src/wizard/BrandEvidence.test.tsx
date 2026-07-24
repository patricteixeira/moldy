import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { BrandEvidence } from "./BrandEvidence"

describe("BrandEvidence", () => {
  it("mostra os arquivos necessários e o processo sem esconder informações", () => {
    render(<BrandEvidence />)

    expect(screen.getByRole("img")).toHaveAttribute("src", "/brand-archive.webp")
    expect(screen.getByRole("heading", { name: "Separe estes arquivos" })).toBeInTheDocument()
    expect(screen.getByText("Manual em PDF")).toBeInTheDocument()
    expect(screen.getByText("Logo em SVG ou PNG")).toBeInTheDocument()
    expect(screen.getByText("Fontes em TTF ou OTF")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Três etapas" })).toBeInTheDocument()
    expect(screen.getByText("Revise somente os dados incertos.")).toBeInTheDocument()
  })
})
