import { act, render, renderHook, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { ApiError } from "../api/client"
import { ApiProvider } from "../api/context"
import type { ApiClient } from "../api/types"
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

it("verdict com blocked mostra o guard e não exporta; ação foca o slot", async () => {
  const createDocument = vi.fn(async () => ({
    documentId: "doc1",
    checks: [
      {
        id: "text-length",
        slotId: "headline",
        status: "blocked" as const,
        messagePt: "O texto de «headline» tem 95 caracteres; o máximo deste layout é 90.",
        detail: {},
      },
    ],
  }))
  const requestExport = vi.fn()
  renderEditor(fakeClient({ getKit: kit, createDocument, requestExport }))
  const input = await screen.findByTestId("slot-input-headline")
  await userEvent.click(input)
  await userEvent.paste("A".repeat(95))
  await userEvent.click(screen.getByTestId("exportar-png"))
  const item = await screen.findByTestId("guard-item")
  expect(item).toHaveAttribute("data-slot-id", "headline")
  expect(requestExport).not.toHaveBeenCalled()
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
      result: { sha256: sha, url: `/v1/assets/${sha}` },
      checks: [],
      error: null,
    })
  renderEditor(fakeClient({ getKit: kit, createDocument, requestExport, getJob }))
  const input = await screen.findByTestId("slot-input-headline")
  await userEvent.type(input, "Lançamento em agosto")
  await userEvent.click(screen.getByTestId("exportar-png"))
  const link = await screen.findByTestId("download-link", {}, { timeout: 3000 })
  expect(link).toHaveAttribute("href", `/v1/assets/${sha}`)
  expect(link).toHaveAttribute("download")
  expect(screen.getByTestId("export-status")).toHaveTextContent("Arquivo pronto.")
  expect(createDocument).toHaveBeenCalledWith({
    layoutId: "statement-post-1x1",
    brandRevisionId: "brandrev_test",
    values: { headline: { kind: "text", text: "Lançamento em agosto" } },
  })
  expect(requestExport).toHaveBeenCalledWith("doc1", "png")
})

it("job falho mostra erro e checks medidos em PT-BR", async () => {
  const getJob = vi.fn(async () => ({
    id: "job1",
    status: "failed" as const,
    result: null,
    checks: [
      {
        id: "text-overflow",
        slotId: "headline",
        status: "blocked" as const,
        messagePt: "O texto ultrapassa a área disponível.",
        detail: { contentPx: 500, boxPx: 432 },
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
    "text-overflow",
  )
  expect(screen.queryByTestId("export-status")).not.toBeInTheDocument()
})

it("backstop 409 preserva os checks e a mensagem da API", async () => {
  const blocked = {
    id: "required-slot",
    slotId: "headline",
    status: "blocked" as const,
    messagePt: "Preencha o campo Título.",
    detail: {},
  }
  const requestExport = vi.fn(async () => {
    throw new ApiError(409, "A exportação ainda tem pendências.", [blocked])
  })
  renderEditor(fakeClient({ getKit: kit, requestExport }))
  await screen.findByTestId("slot-input-headline")
  await userEvent.click(screen.getByTestId("exportar-png"))

  expect(await screen.findByRole("alert")).toHaveTextContent("ainda tem pendências")
  expect(screen.getByTestId("guard-item")).toHaveAttribute("data-check-id", "required-slot")
})

it("layout doc-a4 exporta PDF", async () => {
  renderEditor(fakeClient({ getKit: kit }), "one-pager-doc-a4")
  await screen.findByTestId("slot-input-title")
  expect(screen.getByTestId("exportar-pdf")).toHaveTextContent("Exportar PDF")
  expect(screen.queryByTestId("exportar-png")).not.toBeInTheDocument()
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
  const input = await screen.findByTestId("slot-image-input-photo")
  await userEvent.upload(input, new File(["png"], "foto.png", { type: "image/png" }))

  const exportButton = screen.getByTestId("exportar-png")
  expect(exportButton).toBeDisabled()
  await userEvent.click(exportButton)
  expect(createDocument).not.toHaveBeenCalled()

  const sha256 = "c".repeat(64)
  finishUpload({ sha256, size: 3 })
  expect(await screen.findByText("Foto pronta.")).toBeInTheDocument()
  expect(exportButton).toBeEnabled()
})

it("congela os slots enquanto o arquivo está sendo gerado", async () => {
  let finishJob!: (job: {
    id: string
    status: "succeeded"
    result: { sha256: string; url: string }
    checks: []
    error: null
  }) => void
  const getJob = vi.fn(
    () =>
      new Promise<{
        id: string
        status: "succeeded"
        result: { sha256: string; url: string }
        checks: []
        error: null
      }>((resolve) => {
        finishJob = resolve
      }),
  )
  renderEditor(fakeClient({ getKit: kit, getJob }))
  const input = await screen.findByTestId("slot-input-headline")
  await userEvent.type(input, "Conteúdo congelado")
  await userEvent.click(screen.getByTestId("exportar-png"))

  expect(await screen.findByText("Gerando arquivo…")).toBeInTheDocument()
  expect(input).toBeDisabled()

  const sha256 = "a".repeat(64)
  finishJob({
    id: "job_x",
    status: "succeeded",
    result: { sha256, url: `/v1/assets/${sha256}` },
    checks: [],
    error: null,
  })
  expect(await screen.findByText("Arquivo pronto.")).toBeInTheDocument()
  expect(input).toBeEnabled()
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
