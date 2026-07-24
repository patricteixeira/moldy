import { useEffect, useRef, useState } from "react"
import type { DraftQuestion } from "../api/types"
import { ColorOptions } from "./options/ColorOptions"
import { FontOptions } from "./options/FontOptions"
import { IdentityOptions } from "./options/IdentityOptions"
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

function automaticallySuggestedFont(question: DraftQuestion): unknown | null {
  if (question.kind !== "pick-font") return null
  return question.candidates[0]?.value ?? null
}

function automaticallySuggestedLogoVariant(question: DraftQuestion): unknown | null {
  if (
    question.kind !== "confirm-logo" ||
    !["logo.onLight", "logo.onDark"].includes(question.id) ||
    (question.recommendedCount ?? 0) < 1
  ) {
    return null
  }
  return question.candidates[0]?.value ?? null
}

function validSelection(question: DraftQuestion, value: unknown): boolean {
  if (question.kind !== "review-identity") return value !== null
  if (typeof value !== "object" || value === null) return false
  const essence = (value as Record<string, unknown>).essence
  if (typeof essence !== "string") return false
  const normalized = essence.trim().toLocaleLowerCase("pt-BR")
  return normalized.length > 0 && !new Set(["-", "—", ".", "...", "n/a", "na", "não sei", "nao sei"]).has(normalized)
}

function instructionForQuestion(question: DraftQuestion): string {
  if (question.kind === "review-identity") {
    return question.candidates[0]?.evidence.length
      ? "O Molda encontrou estes dados no manual. Confira e corrija o que estiver errado."
      : "O manual não explicou estes pontos com clareza. Responda com palavras comuns; não é preciso conhecer termos de design."
  }
  if (question.kind === "pick-color") {
    return "Escolha a cor que a marca mais usa para esse caso."
  }
  if (question.kind === "pick-font") {
    return "Compare com os arquivos da marca. Se a fonte certa não aparecer, digite o nome dela."
  }
  if (question.id === "logo.onLight") {
    return "Escolha a versão escura ou colorida, feita para continuar visível em fundos claros."
  }
  if (question.id === "logo.onDark") {
    return "Escolha a versão clara, branca ou negativa, feita para continuar visível em fundos escuros."
  }
  return "Escolha o logo que a marca mais usa."
}

function confirmationLabel(question: DraftQuestion): string {
  if (question.kind === "review-identity") return "Salvar e continuar"
  if (question.kind === "pick-color") return "Escolher esta cor"
  if (question.kind === "pick-font") return "Escolher esta fonte"
  return "Escolher este logo"
}

export function QuestionStep(props: Props) {
  const { draftId, question, index, total, answers, onConfirm, onSkip, onBack, onRestart } = props
  const [selection, setSelection] = useState<{ questionId: string; value: unknown } | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const storedAnswer = Object.prototype.hasOwnProperty.call(answers, question.id)
    ? answers[question.id]
    : null
  const selected =
    selection?.questionId === question.id
      ? selection.value
      : storedAnswer ??
        automaticallySuggestedFont(question) ??
        automaticallySuggestedLogoVariant(question)
  useEffect(() => {
    const heading = headingRef.current
    heading?.closest(".wizard-bench")?.scrollIntoView?.({ block: "start" })
    heading?.focus({ preventScroll: true })
  }, [question.id])
  const missingDetectedOptions = question.candidates.length === 0 && question.kind !== "pick-font"
  const optionProps = {
    candidates: question.candidates,
    selected,
    onSelect: (value: unknown) => setSelection({ questionId: question.id, value }),
  }

  return (
    <section className="question-step" data-testid="wizard-question">
      <header className="question-heading">
        <p className="wizard-progress" data-testid="wizard-progress">
          Passo {index + 1} de {total}
        </p>
        <h2 ref={headingRef} tabIndex={-1}>
          {question.promptPt}
        </h2>
        <p className="question-instruction">{instructionForQuestion(question)}</p>
      </header>

      <div className="question-options">
        {missingDetectedOptions ? (
          <div className="empty-question" role="alert">
            <p>Não encontramos uma opção nos arquivos enviados.</p>
            <p>Volte aos arquivos, acrescente o que está faltando e envie novamente.</p>
          </div>
        ) : (
          <>
            {question.kind === "pick-color" && (
              <ColorOptions
                key={question.id}
                recommendedCount={question.recommendedCount}
                {...optionProps}
              />
            )}
            {question.kind === "pick-font" && (
              <FontOptions
                key={question.id}
                draftId={draftId}
                questionId={question.id as "font.heading" | "font.body"}
                {...optionProps}
              />
            )}
            {question.kind === "confirm-logo" && <LogoOptions draftId={draftId} {...optionProps} />}
            {question.kind === "review-identity" && (
              <IdentityOptions key={question.id} {...optionProps} />
            )}
          </>
        )}
      </div>
      <div className="action-row">
        <button
          data-testid="wizard-trocar-materiais"
          className="secondary-action"
          type="button"
          onClick={onRestart}
        >
          {missingDetectedOptions ? "Voltar aos arquivos" : "Trocar arquivos"}
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
          disabled={!validSelection(question, selected) || missingDetectedOptions}
          onClick={() => onConfirm(selected)}
        >
          {confirmationLabel(question)}
        </button>
      </div>
    </section>
  )
}
