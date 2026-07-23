# Oficina Bauhaus Editorial

Data: 2026-07-23
Status: direção implementada e em validação
Escopo: instalação, kit, editor, carrossel, Word e chrome do produto

## Intenção

O Molda é um ambiente de criação orientado por uma identidade existente. Sua
interface precisa comunicar precisão, autoria e continuidade entre ler uma
marca, escolher uma composição e produzir um arquivo. Ela não deve parecer uma
landing page, um dashboard de métricas ou uma cópia de ferramentas criativas
conhecidas.

A direção usa o vocabulário construtivo da Bauhaus — grade, círculo, plano,
regra e assimetria — como estrutura funcional. Nenhuma forma entra apenas para
decorar:

- círculo indica estado, foco ou ponto de decisão;
- quadrado indica módulo, peça ou unidade editável;
- regra conecta etapas e cria alinhamento;
- plano grafite ancora uma área ou ação;
- âmbar identifica o que está ativo.

## Referência e autoria

[fonts.xyz](https://www.fonts.xyz/) foi estudado como referência de qualidade de
experiência, não como fonte de aparência. O princípio absorvido é aproximar
conteúdo e controle: a pessoa vê a marca em uso enquanto decide. Cores,
componentes, navegação, proporções e movimento do Molda são próprios.

## Sistema visual

### Paleta

| Papel | Hex | Papel no sistema |
| --- | --- | --- |
| Papel | `#F2EFE7` | canvas, superfícies e respiro |
| Grafite | `#202025` | texto, regras fortes e planos de ancoragem |
| Âmbar | `#C05518` | seleção, foco, índice e manipulação |

Grafite sobre Papel mede `14,12:1`. Âmbar sobre Papel mede `4,01:1`; por isso,
Âmbar não é usado para texto pequeno nem como preenchimento dominante de
botões. A ação principal usa Grafite e Papel, com um marcador Âmbar separado.

### Tipografia

Synapsis é a voz principal:

- 400: corpo e controles;
- 500: introduções e instruções;
- 600: hierarquia funcional;
- 700: títulos de painel;
- 900: títulos de tela e índices de grande escala.

A distribuição open source usa Archivo Variable e não procura uma instalação
local da Synapsis. Ela não contém nem solicita arquivos proprietários.

Somente a instância oficial online operada pelo Digital Artisan injeta cinco
WOFF2 privados — pesos 400, 500, 600, 700 e 900 — por meio de
`VITE_SYNAPSIS_FONT_BASE_URL`. Os arquivos preservam os 683 glifos de cada TTF
original; nenhum caractere é removido. Os binários ficam fora do Git e têm uso
exclusivo nessa instância. Seus metadados registram copyright, licença restrita
de incorporação e proibição de subsetting. A transferência técnica ao navegador
não concede licença para uso separado.

Nenhum arquivo proprietário da Adobe Creative Cloud é copiado para o
repositório. Uma família Adobe, se adotada, deve ser publicada por Adobe Fonts
Web Project.

### Grade e medidas

- grade principal: 12 colunas;
- espaçamento-base: 8 px;
- regras: 1 px;
- cantos: 0–2 px;
- alvo de toque: mínimo de 44 px;
- títulos: escala fluida entre aproximadamente 52 e 180 px;
- metadados: nunca abaixo de 12 px.

## Arquitetura das telas

### Instalação

O título é a primeira orientação e ocupa no máximo duas linhas em desktop. A
bancada usa `8 + 4` colunas: upload à esquerda, evidências à direita. A área de
arquivos apresenta um alvo grande e direto; o acordeão explica como cada
evidência será usada sem interromper a tarefa.

### Kit

O cabeçalho usa `7 + 5` colunas. A síntese da marca e os acessos a Carrossel e
Word formam um único início de jornada. As provas dominam o catálogo; nome,
dimensão e motivo da recomendação pertencem à mesma unidade editorial.

### Editor

O editor permanece um ambiente de trabalho claro:

- Camadas à esquerda;
- prova ao centro;
- propriedades à direita;
- toolbar superior;
- conferência e exportação no trecho final.

A camada inicial continua selecionada no primeiro render. Manipulação direta
por mouse ou toque é primária; teclado e controles numéricos permanecem como
alternativas acessíveis. Alças, contorno e estado ativo usam Âmbar.

### Carrossel e Word

Campos, etapas e contratos existentes são preservados. Regras e círculos de
estado tornam a sequência visível. Nenhuma etapa recebe numeração apenas
ornamental.

## Movimento

GSAP é aprimoramento progressivo:

- entrada curta para mudanças de rota;
- cabeçalho do kit fixado somente em desktop e apenas durante o catálogo;
- provas ganham presença conforme entram na leitura;
- títulos secundários ganham presença por deslocamento e opacidade ligados à
  rolagem;
- `prefers-reduced-motion` remove pinning, scrub e transições.

Conteúdo, navegação e ações nunca dependem da animação.

## Critérios de validação

- rotas e nomes de campos preservados;
- ordem de leitura do editor preservada;
- camada selecionada no primeiro render;
- ausência de overflow horizontal a partir de 320 px;
- foco visível em todos os controles;
- contraste de texto compatível com WCAG AA;
- alvos interativos de pelo menos 44 px onde a densidade permitir;
- build, testes unitários e E2E verdes;
- inspeção visual de instalação, kit e editor em desktop e mobile;
- movimento reduzido verificado por preferência do sistema.
