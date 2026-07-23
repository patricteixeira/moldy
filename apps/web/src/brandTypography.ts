type SynapsisFace = {
  weight: 400 | 500 | 600 | 700 | 900
}

const SYNAPSIS_FACES: readonly SynapsisFace[] = [
  { weight: 400 },
  { weight: 500 },
  { weight: 600 },
  { weight: 700 },
  { weight: 900 },
]

const OFFICIAL_FONT_STYLE_ID = "molda-official-synapsis"
const PRELOAD_WEIGHTS = [900] as const

function normalizeBaseUrl(baseUrl: string | undefined): string | undefined {
  const normalized = baseUrl?.trim().replace(/\/+$/, "")
  return normalized === "" ? undefined : normalized
}

function cssString(value: string): string {
  return JSON.stringify(value).replaceAll("<", "\\3c ")
}

function sourceForFace(face: SynapsisFace, baseUrl: string): string {
  const fontUrl = `${baseUrl}/synapsis-${face.weight}.woff2`
  return `url(${cssString(fontUrl)}) format("woff2")`
}

export function buildSynapsisFontCss(baseUrl?: string): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  if (normalizedBaseUrl === undefined) return ""

  const faces = SYNAPSIS_FACES.map(
    (face) => `@font-face {
  font-family: "Synapsis";
  src:
    ${sourceForFace(face, normalizedBaseUrl)};
  font-display: swap;
  font-style: normal;
  font-weight: ${face.weight};
}`,
  ).join("\n\n")

  return `${faces}

:root {
  --m-sans: "Synapsis", "Archivo Variable", Arial, sans-serif;
  --m-serif: "Synapsis", "Archivo Variable", Arial, sans-serif;
}`
}

function installPreloads(baseUrl: string): void {
  for (const weight of PRELOAD_WEIGHTS) {
    const selector = `link[data-synapsis-preload="${weight}"]`
    let link = document.head.querySelector<HTMLLinkElement>(selector)
    if (link === null) {
      link = document.createElement("link")
      link.rel = "preload"
      link.as = "font"
      link.type = "font/woff2"
      link.crossOrigin = "anonymous"
      link.dataset.synapsisPreload = String(weight)
      document.head.append(link)
    }
    link.href = `${baseUrl}/synapsis-${weight}.woff2`
  }
}

function removePreloads(): void {
  document.head
    .querySelectorAll("link[data-synapsis-preload]")
    .forEach((link) => link.remove())
}

export function installSynapsisFontFaces(baseUrl?: string): void {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const existingStyle = document.head.querySelector<HTMLStyleElement>(
    `style#${OFFICIAL_FONT_STYLE_ID}`,
  )

  if (normalizedBaseUrl === undefined) {
    existingStyle?.remove()
    removePreloads()
    return
  }

  let style = existingStyle

  if (style === null) {
    style = document.createElement("style")
    style.id = OFFICIAL_FONT_STYLE_ID
    document.head.append(style)
  }

  style.textContent = buildSynapsisFontCss(normalizedBaseUrl)
  installPreloads(normalizedBaseUrl)
}
