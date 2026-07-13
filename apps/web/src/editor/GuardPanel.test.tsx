import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import type { GuardCheck } from "../api/types"
import { GuardPanel } from "./GuardPanel"

const blocked: GuardCheck = {
  id: "text-length",
  slotId: "headline",
  status: "blocked",
  messagePt: "O texto de «headline» tem 95 caracteres; o máximo deste layout é 90.",
  detail: { chars: 95, maxChars: 90 },
}
const pass: GuardCheck = {
  id: "contrast",
  slotId: "headline",
  status: "pass",
  messagePt: "ok",
  detail: {},
}

it("mostra apenas checks não-pass, com mensagem e ação clara", async () => {
  const onAction = vi.fn()
  render(<GuardPanel checks={[pass, blocked]} onAction={onAction} />)
  const items = screen.getAllByTestId("guard-item")
  expect(items).toHaveLength(1)
  expect(items[0]).toHaveAttribute("data-check-id", "text-length")
  expect(items[0]).toHaveTextContent("95 caracteres")
  const action = screen.getByTestId("guard-action")
  expect(action).toHaveTextContent("Editar texto")
  await userEvent.click(action)
  expect(onAction).toHaveBeenCalledWith(blocked)
})

it("sem problemas, não renderiza painel", () => {
  render(<GuardPanel checks={[pass]} onAction={vi.fn()} />)
  expect(screen.queryByTestId("guard-panel")).not.toBeInTheDocument()
})

it("anuncia checks assíncronos e não oferece ação sem slot", () => {
  render(
    <GuardPanel
      checks={[
        {
          id: "font-fallback",
          status: "fixed",
          messagePt: "A fonte prevista foi substituída com segurança.",
          detail: {},
        },
      ]}
      onAction={vi.fn()}
    />,
  )

  expect(screen.getByTestId("guard-panel")).toHaveAttribute("aria-live", "polite")
  expect(screen.queryByTestId("guard-action")).not.toBeInTheDocument()
})
