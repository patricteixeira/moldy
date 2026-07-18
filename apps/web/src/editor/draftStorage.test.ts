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

  expect(saveEditorDraft("brandrev_1", layout.id, values)).toBe(true)
  expect(loadEditorDraft("brandrev_1", layout)).toEqual(values)
})

it("isola o rascunho por revisão e por peça", () => {
  saveEditorDraft("brandrev_1", layout.id, {
    title: { kind: "text", text: "Primeira marca" },
  })

  expect(loadEditorDraft("brandrev_2", layout)).toEqual({})
  expect(loadEditorDraft("brandrev_1", { ...layout, id: "outro-folder" })).toEqual({})
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

  expect(loadEditorDraft("brandrev_1", layout)).toEqual({})
})

it("remove o rascunho ao limpar a peça", () => {
  saveEditorDraft("brandrev_1", layout.id, {
    title: { kind: "text", text: "Texto temporário" },
  })

  expect(clearEditorDraft("brandrev_1", layout.id)).toBe(true)
  expect(loadEditorDraft("brandrev_1", layout)).toEqual({})
})
