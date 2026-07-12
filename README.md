# brand-runtime <small>(nome provisório)</small>

> Runtime de marca open source e self-hosted: interpreta uma identidade visual
> existente, converte-a num perfil executável e dá a pessoas leigas um ambiente
> de criação onde sair da marca é impossível por construção.

O sistema **não cria identidade visual** — ele lê a que já existe (manual em
PDF, logos, fontes, cores anotadas), transforma tudo num **Brand IR**
versionado e gera trilhos (kits de layout com slots) dentro dos quais qualquer
pessoa produz posts, documentos e materiais corretos em relação à marca.

**Status: em construção** — Marco 1 (walking skeleton) em implementação.
A spec fundadora está em
[`docs/superpowers/specs/2026-07-11-brand-runtime-design.md`](docs/superpowers/specs/2026-07-11-brand-runtime-design.md).

## Estrutura do repositório

```
packages/engine/   Motor Python: intake (extração + confirmação), Brand IR,
                   gerador de kit, guard estático, CLI `brandrt`
schemas/           JSON Schemas publicados do Brand IR e specs (licença MIT)
docs/              Spec fundadora, planos de implementação e ADRs
ENGINEERING.md     Padrões de engenharia e segurança do projeto
```

Componentes previstos pelo plano-mestre do M1 (`docs/superpowers/plans/`):
`packages/render` (biblioteca TS de render — preview e export do mesmo código),
`apps/api` (FastAPI) e `apps/web` (wizard + editor por slots).

## Como rodar o motor (engine)

Pré-requisitos: Python 3.12+ (desenvolvido em 3.14).

```bash
cd packages/engine
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"      # Windows (em POSIX: .venv/bin/pip)
.venv/Scripts/python -m pytest -q          # suíte de testes
.venv/Scripts/brandrt --help               # CLI (disponível ao fim do Plano 1)
```

## Documentação

- **Spec fundadora** — tese, personas, arquitetura e marcos: `docs/superpowers/specs/`
- **Planos de implementação** — tarefas com testes-como-contrato: `docs/superpowers/plans/`
- **Decisões arquiteturais (ADRs)** — `docs/adr/`
- **Padrões de engenharia** — [`ENGINEERING.md`](ENGINEERING.md)

## Licenças

- Aplicação e motor: **AGPL-3.0** ([`LICENSE`](LICENSE)) — quem oferece o
  sistema como serviço deve publicar suas modificações.
- Schemas do Brand IR (`schemas/`): **MIT** ([`schemas/LICENSE`](schemas/LICENSE)) —
  o formato pode ser adotado por qualquer ferramenta, inclusive fechada.
