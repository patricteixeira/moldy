import { useEffect, useMemo, useRef, useState } from "react"
import type { JSX } from "react"
import type { BrandIr, ContentSpec, LayoutSpec } from "../api/types"
import { mountRender, type RenderHandle } from "./mount"

interface PreviewProps {
  brandIr: BrandIr
  layoutSpec: LayoutSpec
  contentSpec: ContentSpec
  assetsBaseUrl: string
  maxWidthPx: number
}

export function Preview({
  brandIr,
  layoutSpec,
  contentSpec,
  assetsBaseUrl,
  maxWidthPx,
}: PreviewProps): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const renderRootRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<RenderHandle | null>(null)
  const skippedInitialUpdate = useRef(false)
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

  return (
    <div
      ref={wrapperRef}
      className="preview-canvas"
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
      >
        <div ref={renderRootRef} />
      </div>
    </div>
  )
}
