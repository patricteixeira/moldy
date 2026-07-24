# ADR 0020 — Catálogo privado da instância hospedada

## Decisão

O catálogo público continua compilado no engine. A instância hospedada pode
acrescentar pacotes declarativos `TemplatePackage` por meio de
`BRANDRT_PRIVATE_TEMPLATE_DIR`.

Os pacotes privados:

- ficam fora do Git e das imagens Docker;
- são montados como diretório somente leitura na API e no worker;
- passam pela mesma validação Pydantic dos pacotes internos;
- não podem executar Python, JavaScript, HTML ou CSS;
- falham de forma explícita se houver arquivo inválido, token ausente ou id
  repetido;
- são resolvidos tanto na prévia quanto na exportação.

As fontes protegidas também são montadas somente na instância hospedada. O
Nginx as entrega na rota já limitada a mesma origem. Como a aplicação não exige
login, qualquer fonte enviada ao navegador pode ser baixada por quem tiver o
link; a proteção garantida aqui é contra redistribuição no repositório e nas
imagens públicas, não contra inspeção de rede.

## Implantação

O arquivo `infra/hosting/compose.hosted-assets.yml` complementa o Compose base:

```powershell
docker compose `
  -f docker-compose.yml `
  -f infra/hosting/compose.hosted-assets.yml `
  up -d --wait
```

O host precisa definir:

- `BRANDRT_PRIVATE_TEMPLATE_HOST_DIR`;
- `BRANDRT_PRIVATE_FONT_HOST_DIR`;
- `VITE_SYNAPSIS_FONT_BASE_URL=/fonts/synapsis`.

O corpus de referências não é montado nem servido. Somente os pacotes
declarativos promovidos após revisão entram no diretório privado de templates.
