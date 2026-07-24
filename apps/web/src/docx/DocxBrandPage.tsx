import { useEffect, useState } from "react"
import type { JSX } from "react"
import { Link, useParams } from "react-router-dom"
import { ApiError } from "../api/client"
import { useApi } from "../api/context"
import type {
  BrandIr,
  DocxBrandApplyResult,
  DocxBrandJobInfo,
  DocxBrandPlan,
} from "../api/types"
import { brandThemeStyle } from "../brandTheme"

async function waitForDocxJob(
  getJob: (jobId: string) => Promise<DocxBrandJobInfo>,
  jobId: string,
): Promise<DocxBrandJobInfo> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const job = await getJob(jobId)
    if (job.status === "succeeded") return job
    if (job.status === "failed") {
      throw new Error(job.error || "O processamento do Word não pôde ser concluído.")
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500))
  }
  throw new Error("O processamento demorou mais que o esperado. Tente novamente.")
}

export function DocxBrandPage(): JSX.Element {
  const { revisionId } = useParams()
  const api = useApi()
  const [brand, setBrand] = useState<BrandIr | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null)
  const [plan, setPlan] = useState<DocxBrandPlan | null>(null)
  const [download, setDownload] = useState<DocxBrandApplyResult | null>(null)
  const [phase, setPhase] = useState<"idle" | "analyzing" | "ready" | "applying" | "done">(
    "idle",
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    if (!revisionId) {
      setError("A revisão da marca não foi informada.")
      return () => {
        current = false
      }
    }
    void api
      .getBrandRevision(revisionId)
      .then((value) => {
        if (current) setBrand(value)
      })
      .catch((reason: unknown) => {
        if (current) {
          setError(
            reason instanceof ApiError ? reason.messagePt : "Não foi possível carregar a marca.",
          )
        }
      })
    return () => {
      current = false
    }
  }, [api, revisionId])

  const analyze = async (): Promise<void> => {
    if (!file || !revisionId) {
      setError("Escolha um arquivo Word .docx para analisar.")
      return
    }
    setError(null)
    setPlan(null)
    setDownload(null)
    setPhase("analyzing")
    try {
      const { jobId } = await api.requestDocxBranding(revisionId, file)
      setAnalysisJobId(jobId)
      const job = await waitForDocxJob(api.getDocxBrandJob, jobId)
      if (!job.result || job.result.kind !== "docx-brand-analyze") {
        throw new Error("A análise terminou sem um plano de aplicação válido.")
      }
      setPlan(job.result.plan)
      setPhase("ready")
    } catch (reason: unknown) {
      setPhase("idle")
      setError(reason instanceof ApiError ? reason.messagePt : (reason as Error).message)
    }
  }

  const apply = async (): Promise<void> => {
    if (!analysisJobId) return
    setError(null)
    setPhase("applying")
    try {
      const { jobId } = await api.requestDocxBrandApply(analysisJobId)
      const job = await waitForDocxJob(api.getDocxBrandJob, jobId)
      if (!job.result || job.result.kind !== "docx-brand-apply") {
        throw new Error("A aplicação terminou sem um documento para download.")
      }
      setDownload(job.result)
      setPhase("done")
    } catch (reason: unknown) {
      setPhase("ready")
      setError(reason instanceof ApiError ? reason.messagePt : (reason as Error).message)
    }
  }

  if (error && !brand) {
    return (
      <main id="main-content" className="docx-brand-page">
        <h1>Aplicar marca ao Word</h1>
        <p role="alert">{error}</p>
        <Link className="primary-link" to={revisionId ? `/marcas/${revisionId}/kit` : "/"}>
          Voltar aos modelos
        </Link>
      </main>
    )
  }
  if (!brand || !revisionId) {
    return (
      <main id="main-content" className="docx-brand-page">
        <p className="loading-note" role="status">
          Carregando a marca…
        </p>
      </main>
    )
  }

  const uploadActive = phase === "idle" || phase === "analyzing"
  const planActive = phase === "ready" || phase === "applying"
  const downloadActive = phase === "done"

  return (
    <main
      id="main-content"
      className="docx-brand-page brand-reactive-page"
      style={brandThemeStyle(brand)}
    >
      <header className="docx-brand-heading" data-motion-enter>
        <div>
          <p className="product-kicker">Documento Word com sua marca</p>
          <h1>Aplicar marca ao Word</h1>
          <p>
            Envie um arquivo do Word (.docx). O Molda mostra tudo o que pretende mudar,
            mantém o conteúdo e devolve uma nova cópia editável com as cores e fontes de
            {` ${brand.brand.name}`}.
          </p>
        </div>
        <Link className="text-action" to={`/marcas/${encodeURIComponent(revisionId)}/kit`}>
          Voltar aos modelos
        </Link>
      </header>

      <div className="docx-brand-flow" data-phase={phase}>
        <section
          className="docx-upload-card"
          aria-labelledby="docx-upload-title"
          data-active={uploadActive || undefined}
          data-complete={plan !== null || undefined}
        >
          <div>
            <p className="docx-stage-label">Documento original</p>
            <h2 id="docx-upload-title">Escolha o documento</h2>
            <p>O arquivo original não é alterado. O Molda cria uma nova cópia.</p>
            <label className="docx-file-picker" htmlFor="docx-brand-file">
              <span>{file ? file.name : "Selecionar arquivo .docx"}</span>
              <input
                id="docx-brand-file"
                name="docx-brand-file"
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) => {
                  setFile(event.currentTarget.files?.[0] ?? null)
                  setPlan(null)
                  setDownload(null)
                  setAnalysisJobId(null)
                  setPhase("idle")
                  setError(null)
                }}
              />
            </label>
            <button
              type="button"
              className="primary-action"
              disabled={phase === "analyzing" || phase === "applying"}
              onClick={() => void analyze()}
            >
              {phase === "analyzing" ? "Conferindo o documento…" : "Ver o que será mudado"}
            </button>
          </div>
        </section>

        <section
          className="docx-plan-card"
          aria-labelledby="docx-plan-title"
          data-active={planActive || undefined}
          data-complete={download !== null || undefined}
        >
          <div>
            <p className="docx-stage-label">Antes de criar a cópia</p>
            <h2 id="docx-plan-title">Confira as mudanças</h2>
            {!plan ? (
              <p className="docx-plan-empty">
                Depois da análise, as mudanças aparecem aqui antes de qualquer novo arquivo ser
                criado.
              </p>
            ) : (
              <>
                <div className="docx-plan-summary" aria-label="Resumo do documento">
                  <span>
                    <strong>{plan.source.paragraphCount}</strong>
                    parágrafos
                  </span>
                  <span>
                    <strong>{plan.source.tableCount}</strong>
                    tabelas
                  </span>
                  <span>
                    <strong>{plan.source.sectionCount}</strong>
                    seções
                  </span>
                </div>
                <ol className="docx-operation-list">
                  {plan.operations.map((operation) => (
                    <li key={operation.id}>
                      <span>{operation.id.replace("op-", "")}</span>
                      <p>{operation.labelPt}</p>
                    </li>
                  ))}
                </ol>
                {plan.warnings.length ? (
                  <ul className="docx-warning-list">
                    {plan.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="docx-safe-note">O documento está pronto para receber a marca.</p>
                )}
                <button
                  type="button"
                  className="primary-action"
                  disabled={phase === "applying"}
                  onClick={() => void apply()}
                >
                  {phase === "applying" ? "Criando a cópia com a marca…" : "Aplicar e criar cópia"}
                </button>
              </>
            )}
          </div>
        </section>

        <section
          className="docx-download-card"
          aria-labelledby="docx-download-title"
          data-active={downloadActive || undefined}
        >
          <div>
            <p className="docx-stage-label">Cópia editável</p>
            <h2 id="docx-download-title">Baixe e continue editando</h2>
            {download ? (
              <div className="docx-download-ready" role="status" aria-live="polite">
                <p>
                  Conteúdo mantido. A nova cópia está pronta para continuar no Word.
                </p>
                <a href={download.url} download={download.filename} className="primary-link">
                  Baixar {download.filename}
                </a>
              </div>
            ) : (
              <p className="docx-plan-empty">A cópia editável aparecerá aqui.</p>
            )}
          </div>
        </section>
      </div>

      {error ? <p className="docx-brand-error" role="alert">{error}</p> : null}
    </main>
  )
}
