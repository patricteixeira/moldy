import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import App from "./App"
import { createApiClient } from "./api/client"
import { ApiProvider } from "./api/context"
import "./index.css"

const root = document.getElementById("root")
if (root === null) throw new Error("Raiz da aplicação não encontrada.")

createRoot(root).render(
  <StrictMode>
    <ApiProvider client={createApiClient()}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ApiProvider>
  </StrictMode>,
)
