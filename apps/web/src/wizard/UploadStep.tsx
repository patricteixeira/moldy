import { type DragEvent, type FormEvent, useEffect, useRef, useState } from "react"
import { useApi } from "../api/context"
import type { Diagnostic, DraftQuestion, ImportResult } from "../api/types"
import { blockingRequiredQuestions } from "./state"

interface IntakeIssues {
  blockingQuestions: DraftQuestion[]
  diagnostics: Diagnostic[]
  ignoredEntries: string[]
}

function actionForQuestion(question: DraftQuestion): string {
  if (question.kind === "confirm-logo") return "Adicione um logo em SVG ou PNG."
  if (question.kind === "pick-font") {
    return "Adicione arquivos TTF/OTF ou um manual que identifique as fontes."
  }
  return "Adicione um PDF, tokens ou logo com cores identificáveis."
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
          ? "Um arquivo com a mesma identificação já estava no pacote e não foi acrescentado novamente."
          : `${repeated} arquivos com a mesma identificação já estavam no pacote e não foram acrescentados novamente.`
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
    setError(null)
    setIntakeIssues(null)
    const current = ++generation.current
    try {
      const result = await api.importBrandPackage(files)
      if (generation.current !== current) return
      const blockingQuestions = blockingRequiredQuestions(result.questions)
      if (result.questions.length === 0 || blockingQuestions.length > 0) {
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
          : "Não foi possível enviar o pacote da marca.",
      )
    } finally {
      if (generation.current === current) setBusy(false)
    }
  }

  return (
    <form className="upload-step" onSubmit={submit}>
      <p className="intro-copy">
        Reúna o manual em PDF, os logos e as fontes da marca. Você pode escolher os
        materiais em várias etapas: cada nova seleção será acrescentada ao pacote.
      </p>
      <label
        className="file-receiver"
        htmlFor="wizard-files"
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <span>Escolher ou soltar materiais da marca</span>
        <input
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
              <strong>{files.length}</strong> {files.length === 1 ? "material reunido" : "materiais reunidos"}
              <span aria-hidden="true"> · </span>
              {pdfCount} PDF · {logoCount} {logoCount === 1 ? "logo" : "logos"} · {fontCount}{" "}
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
              Sem arquivos TTF ou OTF, o sistema pode identificar as famílias citadas no manual,
              mas a prévia usará uma fonte substituta até que os arquivos sejam adicionados.
            </p>
          )}
        </section>
      )}
      {selectionNotice && <p role="status">{selectionNotice}</p>}
      {intakeIssues && (
        <section className="intake-issues" role="alert" aria-labelledby="intake-issues-title">
          <h2 id="intake-issues-title">O pacote ainda está incompleto.</h2>
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
          <p>Acrescente os materiais ausentes e envie o pacote novamente.</p>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      <button data-testid="wizard-enviar" type="submit" disabled={files.length === 0 || busy}>
        {busy ? "Enviando pacote…" : "Enviar pacote da marca"}
      </button>
    </form>
  )
}
