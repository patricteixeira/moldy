# ADR 0005 — Uma única biblioteca de render para preview e export

**Status:** aceito (11/07/2026)

## Contexto

Divergência entre o que o usuário vê no editor e o arquivo exportado é uma
classe inteira de bugs em ferramentas de design, e um leigo não sabe
diagnosticá-la.

## Decisão

Uma única biblioteca TypeScript transforma (Brand IR + Layout Spec + Content
Spec) → DOM. O preview do editor e a página de export usam **o mesmo código**;
o export carrega a mesma página em Chromium headless (Playwright) e produz PNG
(screenshot) ou PDF (print A4 para doc-a4). WYSIWYG por construção.

## Alternativas consideradas

- Render server-side em Python (Pillow/WeasyPrint) + preview web separado:
  dois motores de layout → divergência garantida.
- Export por serialização de canvas no cliente: sem determinismo nem
  reprodutibilidade server-side.

## Consequências

Determinismo exige fontes servidas localmente e teste de igualdade de bytes no
CI (mesmo payload → mesmo PNG). Medições dependentes de texto (overflow real)
vivem na página de render e são reportadas via `window.__GUARD_REPORT__`
(contrato no plano-mestre do M1).
