import { lazy, Suspense } from "react"
import { Link, Route, Routes } from "react-router-dom"
import { AppChrome } from "./components/AppChrome"
import { WizardPage } from "./wizard/WizardPage"

const ProductMotion = lazy(() =>
  import("./components/ProductMotion").then((module) => ({ default: module.ProductMotion })),
)
const CarouselPage = lazy(() =>
  import("./carousel/CarouselPage").then((module) => ({ default: module.CarouselPage })),
)
const CreatePage = lazy(() =>
  import("./create/CreatePage").then((module) => ({ default: module.CreatePage })),
)
const DocxBrandPage = lazy(() =>
  import("./docx/DocxBrandPage").then((module) => ({ default: module.DocxBrandPage })),
)
const EditorPage = lazy(() =>
  import("./editor/EditorPage").then((module) => ({ default: module.EditorPage })),
)
const KitPage = lazy(() =>
  import("./kit/KitPage").then((module) => ({ default: module.KitPage })),
)

function PageLoading() {
  return (
    <main id="main-content" className="loading-page">
      <p className="loading-note" role="status">
        Carregando esta área…
      </p>
    </main>
  )
}

export default function App() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Ir para o conteúdo principal
      </a>
      <AppChrome>
        <div className="motion-root">
          <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route path="/" element={<WizardPage />} />
              <Route path="/marcas/:revisionId/criar" element={<CreatePage />} />
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
          </Suspense>
        </div>
        <Suspense fallback={null}>
          <ProductMotion />
        </Suspense>
      </AppChrome>
    </>
  )
}
