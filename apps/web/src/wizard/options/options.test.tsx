import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { ApiProvider } from "../../api/context"
import type { Candidate } from "../../api/types"
import { fakeClient } from "../../test/fakeApi"
import { ColorOptions } from "./ColorOptions"
import { FontOptions } from "./FontOptions"
import { LogoOptions } from "./LogoOptions"

const candidate = (value: unknown): Candidate => ({ value, score: 1, evidence: [] })

it("cores são amostras clicáveis, sem hex visível", async () => {
  const onSelect = vi.fn()
  render(
    <ColorOptions
      candidates={[candidate("#1A4D8F"), candidate("#F4A300")]}
      selected={null}
      onSelect={onSelect}
    />,
  )
  const options = screen.getAllByTestId("candidate-option")
  expect(options).toHaveLength(2)
  expect(options[0]).toHaveStyle({ backgroundColor: "#1A4D8F" })
  expect(options[0].textContent ?? "").not.toContain("#")
  await userEvent.click(options[1])
  expect(onSelect).toHaveBeenCalledWith("#F4A300")
})

it("fontes mostram amostra na própria família e peso", () => {
  render(
    <ApiProvider client={fakeClient()}>
      <FontOptions
        draftId="d1"
        candidates={[
          candidate({ family: "Fixture Sans", weight: 700, style: "normal" }),
        ]}
        selected={null}
        onSelect={vi.fn()}
      />
    </ApiProvider>,
  )
  const sample = screen.getByTestId("font-sample")
  expect(sample.style.fontFamily).toContain("Fixture Sans")
  expect(sample).toHaveStyle({ fontWeight: "700" })
  expect(screen.getByText("Família citada no manual · prévia aproximada")).toBeInTheDocument()
})

it("identifica quando o arquivo da fonte está incluído", () => {
  render(
    <ApiProvider client={fakeClient()}>
      <FontOptions
        draftId="d1"
        candidates={[
          candidate({ family: "Fixture Sans", weight: 700, style: "normal", path: "fonts/fixture.ttf" }),
        ]}
        selected={null}
        onSelect={vi.fn()}
      />
    </ApiProvider>,
  )

  expect(screen.getByText("Arquivo da fonte incluído")).toBeInTheDocument()
})

it("logo é renderizado de verdade a partir do draft", () => {
  render(
    <ApiProvider client={fakeClient()}>
      <LogoOptions
        draftId="d1"
        candidates={[candidate("assets/logos/logo.svg")]}
        selected={null}
        onSelect={vi.fn()}
      />
    </ApiProvider>,
  )
  const image = screen.getByRole("img", { name: "Logo proposto" })
  expect(image).toHaveAttribute("src", "/v1/drafts/d1/assets/assets/logos/logo.svg")
})
