import { useEffect, useReducer } from "react"
import { useNavigate } from "react-router-dom"
import { PublishStep } from "./PublishStep"
import { QuestionStep } from "./QuestionStep"
import { UploadStep } from "./UploadStep"
import { initialWizardState, wizardReducer } from "./state"

export function WizardPage() {
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState)
  const navigate = useNavigate()

  useEffect(() => {
    if (state.step === "done") {
      navigate(`/marcas/${encodeURIComponent(state.brandRevisionId)}/kit`)
    }
  }, [navigate, state])

  return (
    <main id="main-content" className="wizard-page">
      <header className="page-heading">
        <p className="eyebrow">brand-runtime · instalação</p>
        <h1>Instalar marca</h1>
      </header>
      <div className="wizard-bench">
        <aside className="wizard-rail" aria-hidden="true">
          <span />
        </aside>
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
      </div>
    </main>
  )
}
