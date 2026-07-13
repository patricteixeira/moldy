import { expect, it } from "vitest"
import { fakeQuoteLayout, fakeStatementLayout } from "../test/fakeApi"
import { PLACEHOLDER_IMAGE, placeholderContent } from "./placeholder"

it("placeholder é determinístico, PT-BR e respeita maxChars", () => {
  const layout = fakeStatementLayout()
  const a = placeholderContent(layout, "brandrev_x")
  const b = placeholderContent(layout, "brandrev_x")
  expect(a).toEqual(b)
  expect(a.layoutId).toBe(layout.id)
  expect(a.values.headline).toEqual({ kind: "text", text: "Sua mensagem aqui" })
  expect(a.values).not.toHaveProperty("logo")

  layout.slots[0].maxChars = 4
  expect(placeholderContent(layout, "brandrev_x").values.headline).toEqual({
    kind: "text",
    text: "Sua ",
  })
})

it("slots de imagem usam o data URI placeholder", () => {
  const content = placeholderContent(fakeQuoteLayout(), "brandrev_x")
  const photo = content.values.photo
  expect(photo.kind).toBe("image")
  expect((photo as { path: string }).path).toMatch(/^data:image\/png;base64,/)
  expect((photo as { path: string }).path).toBe(PLACEHOLDER_IMAGE)
})
