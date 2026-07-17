import { useState } from "react"

const evidence = [
  {
    name: "Manual",
    description: "O PDF dá contexto para hierarquia, usos e decisões da identidade.",
  },
  {
    name: "Símbolos",
    description: "SVG e PNG preservam as versões originais da assinatura visual.",
  },
  {
    name: "Tipografia",
    description: "TTF e OTF mantêm a prévia fiel ao desenho aprovado da marca.",
  },
]

const notes = [
  "Os materiais existentes são tratados como fonte de verdade.",
  "Ambiguidades viram escolhas explícitas antes da publicação.",
  "O kit final limita o improviso sem limitar a criação.",
]

export function BrandEvidence() {
  const [activeEvidence, setActiveEvidence] = useState(0)
  const [activeNote, setActiveNote] = useState(0)

  const moveNote = (direction: -1 | 1) => {
    setActiveNote((current) => (current + direction + notes.length) % notes.length)
  }

  return (
    <aside className="brand-evidence" aria-label="Como o sistema interpreta a marca">
      <figure className="evidence-photo" data-motion-enter>
        <img
          src="/brand-archive.webp"
          alt="Manual de identidade, amostras de cor e materiais gráficos sobre uma mesa de estúdio"
          width="1024"
          height="1536"
        />
      </figure>

      <div className="evidence-accordion" role="group" aria-label="Materiais interpretados">
        {evidence.map((item, index) => {
          const active = index === activeEvidence
          return (
            <button
              key={item.name}
              type="button"
              className="evidence-item"
              aria-expanded={active}
              data-active={active || undefined}
              onClick={() => setActiveEvidence(index)}
              onFocus={() => setActiveEvidence(index)}
            >
              <strong>{item.name}</strong>
              <span>{item.description}</span>
            </button>
          )
        })}
      </div>

      <section className="evidence-carousel" aria-label="Princípios do processo">
        <p aria-live="polite">{notes[activeNote]}</p>
        <div className="evidence-carousel-controls">
          <button type="button" className="text-action" onClick={() => moveNote(-1)}>
            Anterior
          </button>
          <span aria-hidden="true">
            {activeNote + 1}/{notes.length}
          </span>
          <button type="button" className="text-action" onClick={() => moveNote(1)}>
            Próxima
          </button>
        </div>
      </section>
    </aside>
  )
}
