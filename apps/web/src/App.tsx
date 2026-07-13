import { Link, Route, Routes } from "react-router-dom"
import { EditorPage } from "./editor/EditorPage"
import { KitPage } from "./kit/KitPage"
import { WizardPage } from "./wizard/WizardPage"

export default function App() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Ir para o conteúdo principal
      </a>
      <Routes>
        <Route path="/" element={<WizardPage />} />
        <Route path="/marcas/:revisionId/kit" element={<KitPage />} />
        <Route path="/marcas/:revisionId/editor/:layoutId" element={<EditorPage />} />
        <Route
          path="*"
          element={
            <main id="main-content" className="wizard-page">
              <h1>Página não encontrada</h1>
              <p>Este endereço não leva a uma área do brand-runtime.</p>
              <Link to="/">Voltar ao início</Link>
            </main>
          }
        />
      </Routes>
    </>
  )
}
