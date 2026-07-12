# ADR 0001 — Persona primária: usuário leigo ("pior cenário")

**Status:** aceito (11/07/2026)

## Contexto

Os documentos iniciais do projeto desenhavam um produto OOXML-first para um
usuário de marketing que edita PowerPoint e re-envia arquivos para validação.
A pesquisa de mercado não trazia evidência de demanda para esse recorte, e o
primeiro usuário concreto definido pelo autor é uma pessoa leiga: tem uma
marca, não sabe usá-la, quer produzir posts, documentos e templates.

## Decisão

Projetar o produto para o leigo primeiro. Consequências estruturais: a entrada
primária é o pacote informal (PDF + logos + fontes) com extração +
confirmação, não tokens; a ordem dos renderizadores inverte (social/PDF antes
de PPTX); o guardrail padrão é correção/restrição por construção, não
relatório; a superfície de edição é por slots, não canvas livre.

## Alternativas consideradas

Manter a persona marketing (round-trip primeiro) — rejeitada: descreve um
fluxo que o primeiro usuário real nunca executaria.

## Consequências

Se o sistema funciona para quem não sabe as regras da marca, funciona para
todos. O round-trip e as severidades continuam no roadmap (M3), uma camada
depois. O leigo 100% sozinho só é alcançado com instância pública (M4).
