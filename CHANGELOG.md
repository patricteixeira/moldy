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
- Brand IR 0.2 e resolução automática de fontes abertas por catálogo oficial
  fixado, com licença, cobertura pt-BR, eixos variáveis, CAS e egress isolado.
- Wizard com entrada manual de família tipográfica, paleta completa por papel
  sem perder as recomendações semânticas, alternativas claras/escuras de fundo
  declaradas pelo manual e prévias permitidas de fontes ITF FFL carregadas
  diretamente do Fontshare, sem re-hospedar seus binários; nomes digitados usam
  a variante catalogada mais próxima quando o peso preferido não existe.
- Brand IR 0.3 com gramática de composição explícita, aliases de logo para
  fundos claros/escuros sem recoloração e dois layouts editoriais 4:5 gerados
  somente quando o manual declara modos, proporção, limite de acento, padrão e
  numeração; o editor expõe apenas conteúdo e o Guard protege contraste,
  destaque, tamanho do símbolo e presença cromática.
- Renderer autoritativo TypeScript (`packages/render`) concluído no Plano 2:
  - DOM 1:1 px e fitting determinístico, com pipeline estável compartilhado
    por prévia e exportação;
  - fontes locais por SHA-256, imagens decodificadas antes do sinal de pronto e
    isolamento contra estilos do app;
  - validação de payload hostil, contenção de origem e relatório medido de
    overflow/fallback;
  - gate Biome, tipagem estrita, suíte unitária e build Vite reproduzível.
- Export PNG/PDF pelo Chromium pinado, com publicação atômica, PDF
  determinístico, equivalência RGBA prévia×exportação e Brand Guard estático +
  medido antes de publicar qualquer arquivo.
- Padrões de engenharia (`ENGINEERING.md`), ADRs iniciais, CI e licenças
  (AGPL-3.0 para o app, MIT para os schemas).

### Segurança

- Bases Nginx do web e do proxy de fontes atualizadas para 1.30.3, com digest
  fixado fora das faixas vulneráveis conhecidas da linha 1.27.

### Próximas validações

- Ampliar a validação do kit para três marcas reais e adicionar mutation tests
  do Guard.
