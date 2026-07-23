import { afterEach, describe, expect, it } from "vitest"
import {
  buildSynapsisFontCss,
  installSynapsisFontFaces,
} from "./brandTypography"

afterEach(() => {
  installSynapsisFontFaces()
})

describe("tipografia da instância oficial", () => {
  it("não ativa Synapsis na distribuição open source", () => {
    expect(buildSynapsisFontCss()).toBe("")

    installSynapsisFontFaces()

    expect(document.head.querySelector("#molda-official-synapsis")).toBeNull()
    expect(document.head.querySelector("[data-synapsis-preload]")).toBeNull()
  })

  it("carrega os cinco WOFF2 somente pela URL do deploy oficial", () => {
    const css = buildSynapsisFontCss("https://assets.molda.example/fonts/")

    expect(css.match(/@font-face/g)).toHaveLength(5)
    expect(css).toContain(
      'url("https://assets.molda.example/fonts/synapsis-400.woff2")',
    )
    expect(css).toContain(
      'url("https://assets.molda.example/fonts/synapsis-900.woff2")',
    )
    expect(css).not.toContain("local(")

    installSynapsisFontFaces("https://assets.molda.example/fonts/")

    const style = document.head.querySelector("#molda-official-synapsis")
    const preload = document.head.querySelector<HTMLLinkElement>(
      'link[data-synapsis-preload="900"]',
    )
    expect(style?.textContent).toBe(css)
    expect(preload?.href).toBe(
      "https://assets.molda.example/fonts/synapsis-900.woff2",
    )
  })
})
