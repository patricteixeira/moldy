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
