# Segurança

## Versões suportadas

Enquanto o Molda estiver na linha `0.1.x`, somente a versão mais recente recebe
correções de segurança. Versões `0.x` podem mudar contratos ainda não declarados
estáveis; mudanças incompatíveis serão registradas no changelog.

## Como relatar uma vulnerabilidade

Não abra uma issue pública com exploit, segredo, arquivo hostil funcional ou
dados de terceiros. Use o formulário privado de
[Security Advisories](https://github.com/patricteixeira/Molda/security/advisories/new)
do repositório e informe:

- componente e versão afetados;
- pré-condições e impacto observável;
- passos mínimos para reproduzir;
- mitigação conhecida, se houver.

O mantenedor fará a triagem inicial em até sete dias corridos. Um prazo de
correção e divulgação será combinado conforme severidade, possibilidade de
exploração e disponibilidade de mitigação. Esse prazo é uma meta operacional,
não um SLA comercial.

## Fronteira operacional da v0.1

A distribuição padrão é self-hosted, single-tenant e ligada a
`127.0.0.1:8080`. O convite injetado pelo proxy identifica a instância, não
usuários diferentes. Publicar essa porta na internet sem TLS e uma camada de
acesso externa está fora do modelo suportado.

Uploads são tratados como conteúdo hostil. Não desative os limites, a
sanitização, a validação OOXML, o filesystem somente leitura ou o isolamento de
rede dos serviços sem revisar o modelo de ameaça.

## Segredos

Nunca envie tokens, senhas, fontes comerciais ou materiais de marca privados em
issues, pull requests ou fixtures. Se um segredo entrar no histórico, revogue-o
antes de qualquer tentativa de remoção.
