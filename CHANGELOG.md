# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/);
o projeto segue [SemVer](https://semver.org/lang/pt-BR/) a partir da primeira
release pública.

## [Não lançado]

### Adicionado

- Spec fundadora do produto (persona leigo-first, Brand IR, kit por slots,
  guard por construção) e plano-mestre do M1 com contratos entre subsistemas.
- Motor Python (`packages/engine`, em andamento — Plano 1):
  - módulo de cores (normalização, deltaE CIEDE2000, contraste WCAG 2.1);
  - modelos do Brand IR com evidência/proveniência e export de JSON Schema;
  - extração de paleta e de fontes de PDFs de diretrizes (PyMuPDF);
- Padrões de engenharia (`ENGINEERING.md`), ADRs iniciais, CI e licenças
  (AGPL-3.0 para o app, MIT para os schemas).
