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

### Export (render)

O export usa o mesmo renderer TypeScript do preview, executado em Chromium
headless. O setup local completo é:

```bash
cd packages/engine
.venv/Scripts/pip install -e ".[dev,export]"
.venv/Scripts/python -m playwright install chromium
cd ../render
npm install
npm run build
```

## Uso

Depois da instalação em modo de desenvolvimento, a CLI `brandrt` expõe o
walking skeleton completo do motor:

```bash
brandrt extract PACKAGE_DIR --out draft.json
brandrt compile draft.json answers.json --name "Nome da marca" --out ir.json
brandrt kit ir.json --out-dir kit
brandrt guard ir.json kit/statement-post-1x1.json content.json --assets-dir PACKAGE_DIR
brandrt schemas --out-dir schemas
brandrt export ir.json kit/statement-post-1x1.json content.json \
  --assets-dir PACKAGE_DIR --render-dist ../render/dist --out out/post.png
```

Exemplo mínimo, partindo de um pacote em `./minha-marca`:

```bash
brandrt extract ./minha-marca --out draft.json
# Confirme os candidatos do draft e salve as escolhas em answers.json.
brandrt compile draft.json answers.json --name "Minha Marca" --out ir.json
brandrt kit ir.json --out-dir kit
brandrt guard ir.json kit/statement-post-1x1.json content.json --assets-dir ./minha-marca
brandrt schemas --out-dir schemas
```

No Prompt de Comando do Windows, o mesmo export pode ser quebrado em duas
linhas com `^`:

```bash
.venv/Scripts/brandrt export ir.json kit/statement-post-1x1.json content.json ^
  --assets-dir pacote-da-marca --render-dist ../render/dist --out out/post.png
```

`answers.json` usa os ids das perguntas do draft como chaves:

```json
{
  "values": {
    "color.primary": "#1A4D8F",
    "color.background": "#FFFFFF",
    "color.text": "#1A1A1A",
    "font.heading": {"family": "Archivo", "weight": 700, "style": "normal"},
    "font.body": {"family": "Inter", "weight": 400, "style": "normal"},
    "logo.primary": "assets/logos/logo.svg"
  }
}
```

O comando `guard` imprime o artefato `{"checks": [...]}` em JSON, inclusive
quando há bloqueios. Códigos de saída: `0` quando não existe `blocked` (`pass`
e `fixed` são não bloqueantes), `2` para entrada/JSON/I/O inválido e `3` para um
verdict válido com ao menos um `blocked`. Erros aparecem em PT-BR no `stderr`.

Todos os artefatos são UTF-8 sem BOM, camelCase, indentados com dois espaços e
newline final. Escritas usam substituição atômica. `schemas` publica:
`brand-ir.schema.json`, `layout-spec.schema.json`, `content-spec.schema.json` e
`guard-verdict.schema.json`.

## API Python

As operações do plano-mestre também são reexportadas na raiz do pacote:

```python
from brand_runtime import build_draft, compile_ir, generate_kit, run_static_checks
```
