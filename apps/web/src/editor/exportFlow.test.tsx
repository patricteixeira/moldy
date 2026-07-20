import { act, render, renderHook, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { ApiError } from "../api/client"
import { ApiProvider } from "../api/context"
import type { ApiClient, RoundtripJobInfo } from "../api/types"
import {
  fakeClient,
  fakeOnePagerLayout,
  fakeQuoteLayout,
  fakeStatementLayout,
} from "../test/fakeApi"
import { EditorPage } from "./EditorPage"
import { useExportFlow } from "./useExportFlow"

function renderEditor(client: ApiClient, layoutId = "statement-post-1x1") {
  return render(
    <ApiProvider client={client}>
      <MemoryRouter initialEntries={[`/marcas/brandrev_test/editor/${layoutId}`]}>
        <Routes>
          <Route
            path="/marcas/:revisionId/editor/:layoutId"
            element={<EditorPage pollIntervalMs={10} />}
          />
        </Routes>
      </MemoryRouter>
    </ApiProvider>,
  )
}

const kit = vi.fn(async () => [fakeStatementLayout(), fakeOnePagerLayout()])

it("orientação de marca aparece, permite exportar e mantém a ação de ajuste", async () => {
  const sha = "a".repeat(64)
  const warning = {
    id: "text-length",
    slotId: "headline",
    status: "warning" as const,
    messagePt: "O texto de «headline» tem 95 caracteres; o máximo deste layout é 90.",
    detail: {},
  }
  const createDocument = vi.fn(async () => ({
    documentId: "doc1",
    checks: [warning],
  }))
  const requestExport = vi.fn(async () => ({ jobId: "job-warning" }))
  const getJob = vi.fn(async () => ({
    id: "job-warning",
    status: "succeeded" as const,
    result: {
      sha256: sha,
      url: `/v1/assets/${sha}`,
      format: "png" as const,
      filename: "com-orientacao.png",
    },
    checks: [warning],
    error: null,
  }))
  renderEditor(fakeClient({ getKit: kit, createDocument, requestExport, getJob }))
  const input = await screen.findByTestId("slot-input-headline")
  await userEvent.click(input)
  await userEvent.paste("A".repeat(95))
  await userEvent.click(screen.getByTestId("exportar-png"))
  const item = await screen.findByTestId("guard-item")
  expect(item).toHaveAttribute("data-slot-id", "headline")
  await waitFor(() => expect(requestExport).toHaveBeenCalledWith("doc1", "png"))
  await userEvent.click(screen.getByTestId("guard-action"))
  expect(screen.getByTestId("slot-input-headline")).toHaveFocus()
})

it("export feliz: documento → job → link de download", async () => {
  const sha = "f".repeat(64)
  const createDocument = vi.fn(async () => ({ documentId: "doc1", checks: [] }))
  const requestExport = vi.fn(async () => ({ jobId: "job1" }))
  const getJob = vi
    .fn()
    .mockResolvedValueOnce({ id: "job1", status: "queued", result: null, checks: [], error: null })
    .mockResolvedValueOnce({ id: "job1", status: "running", result: null, checks: [], error: null })
    .mockResolvedValue({
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
    })
  renderEditor(fakeClient({ getKit: kit, createDocument, requestExport, getJob }))
  const input = await screen.findByTestId("slot-input-headline")
  await userEvent.clear(input)
  await userEvent.type(input, "Lançamento em agosto")
  await userEvent.click(screen.getByTestId("exportar-png"))
  const link = await screen.findByTestId("download-link", {}, { timeout: 3000 })
  expect(link).toHaveAttribute("href", `/v1/assets/${sha}`)
  expect(link).toHaveAttribute("download", "doc1.png")
  expect(screen.getByTestId("export-status")).toHaveTextContent("PNG pronto para baixar.")
  expect(createDocument).toHaveBeenCalledWith(
    expect.objectContaining({
      layoutId: "statement-post-1x1",
      brandRevisionId: "brandrev_test",
      overrides: {},
      surface: null,
      values: expect.objectContaining({
        headline: { kind: "text", text: "Lançamento em agosto" },
      }),
      addedSlots: expect.arrayContaining([
        expect.objectContaining({ id: "user-kicker-1" }),
        expect.objectContaining({ id: "user-signature-1" }),
      ]),
      addedLayers: expect.arrayContaining([
        expect.objectContaining({ id: "user-rule-1" }),
      ]),
    }),
  )
  expect(requestExport).toHaveBeenCalledWith("doc1", "png")
})

it("layout social oferece PPTX editável no Google Slides", async () => {
  const sha = "e".repeat(64)
  const requestExport = vi.fn(async () => ({ jobId: "job-pptx" }))
  const getJob = vi.fn(async () => ({
    id: "job-pptx",
    status: "succeeded" as const,
    result: {
      sha256: sha,
      url: `/v1/assets/${sha}`,
      format: "pptx" as const,
      filename: "statement-post-1x1.pptx",
    },
    checks: [],
    error: null,
  }))
  renderEditor(fakeClient({ getKit: kit, requestExport, getJob }))

  const editableButton = await screen.findByTestId("exportar-pptx")
  expect(screen.getByTestId("exportar-png")).toHaveTextContent("Pronto para publicar")
  expect(editableButton).toHaveTextContent("Arquivo editável")
  expect(editableButton).toHaveTextContent("Edite no PowerPoint ou Google Slides")

  await userEvent.click(editableButton)

  const link = await screen.findByTestId("download-link")
  expect(requestExport).toHaveBeenCalledWith("doc_x", "pptx")
  expect(link).toHaveAttribute("download", "statement-post-1x1.pptx")
  expect(link).toHaveTextContent("Baixar PPTX")
  expect(screen.getByTestId("export-status")).toHaveTextContent("PPTX pronto para baixar.")
})

it("confere o PPTX que voltou e oferece uma cópia corrigida sem expor jargão", async () => {
  const exportSha = "e".repeat(64)
  const fixedSha = "c".repeat(64)
  const requestExport = vi.fn(async () => ({ jobId: "job-pptx" }))
  const getJob = vi.fn(async () => ({
    id: "job-pptx",
    status: "succeeded" as const,
    result: {
      sha256: exportSha,
      url: `/v1/assets/${exportSha}`,
      format: "pptx" as const,
      filename: "statement-post-1x1.pptx",
    },
    checks: [],
    error: null,
  }))
  const requestRoundtrip = vi.fn(async () => ({ jobId: "job-analysis" }))
  const requestRoundtripFix = vi.fn(async () => ({ jobId: "job-fix" }))
  const textFinding = {
    code: "text-changed",
    severity: "info" as const,
    messagePt: "O texto foi editado.",
    nodeId: "node-title",
    slotId: "headline",
    expected: "Texto original",
    actual: "Texto da pessoa",
    fixable: false,
  }
  const getRoundtripJob = vi.fn(async (jobId: string): Promise<RoundtripJobInfo> => {
    if (jobId === "job-fix") {
      return {
        id: jobId,
        status: "succeeded",
        result: {
          kind: "roundtrip-fix",
          sha256: fixedSha,
          url: `/v1/assets/${fixedSha}`,
          format: "pptx",
          filename: "statement-post-1x1-corrigido.pptx",
          fixResult: {
            schemaVersion: "0.1.0",
            sourceSha256: "b".repeat(64),
            fixedSha256: fixedSha,
            outputFilename: "statement-post-1x1-corrigido.pptx",
            appliedOperationIds: ["fix-color"],
            report: {
              schemaVersion: "0.1.0",
              baselineSha256: "a".repeat(64),
              editedSha256: fixedSha,
              summary: {
                status: "review",
                total: 1,
                info: 1,
                warning: 0,
                error: 0,
                locked: 0,
                fixable: 0,
              },
              findings: [textFinding],
            },
          },
        },
        checks: [],
        error: null,
      }
    }
    return {
      id: jobId,
      status: "succeeded",
      result: {
        kind: "roundtrip-lint",
        baselineGraph: {},
        documentGraph: {},
        report: {
          schemaVersion: "0.1.0",
          baselineSha256: "a".repeat(64),
          editedSha256: "b".repeat(64),
          summary: {
            status: "review",
            total: 2,
            info: 1,
            warning: 1,
            error: 0,
            locked: 0,
            fixable: 1,
          },
          findings: [
            textFinding,
            {
              code: "color-changed",
              severity: "warning",
              messagePt: "A cor saiu do padrão.",
              nodeId: "node-title",
              slotId: "headline",
              expected: "#1844D8",
              actual: "#FF00FF",
              fixable: true,
            },
          ],
        },
        fixPlan: {
          schemaVersion: "0.1.0",
          baselineSha256: "a".repeat(64),
          editedSha256: "b".repeat(64),
          operations: [
            {
              id: "fix-color",
              slideIndex: 0,
              nodeId: "node-title",
              role: "heading",
              slotId: "headline",
              property: "color",
              expected: "#1844D8",
              sourceCodes: ["color-changed"],
            },
          ],
          deferredFindingCodes: ["text-changed"],
        },
      },
      checks: [],
      error: null,
    }
  })
  renderEditor(
    fakeClient({
      getKit: kit,
      requestExport,
      getJob,
      requestRoundtrip,
      requestRoundtripFix,
      getRoundtripJob,
    }),
  )

  await screen.findByTestId("slot-input-headline")
  await userEvent.click(screen.getByTestId("exportar-pptx"))
  expect(await screen.findByText("Confira o arquivo que voltou")).toBeInTheDocument()

  const edited = new File(["pptx"], "editado-no-google.pptx", {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  })
  await userEvent.upload(screen.getByTestId("roundtrip-file"), edited)
  await userEvent.click(screen.getByTestId("roundtrip-analyze"))

  expect(await screen.findByText("Texto mantido")).toBeInTheDocument()
  expect(screen.getAllByText("Cor").length).toBeGreaterThan(0)
  expect(screen.getByText("ajuste seguro").closest("p")).toHaveTextContent("1ajuste seguro")
  expect(screen.queryByText("#1844D8")).not.toBeInTheDocument()
  expect(screen.queryByText("#FF00FF")).not.toBeInTheDocument()
  expect(requestRoundtrip).toHaveBeenCalledWith("job-pptx", edited)

  await userEvent.click(screen.getByTestId("roundtrip-fix"))
  const corrected = await screen.findByTestId("roundtrip-download")
  expect(requestRoundtripFix).toHaveBeenCalledWith("job-analysis")
  expect(corrected).toHaveAttribute("href", `/v1/assets/${fixedSha}`)
  expect(corrected).toHaveAttribute("download", "statement-post-1x1-corrigido.pptx")
  expect(corrected).toHaveTextContent("Baixar cópia corrigida")
})

it("job falho mostra erro e checks medidos em PT-BR", async () => {
  const getJob = vi.fn(async () => ({
    id: "job1",
    status: "failed" as const,
    result: null,
    checks: [
      {
        id: "asset-integrity",
        slotId: "photo",
        status: "blocked" as const,
        messagePt: "O arquivo não corresponde ao conteúdo enviado.",
        detail: {},
      },
    ],
    error: "O render encontrou pendências — corrija antes de exportar.",
  }))
  renderEditor(fakeClient({ getKit: kit, getJob }))
  const input = await screen.findByTestId("slot-input-headline")
  await userEvent.type(input, "Olá")
  await userEvent.click(screen.getByTestId("exportar-png"))
  expect(await screen.findByRole("alert")).toHaveTextContent("pendências")
  expect(await screen.findByTestId("guard-item")).toHaveAttribute(
    "data-check-id",
    "asset-integrity",
  )
  expect(screen.queryByTestId("export-status")).not.toBeInTheDocument()
})

it("backstop 409 preserva os checks e a mensagem da API", async () => {
  const blocked = {
    id: "asset-integrity",
    slotId: "photo",
    status: "blocked" as const,
    messagePt: "O arquivo não corresponde ao conteúdo enviado.",
    detail: {},
  }
  const requestExport = vi.fn(async () => {
    throw new ApiError(409, "A exportação ainda tem pendências.", [blocked])
  })
  renderEditor(fakeClient({ getKit: kit, requestExport }))
  await screen.findByTestId("slot-input-headline")
  await userEvent.click(screen.getByTestId("exportar-png"))

  expect(await screen.findByRole("alert")).toHaveTextContent("ainda tem pendências")
  expect(screen.getByTestId("guard-item")).toHaveAttribute("data-check-id", "asset-integrity")
})

it("layout doc-a4 oferece PDF final e DOCX editável no Google Docs", async () => {
  const sha = "d".repeat(64)
  const requestExport = vi.fn(async () => ({ jobId: "job-docx" }))
  const getJob = vi.fn(async () => ({
    id: "job-docx",
    status: "succeeded" as const,
    result: {
      sha256: sha,
      url: `/v1/assets/${sha}`,
      format: "docx" as const,
      filename: "one-pager-doc-a4.docx",
    },
    checks: [],
    error: null,
  }))
  renderEditor(fakeClient({ getKit: kit, requestExport, getJob }), "one-pager-doc-a4")
  await screen.findByTestId("slot-input-title")
  expect(screen.getByTestId("exportar-pdf")).toHaveTextContent("Exportar PDF")
  expect(screen.getByTestId("exportar-pdf")).toHaveTextContent("Pronto para compartilhar")
  expect(screen.queryByTestId("exportar-png")).not.toBeInTheDocument()

  const editableButton = screen.getByTestId("exportar-docx")
  expect(editableButton).toHaveTextContent("Edite no Word ou Google Docs")
  await userEvent.click(editableButton)

  const link = await screen.findByTestId("download-link")
  expect(requestExport).toHaveBeenCalledWith("doc_x", "docx")
  expect(link).toHaveAttribute("download", "one-pager-doc-a4.docx")
  expect(link).toHaveTextContent("Baixar DOCX")
})

it("bloqueia a exportação enquanto a foto ainda está sendo enviada", async () => {
  let finishUpload!: (value: { sha256: string; size: number }) => void
  const uploadAsset = vi.fn(
    () =>
      new Promise<{ sha256: string; size: number }>((resolve) => {
        finishUpload = resolve
      }),
  )
  const createDocument = vi.fn()
  renderEditor(
    fakeClient({
      createDocument,
      getKit: vi.fn(async () => [fakeQuoteLayout()]),
      uploadAsset,
    }),
    "quote-post-1x1",
  )
  await userEvent.click(await screen.findByRole("button", { name: "Foto" }))
  const input = await screen.findByTestId("slot-image-input-photo")
  await userEvent.upload(input, new File(["png"], "foto.png", { type: "image/png" }))

  const exportButton = screen.getByTestId("exportar-png")
  const editableButton = screen.getByTestId("exportar-pptx")
  expect(exportButton).toBeDisabled()
  expect(editableButton).toBeDisabled()
  await userEvent.click(exportButton)
  expect(createDocument).not.toHaveBeenCalled()

  const sha256 = "c".repeat(64)
  finishUpload({ sha256, size: 3 })
  expect(await screen.findByText("Foto pronta.")).toBeInTheDocument()
  expect(exportButton).toBeEnabled()
  expect(editableButton).toBeEnabled()
})

it("congela os slots enquanto o arquivo está sendo gerado", async () => {
  let finishJob!: (job: {
    id: string
    status: "succeeded"
    result: {
      sha256: string
      url: string
      format: "pptx"
      filename: string
    }
    checks: []
    error: null
  }) => void
  const getJob = vi.fn(
    () =>
      new Promise<{
        id: string
        status: "succeeded"
        result: {
          sha256: string
          url: string
          format: "pptx"
          filename: string
        }
        checks: []
        error: null
      }>((resolve) => {
        finishJob = resolve
      }),
  )
  renderEditor(fakeClient({ getKit: kit, getJob }))
  const input = await screen.findByTestId("slot-input-headline")
  await userEvent.type(input, "Conteúdo congelado")
  await userEvent.click(screen.getByTestId("exportar-pptx"))

  expect(await screen.findByText("Gerando PPTX…")).toBeInTheDocument()
  expect(input).toBeDisabled()
  expect(screen.getByTestId("exportar-png")).toBeDisabled()
  expect(screen.getByTestId("exportar-pptx")).toBeDisabled()

  const sha256 = "a".repeat(64)
  finishJob({
    id: "job_x",
    status: "succeeded",
    result: {
      sha256,
      url: `/v1/assets/${sha256}`,
      format: "pptx",
      filename: "doc_x.pptx",
    },
    checks: [],
    error: null,
  })
  expect(await screen.findByText("PPTX pronto para baixar.")).toBeInTheDocument()
  await waitFor(() => {
    expect(input).toBeEnabled()
    expect(screen.getByTestId("exportar-png")).toBeEnabled()
    expect(screen.getByTestId("exportar-pptx")).toBeEnabled()
  })
})

it("encerra um export preso depois de cinco minutos", async () => {
  vi.useFakeTimers()
  try {
    const client = fakeClient({ getJob: vi.fn(() => new Promise<never>(() => undefined)) })
    const { result } = renderHook(() =>
      useExportFlow(
        client,
        {
          brandRevisionId: "brandrev_test",
          layoutId: "statement-post-1x1",
          values: {},
        },
        "png",
        1000,
      ),
    )

    await act(async () => {
      const run = result.current.run()
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      await run
    })

    expect(result.current.pending).toBe(false)
    expect(result.current.status).toBeNull()
    expect(result.current.error).toBe("A geração demorou mais de 5 minutos. Tente novamente.")
  } finally {
    vi.useRealTimers()
  }
})
