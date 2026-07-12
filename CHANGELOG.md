# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/);
o projeto segue [SemVer](https://semver.org/lang/pt-BR/) a partir da primeira
release pública.

## [Não lançado]

### Adicionado

- Spec fundadora do produto (persona leigo-first, Brand IR, kit por slots,
  guard por construção) e plano-mestre do M1 com contratos entre subsistemas.
- Motor Python (`packages/engine`) concluído no escopo do Plano 1:
  - intake de PDF, SVG/PNG, arquivos de fonte e tokens DTCG, com evidência e
    confirmação por wizard;
  - sanitização de SVG com `defusedxml`, defesa de paths e validação de imagens
    hostis;
  - compilação determinística do Brand IR, com revisões imutáveis e proveniência;
  - gerador de dez Layout Specs adaptados aos quatro perfis canônicos;
  - Guard estático para contrato, obrigatoriedade, comprimento, resolução e
    contraste, sem alteração silenciosa de conteúdo;
  - CLI `brandrt` (`extract`, `compile`, `kit`, `guard`, `schemas`) e API Python
    pública para integração com os próximos planos.
- Schemas públicos de Brand IR, Layout Spec, Content Spec e Guard Verdict.
- Padrões de engenharia (`ENGINEERING.md`), ADRs iniciais, CI e licenças
  (AGPL-3.0 para o app, MIT para os schemas).

### Pendente no Marco 1

- Biblioteca única de render e export PNG/PDF (Plano 2).
- API, persistência e jobs de export (Plano 3).
- Wizard, editor por slots, Docker Compose e E2E (Plano 4).
- Validação do kit com três marcas reais e mutation tests do Guard.
