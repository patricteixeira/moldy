# ADR 0007 — Idioma: documentação e código comentado em PT-BR

**Status:** aceito (12/07/2026)

## Contexto

O §4 do `ENGINEERING.md` exige consistência de vocabulário, e o projeto vinha
com um misto de facto: identificadores em inglês, docstrings e mensagens em
PT-BR, documentação de produto em PT-BR. O requisito de código comentado e
documentado (ver ADR no memory do projeto e `ENGINEERING.md` §5/§7) tornou a
escolha urgente: um passe de documentação cobrirá todo o motor.

## Decisão

- **Docstrings, comentários, ADRs, spec, planos, UI e mensagens ao usuário:
  PT-BR.**
- **Identificadores de código (funções, classes, variáveis): inglês**, por ser
  a convenção idiomática dos ecossistemas Python/TypeScript e das bibliotecas
  usadas — nomes como `build_draft` convivem com docstring em PT-BR.
- Presença de docstring é verificada por máquina (regras `D` do ruff no CI);
  o idioma é convenção revisada em code review.

## Alternativas consideradas

Inglês nas docstrings (repo nasce publicável internacionalmente) — rejeitado
pelo autor: o único desenvolvedor hoje trabalha em PT-BR e toda a documentação
do projeto já é PT-BR. Se/quando o projeto internacionalizar, um passe de
tradução assistida é mecânico.

## Consequências

Contribuidores internacionais encontrarão internals em PT-BR até uma eventual
tradução. O README em inglês na publicação do repo (spec §10) segue como
decisão aberta separada.
