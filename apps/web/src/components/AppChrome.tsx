import type { PropsWithChildren } from "react"
import { Link, useLocation } from "react-router-dom"

export function AppChrome({ children }: PropsWithChildren) {
  const { pathname } = useLocation()
  const editorMatch = pathname.match(/^\/marcas\/([^/]+)\/editor\//)
  const kitMatch = pathname.match(/^\/marcas\/([^/]+)\/kit$/)
  const currentArea = editorMatch ? "Editor" : kitMatch ? "Kit" : pathname === "/" ? "Instalação" : "404"
  const contextHref = "/"
  const contextLabel = pathname === "/" ? "Instalar marca" : "Instalação"

  return (
    <div className="app-shell">
      <header className="app-nav">
        <Link className="wordmark" to="/" aria-label="brand-runtime, início">
          <span className="wordmark-mark" aria-hidden="true">
            <span>b</span>
            <span>r</span>
          </span>
          <span>brand-runtime</span>
        </Link>
        <nav className="app-nav-links" aria-label="Navegação principal">
          <Link to={contextHref} aria-current={pathname === "/" ? "page" : undefined}>
            {contextLabel}
          </Link>
          {pathname !== "/" && <span className="app-route-current" aria-current="page">{currentArea}</span>}
          <span className="app-runtime-status">
            <span aria-hidden="true" />
            Runtime local
          </span>
        </nav>
      </header>
      {children}
      <footer className="app-footer">
        <p>
          <span>Marca não é arquivo.</span>
          <span>É decisão em execução.</span>
        </p>
        <div className="app-footer-meta">
          <p>Open source / AGPL-3.0</p>
          <p>Self-hosted / dados sob seu controle</p>
        </div>
      </footer>
    </div>
  )
}
