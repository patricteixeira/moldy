# ADR 0017 — Tradução local e não destrutiva do manual

**Status:** aceito (20/07/2026)

## Contexto

Manuais de marca frequentemente chegam em inglês, enquanto a interface do
Molda e sua pessoa usuária trabalham em PT-BR. Obrigar alguém leigo a interpretar
esses trechos reduz a utilidade do intake. Uma API comercial criaria custo
recorrente, credenciais e envio de materiais da marca a terceiros.

## Decisão

- A API detecta localmente se a leitura de identidade possui evidência lexical
  suficiente de inglês. Texto em PT-BR ou de idioma incerto não é alterado.
- Inglês é traduzido por um modelo OPUS-MT inglês → português do Brasil,
  executado com CTranslate2 e SentencePiece dentro da imagem da API.
- O pacote do modelo é baixado somente durante o build, por URL e SHA-256
  fixados. A API em execução permanece sem egress e sem chave.
- A tradução é armazenada no draft; o texto original também é preservado e
  pode ser conferido no wizard.
- Falha ou ausência do modelo não impede o import. O original permanece
  editável e recebe estado explícito de tradução indisponível.
- As dependências de tradução são opcionais no pacote Python e instaladas apenas
  na imagem da API; worker e motor continuam sem esse peso.

## Consequências

Não existe cobrança por uso nem conta externa. O custo operacional é cerca de
82 MiB adicionais na imagem descompactada e CPU local no primeiro uso de cada
trecho; uma cache de processo evita repetir traduções iguais. A qualidade do
modelo não substitui a revisão humana, por isso os campos continuam editáveis e
o original nunca é descartado.

O modelo deriva do OPUS-MT sob CC BY 4.0. A atribuição e o checksum estão em
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).
