import { useEffect, useReducer } from "react"
import { useNavigate } from "react-router-dom"
import { BrandEvidence } from "./BrandEvidence"
import { PublishStep } from "./PublishStep"
import { QuestionReviewRail } from "./QuestionReviewRail"
import { QuestionStep } from "./QuestionStep"
import { UploadStep } from "./UploadStep"
import { initialWizardState, wizardReducer } from "./state"

const heroByStep = {
  upload: {
    kicker: "Passo 1 de 3",
    title: "Envie os arquivos da marca.",
    description: "Use o manual em PDF e pelo menos um logo em SVG ou PNG.",
    benchLabel: "ENVIAR ARQUIVOS",
  },
  question: {
    kicker: "Passo 2 de 3",
    title: "Confira os dados encontrados.",
    description: "Corrija apenas o que estiver errado.",
    benchLabel: "CONFERIR DADOS",
  },
  publish: {
    kicker: "Passo 3 de 3",
    title: "Dê um nome à marca.",
    description: "Usaremos esse nome no painel e nos arquivos.",
    benchLabel: "NOME DA MARCA",
  },
} as const

const taskSteps = [
  { id: "upload", label: "Enviar arquivos" },
  { id: "question", label: "Conferir dados" },
  { id: "publish", label: "Nomear marca" },
] as const

export function WizardPage() {
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState)
  const navigate = useNavigate()

  useEffect(() => {
    if (state.step === "done") {
      navigate(`/marcas/${encodeURIComponent(state.brandRevisionId)}/criar`)
    }
  }, [navigate, state])

  const visibleStep = state.step === "done" ? "publish" : state.step
  const hero = heroByStep[visibleStep]
  const activeStepIndex = taskSteps.findIndex((step) => step.id === visibleStep)

  return (
    <main id="main-content" className="wizard-page" data-wizard-step={visibleStep}>
      <header className="wizard-hero-copy">
        <p className="product-kicker">{hero.kicker}</p>
        <h1>{hero.title}</h1>
        <p>{hero.description}</p>
      </header>
      <ol className="wizard-task-steps" aria-label="Etapas para configurar a marca">
        {taskSteps.map((step, index) => (
          <li
            key={step.id}
            data-state={
              index < activeStepIndex ? "done" : index === activeStepIndex ? "current" : "next"
            }
            aria-current={index === activeStepIndex ? "step" : undefined}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{step.label}</strong>
          </li>
        ))}
      </ol>
      <div className="wizard-bench" data-stage-label={hero.benchLabel}>
        <div className="wizard-stage">
          <div hidden={state.step !== "upload"}>
            <UploadStep
              onDraft={(result) =>
                dispatch({
                  type: "draft-created",
                  draftId: result.draftId,
                  questions: result.questions,
                })
              }
            />
          </div>
          {state.step === "question" && (
            <QuestionStep
              draftId={state.draftId}
              question={state.questions[state.index]}
              index={state.index}
              total={state.questions.length}
              answers={state.answers}
              onConfirm={(value) =>
                dispatch({
                  type: "answer",
                  questionId: state.questions[state.index].id,
                  value,
                })
              }
              onSkip={() => dispatch({ type: "skip" })}
              onBack={() => dispatch({ type: "back" })}
              onRestart={() => dispatch({ type: "restart" })}
            />
          )}
          {state.step === "publish" && (
            <PublishStep
              draftId={state.draftId}
              answers={state.answers}
              onBack={() => dispatch({ type: "back" })}
              onPublished={(brandRevisionId) =>
                dispatch({ type: "published", brandRevisionId })
              }
            />
          )}
        </div>
        {state.step === "question" ? (
          <QuestionReviewRail
            questions={state.questions}
            currentIndex={state.index}
            answers={state.answers}
          />
        ) : (
          <BrandEvidence />
        )}
      </div>
    </main>
  )
}
