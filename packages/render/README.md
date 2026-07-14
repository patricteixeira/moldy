# @brand-runtime/render

Renderer autoritativo e sem framework do Brand Runtime. A mesma API pública monta o canvas do preview e da exportação, com dimensões 1:1 em pixels, fontes locais e relatório medido do Brand Guard.

## Desenvolvimento

```bash
cd packages/render
npm ci
npm run format
npm run lint
npm test
npm run typecheck
npm run build
```

O pacote não busca assets na internet em runtime. Imagens, logos e fontes são resolvidos sob `assetsBaseUrl`; apenas o placeholder PNG interno em data URI é aceito fora dessa base.

## Composição editorial 0.3

Quando o Brand IR publica `compositionRules`, o renderer aplica o modo claro ou escuro declarado pelo layout, resolve variantes de logo por alias e monta `lockedLayers` antes dos slots editáveis. O vocabulário fixo inclui formas, o motivo determinístico `diagonal-lines` e assets internos — sem CSS livre ou URLs externas.

Slots podem declarar cor, alinhamento, caixa alta, espaçamento, opacidade, ordem, texto contornado, numeração com zero e uma cor de ênfase. A ênfase é criada com nós de texto e um único `span` na primeira ocorrência exata; durante a edição, uma referência que deixou de existir não injeta marcação e fica para o Brand Guard bloquear na exportação.

Payloads legados sem `schemaVersion`, `compositionMode`, layers ou campos editoriais mantêm o comportamento e a ordem visual anteriores.
