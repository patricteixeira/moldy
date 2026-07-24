import { type DragEvent, type FormEvent, useEffect, useRef, useState } from "react"
import { useApi } from "../api/context"
import type {
  BrandImportProgress,
  Diagnostic,
  DraftQuestion,
  ImportResult,
} from "../api/types"
import { blockingRequiredQuestions } from "./state"

interface IntakeIssues {
  blockingQuestions: DraftQuestion[]
  diagnostics: Diagnostic[]
  ignoredEntries: string[]
}

function actionForQuestion(question: DraftQuestion): string {
  if (question.kind === "confirm-logo") return "Adicione um logo em SVG ou PNG."
  if (question.kind === "pick-font") {
    return "Adicione os arquivos de fonte ou um manual que informe os nomes das fontes."
  }
  return "Adicione um manual, um arquivo de cores ou um logo que mostre as cores da marca."
}

function uniqueDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return Array.from(
    new Map(
      diagnostics.map((diagnostic) => [
        `${diagnostic.code}:${diagnostic.target}:${diagnostic.message}`,
        diagnostic,
      ]),
    ).values(),
  )
}

function actionsForIssues(questions: DraftQuestion[]): string[] {
  if (questions.length === 0) {
    return ["Adicione um manual em PDF, um logo em SVG ou PNG e as fontes da marca."]
  }
  return Array.from(new Set(questions.map(actionForQuestion)))
}

export function UploadStep({ onDraft }: { onDraft(result: ImportResult): void }) {
  const api = useApi()
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<BrandImportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null)
  const [intakeIssues, setIntakeIssues] = useState<IntakeIssues | null>(null)
  const generation = useRef(0)
  useEffect(() => () => {
    generation.current += 1
  }, [])

  const addFiles = (incoming: File[]) => {
    setIntakeIssues(null)
    const keys = new Set(
      files.map(
        (file) =>
          `${file.webkitRelativePath}:${file.name.normalize("NFC").toLocaleLowerCase("pt-BR")}:${file.type}:${file.size}:${file.lastModified}`,
      ),
    )
    const additions: File[] = []
    let repeated = 0
    for (const file of incoming) {
      const key = `${file.webkitRelativePath}:${file.name.normalize("NFC").toLocaleLowerCase("pt-BR")}:${file.type}:${file.size}:${file.lastModified}`
      if (keys.has(key)) {
        repeated += 1
        continue
      }
      keys.add(key)
      additions.push(file)
    }
    setSelectionNotice(
      repeated > 0
        ? repeated === 1
          ? "Este arquivo já estava na seleção e não foi adicionado novamente."
          : `${repeated} arquivos já estavam na seleção e não foram adicionados novamente.`
        : null,
    )
    setFiles((current) => [...current, ...additions])
  }

  const removeFile = (fileToRemove: File) => {
    setIntakeIssues(null)
    setSelectionNotice(null)
    setFiles((current) => current.filter((file) => file !== fileToRemove))
  }

  const countByExtension = (extensions: string[]) =>
    files.filter((file) =>
      extensions.some((extension) => file.name.toLocaleLowerCase("pt-BR").endsWith(extension)),
    ).length

  const pdfCount = countByExtension([".pdf"])
  const logoCount = countByExtension([".svg", ".png"])
  const fontCount = countByExtension([".ttf", ".otf"])

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    if (!busy) addFiles(Array.from(event.dataTransfer.files))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (files.length === 0 || busy) return
    setBusy(true)
    setProgress({ phase: "packaging", percent: 0 })
    setError(null)
    setIntakeIssues(null)
    const current = ++generation.current
    try {
      const result = await api.importBrandPackage(files, (nextProgress) => {
        if (generation.current === current) setProgress(nextProgress)
      })
      if (generation.current !== current) return
      const blockingQuestions = blockingRequiredQuestions(result.questions)
      if (blockingQuestions.length > 0) {
        setIntakeIssues({
          blockingQuestions,
          diagnostics: uniqueDiagnostics(result.diagnostics),
          ignoredEntries: result.ignoredEntries,
        })
        return
      }
      onDraft(result)
    } catch (cause) {
      if (generation.current !== current) return
      setError(
        typeof cause === "object" && cause !== null && "messagePt" in cause
          ? String(cause.messagePt)
          : "Não foi possível ler os arquivos da marca.",
      )
    } finally {
      if (generation.current === current) {
        setBusy(false)
        setProgress(null)
      }
    }
  }

  return (
    <form className="upload-step" aria-busy={busy} onSubmit={submit}>
      <p className="intro-copy">
        Envie o manual, o logo, as fontes e outros arquivos da marca. Você pode adicionar mais
        arquivos depois.
      </p>
      <p className="accepted-formats">PDF, SVG, PNG, TTF, OTF e JSON</p>
      <label
        className="file-receiver"
        htmlFor="wizard-files"
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <span>Solte os arquivos da marca aqui.</span>
        <span className="file-receiver-action" aria-hidden="true">
          <strong>Escolher arquivos</strong>
          <small>ou arraste de qualquer pasta</small>
        </span>
        <input
          className="visually-hidden"
          id="wizard-files"
          name="brand-package"
          data-testid="wizard-file-input"
          type="file"
          multiple
          accept=".pdf,.svg,.png,.ttf,.otf,.json"
          disabled={busy}
          onChange={(event) => {
            addFiles(Array.from(event.currentTarget.files ?? []))
            event.currentTarget.value = ""
          }}
        />
      </label>
      {files.length > 0 && (
        <section className="package-summary" aria-labelledby="package-summary-title">
          <div className="package-summary-heading">
            <p id="package-summary-title" aria-live="polite">
              <strong>{files.length}</strong> {files.length === 1 ? "arquivo escolhido" : "arquivos escolhidos"}
              <span aria-hidden="true">, </span>
              {pdfCount} PDF, {logoCount} {logoCount === 1 ? "logo" : "logos"}, {fontCount}{" "}
              {fontCount === 1 ? "fonte" : "fontes"}
            </p>
            <button
              className="text-action"
              type="button"
              disabled={busy}
              onClick={() => {
                setFiles([])
                setIntakeIssues(null)
                setSelectionNotice(null)
              }}
            >
              Limpar seleção
            </button>
          </div>
          <ul className="file-list" aria-label="Arquivos escolhidos">
            {files.map((file) => (
              <li key={`${file.name}-${file.size}-${file.lastModified}`}>
                <span>{file.name}</span>
                <button
                  className="remove-file"
                  type="button"
                  disabled={busy}
                  aria-label={`Remover ${file.name}`}
                  onClick={() => removeFile(file)}
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
          {(pdfCount === 0 || logoCount === 0) && (
            <p className="package-warning" role="status">
              {pdfCount === 0 && logoCount === 0
                ? "Ainda faltam o manual em PDF e ao menos um logo em SVG ou PNG."
                : pdfCount === 0
                  ? "Ainda falta o manual da marca em PDF."
                  : "Ainda falta ao menos um logo em SVG ou PNG."}
            </p>
          )}
          {fontCount === 0 && (
            <p className="package-note">
              Se você não enviar os arquivos de fonte, o Molda tenta usar os nomes escritos no
              manual. A aparência pode ficar diferente até que as fontes sejam adicionadas.
            </p>
          )}
        </section>
      )}
      {selectionNotice && <p role="status">{selectionNotice}</p>}
      {busy && progress && (
        <section className="intake-progress" role="status" aria-live="polite" aria-atomic="true">
          <div className="intake-progress-heading">
            <span>Processamento</span>
            <strong>
              {progress.phase === "packaging"
                ? `Preparando pacote · ${Math.round(progress.percent ?? 0)}%`
                : "Enviando e analisando materiais"}
            </strong>
          </div>
          <progress
            aria-label={
              progress.phase === "packaging"
                ? "Progresso da preparação do pacote"
                : "Envio e análise em andamento"
            }
            max={100}
            value={progress.phase === "packaging" ? progress.percent : undefined}
          />
          <ol aria-label="Etapas do processamento">
            <li data-state={progress.phase === "packaging" ? "active" : "done"}>
              <span>01</span> Preparar pacote
            </li>
            <li data-state={progress.phase === "processing" ? "active" : "pending"}>
              <span>02</span> Enviar e analisar
            </li>
          </ol>
        </section>
      )}
      {intakeIssues && (
        <section className="intake-issues" role="alert" aria-labelledby="intake-issues-title">
          <h2 id="intake-issues-title">Ainda faltam alguns arquivos.</h2>
          {intakeIssues.diagnostics.length > 0 && (
            <ul>
              {intakeIssues.diagnostics.map((diagnostic) => (
                <li key={`${diagnostic.code}-${diagnostic.target}`}>{diagnostic.message}</li>
              ))}
            </ul>
          )}
          <ul>
            {actionsForIssues(intakeIssues.blockingQuestions).map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
          {intakeIssues.ignoredEntries.length > 0 && (
            <p>
              Arquivos ignorados: <span>{intakeIssues.ignoredEntries.join(", ")}</span>
            </p>
          )}
          <p>Adicione os arquivos que faltam e tente novamente.</p>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      <button data-testid="wizard-enviar" type="submit" disabled={files.length === 0 || busy}>
        {busy
          ? progress?.phase === "packaging"
            ? `Preparando ${Math.round(progress.percent ?? 0)}%`
            : "Analisando materiais…"
          : "Usar estes arquivos"}
      </button>
    </form>
  )
}
