# App web do brand-runtime

Wizard de instalação, kit, editor por camadas, Modo Carrossel e aplicação de
marca em Word. A instância oficial online usa Synapsis no chrome; instalações
open source locais usam Archivo e não recebem a fonte proprietária.

```powershell
cd apps/web
npm ci
npm run dev
npm test
npm run typecheck
npm run build
```

O Vite encaminha `/v1` para a API local e injeta o convite `dev-token` apenas
no ambiente de desenvolvimento. Em produção, essa responsabilidade pertence ao
proxy nginx da stack Docker.

## Fluxos principais

Alertas criativos aparecem como **Orientações da marca** e nunca desabilitam a
exportação. A pessoa pode voltar ao campo sugerido ou baixar a peça como está.

O editor aceita sangria real: logo, texto e imagem podem ter coordenadas
negativas ou dimensões maiores que o canvas, por arraste, redimensionamento ou
campos numéricos. A borda do canvas representa o corte final, não uma barreira
de criação. O painel **Direção da marca** usa a identidade confirmada para
propor estrutura, contraste de escala, espaço vazio e superfície procedural.
Se o sinal semântico for fraco, não apresenta um preset universal disfarçado de
sugestão personalizada.

O painel de texturas mostra quatro sugestões explicadas quando existe direção
confirmada e mantém as 20 opções acessíveis por família. Escolher fora da
recomendação não gera bloqueio. Todos os padrões são locais, procedurais e
preservados nas exportações compatíveis.

Kit e Carrossel aplicam a mesma regra ao catálogo de composições: mostram oito
sugestões explicadas pela direção confirmada e deixam o catálogo completo a um
clique. Sem direção suficiente, a interface assume explicitamente uma seleção
exploratória em vez de fingir personalização.

- `/marcas/{revisionId}/carrossel`: cria sequências de 3 a 20 slides, organiza
  capa, conteúdo e fechamento, reabre carrosséis salvos e leva cada slide ao
  editor completo sem quebrar a continuidade.
- `/marcas/{revisionId}/word`: separa upload, plano e aplicação em três etapas;
  o download só aparece depois da prova de preservação do worker.

Ambos os fluxos usam labels visíveis, feedback assíncrono anunciado, alvo mínimo
para toque, foco visível e uma ação primária por etapa. Opções avançadas ficam
fora do caminho inicial.

## Direção visual

O chrome do Molda é editorial, estruturado por formas Bauhaus e dominado por
Papel (`#F2EFE7`) e Grafite (`#202025`). Âmbar (`#C05518`) aparece apenas em
pontos de atenção, seleção e ação. Ele não herda cores da revisão ativa: a
matéria da marca aparece nas provas, amostras, canvas e arquivos exportados.
Synapsis cria a voz da instância oficial online; Archivo preserva legibilidade e
estrutura nas instalações open source locais; a fonte monoespaçada fica
restrita a medidas e valores.

A especificação vigente está em
[`docs/design/2026-07-23-oficina-bauhaus-editorial.md`](../../docs/design/2026-07-23-oficina-bauhaus-editorial.md).
A matriz de breakpoints, interações e gates inspecionados está em
[`docs/design/2026-07-19-validacao-visual.md`](../../docs/design/2026-07-19-validacao-visual.md).

## Edição open source e edição oficial

As duas edições compartilham o mesmo núcleo. A diferença está nos ativos de
identidade e na operação:

- a distribuição open source não contém a Synapsis e funciona sem requisições
  quebradas, usando Archivo;
- somente o deploy da instância oficial online operada pelo Digital Artisan
  recebe os WOFF2 proprietários, ativa a família com
  `VITE_SYNAPSIS_FONT_BASE_URL` e restringe seu carregamento à própria origem;
- instalações independentes podem manter Archivo ou fornecer sua própria
  tipografia sem alterar o núcleo do produto.

Para uma publicação oficial com os arquivos em `public/fonts/synapsis`, use:

```dotenv
VITE_SYNAPSIS_FONT_BASE_URL=/fonts/synapsis
```

Uma URL de CDN também é aceita no deploy oficial, desde que permita o
carregamento apenas pela instância online do Digital Artisan. Os WOFF2 e a marca
Synapsis não fazem parte da licença open source do código. Seu uso é exclusivo
nessa instância oficial:
Copyright © 2026 Digital Artisan. Todos os direitos reservados.

## E2E

O roteiro E2E atravessa o sistema real: intake, confirmação da marca, kit,
guard e exportação PNG/PDF/PPTX/DOCX. Ele gera todas as fixtures em tempo de
execução e reabre os arquivos editáveis para verificar texto, imagem e estilos
nativos.

```powershell
# na raiz do repositório
$env:BRANDRT_DB_PASSWORD = "troque-por-uma-senha-local-segura"
docker compose up -d --build

# uma vez, em apps/web
npx playwright install chromium

# a cada validação, em apps/web
npm run e2e
```

O ambiente virtual de `packages/engine` precisa existir. Se estiver em outro
local, defina `ENGINE_PYTHON` com o caminho do executável Python.
