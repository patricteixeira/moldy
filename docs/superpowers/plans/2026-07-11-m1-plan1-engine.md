# Plano 1 — Motor da marca (Python) Implementation Plan

**Status:** concluído em 12/07/2026. As 15 tarefas foram implementadas e
integradas na branch `m1-walking-skeleton`; render, API e web pertencem aos
Planos 2–4.

> **Registro histórico:** os checkboxes abaixo preservam o roteiro normativo
> original e não representam o progresso atual. O status acima e o histórico
> de commits são a fonte de verdade da execução.
>
> **Formato deste plano:** os testes de cada tarefa são o contrato completo e obrigatório — implemente por TDD até que passem sem alterá-los (mudança em teste = desvio a reportar). Assinaturas, regras e tabelas dadas aqui são normativas. Onde o corpo da implementação não está escrito, ele é livre desde que os testes e as regras sejam satisfeitos.

**Goal:** o motor Python completo do walking skeleton: pacote informal de marca → extração com evidência → perguntas de wizard → Brand IR imutável → kit de Layout Specs → guard estático, exposto por CLI `brandrt`.

**Architecture:** pacote único `brand_runtime` em `packages/engine` (modular monolith — spec §5.9), sem I/O de rede, sem banco; tudo arquivo→arquivo para ser embrulhado pela API no Plano 3. Modelos Pydantic v2 com JSON camelCase; extração produz `Candidate`s com `Evidence`; autoridade: confirmação do wizard > tokens DTCG > extração (spec §5.3).

**Tech Stack:** Python 3.12+ (dev em 3.14), Pydantic v2, PyMuPDF (fitz), Pillow, fontTools, coloraide, typer, pytest, ruff.

## Global Constraints

- Windows dev: paths só via `pathlib`; testes não podem depender de `/tmp`, usar `tmp_path`.
- Sem rede em runtime e em testes; fixtures geradas programaticamente (PDF via PyMuPDF, PNG via Pillow, TTF via fontTools.fontBuilder) — nenhum binário commitado.
- JSON de saída sempre `by_alias=True` (camelCase); chaves de token com ponto (`color.primary`) são chaves de dict, não atributos.
- Strings visíveis ao usuário (prompts, mensagens de guard, diagnostics `message`): PT-BR.
- Determinismo: `compile_ir` recebe `created_at` injetável; id de revisão derivado de hash do conteúdo (nunca de relógio/aleatório).
- Uploads são hostis: SVG passa por sanitização antes de qualquer parse de cor (spec §5.3).
- Antes de cada commit: `.venv/Scripts/python -m pytest packages/engine -q` verde e `.venv/Scripts/python -m ruff check packages/engine` limpo (comandos a partir de `packages/engine`, ver Task 1).
- Commits na branch `m1-walking-skeleton`, mensagem `feat(engine): <resumo>`.
- Nunca editar este arquivo de plano nem os documentos em `docs/` (o orquestrador rastreia progresso fora do arquivo).

---

### Task 1: Scaffold do pacote engine

**Files:**
- Create: `.gitignore` (raiz do repo)
- Create: `packages/engine/pyproject.toml`
- Create: `packages/engine/src/brand_runtime/__init__.py`
- Create: `packages/engine/README.md`
- Test: `packages/engine/tests/test_sanity.py`

**Interfaces:**
- Produces: pacote instalável `brand_runtime` com `__version__ = "0.1.0"`; ambiente de teste documentado que TODAS as tarefas seguintes usam.

- [ ] **Step 1: Escrever `.gitignore`** (raiz):

```gitignore
__pycache__/
*.pyc
.venv/
.pytest_cache/
.ruff_cache/
dist/
node_modules/
out/
*.egg-info/
```

- [ ] **Step 2: Escrever `packages/engine/pyproject.toml`:**

```toml
[project]
name = "brand-runtime-engine"
version = "0.1.0"
description = "Motor de marca do brand-runtime: intake, Brand IR, kit e guard"
requires-python = ">=3.12"
license = "AGPL-3.0-only"
dependencies = [
  "pydantic>=2.8",
  "pymupdf>=1.24",
  "pillow>=10.4",
  "fonttools>=4.53",
  "coloraide>=4.0",
  "typer>=0.12",
]

[project.optional-dependencies]
dev = ["pytest>=8.2", "ruff>=0.6"]

[project.scripts]
brandrt = "brand_runtime.cli:app"

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.ruff]
line-length = 100
target-version = "py312"
```

- [ ] **Step 3: Criar `src/brand_runtime/__init__.py`** com `__version__ = "0.1.0"`, e `README.md` documentando setup dev (copiar exatamente os comandos abaixo para o README, seção "Desenvolvimento"):

```bash
cd packages/engine
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"
.venv/Scripts/python -m pytest -q
.venv/Scripts/python -m ruff check .
```

- [ ] **Step 4: Teste falhando** `tests/test_sanity.py`:

```python
import brand_runtime


def test_version():
    assert brand_runtime.__version__ == "0.1.0"
```

- [ ] **Step 5:** Rodar setup + teste. Expected: PASS. Se alguma dependência falhar de instalar no Python 3.14, registrar a versão que funcionou com pin no pyproject e reportar como desvio.
- [ ] **Step 6: Commit** `feat(engine): scaffold do pacote brand_runtime`

---

### Task 2: Módulo de cores

**Files:**
- Create: `packages/engine/src/brand_runtime/colors.py`
- Test: `packages/engine/tests/test_colors.py`

**Interfaces:**
- Produces:

```python
def normalize_color(value: str) -> str          # qualquer cor CSS parseável -> "#RRGGBB" maiúsculo; ValueError se inválida
def delta_e(hex_a: str, hex_b: str) -> float    # CIEDE2000 via coloraide
def dedupe_colors(items: list[tuple[str, float]], threshold: float = 6.0) -> list[tuple[str, float]]
    # agrupa cores com delta_e < threshold; representante = cor de maior score do grupo;
    # score do grupo = soma; retorno ordenado por score desc
def wcag_contrast(fg_hex: str, bg_hex: str) -> float   # razão WCAG 2.1 (1..21)
def lightness(hex_color: str) -> float           # L do Lab (0..100)
def is_neutral(hex_color: str) -> bool           # croma C do LCh < 12
```

- [ ] **Step 1: Testes falhando** `tests/test_colors.py`:

```python
import pytest
from brand_runtime.colors import (
    normalize_color, delta_e, dedupe_colors, wcag_contrast, lightness, is_neutral,
)


def test_normalize_variants():
    assert normalize_color("#1a4d8f") == "#1A4D8F"
    assert normalize_color("#abc") == "#AABBCC"
    assert normalize_color("rgb(26, 77, 143)") == "#1A4D8F"
    assert normalize_color("navy") == "#000080"


def test_normalize_invalid():
    with pytest.raises(ValueError):
        normalize_color("isto-nao-e-cor")


def test_delta_e_identical_is_zero():
    assert delta_e("#1A4D8F", "#1A4D8F") == pytest.approx(0.0, abs=1e-6)


def test_dedupe_merges_near_colors():
    result = dedupe_colors([("#1A4D8F", 5.0), ("#1B4E90", 3.0), ("#F4A300", 2.0)])
    assert result[0] == ("#1A4D8F", 8.0)   # vizinhas fundidas, score somado
    assert result[1] == ("#F4A300", 2.0)


def test_wcag_contrast_black_on_white():
    assert wcag_contrast("#000000", "#FFFFFF") == pytest.approx(21.0, abs=0.1)


def test_lightness_and_neutral():
    assert lightness("#FFFFFF") > 99
    assert lightness("#000000") < 1
    assert is_neutral("#808080") is True
    assert is_neutral("#F4A300") is False
```

- [ ] **Step 2:** Rodar, ver falhar (módulo inexistente).
- [ ] **Step 3:** Implementar com `coloraide.Color` (`Color(value).convert("srgb").to_string(hex=True, upper=True)` para normalizar; `Color(a).delta_e(b, method="2000")`; `Color(fg).contrast(bg, method="wcag21")`; Lab/LCh para `lightness`/`is_neutral`).
- [ ] **Step 4:** Testes verdes; suíte completa; ruff.
- [ ] **Step 5: Commit** `feat(engine): módulo de cores (normalização, deltaE, contraste WCAG)`

---

### Task 3: Modelos do Brand IR + export de schema

**Files:**
- Create: `packages/engine/src/brand_runtime/ir/__init__.py`
- Create: `packages/engine/src/brand_runtime/ir/models.py`
- Create: `packages/engine/src/brand_runtime/ir/schema.py`
- Test: `packages/engine/tests/test_ir_models.py`

**Interfaces:**
- Produces (em `ir/models.py`; todos os modelos herdam de um `CamelModel(BaseModel)` com `model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)`):

```python
SourceType = Literal["pdf-guideline", "svg-asset", "raster-asset", "font-file",
                     "dtcg-tokens", "wizard-confirmation", "manual-entry"]

class Evidence(CamelModel):
    source_type: SourceType
    path: str | None = None
    page: int | None = None
    detail: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    authoritative: bool = False
    confirmed_at: datetime | None = None

class ColorToken(CamelModel):
    value: str                      # "#RRGGBB" (validator aplica normalize_color)
    evidence: list[Evidence]

class FontToken(CamelModel):
    family: str
    weight: int = 400               # ge=100, le=900
    style: Literal["normal", "italic"] = "normal"
    source: Literal["file", "referenced-only", "fallback"]
    file_sha256: str | None = None
    evidence: list[Evidence]

class LogoAsset(CamelModel):
    path: str
    sha256: str
    format: Literal["svg", "png"]
    evidence: list[Evidence]
    min_width_px: int = 96
    clear_space_ratio: float = 0.25

class SemanticRole(CamelModel):
    font: str                       # chave em BrandIR.fonts
    color: str                      # chave em BrandIR.colors
    min_size_px: int
    max_size_px: int
    line_height: float

class RevisionInfo(CamelModel):
    id: str
    created_at: datetime

class Diagnostic(CamelModel):
    code: str
    target: str
    message: str                    # PT-BR
    resolution: str | None = None

class BrandInfo(CamelModel):
    name: str

class BrandIR(CamelModel):
    schema_version: Literal["0.1.0"] = "0.1.0"
    brand: BrandInfo
    revision: RevisionInfo
    colors: dict[str, ColorToken]
    fonts: dict[str, FontToken]
    roles: dict[str, SemanticRole]
    assets: dict[str, LogoAsset]
    format_profiles: list[str] = ["post-1x1", "post-4x5", "story-9x16", "doc-a4"]
    diagnostics: list[Diagnostic] = []
```

- Produces (em `ir/schema.py`): `export_schemas(out_dir: Path) -> list[Path]` — escreve `brand-ir.schema.json` (via `BrandIR.model_json_schema(by_alias=True)`); tarefas futuras registram mais modelos na lista interna `_SCHEMAS`.

- [ ] **Step 1: Testes falhando** `tests/test_ir_models.py`:

```python
import json
from datetime import datetime, timezone
from brand_runtime.ir.models import (
    BrandIR, BrandInfo, ColorToken, Evidence, FontToken, LogoAsset,
    RevisionInfo, SemanticRole,
)
from brand_runtime.ir.schema import export_schemas


def _minimal_ir() -> BrandIR:
    ev = Evidence(source_type="wizard-confirmation", confidence=1.0, authoritative=True,
                  confirmed_at=datetime(2026, 7, 11, tzinfo=timezone.utc))
    return BrandIR(
        brand=BrandInfo(name="ACME"),
        revision=RevisionInfo(id="brandrev_abc123", created_at=datetime(2026, 7, 11, tzinfo=timezone.utc)),
        colors={"color.primary": ColorToken(value="#1a4d8f", evidence=[ev])},
        fonts={"font.heading": FontToken(family="Archivo", weight=700, source="referenced-only", evidence=[ev])},
        roles={"heading": SemanticRole(font="font.heading", color="color.primary",
                                       min_size_px=40, max_size_px=96, line_height=1.1)},
        assets={"logo.primary": LogoAsset(path="assets/logos/a.svg", sha256="0" * 64,
                                           format="svg", evidence=[ev])},
    )


def test_color_value_is_normalized():
    ir = _minimal_ir()
    assert ir.colors["color.primary"].value == "#1A4D8F"


def test_json_is_camel_case_and_round_trips():
    ir = _minimal_ir()
    data = json.loads(ir.model_dump_json(by_alias=True))
    assert data["schemaVersion"] == "0.1.0"
    assert data["colors"]["color.primary"]["evidence"][0]["sourceType"] == "wizard-confirmation"
    assert BrandIR.model_validate(data) == ir


def test_confidence_bounds_enforced():
    import pytest
    with pytest.raises(Exception):
        Evidence(source_type="manual-entry", confidence=1.5)


def test_export_schemas(tmp_path):
    paths = export_schemas(tmp_path)
    names = {p.name for p in paths}
    assert "brand-ir.schema.json" in names
    schema = json.loads((tmp_path / "brand-ir.schema.json").read_text(encoding="utf-8"))
    assert "schemaVersion" in schema["properties"]
```

- [ ] **Step 2:** Ver falhar. **Step 3:** Implementar (usar `pydantic.alias_generators.to_camel`; validator de `ColorToken.value` chama `normalize_color`). **Step 4:** Verde + suíte + ruff.
- [ ] **Step 5: Commit** `feat(engine): modelos do Brand IR com evidência e export de JSON Schema`

---

### Task 4: Extração de cores de PDF

**Files:**
- Create: `packages/engine/src/brand_runtime/intake/__init__.py`
- Create: `packages/engine/src/brand_runtime/intake/base.py`
- Create: `packages/engine/src/brand_runtime/intake/pdf_colors.py`
- Create: `packages/engine/tests/conftest.py`
- Test: `packages/engine/tests/test_pdf_colors.py`

**Interfaces:**
- Produces (`intake/base.py`):

```python
class Candidate(CamelModel):
    value: Any                    # hex str p/ cores; dict p/ fontes
    score: float                  # relativo dentro do extrator
    evidence: list[Evidence]
```

- Produces (`intake/pdf_colors.py`): `extract_pdf_colors(pdf_path: Path) -> list[Candidate]` — cores de desenhos vetoriais (`page.get_drawings()`: fills e strokes, peso = área do retângulo delimitador em pt² / área da página) e de texto (`page.get_text("dict")` spans, cor `span["color"]` int sRGB, peso = nº de caracteres / total de caracteres). Pesos somados por cor normalizada, dedupe com `dedupe_colors`, scores finais normalizados para máx=1.0. Evidence: `source_type="pdf-guideline", path=str(pdf_path), page=<1-based>, confidence=0.9` para vetores, `0.7` para texto.
- Produces (`tests/conftest.py`): fixture `brand_pdf(tmp_path_factory) -> Path` que gera com PyMuPDF um PDF de 1 página A4 contendo: retângulo grande preenchido `#1A4D8F` (200×200pt), retângulo pequeno `#F4A300` (50×50pt), e um parágrafo de ~200 caracteres em `#333333` (fonte builtin "helv") e um título curto em "Times-Bold" (builtin `tibo`). Esta fixture é reutilizada pelas Tasks 5 e 9.

- [ ] **Step 1: Testes falhando** `tests/test_pdf_colors.py`:

```python
from brand_runtime.intake.pdf_colors import extract_pdf_colors


def test_extracts_the_three_colors(brand_pdf):
    cands = extract_pdf_colors(brand_pdf)
    values = [c.value for c in cands]
    assert "#1A4D8F" in values
    assert "#F4A300" in values
    assert "#333333" in values


def test_big_rect_outranks_small_rect(brand_pdf):
    cands = extract_pdf_colors(brand_pdf)
    by_value = {c.value: c.score for c in cands}
    assert by_value["#1A4D8F"] > by_value["#F4A300"]


def test_evidence_carries_page_and_source(brand_pdf):
    cands = extract_pdf_colors(brand_pdf)
    ev = cands[0].evidence[0]
    assert ev.source_type == "pdf-guideline"
    assert ev.page == 1
```

- [ ] **Step 2:** Falhar. **Step 3:** Implementar (conversão de cor: `span["color"]` é int `0xRRGGBB`; fills de drawings vêm como tupla RGB 0..1 — converter ambos com helper local → `normalize_color`). **Step 4:** Verde + suíte + ruff.
- [ ] **Step 5: Commit** `feat(engine): extração de paleta de PDF com evidência por página`

---

### Task 5: Extração de fontes de PDF

**Files:**
- Create: `packages/engine/src/brand_runtime/intake/pdf_fonts.py`
- Test: `packages/engine/tests/test_pdf_fonts.py`

**Interfaces:**
- Produces:

```python
class FontInfo(CamelModel):
    family: str
    weight: int = 400
    style: Literal["normal", "italic"] = "normal"

def parse_ps_font_name(ps_name: str) -> FontInfo
def extract_pdf_fonts(pdf_path: Path) -> list[Candidate]   # value = FontInfo.model_dump(by_alias=True)
```

- Regras normativas de `parse_ps_font_name`:
  1. remover prefixo de subset `^[A-Z]{6}\+`;
  2. separar família de modificadores no último `-` (se houver);
  3. mapear tokens no sufixo (case-insensitive, podem vir concatenados como `SemiBoldItalic`): `thin→100, extralight→200, light→300, regular/book→400, medium→500, semibold/demibold→600, bold→700, extrabold→800, black/heavy→900`; `italic/oblique→style=italic`;
  4. se não houver sufixo, procurar os mesmos tokens no fim do nome da família (ex.: `TimesBold`);
  5. família final: separar CamelCase por espaço (`ArchivoNarrow` → `Archivo Narrow`).
- `extract_pdf_fonts`: usa spans de `page.get_text("dict")` (campo `span["font"]`), score = caracteres com a fonte / caracteres totais; evidence `source_type="pdf-guideline", confidence=0.8, detail=<ps_name original>`.

- [ ] **Step 1: Testes falhando** `tests/test_pdf_fonts.py`:

```python
from brand_runtime.intake.pdf_fonts import FontInfo, extract_pdf_fonts, parse_ps_font_name


def test_parse_subset_bold():
    info = parse_ps_font_name("ABCDEF+Archivo-Bold")
    assert info == FontInfo(family="Archivo", weight=700, style="normal")


def test_parse_semibold_italic_concatenated():
    info = parse_ps_font_name("Inter-SemiBoldItalic")
    assert info.family == "Inter"
    assert info.weight == 600
    assert info.style == "italic"


def test_parse_suffix_embedded_in_family():
    assert parse_ps_font_name("TimesBold").weight == 700


def test_parse_camel_case_family_split():
    assert parse_ps_font_name("ArchivoNarrow-Regular").family == "Archivo Narrow"


def test_extract_from_fixture_pdf(brand_pdf):
    cands = extract_pdf_fonts(brand_pdf)
    families = {c.value["family"] for c in cands}
    assert "Helvetica" in families           # builtin "helv"
    weights = {c.value["family"]: c.value["weight"] for c in cands}
    assert weights.get("Times", weights.get("Times New Roman", 0)) == 700  # tibo = Times-Bold
```

- [ ] **Step 2:** Falhar. **Step 3:** Implementar. **Step 4:** Verde + suíte + ruff.
- [ ] **Step 5: Commit** `feat(engine): extração e parsing de nomes de fonte de PDF`

---

### Task 6: SVG — sanitização e cores

**Files:**
- Create: `packages/engine/src/brand_runtime/intake/svg_logo.py`
- Test: `packages/engine/tests/test_svg_logo.py`

**Interfaces:**
- Produces:

```python
class SvgInvalid(Exception): ...        # XML não parseável

def sanitize_svg(data: bytes) -> bytes
    # remove: elementos <script>, <foreignObject>; todo atributo on*;
    # atributos href/xlink:href cujo valor NÃO comece com "#";
    # elementos <image> com referência externa (http/https/data além de data:image/png|jpeg).
    # Usa xml.etree.ElementTree (stdlib) com defusedxml se disponível — NÃO executar nada.
def extract_svg_colors(svg_path: Path) -> list[Candidate]
    # após sanitizar: coleta fill/stroke de atributos e de style="" inline;
    # ignora "none", "currentColor", "transparent"; score = ocorrências / total;
    # evidence: source_type="svg-asset", confidence=0.95
def svg_canvas_size(svg_path: Path) -> tuple[float, float]   # de viewBox ou width/height; (0,0) se ausente
```

- [ ] **Step 1: Testes falhando** `tests/test_svg_logo.py`:

```python
from brand_runtime.intake.svg_logo import extract_svg_colors, sanitize_svg, svg_canvas_size

MALICIOUS = b"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <script>alert(1)</script>
  <rect width="60" height="100" fill="#1A4D8F" onclick="evil()"/>
  <circle r="20" fill="#F4A300" stroke="#1A4D8F"/>
  <image href="https://evil.example/x.png"/>
  <use href="#ok"/>
</svg>"""


def test_sanitize_strips_dangerous_content():
    clean = sanitize_svg(MALICIOUS)
    text = clean.decode("utf-8")
    assert "<script" not in text
    assert "onclick" not in text
    assert "evil.example" not in text
    assert 'href="#ok"' in text            # referência local preservada


def test_extract_colors_counts_fills_and_strokes(tmp_path):
    p = tmp_path / "logo.svg"
    p.write_bytes(MALICIOUS)
    cands = extract_svg_colors(p)
    scores = {c.value: c.score for c in cands}
    assert scores["#1A4D8F"] == 1.0        # 2 ocorrências (fill + stroke), normalizado
    assert scores["#F4A300"] == 0.5        # 1 ocorrência


def test_canvas_size_from_viewbox(tmp_path):
    p = tmp_path / "logo.svg"
    p.write_bytes(MALICIOUS)
    assert svg_canvas_size(p) == (100.0, 100.0)
```

- [ ] **Step 2:** Falhar. **Step 3:** Implementar (registrar namespace SVG; iterar com `iter()`; remover via pai). **Step 4:** Verde + suíte + ruff.
- [ ] **Step 5: Commit** `feat(engine): sanitização de SVG e extração de cores de logo`

---

### Task 7: Cores de logo raster (PNG)

**Files:**
- Create: `packages/engine/src/brand_runtime/intake/raster_logo.py`
- Test: `packages/engine/tests/test_raster_logo.py`

**Interfaces:**
- Produces: `extract_raster_colors(img_path: Path, max_colors: int = 8) -> list[Candidate]` — Pillow: converter para RGBA, descartar pixels com alpha < 128, quantizar (paleta adaptativa) para `max_colors`, score = fração de pixels opacos, dedupe, ignorar cores com fração < 0.02. Evidence `source_type="raster-asset", confidence=0.85`.

- [ ] **Step 1: Testes falhando** `tests/test_raster_logo.py`:

```python
from PIL import Image
from brand_runtime.intake.raster_logo import extract_raster_colors


def _make_logo(tmp_path):
    img = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
    for x in range(100):
        for y in range(100):
            if y < 20:
                continue                      # faixa transparente
            img.putpixel((x, y), (26, 77, 143, 255) if x < 60 else (244, 163, 0, 255))
    p = tmp_path / "logo.png"
    img.save(p)
    return p


def test_extracts_two_colors_ignoring_transparency(tmp_path):
    cands = extract_raster_colors(_make_logo(tmp_path))
    values = [c.value for c in cands]
    assert values[0] == "#1A4D8F"            # 60% dos pixels opacos
    assert "#F4A300" in values
    assert len(values) == 2
```

- [ ] **Step 2:** Falhar. **Step 3:** Implementar. **Step 4:** Verde + suíte + ruff.
- [ ] **Step 5: Commit** `feat(engine): extração de cores de logo raster`

---

### Task 8: Introspecção de arquivos de fonte

**Files:**
- Create: `packages/engine/src/brand_runtime/intake/fonts.py`
- Modify: `packages/engine/tests/conftest.py` (nova fixture `fixture_font`)
- Test: `packages/engine/tests/test_fonts.py`

**Interfaces:**
- Produces: `introspect_font(font_path: Path) -> FontInfo` — fontTools `TTFont`: família = nameID 16 se existir, senão nameID 1; weight = `OS/2.usWeightClass`; style italic se bit 0 de `OS/2.fsSelection` ou nameID 2 contém "Italic".
- Fixture `fixture_font(tmp_path_factory) -> Path`: TTF mínima gerada com `fontTools.fontBuilder.FontBuilder(1000)` — `setupGlyphOrder([".notdef","A"])`, `setupCharacterMap({65: "A"})`, `setupGlyf` com glifos vazios, `setupHorizontalMetrics`, `setupHorizontalHeader`, `setupNameTable({"familyName": "Fixture Sans", "styleName": "Bold"})`, `setupOS2(usWeightClass=700)`, `setupPost()` — salvar em `fixture-sans-bold.ttf`.

- [ ] **Step 1: Testes falhando** `tests/test_fonts.py`:

```python
from brand_runtime.intake.fonts import introspect_font


def test_reads_family_weight_style(fixture_font):
    info = introspect_font(fixture_font)
    assert info.family == "Fixture Sans"
    assert info.weight == 700
    assert info.style == "normal"
```

- [ ] **Step 2:** Falhar. **Step 3:** Implementar fixture + função. **Step 4:** Verde + suíte + ruff.
- [ ] **Step 5: Commit** `feat(engine): introspecção de arquivos de fonte`

---

### Task 9: Agregação — BrandDraft e perguntas do wizard

**Files:**
- Create: `packages/engine/src/brand_runtime/intake/draft.py`
- Modify: `packages/engine/tests/conftest.py` (nova fixture `brand_package`)
- Test: `packages/engine/tests/test_draft.py`

**Interfaces:**
- Produces:

```python
class DraftQuestion(CamelModel):
    id: str                    # "color.primary", "font.heading", "logo.primary", ...
    kind: Literal["pick-color", "pick-font", "confirm-logo"]
    prompt_pt: str
    candidates: list[Candidate]
    required: bool

class BrandDraft(CamelModel):
    package_dir: str
    questions: list[DraftQuestion]
    diagnostics: list[Diagnostic]

def build_draft(package_dir: Path) -> BrandDraft
```

- Convenção do pacote (documentar em docstring): PDFs em `*.pdf` ou `references/*.pdf`; logos em `assets/logos/*.svg|*.png`; fontes em `fonts/*.ttf|*.otf`.
- Regras normativas de agregação:
  1. scores de cada extrator normalizados para 0..1 (máx do extrator), depois multiplicados pelo peso da fonte: `svg-asset 3.0`, `raster-asset 2.0`, `pdf-guideline 1.0`; candidatos fundidos com `dedupe_colors` (evidências concatenadas);
  2. `color.primary` (required): top 6 com `not is_neutral(v)`;
  3. `color.background` (required): neutras com `lightness > 85`, mais candidato `#FFFFFF` (score 0.1, evidence `manual-entry`, detail `"padrão"`) sempre presente e por último;
  4. `color.text` (required): neutras com `lightness < 30`, mais `#1A1A1A` padrão idem regra 3;
  5. `color.secondary` (optional): não-neutras restantes, top 4; omitir a pergunta se vazio;
  6. `font.heading` (required): fontes de arquivos (`introspect_font`, evidence `font-file` confidence 1.0, value inclui `"path"`) primeiro, depois fontes de PDF; dentro de cada grupo, weight >= 600 primeiro, depois por score;
  7. `font.body` (required): mesma lista, weight < 600 primeiro;
  8. `logo.primary` (required): SVGs por área de `svg_canvas_size` desc, depois PNGs por área de pixels; `kind="confirm-logo"`, value = path relativo ao pacote;
  9. prompts exatos: `color.primary` → `"Qual destas é a cor principal da marca?"`; `color.background` → `"Qual é a cor de fundo mais comum nos materiais?"`; `color.text` → `"Qual cor é usada para textos longos?"`; `color.secondary` → `"A marca tem uma cor de destaque secundária?"`; `font.heading` → `"Qual fonte é usada em títulos?"`; `font.body` → `"Qual fonte é usada em textos corridos?"`; `logo.primary` → `"Este é o logo oficial da marca?"`;
  10. diagnostics: sem PDF → `NO_PDF_FOUND`; sem logo → `NO_LOGO_FOUND`; sem arquivo de fonte → `FONT_FILE_MISSING` (um por família candidata sem arquivo, `resolution="render-fallback"`). Mensagens PT-BR livres, códigos exatos.
- Fixture `brand_package(tmp_path_factory, brand_pdf, fixture_font)`: monta diretório com `manual.pdf` (copiar `brand_pdf`), `assets/logos/logo.svg` (o `MALICIOUS` da Task 6 — passa pela sanitização), `fonts/fixture-sans-bold.ttf`.

- [ ] **Step 1: Testes falhando** `tests/test_draft.py`:

```python
from brand_runtime.intake.draft import build_draft


def test_question_set(brand_package):
    draft = build_draft(brand_package)
    ids = [q.id for q in draft.questions]
    for required in ["color.primary", "color.background", "color.text",
                     "font.heading", "font.body", "logo.primary"]:
        assert required in ids


def test_primary_candidates_are_non_neutral_and_svg_weighted(brand_package):
    draft = build_draft(brand_package)
    q = next(q for q in draft.questions if q.id == "color.primary")
    assert q.candidates[0].value == "#1A4D8F"     # aparece no SVG (peso 3) e no PDF
    assert all(c.value != "#333333" for c in q.candidates)  # neutra não entra em primary


def test_background_has_white_default_last(brand_package):
    draft = build_draft(brand_package)
    q = next(q for q in draft.questions if q.id == "color.background")
    assert q.candidates[-1].value == "#FFFFFF"


def test_heading_candidates_prefer_font_files(brand_package):
    draft = build_draft(brand_package)
    q = next(q for q in draft.questions if q.id == "font.heading")
    first = q.candidates[0]
    assert first.value["family"] == "Fixture Sans"
    assert first.evidence[0].source_type == "font-file"


def test_logo_question_and_prompt(brand_package):
    draft = build_draft(brand_package)
    q = next(q for q in draft.questions if q.id == "logo.primary")
    assert q.prompt_pt == "Este é o logo oficial da marca?"
    assert q.candidates[0].value.endswith("logo.svg")
```

- [ ] **Step 2:** Falhar. **Step 3:** Implementar. **Step 4:** Verde + suíte + ruff.
- [ ] **Step 5: Commit** `feat(engine): agregação de evidências em BrandDraft com perguntas do wizard`

---

### Task 10: Atalho DTCG (tokens estruturados)

**Files:**
- Create: `packages/engine/src/brand_runtime/intake/dtcg.py`
- Modify: `packages/engine/src/brand_runtime/intake/draft.py` (integração)
- Test: `packages/engine/tests/test_dtcg.py`

**Interfaces:**
- Produces:

```python
class DtcgError(Exception): ...    # mensagem PT-BR; usada p/ ciclo e alias inexistente

def load_dtcg(path: Path) -> dict[str, Candidate]
    # chaves de retorno: "color.<nome-do-grupo-folha>" e "font.<nome>";
    # suporta $type "color" (value hex/rgb) e "fontFamily"+"fontWeight";
    # aliases "{grupo.token}" resolvidos recursivamente; ciclo -> DtcgError;
    # evidence: source_type="dtcg-tokens", confidence=1.0, detail=<pointer>
```

- Integração: `build_draft` aceita `tokens.json`/`*.tokens.json` na raiz do pacote; candidatos DTCG entram com peso de fonte `5.0` (acima de svg), ficando primeiros no ranking — mas continuam passando pelo wizard (autoridade permanece na confirmação, spec §5.3).

- [ ] **Step 1: Testes falhando** `tests/test_dtcg.py`:

```python
import json
import pytest
from brand_runtime.intake.dtcg import DtcgError, load_dtcg

TOKENS = {
    "color": {
        "brand": {"$type": "color", "$value": "#1A4D8F"},
        "action": {"$type": "color", "$value": "{color.brand}"},
    }
}


def test_alias_resolution(tmp_path):
    p = tmp_path / "tokens.json"
    p.write_text(json.dumps(TOKENS), encoding="utf-8")
    out = load_dtcg(p)
    assert out["color.action"].value == "#1A4D8F"
    assert out["color.action"].evidence[0].source_type == "dtcg-tokens"


def test_cycle_raises(tmp_path):
    cyc = {"color": {"a": {"$type": "color", "$value": "{color.b}"},
                     "b": {"$type": "color", "$value": "{color.a}"}}}
    p = tmp_path / "tokens.json"
    p.write_text(json.dumps(cyc), encoding="utf-8")
    with pytest.raises(DtcgError):
        load_dtcg(p)


def test_draft_ranks_dtcg_first(brand_package, tmp_path):
    from brand_runtime.intake.draft import build_draft
    (brand_package / "tokens.json").write_text(
        json.dumps({"color": {"brand": {"$type": "color", "$value": "#00FF88"}}}),
        encoding="utf-8")
    draft = build_draft(brand_package)
    q = next(q for q in draft.questions if q.id == "color.primary")
    assert q.candidates[0].value == "#00FF88"
```

- [ ] **Step 2:** Falhar. **Step 3:** Implementar. **Step 4:** Verde + suíte + ruff (remover `tokens.json` da fixture não é preciso — fixture é por sessão de teste; usar cópia local no teste se houver interferência entre testes, e reportar se a fixture precisar virar function-scoped).
- [ ] **Step 5: Commit** `feat(engine): importador DTCG com resolução de aliases`

---

### Task 11: Compilação — draft + respostas → Brand IR

**Files:**
- Create: `packages/engine/src/brand_runtime/intake/compile.py`
- Test: `packages/engine/tests/test_compile.py`

**Interfaces:**
- Produces:

```python
class Answers(CamelModel):
    values: dict[str, Any]        # question.id -> valor escolhido (hex, FontInfo dict, path do logo)

class CompileError(Exception): ...  # lista ids obrigatórios ausentes, mensagem PT-BR

def compile_ir(draft: BrandDraft, answers: Answers, brand_name: str,
               created_at: datetime | None = None) -> BrandIR
```

- Regras normativas:
  1. obrigatórios: `color.primary`, `color.background`, `color.text`, `font.heading`, `font.body`, `logo.primary` — ausentes em `answers.values` → `CompileError` com todos os faltantes;
  2. valor respondido que coincide com um candidato (cores comparadas após `normalize_color`; fontes por `family`+`weight`, com `path` apenas como desempate seguro entre candidatas idênticas; logo por path) herda as evidências do candidato e recebe **adicionalmente** `Evidence(source_type="wizard-confirmation", confidence=1.0, authoritative=True, confirmed_at=created_at)`; valor que não coincide com nenhum candidato recebe apenas a evidência de confirmação; isso vale também para `LogoAsset.evidence`;
  3. fontes: se o candidato escolhido tem `"path"` no value → `source="file"`, `file_sha256` = SHA-256 do arquivo; senão `source="referenced-only"` + Diagnostic `FONT_FILE_MISSING` com `resolution="render-fallback"`;
  4. logo: `sha256` do arquivo; `format` pela extensão; path relativo ao pacote;
  5. roles fixos: `heading {font.heading, color.primary, 40..96, lh 1.1}`, `body {font.body, color.text, 16..24, lh 1.5}`, `caption {font.body, color.text, 12..16, lh 1.4}`;
  6. `color.secondary` não respondida → Diagnostic `UNDETERMINED` target `color.secondary`;
  7. `created_at` default = `datetime.now(timezone.utc)`; **id da revisão** = `"brandrev_" + sha256(model_dump_json(by_alias=True) da projeção canônica do IR)[0:12]`. A projeção canônica zera `revision.id`, fixa `revision.createdAt` e todo `Evidence.confirmedAt` no epoch UTC (`1970-01-01T00:00:00Z`) e usa `Evidence.path` relativo à raiz do pacote — metadados de auditoria reais permanecem no IR publicado, mas não contaminam a identidade. Assim, mesmo pacote + mesmas respostas produzem o mesmo id mesmo em outra raiz ou horário;
  8. diagnostics do draft são preservados no IR.

- [ ] **Step 1: Testes falhando** `tests/test_compile.py`:

```python
from datetime import datetime, timedelta, timezone
import pytest
from brand_runtime.intake.compile import Answers, CompileError, compile_ir
from brand_runtime.intake.draft import build_draft

FIXED = datetime(2026, 7, 11, 12, 0, 0, tzinfo=timezone.utc)


def _answers(draft):
    def first(qid):
        q = next(q for q in draft.questions if q.id == qid)
        return q.candidates[0].value
    return Answers(values={
        "color.primary": first("color.primary"),
        "color.background": "#FFFFFF",
        "color.text": "#1A1A1A",
        "font.heading": first("font.heading"),
        "font.body": first("font.body"),
        "logo.primary": first("logo.primary"),
    })


def test_missing_required_raises(brand_package):
    draft = build_draft(brand_package)
    with pytest.raises(CompileError) as exc:
        compile_ir(draft, Answers(values={}), "ACME")
    assert "color.primary" in str(exc.value)


def test_happy_path_produces_valid_ir(brand_package):
    draft = build_draft(brand_package)
    ir = compile_ir(draft, _answers(draft), "ACME", created_at=FIXED)
    assert ir.brand.name == "ACME"
    assert ir.colors["color.primary"].value == "#1A4D8F"
    ev_types = [e.source_type for e in ir.colors["color.primary"].evidence]
    assert "wizard-confirmation" in ev_types and "svg-asset" in ev_types
    assert ir.fonts["font.heading"].source == "file"
    assert ir.roles["heading"].font == "font.heading"
    assert ir.assets["logo.primary"].sha256 and len(ir.assets["logo.primary"].sha256) == 64
    assert "wizard-confirmation" in [e.source_type for e in ir.assets["logo.primary"].evidence]


def test_revision_id_is_deterministic(brand_package):
    draft = build_draft(brand_package)
    a = compile_ir(draft, _answers(draft), "ACME", created_at=FIXED)
    b = compile_ir(draft, _answers(draft), "ACME", created_at=FIXED + timedelta(days=1))
    assert a.revision.id == b.revision.id
    assert a.revision.id.startswith("brandrev_")


def test_unanswered_secondary_yields_diagnostic(brand_package):
    draft = build_draft(brand_package)
    ir = compile_ir(draft, _answers(draft), "ACME", created_at=FIXED)
    assert any(d.code == "UNDETERMINED" and d.target == "color.secondary"
               for d in ir.diagnostics)
```

- [ ] **Step 2:** Falhar. **Step 3:** Implementar. **Step 4:** Verde + suíte + ruff.
- [ ] **Step 5: Commit** `feat(engine): compilação de Brand IR com autoridade de confirmação e revisão determinística`

---

### Task 12: Modelos de Layout Spec e Content Spec

**Files:**
- Create: `packages/engine/src/brand_runtime/kit/__init__.py`
- Create: `packages/engine/src/brand_runtime/kit/models.py`
- Modify: `packages/engine/src/brand_runtime/ir/schema.py` (registrar novos schemas)
- Test: `packages/engine/tests/test_kit_models.py`

**Interfaces:**
- Produces (`kit/models.py`):

```python
PROFILES: dict[str, tuple[int, int, int]] = {
    "post-1x1": (1080, 1080, 48),
    "post-4x5": (1080, 1350, 48),
    "story-9x16": (1080, 1920, 64),
    "doc-a4": (794, 1123, 76),
}   # (width_px, height_px, safe_area_px) — contrato do plano-mestre

class Canvas(CamelModel):
    width_px: int
    height_px: int
    safe_area_px: int

class Slot(CamelModel):
    id: str
    kind: Literal["text", "image", "logo"]
    role: str | None = None            # obrigatório quando kind == "text" (validator)
    max_chars: int | None = None
    min_resolution: tuple[int, int] | None = None
    area: tuple[int, int, int, int]    # x, y, w, h em px do canvas
    fit: Literal["shrink-within-role-range", "fixed"] = "shrink-within-role-range"
    required: bool = True

class Background(CamelModel):
    kind: Literal["color", "image-slot"]
    color_token: str | None = None     # obrigatório quando kind == "color"

class LayoutSpec(CamelModel):
    id: str
    profile: str                       # chave de PROFILES (validator)
    name_pt: str
    canvas: Canvas
    background: Background
    slots: list[Slot]

class TextValue(CamelModel):
    kind: Literal["text"] = "text"
    text: str

class ImageValue(CamelModel):
    kind: Literal["image"] = "image"
    path: str
    sha256: str | None = None

class ContentSpec(CamelModel):
    layout_id: str
    brand_revision_id: str
    values: dict[str, TextValue | ImageValue]
```

- `export_schemas` passa a emitir também `layout-spec.schema.json` e `content-spec.schema.json`.

- [ ] **Step 1: Testes falhando** `tests/test_kit_models.py`:

```python
import json
import pytest
from brand_runtime.ir.schema import export_schemas
from brand_runtime.kit.models import (
    PROFILES, Background, Canvas, ContentSpec, LayoutSpec, Slot, TextValue,
)


def test_profiles_match_master_contract():
    assert PROFILES["post-1x1"] == (1080, 1080, 48)
    assert PROFILES["doc-a4"] == (794, 1123, 76)


def test_text_slot_requires_role():
    with pytest.raises(Exception):
        Slot(id="t", kind="text", area=(0, 0, 10, 10))   # sem role


def test_layout_profile_validated():
    with pytest.raises(Exception):
        LayoutSpec(id="x", profile="post-2x3", name_pt="X",
                   canvas=Canvas(width_px=1, height_px=1, safe_area_px=0),
                   background=Background(kind="color", color_token="color.primary"),
                   slots=[])


def test_content_spec_round_trip():
    cs = ContentSpec(layout_id="statement-post-1x1", brand_revision_id="brandrev_abc",
                     values={"headline": TextValue(text="Olá")})
    data = json.loads(cs.model_dump_json(by_alias=True))
    assert data["layoutId"] == "statement-post-1x1"
    assert ContentSpec.model_validate(data) == cs


def test_schemas_exported(tmp_path):
    names = {p.name for p in export_schemas(tmp_path)}
    assert {"brand-ir.schema.json", "layout-spec.schema.json",
            "content-spec.schema.json"} <= names
```

- [ ] **Step 2:** Falhar. **Step 3:** Implementar. **Step 4:** Verde + suíte + ruff.
- [ ] **Step 5: Commit** `feat(engine): modelos de Layout Spec e Content Spec com schemas publicados`

---

### Task 13: Gerador de kit

**Files:**
- Create: `packages/engine/src/brand_runtime/kit/generator.py`
- Test: `packages/engine/tests/test_generator.py`

**Interfaces:**
- Produces: `generate_kit(ir: BrandIR) -> list[LayoutSpec]` — 10 layouts: arquétipos `statement`, `quote`, `announce` × perfis `post-1x1`, `post-4x5`, `story-9x16`, mais `one-pager` × `doc-a4`. IDs: `"{arquétipo}-{profile}"`.
- Tabela normativa (adaptação por perfil, não resize — spec §5.5). Coordenadas em px `(x, y, w, h)`; `S` = safe area do perfil; `W,H` = canvas. Logo em todos: slot `logo`, kind `logo`, `fit="fixed"`, `w = max(ir.assets["logo.primary"].min_width_px, round(W * 0.12))`, `h = w`, posição canto inferior direito: `(W - S - w, H - S - h, w, h)`. Slots `kind="image"` também usam `fit="fixed"` (o renderer aplica `object-fit: cover`; o valor impede que a semântica tipográfica de shrink seja herdada por imagens).

| Arquétipo | Fundo | Slots (além do logo) |
|---|---|---|
| `statement` | `color`, token `color.background` | `headline`: text, role `heading`, maxChars 90, area `(S, round(H*0.30), W-2S, round(H*0.40))` |
| `quote` | `image-slot` (slot `photo`: image, minResolution `(W, H)`, area `(0,0,W,H)`, required) | `quote`: text, role `heading`, maxChars 140, area `(S, round(H*0.32), W-2S, round(H*0.36))`; `author`: text, role `caption`, maxChars 40, required False, area `(S, round(H*0.72), W-2S, round(H*0.06))` |
| `announce` | `color`, token `color.background` | `headline`: text, role `heading`, maxChars 70, area `(S, S, W-2S, round(H*0.22))`; `body`: text, role `body`, maxChars 240, area `(S, round(H*0.30), W-2S, round(H*0.28))`; `photo`: image, minResolution `(W, round(H*0.34))`, area `(0, round(H*0.62), W, round(H*0.38))` |
| `one-pager` (só doc-a4) | `color`, token `color.background` | `title`: text, role `heading`, maxChars 80, area `(S, S, W-2S, 120)`; `body`: text, role `body`, maxChars 2200, area `(S, S+150, W-2S, H-2S-150-logo_w)` — termina exatamente onde começa o logo, sem sobreposição; rodapé usa o slot `logo` padrão |
| `name_pt` | — | `statement`→"Frase de impacto", `quote`→"Citação sobre foto", `announce`→"Anúncio com foto", `one-pager`→"Documento de uma página" |

- [ ] **Step 1: Testes falhando** `tests/test_generator.py`:

```python
from brand_runtime.intake.compile import compile_ir
from brand_runtime.intake.draft import build_draft
from brand_runtime.kit.generator import generate_kit
from brand_runtime.kit.models import PROFILES
from tests.test_compile import FIXED, _answers


def _ir(brand_package):
    draft = build_draft(brand_package)
    return compile_ir(draft, _answers(draft), "ACME", created_at=FIXED)


def test_kit_has_ten_unique_layouts(brand_package):
    kit = generate_kit(_ir(brand_package))
    assert len(kit) == 10
    assert len({l.id for l in kit}) == 10
    assert {l.profile for l in kit} == set(PROFILES)


def test_all_token_and_role_references_exist(brand_package):
    ir = _ir(brand_package)
    for layout in generate_kit(ir):
        if layout.background.kind == "color":
            assert layout.background.color_token in ir.colors
        for slot in layout.slots:
            if slot.kind == "text":
                assert slot.role in ir.roles


def test_slots_fit_inside_canvas(brand_package):
    for layout in generate_kit(_ir(brand_package)):
        W, H = layout.canvas.width_px, layout.canvas.height_px
        for slot in layout.slots:
            x, y, w, h = slot.area
            assert 0 <= x and 0 <= y and x + w <= W and y + h <= H, (layout.id, slot.id)


def test_adaptation_not_resize(brand_package):
    kit = {l.id: l for l in generate_kit(_ir(brand_package))}
    sq = next(s for s in kit["statement-post-1x1"].slots if s.id == "headline")
    st = next(s for s in kit["statement-story-9x16"].slots if s.id == "headline")
    assert sq.area != st.area          # composição recalculada por perfil


def test_logo_slot_everywhere_locked(brand_package):
    for layout in generate_kit(_ir(brand_package)):
        logo = next(s for s in layout.slots if s.kind == "logo")
        assert logo.fit == "fixed"
```

- [ ] **Step 2:** Falhar. **Step 3:** Implementar (nota: import de `tests.test_compile` requer `tests/__init__.py` vazio — criar). **Step 4:** Verde + suíte + ruff.
- [ ] **Step 5: Commit** `feat(engine): gerador de kit com arquétipos adaptados por perfil`

---

### Task 14: Brand Guard — checks estáticos

**Files:**
- Create: `packages/engine/src/brand_runtime/guard/__init__.py`
- Create: `packages/engine/src/brand_runtime/guard/static_checks.py`
- Modify: `packages/engine/src/brand_runtime/ir/schema.py` (registrar verdict compartilhado)
- Test: `packages/engine/tests/test_guard.py`

**Interfaces:**
- Produces:

```python
class GuardCheck(CamelModel):
    id: str                          # inclui "text-length", "image-resolution", "contrast", "required-slot"
    slot_id: str | None = None
    status: Literal["pass", "fixed", "blocked"]  # contrato mestre; estático não emite fixed no M1
    message_pt: str
    detail: dict = Field(default_factory=dict)

class GuardVerdict(CamelModel):
    checks: list[GuardCheck]           # artefato mestre {"checks": [...]}

def run_static_checks(ir: BrandIR, layout: LayoutSpec, content: ContentSpec,
                      assets_dir: Path) -> list[GuardCheck]
```

`export_schemas` passa a emitir também `guard-verdict.schema.json`.

- Regras normativas (ordem determinística: bindings/ids desconhecidos, required/tipo, comprimento, resolução, contraste; mensagens exatas onde fixadas):
  0. contrato: `content.layout_id != layout.id` ou `content.brand_revision_id != ir.revision.id` → `document-contract` blocked; chave de `content.values` sem slot correspondente → `unknown-slot` blocked; valor cujo kind não casa com o slot (`TextValue` para text, `ImageValue` para image) → `content-type` blocked. Esses checks impedem falso pass e nunca lançam `KeyError`/`AttributeError` para input de usuário;
  1. `required-slot`: slot `required=True` (exceto kind `logo`) sem valor em `content.values` — ou texto vazio/apenas whitespace — → blocked, `"Preencha o campo obrigatório «{slot.id}»."`;
  2. `text-length`: `len(text) > max_chars` → blocked, `"O texto de «{slot.id}» tem {n} caracteres; o máximo deste layout é {max}."`, detail `{"chars": n, "maxChars": max}`; dentro do limite → pass;
  3. `image-resolution`: todo `ImageValue` é validado, mesmo quando o slot não declara `minResolution`; conteúdo de imagem do M1 aceita somente PNG/JPEG. Antes de abrir, resolver o path estritamente sob `assets_dir` e bloquear path absoluto, traversal, symlink externo, diretório, ausência, arquivo inválido/truncado e erro/decompression bomb do Pillow — nenhuma exceção crua escapa. Se `sha256` foi informado, emitir `asset-integrity` e comparar com o hash real em streaming. Quando há mínimo e `width < minResolution[0]` ou `height < minResolution[1]` → blocked, `"A imagem de «{slot.id}» tem {w}×{h}px; o mínimo para este formato é {mw}×{mh}px."`; arquivo ausente → blocked `"A imagem de «{slot.id}» não foi encontrada."`;
  4. `contrast`: para cada slot de texto sobre fundo `kind="color"`: `wcag_contrast(ir.colors[role.color].value, ir.colors[background.color_token].value) < 4.5` → blocked, `"O contraste entre o texto de «{slot.id}» e o fundo é insuficiente para leitura."`, detail `{"ratio": <2 casas>}`; senão pass. Fundo `image-slot`: não avaliar aqui (medição é do render, Plano 2);
  5. nunca alterar conteúdo — `fixed` pertence ao contrato compartilhado, mas não é emitido pelo guard estático no M1; qualquer correção futura precisa ser explícita e medida;

- [ ] **Step 1: Testes falhando** `tests/test_guard.py`:

```python
from brand_runtime.guard.static_checks import run_static_checks
from brand_runtime.kit.generator import generate_kit
from brand_runtime.kit.models import ContentSpec, ImageValue, TextValue
from tests.test_generator import _ir


def _layout(ir, layout_id):
    return next(l for l in generate_kit(ir) if l.id == layout_id)


def test_text_within_limit_passes(brand_package):
    ir = _ir(brand_package)
    layout = _layout(ir, "statement-post-1x1")
    content = ContentSpec(layout_id=layout.id, brand_revision_id=ir.revision.id,
                          values={"headline": TextValue(text="A" * 90)})
    checks = run_static_checks(ir, layout, content, brand_package)
    by_id = {(c.id, c.slot_id): c.status for c in checks}
    assert by_id[("text-length", "headline")] == "pass"
    assert by_id[("contrast", "headline")] == "pass"


def test_text_overflow_blocked_with_counts(brand_package):
    ir = _ir(brand_package)
    layout = _layout(ir, "statement-post-1x1")
    content = ContentSpec(layout_id=layout.id, brand_revision_id=ir.revision.id,
                          values={"headline": TextValue(text="A" * 91)})
    checks = run_static_checks(ir, layout, content, brand_package)
    c = next(c for c in checks if c.id == "text-length")
    assert c.status == "blocked"
    assert c.detail == {"chars": 91, "maxChars": 90}
    assert "91" in c.message_pt


def test_missing_required_slot_blocked(brand_package):
    ir = _ir(brand_package)
    layout = _layout(ir, "statement-post-1x1")
    content = ContentSpec(layout_id=layout.id, brand_revision_id=ir.revision.id, values={})
    checks = run_static_checks(ir, layout, content, brand_package)
    assert any(c.id == "required-slot" and c.status == "blocked" for c in checks)


def test_low_resolution_image_blocked(brand_package, tmp_path):
    from PIL import Image
    ir = _ir(brand_package)
    layout = _layout(ir, "quote-post-1x1")
    small = tmp_path / "small.png"
    Image.new("RGB", (200, 200), (10, 10, 10)).save(small)
    content = ContentSpec(layout_id=layout.id, brand_revision_id=ir.revision.id,
                          values={"photo": ImageValue(path="small.png"),
                                  "quote": TextValue(text="Frase")})
    checks = run_static_checks(ir, layout, content, tmp_path)
    c = next(c for c in checks if c.id == "image-resolution")
    assert c.status == "blocked"


def test_bad_contrast_detected_with_doctored_ir(brand_package):
    ir = _ir(brand_package)
    ir = ir.model_copy(deep=True)
    ir.colors["color.primary"].value = "#FEFEFE"     # quase branco sobre fundo branco
    layout = _layout(ir, "statement-post-1x1")       # fundo color.background (#FFFFFF)
    content = ContentSpec(layout_id=layout.id, brand_revision_id=ir.revision.id,
                          values={"headline": TextValue(text="Olá")})
    checks = run_static_checks(ir, layout, content, brand_package)
    contrast = [c for c in checks if c.id == "contrast" and c.slot_id == "headline"]
    assert contrast and contrast[0].status == "blocked"
```

  Nota: `headline` de `statement` usa role `heading` → cor `color.primary` (#FEFEFE) sobre fundo `color.background` (#FFFFFF) → contraste ~1. SVG continua permitido como asset de logo sanitizado, mas não como imagem de conteúdo no M1; slots de imagem aceitam PNG/JPEG, em paridade com o upload do Plano 3.

- [ ] **Step 2:** Falhar. **Step 3:** Implementar. **Step 4:** Verde + suíte + ruff.
- [ ] **Step 5: Commit** `feat(engine): guard estático (obrigatórios, comprimento, resolução, contraste)`

---

### Task 15: CLI `brandrt` + walking skeleton do motor

**Files:**
- Create: `packages/engine/src/brand_runtime/cli.py`
- Create: `packages/engine/src/brand_runtime/_io.py` (publicação atômica de arquivo/conjunto)
- Modify: `packages/engine/src/brand_runtime/__init__.py` (API pública do mestre)
- Modify: `packages/engine/src/brand_runtime/ir/schema.py` (publicação transacional do conjunto)
- Modify: `packages/engine/README.md` (seção "Uso")
- Test: `packages/engine/tests/test_cli.py`

**Interfaces:**
- Produces: app typer `brandrt` com comandos (artefatos estruturados em JSON UTF-8, `by_alias`, indent 2, newline final; escrita atômica):
  - `brandrt extract PACKAGE_DIR --out draft.json`
  - `brandrt compile DRAFT_JSON ANSWERS_JSON --name NOME --out ir.json` (answers = `{"values": {...}}`; `CompileError` → exit code 2 com mensagem em stderr)
  - `brandrt kit IR_JSON --out-dir DIR` (um arquivo `<layout-id>.json` por layout)
  - `brandrt guard IR_JSON LAYOUT_JSON CONTENT_JSON --assets-dir DIR` (imprime `GuardVerdict` `{"checks":[...]}` em stdout; exit 0 se nenhum check está `blocked`, exit 3 se algum está — `fixed` é não bloqueante; stderr vazio nos dois casos)
  - `brandrt schemas --out-dir DIR` (chama `export_schemas` e gera os quatro contratos, incluindo `guard-verdict.schema.json`)

Erros esperados de uso, leitura, JSON, validação Pydantic, `CompileError`, `KitGenerationError` ou I/O → mensagem PT-BR em stderr, stdout vazio e exit 2, sem traceback; bugs fora da lista operacional não são mascarados. `extract` resolve `PACKAGE_DIR` antes de persistir `packageDir`. Kit e schemas são publicados como conjuntos por staging + swap + rollback; a publicação de schemas preserva o sidecar `schemas/LICENSE`. A raiz `brand_runtime` reexporta `build_draft`, `compile_ir`, `generate_kit` e `run_static_checks`, a API pública fixada no plano-mestre.

- [ ] **Step 1: Teste falhando** `tests/test_cli.py` — o roteiro completo do motor:

```python
import json
from typer.testing import CliRunner
from brand_runtime.cli import app

runner = CliRunner()


def test_engine_walking_skeleton(brand_package, tmp_path):
    draft_p = tmp_path / "draft.json"
    r = runner.invoke(app, ["extract", str(brand_package), "--out", str(draft_p)])
    assert r.exit_code == 0, r.output
    draft = json.loads(draft_p.read_text(encoding="utf-8"))

    def first(qid):
        q = next(q for q in draft["questions"] if q["id"] == qid)
        return q["candidates"][0]["value"]

    answers_p = tmp_path / "answers.json"
    answers_p.write_text(json.dumps({"values": {
        "color.primary": first("color.primary"),
        "color.background": "#FFFFFF",
        "color.text": "#1A1A1A",
        "font.heading": first("font.heading"),
        "font.body": first("font.body"),
        "logo.primary": first("logo.primary"),
    }}), encoding="utf-8")

    ir_p = tmp_path / "ir.json"
    r = runner.invoke(app, ["compile", str(draft_p), str(answers_p),
                            "--name", "ACME", "--out", str(ir_p)])
    assert r.exit_code == 0, r.output

    kit_dir = tmp_path / "kit"
    r = runner.invoke(app, ["kit", str(ir_p), "--out-dir", str(kit_dir)])
    assert r.exit_code == 0, r.output
    assert len(list(kit_dir.glob("*.json"))) == 10

    content_p = tmp_path / "content.json"
    content_p.write_text(json.dumps({
        "layoutId": "statement-post-1x1",
        "brandRevisionId": json.loads(ir_p.read_text(encoding="utf-8"))["revision"]["id"],
        "values": {"headline": {"kind": "text", "text": "Lançamento em agosto"}},
    }), encoding="utf-8")
    r = runner.invoke(app, ["guard", str(ir_p), str(kit_dir / "statement-post-1x1.json"),
                            str(content_p), "--assets-dir", str(brand_package)])
    assert r.exit_code == 0, r.output

    content_p.write_text(json.dumps({
        "layoutId": "statement-post-1x1",
        "brandRevisionId": "brandrev_x",
        "values": {"headline": {"kind": "text", "text": "A" * 200}},
    }), encoding="utf-8")
    r = runner.invoke(app, ["guard", str(ir_p), str(kit_dir / "statement-post-1x1.json"),
                            str(content_p), "--assets-dir", str(brand_package)])
    assert r.exit_code == 3


def test_missing_required_exits_2(brand_package, tmp_path):
    draft_p = tmp_path / "draft.json"
    runner.invoke(app, ["extract", str(brand_package), "--out", str(draft_p)])
    answers_p = tmp_path / "answers.json"
    answers_p.write_text(json.dumps({"values": {}}), encoding="utf-8")
    r = runner.invoke(app, ["compile", str(draft_p), str(answers_p),
                            "--name", "ACME", "--out", str(tmp_path / "ir.json")])
    assert r.exit_code == 2
```

- [ ] **Step 2:** Falhar. **Step 3:** Implementar + atualizar README com os cinco comandos e um exemplo. **Step 4:** Verde + suíte + ruff.
- [ ] **Step 5: Commit** `feat(engine): CLI brandrt fecha o walking skeleton do motor`

---

## Self-Review (do autor do plano)

- **Cobertura da spec (escopo motor):** intake informal §5.3 → T4–T9; atalho DTCG → T10; autoridade/evidência → T3/T9/T11; IR §5.4 → T3/T11; kit §5.5 (adaptação, não resize) → T12/T13; guard §5.8 (nunca truncar; mensagens de gente) → T14; determinismo §5.7/NFR → T11; segurança SVG §5.3 → T6; schemas publicados → T3/T12/T14. Medição de overflow real e contraste sobre foto ficam para o Plano 2 (render) — precisam ser adaptados ao `GuardVerdict` antes do fechamento do export.
- **Type-consistency:** `Candidate`/`Evidence` definidos em T3/T4 e usados idênticos em T5–T11; `FontInfo` definido em T5, reusado em T8; `PROFILES` de T12 casa com o plano-mestre; `_ir`/`_answers`/`FIXED` reexportados entre módulos de teste com `tests/__init__.py` (T13).
- **Placeholders:** nenhum; corpos de implementação não-mostrados estão integralmente especificados por testes + regras normativas numeradas.
