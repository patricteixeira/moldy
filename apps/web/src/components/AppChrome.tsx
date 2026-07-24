import type { PropsWithChildren } from "react"
import { Link, useLocation } from "react-router-dom"

export function AppChrome({ children }: PropsWithChildren) {
  const { pathname } = useLocation()
  const editorMatch = pathname.match(/^\/marcas\/([^/]+)\/editor\//)
  const revisionAreaMatch = pathname.match(/^\/marcas\/([^/]+)\/(criar|kit|carrossel|word)$/)
  const revisionId = revisionAreaMatch?.[1]
  const area = revisionAreaMatch?.[2]
  const taskLinks = revisionId
    ? [
        { area: "criar", label: "Nova peça" },
        { area: "kit", label: "Modelos" },
        { area: "carrossel", label: "Carrossel" },
        { area: "word", label: "Word" },
      ]
    : []

  if (editorMatch) {
    return <div className="app-shell app-shell-editor">{children}</div>
  }

  return (
    <div className="app-shell" data-area={area ?? (pathname === "/" ? "installation" : "unknown")}>
      <header className="app-nav">
        <Link className="wordmark" to="/" aria-label="Molda, início">
          <span className="wordmark-symbol" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Molda</span>
        </Link>
        <nav className="app-nav-links" aria-label="Navegação principal">
          <Link to="/" aria-current={pathname === "/" ? "page" : undefined}>
            Configurar marca
          </Link>
          {taskLinks.map((task) => (
            <Link
              key={task.area}
              to={`/marcas/${encodeURIComponent(revisionId ?? "")}/${task.area}`}
              aria-current={area === task.area ? "page" : undefined}
            >
              {task.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
      <footer className="app-footer">
        <p>Crie peças com os arquivos da sua marca.</p>
        <div className="app-footer-meta">
          <p>Código aberto, AGPL-3.0</p>
          <p>Instale no seu servidor ou use a instância hospedada.</p>
        </div>
      </footer>
    </div>
  )
}
