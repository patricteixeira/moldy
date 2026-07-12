import { beforeEach, expect, it, vi } from "vitest";
import { bootstrapRenderPage } from "../src/page";
import { renderDocumentStable } from "../src/stable";
import { fixturePayload } from "./fixtures";

beforeEach(() => {
  document.body.innerHTML = '<div id="canvas"></div>';
  delete window.__PAYLOAD__;
  delete window.__RENDER_DONE__;
  delete window.__GUARD_REPORT__;
  delete window.__RENDER_ERROR__;
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(HTMLImageElement.prototype, "decode", {
    configurable: true,
    value: vi.fn(async () => undefined),
  });
});

it("publica __GUARD_REPORT__ e só então __RENDER_DONE__ com payload válido", async () => {
  window.__PAYLOAD__ = fixturePayload();
  await bootstrapRenderPage();
  expect(window.__RENDER_ERROR__).toBeUndefined();
  expect(window.__RENDER_DONE__).toBe(true);
  expect(window.__GUARD_REPORT__).toEqual({ overflows: [], fontFallbacks: [] });
  const canvas = document.getElementById("canvas")!;
  expect(canvas.style.width).toBe("1080px");
  expect(canvas.style.height).toBe("1080px");
});

it("payload ausente vira __RENDER_ERROR__ e nunca __RENDER_DONE__", async () => {
  await bootstrapRenderPage();
  expect(window.__RENDER_DONE__).toBeUndefined();
  expect(window.__RENDER_ERROR__).toContain("__PAYLOAD__");
});

it("payload inválido vira __RENDER_ERROR__ com a mensagem do parse", async () => {
  window.__PAYLOAD__ = { brandIr: {} };
  await bootstrapRenderPage();
  expect(window.__RENDER_DONE__).toBeUndefined();
  expect(window.__RENDER_ERROR__).toContain("Payload inválido");
});

it("sem #canvas vira __RENDER_ERROR__", async () => {
  document.body.innerHTML = "";
  window.__PAYLOAD__ = fixturePayload();
  await bootstrapRenderPage();
  expect(window.__RENDER_DONE__).toBeUndefined();
  expect(window.__RENDER_ERROR__).toContain("#canvas");
});

it("DONE espera o decode das imagens da segunda passada", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(HTMLImageElement.prototype.decode).mockReturnValue(pending);
  window.__PAYLOAD__ = fixturePayload();
  const boot = bootstrapRenderPage();
  await Promise.resolve();
  expect(window.__RENDER_DONE__).toBeUndefined();
  release();
  await boot;
  expect(window.__RENDER_DONE__).toBe(true);
});

it("falha de decode cita o slot e não publica DONE", async () => {
  vi.mocked(HTMLImageElement.prototype.decode).mockRejectedValue(new Error("arquivo corrompido"));
  window.__PAYLOAD__ = fixturePayload();
  await bootstrapRenderPage();
  expect(window.__RENDER_DONE__).toBeUndefined();
  expect(window.__RENDER_ERROR__).toMatch(/slot «logo».*arquivo corrompido/i);
});

it("render estável abortado não executa a segunda passada", async () => {
  let release!: (faces: FontFace[]) => void;
  const loading = new Promise<FontFace[]>((resolve) => {
    release = resolve;
  });
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load: vi.fn(() => loading), ready: Promise.resolve() },
  });
  const controller = new AbortController();
  const canvas = document.getElementById("canvas")!;
  const pending = renderDocumentStable(canvas, fixturePayload(), { signal: controller.signal });
  controller.abort();
  release([]);
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(HTMLImageElement.prototype.decode).not.toHaveBeenCalled();
});
