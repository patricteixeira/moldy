import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react"
import type { JSX } from "react"
import type { BrandIr, ContentSpec, LayoutSpec } from "../api/types"
import { elementArea, elementLabel, findEditorElement } from "../editor/layerModel"
import {
  alignmentGuideLabel,
  buildAlignmentTargets,
  snapEditorArea,
  type AlignmentGuide,
  type AlignmentTarget,
} from "./alignmentGuides"
import { mountRender, type RenderHandle } from "./mount"
import {
  normalizeRotation,
  RESIZE_HANDLES,
  resizeAnchors,
  resizeAreaFromHandle,
  type ResizeHandle,
} from "./transformGeometry"

interface PreviewProps {
  brandIr: BrandIr
  layoutSpec: LayoutSpec
  contentSpec: ContentSpec
  assetsBaseUrl: string
  maxWidthPx: number
  selectedLayerId?: string | null
  selectedArea?: [number, number, number, number] | null
  selectedRotation?: number
  onSelectLayer?(id: string | null): void
  onAreaChange?(id: string, area: [number, number, number, number]): void
  onRotationChange?(id: string, rotationDeg: number): void
}

interface PointerSession {
  id: string
  action: "move" | "resize" | "rotate"
  resizeHandle: ResizeHandle | null
  startClientX: number
  startClientY: number
  startArea: [number, number, number, number]
  startRotationDeg: number
  rotationCenterClient: [number, number] | null
  startPointerAngleDeg: number | null
  alignmentTargets: AlignmentTarget[]
  layerElement: HTMLElement | null
  hasMoved: boolean
}

const DRAG_START_THRESHOLD_PX = 3
const ALIGNMENT_SNAP_THRESHOLD_SCREEN_PX = 7
const MAX_EDITOR_AREA_PX = 32_768

function normalizeEditorArea(
  area: [number, number, number, number],
): [number, number, number, number] {
  const width = Math.max(8, Math.min(Math.round(area[2]), MAX_EDITOR_AREA_PX))
  const height = Math.max(8, Math.min(Math.round(area[3]), MAX_EDITOR_AREA_PX))
  const x = Math.max(-MAX_EDITOR_AREA_PX, Math.min(Math.round(area[0]), MAX_EDITOR_AREA_PX))
  const y = Math.max(-MAX_EDITOR_AREA_PX, Math.min(Math.round(area[1]), MAX_EDITOR_AREA_PX))
  return [x, y, width, height]
}

export function Preview({
  brandIr,
  layoutSpec,
  contentSpec,
  assetsBaseUrl,
  maxWidthPx,
  selectedLayerId = null,
  selectedArea = null,
  selectedRotation = 0,
  onSelectLayer,
  onAreaChange,
  onRotationChange,
}: PreviewProps): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const renderRootRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<RenderHandle | null>(null)
  const skippedInitialUpdate = useRef(false)
  const pointerSessionRef = useRef<PointerSession | null>(null)
  const liveAreaRef = useRef<[number, number, number, number] | null>(null)
  const liveRotationRef = useRef<number | null>(null)
  const selectionRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(1)
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([])
  const maximumWidth = Math.max(1, Math.min(maxWidthPx, layoutSpec.canvas.widthPx))
  const [visibleWidth, setVisibleWidth] = useState(maximumWidth)
  const payload = useMemo(
    () => ({ brandIr, layoutSpec, contentSpec, assetsBaseUrl }),
    [assetsBaseUrl, brandIr, contentSpec, layoutSpec],
  )

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const measure = (): void => {
      const measuredWidth = wrapper.getBoundingClientRect().width
      setVisibleWidth(Math.min(maximumWidth, measuredWidth > 0 ? measuredWidth : maximumWidth))
    }

    measure()
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(measure)
      observer.observe(wrapper)
      return () => observer.disconnect()
    }

    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [maximumWidth])

  useEffect(() => {
    const renderRoot = renderRootRef.current
    if (!renderRoot) return
    handleRef.current = mountRender(renderRoot, payload)
    return () => {
      handleRef.current?.destroy()
      handleRef.current = null
    }
    // O adapter recebe as atualizações pelo efeito seguinte; o mount acontece uma única vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!skippedInitialUpdate.current) {
      skippedInitialUpdate.current = true
      return
    }
    handleRef.current?.update(payload)
  }, [payload])

  const scale = Math.min(1, visibleWidth / layoutSpec.canvas.widthPx)
  scaleRef.current = scale

  const selectedElement = findEditorElement(layoutSpec, selectedLayerId)
  const selectedLabel = selectedElement ? elementLabel(selectedElement) : selectedLayerId

  const applyLiveArea = (
    session: PointerSession,
    area: [number, number, number, number],
  ): void => {
    const [left, top, width, height] = area
    const selection = selectionRef.current
    if (selection?.dataset.selectionLayer === session.id) {
      Object.assign(selection.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      })
    }
    if (session.layerElement) {
      Object.assign(session.layerElement.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      })
    }
  }

  const applyLiveRotation = (session: PointerSession, rotationDeg: number): void => {
    const transform = rotationDeg === 0 ? "" : `rotate(${rotationDeg}deg)`
    const selection = selectionRef.current
    if (selection?.dataset.selectionLayer === session.id) {
      selection.style.transform = transform
    }
    if (session.layerElement) {
      session.layerElement.style.transform = transform
      session.layerElement.style.transformOrigin = "center"
    }
  }

  const startInteraction = (
    event: ReactPointerEvent<HTMLDivElement>,
    id: string,
    action: "move" | "resize" | "rotate",
    resizeHandle: ResizeHandle | null = null,
  ): void => {
    if (
      event.button !== 0 ||
      (action === "rotate" ? !onRotationChange : !onAreaChange)
    ) return
    const element = findEditorElement(layoutSpec, id)
    if (!element) return
    const startArea = elementArea(element, contentSpec.overrides?.[id])
    const startRotationDeg = contentSpec.overrides?.[id]?.rotationDeg ?? 0
    const nativeRect = event.currentTarget.getBoundingClientRect()
    const centerClient: [number, number] = [
      nativeRect.left + (startArea[0] + startArea[2] / 2) * scaleRef.current,
      nativeRect.top + (startArea[1] + startArea[3] / 2) * scaleRef.current,
    ]
    const pointerAngleDeg = Math.atan2(
      event.clientY - centerClient[1],
      event.clientX - centerClient[0],
    ) * 180 / Math.PI
    pointerSessionRef.current = {
      id,
      action,
      resizeHandle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startArea,
      startRotationDeg,
      rotationCenterClient: action === "rotate" ? centerClient : null,
      startPointerAngleDeg: action === "rotate" ? pointerAngleDeg : null,
      alignmentTargets: buildAlignmentTargets(layoutSpec, contentSpec, id),
      layerElement: Array.from(
        renderRootRef.current?.querySelectorAll<HTMLElement>(
          "[data-slot-id], [data-layer-id]",
        ) ?? [],
      ).find(
        (candidate) => candidate.dataset.slotId === id || candidate.dataset.layerId === id,
      ) ?? null,
      hasMoved: false,
    }
    liveAreaRef.current = startArea
    liveRotationRef.current = startRotationDeg
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement
    const rotationHandle = target.closest<HTMLElement>("[data-rotation-handle]")
    if (rotationHandle && selectedLayerId) {
      startInteraction(event, selectedLayerId, "rotate")
      return
    }

    const resizeHandle = target.closest<HTMLElement>("[data-resize-handle]")
    if (resizeHandle && selectedLayerId) {
      startInteraction(
        event,
        selectedLayerId,
        "resize",
        resizeHandle.dataset.resizeHandle as ResizeHandle,
      )
      return
    }

    const selection = target.closest<HTMLElement>("[data-selection-layer]")
    const selectionId = selection?.dataset.selectionLayer ?? null
    if (selectionId) {
      onSelectLayer?.(selectionId)
      startInteraction(event, selectionId, "move")
      return
    }

    const selectable = target.closest<HTMLElement>("[data-slot-id], [data-layer-id]")
    const id = selectable?.dataset.slotId ?? selectable?.dataset.layerId ?? null
    onSelectLayer?.(id)
    if (id) startInteraction(event, id, "move")
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = pointerSessionRef.current
    if (!session) return
    const clientDx = event.clientX - session.startClientX
    const clientDy = event.clientY - session.startClientY
    if (!session.hasMoved) {
      if (Math.hypot(clientDx, clientDy) < DRAG_START_THRESHOLD_PX) return
      session.hasMoved = true
      wrapperRef.current?.setAttribute("data-dragging", "true")
      wrapperRef.current?.setAttribute("data-transforming", session.action)
    }

    if (session.action === "rotate") {
      if (!session.rotationCenterClient || session.startPointerAngleDeg === null) return
      const currentAngleDeg = Math.atan2(
        event.clientY - session.rotationCenterClient[1],
        event.clientX - session.rotationCenterClient[0],
      ) * 180 / Math.PI
      const angleDelta = normalizeRotation(currentAngleDeg - session.startPointerAngleDeg)
      const rawRotation = normalizeRotation(session.startRotationDeg + angleDelta)
      const nextRotation = event.shiftKey
        ? normalizeRotation(Math.round(rawRotation / 15) * 15)
        : rawRotation
      setAlignmentGuides([])
      liveRotationRef.current = nextRotation
      applyLiveRotation(session, nextRotation)
      return
    }

    const dx = clientDx / scaleRef.current
    const dy = clientDy / scaleRef.current
    const [x, y, width, height] = session.startArea
    const rawArea =
      session.action === "move"
        ? normalizeEditorArea([x + dx, y + dy, width, height])
        : normalizeEditorArea(
            resizeAreaFromHandle(
              session.startArea,
              session.resizeHandle ?? "se",
              dx,
              dy,
              session.startRotationDeg,
            ),
          )
    const canSnapResize = session.action !== "resize" || session.startRotationDeg === 0
    const snapped = event.altKey || !canSnapResize
      ? { area: rawArea, guides: [] }
      : snapEditorArea(
          rawArea,
          session.action,
          session.alignmentTargets,
          ALIGNMENT_SNAP_THRESHOLD_SCREEN_PX / scaleRef.current,
          session.action === "resize" && session.resizeHandle
            ? resizeAnchors(session.resizeHandle)
            : undefined,
        )
    const next = normalizeEditorArea(snapped.area)
    setAlignmentGuides(snapped.guides)
    liveAreaRef.current = next
    applyLiveArea(session, next)
  }

  const finishInteraction = (commit: boolean): void => {
    const session = pointerSessionRef.current
    pointerSessionRef.current = null
    wrapperRef.current?.removeAttribute("data-dragging")
    wrapperRef.current?.removeAttribute("data-transforming")
    setAlignmentGuides([])
    if (!session) return
    const finalArea = liveAreaRef.current
    const finalRotation = liveRotationRef.current
    liveAreaRef.current = null
    liveRotationRef.current = null
    if (session.action === "rotate") {
      if (commit && session.hasMoved && finalRotation !== null) {
        onRotationChange?.(session.id, finalRotation)
        return
      }
      applyLiveRotation(session, session.startRotationDeg)
      return
    }
    if (commit && session.hasMoved && finalArea) {
      onAreaChange?.(session.id, finalArea)
      return
    }
    applyLiveArea(session, session.startArea)
  }

  const nudgeSelection = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!selectedLayerId || !selectedArea || !onAreaChange) return
    const distance = event.shiftKey ? 10 : 1
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-distance, 0],
      ArrowRight: [distance, 0],
      ArrowUp: [0, -distance],
      ArrowDown: [0, distance],
    }
    const movement = delta[event.key]
    if (!movement) return
    event.preventDefault()
    onAreaChange(
      selectedLayerId,
      normalizeEditorArea(
        [
          selectedArea[0] + movement[0],
          selectedArea[1] + movement[1],
          selectedArea[2],
          selectedArea[3],
        ],
      ),
    )
  }

  const rotateSelectionFromKeyboard = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ): void => {
    if (!selectedLayerId || !onRotationChange) return
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    event.stopPropagation()
    const direction = event.key === "ArrowLeft" ? -1 : 1
    const step = event.shiftKey ? 15 : 1
    onRotationChange(
      selectedLayerId,
      normalizeRotation(selectedRotation + direction * step),
    )
  }

  return (
    <div
      ref={wrapperRef}
      className="preview-canvas preview-canvas-editable"
      data-testid="preview-canvas"
      data-aligning={alignmentGuides.length > 0 || undefined}
      style={{
        width: "100%",
        maxWidth: `${maximumWidth}px`,
        aspectRatio: `${layoutSpec.canvas.widthPx} / ${layoutSpec.canvas.heightPx}`,
      }}
    >
      {alignmentGuides.map((guide) => {
        const canvasLength =
          guide.axis === "x" ? layoutSpec.canvas.widthPx : layoutSpec.canvas.heightPx
        return (
          <div
            key={guide.axis}
            className={`canvas-alignment-guide canvas-alignment-guide-${guide.axis}`}
            data-testid={`alignment-guide-${guide.axis}`}
            data-target={guide.targetId}
            data-side={guide.position > canvasLength / 2 ? "end" : "start"}
            aria-hidden="true"
            style={
              guide.axis === "x"
                ? { left: `${(guide.position / canvasLength) * 100}%` }
                : { top: `${(guide.position / canvasLength) * 100}%` }
            }
          >
            <span>{alignmentGuideLabel(guide)}</span>
          </div>
        )
      })}
      {alignmentGuides.length > 0 ? (
        <span className="visually-hidden" role="status" aria-live="polite">
          {alignmentGuides.map(alignmentGuideLabel).join(". ")}
        </span>
      ) : null}
      <div
        className="preview-native"
        style={{
          width: `${layoutSpec.canvas.widthPx}px`,
          height: `${layoutSpec.canvas.heightPx}px`,
          transform: `scale(${scale})`,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => finishInteraction(true)}
        onPointerCancel={() => finishInteraction(false)}
      >
        <div ref={renderRootRef} />
        {selectedLayerId && selectedArea ? (
          <div
            ref={selectionRef}
            className="canvas-selection"
            data-testid="canvas-selection"
            data-layer={selectedLayerId}
            data-selection-layer={selectedLayerId}
            role="group"
            tabIndex={0}
            aria-label={`Item ${selectedLabel ?? selectedLayerId} selecionado. Arraste para mover, use as oito alças para redimensionar ou o ponto circular para girar.`}
            aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
            onKeyDown={nudgeSelection}
            style={{
              left: `${selectedArea[0]}px`,
              top: `${selectedArea[1]}px`,
              width: `${selectedArea[2]}px`,
              height: `${selectedArea[3]}px`,
              transform: selectedRotation === 0 ? undefined : `rotate(${selectedRotation}deg)`,
            }}
          >
            <span className="canvas-selection-label">{selectedLabel ?? selectedLayerId}</span>
            {RESIZE_HANDLES.map((handle) => (
              <span
                key={handle}
                className={`canvas-resize-handle canvas-resize-handle-${handle}`}
                data-resize-handle={handle}
                aria-hidden="true"
              />
            ))}
            <span className="canvas-rotation-stem" aria-hidden="true" />
            <button
              type="button"
              className="canvas-rotation-handle"
              data-rotation-handle
              aria-label={`Girar ${selectedLabel ?? selectedLayerId}. Rotação atual: ${selectedRotation} graus.`}
              aria-keyshortcuts="ArrowLeft ArrowRight"
              title="Arraste para girar. Segure Shift para encaixar em 15°."
              onKeyDown={rotateSelectionFromKeyboard}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
