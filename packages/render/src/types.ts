export interface ColorToken {
  value: string;
}

export interface FontToken {
  family: string;
  weight: number;
  style: "normal" | "italic";
  source: "file" | "referenced-only" | "fallback";
  fileSha256?: string | null;
}

export interface SemanticRole {
  font: string;
  color: string;
  minSizePx: number;
  maxSizePx: number;
  lineHeight: number;
}

export interface LogoAsset {
  path: string;
  minWidthPx?: number;
}

export interface BrandIr {
  revision: { id: string };
  colors: Record<string, ColorToken>;
  fonts: Record<string, FontToken>;
  roles: Record<string, SemanticRole>;
  assets: Record<string, LogoAsset>;
}

export interface Canvas {
  widthPx: number;
  heightPx: number;
  safeAreaPx: number;
}

export interface Background {
  kind: "color" | "image-slot";
  colorToken?: string | null;
}

export interface Slot {
  id: string;
  kind: "text" | "image" | "logo";
  role?: string | null;
  maxChars?: number | null;
  minResolution?: [number, number] | null;
  area: [number, number, number, number];
  fit: "shrink-within-role-range" | "fixed";
  required: boolean;
}

export type Profile = "post-1x1" | "post-4x5" | "story-9x16" | "doc-a4";

export interface LayoutSpec {
  id: string;
  profile: Profile;
  namePt: string;
  canvas: Canvas;
  background: Background;
  slots: Slot[];
}

export type SlotValue =
  | { kind: "text"; text: string }
  | { kind: "image"; path: string; sha256?: string | null };

export interface ContentSpec {
  layoutId: string;
  brandRevisionId: string;
  values: Record<string, SlotValue>;
}

export interface Payload {
  brandIr: BrandIr;
  layoutSpec: LayoutSpec;
  contentSpec: ContentSpec;
  assetsBaseUrl: string;
}

export type RenderPayload = Payload;

export interface Overflow {
  slotId: string;
  contentPx: number;
  boxPx: number;
}

export interface FontFallback {
  slotId: string;
  token: string;
  family: string;
  reason: "referenced-only" | "configured-fallback" | "load-failed";
}

export interface GuardReport {
  overflows: Overflow[];
  fontFallbacks: FontFallback[];
}
