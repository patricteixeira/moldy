import { useCallback, useEffect, useRef, useState } from "react"
import { ApiError } from "../api/client"
import type {
  ApiClient,
  ContentSpec,
  ExportFormat,
  GuardCheck,
  JobResult,
} from "../api/types"

interface ExportFlowState {
  checks: GuardCheck[]
  download: JobResult | null
  error: string | null
  pending: boolean
  status: string | null
  run(): Promise<void>
}

const EXPORT_TIMEOUT_MS = 5 * 60 * 1000

class ExportTimeoutError extends Error {
  constructor() {
    super("A geração demorou mais de 5 minutos. Tente novamente.")
    this.name = "ExportTimeoutError"
  }
}

class ExportCancelledError extends Error {
  constructor() {
    super("Exportação cancelada.")
    this.name = "ExportCancelledError"
  }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }

    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      signal.removeEventListener("abort", finish)
      resolve()
    }
    const timeout = window.setTimeout(finish, milliseconds)
    signal.addEventListener("abort", finish, { once: true })
  })
}

export function useExportFlow(
  client: ApiClient,
  content: ContentSpec,
  format: ExportFormat,
  pollIntervalMs: number,
): ExportFlowState {
  const [checks, setChecks] = useState<GuardCheck[]>([])
  const [download, setDownload] = useState<JobResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const activeController = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      const controller = activeController.current
      activeController.current = null
      controller?.abort()
    },
    [],
  )

  const run = useCallback(async () => {
    activeController.current?.abort()
    const controller = new AbortController()
    activeController.current = controller

    const isActive = () => activeController.current === controller && !controller.signal.aborted

    setChecks([])
    setDownload(null)
    setError(null)
    setStatus(null)
    setPending(true)

    let rejectRun!: (reason: ExportTimeoutError | ExportCancelledError) => void
    const interruptPromise = new Promise<never>((_resolve, reject) => {
      rejectRun = reject
    })
    const timeout = window.setTimeout(
      () => rejectRun(new ExportTimeoutError()),
      EXPORT_TIMEOUT_MS,
    )
    const cancelRun = (): void => rejectRun(new ExportCancelledError())
    controller.signal.addEventListener("abort", cancelRun, { once: true })
    const beforeTimeout = <T,>(promise: Promise<T>): Promise<T> =>
      Promise.race([promise, interruptPromise])

    try {
      const documentResult = await beforeTimeout(client.createDocument(content))
      if (!isActive()) return

      setChecks(documentResult.checks)
      if (documentResult.checks.some((check) => check.status === "blocked")) return

      const { jobId } = await beforeTimeout(
        client.requestExport(documentResult.documentId, format),
      )
      if (!isActive()) return

      setStatus(`Gerando ${format.toUpperCase()}…`)
      while (isActive()) {
        const job = await beforeTimeout(client.getJob(jobId))
        if (!isActive()) return

        setChecks(job.checks)
        if (job.status === "failed") {
          setStatus(null)
          setError(job.error || "Não foi possível gerar o arquivo.")
          return
        }
        if (job.status === "succeeded") {
          if (!job.result) {
            setStatus(null)
            setError("Não foi possível gerar o arquivo.")
            return
          }
          setDownload(job.result)
          setStatus(`${format.toUpperCase()} pronto para baixar.`)
          return
        }

        await beforeTimeout(wait(pollIntervalMs, controller.signal))
      }
    } catch (caught) {
      if (!isActive()) return
      setStatus(null)
      if (caught instanceof ExportTimeoutError) {
        setError(caught.message)
      } else if (caught instanceof ApiError) {
        if (caught.status === 409) setChecks(caught.checks)
        setError(caught.messagePt)
      } else {
        setError("Não foi possível gerar o arquivo.")
      }
    } finally {
      window.clearTimeout(timeout)
      controller.signal.removeEventListener("abort", cancelRun)
      if (activeController.current === controller) {
        activeController.current = null
        setPending(false)
      }
    }
  }, [client, content, format, pollIntervalMs])

  return { checks, download, error, pending, run, status }
}
