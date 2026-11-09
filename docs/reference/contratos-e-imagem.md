# Contratos e imagem

Detalhe que saiu do README do brabo-api. Para o uso e o desenvolvimento, veja o README.

## Contratos

- `@brabo/shared` (só tipos) é o pacote `@viralabs-dev/brabo-shared@1.2.0` do GitHub Packages, instalado pelo alias `npm:` do pnpm como devDependency (ADR 0270). O `.npmrc` do repo só aponta o escopo `@viralabs-dev` para `https://npm.pkg.github.com`.
- O `pnpm install` precisa de token mesmo com pacote público. No Docker, `docker build --secret id=npmrc,src=$HOME/.npmrc .`. No CI vale o `GITHUB_TOKEN` com `packages: read`.
- Para subir a versão do contracts, use `scripts/ci/subir-contracts.sh` do brabo-ci (não edite o lock à mão). O check `contracts-alinhado` confere a versão.
- A api NÃO consome `@brabo/docker-port` (`test/api-nao-consome-docker-port.spec.ts`).
- `contracts/areas.json` é gerado por `pnpm gerar:areas` (a api é a fonte) e publicado no `brabo-contracts`.
- `docs/reference/openapi.json` é a saída de `pnpm openapi:export` (que escreve na saída padrão), commitada no repo. O `brabo-web` guarda uma cópia fixada dele.

## Imagem

- `Dockerfile` é a imagem de produção (contexto = a raiz do repo). `Dockerfile.dev` é a de desenvolvimento (bind mount + `start:dev`).
- O CI constrói a imagem a cada PR e push, sem publicar. Em PR para a `dev` (e hotfix para a `main`), o job `imagem-hotfix` publica `sha-<12>` assinada, com Trivy e cosign, para o regressivo do brabo-qa.
- O `carimbo.yml` (tag-release do brabo-ci) carimba a tag a cada push em `dev` e `main`. O `release.yml` reage a `vX.Y.Z-dev.N` e a `vX.Y.Z`: publica `ghcr.io/viralabs-dev/brabo-api` por digest, escaneia o digest com o Trivy (HIGH/CRITICAL com correção reprova) e assina com cosign keyless pelo digest, verificando a assinatura no mesmo run. Na tag final, anexa o `imagem.json` (imagem, tag e digest) à GitHub Release. É esse arquivo que o brabo lê para montar o `images.json`, e é por ele que o brabo-infra consome a imagem.
- Em tag `-dev`, o `imagem.json` vai como artefato do run, sem Release.
- O `limpeza-ghcr.yml` apaga as `sha-*` de PRs fechadas e as de mais de 7 dias, e guarda as 10 `-dev.*` mais novas.
- As branches permanentes são `dev` e `main`, e toda tag nasce de workflow, nunca à mão.
