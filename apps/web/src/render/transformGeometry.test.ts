import { expect, it } from "vitest"
import {
  normalizeRotation,
  resizeAnchors,
  resizeAreaFromHandle,
} from "./transformGeometry"

it("redimensiona por qualquer lado mantendo o lado oposto ancorado", () => {
  expect(resizeAreaFromHandle([100, 100, 200, 100], "nw", -20, -10, 0)).toEqual([
    80,
    90,
    220,
    110,
  ])
  expect(resizeAreaFromHandle([100, 100, 200, 100], "w", 50, 0, 0)).toEqual([
    150,
    100,
    150,
    100,
  ])
  expect(resizeAreaFromHandle([100, 100, 200, 100], "s", 80, 40, 0)).toEqual([
    100,
    100,
    200,
    140,
  ])
})

it("interpreta o movimento nos eixos locais de uma caixa rotacionada", () => {
  const area = resizeAreaFromHandle([100, 100, 200, 100], "e", 0, 20, 90)

  expect(area[0]).toBeCloseTo(90)
  expect(area[1]).toBeCloseTo(110)
  expect(area[2]).toBeCloseTo(220)
  expect(area[3]).toBeCloseTo(100)
})

it("mantém dimensões positivas e normaliza a rotação persistida", () => {
  expect(resizeAreaFromHandle([100, 100, 20, 20], "nw", 100, 100, 0)).toEqual([
    112,
    112,
    8,
    8,
  ])
  expect(normalizeRotation(190)).toBe(-170)
  expect(normalizeRotation(-540)).toBe(-180)
  expect(normalizeRotation(360)).toBe(0)
})

it("expõe as bordas móveis de cada alça para o encaixe", () => {
  expect(resizeAnchors("nw")).toEqual({ x: "start", y: "start" })
  expect(resizeAnchors("e")).toEqual({ x: "end" })
  expect(resizeAnchors("s")).toEqual({ y: "end" })
})
