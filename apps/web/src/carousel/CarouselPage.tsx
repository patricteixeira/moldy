import { useEffect, useMemo, useState } from "react"
import type { JSX } from "react"
import { Link, useParams } from "react-router-dom"
import { ApiError } from "../api/client"
import { useApi } from "../api/context"
import type {
  BrandIr,
  Carousel,
  CarouselProfile,
  CarouselSignature,
  CarouselSlideInput,
} from "../api/types"
import { brandThemeStyle } from "../brandTheme"
import { Preview } from "../render/Preview"

const MIN_SLIDES = 3
const MAX_SLIDES = 20

function emptySlide(): CarouselSlideInput {
  return { kicker: "", headline: "", textBlocks: [], cta: "" }
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
  const api = useApi()
  const [brandIr, setBrandIr] = useState<BrandIr | null>(null)
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

  useEffect(() => {
    if (!revisionId) {
      setError("A revisão da marca não foi informada.")
      return
    }
    let active = true
    void api
      .getBrandRevision(revisionId)
      .then((result) => {
        if (active) setBrandIr(result)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(
          reason instanceof ApiError
            ? reason.messagePt
            : "Não foi possível carregar a marca para o carrossel.",
        )
      })
    return () => {
      active = false
    }
  }, [api, revisionId])

  const activeSlide = slides[activeIndex]
  const activeRole = roleFor(activeIndex, slides.length)
  const canGenerate = useMemo(
    () => Boolean(name.trim() && slides.every((slide) => slide.headline.trim())),
    [name, slides],
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
      setStatus(
        `${saved.slides.length} slides gerados: capa, ${saved.slides.length - 2} de conteúdo e fechamento.`,
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
                setSlides((current) => resizeSlides(current, count))
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
                setProfile(event.currentTarget.value as CarouselProfile)
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
        {!canGenerate ? <p>Preencha o nome do carrossel e o título de todos os slides.</p> : null}
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
                </footer>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  )
}
