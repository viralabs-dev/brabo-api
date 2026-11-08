# brabo-api

Guarda o estado do Brabo e decide o que um agente pode fazer, para essa regra ficar em um lugar só.

## Para que existe

Os agentes rodam no engine e as pessoas usam a web e o runner. Nenhum deles deveria decidir sozinho o que é permitido nem contar o custo de cada chamada de LLM. A API faz isso: guarda o domínio (sessões, ações e aprovações, backlog, gates de PR, credenciais, IAM, RAG e o grafo), aplica a política de ações e mede o custo. Separada, pode ser auditada e versionada sem o resto.

O código veio do monorepo antigo do Brabo, com o histórico dos caminhos (ADR 0252). Os `#N` dos commits antigos apontam para [brabo-legacy](https://github.com/viralabs-dev/brabo-legacy).

## Onde se encaixa

O engine chama a API pelas rotas `/internal/*`, com o token de serviço. A web e o runner usam as rotas públicas.

<!-- mapa:inicio -->
<!-- Gerado do repos.yml do brabo por brabo-ci:scripts/ci/mapa-dos-repos.ts. Não edite à mão. -->

**brabo-api** — API do produto (NestJS, Drizzle, PostgreSQL/pgvector) — schema, RBAC, LLM, metering e gates. Imagem publicada por tag e consumida pelo brabo e pelo brabo-infra; o brabo-web, o brabo-engine e o brabo-qa leem o código ou o `openapi.json` dele.

| repo | propósito | como é usado | depende de | é usado por |
|---|---|---|---|---|
| brabo | Porta de entrada do produto — documentação agregada, site, instalador e release. | Quem instala usa o `install.sh` e as imagens e o binário das tags de `componentes.json`; o brabo-infra o clona nas aferições cruzadas. | brabo-api (imagem, doc), brabo-engine (imagem, doc), brabo-web (imagem, doc), brabo-broker (imagem, doc), brabo-runner (imagem, doc), brabo-infra (imagem, código, doc), brabo-contracts (doc), brabo-ci (doc, workflow), brabo-qa (doc) | brabo-ci (contrato), brabo-infra (código), brabo-workspace (código) |
| **brabo-api** | API do produto (NestJS, Drizzle, PostgreSQL/pgvector) — schema, RBAC, LLM, metering e gates. | Imagem publicada por tag e consumida pelo brabo e pelo brabo-infra; o brabo-web, o brabo-engine e o brabo-qa leem o código ou o `openapi.json` dele. | brabo-contracts (contrato), brabo-infra (código), brabo-qa (workflow), brabo-ci (workflow) | brabo (imagem, doc), brabo-engine (código), brabo-web (contrato), brabo-contracts (contrato), brabo-infra (código), brabo-qa (código), brabo-workspace (código) |
| brabo-engine | Engine (Elixir/OTP, Phoenix, Oban) — agentes, sessões, gates e roteamento de runners. | Imagem publicada por tag, usada pelo brabo e pelo brabo-infra. | brabo-contracts (contrato), brabo-api (código), brabo-runner (código), brabo-qa (workflow), brabo-ci (workflow) | brabo (imagem, doc), brabo-infra (código), brabo-qa (código), brabo-workspace (código) |
| brabo-web | Interface web (React 19, Vite) — telas, i18n e design system. | Imagem publicada por tag, usada pelo brabo e pelo brabo-infra. | brabo-contracts (contrato), brabo-api (contrato), brabo-qa (workflow), brabo-ci (workflow) | brabo (imagem, doc), brabo-infra (código), brabo-qa (código), brabo-workspace (código) |
| brabo-runner | CLI `brabo-runner` na máquina do usuário — PTY, container local e espelho. | Binário publicado por tag, instalado pelo brabo; o brabo-engine e o brabo-qa leem o código dele nos testes. | brabo-contracts (contrato), brabo-ci (workflow) | brabo (imagem, doc), brabo-engine (código), brabo-infra (código), brabo-qa (código), brabo-workspace (código) |
| brabo-broker | Único processo com o socket do Docker do servidor. | Imagem publicada por tag, usada pelo brabo e pelo brabo-infra. | brabo-contracts (contrato), brabo-qa (workflow), brabo-ci (workflow) | brabo (imagem, doc), brabo-infra (código), brabo-qa (código), brabo-workspace (código) |
| brabo-contracts | Contratos compartilhados — os pacotes `shared` e `docker-port`, `areas.json` e `fluxo.yml`. | Consumido por TAG (pacote no GitHub Packages ou arquivo baixado por raw na mesma tag); uma tag nova pede bump em api, web, runner, broker, engine, qa e infra. | brabo-api (contrato), brabo-ci (workflow) | brabo (doc), brabo-api (contrato), brabo-engine (contrato), brabo-web (contrato), brabo-runner (contrato), brabo-broker (contrato), brabo-infra (código), brabo-qa (contrato), brabo-workspace (código) |
| brabo-ci | Workflows reutilizáveis e a política de PR, escada de aprovação, promoção, tag e Dependabot. | Cada repo chama `uses: viralabs-dev/brabo-ci/...@<sha>`, fixado por SHA. | brabo-qa (contrato, workflow), brabo (contrato) | brabo (doc, workflow), brabo-api (workflow), brabo-engine (workflow), brabo-web (workflow), brabo-runner (workflow), brabo-broker (workflow), brabo-contracts (workflow), brabo-infra (workflow), brabo-qa (workflow), brabo-workspace (código, workflow) |
| brabo-infra | Composes, Dockerfiles de integração, `deploy/k8s`, scripts de dev, release e cadeia de suprimentos. | O brabo clona o brabo-infra no ref de `componentes.json` para subir a instalação; o brabo-api e o brabo-qa o clonam no CI. | brabo-api (código), brabo-engine (código), brabo-web (código), brabo-broker (código), brabo-runner (código), brabo-contracts (código), brabo (código), brabo-qa (workflow), brabo-ci (workflow) | brabo (imagem, código, doc), brabo-api (código), brabo-qa (código), brabo-workspace (código) |
| brabo-qa | E2E de navegador (Playwright), golden-sets e catálogo de funcionalidades — o portão da `main`. | O brabo-ci dispara o `e2e-pr` dele e lê o `funcionalidades.yml`; api, engine, web, broker e infra o chamam como portão. | brabo-api (código), brabo-engine (código), brabo-web (código), brabo-runner (código), brabo-broker (código), brabo-infra (código), brabo-contracts (contrato), brabo-ci (workflow) | brabo (doc), brabo-api (workflow), brabo-engine (workflow), brabo-web (workflow), brabo-broker (workflow), brabo-ci (contrato, workflow), brabo-infra (workflow), brabo-workspace (código) |
| brabo-workspace | Pasta-mãe `~/dev/brabo/` com os clones lado a lado e o `clonar-tudo.sh`. | Quem desenvolve roda `clonar-tudo.sh` uma vez; as sessões do Claude abrem nela. | brabo (código), brabo-api (código), brabo-engine (código), brabo-web (código), brabo-runner (código), brabo-broker (código), brabo-contracts (código), brabo-ci (código, workflow), brabo-infra (código), brabo-qa (código) | — |

```mermaid
flowchart LR
  brabo["brabo"]
  brabo_api["brabo-api"]
  brabo_engine["brabo-engine"]
  brabo_web["brabo-web"]
  brabo_contracts["brabo-contracts"]
  brabo_ci["brabo-ci"]
  brabo_infra["brabo-infra"]
  brabo_qa["brabo-qa"]
  brabo_workspace["brabo-workspace"]
  brabo -->|imagem| brabo_api
  brabo -->|doc| brabo_api
  brabo_api -->|contrato| brabo_contracts
  brabo_api -->|código| brabo_infra
  brabo_api -->|workflow| brabo_qa & brabo_ci
  brabo_engine -->|código| brabo_api
  brabo_web -->|contrato| brabo_api
  brabo_contracts -->|contrato| brabo_api
  brabo_infra -->|código| brabo_api
  brabo_qa -->|código| brabo_api
  brabo_workspace -->|código| brabo_api
  classDef atual fill:#fde68a,stroke:#b45309,color:#000
  class brabo_api atual
```
<!-- mapa:fim -->

## Como é usado

Pela imagem de container `ghcr.io/viralabs-dev/brabo-api`, com a tag que o carimbo do brabo-ci gera (`vX.Y.Z` ou `vX.Y.Z-dev.N`). A imagem é privada: o pull pede login com um token que tenha `read:packages`.

```sh
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USUARIO" --password-stdin
docker pull ghcr.io/viralabs-dev/brabo-api:v2.2.0-dev.8
```

Para subir a api junto com o resto do produto, use o `make dev` do brabo-infra, que constrói cada serviço a partir dos clones irmãos.

## Como desenvolver

Requisitos: Node 26.10.0 e pnpm 11.3.0 (as versões do CI) e um Postgres com a extensão pgvector para os testes. O `pnpm install` precisa de token do GitHub Packages: ponha `//npm.pkg.github.com/:_authToken=<PAT>` no `~/.npmrc` da máquina, com um PAT classic só com `read:packages`. Nunca no repo.

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
TEST_DATABASE_URL=postgres://brabo:brabo@localhost:5432/brabo_test pnpm exec vitest run --coverage
pnpm build
```

- `pnpm lint` e `pnpm typecheck` são os passos do job `lint` do CI; o último comando é o do job `testes`.
- O `globalSetup` do vitest cria um banco-template e um banco por worker a partir de `TEST_DATABASE_URL`. Use um Postgres descartável, nunca o da instalação local.
- `test/runbook/sql-do-incidente-de-custo.spec.ts` lê o runbook do brabo-infra pelo clone irmão (`BRABO_INFRA_DIR`, padrão `../brabo-infra`).
- As migrations ficam em `src/db/migrations` (`pnpm db:generate`, `pnpm db:migrate`), e `pnpm lint:migracao` confere as regras delas.

## O que o CI garante

Só `pr-police` e `escada` (política de PR, em `politica.yml`) são obrigatórios. O resto é informativo: a PR abre mesmo com ele vermelho, mas a falha diz o que corrigir.

| Check | O que prova |
|---|---|
| `lint` (`ci.yml`) | ESLint com zero avisos e o typecheck do build |
| `testes` (`ci.yml`) | vitest com cobertura contra um Postgres de serviço, com o inventário de rotas e o Dockerfile sem token |
| `imagem` (`ci.yml`) | o build da imagem de produção, sem publicar |
| `imagem-hotfix` (`ci.yml`) | em PR para a `dev`, ou hotfix para a `main`, publica `sha-<12>` assinada, com Trivy (HIGH/CRITICAL com correção reprova) |
| `cadeia` (`ci.yml`) | actionlint, e todo `uses:` preso a SHA com a versão em comentário |
| `contracts-alinhado` (`ci.yml`) | a versão do brabo-contracts é a mesma em `package.json`, lock e scripts |
| `refs` (`refs.yml`) | as refs `caminho:N` das regras de negócio apontam para a linha certa |
| `qa-e2e` (`qa-e2e.yml`) | o regressivo do brabo-qa com a imagem `sha-` da PR |
| `dependencias` (`dependencias.yml`) | as dependências de merge |
| `readme-esqueleto` e `mapa-alinhado` (`ci.yml`) | o README segue o esqueleto de 8 seções e o bloco do mapa está em dia |

Fora de PR, `carimbo.yml` carimba a tag a cada push em `dev` e `main`. Na tag `vX.Y.Z`, `release.yml` publica a imagem por digest, escaneia com Trivy e assina com cosign.

## Documentação

- [`docs/business-rules/api.md`](docs/business-rules/api.md): as regras de negócio hospedadas na api, cada uma com o código e o teste que a cobrem.
- [`docs/security-surface.md`](docs/security-surface.md): o inventário das rotas com a classificação de autenticação. `test/interfaces/route-surface.spec.ts` confere com as rotas registradas.
- [`docs/reference/`](docs/reference/): providers de LLM e de git, permissões, artefatos e o `openapi.json`.
- [`docs/reference/contratos-e-imagem.md`](docs/reference/contratos-e-imagem.md): o `@brabo/shared`, o `areas.json` e como a imagem é construída e publicada.
- [`docs/explanation/aceite-providers.md`](docs/explanation/aceite-providers.md): o aceite dos providers com credencial real.
- [`CLAUDE.md`](CLAUDE.md) são as regras para quem altera o código, e [`CHANGELOG.md`](CHANGELOG.md) registra as mudanças.
- O site do produto agrega a `docs/` de cada repo: https://viralabs-dev.github.io/brabo/prd/

## Como replicar no seu projeto

O que copiar: os workflows que chamam o brabo-ci presos a SHA com a versão em comentário (`ci.yml` e `politica.yml`), e o `docs/.docmap.yml`, que liga cada doc ao código que ela descreve. Troque o `uses:` e o `ci_ref` pela versão do brabo-ci que você pina. O passo a passo está no [guia de adoção](https://github.com/viralabs-dev/brabo-ci/blob/v1.4.0-dev.14/scripts/ci/docs/tutorials/adotar.md) do brabo-ci.

## Apoie

Se o projeto te ajuda, você pode [pagar um café no Ko-fi](https://ko-fi.com/daneiel).

## Licença

MIT, ver [LICENSE](LICENSE). Avisos de terceiros em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
