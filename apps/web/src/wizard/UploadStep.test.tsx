import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { ApiProvider } from "../api/context"
import type { BrandImportProgress, ImportResult } from "../api/types"
import { fakeClient } from "../test/fakeApi"
import { UploadStep } from "./UploadStep"

const readyResult: ImportResult = {
  draftId: "d1",
  questions: [
    {
      id: "color.primary",
      kind: "pick-color",
      promptPt: "Qual destas é a cor principal da marca?",
      candidates: [{ value: "#1A4D8F", score: 1, evidence: [] }],
      required: true,
    },
  ],
  diagnostics: [],
  ignoredEntries: [],
}

it("envia o pacote e entrega o draft", async () => {
  const user = userEvent.setup()
  const importBrandPackage = vi.fn(async () => readyResult)
  const onDraft = vi.fn()
  render(
    <ApiProvider client={fakeClient({ importBrandPackage })}>
      <UploadStep onDraft={onDraft} />
    </ApiProvider>,
  )
  expect(screen.getByTestId("wizard-enviar")).toBeDisabled()
  const file = new File(["x"], "manual.pdf", { type: "application/pdf" })
  await user.upload(screen.getByTestId("wizard-file-input"), file)
  await user.click(screen.getByTestId("wizard-enviar"))
  expect(importBrandPackage).toHaveBeenCalledWith([file], expect.any(Function))
  await waitFor(() => expect(onDraft).toHaveBeenCalledWith(readyResult))
})

it("acumula seleções sucessivas sem duplicar o mesmo arquivo", async () => {
  const user = userEvent.setup()
  const importBrandPackage = vi.fn(async () => readyResult)
  render(
    <ApiProvider client={fakeClient({ importBrandPackage })}>
      <UploadStep onDraft={vi.fn()} />
    </ApiProvider>,
  )
  const input = screen.getByTestId("wizard-file-input")
  const manual = new File(["pdf"], "manual.pdf", { type: "application/pdf", lastModified: 1 })
  const logo = new File(["svg"], "logo.svg", { type: "image/svg+xml", lastModified: 2 })

  await user.upload(input, manual)
  await user.upload(input, logo)
  await user.upload(input, manual)

  expect(screen.getByText("arquivos escolhidos", { exact: false }).closest("p")).toHaveTextContent(
    "2 arquivos escolhidos",
  )
  expect(screen.getByRole("status")).toHaveTextContent(
    "Este arquivo já estava na seleção",
  )
  await user.click(screen.getByTestId("wizard-enviar"))
  expect(importBrandPackage).toHaveBeenCalledWith([manual, logo], expect.any(Function))
})

it("permite remover um material antes do envio", async () => {
  const user = userEvent.setup()
  render(
    <ApiProvider client={fakeClient()}>
      <UploadStep onDraft={vi.fn()} />
    </ApiProvider>,
  )
  const manual = new File(["pdf"], "manual.pdf", { type: "application/pdf" })
  const logo = new File(["svg"], "logo.svg", { type: "image/svg+xml" })
  await user.upload(screen.getByTestId("wizard-file-input"), [manual, logo])

  await user.click(screen.getByRole("button", { name: "Remover logo.svg" }))

  expect(screen.queryByText("logo.svg")).not.toBeInTheDocument()
  expect(screen.getByText("arquivo escolhido", { exact: false }).closest("p")).toHaveTextContent(
    "1 arquivo escolhido",
  )
})

it("falha da API vira alerta em PT-BR", async () => {
  const user = userEvent.setup()
  const importBrandPackage = vi.fn(async () => {
    throw Object.assign(new Error("x"), {
      messagePt: "Não foi possível falar com o servidor.",
    })
  })
  render(
    <ApiProvider client={fakeClient({ importBrandPackage })}>
      <UploadStep onDraft={vi.fn()} />
    </ApiProvider>,
  )
  await user.upload(screen.getByTestId("wizard-file-input"), new File(["x"], "manual.pdf"))
  await user.click(screen.getByTestId("wizard-enviar"))
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Não foi possível falar com o servidor.",
  )
})

it("congela a seleção de arquivos enquanto importa o pacote", async () => {
  let finish!: (result: ImportResult) => void
  const importBrandPackage = vi.fn(
    () =>
      new Promise<ImportResult>((resolve) => {
        finish = resolve
      }),
  )
  const onDraft = vi.fn()
  render(
    <ApiProvider client={fakeClient({ importBrandPackage })}>
      <UploadStep onDraft={onDraft} />
    </ApiProvider>,
  )
  const input = screen.getByTestId("wizard-file-input")
  await userEvent.upload(input, new File(["x"], "manual.pdf"))
  await userEvent.click(screen.getByTestId("wizard-enviar"))

  expect(input).toBeDisabled()
  expect(screen.getByTestId("wizard-enviar")).toBeDisabled()

  finish(readyResult)
  await waitFor(() => expect(onDraft).toHaveBeenCalledOnce())
  expect(input).toBeEnabled()
})

it("mostra as fases reais de preparação e processamento", async () => {
  let reportProgress: ((progress: BrandImportProgress) => void) | undefined
  let finish!: (result: ImportResult) => void
  const importBrandPackage = vi.fn(
    (
      _files: File[],
      onProgress?: (
        progress: { phase: "packaging" | "processing"; percent?: number },
      ) => void,
    ) => {
      reportProgress = onProgress
      onProgress?.({ phase: "packaging", percent: 42 })
      return new Promise<ImportResult>((resolve) => {
        finish = resolve
      })
    },
  )
  render(
    <ApiProvider client={fakeClient({ importBrandPackage })}>
      <UploadStep onDraft={vi.fn()} />
    </ApiProvider>,
  )

  await userEvent.upload(
    screen.getByTestId("wizard-file-input"),
    new File(["x"], "manual.pdf"),
  )
  await userEvent.click(screen.getByTestId("wizard-enviar"))

  expect(screen.getByText("Preparando pacote · 42%")).toBeInTheDocument()
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "42")

  act(() => reportProgress?.({ phase: "processing" }))
  expect(screen.getByText("Enviando e analisando materiais")).toBeInTheDocument()
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("value")

  await act(async () => finish(readyResult))
})

it("não avança com pergunta obrigatória vazia e mostra os diagnósticos", async () => {
  const user = userEvent.setup()
  const incomplete: ImportResult = {
    draftId: "d-incompleto",
    questions: [
      {
        id: "logo.primary",
        kind: "confirm-logo",
        promptPt: "Este é o logo principal da marca?",
        candidates: [],
        required: true,
      },
    ],
    diagnostics: [
      {
        code: "NO_LOGO_FOUND",
        target: "package",
        message: "Nenhum logo foi encontrado em assets/logos (SVG ou PNG).",
      },
    ],
    ignoredEntries: ["referencias/anotacao.txt"],
  }
  const onDraft = vi.fn()
  render(
    <ApiProvider client={fakeClient({ importBrandPackage: vi.fn(async () => incomplete) })}>
      <UploadStep onDraft={onDraft} />
    </ApiProvider>,
  )

  await user.upload(screen.getByTestId("wizard-file-input"), new File(["pdf"], "manual.pdf"))
  await user.click(screen.getByTestId("wizard-enviar"))

  const alert = await screen.findByRole("alert")
  expect(alert).toHaveTextContent("Ainda faltam alguns arquivos.")
  expect(alert).toHaveTextContent("Nenhum logo foi encontrado")
  expect(alert).toHaveTextContent("Adicione um logo em SVG ou PNG.")
  expect(alert).toHaveTextContent("referencias/anotacao.txt")
  expect(onDraft).not.toHaveBeenCalled()
  expect(screen.getByTestId("wizard-file-input")).toBeEnabled()
  expect(screen.getByText("manual.pdf")).toBeInTheDocument()
})

it("avança quando somente a fonte não foi detectada porque ela pode ser digitada", async () => {
  const user = userEvent.setup()
  const fontWithoutCandidate: ImportResult = {
    draftId: "d-fonte-manual",
    questions: [
      {
        id: "font.heading",
        kind: "pick-font",
        promptPt: "Qual é a fonte dos títulos?",
        candidates: [],
        required: true,
      },
    ],
    diagnostics: [],
    ignoredEntries: [],
  }
  const onDraft = vi.fn()
  render(
    <ApiProvider
      client={fakeClient({
        importBrandPackage: vi.fn(async () => fontWithoutCandidate),
      })}
    >
      <UploadStep onDraft={onDraft} />
    </ApiProvider>,
  )

  await user.upload(screen.getByTestId("wizard-file-input"), new File(["pdf"], "manual.pdf"))
  await user.click(screen.getByTestId("wizard-enviar"))

  await waitFor(() => expect(onDraft).toHaveBeenCalledWith(fontWithoutCandidate))
  expect(screen.queryByText("Ainda faltam alguns arquivos.")).not.toBeInTheDocument()
})

it("permite acrescentar materiais e reenviar depois de um pacote incompleto", async () => {
  const user = userEvent.setup()
  const incomplete: ImportResult = {
    ...readyResult,
    questions: [{ ...readyResult.questions[0], candidates: [] }],
    diagnostics: [],
  }
  const importBrandPackage = vi
    .fn<() => Promise<ImportResult>>()
    .mockResolvedValueOnce(incomplete)
    .mockResolvedValueOnce(readyResult)
  const onDraft = vi.fn()
  render(
    <ApiProvider client={fakeClient({ importBrandPackage })}>
      <UploadStep onDraft={onDraft} />
    </ApiProvider>,
  )

  const input = screen.getByTestId("wizard-file-input")
  const manual = new File(["pdf"], "manual.pdf")
  const logo = new File(["svg"], "logo.svg")
  await user.upload(input, manual)
  await user.click(screen.getByTestId("wizard-enviar"))
  expect(await screen.findByRole("alert")).toHaveTextContent("mostre as cores da marca")

  await user.upload(input, logo)
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  await user.click(screen.getByTestId("wizard-enviar"))

  await waitFor(() => expect(onDraft).toHaveBeenCalledWith(readyResult))
  expect(importBrandPackage).toHaveBeenLastCalledWith([manual, logo], expect.any(Function))
})
