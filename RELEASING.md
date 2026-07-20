# Processo de release

Releases do Molda são produzidas a partir de `main` pelo workflow manual
**Publicar release**. O workflow só cria a tag e a GitHub Release depois dos
gates; não existe tag antecipada para um artefato que falhou.

## Preparação

1. Escolha uma versão SemVer estável e atualize, no mesmo PR, todos os pacotes,
   `CHANGELOG.md` e `docs/releases/v<versão>.md`.
2. Execute `python tools/release_check.py --version <versão>`.
3. Rode os gates locais afetados e prove a stack com
   `docker compose up -d --build --wait`.
4. Integre o PR somente com CI, Stack Docker e CodeQL verdes.
5. Confirme que `main` local e remota apontam para o mesmo commit e que a árvore
   de trabalho está limpa.

## Publicação

No GitHub, execute **Actions → Publicar release → Run workflow** em `main`.
Informe a versão sem `v` e confirme conscientemente:

- que o mantenedor revisou a decisão e as fronteiras de licenças;
- que o escopo e os limites conhecidos das notas públicas estão corretos.

O workflow então:

1. revalida versões, changelog, notas, licenças e arquivos comunitários;
2. exige sucesso remoto dos jobs de CI, smoke Docker e três análises CodeQL no
   mesmo commit;
3. constrói a stack e atravessa o E2E real de intake, edição,
   PNG/PDF/PPTX/DOCX e round-trip;
4. constrói wheel e sdist do SDK MIT, o bundle de schemas/exemplos e checksums;
5. cria `v<versão>` e a GitHub Release com esses artefatos.

Tags publicadas são imutáveis. Uma correção recebe nova versão; uma release com
problema grave pode ser marcada como retirada, mas a tag e os checksums não são
reescritos.

## Verificação pós-publicação

```powershell
git fetch origin --tags
git rev-parse v<versão>
gh release view v<versão>
gh run list --commit (git rev-list -n 1 v<versão>) --limit 10
```

Baixe os artefatos numa pasta vazia, confira `SHA256SUMS` e faça ao menos uma
instalação limpa via `docker compose up -d --build --wait` a partir da tag.
