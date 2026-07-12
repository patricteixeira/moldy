import type { BrandIr, ContentSpec, LayoutSpec, Payload } from "../src/types";

export const SHA = "a".repeat(64);

export function fixtureIr(): BrandIr {
  return {
    revision: { id: "brandrev_fixture" },
    colors: {
      "color.primary": { value: "#1A4D8F" },
      "color.background": { value: "#FFFFFF" },
      "color.text": { value: "#1A1A1A" },
    },
    fonts: {
      "font.heading": {
        family: "Fixture Sans",
        weight: 700,
        style: "normal",
        source: "file",
        fileSha256: SHA,
      },
      "font.body": {
        family: "Helvetica",
        weight: 400,
        style: "normal",
        source: "referenced-only",
      },
    },
    roles: {
      heading: {
        font: "font.heading",
        color: "color.primary",
        minSizePx: 40,
        maxSizePx: 96,
        lineHeight: 1.1,
      },
      body: {
        font: "font.body",
        color: "color.text",
        minSizePx: 16,
        maxSizePx: 24,
        lineHeight: 1.5,
      },
      caption: {
        font: "font.body",
        color: "color.text",
        minSizePx: 12,
        maxSizePx: 16,
        lineHeight: 1.4,
      },
    },
    assets: { "logo.primary": { path: "assets/logos/logo.svg", minWidthPx: 96 } },
  };
}

export function fixtureLayout(): LayoutSpec {
  return {
    id: "statement-post-1x1",
    profile: "post-1x1",
    namePt: "Frase de impacto",
    canvas: { widthPx: 1080, heightPx: 1080, safeAreaPx: 48 },
    background: { kind: "color", colorToken: "color.background" },
    slots: [
      {
        id: "headline",
        kind: "text",
        role: "heading",
        maxChars: 90,
        area: [48, 324, 984, 432],
        fit: "shrink-within-role-range",
        required: true,
      },
      {
        id: "logo",
        kind: "logo",
        area: [902, 902, 130, 130],
        fit: "fixed",
        required: true,
      },
    ],
  };
}

export function fixtureContent(): ContentSpec {
  return {
    layoutId: "statement-post-1x1",
    brandRevisionId: "brandrev_fixture",
    values: { headline: { kind: "text", text: "Olá, marca" } },
  };
}

export function fixturePayload(): Payload {
  return {
    brandIr: fixtureIr(),
    layoutSpec: fixtureLayout(),
    contentSpec: fixtureContent(),
    assetsBaseUrl: "/pkg",
  };
}
