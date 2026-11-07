# brabo-api

A API do Brabo: NestJS 11, Drizzle e PostgreSQL 16 com pgvector. Ela guarda o domínio do produto (sessões, ações e aprovação, backlog, gates de PR, credenciais, IAM, RAG e o grafo), aplica a política que decide o que um agente pode fazer e mede o custo de cada chamada de LLM. O engine fala com ela pelas rotas `/internal/*`, com o token de serviço; a web e o runner, pelas rotas públicas.

O código veio do antigo monorepo do Brabo, com o histórico dos caminhos (ADR 0252, AT-696). Os `#N` dos commits antigos apontam para [`viralabs-dev/brabo-legacy`](https://github.com/viralabs-dev/brabo-legacy).

## Como desenvolver

Requisitos: Node 26 e pnpm 11 (as versões do CI estão em `.github/workflows/ci.yml`), e um Postgres com a extensão pgvector para os testes.

```sh
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint
TEST_DATABASE_URL=postgres://brabo:brabo@localhost:5432/brabo_test pnpm test   # exige Postgres com pgvector
pnpm build
```

- O `globalSetup` do vitest cria um banco-template e um banco por worker a partir do `TEST_DATABASE_URL`.
- `test/runbook/sql-do-incidente-de-custo.spec.ts` executa o SQL do runbook que mora no `brabo-infra`. Ele lê o clone irmão por `BRABO_INFRA_DIR` (padrão `../brabo-infra`) e reprova, nomeando o caminho, quando o arquivo não existe.
- As migrations ficam em `src/db/migrations` (`pnpm db:generate`, `pnpm db:migrate`), e `pnpm lint:migracao` confere as regras delas.
- Para subir a api junto com o resto do produto, use o `make dev` do `brabo-infra`, que constrói cada serviço a partir dos clones irmãos.

## Contratos

- `@brabo/shared` (só tipos) vem de `github:viralabs-dev/brabo-contracts#v1.2.0-dev.1&path:/packages/shared`, como devDependency.
- A api NÃO consome `@brabo/docker-port` (`test/api-nao-consome-docker-port.spec.ts`).
- `contracts/areas.json` é gerado por `pnpm gerar:areas` (a api é a fonte) e publicado no `brabo-contracts`.
- `docs/reference/openapi.json` é a saída de `pnpm openapi:export` (que escreve na saída padrão), commitada no repo; o `brabo-web` guarda uma cópia fixada dele.

## Imagem

- `Dockerfile` é a imagem de produção (contexto = a raiz do repo); `Dockerfile.dev` é a de desenvolvimento (bind mount + `start:dev`).
- O CI constrói a imagem a cada PR e push, sem publicar.
- O `carimbo.yml` (tag-release do `brabo-ci`) carimba a tag a cada push em `dev` e `main`. Na tag final (`vX.Y.Z`), o `release.yml` constrói e publica `ghcr.io/viralabs-dev/brabo-api` por digest, escaneia o digest com o Trivy (HIGH/CRITICAL com correção reprova), assina com cosign keyless pelo digest, verifica a assinatura no mesmo run e anexa o `imagem.json` (imagem, tag e digest) à GitHub Release. É esse arquivo que o `brabo` lê para montar o `images.json`, e é por ele que o `brabo-infra` consome a imagem.
- As branches permanentes são `dev` e `main`, e toda tag nasce de workflow, nunca à mão.

## Documentação

A documentação desta área mora em `docs/`, em pt-BR:

- `docs/business-rules/api.md`: as regras de negócio (RN-XXX) hospedadas na api, cada uma com o código e o teste que a cobrem;
- `docs/security-surface.md`: o inventário de todas as rotas com a classificação de autenticação, que `test/interfaces/route-surface.spec.ts` compara com as rotas registradas;
- `docs/reference/`: providers de LLM e de git, permissões, artefatos, a API interna e o `openapi.json`;
- `docs/explanation/`: o aceite dos providers com credencial real.

`docs/.docmap.yml` liga cada doc ao código que ela descreve. O site do produto agrega a `docs/` de cada repositório; não há site neste repo. As regras para quem altera o código estão em `CLAUDE.md`, e as mudanças, em `CHANGELOG.md`.

## Repositórios do Brabo

O Brabo é dividido em repositórios por camada (ADR 0252), e a documentação central está no [brabo](https://github.com/viralabs-dev/brabo) e no site https://viralabs-dev.github.io/brabo/prd/.

- **Depende de:** [brabo-contracts](https://github.com/viralabs-dev/brabo-contracts) (os tipos de `@brabo/shared`), [brabo-ci](https://github.com/viralabs-dev/brabo-ci) (workflows reutilizáveis e a política de PR), [brabo-infra](https://github.com/viralabs-dev/brabo-infra) (o CI lê o runbook do infra).
- **É usado por:** [brabo](https://github.com/viralabs-dev/brabo) (documentação e release do produto), [brabo-infra](https://github.com/viralabs-dev/brabo-infra) (sobe a imagem), [brabo-qa](https://github.com/viralabs-dev/brabo-qa) (testes de ponta a ponta), [brabo-web](https://github.com/viralabs-dev/brabo-web) (cópia fixada do `openapi.json`), [brabo-contracts](https://github.com/viralabs-dev/brabo-contracts) (recebe o `areas.json`).

| Repositório | Papel |
|---|---|
| [brabo](https://github.com/viralabs-dev/brabo) | porta de entrada do produto: documentação central, ADRs, `install.sh` e release |
| [brabo-api](https://github.com/viralabs-dev/brabo-api) | API NestJS: domínio, banco, política de ações e auth (este repo) |
| [brabo-engine](https://github.com/viralabs-dev/brabo-engine) | engine Elixir/OTP: agentes, sessões e filas |
| [brabo-web](https://github.com/viralabs-dev/brabo-web) | interface React |
| [brabo-runner](https://github.com/viralabs-dev/brabo-runner) | CLI que roda na máquina do usuário |
| [brabo-broker](https://github.com/viralabs-dev/brabo-broker) | único processo com o socket do Docker |
| [brabo-contracts](https://github.com/viralabs-dev/brabo-contracts) | contratos compartilhados entre os repositórios |
| [brabo-infra](https://github.com/viralabs-dev/brabo-infra) | composes, Kubernetes, runbook e o `make dev` |
| [brabo-ci](https://github.com/viralabs-dev/brabo-ci) | workflows reutilizáveis e scripts da política de PR |
| [brabo-qa](https://github.com/viralabs-dev/brabo-qa) | testes de ponta a ponta e de propriedades |
| [brabo-workspace](https://github.com/viralabs-dev/brabo-workspace) | pasta-mãe que clona os repositórios lado a lado |

## Apoie

Se o projeto te ajuda, você pode [pagar um café no Ko-fi](https://ko-fi.com/daneiel).

## Licença

MIT, ver `LICENSE`. Avisos de terceiros em `THIRD_PARTY_NOTICES.md`.
