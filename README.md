# Molda

[![CI](https://github.com/patricteixeira/Molda/actions/workflows/ci.yml/badge.svg)](https://github.com/patricteixeira/Molda/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/patricteixeira/Molda?display_name=tag&sort=semver)](https://github.com/patricteixeira/Molda/releases)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-111111.svg)](LICENSE)

> Runtime de marca open source e self-hosted: interpreta uma identidade visual
> existente, converte-a num perfil executável e dá a pessoas leigas um ambiente
> de criação orientado pelas decisões reais da marca.

O sistema **não cria identidade visual** — ele lê a que já existe (manual em
PDF, logos, fontes, cores anotadas), transforma tudo num **Brand IR**
versionado e gera trilhos (kits de layout com slots) dentro dos quais qualquer
pessoa produz posts, documentos e materiais orientados pela marca.

O Guard orienta sem policiar: decisões criativas geram recomendações, mas
continuam salváveis e exportáveis. Apenas falhas de segurança, integridade ou
contrato técnico impedem a produção do arquivo. Veja o
[ADR 0014](docs/adr/0014-guard-orienta-sem-policiar.md).

**Status: v0.2.1** — motor, renderer, API, worker e app web compõem
fluxos executáveis de ponta a ponta, cobertos por testes de contrato, integração,
interface e smoke test da distribuição Docker. A linha `0.x` ainda não promete
estabilidade de todos os contratos internos.
A spec fundadora está em
[`docs/superpowers/specs/2026-07-11-brand-runtime-design.md`](docs/superpowers/specs/2026-07-11-brand-runtime-design.md).

## Quickstart self-hosted

Pré-requisitos: Git e Docker Desktop/Engine com Compose v2. Copie a configuração
e defina um token URL-safe antes da primeira subida (letras, números, ponto,
sublinhado, til ou hífen):

```powershell
Copy-Item .env.example .env
# Edite BRANDRT_TOKEN e BRANDRT_DB_PASSWORD em .env.
docker compose up -d --build --wait
```

Abra `http://localhost:8080`. Para evitar uma porta já ocupada, altere
`BRANDRT_PORT` no `.env` antes de subir a stack. A porta continua ligada somente
a `127.0.0.1`; exposição na rede exige uma decisão operacional explícita e TLS
na frente do serviço.

Sem `BRANDRT_TOKEN`, o Compose usa `brandrt-dev`, destinado apenas a testes
locais. O nginx injeta o convite no proxy same-origin, então o M1 não apresenta
uma tela de login. **Qualquer pessoa que alcance a porta web recebe esse mesmo
convite pelo proxy**; TLS protege o transporte, mas não cria isolamento entre
usuários. Não exponha esta configuração single-tenant sem uma camada de acesso
na frente. Trocar o token com o volume Postgres existente semeia um novo
convite, mas não revoga o anterior; para reiniciar a instância local sem dados:

```powershell
docker compose down -v
```

`down -v` apaga os volumes locais desta stack. Para apenas parar os serviços e
preservar os dados, use `docker compose down`.

### Escopo conhecido da v0.2

- a distribuição suportada é self-hosted e single-tenant, sem login por pessoa;
- a porta fica restrita a localhost; exposição pública exige TLS e controle de
  acesso externos;
- o round-trip PPTX está comprovado em Google Slides, LibreOffice e testes
  estruturais, mas o gate de PowerPoint Desktop continua aberto;
- o SDK e o contrato de adapters estão disponíveis, mas o importador Figma e a
  instância pública multi-tenant não fazem parte deste corte.

Veja as [notas completas da v0.2.1](docs/releases/v0.2.1.md) e a
[política de segurança](SECURITY.md).

| Serviço | Responsabilidade | Porta publicada |
| --- | --- | --- |
| `postgres` | Revisões, documentos e fila persistente | nenhuma |
| `font-fetch` | Egress restrito ao snapshot oficial de fontes abertas | nenhuma |
| `api` | Intake, Brand IR, kit, Guard e jobs HTTP | nenhuma |
| `worker` | Export PNG/PDF, round-trip e aplicação de marca no Word | nenhuma |
| `web` | SPA e proxy nginx autenticado | `127.0.0.1:8080` |

O Compose também executa `data-init`, um job efêmero e sem rede que prepara a
permissão do volume para API e worker não-root; ele termina com código 0 antes
dos cinco serviços permanentes iniciarem.

Quando o manual está em inglês, a leitura de identidade é traduzida localmente
para PT-BR e o original permanece disponível para conferência. O modelo aberto é
fixado e incorporado no build da API: não existe API key, cobrança por uso nem
envio do manual a um serviço de tradução. O primeiro build baixa cerca de 66 MiB;
consulte o [ADR 0017](docs/adr/0017-traducao-local-do-manual.md) e os
[avisos de terceiros](THIRD_PARTY_NOTICES.md).

PDFs achatados, digitalizados ou com letras convertidas em desenho recebem OCR
local em português e inglês. Essa camada é usada somente quando o documento não
tem texto legível e é compartilhada por manifesto, cores declaradas, tipografia
e regras de composição; consulte o [ADR 0018](docs/adr/0018-ocr-local-de-pdfs.md).

Fontes abertas declaradas no manual são resolvidas automaticamente por um
catálogo Google Fonts fixado, conferidas contra o objeto Git esperado, validadas
e armazenadas localmente junto com a licença. A API e o worker não recebem
egress direto, e nenhuma API key é necessária. Famílias ITF FFL presentes no
Fontshare — como Clash Display e General Sans — podem ter a prévia oficial
ativada no wizard: o CSS é carregado pelo navegador diretamente do provedor,
após permissão explícita para a conexão externa, sem proxy, cache ou binário no
repositório. A interface informa os dados técnicos expostos ao provedor e liga
os termos ITF FFL 1.0 aplicáveis. Essa prévia externa não incorpora a fonte no
export. Fontes comerciais ou com
redistribuição restrita continuam exigindo uma licença compatível; o sistema
não as substitui silenciosamente.

Quando o manual declara uma gramática visual completa, o Brand IR 0.3 também
preserva relações de composição — modos claro/escuro, limite do acento,
grafismos, numeração e versões do símbolo. O kit então acrescenta duas provas
editoriais 4:5 coerentes com essas regras. A pessoa edita somente o conteúdo;
moldura, padrão, hierarquia, contraste e logo adequada ao fundo permanecem
travados por construção. A decisão está registrada na
[`ADR 0010`](docs/adr/0010-gramatica-de-composicao-editorial.md).

O Brand IR 0.4 acrescenta a camada que faltava entre identidade e composição:
essência, personalidade, voz e limites de expressão são extraídos localmente
como candidatos, revisados pela pessoa e convertidos numa direção explicável.
Essa direção altera escala, densidade, espaço vazio, sangria e superfície — não
apenas cor e fonte. Sem evidência suficiente, o Molda não inventa um estilo
genérico. Todo esse fluxo funciona offline e sem API key. A decisão e os limites
estão no
[`ADR 0015`](docs/adr/0015-direcao-criativa-local-e-geometria-livre.md).
O catálogo de vinte texturas recomenda opções pela direção confirmada sem
esconder nenhuma alternativa. Sua portabilidade e seus limites estão no
[`ADR 0016`](docs/adr/0016-catalogo-aberto-de-texturas-procedurais.md).

O mesmo princípio organiza o catálogo autoral de composições. Kit e Carrossel
abrem com oito sugestões explicadas, escolhidas localmente a partir de energia,
formalidade, densidade, geometria, superfície e contraste confirmados da marca.
A pessoa pode alternar para todos os modelos a qualquer momento; recomendação é
um ponto de partida, não uma restrição.

## Fluxos recorrentes

Além da edição de uma peça por vez, o kit oferece dois fluxos pensados para o
trabalho semanal:

- **Modo Carrossel:** a pessoa escolhe de 3 a 20 slides e constrói uma sequência
  com capa, conteúdo e fechamento. Cada slide pode usar qualquer composição
  compatível, ser editado por inteiro e voltar à sequência sem perder ajustes.
  As mesmas oito sugestões do Kit aparecem primeiro, e a família melhor
classificada inicia a sequência.

Novos modelos entram primeiro num laboratório isolado de referências. O
Template Corpus registra autoria e licença, valida os bytes, aponta estruturas
repetidas ou apenas recoloridas e compara a gramática anotada com o catálogo
atual. O relatório organiza a crítica, mas nunca promove um template
automaticamente. Veja o [protocolo do corpus](docs/template-corpus.md) e o
[ADR 0019](docs/adr/0019-laboratorio-isolado-de-referencias.md).
- **Aplicar marca ao Word:** um `.docx` existente é analisado antes de qualquer
  mudança. Depois do consentimento, o worker cria uma nova cópia editável com
  estilos, hierarquia, margens, tabelas e logo da marca, preservando texto e
  mídias originais.

O Modo Campanha continua implementado no core como experimento, mas foi retirado
temporariamente da navegação pública enquanto sua experiência é reavaliada. A
aplicação não destrutiva em Word está registrada na
[`ADR 0013`](docs/adr/0013-aplicacao-nao-destrutiva-de-marca-em-docx.md).

## Interface web

O app organiza a jornada em instalação da marca, kit de composições, carrossel,
editor por camadas e aplicação de marca em Word. A linguagem **Oficina Bauhaus
Editorial** usa Papel (`#F2EFE7`) e Grafite (`#202025`) como ambiente de trabalho.
O Âmbar (`#C05518`) aparece somente em decisão, foco e manipulação. Regras,
proporções, tipografia e formas elementares dão orientação sem cards de SaaS,
decoração gratuita ou imitação de ferramentas criativas conhecidas. A interface
é responsiva e reduz o movimento quando solicitado pelo navegador.

No editor, qualquer camada pode ser arrastada, redimensionada e sangrada além
do canvas. A direção confirmada da marca também pode propor uma estrutura e uma
superfície procedural específicas; são pontos de partida editáveis, nunca
travas. O canvas continua representando o corte exato do arquivo exportado.
Quatro texturas aparecem como sugestões para a marca e o catálogo completo,
separado em cinco famílias, continua disponível no mesmo painel.

As transições e os comportamentos de rolagem usam GSAP como aprimoramento
progressivo: conteúdo, navegação e ações continuam disponíveis sem depender da
animação. Instalações open source usam Archivo. Somente a instância oficial
online operada pelo Digital Artisan injeta os WOFF2 protegidos da Synapsis,
mantidos fora do Git e fora da licença open source do sistema.
A direção, os tokens, os contratos de interação e os critérios de qualidade
estão documentados em
[`Oficina Bauhaus Editorial`](docs/design/2026-07-23-oficina-bauhaus-editorial.md).
O documento anterior, [`Mesa de Provas`](docs/design/2026-07-19-mesa-de-provas.md),
permanece como histórico de decisão.

## Estrutura do repositório

```
packages/engine/   Motor Python: intake (extração + confirmação), Brand IR,
                   gerador de kit, Guard, CLI e export Playwright
packages/adapter-sdk-python/
                   SDK MIT sem dependências + adapter DTCG de referência
packages/render/   Biblioteca TypeScript única de preview/export, DOM 1:1 px
apps/api/          API FastAPI, documentos, carrosséis e worker transacional
apps/web/          Wizard, kit, carrossel, editor e fluxo Word em React
infra/docker/      Imagens e proxy da instância self-hosted
schemas/           JSON Schemas públicos do motor (licença MIT)
examples/          Fixtures portáteis para adapters e SDKs (licença MIT)
docs/              Spec fundadora, planos de implementação e ADRs
ENGINEERING.md     Padrões de engenharia e segurança do projeto
```

## Como rodar o motor (engine)

Pré-requisitos: Python 3.12+ (desenvolvido em 3.14).

```bash
cd packages/engine
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"      # Windows (em POSIX: .venv/bin/pip)
.venv/Scripts/python -m pytest -q          # suíte de testes
.venv/Scripts/brandrt --help               # comandos do motor
```

O fluxo arquivo→arquivo completo e os códigos de saída da CLI estão documentados
em [`packages/engine/README.md`](packages/engine/README.md).

Os demais componentes têm instruções próprias:

- [SDK Python para adapters](packages/adapter-sdk-python/README.md)
- [renderer TypeScript](packages/render/README.md)
- [API e worker](apps/api/README.md)
- [app web](apps/web/README.md)

## Documentação

- **Spec fundadora** — tese, personas, arquitetura e marcos: `docs/superpowers/specs/`
- **Planos de implementação** — tarefas com testes-como-contrato: `docs/superpowers/plans/`
- **Decisões arquiteturais (ADRs)** — `docs/adr/`
- **Padrões de engenharia** — [`ENGINEERING.md`](ENGINEERING.md)
- **Adapters comunitários** — [`docs/ecosystem/adapters.md`](docs/ecosystem/adapters.md)
- **Como contribuir** — [`CONTRIBUTING.md`](CONTRIBUTING.md)
- **Segurança** — [`SECURITY.md`](SECURITY.md)
- **Processo de release** — [`RELEASING.md`](RELEASING.md)

## Licenças

- Aplicação e motor: **AGPL-3.0** ([`LICENSE`](LICENSE)) — quem oferece o
  sistema como serviço deve publicar suas modificações.
- Schemas públicos do motor (`schemas/`): **MIT**
  ([`schemas/LICENSE`](schemas/LICENSE)) — Brand IR, Layout Spec, Content Spec e
  Guard Verdict podem ser adotados por qualquer ferramenta, inclusive fechada.
- SDK Python para adapters (`packages/adapter-sdk-python/`): **MIT** — pode ser
  usado por integrações externas sem carregar nem incorporar o engine AGPL.
- Documentação (`docs/`): **CC BY 4.0**
  ([`docs/LICENSE`](docs/LICENSE)) — pode ser adaptada com atribuição.
- Synapsis e ativos de identidade: **proprietários** — não são abrangidos pela
  AGPL e têm uso exclusivo na instância oficial online do Molda operada pelo
  Digital Artisan
  ([`aviso de uso`](apps/web/public/fonts/synapsis/PROPRIETARY-NOTICE.txt)).

As fronteiras e alternativas estão registradas no
[`ADR 0003`](docs/adr/0003-licencas-agpl-app-mit-schema.md). A ratificação final
da revisão de licenças é um gate humano explícito do workflow de release.
