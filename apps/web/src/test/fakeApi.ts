import type {
  ApiClient,
  BrandIr,
  Campaign,
  Carousel,
  CarouselSlideInput,
  DocxBrandJobInfo,
  JobInfo,
  LayoutSpec,
  RoundtripJobInfo,
} from "../api/types"
import { vi } from "vitest"

export const FAKE_IR: BrandIr = {
  schemaVersion: "0.3.0",
  brand: { name: "ACME" },
  revision: { id: "brandrev_x", createdAt: "2026-07-12T00:00:00Z" },
  colors: {
    "color.primary": { value: "#1A4D8F", evidence: [] },
    "color.background": { value: "#FFFFFF", evidence: [] },
    "color.text": { value: "#1A1A1A", evidence: [] },
    "color.secondary": { value: "#CA6B0B", evidence: [] },
  },
  fonts: {
    "font.heading": {
      family: "Fixture Sans",
      weight: 700,
      style: "normal",
      source: "fallback",
      evidence: [],
    },
    "font.body": {
      family: "Fixture Sans",
      weight: 400,
      style: "normal",
      source: "fallback",
      evidence: [],
    },
  },
  roles: {
    heading: {
      font: "font.heading",
      color: "color.text",
      minSizePx: 32,
      maxSizePx: 72,
      lineHeight: 1.05,
    },
    body: {
      font: "font.body",
      color: "color.text",
      minSizePx: 18,
      maxSizePx: 32,
      lineHeight: 1.4,
    },
    caption: {
      font: "font.body",
      color: "color.text",
      minSizePx: 16,
      maxSizePx: 24,
      lineHeight: 1.3,
    },
    display: {
      font: "font.heading",
      color: "color.text",
      minSizePx: 56,
      maxSizePx: 84,
      lineHeight: 0.95,
    },
    label: {
      font: "font.body",
      color: "color.text",
      minSizePx: 14,
      maxSizePx: 18,
      lineHeight: 1.1,
    },
    index: {
      font: "font.heading",
      color: "color.text",
      minSizePx: 240,
      maxSizePx: 460,
      lineHeight: 0.8,
    },
    signature: {
      font: "font.body",
      color: "color.text",
      minSizePx: 14,
      maxSizePx: 18,
      lineHeight: 1.1,
    },
  },
  assets: {
    "logo.primary": {
      path: "assets/logos/logo.svg",
      sha256: "a".repeat(64),
      format: "svg",
      minWidthPx: 120,
      clearSpaceRatio: 0.1,
    },
    "logo.onLight": {
      path: "assets/logos/logo.svg",
      sha256: "a".repeat(64),
      format: "svg",
      minWidthPx: 24,
      clearSpaceRatio: 0.25,
    },
    "logo.onDark": {
      path: "assets/logos/logo-on-dark.svg",
      sha256: "b".repeat(64),
      format: "svg",
      minWidthPx: 24,
      clearSpaceRatio: 0.25,
    },
  },
  compositionRules: {
    modes: {
      light: {
        backgroundColorToken: "color.background",
        foregroundColorToken: "color.text",
        logoAssetToken: "logo.onLight",
        evidence: [],
      },
    },
    colorRatios: [
      { colorToken: "color.primary", ratio: 0.6, evidence: [] },
      { colorToken: "color.background", ratio: 0.3, evidence: [] },
      { colorToken: "color.secondary", ratio: 0.1, evidence: [] },
    ],
    accent: { colorToken: "color.secondary", maxRatio: 0.1, evidence: [] },
    motifs: [{ kind: "diagonal-lines", evidence: [] }],
    numbering: { style: "zero-padded", minDigits: 2, evidence: [] },
  },
  formatProfiles: ["post-1x1", "post-4x5", "story-9x16", "doc-a4"],
  diagnostics: [],
}

export function fakeStatementLayout(): LayoutSpec {
  return {
    id: "statement-post-1x1",
    namePt: "Frase de impacto",
    profile: "post-1x1",
    canvas: { widthPx: 1080, heightPx: 1080, safeAreaPx: 48 },
    background: { kind: "color", colorToken: "color.background" },
    slots: [
      {
        id: "headline",
        kind: "text",
        required: true,
        area: [48, 324, 984, 432],
        fit: "shrink-within-role-range",
        role: "heading",
        maxChars: 90,
      },
      {
        id: "logo",
        kind: "logo",
        required: true,
        area: [902, 902, 130, 130],
        fit: "fixed",
      },
    ],
  }
}

export function fakeEditorialLayout(): LayoutSpec {
  return {
    id: "editorial-light-post-4x5",
    namePt: "Editorial claro",
    profile: "post-4x5",
    canvas: { widthPx: 1080, heightPx: 1350, safeAreaPx: 48 },
    background: { kind: "color", colorToken: "color.background" },
    compositionMode: "light",
    lockedLayers: [
      {
        id: "diagonal-field",
        kind: "motif",
        motif: "diagonal-lines",
        area: [0, 0, 1080, 1350],
        colorToken: "color.text",
        opacity: 0.06,
        strokeWidthPx: 2,
        spacingPx: 22,
        zIndex: 0,
      },
      {
        id: "frame-top",
        kind: "shape",
        shape: "rectangle",
        area: [52, 52, 976, 2],
        colorToken: "color.text",
        opacity: 0.1,
        zIndex: 1,
      },
      {
        id: "frame-left",
        kind: "shape",
        shape: "rectangle",
        area: [52, 52, 2, 1246],
        colorToken: "color.text",
        opacity: 0.1,
        zIndex: 1,
      },
      {
        id: "frame-right",
        kind: "shape",
        shape: "rectangle",
        area: [1026, 52, 2, 1246],
        colorToken: "color.text",
        opacity: 0.1,
        zIndex: 1,
      },
      {
        id: "frame-bottom",
        kind: "shape",
        shape: "rectangle",
        area: [52, 1296, 976, 2],
        colorToken: "color.text",
        opacity: 0.1,
        zIndex: 1,
      },
      {
        id: "accent-rule",
        kind: "shape",
        shape: "rectangle",
        area: [104, 445, 56, 4],
        colorToken: "color.secondary",
        opacity: 1,
        zIndex: 2,
      },
      {
        id: "brand-mark",
        kind: "asset",
        assetToken: "logo.onLight",
        area: [918, 116, 58, 58],
        fit: "contain",
        opacity: 1,
        zIndex: 2,
      },
    ],
    slots: [
      {
        id: "index",
        kind: "text",
        required: true,
        area: [80, 890, 760, 460],
        fit: "fixed",
        role: "index",
        colorToken: "color.text",
        maxChars: 2,
        zIndex: 5,
        opacity: 0.08,
        letterSpacingEm: -0.04,
        fillMode: "stroke",
        strokeColorToken: "color.text",
        strokeWidthPx: 2.5,
        textFormat: "zero-padded",
      },
      {
        id: "kicker",
        kind: "text",
        required: false,
        area: [104, 470, 820, 40],
        fit: "shrink-within-role-range",
        role: "label",
        colorToken: "color.text",
        maxChars: 48,
        zIndex: 10,
        textTransform: "uppercase",
        letterSpacingEm: 0.18,
      },
      {
        id: "headline",
        kind: "text",
        required: true,
        area: [104, 525, 840, 360],
        fit: "shrink-within-role-range",
        role: "display",
        colorToken: "color.text",
        maxChars: 96,
        zIndex: 10,
        textTransform: "uppercase",
        letterSpacingEm: -0.035,
        emphasisColorToken: "color.secondary",
      },
      {
        id: "signature",
        kind: "text",
        required: false,
        area: [270, 1210, 540, 36],
        fit: "fixed",
        role: "signature",
        colorToken: "color.text",
        maxChars: 48,
        zIndex: 10,
        textAlign: "center",
        textTransform: "uppercase",
        letterSpacingEm: 0.12,
      },
    ],
  }
}

export function fakeQuoteLayout(): LayoutSpec {
  return {
    id: "quote-post-1x1",
    namePt: "Citação sobre foto",
    profile: "post-1x1",
    canvas: { widthPx: 1080, heightPx: 1080, safeAreaPx: 48 },
    background: { kind: "image-slot" },
    slots: [
      {
        id: "photo",
        kind: "image",
        required: true,
        area: [0, 0, 1080, 1080],
        fit: "fixed",
        minResolution: [1080, 1080],
      },
      {
        id: "quote",
        kind: "text",
        required: true,
        area: [48, 346, 984, 389],
        fit: "shrink-within-role-range",
        role: "heading",
        maxChars: 140,
      },
      {
        id: "author",
        kind: "text",
        required: false,
        area: [48, 778, 984, 65],
        fit: "shrink-within-role-range",
        role: "caption",
        maxChars: 40,
      },
      {
        id: "logo",
        kind: "logo",
        required: true,
        area: [902, 902, 130, 130],
        fit: "fixed",
      },
    ],
  }
}

export function fakeOnePagerLayout(): LayoutSpec {
  return {
    id: "one-pager-doc-a4",
    namePt: "Documento de uma página",
    profile: "doc-a4",
    canvas: { widthPx: 794, heightPx: 1123, safeAreaPx: 76 },
    background: { kind: "color", colorToken: "color.background" },
    slots: [
      {
        id: "title",
        kind: "text",
        required: true,
        area: [76, 76, 642, 120],
        fit: "shrink-within-role-range",
        role: "heading",
        maxChars: 80,
      },
      {
        id: "body",
        kind: "text",
        required: true,
        area: [76, 226, 642, 725],
        fit: "shrink-within-role-range",
        role: "body",
        maxChars: 2200,
      },
      {
        id: "logo",
        kind: "logo",
        required: true,
        area: [622, 951, 96, 96],
        fit: "fixed",
      },
    ],
  }
}

export function fakeCampaign(): Campaign {
  return {
    id: "campaign_x",
    brandRevisionId: FAKE_IR.revision.id,
    name: "Lançamento",
    fields: {
      headline: "Uma mensagem",
      body: "Um corpo compartilhado.",
      cta: "Saiba mais",
      date: "24 de julho",
      imageSha256: null,
    },
    createdAt: "2026-07-18T12:00:00Z",
    updatedAt: "2026-07-18T12:00:00Z",
    pieces: [
      {
        id: "piece_x",
        documentId: "doc_campaign",
        layoutId: "statement-post-1x1",
        bindings: { headline: { kind: "text", source: "all" } },
        content: {
          layoutId: "statement-post-1x1",
          brandRevisionId: FAKE_IR.revision.id,
          values: { headline: { kind: "text", text: "Uma mensagem" } },
        },
        checks: [],
      },
    ],
  }
}

export function fakeCarousel(
  slides: CarouselSlideInput[] = [
    { kicker: "", headline: "Capa", textBlocks: [], cta: "" },
    { kicker: "", headline: "Conteúdo", textBlocks: [], cta: "" },
    { kicker: "", headline: "Fechamento", textBlocks: [], cta: "" },
  ],
): Carousel {
  const layout = fakeStatementLayout()
  return {
    id: "carousel_x",
    brandRevisionId: FAKE_IR.revision.id,
    name: "Sequência",
    profile: "post-1x1",
    signature: { text: "@acme", vertical: "bottom", horizontal: "left" },
    createdAt: "2026-07-20T12:00:00Z",
    slides: slides.map((source, index) => ({
      id: `slide_${index + 1}`,
      documentId: `doc_slide_${index + 1}`,
      position: index + 1,
      role: index === 0 ? "cover" : index === slides.length - 1 ? "closing" : "content",
      source,
      layoutId: layout.id,
      layout,
      content: {
        layoutId: layout.id,
        brandRevisionId: FAKE_IR.revision.id,
        values: { headline: { kind: "text", text: source.headline } },
      },
      checks: [],
      composition: {
        mode: source.layoutId ? "manual" : "automatic",
        reasonPt: source.layoutId
          ? "Este modelo foi escolhido manualmente para o slide."
          : "A composição respeita o papel deste slide na sequência.",
      },
    })),
  }
}

export function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  const sha256 = "b".repeat(64)
  return {
    importBrandPackage: vi.fn(async () => ({
      draftId: "draft_x",
      questions: [],
      diagnostics: [],
      ignoredEntries: [],
    })),
    resolveDraftFont: vi.fn(async (_draftId, questionId, family) => ({
      candidate: {
        value: {
          family,
          weight: questionId === "font.heading" ? 700 : 400,
          style: "normal",
        },
        score: 1,
        evidence: [],
      },
      status: "not-found" as const,
    })),
    compileDraft: vi.fn(async () => ({ brandRevisionId: FAKE_IR.revision.id })),
    getBrandRevision: vi.fn(async () => FAKE_IR),
    getKit: vi.fn(async () => [fakeStatementLayout(), fakeEditorialLayout()]),
    listCampaigns: vi.fn(async () => []),
    getCampaign: vi.fn(async () => fakeCampaign()),
    createCampaign: vi.fn(async (input) => ({
      ...fakeCampaign(),
      name: input.name,
      fields: input.fields,
      brandRevisionId: input.brandRevisionId,
    })),
    updateCampaign: vi.fn(async (_campaignId, input) => ({
      ...fakeCampaign(),
      name: input.name,
      fields: input.fields,
    })),
    listCarousels: vi.fn(async () => []),
    getCarousel: vi.fn(async () => fakeCarousel()),
    createCarousel: vi.fn(async (input) => ({
      ...fakeCarousel(input.slides),
      name: input.name,
      profile: input.profile,
      signature: input.signature,
      brandRevisionId: input.brandRevisionId,
    })),
    updateCarouselSlide: vi.fn(async (carouselId, slideId, content) => {
      const slide = fakeCarousel().slides.find((candidate) => candidate.id === slideId)
      if (!slide) throw new Error(`Slide ${slideId} não encontrado em ${carouselId}.`)
      return { ...slide, content }
    }),
    requestCarouselExport: vi.fn(async () => ({ jobId: "job_carousel" })),
    uploadAsset: vi.fn(async (file) => ({ sha256, size: file.size })),
    createDocument: vi.fn(async () => ({ documentId: "doc_x", checks: [] })),
    requestExport: vi.fn(async () => ({ jobId: "job_x" })),
    getJob: vi.fn(async (): Promise<JobInfo> => ({
      id: "job_x",
      status: "succeeded",
      result: {
        sha256,
        url: `/v1/assets/${sha256}`,
        format: "png",
        filename: "doc_x.png",
      },
      checks: [],
      error: null,
    })),
    requestRoundtrip: vi.fn(async () => ({ jobId: "job_roundtrip" })),
    requestRoundtripFix: vi.fn(async () => ({ jobId: "job_fix" })),
    getRoundtripJob: vi.fn(async (): Promise<RoundtripJobInfo> => ({
      id: "job_roundtrip",
      status: "succeeded",
      result: {
        kind: "roundtrip-lint",
        baselineGraph: {},
        documentGraph: {},
        report: {
          schemaVersion: "0.1.0",
          baselineSha256: "a".repeat(64),
          editedSha256: "b".repeat(64),
          summary: {
            status: "pass",
            total: 0,
            info: 0,
            warning: 0,
            error: 0,
            locked: 0,
            fixable: 0,
          },
          findings: [],
        },
        fixPlan: {
          schemaVersion: "0.1.0",
          baselineSha256: "a".repeat(64),
          editedSha256: "b".repeat(64),
          operations: [],
          deferredFindingCodes: [],
        },
      },
      checks: [],
      error: null,
    })),
    requestDocxBranding: vi.fn(async () => ({ jobId: "job_docx_analysis" })),
    requestDocxBrandApply: vi.fn(async () => ({ jobId: "job_docx_apply" })),
    getDocxBrandJob: vi.fn(async (): Promise<DocxBrandJobInfo> => ({
      id: "job_docx_analysis",
      status: "succeeded",
      result: {
        kind: "docx-brand-analyze",
        plan: {
          schemaVersion: "0.1.0",
          source: {
            filename: "proposta.docx",
            sha256,
            sizeBytes: 1024,
            paragraphCount: 8,
            tableCount: 1,
            sectionCount: 1,
          },
          brandRevisionId: FAKE_IR.revision.id,
          operations: [
            {
              id: "op-001",
              kind: "paragraph-styles",
              labelPt: "Aplicar hierarquia da marca a 8 parágrafos",
              affectedCount: 8,
            },
          ],
          warnings: [],
        },
      },
      checks: [],
      error: null,
    })),
    draftAssetUrl: (draftId, path) =>
      `/v1/drafts/${encodeURIComponent(draftId)}/assets/${path
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/")}`,
    revisionAssetsBaseUrl: (revisionId) =>
      `/v1/brand-revisions/${encodeURIComponent(revisionId)}/assets`,
    ...overrides,
  }
}
