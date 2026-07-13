import type {
  ApiClient,
  BrandIr,
  ContentSpec,
  JobInfo,
  GuardCheck,
  ImportResult,
  LayoutSpec,
} from "./types"
import { buildPackageZip } from "./zipPackage"

interface ErrorBody {
  detail?: unknown
  checks?: GuardCheck[]
}

export class ApiError extends Error {
  readonly status: number
  readonly messagePt: string
  readonly checks: GuardCheck[]

  constructor(status: number, messagePt: string, checks: GuardCheck[] = []) {
    super(messagePt)
    this.name = "ApiError"
    this.status = status
    this.messagePt = messagePt
    this.checks = checks
  }
}

function encodePath(path: string): string {
  const parts = path.split("/")
  if (
    parts.some(
      (part) =>
        part.length === 0 ||
        part === "." ||
        part === ".." ||
        part.includes("\\") ||
        [...part].some((character) => character.charCodeAt(0) <= 31),
    )
  ) {
    throw new Error("Path de asset inválido.")
  }
  return parts.map((part) => encodeURIComponent(part)).join("/")
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as ErrorBody | T
  if (response.ok) return body as T
  const error = body as ErrorBody
  const detail =
    typeof error.detail === "string"
      ? error.detail
      : "Não foi possível falar com o servidor."
  throw new ApiError(response.status, detail, Array.isArray(error.checks) ? error.checks : [])
}

export function contentAddressedPath(sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("SHA-256 de asset inválido.")
  return `sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`
}

export function createApiClient(fetchFn: typeof fetch = fetch): ApiClient {
  const json = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers)
    if (init?.body !== undefined && typeof init.body === "string") {
      headers.set("Content-Type", "application/json")
    }
    const response = await fetchFn(url, { ...init, headers })
    return parseResponse<T>(response)
  }

  return {
    async importBrandPackage(files) {
      const archive = await buildPackageZip(files)
      const form = new FormData()
      form.set("package", new File([archive], "pacote.zip", { type: "application/zip" }))
      return json<ImportResult>("/v1/brands/imports", { method: "POST", body: form })
    },
    compileDraft(draftId, answers, brandName) {
      return json(`/v1/drafts/${encodeURIComponent(draftId)}/compile`, {
        method: "POST",
        body: JSON.stringify({ answers: { values: answers }, brandName }),
      })
    },
    getBrandRevision(revisionId) {
      return json<BrandIr>(`/v1/brand-revisions/${encodeURIComponent(revisionId)}`)
    },
    getKit(revisionId) {
      return json<LayoutSpec[]>(`/v1/brand-revisions/${encodeURIComponent(revisionId)}/kit`)
    },
    async uploadAsset(file) {
      const form = new FormData()
      form.set("file", file)
      return json("/v1/assets", { method: "POST", body: form })
    },
    createDocument(content: ContentSpec) {
      return json("/v1/documents", { method: "POST", body: JSON.stringify(content) })
    },
    requestExport(documentId, format) {
      return json(`/v1/documents/${encodeURIComponent(documentId)}/exports`, {
        method: "POST",
        body: JSON.stringify({ format }),
      })
    },
    getJob(jobId) {
      return json<JobInfo>(`/v1/jobs/${encodeURIComponent(jobId)}`)
    },
    draftAssetUrl(draftId, path) {
      return `/v1/drafts/${encodeURIComponent(draftId)}/assets/${encodePath(path)}`
    },
    revisionAssetsBaseUrl(revisionId) {
      return `/v1/brand-revisions/${encodeURIComponent(revisionId)}/assets`
    },
  }
}
