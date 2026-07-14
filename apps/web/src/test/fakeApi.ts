import type { ApiClient, BrandIr, JobInfo, LayoutSpec } from "../api/types"
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
    getKit: vi.fn(async () => [fakeStatementLayout()]),
    uploadAsset: vi.fn(async (file) => ({ sha256, size: file.size })),
    createDocument: vi.fn(async () => ({ documentId: "doc_x", checks: [] })),
    requestExport: vi.fn(async () => ({ jobId: "job_x" })),
    getJob: vi.fn(async (): Promise<JobInfo> => ({
      id: "job_x",
      status: "succeeded",
      result: { sha256, url: `/v1/assets/${sha256}` },
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
