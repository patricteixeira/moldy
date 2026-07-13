# Padrões de Engenharia

> Guia de práticas de engenharia e segurança adotadas neste projeto.
> Vale para qualquer linguagem ou stack. O objetivo é que qualquer pessoa
> (ou agente) consiga entender, contribuir e manter o código com qualidade
> e consistência.

---

## Sumário

1. [Princípios gerais](#1-princípios-gerais)
2. [Estrutura do projeto](#2-estrutura-do-projeto)
3. [Arquitetura e separação de camadas](#3-arquitetura-e-separação-de-camadas)
4. [Nomenclatura](#4-nomenclatura)
5. [Qualidade de código](#5-qualidade-de-código)
6. [Tratamento de erros](#6-tratamento-de-erros)
7. [Documentação](#7-documentação)
8. [Testes](#8-testes)
9. [Controle de versão](#9-controle-de-versão)
10. [Segurança](#10-segurança)
11. [Configuração e ambientes](#11-configuração-e-ambientes)
12. [Observabilidade](#12-observabilidade)
13. [Dependências](#13-dependências)
14. [CI/CD e automação](#14-cicd-e-automação)
15. [Revisão de código (checklist de PR)](#15-revisão-de-código-checklist-de-pr)
16. [Definição de pronto (Definition of Done)](#16-definição-de-pronto-definition-of-done)

---

## 1. Princípios gerais

Estas são as regras que orientam todas as decisões abaixo:

- **Legibilidade acima de esperteza.** Código é lido muito mais vezes do que é escrito. Prefira o óbvio ao engenhoso.
- **KISS** — mantenha simples. A solução mais simples que resolve o problema é quase sempre a melhor.
- **YAGNI** — não construa o que ainda não é necessário. Evite abstrações e generalizações "para o futuro".
- **DRY** — não repita conhecimento. Mas duplicação é melhor do que a abstração errada; só abstraia quando o padrão estiver claro.
- **Separação de responsabilidades.** Cada módulo, classe ou função deve ter um motivo único para mudar.
- **Falhe cedo e de forma explícita.** Valide o quanto antes e deixe erros visíveis em vez de silenciá-los.
- **Consistência.** Um padrão razoável seguido por todos vale mais do que o padrão "perfeito" seguido por ninguém.

---

## 2. Estrutura do projeto

Todo projeto deve ter, na raiz, no mínimo:

- `README.md` — visão geral, como rodar, como testar, como contribuir.
- `.gitignore` — nunca versionar artefatos de build, dependências ou segredos.
- `.env.example` — modelo das variáveis de ambiente necessárias (sem valores reais).
- Arquivo de dependências travado (`package-lock.json`, `poetry.lock`, `go.sum`, etc.).
- Configuração de lint e formatação versionada.
- `LICENSE` quando aplicável.
- `CHANGELOG.md` para projetos com versionamento público.

**Organize por domínio/funcionalidade, não por tipo técnico.** Prefira agrupar tudo que pertence a uma feature junto, em vez de separar em pastas genéricas como `controllers/`, `services/`, `models/` no topo do projeto.

```
# Preferível (por domínio)          # Evitar em projetos maiores (por tipo)
src/                                 src/
├── pagamentos/                      ├── controllers/
│   ├── pagamento.service            ├── services/
│   ├── pagamento.repository         ├── repositories/
│   └── pagamento.test               └── models/
├── usuarios/
│   ├── usuario.service
│   └── usuario.repository
└── shared/
```

Regra prática: se para entender uma feature você precisa abrir cinco pastas diferentes, a organização está errada.

---

## 3. Arquitetura e separação de camadas

Separe o código em camadas com responsabilidades distintas e **dependências apontando sempre para dentro** (do detalhe para a regra de negócio):

| Camada | Responsabilidade | Não deve conhecer |
|---|---|---|
| **Apresentação / Interface** | Entrada e saída: HTTP, CLI, UI, filas. Traduz requisições em chamadas de negócio. | Detalhes de banco de dados |
| **Aplicação / Casos de uso** | Orquestra o fluxo de uma operação. Coordena regras e chamadas externas. | Framework web, SQL específico |
| **Domínio / Negócio** | Regras e entidades centrais do sistema. O coração da aplicação. | Qualquer detalhe de infraestrutura |
| **Infraestrutura** | Banco de dados, APIs externas, filas, e-mail, sistema de arquivos. | Regras de negócio |

Princípios que sustentam isso:

- **A regra de negócio não depende de framework, banco ou biblioteca.** Você deveria conseguir trocar o banco ou o framework web sem reescrever o domínio.
- **Dependa de abstrações, não de implementações** (Inversão de Dependência). A camada de negócio define uma interface (ex.: `RepositorioDePagamentos`); a infraestrutura a implementa.
- **Injete dependências** em vez de instanciá-las por dentro. Isso torna o código testável e desacoplado.
- **Não vaze detalhes entre camadas.** Um objeto de banco (ex.: modelo ORM) não deve chegar cru na camada de apresentação; converta para o formato apropriado (DTO / entidade de domínio).

### SOLID em uma frase cada

- **S** — Single Responsibility: cada classe tem uma única razão para mudar.
- **O** — Open/Closed: aberto para extensão, fechado para modificação.
- **L** — Liskov: subtipos devem funcionar onde o tipo base é esperado.
- **I** — Interface Segregation: prefira interfaces pequenas e específicas a uma interface "gorda".
- **D** — Dependency Inversion: dependa de abstrações, não de concretizações.

---

## 4. Nomenclatura

Nomes são a primeira forma de documentação. **Use a linguagem do domínio do projeto** — os mesmos termos que o time de negócio usa (Linguagem Ubíqua).

Regras gerais:

- Nomes **revelam intenção**: o que a coisa é ou faz, não como está implementada.
- **Sem abreviações obscuras.** `quantidade` em vez de `qtd`, `usuario` em vez de `usr`. Exceções apenas para convenções universais (`id`, `url`, `http`).
- **Pronunciável e pesquisável.** Se você não consegue falar o nome em voz alta numa conversa, troque.
- **Sem ruído nem redundância.** Evite `dadosDoUsuario`, `objetoPagamento`, `infoCliente`. O tipo já diz o resto.
- **Consistência de vocabulário.** Escolha um termo por conceito e use sempre o mesmo (`buscar` OU `obter` OU `recuperar`, não os três).

Convenções por tipo:

- **Classes / Tipos:** substantivos → `Pagamento`, `NotaFiscal`, `ProcessadorDePagamento`.
- **Funções / Métodos:** verbos → `calcularTotal()`, `enviarEmail()`, `validarCpf()`.
- **Booleanos:** perguntas → `estaAtivo`, `temPermissao`, `foiPago`.
- **Coleções:** plural → `usuarios`, `itensDoPedido`.
- **Constantes:** deixe claro que são fixas, seguindo a convenção da linguagem.

```
# Ruim                              # Bom
d = get(u, 2)                       diasAteVencimento = calcularPrazo(fatura, MESES_PADRAO)
def proc(x):                        def processarReembolso(pagamento):
lista1, lista2                      pedidosPendentes, pedidosConcluidos
flag = True                         pagamentoAprovado = True
```

Siga sempre a **convenção idiomática da linguagem** que estiver usando (`camelCase`, `snake_case`, `PascalCase` etc.). O importante é ser consistente com o ecossistema, não inventar um estilo próprio.

---

## 5. Qualidade de código

- **Funções pequenas e focadas.** Uma função deve fazer uma coisa. Se você precisa de "e" para descrever o que ela faz, provavelmente são duas funções.
- **Poucos parâmetros.** Muitos argumentos indicam que falta um objeto agrupando-os.
- **Evite aninhamento profundo.** Prefira retornar cedo (*early return*) a encadear vários `if` aninhados.
- **Sem números e strings mágicos.** Extraia para constantes nomeadas que expliquem o significado.
- **Comente o *porquê*, não o *o quê*.** O código já diz o que faz; o comentário explica a decisão, o contexto ou o motivo não óbvio.
- **Remova código morto.** Não deixe trechos comentados "por segurança" — o histórico do Git guarda isso.
- **Formatação automática.** Use um formatador (Prettier, Black, gofmt, etc.) e um linter. Estilo não deve ser assunto de revisão manual.
- **Imutabilidade quando possível.** Evite mutar estado compartilhado; reduz bugs difíceis de rastrear.

```
# Aninhamento profundo               # Early return
def desconto(p):                     def desconto(p):
    if p.ativo:                          if not p.ativo:
        if p.total > 100:                    return 0
            if p.vip:                        if p.total <= 100:
                return 0.2                       return 0
    return 0                             return 0.2 if p.vip else 0.1
```

---

## 6. Tratamento de erros

- **Nunca engula exceções silenciosamente.** Um `catch` vazio esconde bugs. Trate, relance com contexto, ou logue.
- **Falhe de forma explícita e com mensagem útil.** O erro deve dizer o que aconteceu e, idealmente, como corrigir.
- **Distinga erros esperados de inesperados.** Entrada inválida do usuário é fluxo normal (valide e responda); um estado impossível é um bug (deixe estourar).
- **Não use exceções para controle de fluxo normal.**
- **Libere recursos com segurança** (conexões, arquivos, locks), mesmo quando ocorre erro.
- **Valide entradas nas fronteiras** do sistema (API, formulários, mensagens de fila). Depois de validado, confie no dado internamente.

---

## 7. Documentação

Documentação é parte da entrega, não um extra opcional.

- **README** deve responder, no mínimo: o que é o projeto, pré-requisitos, como instalar, como rodar, como testar e como contribuir.
- **Documente decisões arquiteturais** (ADR — *Architecture Decision Record*): registre *por que* uma escolha técnica foi feita, as alternativas consideradas e as consequências. Um arquivo curto por decisão em `docs/adr/`.
- **APIs públicas documentadas** — endpoints, parâmetros, respostas e erros (ex.: OpenAPI/Swagger para HTTP).
- **Docstrings/comentários de API** em funções e classes públicas, explicando propósito, parâmetros e retorno.
- **Mantenha a documentação junto do código** e atualize-a no mesmo commit/PR da mudança. Documentação desatualizada é pior do que documentação inexistente.
- **CHANGELOG** para comunicar mudanças entre versões de forma legível para humanos.

---

## 8. Testes

- **Toda lógica de negócio tem teste.** Bugs corrigidos ganham um teste que os reproduz, para não voltarem.
- **Pirâmide de testes:** muitos testes unitários (rápidos, isolados), alguns de integração, poucos de ponta a ponta (lentos, caros).
- **Testes independentes e determinísticos.** Nada de depender de ordem de execução, data/hora real ou rede externa não mockada.
- **Nomes descritivos** que digam o cenário e o resultado esperado: `deveRejeitarPagamentoComSaldoInsuficiente`.
- **Padrão Arrange–Act–Assert** (preparar, agir, verificar) para clareza.
- **Teste comportamento, não implementação.** O teste não deve quebrar só porque você refatorou sem mudar o resultado.
- **Cobertura é um sinal, não uma meta.** 100% de cobertura de código ruim ainda é código ruim; foque em cobrir os caminhos que importam.

---

## 9. Controle de versão

- **Commits pequenos e atômicos.** Cada commit representa uma mudança lógica coerente que, sozinha, deixa o projeto em estado funcional.
- **Mensagens de commit no imperativo e descritivas.** Adote **Conventional Commits**:

  ```
  <tipo>(<escopo opcional>): <descrição curta no imperativo>

  <corpo opcional explicando o porquê>
  ```

  Tipos comuns: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`.

  ```
  feat(pagamentos): adiciona suporte a pagamento via Pix
  fix(auth): corrige expiração de token calculada em fuso errado
  ```

- **Nunca commite segredos.** Se um segredo vazou no histórico, considere-o comprometido: **rotacione-o** e remova do histórico.
- **Branches curtas e revisadas.** Trabalhe em branches de feature e integre via Pull Request.
- **A branch principal está sempre saudável.** Só entra código que passa nos testes e na revisão.
- **Não versione:** dependências, artefatos de build, arquivos de IDE, arquivos `.env` reais.

---

## 10. Segurança

Segurança é responsabilidade de todos e deve ser pensada desde o início, não no final.

**Segredos e credenciais**
- Nunca hardcode senhas, tokens ou chaves no código. Use variáveis de ambiente ou um cofre de segredos.
- `.env` reais ficam fora do versionamento; versione apenas o `.env.example`.
- Rotacione credenciais periodicamente e imediatamente após qualquer suspeita de vazamento.

**Entradas e dados**
- **Nunca confie em entrada externa.** Valide e sanitize tudo que vem de fora (usuário, API, arquivo, fila).
- **Previna injeções** (SQL, comandos, etc.) usando consultas parametrizadas / prepared statements — nunca concatene entrada em queries ou comandos.
- **Escape saídas** para evitar XSS e afins ao renderizar dados de terceiros.

**Autenticação e autorização**
- **Princípio do menor privilégio:** cada usuário, serviço e token tem apenas as permissões estritamente necessárias.
- Verifique autorização em **cada** operação sensível, no servidor — nunca confie em checagens só no cliente.
- Armazene senhas apenas com **hash forte e específico para senhas** (bcrypt, Argon2, scrypt), nunca em texto plano ou com hash simples.

**Transporte e armazenamento**
- **Criptografia em trânsito** (TLS/HTTPS) sempre.
- **Criptografia em repouso** para dados sensíveis.

**Operação segura**
- **Falhe de forma segura:** em caso de erro, negue acesso por padrão em vez de liberar.
- **Não exponha detalhes internos em erros** para o usuário final (stack traces, versões, estrutura interna). Logue o detalhe internamente e responda algo genérico.
- **Nunca logue dados sensíveis** (senhas, tokens, cartões, dados pessoais). Mascare ou omita.
- **Mantenha dependências atualizadas** e rode varredura de vulnerabilidades no pipeline.
- Aplique **rate limiting** e proteções contra abuso em endpoints públicos.
- Familiarize-se com o **OWASP Top 10** e revise o código com essas classes de falha em mente.

---

## 11. Configuração e ambientes

Siga os princípios do **12-Factor App** no que couber:

- **Configuração vem do ambiente**, não do código. O mesmo artefato roda em dev, staging e produção mudando só a configuração.
- **Separe config de código.** Nada específico de ambiente (URLs, credenciais, flags) fica hardcoded.
- **Um `.env.example`** documenta todas as variáveis necessárias, com valores fictícios/explicativos.
- **Valide a configuração na inicialização.** Se falta uma variável obrigatória, a aplicação deve falhar imediatamente com uma mensagem clara, não em runtime aleatório.
- **Paridade entre ambientes.** Dev, staging e produção devem ser o mais parecidos possível para evitar surpresas.

---

## 12. Observabilidade

Sistemas em produção precisam ser observáveis para serem operáveis.

- **Logs estruturados** (idealmente em formato como JSON) com nível apropriado (`debug`, `info`, `warn`, `error`) e contexto útil (id de requisição, id de usuário — sem dados sensíveis).
- **Log tem propósito.** Registre o que ajuda a diagnosticar; evite ruído que esconde o que importa.
- **Correlação de requisições** (trace/correlation id) para acompanhar uma operação através dos serviços.
- **Métricas** de saúde e desempenho (latência, taxa de erro, throughput).
- **Rastreamento de erros** enviado para uma ferramenta de monitoramento, não apenas para o log.
- **Health checks** para orquestradores saberem se a aplicação está viva e pronta.

---

## 13. Dependências

- **Adicione dependências com critério.** Cada uma é código de terceiro que você passa a manter, atualizar e auditar por segurança.
- **Prefira a biblioteca padrão** quando ela resolve bem o problema.
- **Trave versões** com um lockfile versionado para builds reprodutíveis.
- **Mantenha atualizado**, de forma incremental e testada; não deixe acumular anos de dívida.
- **Automatize a auditoria de vulnerabilidades** das dependências no CI.
- Verifique **licença e manutenção ativa** antes de adotar algo novo.

---

## 14. CI/CD e automação

O que pode ser automatizado e verificado por máquina, deve ser.

- **Pipeline de CI** roda em todo push/PR: lint, formatação, testes e build.
- **A regra é objetiva:** não integra código que quebra o pipeline.
- **Automatize verificações de qualidade e segurança:** linter, testes, análise estática, varredura de dependências e de segredos.
- **Builds reprodutíveis:** o mesmo commit gera sempre o mesmo artefato.
- **Deploy automatizado e reversível.** Prefira releases pequenas e frequentes a grandes entregas raras; tenha um caminho claro de rollback.

---

## 15. Revisão de código (checklist de PR)

Toda mudança passa por revisão. Ao abrir ou revisar um PR, verifique:

- [ ] Resolve o problema proposto e nada além do escopo.
- [ ] O código é legível e os nomes revelam intenção.
- [ ] Respeita a separação de camadas e não vaza responsabilidades.
- [ ] Tem testes cobrindo o comportamento novo/alterado, e todos passam.
- [ ] Trata erros e casos de borda de forma explícita.
- [ ] Não introduz segredos, credenciais ou dados sensíveis.
- [ ] Valida entradas externas e não abre brecha de segurança.
- [ ] Documentação e comentários relevantes foram atualizados.
- [ ] Não há código morto, `TODO` esquecido ou log de depuração perdido.
- [ ] Mensagens de commit são claras e seguem o padrão.

Revisão é sobre o código, não sobre a pessoa. Seja específico, gentil e construtivo — e explique o *porquê* das sugestões.

---

## 16. Definição de pronto (Definition of Done)

Uma tarefa só está concluída quando:

- [ ] O código atende ao requisito e foi revisado e aprovado.
- [ ] Há testes automatizados e todos estão passando.
- [ ] O pipeline de CI está verde.
- [ ] A documentação necessária foi criada ou atualizada.
- [ ] Não há regressões conhecidas nem dívida crítica introduzida sem registro.
- [ ] Está pronto para ser implantado com segurança (ou já implantado, conforme o fluxo).

---

> Este documento é vivo. Sempre que uma prática se mostrar melhor na realidade
> do time, atualize-o — de preferência com um breve registro do motivo.
