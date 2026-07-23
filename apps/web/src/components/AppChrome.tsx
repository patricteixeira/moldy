import type { PropsWithChildren } from "react"
import { Link, useLocation } from "react-router-dom"

export function AppChrome({ children }: PropsWithChildren) {
  const { pathname } = useLocation()
  const editorMatch = pathname.match(/^\/marcas\/([^/]+)\/editor\//)
  const revisionAreaMatch = pathname.match(/^\/marcas\/([^/]+)\/(kit|carrossel|word)$/)
  const revisionId = revisionAreaMatch?.[1]
  const area = revisionAreaMatch?.[2]
  const currentArea =
    area === "kit"
      ? "Kit"
      : area === "carrossel"
        ? "Carrossel"
        : area === "word"
          ? "Word"
          : pathname === "/"
            ? "Instalação"
            : "Página não encontrada"
  const contextHref = revisionId && area !== "kit" ? `/marcas/${encodeURIComponent(revisionId)}/kit` : "/"
  const contextLabel = revisionId && area !== "kit" ? "Kit" : pathname === "/" ? "Instalar marca" : "Instalação"

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
          <Link to={contextHref} aria-current={pathname === "/" ? "page" : undefined}>
            {contextLabel}
          </Link>
          {pathname !== "/" && <span className="app-route-current" aria-current="page">{currentArea}</span>}
        </nav>
      </header>
      {children}
      <footer className="app-footer">
        <p>Molda trabalha com os arquivos que você controla.</p>
        <div className="app-footer-meta">
          <p>Código aberto, AGPL-3.0</p>
          <p>Pode rodar no seu próprio servidor. Seus arquivos continuam sob seu controle.</p>
        </div>
      </footer>
    </div>
  )
}
