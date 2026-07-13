import { internalFamily } from "./fonts";
import { renderDocument } from "./render";
import type { GuardReport, Payload } from "./types";

export interface StableRenderOptions {
  signal?: AbortSignal;
}

function abortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("Render cancelado.", "AbortError");
  }
  const error = new Error("Render cancelado.");
  error.name = "AbortError";
  return error;
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function usedFileFonts(payload: Payload): Map<string, string> {
  const texts = new Map<string, string[]>();
  for (const slot of payload.layoutSpec.slots) {
    if (slot.kind !== "text" || !slot.role) continue;
    const value = payload.contentSpec.values[slot.id];
    if (value?.kind !== "text") continue;
    const token = payload.brandIr.roles[slot.role].font;
    if (payload.brandIr.fonts[token].source !== "file") continue;
    const samples = texts.get(token) ?? [];
    samples.push(value.text);
    texts.set(token, samples);
  }
  return new Map(
    [...texts.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([token, samples]) => [token, samples.join("\n")]),
  );
}

async function loadUsedFonts(
  payload: Payload,
  signal?: AbortSignal,
): Promise<Map<string, boolean>> {
  const statuses = new Map<string, boolean>();
  const fontSet = document.fonts;
  for (const [token, sample] of usedFileFonts(payload)) {
    assertActive(signal);
    const font = payload.brandIr.fonts[token];
    const italic = font.style === "italic" ? "italic " : "";
    const spec = `${italic}${font.weight} 16px "${internalFamily(token)}"`;
    if (!fontSet || typeof fontSet.load !== "function") {
      statuses.set(token, true);
      continue;
    }
    try {
      const loaded = await fontSet.load(spec, sample);
      assertActive(signal);
      statuses.set(token, loaded.length > 0);
    } catch {
      assertActive(signal);
      statuses.set(token, false);
    }
  }
  if (fontSet?.ready) {
    assertActive(signal);
    await fontSet.ready;
    assertActive(signal);
  }
  return statuses;
}

async function decodeImages(container: HTMLElement, signal?: AbortSignal): Promise<void> {
  const images = [...container.querySelectorAll("img")];
  for (const image of images) {
    assertActive(signal);
    const slotId = image.closest<HTMLElement>("[data-slot-id]")?.dataset.slotId ?? "desconhecido";
    try {
      if (typeof image.decode === "function") {
        await image.decode();
      } else if (!image.complete) {
        await new Promise<void>((resolve, reject) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => reject(new Error("falha de carregamento")), {
            once: true,
          });
        });
      } else if (image.naturalWidth === 0) {
        throw new Error("imagem sem dimensões");
      }
      assertActive(signal);
    } catch (error) {
      assertActive(signal);
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Não foi possível decodificar a imagem do slot «${slotId}»: ${detail}`);
    }
  }
}

async function frame(signal?: AbortSignal): Promise<void> {
  assertActive(signal);
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
  assertActive(signal);
}

export async function renderDocumentStable(
  container: HTMLElement,
  payload: Payload,
  options: StableRenderOptions = {},
): Promise<GuardReport> {
  const { signal } = options;
  assertActive(signal);
  renderDocument(container, payload);
  assertActive(signal);
  const statuses = await loadUsedFonts(payload, signal);
  assertActive(signal);
  const report = renderDocument(container, payload, { fontLoadStatus: statuses });
  assertActive(signal);
  await decodeImages(container, signal);
  await frame(signal);
  await frame(signal);
  return report;
}
