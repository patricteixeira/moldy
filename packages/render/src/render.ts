import { chooseFontSize } from "./fit";
import { buildFontFaces, joinUrl } from "./fonts";
import { roleStyle } from "./styles";
import type { CompositionModeRule, GuardReport, LockedLayer, Payload, Slot } from "./types";

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

function applyBoxStyle(box: HTMLElement, slot: Slot): void {
  applyAreaStyle(box, slot.area, String(slot.zIndex ?? Z_INDEX[slot.kind]));
  if (slot.opacity !== undefined && slot.opacity !== null) {
    box.style.opacity = String(slot.opacity);
  }
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

function appendLockedLayer(
  container: HTMLElement,
  payload: Payload,
  layer: LockedLayer,
  index: number,
): void {
  const element = document.createElement("div");
  element.dataset.lockedLayerIndex = String(index);
  element.dataset.layerKind = layer.kind;
  element.dataset.layerId = layer.id;
  applyAreaStyle(element, layer.area, String(layer.zIndex ?? 0));

  if (layer.kind === "shape") {
    element.style.backgroundColor = payload.brandIr.colors[layer.colorToken].value;
    element.style.opacity = String(layer.opacity ?? 1);
    if (layer.shape === "circle") element.style.borderRadius = "50%";
  } else if (layer.kind === "motif") {
    const color = payload.brandIr.colors[layer.colorToken].value;
    element.style.opacity = String(layer.opacity ?? 1);
    element.style.backgroundImage = [
      "repeating-linear-gradient(135deg",
      `${color} 0px`,
      `${color} ${layer.strokeWidthPx}px`,
      `transparent ${layer.strokeWidthPx}px`,
      `transparent ${layer.spacingPx}px)`,
    ].join(", ");
  } else {
    const asset = payload.brandIr.assets[layer.assetToken];
    element.style.opacity = String(layer.opacity ?? 1);
    element.appendChild(
      createImage(joinUrl(payload.assetsBaseUrl, asset.path), layer.fit ?? "contain"),
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
  if (layout.background.kind === "color" && layout.background.colorToken) {
    const token = compositionMode?.backgroundColorToken ?? layout.background.colorToken;
    container.style.backgroundColor = ir.colors[token].value;
  }

  const fontBuild = buildFontFaces(ir, payload.assetsBaseUrl);
  const style = document.createElement("style");
  style.textContent = fontBuild.css;
  container.appendChild(style);

  for (const [index, layer] of (layout.lockedLayers ?? []).entries()) {
    appendLockedLayer(container, payload, layer, index);
  }

  const report: GuardReport = { overflows: [], fontFallbacks: [] };
  const measureText = options.measureText ?? ((element: HTMLElement) => element.scrollHeight);

  for (const slot of layout.slots) {
    const value = content.values[slot.id];
    if (slot.kind === "text" && value?.kind !== "text") continue;
    if (slot.kind === "image" && value?.kind !== "image") continue;

    const box = document.createElement("div");
    box.dataset.slotId = slot.id;
    applyBoxStyle(box, slot);

    if (slot.kind === "logo") {
      const assetToken = slot.assetToken ?? compositionMode?.logoAssetToken ?? "logo.primary";
      box.appendChild(
        createImage(joinUrl(payload.assetsBaseUrl, ir.assets[assetToken].path), "contain"),
      );
      container.appendChild(box);
      continue;
    }

    if (slot.kind === "image" && value?.kind === "image") {
      box.appendChild(createImage(joinUrl(payload.assetsBaseUrl, value.path), "cover"));
      container.appendChild(box);
      continue;
    }

    if (slot.kind === "text" && value?.kind === "text" && slot.role) {
      const textStyle = roleStyle(ir, slot.role, fontBuild.families);
      const contentElement = document.createElement("div");
      contentElement.dataset.slotContent = "";
      const colorToken = slot.colorToken ?? compositionMode?.foregroundColorToken;
      const color = colorToken ? ir.colors[colorToken].value : textStyle.color;
      const fillMode = slot.fillMode ?? "fill";
      Object.assign(contentElement.style, {
        all: "initial",
        boxSizing: "border-box",
        display: "block",
        fontFamily: textStyle.fontFamily,
        fontWeight: textStyle.fontWeight,
        fontStyle: textStyle.fontStyle,
        color: fillMode === "stroke" ? "transparent" : color,
        lineHeight: textStyle.lineHeight,
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
        textRendering: "optimizeLegibility",
        fontFeatureSettings: '"kern" 1, "liga" 1',
        letterSpacing:
          slot.letterSpacingEm === undefined || slot.letterSpacingEm === null
            ? "normal"
            : `${slot.letterSpacingEm}em`,
        textIndent: "0",
        textAlign: slot.textAlign ?? "left",
        textTransform: slot.textTransform ?? "none",
        wordSpacing: "normal",
      });
      if (fillMode === "stroke") {
        const strokeToken =
          slot.strokeColorToken ?? slot.colorToken ?? compositionMode?.foregroundColorToken;
        const strokeColor = strokeToken ? ir.colors[strokeToken].value : textStyle.color;
        contentElement.style.setProperty(
          "-webkit-text-stroke",
          `${slot.strokeWidthPx ?? 1}px ${strokeColor}`,
        );
        contentElement.style.setProperty("paint-order", "stroke fill");
      }
      const emphasisColor = slot.emphasisColorToken
        ? ir.colors[slot.emphasisColorToken].value
        : null;
      const minimumDigits = ir.compositionRules?.numbering?.minDigits ?? 2;
      const text =
        slot.textFormat === "zero-padded" && /^\d+$/.test(value.text)
          ? value.text.padStart(minimumDigits, "0")
          : value.text;
      appendTextWithEmphasis(contentElement, text, value.emphasis, emphasisColor);
      box.appendChild(contentElement);
      container.appendChild(box);

      const measureAt = (sizePx: number): number => {
        contentElement.style.fontSize = `${sizePx}px`;
        return measureText(contentElement, sizePx);
      };
      const size =
        slot.fit === "shrink-within-role-range"
          ? chooseFontSize(measureAt, slot.area[3], textStyle.minSizePx, textStyle.maxSizePx)
          : textStyle.maxSizePx;
      contentElement.style.fontSize = `${size}px`;
      const contentPx = measureText(contentElement, size);
      if (contentPx > slot.area[3]) {
        report.overflows.push({ slotId: slot.id, contentPx, boxPx: slot.area[3] });
      }

      const token = ir.roles[slot.role].font;
      const font = ir.fonts[token];
      if (font.source === "referenced-only" || font.source === "fallback") {
        report.fontFallbacks.push({
          slotId: slot.id,
          token,
          family: font.family,
          reason: font.source === "referenced-only" ? "referenced-only" : "configured-fallback",
        });
      } else if (options.fontLoadStatus?.get(token) === false) {
        report.fontFallbacks.push({
          slotId: slot.id,
          token,
          family: font.family,
          reason: "load-failed",
        });
      }
    }
  }

  return report;
}
