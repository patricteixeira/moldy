import { useEffect, useState } from "react"
import type { JSX } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { ApiError } from "../api/client"
import { useApi } from "../api/context"
import type { BrandIr, ContentSpec, LayoutSpec } from "../api/types"
import { brandThemeStyle } from "../brandTheme"
import {
  creationBriefFromSearch,
  creationBriefSummary,
  selectLayoutsForCreationBrief,
} from "../create/creationBrief"
import { materializeContentLayout } from "../editor/contentLayout"
import { Preview } from "../render/Preview"
import { placeholderContent } from "./placeholder"
import {
  templateFamilyKey,
  templateFamilyLabel,
} from "./templateFamilies"
import {
  recommendationIsBrandLed,
  recommendedTemplateGroups,
  type TemplateCatalogMode,
} from "./templateRecommendations"

interface KitState {
  brandIr: BrandIr
  layouts: LayoutSpec[]
}

function headlineSlotId(layout: LayoutSpec): string | null {
  const preferredIds = ["headline", "title", "quote"]
  for (const id of preferredIds) {
    if (layout.slots.some((slot) => slot.kind === "text" && slot.id === id)) return id
  }
  return (
    layout.slots.find(
      (slot) =>
        slot.kind === "text" && (slot.role === "heading" || slot.role === "display"),
    )?.id ?? null
  )
}

function applyPreviewText(
  layout: LayoutSpec,
  content: ContentSpec,
  previewText: string,
): ContentSpec {
  const slotId = headlineSlotId(layout)
  const text = previewText.trim()
  if (!slotId || !text) return content
  return {
    ...content,
    values: {
      ...content.values,
      [slotId]: { kind: "text", text },
    },
  }
}

export function KitPage(): JSX.Element {
  const { revisionId } = useParams()
  const [searchParams] = useSearchParams()
  const api = useApi()
  const [kit, setKit] = useState<KitState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [catalogMode, setCatalogMode] = useState<TemplateCatalogMode>("recommended")
  const [previewText, setPreviewText] = useState("")
  const [familyFilter, setFamilyFilter] = useState("all")

  useEffect(() => {
    let active = true
    setKit(null)
    setError(null)

    if (!revisionId) {
      setError("A revisão da marca não foi informada.")
      return () => {
        active = false
      }
    }

    void Promise.all([api.getBrandRevision(revisionId), api.getKit(revisionId)])
      .then(([brandIr, layouts]) => {
        if (active) setKit({ brandIr, layouts })
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(
          reason instanceof ApiError
            ? reason.messagePt
            : "Não foi possível carregar os modelos. Tente novamente.",
        )
      })

    return () => {
      active = false
    }
  }, [api, attempt, revisionId])

  if (error) {
    return (
      <main id="main-content" className="kit-page">
        <h1>Modelos</h1>
        <p role="alert">{error}</p>
        <button
          type="button"
          className="secondary-action"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Tentar novamente
        </button>
      </main>
    )
  }

  if (!kit || !revisionId) {
    return (
      <main id="main-content" className="kit-page">
        <p className="loading-note" role="status">
          Carregando modelos…
        </p>
      </main>
    )
  }

  if (kit.layouts.length === 0) {
    return (
      <main id="main-content" className="kit-page">
        <h1>Modelos</h1>
        <p role="alert">Esta marca ainda não tem modelos disponíveis.</p>
        <button
          type="button"
          className="secondary-action"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Tentar novamente
        </button>
      </main>
    )
  }

  const activeRevisionId = revisionId
  const brandIr = kit.brandIr
  const creationBrief = creationBriefFromSearch(searchParams)
  const briefSummary = creationBriefSummary(creationBrief)
  const assetsBaseUrl = api.revisionAssetsBaseUrl(activeRevisionId)
  const headingFont = brandIr.fonts["font.heading"]?.family ?? "Fonte da marca"
  const layoutSelection = selectLayoutsForCreationBrief(kit.layouts, creationBrief)
  const formatFallback = layoutSelection.match === "fallback"
  const orderedLayouts = [...layoutSelection.layouts].sort(
    (left, right) => Number(right.templateRef != null) - Number(left.templateRef != null),
  )
  const recommendationGroups = recommendedTemplateGroups(orderedLayouts, 3, {
    objective: creationBrief.objective,
    action: creationBrief.action,
    visualPreference: creationBrief.visualPreference,
  })
  const recommendedLayouts = recommendationGroups.flatMap((group) => group.layouts)
  const brandLedRecommendations = recommendationIsBrandLed(recommendedLayouts)
  const availableFamilies = [
    ...new Set(orderedLayouts.map((layout) => templateFamilyKey(layout))),
  ].sort((left, right) =>
    templateFamilyLabel(left).localeCompare(templateFamilyLabel(right), "pt-BR"),
  )
  const allLayouts =
    familyFilter === "all"
      ? orderedLayouts
      : orderedLayouts.filter((layout) => templateFamilyKey(layout) === familyFilter)

  if (orderedLayouts.length === 0) {
    return (
      <main
        id="main-content"
        className="kit-page brand-reactive-page"
        style={brandThemeStyle(kit.brandIr)}
      >
        <div className="kit-empty-format">
          <p className="panel-kicker">Formato indisponível</p>
          <h1>Ainda não há modelos para esta dimensão.</h1>
          <p>Escolha outro formato sem alterar a marca instalada.</p>
          <Link
            className="primary-link"
            to={`/marcas/${encodeURIComponent(activeRevisionId)}/criar`}
          >
            Mudar tamanho
          </Link>
        </div>
      </main>
    )
  }

  function renderLayoutCard(layout: LayoutSpec, showReason: boolean): JSX.Element {
    const sample = applyPreviewText(
      layout,
      placeholderContent(layout, activeRevisionId, brandIr),
      previewText,
    )
    const headlineQuery = previewText.trim()
      ? `?headline=${encodeURIComponent(previewText.trim())}`
      : ""
    return (
      <Link
        key={layout.id}
        className="kit-card"
        to={`/marcas/${encodeURIComponent(activeRevisionId)}/editor/${encodeURIComponent(layout.id)}${headlineQuery}`}
        data-layout-id={layout.id}
        data-testid="kit-card"
        aria-label={`Usar ${layout.namePt}`}
      >
        <span className="kit-proof">
          <Preview
            brandIr={brandIr}
            layoutSpec={materializeContentLayout(layout, sample)}
            contentSpec={sample}
            assetsBaseUrl={assetsBaseUrl}
            maxWidthPx={360}
          />
        </span>
        <span className="kit-card-caption">
          <span>
            {layout.templateRef ? (
              <span className="kit-card-family">
                {templateFamilyLabel(layout.templateRef.packageId)}
              </span>
            ) : null}
            <span>{layout.namePt}</span>
            {showReason && layout.recommendationReasonPt ? (
              <span className="kit-card-reason">{layout.recommendationReasonPt}</span>
            ) : null}
            <span className="kit-card-action">Usar este modelo →</span>
          </span>
          <span className="kit-card-meta">
            {layout.canvas.widthPx} × {layout.canvas.heightPx} px
          </span>
        </span>
      </Link>
    )
  }

  return (
    <main
      id="main-content"
      className="kit-page brand-reactive-page"
      style={brandThemeStyle(kit.brandIr)}
    >
      <div className="kit-layout">
        <header className="kit-heading" data-motion-enter>
          <p className="kit-brand-name">{kit.brandIr.brand.name}</p>
          <h1>Escolha um modelo.</h1>
          <p className="kit-intro">
            {briefSummary
              ? formatFallback
                ? "Ainda não há um modelo no tamanho escolhido. Mostramos os outros tamanhos disponíveis."
                : "Os modelos abaixo têm o tamanho escolhido e estão ordenados pelo seu objetivo."
              : "Teste seu texto nas prévias e escolha uma opção para editar."}
          </p>
          {briefSummary ? <p className="creation-brief-summary">{briefSummary}</p> : null}
          {formatFallback ? (
            <p className="creation-format-notice" role="status">
              Exibindo outros formatos disponíveis. O tamanho real aparece em cada cartão.
            </p>
          ) : null}
          <p className="kit-count">{orderedLayouts.length} modelos disponíveis</p>
          <div className="brand-material-summary" aria-label="Fonte usada nos títulos">
            <span className="brand-material-swatches" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>
              <small>Fonte usada nos títulos</small>
              <strong>{headingFont}</strong>
            </span>
          </div>
          <Link className="text-action" to="/">
            Instalar outra marca
          </Link>
          <Link
            className="text-action"
            to={`/marcas/${encodeURIComponent(activeRevisionId)}/criar`}
          >
            {briefSummary ? "Mudar respostas" : "Criar nova peça"}
          </Link>
        </header>

        <section className="kit-tester" aria-labelledby="kit-tester-title">
          <div>
            <p className="panel-kicker">Teste antes de escolher</p>
            <h2 id="kit-tester-title">Digite o título da sua peça.</h2>
            <p>O texto muda apenas as prévias. Você poderá editá-lo novamente.</p>
          </div>
          <label>
            <span>Texto de teste</span>
            <input
              name="preview-title"
              value={previewText}
              maxLength={180}
              autoComplete="off"
              placeholder="Ex.: Nova coleção disponível"
              onChange={(event) => setPreviewText(event.currentTarget.value)}
            />
          </label>
        </section>

        <section className="kit-workflows" aria-labelledby="kit-workflows-title">
          <div className="kit-workflows-heading">
            <h2 id="kit-workflows-title">Precisa de mais de uma tela?</h2>
          </div>
          <div className="kit-workflow-grid">
            <Link
              className="kit-workflow-card kit-workflow-card-primary"
              to={`/marcas/${encodeURIComponent(revisionId)}/carrossel`}
            >
              <span>
                <strong>Carrossel</strong>
                <small>Crie e edite uma sequência de slides.</small>
              </span>
              <span className="kit-workflow-action">Criar carrossel →</span>
            </Link>
            <Link
              className="kit-workflow-card"
              to={`/marcas/${encodeURIComponent(revisionId)}/word`}
            >
              <span>
                <strong>Aplicar marca ao Word</strong>
                <small>Envie um `.docx` e aplique a identidade da marca.</small>
              </span>
              <span className="kit-workflow-action">Enviar Word →</span>
            </Link>
          </div>
        </section>

        <section className="kit-library-heading" aria-labelledby="kit-library-title">
          <p className="panel-kicker">Peças individuais</p>
          <h2 id="kit-library-title">
            {catalogMode === "recommended"
              ? "Escolha pela função da peça."
              : "Todos os modelos disponíveis."}
          </h2>
          <p>
            {catalogMode === "recommended"
              ? brandLedRecommendations
                ? "As primeiras opções combinam a estrutura do modelo com os dados da marca."
                : "As sugestões estão separadas em abrir, explicar e encerrar."
              : "Use o filtro para reduzir a lista."}
          </p>
          <div className="template-catalog-switch" aria-label="Abrangência do catálogo">
            <button
              type="button"
              aria-pressed={catalogMode === "recommended"}
              onClick={() => setCatalogMode("recommended")}
            >
              Sugestões para a marca
              <span>{recommendedLayouts.length}</span>
            </button>
            <button
              type="button"
              aria-pressed={catalogMode === "all"}
              onClick={() => setCatalogMode("all")}
            >
              Todos os modelos
              <span>{orderedLayouts.length}</span>
            </button>
          </div>
          {catalogMode === "all" && availableFamilies.length > 1 ? (
            <label className="template-family-filter">
              <span>Filtrar por estrutura</span>
              <select
                name="template-family"
                value={familyFilter}
                onChange={(event) => setFamilyFilter(event.currentTarget.value)}
              >
                <option value="all">Todas as estruturas</option>
                {availableFamilies.map((family) => (
                  <option key={family} value={family}>
                    {templateFamilyLabel(family)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </section>

        {catalogMode === "recommended" ? (
          <div className="kit-recommendation-groups" aria-label="Sugestões por função">
            {recommendationGroups.map((group) => (
              <section
                key={group.purpose}
                className="kit-recommendation-group"
                data-template-purpose={group.purpose}
                aria-labelledby={`template-purpose-${group.purpose}`}
              >
                <header className="kit-recommendation-heading">
                  <p>{group.eyebrow}</p>
                  <h3 id={`template-purpose-${group.purpose}`}>{group.label}</h3>
                  <p>{group.description}</p>
                  <span>{group.layouts.length} opções</span>
                </header>
                <div
                  className="kit-grid kit-grid-category"
                  data-layout-count={group.layouts.length}
                  aria-label={`Modelos de ${group.label.toLocaleLowerCase("pt-BR")}`}
                >
                  {group.layouts.map((layout) => renderLayoutCard(layout, true))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div
            className="kit-grid"
            data-layout-count={allLayouts.length}
            aria-label="Todos os modelos disponíveis"
          >
            {allLayouts.map((layout) => renderLayoutCard(layout, false))}
          </div>
        )}

      </div>
    </main>
  )
}
