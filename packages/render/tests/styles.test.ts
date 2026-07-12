import { expect, it } from "vitest";
import { chooseFontSize } from "../src/fit";
import { roleStyle } from "../src/styles";
import { fixtureIr } from "./fixtures";

it("estilo do role vem do IR", () => {
  expect(roleStyle(fixtureIr(), "heading", { "font.heading": "X, sans-serif" })).toEqual({
    fontFamily: "X, sans-serif",
    fontWeight: "700",
    fontStyle: "normal",
    color: "#1A4D8F",
    lineHeight: "1.1",
    minSizePx: 40,
    maxSizePx: 96,
  });
});

it("role inexistente lança erro PT-BR", () => {
  expect(() => roleStyle(fixtureIr(), "hero", {})).toThrowError(/desconhecido/);
});

it("chooseFontSize devolve o maior tamanho inteiro que cabe", () => {
  expect(chooseFontSize((size) => size * 3, 100, 10, 50)).toBe(33);
});

it("nada cabe: devolve o mínimo", () => {
  expect(chooseFontSize(() => 1000, 100, 10, 50)).toBe(10);
});

it("o máximo cabe: devolve o máximo com uma única medição", () => {
  let calls = 0;
  const size = chooseFontSize(
    (candidate) => {
      calls += 1;
      return candidate;
    },
    100,
    10,
    50,
  );
  expect(size).toBe(50);
  expect(calls).toBe(1);
});
