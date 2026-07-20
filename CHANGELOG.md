# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/);
o projeto segue [SemVer](https://semver.org/lang/pt-BR/) a partir da primeira
release pública.

## [Não lançado]

## [0.1.0] - 2026-07-19

### Alterado

- A porta web da distribuição Docker pode ser escolhida por `BRANDRT_PORT`,
  preservando o bind exclusivo em `127.0.0.1` e o padrão `8080`.
- O Postgres passa a reiniciar com o daemon do Docker; API e worker não ficam em
  loop por ausência do banco depois de reiniciar a máquina ou o Docker Desktop.
- O proxy web re-resolve a API pelo DNS interno do Docker e seu healthcheck
  atravessa essa fronteira; a interface se recupera quando containers recebem
  novos endereços depois de reiniciar o daemon.
- O editor deixa de confinar camadas ao canvas: arraste, resize, teclado e
  campos numéricos aceitam sangria, coordenadas negativas e logos maiores que a
  peça; o corte final continua explícito e desvios geram orientação.
- O wizard passa a revisar essência, personalidade, voz e limites de expressão
  antes de publicar a marca. A direção resultante muda estrutura, escala,
  densidade e espaço vazio, em vez de apenas recolorir um template universal.
- A interface substitui Abertura de Marca por Mesa de Provas: chrome
  monocromático, hierarquia editorial sem accent, instalador como superfície de
  recebimento, editor como mesa gráfica, Kit como catálogo de provas, Campanha
  como linha conectada e Word como sequência documental.
- O editor passa a respeitar a altura real de notebooks, mantém canvas e seleção
  dentro da área interativa e separa links de download dos demais formatos de
  exportação, preservando arraste e ações consecutivas no E2E.
- O Guard agora orienta sem policiar: recomendações criativas usam `warning` e
  não impedem exportação; `blocked` fica reservado a segurança, integridade e
  contratos tecnicamente impossíveis de renderizar.
- O round-trip considera o artefato exportado como baseline autoral: escolhas já
  aceitas não são julgadas de novo, e desvios externos de marca geram orientação
  revisável em vez de bloquear o documento.
- A compilação combina proporções quando uma cor confirmada ocupa mais de um
  papel de composição, preserva evidências e publica a marca normalmente.
- Falhas internas de compilação deixam de culpar genericamente as respostas ou
  o nome da marca.
- A conferência da marca deixa de parecer um questionário técnico: cada decisão
  usa palavras comuns, explica o efeito da escolha, mostra o que ainda falta e
  separa informações encontradas nos arquivos de sugestões iniciais do Molda.
- Instalador, editor, Kit, Campanha e Word trocam termos internos por ações
  diretas para pessoas leigas; no celular, a seleção de arquivos aparece perto
  da primeira dobra e não depende de animação para ficar legível.

### Adicionado

- Brand IR 0.4 com identidade semântica confirmada, direção criativa
  determinística e explicável, extração inteiramente local e degradação honesta
  quando o material não fornece sinal suficiente — sem API key ou custo por
  requisição no core open source.
- Catálogo aberto com 20 texturas procedurais em cinco famílias. O editor
  recomenda quatro pela identidade confirmada, mantém todas disponíveis e
  preserva cor, transparência, tamanho, espessura e rotação no preview, Guard,
  exportação web e PPTX nativo.
- Modo Campanha com fonte compartilhada de título, mensagem, data, CTA e
  imagem; campanhas, peças e documentos persistidos; propagação transacional,
  Guard por formato, biblioteca web, prévias e export final/editável.
- Aplicação não destrutiva de identidade em DOCX existente, com plano prévio
  vinculado ao SHA-256, estilos editáveis `Molda Título`/`Molda Texto`, margens,
  tabelas e logo, fila em duas etapas, preservação verificada de texto/mídias,
  CLI e schemas públicos.

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
- Arquétipos fechados `ornamental-divider` e `restrained-clinical-grid`,
  selecionados somente por prescrições textuais completas do manual e
  materializados como provas 4:5 sem CSS livre nem coordenadas editáveis.
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
- Export PPTX/DOCX nativo integrado à API e ao worker transacional, com
  templates `v1` empacotados por perfil, versão persistida no job, tema
  derivado do Brand IR, logo SVG convertido apenas no workdir, MIME OOXML e
  filename estável no resultado; PPTX também preserva fundo, texto e imagens
  substituíveis como objetos nativos.
- Editor web com saída final PNG/PDF e saída editável PPTX/DOCX no mesmo fluxo
  protegido pelo Guard; a interface orienta explicitamente a continuação no
  Google Slides ou Google Docs e congela os slots durante qualquer exportação.
- Primeiro corte do M3 com parser defensivo de PPTX editado para `Document
  Graph 0.1.0`, schema público e recuperação explícita de roles, slots, revisão,
  conteúdo, estilo e geometria após save em editor externo.
- Linter inicial de round-trip com baseline do artefato exportado, autoridade
  opcional do Brand IR, severidades, resumo para API/web e valores esperados e
  atuais suficientes para construir correções auditáveis.
- Fix Plan e fixer PPTX conservador com verificação de SHA-256, deduplicação por
  propriedade, aplicação atômica apenas em cópia e relint completo do resultado;
  texto e findings estruturais nunca são corrigidos silenciosamente.
- Upload de round-trip ligado ao job PPTX original, jobs separados de análise e
  correção, persistência de graphs/relatório/plano e publicação do resultado pelo
  worker sob o mesmo lease transacional dos exports.
- Mesa de conferência no editor web para receber o PPTX editado, traduzir o
  relatório de round-trip em sinais compreensíveis, preservar alterações de
  texto e baixar uma nova cópia com os ajustes seguros aplicados.
- Primeiro fundamento do M4 com Brand Package 0.1 para adapters externos,
  schemas MIT, validação determinística por CLI, fixture pública e verificação
  opcional no intake HTTP antes de qualquer sanitização ou persistência.
- SDK Python MIT sem dependências para construir Brand Packages por staging,
  com adapter DTCG offline de referência, entry point instalável e testes de
  contrato cruzados contra o validator e o intake reais do engine.
- Padrões de engenharia (`ENGINEERING.md`), ADRs iniciais, CI e licenças
  (AGPL-3.0 para o app, MIT para os schemas).

### Segurança

- Web e proxy de fontes usam a variante oficial mínima do Nginx 1.30.3, fixada
  por digest e sem os pacotes Alpine atingidos pelas CVEs corrigíveis encontradas
  no audit; o gate recusa novas vulnerabilidades High/Critical com correção.

### Corrigido

- `native-inspect` agora resolve cores de color scheme e famílias major/minor
  herdadas do tema após regravação em editores externos, em vez de falhar ou
  retornar fonte nula quando RGB e typeface não estão explícitos no run.

### Validações de fechamento

- Kit validado com Digital Artisan, Fofo's Massage Therapy e VitaCannMed; as
  três revisões exportam provas estruturalmente distintas pelo mesmo pipeline.
- Dezoito violações semeadas cobertas por mutation tests do Guard, incluindo
  contrato, slots, referências, contraste, acento, resolução e integridade.
- Round-trip manual do PPTX no Google Slides web preservou edição nativa,
  descrições semânticas, tema, logo substituível e reinspeção sem finding
  bloqueante; PowerPoint Desktop continua pendente e indisponível no ambiente.
- Contrato M4.1 validado com fixture pública determinística, 257 testes do
  motor e 154 da API; a interface web permaneceu em 95 testes e o E2E Docker
  completo incluiu a volta do PPTX pelo novo round-trip.
- SDK M4.2 validado por testes de segurança e integração, Ruff, build de wheel
  sem dependências, instalação em venv limpa e execução do adapter pela CLI; o
  Brand Package resultante foi aceito pelo engine com SHA-256 determinístico.
- Regressão do corte M2.1 passou com 216 testes do motor, 152 da API/worker e
  92 do app web; a imagem de produção do worker contém e valida os quatro
  templates nativos versionados.
- Regressão do corte M2.2 passou com 93 testes do app web, build de produção e
  E2E Chromium baixando e reabrindo PNG/PDF/PPTX/DOCX contra a stack real.
- A fixture real editada no Google Slides gerou Document Graph determinístico
  com heading, body e logo recuperados, zero diagnóstico e SHA-256 conferido.
- O linter da mesma fixture distinguiu duas edições de conteúdo de duas mudanças
  visuais corrigíveis, sem acusar quebra estrutural inexistente.
- O fixer da fixture real restaurou a cor do heading e a geometria do logo em uma
  nova cópia, preservou os dois textos editados e reduziu o relint a dois itens
  informativos, com zero warning, error, locked ou fixable.
- O fluxo integrado API→worker exportou, reimportou, analisou e corrigiu um PPTX
  nativo pelo storage real de teste, preservando o upload original e eliminando
  todos os findings visuais corrigíveis.

[Não lançado]: https://github.com/patricteixeira/Molda/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/patricteixeira/Molda/releases/tag/v0.1.0
