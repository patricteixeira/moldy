import { useEffect, useMemo, useState, type JSX } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { ApiError } from "../api/client"
import { useApi } from "../api/context"
import type {
  BrandIr,
  ContentSpec,
  LayerOverride,
  LayoutSpec,
  ShapeLayer,
  Slot,
  SlotValue,
  SurfaceStyle,
} from "../api/types"
import { brandThemeStyle } from "../brandTheme"
import { placeholderContent } from "../kit/placeholder"
import { Preview } from "../render/Preview"
import { ExportControls } from "./ExportControls"
import { LayerPanel } from "./LayerPanel"
import { SlotForm } from "./SlotForm"
import { materializeContentLayout } from "./contentLayout"
import { clearEditorDraft, loadEditorDraft, saveEditorDraft } from "./draftStorage"
import { directionApplication } from "./direction"
import { exactOccurrenceCount } from "./emphasis"
import { editorElements, elementArea, findEditorElement } from "./layerModel"

interface EditorPageProps {
  pollIntervalMs?: number
}

interface EditorData {
  brandIr: BrandIr
  layouts: LayoutSpec[]
  carousel: {
    id: string
    name: string
    slideId: string
    position: number
    total: number
    previous: CarouselSlideTarget | null
    next: CarouselSlideTarget | null
    content: ContentSpec
  } | null
}

interface CarouselSlideTarget {
  layoutId: string
  slideId: string
  position: number
}

type CarouselSaveState = "idle" | "pending" | "saving" | "saved" | "error"

class EditorContextError extends Error {}

export type AddedElementKind = "text" | "signature" | "image" | "logo" | "shape"

function initialSelection(layout: LayoutSpec): string | null {
  return (
    layout.slots.find((slot) => slot.id === "headline")?.id ??
    layout.slots.find((slot) => slot.kind === "text")?.id ??
    editorElements(layout)[0]?.id ??
    null
  )
}

function applyInitialHeadline(
  layout: LayoutSpec,
  content: ContentSpec,
  headline: string,
): ContentSpec {
  if (!headline) return content
  const slot =
    layout.slots.find(
      (candidate) =>
        candidate.kind === "text" &&
        ["headline", "title", "quote"].includes(candidate.id),
    ) ??
    layout.slots.find(
      (candidate) =>
        candidate.kind === "text" &&
        (candidate.role === "heading" || candidate.role === "display"),
    )
  if (!slot) return content
  return {
    ...content,
    values: {
      ...content.values,
      [slot.id]: { kind: "text", text: headline },
    },
  }
}

function compactOverride(override: LayerOverride): LayerOverride | null {
  const entries = Object.entries(override).filter(([, value]) => value !== undefined)
  return entries.length > 0 ? (Object.fromEntries(entries) as LayerOverride) : null
}

function overrideSignature(override: LayerOverride | undefined): string {
  return JSON.stringify(
    Object.entries(override ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  )
}

export function EditorPage({ pollIntervalMs = 1000 }: EditorPageProps): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const { revisionId, layoutId } = useParams()
  const [searchParams] = useSearchParams()
  const carouselId = searchParams.get("carouselId")
  const carouselSlideId = searchParams.get("slideId")
  const initialHeadline =
    carouselId || carouselSlideId
      ? ""
      : (searchParams.get("headline")?.trim().slice(0, 180) ?? "")
  const carouselDraftScope =
    carouselId && carouselSlideId ? `${carouselId}:${carouselSlideId}` : null
  const draftContextKey =
    revisionId && layoutId
      ? `${revisionId}:${layoutId}:${carouselDraftScope ?? "individual"}`
      : null
  const [data, setData] = useState<EditorData | null>(null)
  const [values, setValues] = useState<Record<string, SlotValue>>({})
  const [overrides, setOverrides] = useState<Record<string, LayerOverride>>({})
  const [surface, setSurface] = useState<SurfaceStyle | null>(null)
  const [addedSlots, setAddedSlots] = useState<Slot[]>([])
  const [addedLayers, setAddedLayers] = useState<ShapeLayer[]>([])
  const [backgroundColorToken, setBackgroundColorToken] = useState<string | null>(null)
  const [assetBindings, setAssetBindings] = useState<Record<string, string>>({})
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(50)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [readyDraftContextKey, setReadyDraftContextKey] = useState<string | null>(null)
  const [draftSaved, setDraftSaved] = useState(true)
  const [carouselSaveState, setCarouselSaveState] = useState<CarouselSaveState>("idle")
  const [carouselSaveError, setCarouselSaveError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setData(null)
    setError(null)
    setValues({})
    setOverrides({})
    setSurface(null)
    setAddedSlots([])
    setAddedLayers([])
    setBackgroundColorToken(null)
    setAssetBindings({})
    setSelectedLayerId(null)
    setUploading(false)
    setExporting(false)
    setReadyDraftContextKey(null)
    setDraftSaved(true)
    setCarouselSaveState("idle")
    setCarouselSaveError(null)

    if (!revisionId) {
      setError("Revisão de marca não encontrada.")
      return () => {
        active = false
      }
    }

    if (Boolean(carouselId) !== Boolean(carouselSlideId)) {
      setError("A referência do slide está incompleta. Volte ao carrossel e abra o slide novamente.")
      return () => {
        active = false
      }
    }

    void Promise.all([
      api.getBrandRevision(revisionId),
      api.getKit(revisionId),
      carouselId ? api.getCarousel(carouselId) : Promise.resolve(null),
    ])
      .then(([brandIr, kitLayouts, carousel]) => {
        if (!active) return
        if (carousel && carousel.brandRevisionId !== revisionId) {
          throw new EditorContextError("O slide não pertence a esta revisão de marca.")
        }
        const carouselSlide = carousel?.slides.find((candidate) => candidate.id === carouselSlideId)
        const carouselSlideIndex = carouselSlide
          ? (carousel?.slides.findIndex((candidate) => candidate.id === carouselSlide.id) ?? -1)
          : -1
        const slideTarget = (index: number): CarouselSlideTarget | null => {
          const candidate = carousel?.slides[index]
          return candidate
            ? {
                layoutId: candidate.layoutId,
                slideId: candidate.id,
                position: candidate.position,
              }
            : null
        }
        if (carousel && !carouselSlide) {
          throw new EditorContextError("O slide não foi encontrado neste carrossel.")
        }
        if (carouselSlide && carouselSlide.layoutId !== layoutId) {
          throw new EditorContextError("O endereço do editor não corresponde ao modelo deste slide.")
        }
        const layouts = carouselSlide
          ? [
              ...kitLayouts.filter((candidate) => candidate.id !== carouselSlide.layoutId),
              carouselSlide.layout,
            ]
          : kitLayouts
        const activeLayout = layouts.find((candidate) => candidate.id === layoutId)
        setData({
          brandIr,
          layouts,
          carousel:
            carousel && carouselSlide
              ? {
                  id: carousel.id,
                  name: carousel.name,
                  slideId: carouselSlide.id,
                  position: carouselSlide.position,
                  total: carousel.slides.length,
                  previous: slideTarget(carouselSlideIndex - 1),
                  next: slideTarget(carouselSlideIndex + 1),
                  content: carouselSlide.content,
                }
              : null,
        })
        if (activeLayout) {
          const stored = loadEditorDraft(revisionId, activeLayout, carouselDraftScope)
          const baseSample =
            carouselSlide?.content ?? placeholderContent(activeLayout, revisionId, brandIr)
          const sample = carouselSlide
            ? baseSample
            : applyInitialHeadline(activeLayout, baseSample, initialHeadline)
          const hasStoredDraft =
            Object.keys(stored.values).length > 0 ||
            Object.keys(stored.overrides).length > 0 ||
            stored.surface !== null ||
            stored.addedSlots.length > 0 ||
            stored.addedLayers.length > 0 ||
            stored.backgroundColorToken !== null ||
            Object.keys(stored.assetBindings).length > 0
          setValues(hasStoredDraft ? stored.values : sample.values)
          setOverrides(hasStoredDraft ? stored.overrides : (sample.overrides ?? {}))
          setSurface(hasStoredDraft ? stored.surface : (sample.surface ?? null))
          setAddedSlots(hasStoredDraft ? stored.addedSlots : (sample.addedSlots ?? []))
          setAddedLayers(hasStoredDraft ? stored.addedLayers : (sample.addedLayers ?? []))
          setBackgroundColorToken(
            hasStoredDraft ? stored.backgroundColorToken : (sample.backgroundColorToken ?? null),
          )
          setAssetBindings(hasStoredDraft ? stored.assetBindings : (sample.assetBindings ?? {}))
          setSelectedLayerId(
            initialSelection(
              materializeContentLayout(activeLayout, {
                addedSlots: hasStoredDraft ? stored.addedSlots : sample.addedSlots,
                addedLayers: hasStoredDraft ? stored.addedLayers : sample.addedLayers,
              }),
            ),
          )
        }
        setReadyDraftContextKey(draftContextKey)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(
          caught instanceof ApiError
            ? caught.messagePt
            : caught instanceof EditorContextError
              ? caught.message
              : "Não foi possível abrir o editor.",
        )
      })

    return () => {
      active = false
    }
  }, [
    api,
    carouselDraftScope,
    carouselId,
    carouselSlideId,
    draftContextKey,
    initialHeadline,
    layoutId,
    revisionId,
  ])

  const layout = useMemo(
    () => data?.layouts.find((candidate) => candidate.id === layoutId) ?? null,
    [data, layoutId],
  )

  const contentSpec = useMemo<ContentSpec | null>(
    () =>
      revisionId && layout
        ? {
            layoutId: layout.id,
            brandRevisionId: revisionId,
            values,
            overrides,
            surface,
            addedSlots,
            addedLayers,
            backgroundColorToken,
            assetBindings,
          }
        : null,
    [
      addedLayers,
      addedSlots,
      assetBindings,
      backgroundColorToken,
      layout,
      overrides,
      revisionId,
      surface,
      values,
    ],
  )

  const activeLayout = useMemo(
    () => (layout && contentSpec ? materializeContentLayout(layout, contentSpec) : null),
    [contentSpec, layout],
  )

  const previewContentSpec = useMemo<ContentSpec | null>(() => {
    if (!contentSpec) return null
    const previewValues = Object.fromEntries(
      Object.entries(contentSpec.values).map(([slotId, value]) => {
        if (
          value.kind !== "text" ||
          !value.emphasis ||
          exactOccurrenceCount(value.text, value.emphasis) === 1
        ) {
          return [slotId, value]
        }
        return [slotId, { ...value, emphasis: undefined }]
      }),
    )
    return { ...contentSpec, values: previewValues }
  }, [contentSpec])

  useEffect(() => {
    if (!draftContextKey || readyDraftContextKey !== draftContextKey || !revisionId || !layout) return
    setDraftSaved(
      saveEditorDraft(
        revisionId,
        layout.id,
        values,
        overrides,
        surface,
        addedSlots,
        addedLayers,
        backgroundColorToken,
        assetBindings,
        carouselDraftScope,
      ),
    )
    if (data?.carousel) {
      setCarouselSaveState((current) => (current === "saved" ? "pending" : current))
    }
  }, [
    addedLayers,
    addedSlots,
    assetBindings,
    backgroundColorToken,
    carouselDraftScope,
    data?.carousel?.id,
    draftContextKey,
    layout,
    overrides,
    readyDraftContextKey,
    revisionId,
    surface,
    values,
  ])

  if (error) {
    return (
      <main id="main-content" className="editor-page editor-state-page">
        <p role="alert">{error}</p>
      </main>
    )
  }

  if (!data) {
    return (
      <main id="main-content" className="editor-page editor-state-page">
        <p className="loading-note" role="status">Preparando o editor…</p>
      </main>
    )
  }

  if (!layout || !activeLayout || !contentSpec || !previewContentSpec || !revisionId) {
    return (
      <main id="main-content" className="editor-page editor-state-page">
        <p role="alert">Modelo não encontrado neste kit.</p>
      </main>
    )
  }

  const changeValue = (slotId: string, value: SlotValue | null): void => {
    setValues((current) => {
      if (value === null) {
        const { [slotId]: _removed, ...remaining } = current
        return remaining
      }
      return { ...current, [slotId]: value }
    })
  }

  const patchOverride = (elementId: string, patch: Partial<LayerOverride>): void => {
    setOverrides((current) => {
      const nextOverride = compactOverride({ ...(current[elementId] ?? {}), ...patch })
      if (nextOverride) return { ...current, [elementId]: nextOverride }
      const { [elementId]: _removed, ...remaining } = current
      return remaining
    })
  }

  const resetLayer = (elementId: string): void => {
    setOverrides((current) => {
      const { [elementId]: _removed, ...remaining } = current
      return remaining
    })
  }

  const applyBrandDirection = (): void => {
    const application = directionApplication(data.brandIr, layout)
    if (!application) return
    setSurface(application.surface)
    setOverrides((current) => {
      const next = { ...current }
      for (const [elementId, patch] of Object.entries(application.patches)) {
        const merged = compactOverride({ ...(next[elementId] ?? {}), ...patch })
        if (merged) next[elementId] = merged
      }
      return next
    })
  }

  const restoreComposition = (): void => {
    const sample = data.carousel?.content ?? placeholderContent(layout, revisionId, data.brandIr)
    clearEditorDraft(revisionId, layout.id, carouselDraftScope)
    setValues(sample.values)
    setOverrides(sample.overrides ?? {})
    setSurface(sample.surface ?? null)
    setAddedSlots(sample.addedSlots ?? [])
    setAddedLayers(sample.addedLayers ?? [])
    setBackgroundColorToken(sample.backgroundColorToken ?? null)
    setAssetBindings(sample.assetBindings ?? {})
    setSelectedLayerId(initialSelection(materializeContentLayout(layout, sample)))
    setDraftSaved(true)
  }

  const nextElementId = (prefix: string): string => {
    const ids = new Set([
      ...activeLayout.slots.map((slot) => slot.id),
      ...(activeLayout.lockedLayers ?? []).map((layer) => layer.id),
    ])
    let index = 1
    while (ids.has(`user-${prefix}-${index}`)) index += 1
    return `user-${prefix}-${index}`
  }

  const addElement = (kind: AddedElementKind): void => {
    const { widthPx: width, heightPx: height, safeAreaPx: safe } = layout.canvas
    const captionRole = data.brandIr.roles.caption ? "caption" : "body"
    const bodyRole = data.brandIr.roles.body ? "body" : (Object.keys(data.brandIr.roles)[0] ?? "body")
    const accentToken =
      (data.brandIr.colors["color.secondary"] && "color.secondary") ||
      (data.brandIr.colors["color.primary"] && "color.primary") ||
      (data.brandIr.colors["color.text"] && "color.text") ||
      Object.keys(data.brandIr.colors)[0] ||
      "color.text"

    if (kind === "shape") {
      const id = nextElementId("shape")
      setAddedLayers((current) => [
        ...current,
        {
          id,
          kind: "shape",
          shape: "rectangle",
          area: [safe, Math.round(height * 0.5), Math.round(width * 0.32), 6],
          colorToken: accentToken,
          opacity: 1,
          zIndex: 6,
        },
      ])
      setSelectedLayerId(id)
      return
    }

    const prefix = kind === "signature" ? "signature" : kind
    const id = nextElementId(prefix)
    let slot: Slot
    let value: SlotValue | null = null
    if (kind === "text" || kind === "signature") {
      const signature = kind === "signature"
      slot = {
        id,
        kind: "text",
        role: signature ? captionRole : bodyRole,
        area: signature
          ? [safe, height - safe - Math.round(height * 0.06), Math.round(width * 0.48), Math.round(height * 0.05)]
          : [safe, Math.round(height * 0.42), Math.round(width * 0.62), Math.round(height * 0.18)],
        fit: "shrink-within-role-range",
        required: false,
        maxChars: signature ? 72 : 320,
        zIndex: 10,
        ...(signature ? { letterSpacingEm: 0.08 } : {}),
      }
      const handle = data.brandIr.brand.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .replace(/[^a-z0-9]+/g, "")
      value = {
        kind: "text",
        text: signature ? `@${handle || "sua-marca"}` : "Novo bloco de texto",
      }
    } else if (kind === "image") {
      slot = {
        id,
        kind: "image",
        area: [safe, Math.round(height * 0.28), width - safe * 2, Math.round(height * 0.44)],
        fit: "fixed",
        required: false,
        minResolution: [Math.round(width * 0.5), Math.round(height * 0.35)],
        zIndex: 4,
      }
    } else {
      const size = Math.max(96, Math.round(width * 0.16))
      slot = {
        id,
        kind: "logo",
        assetToken: "logo.primary",
        area: [width - safe - size, height - safe - size, size, size],
        fit: "fixed",
        required: false,
        zIndex: 9,
      }
    }
    setAddedSlots((current) => [...current, slot])
    if (value) setValues((current) => ({ ...current, [id]: value }))
    setSelectedLayerId(id)
  }

  const removeElement = (elementId: string): void => {
    if (!elementId.startsWith("user-")) return
    setAddedSlots((current) => current.filter((slot) => slot.id !== elementId))
    setAddedLayers((current) => current.filter((layer) => layer.id !== elementId))
    setValues((current) => {
      const { [elementId]: _removed, ...remaining } = current
      return remaining
    })
    setOverrides((current) => {
      const { [elementId]: _removed, ...remaining } = current
      return remaining
    })
    setAssetBindings((current) => {
      if (!(elementId in current)) return current
      const { [elementId]: _removed, ...remaining } = current
      return remaining
    })
    setSelectedLayerId(initialSelection(layout))
  }

  const duplicateElement = (elementId: string): void => {
    if (!elementId.startsWith("user-")) return
    const slot = addedSlots.find((item) => item.id === elementId)
    const layer = addedLayers.find((item) => item.id === elementId)
    const prefix = elementId.split("-").slice(1, -1).join("-") || "element"
    const id = nextElementId(prefix)
    const moveArea = (area: [number, number, number, number]) => {
      const [x, y, width, height] = area
      return [
        Math.max(0, Math.min(layout.canvas.widthPx - width, x + 24)),
        Math.max(0, Math.min(layout.canvas.heightPx - height, y + 24)),
        width,
        height,
      ] as [number, number, number, number]
    }
    if (slot) {
      setAddedSlots((current) => [...current, { ...slot, id, area: moveArea(slot.area) }])
      const value = values[elementId]
      if (value) setValues((current) => ({ ...current, [id]: { ...value } }))
      const assetBinding = assetBindings[elementId]
      if (slot.kind === "logo" && assetBinding) {
        setAssetBindings((current) => ({ ...current, [id]: assetBinding }))
      }
    } else if (layer) {
      setAddedLayers((current) => [...current, { ...layer, id, area: moveArea(layer.area) }])
    } else {
      return
    }
    const sourceOverride = overrides[elementId]
    if (sourceOverride) {
      setOverrides((current) => ({
        ...current,
        [id]: {
          ...sourceOverride,
          ...(sourceOverride.area ? { area: moveArea(sourceOverride.area) } : {}),
        },
      }))
    }
    setSelectedLayerId(id)
  }

  const persistCarouselSlide = async (): Promise<boolean> => {
    if (!data.carousel) return false
    setCarouselSaveState("saving")
    setCarouselSaveError(null)
    try {
      const updated = await api.updateCarouselSlide(
        data.carousel.id,
        data.carousel.slideId,
        contentSpec,
      )
      setData((current) =>
        current?.carousel
          ? {
              ...current,
              carousel: { ...current.carousel, content: updated.content },
            }
          : current,
      )
      setCarouselSaveState("saved")
      return true
    } catch (caught: unknown) {
      setCarouselSaveState("error")
      setCarouselSaveError(
        caught instanceof ApiError
          ? caught.messagePt
          : "Não foi possível salvar este slide no carrossel.",
      )
      return false
    }
  }

  const saveCarouselSlide = async (): Promise<void> => {
    await persistCarouselSlide()
  }

  const openCarouselSlide = async (target: CarouselSlideTarget | null): Promise<void> => {
    if (!data.carousel || !target || carouselSaveState === "saving") return
    const saved = await persistCarouselSlide()
    if (!saved) return
    navigate(
      `/marcas/${encodeURIComponent(revisionId)}/editor/${encodeURIComponent(target.layoutId)}?carouselId=${encodeURIComponent(data.carousel.id)}&slideId=${encodeURIComponent(target.slideId)}`,
    )
  }

  const selectedElement = findEditorElement(activeLayout, selectedLayerId)
  const selectedArea = selectedElement
    ? elementArea(selectedElement, overrides[selectedElement.id])
    : null
  const selectedRotation = selectedElement
    ? (overrides[selectedElement.id]?.rotationDeg ?? 0)
    : 0
  const sampleOverrides =
    data.carousel?.content.overrides ??
    placeholderContent(layout, revisionId, data.brandIr).overrides ??
    {}
  const changedLayerCount = [
    ...new Set([...Object.keys(sampleOverrides), ...Object.keys(overrides)]),
  ].filter(
      (id) => overrideSignature(overrides[id]) !== overrideSignature(sampleOverrides[id]),
    ).length

  return (
    <main
      id="main-content"
      className="editor-page brand-reactive-editor"
      style={brandThemeStyle(data.brandIr)}
    >
      <header className="editor-toolbar">
        <div
          className="editor-toolbar-context"
          data-carousel={data.carousel ? "true" : undefined}
        >
          <Link
            className="editor-back"
            to={
              data.carousel
                ? `/marcas/${encodeURIComponent(revisionId)}/carrossel?carouselId=${encodeURIComponent(data.carousel.id)}`
                : `/marcas/${encodeURIComponent(revisionId)}/kit`
            }
          >
            <span aria-hidden="true">←</span>
            {data.carousel ? "Carrossel" : "Modelos"}
          </Link>
          <span className="editor-toolbar-rule" aria-hidden="true" />
          {data.carousel ? (
            <nav className="editor-slide-navigation" aria-label="Navegação entre slides">
              <button
                type="button"
                aria-label="Slide anterior"
                disabled={!data.carousel.previous || carouselSaveState === "saving"}
                onClick={() => void openCarouselSlide(data.carousel?.previous ?? null)}
              >
                <span aria-hidden="true">←</span>
              </button>
              <span aria-label={`Slide ${data.carousel.position} de ${data.carousel.total}`}>
                {String(data.carousel.position).padStart(2, "0")} / {String(data.carousel.total).padStart(2, "0")}
              </span>
              <button
                type="button"
                aria-label="Próximo slide"
                disabled={!data.carousel.next || carouselSaveState === "saving"}
                onClick={() => void openCarouselSlide(data.carousel?.next ?? null)}
              >
                <span aria-hidden="true">→</span>
              </button>
            </nav>
          ) : null}
          <div>
            <strong>{data.brandIr.brand.name}</strong>
            <span>
              {data.carousel
                ? `${data.carousel.name} · slide ${String(data.carousel.position).padStart(2, "0")}`
                : layout.namePt}
            </span>
          </div>
        </div>
        <div className="editor-toolbar-status" role="status" aria-live="polite">
          <span data-saved={draftSaved || undefined} aria-hidden="true" />
          {draftSaved ? "Salvo localmente" : "Rascunho não salvo"}
          {changedLayerCount > 0 ? <b>{changedLayerCount} ajustes</b> : null}
        </div>
        <div className="editor-toolbar-actions">
          {data.carousel ? (
            <button
              type="button"
              className="editor-carousel-save"
              disabled={carouselSaveState === "saving"}
              onClick={() => void saveCarouselSlide()}
            >
              {carouselSaveState === "saving"
                ? "Salvando…"
                : carouselSaveState === "saved"
                  ? "Salvo no carrossel"
                  : carouselSaveState === "pending"
                    ? "Salvar alterações"
                    : "Salvar no carrossel"}
            </button>
          ) : null}
          <label className="zoom-control">
            <span>Zoom</span>
            <input
              name="editor-zoom"
              type="range"
              min="25"
              max="100"
              step="5"
              value={zoom}
              onChange={(event) => setZoom(Number(event.currentTarget.value))}
            />
            <output>{zoom}%</output>
          </label>
          <a className="editor-export-jump" href="#export-panel">Baixar</a>
          {carouselSaveError ? (
            <span className="editor-carousel-save-error" role="alert">
              {carouselSaveError}
            </span>
          ) : null}
        </div>
      </header>

      <div className="editor-workbench">
        <section className="editor-preview" aria-label="Área da peça">
          <div className="canvas-ruler canvas-ruler-horizontal" aria-hidden="true" />
          <div className="canvas-ruler canvas-ruler-vertical" aria-hidden="true" />
          <div className="editor-quick-guide" aria-label="Como editar">
            <span><strong>1. Selecione</strong> um item na peça.</span>
            <span><strong>2. Edite</strong> no painel ao lado.</span>
            <span><strong>3. Baixe</strong> o arquivo no fim da página.</span>
            <details>
              <summary>Atalhos de precisão</summary>
              <p>Arraste para mover. Use as alças para redimensionar e o ponto circular para girar. Alt move livremente e Shift encaixa a rotação.</p>
            </details>
          </div>
          <Preview
            brandIr={data.brandIr}
            layoutSpec={activeLayout}
            contentSpec={previewContentSpec}
            assetsBaseUrl={api.revisionAssetsBaseUrl(revisionId)}
            maxWidthPx={Math.round(layout.canvas.widthPx * (zoom / 100))}
            selectedLayerId={selectedLayerId}
            selectedArea={selectedArea}
            selectedRotation={selectedRotation}
            onSelectLayer={setSelectedLayerId}
            onAreaChange={(id, area) => patchOverride(id, { area })}
            onRotationChange={(id, rotationDeg) => patchOverride(id, { rotationDeg })}
          />
        </section>

        <LayerPanel
          layout={activeLayout}
          overrides={overrides}
          selectedId={selectedLayerId}
          onSelect={setSelectedLayerId}
          onPatch={patchOverride}
          onResetAll={restoreComposition}
          onAdd={addElement}
          onDelete={removeElement}
          onDuplicate={duplicateElement}
        />

        <SlotForm
          brandIr={data.brandIr}
          layout={activeLayout}
          selectedId={selectedLayerId}
          values={values}
          overrides={overrides}
          onChange={changeValue}
          onPatch={patchOverride}
          onReset={resetLayer}
          surface={surface}
          onSurfaceChange={setSurface}
          onApplyDirection={applyBrandDirection}
          backgroundColorToken={backgroundColorToken}
          onBackgroundColorChange={setBackgroundColorToken}
          assetBindings={assetBindings}
          onAssetBindingChange={(slotId, assetToken) =>
            setAssetBindings((current) => {
              if (assetToken === null) {
                const { [slotId]: _removed, ...remaining } = current
                return remaining
              }
              return { ...current, [slotId]: assetToken }
            })
          }
          onUploadingChange={setUploading}
          disabled={exporting}
        />
      </div>

      <section id="export-panel" className="editor-guard-export" data-testid="editor-guard-export">
        <div className="export-panel-heading">
          <p className="panel-kicker">Arquivo final</p>
          <h2>Baixar arquivo</h2>
          <p>Escolha o formato e faça o download.</p>
        </div>
        <ExportControls
          disabled={uploading}
          layout={layout}
          pollIntervalMs={pollIntervalMs}
          revisionId={revisionId}
          values={values}
          overrides={overrides}
          addedSlots={addedSlots}
          addedLayers={addedLayers}
          surface={surface}
          backgroundColorToken={backgroundColorToken}
          assetBindings={assetBindings}
          onPendingChange={setExporting}
        />
      </section>
    </main>
  )
}
