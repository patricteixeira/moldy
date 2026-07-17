# brand-runtime <small>(nome provisório)</small>

> Runtime de marca open source e self-hosted: interpreta uma identidade visual
> existente, converte-a num perfil executável e dá a pessoas leigas um ambiente
> de criação onde sair da marca é impossível por construção.

O sistema **não cria identidade visual** — ele lê a que já existe (manual em
PDF, logos, fontes, cores anotadas), transforma tudo num **Brand IR**
versionado e gera trilhos (kits de layout com slots) dentro dos quais qualquer
pessoa produz posts, documentos e materiais corretos em relação à marca.

**Status: Marco 1 implementado** — motor, renderer, API, worker e app web
compõem um walking skeleton executável de ponta a ponta, coberto por E2E real.
A spec fundadora está em
[`docs/superpowers/specs/2026-07-11-brand-runtime-design.md`](docs/superpowers/specs/2026-07-11-brand-runtime-design.md).

## Quickstart self-hosted

Pré-requisitos: Docker Desktop/Compose. Defina um token URL-safe antes da
primeira subida (letras, números, ponto, sublinhado, til ou hífen):

```powershell
$env:BRANDRT_TOKEN = "troque-por-um-token-local-seguro"
$env:BRANDRT_DB_PASSWORD = "troque-por-uma-senha-local-segura"
docker compose up --build
```

Abra `http://localhost:8080`. A porta é ligada somente a `127.0.0.1`; exposição
na rede exige uma decisão operacional explícita e TLS na frente do serviço.

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

| Serviço | Responsabilidade | Porta publicada |
| --- | --- | --- |
| `postgres` | Revisões, documentos e fila persistente | nenhuma |
| `font-fetch` | Egress restrito ao snapshot oficial de fontes abertas | nenhuma |
| `api` | Intake, Brand IR, kit, Guard e jobs HTTP | nenhuma |
| `worker` | Export PNG/PDF com Chromium headless | nenhuma |
| `web` | SPA e proxy nginx autenticado | `127.0.0.1:8080` |

O Compose também executa `data-init`, um job efêmero e sem rede que prepara a
permissão do volume para API e worker não-root; ele termina com código 0 antes
dos cinco serviços permanentes iniciarem.

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

## Interface web

O app organiza a jornada em três superfícies: instalação da marca, kit de
composições e editor por slots. A linguagem visual combina tipografia editorial,
grade assimétrica e uma paleta mineral com um único acento funcional. A interface
é responsiva, oferece modos claro e escuro conforme a preferência do sistema e
reduz o movimento quando solicitado pelo navegador.

As transições e os comportamentos de rolagem usam GSAP como aprimoramento
progressivo: conteúdo, navegação e ações continuam disponíveis sem depender da
animação. As fontes da interface são servidas localmente pelo próprio app.

## Estrutura do repositório

```
packages/engine/   Motor Python: intake (extração + confirmação), Brand IR,
                   gerador de kit, Guard, CLI e export Playwright
packages/adapter-sdk-python/
                   SDK MIT sem dependências + adapter DTCG de referência
packages/render/   Biblioteca TypeScript única de preview/export, DOM 1:1 px
apps/api/          API FastAPI e worker transacional de export
apps/web/          Wizard e editor React por slots
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

## Licenças

- Aplicação e motor: **AGPL-3.0** ([`LICENSE`](LICENSE)) — quem oferece o
  sistema como serviço deve publicar suas modificações.
- Schemas públicos do motor (`schemas/`): **MIT**
  ([`schemas/LICENSE`](schemas/LICENSE)) — Brand IR, Layout Spec, Content Spec e
  Guard Verdict podem ser adotados por qualquer ferramenta, inclusive fechada.
  A escolha ainda passa por revisão jurídica antes da publicação pública
  (ADR 0003).
- SDK Python para adapters (`packages/adapter-sdk-python/`): **MIT** — pode ser
  usado por integrações externas sem carregar nem incorporar o engine AGPL.
