import type { BrandIr, SurfaceKind, SurfaceStyle } from "../api/types"

export type SurfaceFamily = "matter" | "lines" | "grids" | "dots" | "motion"

export interface SurfaceDefinition {
  kind: SurfaceKind
  name: string
  family: SurfaceFamily
  description: string
  defaults: Pick<SurfaceStyle, "opacity" | "scalePx" | "weightPx" | "angleDeg">
}

export const SURFACE_FAMILIES: ReadonlyArray<{ id: SurfaceFamily; name: string }> = [
  { id: "matter", name: "Papel e matéria" },
  { id: "lines", name: "Linhas e tramas" },
  { id: "grids", name: "Grades e módulos" },
  { id: "dots", name: "Pontos e impressão" },
  { id: "motion", name: "Curvas e movimento" },
]

export const SURFACE_CATALOG: ReadonlyArray<SurfaceDefinition> = [
  {
    kind: "paper-grain",
    name: "Grão de papel",
    family: "matter",
    description: "Pontilhado fino e irregular, como papel sem revestimento.",
    defaults: { opacity: 0.11, scalePx: 36, weightPx: 1.2, angleDeg: 0 },
  },
  {
    kind: "paper-fibers",
    name: "Fibras aparentes",
    family: "matter",
    description: "Fios cruzados que lembram papel artesanal e tecido cru.",
    defaults: { opacity: 0.08, scalePx: 54, weightPx: 0.8, angleDeg: 7 },
  },
  {
    kind: "flecked-paper",
    name: "Papel com fragmentos",
    family: "matter",
    description: "Pequenas marcas dispersas, com aparência reciclada.",
    defaults: { opacity: 0.13, scalePx: 62, weightPx: 1.5, angleDeg: 0 },
  },
  {
    kind: "dry-brush",
    name: "Pincel seco",
    family: "matter",
    description: "Faixas imperfeitas, mais gestuais e expressivas.",
    defaults: { opacity: 0.1, scalePx: 88, weightPx: 2.2, angleDeg: -8 },
  },
  {
    kind: "terrazzo",
    name: "Fragmentos minerais",
    family: "matter",
    description: "Lascas angulares espalhadas como granilite e terrazzo.",
    defaults: { opacity: 0.14, scalePx: 76, weightPx: 2.2, angleDeg: 17 },
  },
  {
    kind: "linear-rhythm",
    name: "Ritmo linear",
    family: "lines",
    description: "Linhas espaçadas que criam direção sem pesar.",
    defaults: { opacity: 0.12, scalePx: 42, weightPx: 1.2, angleDeg: 24 },
  },
  {
    kind: "scanlines",
    name: "Linhas de tela",
    family: "lines",
    description: "Riscos horizontais finos semelhantes às linhas de uma tela.",
    defaults: { opacity: 0.08, scalePx: 28, weightPx: 0.8, angleDeg: 0 },
  },
  {
    kind: "diagonal-hatch",
    name: "Hachura diagonal",
    family: "lines",
    description: "Traços paralelos que acrescentam tensão e movimento.",
    defaults: { opacity: 0.1, scalePx: 32, weightPx: 1, angleDeg: 45 },
  },
  {
    kind: "crosshatch",
    name: "Hachura cruzada",
    family: "lines",
    description: "Duas direções de traço, como sombra feita à mão.",
    defaults: { opacity: 0.08, scalePx: 38, weightPx: 0.8, angleDeg: 45 },
  },
  {
    kind: "woven",
    name: "Trama têxtil",
    family: "lines",
    description: "Cruzamento regular que lembra tecido e impressão tátil.",
    defaults: { opacity: 0.08, scalePx: 44, weightPx: 1.1, angleDeg: 0 },
  },
  {
    kind: "technical-grid",
    name: "Grade técnica",
    family: "grids",
    description: "Módulos precisos para marcas sistemáticas e rigorosas.",
    defaults: { opacity: 0.1, scalePx: 48, weightPx: 1, angleDeg: 0 },
  },
  {
    kind: "micro-grid",
    name: "Papel milimetrado",
    family: "grids",
    description: "Grade fina com marcações maiores em intervalos regulares.",
    defaults: { opacity: 0.08, scalePx: 64, weightPx: 0.65, angleDeg: 0 },
  },
  {
    kind: "isometric-grid",
    name: "Grade isométrica",
    family: "grids",
    description: "Três eixos que sugerem construção, volume e sistema.",
    defaults: { opacity: 0.09, scalePx: 52, weightPx: 0.8, angleDeg: 0 },
  },
  {
    kind: "checkerboard",
    name: "Tabuleiro modular",
    family: "grids",
    description: "Alternância de blocos para composições fortes e gráficas.",
    defaults: { opacity: 0.09, scalePx: 72, weightPx: 1, angleDeg: 0 },
  },
  {
    kind: "point-field",
    name: "Campo de pontos",
    family: "dots",
    description: "Pontos regulares com leitura leve e modular.",
    defaults: { opacity: 0.13, scalePx: 34, weightPx: 1.6, angleDeg: 0 },
  },
  {
    kind: "halftone",
    name: "Retícula de impressão",
    family: "dots",
    description: "Pontos alternados inspirados em impressão e fotografia.",
    defaults: { opacity: 0.14, scalePx: 30, weightPx: 2.2, angleDeg: 0 },
  },
  {
    kind: "concentric-rings",
    name: "Anéis concêntricos",
    family: "motion",
    description: "Ondas circulares que conduzem o olhar ao centro.",
    defaults: { opacity: 0.1, scalePx: 46, weightPx: 1.1, angleDeg: 0 },
  },
  {
    kind: "topographic",
    name: "Curvas de nível",
    family: "motion",
    description: "Contornos sobrepostos com ritmo orgânico e territorial.",
    defaults: { opacity: 0.1, scalePx: 38, weightPx: 1, angleDeg: 0 },
  },
  {
    kind: "sunburst",
    name: "Raios",
    family: "motion",
    description: "Linhas que partem do centro e amplificam energia.",
    defaults: { opacity: 0.09, scalePx: 58, weightPx: 1.2, angleDeg: -12 },
  },
  {
    kind: "waves",
    name: "Ondas abertas",
    family: "motion",
    description: "Curvas amplas que criam fluxo sem uma grade rígida.",
    defaults: { opacity: 0.1, scalePx: 52, weightPx: 1.1, angleDeg: 0 },
  },
]

const FAMILY_BY_KIND = new Map(SURFACE_CATALOG.map((item) => [item.kind, item.family]))

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function colorTokenForBrand(brandIr: BrandIr): string | null {
  if (brandIr.colors["color.primary"]) return "color.primary"
  if (brandIr.colors["color.text"]) return "color.text"
  return Object.keys(brandIr.colors)[0] ?? null
}

function scoreSurface(item: SurfaceDefinition, brandIr: BrandIr): number {
  const direction = brandIr.creativeDirection
  if (!direction) return 0
  const { energy, geometry, density, formality, materiality, contrast } = direction
  let score = direction.surface === item.kind ? 8 : 0

  if (item.family === "matter") {
    score += -materiality.value * 2.4 - geometry.value * 0.8 - formality.value * 0.35
  } else if (item.family === "lines") {
    score += energy.value * 1.6 + contrast.value * 0.8 + materiality.value * 0.45
  } else if (item.family === "grids") {
    score += geometry.value * 2.1 + formality.value * 1.2 + materiality.value * 0.35
  } else if (item.family === "dots") {
    score += density.value * 1.2 + contrast.value * 0.8 - formality.value * 0.25
  } else {
    score += -geometry.value * 1.8 + energy.value * 0.7 + contrast.value * 0.5
  }

  const kindBoost: Partial<Record<SurfaceKind, number>> = {
    "paper-grain": -materiality.value + -contrast.value * 0.25,
    "paper-fibers": -materiality.value * 1.4 - formality.value * 0.4,
    "flecked-paper": -materiality.value + density.value * 0.4,
    "dry-brush": energy.value + contrast.value,
    terrazzo: density.value + contrast.value * 0.6,
    "linear-rhythm": energy.value + geometry.value * 0.4,
    scanlines: materiality.value + formality.value * 0.5,
    "diagonal-hatch": energy.value + contrast.value * 0.8,
    crosshatch: density.value + -materiality.value * 0.5,
    woven: -materiality.value + density.value * 0.5,
    "technical-grid": geometry.value + formality.value,
    "micro-grid": geometry.value + formality.value * 0.7 - contrast.value * 0.3,
    "isometric-grid": geometry.value + materiality.value + energy.value * 0.3,
    checkerboard: contrast.value * 1.2 + geometry.value * 0.6,
    "point-field": density.value + geometry.value * 0.3,
    halftone: contrast.value + energy.value * 0.5 - formality.value * 0.25,
    "concentric-rings": -geometry.value + -energy.value * 0.25,
    topographic: -geometry.value + -materiality.value * 0.6,
    sunburst: energy.value * 1.3 + contrast.value,
    waves: -geometry.value + energy.value * 0.35,
  }
  return score + (kindBoost[item.kind] ?? 0)
}

export function recommendedSurfaces(brandIr: BrandIr, limit = 4): SurfaceDefinition[] {
  if (!brandIr.creativeDirection) return []
  return [...SURFACE_CATALOG]
    .sort((left, right) => {
      const difference = scoreSurface(right, brandIr) - scoreSurface(left, brandIr)
      return difference || left.name.localeCompare(right.name, "pt-BR")
    })
    .slice(0, limit)
}

export function surfaceForBrand(item: SurfaceDefinition, brandIr: BrandIr): SurfaceStyle | null {
  const colorToken = colorTokenForBrand(brandIr)
  if (!colorToken) return null
  const density = brandIr.creativeDirection?.surfaceDensity ?? 0.35
  const energy = brandIr.creativeDirection?.energy.value ?? 0
  return {
    kind: item.kind,
    colorToken,
    opacity: Number(clamp(item.defaults.opacity + density * 0.035, 0.04, 0.24).toFixed(2)),
    scalePx: Math.round(clamp(item.defaults.scalePx * (1.12 - density * 0.35), 8, 180)),
    weightPx: Number(clamp(item.defaults.weightPx * (0.85 + density * 0.4), 0.5, 8).toFixed(1)),
    angleDeg: Math.round(clamp(item.defaults.angleDeg + energy * 8, -180, 180)),
  }
}

export function recommendationReason(item: SurfaceDefinition, brandIr: BrandIr): string {
  const direction = brandIr.creativeDirection
  if (!direction) return item.description
  if (direction.surface === item.kind) return "É a sugestão principal baseada nos arquivos e respostas da marca."
  const family = FAMILY_BY_KIND.get(item.kind)
  if (family === "matter") return "Combina com o lado tátil, humano ou artesanal da marca."
  if (family === "lines") return "Acompanha o ritmo e a energia que a marca quer transmitir."
  if (family === "grids") return "Reforça precisão, organização e construção visual."
  if (family === "dots") return "Acrescenta densidade com uma referência de impressão."
  return "Acompanha formas mais orgânicas, abertas ou em movimento."
}
