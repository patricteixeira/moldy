import type { ApiClient, BrandIr, JobInfo, LayoutSpec } from "../api/types"
import { vi } from "vitest"

export const FAKE_IR: BrandIr = {
  schemaVersion: "1.0.0",
  brand: { name: "ACME" },
  revision: { id: "brandrev_x", createdAt: "2026-07-12T00:00:00Z" },
  colors: {
    "color.primary": { value: "#1A4D8F", evidence: [] },
    "color.background": { value: "#FFFFFF", evidence: [] },
    "color.text": { value: "#1A1A1A", evidence: [] },
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
  },
  assets: {
    "logo.primary": {
      path: "assets/logos/logo.svg",
      sha256: "a".repeat(64),
      format: "svg",
      minWidthPx: 120,
      clearSpaceRatio: 0.1,
    },
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
