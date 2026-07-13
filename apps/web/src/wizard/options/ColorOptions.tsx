import type { Candidate } from "../../api/types"

interface Props {
  candidates: Candidate[]
  selected: unknown
  onSelect(value: unknown): void
}

export function ColorOptions({ candidates, selected, onSelect }: Props) {
  return (
    <div className="color-options" role="group" aria-label="Cores propostas">
      {candidates.map((candidate) => {
        const value = String(candidate.value)
        return (
          <button
            key={value}
            type="button"
            className="color-option"
            data-testid="candidate-option"
            data-value={value}
            aria-label={`Cor ${value}`}
            aria-pressed={selected === candidate.value}
            style={{ backgroundColor: value }}
            onClick={() => onSelect(candidate.value)}
          >
            <span className="visually-hidden">Amostra de cor</span>
          </button>
        )
      })}
    </div>
  )
}
