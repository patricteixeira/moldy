# ADR 0010 — Gramática de composição editorial como contrato

**Status:** aceito (13/07/2026)

## Contexto

Cor, fonte e logo corretas ainda podem produzir uma peça genérica. Manuais de
marca também prescrevem relações: modos claro e escuro, proporção cromática,
posição do símbolo, grafismos derivados, tratamento de números, hierarquia e
limites para o acento. O Brand IR 0.2 preservava os ingredientes, mas não essa
gramática; por isso o Kit Generator repetia a mesma geometria para qualquer
marca.

O material real da Digital Artisan demonstrou o limite com declarações
explícitas de fundo positivo/negativo, proporção 60/30/10, âmbar abaixo de 10%,
padrão diagonal, numeração com zero à esquerda e duas versões do mesmo símbolo.
As peças de referência aplicam essas regras em um arquétipo editorial 4:5.

## Decisão

- O Brand IR 0.3 adiciona `compositionRules`. Versões 0.1 e 0.2 continuam
  legíveis, mas não podem carregar esse campo.
- Uma regra só é compilada quando existe declaração textual explícita no
  manual. A aparência incidental da página não se torna regra.
- Modos `light` e `dark` referenciam tokens de fundo, primeiro plano e aliases
  de logo. Os aliases `logo.onLight` e `logo.onDark` apontam para SVGs reais do
  pacote; o sistema nunca recolore ou redesenha o símbolo.
- O Layout Spec recebe primitivas fechadas: retângulo, círculo, padrão de linhas
  diagonais e asset da marca. Camadas são travadas, possuem geometria e ordem
  determinísticas e não aceitam CSS livre.
- Slots de texto podem declarar alinhamento, tracking, caixa, contorno,
  zero-padding e uma cor de ênfase. O conteúdo fornece apenas o trecho literal
  a destacar; o usuário não escolhe tokens nem coordenadas.
- O kit adiciona as provas `editorial-light-post-4x5` e
  `editorial-dark-post-4x5` somente quando modos, proporções cromáticas, acento,
  motivo, numeração e as duas versões de logo estão completos e cabem na
  geometria prevista. Os dez layouts canônicos permanecem.
- O Brand Guard valida referências, contraste por tamanho, vínculo inequívoco
  do destaque, tamanho mínimo da logo e uma estimativa geométrica calibrada
  pela cobertura tipográfica para o limite de acento. Preview e export
  continuam usando o mesmo renderer.
- Como a revisão persiste IR e kit em um bundle imutável, o domínio de sua
  identidade é versionado. Uma mudança semântica no gerador cria uma nova
  revisão em vez de devolver silenciosamente um kit antigo já persistido.

## Consequências

O usuário escolhe uma prova clara ou escura e edita somente frase de apoio,
frase principal, trecho em destaque, número e assinatura. Moldura, padrão,
logo, hierarquia e proporção permanecem coerentes com o design system por
construção.

O contrato deliberadamente não é um canvas genérico. Novos motivos e
arquétipos exigem vocabulário tipado, evidência e testes. Capa, fechamento e a
sequência completa de carrossel ficam para uma evolução posterior sobre a mesma
base, sem codificar uma marca específica no renderer.
