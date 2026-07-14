# Plano M3.3 — correção segura em cópia

**Objetivo:** transformar findings corrigíveis em operações auditáveis, aplicá-las
somente sobre os bytes analisados e relintar uma nova cópia do PPTX.

## Decisões

- `FixPlan 0.1.0` referencia os SHA-256 exatos do baseline e do arquivo editado;
- cada operação aponta slide, nó, role, slot, propriedade, alvo e findings de
  origem; propriedades duplicadas são deduplicadas e a regra de marca de maior
  severidade prevalece;
- somente fonte, tamanho, cor e geometria podem entrar no plano; conteúdo textual
  e violações estruturais ficam explícitos em `deferredFindingCodes`;
- o fixer recusa fonte e destino iguais, bytes diferentes dos analisados, slide
  inexistente ou identidade semântica ambígua;
- o PPTX é salvo em arquivo temporário, validado e publicado por troca atômica;
- `FixResult 0.1.0` registra hashes, operações aplicadas e o relatório completo do
  relint.

## Fixture real

Entrada editada: `C:/Users/patri/Downloads/proof.pptx`, SHA-256
`4e1f4a60f061dc47555e7a20b802cff665e2641abb99019ae57d0efeb0bc0225`.

Plano: `docs/validation/2026-07-14-m3-google-slides-fix-plan.json`.

Resultado: `docs/validation/2026-07-14-m3-google-slides-fix-result.json`.

A cópia corrigida recebeu a cor original do heading e a geometria original do
logo. O relint preservou os dois textos editados, reduziu os findings a dois
itens informativos e terminou com zero warning, error, locked ou fixable.

## Próximo contrato

M3.4 persistirá upload, Document Graph, relatório, Fix Plan e resultado em um job
transacional da API/worker, sem confiar em paths fornecidos pelo cliente.
