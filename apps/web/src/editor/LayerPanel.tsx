import type { JSX } from "react"
import type { LayerOverride, LayoutSpec } from "../api/types"
import type { AddedElementKind } from "./EditorPage"
import {
  editorElements,
  elementGlyph,
  elementLabel,
  elementZIndex,
  isStructuralElement,
  type EditorElement,
} from "./layerModel"

interface LayerPanelProps {
  layout: LayoutSpec
  overrides: Record<string, LayerOverride>
  selectedId: string | null
  onSelect(id: string): void
  onPatch(id: string, patch: Partial<LayerOverride>): void
  onResetAll(): void
  onAdd(kind: AddedElementKind): void
  onDelete(id: string): void
  onDuplicate(id: string): void
}

function ordered(elements: EditorElement[], overrides: Record<string, LayerOverride>) {
  return [...elements].sort((a, b) => {
    const z = elementZIndex(b, overrides[b.id]) - elementZIndex(a, overrides[a.id])
    return z || a.id.localeCompare(b.id, "pt-BR")
  })
}

export function LayerPanel({
  layout,
  overrides,
  selectedId,
  onSelect,
  onPatch,
  onResetAll,
  onAdd,
  onDelete,
  onDuplicate,
}: LayerPanelProps): JSX.Element {
  const elements = editorElements(layout)
  const main = ordered(elements.filter((element) => !isStructuralElement(element)), overrides)
  const structure = ordered(elements.filter(isStructuralElement), overrides)
  const selected = elements.find((element) => element.id === selectedId)
  const selectedZ = selected ? elementZIndex(selected, overrides[selected.id]) : 0

  const renderLayer = (element: EditorElement) => {
    const override = overrides[element.id]
    const hidden = override?.hidden ?? false
    const active = element.id === selectedId
    return (
      <li key={element.id} className="layer-row" data-selected={active || undefined}>
        <button
          type="button"
          className="layer-visibility"
          aria-label={`${hidden ? "Mostrar" : "Ocultar"} ${elementLabel(element)}`}
          aria-pressed={!hidden}
          onClick={() => onPatch(element.id, { hidden: !hidden })}
        >
          {hidden ? "OFF" : "ON"}
        </button>
        <button
          type="button"
          className="layer-select"
          onClick={() => onSelect(element.id)}
          aria-current={active ? "true" : undefined}
        >
          <span className="layer-glyph" aria-hidden="true">{elementGlyph(element)}</span>
          <span>{elementLabel(element)}</span>
        </button>
      </li>
    )
  }

  return (
    <aside className="layer-panel" aria-label="Itens da peça">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">O que aparece</p>
          <h2>Itens da peça</h2>
        </div>
        <span className="layer-count">{elements.length}</span>
      </div>

      <details className="layer-add-menu">
        <summary>+ Adicionar elemento</summary>
        <div className="layer-add-options" role="group" aria-label="Elementos disponíveis">
          <button type="button" aria-label="Adicionar texto" onClick={() => onAdd("text")}>
            <span aria-hidden="true">T</span> Texto
          </button>
          <button type="button" aria-label="Adicionar assinatura" onClick={() => onAdd("signature")}>
            <span aria-hidden="true">@</span> Assinatura
          </button>
          <button type="button" aria-label="Adicionar imagem" onClick={() => onAdd("image")}>
            <span aria-hidden="true">IMG</span> Imagem
          </button>
          <button type="button" aria-label="Adicionar logo" onClick={() => onAdd("logo")}>
            <span aria-hidden="true">BR</span> Logo
          </button>
          <button type="button" aria-label="Adicionar forma ou linha" onClick={() => onAdd("shape")}>
            <span aria-hidden="true">□</span> Forma ou linha
          </button>
        </div>
      </details>

      <ol className="layer-list">{main.map(renderLayer)}</ol>

      {structure.length > 0 ? (
        <details className="layer-structure">
          <summary>Outros itens <span>{structure.length}</span></summary>
          <ol className="layer-list">{structure.map(renderLayer)}</ol>
        </details>
      ) : null}

      <div className="layer-panel-footer">
        {selected?.id.startsWith("user-") ? (
          <div className="layer-item-actions" role="group" aria-label="Ações do elemento selecionado">
            <button type="button" onClick={() => onDuplicate(selected.id)}>Duplicar</button>
            <button type="button" onClick={() => onDelete(selected.id)}>Remover</button>
          </div>
        ) : null}
        <div className="layer-order" role="group" aria-label="Ordem do item selecionado">
          <span>Ordem</span>
          <button
            type="button"
            disabled={!selected || selectedZ >= 20}
            onClick={() => selected && onPatch(selected.id, { zIndex: Math.min(20, selectedZ + 1) })}
            aria-label="Trazer item para frente"
          >
            +
          </button>
          <button
            type="button"
            disabled={!selected || selectedZ <= 0}
            onClick={() => selected && onPatch(selected.id, { zIndex: Math.max(0, selectedZ - 1) })}
            aria-label="Enviar item para trás"
          >
            -
          </button>
        </div>
        <button type="button" className="layer-reset-all" onClick={onResetAll}>
          Desfazer todos os ajustes
        </button>
      </div>
    </aside>
  )
}
