import type { GuardCheck } from "../api/types"

interface GuardPanelProps {
  checks: GuardCheck[]
  onAction(check: GuardCheck): void
}

const ACTION_LABELS: Record<string, string> = {
  "required-slot": "Preencher campo",
  "text-length": "Editar texto",
  "text-overflow": "Editar texto",
  "image-resolution": "Trocar imagem",
  "font-fallback": "Rever marca",
}

function actionLabel(checkId: string): string {
  return ACTION_LABELS[checkId] ?? "Rever campo"
}

export function GuardPanel({ checks, onAction }: GuardPanelProps) {
  const visibleChecks = checks.filter((check) => check.status !== "pass")

  if (visibleChecks.length === 0) return null

  return (
    <section
      className="guard-panel"
      data-testid="guard-panel"
      aria-labelledby="guard-heading"
      aria-live="polite"
    >
      <h2 id="guard-heading">Itens para revisar</h2>
      <p>Corrija os itens abaixo ou baixe o arquivo sem alterações.</p>
      <ul>
        {visibleChecks.map((check, index) => (
          <li
            key={`${check.id}-${check.slotId ?? "geral"}-${index}`}
            className="guard-item"
            data-testid="guard-item"
            data-check-id={check.id}
            data-status={check.status}
            data-slot-id={check.slotId ?? undefined}
          >
            <p>{check.messagePt}</p>
            {check.slotId ? (
              <button
                type="button"
                className="guard-action"
                data-testid="guard-action"
                onClick={() => onAction(check)}
              >
                {actionLabel(check.id)}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
