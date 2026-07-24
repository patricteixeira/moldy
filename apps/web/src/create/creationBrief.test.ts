import { expect, it } from "vitest"
import { fakeQuoteLayout, fakeStatementLayout } from "../test/fakeApi"
import {
  creationBriefFromSearch,
  creationBriefSearch,
  creationTarget,
  layoutsForCreationBrief,
  selectLayoutsForCreationBrief,
  type CreationBrief,
} from "./creationBrief"

const brief: CreationBrief = {
  objective: "inform",
  pieceType: "carousel",
  channel: "other",
  customChannel: "Bluesky",
  profile: "post-4x5",
  action: "save",
  visualPreference: "no-image",
}

it("serializa o briefing na rota sem misturá-lo à identidade da marca", () => {
  const search = creationBriefSearch(brief)
  expect(creationBriefFromSearch(new URLSearchParams(search))).toEqual(brief)
  expect(creationTarget("brand rev", brief)).toBe(
    `/marcas/brand%20rev/carrossel?${search}`,
  )
})

it("filtra modelos pelo formato escolhido", () => {
  const portrait = fakeStatementLayout()
  portrait.profile = "post-4x5"
  const square = fakeQuoteLayout()
  square.profile = "post-1x1"

  expect(layoutsForCreationBrief([portrait, square], brief)).toEqual([portrait])
})

it("preserva os modelos sociais quando o formato pedido ainda não existe", () => {
  const square = fakeStatementLayout()
  const document = fakeQuoteLayout()
  document.profile = "doc-a4"

  expect(selectLayoutsForCreationBrief([square, document], brief)).toEqual({
    layouts: [square],
    match: "fallback",
  })
})

it("não apresenta documento como alternativa a uma peça social", () => {
  const document = fakeQuoteLayout()
  document.profile = "doc-a4"

  expect(selectLayoutsForCreationBrief([document], brief)).toEqual({
    layouts: [],
    match: "unavailable",
  })
})
