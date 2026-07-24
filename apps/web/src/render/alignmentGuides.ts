import type { ContentSpec, LayoutSpec } from "../api/types"
import {
  editorElements,
  elementArea,
  elementLabel,
  elementOpacity,
  isStructuralElement,
} from "../editor/layerModel"

export type AlignmentAxis = "x" | "y"
export type AlignmentAnchor = "start" | "center" | "end"
export type AlignmentTargetKind = "canvas" | "safe-area" | "layer"
export type AlignmentAction = "move" | "resize"
export interface ResizeAlignmentAnchors {
  x?: Extract<AlignmentAnchor, "start" | "end">
  y?: Extract<AlignmentAnchor, "start" | "end">
}

export interface AlignmentTarget {
  id: string
  label: string
  kind: AlignmentTargetKind
  area: [number, number, number, number]
}

export interface AlignmentGuide {
  axis: AlignmentAxis
  position: number
  movingAnchor: AlignmentAnchor
  targetAnchor: AlignmentAnchor
  targetId: string
  targetLabel: string
  targetKind: AlignmentTargetKind
  delta: number
}

export interface AlignmentSnap {
  area: [number, number, number, number]
  guides: AlignmentGuide[]
}

const ANCHORS: AlignmentAnchor[] = ["start", "center", "end"]

function anchorPosition(
  area: [number, number, number, number],
  axis: AlignmentAxis,
  anchor: AlignmentAnchor,
): number {
  const start = axis === "x" ? area[0] : area[1]
  const length = axis === "x" ? area[2] : area[3]
  if (anchor === "center") return start + length / 2
  if (anchor === "end") return start + length
  return start
}

function targetPriority(kind: AlignmentTargetKind): number {
  if (kind === "layer") return 0
  if (kind === "safe-area") return 1
  return 2
}

function bestGuide(
  area: [number, number, number, number],
  axis: AlignmentAxis,
  action: AlignmentAction,
  targets: AlignmentTarget[],
  thresholdPx: number,
  resizeAnchors?: ResizeAlignmentAnchors,
): AlignmentGuide | null {
  const resizeAnchor = axis === "x" ? resizeAnchors?.x : resizeAnchors?.y
  const movingAnchors =
    action === "resize"
      ? resizeAnchor
        ? ([resizeAnchor] as AlignmentAnchor[])
        : []
      : ANCHORS
  const candidates: AlignmentGuide[] = []

  for (const movingAnchor of movingAnchors) {
    const movingPosition = anchorPosition(area, axis, movingAnchor)
    for (const target of targets) {
      for (const targetAnchor of ANCHORS) {
        const sameAnchor = targetAnchor === movingAnchor
        const adjacentEdges =
          (movingAnchor === "start" && targetAnchor === "end") ||
          (movingAnchor === "end" && targetAnchor === "start")
        if (!sameAnchor && (target.kind !== "layer" || !adjacentEdges)) continue
        const position = anchorPosition(target.area, axis, targetAnchor)
        const delta = position - movingPosition
        if (Math.abs(delta) > thresholdPx) continue
        candidates.push({
          axis,
          position,
          movingAnchor,
          targetAnchor,
          targetId: target.id,
          targetLabel: target.label,
          targetKind: target.kind,
          delta,
        })
      }
    }
  }

  candidates.sort((left, right) => {
    const distance = Math.abs(left.delta) - Math.abs(right.delta)
    if (distance !== 0) return distance
    const kind = targetPriority(left.targetKind) - targetPriority(right.targetKind)
    if (kind !== 0) return kind
    const sameAnchor = Number(left.movingAnchor !== left.targetAnchor) -
      Number(right.movingAnchor !== right.targetAnchor)
    if (sameAnchor !== 0) return sameAnchor
    return left.targetId.localeCompare(right.targetId)
  })

  return candidates[0] ?? null
}

export function buildAlignmentTargets(
  layout: LayoutSpec,
  content: ContentSpec,
  selectedId: string,
): AlignmentTarget[] {
  const { widthPx, heightPx, safeAreaPx } = layout.canvas
  const targets: AlignmentTarget[] = [
    {
      id: "canvas",
      label: "Peça",
      kind: "canvas",
      area: [0, 0, widthPx, heightPx],
    },
  ]

  if (safeAreaPx > 0 && widthPx > safeAreaPx * 2 && heightPx > safeAreaPx * 2) {
    targets.push({
      id: "safe-area",
      label: "Área segura",
      kind: "safe-area",
      area: [
        safeAreaPx,
        safeAreaPx,
        widthPx - safeAreaPx * 2,
        heightPx - safeAreaPx * 2,
      ],
    })
  }

  for (const element of editorElements(layout)) {
    if (element.id === selectedId) continue
    if (isStructuralElement(element)) continue
    const override = content.overrides?.[element.id]
    if (override?.hidden || elementOpacity(element, override) <= 0) continue
    const area = elementArea(element, override)
    const coversCanvas =
      area[0] <= 0 &&
      area[1] <= 0 &&
      area[2] >= widthPx &&
      area[3] >= heightPx
    if (coversCanvas) continue
    targets.push({
      id: element.id,
      label: elementLabel(element),
      kind: "layer",
      area,
    })
  }

  return targets
}

export function snapEditorArea(
  area: [number, number, number, number],
  action: AlignmentAction,
  targets: AlignmentTarget[],
  thresholdPx: number,
  resizeAnchors?: ResizeAlignmentAnchors,
): AlignmentSnap {
  const xGuide = bestGuide(area, "x", action, targets, thresholdPx, resizeAnchors)
  const yGuide = bestGuide(area, "y", action, targets, thresholdPx, resizeAnchors)
  const next: [number, number, number, number] = [...area]

  if (xGuide) {
    if (action === "move") next[0] += xGuide.delta
    else if (xGuide.movingAnchor === "start") {
      next[0] += xGuide.delta
      next[2] -= xGuide.delta
    } else {
      next[2] += xGuide.delta
    }
  }
  if (yGuide) {
    if (action === "move") next[1] += yGuide.delta
    else if (yGuide.movingAnchor === "start") {
      next[1] += yGuide.delta
      next[3] -= yGuide.delta
    } else {
      next[3] += yGuide.delta
    }
  }

  return {
    area: next,
    guides: [xGuide, yGuide].filter((guide): guide is AlignmentGuide => guide !== null),
  }
}

function anchorLabel(axis: AlignmentAxis, anchor: AlignmentAnchor): string {
  if (axis === "x") {
    return anchor === "start" ? "Esquerda" : anchor === "center" ? "Centro" : "Direita"
  }
  return anchor === "start" ? "Topo" : anchor === "center" ? "Meio" : "Base"
}

export function alignmentGuideLabel(guide: AlignmentGuide): string {
  const moving = anchorLabel(guide.axis, guide.movingAnchor)
  if (guide.targetKind === "canvas") return `${moving} · peça`
  if (guide.targetKind === "safe-area") return `${moving} · área segura`
  if (guide.movingAnchor === guide.targetAnchor) return `${moving} · ${guide.targetLabel}`
  return `${moving} com ${anchorLabel(guide.axis, guide.targetAnchor).toLocaleLowerCase("pt-BR")} · ${guide.targetLabel}`
}
