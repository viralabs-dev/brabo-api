# Changelog

## Unreleased

- Folga de raciocínio do Haiku 5.5 na Anthropic (AT-743, RN-1007): a migration `0083` grava `reasoning_budget = 12288` no `claude-haiku-5-5` (teto 16384), para o gate que raciocina não ser cortado; smoke manual `anthropic-provider.folga.smoke.spec.ts`.
- `POST /internal/projects/:projectId/open-questions/:questionId/answer` (AT-741, RN-1002): the agent closes the open question the user answered in chat, sharing the core of the human answer; idempotent (`already_answered`).
- Corrige o `TracedLLMProvider` (AT-743, RN-1001): repassa `aceitaRaciocinioDesligado` do provider envolvido; sem isso a retentativa sem raciocínio da RN-916 nunca rodava em produção (OpenRouter e Anthropic).
- Provider Anthropic (AT-739, RN-1000): com o raciocínio desligado o corpo é por modelo — Haiku 5.5 `thinking: disabled`, Sonnet 5.5 `between_tools`, Opus 5.5 `effort: low` (reduzido); o adaptativo ligado ganha a folga no `max_tokens`; declara `aceitaRaciocinioDesligado`; `reasoning_tokens` vem do `thinking_tokens` do `message_delta` em vez de NULL.
- `politica.yml`: pins do `brabo-ci` sobem para `b030fbf` (dispensa da PR do bot, ADR 0255; AT-733).
- Release por tag da imagem `ghcr.io/viralabs-dev/brabo-api` (AT-704): `carimbo.yml` (tag-release do brabo-ci) e `release.yml` (build, push por digest, Trivy sobre o digest, cosign keyless por digest com verify, `imagem.json` na Release). A 1ª tag final na `main` sai `v1.0.0`.

- Volta `test/runbook/sql-do-incidente-de-custo.spec.ts`: executa o SQL do runbook (`deploy/docs/runbook.md` do `brabo-infra`) contra o schema da api. Lê o runbook por `BRABO_INFRA_DIR` (padrão `../brabo-infra`; o CI baixa o `brabo-infra` `dev`) e REPROVA, nomeando o caminho, se ele não existe.
- Catálogo `docs/i18n/{pt-BR,ru,zh-Hans}/openapi-textos.json`: removida a entrada órfã `606f9805e6ba` (conferida com `aplicar()` de `openapi-por-locale.mjs`, que mora no `brabo-legacy`/`brabo`).
- `CLAUDE.md`: blocos cortados pelo teto de 40 mil caracteres passam a regras de caminho em `.claude/rules/`.

## v1.0.0

- Extração de `apps/api` (e dos Dockerfiles `docker/api/*`) do monorepo `daneiel/brabo` (AT-696, ADR 0252), com o histórico dos caminhos; `#N` nos commits aponta para `viralabs-dev/brabo-legacy`.
- `@brabo/shared` passa a vir do `brabo-contracts#v1.0.0` (devDependency; é só tipos). `@brabo/docker-port` continua NÃO consumido pela api.
- `Dockerfile` (produção) e `Dockerfile.dev` adaptados ao contexto do repositório sozinho, sem workspace pnpm.
- `scripts/gerar-areas.ts` gera só `contracts/areas.json` (a api é a fonte); as cópias de web e engine nascem do contrato nesses repositórios.
- Saíram do repositório, por lerem outros repositórios: `packages-shared-so-tipos.spec.ts` (afere o contrato; vai para o `brabo-contracts`), `rede-do-container-paridade.spec.ts`, `especificacao-de-container-para-runner.contract.spec.ts` e o bloco de paridade de `path-scope.spec.ts` (api x docker-port; vão para o `brabo-infra`/`brabo-qa`), `tool-router-correcao-do-dev.spec.ts` e `tool-router-piso-dos-gates.spec.ts` (api x engine), `sql-do-incidente-de-custo.spec.ts` (executa o SQL do runbook de deploy; vai para o `brabo-infra`) e a asserção `todo alvo de prova citado existe` de `gate-registry.spec.ts` (o registro cita arquivos de vários repositórios).
- `git-errors.spec.ts` e `git-provider-contract-callers.spec.ts` leem `GitProviderContract` de `node_modules/@brabo/shared`.
