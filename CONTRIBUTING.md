# Como contribuir

O Molda é um runtime de marca, não um editor genérico. Uma contribuição precisa
preservar a autoria da identidade instalada, a explicabilidade das decisões e a
equivalência entre prévia e arquivo produzido.

## Antes de implementar

1. Leia a [spec fundadora](docs/superpowers/specs/2026-07-11-brand-runtime-design.md),
   os [padrões de engenharia](ENGINEERING.md) e os ADRs ligados à mudança.
2. Para bugs e recortes pequenos, abra uma issue com comportamento atual,
   comportamento esperado e reprodução. Para decisões de produto ou contrato,
   discuta o recorte antes de produzir uma implementação extensa.
3. Vulnerabilidades seguem [SECURITY.md](SECURITY.md), nunca uma issue pública.

## Ambiente

O caminho principal exige Python 3.12+, Node.js 24, npm 11 e Docker
Desktop/Engine com Compose v2.

```powershell
# Motor
python -m venv packages/engine/.venv
packages/engine/.venv/Scripts/pip install -r packages/engine/requirements-lock.txt
packages/engine/.venv/Scripts/pip install --no-deps -e packages/engine

# Renderer e app
npm ci --prefix packages/render
npm ci --prefix apps/web

# Stack real
Copy-Item .env.example .env
# Edite token e senha em .env; mude BRANDRT_PORT se 8080 estiver ocupada.
docker compose up -d --build
```

Em POSIX, use `packages/engine/.venv/bin/python` e `.venv/bin/pip`.

## Gates por componente

```powershell
# Contrato público e ferramentas
python tools/release_check.py --version 0.1.0
python -m unittest discover -s tools/tests -p "test_*.py"

# Engine
packages/engine/.venv/Scripts/python -m ruff format --check packages/engine
packages/engine/.venv/Scripts/python -m ruff check packages/engine
packages/engine/.venv/Scripts/python -m pytest packages/engine -q

# API
packages/engine/.venv/Scripts/python -m ruff format --check apps/api
packages/engine/.venv/Scripts/python -m ruff check apps/api

# Renderer e web
npm --prefix packages/render run check
npm --prefix packages/render run typecheck
npm --prefix packages/render test
npm --prefix packages/render run build
npm --prefix apps/web run typecheck
npm --prefix apps/web test
npm --prefix apps/web run build
```

Os testes da API usam PostgreSQL real no CI. O E2E completo exige a stack
Docker e está documentado em [apps/web/README.md](apps/web/README.md).

## Pull requests

- Crie uma branch curta a partir de `main`.
- Mantenha o diff no problema declarado.
- Inclua testes de comportamento e atualize documentação/ADR quando o contrato
  ou a decisão mudar.
- Use Conventional Commits em português.
- Não versione builds, `.env`, fixtures privadas nem dependências instaladas.

Ao contribuir, você concorda que seu trabalho será distribuído sob as licenças
aplicáveis ao diretório alterado: AGPL-3.0 para aplicação e motor; MIT para
schemas, exemplos e SDK de adapters.
