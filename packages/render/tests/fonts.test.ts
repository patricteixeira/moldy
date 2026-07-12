import { expect, it } from "vitest";
import {
  buildFontFaces,
  FALLBACK_FAMILY,
  fontLoadSpecs,
  internalFamily,
  joinUrl,
} from "../src/fonts";
import { fixtureIr, SHA } from "./fixtures";

it("internalFamily deriva o nome interno do token", () => {
  expect(internalFamily("font.heading")).toBe("br-font-heading");
});

it("joinUrl normaliza barras e escapa cada segmento", () => {
  expect(joinUrl("http://x/assets/", "a b/c.png")).toBe("http://x/assets/a%20b/c.png");
  expect(joinUrl("http://x/assets", "a.png")).toBe("http://x/assets/a.png");
  expect(joinUrl("http://x/assets", "a#b?/c d.png")).toBe("http://x/assets/a%23b%3F/c%20d.png");
});

it("joinUrl usa verbatim apenas para data:image/png;base64", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
  expect(joinUrl("http://x/assets", png)).toBe(png);
  expect(() => joinUrl("http://x/assets", "data:image/png;base64,AAA=")).toThrow(/externa/i);
  expect(() => joinUrl("http://x/assets", "https://exemplo/img.png")).toThrow(/externa/i);
  expect(() => joinUrl("http://x/assets", "../segredo")).toThrow(/inválido/i);
  expect(() => joinUrl("http://x/assets", "a//b.png")).toThrow(/inválido/i);
});

it("detecta colisão entre nomes internos de fontes", () => {
  const ir = fixtureIr();
  ir.fonts["font/heading"] = { ...ir.fonts["font.heading"] };
  expect(() => buildFontFaces(ir, "/pkg")).toThrow(/mesma família interna/i);
});

it("preserva token próprio __proto__ sem mutar o dicionário de famílias", () => {
  const ir = fixtureIr();
  Object.defineProperty(ir.fonts, "__proto__", {
    value: { ...ir.fonts["font.heading"] },
    enumerable: true,
    configurable: true,
  });
  ir.roles.heading.font = "__proto__";

  const output = buildFontFaces(ir, "/pkg");

  expect(Object.getPrototypeOf(output.families)).toBeNull();
  expect(Object.hasOwn(output.families, "__proto__")).toBe(true);
  expect(Reflect.get(output.families, "__proto__")).toContain("br-__proto__");
});

it("fonte com arquivo vira @font-face local por sha256", () => {
  const output = buildFontFaces(fixtureIr(), "http://x/assets");
  expect(output.css).toContain('font-family: "br-font-heading"');
  expect(output.css).toContain(`src: url("http://x/assets/fonts/${SHA}")`);
  expect(output.css).toContain("font-weight: 700");
  expect(output.families["font.heading"]).toBe(`"br-font-heading", ${FALLBACK_FAMILY}`);
});

it("referenced-only não gera @font-face, usa genérica e registra fallback", () => {
  const output = buildFontFaces(fixtureIr(), "http://x/assets");
  expect(output.css).not.toContain("br-font-body");
  expect(output.families["font.body"]).toBe(FALLBACK_FAMILY);
  expect(output.fallbacks).toEqual([
    { token: "font.body", family: "Helvetica", reason: "referenced-only" },
  ]);
});

it("fontLoadSpecs cobre apenas fontes com arquivo", () => {
  expect(fontLoadSpecs(fixtureIr())).toEqual(['700 16px "br-font-heading"']);
});
