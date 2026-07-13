import { beforeEach, expect, it, vi } from "vitest";
import { renderDocumentStable } from "../src/stable";
import { fixturePayload } from "./fixtures";

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  Object.defineProperty(HTMLImageElement.prototype, "decode", {
    configurable: true,
    value: vi.fn(async () => undefined),
  });
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: undefined,
  });
  vi.unstubAllGlobals();
});

it("carrega somente a face local usada com o texto do slot", async () => {
  const load = vi.fn(async () => [{} as FontFace]);
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load, ready: Promise.resolve() },
  });
  const report = await renderDocumentStable(container, fixturePayload());
  expect(load).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledWith('700 16px "br-font-heading"', "Olá, marca");
  expect(report.fontFallbacks).toEqual([]);
});

it("face local não carregada registra load-failed por slot", async () => {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load: vi.fn(async () => []), ready: Promise.resolve() },
  });
  const report = await renderDocumentStable(container, fixturePayload());
  expect(report.fontFallbacks).toEqual([
    {
      slotId: "headline",
      token: "font.heading",
      family: "Fixture Sans",
      reason: "load-failed",
    },
  ]);
});

it("aguarda exatamente dois frames depois das imagens", async () => {
  const requestFrame = vi.fn((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  await renderDocumentStable(container, fixturePayload());
  expect(HTMLImageElement.prototype.decode).toHaveBeenCalledTimes(1);
  expect(requestFrame).toHaveBeenCalledTimes(2);
});

it("render antigo abortado não sobrescreve update estabilizado mais novo", async () => {
  let releaseOld!: (faces: FontFace[]) => void;
  const oldLoad = new Promise<FontFace[]>((resolve) => {
    releaseOld = resolve;
  });
  const load = vi
    .fn<() => Promise<FontFace[]>>()
    .mockImplementationOnce(() => oldLoad)
    .mockResolvedValueOnce([{} as FontFace]);
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load, ready: Promise.resolve() },
  });

  const oldPayload = fixturePayload();
  oldPayload.contentSpec.values.headline = { kind: "text", text: "Versão antiga" };
  const newPayload = fixturePayload();
  newPayload.contentSpec.values.headline = { kind: "text", text: "Versão nova" };
  const oldController = new AbortController();
  const oldRender = renderDocumentStable(container, oldPayload, {
    signal: oldController.signal,
  });
  const newRender = renderDocumentStable(container, newPayload);
  await newRender;
  oldController.abort();
  releaseOld([{} as FontFace]);
  await expect(oldRender).rejects.toMatchObject({ name: "AbortError" });
  expect(container.querySelector("[data-slot-content]")?.textContent).toBe("Versão nova");
});
