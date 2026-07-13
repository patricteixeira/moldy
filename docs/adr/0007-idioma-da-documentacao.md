# ADR 0007 — Idioma: documentação e código comentado em PT-BR

**Status:** aceito (12/07/2026)

## Contexto

O §4 do `ENGINEERING.md` exige consistência de vocabulário, e o projeto vinha
com um misto de facto: identificadores em inglês, docstrings e mensagens em
PT-BR, documentação de produto em PT-BR. O requisito de código comentado e
documentado (`ENGINEERING.md` §5/§7) tornou a escolha urgente: o motor deve
permanecer legível e revisável no idioma de trabalho do projeto.

## Decisão

- **Docstrings, comentários, ADRs, spec, planos, UI e mensagens ao usuário:
  PT-BR.**
- **Identificadores de código (funções, classes, variáveis): inglês**, por ser
  a convenção idiomática dos ecossistemas Python/TypeScript e das bibliotecas
  usadas — nomes como `build_draft` convivem com docstring em PT-BR.
- Presença e formato de docstrings são verificados por máquina pelas regras `D`
  do Ruff no CI; `ruff format --check` também faz parte do gate. O idioma
  permanece uma convenção verificada em code review.

## Alternativas consideradas

Inglês nas docstrings (repo nasce publicável internacionalmente) — rejeitado
pelo autor: o único desenvolvedor hoje trabalha em PT-BR e toda a documentação
do projeto já é PT-BR. Se/quando o projeto internacionalizar, um passe de
tradução assistida é mecânico.

## Consequências

Contribuidores internacionais encontrarão internals em PT-BR até uma eventual
tradução. O README em inglês na publicação do repo (spec §10) segue como
decisão aberta separada.
