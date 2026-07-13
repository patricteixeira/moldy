import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitFor(url: string, label: string): Promise<void> {
  let lastFailure = "sem resposta"
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return
      lastFailure = `HTTP ${response.status}`
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error)
    }
    await sleep(1_000)
  }
  throw new Error(`${label} não ficou pronto em 60 s: ${lastFailure}`)
}

export default async function globalSetup(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    process.env.ENGINE_PYTHON,
    path.resolve(here, "../../../packages/engine/.venv/Scripts/python.exe"),
    path.resolve(here, "../../../packages/engine/.venv/bin/python"),
  ].filter((candidate): candidate is string => Boolean(candidate))
  const python = candidates.find((candidate) => fs.existsSync(candidate))
  if (!python) {
    throw new Error(
      "Python do engine não encontrado. Crie o venv de packages/engine (ver README) ou defina ENGINE_PYTHON.",
    )
  }

  execFileSync(python, [path.join(here, "fixtures", "generate_package.py")], {
    stdio: "inherit",
  })

  const baseUrl = (process.env.E2E_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "")
  await waitFor(`${baseUrl}/healthz`, "API")
  await waitFor(`${baseUrl}/v1/ping`, "proxy autenticado")
}
