import { useEffect, useMemo, useState } from "react"
import type { JSX } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { ApiError, contentAddressedPath } from "../api/client"
import { useApi } from "../api/context"
import type {
  BrandIr,
  Carousel,
  ContentSpec,
  CarouselProfile,
  CarouselSignature,
  CarouselSlideInput,
  LayoutSpec,
} from "../api/types"
import { brandThemeStyle } from "../brandTheme"
import {
  hasAutomaticLogoPair,
  logoAssetLabel,
  logoAssetTokens,
  uniqueLogoCount,
} from "../logoAssets"
import { Preview } from "../render/Preview"
import { placeholderContent } from "../kit/placeholder"
import { templateFamilyKey, templateFamilyLabel } from "../kit/templateFamilies"
import {
  recommendationIsBrandLed,
  recommendedTemplateLayouts,
  type TemplateCatalogMode,
} from "../kit/templateRecommendations"

const MIN_SLIDES = 3
const MAX_SLIDES = 20

interface TemplateHoverPreview {
  layout: LayoutSpec
  content: ContentSpec
  left: number
  top: number
}

function emptySlide(): CarouselSlideInput {
  return {
    kicker: "",
    headline: "",
    textBlocks: [],
    cta: "",
    layoutId: null,
    imageSha256: null,
    backgroundColorToken: null,
    textColorToken: null,
    logoAssetToken: null,
  }
}

function initialSlides(count: number): CarouselSlideInput[] {
  return Array.from({ length: count }, emptySlide)
}

function roleFor(index: number, total: number): "Capa" | "Conteúdo" | "Fechamento" {
  if (index === 0) return "Capa"
  if (index === total - 1) return "Fechamento"
  return "Conteúdo"
}

function resizeSlides(current: CarouselSlideInput[], count: number): CarouselSlideInput[] {
  const cover = current[0] ?? emptySlide()
  const closing = current.at(-1) ?? emptySlide()
  const currentContent = current.slice(1, -1)
  const content = Array.from(
    { length: count - 2 },
    (_, index) => currentContent[index] ?? emptySlide(),
  )
  return [cover, ...content, closing]
}

function compatibleLayouts(layouts: LayoutSpec[], profile: CarouselProfile): LayoutSpec[] {
  return layouts.filter((layout) => layout.profile === profile)
}

function baseLayouts(layouts: LayoutSpec[]): LayoutSpec[] {
  const withoutAlternatives = layouts.filter((layout) => !layout.id.endsWith("-alternative"))
  return withoutAlternatives.length > 0 ? withoutAlternatives : layouts
}

function sequenceLayoutIds(layouts: LayoutSpec[], count: number): string[] {
  if (layouts.length === 0) return Array.from({ length: count }, () => "")
  const bases = baseLayouts(layouts)
  const cover = bases[0] ?? layouts[0]
  const closing = bases.at(-1) ?? cover
  const content = bases.slice(1, -1)
  const middle = content.length > 0 ? content : bases
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return cover.id
    if (index === count - 1) return closing.id
    return middle[(index - 1) % middle.length].id
  })
}

function withCompatibleLayouts(
  slides: CarouselSlideInput[],
  layouts: LayoutSpec[],
  profile: CarouselProfile,
): CarouselSlideInput[] {
  const compatible = compatibleLayouts(layouts, profile)
  const validIds = new Set(compatible.map((layout) => layout.id))
  return slides.map((slide) => ({
    ...slide,
    layoutId: slide.layoutId && validIds.has(slide.layoutId) ? slide.layoutId : null,
  }))
}

function humanizeToken(token: string, prefix: string): string {
  const standardLabels: Record<string, string> = {
    "color.primary": "Principal",
    "color.secondary": "Secundária",
    "color.background": "Fundo",
    "color.text": "Texto",
    "logo.primary": "Principal",
    "logo.onLight": "Escura · para fundo claro",
    "logo.onDark": "Clara · para fundo escuro",
  }
  const known = standardLabels[token]
  if (known) return known
  const raw = token.startsWith(prefix) ? token.slice(prefix.length) : token
  const words = raw.replace(/([a-zà-ÿ])([A-ZÀ-Ý])/g, "$1 $2").replace(/[._-]+/g, " ").trim()
  return words ? `${words.charAt(0).toLocaleUpperCase("pt-BR")}${words.slice(1)}` : token
}

function carouselTemplateContent(
  layout: LayoutSpec,
  slide: CarouselSlideInput,
  revisionId: string,
  brandIr: BrandIr,
  signature: CarouselSignature,
): ContentSpec {
  const sample = carouselCatalogContent(layout, revisionId, brandIr)
  const values = { ...sample.values }
  const mainTextIds = new Set([
    "headline",
    "title",
    "quote",
    "headline-lead",
    "echo-near",
    "echo-far",
  ])
  for (const slot of layout.slots) {
    if (slot.kind === "image" && slide.imageSha256) {
      values[slot.id] = {
        kind: "image",
        path: contentAddressedPath(slide.imageSha256),
        sha256: slide.imageSha256,
      }
    } else if (slot.kind === "text" && mainTextIds.has(slot.id) && slide.headline.trim()) {
      values[slot.id] = { kind: "text", text: slide.headline.trim() }
    } else if (slot.kind === "text" && slot.id === "kicker" && slide.kicker.trim()) {
      values[slot.id] = { kind: "text", text: slide.kicker.trim() }
    } else if (slot.kind === "text" && slot.id === "cta" && slide.cta.trim()) {
      values[slot.id] = { kind: "text", text: slide.cta.trim() }
    } else if (slot.kind === "text" && slot.id.startsWith("body") && slide.textBlocks.length) {
      const bodyIndex = Number(slot.id.match(/\d+$/)?.[0] ?? "1") - 1
      values[slot.id] = {
        kind: "text",
        text: slide.textBlocks[Math.max(0, bodyIndex) % slide.textBlocks.length] || " ",
      }
    } else if (slot.kind === "text" && slot.id === "signature" && signature.text.trim()) {
      values[slot.id] = { kind: "text", text: signature.text.trim() }
    }
  }
  const assetBindings: Record<string, string> = {}
  if (slide.logoAssetToken) {
    for (const slot of layout.slots) {
      if (slot.kind === "logo") assetBindings[slot.id] = slide.logoAssetToken
    }
    for (const layer of layout.lockedLayers ?? []) {
      if (layer.kind === "asset") assetBindings[layer.id] = slide.logoAssetToken
    }
  }
  const overrides = { ...(sample.overrides ?? {}) }
  if (slide.textColorToken) {
    for (const slot of layout.slots) {
      if (slot.kind === "text") {
        overrides[slot.id] = {
          ...(overrides[slot.id] ?? {}),
          colorToken: slide.textColorToken,
        }
      }
    }
  }
  return {
    ...sample,
    values,
    overrides,
    assetBindings,
    backgroundColorToken: slide.backgroundColorToken,
  }
}

function carouselCatalogContent(
  layout: LayoutSpec,
  revisionId: string,
  brandIr: BrandIr,
): ContentSpec {
  const sample = placeholderContent(layout, revisionId, brandIr)
  if (layout.templateRef != null) return sample
  const ownedIds = new Set(layout.slots.map((slot) => slot.id))
  return {
    ...sample,
    values: Object.fromEntries(
      Object.entries(sample.values).filter(([slotId]) => ownedIds.has(slotId)),
    ),
    overrides: {},
    surface: null,
    addedSlots: [],
    addedLayers: [],
  }
}

const signaturePositions: Array<{
  value: `${CarouselSignature["vertical"]}-${CarouselSignature["horizontal"]}`
  label: string
}> = [
  { value: "top-left", label: "Superior esquerda" },
  { value: "top-center", label: "Superior centro" },
  { value: "top-right", label: "Superior direita" },
  { value: "bottom-left", label: "Inferior esquerda" },
  { value: "bottom-center", label: "Inferior centro" },
  { value: "bottom-right", label: "Inferior direita" },
]

export function CarouselPage(): JSX.Element {
  const { revisionId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedCarouselId = searchParams.get("carouselId")
  const api = useApi()
  const [brandIr, setBrandIr] = useState<BrandIr | null>(null)
  const [layouts, setLayouts] = useState<LayoutSpec[]>([])
  const [name, setName] = useState("")
  const [profile, setProfile] = useState<CarouselProfile>("post-4x5")
  const [slides, setSlides] = useState<CarouselSlideInput[]>(() => initialSlides(5))
  const [activeIndex, setActiveIndex] = useState(0)
  const [signature, setSignature] = useState<CarouselSignature>({
    text: "",
    vertical: "bottom",
    horizontal: "left",
  })
  const [carousel, setCarousel] = useState<Carousel | null>(null)
  const [pending, setPending] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [download, setDownload] = useState<{ url: string; filename: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [familyFilter, setFamilyFilter] = useState("all")
  const [catalogMode, setCatalogMode] = useState<TemplateCatalogMode>("recommended")
  const [uploadingImage, setUploadingImage] = useState(false)
  const [templateHoverPreview, setTemplateHoverPreview] =
    useState<TemplateHoverPreview | null>(null)

  useEffect(() => {
    if (!revisionId) {
      setError("A revisão da marca não foi informada.")
      return
    }
    let active = true
    void Promise.all([
      api.getBrandRevision(revisionId),
      api.getKit(revisionId),
      requestedCarouselId ? api.getCarousel(requestedCarouselId) : Promise.resolve(null),
    ])
      .then(([result, kit, savedCarousel]) => {
        if (!active) return
        if (savedCarousel && savedCarousel.brandRevisionId !== revisionId) {
          throw new Error("Este carrossel não pertence à revisão de marca aberta.")
        }
        setBrandIr(result)
        setLayouts(kit)
        if (savedCarousel) {
          setCarousel(savedCarousel)
          setName(savedCarousel.name)
          setProfile(savedCarousel.profile)
          setSignature(savedCarousel.signature)
          setSlides(savedCarousel.slides.map((slide) => slide.source))
          setActiveIndex(0)
        } else {
          setSlides((current) => withCompatibleLayouts(current, kit, profile))
        }
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(
          reason instanceof ApiError
            ? reason.messagePt
            : reason instanceof Error
              ? reason.message
              : "Não foi possível carregar a marca para o carrossel.",
        )
      })
    return () => {
      active = false
    }
  }, [api, profile, requestedCarouselId, revisionId])

  const activeSlide = slides[activeIndex]
  const activeRole = roleFor(activeIndex, slides.length)
  const formatLayouts = useMemo(
    () => compatibleLayouts(layouts, profile),
    [layouts, profile],
  )
  const recommendedFormatLayouts = useMemo(
    () => recommendedTemplateLayouts(formatLayouts),
    [formatLayouts],
  )
  const brandLedRecommendations = recommendationIsBrandLed(recommendedFormatLayouts)
  const visibleLayouts = useMemo(
    () => {
      if (catalogMode === "recommended") return recommendedFormatLayouts
      return familyFilter === "all"
        ? formatLayouts
        : formatLayouts.filter((layout) => templateFamilyKey(layout) === familyFilter)
    },
    [catalogMode, familyFilter, formatLayouts, recommendedFormatLayouts],
  )
  const templateFamilies = useMemo(
    () =>
      Array.from(new Set(formatLayouts.map(templateFamilyKey))).sort((left, right) =>
        templateFamilyLabel(left).localeCompare(templateFamilyLabel(right), "pt-BR"),
      ),
    [formatLayouts],
  )
  const formatLayoutById = useMemo(
    () => new Map(formatLayouts.map((layout) => [layout.id, layout])),
    [formatLayouts],
  )
  const activeLayout = formatLayouts.find((layout) => layout.id === activeSlide.layoutId) ?? null
  const automaticPreviewLayouts = useMemo(() => {
    const withoutUnsupportedPhotos = recommendedFormatLayouts.filter(
      (layout) =>
        Boolean(activeSlide.imageSha256) || !layout.slots.some((slot) => slot.kind === "image"),
    )
    return (withoutUnsupportedPhotos.length > 0
      ? withoutUnsupportedPhotos
      : recommendedFormatLayouts
    ).slice(0, 3)
  }, [activeSlide.imageSha256, recommendedFormatLayouts])
  const canGenerate = useMemo(
    () =>
      Boolean(
        name.trim() &&
          formatLayouts.length > 0 &&
          slides.every((slide) => {
            if (!slide.headline.trim()) return false
            if (!slide.layoutId) return true
            const layout = formatLayoutById.get(slide.layoutId)
            if (!layout) return false
            const requiresImage = layout.slots.some(
              (slot) => slot.kind === "image" && slot.required,
            )
            return !requiresImage || Boolean(slide.imageSha256)
          }),
      ),
    [formatLayoutById, formatLayouts.length, name, slides],
  )

  const updateSlide = (change: Partial<CarouselSlideInput>) => {
    setSlides((current) =>
      current.map((slide, index) => (index === activeIndex ? { ...slide, ...change } : slide)),
    )
    setCarousel(null)
    setDownload(null)
  }

  const addTextBlock = () => {
    if (activeSlide.textBlocks.length >= 6) return
    updateSlide({ textBlocks: [...activeSlide.textBlocks, ""] })
  }

  const updateTextBlock = (index: number, text: string) => {
    updateSlide({
      textBlocks: activeSlide.textBlocks.map((block, blockIndex) =>
        blockIndex === index ? text : block,
      ),
    })
  }

  const removeTextBlock = (index: number) => {
    updateSlide({
      textBlocks: activeSlide.textBlocks.filter((_, blockIndex) => blockIndex !== index),
    })
  }

  const showTemplateHoverPreview = (
    layout: LayoutSpec,
    content: ContentSpec,
    anchor: HTMLElement,
  ): void => {
    const gap = 12
    const viewportInset = 16
    const width = Math.min(304, window.innerWidth - viewportInset * 2)
    const previewHeight = width * (layout.canvas.heightPx / layout.canvas.widthPx)
    const estimatedHeight = Math.min(window.innerHeight - viewportInset * 2, previewHeight + 82)
    const rect = anchor.getBoundingClientRect()
    let left = rect.right + gap
    if (left + width > window.innerWidth - viewportInset) left = rect.left - width - gap
    left = Math.max(viewportInset, Math.min(left, window.innerWidth - width - viewportInset))
    const top = Math.max(
      viewportInset,
      Math.min(rect.top, window.innerHeight - estimatedHeight - viewportInset),
    )
    setTemplateHoverPreview({ layout, content, left, top })
  }

  const applyAppearanceToAll = (
    field: "backgroundColorToken" | "textColorToken" | "logoAssetToken",
    value: string | null,
  ) => {
    setSlides((current) => current.map((slide) => ({ ...slide, [field]: value })))
    setCarousel(null)
    setDownload(null)
  }

  const applyFamilyToSequence = () => {
    if (!activeLayout) return
    const family = templateFamilyKey(activeLayout)
    const usesAlternative = activeLayout.id.endsWith("-alternative")
    const familyLayouts = formatLayouts.filter(
      (layout) =>
        templateFamilyKey(layout) === family &&
        layout.id.endsWith("-alternative") === usesAlternative,
    )
    const layoutIds = sequenceLayoutIds(familyLayouts, slides.length)
    setSlides((current) =>
      current.map((slide, index) => ({ ...slide, layoutId: layoutIds[index] })),
    )
    setCarousel(null)
    setDownload(null)
  }

  const uploadSlideImage = async (file: File | null) => {
    if (!file) return
    setUploadingImage(true)
    setError(null)
    try {
      const uploaded = await api.uploadAsset(file)
      updateSlide({ imageSha256: uploaded.sha256 })
      setStatus(`Imagem «${file.name}» pronta para este slide.`)
    } catch (reason: unknown) {
      setError(
        reason instanceof ApiError
          ? reason.messagePt
          : "Não foi possível preparar a imagem deste slide.",
      )
    } finally {
      setUploadingImage(false)
    }
  }

  const generate = async () => {
    if (!revisionId || !canGenerate) return
    if (slides.some((slide) => slide.textBlocks.some((block) => !block.trim()))) {
      setError("Preencha ou remova os blocos de texto vazios antes de gerar.")
      return
    }
    setPending(true)
    setError(null)
    setStatus(null)
    setDownload(null)
    try {
      const saved = await api.createCarousel({
        brandRevisionId: revisionId,
        name: name.trim(),
        profile,
        signature,
        slides,
      })
      setCarousel(saved)
      setSearchParams({ carouselId: saved.id }, { replace: true })
      setStatus(
        `${saved.slides.length} slides gerados e compostos: capa, ${saved.slides.length - 2} de conteúdo e fechamento. Cada um continua totalmente editável.`,
      )
    } catch (reason: unknown) {
      setError(
        reason instanceof ApiError
          ? reason.messagePt
          : "Não foi possível gerar o carrossel. Revise o conteúdo e tente novamente.",
      )
    } finally {
      setPending(false)
    }
  }

  const exportCarousel = async () => {
    if (!carousel) return
    setExporting(true)
    setError(null)
    setDownload(null)
    try {
      const { jobId } = await api.requestCarouselExport(carousel.id)
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const job = await api.getJob(jobId)
        if (job.status === "succeeded" && job.result) {
          setDownload({ url: job.result.url, filename: job.result.filename })
          setStatus("A série está pronta: um PNG numerado para cada slide.")
          return
        }
        if (job.status === "failed") {
          throw new Error(job.error ?? "A exportação do carrossel falhou.")
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000))
      }
      throw new Error("A exportação demorou mais que o esperado.")
    } catch (reason: unknown) {
      setError(
        reason instanceof ApiError
          ? reason.messagePt
          : reason instanceof Error
            ? reason.message
            : "Não foi possível exportar a série.",
      )
    } finally {
      setExporting(false)
    }
  }

  if (!brandIr || !revisionId) {
    return (
      <main id="main-content" className="carousel-page">
        {error ? <p role="alert">{error}</p> : <p role="status">Preparando o carrossel…</p>}
      </main>
    )
  }

  const signatureValue = `${signature.vertical}-${signature.horizontal}`
  const assetsBaseUrl = api.revisionAssetsBaseUrl(revisionId)
  const activeImageSlots = activeLayout?.slots.filter((slot) => slot.kind === "image") ?? []
  const activeNeedsImage = activeImageSlots.some((slot) => slot.required)

  return (
    <main
      id="main-content"
      className="carousel-page brand-reactive-page"
      style={brandThemeStyle(brandIr)}
    >
      <header className="carousel-heading" data-motion-enter>
        <div>
          <p className="product-kicker">Uma história, slide por slide</p>
          <h1>Modo Carrossel</h1>
          <p>
            Você escolhe a quantidade. O Molda organiza a capa, dá mais espaço ao conteúdo e
            fecha a sequência com intenção.
          </p>
        </div>
        <Link className="text-action" to={`/marcas/${encodeURIComponent(revisionId)}/kit`}>
          Voltar ao kit
        </Link>
      </header>

      <section className="carousel-setup" aria-labelledby="carousel-setup-title">
        <h2 id="carousel-setup-title" className="visually-hidden">Configuração do carrossel</h2>
        <div className="carousel-sequence-summary">
          <span><strong>01</strong><small>Capa</small></span>
          <i aria-hidden="true" />
          <span><strong>{Math.max(1, slides.length - 2)}</strong><small>Conteúdo</small></span>
          <i aria-hidden="true" />
          <span><strong>{String(slides.length).padStart(2, "0")}</strong><small>Fechamento</small></span>
        </div>

        <div className="carousel-setup-grid">
          <label>
            <span>Nome do carrossel</span>
            <input
              value={name}
              maxLength={160}
              autoComplete="off"
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="Ex.: O que sustenta uma marca"
            />
          </label>
          <label>
            <span>Quantidade de slides</span>
            <select
              value={slides.length}
              onChange={(event) => {
                const count = Number(event.currentTarget.value)
                setSlides((current) =>
                  withCompatibleLayouts(resizeSlides(current, count), layouts, profile),
                )
                setActiveIndex((current) => Math.min(current, count - 1))
                setCarousel(null)
              }}
            >
              {Array.from({ length: MAX_SLIDES - MIN_SLIDES + 1 }, (_, index) => {
                const count = MIN_SLIDES + index
                return <option key={count} value={count}>{count} slides</option>
              })}
            </select>
            <small>De 3 a 20. O primeiro e o último têm função própria.</small>
          </label>
          <label>
            <span>Formato de todos os arquivos</span>
            <select
              value={profile}
              onChange={(event) => {
                const nextProfile = event.currentTarget.value as CarouselProfile
                setProfile(nextProfile)
                setSlides((current) => withCompatibleLayouts(current, layouts, nextProfile))
                setFamilyFilter("all")
                setCarousel(null)
              }}
            >
              <option value="post-4x5">Retrato 4:5 · 1080 × 1350</option>
              <option value="post-1x1">Quadrado 1:1 · 1080 × 1080</option>
            </select>
          </label>
        </div>

        <fieldset className="carousel-signature">
          <legend>Assinatura repetida</legend>
          <p>Use @perfil, site, autoria ou uma frase curta. Escolha onde ela aparece.</p>
          <input
            aria-label="Texto da assinatura"
            value={signature.text}
            maxLength={80}
            onChange={(event) => {
              const text = event.currentTarget.value
              setSignature((current) => ({ ...current, text }))
              setCarousel(null)
            }}
            placeholder="@suaassinatura"
          />
          <div className="signature-position-grid">
            {signaturePositions.map((position) => (
              <label key={position.value}>
                <input
                  type="radio"
                  name="signature-position"
                  value={position.value}
                  checked={signatureValue === position.value}
                  onChange={() => {
                    const [vertical, horizontal] = position.value.split("-") as [
                      CarouselSignature["vertical"],
                      CarouselSignature["horizontal"],
                    ]
                    setSignature((current) => ({ ...current, vertical, horizontal }))
                    setCarousel(null)
                  }}
                />
                <span>{position.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="carousel-composer" aria-labelledby="carousel-composer-title">
        <div className="carousel-slide-rail" aria-label="Slides do carrossel">
          <h2 id="carousel-composer-title">Conteúdo da sequência</h2>
          <ol>
            {slides.map((slide, index) => (
              <li key={`${index}-${slides.length}`}>
                <button
                  type="button"
                  data-active={index === activeIndex || undefined}
                  onClick={() => setActiveIndex(index)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <span>
                    <strong>{roleFor(index, slides.length)}</strong>
                    <small>{slide.headline.trim() || "Sem título"}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>

        <div className="carousel-slide-form">
          <div className="carousel-slide-form-heading">
            <span>Slide {String(activeIndex + 1).padStart(2, "0")}</span>
            <strong>{activeRole}</strong>
          </div>
          <section className="carousel-template-picker" aria-labelledby="carousel-template-title">
            <div className="carousel-template-heading">
              <div>
                <p className="product-kicker">Composição do slide</p>
                <h3 id="carousel-template-title">
                  {catalogMode === "recommended"
                    ? "Deixe o conteúdo escolher a composição"
                    : "Escolha qualquer modelo do kit"}
                </h3>
                <p>
                  {catalogMode === "recommended"
                    ? brandLedRecommendations
                      ? "No modo inteligente, o Molda cruza a linguagem do manual com o papel e o conteúdo de cada slide. Você ainda pode assumir qualquer escolha."
                      : "No modo inteligente, o Molda monta uma sequência variada e honesta com os sinais disponíveis. Você ainda pode escolher manualmente."
                    : `${formatLayouts.length} modelos compatíveis com este formato. A escolha vale para o slide atual; você também pode aplicar a família inteira à sequência.`}
                </p>
              </div>
              <div className="carousel-template-controls">
                <div className="template-catalog-switch" aria-label="Abrangência do catálogo">
                  <button
                    type="button"
                    aria-pressed={catalogMode === "recommended"}
                    onClick={() => setCatalogMode("recommended")}
                  >
                    Sugestões
                    <span>{recommendedFormatLayouts.length}</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={catalogMode === "all"}
                    onClick={() => setCatalogMode("all")}
                  >
                    Todos
                    <span>{formatLayouts.length}</span>
                  </button>
                </div>
                {catalogMode === "all" ? (
                  <label>
                    <span>Família</span>
                    <select
                      aria-label="Família de templates"
                      value={familyFilter}
                      onChange={(event) => setFamilyFilter(event.currentTarget.value)}
                    >
                      <option value="all">Todas as famílias</option>
                      {templateFamilies.map((family) => (
                        <option key={family} value={family}>
                          {templateFamilyLabel(family)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              className="carousel-auto-choice"
              aria-label="Usar composição inteligente"
              aria-pressed={!activeSlide.layoutId}
              data-active={!activeSlide.layoutId || undefined}
              onClick={() => updateSlide({ layoutId: null })}
            >
              <span className="carousel-auto-copy">
                <small>Direção automática · slide {String(activeIndex + 1).padStart(2, "0")}</small>
                <strong>Composição inteligente</strong>
                <span>
                  Considera {activeRole.toLocaleLowerCase("pt-BR")}, volume de texto, números,
                  etapas, ação e imagem. Sem foto, não escolhe modelos fotográficos.
                </span>
              </span>
              <span className="carousel-auto-contact-sheet" aria-hidden="true">
                {automaticPreviewLayouts.map((layout) => (
                  <span key={layout.id}>
                    <Preview
                      brandIr={brandIr}
                      layoutSpec={layout}
                      contentSpec={carouselTemplateContent(
                        layout,
                        activeSlide,
                        revisionId,
                        brandIr,
                        signature,
                      )}
                      assetsBaseUrl={assetsBaseUrl}
                      maxWidthPx={92}
                    />
                  </span>
                ))}
              </span>
              <span className="carousel-auto-state">
                {!activeSlide.layoutId ? "Em uso" : "Retomar automático"}
              </span>
            </button>
            <div className="carousel-template-grid" aria-label="Modelos disponíveis">
              {visibleLayouts.map((layout) => {
                const selected = activeSlide.layoutId === layout.id
                const sample = selected
                  ? carouselTemplateContent(layout, activeSlide, revisionId, brandIr, signature)
                  : carouselCatalogContent(layout, revisionId, brandIr)
                return (
                  <button
                    key={layout.id}
                    type="button"
                    className="carousel-template-card"
                    aria-label={`Usar ${layout.namePt}`}
                    aria-pressed={selected}
                    data-active={selected || undefined}
                    onClick={() => updateSlide({ layoutId: layout.id })}
                    onPointerEnter={(event) =>
                      showTemplateHoverPreview(layout, sample, event.currentTarget)
                    }
                    onPointerLeave={() => setTemplateHoverPreview(null)}
                    onFocus={(event) =>
                      showTemplateHoverPreview(layout, sample, event.currentTarget)
                    }
                    onBlur={() => setTemplateHoverPreview(null)}
                  >
                    <span className="carousel-template-proof" aria-hidden="true">
                      <Preview
                        brandIr={brandIr}
                        layoutSpec={layout}
                        contentSpec={sample}
                        assetsBaseUrl={assetsBaseUrl}
                        maxWidthPx={150}
                      />
                    </span>
                    <span className="carousel-template-caption">
                      <strong>{layout.namePt}</strong>
                      <small>{templateFamilyLabel(templateFamilyKey(layout))}</small>
                      {catalogMode === "recommended" && layout.recommendationReasonPt ? (
                        <small className="carousel-template-reason">
                          {layout.recommendationReasonPt}
                        </small>
                      ) : null}
                    </span>
                  </button>
                )
              })}
            </div>
            {templateHoverPreview ? (
              <aside
                className="carousel-template-hover-preview"
                data-testid="carousel-template-hover-preview"
                aria-label={`Prévia ampliada de ${templateHoverPreview.layout.namePt}`}
                style={{
                  left: `${templateHoverPreview.left}px`,
                  top: `${templateHoverPreview.top}px`,
                }}
              >
                <span className="carousel-template-hover-proof" aria-hidden="true">
                  <Preview
                    brandIr={brandIr}
                    layoutSpec={templateHoverPreview.layout}
                    contentSpec={templateHoverPreview.content}
                    assetsBaseUrl={assetsBaseUrl}
                    maxWidthPx={280}
                  />
                </span>
                <span className="carousel-template-hover-caption">
                  <strong>{templateHoverPreview.layout.namePt}</strong>
                  <small>
                    {templateFamilyLabel(templateFamilyKey(templateHoverPreview.layout))}
                  </small>
                  {templateHoverPreview.layout.recommendationReasonPt ? (
                    <small>{templateHoverPreview.layout.recommendationReasonPt}</small>
                  ) : null}
                </span>
              </aside>
            ) : null}
            <div className="carousel-template-actions">
              <p>
                Selecionado: <strong>{activeLayout?.namePt ?? "Composição inteligente"}</strong>
              </p>
              <button
                type="button"
                className="secondary-action"
                disabled={!activeLayout}
                onClick={applyFamilyToSequence}
              >
                Aplicar esta família aos {slides.length} slides
              </button>
            </div>
            {activeLayout === null || activeImageSlots.length > 0 ? (
              <div className="carousel-template-image">
                <label>
                  <span>
                    Imagem deste slide {activeNeedsImage ? "· necessária" : "· opcional"}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={uploadingImage}
                    onChange={(event) =>
                      void uploadSlideImage(event.currentTarget.files?.[0] ?? null)
                    }
                  />
                </label>
                <p>
                  {activeSlide.imageSha256
                    ? "Imagem pronta. Ela será aplicada a todos os espaços de imagem deste modelo."
                    : activeNeedsImage
                      ? "Este modelo só pode ser gerado depois que você enviar uma imagem."
                      : activeLayout === null
                        ? "Se você enviar uma imagem, ela também participa da escolha automática do modelo."
                        : "Envie uma imagem para substituir o espaço previsto no modelo."}
                </p>
                {activeSlide.imageSha256 ? (
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => updateSlide({ imageSha256: null })}
                  >
                    Remover imagem
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
          <section className="carousel-appearance" aria-labelledby="carousel-appearance-title">
            <div className="carousel-appearance-heading">
              <div>
                <h3 id="carousel-appearance-title">Aparência deste slide</h3>
                <p>Fundo, textos e logo podem mudar sem perder a paleta da marca.</p>
              </div>
              <span>{activeRole}</span>
            </div>

            <div className="carousel-appearance-grid">
              <div className="carousel-background-control">
                <div className="carousel-control-heading">
                  <strong>Cor de fundo</strong>
                  <button
                    type="button"
                    className="text-action"
                    disabled={!activeSlide.backgroundColorToken}
                    onClick={() => updateSlide({ backgroundColorToken: null })}
                  >
                    Usar o modelo
                  </button>
                </div>
                <div className="carousel-color-grid" role="group" aria-label="Cor de fundo deste slide">
                  {Object.entries(brandIr.colors).map(([token, color]) => (
                    <button
                      key={token}
                      type="button"
                      className="carousel-color-option"
                      title={`${humanizeToken(token, "color.")} · ${color.value}`}
                      aria-label={`Fundo: ${humanizeToken(token, "color.")}, ${color.value}`}
                      aria-pressed={activeSlide.backgroundColorToken === token}
                      data-active={activeSlide.backgroundColorToken === token || undefined}
                      onClick={() => updateSlide({ backgroundColorToken: token })}
                    >
                      <span style={{ backgroundColor: color.value }} />
                      <span>
                        <b>{humanizeToken(token, "color.")}</b>
                        <small>{color.value}</small>
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="secondary-action carousel-apply-all"
                  onClick={() =>
                    applyAppearanceToAll(
                      "backgroundColorToken",
                      activeSlide.backgroundColorToken ?? null,
                    )
                  }
                >
                  Aplicar este fundo aos {slides.length} slides
                </button>
              </div>

              <div className="carousel-text-control">
                <div className="carousel-control-heading">
                  <strong>Cor dos textos</strong>
                  <button
                    type="button"
                    className="text-action"
                    disabled={!activeSlide.textColorToken}
                    onClick={() => updateSlide({ textColorToken: null })}
                  >
                    Usar o modelo
                  </button>
                </div>
                <div className="carousel-color-grid" role="group" aria-label="Cor dos textos deste slide">
                  {Object.entries(brandIr.colors).map(([token, color]) => (
                    <button
                      key={token}
                      type="button"
                      className="carousel-color-option"
                      title={`${humanizeToken(token, "color.")} · ${color.value}`}
                      aria-label={`Textos: ${humanizeToken(token, "color.")}, ${color.value}`}
                      aria-pressed={activeSlide.textColorToken === token}
                      data-active={activeSlide.textColorToken === token || undefined}
                      onClick={() => updateSlide({ textColorToken: token })}
                    >
                      <span style={{ backgroundColor: color.value }} />
                      <span>
                        <b>{humanizeToken(token, "color.")}</b>
                        <small>{color.value}</small>
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="secondary-action carousel-apply-all"
                  onClick={() =>
                    applyAppearanceToAll("textColorToken", activeSlide.textColorToken ?? null)
                  }
                >
                  Aplicar esta cor aos {slides.length} slides
                </button>
              </div>

              <div className="carousel-logo-control">
                <label htmlFor="carousel-logo-asset">
                  <span>Versão da marca</span>
                  <select
                    id="carousel-logo-asset"
                    value={activeSlide.logoAssetToken ?? ""}
                    onChange={(event) =>
                      updateSlide({ logoAssetToken: event.currentTarget.value || null })
                    }
                  >
                    <option value="">Automática para o fundo</option>
                    {logoAssetTokens(brandIr).map((token) => (
                        <option key={token} value={token}>
                          {logoAssetLabel(brandIr, token)}
                        </option>
                      ))}
                  </select>
                </label>
                {hasAutomaticLogoPair(brandIr) ? (
                  <p>
                    No automático, o Molda usa a versão clara ou escura adequada ao fundo deste
                    slide.
                  </p>
                ) : uniqueLogoCount(brandIr) > 1 ? (
                  <p>
                    As {uniqueLogoCount(brandIr)} versões carregadas estão disponíveis. O
                    automático usa a principal; escolha outra quando necessário.
                  </p>
                ) : (
                  <p className="carousel-appearance-warning">
                    Esta revisão tem apenas uma versão da logo. Fundos de baixo contraste podem
                    esconder a marca.
                  </p>
                )}
                <button
                  type="button"
                  className="secondary-action carousel-apply-all"
                  onClick={() =>
                    applyAppearanceToAll("logoAssetToken", activeSlide.logoAssetToken ?? null)
                  }
                >
                  Aplicar esta escolha aos {slides.length} slides
                </button>
              </div>
            </div>
          </section>
          <label>
            <span>Contexto curto <small>(opcional)</small></span>
            <input
              value={activeSlide.kicker}
              maxLength={80}
              onChange={(event) => updateSlide({ kicker: event.currentTarget.value })}
              placeholder={activeRole === "Conteúdo" ? "Ex.: Princípio 01" : "Ex.: Guia visual"}
            />
          </label>
          <label>
            <span>{activeRole === "Fechamento" ? "Mensagem final" : "Título principal"}</span>
            <textarea
              value={activeSlide.headline}
              maxLength={180}
              rows={3}
              onChange={(event) => updateSlide({ headline: event.currentTarget.value })}
              placeholder={
                activeRole === "Capa"
                  ? "A ideia que abre a história"
                  : activeRole === "Fechamento"
                    ? "A ideia que deve permanecer"
                    : "Uma ideia clara para este slide"
              }
            />
          </label>

          {activeRole !== "Fechamento" ? (
            <div className="carousel-blocks">
              <div className="carousel-blocks-heading">
                <span>
                  {activeRole === "Capa" ? "Texto de apoio" : "Blocos de texto"}
                  <small>
                    {activeRole === "Capa"
                      ? " A capa usa no máximo um apoio curto."
                      : " Separe ideias para criar ritmo e hierarquia."}
                  </small>
                </span>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={
                    activeSlide.textBlocks.length >= (activeRole === "Capa" ? 1 : 6)
                  }
                  onClick={addTextBlock}
                >
                  + Adicionar bloco
                </button>
              </div>
              {activeSlide.textBlocks.map((block, index) => (
                <div className="carousel-block" key={`block-${index}`}>
                  <label>
                    <span>Bloco {index + 1}</span>
                    <textarea
                      value={block}
                      maxLength={520}
                      rows={4}
                      onChange={(event) => updateTextBlock(index, event.currentTarget.value)}
                      placeholder="Escreva uma ideia completa — não precisa conhecer termos de design."
                    />
                  </label>
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => removeTextBlock(index)}
                  >
                    Remover
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <label>
              <span>Próximo passo <small>(opcional)</small></span>
              <input
                value={activeSlide.cta}
                maxLength={240}
                onChange={(event) => updateSlide({ cta: event.currentTarget.value })}
                placeholder="Ex.: Salve para consultar depois"
              />
            </label>
          )}
        </div>
      </section>

      <div className="carousel-actions">
        <button
          type="button"
          className="primary-action"
          disabled={!canGenerate || pending}
          onClick={() => void generate()}
        >
          {pending ? "Gerando sequência…" : `Gerar ${slides.length} slides`}
        </button>
        {!canGenerate ? (
          <p>
            Preencha o nome e a mensagem principal de todos os slides. Se você escolher
            manualmente um modelo fotográfico, envie também a imagem.
          </p>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        {status ? <p role="status">{status}</p> : null}
      </div>

      {carousel ? (
        <section className="carousel-result" aria-labelledby="carousel-result-title">
          <div className="carousel-result-heading">
            <div>
              <p className="product-kicker">Sequência gerada</p>
              <h2 id="carousel-result-title">{carousel.name}</h2>
            </div>
            <div>
              <button
                type="button"
                className="primary-action"
                disabled={exporting}
                onClick={() => void exportCarousel()}
              >
                {exporting ? "Preparando ZIP…" : "Exportar todos em PNG"}
              </button>
              {download ? (
                <a className="download-link" href={download.url} download={download.filename}>
                  Baixar {download.filename}
                </a>
              ) : null}
            </div>
          </div>
          <div className="carousel-preview-grid">
            {carousel.slides.map((slide) => (
              <article key={slide.id}>
                <div className="carousel-preview-proof">
                  <Preview
                    brandIr={brandIr}
                    layoutSpec={slide.layout}
                    contentSpec={slide.content}
                    assetsBaseUrl={assetsBaseUrl}
                    maxWidthPx={330}
                  />
                </div>
                <footer>
                  <span>{String(slide.position).padStart(2, "0")}</span>
                  <strong>
                    {slide.role === "cover"
                      ? "Capa"
                      : slide.role === "closing"
                        ? "Fechamento"
                        : "Conteúdo"}
                  </strong>
                  <span>PNG {slide.layout.canvas.widthPx} × {slide.layout.canvas.heightPx}</span>
                  <span className="carousel-composition-note">
                    <small>
                      {slide.composition.mode === "automatic"
                        ? "Escolha inteligente"
                        : "Escolha manual"}
                    </small>
                    {slide.composition.reasonPt}
                  </span>
                  <Link
                    className="carousel-slide-edit"
                    to={`/marcas/${encodeURIComponent(revisionId)}/editor/${encodeURIComponent(slide.layoutId)}?carouselId=${encodeURIComponent(carousel.id)}&slideId=${encodeURIComponent(slide.id)}`}
                    aria-label={`Editar slide ${String(slide.position).padStart(2, "0")}, ${
                      slide.role === "cover"
                        ? "Capa"
                        : slide.role === "closing"
                          ? "Fechamento"
                          : "Conteúdo"
                    }`}
                  >
                    Editar slide <span aria-hidden="true">→</span>
                  </Link>
                </footer>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  )
}
