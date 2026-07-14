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
  recommendedCount?: number
  required: boolean
}

export interface FontCandidateValue {
  family: string
  weight: number
  style: "normal" | "italic"
  path?: string | null
  resource?: FontResource | null
}

export interface FontAxis {
  tag: string
  minimum: number
  default: number
  maximum: number
}

export interface FontResource {
  provider: string
  format: "ttf" | "otf" | "woff2"
  upstreamRef?: string | null
  licenseId?: string | null
  licenseSha256?: string | null
  usagePolicy: "redistributable" | "embeddable" | "restricted" | "unknown"
  coverageProfile?: string | null
  missingCodepoints: number[]
  axes: FontAxis[]
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
      resource?: FontResource | null
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
  compositionRules?: {
    modes: {
      light?: CompositionMode | null
      dark?: CompositionMode | null
    }
    colorRatios: Array<{ colorToken: string; ratio: number; evidence: Evidence[] }>
    accent?: { colorToken: string; maxRatio: number; evidence: Evidence[] } | null
    motifs: Array<{ kind: "diagonal-lines"; evidence: Evidence[] }>
    numbering?: { style: "zero-padded"; minDigits: number; evidence: Evidence[] } | null
  } | null
  formatProfiles: string[]
  diagnostics: Diagnostic[]
}

export interface CompositionMode {
  backgroundColorToken: string
  foregroundColorToken: string
  logoAssetToken?: string | null
  evidence: Evidence[]
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
  colorToken?: string | null
  zIndex?: number | null
  opacity?: number
  textAlign?: "left" | "center" | "right"
  textTransform?: "none" | "uppercase"
  letterSpacingEm?: number
  fillMode?: "fill" | "stroke"
  strokeColorToken?: string | null
  strokeWidthPx?: number | null
  assetToken?: string | null
  emphasisColorToken?: string | null
  textFormat?: "plain" | "zero-padded"
}

export interface ShapeLayer {
  id: string
  kind: "shape"
  shape: "rectangle" | "circle"
  area: [number, number, number, number]
  colorToken: string
  opacity: number
  zIndex: number
}

export interface MotifLayer {
  id: string
  kind: "motif"
  motif: "diagonal-lines"
  area: [number, number, number, number]
  colorToken: string
  opacity: number
  strokeWidthPx: number
  spacingPx: number
  zIndex: number
}

export interface AssetLayer {
  id: string
  kind: "asset"
  assetToken: string
  area: [number, number, number, number]
  fit: "contain" | "cover"
  opacity: number
  zIndex: number
}

export type LockedLayer = ShapeLayer | MotifLayer | AssetLayer

export interface LayoutSpec {
  id: string
  profile: string
  namePt: string
  canvas: { widthPx: number; heightPx: number; safeAreaPx: number }
  background: { kind: "color" | "image-slot"; colorToken?: string | null }
  slots: Slot[]
  compositionMode?: "light" | "dark" | null
  lockedLayers?: LockedLayer[]
}

export type SlotValue =
  | { kind: "text"; text: string; emphasis?: string | null }
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

export type FontResolutionStatus =
  | "local-ready"
  | "vendor-hosted"
  | "not-found"
  | "capacity-reached"
  | "failed"

export interface FontResolutionResult {
  candidate: Candidate
  status: FontResolutionStatus
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
  resolveDraftFont(
    draftId: string,
    questionId: "font.heading" | "font.body",
    family: string,
  ): Promise<FontResolutionResult>
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
