import type { LayerOverride, LayoutSpec, LockedLayer, Slot } from "../api/types"
import { slotLabel } from "./labels"

export type EditorElement = Slot | LockedLayer

const LAYER_LABELS: Record<string, string> = {
  "diagonal-field": "Campo diagonal",
  "accent-diagonals": "Linhas de acento",
  "accent-rule": "Linha de destaque",
  "brand-mark": "Marca",
  "frame-top": "Moldura superior",
  "frame-left": "Moldura esquerda",
  "frame-right": "Moldura direita",
  "frame-bottom": "Moldura inferior",
  "register-top-left-x": "Registro superior esquerdo",
  "register-top-left-y": "Registro superior esquerdo",
  "register-top-right-x": "Registro superior direito",
  "register-top-right-y": "Registro superior direito",
  "register-bottom-left-x": "Registro inferior esquerdo",
  "register-bottom-left-y": "Registro inferior esquerdo",
  "register-bottom-right-x": "Registro inferior direito",
  "register-bottom-right-y": "Registro inferior direito",
  "vertical-rail": "Trilho vertical",
  "rise-step-one": "Degrau inferior",
  "rise-step-two": "Degrau intermediário",
  "rise-step-three": "Degrau superior",
  "counter-disc": "Disco de contraponto",
  "closing-rule": "Linha de fechamento",
  "signal-disc": "Disco de transmissão",
  "signal-counter": "Centro do sinal",
  "broadcast-bar-one": "Faixa de transmissão curta",
  "broadcast-bar-two": "Faixa de transmissão média",
  "broadcast-bar-three": "Faixa de transmissão longa",
  "lower-frequency-one": "Frequência inferior curta",
  "lower-frequency-two": "Frequência inferior média",
  "lower-frequency-three": "Frequência inferior longa",
  "left-field": "Campo lateral",
  "crossbar-wide": "Travessia principal",
  "crossbar-narrow": "Travessia secundária",
  "lower-block": "Bloco inferior",
  "marker-disc": "Marcador circular",
  "portrait-mat": "Campo do retrato",
  "portrait-shadow": "Contracampo do retrato",
  "masthead-rule": "Linha do cabeçalho",
  "left-photo-mat": "Campo da foto principal",
  "right-photo-mat": "Campo da foto secundária",
  "collection-index-field": "Campo do número",
  "footer-rule": "Linha de rodapé",
  "portrait-backdrop": "Fundo do retrato",
  "editorial-rail": "Trilho editorial",
  "caption-marker": "Marcador da legenda",
  "headline-field": "Campo da manchete",
  "bottom-rule": "Linha inferior",
  "folio-disc": "Marcador de página",
  "whisper-top-rule": "Linha superior",
  "whisper-marker": "Marcador de abertura",
  "whisper-axis": "Eixo vertical",
  "whisper-closing-field": "Campo de fechamento",
  "gallery-mat": "Campo da imagem",
  "gallery-shadow": "Contracampo da imagem",
  "gallery-rail": "Trilho da galeria",
  "gallery-accent": "Linha de destaque da galeria",
  "gallery-bottom-rule": "Linha inferior da galeria",
  "column-field": "Campo central",
  "column-top-disc": "Marcador superior",
  "column-upper-rule": "Linha superior da coluna",
  "column-lower-rule": "Linha inferior da coluna",
  "column-bottom-disc": "Marcador inferior",
  "overlap-primary-mat": "Campo da foto principal",
  "overlap-secondary-mat": "Campo da foto secundária",
  "overlap-tape-one": "Fita superior",
  "overlap-tape-two": "Fita inferior",
  "overlap-copy-field": "Campo da manchete",
  "cutout-disc": "Disco de recorte",
  "cutout-photo-mat": "Campo da foto",
  "cutout-caption-field": "Campo da legenda",
  "cutout-side-rule": "Linha lateral",
  "cutout-bottom-rule": "Linha inferior da colagem",
  "contact-frame-one": "Quadro da foto 1",
  "contact-frame-two": "Quadro da foto 2",
  "contact-frame-three": "Quadro da foto 3",
  "contact-frame-four": "Quadro da foto 4",
  "contact-copy-rule": "Linha do texto",
  "blueprint-frame-top": "Moldura técnica superior",
  "blueprint-frame-left": "Moldura técnica esquerda",
  "blueprint-frame-right": "Moldura técnica direita",
  "blueprint-frame-bottom": "Moldura técnica inferior",
  "blueprint-axis-x": "Eixo horizontal da planta",
  "blueprint-axis-y": "Eixo vertical da planta",
  "blueprint-target-disc": "Área de referência",
  "blueprint-target-core": "Ponto de referência",
  "blueprint-measure": "Linha de medida",
  "annotation-photo-mat": "Campo do objeto",
  "annotation-cross-x": "Eixo horizontal do objeto",
  "annotation-cross-y": "Eixo vertical do objeto",
  "annotation-callout-one": "Chamada da nota 1",
  "annotation-callout-two": "Chamada da nota 2",
  "annotation-callout-three": "Chamada da nota 3",
  "annotation-point-one": "Ponto da nota 1",
  "annotation-point-two": "Ponto da nota 2",
  "annotation-point-three": "Ponto da nota 3",
  "annotation-bottom-rule": "Linha inferior das anotações",
  "flow-rail": "Linha de início do fluxo",
  "flow-node-one": "Campo da etapa 1",
  "flow-node-two": "Campo da etapa 2",
  "flow-node-three": "Campo da etapa 3",
  "flow-link-one-x": "Conector horizontal 1",
  "flow-link-one-y": "Conector vertical 1",
  "flow-link-two-x": "Conector horizontal 2",
  "flow-link-two-y": "Conector vertical 2",
  "flow-origin": "Início do fluxo",
  "flow-end": "Fim do fluxo",
  "product-hero-mat": "Campo principal do produto",
  "product-hero-rail": "Trilho da oferta",
  "product-hero-price-rule": "Linha do preço",
  "product-hero-cta-field": "Campo da chamada para ação",
  "product-hero-copy-field": "Campo do argumento",
  "product-hero-bottom-rule": "Linha inferior do produto",
  "benefit-photo-mat": "Campo da foto do produto",
  "benefit-divider": "Divisão entre produto e benefícios",
  "benefit-one-field": "Campo do benefício 1",
  "benefit-two-field": "Campo do benefício 2",
  "benefit-three-field": "Campo do benefício 3",
  "benefit-cta-field": "Campo da chamada dos benefícios",
  "benefit-bottom-rule": "Linha inferior dos benefícios",
  "launch-orbit": "Órbita do produto",
  "launch-photo-mat": "Campo central do produto",
  "launch-left-marker": "Marcador lateral esquerdo",
  "launch-right-marker": "Marcador lateral direito",
  "launch-offer-rule": "Linha da oferta",
  "launch-cta-field": "Campo da chamada do lançamento",
  "launch-bottom-rule": "Linha inferior do lançamento",
  "metric-top-rule": "Linha superior da métrica",
  "metric-field": "Campo da métrica principal",
  "metric-axis": "Eixo da métrica principal",
  "metric-delta-field": "Campo da variação",
  "metric-bar-one": "Barra do indicador 1",
  "metric-bar-two": "Barra do indicador 2",
  "metric-bar-three": "Barra do indicador 3",
  "metric-bottom-rule": "Linha inferior da métrica",
  "comparison-left-field": "Campo esquerdo da comparação",
  "comparison-right-field": "Campo direito da comparação",
  "comparison-spine": "Eixo central da comparação",
  "comparison-left-rule": "Linha do valor esquerdo",
  "comparison-right-rule": "Linha do valor direito",
  "comparison-verdict-field": "Campo da conclusão",
  "dashboard-card-one": "Cartão da métrica 1",
  "dashboard-card-two": "Cartão da métrica 2",
  "dashboard-card-three": "Cartão da métrica 3",
  "dashboard-rail": "Eixo de progressão",
  "dashboard-progress-one": "Progresso inicial",
  "dashboard-progress-two": "Progresso intermediário",
  "dashboard-progress-three": "Progresso atual",
  "dashboard-endpoint": "Ponto atual",
  "dashboard-bottom-rule": "Linha inferior do painel",
  "phone-stage": "Campo de apresentação do celular",
  "phone-body": "Corpo do celular",
  "phone-bezel": "Moldura interna do celular",
  "phone-camera": "Câmera do celular",
  "phone-home": "Indicador inferior do celular",
  "phone-cta-field": "Campo da chamada do celular",
  "phone-bottom-rule": "Linha inferior do celular",
  "browser-shadow": "Contracampo do navegador",
  "browser-frame": "Moldura do navegador",
  "browser-screen-field": "Campo da tela do navegador",
  "browser-chrome": "Barra superior do navegador",
  "browser-dot-one": "Controle do navegador 1",
  "browser-dot-two": "Controle do navegador 2",
  "browser-dot-three": "Controle do navegador 3",
  "browser-address": "Campo do endereço",
  "browser-bottom-rule": "Linha inferior do navegador",
  "ecosystem-orbit": "Campo circular do ecossistema",
  "ecosystem-tablet-body": "Corpo da tela ampla",
  "ecosystem-tablet-screen": "Campo da tela ampla",
  "ecosystem-tablet-camera": "Câmera da tela ampla",
  "ecosystem-phone-shadow": "Contracampo do celular",
  "ecosystem-phone-body": "Corpo do celular sobreposto",
  "ecosystem-phone-screen": "Campo da tela móvel",
  "ecosystem-phone-camera": "Câmera da tela móvel",
  "ecosystem-cta-field": "Campo da chamada do ecossistema",
  "ecosystem-bottom-rule": "Linha inferior do ecossistema",
}

export function editorElements(layout: LayoutSpec): EditorElement[] {
  return [...layout.slots, ...(layout.lockedLayers ?? [])]
}

export function findEditorElement(layout: LayoutSpec, id: string | null): EditorElement | null {
  if (!id) return null
  return editorElements(layout).find((element) => element.id === id) ?? null
}

export function elementLabel(element: EditorElement): string {
  if (element.id.startsWith("user-text-")) return "Bloco de texto"
  if (element.id.startsWith("user-signature-")) return "Assinatura"
  if (element.id.startsWith("user-kicker-")) return "Linha de contexto"
  if (element.id.startsWith("user-support-")) return "Texto de apoio"
  if (element.id.startsWith("user-index-")) return "Número"
  if (element.id.startsWith("user-image-")) return "Imagem"
  if (element.id.startsWith("user-logo-")) return "Logo"
  if (element.id.startsWith("user-shape-") || element.id.startsWith("user-rule-")) {
    return "Forma ou linha"
  }
  if (element.kind === "asset" && element.assetToken.startsWith("logo.")) return "Logo"
  if (element.kind === "text" || element.kind === "image" || element.kind === "logo") {
    return slotLabel(element.id)
  }
  return LAYER_LABELS[element.id] ?? element.id.replaceAll("-", " ")
}

export function elementArea(
  element: EditorElement,
  override: LayerOverride | undefined,
): [number, number, number, number] {
  return override?.area ?? element.area
}

export function elementOpacity(element: EditorElement, override: LayerOverride | undefined): number {
  return override?.opacity ?? element.opacity ?? 1
}

export function elementZIndex(element: EditorElement, override: LayerOverride | undefined): number {
  if (override?.zIndex !== undefined && override.zIndex !== null) return override.zIndex
  if (element.zIndex !== undefined && element.zIndex !== null) return element.zIndex
  if (element.kind === "logo") return 3
  if (element.kind === "text") return 2
  if (element.kind === "image") return 1
  return 0
}

export function isStructuralElement(element: EditorElement): boolean {
  return element.id.startsWith("frame-") || element.id.startsWith("register-")
}

export function elementGlyph(element: EditorElement): string {
  if (element.kind === "text") return "T"
  if (element.kind === "image") return "IMG"
  if (element.kind === "logo" || element.kind === "asset") return "BR"
  if (element.kind === "motif") return "///"
  return "□"
}
