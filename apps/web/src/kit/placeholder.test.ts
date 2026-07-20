import { expect, it } from "vitest"
import { fakeEditorialLayout, fakeQuoteLayout, fakeStatementLayout } from "../test/fakeApi"
import { PLACEHOLDER_IMAGE, placeholderContent } from "./placeholder"

it("placeholder é determinístico, PT-BR e respeita maxChars", () => {
  const layout = fakeStatementLayout()
  const a = placeholderContent(layout, "brandrev_x")
  const b = placeholderContent(layout, "brandrev_x")
  expect(a).toEqual(b)
  expect(a.layoutId).toBe(layout.id)
  expect(a.values.headline).toEqual({ kind: "text", text: "Sua marca em movimento." })
  expect(a.values).not.toHaveProperty("logo")
  expect(a.addedSlots?.map((slot) => slot.id)).toEqual([
    "user-kicker-1",
    "user-signature-1",
    "user-support-1",
  ])
  expect(a.addedLayers?.map((layer) => layer.id)).toEqual(["user-rule-1"])

  layout.slots[0].maxChars = 4
  expect(placeholderContent(layout, "brandrev_x").values.headline).toEqual({
    kind: "text",
    text: "Sua…",
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
    kicker: { kind: "text", text: "AUTORIA NÃO É UM EFEITO." },
    headline: {
      kind: "text",
      text: "É A COERÊNCIA ENTRE INTENÇÃO E FORMA.",
      emphasis: "INTENÇÃO E FORMA",
    },
    index: { kind: "text", text: "06" },
    signature: { kind: "text", text: "@suamarca" },
  })
})

it("corte editorial remove destaque quando a palavra inteira não cabe", () => {
  const layout = fakeEditorialLayout()
  const headline = layout.slots.find((slot) => slot.id === "headline")
  if (!headline) throw new Error("fixture sem headline")
  headline.maxChars = 12

  expect(placeholderContent(layout, "brandrev_x").values.headline).toEqual({
    kind: "text",
    text: "É A COERÊNC…",
  })
})
