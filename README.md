# brabo-api

API do Brabo (NestJS 11 + Drizzle + PostgreSQL 16/pgvector), extraída do monorepo `daneiel/brabo` (ADR 0252, AT-696). Documentação da área em `docs/`; regras de negócio em `docs/business-rules/`.

## Contratos

`@brabo/shared` (só tipos) vem de `github:viralabs-dev/brabo-contracts#v1.0.0&path:/packages/shared`. A api NÃO consome `@brabo/docker-port` (`test/api-nao-consome-docker-port.spec.ts`). `contracts/areas.json` é gerado por `pnpm gerar:areas` e publicado no `brabo-contracts`.

## Desenvolver

```sh
pnpm install
pnpm typecheck && pnpm lint
TEST_DATABASE_URL=postgres://brabo:brabo@localhost:5432/brabo_test pnpm test   # exige Postgres com pgvector
pnpm build
```

## Imagem

`Dockerfile` (produção, contexto = a raiz) e `Dockerfile.dev` (bind-mount + `start:dev`). O CI constrói a imagem sem publicar; publicar por digest é da tag (AT-704) e o `brabo-infra` a consome.

Branches permanentes: `dev` e `main`; tag só por workflow.
