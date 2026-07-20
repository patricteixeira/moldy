import { expect, it } from "vitest"
import type { LayoutSpec } from "../api/types"
import { clearEditorDraft, loadEditorDraft, saveEditorDraft } from "./draftStorage"

const layout: LayoutSpec = {
  id: "folder-a4",
  profile: "document-a4",
  namePt: "Folder A4",
  canvas: { widthPx: 794, heightPx: 1123, safeAreaPx: 48 },
  background: { kind: "color", colorToken: "color.background" },
  slots: [
    {
      id: "title",
      kind: "text",
      area: [48, 48, 698, 160],
      fit: "shrink-within-role-range",
      required: true,
    },
    {
      id: "photo",
      kind: "image",
      area: [48, 240, 698, 480],
      fit: "fixed",
      required: false,
    },
  ],
}

it("salva e reabre o conteúdo do folder", () => {
  const sha256 = "a".repeat(64)
  const values = {
    title: { kind: "text" as const, text: "Um rascunho recuperável" },
    photo: {
      kind: "image" as const,
      path: `sha256/aa/aa/${sha256}`,
      sha256,
    },
  }

  expect(saveEditorDraft("brandrev_1", layout.id, values, {})).toBe(true)
  expect(loadEditorDraft("brandrev_1", layout)).toEqual({
    values,
    overrides: {},
    surface: null,
    addedSlots: [],
    addedLayers: [],
  })
})

it("preserva ajustes visuais por camada", () => {
  const values = { title: { kind: "text" as const, text: "Com autoria" } }
  const overrides = {
    title: {
      area: [72, 96, 620, 210] as [number, number, number, number],
      fontSizePx: 86,
      fontWeight: 700,
      opacity: 0.82,
    },
  }

  expect(saveEditorDraft("brandrev_visual", layout.id, values, overrides)).toBe(true)
  expect(loadEditorDraft("brandrev_visual", layout)).toEqual({
    values,
    overrides,
    surface: null,
    addedSlots: [],
    addedLayers: [],
  })
})

it("preserva a superfície procedural aplicada", () => {
  const surface = {
    kind: "paper-grain" as const,
    colorToken: "color.primary",
    opacity: 0.12,
    scalePx: 42,
    weightPx: 1.4,
    angleDeg: 0,
  }
  expect(saveEditorDraft("brandrev_surface", layout.id, {}, {}, surface)).toBe(true)
  expect(loadEditorDraft("brandrev_surface", layout)).toEqual({
    values: {},
    overrides: {},
    surface,
    addedSlots: [],
    addedLayers: [],
  })
})

it("preserva elementos adicionados como parte editável da peça", () => {
  const addedSlots = [
    {
      id: "user-text-1",
      kind: "text" as const,
      role: "body",
      area: [48, 420, 520, 180] as [number, number, number, number],
      fit: "shrink-within-role-range" as const,
      required: false,
    },
  ]
  const addedLayers = [
    {
      id: "user-shape-1",
      kind: "shape" as const,
      shape: "rectangle" as const,
      area: [48, 390, 180, 4] as [number, number, number, number],
      colorToken: "color.primary",
      opacity: 1,
      zIndex: 6,
    },
  ]
  const values = { "user-text-1": { kind: "text" as const, text: "Outro bloco" } }

  expect(
    saveEditorDraft(
      "brandrev_elements",
      layout.id,
      values,
      {},
      null,
      addedSlots,
      addedLayers,
    ),
  ).toBe(true)
  expect(loadEditorDraft("brandrev_elements", layout)).toEqual({
    values,
    overrides: {},
    surface: null,
    addedSlots,
    addedLayers,
  })
})

it("isola o rascunho por revisão e por peça", () => {
  saveEditorDraft(
    "brandrev_1",
    layout.id,
    { title: { kind: "text", text: "Primeira marca" } },
    {},
  )

  expect(loadEditorDraft("brandrev_2", layout)).toEqual({
    values: {},
    overrides: {},
    surface: null,
    addedSlots: [],
    addedLayers: [],
  })
  expect(loadEditorDraft("brandrev_1", { ...layout, id: "outro-folder" })).toEqual({
    values: {},
    overrides: {},
    surface: null,
    addedSlots: [],
    addedLayers: [],
  })
})

it("ignora dados corrompidos, slots desconhecidos e valores incompatíveis", () => {
  window.localStorage.setItem(
    "brand-runtime:editor-draft:v1:brandrev_1:folder-a4",
    JSON.stringify({
      version: 1,
      values: {
        title: { kind: "image", path: "javascript:alert(1)" },
        unknown: { kind: "text", text: "Não pertence a esta peça" },
      },
    }),
  )

  expect(loadEditorDraft("brandrev_1", layout)).toEqual({
    values: {},
    overrides: {},
    surface: null,
    addedSlots: [],
    addedLayers: [],
  })
})

it("remove o rascunho ao limpar a peça", () => {
  saveEditorDraft(
    "brandrev_1",
    layout.id,
    { title: { kind: "text", text: "Texto temporário" } },
    {},
  )

  expect(clearEditorDraft("brandrev_1", layout.id)).toBe(true)
  expect(loadEditorDraft("brandrev_1", layout)).toEqual({
    values: {},
    overrides: {},
    surface: null,
    addedSlots: [],
    addedLayers: [],
  })
})
