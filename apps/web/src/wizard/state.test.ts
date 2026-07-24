import { expect, it } from "vitest"
import type { DraftQuestion } from "../api/types"
import { blockingRequiredQuestions, initialWizardState, wizardReducer } from "./state"

const q = (id: string, required = true): DraftQuestion => ({
  id,
  kind: "pick-color",
  promptPt: `Pergunta ${id}`,
  candidates: [{ value: "#1A4D8F", score: 1, evidence: [] }],
  required,
})
const questions = [q("color.primary"), q("color.secondary", false), q("font.heading")]
const started = wizardReducer(initialWizardState, {
  type: "draft-created",
  draftId: "d1",
  questions,
})

it("draft-created entra na primeira pergunta", () => {
  expect(started).toMatchObject({ step: "question", draftId: "d1", index: 0, answers: {} })
})

it("identifica apenas perguntas obrigatórias sem candidatos", () => {
  const requiredEmpty = { ...q("logo.primary"), candidates: [] }
  const optionalEmpty = { ...q("color.secondary", false), candidates: [] }
  expect(blockingRequiredQuestions([requiredEmpty, optionalEmpty, q("font.body")])).toEqual([
    requiredEmpty,
  ])
})

it("não bloqueia fonte obrigatória sem candidato porque o nome pode ser digitado", () => {
  const fontWithoutCandidate: DraftQuestion = {
    id: "font.heading",
    kind: "pick-font",
    promptPt: "Qual é a fonte dos títulos?",
    candidates: [],
    required: true,
  }

  expect(blockingRequiredQuestions([fontWithoutCandidate])).toEqual([])
  expect(
    wizardReducer(initialWizardState, {
      type: "draft-created",
      draftId: "d-fonte-manual",
      questions: [fontWithoutCandidate],
    }),
  ).toMatchObject({
    step: "question",
    draftId: "d-fonte-manual",
    index: 0,
  })
})

it("draft-created incompleto permanece no envio de materiais", () => {
  const requiredEmpty = { ...q("logo.primary"), candidates: [] }
  expect(
    wizardReducer(initialWizardState, {
      type: "draft-created",
      draftId: "d-incompleto",
      questions: [q("color.primary"), requiredEmpty],
    }),
  ).toEqual(initialWizardState)
})

it("quando a leitura não exige conferência humana, segue direto para o nome da marca", () => {
  expect(
    wizardReducer(initialWizardState, {
      type: "draft-created",
      draftId: "d-vazio",
      questions: [],
    }),
  ).toEqual({
    step: "publish",
    draftId: "d-vazio",
    questions: [],
    answers: {},
  })
})

it("answer grava e avança; a última leva a publish", () => {
  let state = wizardReducer(started, {
    type: "answer",
    questionId: "color.primary",
    value: "#1A4D8F",
  })
  expect(state).toMatchObject({ step: "question", index: 1 })
  state = wizardReducer(state, {
    type: "answer",
    questionId: "color.secondary",
    value: "#F4A300",
  })
  state = wizardReducer(state, {
    type: "answer",
    questionId: "font.heading",
    value: { family: "X" },
  })
  expect(state).toMatchObject({
    step: "publish",
    answers: {
      "color.primary": "#1A4D8F",
      "color.secondary": "#F4A300",
      "font.heading": { family: "X" },
    },
  })
})

it("skip só funciona em pergunta opcional e não grava resposta", () => {
  expect(wizardReducer(started, { type: "skip" })).toBe(started)
  const atOne = wizardReducer(started, {
    type: "answer",
    questionId: "color.primary",
    value: "#1A4D8F",
  })
  const skipped = wizardReducer(atOne, { type: "skip" })
  expect(skipped).toMatchObject({ step: "question", index: 2 })
  expect((skipped as { answers: Record<string, unknown> }).answers).not.toHaveProperty(
    "color.secondary",
  )
})

it("skip remove uma resposta opcional confirmada anteriormente", () => {
  let state = wizardReducer(started, {
    type: "answer",
    questionId: "color.primary",
    value: "#1A4D8F",
  })
  state = wizardReducer(state, {
    type: "answer",
    questionId: "color.secondary",
    value: "#F4A300",
  })
  state = wizardReducer(state, { type: "back" })
  const skipped = wizardReducer(state, { type: "skip" })

  expect((skipped as { answers: Record<string, unknown> }).answers).not.toHaveProperty(
    "color.secondary",
  )
})

it("back não sai da primeira pergunta e volta de publish", () => {
  expect(wizardReducer(started, { type: "back" })).toBe(started)
  let state = started
  for (const [questionId, value] of [
    ["color.primary", "a"],
    ["color.secondary", "b"],
    ["font.heading", "c"],
  ] as const) {
    state = wizardReducer(state, { type: "answer", questionId, value })
  }
  expect(wizardReducer(state, { type: "back" })).toMatchObject({ step: "question", index: 2 })
})

it("published finaliza", () => {
  let state = started
  for (const question of questions) {
    state = wizardReducer(state, { type: "answer", questionId: question.id, value: 1 })
  }
  expect(wizardReducer(state, { type: "published", brandRevisionId: "brandrev_z" })).toEqual({
    step: "done",
    brandRevisionId: "brandrev_z",
  })
})

it("restart retorna ao envio de materiais", () => {
  expect(wizardReducer(started, { type: "restart" })).toEqual(initialWizardState)
})
