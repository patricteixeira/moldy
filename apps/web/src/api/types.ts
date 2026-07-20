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
  kind: "pick-color" | "pick-font" | "confirm-logo" | "review-identity"
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
  identity?: {
    essence: string
    personality: string
    voice: string
    avoid: string
    evidence: Evidence[]
  } | null
  creativeDirection?: {
    energy: ExpressionAxis
    geometry: ExpressionAxis
    density: ExpressionAxis
    formality: ExpressionAxis
    materiality: ExpressionAxis
    contrast: ExpressionAxis
    composition: "contemplative" | "asymmetric" | "modular" | "expansive" | "layered"
    surface:
      | "none"
      | "paper-grain"
      | "linear-rhythm"
      | "technical-grid"
      | "point-field"
      | "concentric-rings"
    scaleContrast: number
    negativeSpace: number
    bleed: number
    surfaceDensity: number
    rationalePt: string[]
  } | null
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

export interface LayerOverride {
  area?: [number, number, number, number] | null
  opacity?: number | null
  hidden?: boolean
  zIndex?: number | null
  colorToken?: string | null
  fontToken?: string | null
  fontSizePx?: number | null
  fontWeight?: number | null
  fontStyle?: "normal" | "italic" | null
  lineHeight?: number | null
  letterSpacingEm?: number | null
  textAlign?: "left" | "center" | "right" | null
  textTransform?: "none" | "uppercase" | null
  fillMode?: "fill" | "stroke" | null
  strokeColorToken?: string | null
  strokeWidthPx?: number | null
  fit?: "contain" | "cover" | null
  spacingPx?: number | null
}

export interface ExpressionAxis {
  value: number
  confidence: number
  evidenceTerms: string[]
}

export interface IdentityTextValue {
  essence: string
  personality: string
  voice: string
  avoid: string
}

export interface IdentityExpressionValue extends IdentityTextValue {
  original?: IdentityTextValue | null
  sourceLanguage?: "en" | "pt-BR" | "unknown"
  displayLanguage?: "en" | "pt-BR" | "unknown"
  translationStatus?: "not-needed" | "translated" | "unavailable"
  translator?: string | null
}

export interface ContentSpec {
  layoutId: string
  brandRevisionId: string
  values: Record<string, SlotValue>
  overrides?: Record<string, LayerOverride>
  surface?: SurfaceStyle | null
  addedSlots?: Slot[]
  addedLayers?: ShapeLayer[]
}

export type SurfaceKind =
  | "paper-grain"
  | "paper-fibers"
  | "flecked-paper"
  | "dry-brush"
  | "linear-rhythm"
  | "scanlines"
  | "diagonal-hatch"
  | "crosshatch"
  | "woven"
  | "technical-grid"
  | "micro-grid"
  | "isometric-grid"
  | "point-field"
  | "halftone"
  | "checkerboard"
  | "concentric-rings"
  | "topographic"
  | "sunburst"
  | "waves"
  | "terrazzo"

export interface SurfaceStyle {
  kind: SurfaceKind
  colorToken: string
  opacity: number
  scalePx: number
  weightPx: number
  angleDeg: number
}

export interface GuardCheck {
  id: string
  slotId?: string | null
  status: "pass" | "fixed" | "warning" | "blocked"
  messagePt: string
  detail: Record<string, unknown>
}

export type ExportFormat = "png" | "pdf" | "pptx" | "docx"

export interface JobResult {
  sha256: string
  url: string
  format: ExportFormat | "zip"
  filename: string
}

export interface JobInfo {
  id: string
  status: "queued" | "running" | "succeeded" | "failed"
  result?: JobResult | null
  checks: GuardCheck[]
  error?: string | null
}

export type RoundtripSeverity = "info" | "warning" | "error" | "locked"

export interface RoundtripFinding {
  code: string
  severity: RoundtripSeverity
  messagePt: string
  nodeId?: string | null
  slotId?: string | null
  expected?: unknown
  actual?: unknown
  fixable: boolean
}

export interface RoundtripSummary {
  status: "pass" | "review" | "blocked"
  total: number
  info: number
  warning: number
  error: number
  locked: number
  fixable: number
}

export interface RoundtripReport {
  schemaVersion: "0.1.0"
  baselineSha256: string
  editedSha256: string
  summary: RoundtripSummary
  findings: RoundtripFinding[]
}

export interface FixOperation {
  id: string
  slideIndex: number
  nodeId: string
  role: string
  slotId?: string | null
  property: "fontFamily" | "fontSizePt" | "color" | "boundsPt"
  expected: unknown
  sourceCodes: string[]
}

export interface FixPlan {
  schemaVersion: "0.1.0"
  baselineSha256: string
  editedSha256: string
  operations: FixOperation[]
  deferredFindingCodes: string[]
}

export interface RoundtripAnalysisResult {
  kind: "roundtrip-lint"
  baselineGraph: Record<string, unknown>
  documentGraph: Record<string, unknown>
  report: RoundtripReport
  fixPlan: FixPlan
}

export interface RoundtripFixJobResult extends JobResult {
  kind: "roundtrip-fix"
  format: "pptx"
  fixResult: {
    schemaVersion: "0.1.0"
    sourceSha256: string
    fixedSha256: string
    outputFilename: string
    appliedOperationIds: string[]
    report: RoundtripReport
  }
}

export interface RoundtripJobInfo {
  id: string
  status: "queued" | "running" | "succeeded" | "failed"
  result?: RoundtripAnalysisResult | RoundtripFixJobResult | null
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

export interface CampaignFields {
  headline: string
  body: string
  cta: string
  date: string
  imageSha256?: string | null
}

export interface CampaignPiece {
  id: string
  documentId: string
  layoutId: string
  bindings: Record<string, { kind: "text" | "image"; source: string }>
  content: ContentSpec
  checks: GuardCheck[]
}

export interface Campaign {
  id: string
  brandRevisionId: string
  name: string
  fields: CampaignFields
  createdAt: string
  updatedAt: string
  pieces: CampaignPiece[]
}

export type CarouselProfile = "post-1x1" | "post-4x5"
export type CarouselSlideRole = "cover" | "content" | "closing"

export interface CarouselSignature {
  text: string
  vertical: "top" | "bottom"
  horizontal: "left" | "center" | "right"
}

export interface CarouselSlideInput {
  kicker: string
  headline: string
  textBlocks: string[]
  cta: string
}

export interface CarouselSlide {
  id: string
  documentId: string
  position: number
  role: CarouselSlideRole
  source: CarouselSlideInput
  layoutId: string
  layout: LayoutSpec
  content: ContentSpec
  checks: GuardCheck[]
}

export interface Carousel {
  id: string
  brandRevisionId: string
  name: string
  profile: CarouselProfile
  signature: CarouselSignature
  createdAt: string
  slides: CarouselSlide[]
}

export interface DocxBrandOperation {
  id: string
  kind:
    | "document-styles"
    | "paragraph-styles"
    | "page-layout"
    | "table-styles"
    | "header-logo"
  labelPt: string
  affectedCount: number
  targetRole?: string | null
}

export interface DocxBrandPlan {
  schemaVersion: "0.1.0"
  source: {
    filename: string
    sha256: string
    sizeBytes: number
    paragraphCount: number
    tableCount: number
    sectionCount: number
  }
  brandRevisionId: string
  operations: DocxBrandOperation[]
  warnings: string[]
}

export interface DocxBrandAnalysisResult {
  kind: "docx-brand-analyze"
  plan: DocxBrandPlan
}

export interface DocxBrandApplyResult extends JobResult {
  kind: "docx-brand-apply"
  format: "docx"
  brandResult: {
    schemaVersion: "0.1.0"
    sourceSha256: string
    brandedSha256: string
    outputFilename: string
    appliedOperationIds: string[]
    contentPreserved: boolean
    contentSha256: string
  }
}

export interface DocxBrandJobInfo {
  id: string
  status: "queued" | "running" | "succeeded" | "failed"
  result?: DocxBrandAnalysisResult | DocxBrandApplyResult | null
  checks: GuardCheck[]
  error?: string | null
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
  listCampaigns(revisionId: string): Promise<Campaign[]>
  getCampaign(campaignId: string): Promise<Campaign>
  createCampaign(input: {
    brandRevisionId: string
    name: string
    fields: CampaignFields
    layoutIds: string[]
  }): Promise<Campaign>
  updateCampaign(
    campaignId: string,
    input: { name: string; fields: CampaignFields },
  ): Promise<Campaign>
  listCarousels(revisionId: string): Promise<Carousel[]>
  getCarousel(carouselId: string): Promise<Carousel>
  createCarousel(input: {
    brandRevisionId: string
    name: string
    profile: CarouselProfile
    signature: CarouselSignature
    slides: CarouselSlideInput[]
  }): Promise<Carousel>
  requestCarouselExport(carouselId: string): Promise<{ jobId: string }>
  createDocument(content: ContentSpec): Promise<DocumentResult>
  requestExport(documentId: string, format: ExportFormat): Promise<{ jobId: string }>
  getJob(jobId: string): Promise<JobInfo>
  requestRoundtrip(exportJobId: string, file: File): Promise<{ jobId: string }>
  requestRoundtripFix(roundtripJobId: string): Promise<{ jobId: string }>
  getRoundtripJob(jobId: string): Promise<RoundtripJobInfo>
  requestDocxBranding(revisionId: string, file: File): Promise<{ jobId: string }>
  requestDocxBrandApply(analysisJobId: string): Promise<{ jobId: string }>
  getDocxBrandJob(jobId: string): Promise<DocxBrandJobInfo>
  uploadAsset(file: File): Promise<AssetUpload>
  draftAssetUrl(draftId: string, path: string): string
  revisionAssetsBaseUrl(revisionId: string): string
}

export type SlotSpec = Slot
export type ContentValue = SlotValue
export type ExportJob = JobInfo
