import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { BrandEvidence } from "./BrandEvidence"

describe("BrandEvidence", () => {
  it("explica os materiais e permite percorrer os princípios", async () => {
    const user = userEvent.setup()
    render(<BrandEvidence />)

    expect(screen.getByRole("img")).toHaveAttribute("src", "/brand-archive.webp")
    expect(screen.getByRole("button", { name: /Manual/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    )

    await user.click(screen.getByRole("button", { name: /Símbolos/ }))
    expect(screen.getByRole("button", { name: /Símbolos/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    )

    expect(
      screen.getByText("Os materiais existentes são tratados como fonte de verdade."),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Próxima" }))
    expect(
      screen.getByText("Ambiguidades viram escolhas explícitas antes da publicação."),
    ).toBeInTheDocument()
  })
})
