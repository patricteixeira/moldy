# brand-runtime-engine

Motor de marca do brand-runtime: intake de pacote informal de marca, extração
com evidência, Brand IR imutável, kit, Guard e arquivos OOXML nativos por
template-fill — exposto pela CLI `brandrt`.

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

### M2 — PPTX e DOCX nativos

O tema é derivado uma vez em uma cópia do template; o template original nunca é
sobrescrito. Em seguida, `native-pptx` ou `native-docx` preenche os placeholders
com o mesmo Brand IR, Layout Spec e Content Spec do M1:

```bash
brandrt native-theme ir.json template.pptx --out marca-theme.pptx
brandrt native-pptx ir.json kit/announce-post-1x1.json slide-content.json \
  marca-theme.pptx --assets-dir PACKAGE_DIR \
  --native-layout "Title and Content" --out out/apresentacao.pptx

brandrt native-theme ir.json template.docx --out marca-theme.docx
brandrt native-docx ir.json kit/one-pager-doc-a4.json doc-content.json \
  marca-theme.docx --assets-dir PACKAGE_DIR --out out/documento.docx

brandrt native-inspect out/apresentacao-editada.pptx
brandrt native-preview out/apresentacao.pptx --out-dir out/preview
```

O DOCX usa placeholders de parágrafo `{{slot:<id>}}`, por exemplo
`{{slot:title}}`, `{{slot:body}}` e `{{slot:logo}}`. O PPTX exige um layout
nativo com placeholders de título e corpo; os shapes recebem tags redundantes
`br:<role>:<slot>` e descrição semântica para serem reencontrados depois de um
save externo.

O preview requer LibreOffice. A imagem isolada do spike pode ser construída com:

```bash
docker build -f infra/docker/native-preview.Dockerfile -t brandrt-native-preview .
docker run --rm --network none --read-only --cap-drop ALL \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m \
  -v "$PWD/out:/work" brandrt-native-preview \
  native-preview /work/apresentacao.pptx --out-dir /work/preview
```

`native-preview` retorna código `4` quando a conversão falha, sem invalidar nem
alterar o OOXML estruturalmente correto.

### M3 — round-trip PPTX

O primeiro corte do M3 valida um PPTX editado externamente e recupera seus
objetos semânticos em um `Document Graph 0.1.0`. O arquivo-fonte nunca é
alterado:

```bash
brandrt roundtrip-parse apresentacao-editada.pptx --out document-graph.json
brandrt roundtrip-lint baseline-graph.json document-graph.json \
  --brand-ir ir.json --out roundtrip-report.json
brandrt roundtrip-plan document-graph.json roundtrip-report.json \
  --out fix-plan.json
brandrt roundtrip-fix apresentacao-editada.pptx baseline-graph.json fix-plan.json \
  --brand-ir ir.json --out apresentacao-corrigida.pptx \
  --result-out fix-result.json
```

O grafo registra identidade SHA-256, roles, slots, revisão de marca, texto,
tipografia, cor e bounds. A origem semântica também é preservada (`name`,
`description` ou `placeholder`) para o futuro linter avaliar cada vínculo.
O relatório separa alterações informativas de avisos, erros de marca e regras
travadas, preservando valores esperados e atuais para um fix plan auditável.
O plano contém somente propriedades visuais corrigíveis e o fixer sempre salva
uma cópia, confere os hashes do plano, valida o OOXML e executa o linter outra
vez. Alterações de texto nunca são revertidas automaticamente.

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
newline final. Escritas usam substituição atômica. `schemas` publica os contratos
de Brand IR, Layout Spec, Content Spec, Guard Verdict, Document Graph, relatório
de round-trip, Fix Plan e Fix Result.

## API Python

As operações do plano-mestre também são reexportadas na raiz do pacote:

```python
from brand_runtime import (
    build_draft,
    build_fix_plan,
    compile_ir,
    derive_branded_template,
    generate_kit,
    apply_pptx_fix_plan,
    render_docx,
    render_pptx,
    run_static_checks,
)
```
