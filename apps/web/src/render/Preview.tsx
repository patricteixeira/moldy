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
import { mountRender, type RenderHandle } from "./mount"

interface PreviewProps {
  brandIr: BrandIr
  layoutSpec: LayoutSpec
  contentSpec: ContentSpec
  assetsBaseUrl: string
  maxWidthPx: number
  selectedLayerId?: string | null
  selectedArea?: [number, number, number, number] | null
  onSelectLayer?(id: string | null): void
  onAreaChange?(id: string, area: [number, number, number, number]): void
}

interface PointerSession {
  id: string
  action: "move" | "resize"
  startClientX: number
  startClientY: number
  startArea: [number, number, number, number]
  layerElement: HTMLElement | null
  hasMoved: boolean
}

const DRAG_START_THRESHOLD_PX = 3

function clampArea(
  area: [number, number, number, number],
  canvas: LayoutSpec["canvas"],
): [number, number, number, number] {
  const width = Math.max(8, Math.min(Math.round(area[2]), canvas.widthPx))
  const height = Math.max(8, Math.min(Math.round(area[3]), canvas.heightPx))
  const x = Math.max(0, Math.min(Math.round(area[0]), canvas.widthPx - width))
  const y = Math.max(0, Math.min(Math.round(area[1]), canvas.heightPx - height))
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
  onSelectLayer,
  onAreaChange,
}: PreviewProps): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const renderRootRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<RenderHandle | null>(null)
  const skippedInitialUpdate = useRef(false)
  const pointerSessionRef = useRef<PointerSession | null>(null)
  const liveAreaRef = useRef<[number, number, number, number] | null>(null)
  const selectionRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(1)
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

  const startInteraction = (
    event: ReactPointerEvent<HTMLDivElement>,
    id: string,
    action: "move" | "resize",
  ): void => {
    if (event.button !== 0 || !onAreaChange) return
    const element = findEditorElement(layoutSpec, id)
    if (!element) return
    const startArea = elementArea(element, contentSpec.overrides?.[id])
    pointerSessionRef.current = {
      id,
      action,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startArea,
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
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement
    const resizeHandle = target.closest<HTMLElement>("[data-resize-handle]")
    if (resizeHandle && selectedLayerId) {
      startInteraction(event, selectedLayerId, "resize")
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
    }
    const dx = clientDx / scaleRef.current
    const dy = clientDy / scaleRef.current
    const [x, y, width, height] = session.startArea
    const next =
      session.action === "move"
        ? clampArea([x + dx, y + dy, width, height], layoutSpec.canvas)
        : clampArea([x, y, width + dx, height + dy], layoutSpec.canvas)
    liveAreaRef.current = next
    applyLiveArea(session, next)
  }

  const finishInteraction = (commit: boolean): void => {
    const session = pointerSessionRef.current
    pointerSessionRef.current = null
    wrapperRef.current?.removeAttribute("data-dragging")
    if (!session) return
    const finalArea = liveAreaRef.current
    liveAreaRef.current = null
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
      clampArea(
        [
          selectedArea[0] + movement[0],
          selectedArea[1] + movement[1],
          selectedArea[2],
          selectedArea[3],
        ],
        layoutSpec.canvas,
      ),
    )
  }

  return (
    <div
      ref={wrapperRef}
      className="preview-canvas preview-canvas-editable"
      data-testid="preview-canvas"
      style={{
        width: "100%",
        maxWidth: `${maximumWidth}px`,
        aspectRatio: `${layoutSpec.canvas.widthPx} / ${layoutSpec.canvas.heightPx}`,
      }}
    >
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
            role="button"
            tabIndex={0}
            aria-label={`Camada ${selectedLabel ?? selectedLayerId} selecionada. Arraste para mover ou use as setas do teclado.`}
            aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
            onKeyDown={nudgeSelection}
            style={{
              left: `${selectedArea[0]}px`,
              top: `${selectedArea[1]}px`,
              width: `${selectedArea[2]}px`,
              height: `${selectedArea[3]}px`,
            }}
          >
            <span className="canvas-selection-label">{selectedLabel ?? selectedLayerId}</span>
            <span className="canvas-resize-handle" data-resize-handle aria-hidden="true" />
          </div>
        ) : null}
      </div>
    </div>
  )
}
