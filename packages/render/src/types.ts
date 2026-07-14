export interface ColorToken {
  value: string;
}

export interface FontToken {
  family: string;
  weight: number;
  style: "normal" | "italic";
  source: "file" | "referenced-only" | "fallback";
  fileSha256?: string | null;
  resource?: {
    axes?: Array<{
      tag: string;
      minimum: number;
      default: number;
      maximum: number;
    }>;
  } | null;
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

export interface CompositionModeRule {
  backgroundColorToken: string;
  foregroundColorToken: string;
  logoAssetToken?: string | null;
  evidence?: unknown[];
}

export interface CompositionRules {
  modes?: {
    light?: CompositionModeRule | null;
    dark?: CompositionModeRule | null;
  };
  colorRatios?: Array<{
    colorToken: string;
    ratio: number;
    evidence?: unknown[];
  }>;
  accent?: {
    colorToken: string;
    maxRatio: number;
    evidence?: unknown[];
  } | null;
  motifs?: Array<{
    kind: "diagonal-lines";
    evidence?: unknown[];
  }>;
  numbering?: {
    style: "zero-padded";
    minDigits?: number;
    evidence?: unknown[];
  } | null;
}

export interface BrandIr {
  schemaVersion?: "0.1.0" | "0.2.0" | "0.3.0";
  revision: { id: string };
  colors: Record<string, ColorToken>;
  fonts: Record<string, FontToken>;
  roles: Record<string, SemanticRole>;
  assets: Record<string, LogoAsset>;
  compositionRules?: CompositionRules | null;
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
  colorToken?: string | null;
  zIndex?: number | null;
  opacity?: number | null;
  textAlign?: "left" | "center" | "right" | null;
  textTransform?: "none" | "uppercase" | null;
  letterSpacingEm?: number | null;
  fillMode?: "fill" | "stroke" | null;
  strokeColorToken?: string | null;
  strokeWidthPx?: number | null;
  assetToken?: string | null;
  emphasisColorToken?: string | null;
  textFormat?: "plain" | "zero-padded" | null;
}

export interface ShapeLayer {
  id: string;
  kind: "shape";
  shape: "rectangle" | "circle";
  area: [number, number, number, number];
  colorToken: string;
  opacity?: number;
  zIndex?: number;
}

export interface MotifLayer {
  id: string;
  kind: "motif";
  motif: "diagonal-lines";
  area: [number, number, number, number];
  colorToken: string;
  opacity?: number;
  strokeWidthPx: number;
  spacingPx: number;
  zIndex?: number;
}

export interface AssetLayer {
  id: string;
  kind: "asset";
  assetToken: string;
  area: [number, number, number, number];
  fit?: "contain" | "cover";
  opacity?: number;
  zIndex?: number;
}

export type LockedLayer = ShapeLayer | MotifLayer | AssetLayer;

export type Profile = "post-1x1" | "post-4x5" | "story-9x16" | "doc-a4";

export interface LayoutSpec {
  id: string;
  profile: Profile;
  namePt: string;
  canvas: Canvas;
  background: Background;
  slots: Slot[];
  compositionMode?: "light" | "dark" | null;
  lockedLayers?: LockedLayer[] | null;
}

export type SlotValue =
  | { kind: "text"; text: string; emphasis?: string | null }
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
