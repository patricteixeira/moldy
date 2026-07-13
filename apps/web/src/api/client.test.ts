import { expect, it, vi } from "vitest"
import { contentAddressedPath, createApiClient } from "./client"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

it("importBrandPackage envia um ZIP no campo package", async () => {
  const response = {
    draftId: "d1",
    questions: [],
    diagnostics: [
      {
        code: "NO_LOGO_FOUND",
        target: "package",
        message: "Nenhum logo foi encontrado.",
      },
    ],
    ignoredEntries: ["anotacao.txt"],
  }
  const fetchFn = vi.fn(async () => jsonResponse(response))
  const client = createApiClient(fetchFn as unknown as typeof fetch)
  const files = [new File(["%PDF"], "manual.pdf"), new File(["<svg/>"], "logo.svg")]
  const result = await client.importBrandPackage(files)
  expect(result).toEqual(response)
  const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe("/v1/brands/imports")
  expect(init.method).toBe("POST")
  const pkg = (init.body as FormData).get("package") as File
  expect(pkg).toBeInstanceOf(Blob)
  expect(pkg.name).toBe("pacote.zip")
})

it("compileDraft embrulha as respostas em values (forma do Plano 3)", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ brandRevisionId: "brandrev_x" }))
  const client = createApiClient(fetchFn as unknown as typeof fetch)
  const out = await client.compileDraft("d1", { "color.primary": "#1A4D8F" }, "ACME")
  expect(out.brandRevisionId).toBe("brandrev_x")
  const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe("/v1/drafts/d1/compile")
  expect(JSON.parse(init.body as string)).toEqual({
    answers: { values: { "color.primary": "#1A4D8F" } },
    brandName: "ACME",
  })
})

it("createDocument posta o ContentSpec e devolve os checks do guard", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ documentId: "doc1", checks: [] }))
  const client = createApiClient(fetchFn as unknown as typeof fetch)
  const content = {
    layoutId: "statement-post-1x1",
    brandRevisionId: "brandrev_x",
    values: { headline: { kind: "text" as const, text: "Olá" } },
  }
  const out = await client.createDocument(content)
  expect(out.documentId).toBe("doc1")
  const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe("/v1/documents")
  expect(JSON.parse(init.body as string)).toEqual(content)
})

it("requestExport e getJob usam as rotas e o shape de job do Plano 3", async () => {
  const sha = "f".repeat(64)
  const fetchFn = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ jobId: "job1" }))
    .mockResolvedValueOnce(
      jsonResponse({
        id: "job1",
        status: "succeeded",
        result: { sha256: sha, url: `/v1/assets/${sha}` },
        checks: [],
        error: null,
      }),
    )
  const client = createApiClient(fetchFn as unknown as typeof fetch)
  await client.requestExport("doc1", "png")
  const job = await client.getJob("job1")
  expect(job.result?.url).toBe(`/v1/assets/${sha}`)
  expect(fetchFn.mock.calls[0][0]).toBe("/v1/documents/doc1/exports")
  expect(JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)).toEqual({
    format: "png",
  })
  expect(fetchFn.mock.calls[1][0]).toBe("/v1/jobs/job1")
})

it("erro HTTP vira ApiError com mensagem PT-BR do corpo", async () => {
  const fetchFn = vi.fn(async () =>
    jsonResponse({ detail: "Faltam respostas obrigatórias: color.primary" }, 422),
  )
  const client = createApiClient(fetchFn as unknown as typeof fetch)
  await expect(client.getKit("r1")).rejects.toMatchObject({
    status: 422,
    messagePt: "Faltam respostas obrigatórias: color.primary",
  })
})

it("urls de asset são relativas e estáveis", () => {
  const client = createApiClient(vi.fn() as unknown as typeof fetch)
  expect(client.draftAssetUrl("d1", "assets/logos/logo.svg")).toBe(
    "/v1/drafts/d1/assets/assets/logos/logo.svg",
  )
  expect(client.revisionAssetsBaseUrl("r1")).toBe("/v1/brand-revisions/r1/assets")
})

it("contentAddressedPath deriva o path fixado pelo Plano 3", () => {
  const sha = "ab".repeat(32)
  expect(contentAddressedPath(sha)).toBe(`sha256/ab/ab/${sha}`)
})
