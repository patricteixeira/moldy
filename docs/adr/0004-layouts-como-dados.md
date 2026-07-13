# ADR 0004 — Layouts como dados (Layout Spec), edição por slots

**Status:** aceito (11/07/2026)

## Contexto

O leigo erra em canvas livre; clonar o editor do Canva é fracasso de escopo; e
regras de marca só são verificáveis se a composição for estruturada.

## Decisão

Layouts são **dados** (JSON: slots tipados, áreas em px, constraints, política
de fitting), gerados pelo Kit Generator a partir do Brand IR e validados por
schema publicado. O usuário edita preenchendo slots (texto, imagem, escolha de
variação) — nunca manipulando a composição diretamente.

## Alternativas consideradas

- Canvas livre com linter por cima: reintroduz todas as violações que o
  produto promete impossibilitar.
- Templates como HTML solto: não validável, não multi-formato, não evolutivo.

## Consequências

O poder expressivo do Layout Spec é a aposta técnica central do M1 (risco R2
da spec): pobre demais → kit genérico; rico demais → motor de layout completo.
Calibrar com marcas reais; evoluir o schema por necessidade demonstrada.
Mudar de proporção é adaptação de layout (composição própria por perfil),
nunca resize.
