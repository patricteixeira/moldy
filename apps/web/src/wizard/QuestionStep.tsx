import { useEffect, useRef, useState } from "react"
import type { DraftQuestion } from "../api/types"
import { ColorOptions } from "./options/ColorOptions"
import { FontOptions } from "./options/FontOptions"
import { LogoOptions } from "./options/LogoOptions"

interface Props {
  draftId: string
  question: DraftQuestion
  index: number
  total: number
  answers: Record<string, unknown>
  onConfirm(value: unknown): void
  onSkip(): void
  onBack(): void
  onRestart(): void
}

export function QuestionStep(props: Props) {
  const { draftId, question, index, total, answers, onConfirm, onSkip, onBack, onRestart } = props
  const [selection, setSelection] = useState<{ questionId: string; value: unknown } | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const storedAnswer = Object.prototype.hasOwnProperty.call(answers, question.id)
    ? answers[question.id]
    : null
  const selected = selection?.questionId === question.id ? selection.value : storedAnswer
  useEffect(() => headingRef.current?.focus(), [question.id])
  const optionProps = {
    candidates: question.candidates,
    selected,
    onSelect: (value: unknown) => setSelection({ questionId: question.id, value }),
  }

  return (
    <section className="question-step" data-testid="wizard-question">
      <p className="wizard-progress" data-testid="wizard-progress">
        Pergunta {index + 1} de {total}
      </p>
      <h2 ref={headingRef} tabIndex={-1}>
        {question.promptPt}
      </h2>
      {question.candidates.length === 0 ? (
        <div className="empty-question" role="alert">
          <p>O pacote não trouxe uma opção válida para esta etapa.</p>
          <p>Volte aos materiais, acrescente os arquivos que faltam e envie o pacote novamente.</p>
        </div>
      ) : (
        <>
          {question.kind === "pick-color" && <ColorOptions {...optionProps} />}
          {question.kind === "pick-font" && <FontOptions draftId={draftId} {...optionProps} />}
          {question.kind === "confirm-logo" && <LogoOptions draftId={draftId} {...optionProps} />}
        </>
      )}
      <div className="action-row">
        <button
          data-testid="wizard-trocar-materiais"
          className="secondary-action"
          type="button"
          onClick={onRestart}
        >
          {question.candidates.length === 0 ? "Voltar aos materiais" : "Trocar materiais"}
        </button>
        {index > 0 && (
          <button data-testid="wizard-voltar" className="secondary-action" type="button" onClick={onBack}>
            Voltar
          </button>
        )}
        {!question.required && (
            <button
              data-testid="wizard-pular"
              className="secondary-action"
              type="button"
              onClick={() => {
                setSelection(null)
                onSkip()
              }}
            >
            A marca não tem
          </button>
        )}
        <button
          data-testid="wizard-confirmar"
          type="button"
          disabled={selected === null || question.candidates.length === 0}
          onClick={() => onConfirm(selected)}
        >
          Confirmar
        </button>
      </div>
    </section>
  )
}
