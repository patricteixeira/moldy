import { chooseFontSize } from "./fit";
import { buildFontFaces, joinUrl } from "./fonts";
import { roleStyle } from "./styles";
import type { GuardReport, Payload, Slot } from "./types";

export interface RenderOptions {
  measureText?: (contentEl: HTMLElement, fontSizePx: number) => number;
  fontLoadStatus?: ReadonlyMap<string, boolean>;
}

const Z_INDEX: Record<Slot["kind"], string> = { image: "1", text: "2", logo: "3" };

function applyBoxStyle(box: HTMLElement, slot: Slot): void {
  const [left, top, width, height] = slot.area;
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
    zIndex: Z_INDEX[slot.kind],
  });
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
  if (layout.background.kind === "color" && layout.background.colorToken) {
    container.style.backgroundColor = ir.colors[layout.background.colorToken].value;
  }

  const fontBuild = buildFontFaces(ir, payload.assetsBaseUrl);
  const style = document.createElement("style");
  style.textContent = fontBuild.css;
  container.appendChild(style);

  const report: GuardReport = { overflows: [], fontFallbacks: [] };
  const measureText = options.measureText ?? ((element: HTMLElement) => element.scrollHeight);

  for (const slot of layout.slots) {
    const value = content.values[slot.id];
    if (slot.kind !== "logo" && (!value || value.kind !== slot.kind)) continue;

    const box = document.createElement("div");
    box.dataset.slotId = slot.id;
    applyBoxStyle(box, slot);

    if (slot.kind === "logo") {
      box.appendChild(
        createImage(joinUrl(payload.assetsBaseUrl, ir.assets["logo.primary"].path), "contain"),
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
      contentElement.textContent = value.text;
      Object.assign(contentElement.style, {
        all: "initial",
        boxSizing: "border-box",
        display: "block",
        fontFamily: textStyle.fontFamily,
        fontWeight: textStyle.fontWeight,
        fontStyle: textStyle.fontStyle,
        color: textStyle.color,
        lineHeight: textStyle.lineHeight,
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
        textRendering: "optimizeLegibility",
        fontFeatureSettings: '"kern" 1, "liga" 1',
        letterSpacing: "normal",
        textIndent: "0",
        textTransform: "none",
        wordSpacing: "normal",
      });
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
