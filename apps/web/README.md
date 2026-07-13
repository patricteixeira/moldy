# App web do brand-runtime

Wizard de instalação e editor por slots do walking skeleton. O chrome usa
tipografia do sistema; as fontes da marca ficam contidas nas provas renderizadas.

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

## E2E

O roteiro E2E atravessa o sistema real: intake, confirmação da marca, kit,
guard e exportação PNG/PDF. Ele gera todas as fixtures em tempo de execução.

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
