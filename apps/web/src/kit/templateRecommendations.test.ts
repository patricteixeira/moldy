import { expect, it } from "vitest"
import { fakeQuoteLayout, fakeStatementLayout } from "../test/fakeApi"
import {
  recommendationIsBrandLed,
  recommendedTemplateGroups,
  recommendedTemplateLayouts,
} from "./templateRecommendations"

it("respeita a ordem explicável enviada pelo motor", () => {
  const first = fakeStatementLayout()
  first.recommendationRank = 2
  first.recommendationBasis = "brand"
  const second = fakeQuoteLayout()
  second.recommendationRank = 1
  second.recommendationBasis = "brand"

  expect(recommendedTemplateLayouts([first, second]).map((layout) => layout.id)).toEqual([
    second.id,
    first.id,
  ])
  expect(recommendationIsBrandLed([first, second])).toBe(true)
})

it("mantém uma amostra pequena e honesta quando ainda não há ranking", () => {
  const layouts = Array.from({ length: 12 }, (_, index) => ({
    ...fakeStatementLayout(),
    id: `layout-${index}`,
  }))

  expect(recommendedTemplateLayouts(layouts)).toHaveLength(8)
  expect(recommendationIsBrandLed(layouts)).toBe(false)
})

it("separa três estruturas distintas para capa, corpo e fechamento", () => {
  const layouts = [
    "fashion-cover",
    "product-hero",
    "brutalist-manifesto",
    "fashion-spread",
    "product-benefit",
    "evidence-comparison",
    "product-launch",
    "geometric-signal",
    "kinetic-pulse",
  ].map((id, index) => {
    const layout = fakeStatementLayout()
    layout.id = `${id}-post-4x5`
    layout.namePt = id
    layout.recommendationRank = index + 1
    if (/spread|benefit|comparison/.test(id)) {
      layout.slots.push({
        id: "body",
        kind: "text",
        required: true,
        area: [48, 760, 984, 160],
        fit: "shrink-within-role-range",
        role: "body",
        maxChars: 320,
      })
    }
    if (/launch|signal|pulse/.test(id)) {
      layout.slots.push({
        id: "cta",
        kind: "text",
        required: false,
        area: [48, 900, 360, 72],
        fit: "shrink-within-role-range",
        role: "caption",
        maxChars: 40,
      })
    }
    return layout
  })

  const groups = recommendedTemplateGroups(layouts)
  expect(groups.map((group) => [group.purpose, group.layouts.length])).toEqual([
    ["cover", 3],
    ["content", 3],
    ["closing", 3],
  ])
  expect(groups[0].layouts.every((layout) => /cover|hero|manifesto/.test(layout.id))).toBe(
    true,
  )
  expect(groups[1].layouts.every((layout) => /spread|benefit|comparison/.test(layout.id))).toBe(
    true,
  )
  expect(groups[2].layouts.every((layout) => /launch|signal|pulse/.test(layout.id))).toBe(
    true,
  )
  expect(new Set(groups.flatMap((group) => group.layouts.map((layout) => layout.id))).size).toBe(
    9,
  )
})

it("não recomenda a alternativa cromática como se fosse outra estrutura", () => {
  const principal = fakeStatementLayout()
  principal.id = "fashion-cover-post-4x5"
  principal.recommendationRank = 1
  const alternative = fakeStatementLayout()
  alternative.id = "fashion-cover-post-4x5-alternative"
  alternative.recommendationRank = 2

  const ids = recommendedTemplateGroups([alternative, principal], 3).flatMap((group) =>
    group.layouts.map((layout) => layout.id),
  )
  expect(ids).toEqual([principal.id])
})

it("usa a preferência de imagem para ordenar estruturas da mesma função", () => {
  const withImage = fakeStatementLayout()
  withImage.id = "fashion-spread-with-image"
  withImage.namePt = "Corpo com imagem"
  withImage.slots.push({
    id: "body",
    kind: "text",
    required: true,
    area: [48, 760, 984, 160],
    fit: "shrink-within-role-range",
    role: "body",
    maxChars: 320,
  })
  withImage.slots.push({
    id: "photo",
    kind: "image",
    required: true,
    area: [48, 120, 984, 560],
    fit: "fixed",
  })
  const textOnly = fakeStatementLayout()
  textOnly.id = "fashion-spread-text-only"
  textOnly.namePt = "Corpo tipográfico"
  textOnly.slots.push({
    id: "body",
    kind: "text",
    required: true,
    area: [48, 760, 984, 160],
    fit: "shrink-within-role-range",
    role: "body",
    maxChars: 320,
  })

  const content = recommendedTemplateGroups([withImage, textOnly], 2, {
    objective: "inform",
    visualPreference: "no-image",
  }).find((group) => group.purpose === "content")

  expect(content?.layouts[0].id).toBe(textOnly.id)
})
