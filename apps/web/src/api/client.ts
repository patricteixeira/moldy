import type {
  ApiClient,
  BrandIr,
  Campaign,
  Carousel,
  CarouselSlide,
  ContentSpec,
  JobInfo,
  GuardCheck,
  ImportResult,
  LayoutSpec,
  FontResolutionResult,
  DocxBrandJobInfo,
  RoundtripJobInfo,
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
    async importBrandPackage(files, onProgress) {
      onProgress?.({ phase: "packaging", percent: 0 })
      const archive = await buildPackageZip(files, (percent) =>
        onProgress?.({ phase: "packaging", percent }),
      )
      onProgress?.({ phase: "packaging", percent: 100 })
      const form = new FormData()
      form.set("package", new File([archive], "pacote.zip", { type: "application/zip" }))
      onProgress?.({ phase: "processing" })
      return json<ImportResult>("/v1/brands/imports", { method: "POST", body: form })
    },
    resolveDraftFont(draftId, questionId, family) {
      return json<FontResolutionResult>(
        `/v1/drafts/${encodeURIComponent(draftId)}/fonts/resolve`,
        {
          method: "POST",
          body: JSON.stringify({ questionId, family }),
        },
      )
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
    listCampaigns(revisionId) {
      return json<Campaign[]>(
        `/v1/brand-revisions/${encodeURIComponent(revisionId)}/campaigns`,
      )
    },
    getCampaign(campaignId) {
      return json<Campaign>(`/v1/campaigns/${encodeURIComponent(campaignId)}`)
    },
    createCampaign(input) {
      return json<Campaign>("/v1/campaigns", {
        method: "POST",
        body: JSON.stringify(input),
      })
    },
    updateCampaign(campaignId, input) {
      return json<Campaign>(`/v1/campaigns/${encodeURIComponent(campaignId)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      })
    },
    listCarousels(revisionId) {
      return json<Carousel[]>(
        `/v1/brand-revisions/${encodeURIComponent(revisionId)}/carousels`,
      )
    },
    getCarousel(carouselId) {
      return json<Carousel>(`/v1/carousels/${encodeURIComponent(carouselId)}`)
    },
    createCarousel(input) {
      return json<Carousel>("/v1/carousels", {
        method: "POST",
        body: JSON.stringify(input),
      })
    },
    updateCarouselSlide(carouselId, slideId, content) {
      return json<CarouselSlide>(
        `/v1/carousels/${encodeURIComponent(carouselId)}/slides/${encodeURIComponent(slideId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(content),
        },
      )
    },
    requestCarouselExport(carouselId) {
      return json(`/v1/carousels/${encodeURIComponent(carouselId)}/exports`, {
        method: "POST",
        body: JSON.stringify({ format: "png" }),
      })
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
    async requestRoundtrip(exportJobId, file) {
      const form = new FormData()
      form.set("file", file)
      return json(`/v1/jobs/${encodeURIComponent(exportJobId)}/roundtrips`, {
        method: "POST",
        body: form,
      })
    },
    requestRoundtripFix(roundtripJobId) {
      return json(`/v1/jobs/${encodeURIComponent(roundtripJobId)}/fixes`, {
        method: "POST",
      })
    },
    getRoundtripJob(jobId) {
      return json<RoundtripJobInfo>(`/v1/jobs/${encodeURIComponent(jobId)}`)
    },
    async requestDocxBranding(revisionId, file) {
      const form = new FormData()
      form.set("file", file)
      return json(`/v1/brand-revisions/${encodeURIComponent(revisionId)}/docx-brandings`, {
        method: "POST",
        body: form,
      })
    },
    requestDocxBrandApply(analysisJobId) {
      return json(`/v1/jobs/${encodeURIComponent(analysisJobId)}/docx-brandings`, {
        method: "POST",
      })
    },
    getDocxBrandJob(jobId) {
      return json<DocxBrandJobInfo>(`/v1/jobs/${encodeURIComponent(jobId)}`)
    },
    draftAssetUrl(draftId, path) {
      return `/v1/drafts/${encodeURIComponent(draftId)}/assets/${encodePath(path)}`
    },
    revisionAssetsBaseUrl(revisionId) {
      return `/v1/brand-revisions/${encodeURIComponent(revisionId)}/assets`
    },
  }
}
