# brand-runtime-engine

Motor de marca do brand-runtime: intake de pacote informal de marca, extração
com evidência, perguntas de wizard, Brand IR imutável, kit de Layout Specs e
guard estático — exposto pela CLI `brandrt`.

Sem I/O de rede e sem banco de dados: tudo arquivo→arquivo.

## Desenvolvimento

```bash
cd packages/engine
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"
.venv/Scripts/python -m pytest -q
.venv/Scripts/python -m ruff check .
```

Requisitos: Python 3.12+ (desenvolvimento em 3.14).
