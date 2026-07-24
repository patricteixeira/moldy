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
  const progress: Array<{ phase: string; percent?: number }> = []
  const result = await client.importBrandPackage(files, (value) => progress.push(value))
  expect(result).toEqual(response)
  expect(progress[0]).toEqual({ phase: "packaging", percent: 0 })
  expect(progress.at(-1)).toEqual({ phase: "processing" })
  expect(progress).toContainEqual({ phase: "packaging", percent: 100 })
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

it("resolveDraftFont envia apenas papel tipográfico e nome informado", async () => {
  const response = {
    candidate: {
      value: { family: "General Sans", weight: 400, style: "normal" },
      score: 1,
      evidence: [],
    },
    status: "vendor-hosted",
  }
  const fetchFn = vi.fn(async () => jsonResponse(response))
  const client = createApiClient(fetchFn as unknown as typeof fetch)

  await expect(client.resolveDraftFont("d1", "font.body", "General Sans")).resolves.toEqual(
    response,
  )
  const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe("/v1/drafts/d1/fonts/resolve")
  expect(init.method).toBe("POST")
  expect(JSON.parse(init.body as string)).toEqual({
    questionId: "font.body",
    family: "General Sans",
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
        result: {
          sha256: sha,
          url: `/v1/assets/${sha}`,
          format: "png",
          filename: "doc1.png",
        },
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

it("round-trip envia o PPTX e usa os jobs persistidos para conferir e corrigir", async () => {
  const fetchFn = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ jobId: "job-analysis" }))
    .mockResolvedValueOnce(jsonResponse({ jobId: "job-fix" }))
    .mockResolvedValueOnce(
      jsonResponse({
        id: "job-analysis",
        status: "succeeded",
        result: null,
        checks: [],
        error: null,
      }),
    )
  const client = createApiClient(fetchFn as unknown as typeof fetch)
  const edited = new File(["pptx"], "editado.pptx", {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  })

  await client.requestRoundtrip("job-export", edited)
  await client.requestRoundtripFix("job-analysis")
  await client.getRoundtripJob("job-analysis")

  expect(fetchFn.mock.calls[0][0]).toBe("/v1/jobs/job-export/roundtrips")
  expect((fetchFn.mock.calls[0][1] as RequestInit).method).toBe("POST")
  expect(((fetchFn.mock.calls[0][1] as RequestInit).body as FormData).get("file")).toBe(edited)
  expect(fetchFn.mock.calls[1][0]).toBe("/v1/jobs/job-analysis/fixes")
  expect((fetchFn.mock.calls[1][1] as RequestInit).method).toBe("POST")
  expect(fetchFn.mock.calls[2][0]).toBe("/v1/jobs/job-analysis")
})

it("updateCarouselSlide persiste o ContentSpec no slide correto", async () => {
  const response = {
    id: "slide_2",
    content: { layoutId: "statement-post-1x1", brandRevisionId: "brandrev_x", values: {} },
  }
  const fetchFn = vi.fn(async () => jsonResponse(response))
  const client = createApiClient(fetchFn as unknown as typeof fetch)
  const content = {
    layoutId: "statement-post-1x1",
    brandRevisionId: "brandrev_x",
    values: { headline: { kind: "text" as const, text: "Texto editado" } },
  }

  await client.updateCarouselSlide("carousel x", "slide/2", content)

  const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe("/v1/carousels/carousel%20x/slides/slide%2F2")
  expect(init.method).toBe("PATCH")
  expect(JSON.parse(init.body as string)).toEqual(content)
})

it("campanhas usam uma fonte compartilhada e atualização parcial da entidade", async () => {
  const fetchFn = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse([]))
    .mockResolvedValueOnce(jsonResponse({ id: "campaign_x" }))
    .mockResolvedValueOnce(jsonResponse({ id: "campaign_x" }))
  const client = createApiClient(fetchFn as unknown as typeof fetch)
  const fields = {
    headline: "Lançamento",
    body: "Mensagem",
    cta: "Conheça",
    date: "24 de julho",
    imageSha256: null,
  }

  await client.listCampaigns("brandrev_x")
  await client.createCampaign({
    brandRevisionId: "brandrev_x",
    name: "Julho",
    fields,
    layoutIds: ["announce-post-1x1"],
  })
  await client.updateCampaign("campaign_x", { name: "Julho 2", fields })

  expect(fetchFn.mock.calls[0][0]).toBe("/v1/brand-revisions/brandrev_x/campaigns")
  expect(fetchFn.mock.calls[1][0]).toBe("/v1/campaigns")
  expect(JSON.parse((fetchFn.mock.calls[1][1] as RequestInit).body as string)).toEqual({
    brandRevisionId: "brandrev_x",
    name: "Julho",
    fields,
    layoutIds: ["announce-post-1x1"],
  })
  expect(fetchFn.mock.calls[2][0]).toBe("/v1/campaigns/campaign_x")
  expect((fetchFn.mock.calls[2][1] as RequestInit).method).toBe("PATCH")
})

it("aplicação de marca ao Word separa análise, consentimento e download", async () => {
  const fetchFn = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ jobId: "job-analysis" }))
    .mockResolvedValueOnce(jsonResponse({ jobId: "job-apply" }))
    .mockResolvedValueOnce(
      jsonResponse({
        id: "job-apply",
        status: "succeeded",
        result: null,
        checks: [],
        error: null,
      }),
    )
  const client = createApiClient(fetchFn as unknown as typeof fetch)
  const source = new File(["docx"], "proposta.docx")

  await client.requestDocxBranding("brandrev_x", source)
  await client.requestDocxBrandApply("job-analysis")
  await client.getDocxBrandJob("job-apply")

  expect(fetchFn.mock.calls[0][0]).toBe("/v1/brand-revisions/brandrev_x/docx-brandings")
  expect(((fetchFn.mock.calls[0][1] as RequestInit).body as FormData).get("file")).toBe(source)
  expect(fetchFn.mock.calls[1][0]).toBe("/v1/jobs/job-analysis/docx-brandings")
  expect((fetchFn.mock.calls[1][1] as RequestInit).method).toBe("POST")
  expect(fetchFn.mock.calls[2][0]).toBe("/v1/jobs/job-apply")
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
