import { chooseFontSize } from "./fit";
import { buildFontFaces, joinUrl } from "./fonts";
import { roleStyle } from "./styles";
import { paintForSurface } from "./surfaces";
import type {
  CompositionModeRule,
  GuardReport,
  LayerOverride,
  LockedLayer,
  Payload,
  Slot,
} from "./types";

export interface RenderOptions {
  measureText?: (contentEl: HTMLElement, fontSizePx: number) => number;
  fontLoadStatus?: ReadonlyMap<string, boolean>;
}

const Z_INDEX: Record<Slot["kind"], string> = { image: "1", text: "2", logo: "3" };

type Area = [number, number, number, number];

function applyAreaStyle(box: HTMLElement, area: Area, zIndex: string): void {
  const [left, top, width, height] = area;
  Object.assign(box.style, {
    all: "initial",
    boxSizing: "border-box",
    display: "block",
    position: "absolute",
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
    overflow: "hidden",
    zIndex,
  });
}

function applyBoxStyle(box: HTMLElement, slot: Slot, override?: LayerOverride): void {
  applyAreaStyle(
    box,
    override?.area ?? slot.area,
    String(override?.zIndex ?? slot.zIndex ?? Z_INDEX[slot.kind]),
  );
  box.style.transform = override?.rotationDeg ? `rotate(${override.rotationDeg}deg)` : "";
  box.style.transformOrigin = "center";
  box.style.opacity = String(override?.opacity ?? slot.opacity ?? 1);
  if (override?.hidden) box.style.display = "none";
}

function createImage(src: string, fit: "cover" | "contain"): HTMLImageElement {
  const image = document.createElement("img");
  image.src = src;
  image.alt = "";
  Object.assign(image.style, {
    all: "initial",
    boxSizing: "border-box",
    width: "100%",
    height: "100%",
    objectFit: fit,
    display: "block",
  });
  return image;
}

function activeCompositionMode(payload: Payload): CompositionModeRule | null {
  const name = payload.layoutSpec.compositionMode;
  if (name !== "light" && name !== "dark") return null;
  return payload.brandIr.compositionRules?.modes?.[name] ?? null;
}

function effectiveBackgroundToken(
  payload: Payload,
  compositionMode: CompositionModeRule | null,
): string | null {
  if (payload.contentSpec.backgroundColorToken) {
    return payload.contentSpec.backgroundColorToken;
  }
  if (compositionMode?.backgroundColorToken) return compositionMode.backgroundColorToken;
  if (payload.layoutSpec.background.kind !== "color") return null;
  return payload.layoutSpec.background.colorToken ?? null;
}

function relativeLuminance(color: string): number {
  const channels = [color.slice(1, 3), color.slice(3, 5), color.slice(5, 7)].map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function automaticLogoToken(payload: Payload, backgroundToken: string | null): string | null {
  if (!backgroundToken) return null;
  const background = payload.brandIr.colors[backgroundToken];
  if (!background) return null;
  const token = relativeLuminance(background.value) >= 0.179 ? "logo.onLight" : "logo.onDark";
  return Object.hasOwn(payload.brandIr.assets, token) ? token : null;
}

function logoAssetToken(
  payload: Payload,
  slot: Slot,
  compositionMode: CompositionModeRule | null,
  backgroundToken: string | null,
): string {
  return (
    payload.contentSpec.assetBindings?.[slot.id] ??
    automaticLogoToken(payload, backgroundToken) ??
    slot.assetToken ??
    compositionMode?.logoAssetToken ??
    "logo.primary"
  );
}

function appendSurface(container: HTMLElement, payload: Payload): void {
  const surface = payload.contentSpec.surface;
  if (!surface) return;
  const element = document.createElement("div");
  element.dataset.surfaceKind = surface.kind;
  applyAreaStyle(
    element,
    [0, 0, payload.layoutSpec.canvas.widthPx, payload.layoutSpec.canvas.heightPx],
    "0",
  );
  element.style.pointerEvents = "none";
  element.style.opacity = String(surface.opacity);
  const color = payload.brandIr.colors[surface.colorToken].value;
  Object.assign(element.style, paintForSurface(surface, color));
  container.appendChild(element);
}

function appendLockedLayer(
  container: HTMLElement,
  payload: Payload,
  layer: LockedLayer,
  index: number,
  backgroundToken: string | null,
): void {
  const override = payload.contentSpec.overrides?.[layer.id];
  const element = document.createElement("div");
  element.dataset.lockedLayerIndex = String(index);
  element.dataset.layerKind = layer.kind;
  element.dataset.layerId = layer.id;
  applyAreaStyle(
    element,
    override?.area ?? layer.area,
    String(override?.zIndex ?? layer.zIndex ?? 0),
  );
  element.style.transform = override?.rotationDeg ? `rotate(${override.rotationDeg}deg)` : "";
  element.style.transformOrigin = "center";
  element.style.opacity = String(override?.opacity ?? layer.opacity ?? 1);
  if (override?.hidden) element.style.display = "none";

  if (layer.kind === "shape") {
    const token = override?.colorToken ?? layer.colorToken;
    element.style.backgroundColor = payload.brandIr.colors[token].value;
    if (layer.shape === "circle") element.style.borderRadius = "50%";
  } else if (layer.kind === "motif") {
    const token = override?.colorToken ?? layer.colorToken;
    const color = payload.brandIr.colors[token].value;
    const strokeWidth = override?.strokeWidthPx ?? layer.strokeWidthPx;
    const spacing = override?.spacingPx ?? layer.spacingPx;
    element.style.backgroundImage = [
      "repeating-linear-gradient(135deg",
      `${color} 0px`,
      `${color} ${strokeWidth}px`,
      `transparent ${strokeWidth}px`,
      `transparent ${spacing}px)`,
    ].join(", ");
  } else {
    const assetToken =
      payload.contentSpec.assetBindings?.[layer.id] ??
      (layer.assetToken.startsWith("logo.")
        ? automaticLogoToken(payload, backgroundToken)
        : null) ??
      layer.assetToken;
    const asset = payload.brandIr.assets[assetToken];
    element.appendChild(
      createImage(
        joinUrl(payload.assetsBaseUrl, asset.path),
        override?.fit ?? layer.fit ?? "contain",
      ),
    );
  }
  container.appendChild(element);
}

function appendTextWithEmphasis(
  element: HTMLElement,
  text: string,
  emphasis: string | null | undefined,
  emphasisColor: string | null,
): void {
  if (!emphasis || !emphasisColor) {
    element.textContent = text;
    return;
  }
  const start = text.indexOf(emphasis);
  if (start < 0) {
    element.textContent = text;
    return;
  }
  const span = document.createElement("span");
  span.dataset.emphasis = "";
  span.textContent = emphasis;
  span.style.all = "unset";
  span.style.color = emphasisColor;
  span.style.setProperty("-webkit-text-stroke", "0px transparent");
  element.append(
    document.createTextNode(text.slice(0, start)),
    span,
    document.createTextNode(text.slice(start + emphasis.length)),
  );
}

export function renderDocument(
  container: HTMLElement,
  payload: Payload,
  options: RenderOptions = {},
): GuardReport {
  container.replaceChildren();
  const { brandIr: ir, layoutSpec: layout, contentSpec: content } = payload;
  Object.assign(container.style, {
    all: "initial",
    boxSizing: "border-box",
    display: "block",
    direction: "ltr",
    isolation: "isolate",
    position: "relative",
    overflow: "hidden",
    width: `${layout.canvas.widthPx}px`,
    height: `${layout.canvas.heightPx}px`,
    backgroundColor: "",
  });
  const compositionMode = activeCompositionMode(payload);
  const backgroundToken = effectiveBackgroundToken(payload, compositionMode);
  if (backgroundToken) {
    container.style.backgroundColor = ir.colors[backgroundToken].value;
  }

  const fontBuild = buildFontFaces(ir, payload.assetsBaseUrl);
  const style = document.createElement("style");
  style.textContent = fontBuild.css;
  container.appendChild(style);
  appendSurface(container, payload);

  for (const [index, layer] of (layout.lockedLayers ?? []).entries()) {
    appendLockedLayer(container, payload, layer, index, backgroundToken);
  }

  const report: GuardReport = { overflows: [], fontFallbacks: [] };
  const measureText = options.measureText ?? ((element: HTMLElement) => element.scrollHeight);

  for (const slot of layout.slots) {
    const value = content.values[slot.id];
    if (slot.kind === "text" && value?.kind !== "text") continue;
    if (slot.kind === "image" && value?.kind !== "image") continue;

    const box = document.createElement("div");
    box.dataset.slotId = slot.id;
    const override = content.overrides?.[slot.id];
    applyBoxStyle(box, slot, override);

    if (slot.kind === "logo") {
      const assetToken = logoAssetToken(payload, slot, compositionMode, backgroundToken);
      box.appendChild(
        createImage(
          joinUrl(payload.assetsBaseUrl, ir.assets[assetToken].path),
          override?.fit ?? "contain",
        ),
      );
      container.appendChild(box);
      continue;
    }

    if (slot.kind === "image" && value?.kind === "image") {
      box.appendChild(
        createImage(joinUrl(payload.assetsBaseUrl, value.path), override?.fit ?? "cover"),
      );
      container.appendChild(box);
      continue;
    }

    if (slot.kind === "text" && value?.kind === "text" && slot.role) {
      const textStyle = roleStyle(ir, slot.role, fontBuild.families);
      const fontToken = override?.fontToken ?? ir.roles[slot.role].font;
      const font = ir.fonts[fontToken];
      const contentElement = document.createElement("div");
      contentElement.dataset.slotContent = "";
      const colorToken =
        override?.colorToken ?? slot.colorToken ?? compositionMode?.foregroundColorToken;
      const color = colorToken ? ir.colors[colorToken].value : textStyle.color;
      const fillMode = override?.fillMode ?? slot.fillMode ?? "fill";
      Object.assign(contentElement.style, {
        all: "initial",
        boxSizing: "border-box",
        display: "block",
        fontFamily: fontBuild.families[fontToken],
        fontWeight: String(override?.fontWeight ?? slot.fontWeight ?? font.weight),
        fontStyle: override?.fontStyle ?? slot.fontStyle ?? font.style,
        color: fillMode === "stroke" ? "transparent" : color,
        lineHeight: String(override?.lineHeight ?? slot.lineHeight ?? textStyle.lineHeight),
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
        textRendering: "optimizeLegibility",
        fontFeatureSettings: '"kern" 1, "liga" 1',
        letterSpacing:
          override?.letterSpacingEm === undefined || override.letterSpacingEm === null
            ? slot.letterSpacingEm === undefined || slot.letterSpacingEm === null
              ? "normal"
              : `${slot.letterSpacingEm}em`
            : `${override.letterSpacingEm}em`,
        textIndent: "0",
        textAlign: override?.textAlign ?? slot.textAlign ?? "left",
        textTransform: override?.textTransform ?? slot.textTransform ?? "none",
        wordSpacing: "normal",
      });
      if (fillMode === "stroke") {
        const strokeToken =
          override?.strokeColorToken ??
          slot.strokeColorToken ??
          override?.colorToken ??
          slot.colorToken ??
          compositionMode?.foregroundColorToken;
        const strokeColor = strokeToken ? ir.colors[strokeToken].value : textStyle.color;
        contentElement.style.setProperty(
          "-webkit-text-stroke",
          `${override?.strokeWidthPx ?? slot.strokeWidthPx ?? 1}px ${strokeColor}`,
        );
        contentElement.style.setProperty("paint-order", "stroke fill");
      }
      const emphasisColor = slot.emphasisColorToken
        ? ir.colors[slot.emphasisColorToken].value
        : null;
      const minimumDigits = ir.compositionRules?.numbering?.minDigits ?? 2;
      const zeroPaddedNumber =
        slot.textFormat === "zero-padded"
          ? /^\s*(\d+)(?:\s*\/\s*\d+)?\s*$/.exec(value.text)?.[1]
          : undefined;
      const text = zeroPaddedNumber ? zeroPaddedNumber.padStart(minimumDigits, "0") : value.text;
      appendTextWithEmphasis(contentElement, text, value.emphasis, emphasisColor);
      box.appendChild(contentElement);
      container.appendChild(box);

      const measureAt = (sizePx: number): number => {
        contentElement.style.fontSize = `${sizePx}px`;
        return measureText(contentElement, sizePx);
      };
      const effectiveArea = override?.area ?? slot.area;
      const size =
        override?.fontSizePx ??
        (slot.fit === "shrink-within-role-range"
          ? chooseFontSize(
              measureAt,
              effectiveArea[3],
              textStyle.minSizePx,
              slot.fontSizePx ?? textStyle.maxSizePx,
            )
          : (slot.fontSizePx ?? textStyle.maxSizePx));
      contentElement.style.fontSize = `${size}px`;
      const contentPx = measureText(contentElement, size);
      if (contentPx > effectiveArea[3]) {
        report.overflows.push({ slotId: slot.id, contentPx, boxPx: effectiveArea[3] });
      }

      if (font.source === "referenced-only" || font.source === "fallback") {
        report.fontFallbacks.push({
          slotId: slot.id,
          token: fontToken,
          family: font.family,
          reason: font.source === "referenced-only" ? "referenced-only" : "configured-fallback",
        });
      } else if (options.fontLoadStatus?.get(fontToken) === false) {
        report.fontFallbacks.push({
          slotId: slot.id,
          token: fontToken,
          family: font.family,
          reason: "load-failed",
        });
      }
    }
  }

  return report;
}
