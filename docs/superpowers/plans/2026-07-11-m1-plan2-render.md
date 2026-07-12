# Plano 2 — Render e Export (TypeScript + Playwright) Implementation Plan

**Status:** concluído em 12/07/2026. As nove tarefas foram implementadas e
integradas na branch `m1-walking-skeleton`; API e web pertencem aos Planos 3–4.

> **Registro histórico:** os checkboxes abaixo preservam o roteiro normativo
> original e não representam o progresso atual. O status acima, os gates do CI
> e o histórico de commits são a fonte de verdade da execução.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Formato deste plano:** os testes de cada tarefa são o contrato completo e obrigatório — implemente por TDD até que passem sem alterá-los (mudança em teste = desvio a reportar). Assinaturas, regras e tabelas dadas aqui são normativas. Onde o corpo da implementação não está escrito, ele é livre desde que os testes e as regras sejam satisfeitos.

**Goal:** a biblioteca de render do walking skeleton: (Brand IR + Layout Spec + Content Spec) → DOM 1:1 px numa página `render.html` que cumpre o contrato do plano-mestre (`__PAYLOAD__` → `__RENDER_DONE__` + `__GUARD_REPORT__`), mais o export Python (Playwright/Chromium headless) que produz PNG por screenshot e PDF (doc-a4) de forma **determinística** (mesmo payload → bytes idênticos).

**Architecture:** pacote npm `@brand-runtime/render` em `packages/render`, **framework-free** (DOM puro, sem React): o preview do Plano 4 embrulha `renderDocument` num componente React — mesmos componentes TS no preview e no export, WYSIWYG por construção (spec §5.7). A página `render.html` é buildada pelo Vite para `packages/render/dist`. O export vive do lado Python (`brand_runtime/export.py`, extra opcional `export`): sobe um servidor HTTP **loopback** efêmero que serve o dist + o diretório de assets do pacote de marca (fontes **nunca** vêm da rede), injeta o payload via `add_init_script`, espera `__RENDER_DONE__`, tira screenshot (PNG) ou `page.pdf` A4 (PDF) e normaliza metadados do PDF para determinismo byte a byte.

**Tech Stack:** TypeScript 5 (strict), Vite, Vitest (+jsdom), npm (Node 24) — sem pnpm. Python: Playwright (extra `export`, versão exata registrada no lock), pytest, Pillow (já dep do engine); reuso das fixtures do Plano 1 (`brand_package`, `_ir`, `generate_kit`).

## Global Constraints

- **Pré-requisito:** Plano 1 completo (`packages/engine` com fixtures, `generate_kit`, CLI). Tarefas 1–6 (TS puro) não dependem do engine; Tarefas 7–9 dependem.
- Windows dev: paths Python só via `pathlib`; testes com `tmp_path`; comandos npm a partir de `packages/render` (`npm install`, `npm test`, `npm run typecheck`, `npm run build`).
- Sem rede em runtime e em testes, **exceto loopback 127.0.0.1** (servidor de assets do export). Única exceção de setup dev (uma vez, documentada): `npm install` e `python -m playwright install chromium`.
- O export **aborta qualquer request** para host fora de `127.0.0.1` (regra normativa da Task 8) — "fontes nunca da rede" vira garantia estrutural, não convenção.
- Payload da página: exatamente `{brandIr, layoutSpec, contentSpec, assetsBaseUrl}` (contrato do plano-mestre, imutável). JSON sempre camelCase — é o que o engine emite com `by_alias=True`.
- Strings visíveis ao usuário (erros de payload, mensagens de export): PT-BR.
- Determinismo: nenhum `Date.now()`/`Math.random()` no código de render; ordem de iteração estável (ordenar chaves quando a ordem importar); Chromium com flags fixas e `device_scale_factor=1`; PDF normalizado (Task 7).
- Fontes: `source="file"` → `@font-face` servida localmente por sha256; `source="referenced-only"|"fallback"` → família genérica `sans-serif` + registro em `__GUARD_REPORT__.fontFallbacks`. Nunca declarar URL externa de fonte.
- Dependências npm e Python são instaladas com versões exatas materializadas em `package-lock.json`/`requirements-lock.txt`; a imagem Playwright do Plano 4 usa exatamente a mesma versão do pacote Python e do Chromium instalados aqui.
- Antes de cada commit: em `packages/render`, typecheck/test/build verdes; quando tocar Python, pytest/ruff/format check do engine. Localmente os testes de Chromium podem pular antes do setup; no gate `BRANDRT_REQUIRE_RENDER_TESTS=1` (CI e fechamento do plano), extra, browser ou dist ausente é falha e nenhum teste de render/export pode pular.
- Arquivos do Plano 1 só podem ser modificados nos pontos `Modify:` listados nas tarefas (pyproject, cli.py, conftest.py, README do engine). Qualquer outra necessidade = desvio a reportar.
- Commits na branch `m1-walking-skeleton`, mensagem `feat(render): <resumo>`.
- Nunca editar este arquivo de plano nem os documentos em `docs/`.

## Contratos que este plano produz (consumidos pelos Planos 3 e 4)

Além do contrato da página fixado no plano-mestre (repetido aqui por completude: `window.__PAYLOAD__` injetado antes do script; `#canvas` com width/height exatos do perfil; `__RENDER_DONE__ = true` só após `document.fonts.ready` + layout estável; `__GUARD_REPORT__` com overflows medidos), este plano fixa três **adições** (não alteram nenhuma chave existente do plano-mestre; registradas no Self-Review para o orquestrador refletir no plano-mestre):

1. **URLs de assets** — a página resolve:
   - imagem/logo: `${assetsBaseUrl}/${path}` (path relativo ao pacote de marca, `encodeURI`);
   - fonte com `source="file"`: `${assetsBaseUrl}/fonts/${fileSha256}` (sem extensão);
   - apenas `data:image/png;base64,...` pode ser usado **verbatim**, exclusivamente para o placeholder constante das thumbnails;
   - URLs `http:`, `https:`, protocol-relative, `javascript:` e `blob:` são recusadas. Todo asset real vem do pacote/storage controlado.
   O Plano 3 deve expor essas rotas sobre seu storage content-addressed; o export deste plano as serve localmente.
2. **`__GUARD_REPORT__` estendido** — `{overflows: [{slotId, contentPx, boxPx}], fontFallbacks: [{slotId, token, family, reason}]}`. `reason` é `referenced-only|configured-fallback|load-failed`; só fontes efetivamente usadas entram. `build_guard_verdict` valida o report e o combina ao guard estático na ordem dos slots: overflow e `load-failed` são `blocked`; substituições confirmadas são `fixed`. Um verdict com `blocked` nunca publica o arquivo final.
3. **Erro de página** — payload ausente/inválido: a página define `window.__RENDER_ERROR__ = <mensagem PT-BR>` e **nunca** define `__RENDER_DONE__`; o export converte isso em `ExportError`.

API pública TS (import do Plano 4): `renderDocument(container, payload) → GuardReport`, `renderDocumentStable(container, payload, options?) → Promise<GuardReport>` e `parsePayload(raw) → Payload`, exportadas de `src/index.ts`. Página de export e preview usam a variante estável.

API pública Python (import do Plano 3): `export_document(ir, layout, content, assets_dir, render_dist, out_path) → ExportResult(out_path, guard_verdict)`; `ExportBlocked` carrega o `GuardVerdict` quando uma regra impede a publicação.

---

### Task 1: Scaffold do pacote render

**Files:**
- Create: `packages/render/package.json`
- Create: `packages/render/package-lock.json` (gerado por npm; nunca escrito à mão)
- Create: `packages/render/tsconfig.json`
- Create: `packages/render/vite.config.ts`
- Create: `packages/render/src/index.ts`
- Create: `packages/render/README.md`
- Test: `packages/render/tests/sanity.test.ts`

**Interfaces:**
- Produces: pacote npm testável com Vitest e typecheck com tsc; ambiente que TODAS as tarefas TS seguintes usam.

- [ ] **Step 1: Escrever `packages/render/package.json`:**

```json
{
  "name": "@brand-runtime/render",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": "24.x", "npm": "11.x" },
  "main": "src/index.ts",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0",
    "jsdom": "^25.0.0"
  }
}
```

- [ ] **Step 2: Escrever `packages/render/tsconfig.json`:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

- [ ] **Step 3: Escrever `packages/render/vite.config.ts`** (config de build entra na Task 6; aqui só o ambiente de teste):

```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  test: { environment: "jsdom" },
});
```

- [ ] **Step 4: Criar `src/index.ts`** com `export const VERSION = "0.1.0";` e `README.md` documentando setup dev (copiar exatamente para a seção "Desenvolvimento"):

```bash
cd packages/render
npm install
npm test
npm run typecheck
npm run build
```

- [ ] **Step 5: Teste falhando** `tests/sanity.test.ts`:

```ts
import { expect, it } from "vitest";
import { VERSION } from "../src/index";

it("exporta a versão do pacote", () => {
  expect(VERSION).toBe("0.1.0");
});
```

- [ ] **Step 6:** `npm install` gera `package-lock.json`; a partir daí, apagar `node_modules`, rodar `npm ci` + `npm test` + `npm run typecheck`. Expected: PASS. O lockfile é parte obrigatória do commit.
- [ ] **Step 7: Commit** `feat(render): scaffold do pacote @brand-runtime/render`

---

### Task 2: Tipos do contrato + parsePayload

**Files:**
- Create: `packages/render/src/types.ts`
- Create: `packages/render/src/payload.ts`
- Create: `packages/render/tests/fixtures.ts`
- Modify: `packages/render/src/index.ts` (re-exports)
- Test: `packages/render/tests/payload.test.ts`

**Interfaces:**
- Produces (`src/types.ts`) — o **subconjunto lido pelo render** dos JSONs do engine (camelCase; campos que o render não usa ficam de fora de propósito — YAGNI):

```ts
export interface ColorToken { value: string }
export interface FontToken {
  family: string;
  weight: number;
  style: "normal" | "italic";
  source: "file" | "referenced-only" | "fallback";
  fileSha256?: string | null;
}
export interface SemanticRole {
  font: string; color: string;
  minSizePx: number; maxSizePx: number; lineHeight: number;
}
export interface LogoAsset { path: string; minWidthPx?: number }
export interface BrandIr {
  revision: { id: string };
  colors: Record<string, ColorToken>;
  fonts: Record<string, FontToken>;
  roles: Record<string, SemanticRole>;
  assets: Record<string, LogoAsset>;
}
export interface Canvas { widthPx: number; heightPx: number; safeAreaPx: number }
export interface Background { kind: "color" | "image-slot"; colorToken?: string | null }
export interface Slot {
  id: string;
  kind: "text" | "image" | "logo";
  role?: string | null;
  maxChars?: number | null;
  minResolution?: [number, number] | null;
  area: [number, number, number, number];
  fit: "shrink-within-role-range" | "fixed";
  required: boolean;
}
export type Profile = "post-1x1" | "post-4x5" | "story-9x16" | "doc-a4";
export interface LayoutSpec {
  id: string; profile: Profile; namePt: string;
  canvas: Canvas; background: Background; slots: Slot[];
}
export type SlotValue =
  | { kind: "text"; text: string }
  | { kind: "image"; path: string; sha256?: string | null };
export interface ContentSpec {
  layoutId: string; brandRevisionId: string;
  values: Record<string, SlotValue>;
}
export interface Payload {
  brandIr: BrandIr; layoutSpec: LayoutSpec; contentSpec: ContentSpec;
  assetsBaseUrl: string;
}
export type RenderPayload = Payload;   // alias — Plano 4 usa os dois nomes
export interface Overflow { slotId: string; contentPx: number; boxPx: number }
export interface FontFallback {
  slotId: string; token: string; family: string;
  reason: "referenced-only" | "configured-fallback" | "load-failed";
}
export interface GuardReport { overflows: Overflow[]; fontFallbacks: FontFallback[] }
```

- Produces (`src/payload.ts`): `parsePayload(raw: unknown): Payload`.
- Regras normativas de `parsePayload` (validar todo campo dereferenciado pelo render; evidências/diagnostics podem ficar fora da projeção TS):
  1. raízes/records, strings não vazias e números finitos; profile na union canônica e canvas exatamente igual à tabela de perfis;
  2. slots com IDs únicos, kind válido, área positiva dentro do canvas, role obrigatório para texto, `fit`, limites e resolução válidos;
  3. colors `#RRGGBB`; fonts com source válido, peso/style e `source="file"` exigindo sha256 lowercase de 64 hex; roles com referências existentes e `0 < minSizePx <= maxSizePx`, lineHeight positivo;
  4. `logo.primary.path` presente e seguro; values pela union discriminada, chaves de slot conhecidas, path seguro; `contentSpec.layoutId == layoutSpec.id` e `brandRevisionId == brandIr.revision.id`;
  5. `assetsBaseUrl` aceita root-relative ou URL `http://127.0.0.1:<porta>/...` do export; URL externa é inválida. Paths recusam scheme, `\\`, segmentos vazios/`.`/`..`;
  6. qualquer falha → `throw new Error("Payload inválido: <detalhe PT-BR citando o campo>")` (primeiro problema encontrado); sucesso devolve a mesma referência.
- Produces (`tests/fixtures.ts`) — fixture compartilhada por TODOS os testes TS (valores casam com o kit do Plano 1: `statement-post-1x1`, headline `(48, 324, 984, 432)`, logo `(902, 902, 130, 130)`):

```ts
import type { BrandIr, ContentSpec, LayoutSpec, Payload } from "../src/types";

export const SHA = "a".repeat(64);

export function fixtureIr(): BrandIr {
  return {
    revision: { id: "brandrev_fixture" },
    colors: {
      "color.primary": { value: "#1A4D8F" },
      "color.background": { value: "#FFFFFF" },
      "color.text": { value: "#1A1A1A" },
    },
    fonts: {
      "font.heading": { family: "Fixture Sans", weight: 700, style: "normal", source: "file", fileSha256: SHA },
      "font.body": { family: "Helvetica", weight: 400, style: "normal", source: "referenced-only" },
    },
    roles: {
      heading: { font: "font.heading", color: "color.primary", minSizePx: 40, maxSizePx: 96, lineHeight: 1.1 },
      body: { font: "font.body", color: "color.text", minSizePx: 16, maxSizePx: 24, lineHeight: 1.5 },
      caption: { font: "font.body", color: "color.text", minSizePx: 12, maxSizePx: 16, lineHeight: 1.4 },
    },
    assets: { "logo.primary": { path: "assets/logos/logo.svg", minWidthPx: 96 } },
  };
}

export function fixtureLayout(): LayoutSpec {
  return {
    id: "statement-post-1x1",
    profile: "post-1x1",
    namePt: "Frase de impacto",
    canvas: { widthPx: 1080, heightPx: 1080, safeAreaPx: 48 },
    background: { kind: "color", colorToken: "color.background" },
    slots: [
      { id: "headline", kind: "text", role: "heading", maxChars: 90, area: [48, 324, 984, 432], fit: "shrink-within-role-range", required: true },
      { id: "logo", kind: "logo", area: [902, 902, 130, 130], fit: "fixed", required: true },
    ],
  };
}

export function fixtureContent(): ContentSpec {
  return {
    layoutId: "statement-post-1x1",
    brandRevisionId: "brandrev_fixture",
    values: { headline: { kind: "text", text: "Olá, marca" } },
  };
}

export function fixturePayload(): Payload {
  return {
    brandIr: fixtureIr(),
    layoutSpec: fixtureLayout(),
    contentSpec: fixtureContent(),
    assetsBaseUrl: "/pkg",
  };
}
```

- [ ] **Step 1: Testes falhando** `tests/payload.test.ts`:

```ts
import { expect, it } from "vitest";
import { parsePayload } from "../src/payload";
import { fixturePayload } from "./fixtures";

it("aceita payload válido e devolve a mesma referência", () => {
  const p = fixturePayload();
  expect(parsePayload(p)).toBe(p);
});

it("rejeita não-objeto", () => {
  expect(() => parsePayload("x")).toThrowError(/Payload inválido/);
});

it("rejeita payload sem assetsBaseUrl", () => {
  const p = fixturePayload() as unknown as Record<string, unknown>;
  delete p.assetsBaseUrl;
  expect(() => parsePayload(p)).toThrowError(/Payload inválido: .*assetsBaseUrl/);
});

it("rejeita canvas sem dimensões", () => {
  const p = fixturePayload();
  (p.layoutSpec.canvas as unknown as Record<string, unknown>).widthPx = undefined;
  expect(() => parsePayload(p)).toThrowError(/Payload inválido/);
});

it("rejeita slots que não são array", () => {
  const p = fixturePayload();
  (p.layoutSpec as unknown as Record<string, unknown>).slots = {};
  expect(() => parsePayload(p)).toThrowError(/Payload inválido/);
});

it("rejeita referências quebradas e divergência de revisão", () => {
  const p = fixturePayload();
  p.layoutSpec.slots[0].role = "nao-existe";
  expect(() => parsePayload(p)).toThrowError(/role|papel/i);
  p.layoutSpec.slots[0].role = "heading";
  p.contentSpec.brandRevisionId = "brandrev_outra";
  expect(() => parsePayload(p)).toThrowError(/revisão/i);
});

it("rejeita asset externo, traversal e fonte file sem sha válido", () => {
  const external = fixturePayload();
  external.assetsBaseUrl = "https://externo.example/assets";
  expect(() => parsePayload(external)).toThrowError(/assetsBaseUrl/i);
  const traversal = fixturePayload();
  traversal.brandIr.assets["logo.primary"].path = "../segredo.svg";
  expect(() => parsePayload(traversal)).toThrowError(/path/i);
  const font = fixturePayload();
  font.brandIr.fonts["font.heading"].fileSha256 = "abc";
  expect(() => parsePayload(font)).toThrowError(/sha256/i);
});
```

- [ ] **Step 2:** Rodar, ver falhar (módulos inexistentes).
- [ ] **Step 3:** Implementar `types.ts` + `payload.ts`; re-exportar de `index.ts`: `export * from "./types"; export { parsePayload } from "./payload";`.
- [ ] **Step 4:** Testes verdes; suíte completa; typecheck.
- [ ] **Step 5: Commit** `feat(render): tipos do contrato e parsePayload com validação PT-BR`

---

### Task 3: Fontes locais — @font-face, fallback e URLs

**Files:**
- Create: `packages/render/src/fonts.ts`
- Test: `packages/render/tests/fonts.test.ts`

**Interfaces:**
- Produces:

```ts
export const FALLBACK_FAMILY = "sans-serif";
export function internalFamily(token: string): string;
// "font.heading" -> "br-font-heading" (pontos viram hífens, prefixo "br-")
export function joinUrl(base: string, path: string): string;
export interface FontFaceBuild {
  css: string;
  families: Record<string, string>;          // token -> valor CSS completo de font-family
  fallbacks: Array<{ token: string; family: string; reason: "referenced-only" | "configured-fallback" }>;
}
export function buildFontFaces(ir: BrandIr, assetsBaseUrl: string): FontFaceBuild;
export function fontLoadSpecs(ir: BrandIr): string[];
// specs para document.fonts.load — só tokens source=="file"
```

- Regras normativas:
  1. `joinUrl`: aceita `data:image/png;base64,...` **verbatim** para o placeholder interno; recusa com erro PT-BR qualquer outro esquema/URL absoluta, path protocol-relative, barra invertida e segmentos vazios/`.`/`..`; nos demais casos codifica cada segmento com `encodeURIComponent` e junta ao `base` sem barra final;
  2. token com `source=="file"` e `fileSha256` presente → bloco `@font-face` com `font-family: "<internalFamily>"`, `src: url("<joinUrl(assetsBaseUrl, "fonts/" + fileSha256)>")`, `font-weight: <weight>`, `font-style: <style>`; `families[token] = '"<internalFamily>", ' + FALLBACK_FAMILY`;
  3. token `referenced-only|fallback` → **sem** `@font-face`; `families[token] = FALLBACK_FAMILY`; entrada com `reason="referenced-only"|"configured-fallback"`. `source="file"` sem sha válido nunca chega aqui: `parsePayload` falha;
  4. iteração de tokens em ordem alfabética de chave (`Object.keys(ir.fonts).sort()`) — CSS e listas determinísticos;
  5. `fontLoadSpecs`: para cada token `file` (mesma ordem), string no formato do font shorthand aceito por `document.fonts.load`: `[italic ]<weight> 16px "<internalFamily>"` (prefixo `italic ` só quando `style=="italic"`);
  6. nenhuma URL externa jamais aparece no CSS gerado (fontes locais ou genérica — spec §8, risco R3).

- [ ] **Step 1: Testes falhando** `tests/fonts.test.ts`:

```ts
import { expect, it } from "vitest";
import { FALLBACK_FAMILY, buildFontFaces, fontLoadSpecs, internalFamily, joinUrl } from "../src/fonts";
import { SHA, fixtureIr } from "./fixtures";

it("internalFamily deriva o nome interno do token", () => {
  expect(internalFamily("font.heading")).toBe("br-font-heading");
});

it("joinUrl normaliza barras e escapa o path", () => {
  expect(joinUrl("http://x/assets/", "a b/c.png")).toBe("http://x/assets/a%20b/c.png");
  expect(joinUrl("http://x/assets", "a.png")).toBe("http://x/assets/a.png");
  expect(joinUrl("http://x/assets", "a#b?/c d.png")).toBe("http://x/assets/a%23b%3F/c%20d.png");
});

it("joinUrl usa verbatim apenas para data:image/png;base64", () => {
  expect(joinUrl("http://x/assets", "data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
  expect(() => joinUrl("http://x/assets", "https://exemplo/img.png")).toThrow(/externa/i);
  expect(() => joinUrl("http://x/assets", "../segredo")).toThrow(/inválido/i);
});

it("fonte com arquivo vira @font-face local por sha256", () => {
  const out = buildFontFaces(fixtureIr(), "http://x/assets");
  expect(out.css).toContain('font-family: "br-font-heading"');
  expect(out.css).toContain(`src: url("http://x/assets/fonts/${SHA}")`);
  expect(out.css).toContain("font-weight: 700");
  expect(out.families["font.heading"]).toBe(`"br-font-heading", ${FALLBACK_FAMILY}`);
});

it("referenced-only não gera @font-face, usa genérica e registra fallback", () => {
  const out = buildFontFaces(fixtureIr(), "http://x/assets");
  expect(out.css).not.toContain("br-font-body");
  expect(out.families["font.body"]).toBe(FALLBACK_FAMILY);
  expect(out.fallbacks).toEqual([
    { token: "font.body", family: "Helvetica", reason: "referenced-only" },
  ]);
});

it("fontLoadSpecs cobre apenas fontes com arquivo", () => {
  expect(fontLoadSpecs(fixtureIr())).toEqual(['700 16px "br-font-heading"']);
});
```

- [ ] **Step 2:** Falhar. **Step 3:** Implementar. **Step 4:** Verde + suíte + typecheck.
- [ ] **Step 5: Commit** `feat(render): fontes locais por sha256 com fallback genérico registrado`

---

### Task 4: Estilos por role + algoritmo de fitting

**Files:**
- Create: `packages/render/src/styles.ts`
- Create: `packages/render/src/fit.ts`
- Test: `packages/render/tests/styles.test.ts`

**Interfaces:**
- Produces (`src/styles.ts`):

```ts
export interface TextStyle {
  fontFamily: string;   // families[role.font] (Task 3)
  fontWeight: string;   // String(ir.fonts[role.font].weight)
  fontStyle: string;    // ir.fonts[role.font].style
  color: string;        // ir.colors[role.color].value
  lineHeight: string;   // String(role.lineHeight)
  minSizePx: number;    // role.minSizePx
  maxSizePx: number;    // role.maxSizePx
}
export function roleStyle(ir: BrandIr, roleName: string, families: Record<string, string>): TextStyle;
// role/font/color inexistente no IR -> Error com mensagem PT-BR contendo "desconhecido"
```

- Produces (`src/fit.ts`):

```ts
export function chooseFontSize(
  measure: (sizePx: number) => number,   // altura do conteúdo em px para o tamanho testado
  boxPx: number, minPx: number, maxPx: number,
): number;
```

- Regras normativas de `chooseFontSize`:
  1. testa `maxPx` primeiro; se `measure(maxPx) <= boxPx`, retorna `maxPx` sem outras chamadas;
  2. senão desce de 1 em 1 px (inteiros) e retorna o primeiro (= maior) tamanho que cabe;
  3. se nem `minPx` cabe, retorna `minPx` (o overflow será reportado pelo render — nunca truncar silenciosamente, spec §5.8);
  4. totalmente determinístico — sem busca aleatória/heurística dependente de float.

- [ ] **Step 1: Testes falhando** `tests/styles.test.ts`:

```ts
import { expect, it } from "vitest";
import { chooseFontSize } from "../src/fit";
import { roleStyle } from "../src/styles";
import { fixtureIr } from "./fixtures";

it("estilo do role vem do IR", () => {
  const st = roleStyle(fixtureIr(), "heading", { "font.heading": "X, sans-serif" });
  expect(st).toEqual({
    fontFamily: "X, sans-serif",
    fontWeight: "700",
    fontStyle: "normal",
    color: "#1A4D8F",
    lineHeight: "1.1",
    minSizePx: 40,
    maxSizePx: 96,
  });
});

it("role inexistente lança erro PT-BR", () => {
  expect(() => roleStyle(fixtureIr(), "hero", {})).toThrowError(/desconhecido/);
});

it("chooseFontSize devolve o maior tamanho inteiro que cabe", () => {
  expect(chooseFontSize((s) => s * 3, 100, 10, 50)).toBe(33);
});

it("nada cabe: devolve o mínimo", () => {
  expect(chooseFontSize(() => 1000, 100, 10, 50)).toBe(10);
});

it("o máximo cabe: devolve o máximo com uma única medição", () => {
  let calls = 0;
  const size = chooseFontSize((s) => {
    calls += 1;
    return s;
  }, 100, 10, 50);
  expect(size).toBe(50);
  expect(calls).toBe(1);
});
```

- [ ] **Step 2:** Falhar. **Step 3:** Implementar. **Step 4:** Verde + suíte + typecheck.
- [ ] **Step 5: Commit** `feat(render): estilos por role e fitting determinístico dentro da faixa do papel`

---

### Task 5: renderDocument — DOM 1:1 px + GuardReport

**Files:**
- Create: `packages/render/src/render.ts`
- Modify: `packages/render/src/index.ts` (re-export)
- Test: `packages/render/tests/render.test.ts`

**Interfaces:**
- Produces:

```ts
export interface RenderOptions {
  // injeção de medição p/ testes (jsdom não faz layout); default = medida DOM real
  measureText?: (contentEl: HTMLElement, fontSizePx: number) => number;
  // preenchido apenas por renderDocumentStable após tentar carregar as fontes usadas
  fontLoadStatus?: ReadonlyMap<string, boolean>;
}
export function renderDocument(container: HTMLElement, payload: Payload, options?: RenderOptions): GuardReport;
```

- Regras normativas (a API síncrona `renderDocument(container, payload, options?) → GuardReport` é a fixada para o Plano 4 — o `.d.ts` de lá assume exatamente isso):
  1. **Síncrona e idempotente:** começa com `container.replaceChildren()` — re-render não duplica nós (contrato do adapter `mount.ts` do Plano 4: `update(p)` chama `renderDocument` de novo);
  2. container (o futuro `#canvas`): `position: relative; overflow: hidden`; `width`/`height` em px **exatos** do `layoutSpec.canvas`; `background-color` = valor do token quando `background.kind == "color"`; nenhuma cor definida quando `"image-slot"`;
  3. primeiro filho: `<style>` com o CSS de `buildFontFaces(ir, assetsBaseUrl)`;
  4. cada slot renderizado vira `<div data-slot-id="{id}">` com `position: absolute`, `left/top/width/height` = `area` em px e `z-index` por kind: `image` 1, `text` 2, `logo` 3 (texto sempre legível sobre foto; logo sempre por cima);
  5. slot `text` (só com value `kind=="text"`): filho `<div data-slot-content>` com `textContent` = texto **integral** — `maxChars` NÃO é imposto aqui (bloquear é papel do guard; o render mede e reporta); estilos de `roleStyle` + `white-space: pre-wrap; overflow-wrap: break-word`; caixa com `overflow: hidden` (nada vaza visualmente; o overflow é **reportado**, nunca silencioso);
  6. fitting (`fit == "shrink-within-role-range"`): tamanho via `chooseFontSize` na faixa `[minSizePx, maxSizePx]` do role, com measure = `options?.measureText ?? medidaDomReal`; a implementação seta `content.style.fontSize = "<size>px"` ANTES de cada chamada do measure e deixa aplicado o tamanho escolhido; `medidaDomReal(el) = el.scrollHeight`; `fit == "fixed"` em slot text: usa `maxSizePx` sem fitting;
  7. `overflows`: após o fitting, `contentPx` = medida final do conteúdo, `boxPx` = `area[3]`; entra no report somente se `contentPx > boxPx`; ordem = ordem dos slots no layout;
  8. slot `image` (só com value `kind=="image"`): `<img>` com `src = joinUrl(assetsBaseUrl, value.path)` (somente placeholder `data:image/png;base64` pode escapar da base — Task 3), `width/height: 100%; object-fit: cover; display: block`, `alt=""`;
  9. slot `logo`: independe do content — sempre renderiza `<img>` com `src = joinUrl(assetsBaseUrl, ir.assets["logo.primary"].path)`, `object-fit: contain`, demais regras do item 8;
  10. slot `text`/`image` sem value correspondente → **não vai ao DOM** (o render nunca inventa conteúdo; obrigatoriedade é check do guard — Plano 1 Task 14);
  11. `fontFallbacks` do report: uma entrada por slot textual com conteúdo, na ordem de `layout.slots`. Para `referenced-only|fallback`, inclui `{slotId, token, family, reason}` com reason correspondente. Para `source="file"`, só inclui `reason="load-failed"` quando o passe estável já tentou carregar a face e confirmou falha; o passe imediato não inventa falha antes do load;
  12. nenhum acesso a rede, relógio ou aleatoriedade em qualquer caminho.

- [ ] **Step 1: Testes falhando** `tests/render.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { renderDocument } from "../src/render";
import { fixturePayload } from "./fixtures";

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
});

it("canvas 1:1 px com fundo do token", () => {
  renderDocument(container, fixturePayload());
  expect(container.style.width).toBe("1080px");
  expect(container.style.height).toBe("1080px");
  expect(container.style.position).toBe("relative");
  const bg = container.style.backgroundColor.toLowerCase().replaceAll(" ", "");
  expect(["#ffffff", "#fff", "rgb(255,255,255)"]).toContain(bg);
});

it("fundo image-slot não define cor", () => {
  const payload = fixturePayload();
  payload.layoutSpec.background = { kind: "image-slot" };
  renderDocument(container, payload);
  expect(container.style.backgroundColor).toBe("");
});

it("slot de texto absoluto com estilos do role e texto integral", () => {
  const payload = fixturePayload();
  payload.contentSpec.values.headline = { kind: "text", text: "Olá\nmarca" };
  renderDocument(container, payload);
  const slot = container.querySelector('[data-slot-id="headline"]') as HTMLElement;
  expect(slot.style.position).toBe("absolute");
  expect(slot.style.left).toBe("48px");
  expect(slot.style.top).toBe("324px");
  expect(slot.style.width).toBe("984px");
  expect(slot.style.height).toBe("432px");
  expect(slot.style.zIndex).toBe("2");
  expect(slot.style.overflow).toBe("hidden");
  const content = slot.querySelector("[data-slot-content]") as HTMLElement;
  expect(content.textContent).toBe("Olá\nmarca");
  expect(content.style.whiteSpace).toBe("pre-wrap");
  expect(content.style.fontFamily).toContain("br-font-heading");
  expect(content.style.fontWeight).toBe("700");
  expect(content.style.lineHeight).toBe("1.1");
});

it("fitting escolhe o maior tamanho que cabe via measureText injetado", () => {
  const report = renderDocument(container, fixturePayload(), {
    measureText: (_el, size) => size * 10,
  });
  const content = container.querySelector("[data-slot-content]") as HTMLElement;
  expect(content.style.fontSize).toBe("43px"); // maior s em 40..96 com 10*s <= 432
  expect(report.overflows).toEqual([]);
});

it("overflow reportado quando nem o mínimo cabe", () => {
  const report = renderDocument(container, fixturePayload(), { measureText: () => 1000 });
  const content = container.querySelector("[data-slot-content]") as HTMLElement;
  expect(content.style.fontSize).toBe("40px"); // fica no mínimo do role
  expect(report.overflows).toEqual([{ slotId: "headline", contentPx: 1000, boxPx: 432 }]);
});

it("logo sempre renderiza a partir do IR, acima do resto", () => {
  renderDocument(container, fixturePayload());
  const box = container.querySelector('[data-slot-id="logo"]') as HTMLElement;
  const img = box.querySelector("img") as HTMLImageElement;
  expect(img.getAttribute("src")).toBe("/pkg/assets/logos/logo.svg");
  expect(img.style.objectFit).toBe("contain");
  expect(box.style.zIndex).toBe("3");
});

it("slot image sem valor fica fora do DOM; com valor vira img cover", () => {
  const payload = fixturePayload();
  payload.layoutSpec.slots.unshift({
    id: "photo", kind: "image", minResolution: [1080, 1080],
    area: [0, 0, 1080, 1080], fit: "fixed", required: true,
  });
  renderDocument(container, payload);
  expect(container.querySelector('[data-slot-id="photo"]')).toBeNull();

  payload.contentSpec.values.photo = { kind: "image", path: "fotos/praia grande.png" };
  renderDocument(container, payload);
  const img = container.querySelector('[data-slot-id="photo"] img') as HTMLImageElement;
  expect(img.getAttribute("src")).toBe("/pkg/fotos/praia%20grande.png");
  expect(img.style.objectFit).toBe("cover");
  expect((img.parentElement as HTMLElement).style.zIndex).toBe("1");
});

it("path data: é usado verbatim (thumbnails do Plano 4)", () => {
  const payload = fixturePayload();
  payload.layoutSpec.slots.unshift({
    id: "photo", kind: "image", area: [0, 0, 10, 10], fit: "fixed", required: false,
  });
  payload.contentSpec.values.photo = { kind: "image", path: "data:image/png;base64,AA==" };
  renderDocument(container, payload);
  const img = container.querySelector('[data-slot-id="photo"] img') as HTMLImageElement;
  expect(img.getAttribute("src")).toBe("data:image/png;base64,AA==");
});

it("re-render é idempotente e não reporta fallback de token não usado", () => {
  renderDocument(container, fixturePayload());
  const report = renderDocument(container, fixturePayload());
  expect(container.querySelectorAll('[data-slot-id="headline"]').length).toBe(1);
  expect(report.fontFallbacks).toEqual([]);
});
```

- [ ] **Step 2:** Falhar. **Step 3:** Implementar; re-exportar `renderDocument` e `RenderOptions` de `index.ts`. **Step 4:** Verde + suíte + typecheck.
- [ ] **Step 5: Commit** `feat(render): renderDocument monta DOM 1:1 px e reporta overflow e fallback`

---

### Task 6: Página render.html — sinais, fontes prontas e build

**Files:**
- Create: `packages/render/src/page.ts`
- Create: `packages/render/src/stable.ts`
- Create: `packages/render/src/preview-page.ts` (harness de equivalência)
- Create: `packages/render/render.html`
- Create: `packages/render/preview.html` (harness, sem chrome visual)
- Modify: `packages/render/vite.config.ts` (build)
- Test: `packages/render/tests/page.test.ts`

**Interfaces:**
- Produces (`src/page.ts`):

```ts
declare global {
  interface Window {
    __PAYLOAD__?: unknown;
    __RENDER_DONE__?: boolean;
    __GUARD_REPORT__?: GuardReport;
    __RENDER_ERROR__?: string;
  }
}
export async function bootstrapRenderPage(): Promise<void>;

export interface StableRenderOptions { signal?: AbortSignal }
export async function renderDocumentStable(
  container: HTMLElement, payload: Payload, options?: StableRenderOptions
): Promise<GuardReport>;
```

- Regras normativas de `renderDocumentStable` (pipeline autoritativo compartilhado pelo preview e export):
  1. checa `signal.aborted` em cada fronteira assíncrona; abort anterior nunca pode sobrescrever um update mais novo;
  2. primeira passada com `renderDocument`, apenas para instalar faces e iniciar recursos;
  3. identifica fontes usadas por slots textuais com conteúdo, carrega cada face `file` com `document.fonts.load(spec, textoDoSlot)`, registra sucesso/falha por token e aguarda `document.fonts.ready`;
  4. segunda passada com o mapa de status das fontes, fazendo fitting com métricas finais e reportando fallbacks por slot/reason;
  5. aguarda `decode()` de toda imagem criada na segunda passada; erro de logo/imagem vira `Error` PT-BR com o slot — nunca screenshot de recurso incompleto;
  6. aguarda dois `requestAnimationFrame` (fallback `setTimeout(0)`) e devolve o report da segunda passada. A função nunca acessa rede por conta própria.

- Regras normativas do bootstrap (cumpre o contrato do plano-mestre + adição nº 3):
  1. `window.__PAYLOAD__` ausente → `window.__RENDER_ERROR__ = "window.__PAYLOAD__ ausente — o payload deve ser injetado antes do script."`; **nunca** define `__RENDER_DONE__`; retorna;
  2. `parsePayload` falha → `__RENDER_ERROR__ = <mensagem do erro>`; nunca DONE;
  3. renderiza no elemento `#canvas` (ausente → `__RENDER_ERROR__ = "elemento #canvas ausente na página de render."`);
  4. chama exclusivamente `renderDocumentStable(canvas, payload)`; `window.__GUARD_REPORT__ = report` e **só depois** `window.__RENDER_DONE__ = true`;
  7. exceção inesperada em qualquer ponto → `__RENDER_ERROR__ = String(erro)`; nunca DONE;
  8. o módulo NÃO executa nada ao ser importado (testável em jsdom) — quem chama `bootstrapRenderPage()` é o script inline de `render.html`.
- Produces (`render.html`, raiz do pacote — input do Vite; conteúdo exato):

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>brand-runtime — render</title>
    <style>
      html, body { margin: 0; padding: 0; }
      @page { size: A4; margin: 0; }
      @media print {
        html, body { width: 210mm; height: 297mm; overflow: hidden; }
      }
    </style>
  </head>
  <body>
    <div id="canvas"></div>
    <script type="module">
      import { bootstrapRenderPage } from "/src/page.ts";
      void bootstrapRenderPage();
    </script>
  </body>
</html>
```

  O bloco `@page`/`@media print` é normativo: garante que o `page.pdf(format:"A4")` do export saia com margem zero e **uma única página** (o canvas doc-a4 de 794×1123 px excede o A4 CSS por fração de px — sem o clamp de print, o Chromium cria uma 2ª página em branco).
- `preview.html` contém somente `#canvas` e chama `parsePayload` + `renderDocumentStable`, publicando `__PREVIEW_DONE__`/`__PREVIEW_ERROR__`. É um harness sem UI usado para provar que a entrada pública de preview e a página de export geram os mesmos pixels; o app React usa a mesma função via adapter.
- Produces (`vite.config.ts` final):

```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    rollupOptions: { input: { render: "render.html", preview: "preview.html" } },
  },
  test: { environment: "jsdom" },
});
```

  `base: "./"` é normativo — o dist precisa funcionar servido de qualquer prefixo de path (staging do export, nginx do Plano 4).

- [ ] **Step 1: Testes falhando** `tests/page.test.ts`:

```ts
import { beforeEach, expect, it, vi } from "vitest";
import { bootstrapRenderPage } from "../src/page";
import { fixturePayload } from "./fixtures";

beforeEach(() => {
  document.body.innerHTML = '<div id="canvas"></div>';
  delete window.__PAYLOAD__;
  delete window.__RENDER_DONE__;
  delete window.__GUARD_REPORT__;
  delete window.__RENDER_ERROR__;
  Object.defineProperty(HTMLImageElement.prototype, "decode", {
    configurable: true,
    value: vi.fn(async () => undefined),
  });
});

it("publica __GUARD_REPORT__ e só então __RENDER_DONE__ com payload válido", async () => {
  window.__PAYLOAD__ = fixturePayload();
  await bootstrapRenderPage();
  expect(window.__RENDER_ERROR__).toBeUndefined();
  expect(window.__RENDER_DONE__).toBe(true);
  expect(window.__GUARD_REPORT__).toEqual({
    overflows: [],
    fontFallbacks: [],
  });
  const canvas = document.getElementById("canvas") as HTMLElement;
  expect(canvas.style.width).toBe("1080px");
  expect(canvas.style.height).toBe("1080px");
});

it("payload ausente vira __RENDER_ERROR__ e nunca __RENDER_DONE__", async () => {
  await bootstrapRenderPage();
  expect(window.__RENDER_DONE__).toBeUndefined();
  expect(window.__RENDER_ERROR__).toContain("__PAYLOAD__");
});

it("payload inválido vira __RENDER_ERROR__ com a mensagem do parse", async () => {
  window.__PAYLOAD__ = { brandIr: {} };
  await bootstrapRenderPage();
  expect(window.__RENDER_DONE__).toBeUndefined();
  expect(window.__RENDER_ERROR__).toContain("Payload inválido");
});

it("sem #canvas vira __RENDER_ERROR__", async () => {
  document.body.innerHTML = "";
  window.__PAYLOAD__ = fixturePayload();
  await bootstrapRenderPage();
  expect(window.__RENDER_DONE__).toBeUndefined();
  expect(window.__RENDER_ERROR__).toContain("#canvas");
});

it("DONE espera o decode das imagens da segunda passada", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  vi.mocked(HTMLImageElement.prototype.decode).mockReturnValue(pending);
  window.__PAYLOAD__ = fixturePayload();
  const boot = bootstrapRenderPage();
  await Promise.resolve();
  expect(window.__RENDER_DONE__).toBeUndefined();
  release();
  await boot;
  expect(window.__RENDER_DONE__).toBe(true);
});
```

- [ ] **Step 2:** Falhar. **Step 3:** Implementar `page.ts`, `render.html` e o `vite.config.ts` final.
- [ ] **Step 4:** Verde + suíte + typecheck. Rodar `npm run build` e conferir: `dist/render.html` e `dist/preview.html` existem e referenciam bundles por paths relativos.
- [ ] **Step 5: Commit** `feat(render): página render.html com sinais __RENDER_DONE__/__GUARD_REPORT__/__RENDER_ERROR__ e build Vite`

---

### Task 7: Export Python — base pura (payload, staging, PDF normalizado)

**Files:**
- Create: `packages/engine/src/brand_runtime/export.py`
- Modify: `packages/engine/pyproject.toml` (extras)
- Modify: `packages/engine/requirements-lock.txt` (regerado com extras; Playwright 1.61.0 exato)
- Modify: `packages/engine/README.md` (seção "Export (render)")
- Test: `packages/engine/tests/test_export_pure.py`

**Interfaces:**
- Produces (`export.py`, parte 1 — nada aqui importa playwright; o módulo inteiro importa SEM o extra instalado):

```python
class ExportError(Exception):
    """Falha de render/export. Mensagem PT-BR."""

def build_payload(ir: BrandIR, layout: LayoutSpec, content: ContentSpec,
                  assets_base_url: str) -> dict
def stage_site(render_dist: Path, assets_dir: Path, staging_dir: Path) -> Path
def normalize_pdf(data: bytes) -> bytes
```

- Regras normativas:
  1. `build_payload` → exatamente `{"brandIr": ..., "layoutSpec": ..., "contentSpec": ..., "assetsBaseUrl": ...}` com os três modelos serializados via `model_dump(mode="json", by_alias=True)` (camelCase — o que a página espera);
  2. `stage_site`: se `render_dist / "render.html"` não existe → `ExportError` com mensagem PT-BR contendo `npm run build`; copia o dist confiável → `staging_dir` e materializa `assets_dir` → `staging_dir / "pkg"` arquivo a arquivo. Recusa symlink/junction, arquivo não regular e qualquer resolved path fora da raiz — nunca segue links do pacote. Para cada arquivo regular em `assets_dir / "fonts"`: cópia extra em `staging_dir / "pkg" / "fonts" / <sha256 hex do conteúdo>` (sem extensão). A cópia é idempotente: no workdir do Plano 3 os arquivos já têm o hash como nome;
  3. `normalize_pdf`: preservando o **comprimento total em bytes** (offsets do xref continuam válidos), zera: os dígitos dentro de `/CreationDate (D:...)` e `/ModDate (D:...)`, e os dígitos hex dentro de `/ID [<...> <...>]` (regexes tolerantes a espaçamento). São os únicos campos variáveis conhecidos do `page.pdf` do Chromium; se o teste de determinismo da Task 9 revelar outro, ampliar a normalização preservando comprimento e reportar desvio;
  4. `assets_base_url` nunca é modificada por `build_payload` — quem decide a base (loopback aqui, rota da API no Plano 3) é o chamador.
- Modify `pyproject.toml` — extras ficam:

```toml
[project.optional-dependencies]
dev = ["pytest>=8.2", "ruff>=0.6", "pypdf>=4.2"]
export = ["playwright==1.61.0"]
```

  (`pypdf` é dev-only: usado nos testes da Task 9 para contar páginas/medir mediabox.)
- Modify `README.md` do engine — seção "Export (render)" com o setup (copiar exatamente):

```bash
cd packages/engine
.venv/Scripts/pip install -e ".[dev,export]"
.venv/Scripts/python -m playwright install chromium
cd ../render
npm install
npm run build
```

- [ ] **Step 1: Testes falhando** `tests/test_export_pure.py`:

```python
import hashlib

import pytest

from brand_runtime.export import ExportError, build_payload, normalize_pdf, stage_site
from brand_runtime.kit.generator import generate_kit
from brand_runtime.kit.models import ContentSpec, TextValue
from tests.test_generator import _ir


def test_build_payload_tem_as_quatro_chaves_camel_case(brand_package):
    ir = _ir(brand_package)
    layout = next(l for l in generate_kit(ir) if l.id == "statement-post-1x1")
    content = ContentSpec(layout_id=layout.id, brand_revision_id=ir.revision.id,
                          values={"headline": TextValue(text="Olá, marca")})
    payload = build_payload(ir, layout, content, "http://127.0.0.1:9/pkg")
    assert set(payload) == {"brandIr", "layoutSpec", "contentSpec", "assetsBaseUrl"}
    assert payload["layoutSpec"]["canvas"]["widthPx"] == 1080
    assert payload["brandIr"]["fonts"]["font.heading"]["fileSha256"]
    assert payload["contentSpec"]["layoutId"] == "statement-post-1x1"
    assert payload["assetsBaseUrl"] == "http://127.0.0.1:9/pkg"


def test_stage_site_monta_dist_pkg_e_fontes_por_hash(brand_package, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "render.html").write_text("<!doctype html>", encoding="utf-8")
    (dist / "assets" / "page.js").write_text("//js", encoding="utf-8")
    staging = stage_site(dist, brand_package, tmp_path / "staging")
    assert (staging / "render.html").is_file()
    assert (staging / "assets" / "page.js").is_file()
    assert (staging / "pkg" / "assets" / "logos" / "logo.svg").is_file()
    font = brand_package / "fonts" / "fixture-sans-bold.ttf"
    sha = hashlib.sha256(font.read_bytes()).hexdigest()
    assert (staging / "pkg" / "fonts" / sha).is_file()


def test_stage_site_sem_build_falha_com_instrucao(brand_package, tmp_path):
    with pytest.raises(ExportError, match="npm run build"):
        stage_site(tmp_path / "nao-existe", brand_package, tmp_path / "staging")


def test_stage_site_recusa_symlink_de_asset(brand_package, tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "render.html").write_text("<!doctype html>", encoding="utf-8")
    link = brand_package / "escape.png"
    try:
        link.symlink_to(tmp_path / "segredo.txt")
    except OSError:
        pytest.skip("criação de symlink indisponível neste ambiente")
    with pytest.raises(ExportError, match="link"):
        stage_site(dist, brand_package, tmp_path / "staging")


def test_normalize_pdf_zera_datas_e_id_preservando_tamanho():
    raw = (b"%PDF-1.7\n"
           b"/CreationDate (D:20260711120000+00'00')\n"
           b"/ModDate (D:20260711120000+00'00')\n"
           b"/ID [<AABB01> <CCDD02>]\ntrailer")
    out = normalize_pdf(raw)
    assert len(out) == len(raw)
    assert b"20260711" not in out
    assert b"/CreationDate (D:00000000000000+00'00')" in out
    assert b"/ID [<000000> <000000>]" in out
```

- [ ] **Step 2:** Falhar. **Step 3:** Implementar + atualizar pyproject e README; reinstalar extras: `.venv/Scripts/pip install -e ".[dev,export]"`. **Step 4:** Verde + suíte completa + ruff (a partir de `packages/engine`).
- [ ] **Step 5: Commit** `feat(render): base pura do export Python (payload, staging, PDF normalizado)`

---

### Task 8: Export Python — runtime Playwright e guard report medido

**Files:**
- Modify: `packages/engine/src/brand_runtime/export.py`
- Modify: `packages/engine/tests/conftest.py` (fixture `render_dist`)
- Test: `packages/engine/tests/test_export_report.py`

**Interfaces:**
- Produces (`export.py`, parte 2):

```python
DEFAULT_LAUNCH_ARGS: tuple[str, ...] = ("--force-color-profile=srgb",)

@contextmanager
def serve_directory(root: Path) -> Iterator[str]      # yield "http://127.0.0.1:<porta>"

@contextmanager
def open_render_page(ir: BrandIR, layout: LayoutSpec, content: ContentSpec,
                     assets_dir: Path, render_dist: Path) -> Iterator["Page"]

class MeasuredOverflow(CamelModel): ...
class MeasuredFontFallback(CamelModel):
    slot_id: str
    token: str
    family: str
    reason: Literal["referenced-only", "configured-fallback", "load-failed"]
class MeasuredGuardReport(CamelModel): ...

def measure_guard_report(ir: BrandIR, layout: LayoutSpec, content: ContentSpec,
                         assets_dir: Path, render_dist: Path) -> MeasuredGuardReport
def build_guard_verdict(ir: BrandIR, layout: LayoutSpec, content: ContentSpec,
                        assets_dir: Path, report: MeasuredGuardReport) -> GuardVerdict
```

- Regras normativas:
  1. playwright é importado **dentro** de `open_render_page`; `ImportError`, browser ausente, launch/navigation/timeout e encerramento inesperado viram `ExportError` PT-BR com causa encadeada. Page, context, browser, servidor e temporários são sempre fechados em `finally`;
  2. `serve_directory`: `ThreadingHTTPServer(("127.0.0.1", 0), ...)` com `SimpleHTTPRequestHandler` (`directory=root`) e `log_message` silenciado; porta efêmera no URL; `shutdown()` garantido no fim;
  3. `open_render_page`: staging em `tempfile.TemporaryDirectory` → `stage_site` → `serve_directory`; `chromium.launch(args=list(DEFAULT_LAUNCH_ARGS))` (headless default); `new_page(viewport={"width": layout.canvas.width_px, "height": layout.canvas.height_px}, device_scale_factor=1)` (viewport = dimensões do perfil — contrato do plano-mestre);
  4. **bloqueio estrutural de rede:** `page.route("**/*", handler)` compara scheme + host + porta com a origem efêmera exata de `base`; aborta qualquer outra request, inclusive outro serviço em `127.0.0.1` — fonte/imagem externa e SSRF loopback são impossíveis por construção;
  5. payload: `build_payload(..., assets_base_url=f"{base}/pkg")`; injetado pelo argumento serializado do Playwright (`page.add_init_script("payload => { window.__PAYLOAD__ = payload; }", payload)`), nunca por interpolação de código — antes de qualquer script da página;
  6. `goto(f"{base}/render.html")` e espera com timeout explícito de 30 s por `__RENDER_DONE__` ou `__RENDER_ERROR__`; timeout vira `ExportError` PT-BR. Se `__RENDER_ERROR__` estiver definido → `ExportError(<mensagem da página>)`;
  7. `measure_guard_report`: valida `page.evaluate("window.__GUARD_REPORT__")` com `MeasuredGuardReport`; shape inválido vira `ExportError`, nunca `dict` livre;
  8. `build_guard_verdict`: começa com `run_static_checks`; valida que medições referenciam slots textuais com conteúdo, recusa duplicatas e acrescenta checks na ordem de `layout.slots`. Overflow → `text-overflow/blocked`; fallback `referenced-only|configured-fallback` → `font-fallback/fixed`; `load-failed` → `font-fallback/blocked`. Retorna `GuardVerdict(checks=...)`.
- Modify `tests/conftest.py` — acrescentar (sem tocar no resto):

```python
RENDER_DIST = Path(__file__).resolve().parents[2] / "render" / "dist"


@pytest.fixture(scope="session")
def render_dist() -> Path:
    if not (RENDER_DIST / "render.html").is_file():
        if os.environ.get("BRANDRT_REQUIRE_RENDER_TESTS") == "1":
            pytest.fail("render dist obrigatório ausente — rode npm ci && npm run build")
        pytest.skip("rode `npm run build` em packages/render antes dos testes de export")
    return RENDER_DIST
```

  Ainda em `conftest.py`, ampliar a fonte fixture: cmap e outlines determinísticos para ASCII básico e caracteres usados pelos testes (`á`, `í`, `ó`, `ã`, `ç`, `é`). Uma face só com `.notdef`/`A` não prova carregamento real e é proibida no gate de render.

- [ ] **Step 1: Testes falhando** `tests/test_export_report.py` (cada teste lança um Chromium — a suíte de export é a parte lenta e isso é aceito no skeleton):

```python
import os

import pytest

if os.environ.get("BRANDRT_REQUIRE_RENDER_TESTS") == "1":
    import playwright.sync_api  # noqa: F401
else:
    pytest.importorskip("playwright.sync_api", reason="extra [export] não instalado")

from brand_runtime.export import (  # noqa: E402
    ExportError, MeasuredGuardReport, build_guard_verdict, measure_guard_report,
)
from brand_runtime.kit.generator import generate_kit  # noqa: E402
from brand_runtime.kit.models import ContentSpec, TextValue  # noqa: E402
from tests.test_generator import _ir  # noqa: E402


def _triplet(brand_package, text):
    ir = _ir(brand_package)
    layout = next(l for l in generate_kit(ir) if l.id == "statement-post-1x1")
    content = ContentSpec(layout_id=layout.id, brand_revision_id=ir.revision.id,
                          values={"headline": TextValue(text=text)})
    return ir, layout, content


def test_fallback_de_fonte_usada_registrado_no_report(brand_package, render_dist):
    ir = _ir(brand_package)
    layout = next(l for l in generate_kit(ir) if l.id == "one-pager-doc-a4")
    content = ContentSpec(layout_id=layout.id, brand_revision_id=ir.revision.id,
                          values={"title": TextValue(text="Título"),
                                  "body": TextValue(text="Corpo")})
    report = measure_guard_report(ir, layout, content, brand_package, render_dist)
    tokens = {f.token for f in report.font_fallbacks}
    assert "font.body" in tokens          # usado e referenced-only na fixture do Plano 1
    assert "font.heading" not in tokens   # usado, mas arquivo local carregou


def test_texto_curto_nao_tem_overflow(brand_package, render_dist):
    ir, layout, content = _triplet(brand_package, "Olá, marca")
    report = measure_guard_report(ir, layout, content, brand_package, render_dist)
    assert report.overflows == []


def test_overflow_medido_com_quarenta_linhas(brand_package, render_dist):
    ir, layout, content = _triplet(brand_package, "Linha de teste\n" * 40)
    report = measure_guard_report(ir, layout, content, brand_package, render_dist)
    ov = {o.slot_id: o for o in report.overflows}
    assert "headline" in ov
    assert ov["headline"].box_px == 432
    assert ov["headline"].content_px > 432


def test_report_vira_verdict_bloqueado_e_corrigido(brand_package):
    ir, layout, content = _triplet(brand_package, "A\n" * 40)
    report = MeasuredGuardReport.model_validate({
        "overflows": [{"slotId": "headline", "contentPx": 500, "boxPx": 432}],
        "fontFallbacks": [{"slotId": "headline", "token": "font.heading",
                           "family": "Fixture Sans", "reason": "load-failed"}],
    })
    verdict = build_guard_verdict(ir, layout, content, brand_package, report)
    measured = [c for c in verdict.checks if c.id in {"text-overflow", "font-fallback"}]
    assert [(c.id, c.status) for c in measured] == [
        ("text-overflow", "blocked"), ("font-fallback", "blocked")]


def test_render_error_vira_export_error(brand_package, render_dist, monkeypatch):
    import brand_runtime.export as export_mod
    ir, layout, content = _triplet(brand_package, "Olá")
    monkeypatch.setattr(export_mod, "build_payload", lambda *a, **k: {"brandIr": {}})
    with pytest.raises(ExportError):
        with export_mod.open_render_page(ir, layout, content, brand_package, render_dist):
            pass
```

- [ ] **Step 2:** Falhar. **Step 3:** Implementar. **Step 4:** Verde (os 4 testes RODANDO, não pulando — extra instalado e dist buildado) + suíte completa + ruff.
- [ ] **Step 5: Commit** `feat(render): runtime Playwright com servidor loopback e guard report medido`

---

### Task 9: export_document — PNG/PDF determinístico + CLI

**Files:**
- Modify: `packages/engine/src/brand_runtime/export.py` (`ExportResult`, `export_document`)
- Modify: `packages/engine/src/brand_runtime/cli.py` (comando `export`)
- Modify: `packages/engine/README.md` (seção "Uso" — exemplo de export)
- Test: `packages/engine/tests/test_export_files.py`
- Test: `packages/engine/tests/test_cli_export.py`
- Test: `packages/engine/tests/test_preview_equivalence.py`
- Modify: `.github/workflows/ci.yml` (gate render obrigatório)

**Interfaces:**
- Produces:

```python
class ExportBlocked(ExportError):
    """Export recusado pelo Brand Guard; expõe ``verdict`` para API/CLI."""
    verdict: GuardVerdict

@dataclass(frozen=True)
class ExportResult:
    out_path: Path
    guard_verdict: GuardVerdict

def export_document(ir: BrandIR, layout: LayoutSpec, content: ContentSpec,
                    assets_dir: Path, render_dist: Path, out_path: Path) -> ExportResult
```

  (Assinatura fixada — o `PlaywrightExporter` do Plano 3 a chama exatamente assim, com o formato codificado na extensão de `out_path`.)
- Regras normativas de `export_document`:
  1. o sufixo decide o formato: `.png` → `locator.screenshot(type="png", animations="disabled", caret="hide", scale="css")`; `.pdf` → `page.pdf(format="A4", print_background=True, margin=0)` passado por `normalize_pdf`; outro sufixo → `ValueError` PT-BR;
  2. `.pdf` exige `layout.profile == "doc-a4"` → senão `ValueError("Export em PDF é exclusivo do perfil doc-a4.")` (contrato do plano-mestre: doc-a4 via print A4; posts são PNG);
  3. executa primeiro `run_static_checks`; bloqueio estático levanta `ExportBlocked(GuardVerdict(...))` sem abrir o Chromium. Só então captura/valida o report, monta `build_guard_verdict` (estático + medido) e aplica o mesmo gate antes de screenshot/PDF/escrita;
  4. checks `fixed` são preservados e permitem export; só depois do gate cria os bytes e publica por temporário no mesmo diretório + `flush`/`fsync` + `os.replace`; falha preserva arquivo anterior. Retorno `ExportResult(out_path, guard_verdict)`;
  6. determinismo: mesma entrada → bytes idênticos. PNG é determinístico por construção (mesma plataforma + `--force-color-profile=srgb` + `device_scale_factor=1`); PDF via `normalize_pdf`. Se a igualdade de bytes do PDF falhar por campo ainda não normalizado, ampliar `normalize_pdf` (preservando comprimento) e reportar desvio.
  7. equivalência: o harness `preview.html` e `render.html` recebem o mesmo payload, usam `renderDocumentStable` e têm seus `#canvas` capturados no mesmo Chromium com as mesmas opções; `ImageChops.difference(...).getbbox()` precisa ser `None` (RGBA, tolerância zero). Esse teste é separado de export A==B.
- Regras normativas do CLI (Modify `cli.py` — 6º comando, mesmo estilo JSON/UTF-8 do Plano 1):
  - `brandrt export IR_JSON LAYOUT_JSON CONTENT_JSON --assets-dir DIR --render-dist DIR --out FILE`;
  - carrega os três JSONs com `model_validate` dos modelos do engine; chama `export_document`; imprime o path exportado em stdout; exit 0;
  - `ValueError` ou `ExportError` operacional → mensagem PT-BR em stderr, exit code 2;
  - `ExportBlocked` → `exc.verdict` JSON camelCase em stderr, exit code 3, sem arquivo parcial;
  - formato vem da extensão de `--out` (consistente com `export_document`; sem flag `--format`).
- Modify `README.md` do engine: exemplo completo na seção "Uso":

```bash
.venv/Scripts/brandrt export ir.json kit/statement-post-1x1.json content.json ^
  --assets-dir pacote-da-marca --render-dist ../render/dist --out out/post.png
```

- [ ] **Step 1: Testes falhando** `tests/test_export_files.py`:

```python
import os
import shutil

import pytest

if os.environ.get("BRANDRT_REQUIRE_RENDER_TESTS") == "1":
    import playwright.sync_api  # noqa: F401
else:
    pytest.importorskip("playwright.sync_api", reason="extra [export] não instalado")

from PIL import Image  # noqa: E402

from brand_runtime.export import ExportBlocked, export_document, normalize_pdf  # noqa: E402
from brand_runtime.kit.generator import generate_kit  # noqa: E402
from brand_runtime.kit.models import ContentSpec, ImageValue, TextValue  # noqa: E402
from tests.test_generator import _ir  # noqa: E402


def _statement(brand_package, text="Olá, marca"):
    ir = _ir(brand_package)
    layout = next(l for l in generate_kit(ir) if l.id == "statement-post-1x1")
    content = ContentSpec(layout_id=layout.id, brand_revision_id=ir.revision.id,
                          values={"headline": TextValue(text=text)})
    return ir, layout, content


def test_png_tem_dimensoes_do_perfil_e_fundo_da_marca(brand_package, render_dist, tmp_path):
    ir, layout, content = _statement(brand_package)
    result = export_document(ir, layout, content, brand_package, render_dist,
                             tmp_path / "post.png")
    img = Image.open(result.out_path).convert("RGB")
    assert img.size == (1080, 1080)
    assert img.getpixel((5, 5)) == (255, 255, 255)   # color.background #FFFFFF
    assert all(check.status == "pass" for check in result.guard_verdict.checks)


def test_png_deterministico_bytes_identicos(brand_package, render_dist, tmp_path):
    ir, layout, content = _statement(brand_package)
    a = export_document(ir, layout, content, brand_package, render_dist, tmp_path / "a.png")
    b = export_document(ir, layout, content, brand_package, render_dist, tmp_path / "b.png")
    assert a.out_path.read_bytes() == b.out_path.read_bytes()


def test_png_renderiza_slot_de_imagem_servido_localmente(brand_package, render_dist, tmp_path):
    pkg = tmp_path / "pkg"
    shutil.copytree(brand_package, pkg)
    Image.new("RGB", (1080, 410), (10, 200, 30)).save(pkg / "foto.png")
    ir = _ir(pkg)
    layout = next(l for l in generate_kit(ir) if l.id == "announce-post-1x1")
    content = ContentSpec(layout_id=layout.id, brand_revision_id=ir.revision.id,
                          values={"headline": TextValue(text="Olá"),
                                  "body": TextValue(text="Corpo do anúncio."),
                                  "photo": ImageValue(path="foto.png")})
    result = export_document(ir, layout, content, pkg, render_dist,
                             tmp_path / "announce.png")
    img = Image.open(result.out_path).convert("RGB")
    assert img.getpixel((5, 1075)) == (10, 200, 30)   # foto cobre a faixa inferior
    assert img.getpixel((5, 5)) == (255, 255, 255)    # fundo color.background


def test_pdf_doc_a4_uma_pagina_deterministico(brand_package, render_dist, tmp_path):
    from pypdf import PdfReader
    ir = _ir(brand_package)
    layout = next(l for l in generate_kit(ir) if l.id == "one-pager-doc-a4")
    content = ContentSpec(layout_id=layout.id, brand_revision_id=ir.revision.id,
                          values={"title": TextValue(text="Relatório"),
                                  "body": TextValue(text="Um parágrafo simples de documento.")})
    a = export_document(ir, layout, content, brand_package, render_dist, tmp_path / "a.pdf")
    b = export_document(ir, layout, content, brand_package, render_dist, tmp_path / "b.pdf")
    data = a.out_path.read_bytes()
    assert data[:5] == b"%PDF-"
    assert data == b.out_path.read_bytes()
    assert normalize_pdf(data) == data  # normalização idempotente
    reader = PdfReader(str(a.out_path))
    assert len(reader.pages) == 1
    box = reader.pages[0].mediabox
    # A4 matemático em pt; Chromium 149 quantiza o MediaBox em até ~1 pt.
    assert abs(float(box.width) - 595.276) <= 1.1
    assert abs(float(box.height) - 841.890) <= 1.1


def test_pdf_fora_do_doc_a4_recusado(brand_package, render_dist, tmp_path):
    ir, layout, content = _statement(brand_package)
    with pytest.raises(ValueError, match="doc-a4"):
        export_document(ir, layout, content, brand_package, render_dist, tmp_path / "x.pdf")


def test_sufixo_desconhecido_recusado(brand_package, render_dist, tmp_path):
    ir, layout, content = _statement(brand_package)
    with pytest.raises(ValueError, match="png ou .pdf"):
        export_document(ir, layout, content, brand_package, render_dist, tmp_path / "x.gif")


def test_overflow_medido_bloqueia_sem_publicar_arquivo(brand_package, render_dist, tmp_path):
    ir, layout, content = _statement(brand_package, "A\n" * 40)  # 80 chars: passa limite, estoura altura
    out = tmp_path / "x.png"
    with pytest.raises(ExportBlocked) as caught:
        export_document(ir, layout, content, brand_package, render_dist, out)
    assert any(c.id == "text-overflow" and c.status == "blocked"
               for c in caught.value.verdict.checks)
    assert not out.exists()
```

  `tests/test_preview_equivalence.py` monta o mesmo staging, injeta o mesmo payload em `preview.html`, aguarda `__PREVIEW_DONE__`, captura `#canvas` com as opções normativas e compara RGBA/tolerância zero com o PNG de `export_document`. Também prova que request a URL externa e a outra porta loopback são abortados. Com `BRANDRT_REQUIRE_RENDER_TESTS=1`, ausência de pacote, browser ou dist é falha, nunca skip.

  E `tests/test_cli_export.py`:

```python
import json
import os

import pytest
from typer.testing import CliRunner

if os.environ.get("BRANDRT_REQUIRE_RENDER_TESTS") == "1":
    import playwright.sync_api  # noqa: F401
else:
    pytest.importorskip("playwright.sync_api", reason="extra [export] não instalado")

from brand_runtime.cli import app  # noqa: E402
from brand_runtime.kit.generator import generate_kit  # noqa: E402
from tests.test_generator import _ir  # noqa: E402

runner = CliRunner()


def _write_inputs(brand_package, tmp_path, layout_id, values):
    ir = _ir(brand_package)
    layout = next(l for l in generate_kit(ir) if l.id == layout_id)
    ir_p = tmp_path / "ir.json"
    ir_p.write_text(ir.model_dump_json(by_alias=True), encoding="utf-8")
    layout_p = tmp_path / "layout.json"
    layout_p.write_text(layout.model_dump_json(by_alias=True), encoding="utf-8")
    content_p = tmp_path / "content.json"
    content_p.write_text(json.dumps({"layoutId": layout_id,
                                     "brandRevisionId": ir.revision.id,
                                     "values": values}), encoding="utf-8")
    return ir_p, layout_p, content_p


def test_cli_export_png(brand_package, render_dist, tmp_path):
    ir_p, layout_p, content_p = _write_inputs(
        brand_package, tmp_path, "statement-post-1x1",
        {"headline": {"kind": "text", "text": "Olá"}})
    out = tmp_path / "post.png"
    r = runner.invoke(app, ["export", str(ir_p), str(layout_p), str(content_p),
                            "--assets-dir", str(brand_package),
                            "--render-dist", str(render_dist),
                            "--out", str(out)])
    assert r.exit_code == 0, r.output
    assert out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_cli_export_pdf_one_pager(brand_package, render_dist, tmp_path):
    ir_p, layout_p, content_p = _write_inputs(
        brand_package, tmp_path, "one-pager-doc-a4",
        {"title": {"kind": "text", "text": "Relatório"},
         "body": {"kind": "text", "text": "Corpo."}})
    out = tmp_path / "doc.pdf"
    r = runner.invoke(app, ["export", str(ir_p), str(layout_p), str(content_p),
                            "--assets-dir", str(brand_package),
                            "--render-dist", str(render_dist),
                            "--out", str(out)])
    assert r.exit_code == 0, r.output
    assert out.read_bytes()[:5] == b"%PDF-"


def test_cli_export_pdf_de_post_falha_com_exit_2(brand_package, render_dist, tmp_path):
    ir_p, layout_p, content_p = _write_inputs(
        brand_package, tmp_path, "statement-post-1x1",
        {"headline": {"kind": "text", "text": "Olá"}})
    r = runner.invoke(app, ["export", str(ir_p), str(layout_p), str(content_p),
                            "--assets-dir", str(brand_package),
                            "--render-dist", str(render_dist),
                            "--out", str(tmp_path / "x.pdf")])
    assert r.exit_code == 2


def test_cli_export_bloqueado_emite_verdict_exit_3_sem_arquivo(
    brand_package, render_dist, tmp_path
):
    ir_p, layout_p, content_p = _write_inputs(
        brand_package, tmp_path, "statement-post-1x1",
        {"headline": {"kind": "text", "text": "A\n" * 40}})
    out = tmp_path / "blocked.png"
    r = runner.invoke(app, ["export", str(ir_p), str(layout_p), str(content_p),
                            "--assets-dir", str(brand_package),
                            "--render-dist", str(render_dist), "--out", str(out)])
    assert r.exit_code == 3 and not out.exists()
    verdict = json.loads(r.stderr)
    assert any(c["id"] == "text-overflow" for c in verdict["checks"])
```

- [ ] **Step 2:** Falhar. **Step 3:** Implementar `ExportResult` + `export_document` + comando CLI + README; atualizar CI para Node 24 → `npm ci/test/typecheck/build`, instalar `playwright==1.61.0` + Chromium e executar pytest com `BRANDRT_REQUIRE_RENDER_TESTS=1`. **Step 4:** todos os testes de render/export RODANDO, nenhum skip; suíte completa + ruff + format check verdes.
- [ ] **Step 5: Commit** `feat(render): export_document PNG/PDF determinístico e comando brandrt export`

---

## Self-Review (do autor do plano)

- **Cobertura do escopo:** DOM 1:1 px → T5; pipeline autoritativo compartilhado (`renderDocumentStable`: fontes usadas, refit, decode de imagens, dois frames) e páginas de render/preview → T6; export Playwright PNG/PDF → T8–T9; determinismo A==B e equivalência preview/export RGBA com tolerância zero → T9; guard estático + medido tipado → T8/T9. Fallback confirmado vira `fixed`; falha de fonte/overflow vira `blocked` antes de qualquer publicação. Fora de escopo do skeleton: contraste texto×foto medido, scrim automático e autofix de overflow.
- **Consistência com o plano-mestre:** payload com quatro chaves; canvas/viewport exatos; `__RENDER_DONE__` somente depois de fontes, imagens e layout estáveis; report interno validado e convertido em `GuardVerdict`; doc-a4 794×1123 e print A4. As extensões foram refletidas no mestre antes da implementação.
- **Consistência com os Planos 3 e 4:** `export_document` é o ponto único chamado pelo adapter da API; `ExportBlocked.verdict.checks` chega ao job. O app usa `renderDocumentStable` com cancelamento. Somente `data:image/png;base64` interno é verbatim; URLs externas e outra origem loopback são recusadas.
- **Extensões aditivas refletidas no plano-mestre:** (1) convenção de URLs sob `assetsBaseUrl` (`fonts/<sha256>`, placeholder `data:image/png;base64`); (2) campo `fontFallbacks` no `__GUARD_REPORT__`; (3) sinal `__RENDER_ERROR__`; (4) adaptação obrigatória das medições para `GuardCheck` e gate de publicação.
- **Riscos conhecidos e mitigação:** Playwright Python e imagem estão pinados em 1.61.0; CI exige browser/dist. PDF é comparado entre processos frescos, normalizado de forma idempotente e reaberto por pypdf. `sans-serif` varia entre plataformas, mas preview/export e determinismo são provados dentro da mesma imagem pinada.
- **Type-consistency:** projeção TS valida todos os campos dereferenciados; report medido é validado por Pydantic; fixture font tem cmap/outlines para o texto de teste; `GuardVerdict` é o artefato único atravessando CLI/API.
- **Placeholders:** nenhum; todo corpo de implementação não-mostrado está integralmente especificado por testes + regras normativas numeradas.
