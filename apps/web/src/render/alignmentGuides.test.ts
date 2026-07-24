import { expect, it } from "vitest"
import type { ContentSpec } from "../api/types"
import { FAKE_IR, fakeEditorialLayout } from "../test/fakeApi"
import {
  alignmentGuideLabel,
  buildAlignmentTargets,
  snapEditorArea,
  type AlignmentTarget,
} from "./alignmentGuides"

const layerTarget: AlignmentTarget = {
  id: "support",
  label: "Texto de apoio",
  kind: "layer",
  area: [100, 200, 300, 100],
}

it("monta referências da peça, área segura e elementos visíveis", () => {
  const layout = fakeEditorialLayout()
  const content: ContentSpec = {
    layoutId: layout.id,
    brandRevisionId: FAKE_IR.revision.id,
    values: {},
    overrides: {
      "accent-rule": { hidden: true },
    },
  }

  const targets = buildAlignmentTargets(layout, content, "headline")

  expect(targets).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "canvas", kind: "canvas" }),
      expect.objectContaining({ id: "safe-area", kind: "safe-area" }),
      expect.objectContaining({ id: "brand-mark", kind: "layer" }),
    ]),
  )
  expect(targets).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "headline" }),
      expect.objectContaining({ id: "accent-rule" }),
      expect.objectContaining({ id: "diagonal-field" }),
      expect.objectContaining({ id: "frame-left" }),
    ]),
  )
})

it("encaixa bordas horizontais e verticais em outro elemento", () => {
  const result = snapEditorArea([96, 204, 100, 40], "move", [layerTarget], 5)

  expect(result.area).toEqual([100, 200, 100, 40])
  expect(result.guides).toEqual([
    expect.objectContaining({ axis: "x", position: 100, targetId: "support" }),
    expect.objectContaining({ axis: "y", position: 200, targetId: "support" }),
  ])
  expect(result.guides.map(alignmentGuideLabel)).toEqual([
    "Esquerda · Texto de apoio",
    "Topo · Texto de apoio",
  ])
})

it("encaixa o centro do elemento no centro da peça", () => {
  const canvas: AlignmentTarget = {
    id: "canvas",
    label: "Peça",
    kind: "canvas",
    area: [0, 0, 1080, 1080],
  }

  const result = snapEditorArea([446, 400, 200, 100], "move", [canvas], 7)

  expect(result.area).toEqual([440, 400, 200, 100])
  expect(result.guides).toEqual([
    expect.objectContaining({ axis: "x", movingAnchor: "center", position: 540 }),
  ])
  expect(alignmentGuideLabel(result.guides[0])).toBe("Centro · peça")
})

it("encaixa largura e altura ao redimensionar pelo canto", () => {
  const target: AlignmentTarget = {
    id: "photo",
    label: "Imagem",
    kind: "layer",
    area: [400, 300, 100, 100],
  }

  const result = snapEditorArea(
    [100, 100, 294, 196],
    "resize",
    [target],
    6,
    { x: "end", y: "end" },
  )

  expect(result.area).toEqual([100, 100, 300, 200])
  expect(result.guides).toEqual([
    expect.objectContaining({ axis: "x", movingAnchor: "end", targetAnchor: "start" }),
    expect.objectContaining({ axis: "y", movingAnchor: "end", targetAnchor: "start" }),
  ])
})

it("encaixa o lado inicial sem deslocar o lado oposto", () => {
  const target: AlignmentTarget = {
    id: "photo",
    label: "Imagem",
    kind: "layer",
    area: [100, 100, 100, 100],
  }

  const result = snapEditorArea(
    [204, 204, 296, 196],
    "resize",
    [target],
    6,
    { x: "start", y: "start" },
  )

  expect(result.area).toEqual([200, 200, 300, 200])
  expect(result.guides).toEqual([
    expect.objectContaining({ axis: "x", movingAnchor: "start", targetAnchor: "end" }),
    expect.objectContaining({ axis: "y", movingAnchor: "start", targetAnchor: "end" }),
  ])
})

it("não altera a área fora da margem de encaixe", () => {
  const result = snapEditorArea([88, 214, 100, 40], "move", [layerTarget], 5)

  expect(result.area).toEqual([88, 214, 100, 40])
  expect(result.guides).toEqual([])
})

it("prefere a referência de um elemento quando ela coincide com a peça", () => {
  const canvas: AlignmentTarget = {
    id: "canvas",
    label: "Peça",
    kind: "canvas",
    area: [0, 0, 1080, 1080],
  }
  const layer: AlignmentTarget = {
    id: "frame-left",
    label: "Moldura esquerda",
    kind: "layer",
    area: [0, 80, 100, 800],
  }

  const result = snapEditorArea([3, 300, 100, 100], "move", [canvas, layer], 5)

  expect(result.area[0]).toBe(0)
  expect(result.guides[0]).toMatchObject({ axis: "x", targetId: "frame-left" })
})
