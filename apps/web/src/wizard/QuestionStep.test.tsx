import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { ApiProvider } from "../api/context"
import type { DraftQuestion } from "../api/types"
import { fakeClient } from "../test/fakeApi"
import { QuestionStep } from "./QuestionStep"

const question: DraftQuestion = {
  id: "color.primary",
  kind: "pick-color",
  promptPt: "Qual destas é a cor principal da marca?",
  candidates: [
    { value: "#1A4D8F", score: 1, evidence: [] },
    { value: "#F4A300", score: 0.5, evidence: [] },
  ],
  required: true,
}

function renderStep(overrides: Partial<Parameters<typeof QuestionStep>[0]> = {}) {
  const props = {
    draftId: "d1",
    question,
    index: 0,
    total: 7,
    answers: {},
    onConfirm: vi.fn(),
    onSkip: vi.fn(),
    onBack: vi.fn(),
    onRestart: vi.fn(),
    ...overrides,
  }
  render(
    <ApiProvider client={fakeClient()}>
      <QuestionStep {...props} />
    </ApiProvider>,
  )
  return props
}

it("mostra o prompt do servidor, o progresso e confirma a seleção", async () => {
  const props = renderStep()
  expect(
    screen.getByRole("heading", { name: "Qual destas é a cor principal da marca?" }),
  ).toBeInTheDocument()
  expect(screen.getByTestId("wizard-progress")).toHaveTextContent("Pergunta 1 de 7")
  const confirm = screen.getByTestId("wizard-confirmar")
  expect(confirm).toBeDisabled()
  await userEvent.click(screen.getAllByTestId("candidate-option")[0])
  expect(confirm).toBeEnabled()
  await userEvent.click(confirm)
  expect(props.onConfirm).toHaveBeenCalledWith("#1A4D8F")
})

it("pergunta sem candidatos oferece retorno aos materiais", async () => {
  const props = renderStep({ question: { ...question, candidates: [] } })

  expect(screen.getByRole("alert")).toHaveTextContent("não trouxe uma opção válida")
  expect(screen.getByTestId("wizard-confirmar")).toBeDisabled()
  await userEvent.click(screen.getByRole("button", { name: "Voltar aos materiais" }))
  expect(props.onRestart).toHaveBeenCalledOnce()
})

it("pular só existe em pergunta opcional; a primeira permite trocar os materiais", () => {
  renderStep()
  expect(screen.queryByTestId("wizard-pular")).not.toBeInTheDocument()
  expect(screen.queryByTestId("wizard-voltar")).not.toBeInTheDocument()
  expect(screen.getByTestId("wizard-trocar-materiais")).toHaveTextContent("Trocar materiais")
})

it("pergunta opcional oferece 'A marca não tem'", async () => {
  const props = renderStep({
    question: { ...question, id: "color.secondary", required: false },
    index: 3,
  })
  await userEvent.click(screen.getByTestId("wizard-pular"))
  expect(props.onSkip).toHaveBeenCalled()
  expect(screen.getByTestId("wizard-voltar")).toBeInTheDocument()
})

it("restaura a resposta confirmada ao voltar para uma pergunta", () => {
  renderStep({ answers: { "color.primary": "#F4A300" } })

  expect(screen.getAllByTestId("candidate-option")[1]).toHaveAttribute("aria-pressed", "true")
  expect(screen.getByTestId("wizard-confirmar")).toBeEnabled()
})
