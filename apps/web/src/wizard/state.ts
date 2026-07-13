import type { DraftQuestion } from "../api/types"

export type WizardState =
  | { step: "upload" }
  | {
      step: "question"
      draftId: string
      questions: DraftQuestion[]
      index: number
      answers: Record<string, unknown>
    }
  | {
      step: "publish"
      draftId: string
      questions: DraftQuestion[]
      answers: Record<string, unknown>
    }
  | { step: "done"; brandRevisionId: string }

export type WizardAction =
  | { type: "draft-created"; draftId: string; questions: DraftQuestion[] }
  | { type: "answer"; questionId: string; value: unknown }
  | { type: "skip" }
  | { type: "back" }
  | { type: "restart" }
  | { type: "published"; brandRevisionId: string }

export const initialWizardState: WizardState = { step: "upload" }

export function blockingRequiredQuestions(questions: DraftQuestion[]): DraftQuestion[] {
  return questions.filter((question) => question.required && question.candidates.length === 0)
}

function advance(
  state: Extract<WizardState, { step: "question" }>,
  answers: Record<string, unknown>,
): WizardState {
  if (state.index >= state.questions.length - 1) {
    return {
      step: "publish",
      draftId: state.draftId,
      questions: state.questions,
      answers,
    }
  }
  return { ...state, index: state.index + 1, answers }
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  if (action.type === "restart") return initialWizardState
  if (action.type === "draft-created" && state.step === "upload") {
    if (
      action.questions.length === 0 ||
      blockingRequiredQuestions(action.questions).length > 0
    ) return state
    return {
      step: "question",
      draftId: action.draftId,
      questions: action.questions,
      index: 0,
      answers: {},
    }
  }
  if (state.step === "question" && action.type === "answer") {
    return advance(state, { ...state.answers, [action.questionId]: action.value })
  }
  if (state.step === "question" && action.type === "skip") {
    if (state.questions[state.index]?.required !== false) return state
    const questionId = state.questions[state.index].id
    const { [questionId]: _removed, ...answers } = state.answers
    return advance(state, answers)
  }
  if (action.type === "back") {
    if (state.step === "question") {
      return state.index === 0 ? state : { ...state, index: state.index - 1 }
    }
    if (state.step === "publish" && state.questions.length > 0) {
      return {
        step: "question",
        draftId: state.draftId,
        questions: state.questions,
        index: state.questions.length - 1,
        answers: state.answers,
      }
    }
  }
  if (state.step === "publish" && action.type === "published") {
    return { step: "done", brandRevisionId: action.brandRevisionId }
  }
  return state
}
