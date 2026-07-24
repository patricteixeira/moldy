import { expect, it } from "vitest"
import type { LayoutSpec } from "../api/types"
import { clearEditorDraft, loadEditorDraft, saveEditorDraft } from "./draftStorage"

const v5Defaults = { backgroundColorToken: null, assetBindings: {} }

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
    ...v5Defaults,
  })
})

it("preserva ajustes visuais por camada", () => {
  const values = { title: { kind: "text" as const, text: "Com autoria" } }
  const overrides = {
    title: {
      area: [72, 96, 620, 210] as [number, number, number, number],
      rotationDeg: 27,
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
    ...v5Defaults,
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
    ...v5Defaults,
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
    ...v5Defaults,
  })
})

it("preserva fundo global e versão de logo por slot no rascunho v5", () => {
  const layoutWithLogo: LayoutSpec = {
    ...layout,
    slots: [
      ...layout.slots,
      {
        id: "logo",
        kind: "logo",
        area: [640, 920, 96, 96],
        fit: "fixed",
        required: false,
      },
    ],
    lockedLayers: [
      {
        id: "brand-mark",
        kind: "asset",
        assetToken: "logo.onLight",
        area: [48, 920, 96, 96],
        fit: "contain",
        opacity: 1,
        zIndex: 3,
      },
    ],
  }

  expect(
    saveEditorDraft(
      "brandrev_v5",
      layoutWithLogo.id,
      { title: { kind: "text", text: "Fundo e marca escolhidos" } },
      {},
      null,
      [],
      [],
      "color.primary",
      { logo: "logo.onDark", "brand-mark": "logo.onLight" },
    ),
  ).toBe(true)
  expect(loadEditorDraft("brandrev_v5", layoutWithLogo)).toEqual({
    values: { title: { kind: "text", text: "Fundo e marca escolhidos" } },
    overrides: {},
    surface: null,
    addedSlots: [],
    addedLayers: [],
    backgroundColorToken: "color.primary",
    assetBindings: { logo: "logo.onDark", "brand-mark": "logo.onLight" },
  })
})

it("migra rascunho v4 sem inventar fundo nem binding de asset", () => {
  window.localStorage.setItem(
    "brand-runtime:editor-draft:v1:brandrev_v4:folder-a4",
    JSON.stringify({
      version: 4,
      values: { title: { kind: "text", text: "Rascunho anterior" } },
      overrides: {},
      surface: null,
      addedSlots: [],
      addedLayers: [],
    }),
  )

  expect(loadEditorDraft("brandrev_v4", layout)).toEqual({
    values: { title: { kind: "text", text: "Rascunho anterior" } },
    overrides: {},
    surface: null,
    addedSlots: [],
    addedLayers: [],
    ...v5Defaults,
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
    ...v5Defaults,
  })
  expect(loadEditorDraft("brandrev_1", { ...layout, id: "outro-folder" })).toEqual({
    values: {},
    overrides: {},
    surface: null,
    addedSlots: [],
    addedLayers: [],
    ...v5Defaults,
  })
})

it("isola slides diferentes que usam o mesmo modelo", () => {
  saveEditorDraft(
    "brandrev_carousel",
    layout.id,
    { title: { kind: "text", text: "Primeiro slide" } },
    {},
    null,
    [],
    [],
    null,
    {},
    "carousel_x:slide_1",
  )
  saveEditorDraft(
    "brandrev_carousel",
    layout.id,
    { title: { kind: "text", text: "Segundo slide" } },
    {},
    null,
    [],
    [],
    null,
    {},
    "carousel_x:slide_2",
  )

  expect(loadEditorDraft("brandrev_carousel", layout, "carousel_x:slide_1").values.title).toEqual({
    kind: "text",
    text: "Primeiro slide",
  })
  expect(loadEditorDraft("brandrev_carousel", layout, "carousel_x:slide_2").values.title).toEqual({
    kind: "text",
    text: "Segundo slide",
  })
  expect(loadEditorDraft("brandrev_carousel", layout).values).toEqual({})
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
    ...v5Defaults,
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
    ...v5Defaults,
  })
})
