# ADR 0002 — Stack: Python no núcleo, TypeScript na superfície

**Status:** aceito (11/07/2026)

## Contexto

O system design anterior fixava C# + Open XML SDK — a escolha certa para um
produto OOXML-first. A decisão da ADR 0001 moveu o OOXML para o Marco 2 e
transformou o Marco 1 em um problema de extração (PDF/SVG/fontes) +
orquestração + web. O desenvolvedor principal domina Python e TypeScript, não
.NET.

## Decisão

Python 3.12+ (FastAPI, Pydantic v2, PyMuPDF, Pillow, fontTools, coloraide)
para motor e API; TypeScript (React, Vite) para wizard, editor por slots e a
biblioteca única de render. Sem `uv`/`pnpm` no ambiente atual: `venv`+`pip` e
`npm`.

## Alternativas consideradas

- C# + Open XML SDK: superior para masters/layouts OOXML profundos, mas paga
  a mensalidade de aprender .NET por um marco que deixou de ser o primeiro.
- TypeScript em tudo: ecossistema fraco justamente em extração de PDF e
  leitura/modificação de OOXML.

## Consequências

`python-pptx` é mais fraco que o Open XML SDK; mitigação: OOXML só no M2 com
spikes go/no-go, estratégia template-fill + cirurgia via `lxml`, e
renderizadores isolados atrás do Brand IR — um serviço OOXML dedicado
(inclusive em C#) pode entrar como adapter sem reescrever o resto.
