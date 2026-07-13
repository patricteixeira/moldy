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
| `api` | Intake, Brand IR, kit, Guard e jobs HTTP | nenhuma |
| `worker` | Export PNG/PDF com Chromium headless | nenhuma |
| `web` | SPA e proxy nginx autenticado | `127.0.0.1:8080` |

O Compose também executa `data-init`, um job efêmero e sem rede que prepara a
permissão do volume para API e worker não-root; ele termina com código 0 antes
dos quatro serviços permanentes iniciarem.

## Estrutura do repositório

```
packages/engine/   Motor Python: intake (extração + confirmação), Brand IR,
                   gerador de kit, Guard, CLI e export Playwright
packages/render/   Biblioteca TypeScript única de preview/export, DOM 1:1 px
apps/api/          API FastAPI e worker transacional de export
apps/web/          Wizard e editor React por slots
infra/docker/      Imagens e proxy da instância self-hosted
schemas/           JSON Schemas públicos do motor (licença MIT)
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

- [renderer TypeScript](packages/render/README.md)
- [API e worker](apps/api/README.md)
- [app web](apps/web/README.md)

## Documentação

- **Spec fundadora** — tese, personas, arquitetura e marcos: `docs/superpowers/specs/`
- **Planos de implementação** — tarefas com testes-como-contrato: `docs/superpowers/plans/`
- **Decisões arquiteturais (ADRs)** — `docs/adr/`
- **Padrões de engenharia** — [`ENGINEERING.md`](ENGINEERING.md)

## Licenças

- Aplicação e motor: **AGPL-3.0** ([`LICENSE`](LICENSE)) — quem oferece o
  sistema como serviço deve publicar suas modificações.
- Schemas públicos do motor (`schemas/`): **MIT**
  ([`schemas/LICENSE`](schemas/LICENSE)) — Brand IR, Layout Spec, Content Spec e
  Guard Verdict podem ser adotados por qualquer ferramenta, inclusive fechada.
  A escolha ainda passa por revisão jurídica antes da publicação pública
  (ADR 0003).
