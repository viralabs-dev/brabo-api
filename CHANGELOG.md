# Changelog

## v1.0.0

- Extração de `apps/api` (e dos Dockerfiles `docker/api/*`) do monorepo `daneiel/brabo` (AT-696, ADR 0252), com o histórico dos caminhos; `#N` nos commits aponta para `viralabs-dev/brabo-legacy`.
- `@brabo/shared` passa a vir do `brabo-contracts#v1.0.0` (devDependency; é só tipos). `@brabo/docker-port` continua NÃO consumido pela api.
- `Dockerfile` (produção) e `Dockerfile.dev` adaptados ao contexto do repositório sozinho, sem workspace pnpm.
- `scripts/gerar-areas.ts` gera só `contracts/areas.json` (a api é a fonte); as cópias de web e engine nascem do contrato nesses repositórios.
- Saíram do repositório, por lerem outros repositórios: `packages-shared-so-tipos.spec.ts` (afere o contrato; vai para o `brabo-contracts`), `rede-do-container-paridade.spec.ts`, `especificacao-de-container-para-runner.contract.spec.ts` e o bloco de paridade de `path-scope.spec.ts` (api x docker-port; vão para o `brabo-infra`/`brabo-qa`), `tool-router-correcao-do-dev.spec.ts` e `tool-router-piso-dos-gates.spec.ts` (api x engine), `sql-do-incidente-de-custo.spec.ts` (executa o SQL do runbook de deploy; vai para o `brabo-infra`) e a asserção `todo alvo de prova citado existe` de `gate-registry.spec.ts` (o registro cita arquivos de vários repositórios).
- `git-errors.spec.ts` e `git-provider-contract-callers.spec.ts` leem `GitProviderContract` de `node_modules/@brabo/shared`.
