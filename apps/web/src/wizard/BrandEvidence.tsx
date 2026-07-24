const evidence = [
  {
    name: "Manual em PDF",
    status: "Recomendado",
    description: "Cores, tipografia e regras da marca.",
  },
  {
    name: "Logo em SVG ou PNG",
    status: "Obrigatório",
    description: "Arquivo principal e versões disponíveis.",
  },
  {
    name: "Fontes em TTF ou OTF",
    status: "Opcional",
    description: "Use apenas arquivos que você pode enviar.",
  },
]

const process = [
  { name: "Enviar", description: "Adicione os arquivos da marca." },
  { name: "Conferir", description: "Revise somente os dados incertos." },
  { name: "Criar", description: "Escolha um modelo e edite a peça." },
]

export function BrandEvidence() {
  return (
    <aside className="brand-evidence" aria-label="Como usamos os arquivos da marca">
      <figure className="evidence-photo" data-motion-enter>
        <img
          src="/brand-archive.webp"
          alt="Manual, amostras de cor e arquivos da marca sobre uma mesa"
          width="1024"
          height="1536"
          loading="lazy"
          decoding="async"
        />
      </figure>

      <section className="evidence-checklist" aria-labelledby="evidence-files-title">
        <p className="panel-kicker">Antes de começar</p>
        <h2 id="evidence-files-title">Separe estes arquivos</h2>
        <ul>
          {evidence.map((item, index) => {
            return (
              <li key={item.name} className="evidence-item">
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{item.name}</strong>
                  <small>{item.status}</small>
                  <p>{item.description}</p>
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="evidence-process" aria-labelledby="evidence-process-title">
        <p className="panel-kicker">Como funciona</p>
        <h2 id="evidence-process-title">Três etapas</h2>
        <ol>
          {process.map((item, index) => (
            <li key={item.name}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{item.name}</strong>
                <p>{item.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </aside>
  )
}
