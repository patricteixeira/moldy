import { useEffect, useRef, useState, type ChangeEvent, type JSX } from "react"
import { ApiError } from "../api/client"
import type {
  ApiClient,
  RoundtripAnalysisResult,
  RoundtripFinding,
  RoundtripFixJobResult,
  RoundtripJobInfo,
} from "../api/types"
import { useApi } from "../api/context"

interface RoundtripPanelProps {
  disabled?: boolean
  exportJobId: string
  pollIntervalMs: number
  onPendingChange?(pending: boolean): void
}

const ROUNDTRIP_TIMEOUT_MS = 5 * 60 * 1000

class RoundtripTimeoutError extends Error {
  constructor() {
    super("A conferência demorou mais de 5 minutos. Tente novamente.")
    this.name = "RoundtripTimeoutError"
  }
}

class RoundtripCancelledError extends Error {
  constructor() {
    super("Conferência cancelada.")
    this.name = "RoundtripCancelledError"
  }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const finish = (): void => {
      window.clearTimeout(timeout)
      signal.removeEventListener("abort", finish)
      resolve()
    }
    const timeout = window.setTimeout(finish, milliseconds)
    signal.addEventListener("abort", finish, { once: true })
  })
}

async function pollRoundtripJob(
  client: ApiClient,
  jobId: string,
  pollIntervalMs: number,
  signal: AbortSignal,
): Promise<RoundtripJobInfo> {
  while (!signal.aborted) {
    const job = await client.getRoundtripJob(jobId)
    if (signal.aborted) break
    if (job.status === "failed") {
      throw new Error(job.error || "Não foi possível conferir o arquivo.")
    }
    if (job.status === "succeeded") return job
    await wait(pollIntervalMs, signal)
  }
  throw new RoundtripCancelledError()
}

function withDeadline<T>(promise: Promise<T>): Promise<T> {
  let timeout = 0
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = window.setTimeout(() => reject(new RoundtripTimeoutError()), ROUNDTRIP_TIMEOUT_MS)
  })
  return Promise.race([promise, deadline]).finally(() => window.clearTimeout(timeout))
}

function findingTitle(finding: RoundtripFinding): string {
  if (finding.code === "text-changed") return "Texto mantido"
  if (finding.code.includes("font-size")) return "Tamanho do texto"
  if (finding.code.includes("font")) return "Tipografia"
  if (finding.code.includes("color")) return "Cor"
  if (finding.code === "geometry-changed") return "Posição e tamanho"
  if (finding.code === "unexpected-node") return "Elemento novo"
  if (["missing-node", "semantic-contract", "brand-revision", "slide-count"].includes(finding.code)) {
    return "Estrutura protegida"
  }
  return "Mudança encontrada"
}

function findingGuidance(finding: RoundtripFinding): string {
  if (finding.code === "text-changed") return "Mantido exatamente como você escreveu."
  if (finding.fixable) return "Pode voltar ao padrão sem apagar seu conteúdo."
  if (finding.severity === "locked" || finding.severity === "error") {
    return "Precisa de revisão manual antes de fechar o arquivo."
  }
  return "Registrado para sua conferência."
}

function humanError(caught: unknown, fallback: string): string {
  if (caught instanceof RoundtripTimeoutError) return caught.message
  if (caught instanceof ApiError) return caught.messagePt
  if (caught instanceof Error && caught.message && !(caught instanceof RoundtripCancelledError)) {
    return caught.message
  }
  return fallback
}

export function RoundtripPanel({
  disabled = false,
  exportJobId,
  pollIntervalMs,
  onPendingChange,
}: RoundtripPanelProps): JSX.Element {
  const client = useApi()
  const [file, setFile] = useState<File | null>(null)
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<RoundtripAnalysisResult | null>(null)
  const [fixed, setFixed] = useState<RoundtripFixJobResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const activeController = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    onPendingChange?.(pending)
    return () => onPendingChange?.(false)
  }, [onPendingChange, pending])

  useEffect(
    () => () => {
      activeController.current?.abort()
      activeController.current = null
    },
    [],
  )

  const chooseFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const selected = event.target.files?.[0] ?? null
    setError(null)
    setAnalysis(null)
    setAnalysisJobId(null)
    setFixed(null)
    setStatus(null)
    if (selected && !selected.name.toLocaleLowerCase("pt-BR").endsWith(".pptx")) {
      setFile(null)
      event.target.value = ""
      setError("Escolha o arquivo salvo no formato PowerPoint (.pptx).")
      return
    }
    setFile(selected)
  }

  const analyze = async (): Promise<void> => {
    if (!file || pending) return
    activeController.current?.abort()
    const controller = new AbortController()
    activeController.current = controller
    setError(null)
    setAnalysis(null)
    setAnalysisJobId(null)
    setFixed(null)
    setPending(true)
    setStatus("Lendo o arquivo editado…")
    try {
      const { jobId } = await withDeadline(client.requestRoundtrip(exportJobId, file))
      if (controller.signal.aborted) return
      setAnalysisJobId(jobId)
      const job = await withDeadline(
        pollRoundtripJob(client, jobId, pollIntervalMs, controller.signal),
      )
      if (controller.signal.aborted) return
      if (!job.result || job.result.kind !== "roundtrip-lint") {
        throw new Error("O servidor não devolveu a conferência esperada.")
      }
      setAnalysis(job.result)
      setStatus("Conferência concluída.")
    } catch (caught) {
      if (!controller.signal.aborted) {
        setStatus(null)
        setError(humanError(caught, "Não foi possível conferir o arquivo."))
      }
    } finally {
      controller.abort()
      if (activeController.current === controller) {
        activeController.current = null
        setPending(false)
      }
    }
  }

  const applyFixes = async (): Promise<void> => {
    if (!analysisJobId || !analysis || pending) return
    activeController.current?.abort()
    const controller = new AbortController()
    activeController.current = controller
    setError(null)
    setFixed(null)
    setPending(true)
    setStatus("Criando uma nova cópia ajustada…")
    try {
      const { jobId } = await withDeadline(client.requestRoundtripFix(analysisJobId))
      if (controller.signal.aborted) return
      const job = await withDeadline(
        pollRoundtripJob(client, jobId, pollIntervalMs, controller.signal),
      )
      if (controller.signal.aborted) return
      if (!job.result || job.result.kind !== "roundtrip-fix") {
        throw new Error("O servidor não devolveu a cópia ajustada.")
      }
      setFixed(job.result)
      setStatus("Nova cópia pronta para baixar.")
    } catch (caught) {
      if (!controller.signal.aborted) {
        setStatus(null)
        setError(humanError(caught, "Não foi possível criar a cópia ajustada."))
      }
    } finally {
      controller.abort()
      if (activeController.current === controller) {
        activeController.current = null
        setPending(false)
      }
    }
  }

  const report = fixed?.fixResult.report ?? analysis?.report ?? null
  const fixCount = analysis?.fixPlan.operations.length ?? 0
  const manualCount = report ? report.summary.error + report.summary.locked : 0

  return (
    <section className="roundtrip-panel" aria-labelledby="roundtrip-title">
      <header className="roundtrip-heading">
        <h2 id="roundtrip-title">Confira o arquivo editado</h2>
        <p>
          O Molda mantém seu texto e mostra o que saiu do padrão da marca.
        </p>
      </header>

      <ol className="roundtrip-steps" aria-label="Como trazer o arquivo de volta">
        <li><strong>Editar</strong><p>Abra o PPTX no Google Slides ou PowerPoint.</p></li>
        <li><strong>Salvar</strong><p>Baixe novamente como arquivo PowerPoint.</p></li>
        <li><strong>Conferir</strong><p>Envie a cópia editada aqui.</p></li>
      </ol>

      {!analysis ? (
        <div className="roundtrip-receiver">
          <label htmlFor="roundtrip-file">Arquivo editado (.pptx)</label>
          <input
            ref={fileInput}
            id="roundtrip-file"
            name="roundtrip-file"
            data-testid="roundtrip-file"
            type="file"
            accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            disabled={disabled || pending}
            onChange={chooseFile}
          />
          {file ? <p className="roundtrip-file-name">Pronto para conferir: {file.name}</p> : null}
          <button
            type="button"
            data-testid="roundtrip-analyze"
            disabled={disabled || pending || !file}
            onClick={() => void analyze()}
          >
            Conferir arquivo
          </button>
        </div>
      ) : null}

      {report ? (
        <div className="roundtrip-report" data-status={report.summary.status}>
          <div className="roundtrip-score" aria-label="Resumo da conferência">
            <p><strong>{fixCount}</strong><span>{fixCount === 1 ? "ajuste seguro" : "ajustes seguros"}</span></p>
            <p><strong>{report.summary.info}</strong><span>{report.summary.info === 1 ? "edição mantida" : "edições mantidas"}</span></p>
            <p><strong>{manualCount}</strong><span>{manualCount === 1 ? "atenção manual" : "atenções manuais"}</span></p>
          </div>

          {report.findings.length ? (
            <ul className="roundtrip-findings">
              {report.findings.map((finding, index) => (
                <li
                  key={`${finding.nodeId ?? "document"}-${finding.code}-${index}`}
                  data-severity={finding.severity}
                >
                  <span className="roundtrip-finding-index">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{findingTitle(finding)}</h3>
                    <p>{findingGuidance(finding)}</p>
                  </div>
                  <span className="roundtrip-finding-state">
                    {finding.code === "text-changed"
                      ? "mantido"
                      : finding.fixable
                        ? "ajustável"
                        : "revisar"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="roundtrip-pass">Nenhum problema encontrado. O arquivo pode ser usado.</p>
          )}

          <div className="roundtrip-report-actions">
            {analysis && fixCount > 0 && !fixed ? (
              <button
                type="button"
                data-testid="roundtrip-fix"
                disabled={disabled || pending}
                onClick={() => void applyFixes()}
              >
                Criar cópia ajustada
              </button>
            ) : null}
            <button
              className="text-action"
              type="button"
              disabled={pending}
              onClick={() => {
                if (fileInput.current) fileInput.current.value = ""
                setFile(null)
                setAnalysis(null)
                setAnalysisJobId(null)
                setFixed(null)
                setError(null)
                setStatus(null)
              }}
            >
              Conferir outro arquivo
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="roundtrip-error" role="alert">{error}</p> : null}
      {status ? <p className="roundtrip-status" role="status" aria-live="polite">{status}</p> : null}
      {fixed ? (
        <a
          className="download-link roundtrip-download"
          data-testid="roundtrip-download"
          href={fixed.url}
          download={fixed.filename}
        >
          Baixar cópia corrigida
        </a>
      ) : null}
    </section>
  )
}
