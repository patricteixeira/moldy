# brand-runtime <small>(nome provisório)</small>

> Runtime de marca open source e self-hosted: interpreta uma identidade visual
> existente, converte-a num perfil executável e dá a pessoas leigas um ambiente
> de criação onde sair da marca é impossível por construção.

O sistema **não cria identidade visual** — ele lê a que já existe (manual em
PDF, logos, fontes, cores anotadas), transforma tudo num **Brand IR**
versionado e gera trilhos (kits de layout com slots) dentro dos quais qualquer
pessoa produz posts, documentos e materiais corretos em relação à marca.

**Status: em construção** — o motor Python/CLI (Plano 1) e o renderer com
export PNG/PDF (Plano 2) estão concluídos; API, app web e o E2E do Marco 1
continuam pendentes.
A spec fundadora está em
[`docs/superpowers/specs/2026-07-11-brand-runtime-design.md`](docs/superpowers/specs/2026-07-11-brand-runtime-design.md).

## Estrutura do repositório

```
packages/engine/   Motor Python: intake (extração + confirmação), Brand IR,
                   gerador de kit, Guard, CLI e export Playwright
packages/render/   Biblioteca TypeScript única de preview/export, DOM 1:1 px
schemas/           JSON Schemas públicos do motor (licença MIT)
docs/              Spec fundadora, planos de implementação e ADRs
ENGINEERING.md     Padrões de engenharia e segurança do projeto
```

Componentes ainda previstos pelo plano-mestre do M1
(`docs/superpowers/plans/`): `apps/api` (FastAPI) e `apps/web` (wizard + editor
por slots).

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
