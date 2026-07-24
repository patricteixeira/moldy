import { useEffect, useRef, useState, type ChangeEvent, type JSX } from "react"
import { ApiError, contentAddressedPath } from "../api/client"
import { useApi } from "../api/context"
import type {
  BrandIr,
  LayerOverride,
  LayoutSpec,
  Slot,
  SlotValue,
  SurfaceStyle,
} from "../api/types"
import {
  hasAutomaticLogoPair,
  logoAssetLabel,
  logoAssetTokens,
  uniqueLogoCount,
} from "../logoAssets"
import { DirectionPanel } from "./DirectionPanel"
import { exactOccurrenceCount } from "./emphasis"
import { elementArea, elementLabel, elementOpacity, elementZIndex, findEditorElement } from "./layerModel"

interface SlotFormProps {
  brandIr: BrandIr
  layout: LayoutSpec
  selectedId: string | null
  values: Record<string, SlotValue>
  overrides: Record<string, LayerOverride>
  onChange(slotId: string, value: SlotValue | null): void
  onPatch(elementId: string, patch: Partial<LayerOverride>): void
  onReset(elementId: string): void
  surface: SurfaceStyle | null
  onSurfaceChange(surface: SurfaceStyle | null): void
  onApplyDirection(): void
  backgroundColorToken: string | null
  onBackgroundColorChange(colorToken: string | null): void
  assetBindings: Record<string, string>
  onAssetBindingChange(slotId: string, assetToken: string | null): void
  disabled?: boolean
  onUploadingChange?(uploading: boolean): void
}

type UploadState =
  | { phase: "idle" }
  | { phase: "uploading" }
  | { phase: "ready" }
  | { phase: "error"; message: string }

const IDLE_UPLOAD: UploadState = { phase: "idle" }
const MAX_EDITOR_AREA_PX = 32_768

function numberValue(value: string): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
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

export function SlotForm({
  brandIr,
  layout,
  selectedId,
  values,
  overrides,
  onChange,
  onPatch,
  onReset,
  surface,
  onSurfaceChange,
  onApplyDirection,
  backgroundColorToken,
  onBackgroundColorChange,
  assetBindings,
  onAssetBindingChange,
  disabled = false,
  onUploadingChange,
}: SlotFormProps): JSX.Element {
  const api = useApi()
  const mountedRef = useRef(true)
  const uploadGenerationRef = useRef<Record<string, number>>({})
  const activeUploadsRef = useRef(new Set<string>())
  const onUploadingChangeRef = useRef(onUploadingChange)
  const [uploadStates, setUploadStates] = useState<Record<string, UploadState>>({})

  useEffect(() => {
    onUploadingChangeRef.current = onUploadingChange
  }, [onUploadingChange])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      activeUploadsRef.current.clear()
      onUploadingChangeRef.current?.(false)
    }
  }, [])

  const reportUploading = (): void => {
    onUploadingChangeRef.current?.(activeUploadsRef.current.size > 0)
  }

  const modelBackgroundToken =
    layout.background.kind === "color" ? (layout.background.colorToken ?? null) : null
  const activeBackgroundToken = backgroundColorToken ?? modelBackgroundToken
  const logoSlots = layout.slots.filter((slot) => slot.kind === "logo")
  const logoLayers = (layout.lockedLayers ?? []).filter(
    (layer) => layer.kind === "asset" && layer.assetToken.startsWith("logo."),
  )
  const logoElements = [...logoSlots, ...logoLayers]
  const availableLogoTokens = logoAssetTokens(brandIr)
  const availableLogoCount = uniqueLogoCount(brandIr)
  const automaticLogoPair = hasAutomaticLogoPair(brandIr)
  const explicitLogoTokens = Array.from(
    new Set(
      logoElements
        .map((element) => assetBindings[element.id])
        .filter((token): token is string => typeof token === "string"),
    ),
  )
  const activeLogoToken =
    explicitLogoTokens.length === 1 &&
    logoElements.every((element) => assetBindings[element.id] === explicitLogoTokens[0])
      ? explicitLogoTokens[0]
      : ""
  const applyLogo = (assetToken: string | null): void => {
    for (const element of logoElements) onAssetBindingChange(element.id, assetToken)
  }
  const renderColorChoices = ({
    activeToken,
    groupLabel,
    itemLabel,
    onSelect,
  }: {
    activeToken: string | null
    groupLabel: string
    itemLabel: string
    onSelect(colorToken: string): void
  }): JSX.Element => (
    <div className="canvas-color-grid" role="group" aria-label={groupLabel}>
      {Object.entries(brandIr.colors).map(([token, color]) => (
        <button
          key={token}
          type="button"
          className="canvas-color-option"
          title={`${humanizeToken(token, "color.")} · ${color.value}`}
          aria-label={`${itemLabel}: ${humanizeToken(token, "color.")}, ${color.value}`}
          aria-pressed={activeToken === token}
          data-active={activeToken === token || undefined}
          disabled={disabled}
          onClick={() => onSelect(token)}
        >
          <span className="canvas-color-swatch" style={{ backgroundColor: color.value }} />
          <span>
            <b>{humanizeToken(token, "color.")}</b>
            <small>{color.value}</small>
          </span>
        </button>
      ))}
    </div>
  )
  const logoPanel =
    logoElements.length > 0 ? (
      <section className="inspector-section canvas-logo-quick logo-binding-panel">
        <div>
          <h3>Logo da peça</h3>
          <p className="field-guidance">Troque todas as ocorrências sem alterar o fundo.</p>
        </div>
        <label htmlFor="canvas-logo-binding">
          <span>Versão da logo</span>
          <select
            id="canvas-logo-binding"
            name="canvas-logo-binding"
            value={activeLogoToken}
            disabled={disabled}
            onChange={(event) => applyLogo(event.currentTarget.value || null)}
          >
            <option value="">Automática para o fundo</option>
            {availableLogoTokens.map((token) => (
                <option key={token} value={token}>
                  {logoAssetLabel(brandIr, token)}
                </option>
              ))}
          </select>
        </label>
        {automaticLogoPair ? (
          <p className="field-guidance">
            Escolha manualmente ou deixe o Molda usar a versão adequada ao fundo.
          </p>
        ) : availableLogoCount > 1 ? (
          <p className="field-guidance">
            As {availableLogoCount} versões carregadas estão disponíveis. Como esta revisão não
            definiu um par claro/escuro, o automático usa a principal.
          </p>
        ) : (
          <p className="field-guidance field-guidance-warning">
            Esta revisão tem apenas uma versão da logo. Fundos de baixo contraste podem esconder
            a marca.
          </p>
        )}
      </section>
    ) : null
  const backgroundPanel = (
    <section className="inspector-section canvas-background-panel canvas-global-control">
      <div className="canvas-background-heading">
        <div>
          <p className="panel-kicker">Ajuste global</p>
          <h3>Fundo da peça</h3>
          <p className="field-guidance">
            Altera somente o fundo. O item selecionado mantém sua própria cor.
          </p>
        </div>
        <button
          type="button"
          className="canvas-background-reset"
          aria-label="Usar o fundo do modelo"
          disabled={disabled || backgroundColorToken === null}
          onClick={() => onBackgroundColorChange(null)}
        >
          Usar o modelo
        </button>
      </div>
      {renderColorChoices({
        activeToken: activeBackgroundToken,
        groupLabel: "Cor de fundo da peça",
        itemLabel: "Fundo",
        onSelect: onBackgroundColorChange,
      })}
    </section>
  )

  const handleImage = async (slotId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ""
    if (!file) return

    const generation = (uploadGenerationRef.current[slotId] ?? 0) + 1
    uploadGenerationRef.current[slotId] = generation
    activeUploadsRef.current.add(slotId)
    reportUploading()
    setUploadStates((current) => ({ ...current, [slotId]: { phase: "uploading" } }))

    try {
      const uploaded = await api.uploadAsset(file)
      if (!mountedRef.current || uploadGenerationRef.current[slotId] !== generation) return
      onChange(slotId, {
        kind: "image",
        path: contentAddressedPath(uploaded.sha256),
        sha256: uploaded.sha256,
      })
      setUploadStates((current) => ({ ...current, [slotId]: { phase: "ready" } }))
    } catch (error) {
      if (!mountedRef.current || uploadGenerationRef.current[slotId] !== generation) return
      const message =
        error instanceof ApiError ? error.messagePt : "Não foi possível enviar a foto."
      setUploadStates((current) => ({ ...current, [slotId]: { phase: "error", message } }))
    } finally {
      if (mountedRef.current && uploadGenerationRef.current[slotId] === generation) {
        activeUploadsRef.current.delete(slotId)
        reportUploading()
      }
    }
  }

  const element = findEditorElement(layout, selectedId)
  if (!element) {
    return (
      <aside className="slot-form layer-inspector">
        {logoPanel}
        {backgroundPanel}
        <DirectionPanel
          brandIr={brandIr}
          surface={surface}
          disabled={disabled || layout.profile === "doc-a4"}
          onSurfaceChange={onSurfaceChange}
          onApplyDirection={onApplyDirection}
        />
        <p className="inspector-empty">Escolha um item na peça ou na lista.</p>
      </aside>
    )
  }

  const override = overrides[element.id] ?? {}
  const area = elementArea(element, override)
  const rotationDeg = override.rotationDeg ?? 0
  const opacity = elementOpacity(element, override)
  const zIndex = elementZIndex(element, override)
  const setAreaValue = (index: number, raw: string): void => {
    const parsed = numberValue(raw)
    if (parsed === null) return
    const next = [...area] as [number, number, number, number]
    next[index] = Math.round(parsed)
    if (index === 0 || index === 1) {
      next[index] = Math.max(-MAX_EDITOR_AREA_PX, Math.min(next[index], MAX_EDITOR_AREA_PX))
    }
    if (index === 2 || index === 3) {
      next[index] = Math.max(1, Math.min(next[index], MAX_EDITOR_AREA_PX))
    }
    onPatch(element.id, { area: next })
  }

  const renderTextControls = (slot: Slot) => {
    const currentValue = values[slot.id]
    const text = currentValue?.kind === "text" ? currentValue.text : ""
    const emphasis = currentValue?.kind === "text" ? (currentValue.emphasis ?? "") : ""
    const role = slot.role ? brandIr.roles[slot.role] : null
    const defaultFontToken = role?.font ?? Object.keys(brandIr.fonts)[0] ?? ""
    const fontToken = override.fontToken ?? defaultFontToken
    const font = brandIr.fonts[fontToken]
    const activeColorToken = override.colorToken ?? slot.colorToken ?? null
    const emphasisIsAmbiguous =
      emphasis.length > 0 && exactOccurrenceCount(text, emphasis) !== 1

    return (
      <>
        <section className="inspector-section inspector-content">
          <h3>Conteúdo</h3>
          <label htmlFor={`slot-input-${slot.id}`}>{elementLabel(slot)}</label>
          <textarea
            id={`slot-input-${slot.id}`}
            name={slot.id}
            data-testid={`slot-input-${slot.id}`}
            autoComplete="off"
            disabled={disabled}
            value={text}
            onChange={(event) =>
              onChange(
                slot.id,
                event.currentTarget.value === ""
                  ? null
                  : {
                      kind: "text",
                      text: event.currentTarget.value,
                      ...(emphasis ? { emphasis } : {}),
                    },
              )
            }
          />
          {slot.maxChars != null ? (
            <span
              className="char-counter"
              data-testid={`char-counter-${slot.id}`}
              data-over={text.length > slot.maxChars || undefined}
            >
              {text.length}/{slot.maxChars}
            </span>
          ) : null}
          {slot.emphasisColorToken ? (
            <div className="slot-emphasis-field">
              <label htmlFor={`slot-emphasis-input-${slot.id}`}>Trecho em destaque</label>
              <input
                id={`slot-emphasis-input-${slot.id}`}
                name={`slot-emphasis-${slot.id}`}
                data-testid={`slot-emphasis-input-${slot.id}`}
                type="text"
                autoComplete="off"
                disabled={disabled || text.length === 0}
                required
                aria-required="true"
                aria-describedby={`slot-emphasis-guidance-${slot.id}`}
                value={emphasis}
                aria-invalid={emphasisIsAmbiguous || undefined}
                onChange={(event) => {
                  const nextEmphasis = event.currentTarget.value
                  onChange(slot.id, {
                    kind: "text",
                    text,
                    ...(nextEmphasis ? { emphasis: nextEmphasis } : {}),
                  })
                }}
              />
              <p id={`slot-emphasis-guidance-${slot.id}`} className="field-guidance">
                Copie exatamente uma parte da frase principal.
              </p>
              {emphasisIsAmbiguous ? (
                <p className="field-guidance field-guidance-error" role="status">
                  Faça com que o trecho apareça exatamente uma vez no texto.
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="inspector-section">
          <h3>Fonte e texto</h3>
          <div className="item-color-control">
            <div className="canvas-background-heading">
              <div>
                <strong>Cor deste texto</strong>
                <p className="field-guidance">Afeta apenas {elementLabel(slot)}.</p>
              </div>
              <button
                type="button"
                className="canvas-background-reset"
                aria-label={`Usar a cor do modelo para ${elementLabel(slot)}`}
                disabled={disabled || override.colorToken == null}
                onClick={() => onPatch(slot.id, { colorToken: null })}
              >
                Usar o modelo
              </button>
            </div>
            {renderColorChoices({
              activeToken: activeColorToken,
              groupLabel: `Cor do item: ${elementLabel(slot)}`,
              itemLabel: elementLabel(slot),
              onSelect: (colorToken) => onPatch(slot.id, { colorToken }),
            })}
          </div>
          <div className="inspector-grid inspector-grid-two">
            <label>
              <span>Fonte</span>
              <select
                name={`slot-font-${slot.id}`}
                value={fontToken}
                disabled={disabled}
                onChange={(event) => onPatch(slot.id, { fontToken: event.currentTarget.value })}
              >
                {Object.entries(brandIr.fonts).map(([token, item]) => (
                  <option key={token} value={token}>{item.family}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Peso</span>
              <select
                name={`slot-weight-${slot.id}`}
                value={override.fontWeight ?? font?.weight ?? 400}
                disabled={disabled}
                onChange={(event) => onPatch(slot.id, { fontWeight: Number(event.currentTarget.value) })}
              >
                {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) => (
                  <option key={weight} value={weight}>{weight}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Tamanho</span>
              <input
                name={`slot-size-${slot.id}`}
                type="number"
                min="6"
                max="1024"
                value={override.fontSizePx ?? role?.maxSizePx ?? 24}
                disabled={disabled}
                onChange={(event) => {
                  const value = numberValue(event.currentTarget.value)
                  if (value !== null) onPatch(slot.id, { fontSizePx: Math.max(6, Math.min(1024, value)) })
                }}
              />
            </label>
            <label>
              <span>Estilo</span>
              <select
                name={`slot-style-${slot.id}`}
                value={override.fontStyle ?? font?.style ?? "normal"}
                disabled={disabled}
                onChange={(event) =>
                  onPatch(slot.id, { fontStyle: event.currentTarget.value as "normal" | "italic" })
                }
              >
                <option value="normal">Normal</option>
                <option value="italic">Itálico</option>
              </select>
            </label>
            <label>
              <span>Espaço entre linhas</span>
              <input
                name={`slot-line-height-${slot.id}`}
                type="number"
                min="0.5"
                max="3"
                step="0.05"
                value={override.lineHeight ?? role?.lineHeight ?? 1.2}
                disabled={disabled}
                onChange={(event) => {
                  const value = numberValue(event.currentTarget.value)
                  if (value !== null) onPatch(slot.id, { lineHeight: Math.max(0.5, Math.min(3, value)) })
                }}
              />
            </label>
            <label>
              <span>Espaço entre letras</span>
              <input
                name={`slot-letter-spacing-${slot.id}`}
                type="number"
                min="-0.25"
                max="1"
                step="0.01"
                value={override.letterSpacingEm ?? slot.letterSpacingEm ?? 0}
                disabled={disabled}
                onChange={(event) => {
                  const value = numberValue(event.currentTarget.value)
                  if (value !== null) onPatch(slot.id, { letterSpacingEm: Math.max(-0.25, Math.min(1, value)) })
                }}
              />
            </label>
          </div>
          <div className="inspector-grid">
            <label>
              <span>Caixa</span>
              <select
                name={`slot-case-${slot.id}`}
                value={override.textTransform ?? slot.textTransform ?? "none"}
                disabled={disabled}
                onChange={(event) =>
                  onPatch(slot.id, { textTransform: event.currentTarget.value as "none" | "uppercase" })
                }
              >
                <option value="none">Como digitado</option>
                <option value="uppercase">Maiúsculas</option>
              </select>
            </label>
          </div>
          <div className="segmented-control" role="group" aria-label="Alinhamento do texto">
            {(["left", "center", "right"] as const).map((align) => (
              <button
                key={align}
                type="button"
                data-active={(override.textAlign ?? slot.textAlign ?? "left") === align || undefined}
                onClick={() => onPatch(slot.id, { textAlign: align })}
                disabled={disabled}
              >
                {align === "left" ? "Esq." : align === "center" ? "Centro" : "Dir."}
              </button>
            ))}
          </div>
        </section>
      </>
    )
  }

  const uploadState = uploadStates[element.id] ?? IDLE_UPLOAD
  const canFit = ["image", "logo", "asset"].includes(element.kind)
  const canColor = ["text", "shape", "motif"].includes(element.kind)
  const selectedAssetIsLogo =
    element.kind === "logo" ||
    (element.kind === "asset" && element.assetToken.startsWith("logo."))
  const modelElementColorToken = "colorToken" in element ? (element.colorToken ?? null) : null
  const selectedAssetTokens = selectedAssetIsLogo
    ? availableLogoTokens
    : Object.keys(brandIr.assets).sort((left, right) => left.localeCompare(right))

  return (
    <form className="slot-form layer-inspector" onSubmit={(event) => event.preventDefault()}>
      <div className="panel-heading inspector-heading">
        <div>
          <p className="panel-kicker">Ajustes</p>
          <h2>{elementLabel(element)}</h2>
        </div>
        <span className="element-kind">
          {element.kind === "asset" && selectedAssetIsLogo
            ? "Logo"
            : ({ text: "Texto", image: "Imagem", logo: "Logo", asset: "Arquivo", motif: "Grafismo", shape: "Forma" }[element.kind] ?? "Item")}
        </span>
      </div>

      {element.kind === "text" ? renderTextControls(element) : null}

      {element.kind === "image" ? (
        <section className="inspector-section">
          <h3>Imagem</h3>
          <input
            id={`slot-image-input-${element.id}`}
            name={`slot-image-${element.id}`}
            data-testid={`slot-image-input-${element.id}`}
            type="file"
            accept="image/png,image/jpeg"
            disabled={disabled || uploadState.phase === "uploading"}
            onChange={(event) => void handleImage(element.id, event)}
          />
          {uploadState.phase === "uploading" ? <p role="status">Enviando imagem…</p> : null}
          {uploadState.phase === "ready" ? <p role="status">Foto pronta.</p> : null}
          {uploadState.phase === "error" ? <p role="alert">{uploadState.message}</p> : null}
        </section>
      ) : null}

      {element.kind === "logo" || element.kind === "asset" ? (
        <section className="inspector-section logo-binding-panel">
          <h3>{selectedAssetIsLogo ? "Versão da logo" : "Arquivo usado"}</h3>
          <label htmlFor={`slot-logo-binding-${element.id}`}>
            <span>{selectedAssetIsLogo ? "Logo usada neste item" : "Arquivo usado neste item"}</span>
            <select
              id={`slot-logo-binding-${element.id}`}
              name={`slot-asset-${element.id}`}
              data-testid={`slot-logo-binding-${element.id}`}
              value={assetBindings[element.id] ?? ""}
              disabled={disabled}
              onChange={(event) =>
                onAssetBindingChange(element.id, event.currentTarget.value || null)
              }
            >
              <option value="">
                {selectedAssetIsLogo ? "Automática para o fundo" : "Usar o arquivo do modelo"}
              </option>
              {selectedAssetTokens.map((token) => (
                  <option key={token} value={token}>
                    {selectedAssetIsLogo
                      ? logoAssetLabel(brandIr, token)
                      : humanizeToken(token, "")}
                  </option>
                ))}
            </select>
          </label>
          {selectedAssetIsLogo && automaticLogoPair ? (
            <p className="field-guidance">
              Em fundo claro, escolha “Escura”. Em fundo escuro, escolha “Clara”.
            </p>
          ) : selectedAssetIsLogo && availableLogoCount > 1 ? (
            <p className="field-guidance">
              Você carregou {availableLogoCount} versões. Escolha a adequada para este fundo; o
              automático usa a principal.
            </p>
          ) : selectedAssetIsLogo ? (
            <p className="field-guidance field-guidance-warning">
              Esta revisão tem apenas uma versão da logo. Para alternar com segurança, instale a
              marca novamente com as versões para fundo claro e escuro.
            </p>
          ) : null}
        </section>
      ) : null}

      {(canColor || canFit || element.kind === "motif") && element.kind !== "text" ? (
        <section className="inspector-section">
          <h3>Aparência</h3>
          {canColor ? (
            <div className="item-color-control">
              <div className="canvas-background-heading">
                <div>
                  <strong>Cor deste item</strong>
                  <p className="field-guidance">Afeta apenas {elementLabel(element)}.</p>
                </div>
                <button
                  type="button"
                  className="canvas-background-reset"
                  aria-label={`Usar a cor do modelo para ${elementLabel(element)}`}
                  disabled={disabled || override.colorToken == null}
                  onClick={() => onPatch(element.id, { colorToken: null })}
                >
                  Usar o modelo
                </button>
              </div>
              {renderColorChoices({
                activeToken: override.colorToken ?? modelElementColorToken,
                groupLabel: `Cor do item: ${elementLabel(element)}`,
                itemLabel: elementLabel(element),
                onSelect: (colorToken) => onPatch(element.id, { colorToken }),
              })}
            </div>
          ) : null}
          {canFit ? (
            <label>
              <span>Como preencher o espaço</span>
              <select
                name={`slot-fit-${element.id}`}
                value={override.fit ?? ("fit" in element ? element.fit : "contain") ?? "contain"}
                disabled={disabled}
                onChange={(event) =>
                  onPatch(element.id, { fit: event.currentTarget.value as "contain" | "cover" })
                }
              >
                <option value="contain">Mostrar a imagem inteira</option>
                <option value="cover">Preencher e cortar as bordas</option>
              </select>
            </label>
          ) : null}
          {element.kind === "motif" ? (
            <div className="inspector-grid inspector-grid-two">
              <label>
                <span>Traço</span>
                <input
                  name={`slot-stroke-${element.id}`}
                  type="number"
                  min="0.1"
                  max="20"
                  step="0.1"
                  value={override.strokeWidthPx ?? element.strokeWidthPx}
                  onChange={(event) => {
                    const value = numberValue(event.currentTarget.value)
                    if (value !== null) onPatch(element.id, { strokeWidthPx: value })
                  }}
                />
              </label>
              <label>
                <span>Intervalo</span>
                <input
                  name={`slot-spacing-${element.id}`}
                  type="number"
                  min="1"
                  max="256"
                  value={override.spacingPx ?? element.spacingPx}
                  onChange={(event) => {
                    const value = numberValue(event.currentTarget.value)
                    if (value !== null) onPatch(element.id, { spacingPx: value })
                  }}
                />
              </label>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="inspector-section">
        <h3>Posição e tamanho</h3>
        <p className="field-guidance">
          Use números negativos para levar o item para fora da peça. A largura e a altura podem
          passar das bordas.
        </p>
        <div className="inspector-grid inspector-grid-four">
          {(["X", "Y", "L", "A"] as const).map((label, index) => (
            <label key={label}>
              <span>{label}</span>
              <input
                name={`slot-${element.id}-${label.toLocaleLowerCase("pt-BR")}`}
                type="number"
                min={index < 2 ? -MAX_EDITOR_AREA_PX : 1}
                max={MAX_EDITOR_AREA_PX}
                value={area[index]}
                disabled={disabled}
                onChange={(event) => setAreaValue(index, event.currentTarget.value)}
              />
            </label>
          ))}
        </div>
        <div className="rotation-field">
          <label htmlFor={`rotation-input-${element.id}`}>Rotação</label>
          <span className="rotation-input">
            <input
              id={`rotation-input-${element.id}`}
              name={`slot-rotation-${element.id}`}
              type="number"
              min="-180"
              max="180"
              step="1"
              value={rotationDeg}
              disabled={disabled}
              aria-describedby={`rotation-guidance-${element.id}`}
              onChange={(event) => {
                const value = numberValue(event.currentTarget.value)
                if (value !== null) {
                  onPatch(element.id, {
                    rotationDeg: Math.max(-180, Math.min(180, value)),
                  })
                }
              }}
            />
            <span aria-hidden="true">°</span>
          </span>
          <small id={`rotation-guidance-${element.id}`}>
            Arraste o ponto circular na peça. Segure Shift para intervalos de 15°.
          </small>
        </div>
      </section>

      <section className="inspector-section">
        <h3>Item</h3>
        <label className="range-field">
          <span>Opacidade</span>
          <input
            name={`slot-opacity-${element.id}`}
            type="range"
            min="0"
            max="100"
            value={Math.round(opacity * 100)}
            disabled={disabled}
            onChange={(event) => onPatch(element.id, { opacity: Number(event.currentTarget.value) / 100 })}
          />
          <output>{Math.round(opacity * 100)}%</output>
        </label>
        <div className="inspector-grid inspector-grid-two">
          <label>
            <span>Ordem</span>
            <input
              name={`slot-order-${element.id}`}
              type="number"
              min="0"
              max="20"
              value={zIndex}
              disabled={disabled}
              onChange={(event) => {
                const value = numberValue(event.currentTarget.value)
                if (value !== null) onPatch(element.id, { zIndex: Math.max(0, Math.min(20, Math.round(value))) })
              }}
            />
          </label>
          <label className="toggle-field">
            <span>Visível</span>
            <input
              name={`slot-visible-${element.id}`}
              type="checkbox"
              checked={!override.hidden}
              disabled={disabled}
              onChange={(event) => onPatch(element.id, { hidden: !event.currentTarget.checked })}
            />
          </label>
        </div>
      </section>

      <button
        type="button"
        className="inspector-reset"
        disabled={disabled || !overrides[element.id]}
        onClick={() => onReset(element.id)}
      >
        Desfazer ajustes deste item
      </button>
      {backgroundPanel}
      {selectedAssetIsLogo ? null : logoPanel}
      <DirectionPanel
        brandIr={brandIr}
        surface={surface}
        disabled={disabled || layout.profile === "doc-a4"}
        onSurfaceChange={onSurfaceChange}
        onApplyDirection={onApplyDirection}
      />
    </form>
  )
}
