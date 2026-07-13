import { createContext, type ReactNode, useContext } from "react"
import type { ApiClient } from "./types"

const ApiContext = createContext<ApiClient | null>(null)

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext)
  if (client === null) throw new Error("ApiProvider ausente")
  return client
}
