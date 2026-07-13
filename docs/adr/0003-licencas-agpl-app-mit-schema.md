# ADR 0003 — Licenças: AGPL-3.0 no app, MIT nos schemas

**Status:** aceito (11/07/2026); revisão jurídica pendente antes da publicação

## Contexto

O projeto é integralmente open source. O ativo defensável é o motor + o
formato Brand IR; o risco é fork SaaS fechado; a ambição de ecossistema
(adapters de terceiros, M4) exige que o formato seja adotável sem atrito.

## Decisão

- Aplicação e motor: **AGPL-3.0** — quem oferece como serviço publica
  modificações. Também libera o uso de PyMuPDF (AGPL) no extrator.
- Schemas do Brand IR, exemplos e SDKs: **MIT** — adotáveis por qualquer
  ferramenta, inclusive fechada.
- Documentação/spec: CC BY 4.0.

## Alternativas consideradas

MIT/Apache em tudo (máxima adoção, zero proteção contra fork SaaS) e AGPL em
tudo (mata o ecossistema de adapters). Apache-2.0 no lugar do MIT para os
schemas segue em avaliação (patent grant) — decidir na revisão pré-publicação.

## Consequências

Fontes comerciais nunca são redistribuídas pelo repositório ou pela instância
sem licença registrada (política de fontes do intake).
