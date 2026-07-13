export interface Evidence {
  sourceType: string
  path?: string | null
  page?: number | null
  detail?: string | null
  confidence: number
  authoritative: boolean
  confirmedAt?: string | null
}

export interface Candidate {
  value: unknown
  score: number
  evidence: Evidence[]
}

export interface DraftQuestion {
  id: string
  kind: "pick-color" | "pick-font" | "confirm-logo"
  promptPt: string
  candidates: Candidate[]
  required: boolean
}

export interface FontCandidateValue {
  family: string
  weight: number
  style: "normal" | "italic"
  path?: string | null
}

export interface Diagnostic {
  code: string
  target: string
  message: string
  resolution?: string | null
}

export interface BrandIr {
  schemaVersion: string
  brand: { name: string }
  revision: { id: string; createdAt: string }
  colors: Record<string, { value: string; evidence: Evidence[] }>
  fonts: Record<
    string,
    {
      family: string
      weight: number
      style: "normal" | "italic"
      source: string
      fileSha256?: string | null
      evidence: Evidence[]
    }
  >
  roles: Record<
    string,
    { font: string; color: string; minSizePx: number; maxSizePx: number; lineHeight: number }
  >
  assets: Record<
    string,
    {
      path: string
      sha256: string
      format: "svg" | "png"
      minWidthPx: number
      clearSpaceRatio: number
    }
  >
  formatProfiles: string[]
  diagnostics: Diagnostic[]
}

export interface Slot {
  id: string
  kind: "text" | "image" | "logo"
  role?: string | null
  maxChars?: number | null
  minResolution?: [number, number] | null
  area: [number, number, number, number]
  fit: "shrink-within-role-range" | "fixed"
  required: boolean
}

export interface LayoutSpec {
  id: string
  profile: string
  namePt: string
  canvas: { widthPx: number; heightPx: number; safeAreaPx: number }
  background: { kind: "color" | "image-slot"; colorToken?: string | null }
  slots: Slot[]
}

export type SlotValue =
  | { kind: "text"; text: string }
  | { kind: "image"; path: string; sha256?: string | null }

export interface ContentSpec {
  layoutId: string
  brandRevisionId: string
  values: Record<string, SlotValue>
}

export interface GuardCheck {
  id: string
  slotId?: string | null
  status: "pass" | "fixed" | "blocked"
  messagePt: string
  detail: Record<string, unknown>
}

export interface JobResult {
  sha256: string
  url: string
}

export interface JobInfo {
  id: string
  status: "queued" | "running" | "succeeded" | "failed"
  result?: JobResult | null
  checks: GuardCheck[]
  error?: string | null
}

export interface ImportResult {
  draftId: string
  questions: DraftQuestion[]
  diagnostics: Diagnostic[]
  ignoredEntries: string[]
}

export interface DocumentResult {
  documentId: string
  checks: GuardCheck[]
}

export interface AssetUpload {
  sha256: string
  size: number
}

export interface ApiClient {
  importBrandPackage(files: File[]): Promise<ImportResult>
  compileDraft(
    draftId: string,
    answers: Record<string, unknown>,
    brandName: string,
  ): Promise<{ brandRevisionId: string }>
  getBrandRevision(revisionId: string): Promise<BrandIr>
  getKit(revisionId: string): Promise<LayoutSpec[]>
  createDocument(content: ContentSpec): Promise<DocumentResult>
  requestExport(documentId: string, format: "png" | "pdf"): Promise<{ jobId: string }>
  getJob(jobId: string): Promise<JobInfo>
  uploadAsset(file: File): Promise<AssetUpload>
  draftAssetUrl(draftId: string, path: string): string
  revisionAssetsBaseUrl(revisionId: string): string
}

export type SlotSpec = Slot
export type ContentValue = SlotValue
export type ExportJob = JobInfo
