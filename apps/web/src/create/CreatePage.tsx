import { useEffect, useState } from "react"
import type { JSX } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ApiError } from "../api/client"
import { useApi } from "../api/context"
import type { BrandIr } from "../api/types"
import { brandThemeStyle } from "../brandTheme"
import {
  ACTION_OPTIONS,
  CHANNEL_OPTIONS,
  OBJECTIVE_OPTIONS,
  PROFILE_OPTIONS,
  creationTarget,
  type CreationAction,
  type CreationBrief,
  type CreationChannel,
  type CreationObjective,
  type CreationPieceType,
  type CreationProfile,
  type CreationVisualPreference,
} from "./creationBrief"

const VISUAL_OPTIONS: Array<{
  value: CreationVisualPreference
  label: string
  description: string
}> = [
  {
    value: "either",
    label: "Ainda não sei",
    description: "Mostra opções com e sem imagem.",
  },
  {
    value: "image",
    label: "Sim, vou usar imagem",
    description: "Mostra primeiro os modelos com área para foto ou ilustração.",
  },
  {
    value: "no-image",
    label: "Não, será só texto e formas",
    description: "Mostra primeiro os modelos que não dependem de imagem.",
  },
]

const CREATION_STEPS = [
  { label: "Objetivo", description: "O que será criado" },
  { label: "Formato", description: "Onde será publicado" },
  { label: "Conteúdo", description: "Ação e imagem" },
] as const

export function CreatePage(): JSX.Element {
  const { revisionId } = useParams()
  const api = useApi()
  const navigate = useNavigate()
  const [brandIr, setBrandIr] = useState<BrandIr | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [objective, setObjective] = useState<CreationObjective | null>(null)
  const [pieceType, setPieceType] = useState<CreationPieceType | null>(null)
  const [channel, setChannel] = useState<CreationChannel>("instagram")
  const [customChannel, setCustomChannel] = useState("")
  const [profile, setProfile] = useState<CreationProfile>("post-4x5")
  const [action, setAction] = useState<CreationAction>("none")
  const [visualPreference, setVisualPreference] = useState<CreationVisualPreference>("either")
  const [stage, setStage] = useState(0)

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
          reason instanceof ApiError ? reason.messagePt : "Não foi possível abrir esta marca.",
        )
      })
    return () => {
      active = false
    }
  }, [api, revisionId])

  const choosePieceType = (next: CreationPieceType): void => {
    setPieceType(next)
    if (next === "carousel" && profile === "story-9x16") setProfile("post-4x5")
  }

  const ready = Boolean(
    revisionId &&
      objective &&
      pieceType &&
      (channel !== "other" || customChannel.trim().length > 0),
  )
  const stageReady =
    stage === 0
      ? Boolean(objective && pieceType)
      : stage === 1
        ? channel !== "other" || customChannel.trim().length > 0
        : true

  const continueToTemplates = (): void => {
    if (!ready || !revisionId || !objective || !pieceType) return
    const brief: CreationBrief = {
      objective,
      pieceType,
      channel,
      customChannel,
      profile,
      action,
      visualPreference,
    }
    navigate(creationTarget(revisionId, brief))
  }

  if (error) {
    return (
      <main id="main-content" className="creation-page">
        <p role="alert">{error}</p>
        <Link className="secondary-action" to="/">
          Voltar ao início
        </Link>
      </main>
    )
  }

  if (!brandIr || !revisionId) {
    return (
      <main id="main-content" className="creation-page">
        <p className="loading-note" role="status">
          Preparando as opções de criação…
        </p>
      </main>
    )
  }

  const availableProfiles = PROFILE_OPTIONS.filter(
    (option) => pieceType !== "carousel" || !option.individualOnly,
  )

  return (
    <main
      id="main-content"
      className="creation-page brand-reactive-page"
      style={brandThemeStyle(brandIr)}
    >
      <header className="creation-heading">
        <div>
          <p className="product-kicker">{brandIr.brand.name}</p>
          <h1>O que você quer criar?</h1>
        </div>
        <p>Responda três etapas. Você poderá editar tudo depois.</p>
      </header>

      <ol className="creation-progress" aria-label="Etapas da nova peça">
        {CREATION_STEPS.map((item, index) => (
          <li
            key={item.label}
            data-state={index < stage ? "done" : index === stage ? "current" : "next"}
            aria-current={index === stage ? "step" : undefined}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </div>
          </li>
        ))}
      </ol>

      <div className="creation-form">
        {stage === 0 ? (
          <>
            <fieldset className="creation-section creation-section-objective">
              <legend>
                <span>1A</span>
                <strong>Qual é o objetivo?</strong>
                <small>Escolha a resposta mais próxima do que você precisa.</small>
              </legend>
              <div className="creation-option-grid creation-option-grid-objective">
                {OBJECTIVE_OPTIONS.map((option) => (
                  <label key={option.value} className="creation-option-card">
                    <input
                      type="radio"
                      name="creation-objective"
                      value={option.value}
                      checked={objective === option.value}
                      onChange={() => setObjective(option.value)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="creation-section">
              <legend>
                <span>1B</span>
                <strong>Quantas telas serão criadas?</strong>
                <small>Escolha uma peça única ou uma sequência.</small>
              </legend>
              <div className="creation-option-grid creation-option-grid-two">
                {(
                  [
                    {
                      value: "individual",
                      label: "Peça individual",
                      description: "Uma única imagem para feed, story ou outra tela.",
                    },
                    {
                      value: "carousel",
                      label: "Carrossel",
                      description: "Uma sequência com três ou mais slides.",
                    },
                  ] as const
                ).map((option) => (
                  <label key={option.value} className="creation-option-card">
                    <input
                      type="radio"
                      name="creation-piece"
                      value={option.value}
                      checked={pieceType === option.value}
                      onChange={() => choosePieceType(option.value)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        ) : null}

        {stage === 1 ? (
          <>
            <fieldset className="creation-section">
              <legend>
                <span>2A</span>
                <strong>Onde será publicada?</strong>
                <small>Se não estiver na lista, escolha outra rede.</small>
              </legend>
              <div className="creation-choice-row">
                {CHANNEL_OPTIONS.map((option) => (
                  <label key={option.value} className="creation-choice">
                    <input
                      type="radio"
                      name="creation-channel"
                      value={option.value}
                      checked={channel === option.value}
                      onChange={() => setChannel(option.value)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
              {channel === "other" ? (
                <label className="creation-custom-channel">
                  <span>Qual rede ou canal?</span>
                  <input
                    name="custom-channel"
                    value={customChannel}
                    maxLength={80}
                    autoComplete="off"
                    onChange={(event) => setCustomChannel(event.currentTarget.value)}
                    placeholder="Ex.: Bluesky, WhatsApp ou plataforma própria"
                  />
                </label>
              ) : null}
            </fieldset>

            <fieldset className="creation-section">
              <legend>
                <span>2B</span>
                <strong>Qual é o tamanho?</strong>
                <small>As medidas aparecem em cada opção.</small>
              </legend>
              <div className="creation-option-grid creation-option-grid-format">
                {availableProfiles.map((option) => (
                  <label key={option.value} className="creation-option-card creation-format-card">
                    <input
                      type="radio"
                      name="creation-profile"
                      value={option.value}
                      checked={profile === option.value}
                      onChange={() => setProfile(option.value)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.dimensions}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        ) : null}

        {stage === 2 ? (
          <>
            <fieldset className="creation-section">
              <legend>
                <span>3A</span>
                <strong>O que a pessoa deve fazer?</strong>
                <small>Escolha a ação principal da peça.</small>
              </legend>
              <select
                name="creation-action"
                aria-label="Ação esperada do público"
                value={action}
                onChange={(event) => setAction(event.currentTarget.value as CreationAction)}
              >
                {ACTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </fieldset>

            <fieldset className="creation-section">
              <legend>
                <span>3B</span>
                <strong>Você vai usar uma imagem?</strong>
                <small>Isso muda apenas a ordem dos modelos.</small>
              </legend>
              <div className="creation-option-grid creation-option-grid-three">
                {VISUAL_OPTIONS.map((option) => (
                  <label key={option.value} className="creation-option-card">
                    <input
                      type="radio"
                      name="creation-visual"
                      value={option.value}
                      checked={visualPreference === option.value}
                      onChange={() => setVisualPreference(option.value)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        ) : null}

        <footer className="creation-actions">
          <p>
            Etapa {stage + 1} de {CREATION_STEPS.length}
          </p>
          <div>
            {stage > 0 ? (
              <button
                type="button"
                className="secondary-action"
                onClick={() => setStage((current) => Math.max(0, current - 1))}
              >
                Voltar
              </button>
            ) : null}
            {stage < CREATION_STEPS.length - 1 ? (
              <button
                type="button"
                disabled={!stageReady}
                onClick={() => setStage((current) => Math.min(2, current + 1))}
              >
                {stage === 0 ? "Escolher formato" : "Definir conteúdo"}
              </button>
            ) : (
              <button type="button" disabled={!ready} onClick={continueToTemplates}>
                {pieceType === "carousel" ? "Montar carrossel" : "Ver modelos"}
              </button>
            )}
          </div>
        </footer>
      </div>
    </main>
  )
}
