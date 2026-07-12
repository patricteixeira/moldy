# brand-runtime — documento fundador

**Nome de trabalho:** brand-runtime (batismo pendente — §10)
**Status:** spec fundadora v1 — aprovada em 11/07/2026 e reconciliada em
12/07/2026 com as ADRs 0001–0007 e o motor concluído do Plano 1
**Substitui como referência de produto:** `brand-compiler-projeto (1).md`, `brand-compiler-system-design.md`, `brand-compiler-roadmap.md` e a pesquisa de mercado. O destino de cada documento anterior está no §11 — nada foi descartado sem endereço.

---

## 1. Tese

> Sistema open source e self-hosted que interpreta uma identidade visual existente, converte-a num perfil de marca executável e dá a pessoas leigas um ambiente de criação onde sair da marca é impossível por construção.

O sistema **não cria identidade visual**. Ele lê a que já existe — manual em PDF, logos, fontes, cores anotadas — e a transforma em trilhos dentro dos quais qualquer pessoa produz material correto: posts, documentos e, mais tarde, apresentações e arquivos Office nativos.

**Prova da tese (marco 1):** uma pessoa que não sabe usar a própria marca produz, sem ajuda, um post de Instagram e um documento simples corretos em relação à marca.

---

## 2. A decisão que reorganizou o projeto

Os documentos anteriores desenhavam o produto para um usuário que edita PowerPoint e re-envia arquivos para validação (round-trip). A decisão de persona de 11/07/2026 estabelece outra prioridade: **o usuário leigo** — tem uma marca, não sabe usá-la, quer produzir posts, documentos e templates. É o "pior cenário": se o sistema funciona para ele, funciona para todos.

Consequências que esta spec incorpora:

1. **A entrada inverte.** Leigo não tem tokens nem escreve regras. A entrada primária é o pacote informal (PDF do manual, logos, fontes, cores anotadas). Tokens DTCG viram atalho para instaladores técnicos, não pré-requisito.
2. **A ordem dos renderizadores inverte.** Social (PNG) e documento simples (PDF) antes de PPTX de alta fidelidade.
3. **O guardrail padrão inverte.** Autocorreção e restrição por construção, não relatório de conformidade. Round-trip e severidades viram camada posterior (M3), para a persona marketing.
4. **A superfície de edição é por slots**, não canvas livre nem editor Office embutido. Canvas livre é onde o leigo erra; editor embutido chega no M3 para quem sabe o que faz.

O que **não** mudou em relação aos documentos anteriores: o Brand IR como contrato central; conformidade determinística, auditável e reproduzível; arquivos nativos como requisito sério (agora no M2); proveniência e autoridade de evidências; imutabilidade de revisões; tratamento de uploads como conteúdo hostil. A engenharia anterior foi **reorganizada, não descartada** (§11).

---

## 3. Personas

### 3.1 Usuário leigo — persona nº 1, "pior cenário"

Tem uma marca (encomendada, herdada, ou da empresa onde trabalha) e não sabe usá-la. Quer produzir posts, documentos e materiais sem aprender design. Não lê relatório de conformidade; não re-envia arquivo para validação; não distingue heading de body; fecha a aba diante de doze warnings. Interage apenas com: escolher layout, trocar texto, trocar imagem, exportar.

### 3.2 Instalador da marca

Quem alimenta o sistema: um designer entregando a marca "instalada" ao cliente (no lugar do PDF morto), o dono do projeto, ou o próprio wizard assistido quando não há ninguém técnico por perto. Interage com extração, confirmação, resolução de conflitos e publicação de revisões do Brand IR. O pacote de marca instalado é o **entregável que um designer de identidade passa ao cliente** — este é um canal de adoção deliberado.

### 3.3 Usuário marketing (M3)

Sabe o que está fazendo e quer liberdade com verificação: edita livremente (inclusive no PowerPoint), recebe lint com severidades, autocorreção e waivers. É a persona dos documentos anteriores — continua no roadmap, uma camada depois.

---

## 4. O que o produto é — e o que não é

**É:** um compilador de marca (intake → Brand IR), um gerador de kits de layout, um editor por slots, um motor de render multi-formato e um guarda de conformidade.

**Não é e não promete:**

- criar identidade visual — marca fraca entra, marca fraca sai, fielmente;
- canvas livre — Canva já existe; nosso valor é o trilho, não a liberdade;
- clone de suíte Office — arquivos nativos são saída (M2) e round-trip (M3), não a superfície primária de edição;
- IA como autoridade de conformidade — regras são determinísticas; LLM apenas acelera interpretação e sempre passa por confirmação humana;
- inferência precisa de uma marca completa a partir de qualquer PDF — extração é sugestão com evidência, nunca verdade silenciosa;
- edição semântica de PDF.

**Posicionamento** (síntese da pesquisa de mercado, com as lacunas dela já consideradas):

| Player | O que faz | Por que não resolve |
|---|---|---|
| Canva Brand Kit | guarda cores, fontes, logos | **guarda, não impõe** — off-brand continua fácil; fechado, hosted |
| Marq (ex-Lucidpress) | templates com elementos travados | valida nosso padrão de produto; SaaS fechado, sem compilador de marca |
| Templafy / UpSlide / Macabacus | compliance documental enterprise | acoplados ao Microsoft 365, caros, fechados |
| BrandDocs (OSS, alpha) | extrai perfil de templates Office | valida interesse na tese; sem runtime, sem UX leiga |
| ONLYOFFICE / Collabora | editores embutíveis | sem inteligência de marca — candidatos a **adapter** no M3, não concorrentes |

O diferencial defensável: enforcement determinístico + pacote de marca executável e versionado + posse dos dados (self-hosted) + arquivos nativos de verdade (M2).

---

## 5. Arquitetura

### 5.1 Visão geral

```text
pacote informal da marca                 entrada estruturada (atalho)
(PDF manual, logos, fontes,              (tokens DTCG / Tokens Studio)
 cores anotadas, exemplos)                        │
        │                                         │
        ▼                                         ▼
┌─────────────────────────────────────────────────────────┐
│ BRAND INTAKE — extração + confirmação (wizard)          │
│ evidência, confiança e autoridade por valor             │
│ LLM opcional e plugável; funciona 100% sem              │
└───────────────────────────┬─────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────┐
│ BRAND IR — perfil de marca executável                   │
│ revisões imutáveis; Pydantic → JSON Schema publicado    │
└───────────────────────────┬─────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────┐
│ TEMPLATE KIT GENERATOR — Brand IR → Layout Specs        │
│ (layouts como dados: slots tipados, constraints)        │
└───────────────────────────┬─────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────┐
│ SLOT EDITOR (web) — preencher, trocar, escolher         │
│ preview = a mesma biblioteca de render do export        │
│ BRAND GUARD — checks de conteúdo; corrige ou bloqueia   │
└───────────────────────────┬─────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────┐
│ RENDER / EXPORT                                         │
│ M1: PNG + PDF (Chromium headless, mesma render lib)     │
│ M2: PPTX / DOCX nativos (template-fill OOXML)           │
│ M3: round-trip — parser → linter → fixer                │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Os três modelos de dados

Herança direta do system design anterior (que separava Brand IR / Deck Spec / Document Graph), generalizada para além de apresentações:

- **Brand IR** — a marca executável. Tokens, papéis semânticos (`heading`,
  `body`, `caption`), assets com hash, perfis de formato, regras, proveniência e
  diagnostics. Independente de qualquer formato de saída. Revisões imutáveis;
  documentos gerados registram o `brandRevisionId` de origem.
- **Layout Spec** — um layout como dados: slots tipados, composição, constraints, política de fitting. Produzido pelo Kit Generator, validável por schema, renderizável em qualquer formato de saída compatível com seu perfil.
- **Content Spec** — o que o usuário preencheu: valores por slot. Equivalente generalizado do "Deck Spec" anterior (posts e documentos, não só decks).

Operações:

```text
Brand IR ──Kit Generator──► Layout Specs (o kit da marca)
Brand IR + Layout Spec + Content Spec ──Render──► PNG/PDF (M1) | PPTX/DOCX (M2)
Brand IR + Layout Spec + Content Spec ──Brand Guard──► correções e bloqueios
PPTX editado fora ──Parser──► Document Graph ──Linter/Fixer──► nova revisão (M3)
```

### 5.3 Brand Intake

**Entradas interpretadas pelo motor do M1:** PDF de manual de marca; logos
(SVG/PNG); fontes (arquivos ou apenas nomes); cores extraídas e tokens
DTCG/Tokens Studio. DTCG é a camada de maior autoridade no ranking, mas não
fura o princípio de confirmação: seus valores também passam pelo wizard antes
de entrar no IR. Exemplos de materiais aprovados podem viajar no pacote, mas
sua interpretação visual permanece fora do motor do Plano 1.

**Extração com evidência.** Cada valor candidato carrega origem (arquivo, página, região), confiança e autoridade — modelo herdado do system design anterior, com sua regra central mantida: **inferência nunca vence fonte autoritativa, e conflito material nunca é resolvido silenciosamente.** No mundo leigo-first, "resolver conflito" vira pergunta de confirmação em linguagem natural.

**Wizard de confirmação.** Mostra, não descreve ("esta é a cor principal?" com a cor na tela); uma pergunta por vez; vocabulário sem jargão. O que não pôde ser determinado fica registrado como indeterminado — o sistema **nunca inventa silenciosamente**. O resultado confirmado é publicado como revisão imutável do Brand IR.

**LLM como acelerador opcional.** Interpretar texto de guideline, sugerir mapeamento de papéis, classificar layouts de exemplo. Toda sugestão é materializada como configuração explícita e confirmada — IA não decide conformidade. O wizard funciona 100% sem chave de API (provedores plugáveis: Anthropic, OpenAI, Ollama local).

**Segurança.** Uploads são conteúdo hostil. A política do system design anterior (§20 daquele documento) aplica-se integralmente desde o M1: limites de tamanho e entries de ZIP, path traversal, MIME por assinatura, sanitização de SVG (scripts, links externos), image bombs, hash SHA-256 em streaming, processamento em sandbox sem rede externa.

### 5.4 Brand IR — exemplo abreviado

```json
{
  "schemaVersion": "0.1.0",
  "brand": { "name": "Empresa X" },
  "revision": {
    "id": "brandrev_a1b2c3d4e5f6",
    "createdAt": "2026-07-11T12:00:00Z"
  },
  "colors": {
    "color.primary": {
      "value": "#1A4D8F",
      "evidence": [
        { "sourceType": "pdf-guideline", "path": "manual.pdf", "page": 12, "confidence": 0.92 },
        { "sourceType": "wizard-confirmation", "confidence": 1.0, "authoritative": true, "confirmedAt": "2026-07-11T12:00:00Z" }
      ]
    },
    "color.background": {
      "value": "#FFFFFF",
      "evidence": [
        { "sourceType": "wizard-confirmation", "confidence": 1.0, "authoritative": true, "confirmedAt": "2026-07-11T12:00:00Z" }
      ]
    },
    "color.text": {
      "value": "#1A1A1A",
      "evidence": [
        { "sourceType": "wizard-confirmation", "confidence": 1.0, "authoritative": true, "confirmedAt": "2026-07-11T12:00:00Z" }
      ]
    }
  },
  "fonts": {
    "font.heading": {
      "family": "Archivo",
      "weight": 700,
      "style": "normal",
      "source": "file",
      "fileSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "evidence": [
        { "sourceType": "font-file", "path": "fonts/archivo-bold.ttf", "confidence": 1.0 },
        { "sourceType": "wizard-confirmation", "confidence": 1.0, "authoritative": true, "confirmedAt": "2026-07-11T12:00:00Z" }
      ]
    },
    "font.body": {
      "family": "Inter",
      "weight": 400,
      "style": "normal",
      "source": "referenced-only",
      "fileSha256": null,
      "evidence": [
        { "sourceType": "wizard-confirmation", "confidence": 1.0, "authoritative": true, "confirmedAt": "2026-07-11T12:00:00Z" }
      ]
    }
  },
  "roles": {
    "heading": { "font": "font.heading", "color": "color.primary", "minSizePx": 40, "maxSizePx": 96, "lineHeight": 1.1 },
    "body": { "font": "font.body", "color": "color.text", "minSizePx": 16, "maxSizePx": 24, "lineHeight": 1.5 },
    "caption": { "font": "font.body", "color": "color.text", "minSizePx": 12, "maxSizePx": 16, "lineHeight": 1.4 }
  },
  "assets": {
    "logo.primary": {
      "path": "assets/logos/primary.svg",
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "format": "svg",
      "evidence": [
        { "sourceType": "svg-asset", "path": "assets/logos/primary.svg", "confidence": 0.95 },
        { "sourceType": "wizard-confirmation", "confidence": 1.0, "authoritative": true, "confirmedAt": "2026-07-11T12:00:00Z" }
      ],
      "minWidthPx": 96,
      "clearSpaceRatio": 0.25
    }
  },
  "formatProfiles": ["post-1x1", "post-4x5", "story-9x16", "doc-a4"],
  "diagnostics": [
    {
      "code": "FONT_FILE_MISSING",
      "target": "font.body",
      "message": "A fonte «Inter» foi confirmada, mas o arquivo dela não veio no pacote.",
      "resolution": "render-fallback"
    }
  ]
}
```

### 5.5 Template Kit Generator

Brand IR → kit inicial de Layout Specs por perfil de formato: post 1:1, post 4:5, story 9:16, documento A4. Princípio herdado do roadmap anterior: mudar de proporção é **adaptação de layout, não resize** — cada perfil tem composição própria, com o mesmo conteúdo recomposto.

Um Layout Spec, abreviado:

```json
{
  "id": "post-quote-1x1",
  "profile": "post-1x1",
  "slots": [
    { "id": "quote", "kind": "text", "role": "heading", "maxChars": 140, "fit": "shrink-within-role-range" },
    { "id": "author", "kind": "text", "role": "caption", "required": false },
    { "id": "photo", "kind": "image", "treatment": "cover", "minResolution": [1080, 1080] },
    { "id": "logo", "kind": "logo", "variant": "auto-contrast", "position": "locked" }
  ]
}
```

**Este é o componente da aposta técnica central do M1** — ver risco R2.

### 5.6 Slot Editor

O que o leigo faz: escolhe um layout do kit; troca texto; troca imagem; alterna entre variações pré-aprovadas (ex.: versão clara/escura). O que ele nunca vê: hex, px, nomes de fonte, JSON, a palavra "token". Preview ao vivo renderizado pela mesma biblioteca do export.

### 5.7 Render

Uma única biblioteca TypeScript transforma (Brand IR + Layout Spec + Content Spec) → DOM. O preview do editor e o export usam **o mesmo código**: no export, Chromium headless (Playwright) carrega a mesma página de render e produz PNG (posts) ou PDF (documentos, via print CSS). WYSIWYG por construção — a divergência preview×arquivo deixa de ser uma classe de bug possível.

Determinismo (NFR herdado): mesmas entradas + mesma versão do renderer → mesmo resultado; fontes servidas localmente pelo worker; teste de igualdade de pixels no CI.

### 5.8 Brand Guard

No mundo de slots, a maior parte das violações do linter anterior é **estruturalmente impossível**: fonte, cor, posição de logo, margem e hierarquia não são editáveis fora dos trilhos. O que resta é conteúdo:

- **Overflow de texto** — política herdada e adaptada: tamanho ideal → reduzir dentro da faixa do papel → ajustar espaçamento na faixa permitida → **bloquear com mensagem clara e ação sugerida**. Nunca truncar silenciosamente.
- **Contraste texto × imagem** — medir; aplicar scrim/variação aprovada da marca automaticamente, ou pedir outra imagem.
- **Resolução mínima de imagem** — bloquear abaixo do limiar do perfil.
- **Área segura** — garantida por construção nos layouts; checada no conteúdo que pode vazar.

Tudo determinístico e auditável, com mensagens em linguagem de gente e ação de
correção clara. No motor concluído do Plano 1, o Guard estático emite `pass` ou
`blocked`; `fixed` permanece no contrato compartilhado, mas nenhuma correção é
aplicada silenciosamente. Overflow medido, fallback de fonte e contraste sobre
imagem precisam ser integrados ao verdict nos Planos 2 e 3. Severidades formais
(`info`/`warning`/`error`/`locked`) só entram no M3, onde há edição livre para
justificá-las.

### 5.9 Plataforma

Modular monolith + worker (decisão herdada — microserviços continuam
explicitamente adiados). API FastAPI; jobs de export em tabela persistida no
PostgreSQL; JSONB para IR/specs; assets em filesystem endereçado por conteúdo
no M1 (SHA-256, deduplicado), com adapter S3-compatible reservado para evolução;
revisões imutáveis em tudo (marca, kit, documento). Logs estruturados com
correlation ID continuam pendentes da camada de plataforma.

Auth do M1: token de convite, single-tenant por instância e N marcas por
instância. O M1 não materializa workspaces nem multi-tenant; essa fronteira fica
reservada para o M4. A UI não expõe uma tela de login: fala apenas por paths
same-origin, e o proxy controlado da instância injeta o header
`Authorization: Bearer <token>`. Tokens em query string são recusados para não
vazar em histórico ou logs. A porta web é, conscientemente, a superfície
confiável da instância no M1.

---

## 6. Marcos

### M1 — "A marca instalada"

**Estado em 12/07/2026:** o motor arquivo→arquivo do Plano 1 está concluído
(intake, confirmação, Brand IR, kit, Guard, CLI e schemas). Render/export, API,
app web, Docker Compose e E2E permanecem pendentes nos Planos 2–4; portanto o
M1 ainda não está concluído.

**Walking skeleton** (disciplina herdada do roadmap anterior — nada de expansão antes deste roteiro funcionar de ponta a ponta):

1. instalar uma marca a partir de pacote informal (PDF + logos + fontes) via wizard;
2. confirmar os valores extraídos; publicar Brand IR como revisão imutável;
3. gerar o kit (post 1:1, 4:5, story 9:16, documento A4);
4. um leigo preenche um post e um documento simples por slots;
5. o guard intercepta uma violação semeada (texto longo demais; foto de baixa resolução) e oferece correção;
6. exportar PNG idêntico ao preview;
7. exportar PDF do documento.

**Critérios de aceite:**

- wizard completo **sem** LLM configurado;
- todo valor do Brand IR tem evidência ou confirmação — nada inventado silenciosamente;
- instância sobe com `docker compose up`;
- export = preview (igualdade de pixels, tolerância zero na mesma plataforma);
- kit gerado é distinguível de template genérico — validado com pelo menos 3 marcas reais (a primeira: a do próprio autor);
- violações semeadas nos fixtures são todas interceptadas (mutation tests do guard — disciplina herdada).

### M2 — "Arquivos nativos"

PPTX e DOCX editáveis gerados do mesmo Brand IR + Content Spec, estratégia **template-fill**: o tema OOXML da marca é derivado do IR uma vez; documentos derivam dele. Nada de gerar pacote OOXML inteiro do zero.

- Os requisitos de natividade do system design anterior (§3.4 daquele documento) viram critérios de aceite aqui, na íntegra: texto é texto, imagens substituíveis, masters/layouts preservados, estilos semânticos, abre sem reparo, sobrevive a save do PowerPoint real.
- Suíte de regressão estrutural **desde o primeiro dia do marco**: golden tests de OOXML canonicalizado, matriz de editores (PowerPoint desktop obrigatório; LibreOffice/ONLYOFFICE como compatibilidade), regressão visual — tudo herdado do §21 do system design.
- Os spikes A/B/C do roadmap anterior (clonar layout, round-trip, preview) rodam **no início do M2, em Python**, como gate go/no-go da mecânica OOXML.

### M3 — "Usuário marketing"

Round-trip completo: upload de arquivo editado fora → parser → Document Graph → linter com severidades (info/warning/error/locked) → fix plan aplicado em cópia → relint → nova revisão. O design de parser/linter/fixer do system design anterior aplica-se aqui, com o motor em Python. Editor embutido via adapter ONLYOFFICE/Collabora atrás de interface estável (o core nunca depende do editor — herdado). Waivers com justificativa e validade.

### M4 — "Ecossistema"

Importador Figma (quando o acesso à API for viável), adapters comunitários de importação, biblioteca pública de kits, instância pública multi-tenant, add-in PowerPoint (avaliar custo/benefício na época).

---

## 7. Stack

| Camada | Escolha | Justificativa |
|---|---|---|
| Núcleo / API | Python 3.12+, FastAPI, Pydantic v2 | intake e regras são extração + orquestração — campo forte do Python; Pydantic exporta o JSON Schema do IR de graça |
| Extração | PyMuPDF, Pillow, fontTools, defusedxml | PDF, imagem, fonte e SVG seguro no motor do M1; PyMuPDF (AGPL) é compatível com a licença escolhida |
| Frontend | TypeScript, React, Vite | React foi fixado para o wizard, slot editor e integração com a biblioteca de render |
| Render/export | biblioteca TS única + Playwright/Chromium headless | preview e export do mesmo código — WYSIWYG por construção |
| OOXML (M2) | python-pptx, python-docx, lxml; LibreOffice headless em sandbox | template-fill + cirurgia XML; conversões e previews isolados |
| Dados | PostgreSQL (JSONB), filesystem content-addressed no M1 | storage por SHA-256; adapter S3-compatible pode entrar sem alterar os contratos |
| Fila | tabela de jobs no PostgreSQL | escolha mínima do M1, com status `queued|running|succeeded|failed` e worker por polling |
| LLM | abstração própria, provedores plugáveis (Anthropic/OpenAI/Ollama) | sempre opcional; nunca no caminho crítico nem na decisão de conformidade |
| Observabilidade | logs estruturados com correlationId | OpenTelemetry quando a plataforma justificar |

**Trade-off registrado (a mudança em relação à "stack fixada" anterior).** O design anterior fixava C# + Open XML SDK — a escolha certa para um produto OOXML-first. A persona leigo-first moveu o OOXML para o M2 e transformou o M1 em extração + orquestração + web, campo do Python/TS. Além disso, o desenvolvedor principal domina Python e não .NET — custo de aprendizado é custo de projeto. Permanece verdade que `python-pptx` é mais fraco que o Open XML SDK para masters/layouts profundos; mitigações: (a) OOXML só no M2, atrás de gate com spikes; (b) template-fill + `lxml` em vez de geração do zero; (c) renderizadores isolados atrás do IR — se os spikes do M2 provarem insuficiência do Python, um serviço OOXML dedicado (inclusive em C#) entra como adapter sem reescrever o resto do sistema.

---

## 8. Licenciamento e distribuição

- **Aplicação e motor: AGPL-3.0.** Quem oferecer o sistema como serviço é obrigado a publicar modificações — proteção contra fork SaaS fechado.
- **Schemas públicos do motor, exemplos e SDKs: MIT.** Os formatos devem poder
  ser adotados por qualquer ferramenta, inclusive fechada — o ecossistema de
  adapters depende disso. Apache-2.0 permanece como alternativa com patent
  grant; a decisão final depende de revisão jurídica antes da publicação.
- **Documentação e spec: CC BY 4.0.**
- **Fontes:** nunca redistribuídas pelo repositório nem pela instância sem licença registrada. O intake classifica cada fonte (instalada / hospedada / embutível / apenas referenciada / fallback) e toda substituição é sinalizada — nunca silenciosa.
- **Distribuição M1:** `docker compose up`, single-tenant por instância, auth por convite. Instância pública multi-tenant só no M4.

---

## 9. Riscos

| # | Risco | Mitigação |
|---|---|---|
| R1 | Extração de PDF de manual varia brutalmente | confirmação humana obrigatória; extração é sugestão com evidência; corpus de manuais reais como fixtures desde o M1; medir taxa de acerto |
| R2 | **Layout Spec é a aposta central**: pobre = kit genérico (fracasso de produto); rico demais = motor de layout completo (fracasso de escopo) | calibrar com marcas reais; critério de aceite: kit distinguível de template de banco; evoluir o schema por necessidade demonstrada, nunca especulativamente |
| R3 | Fontes sem arquivo ou sem licença clara | política de fontes no intake; fallback declarado e confirmado; registro no IR |
| R4 | Leigo 100% sozinho não existe até haver instância pública | M1 assume instalador presente; instância pública é M4, decisão consciente |
| R5 | Canva como incumbente do público leigo | competir em enforcement, posse dos dados e arquivos nativos — nunca em amplitude criativa |
| R6 | Fidelidade OOXML no M2 | spikes go/no-go no início do M2; golden tests; matriz de editores; escape hatch de serviço dedicado |
| R7 | Divergência preview × export | eliminada por construção (mesma biblioteca de render); teste de igualdade de pixels no CI |
| R8 | Escopo escorregar para editor completo | non-goals explícitos (§4); slots até que uma persona real exija mais |

---

## 10. Decisões abertas

- **Nome do projeto** — dono: Patric. Até lá, `brand-runtime`.
- **PDF paginado** — começar com Chromium print; revisitar WeasyPrint quando documentos exigirem cabeçalho corrido/numeração séria.
- **MIT vs Apache-2.0 para o schema** — revisão antes da publicação do repo.
- **README em inglês** — decidir o momento da tradução; UI e documentação de
  trabalho do M1 já estão fixadas em PT-BR pela ADR 0007.

---

## 11. Destino dos documentos anteriores

| Documento | Destino |
|---|---|
| Pesquisa de mercado (deep research) | Base do posicionamento (§4). Lacunas identificadas em revisão — Marq, Gamma, ecossistema Google — já incorporadas à análise. |
| `brand-compiler-projeto (1).md` | Tese, pacote de marca e Brand IR absorvidos (§1, §5). MVP de apresentações e round-trip-como-MVP-2 **substituídos** pelos marcos do §6. Stack C# substituída (§7). |
| `brand-compiler-system-design.md` | **Continua sendo a referência de engenharia para M2/M3**: parser/linter/fixer, Document Graph, segurança de uploads e OOXML, modelo de domínio, testes (golden, mutation, matriz de editores), API. Stack trocada para Python; walking skeleton OOXML movido para a abertura do M2. Suas seções de provenance, imutabilidade, jobs e segurança valem **desde o M1**. |
| `brand-compiler-roadmap.md` | Substituído como plano. A disciplina — gates go/no-go, spikes antes de produto, fixtures-first, definition of done, lista "o que não fazer" — é reaproveitada no plano de implementação do M1 e na abertura do M2. |
