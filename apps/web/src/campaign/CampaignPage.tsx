import { useEffect, useMemo, useState } from "react"
import type { ChangeEvent, JSX } from "react"
import { Link, useParams } from "react-router-dom"
import { ApiError } from "../api/client"
import { useApi } from "../api/context"
import type {
  BrandIr,
  Campaign,
  CampaignFields,
  CampaignPiece,
  ExportFormat,
  LayoutSpec,
} from "../api/types"
import { brandThemeStyle } from "../brandTheme"
import { Preview } from "../render/Preview"

interface CampaignData {
  brandIr: BrandIr
  layouts: LayoutSpec[]
  campaigns: Campaign[]
}

const EMPTY_FIELDS: CampaignFields = {
  headline: "",
  body: "",
  cta: "",
  date: "",
  imageSha256: null,
}

function layoutRequiresImage(layout: LayoutSpec): boolean {
  return layout.slots.some((slot) => slot.kind === "image" && slot.required)
}

function representativeLayouts(layouts: LayoutSpec[], hasImage = false): string[] {
  const seen = new Set<string>()
  const selected: string[] = []
  for (const layout of layouts) {
    if (!hasImage && layoutRequiresImage(layout)) continue
    if (seen.has(layout.profile)) continue
    seen.add(layout.profile)
    selected.push(layout.id)
  }
  return selected
}

function profileName(profile: string): string {
  const names: Record<string, string> = {
    "post-1x1": "Post quadrado",
    "post-4x5": "Post vertical",
    "story-9x16": "Story",
    "doc-a4": "Documento A4",
  }
  return names[profile] ?? "Modelo"
}

function CampaignExportButton({
  piece,
  format,
  label,
  blockedReason,
}: {
  piece: CampaignPiece
  format: ExportFormat
  label: string
  blockedReason?: string
}): JSX.Element {
  const api = useApi()
  const [pending, setPending] = useState(false)
  const [download, setDownload] = useState<{ url: string; filename: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const exportPiece = async (): Promise<void> => {
    setPending(true)
    setDownload(null)
    setError(null)
    try {
      const { jobId } = await api.requestExport(piece.documentId, format)
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const job = await api.getJob(jobId)
        if (job.status === "succeeded" && job.result) {
          setDownload({ url: job.result.url, filename: job.result.filename })
          return
        }
        if (job.status === "failed") {
          throw new Error(job.error || "Não foi possível exportar esta peça.")
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500))
      }
      throw new Error("A exportação demorou mais que o esperado. Tente novamente.")
    } catch (reason: unknown) {
      setError(reason instanceof ApiError ? reason.messagePt : (reason as Error).message)
    } finally {
      setPending(false)
    }
  }

  if (download) {
    return (
      <a className="campaign-download" href={download.url} download={download.filename}>
        Baixar {format.toUpperCase()}
      </a>
    )
  }
  return (
    <span className="campaign-export-control">
      <button
        type="button"
        className="secondary-action"
        disabled={pending || Boolean(blockedReason)}
        title={blockedReason}
        onClick={exportPiece}
      >
        {pending ? "Preparando…" : label}
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </span>
  )
}

function CampaignPieceCard({
  piece,
  layout,
  brandIr,
  assetsBaseUrl,
}: {
  piece: CampaignPiece
  layout: LayoutSpec
  brandIr: BrandIr
  assetsBaseUrl: string
}): JSX.Element {
  const blockers = piece.checks.filter(
    (check) => check.status === "blocked" || check.id === "required-slot",
  )
  const guidance = piece.checks.filter(
    (check) => check.status !== "pass" && !blockers.includes(check),
  )
  const blockedReason = blockers[0]?.messagePt
  const finalFormat: ExportFormat = layout.profile === "doc-a4" ? "pdf" : "png"
  const editableFormat: ExportFormat = layout.profile === "doc-a4" ? "docx" : "pptx"
  return (
    <article className="campaign-piece" data-testid="campaign-piece">
      <div className="campaign-piece-preview">
        <Preview
          brandIr={brandIr}
          layoutSpec={layout}
          contentSpec={piece.content}
          assetsBaseUrl={assetsBaseUrl}
          maxWidthPx={360}
        />
      </div>
      <div className="campaign-piece-copy">
        <p className="product-kicker">{profileName(layout.profile)}</p>
        <h3>{layout.namePt}</h3>
        {blockers.length ? (
          <div className="campaign-piece-warning campaign-piece-blocked" role="alert">
            <strong>Peça incompleta — exportação bloqueada</strong>
            <span>{blockedReason}</span>
          </div>
        ) : guidance.length ? (
          <div className="campaign-piece-warning" role="status">
            <strong>{guidance.length} orientação(ões) da marca</strong>
            <span>{guidance[0].messagePt}</span>
          </div>
        ) : (
          <p className="campaign-piece-ready">Dentro da marca e pronta para exportar.</p>
        )}
        <div className="campaign-piece-actions">
          <CampaignExportButton
            piece={piece}
            format={finalFormat}
            label={`Gerar ${finalFormat.toUpperCase()}`}
            blockedReason={blockedReason}
          />
          <CampaignExportButton
            piece={piece}
            format={editableFormat}
            label={`Gerar ${editableFormat.toUpperCase()} editável`}
            blockedReason={blockedReason}
          />
        </div>
      </div>
    </article>
  )
}

export function CampaignPage(): JSX.Element {
  const { revisionId } = useParams()
  const api = useApi()
  const [data, setData] = useState<CampaignData | null>(null)
  const [active, setActive] = useState<Campaign | null>(null)
  const [name, setName] = useState("")
  const [fields, setFields] = useState<CampaignFields>(EMPTY_FIELDS)
  const [selectedLayouts, setSelectedLayouts] = useState<string[]>([])
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    if (!revisionId) {
      setError("A revisão da marca não foi informada.")
      return () => {
        current = false
      }
    }
    void Promise.all([
      api.getBrandRevision(revisionId),
      api.getKit(revisionId),
      api.listCampaigns(revisionId),
    ])
      .then(([brandIr, layouts, campaigns]) => {
        if (!current) return
        setData({ brandIr, layouts, campaigns })
        setSelectedLayouts(representativeLayouts(layouts, false))
      })
      .catch((reason: unknown) => {
        if (current) {
          setError(
            reason instanceof ApiError
              ? reason.messagePt
              : "Não foi possível carregar o modo campanha.",
          )
        }
      })
    return () => {
      current = false
    }
  }, [api, revisionId])

  const layoutById = useMemo(
    () => new Map(data?.layouts.map((layout) => [layout.id, layout]) ?? []),
    [data?.layouts],
  )

  const selectCampaign = (campaign: Campaign): void => {
    setActive(campaign)
    setName(campaign.name)
    setFields(campaign.fields)
    setSelectedLayouts(campaign.pieces.map((piece) => piece.layoutId))
    setImageFile(null)
    setError(null)
    setStatus(null)
  }

  const newCampaign = (): void => {
    setActive(null)
    setName("")
    setFields(EMPTY_FIELDS)
    setSelectedLayouts(representativeLayouts(data?.layouts ?? [], false))
    setImageFile(null)
    setError(null)
    setStatus(null)
  }

  const changeField = (field: keyof CampaignFields, value: string | null): void => {
    setFields((current) => ({ ...current, [field]: value }))
  }

  const changeLayout = (event: ChangeEvent<HTMLInputElement>): void => {
    const { value, checked } = event.currentTarget
    setSelectedLayouts((current) =>
      checked ? [...current, value] : current.filter((layoutId) => layoutId !== value),
    )
  }

  const save = async (): Promise<void> => {
    if (!revisionId) return
    if (!name.trim()) {
      setError("Dê um nome para reencontrar esta campanha.")
      return
    }
    if (!data?.brandIr.creativeDirection) {
      setError(
        "Esta revisão ainda não tem direção criativa confiável. Refaça a leitura da marca antes de gerar peças.",
      )
      return
    }
    if (!active && selectedLayouts.length === 0) {
      setError("Escolha ao menos um modelo para a campanha.")
      return
    }
    if (![fields.headline, fields.body, fields.cta, fields.date].some((value) => value.trim())) {
      setError("Escreva ao menos um título, mensagem, data ou chamada para a campanha.")
      return
    }
    const hasImage = Boolean(imageFile || fields.imageSha256)
    const incompatible = selectedLayouts
      .map((layoutId) => layoutById.get(layoutId))
      .find((layout) => layout && layoutRequiresImage(layout) && !hasImage)
    if (incompatible) {
      setError(
        `O modelo “${incompatible.namePt}” precisa de uma imagem. Envie uma foto ou escolha um modelo sem imagem.`,
      )
      return
    }
    setPending(true)
    setError(null)
    setStatus("Atualizando todas as peças…")
    try {
      let nextFields = fields
      if (imageFile) {
        const upload = await api.uploadAsset(imageFile)
        nextFields = { ...fields, imageSha256: upload.sha256 }
      }
      const saved = active
        ? await api.updateCampaign(active.id, { name: name.trim(), fields: nextFields })
        : await api.createCampaign({
            brandRevisionId: revisionId,
            name: name.trim(),
            fields: nextFields,
            layoutIds: selectedLayouts,
          })
      setActive(saved)
      setFields(saved.fields)
      setImageFile(null)
      setData((current) =>
        current
          ? {
              ...current,
              campaigns: [saved, ...current.campaigns.filter((item) => item.id !== saved.id)],
            }
          : current,
      )
      setStatus(`${saved.pieces.length} peça(s) atualizada(s) a partir da mesma mensagem.`)
    } catch (reason: unknown) {
      setError(
        reason instanceof ApiError
          ? reason.messagePt
          : "Não foi possível salvar a campanha. Revise os campos e tente novamente.",
      )
      setStatus(null)
    } finally {
      setPending(false)
    }
  }

  if (error && !data) {
    return (
      <main id="main-content" className="campaign-page">
        <h1>Modo Campanha</h1>
        <p role="alert">{error}</p>
        <Link className="primary-link" to={revisionId ? `/marcas/${revisionId}/kit` : "/"}>
          Voltar ao kit
        </Link>
      </main>
    )
  }
  if (!data || !revisionId) {
    return (
      <main id="main-content" className="campaign-page">
        <p className="loading-note" role="status">
          Carregando campanhas…
        </p>
      </main>
    )
  }

  const assetsBaseUrl = api.revisionAssetsBaseUrl(revisionId)
  const hasCreativeDirection = Boolean(data.brandIr.creativeDirection)
  const hasCampaignImage = Boolean(imageFile || fields.imageSha256)
  return (
    <main
      id="main-content"
      className="campaign-page brand-reactive-page"
      style={brandThemeStyle(data.brandIr)}
    >
      <header className="campaign-heading" data-motion-enter>
        <div>
          <p className="product-kicker">Uma mensagem, muitas peças</p>
          <h1>Modo Campanha</h1>
          <p>
            Mude título, texto, data, chamada ou imagem uma vez. O Molda leva a mudança a todos
            os formatos e mantém cada peça ligada à mesma origem.
          </p>
        </div>
        <Link className="text-action" to={`/marcas/${encodeURIComponent(revisionId)}/kit`}>
          Voltar ao kit
        </Link>
      </header>

      <div className="campaign-continuity" aria-label="Continuidade da campanha" data-motion-enter>
        <span>
          <strong>Uma mensagem</strong>
          <small>é a fonte</small>
        </span>
        <i aria-hidden="true" />
        <span>
          <strong>{selectedLayouts.length} modelos</strong>
          <small>permanecem ligados</small>
        </span>
        <i aria-hidden="true" />
        <span>
          <strong>Uma alteração</strong>
          <small>atualiza o conjunto</small>
        </span>
      </div>

      <div className="campaign-workspace">
        <aside className="campaign-library" aria-label="Campanhas salvas">
          <div className="campaign-library-heading">
            <h2>Campanhas</h2>
            <button type="button" className="secondary-action" onClick={newCampaign}>
              Nova campanha
            </button>
          </div>
          {data.campaigns.length ? (
            <ul>
              {data.campaigns.map((campaign) => (
                <li key={campaign.id}>
                  <button
                    type="button"
                    data-active={active?.id === campaign.id || undefined}
                    onClick={() => selectCampaign(campaign)}
                  >
                    <span>{campaign.name}</span>
                    <small>{campaign.pieces.length} peça(s)</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="campaign-empty">Sua primeira campanha começa aqui.</p>
          )}
        </aside>

        <section className="campaign-form-panel" aria-labelledby="campaign-form-title">
          <div className="campaign-form-heading">
            <h2 id="campaign-form-title">
              {active ? "Edite a mensagem central" : "Crie a mensagem central"}
            </h2>
          </div>
          <form
            className="campaign-form"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            {!hasCreativeDirection ? (
              <div className="campaign-direction-blocker" role="alert">
                <strong>Esta marca ainda não está pronta para gerar campanhas.</strong>
                <span>
                  A leitura anterior não encontrou direção criativa suficiente. Volte ao início,
                  envie o manual novamente e confira as pistas que o Molda extrair.
                </span>
                <Link className="text-action" to="/">Refazer leitura da marca</Link>
              </div>
            ) : null}
            <label htmlFor="campaign-name">Nome da campanha</label>
            <input
              id="campaign-name"
              name="campaign-name"
              value={name}
              maxLength={160}
              autoComplete="off"
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="Ex.: Lançamento de julho…"
            />

            <label htmlFor="campaign-headline">Título principal</label>
            <input
              id="campaign-headline"
              name="campaign-headline"
              value={fields.headline}
              maxLength={500}
              autoComplete="off"
              onChange={(event) => changeField("headline", event.currentTarget.value)}
              placeholder="A mensagem que precisa ser lembrada…"
            />

            <label htmlFor="campaign-body">Mensagem</label>
            <textarea
              id="campaign-body"
              name="campaign-body"
              value={fields.body}
              maxLength={10_000}
              rows={5}
              onChange={(event) => changeField("body", event.currentTarget.value)}
              placeholder="Explique a campanha em linguagem direta…"
            />

            <div className="campaign-form-row">
              <span>
                <label htmlFor="campaign-date">Data ou período</label>
                <input
                  id="campaign-date"
                  name="campaign-date"
                  value={fields.date}
                  maxLength={300}
                  autoComplete="off"
                  onChange={(event) => changeField("date", event.currentTarget.value)}
                  placeholder="24 de julho…"
                />
              </span>
              <span>
                <label htmlFor="campaign-cta">Chamada para ação</label>
                <input
                  id="campaign-cta"
                  name="campaign-cta"
                  value={fields.cta}
                  maxLength={500}
                  autoComplete="off"
                  onChange={(event) => changeField("cta", event.currentTarget.value)}
                  placeholder="Conheça agora…"
                />
              </span>
            </div>

            <div className="campaign-image-field">
              <label htmlFor="campaign-image">Imagem da campanha</label>
              <input
                id="campaign-image"
                name="campaign-image"
                type="file"
                accept="image/png,image/jpeg"
                onChange={(event) => {
                  const next = event.currentTarget.files?.[0] ?? null
                  setImageFile(next)
                  if (!next && !fields.imageSha256) {
                    setSelectedLayouts((current) =>
                      current.filter((layoutId) => {
                        const layout = layoutById.get(layoutId)
                        return !layout || !layoutRequiresImage(layout)
                      }),
                    )
                  }
                }}
              />
              <p className="field-guidance">
                {imageFile
                  ? `Nova imagem: ${imageFile.name}`
                  : fields.imageSha256
                    ? "A campanha já tem uma imagem."
                    : "PNG ou JPEG. Modelos que dependem de fotografia ficam indisponíveis sem uma imagem."}
              </p>
              {fields.imageSha256 || imageFile ? (
                <button
                  type="button"
                  className="text-action campaign-clear-image"
                  onClick={() => {
                    setImageFile(null)
                    changeField("imageSha256", null)
                    setSelectedLayouts((current) =>
                      current.filter((layoutId) => {
                        const layout = layoutById.get(layoutId)
                        return !layout || !layoutRequiresImage(layout)
                      }),
                    )
                  }}
                >
                  Remover imagem
                </button>
              ) : null}
            </div>

            <fieldset className="campaign-formats" disabled={active !== null}>
              <legend>Modelos usados</legend>
              {active ? (
                <p>Os modelos não mudam depois da criação, para manter o histórico da campanha.</p>
              ) : (
                <p>Selecionamos um modelo de cada tipo. Mude se precisar.</p>
              )}
              <div>
                {data.layouts.map((layout) => (
                  <label key={layout.id}>
                    <input
                      type="checkbox"
                      name="campaign-layout"
                      value={layout.id}
                      checked={selectedLayouts.includes(layout.id)}
                      disabled={layoutRequiresImage(layout) && !hasCampaignImage}
                      onChange={changeLayout}
                    />
                    <span>
                      {layout.namePt}
                      <small>
                        {profileName(layout.profile)}
                        {layoutRequiresImage(layout) && !hasCampaignImage
                          ? " · precisa de imagem"
                          : ""}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {error ? <p className="campaign-error" role="alert">{error}</p> : null}
            {status ? <p className="campaign-status" role="status" aria-live="polite">{status}</p> : null}
            <button
              type="submit"
              className="primary-action"
              disabled={pending || !hasCreativeDirection}
            >
              {pending
                ? "Atualizando todas as peças…"
                : active
                  ? `Salvar e atualizar ${active.pieces.length} peça(s)`
                  : `Criar campanha com ${selectedLayouts.length} formato(s)`}
            </button>
          </form>
        </section>
      </div>

      {active ? (
        <section className="campaign-results" aria-labelledby="campaign-results-title">
          <div className="campaign-results-heading">
            <h2 id="campaign-results-title">Peças desta campanha</h2>
            <p>Todas as peças abaixo usam a mesma mensagem que você acabou de salvar.</p>
          </div>
          <div className="campaign-piece-grid">
            {active.pieces.map((piece) => {
              const layout = layoutById.get(piece.layoutId)
              return layout ? (
                <CampaignPieceCard
                  key={piece.id}
                  piece={piece}
                  layout={layout}
                  brandIr={data.brandIr}
                  assetsBaseUrl={assetsBaseUrl}
                />
              ) : null
            })}
          </div>
        </section>
      ) : null}
    </main>
  )
}
