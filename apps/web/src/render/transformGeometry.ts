export const RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const

export type ResizeHandle = (typeof RESIZE_HANDLES)[number]

type Area = [number, number, number, number]

const HANDLE_VECTOR: Record<ResizeHandle, [number, number]> = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
}

export function normalizeRotation(degrees: number): number {
  const normalized = ((degrees + 180) % 360 + 360) % 360 - 180
  const rounded = Math.round(normalized * 10) / 10
  return Object.is(rounded, -0) ? 0 : rounded
}

export function resizeAnchors(
  handle: ResizeHandle,
): { x?: "start" | "end"; y?: "start" | "end" } {
  const [horizontal, vertical] = HANDLE_VECTOR[handle]
  return {
    ...(horizontal < 0 ? { x: "start" as const } : horizontal > 0 ? { x: "end" as const } : {}),
    ...(vertical < 0 ? { y: "start" as const } : vertical > 0 ? { y: "end" as const } : {}),
  }
}

export function resizeAreaFromHandle(
  area: Area,
  handle: ResizeHandle,
  canvasDx: number,
  canvasDy: number,
  rotationDeg: number,
  minimumSize = 8,
): Area {
  const [x, y, width, height] = area
  const [horizontal, vertical] = HANDLE_VECTOR[handle]
  const radians = rotationDeg * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)

  // O ponteiro se move na tela; a caixa cresce nos próprios eixos, mesmo rotacionada.
  const localDx = cosine * canvasDx + sine * canvasDy
  const localDy = -sine * canvasDx + cosine * canvasDy
  const nextWidth = horizontal === 0
    ? width
    : Math.max(minimumSize, width + horizontal * localDx)
  const nextHeight = vertical === 0
    ? height
    : Math.max(minimumSize, height + vertical * localDy)

  const localCenterDx = horizontal * (nextWidth - width) / 2
  const localCenterDy = vertical * (nextHeight - height) / 2
  const centerDx = cosine * localCenterDx - sine * localCenterDy
  const centerDy = sine * localCenterDx + cosine * localCenterDy
  const centerX = x + width / 2 + centerDx
  const centerY = y + height / 2 + centerDy

  return [
    centerX - nextWidth / 2,
    centerY - nextHeight / 2,
    nextWidth,
    nextHeight,
  ]
}
