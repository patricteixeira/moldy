import { lazy, Suspense } from "react"
import { Link, Route, Routes } from "react-router-dom"
import { AppChrome } from "./components/AppChrome"
import { CarouselPage } from "./carousel/CarouselPage"
import { DocxBrandPage } from "./docx/DocxBrandPage"
import { EditorPage } from "./editor/EditorPage"
import { KitPage } from "./kit/KitPage"
import { WizardPage } from "./wizard/WizardPage"

const ProductMotion = lazy(() =>
  import("./components/ProductMotion").then((module) => ({ default: module.ProductMotion })),
)

export default function App() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Ir para o conteúdo principal
      </a>
      <AppChrome>
        <div className="motion-root">
          <Routes>
            <Route path="/" element={<WizardPage />} />
            <Route path="/marcas/:revisionId/kit" element={<KitPage />} />
            <Route path="/marcas/:revisionId/carrossel" element={<CarouselPage />} />
            <Route path="/marcas/:revisionId/word" element={<DocxBrandPage />} />
            <Route path="/marcas/:revisionId/editor/:layoutId" element={<EditorPage />} />
            <Route
              path="*"
              element={
                <main id="main-content" className="not-found-page" data-motion-enter>
                  <p className="product-kicker">Endereço desconhecido</p>
                  <h1>Página não encontrada</h1>
                  <p>Este endereço não leva a uma área do Molda.</p>
                  <Link className="primary-link" to="/">
                    Voltar ao início
                  </Link>
                </main>
              }
            />
          </Routes>
        </div>
        <Suspense fallback={null}>
          <ProductMotion />
        </Suspense>
      </AppChrome>
    </>
  )
}
