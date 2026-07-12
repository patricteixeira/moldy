# ADR 0006 — Revisões imutáveis com id determinístico por conteúdo

**Status:** aceito (11/07/2026)

## Contexto

A spec herda do system design anterior os requisitos de auditabilidade,
imutabilidade de revisões e determinismo (mesmas entradas → mesmo resultado).
Ids derivados de relógio ou aleatoriedade quebram reprodutibilidade de builds
e de testes.

## Decisão

Revisões do Brand IR são imutáveis e o id é derivado do conteúdo:
`"brandrev_" + sha256(JSON canônico do IR com o bloco revision zerado)[0:12]`.
`created_at` é injetável (para testes) com default UTC. O mesmo princípio vale
para artefatos: storage endereçado por SHA-256 (`sha256/ab/cd/<hash>`).

## Alternativas consideradas

UUIDs aleatórios (não reproduzíveis) e ids sequenciais de banco (acoplam o
motor à persistência — o motor é puro, arquivo→arquivo).

## Consequências

Mesmo pacote + mesmas respostas do wizard → mesma revisão, o que permite
deduplicação e testes de regressão estáveis. Todo valor do IR carrega
evidência (fonte, página, confiança) e confirmação do wizard é sempre
autoritativa sobre inferência.
