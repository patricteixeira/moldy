import { expect, it } from "vitest"
import { fakeEditorialLayout, fakeQuoteLayout, fakeStatementLayout } from "../test/fakeApi"
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

it("arquétipo editorial nasce com texto autoral e destaque válido", () => {
  const content = placeholderContent(fakeEditorialLayout(), "brandrev_x")

  expect(content.values).toMatchObject({
    kicker: { kind: "text", text: "PRINCÍPIO 01" },
    headline: {
      kind: "text",
      text: "O OFÍCIO PEDE INTENÇÃO.",
      emphasis: "INTENÇÃO",
    },
    index: { kind: "text", text: "01" },
    signature: { kind: "text", text: "@sua-marca" },
  })
})

it("corte editorial remove destaque quando a palavra inteira não cabe", () => {
  const layout = fakeEditorialLayout()
  const headline = layout.slots.find((slot) => slot.id === "headline")
  if (!headline) throw new Error("fixture sem headline")
  headline.maxChars = 12

  expect(placeholderContent(layout, "brandrev_x").values.headline).toEqual({
    kind: "text",
    text: "O OFÍCIO PED",
  })
})
