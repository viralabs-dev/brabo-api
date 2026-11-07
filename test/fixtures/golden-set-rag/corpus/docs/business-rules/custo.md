---
id: custo
title: 'Regras de negócio — Custo'
sidebar_label: Custo e metering
description: 'As RNs de orçamento, metering, relatório de gasto e teto de custo — extraídas do business-rules.md por tamanho.'
keywords: [regras de negócio, custo, orçamento, metering, token]
---

# Cost

> Estas RNs saíram de [`business-rules.md`](../business-rules.md) sem
> mudar uma vírgula do conteúdo: a página única passava de 640 KB e
> estas duas seções sozinhas eram metade dela. As âncoras `#rn-NNN`
> continuam idênticas — só o arquivo que as hospeda mudou.

### RN-017 — Budget has an exclusive scope: project **or** session {#rn-017}

A `budget` references a project or a session, never both — guaranteed by
a `check` in the database, not just in code.

- **Where:** `apps/api/src/db/schema/llm.ts` (`budgets_scope_check`)
- **Test:** the constraint is the guarantee

### RN-018 — Budget notification at 70%, 90%, and 100%, without repeating {#rn-018}

Each threshold fires **once**; the last one notified is persisted in
`budgets.last_threshold_notified`.

- **Where:** `apps/api/src/domain/llm/budget-threshold.ts:1`
- **Test:** `test/domain/llm/budget-threshold.spec.ts`

### RN-019 — `policy = 'block'` refuses the call; `'allow'` only records {#rn-019}

- **Where:** `apps/api/src/domain/llm/budget-threshold.ts:4`
- **Edge case:** a project in `allow` **doesn't stop itself** at the
  ceiling. It's the most common cause of "the budget didn't hold" — see
  the [runbook](../runbook.md).

### RN-020 — The model is resolved by cascade, from most specific to most general {#rn-020}

`session > agent > area > project > workspace`. The first one that
exists wins. `area` entered in PHASE 23 — see [RN-102](#rn-102) for its
position and what changes for whoever already read this cascade.

- **Where:** `apps/api/src/domain/llm/binding-resolver.ts`
- **Test:** `test/domain/llm/binding-resolver.spec.ts`

### RN-040 — Agent binding requires native tool calling {#rn-040}

Binding a model to an **agent** (`scope = 'agent'`) is only allowed if the
model has `supports_tool_calling`. An agent only exists inside the
ToolLoop, and the ToolLoop only works if the model knows how to
**request** tools; without that, the failure would show up downstream as
"the agent stopped without finishing", which is exactly the
diagnosis-by-elimination that [ADR 0020](../adr/0020-destravar-gates-qa-secops.md)
forbade. The refusal is a 422 and the message points to the **"fit for
agents"** filter — without that pointer the rule becomes a dead end.

The engine's `ToolCallRecovery` recovers calls the model wrote in prose,
but it's a **rescue, not a license**: it depends on the model getting the
format right by chance.

Only `agent` validates. `workspace` and `project` are the human chat's
fallback and `session` is conversation — none of them run a ToolLoop, and
locking them would forbid chat-only models in the product. The
`context-manager` agent is covered by construction: it's a slug
**within** the `agent` scope, not its own scope.

**Nota aditiva — o filtro passou a vir MARCADO, e quem o liga é o ESCOPO.** O
parágrafo acima diz que a recusa aponta para o filtro "aptos para agentes",
"senão a regra vira beco sem saída" — e por muito tempo ela foi um: o prop que
abre o seletor com o filtro marcado existia desde a Fase 9c e **nenhuma tela de
produção o passava**. O seletor de um agente abria oferecendo modelo chat-only
cujo clique só existia para ser recusado. As duas telas que gravam num escopo
validado passam a abrir filtradas — `ModelsSection` (agente) e
`AreaModelsSection` (área) —, e a régua de quem liga não é a tela e sim
`assertModelFitsBindingScope`: onde a api RECUSA, o filtro vem marcado; onde ela
não recusa, quem escolhe é a pessoa. Por isso o seletor de SESSÃO continua sem
filtro — marcar ali esconderia modelo que a api aceita. **Isto não elimina o
422**: o filtro cobre uma das três causas, e as outras duas
([RN-043](#rn-043) — desativado no workspace, sumido do provider) seguem
alcançáveis, com o indisponível ainda LISTADO e marcado; o desfecho de recusa da
[RN-470](#rn-470) continua sendo o que conta o que houve. E é estado INICIAL de
um checkbox, não trava: desmarcar volta a listar tudo.

**A consequência: o vigente que o filtro esconde é DITO.** `workspace` e
`project` nunca exigiram tool calling, e as rotas que resolvem o binding de um
agente ou de uma área chamam `ResolveModelBindingUseCase` **sem**
`exigeToolCalling` — então um padrão chat-only desses níveis é resolvido
normalmente e vira o vigente da linha. Com o filtro marcado, o gatilho mostrava
um nome que a lista aberta não continha, sem nenhuma opção marcada. O picker
agora nomeia o modelo e a causa; ele PODE nomear a causa porque só há um filtro
ali. Quando a lista inteira fica vazia, quem fala continua sendo o texto de
lista vazia, que já manda desmarcar — dois avisos sobre o mesmo checkbox seriam
ruído.

**Correção de fato, não do texto acima:** "Only `agent` validates" descreve a
Fase 9a. Desde o [ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)
`area` entra na MESMA validação — ela não é fallback genérico, o único consumidor
do modelo de uma área é um agente dela ([RN-102](#rn-102)) —, e é por isso que
são DUAS as telas que ligam o filtro.

- **Where:** `apps/api/src/domain/llm/model-capabilities.ts:38`;
  `apps/web/src/components/ModelPicker.tsx` (o filtro e o aviso de vigente
  escondido), `apps/web/src/routes/settings/ModelsSection.tsx`,
  `apps/web/src/routes/settings/AreaModelsSection.tsx` (quem o liga)
- **Test:** `test/domain/llm/model-capabilities.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`;
  `apps/web/src/routes/settings/filtro-de-aptos.test.tsx` e
  `apps/web/src/routes/SessionPage.filtro-de-aptos.test.tsx` (as duas telas que
  ligam, e a que não liga)
- **Origin:** [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)

### RN-041 — Token count the provider didn't give is marked as estimated {#rn-041}

When the provider's response doesn't carry `usage`, the OpenAI-compatible
base counts locally with the tokenizer and emits the chunk with
`estimated: true`. The number still serves for billing, but the mark
preserves the difference between **"the provider said zero"** and **"the
provider said nothing"** — and it's what lets the UI qualify the cost
instead of showing a value with no provenance.

The other two providers diverge, and the divergence is normalized, not
hidden: Ollama simply doesn't emit `usage` without the `done` line;
Anthropic can't omit the count, because `usage` is mandatory in its
protocol's `message_start`. The three responses are in
[docs/reference/llm-providers.md](../reference/llm-providers.md#normalized-divergences).

- **Where:** `apps/api/src/infrastructure/llm/openai-compatible-provider.ts:150`
- **Test:** `test/contract/llm-provider.contract.ts` (scenario
  `sem_usage`, run against the three providers)
- **Origin:** [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)

### RN-042 — Metering records who SERVED the call, not just where it came in {#rn-042}

When the call goes through a hub that reports the real provider,
`token_usage` records that provider in `upstream_provider` in addition to
the entry provider. With no hub — or a hub that didn't report — the field
is **`null`**, never an empty string: the cost-by-provider query needs to
distinguish "didn't go through a hub" from "went through one and the hub
didn't say".

In metrics the `upstream_provider` label repeats the provider itself when
there's no hub, so `sum by (upstream_provider)` keeps summing the whole
cost.

- **Where:** `apps/api/src/application/use-cases/llm/record-llm-usage.use-case.ts:58`
- **Test:** `test/application/use-cases/llm/record-llm-usage.use-case.spec.ts`
- **Origin:** [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)

### RN-043 — A discovered model enters disabled; a model that disappears is marked, never deleted {#rn-043}

Catalog sync has three outcomes, and none of them is destructive:

1. **A new model** enters **with no curation row in any workspace**, and
   the absence of a row IS the disabled state. A provider's catalog has
   hundreds of rows — dumping them in active would make choosing
   impossible and would turn on an expensive model without anyone
   deciding. Activating is the owner's curation, and it applies only in
   their workspace ([RN-052](#rn-052)).
2. **A model that disappeared from the remote catalog** receives
   `availability = 'unavailable'` and **stays in the table**:
   `model_bindings` and `token_usage` point to the row, and deleting it
   would take the cost history along with it.
3. **A model that came back** returns to `available` with the curation
   **untouched** — the owner's choice survives a temporary absence from
   the provider.

The two axes are deliberately independent: curation is a person's
decision, `availability` is an observation of the provider. Neither
writes to the other — and since
[ADR 0049](../adr/0049-curadoria-de-modelo-por-workspace.md) they don't even
live in the same table, so sync has no curation field to run over even if
it wanted to.

Three consequences in the rest of the system:

- a **NEW** binding for an inactive or unavailable model is refused in
  the domain (`ModelNotBindableError`, 422). Bindings that already exist
  stand;
- `resolveBinding`'s **cascade** skips the unavailable candidate, records
  what it skipped in `skipped`, and — when the turn carries tools —
  revalidates `supports_tool_calling` at EVERY level. Without that, the
  fallback would land an agent on a chat-only model and silently violate
  [RN-040](#rn-040);
- **a provider that failed doesn't make anything unavailable**: a 401 is
  "I don't know what's there", not "there's nothing there". The provider
  is skipped, with the failure's ORIGIN (`infra` | `modelo`) in the
  report — never diagnosis by elimination.

- **Where:** `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts:160`,
  `apps/api/src/domain/llm/binding-resolver.ts:63`,
  `apps/api/src/domain/llm/model-capabilities.ts:49`
- **Test:** `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`,
  `test/domain/llm/binding-resolver.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`
- **Origin:** [ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)

### RN-044 — Price applies from here on, and old cost still checks out {#rn-044}

Every `token_usage` row records the price that produced its
`cost_micros`. Changing a model's price **doesn't reprice past
consumption** — and more than that: old cost stays **reproducible**,
because `tokens × recorded price` matches the recorded cost even after
three corrections to the `models` table.

Every price change writes a row to `model_price_changes`, append-only,
with the before/after pair and the origin (`manual` | `sync`). The pair
is recorded together on purpose: reconstructing the "before" from the
previous row would depend on no write having escaped the audited path,
which is exactly what the audit exists to prove. A price equal to the
current one is a no-op — a row saying "changed from 10 to 10" would turn
the log into noise.

The rule applies to **every** path that changes price, not just the
screen's. Two writes used to escape it: catalog sync (which changed
price via `upsert`, never producing the `sync` origin the domain had
declared since Phase 9c) and `seed.ts` (which runs on an already-seeded
database — `BRABO_FORCE_SEED=1` in k8s's `bootstrap.sh` — and therefore
silently corrected price). Both now audit, with the seed reusing
`UpdateModelPricingUseCase` itself.

- **Where:** `apps/api/src/application/use-cases/llm/update-model-pricing.use-case.ts:44`,
  `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts:213`,
  `apps/api/src/db/seed.ts:376`
- **Test:** `test/application/use-cases/llm/update-model-pricing.use-case.spec.ts`,
  `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
- **Origin:** [ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)

### RN-189 — Embedding returns one vector per input, or an error {#rn-189}

`embed` is a BATCH operation: it receives N texts and returns N vectors,
**in the same order**. Order is the only link between input and vector,
and that's why a shorter response isn't usable — the i-th vector would
end up belonging to another sentence, and the index would silently go
wrong, with the symptom showing up in SEARCH, weeks later and far from
the cause.

So the contract refuses, rather than degrading, three things: an
incomplete batch, an empty vector, and different dimensions in the same
response. An empty input list is also refused before it goes out over the
network — answering `[]` to it would make the caller record an empty
index thinking it had indexed something.

The result carries four fields, and each answers a question that already
cost dearly somewhere else in the product: `dimensions` is checked
against what CAME BACK (never copied from the catalog); `model` is what
the provider **said** it used, because an alias resolves to a dated
version and it's that name that goes to metering, for the same reason as
the frozen price ([RN-044](#rn-044)); and `inputTokens` comes with
`estimated`, preserving the "the provider said zero" × "the provider said
nothing" distinction from [RN-041](#rn-041).

The error is **thrown**, normalized by `code`, instead of becoming a
chunk like in `chat`. The chunk's reason is to preserve the spend of an
in-progress turn; here there's nothing to preserve — either the provider
returned the vectors and charged, or it didn't return them and didn't
charge. It's the same choice as `listModels`, and the taxonomy is the
same: no new `LLMErrorCode`.

- **Where:** `apps/api/src/application/ports/llm-provider.port.ts:61`,
  `apps/api/src/infrastructure/llm/embedding-result.ts:26`
- **Test:** `test/contract/llm-provider.contract.ts` (five cases, run
  against every provider that declares the capability)
- **Origin:** [ADR 0075](../adr/0075-embeddings-no-contrato-de-llm-provider.md)

### RN-190 — Embedding has a capability in two layers, and the model's is exclusion {#rn-190}

As with tool calling ([RN-040](#rn-040)), the capability has two layers:
the PROVIDER (`capabilities.embeddings`, the ceiling) and the MODEL
(`supportsEmbeddings` on the catalog row). The difference between the two
cases is exactly what the rule exists to state:

- **tool calling is a gradient** — a model that doesn't request tools
  still converses, and that's why only the agent binding is refused;
- **embedding is exclusion** — `nomic-embed-text` doesn't answer a
  question and `llama3.2` doesn't return a vector. They're disjoint sets,
  and the Ollama daemon proves it by answering **`501`** ("This server
  does not support embeddings") to an embedding request with a chat
  model.

`assertCanEmbed` checks both in the order that fails best: the provider
first, because switching models doesn't fix a provider that doesn't
embed. A model **with no declaration** is also refused, with a different
message — absence means "the provider didn't say"
([ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)),
never permission, and the right action for the reader is to sync the
catalog rather than switch models. Deducing the capability from the
model's NAME is forbidden: it would be a guess dressed up as data.

- **Where:** `apps/api/src/domain/llm/embedding-capability.ts:64`,
  `apps/api/src/infrastructure/llm/ollama-provider.ts:319`
- **Test:** `test/domain/llm/embedding-capability.spec.ts`,
  `test/infrastructure/llm/ollama-provider.spec.ts`
- **Origin:** [ADR 0075](../adr/0075-embeddings-no-contrato-de-llm-provider.md)

### RN-191 — `embeddings: true` requires execution, not documentation {#rn-191}

The house rule ([ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)/[ADR 0043](../adr/0043-seis-providers-de-llm-e-o-fechamento-da-fase-9b.md))
applied to the new capability: **only `ollama` declares `true`**, and the
proof is `POST /api/embed` run against the real 0.32.1 daemon with
`nomic-embed-text` — two inputs, two 768-dimension vectors,
`prompt_eval_count: 10`.

The other eight declare `false`, for two distinct reasons:

- **lack of proof** (seven): there's no key for them in the environment,
  and the only paid smoke test that has ever run
  ([acceptance](../explanation/aceite-providers.md)) was for CHAT — in a
  hub, embedding routes to different providers than chat does, and proof
  of one endpoint isn't proof of the other;
- **operation absent** (Anthropic): there's no dedicated embedding
  endpoint, and its docs point to a third party, which is a different
  provider with a different key and a different dialect.

The OpenAI-compatible base's DIALECT is proven separately, with the
contract suite running a second time over it with the capability turned
on. That's what makes it cheap to flip a provider to `true` the day its
key exists: it changes one line of the literal, and the parsing is
already exercised. A provider that declares `false` and still exposes
the method **refuses the call** before touching the network.

- **Where:** `apps/api/src/infrastructure/llm/ollama-provider.ts:73`,
  `apps/api/src/infrastructure/llm/openai-compatible-provider.ts:302`
- **Test:** `test/contract/llm-provider.contract.ts`,
  `test/infrastructure/llm/openai-compatible-provider.contract.spec.ts`,
  `test/infrastructure/llm/ollama-provider.embeddings.smoke.spec.ts`
  (manual, against the real daemon)
- **Origin:** [ADR 0075](../adr/0075-embeddings-no-contrato-de-llm-provider.md)

### RN-045 — An adopted repository is only changed by an approved plan {#rn-045}

Adopting an existing repository **diagnoses without acting**. Adoption
validates access (`getRepo`), writes the project's rows, and produces a
**plan**: the serialized list of what the bootstrap would do, obtained by
calling each step's `check()` — the same one that has provided idempotency
since [RN-029](../business-rules.md#rn-029) — without ever running the corresponding
mutation.

While `repo_bootstraps.plan_decision` is **null**, no mutation runs. The
gate is **before** the executor, not inside it: the bootstrap runner is
the same one from Phase 2, with no filter, and it simply isn't called.
Added to the guard that already skipped protected branches, there's no
code path that touches a branch outside an approved plan.

The two outcomes:

- **approve** is all-or-nothing (approving loose steps would break the
  `dev←main, qa←dev` cascade). What executes is the plan
  **re-derived** at execution time: equal to or smaller than the one
  shown, **never larger** — a branch that turned protected in the
  meantime is skipped;
- **adopt as-is** waives the bootstrap, records the decision, and does
  **not** tamper with the cursor to fake convergence. The plan is kept
  as evidence of what was deliberately not applied.

Deciding on a regenerated plan is refused (409): the decision carries the
`planGeneratedAt` the user saw, and a "yes" given about something else
doesn't count.

Normal provisioning refuses (409) to run on an adopted repository —
without this guard, the resumption path would run the bootstrap on a
third party's repository with no plan at all.

**Known limit:** "divergent protection" here is presence × absence,
because that's all the contract exposes (`GitBranch.protected` is a
boolean, and
[ADR 0028](../adr/0028-protecao-de-branch-divergencia-entre-providers.md)
deferred a normalized `ProtectionPolicy`). A branch with PARTIAL
protection counts as "unprotected" and can be overwritten — but only
within an approved plan.

- **Where:** `apps/api/src/application/use-cases/git/decide-bootstrap-plan.use-case.ts`,
  `apps/api/src/application/use-cases/git/bootstrap-plan.ts`,
  `apps/api/src/application/use-cases/git/bootstrap-steps.ts:112`
- **Test:** `test/application/use-cases/git/decide-bootstrap-plan.use-case.spec.ts`,
  `test/application/use-cases/git/bootstrap-plan.spec.ts`
- **Origin:** [ADR 0044](../adr/0044-adocao-de-repositorio-existente.md)

### RN-046 — Every project repository declares its origin {#rn-046}

`project_repositories.origin` and `repo_bootstraps.origin` say whether
Brabo **created** the repository (`created`) or **adopted** one that
already existed (`adopted`). The origin is written explicitly by whoever
writes the row — not by the column's default — and doesn't change
afterward.

It isn't decoration: it's what makes the product treat as a legitimate
case what Phase 10 had to do by hand (inserting rows into
`project_repositories` and `repo_bootstraps` to point a project at a
fork). An `adopted` repository has its own branch policy, doesn't go
through provisioning, and is only changed per [RN-045](#rn-045).

Migration `0031`'s backfill marks everything that already existed as
`created`, and can be blind about it: adoption didn't exist before it,
so there's no adopted row to misclassify.

- **Where:** `apps/api/src/db/schema/git.ts`, `apps/api/src/db/migrations/0031_special_winter_soldier.sql`,
  `apps/api/src/domain/git/repo-bootstrap.entity.ts`
- **Test:** `test/application/use-cases/git/adopt-repository.use-case.spec.ts`
- **Origin:** [ADR 0044](../adr/0044-adocao-de-repositorio-existente.md)

### RN-047 — Dev agent circuit breaker: N consecutive blocked stops it, without burning budget in a loop {#rn-047}

Each dev agent keeps a counter (`dev_agent_states.consecutive_blocked`)
of how many tasks ENDED `blocked` in a row — locally (in the ToolLoop) or
remotely (the gate's correction ceiling exhausted). On hitting the
per-project ceiling (`max_consecutive_blocked`, default 3), the agent
stops at `idle_tripped` **without trying to claim the next task**. An
approved terminal outcome resets the counter; an individual blocked task
continues the normal flow (returned with a diagnosis, available for a
human to unblock) — the breaker is about the SEQUENCE, not the task.

The only way out of `idle_tripped` is an explicit rearm
(`POST .../agents/:agentId/rearm`, role `developer`): it resets the
counter and the agent starts trying to claim again. There's no automatic
unlock — the same principle as `MarkTaskBlockedUseCase`/`unblock`,
applied to the sequence instead of the task. Rearming an agent that is
**not** tripped is **409**, not silent success: the `dev.rearmed` event
is immutable, and recording it for a rearm that didn't happen would be a
lie in the event log.

A block that comes from OUTSIDE the agent (`QaLeadServer` failing
internally, for example) also needs to wake it — that's why the
`task.gate_resolved` emission lives in `MarkTaskBlockedUseCase`, the
funnel every block passes through, and not in
`RecordGateVerdictUseCase`, which only sees part of them. Without this
the agent would stay in `awaiting_gate` forever, with the task dead and
the breaker's counter never incrementing.

Restarting the engine with an agent in `working` does **not** count
toward the counter: the retained task is blocked with a restart
diagnosis, but that block isn't the agent "burning the ceiling" — it's
the infrastructure going down. The counter only rises when the dev↔gate
cycle itself produces a real `blocked`.

- **Where:** `apps/engine/lib/engine/dev/dev_agent_server.ex` (`finish_task/2`,
  `resume_state/2`), `apps/api/src/application/use-cases/execution/rearm-dev-agent.use-case.ts`,
  `apps/api/src/db/schema/iam.ts` (`projects.max_consecutive_blocked`)
- **Test:** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  (describe `circuit breaker`), `apps/engine/test/engine/dev/dev_rehydrator_test.exs`
  (describe `the four rehydrated states`), `test/application/use-cases/execution/rearm-dev-agent.use-case.spec.ts`
- **Origin:** [ADR 0045](../adr/0045-reagendamento-por-evento-do-dev-agent.md)

### RN-053 — Reactivating execution wakes whoever is stopped, inside the session that already exists {#rn-053}

Activating execution for a project that's **already executing** is
reactivation, not a fresh start: it lands on the current execution
session and wakes the agents that were stopped. Two parts, one on each
side of the system.

**The session is reused.** Activation uses the project's `active` session
that already carries an `execution.activated`; it only creates one when
there's none. There's no column saying "this session is an execution
session" — what distinguishes one is the event it holds, and that's what
gets queried. Closing the session is still the way to start fresh: a
closed one isn't a candidate, and the next activation opens a new one.

Before, `create` was unconditional, and the engine **discards** the new
`session_id` when the agent is already alive. Every click on "activate"
left behind an active session that received the `execution.activated`
and nothing else — the agents' events kept going to the previous
activation's session.

**The agent is woken by wake, not by `work`.** A fresh start triggers the
cycle (`:work` — emits `dev.started` and claims). An agent that was
already alive receives `{:wake, :became_claimable}`, and it's the
server's state guard that decides:

| agent state | what reactivation does |
|---|---|
| `idle` | claims the next task |
| `working`, `awaiting_gate`, `awaiting_approval` | nothing — the in-progress task isn't abandoned |
| `idle_tripped` | nothing — only the explicit rearm unlocks it ([RN-047](#rn-047)) |

Firing `:work` for everyone would be worse than the defect: it claims
unconditionally, and for an `awaiting_gate` agent it would mean dropping
the worktree the gate is sweeping — on top of bypassing the circuit
breaker with a click.

- **Where:** `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/session.repository.ts`
  (`findActiveExecutionSession`),
  `apps/engine/lib/engine_web/controllers/execution_command_controller.ex`
  (`acordar/4`)
- **Test:** `test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  (describe `reactivation doesn't open an orphan session`),
  `test/infrastructure/persistence/session-execution.repository.spec.ts`,
  `apps/engine/test/engine_web/controllers/execution_command_controller_test.exs`
  (describe `reactivation`)
- **Origin:** finding #11 of the
  [first dogfooding](../explanation/primeiro-dogfooding.md)

### RN-048 — Story promotion is the user's by default; the mode changes who triggers it, never what gets validated {#rn-048}

`projects.story_promotion` chooses WHO promotes a story from `draft` to
`ready`:

- **`manual`** (new project's default): the PO leaves the story complete
  and it stays `draft` with `stories.proposed_ready = true`. **None of
  its tasks are claimable** — `claimNext` requires `story.status =
  'ready'` — and it's the user who promotes it, individually or in
  batch, from the Backlog.
- **`auto`**: the PO promotes on its own upon finishing a complete story.
  This is the behavior that predates Phase 12c, kept as an explicit
  option.

**The mode changes the trigger, not the criterion.** Both paths go
through `assertPromotable` — readiness (RF/DoD/DoR/rule) and modules
resolved against the current `module_map` — and that's what the symmetry
test in `story-promotion.spec.ts` locks down: for every story,
`isPromotable` agrees with what `assertPromotable` raises. Before the
phase, validation was duplicated and asymmetric (creation called
`canBecomeReady`, transition called `assertReady` +
`assertModulesResolved`): two doors to the same state, with different
locks. Making the trigger configurable required unifying them first, or
else "promote via the UI" and "promote on creation" would be distinct
rules with the same name.

An **incomplete** story is never proposed. `proposed_ready` only turns on
when the story would already pass validation — proposing what the domain
would refuse would push the PO's work onto the user disguised as a
decision.

**Refusal** returns the story to the PO: it records
`returned_reason`/`returned_at`, turns off `proposed_ready`, emits
`backlog.story_promotion_returned`, and injects the reason as a PINNED
message in the PO's session, with the same precedence wording as a gate
returned to the dev (a lesson from ADR 0020). The refusal is recorded
**before** talking to the engine, and the engine failing doesn't undo
it — it's the reverse of the rearm order in [RN-047](#rn-047), and for a
reason: there the event asserts something ABOUT the engine, here it
asserts something about the user, which is true whether or not there's a
PO standing by to listen.

Batch promotion is **not all-or-nothing**: each story is its own
transaction, and one that lost readiness between the proposal and the
decision comes back `failed` with the reason, without knocking down the
others the user just reviewed.

The `backlog.story_transitioned` event records the **real actor** —
`user` on manual promotion, `agent/po` on automatic. The event log is
immutable and it's what the audit reads: recording the PO on a user's
decision would erase exactly the human step the rule exists to give
back.

Migration `0033` does a **directed** backfill, not a blind one: the
column is born `manual` and every project that already existed is moved
to `auto`. The new default applies to whoever comes afterward; an
in-progress project can't stop producing because of a deploy.

- **Where:** `apps/api/src/domain/backlog/story-promotion.ts`,
  `apps/api/src/db/migrations/0033_absurd_domino.sql`,
  `apps/api/src/application/use-cases/backlog/promote-stories.use-case.ts`,
  `apps/api/src/application/use-cases/backlog/return-story.use-case.ts`,
  `apps/engine/lib/engine/agents/po_server.ex` (`revision_message/1`)
- **Test:** `test/domain/backlog/story-promotion.spec.ts` (symmetry),
  `test/db/story-promotion-migration.spec.ts` (directed backfill),
  `test/application/use-cases/backlog/promote-stories.use-case.spec.ts`,
  `test/application/use-cases/backlog/return-story.use-case.spec.ts`,
  `apps/engine/test/engine/agents/po_server_test.exs` (describe `revise/2`)
- **Origin:** [ADR 0046](../adr/0046-promocao-de-story-com-autoridade-do-usuario.md)

### RN-049 — Every decision on a proposed action stays in the event log, with who decided {#rn-049}

`proposed_action.created`, `.approved`, and `.denied` are domain events in
`session_events`, in addition to the outbox rows that carry them to the
engine. The outbox is **not** memory: it's drained, marked with
`processed_at`, and pruned.

`actor` is who really decided — the **user** on `.approved`/`.denied`,
the **agent** that proposed on `.created`. And `created.payload.status`
says how the action was born (`pending`, `auto_approved`, `denied`).

That yields the distinction that gives the metric: **human decision =
`proposed_action.approved` event**; policy deciding alone shows up only
in `.created` with `status: auto_approved` and an agent actor, and is
never confused with a click. That count — "approval clicks" — was
exactly what Phase 10 wanted to measure and couldn't, because the
decision existed nowhere queryable (finding #17). `approve_always`
counts as an approval because it delegates to the same use case, and
emits `permission.granted` on top.

Left out, by decision: the `proposed_action.created` that the repository
bootstrap emits directly to the outbox. Those mutations are already
narrated by `bootstrap.step_*` in the same session, and duplicating them
would count the same fact twice in an approval metric.

- **Where:** `apps/api/src/application/use-cases/actions/propose-action.use-case.ts`,
  `.../approve-action.use-case.ts`, `.../deny-action.use-case.ts`
- **Test:** `test/application/use-cases/actions/approve-deny-action.use-case.spec.ts`
  (describe `the decision in the event log`)
- **Origin:** [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md)

### RN-050 — With no PR open, no gate opens {#rn-050}

The dev agent proposes commit, push, and PR and **reads each one's
outcome**. It only opens the gate if all three executed. If one stayed
`pending` — the agent's autonomy at `require_approval` — it enters
`awaiting_approval`, **holding the worktree**, and opens no gate at all.

Without this the gate opened regardless, and the damage was silent: QA
scans the **worktree**, not the PR; it found the files, approved; SecOps
approved; the task closed as completed — **with not one line committed
and no PR at all**. Only later, when approving the commit, would the
user see the action fail (with an empty diagnosis, because
`System.cmd` on a deleted directory returns `{"", 2}`).

What releases the agent is `task.pr_settled`, emitted by the api when
`pr_open` reaches a terminal outcome: `opened: true` opens the gate;
`opened: false` (denied or failed) returns the task with a diagnosis,
instead of leaving the agent waiting forever for a gate no one is going
to open.

A denied PR **doesn't count toward the circuit breaker** of
[RN-047](#rn-047): the decision was the user's, not the agent burning
the ceiling — the same principle as restart recovery.

This rule also eliminates D5 (worktree recycled under pending approval)
as a consequence: the worktree is only released on `gate_resolved`, the
gate only opens after the PR, and the PR only opens after commit and
push.

- **Where:** `apps/engine/lib/engine/dev/agent_io.ex` (`propose/3`),
  `apps/engine/lib/engine/dev/dev_agent_server.ex` (`abrir_gate/1`,
  `aguardar_aprovacao/2`),
  `apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts`
  (`settlePrOpen`)
- **Test:** `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  (describe `pending approval doesn't open a gate`)
- **Origin:** [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md)

### RN-051 — A manually typed price beats the provider's catalog {#rn-051}

A `models` row with `manual_pricing = true` has a number someone typed
after reading the provider's docs. Catalog sync **doesn't touch it** —
not even when the remote catalog brings its own price. That's what the
schema always said ("whoever syncs price CANNOT overwrite a row marked
here without an explicit decision") and what the code didn't do: the
remote always won whenever it brought a price, and the next sync would
undo the correction of whoever had fixed a wrong number.

The rule exists because for several providers the typed number is the
**only one that exists**: NVIDIA NIM and Bitdeer don't publish
per-token price in any doc
([providers reference](../reference/llm-providers.md)), and the seeded
value is a market approximation. Letting the remote catalog overwrite
that would trade one known approximation for another, with no one
deciding.

A NEW model is born with the flag coming from the catalog, not from a
fixed default: discovered **with** a price, `manual_pricing = false`
(the source is the sync, and it's the one keeping the row up to date);
discovered **without** a price, `true` — the row is waiting for someone
to type one, and flagging it already protects that number from the
first catalog that decides to report a price.

- **Where:** `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts`
  (`resolverPreco`), `apps/api/src/db/schema/llm.ts:137`
- **Test:** `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
  (`manually typed price beats a catalog that REPORTS a price`)
- **Origin:** [ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)

### RN-052 — Model curation applies only to the workspace that decided it {#rn-052}

Turning a model on or off in the selector is a decision **of that
workspace**, and doesn't reach its neighbor. The catalog itself stays
global — name, price, window, and capabilities are provider facts, the
same for everyone, and duplicating them per workspace would create N
truths about the same model on top of splitting `token_usage.model_id`
in half.

Before this, `models.is_active` was a column for the whole installation:
whoever clicked "activate" decided for every workspace, and the screen
gave no sign of that at all. The practical effect was one workspace
turning on an expensive model in another's selector — and the spend
showing up in the budget of someone who decided nothing.

Three derived rules:

1. **Absence of a row is the disabled state.** There's no separate
   "never decided" state; a model the sync discovered has no row and
   doesn't show up in the selector ([RN-043](#rn-043)).
2. **Disabling is `UPDATE`, not `DELETE`.** Deleting the row would also
   delete who decided and when. Reads treat both cases as inactive; the
   record exists for whoever audits.
3. **The `agent` and `session` scopes don't check curation.** Neither
   has a workspace anchor — agent binding is by global slug. The check
   receives `null` and only checks availability, leaving the gap
   explicit instead of guessing a workspace.

- **Where:** `apps/api/src/db/schema/llm.ts` (`workspace_models`),
  `apps/api/src/application/use-cases/llm/set-models-active.use-case.ts`,
  `apps/api/src/application/use-cases/llm/set-model-binding.use-case.ts`
  (`workspaceDoEscopo`)
- **Test:** `test/application/use-cases/llm/set-models-active.use-case.spec.ts`
  (`activating in one workspace does NOT turn on the model in its neighbor`)
- **Origin:** [ADR 0049](../adr/0049-curadoria-de-modelo-por-workspace.md)

### RN-061 — A TOOL failure is also an event, and goes back to the model {#rn-061}

A tool call's result is never discarded. It becomes `tool.result` in the
event log (`ok`, and when it fails, `erro`), the agent **says** what
happened in the thread, and the reason **goes back to the model** in the
`tool` role — for it to correct and reemit on the next turn. A tool
error is input to the loop, not the end of the line.

The Creative agent was the only one that discarded it
(`_ = EmitArtifact.run(args, state)`) — the PO and the Architect already
fed it back. In a real execution the model emitted `titulo`/`descricao`
against a schema that requires `title`/`description`/`origin`: the
**four business rules from the conversation were refused**, no event was
recorded, and it kept saying "I recorded the rules" with an empty panel.

The tool's description now NAMES each type's required fields, in
English and with a filled-in example — including that
`business_rule.origin` is a **non-empty list** of `seq` from the
messages that originated the rule, not free text. Without that the model
guesses, and guesses in the conversation's language.

It's the same rule as [RN-059](#rn-059) applied to the other failure
path: two policies for the same problem would be two chances to swallow
the error.

- **Where:** `apps/engine/lib/engine/agents/criativo_server.ex` (`dispatch_tool`,
  `realimentar`), `apps/engine/lib/engine/harness/tools/emit_artifact.ex`
  (`descricao/0`), `apps/engine/lib/engine/harness/artifact_schemas.ex`
  (`required/1`)
- **Test:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (`a refused tool becomes a tool.result with an error, and the agent speaks`)
- **Origin:** PHASE 13b real execution

### RN-065 — One module_map per SESSION; revision is another session {#rn-065}

`create_module_map` refuses a second emission **within the same
session**, with a message stating the next step. Between sessions the
map keeps versioning (`version + 1`, `findCurrent` returns the highest)
— revising architecture is desired behavior.

The distinction is the point: between sessions, a new emission is a
**revision**; within the same one, it's the model **re-deciding from
scratch**. In a real execution the Architect emitted four maps in a row,
with different names and cuts each time —
`greeting`, `hello_core`, `greeting`, `hello-api-core` — and the loop
only ended because the network dropped
(`%Req.TransportError{reason: :timeout}`).

The refusal goes back to the model via the tool-result ([RN-061](#rn-061)):
it reads that one already exists and moves on to
`assign_story_modules`, which is step 2 of its kickoff. That's why the
turn does **not** end when the map is emitted — the Architect still has
three steps ahead (linking stories, proposing an ADR, recording
tensions), and ending there would kill all three.

- **Where:** `apps/api/src/application/use-cases/architecture/create-module-map.use-case.ts`
- **Test:** `test/application/use-cases/architecture/create-module-map.use-case.spec.ts`
  (`refuses the SECOND map of the same session`; and cross-session
  versioning is still proven alongside)
- **Origin:** PHASE 13b real execution

### RN-066 — Every response about modules carries the canonical names {#rn-066}

The Architect **has no tool to read** the current module_map. That's
why the three responses it gets about modules need to state the names:

1. A successful `create_module_map` returns the modules **as the api
   recorded them** — not just the version.
2. A refused `assign_story_modules` lists the **valid** modules, in
   addition to the nonexistent ones.
3. `create_module_map` refused by [RN-065](#rn-065) says **which**
   modules the session already defined, not how many.

With no map at all there are no names to offer, and an empty list reads
as "guess again": that path names the real problem — kickoff step 1 is
missing.

The reason is concrete. In a real execution the Architect emitted the
map (`saudacao`, `api_http`), couldn't reread it, and resorted to brute
force: 18 guesses in a row — `api`, `core`, `http`, `greeting`,
`domain`, `web`, `hello-api`, `hello`, `greeting-api`, `saudacao`,
`app`, `server`, `publico`, `public-api`, `api-publica` — until it hit
**one by luck**. In its own words in the event log: *"I'll figure out
the valid names by testing plausible candidates"*.

The damage wasn't the waste, it was the result: the **four** stories
ended up in the same module (`saudacao`), including the endpoint's,
`api_http` ended up with no story at all, and the outcome asserted
*"All 4 stories were successfully linked to modules"*. Since execution
spins up **one dev agent per module**, the designed architecture
wouldn't be the one built.

The loop from [RN-065](#rn-065) was a symptom of this: the Architect kept
reemitting the map precisely to try to pin down names it couldn't read.

- **Where:** `apps/api/src/application/use-cases/architecture/assign-story-modules.use-case.ts`,
  `apps/api/src/application/use-cases/architecture/create-module-map.use-case.ts`,
  `apps/engine/lib/engine/harness/tools/create_module_map.ex`
- **Test:** `test/application/use-cases/architecture/assign-story-modules.use-case.spec.ts`
  (`the refusal lists the VALID modules`; `with no module_map, it directs
  creating the map`) and
  `create-module-map.use-case.spec.ts` (`the refusal says WHICH modules
  there are`)
- **Origin:** PHASE 13b real execution

### RN-067 — Every session is born emitting `session.created` {#rn-067}

`CreateSessionUseCase` is the **only** place that creates a session. It
emits `session.created` to the outbox **in the same transaction** as the
insert, and it's that event that makes the engine spin up the session's
`SessionServer`.

Whoever called `sessions.create(...)` directly produced a session the
engine never knew about. The effect is a silent cascade:

- the Phoenix channel replies `REFUSED JOIN` forever — the UI only
  complains in the console and keeps retrying every 10 seconds;
- with no channel there's no live update: the thread stays stuck on the
  typing indicator, even with the agent already `idle`;
- no one hits the heartbeat, and since it's the heartbeat that closes
  the session ([RN-064](#rn-064)), it stays `active` **forever**.

Three paths did this: `provision-repository` (two calls),
`adopt-repository`, and `activate-execution` — the last of which creates
the session where the **dev agents** run.

The proof by contrast, from a real execution: the wizard's session had
no `session.created`, had an empty `engine.session_states`, and
`REFUSED JOIN`; the session opened via the normal route had the event,
the state row, and `JOINED`.

The test is about the SOURCE on purpose: a behavior test would prove one
path at a time, and the defect here is the path no one thought of.

- **Where:** `apps/api/src/application/use-cases/sessions/create-session.use-case.ts`
  (the owner), `git/provision-repository.use-case.ts`,
  `git/adopt-repository.use-case.ts`,
  `execution/activate-execution.use-case.ts` (the callers)
- **Test:** `test/application/use-cases/sessions/toda-sessao-emite-created.spec.ts`
  (`only CreateSessionUseCase calls sessions.create`)
- **Origin:** PHASE 13b real execution

### RN-068 — The dev agent reads the worktree without asking permission {#rn-068}

Activating execution seeds two command families into the project's
`allow`: **reading the worktree itself** (`ls`, `pwd`, `find`, `cat`,
`head`, `tail`, `grep`, `wc`, `echo`, `git status`, `git diff`, `git
log`) and **build and test**.

The second already existed: `ReportDone` only lets a PR open after a
`terminal` with `exit 0`. The first was added because the agent
**looks before it builds**, and without it it couldn't get started.

The reason is concrete. A pending `:pipeline` tool returns
`proposed_action <id> status pending` as the RESULT — not the command's
output — and the ToolLoop moves on. On a freshly provisioned repository,
every `ls -la` from the agent fell into approval, taught it nothing, and
burned an iteration. In a real execution the outcome was
`toolloop.limit_reached {iteration: 8, max_iterations: 8}`, task blocked
for "iteration limit reached", with not one line written — and the
approvals the user granted arrived after the loop was exhausted.

Freeing up reads doesn't loosen the pipeline, and that's what the test
asserts: `deny` beats `allow`, `BUILTIN_DENY_PATTERNS` stay active,
matching is by TOKEN prefix (an allowed `ls` doesn't allow `lsof`), and a
composite command requires EVERY segment to match — `ls && rm -rf /`
doesn't pass because of the `ls`.

The allowlist is mitigation, not a solution: it's a list of foreseen
commands and the model invents commands. The structural fix — the agent
WAITING for the decision instead of burning iterations — is in
[ADR 0052](../adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md).

- **Where:** `apps/api/src/domain/actions/dev-terminal-patterns.ts`,
  seeded by `application/use-cases/execution/activate-execution.use-case.ts`
- **Test:** `test/domain/actions/dev-terminal-patterns.spec.ts`
  (`allows ls -la`; `a composite command doesn't hitch a ride on the
  allowed segment`)
- **Origin:** PHASE 13b real execution

### RN-143 — A read-only git subcommand is only allowed anchored by the flag that makes the read unambiguous, never by the bare verb {#rn-143}

Querying a real execution's database, dev agents burned dozens of manual
approvals on exploration subcommands — `git branch -a`, `git
remote -v`, `git worktree list`, `git show origin/dev --stat`, `git log
--all --oneline --graph`, `git for-each-ref`, `git ls-tree -r origin/dev
--name-only`, `git config user.name` — none covered by [RN-068](#rn-068),
which only allowed `git status`/`diff`/`log` (with no extra flags).
Since prefix-by-token matching requires EVERY segment of a composite
command to be in `allow`, a long exploration chain fell entirely into
`require_approval` the moment ONE of these subcommands showed up in the
middle.

`DEV_TERMINAL_ALLOW_PATTERNS` gained
`git branch -a/-r/-v/--list/--show-current`, `git remote -v`/`git remote
show`, `git worktree list`, `git show`, `git for-each-ref`, `git
ls-tree`, `git rev-parse`, and `git config --get`. `git log` didn't need
a new pattern: matching is already by token PREFIX (extra trailing
tokens are allowed), so `Terminal(git log)` already covered `git log
--all --graph --oneline --decorate`.

**The caution here is the same one RN-068 already shows for
`ls`/`lsof`, applied to verbs with a MUTATING sibling that accepts the
same truncated form of the pattern.** `Terminal(git branch)` would match
`git branch -D nome` (deletes) just as much as `git branch nome-nova`
(creates) or `git branch` alone — the pattern doesn't see what comes
AFTER the prefix it checked. That's why none of the four verbs with a
mutating form (`branch`, `remote`, `worktree`, `config`) was admitted by
the bare verb; each was ANCHORED by the flag that makes the read
unambiguous regardless of anything that follows it:

- `git branch` — anchored on `-a`/`-r`/`-v`/`--list`/`--show-current`,
  never the verb alone; `-D`/`-d`/`-m`/`-M` (delete/rename) and a bare
  branch name (create) stay out.
- `git remote` — anchored on `-v` and `show` (which only accepts a
  remote name afterward, always a read); `add`/`remove`/`set-url` stay
  out.
- `git worktree` — anchored on `list`; `add`/`remove`/`prune` stay out.
- `git config` — only `--get` was admitted, because it's the only flag
  git itself guarantees is a read regardless of what follows (a key, or
  a key + value pattern). `git config user.name`/`git config
  user.email` WITHOUT `--get` were deliberately left out: a second
  token after the key (`git config user.name "new value"`) is a WRITE,
  and prefix matching doesn't distinguish "no more tokens" from "one
  more token" without inventing a new argument-counting parser — the
  same limitation that already blocks a bare `git branch`.
  `--global`/`--system` were never anchored.

- **Where:** `apps/api/src/domain/actions/dev-terminal-patterns.ts`
- **Test:** `test/domain/actions/dev-terminal-patterns.spec.ts` (describe
  `read-only git subcommands (found live)` — covers the composite chain
  observed live auto-approving, and each mutating variant with the SAME
  command word — `git branch -D`, `git remote add`, `git worktree add`,
  `git config --global user.name` — staying in `require_approval`)
- **Origin:** query against a real session's database, found during use

### RN-069 — Retrying a task recreates the branch, doesn't fail {#rn-069}

`WorktreeManager.add_worktree/3` uses `git worktree add -B` (creates
**or** resets), not `-b`. It already removed the previous worktree's
directory, but left the branch behind — and since its name comes from
the task's slug, the second attempt on the SAME task always fell into
`fatal: a branch named 'feature/<slug>' already exists`.

The effect was permanent: unblocking the task didn't help, reactivating
execution didn't help, and the circuit breaker disarmed with no way
out. In a real execution the only way out was a manual
`git worktree prune` in the project's workspace.

Resetting is the right call: the previous worktree has already been
removed, that attempt's work is worthless (the task went back to the
queue), and the branch is reborn from the current point of `work_dir`.

- **Where:** `apps/engine/lib/engine/dev/worktree_manager.ex`
- **Test:** `apps/engine/test/engine/dev/worktree_manager_test.exs`
  (`retrying the SAME task recreates the worktree instead of failing`)
- **Origin:** PHASE 13b real execution

### RN-070 — Every declared gate points to the evidence that proves it {#rn-070}

No entry in `docs/gates.yml` exists without `evidencia`, and the
registry can't claim more than it verifies: a `block` gate requires
`verificacao: script`, and a `planned` gate carries no evidence of
something that hasn't happened yet.

Evidence is a **locator**, not prose: `event_log` carries the event
types and the payload filter that distinguishes them from their
neighbors; `teste` and `ci` carry the path, and a target that
disappeared FAILS. It's the same failure mode the docmap calls a dead
glob — a rule that never fires and fakes coverage.

Three types because not every gate lives in the event log:
[`merge-protegida`](../business-rules.md#rn-014) is a ceiling in a pure rule that emits no
event of its own (what guarantees it is a test) and `backmerge` is CI
with state in `.release/gate.json`. Downgrading them to `warn` for that
reason would lie about the product's hardest locks.

The filter matters as much as the type: `qa-verificada` and
`secops-segura` record the SAME `pr.gate_changed`, and the same type
fires on the gate's OPENING with no `veredito` — without the filter,
opening would count as passing. The same holds for the two infra PR
gates. That's why no (`event_types` + `filtro`) pair can repeat.

The filter only reaches the PAYLOAD, on purpose: accepting an arbitrary
column would open up the whole query. Who promoted a story (human or
the PO) lives in the `actor_kind` column and stays outside the
declarative vocabulary.

- **Where:** `apps/api/src/domain/gates/gate-registry.ts`, registered in
  `docs/gates.yml`, measured in `apps/api/scripts/validacao-gates.ts`
- **Test:** `apps/api/test/domain/gates/gate-registry.spec.ts`
  (`is valid: no accumulated problem`; `no (event_types + filtro) pair
  repeats between gates`)
- **Origin:** PHASE 15a (ADR 0054)

### RN-071 — The four user-authority gates cannot be declared automatic {#rn-071}

`acao-aprovada`, `story-promovida`, `plano-de-adocao`, and
`merge-protegida` have `aprovacao_humana: true` by construction. The
list lives in the DOMAIN (`GATES_HUMANOS_IMUTAVEIS`), not in the test:
touching it has to be a deliberate act, reviewed like code.

`aprovacao_humana: true` means the decision is the user's — directly by
a click, or delegated by a policy they themselves wrote in
`permissions.json`. That's what lets `acao-aprovada` coexist with
`status: auto_approved`: policy deciding alone is the user having
decided beforehand. `merge-protegida` is the case where not even the
delegation exists — the ceiling downgrades `auto_approve` to
`require_approval` even with autonomy turned on.

The opposite also fails: an id in the list with no matching gate is a
dead rule, pointing at nothing.

- **Where:** `apps/api/src/domain/gates/gate-registry.ts`
  (`GATES_HUMANOS_IMUTAVEIS`); the ceiling in
  `apps/api/src/domain/actions/decide.ts`
- **Test:** `apps/api/test/domain/gates/gate-registry.spec.ts`
  (`%s cannot have aprovacao_humana false`); the ceiling in
  `apps/api/test/domain/actions/decide.spec.ts`
- **Origin:** PHASE 15a (ADR 0054)

### RN-072 — With no explicit choice, the model is the Creative agent's {#rn-072}

When the binding cascade lands on the **workspace** default — that is,
no one decided anything for this project — the inherited model is the
**Creative** agent's, not the global default.

The Creative agent is always a project's entry door: it's the one the
first conversation happens with, and its binding represents "the model
this project uses to think".

Inheritance fills the **gap**, never overrides: session, agent, or
project bindings are someone's explicit choices and still win. That's
why it's a step AFTER the cascade and not a new scope within it — it
doesn't compete for precedence. And the inherited model passes through
the same filters: gone from the catalog or with no tool calling means
it isn't inherited, for the same reason the cascade skips them
([RN-043](#rn-043)).

What this fixes: the workspace default is global and tends to be a
small local model. A new session and a dev agent — which have no
binding of their own — used to be born in it, and
[ADR 0020](../adr/0020-destravar-gates-qa-secops.md) forbids a small local
model at the semantic step. In a real execution, the model had to be
switched by hand in every open session, and the three dev agents came
up on `llama3.2:1b` with no one having asked for it.

- **Where:** `apps/api/src/domain/llm/binding-resolver.ts`
  (`herdarModeloDeStart`), applied in
  `application/use-cases/llm/resolve-model-binding.use-case.ts`
- **Test:** `apps/api/test/domain/llm/binding-resolver.spec.ts`
  (`fills the gap`; `does NOT override %s's explicit choice`)
- **Origin:** findings B and O of the real execution (PHASE 13c, phase A)

### RN-073 — A pending approval SUSPENDS the loop, doesn't burn it {#rn-073}

When a pipeline tool returns `pending`, the ToolLoop **stops** and the
dev agent enters `:awaiting_approval`, holding onto the task, the
worktree, and the loop's history. The user's decision emits
`task.action_settled`, which wakes it: the real result takes the place
where the word "pending" would be, and the loop resumes from where it
stopped.

Two properties the test locks down:

- **Nothing is recorded while waiting.** The tool message's slot stays
  empty. Recording "pending" there would tell the model that's what the
  command answered — which was exactly the defect.
- **A refusal is a response.** The reason takes the result's place and
  the agent learns that path closed, instead of waiting forever for
  something no one is going to approve. It's the same principle as
  `pr_settled` with `opened: false` ([RN-047](#rn-047)), one level down.
- **The wake has to ARRIVE.** `task.action_settled` is born on the
  `task` aggregate, not on the `proposed_action` the table name
  suggests: the engine's drain reads a closed list of aggregates
  (`session` and `task`). Emitted outside that list, the event is
  recorded successfully, stays with a null `processed_at`, and is never
  even read — no job, no error, no log, and the agent waits forever.
  The contract crosses two languages, and that's why it's pinned on
  both sides.

If the engine **restarts** during the wait, the rule no longer applies
to that task: the suspended loop only exists in memory, so it goes back
to the queue blocked with origin `infra`, and the decision made
afterward has nowhere to be applied. Blocking with a diagnosis is
deliberate — the alternative was the silent eternal wait, which is
exactly what this rule exists to end.

What this fixes: `pending` used to come back as the tool's RESULT and
the loop kept going. The model read that as the command's answer,
learned nothing, tried something else — and each attempt burned an
iteration until `toolloop.limit_reached {iteration: 8,
max_iterations: 8}`, with the task blocked for "iteration limit
reached" with not one line written. The approvals granted arrived
after the loop was exhausted and were useless.

The terminal allowlist ([RN-068](#rn-068)) still applies, but stops
being the only defense: it's a list of foreseen commands, and the model
invents commands.

- **Where:** `apps/engine/lib/engine/harness/hooks/action_pipeline.ex`,
  `harness/tool_loop.ex`, `dev/dev_agent_server.ex`,
  `workers/dev_agent_wake_worker.ex`; emission in
  `apps/api/src/application/use-cases/actions/{approve,deny}-action.use-case.ts`
- **Test:** `apps/engine/test/engine/dev/dev_agent_awaiting_approval_test.exs`
  (`pending action STOPS the agent`; `approved: resumes the loop with
  the REAL output`; `restart during the wait BLOCKS the task`) and
  `apps/engine/test/engine/dev/wake_do_outbox_ao_agente_test.exs`, which
  walks the whole chain — outbox, drain, queue, and process — because
  the per-link tests were all green with the delivery broken; the
  aggregate is pinned on the api side in
  `apps/api/test/application/use-cases/actions/approve-deny-action.use-case.spec.ts`
- **Origin:** [ADR 0052](../adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md),
  triage phase A

### RN-135 — Activating execution closes the CHAT session that originated the request {#rn-135}

`ActivateExecutionUseCase` always resolved the EXECUTION session
(`findActiveExecutionSession`, or created a new `criativa` one), but
never transitioned the CHAT session the click on "activate execution"
came from — the Dev Lead/PO conversing in a separate session. It stayed
`active` forever, even with execution already running on its own in
another session, and kept showing up as an open conversation in the
list.

`execute()` gained `originSessionId`, optional and last — an old caller
(today only activation from Overview, with no session context) keeps
working IDENTICALLY, closing nothing. When passed, at the END of the
method (after everything else has happened: module_map, areas,
autonomy, `startExecution`, `execution.activated`):

- **never closes the execution session itself** — if `originSessionId`
  equals the session that just received `execution.activated`, closing
  is skipped, because closing it would destroy the process the dev
  agents just gained;
- **only closes what's `active`** — the same caution as
  `decide-bootstrap-plan.use-case.ts#fecharSessao`, nothing to do if
  the session no longer exists or is no longer open;
- **reuses `GetSessionPendingWorkUseCase`** ([RN-073](#rn-073)) — the
  SAME guard that holds off closing on inactivity heartbeat: an offered
  handoff, a pending `proposed_action`, or an agent `working` with no
  subsequent `idle` prevent closing;
- goes through `closing` before `closed` — the state machine
  (`active -> closing -> closed`) doesn't allow the direct jump.

A failure or pending state here NEVER propagates to whoever called
`execute()`: the
ativação da execução já aconteceu e é o efeito principal; fechar o chat de
origem é um efeito colateral *best-effort*.

- **Onde:** `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts`
  (`closeOriginSession`), `apps/api/src/interfaces/http/execution/dto/activate-execution.dto.ts`
  (`originSessionId`), `apps/api/src/interfaces/http/execution/execution.controller.ts`
- **Teste:** `apps/api/test/application/use-cases/execution/activate-execution.use-case.spec.ts`,
  describe `fecha a sessão de origem (RN-135)` — fecha sem pendência,
  NÃO fecha com pendência, NÃO fecha sessão já não-`active`, chamador
  antigo sem o parâmetro não fecha nada, e nunca fecha a própria sessão de
  execução mesmo se `originSessionId` coincidir com ela
- **Origem:** achado de investigação de código — sessão criativa com
  execução ativada continuava `active` na lista mesmo com 35 eventos de
  dev agents dentro dela

### RN-074 — A saída de terminal tem teto de bytes {#rn-074}

A saída de um comando é cortada em `TERMINAL_OUTPUT_MAX_BYTES` (default 32 KiB)
antes de virar resultado da ferramenta, e o corte deixa uma **marca** dizendo os
dois tamanhos e o que fazer:

```
[saída truncada: 32768 de 1048576 bytes. Refine o comando (head, grep,
-maxdepth) para ver o que falta.]
```

Três propriedades que o teste fixa:

- **O teto é `>`, não `>=`.** Saída que cabe exatamente no limite passa
  intacta — marcá-la faria o modelo refinar um comando que já deu tudo.
- **O corte não parte caractere multibyte.** `binary_part/3` corta por byte;
  cair no meio de um `é` produz binário inválido que quebra a serialização
  JSON antes de o resultado chegar ao modelo.
- **`raw_bytes` continua sendo o tamanho REAL produzido**, não o truncado. É
  medição, e mentir nela esconderia justamente o comportamento que motivou o
  teto. Quem quiser detectar truncagem compara `byte_size(stdout)` com
  `raw_bytes`.

O que isso conserta: a saída de cada comando fica no histórico do laço e viaja
em **todo** turno seguinte. Sem teto, um `find` numa árvore grande basta — a
execução do `hello-limpo` morreu com `{413, "request entity too large"}` no
turno 18, sem uma linha escrita. O estouro é de **bytes da requisição**, não de
janela de contexto: a maior chamada bem-sucedida tinha 28.993 tokens de entrada.

A marca é endereçada ao **modelo**, não ao humano — sem dizer o que fazer, ele
tende a repetir o mesmo comando.

- **Onde:** `apps/engine/lib/engine/actions/terminal_executor.ex`
  (`truncate/2`), teto em `apps/engine/config/runtime.exs`
- **Teste:** `apps/engine/test/engine/actions/terminal_executor_test.exs`
  (describe `teto de bytes da saída`)
- **Origem:** achado S de
  [achados-execucao-real.md](../explanation/achados-execucao-real.md), Fase F do
  [backlog](../explanation/backlog.md)

### RN-075 — Comando de terminal é avaliado por onde toca, não só pelo verbo {#rn-075}

A pasta do projeto (`<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>` — o
UUID puro num projeto de antes do [RN-109](../business-rules/autenticacao.md#rn-109), `<slug>-<8 chars do
id>` num projeto novo) é o **escopo**.
Um comando de `terminal` que toca qualquer caminho fora dela **nunca** é
auto-aprovado, por mais que o verbo esteja em `allow`. Dentro dela, `cd` deixa
de exigir permissão — ele é a declaração de escopo, não um verbo.

Quatro propriedades que os testes fixam:

- **Aperta:** `Terminal(cat)` liberado deixa de auto-executar
  `cat /workspace/apps/engine/.../git_executor.ex`. Era o achado U: o
  casamento é por VERBO, então o agente lia o código da plataforma que o
  executava, e alcançava o worktree de outros projetos.
- **Afrouxa:** `cd <dentro> && cat README.md` vira `auto_approve`. Era o
  defeito mais caro da escada — o dev agent emite sempre `cd <caminho> &&
  <verbo>`, `cd` não estava em `allow` nenhum, e comando composto exige que
  TODOS os segmentos casem.
- **Permite sem isentar:** dentro do escopo, verbo fora do `allow` continua
  pedindo. Estar na pasta do projeto não torna `curl … | sh` seguro.
- **Fora do escopo é `require_approval`, nunca `deny`:** o agente pode ter
  razão legítima para olhar fora, e a decisão continua sendo do usuário.

`deny` continua vencendo primeiro, e os dois tetos ([RN-006](../business-rules.md#rn-006),
[RN-007](../business-rules.md#rn-007)) seguem intocados. Sem raiz informada ao `decide()`, o
veredito é o de antes desta regra — nenhum chamador tem comportamento alterado
por omissão.

A normalização é **léxica**, não `realpath`: `<raiz>/../..` é resolvido e
reprovado, mas link simbólico de dentro apontando para fora não é detectado.
`decide()` é puro por contrato e resolver symlink exigiria IO no domínio.
Escopo é política; isolamento é outro problema, declarado em aberto no ADR.

**Sem regex sobre a entrada, de propósito.** Tirar as barras finais da raiz era
`.replace(/\/+$/, '')`, e o CodeQL apontou ReDoS polinomial
(`js/polynomial-redos`, HIGH): o padrão obriga o motor a tentar cada posição
inicial e varrer até o fim, degradando em O(n²). Hoje é varredura O(n),
equivalente inclusive no caso degenerado — a raiz `/` vira string vazia nos
dois, e é isso que faz `startsWith('/')` valer para todo caminho absoluto.
Quem for "simplificar" de volta para regex reabre o alerta.

- **Onde:** `apps/api/src/domain/actions/path-scope.ts`,
  `domain/actions/decide.ts` (teto do escopo e o `cd` no escopo),
  raiz derivada em
  `infrastructure/filesystem/project-workspaces-root.ts`
- **Teste:** `apps/api/test/domain/actions/path-scope.spec.ts` e
  `apps/api/test/domain/actions/decide.spec.ts`
  (describe `decide — escopo de caminho`)
- **Origem:** [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md),
  achado U, Fase F do [backlog](../explanation/backlog.md)

O escopo só vale enquanto ele próprio estiver dentro da raiz — quem garante isso
é a [RN-092](#rn-092).

### RN-092 — O `projectId` é segmento de caminho, e o escopo nunca sai da raiz {#rn-092}

`projectScopeRoot()` **recusa** um `projectId` que não seja segmento de caminho
simples (`^[A-Za-z0-9_-]{1,64}$`), lançando em vez de montar o caminho.

O motivo é que o id chega de `@Param('projectId')` sem pipe de validação, e o
Express **decodifica o percent-encoding do segmento antes de entregá-lo**: um
`..%2F..%2Fetc` chega como `../../etc`, e o `join` resolveria para fora da raiz
sem reclamar. Os dois consumidores da função sofrem, e o segundo é o grave:

- o `permissions.json` seria lido **e escrito** em caminho arbitrário;
- o escopo da [RN-075](#rn-075) autoriza comando de `terminal` sob essa pasta.
  Um escopo que escapa da raiz é a política de aprovação apontando para o lugar
  errado — falha de SEGURANÇA, não de arquivo não encontrado.

A checagem é deliberadamente **mais larga que UUID** (aceita letra, dígito,
hífen e sublinhado) para não amarrar o formato do id, e estreita o bastante para
que o resultado nunca escape. E fica **onde a raiz é derivada**, não em cada
chamador, pela mesma razão que fez a função existir: as duas derivações têm que
concordar, e checagem duplicada é checagem que um dia diverge.

O caminho feliz não muda — todo id real é UUID vindo do banco.

- **Onde:** `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`projectScopeRoot`)
- **Teste:** `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
- **Origem:** [ADR 0058](../adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md),
  alertas `js/path-injection` do CodeQL

### RN-095 — A leitura de repositório é contida ao projeto e limitada {#rn-095}

A superfície de leitura de código (`GET /projects/:projectId/code/{tree,file,search}`
e o diff de PR) tem **duas** garantias, e as duas são do mesmo tipo: o produto
recusando fazer o que o cliente pediu.

**Contenção.** Todo caminho de arquivo vindo do cliente passa por
`caminhoDeRepositorioContido()`, que ancora o pedido na pasta do projeto e
recusa o que sair dela — `../`, absoluto, ou byte NUL. Ela é uma função só, no
mesmo arquivo do `projectScopeRoot` da [RN-092](#rn-092), reusando as primitivas
do escopo de terminal (`normalizarCaminho`/`dentroDoEscopo`). **Nenhuma rota
valida caminho por conta própria**, e é isso que a regra afirma: quatro
implementações da mesma contenção seriam quatro chances de divergir, e o
CLAUDE.md já registra que a decisão foi manter a checagem central e pagar o
preço no painel do CodeQL (barreira em outra função ele não enxerga).

Ela devolve o caminho **normalizado**, e o chamador usa o que voltou. Devolver o
original permitiria conferir `b` e mandar `a/../b` ao provider — a forma mais
comum de a contenção existir e não valer.

O vetor não é "ler o arquivo errado". Em `github`/`gitlab` o caminho vira
segmento de URL da API do provider, então um `../` **troca de endpoint** com a
credencial do owner do workspace na mão ([RN-058](#rn-058)/[RN-082](#rn-082)).
Em `local` ele vira o lado direito de `git show <ref>:<path>`. A `ref` é
conferida no mesmo lugar, pelo mesmo motivo, e `..` nela é recusado porque para
o git `dev..main` é intervalo de commits, não revisão.

**Limite.** Árvore e diff já vêm cortados pelo contrato
(`GIT_TREE_ENTRY_LIMIT`, `GIT_DIFF_FILE_LIMIT`, FASE 26a). A **busca** não: ela
não é operação do contrato — é composta sobre `listTree` e `getFileContent`, e
é a única leitura cujo custo cresce com o TAMANHO do repositório em vez do
tamanho do pedido. Três orçamentos a param (diretórios percorridos, arquivos
abertos, casamentos devolvidos), um cache de TTL curto evita repetir as mesmas
chamadas, e `truncated` diz que o corte aconteceu. Sem eles, um `viewer`
gastaria a credencial e o rate limit do owner à vontade — a mesma família de
defeito dos 3.824 req/min do dashboard ([RN-090](../business-rules.md#rn-090)).

Cortar é sempre **visível**: toda resposta que pode ter sido cortada diz isso
num campo. `filesScanned` vai junto na busca porque o custo que ninguém vê é o
que ninguém corrige.

**Ler não vira `proposed_action`.** Leitura não é efeito externo, e transformá-la
em ação de aprovação encheria a fila de ruído até ninguém mais ler as de
verdade. O congelamento da fase é o outro lado disso: a aba é só leitura, e
escrita — quando vier — nasce `proposed_action`.

- **Onde:**
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`caminhoDeRepositorioContido`),
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`,
  `apps/api/src/domain/git/git-read-limits.ts`,
  `apps/api/src/domain/git/git-read-cache.ts`,
  `apps/api/src/interfaces/http/git/code.controller.ts`
- **Teste:**
  `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (a contenção isolada),
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (o caminho malicioso recusado nas três rotas **antes** de o provider ser
  chamado, e cada um dos três orçamentos parando a busca),
  `apps/api/test/domain/git/git-read-cache.spec.ts`
- **Origem:** FASE 26b, item 34 do programa 16–26; a contenção estende a
  [RN-092](#rn-092) ([ADR 0058](../adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md))

### RN-127 — `ref`/`path` da aba Code recusam chegar como ARRAY, não só como caminho fora do escopo {#rn-127}

`@Query('ref') ref?: string` e `@Query('path') path?: string`
(`code.controller.ts`) extraem o valor cru sem DTO/`class-validator` no
meio, e o `ValidationPipe` global (`main.ts`) não ajuda: ele pula tipo
primitivo nativo (`String`) por desenho do Nest, então nada intercepta
`ref`/`path` antes de chegarem como argumento de método. O Express entrega
`?ref=a&ref=b` como **array**, não string — a anotação `string` do
TypeScript só existe em compile-time.

Um array escapava das DUAS checagens que a [RN-095](#rn-095) já fazia
tratando o valor como string: `ref.includes('..')` tem semântica de
ELEMENTO EXATO (não substring) em array, e `REF_VALIDO.test(ref)` chama
`.toString()` no array antes de casar — um valor como `['x/../y']`
continha `..` e ainda assim passaria pelas duas.

`garantirQueryEscalar(valor, criarErro)` recusa o array ANTES de qualquer
outra checagem, num lugar só, reusado pelos DOIS pontos que tratavam query
como string: `caminhoDeRepositorioContido` (mesmo arquivo da RN-092/095) e
`ReadProjectCodeUseCase.alvo` (`ref`). O erro concreto (`CaminhoForaDoEscopoError`
ou `BadRequestException`) é decidido por quem chama, passado como fábrica —
a função central não decide o tipo de erro, só a forma da checagem.

O caminho feliz não muda: todo `ref`/`path` legítimo já era string.

- **Onde:** `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`garantirQueryEscalar`, usada em `caminhoDeRepositorioContido`),
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (`alvo`, `ref`)
- **Teste:**
  `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (`garantirQueryEscalar` isolada e `caminhoDeRepositorioContido` recusando
  array), `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (`ref`/`path` como array são 400 em `tree`, que todas as outras rotas
  reusam via `alvo`)
- **Origem:** alerta CRÍTICO do CodeQL (confusão de tipo em query param HTTP)
  bloqueando a promoção qa→main, achado durante a PR #256; estende a
  [RN-095](#rn-095)

### RN-093 — Em produção, a api não sobe com a chave de exemplo do `state` de OAuth {#rn-093}

`resolveOauthStateSecret()` **derruba o boot** quando `NODE_ENV === 'production'`
e `GIT_OAUTH_STATE_SECRET` está ausente, é igual ao literal de exemplo do
repositório, ou tem menos de 16 caracteres. Fora de produção o default de
desenvolvimento continua valendo.

Essa chave assina o `state` do OAuth de git, e o `state` é o único que impede o
callback `GET /git/oauth/:provider/callback` — rota pública, por necessidade —
de ser forjado. Com a chave conhecida, qualquer um assina um `state` para
`{projectId, userId, provider}` à escolha e faz o callback gravar, no projeto
apontado por esse payload, o token de git obtido do provider.

**Por que rejeitar o literal, e não só o vazio.** O default estava no
`.env.example` de um repositório open source — é segredo publicado, não segredo
fraco. E o `docker-compose.prod.yml` o supria como fallback, então no caminho
real de erro a variável estava **definida**: uma verificação de "não vazia"
passaria por cima do defeito inteiro.

A resolução fica em função única, e não em cada chamador, pela mesma razão da
[RN-092](#rn-092) — eram duas cópias do mesmo literal, e cópias divergem.
Divergindo aqui, o callback recusaria todo `state` legítimo.

- **Onde:** `apps/api/src/infrastructure/security/oauth-state-secret.ts`
  (`resolveOauthStateSecret`), chamada no boot em `apps/api/src/main.ts`
- **Teste:** `apps/api/test/infrastructure/security/oauth-state-secret.spec.ts`
- **Origem:** [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md)

### RN-114 — Os quatro segredos irmãos do `GIT_OAUTH_STATE_SECRET` também não sobem em produção com o valor de exemplo {#rn-114}

O [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md) fechou o
padrão para `GIT_OAUTH_STATE_SECRET` e deixou declaradamente aberto que o
mesmo modo de falha valia para quatro segredos irmãos, todos com default de
desenvolvimento no `docker-compose.prod.yml`: `AUTH_JWT_SECRET`,
`BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY` e `SECRET_KEY_BASE`. Esta RN
fecha os quatro, replicando exatamente a mesma regra — não é decisão nova,
é a mesma decisão aplicada aos irmãos.

Em produção (`NODE_ENV === 'production'`), cada resolutor **derruba o boot**
quando a variável está ausente/só com espaços, é igual ao literal de exemplo
do repositório (que é público — está no `.env.example`), ou tem menos de 16
caracteres. Fora de produção o default de desenvolvimento continua valendo,
porque `docker compose up` sem `.env` tem que funcionar.

- `AUTH_JWT_SECRET` — deriva o par Ed25519 que assina o access token. Com o
  default público, qualquer um forja um access token válido.
- `BRABO_SERVICE_TOKEN` — autentica o tráfego interno api ↔ engine. Com o
  default público, qualquer um chama as rotas `/internal/*` sem passar pelo
  `EngineServiceGuard`.
- `CREDENTIALS_MASTER_KEY` — embrulha os DEKs que cifram as credenciais do
  usuário (chaves de LLM, tokens de git). Com o default público, qualquer um
  decripta o acervo. **Fora de escopo aqui**: qualquer mecanismo de rotação —
  esse já existe (`CREDENTIALS_MASTER_KEY_PREVIOUS` +
  `src/scripts/rewrap-deks.ts`) e não muda; esta é só a checagem de BOOT.
- `SECRET_KEY_BASE` (engine) — já derrubava o boot sem a variável
  (`runtime.exs`, bloco `:prod`, boilerplate padrão do Phoenix). O defeito
  real não era falta de checagem no Elixir: era o `docker-compose.prod.yml`
  suprir o literal público como fallback, o que fazia a variável chegar
  sempre DEFINIDA e mascarava o `raise` que já existia. A correção aqui foi
  só remover o fallback do compose — nenhuma linha de Elixir mudou.

Vale a mesma razão do ADR 0059 para rejeitar o literal, e não só o vazio: o
`docker-compose.prod.yml` supria os quatro literais como fallback, então no
caminho real de erro as variáveis estavam **definidas** — uma verificação de
"não vazia" passaria por cima do defeito inteiro.

- **Onde:** `apps/api/src/infrastructure/security/auth-key-material.ts`
  (`passphraseAtual`), `apps/api/src/infrastructure/security/service-token.ts`
  (`tokenDeServicoAtual`) e
  `apps/api/src/infrastructure/security/envelope-encryption.service.ts`
  (`EnvelopeEncryptionService`, checagem no construtor) — os dois primeiros
  chamados no boot em `apps/api/src/main.ts`, o terceiro exercitado quando o
  `NestFactory.create` monta o grafo de providers. `SECRET_KEY_BASE` em
  `apps/engine/config/runtime.exs` (inalterado) com o fallback removido de
  `docker/docker-compose.prod.yml`
- **Teste:** `apps/api/test/infrastructure/security/auth-key-material.spec.ts`,
  `apps/api/test/infrastructure/security/service-token.spec.ts` e o describe
  `validação de produção` em
  `apps/api/test/infrastructure/security/envelope-encryption.service.spec.ts`
- **Origem:** [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md)

### RN-076 — A credencial de git nunca é escrita em arquivo {#rn-076}

O engine trabalha em repositório remoto pedindo o **remoto de trabalho** à api
(`GET /internal/projects/:projectId/git-remote`), que devolve a origem **limpa**
e o token do owner à parte. O token entra na invocação do git pelo **ambiente do
processo filho** e em nenhum outro lugar:

- **não no `origin`** — é a URL limpa que fica gravada no `.git/config`;
- **não em argv** — `ps` mostra a linha de comando de qualquer processo;
- **não em arquivo** — nem helper persistido, nem `~/.git-credentials`.

O helper de credencial é passado por `-c`, vale só para aquele processo, e vem
depois de um `credential.helper=` vazio: helpers são acumulativos e o primeiro a
responder ganha, então sem zerar antes um helper do host responderia no lugar.

**Por que isso é regra e não preferência.** Escrever
`https://x-access-token:TOKEN@github.com/…` no `origin` — o que quase todo
tutorial ensina — grava a credencial em texto puro **dentro da pasta do
projeto**, exatamente onde a [RN-075](#rn-075) dá ao dev agent leitura
**auto-aprovada**. Um `cat .git/config` devolveria o token sem passar por
aprovação nenhuma, e ele viajaria ao provider de LLM no histórico do laço. O
escopo de caminho protege contra o agente ler para FORA do projeto; não tem como
proteger contra um segredo que o próprio produto colocou DENTRO.

A credencial é a do **owner do workspace**, pelo mesmo resolvedor da
[RN-058](#rn-058) — duas regras de "de quem é a credencial" divergiriam.
Provider `local` não tem token nem consulta a api: é resolvido direto do banco,
e é o caminho que o `pnpm dev` e a suite inteira exercitam.

- **Onde:** `apps/engine/lib/engine/actions/git_auth.ex`,
  `engine/projects/project_repository.ex` (`remoto_de_trabalho/1`),
  `apps/api/src/application/use-cases/git/get-project-git-remote.use-case.ts`
- **Teste:** `apps/engine/test/engine/actions/git_auth_test.exs` (o token não
  aparece em argv nem no helper) e
  `apps/api/test/application/use-cases/git/get-project-git-remote.use-case.spec.ts`
  (a origem devolvida não contém o token nem `@`)
- **Origem:** [ADR 0056](../adr/0056-o-engine-trabalha-em-repositorio-remoto.md),
  achado N, Fase B do [backlog](../explanation/backlog.md)

### RN-077 — A origem da falha é sempre uma das quatro {#rn-077}

Todo desfecho de falha nomeia a ORIGEM no vocabulário **fechado** do
[ADR 0020](../adr/0020-destravar-gates-qa-secops.md) —
`infra | modelo | codigo | politica`. Não há quinto valor: `null` e
`"indeterminada"` deixaram de ser possíveis.

Duas garantias estruturais, e nenhuma depende de alguém lembrar:

- **`AgentIo.block_task/4` não tem default para a origem.** Ela era
  "obrigatória em espírito", com `"indeterminada"` de default — e o desfecho
  mais caro da execução real saiu exatamente assim, porque o call site não
  passou nada. Sem default, esquecer vira erro de compilação.
- **`FalhaDeTurno.origem/1` sempre devolve uma das quatro**, e há teste de
  tabela que falha se alguma entrada — inclusive uma forma nunca vista —
  produzir outra coisa.

**Por que `indeterminada` saiu.** Ela existiu com um argumento razoável: não
chutar seria mais honesto que escolher no escuro. O efeito real foi o oposto —
`indeterminada` **não aponta ação nenhuma**, e quem triava a rodada seguinte
recomeçava a investigação do zero. O que ela significava de fato era *o
classificador não reconheceu esta forma*, que é lacuna do nosso código: `codigo`
é a origem que aponta a ação certa (acrescentar a cláusula que falta). O
diagnóstico continua indo verbatim, então nada se perde.

**As origens não são chute.** Cada desfecho do ToolLoop diz quem decidiu parar:
`report_blocked` e teto de iterações são do **modelo** (ele decidiu, ou gastou o
que tinha); orçamento e PR não aprovada são **política** (foi uma decisão, nada
quebrou); restart e falha ao montar contexto são **infra**; e quando há
`last_error`, a origem sai do MESMO erro que o diagnóstico narra — era esse par
que se contradizia, com `diagnosis` dizendo `{413, …}` e `origem` dizendo
"indeterminada" na mesma linha.

- **Onde:** `apps/engine/lib/engine/agents/falha_de_turno.ex`,
  `engine/dev/agent_io.ex` (`block_task/4`, sem default),
  `engine/dev/dev_agent_server.ex` (`origem_da_parada/1`)
- **Teste:** `apps/engine/test/engine/agents/falha_de_turno_test.exs`
  (`o vocabulário é fechado`) e
  `apps/engine/test/engine/dev/dev_agent_server_test.exs`, que afirma a origem
  no evento emitido
- **Origem:** achados P, Q e T de
  [achados-execucao-real.md](../explanation/achados-execucao-real.md), Fase G do
  [backlog](../explanation/backlog.md)

### RN-078 — Falha em proteger branches pode ser reconhecida, e só ela {#rn-078}

`protect_branches` falha em repositório privado no plano gratuito do GitHub — e
o wizard **avisa isso antes de começar**. O usuário pode reconhecer a falha e
seguir; o bootstrap fecha e o projeto passa a ser alcançável.

**O que isso destrava é maior do que parece.** O único botão oferecido depois da
falha era "Tentar novamente", que falha sempre pelo mesmo motivo. E
`provision_failed` faz o dashboard **redirecionar o clique do projeto de volta
para a página de provisionamento** — o projeto ficava inalcançável para sempre,
preso num passo que não tem como suceder.

**Só a proteção pode ser reconhecida.** Ela é o ÚLTIMO passo e a única cuja
falha deixa um repositório utilizável: o repo existe, os arquivos foram
commitados, as branches foram criadas. Falhar em criar o repositório ou em
commitar é outra coisa — ali "seguir" produziria um projeto sem onde trabalhar,
e o botão seria uma segunda mentira em cima da primeira. A recusa diz isso, em
vez de só negar.

**A garantia do produto não muda.** A trava de merge ([RN-006](../business-rules.md#rn-006)) é
aplicada em `decide.ts`, não pela proteção do provider. Seguir sem ela remove a
segunda camada, a do GitHub — não a do Brabo. É o que torna esta saída honesta
em vez de um atalho.

A decisão vai para o event log com o **usuário** como ator e o erro original no
payload: seguir sem proteção é escolha dele, e quem ler depois precisa saber o
que exatamente foi dispensado.

- **Onde:** `apps/api/src/application/use-cases/git/acknowledge-protection-failure.use-case.ts`,
  rota em `interfaces/http/git/git.controller.ts`, botão em
  `apps/web/src/routes/ProvisioningPage.tsx`
- **Teste:** `apps/api/test/application/use-cases/git/acknowledge-protection-failure.use-case.spec.ts`
  (destrava; a decisão no log com o ator; e a recusa para falha anterior)
- **Origem:** achado D, Fase D do [backlog](../explanation/backlog.md)

### RN-079 — O Psicólogo não analisa sessão sem evento analisável {#rn-079}

Antes de gastar um turno de modelo, a análise pergunta se há o que analisar. Não
havendo, ela **não roda** e o desfecho vira `psychologist.analysis_skipped`.

**Analisável exclui duas coisas, por motivos diferentes:**

- **o rastro dos próprios analistas.** O Psicólogo grava o turno dele no log da
  sessão que está analisando (`agent.response`, `tool.call`, `tool.result`, a
  hipótese). Contar isso faria uma sessão vazia parecer povoada **a partir da
  primeira análise**, e cada retentativa a encheria mais — o critério nunca mais
  reprovaria. Vale igual para a Anamnese;
- **`bootstrap.*`**, que é provisionamento de repositório rodando sozinho: nove
  passos de máquina não dizem nada sobre a pessoa.

Tudo o mais conta, inclusive `proposed_action.*` — o usuário aprovando e negando
sem escrever mensagem nenhuma **é** comportamento, lição que a Anamnese já tinha
aprendido ([RN-063](#rn-063)).

**São duas contagens, e elas não se substituem.** A crua dimensiona o trabalho
(quanto log ler, logo qual tier de triagem, leve ou pesado); a analisável decide
se há trabalho. Confundi-las é o defeito: uma sessão só de bootstrap passava por "20
eventos" sem ter nenhum, ganhava a análise, e o modelo — sem nada para citar —
inventava `seq` inexistentes até a validação de evidência rejeitar e ele
desistir, com o orçamento já gasto.

**Pular vale também para reprocessamento manual.** Reprocessar não fabrica
material: quem clicou recebe o motivo no log em vez de uma hipótese inventada
sobre um log que não existe.

O skip vira **evento**, ao contrário do da Anamnese, que é só log — aquele roda
a cada 15 min e viraria ruído, este roda uma vez por fechamento de sessão, e uma
análise ausente sem nada narrado é indiagnosticável.

- **Onde:** `apps/engine/lib/engine/session_events/event.ex` (`count_analisaveis/1`),
  `apps/engine/lib/engine/psychologist/triage.ex` (`should_run?/1`),
  `apps/engine/lib/engine/workers/psychologist_worker.ex`
- **Teste:** `apps/engine/test/engine/session_events/event_analisaveis_test.exs`
  (inclui a reprodução da sessão do achado: 14 eventos, nenhum analisável),
  `apps/engine/test/engine/workers/psychologist_worker_test.exs`
- **Origem:** achado J, Fase E do [backlog](../explanation/backlog.md)

### RN-080 — Regra de negócio duplicada é recusada na entrada {#rn-080}

`business_rule` cujo título já existe **no projeto** não é gravada. A recusa
volta ao modelo pelo mesmo caminho de um payload inválido, e ele segue para a
próxima regra em vez de parar.

**Na entrada porque não há outro lugar.** Não existe tabela de regras: o
artefato É o evento `artifact.business_rule`, e evento de domínio não é apagado
nem editado. Deixar entrar significa conviver com a duplicata para sempre.

**Escopo de projeto, não de sessão** — é entre sessões que a duplicata nasce.
Rodar o Criativo de novo abre sessão nova, e uma checagem por sessão não veria a
rodada anterior, que é exatamente o caso do achado.

A comparação normaliza caixa, acento e espaço redundante; pontuação fica.
**Duplicata semântica continua passando, e isso é declarado, não esquecido:**
"Saudação com nome" e "Quem chama pode se identificar" seguem sendo duas regras,
porque separá-las é julgamento e não cabe num `if`.

- **Onde:** `apps/engine/lib/engine/harness/artifact_dedupe.ex`,
  `apps/engine/lib/engine/harness/tools/emit_artifact.ex`,
  `apps/engine/lib/engine/session_events/event.ex` (`titulos_de_regras/1`)
- **Teste:** `apps/engine/test/engine/harness/artifact_dedupe_test.exs`,
  `apps/engine/test/engine/harness/emit_artifact_dedupe_test.exs`
- **Origem:** achado K, Fase E do [backlog](../explanation/backlog.md)

### RN-081 — História repetida: título igual recusa, justificativa igual avisa {#rn-081}

Duas respostas diferentes para dois problemas diferentes:

- **título idêntico** no projeto é erro, não escolha: a história é **recusada** e
  nada é criado;
- **mesma justificativa** — todas as regras de negócio que a história cita já
  estavam cobertas por outra — é suspeita, não erro. A história **é criada** e
  sai um `backlog.story_overlap_warned`. Um segundo recorte da mesma regra pode
  ser legítimo, então quem julga é o usuário; o produto só se recusa a deixar
  passar despercebido.

**Contido, não intersecção.** Duas histórias compartilharem uma regra é normal, e
avisar disso viraria ruído que ninguém lê. O sinal só existe quando a nova não
acrescenta cobertura nenhuma. História que não cita regra alguma não gera aviso:
tratar o conjunto vazio como subconjunto de tudo acusaria todas.

**O limite é o mesmo da [RN-080](#rn-080), e o par do achado o atravessa:**
"Endpoint público de saudação determinística" e "Endpoint público GET /hello que
responde saudação imediata" cobrem o mesmo endpoint com títulos e justificativas
diferentes — nada mecânico os liga, e eles continuam passando. Há teste
afirmando isso, para o limite ficar visível em vez de implícito.

- **Onde:** `apps/api/src/domain/backlog/story-overlap.ts`,
  `apps/api/src/application/use-cases/backlog/create-story.use-case.ts`
- **Teste:** `apps/api/test/domain/backlog/story-overlap.spec.ts`,
  `apps/api/test/application/use-cases/backlog/create-story.use-case.spec.ts`
- **Origem:** achado R, Fase E do [backlog](../explanation/backlog.md)

### RN-082 — A credencial de git de uma ação é a do OWNER do workspace {#rn-082}

Quando a api executa uma ação de git contra provider remoto (`pr_open`,
`git_merge`), o token vem do **owner do workspace** — o mesmo resolvedor da
[RN-058](#rn-058), não de quem decidiu a ação.

**Resolver por quem decidiu só funcionava com clique humano.** Ação
auto-aprovada por política não tem decisor: `decided_by` fica `NULL`, o token
fica `undefined`, e o GitHub responde `Requires authentication`. Na prática,
com autonomia ligada — que é o modo que o ADR 0055 existe para viabilizar —
**nenhum dev agent conseguia abrir PR em provider remoto**.

**O contraste que expôs o defeito** aconteceu dentro de uma execução só: no
mesmo run, `git_push` passou e `pr_open` falhou. O push é executado pelo
ENGINE, que já injetava a credencial do owner
([RN-076](#rn-076)); a PR é aberta pela API, que estava fora de simetria.

Não apareceu antes porque toda validação anterior usou o `LocalGitProvider`,
onde o token nem é consultado.

O princípio é o mesmo da RN-058, e vale repetir porque é o que impede as duas
regras de divergirem com o tempo: **quem banca a conta banca os agentes**, e
isso não muda conforme quem clica. Por isso o resolvedor é REUSADO em vez de
reimplementado.

- **Onde:** `apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts`,
  reusando `application/use-cases/llm/resolve-credential-owner.use-case.ts`
- **Teste:** `apps/api/test/application/use-cases/actions/execute-git-action.use-case.spec.ts`
  (`pr_open` auto-aprovado, com `decidedBy: null`, pede a credencial do owner)
- **Origem:** achado AA, [validação real da 13b](../explanation/validacao-real.md)

### RN-083 — O lead decide o paralelismo; acima do teto, você autoriza {#rn-083}

Quantos agentes sobem deixa de ser um número no código: quem avalia é o **lead
da área**. Mas a decisão dele não é soberana sobre GASTO — até
`agent_areas.max_parallel` (default **2**) ele sobe e segue; **acima disso vira
`proposed_action` do tipo `parallelize`**, pelo mesmo pipeline de toda ação com
efeito externo.

**O teto é da SESSÃO, não do módulo.** É a única parte da regra que não é
óbvia, e a que um refactor desatento desfaz: contar por módulo permitiria N
módulos × 2 agentes sem autorização nenhuma — o buraco anterior com outro nome.
Há teste afirmando exatamente isso.

**Teto zero ou negativo é configuração inválida, não "sem limite".** Tratá-lo
como ilimitado transformaria um erro de digitação em gasto irrestrito, que é o
oposto do que o pipeline existe para fazer.

**Quem PEDE é o lead; quem DECIDE é você.** A `proposed_action` nasce com o
lead como ator, e a decisão fica no event log com o seu nome — é essa distinção
que faz a história ser reconstituível depois ([ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md)).

O motivo viaja no payload IMUTÁVEL, com os três números (quantos há, quantos
pede, qual o teto): quem ler daqui a seis meses precisa entender o que foi
autorizado sem reconstruir o estado da sessão.

`AcceptParallelizationUseCase` não muda: ele continua sendo quem EXECUTA, tanto
no caminho direto quanto quando a ação é aprovada. Absorvê-lo por dentro, em vez
de reescrevê-lo, é o que mantém a suite da Fase 4 verde sem modificação — que é
a prova de que a troca não vazou para o contrato externo.

**O teto é configurável por área, e só por você.** `PATCH
/projects/:projectId/agent-areas/:key/max-parallel` exige `maintainer` — o mesmo
papel de ativar a execução, e pelo mesmo motivo: mudar o teto é decidir quanto o
produto pode gastar sem perguntar. Não existe caminho automático de subi-lo. A
Anamnese pode PROPOR, quando notar que a autorização virou rotina, e a proposta
continua passando por esta rota depois que você aceita — um produto que eleva o
próprio teto de gasto é exatamente o que o pipeline de aprovação existe para
impedir.

Mudar o teto vale para os PRÓXIMOS pedidos. O que já está aguardando decisão
continua aguardando: a ação carrega no payload o teto vigente quando foi criada,
e reinterpretá-la sob o teto novo mudaria o que você está prestes a decidir
depois de ler.

- **Onde:** `apps/api/src/domain/execution/paralelismo.ts` (a regra pura),
  `application/use-cases/execution/request-parallelization.use-case.ts`,
  `application/use-cases/execution/set-area-max-parallel.use-case.ts`,
  exposto em `interfaces/http/execution/execution.controller.ts` e configurado
  em `apps/web/src/routes/settings/ParallelismSection.tsx`
- **Teste:** `apps/api/test/domain/execution/paralelismo.spec.ts`,
  `test/application/use-cases/execution/request-parallelization.use-case.spec.ts`,
  `test/application/use-cases/execution/set-area-max-parallel.use-case.spec.ts`
  e `apps/web/src/routes/ProjectSettingsTab.test.tsx` (`ParallelismSection`)
- **Gate:** `docs/gates.yml` (`paralelismo-autorizado`) — `status: active`
  desde a auditoria fluxo.yml × código (achado A1/B5); o mecanismo em si não
  mudou, só o registro que ficou `planned` por engano desde a FASE 14d, ver
  [gates.md](../explanation/gates.md#a-registry-can-age-in-the-wrong-direction--stale-not-inactive)
- **Origem:** [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md), FASE 14d

### RN-094 — A área de agentes nasce com o projeto {#rn-094}

Criar um projeto grava as três áreas (`dev`, `qa`, `infra`) em `agent_areas`,
com o lead de cada uma e os membros **enumeráveis** em `agent_area_members` —
na MESMA transação da criação. Se o seeding falha, o projeto não nasce: projeto
sem área é projeto onde a RN-083 lê tabela vazia e cai no default sem que
ninguém tenha decidido nada.

**Isto é a correção de um defeito, não uma capacidade nova.** `agent_areas`
existe desde a FASE 14d e nunca foi gravada — `AgentAreaRepository.upsert`
tinha teste e não tinha NENHUM chamador. Em produção a tabela estava vazia,
`GET /projects/:projectId/agent-areas` devolvia `[]`, e os quatro casos de uso
que a leem operavam sobre o nada. É a mesma falha da própria FASE 14d, escrita
no CLAUDE.md: **testar a peça não é testar o caminho até ela**. Por isso o
teste desta regra entra pelo caso de uso que a rota chama, com repositório
real: um fake aqui provaria exatamente o que já estava provado e quebrado.

**Semeia em DOIS lugares, e cada um responde uma pergunta diferente.** A
criação do projeto faz a área EXISTIR — a tela de Configurações lê num projeto
que nunca executou. A ativação da execução diz quem são os MEMBROS da área de
`dev`: um `dev-<modulo>` por módulo do `module_map`, que não existia quando o
projeto nasceu. Enquanto não há membros gravados, quem sustenta a regra de
endereçamento (RN-087) é o predicado `ehDevDeModulo`, que não consulta o banco.

**O seeding nunca manda `max_parallel`.** A ativação é repetível, e mandar o
default faria um teto que você subiu para 5 voltar para 2 em silêncio — o
produto desfazendo a sua decisão. O mesmo vale para a migração de backfill: ela
faz a área existir e para aí.

Projetos criados antes disto são cobertos pela migração `0038`, com `ON
CONFLICT DO NOTHING` nas duas tabelas. Sem ela, o defeito ficaria corrigido só
para quem começasse do zero.

- **Onde:**
  `apps/api/src/application/use-cases/agents/seed-agent-areas.use-case.ts`,
  chamado por `application/use-cases/iam/create-project.use-case.ts` e
  `application/use-cases/execution/activate-execution.use-case.ts`;
  lista canônica em `apps/api/src/domain/agents/agent-areas.ts`;
  backfill em `apps/api/src/db/migrations/0038_wandering_lila_cheney.sql`
- **Teste:**
  `test/application/use-cases/iam/create-project-semeia-areas.spec.ts` (o
  caminho, contra o banco, incluindo a falha que derruba a criação),
  `test/db/agent-areas-backfill.spec.ts` (a migração rodada de verdade, duas
  vezes) e `test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  (os membros de dev, e o teto nunca enviado)
- **Origem:** FASE 18, defeito achado na investigação do programa 16–26;
  a tabela vem do [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md)

### RN-084 — A esteira exibida deriva do registro de gates {#rn-084}

O painel do time mostra a etapa em que uma PR está **derivando-a de
`docs/gates.yml`**, não de uma lista escrita na tela. Gate que sai do registro
some da esteira; gate `planned` nunca aparece.

**A regra existe por uma forma específica de envelhecimento.** Antes da FASE
15b a tela tinha as etapas fixas no componente, e o registro (FASE 15a)
descrevia os gates em outro lugar. Nada ligava os dois: acrescentar um gate ao
YAML não mudava a tela, e remover um deixava a tela mostrando uma etapa que já
não existia — sem nenhum teste falhar, porque as duas fontes estavam certas
cada uma por si. É o mesmo apodrecimento que o `docs/.docmap.yml` existe para
impedir, e a resposta é a mesma: uma fonte só, com o consumo cobrado.

Três decisões de borda, todas para a tela **degradar** em vez de sumir:

- gate de PR que a tela ainda não sabe desenhar é **ignorado**, não quebra o
  render — o registro pode ganhar um gate antes de a tela ganhar o rótulo;
- os **rótulos são de tela**, não do registro: o YAML descreve engenharia, e a
  tela fala com quem espera uma PR;
- **sem registro** (a rota falhou), mostra a esteira completa em vez de vazia —
  uma esteira genérica informa mais que nada.

- **Onde:** `apps/web/src/components/PrGateTimeline.tsx` (`etapasDaEsteira`),
  lendo `GET /gates` (`apps/api/src/interfaces/http/gates/gates.controller.ts`)
- **Teste:** `apps/web/src/components/PrGateTimeline.test.ts`
  (`gate que SAI do registro some da tela`, `gate de PR que a tela ainda não
  sabe desenhar é IGNORADO`, `sem registro, mostra a esteira completa`)
- **Origem:** [ADR 0054](../adr/0054-gates-como-registro-declarativo.md), FASE 15b

### RN-085 — O teto de iterações é por TIPO de agente {#rn-085}

Quantas voltas um agente pode dar no laço de ferramenta depende do trabalho que
ele faz: **8** para quem conversa, **60** para o dev agent e para os subagentes
de QA. Não há mais um número único.

**O teto de 8 nasceu de agente conversacional e foi herdado por quem trabalha.**
Na validação real da 13b isso apareceu como bloqueio: o dev agent gastou as
oito voltas explorando um repositório recém-provisionado e **nunca escreveu um
arquivo**; com 25, escreveu três e rodou os testes. O desfecho registrado era
`limite de iterações atingido` com origem `modelo` — tecnicamente verdade e
praticamente inútil, porque o modelo nunca chegou a julgar nada.

**Subir o default global seria a correção errada**, e é isso que a regra
protege: o Criativo não precisa de 60 voltas para conversar, e o teto também é
a trava contra laço infinito.

**Quem pode subir não é "quem trabalha muito", é quem tem trava de gasto por
baixo.** O teto de iterações protege contra laço infinito; quem protege o
BOLSO é o `token_budget_micros`. Dev agents e subagentes de QA rodam com o
`task_budget_micros` da task, então afrouxar as voltas não afrouxa a conta.
`infra-workflows` usa ferramenta pesada e mesmo assim **fica em 8**: ele roda
sem budget, e para ele o teto é a única trava que existe.

Duas bordas com teste próprio:

- **`dev-lead` é conversacional**, apesar do prefixo `dev-` que identifica os
  dev agents (`dev-<modulo>`, `dev-<modulo>-2`). O lead decide e delega, e sem
  a cláusula explícita nasceria com o teto do trabalho pesado por acidente de
  nomenclatura.
- **Agente desconhecido cai no teto mais baixo.** Errar para o lado barato:
  quem precisa de mais voltas aparece como `limite de iterações atingido` e é
  corrigido; quem ganha 60 por engano gasta calado.

- **Onde:** `apps/engine/lib/engine/harness/iteracoes.ex`, aplicado em
  `apps/engine/lib/engine/harness/tool_loop.ex` (`init/1`)
- **Teste:** `apps/engine/test/engine/harness/iteracoes_test.exs` e
  `apps/engine/test/engine/harness/tool_loop_test.exs`
  (`o teto vem do TIPO do agente quando o chamador não passa um`,
  `teto explícito do chamador VENCE o do tipo`)
- **Origem:** achado X, [validação real da 13b](../explanation/validacao-real.md);
  [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md), FASE 14d

### RN-086 — Gastar com mais agentes nunca se auto-aprova {#rn-086}

As duas ações que mexem em **quanto o produto pode gastar sozinho** —
`parallelize` (ultrapassar o teto agora) e `raise_max_parallel` (mudar o teto)
— nunca são auto-aprováveis. Nem por `agent_autonomy`, nem por
`permissions.json`. É a mesma classe de garantia da trava de merge e do teto do
patch de instrução.

**Sem isto o teto da [RN-083](#rn-083) seria decorativo.** Um `permissions.json`
com `Parallelize()` no `allow` faria toda ultrapassagem se aprovar sozinha — a
regra que existe para EXIGIR a decisão do usuário passaria a dispensá-la. E
`raise_max_parallel` é o caso mais grave: seria o produto elevando o próprio
limite de gasto, exatamente o que o pipeline de aprovação existe para impedir.

**A Anamnese pode PROPOR, e é isso que ela faz.** Quando autorizar mais um
agente vira rotina, o teto está errado, e quem percebe primeiro é quem lê o
histórico. O sinal já chegava a ela: as decisões do usuário na janela vêm de
`proposed_actions`, com `actionType` e `status`.

O limiar é **três aprovações e nenhuma negação**, e as duas metades importam:

- **duas não são rotina — são duas.** Três é o que separa "aconteceu" de "está
  acontecendo sempre";
- **uma negação derruba o sinal inteiro**, por mais aprovações que haja. Se o
  usuário recusou alguma vez, o teto está fazendo o trabalho dele, e propor
  subi-lo seria ler o sinal ao contrário.

Propor um teto **igual ou menor** que o vigente é recusado pela api: a Anamnese
roda periodicamente e reproporia a mesma coisa a cada rodada, enchendo de ruído
uma fila que o usuário precisa ler.

Aprovar aplica o valor do **payload**, não um recalculado na hora — é o número
que você leu ao decidir.

- **Onde:** `apps/api/src/domain/actions/decide.ts` (o teto),
  `application/use-cases/execution/propose-max-parallel.use-case.ts`,
  `execute-max-parallel-raise.use-case.ts`,
  `apps/engine/lib/engine/anamnese/tools/propose_max_parallel.ex` e o limiar em
  `apps/engine/lib/engine/workers/anamnese_worker.ex` (`nota_de_paralelismo/1`)
- **Teste:** `apps/api/test/domain/actions/decide.spec.ts`
  (`decide — teto do paralelismo`),
  `test/application/use-cases/execution/propose-max-parallel.use-case.spec.ts`,
  `execute-max-parallel-raise.use-case.spec.ts`,
  `apps/engine/test/engine/anamnese/tools_test.exs` e
  `test/engine/workers/anamnese_worker_test.exs` (`duas aprovacoes NAO sao
  rotina`, `uma NEGACAO derruba o sinal`)
- **Origem:** [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md), FASE 14d

### RN-087 — O Dev Lead é o único endereço externo da execução {#rn-087}

Existe um agente `dev-lead`, conversacional, que recebe o handoff do Arquiteto
e propõe o **plano de execução**: quantos agentes por módulo e por quê. Ele não
escreve código — distribui trabalho e responde por ele.

**Antes dele, a frase "quem decide é o lead" da [RN-083](#rn-083) não tinha
dono.** O Arquiteto terminava e a execução subia por um botão, sem ninguém no
meio para avaliar quanto trabalho havia.

**Os `dev-<modulo>` deixaram de ser endereçáveis por handoff.** Isso não é
exceção nova: é a regra do [ADR 0038](../adr/0038-hierarquia-de-agentes.md) —
handoff externo endereça só lead de área ou agente sem área — passando a valer
para o dev como já valia para QA e Infra. Enquanto não havia Dev Lead, eles
eram agentes SEM área e por isso alvos válidos; virando membros, deixam de ser.

**A área de `dev` é a primeira DINÂMICA**, e é o que forçou o predicado: os
membros são um por módulo do `module_map`, decididos pelo Arquiteto e
diferentes em cada projeto, então não há lista a enumerar. `dev-lead` casa com
o mesmo prefixo `dev-` dos membros, e quem o exclui é a regra genérica **o lead
nunca é membro da própria área** — que vale para qualquer área e vive num lugar
só. A primeira versão repetia essa exclusão em três pontos, e a verificação por
mutação mostrou que nenhuma das cópias era alcançável por teste: cada uma
sobrevivia à mutação da outra.

**O plano é `proposed_action` (revisado pelo [ADR 0086](../adr/0086-dev-lead-plano-suspende-para-aprovacao.md), [RN-284](../business-rules.md#rn-284)).**
Até essa mudança o plano virava EVENTO simples, sem aprovação: o argumento era
que propor não tem efeito externo — o gasto acontece quando os agentes sobem,
e é lá que o teto cobra autorização; transformar a proposta em ação a decidir
faria você decidir duas vezes a mesma coisa. Uma auditoria de
`docs/fluxo.yml` × código encontrou que o fluxo já declarava esta saída como
`via: proposed_action` desde o ADR 0085, e o código nunca foi ajustado para
bater — o dono do produto decidiu que o código errava: o plano é a PRIMEIRA
decisão real de quanto a sessão vai gastar com paralelismo, e o usuário passou
a decidir ativar a execução tendo VISTO uma aprovação de verdade, não só lido
uma linha no fio. A lição antiga não desapareceu — é o motivo pelo qual
`propose_execution_plan` NÃO entrou no bloco de tetos absolutos de
`decide.ts` (ver RN-284).

**O plano BEM-SUCEDIDO encerra o turno — no caminho SEM suspensão.** Na
primeira execução real o Dev Lead registrou **dois** `execution.plan_proposed`
na mesma sessão — textos diferentes, mesmo total —, porque o laço voltava ao
modelo e ele propunha de novo. O event log é imutável: ficaram duas propostas
e nada dizendo qual valia. A instrução "use uma vez" no spec da ferramenta é
pedido, não garantia; quem garante é o laço parar. Desde o ADR 0086, quando a
proposta fica `pending`, quem encerra o turno é a PARADA por suspensão
(RN-284) — o sucesso imediato (`auto_approved`/`executed`/`approved`, ver
RN-284) continua fechando o laço do mesmo jeito de sempre.

**Bem-sucedido, e não "chamou a ferramenta"**: um plano recusado (vazio, ou com
zero agente num módulo) deixa o laço seguir, senão a recusa vira fim de turno e
o modelo nunca chega a corrigir. A primeira versão desta guarda olhava só o
nome da ferramenta e tinha esse defeito — encontrado pelo teste comportamental,
não pela leitura.

Um plano vazio, ou com zero agente num módulo, é recusado **antes de propor
qualquer coisa** — a proposta, uma vez criada, é decisão real do usuário, e um
plano meio proposto não teria como ser retratado.

- **Onde:** `apps/engine/lib/engine/agents/dev_lead_server.ex` e
  `dev_lead_tools.ex`; a regra de endereçamento em
  `apps/api/src/domain/agents/agent-areas.ts`; o handoff em
  `application/use-cases/agents/offer-infra-handoff.use-case.ts`
- **Teste:** `apps/engine/test/engine/agents/dev_lead_tools_test.exs`,
  `dev_lead_server_test.exs` (`o plano ENCERRA o turno`, `o plano recusado NÃO
  encerra o turno`),
  `apps/api/test/domain/agents/agent-areas.spec.ts` (`o dev de módulo DEIXOU de
  ser endereçável`, `` `dev-lead` É endereçável, apesar do prefixo ``) e
  `test/application/use-cases/agents/offer-infra-handoff.use-case.spec.ts`
- **Origem:** [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md), FASE 14d;
  o mecanismo de aprovação revisado pelo [ADR 0086](../adr/0086-dev-lead-plano-suspende-para-aprovacao.md)

### RN-064 — Heartbeat não encerra sessão com trabalho pendente {#rn-064}

O timeout de heartbeat mede inatividade da **aba**, não do **trabalho**. Antes
de encerrar, o `SessionServer` pergunta à api se sobrou trabalho
(`GET /internal/sessions/:id/pending-work`); havendo, reagenda o timeout e
registra o motivo no log em vez de matar a sessão.

O default são **30 segundos**. Sair da sessão para a aba de Backlog já bastava
para matá-la — e numa execução real isso prendeu um handoff `offered` para o
Arquiteto dentro de uma sessão fechada: épico e quatro histórias prontos, e a
cadeia sem como seguir, porque não existe onde aceitar handoff de sessão morta.

Fechar sessão é sobre o trabalho ter acabado, não sobre quem está olhando.

**A api fora do ar NÃO impede o encerramento**: `{:error, _}` encerra assim
mesmo, com aviso no log. Trocar sessão órfã por sessão imortal seria trocar um
defeito por outro.

"Trabalho pendente" são **três** sinais — o segundo entrou pelo achado V, o
terceiro pelo bug real do Criativo→PO→Arquiteto:

1. **handoff `offered`** — o caso original acima;
2. **`proposed_action` com status `pending`** — alguém está esperando a SUA
   decisão, e um agente pode estar suspenso esperando o desfecho
   ([RN-073](#rn-073));
3. **agente ATIVADO ainda em turno** — o último `agent.status` de cada ator
   que já falou na sessão é `working` sem um `idle` posterior.

O segundo é o mesmo defeito do primeiro um nível abaixo, e a execução do
`hello-limpo` mostrou o custo: a sessão nasceu 23:34:12, uma ação ficou
`pending` às 23:34:13, e o heartbeat a fechou às **23:34:42 — exatamente os 30s
do timeout**. O dev agent seguiu trabalhando por mais de uma hora numa sessão
que o banco dava por encerrada, e isso envenena toda métrica por sessão:
duração, custo e "quantas terminaram bem" passam a ler um estado que não
descreve o que houve.

O terceiro é a mesma janela, um passo antes de qualquer um dos dois primeiros
existir: `AcceptHandoffUseCase` marca o handoff antigo como `accepted` e ativa
o próximo agente na hora, mas a ativação no engine é `GenServer.cast`
fire-and-forget — responde 201 antes de o agente sequer começar. O PO ativado
pelo handoff do Criativo roda um kickoff de até 12 iterações de LLM usando só
ferramentas `category: :direct` (`create_epic`/`create_story`/`create_task`),
que nunca geram `proposed_action`, e só oferece o handoff seguinte (o sinal 1)
no FIM do turno inteiro. Entre a ativação e esse fim, nem o sinal 1 nem o sinal
2 existiam — só o ping do canal Phoenix a cada 10s segurava a sessão, e
qualquer atraso maior que os 30s do timeout fechava a sessão com o PO ainda
gerando o backlog, quebrando a cadeia de handoff pela raiz: o handoff seguinte
acabava sendo oferecido numa sessão já `closed`, que não aceita mais nada.

`agent.status` (`working`/`idle`) é o que todo agente conversacional
(Criativo/PO/Arquiteto/Dev Lead/Infra) já narra nos limites de turno, e é
PERSISTIDO no event log, não só broadcastado no canal
(`Engine.Sessions.LiveBroadcast.agent_status/4`, [ADR 0021](../adr/0021-fechamento-4a-infra-e-painel.md))
— o mesmo sinal que o painel do time já lê para derivar o roster
(`conversationalStatus` em `apps/web/src/lib/agent-status.ts`). Reaproveitá-lo
aqui não exigiu evento novo nenhum: o terceiro sinal é o último `agent.status`
de CADA ator que já falou na sessão, e é genérico por tipo de evento — cobre
qualquer agente ativado por handoff, não só o PO.

A versão anterior desta regra dizia, por escrito, que incluir trabalho de agente
"sem um teste que prove a interação seria adivinhar". A execução produziu a
prova, e o teste agora existe.

**O que continua fora:** task `in_progress` sem ação pendente nem handoff nem
turno em aberto. O dev agent tem máquina de estados própria e retém o worktree
por conta dele; o sinal que a api possui e que a execução comprovou é a ação
pendente. Incluir a task exigiria a api ler `dev_agent_states`, que é do
engine — decisão de fronteira, não conserto de passagem. Os dev agents também
não emitem `agent.status` (rodam com máquina de estados própria, não com o
loop conversacional de turno) — o terceiro sinal não os cobre, e não precisa:
a ação pendente já cobre o caminho deles.

- **Onde:** `apps/api/src/application/use-cases/sessions/get-session-pending-work.use-case.ts`,
  `apps/api/src/application/ports/session-event-repository.port.ts`
  (`listByTypeInSession`), `apps/engine/lib/engine/sessions/session_server.ex`
  (`handle_info(:heartbeat_timeout, …)`)
- **Teste:** `apps/engine/test/engine/sessions/session_lifecycle_test.exs`
  (`heartbeat NÃO encerra sessão com trabalho pendente` e o caso oposto) e
  `apps/api/test/application/use-cases/sessions/get-session-pending-work.use-case.spec.ts`
  (os três sinais, a ação já decidida que NÃO segura, o `idle` que libera, o
  isolamento por ator, a genericidade por tipo de agente e o escopo por
  sessão)
- **Origem:** execução real da FASE 13b; achado V, Fase H do
  [backlog](../explanation/backlog.md); bug real do encadeamento
  Criativo→PO→Arquiteto

### RN-063 — Encerrar sem produzir é desfecho, não falha {#rn-063}

A Anamnese tem uma ferramenta para dizer **"não há nada a emitir, e este é o
motivo"** (`skip_proficiency`). A rodada encerra com `anamnese.run_skipped` e o
motivo no payload — nunca com `anamnese.run_failed`.

Antes ela não tinha esse verbo. A única ferramenta era `emit_proficiency`, que
recusa lista vazia (com razão: perfil vazio não é perfil). Numa janela sem
membro elegível a Anamnese descobria isso na PRIMEIRA iteração, escrevia em
prosa "não há membros elegíveis", chamava `emit_proficiency` com `profiles: []`,
era recusada — e repetia até o teto de iterações. Cada volta reenvia o
histórico, que cresce a cada volta.

Numa execução real isso custou **145 mil tokens de entrada e 4× o gasto do
Criativo e do PO somados**, sem produzir nada. E voltava a cada tick do
agendador, a cada 15 minutos, para sempre.

O teto de iterações funcionava — não era laço infinito. O desperdício era **por
rodada, repetido indefinidamente**, que é pior: um laço trava e alguém percebe;
este sangrava devagar.

Narrar `run_failed` para uma rodada que fez a coisa certa também é defeito: quem
lê o log aprende a ignorar o evento de falha.

- **Onde:** `apps/engine/lib/engine/anamnese/tools/skip_proficiency.ex`,
  `apps/engine/lib/engine/anamnese/hooks/termination.ex`,
  `apps/engine/lib/engine/workers/anamnese_worker.ex` (`handle_outcome`)
- **Teste:** `apps/engine/test/engine/workers/anamnese_worker_test.exs`
  (`encerrar sem perfis é DESFECHO: narra run_skipped com o motivo, não falha`)
- **Origem:** execução real da FASE 13b

### RN-062 — Mensagem a agente conversacional REIDRATA o processo {#rn-062}

Uma mensagem endereçada a Criativo, PO ou Arquiteto sobe o processo se ele não
estiver de pé, antes de entregar. O `init` de cada servidor já reconstrói o
histórico do event log; faltava quem o chamasse.

Antes, um restart do engine matava a conversa em silêncio: a sessão sobrevivia
como `active`, o processo do agente não, e a próxima mensagem morria com
`GenServer.call ... exited` — sem evento, sem erro na tela, sem nada. O usuário
via a própria mensagem aparecer e nenhuma resposta chegar, para sempre.

O comentário de `revise/2` dizia que agente morto nesta rota "é um bug". É — e
basta o engine reiniciar para acontecer. É a mesma garantia que a Fase 12b deu
aos dev agents, aplicada aos conversacionais.

- **Onde:** `apps/engine/lib/engine_web/controllers/agent_command_controller.ex`
  (`message/2`)
- **Teste:** coberto pela suite de agentes; a prova de execução está em
  docs/explanation/validacao-real.md
- **Origem:** execução real da FASE 13b

### RN-060 — O gasto das chaves é do owner, e só ele vê {#rn-060}

O relatório de consumo por credencial (`GET /workspaces/:id/credential-spend`)
exige **`owner`** no workspace. Não é `maintainer`: desde a
[RN-058](#rn-058) os agentes de todos os projetos gastam a credencial do dono,
e a fatura dele não é assunto de quem só opera um projeto.

O relatório agrupa por **provider**, porque é essa a unidade da credencial —
uma chave por provider, por pessoa. Um total único não bateria com fatura
nenhuma.

E separa **agente** de **pessoa**: as duas coisas saem da mesma chave desde a
RN-058, e "meus agentes estão caros?" é uma pergunta diferente de "eu uso muito
o chat?". Por isso este é o único agregado de custo do produto **sem** o filtro
`actor_kind = 'agent'` da [RN-038](#rn-038) — aqui a pergunta é quanto saiu da
chave, e o chat do próprio owner sai dela.

Gasto de credencial **já removida** continua no relatório, marcado: o consumo
aconteceu, e escondê-lo daria um total que não fecha com o extrato do provider.

Nenhum segredo atravessa: a resposta tem provider, tokens e custo — nunca a
chave, nem cifrada ([ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md)).

- **Onde:**
  `apps/api/src/application/use-cases/llm/get-credential-spend.use-case.ts`,
  `apps/api/src/interfaces/http/llm/budgets.controller.ts`,
  `apps/web/src/components/CredentialSpendSection.tsx`
- **Teste:** `test/application/use-cases/llm/get-credential-spend.use-case.spec.ts`
  (agrupa por provider; separa agente de pessoa; chave removida fica marcada);
  `apps/web/src/components/CredentialSpendSection.test.tsx`
- **Origem:** decisão do usuário junto com a RN-058

### RN-101 — O mesmo gasto, duas audiências: a fatura é do owner, o consumo é de quem gastou {#rn-101}

O produto responde **duas perguntas diferentes** sobre `token_usage`, e nenhuma
é recorte da outra.

**A do owner é por CREDENCIAL.** `GET /workspaces/:id/credential-spend` continua
como a [RN-060](#rn-060) o deixou — por provider, exigindo `owner`, respondendo
"quanto saiu da minha chave". Junto dele, `GET /workspaces/:id/spend-report`
(também `owner`) quebra o workspace por **modelo, provider, projeto, ator e
dia** — o eixo de provider entrou pela [RN-186](#rn-186). O owner vê os dois
porque é a única pessoa que pode ver os dois.

**A do membro é por ATOR.** `GET /projects/:id/spend/me` (papel `viewer`)
devolve, em tokens e custo **estimado**, o que **quem chamou** consumiu naquele
projeto, por sessão e por dia. Ela **não quebra por provider nem por
credencial** — a chave que rodou é a do owner ([RN-058](#rn-058)), e uma fatia
da fatura dele não é o que o membro está perguntando.

O ator **não é parâmetro**: sai do usuário autenticado, e não existe onde
escrever o id de outra pessoa. "Membro não vê linha de outro ator" é propriedade
da assinatura do caso de uso, não uma checagem que alguém pode esquecer de
chamar.

**Agente não entra na conta do membro.** `token_usage` registra quem GASTOU, não
quem mandou gastar; atribuir o agente a quem o iniciou seria inventar um dado
que a tabela não tem. Gasto de agente aparece no relatório do owner, de quem é a
chave.

**O eixo de `provider` existe, e o membro não o alcança.** Até o
[ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md) ele simplesmente
não existia na agregação, e era a ausência que continha a visão do membro. Hoje
`sumGroupedBy` tem seis dimensões (`model`, `provider`, `project`, `actor`,
`session`, `day`) e a contenção mudou de forma, não de força: quem contém é o
TIPO — ver [RN-186](#rn-186) e [RN-187](#rn-187). O que não mudou é que dois
providers servindo o mesmo nome de modelo continuam caindo numa linha só na
dimensão `model`.

- **Onde:**
  `apps/api/src/application/use-cases/llm/get-my-spend.use-case.ts`,
  `apps/api/src/application/use-cases/llm/get-workspace-spend-report.use-case.ts`,
  `apps/api/src/application/ports/token-usage-repository.port.ts`,
  `apps/api/src/interfaces/http/llm/spend.controller.ts`,
  `apps/web/src/routes/ProjectSpendTab.tsx`
- **Teste:** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  (o membro não enxerga linha de outro ator, nem de agente, nem do owner; o
  filtro é pelo par `(kind, id)`; a resposta não carrega provider);
  `apps/web/src/routes/ProjectSpendTab.test.tsx`
- **Origem:** [ADR 0063](../adr/0063-duas-audiencias-para-o-mesmo-gasto.md) (FASE 22),
  revisto pelo [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-186 — `provider` é dimensão do relatório do owner, e só dele {#rn-186}

`sumGroupedBy` aceita `provider` como dimensão, e
`GET /workspaces/:id/spend-report` devolve a lista `porProvider` ao lado de
modelo, projeto, ator e dia. O [ADR 0063](../adr/0063-duas-audiencias-para-o-mesmo-gasto.md)
tinha deixado o eixo de fora; o [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)
o devolveu **sem revogar o argumento**: quebrar gasto por provider continua
sendo quebrar por CREDENCIAL, e por isso o eixo mora numa rota que já exige
`owner` ([RN-060](#rn-060)) — a mesma régua de `credential-spend`, que segue
respondendo a pergunta da FATURA (por mês, com o vínculo à chave que existe
hoje).

`GET /projects/:id/spend/me` **não ganhou nada**. A assimetria é o desenho: as
duas respostas continuam não sendo recorte uma da outra ([RN-101](#rn-101)).

A dimensão `model` **não mudou**: dois providers servindo o mesmo nome de modelo
continuam numa linha só. Quem quer a quebra por credencial tem a lista própria,
e cruzar as duas dimensões multiplicaria as linhas do ranking sem responder
pergunta que as duas listas separadas já não respondam.

- **Onde:** `apps/api/src/application/ports/token-usage-repository.port.ts:123`
  (`SpendDimension`),
  `apps/api/src/infrastructure/persistence/drizzle/token-usage.repository.ts:245`
  (o `GROUP BY`), `apps/api/src/application/use-cases/llm/get-workspace-spend-report.use-case.ts:112`,
  `apps/api/src/interfaces/http/llm/spend.controller.ts:56`
- **Teste:** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  ("quebra por PROVIDER, e o mesmo nome de modelo em dois providers segue UMA
  linha")
- **Origem:** [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-187 — A visão do membro não alcança `provider`, e quem garante é o TIPO {#rn-187}

Enquanto o eixo não existia, o que continha a visão do membro era a **ausência**
de argumento a passar. Com o eixo de volta, a contenção passou a ser da
assinatura: `sumGroupedBy` tem **duas sobrecargas**, e a que aceita um escopo com
`actor` — o da audiência do membro, e o único que ele tem — só recebe
`SpendDimensionDoAtor`, que é `Exclude<SpendDimension, 'provider'>`.
`sumGroupedBy('provider', escopoComAtor)` **não compila**.

Nem o repositório nem o caso de uso têm `if` sobre essa combinação, de
propósito: uma checagem em tempo de execução daria a impressão de que a garantia
é dinâmica, quando quem a sustenta é o compilador — e um `if` é o tipo de coisa
que a próxima refatoração remove sem que nenhum teste fique vermelho.

A barreira é dupla e as duas metades são independentes: a rota do membro
**também não tem parâmetro de dimensão** (só `projectId` e `dias`), então uma
query inventada como `?dimensao=provider` é descartada pelo Nest antes de
chegar ao handler.

`Exclude` em vez de uma segunda lista escrita à mão é deliberado: dimensão nova
nasce alcançável pelas duas audiências, e tirá-la do alcance do membro vira ato
explícito **neste ponto** — nunca um esquecimento em outro arquivo.

- **Onde:** `apps/api/src/application/ports/token-usage-repository.port.ts:107`
  (as duas sobrecargas), `:138` (`SpendDimensionDoAtor`), `:154`/`:164` (os dois
  escopos), `apps/api/src/application/use-cases/llm/get-my-spend.use-case.ts:73`,
  `apps/api/src/interfaces/http/llm/spend.controller.ts:98`
- **Teste:** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  ("não compila pedir `provider` com escopo de ator" — um `@ts-expect-error` que
  o `tsc` reprova como diretiva NÃO USADA se a barreira cair; e "só pede as
  dimensões `session` e `day`"),
  `apps/api/test/interfaces/spend.controller.spec.ts` (a rota do membro aceita
  `dias` e mais nada)
- **Origem:** [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-188 — Pessoa e agente são partição da lista por ator, sem consulta a mais {#rn-188}

O relatório do owner traz `porOwner` (linhas de `actor_kind = 'user'`) e
`porAgente` (`actor_kind = 'agent'`) além de `porAtor`, que continua inteira.
Os dois blocos são **derivados** de `porAtor` no caso de uso — `actorKind` já
vem na linha desde a FASE 22 —, e não duas consultas com `where actor_kind`.
O motivo é medido: o [ADR 0063](../adr/0063-duas-audiencias-para-o-mesmo-gasto.md)
mostrou que o custo destas consultas cresce com o tamanho de `token_usage` e
não com o do pedido, então varrer a janela duas vezes a mais para separar o que
já está separado em memória seria caro pelo motivo errado.

`actor_kind` que não seja pessoa nem agente (hoje, `system`) **não entra em
nenhum dos dois blocos** e continua visível em `porAtor` e no total. Abrir um
terceiro bloco para ele diria que o produto tem uma audiência que ele não tem.

O rótulo "Por owner" é do handoff de design e vale pela [RN-058](#rn-058) — é a
chave do owner que todas essas linhas gastam. Quem é o dono do workspace
continua sendo o campo `ownerId`, não o `actorKind` de cada linha.

- **Onde:** `apps/api/src/application/use-cases/llm/get-workspace-spend-report.use-case.ts:120`
- **Teste:** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  ("separa PESSOA de AGENTE em dois blocos, sem perder a lista por ator")
- **Origem:** [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-102 — O modelo da área é padrão herdável; divergir é decisão do agente, e voltar a herdar apaga a decisão {#rn-102}

A cascata de binding ganhou um nível: `sessão > agente > **área** > projeto >
workspace`. `area` fica ENTRE agente e projeto — é o PADRÃO que o lead e os
subagentes de uma área compartilham (`qa`/`qa-automacao`/
`qa-performance-seguranca`, `infra`/`infra-workflows`, `dev`/`dev-<módulo>`), e
o binding do próprio agente é a DIVERGÊNCIA que o sobrepõe. Se a área viesse
ACIMA do agente ela venceria sempre, e "padrão herdável" seria, na prática,
"padrão imposto" — nenhum agente conseguiria escolher outro modelo.

O nível novo entra na MESMA revalidação de capability da
[RN-041](#rn-041)/[RN-043](#rn-043): modelo da área que sumiu do provider ou
que não faz tool calling é PULADO e registrado em `skipped`, exatamente como
`agent` já era. `assertModelFitsBindingScope` (RN-040) passou a exigir
`supports_tool_calling` também no escopo `area` — ela nunca é lida por chat
humano, só por agente, então deixá-la passar adiaria a mesma falha silenciosa
em um nível.

**"Voltar a herdar" apaga o binding, nunca copia o modelo do nível de baixo
para o de cima.** Gravar no agente o modelo que a área decidiu pareceria igual
na tela e não é: viraria uma CÓPIA, e a próxima mudança da área deixaria esse
agente para trás sem ninguém notar. Herdar é a AUSÊNCIA de decisão própria, e
desfazer uma divergência é remover a linha — `DELETE
/projects/:id/agent-bindings/:slug` e `DELETE
/projects/:id/area-bindings/:key`, ambos 204, ambos 404 quando o escopo já
herda (idempotência que MENTIRIA se fosse 204 silencioso: apagar o que não
existia e apagar de verdade são respostas diferentes para a mesma tela).

Mudar o modelo da ÁREA exige `maintainer`, e não `developer` como o do agente
individual — pelo mesmo motivo do teto de paralelismo
([RN-083](#rn-083)): o binding da área alcança o lead e TODOS os subagentes de
uma vez, e escolher modelo é decidir quanto o produto gasta sem perguntar.

**A TELA passou a honrar os DOIS mínimos, e são dois.** Até aqui
`ModelsSection` — a tabela de modelo por agente — não checava papel nenhum: o
`ModelPicker` da coluna MODELO VIGENTE e o "voltar a herdar" da coluna ORIGEM
apareciam clicáveis para todo mundo, `viewer` incluído, e a api recusava com
403. A saída NÃO foi copiar o gate da seção irmã (`owner || maintainer`): isso
trocaria o defeito pelo INVERSO, trancando um `developer` fora de uma ação que
`PUT`/`DELETE .../agent-bindings/:slug` aceita — e o inverso é pior, porque
oferecer o que será recusado ao menos termina num toast, enquanto perder
capacidade é invisível para quem a perdeu. O mínimo é do ENDPOINT, não da
seção, e as duas seções são vizinhas na MESMA tela com mínimos diferentes. A
comparação saiu das telas e virou `roleAtLeast` (`apps/web/src/lib/roles.ts`),
sobre o `ROLE_ORDER` que já existia — mesmo nome da função do backend, porque é
a mesma regra dos dois lados do fio; escrever a hierarquia à mão
(`role === 'owner' || role === 'maintainer'`) acerta por acidente enquanto o
mínimo é alto e erra calada quando é baixo. Papel AUSENTE (consulta em voo, ou
que falhou) não alcança nada: errar para o lado de desabilitar se conserta
recarregando.

**Some o CONTROLE, nunca a INFORMAÇÃO** (ADR 0064). Quem não pode editar
continua vendo o modelo vigente no gatilho e a cadeia de origem inteira
([RN-470](#rn-470)), e o "voltar a herdar" continua na linha, inerte — ele é o
que DIZ que aquele agente divergiu, e escondê-lo apagaria um estado que dá para
ler sem poder mudar. O motivo de estarem apagados é dito UMA vez, em texto, na
legenda da seção, e não por `title` em cada linha: tooltip em elemento
`disabled` não abre no Chromium (o navegador não despacha evento de mouse em
controle desabilitado), e uma explicação que não aparece é a mesma ausência com
mais código.

**Nada disso é fronteira de segurança, e o limite é declarado.** Quem recusa
continua sendo o `RolesGuard`. O papel que a tela lê é o do WORKSPACE
(`useCurrentWorkspaceWithRole`) e quem autoriza do outro lado é o papel EFETIVO
do PROJETO (`ResolveEffectiveRoleUseCase.forProject`), que uma linha de
`project_members` SOBREPÕE nos dois sentidos — então quem tem papel próprio no
projeto pode ver aqui um controle desabilitado que a api aceitaria. Fechar isso
exigiria uma consulta de papel POR PROJETO que o web ainda não tem, e é a mesma
lacuna que `AreaModelsSection` já carregava; inventar uma segunda fonte de papel
só numa seção seria pior que a lacuna.

> **Nota aditiva ([RN-471](../business-rules.md#rn-471)):** a lacuna do parágrafo
> acima é UMA, não uma por seção, e onde a tela JÁ faz a consulta de papel por
> projeto ela se fecha em vez de se declarar. A seção de **Membros** busca
> `listProjectMembers`, que é `findMemberRole` para todo mundo de uma vez, e
> compõe `projectRole ?? workspaceRole` — exatamente o que `forProject` faz.
> Isso não é a segunda fonte de papel que este parágrafo recusa: é a MESMA
> composição, a partir de dados que aquela seção já tem em mãos. As duas seções
> de modelo continuam com a aproximação por não terem esses dados. Cuidado ao
> ler "SOBREPÕE nos dois sentidos" acima: é literal, e três descrições de OpenAPI
> afirmam o contrário — ver a RN-471.

- **Onde:** `apps/api/src/domain/llm/binding-resolver.ts` (precedência),
  `apps/api/src/domain/llm/model-capabilities.ts` (capability de `area`),
  `apps/api/src/application/use-cases/llm/resolve-model-binding.use-case.ts`
  (a área do agente sai do catálogo `agent-areas.ts`, sem round-trip ao
  banco), `apps/api/src/application/use-cases/llm/clear-model-binding.use-case.ts`,
  `apps/api/src/interfaces/http/llm/model-bindings.controller.ts`
  (`area-bindings`, `DELETE` em `agent-bindings` e `area-bindings`),
  `apps/web/src/routes/settings/AreaModelsSection.tsx` (coluna Origem com
  "voltar a herdar", e o gate de `maintainer` reescrito sobre `roleAtLeast` sem
  mudar de mínimo),
  `apps/api/src/interfaces/http/llm/model-bindings.controller.ts:195` e `:222`
  (`developer` nos dois endpoints de agente — estas linhas NÃO mudaram),
  `apps/web/src/lib/roles.ts:49` (`roleAtLeast` — a comparação que faltava),
  `apps/web/src/routes/settings/ModelsSection.tsx:77` (`podeEditar`, e por que
  `developer` e não `maintainer`), `:379` (o picker desabilitado), `:446` (o
  botão desabilitado, e por que o motivo não vai em `title`), `:546` (a legenda
  que diz o motivo)
- **Teste:** `test/domain/llm/binding-resolver.spec.ts`,
  `test/domain/llm/model-capabilities.spec.ts`,
  `test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`,
  `test/application/use-cases/llm/clear-model-binding.use-case.spec.ts`,
  `apps/web/src/routes/ProjectSettingsTab.test.tsx`,
  `apps/web/src/routes/settings/papel-na-tabela-de-agentes.test.tsx`
  (`viewer` não edita e o clique não chega na api; `developer` edita e o
  PUT/DELETE chega; papel ausente é inerte; a informação da linha sobrevive ao
  controle apagado; e o caso que impede "uniformizar" as duas seções — o mesmo
  `developer` vê a tabela de agentes habilitada e a de áreas desabilitada, ao
  mesmo tempo)
- **Origem:** [ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) (FASE 23)

### RN-103 — O binding de agente é POR PROJETO, não mais global {#rn-103}

Até a FASE 23, `scope = 'agent'` guardava um SLUG global
(`scope_id = 'qa'`), e `PUT /projects/:id/agent-bindings/:slug` recebia
`:projectId` na rota e o DESCARTAVA de propósito — escolher o modelo do
Arquiteto na tela de um projeto mudava o modelo dele em TODOS os projetos.
Isso deixou de se sustentar quando a área virou padrão herdável (RN-102): a
área é por projeto, e um binding de agente global ACIMA de um padrão por
projeto faria o mesmo agente resolver modelos diferentes só onde existisse
área — e faria "voltar a herdar" apagar uma decisão que alcançava projetos
que ninguém está olhando.

A saída foi tornar `agent` por projeto também, e não rebaixar a área para
abaixo do agente: `scope_id` de `agent` e de `area` virou COMPOSTO —
`<projectId>:<slug do agente|chave da área>` — em vez de inventar uma tabela
nova só para guardar um projeto por binding. UUID de projeto e slug de agente
nunca contêm `:`, o que torna o primeiro `:` um separador não ambíguo; a
leitura corta nele, e não em todos, para um slug com `:` (nenhum existe hoje,
mas nada impede) não virar três pedaços.

`scope_id` sem o projeto (o formato antigo) é RECUSADO na escrita, não aceito
e ignorado: gravá-lo criaria um binding que a cascata nunca mais encontraria
— invisível, e não um erro. A migração 0040 espalha cada binding de agente
global existente para uma linha por projeto (preservando o que cada projeto
resolvia antes da mudança) e apaga o formato antigo; é ESPALHAR e não
apagar porque a linha global nunca guardou informação de a quem "pertencia" —
inventar um projeto dono seria inventar dado que não existia.

- **Onde:** `apps/api/src/domain/llm/binding-scope-id.ts` (formato e
  validação), `apps/api/src/application/use-cases/llm/set-model-binding.use-case.ts`
  (`workspaceDoEscopo` passou a derivar o workspace de `agent`/`area` também —
  a curadoria da RN-043 não era verificável neles antes), `apps/api/src/db/migrations/0040_tearful_night_nurse.sql`
- **Teste:** `test/domain/llm/binding-scope-id.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`,
  `test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`
  ("o binding de agente é POR PROJETO: o vizinho não o enxerga")
- **Origem:** [ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) (FASE 23)

### RN-470 — A origem do modelo distingue binding próprio de herança do Criativo, e nenhum vazio da cascata usa o mesmo símbolo de outro {#rn-470}

`origin: 'agent'` na resposta da api significa **duas coisas diferentes**, e a
api está certa em não separá-las: o agente tem uma linha de escopo `agent` em
`model_bindings`, **ou** a cascata pousou em `workspace` e
[`herdarModeloDeStart`](#rn-102) trocou o valor pelo modelo do Criativo — quem
lê "de onde veio" precisa ver que veio de um AGENTE, não de um escopo que não
existe no banco. Quem tem de separá-las é a **tela**, e até aqui ela não
separava: a coluna Origem imprimia o enum cru, e num projeto com 3 linhas de
`agent` no banco os 12 agentes mostravam a mesma palavra `agent`.

**A origem é uma CADEIA, não uma palavra.** `workspace › projeto › área ›
agente` com quatro estados por nó, e os quatro existem porque dizem coisas
diferentes: **vigente** (é daqui que sai o modelo em uso — o único nó em
`Badge`), **definido** (este nível tem valor próprio, mas um mais específico
venceu), **vazio** (nenhum valor aqui) e **pulado** (tinha valor e a cascata o
descartou por `unavailable`/`sem_tool_calling`, [RN-043](#rn-043)). Colapsar
`definido` em `vazio` devolveria o problema do enum cru um nível abaixo.

**Na herança, o nó `agente` fica VAZIO e um nó extra nomeia o Criativo.** O
nível que a cascata alcançou (`workspace`) aparece como `definido` e **não**
como vigente: o modelo do workspace não é o que vale, e marcá-lo vigente
afirmaria o modelo errado. O nó do Criativo é o único que não é escopo do
banco, de propósito — ele nomeia o passo pós-cascata. A mesma cadeia vale para
a seção de ÁREA, onde `origin: 'agent'` **só** pode ser esse passo: a consulta
de área não põe escopo de agente na cascata.

**A derivação é do CLIENTE, e o que ela não consegue provar continua
acionável.** Nenhum endpoint novo: a tela já busca os quatro níveis. `agent` é
herança quando nenhum nível acima do workspace tinha valor UTILIZÁVEL (o que
foi pulado não segura a descida) e o modelo é o mesmo do Criativo resolvido.
Sobra um caso indistinguível: agente com linha própria apontando para o mesmo
modelo do Criativo, sem padrão de área nem de projeto. Por isso "voltar a
herdar" continua aparecendo em toda origem `agent` — a ação segue disponível
justamente no caso que a cadeia não prova, e nele ela ainda muda o futuro
(sem a linha, o agente passa a acompanhar o Criativo).

**A outra metade dessa escolha: o 404 tem desfecho próprio.** Manter o botão em
toda origem `agent` significa oferecê-lo TAMBÉM onde não há linha para apagar —
e ali `ClearModelBindingUseCase` responde **404**, corretamente ("apaguei o que
não existia" e "apaguei" não são a mesma resposta; colapsá-las esconderia um
`agentSlug` errado). Para quem clicou, porém, esse 404 não é falha: o estado
pedido — o agente herda — **já é verdade**, e chamá-lo de erro seria a tela
contradizendo o que ela sabe. Então ele não passa por `mensagemDaApi` como as
demais recusas, por dois motivos: a frase da api é pt-BR cravada no código e o
idioma default do web é `en`, e este endpoint tem **uma** causa de 404 (papel
insuficiente é 403 no `RolesGuard`, `scope_id` malformado não é 404) — o cliente
SABE o que este 404 significa e pode dizer na língua de quem lê. Qualquer outro
status continua sendo falha de verdade, com a frase da api e tom `danger`. Nos
**dois** desfechos a linha é relida: se a api diz que não havia binding, quem
está velha é a tela.

**E o desfecho próprio é do ENDPOINT, não da tela.** A outra ação da mesma
linha — trocar o modelo pelo `ModelPicker` da coluna MODELO VIGENTE — recusa
por sete caminhos, e **nenhum status identifica um deles sozinho**
(`SetModelBindingUseCase`): 400 para `scope_id` malformado ou `modelId`
reprovado no DTO, 403 para papel abaixo de `developer`, **404 para duas causas
indistinguíveis** ("Modelo não encontrado" e "Projeto não encontrado") e 422
para três ([RN-040](#rn-040) sem tool calling; [RN-043](#rn-043) desativado no
workspace ou sumido do provider). Ali o cliente NÃO pode nomear o 404 —
escolher uma das duas frases seria a tela afirmando o que não sabe —, então
toda recusa segue a gramática normal, com a frase da api e tom `danger`. As
duas funções são vizinhas e tratam o mesmo status de formas opostas de
propósito: o que autoriza o desfecho próprio é a causa ÚNICA, não a tela.

**Na recusa, a coluna MODELO VIGENTE continua exibindo o binding confirmado.**
O `ModelPicker` não guarda a escolha em estado local (`selected` sai do prop
`selectedModelId`, que vem da query), então uma recusa não deixa na tela um
modelo que a api se recusou a gravar — e a linha só é relida no sucesso, já que
na recusa nada mudou no banco. É a mesma disciplina desta RN aplicada ao
tempo: a tela não afirma um estado que não existe, nem por traço, nem por enum,
nem por otimismo.

**Vazio tem texto próprio, e vazios diferentes têm textos diferentes.** Os três
`—` da tela diziam três coisas com o mesmo símbolo e agora dizem cada uma a
sua: `sem modelo em nenhum nível` (nenhum nível tem binding para o agente),
`sem gasto ainda` (o agente não registrou consumo — diferente de `US$ 0,00`,
que é ter rodado de graça) e `sem padrão em nenhum nível` (a área e os dois
níveis acima dela estão vazios). Mesma disciplina da
[RN-180](autenticacao.md#rn-180): a tela não afirma com um traço o que não
consegue nomear.

- **Onde:** `apps/web/src/routes/settings/cascata.tsx:119` (`montarCadeia` — os
  quatro estados e o nó do Criativo), `:178` (`herdouDoCriativo` — a dedução e
  seu limite), `:287` (`CadeiaDeCascata`),
  `apps/web/src/routes/settings/ModelsSection.tsx:122` (`cadeiaDoAgente`),
  `:242` (`handleModelChange` — por que aqui o 404 NÃO tem desfecho próprio, e
  por que a linha só relê no sucesso), `:285` (`handleClearAgentBinding` — os
  três desfechos, e por que o 404 tem o dele), `:352` (coluna Origem), `:422`
  (`não há nível abaixo`), `:441` (`sem gasto ainda`),
  `apps/web/src/components/ModelPicker.tsx:83` (`selected` sai do prop — o
  picker não guarda a escolha, e é por isso que a recusa não deixa valor
  fantasma na tela),
  `apps/api/src/application/use-cases/llm/set-model-binding.use-case.ts:38`
  (as duas causas de 404 deste endpoint — este arquivo NÃO mudou),
  `apps/api/src/interfaces/http/shared/llm-binding-error.filter.ts:39`
  (400/422 das recusas de curadoria — este arquivo NÃO mudou),
  `apps/web/src/routes/settings/AreaModelsSection.tsx:142` (a cadeia da área),
  `apps/api/src/application/use-cases/llm/clear-model-binding.use-case.ts:25`
  (o 404 que a api levanta — este arquivo NÃO mudou),
  `apps/api/src/domain/llm/binding-resolver.ts:140` (o `origin: 'agent'` que a
  api devolve, e o comentário que explica por que ele está certo — este
  arquivo NÃO mudou)
- **Teste:** `apps/web/src/routes/settings/cascata.test.tsx` (binding próprio
  termina no nó `agente`; herança deixa `agente` vazio e nomeia o Criativo;
  o workspace nunca aparece vigente na herança; a seção de área idem; a
  distinção sobrevive ao `en`; nível descartado vira nó riscado e o badge
  concorrente sumiu; os três vazios com três textos; `montarCadeia` e
  `herdouDoCriativo` como funções puras, incluindo o caso do padrão de área
  DESCARTADO, que não segura a descida),
  `apps/web/src/routes/settings/voltar-a-herdar.test.tsx` (os três desfechos do
  clique: apagou e relê; 404 não é erro, não repassa a frase pt-BR da api nem
  em `en`, e relê porque a tela é que estava velha; outro status vai por
  `mensagemDaApi` e não relê),
  `apps/web/src/routes/settings/troca-de-modelo.test.tsx` (a outra ação da
  mesma linha: grava e relê; 422 do modelo `unavailable` — o alcançável, já
  que o picker mostra o indisponível marcado — vai por `mensagemDaApi` e não
  relê; a coluna MODELO VIGENTE segue no modelo antigo, nunca no recusado; e o
  404 NÃO ganha desfecho próprio, que é o contraste com a função irmã)
- **Origem:** revisão de design do dono do produto (item #9 do canvas de
  melhorias de UI — "cascata de modelo como cadeia visível")

### RN-059 — Falha de turno é evento durável com origem, e o agente fala {#rn-059}

Quando um turno de LLM falha, o agente grava **`agent.error`** no event log
com três campos: `origem` (vocabulário do ADR 0020), `mensagem` em português e
o `reason` bruto. E a mensagem aparece **no fio da conversa**, não só no log.

Era o contrário, e o desfecho era o pior possível: os quatro agentes
conversacionais gravavam `agent.response` com conteúdo **vazio** —
indistinguível de sucesso no log imutável — e mandavam o motivo por
`broadcast`, que é efêmero. Quem não estivesse com a aba aberta naquele
segundo nunca saberia que houve erro; quem estivesse, via um balão em branco.

Havia um segundo caminho, pior ainda: quando a api narrava a falha no PRÓPRIO
frame final (budget, credencial ausente, binding faltando), o turno não caía no
ramo de erro e **não emitia evento nenhum** — silêncio absoluto.

Esse mesmo ramo, uma vez corrigido, custou uma segunda rodada: no PO, no
Arquiteto e no Dev Lead ele devolvia `{state, ""}` — uma TUPLA onde todos os
outros ramos de `run_turn` devolvem o `state` (um mapa). O `Map.put/3` de
`TurnoAssincrono.tratar_resultado/2` levantava `BadMapError` dentro do
`handle_info`, e como os quatro conversacionais são `restart: :temporary`, o
agente MORRIA e não voltava. A falha deixava de ser silenciosa e virava uma
queda — com os gatilhos mais corriqueiros que existem. A regra vale inteira: o
agente narra a falha **e continua de pé**. Por isso `tratar_resultado/2` tem
uma segunda barreira, no ponto compartilhado pelos quatro: resultado de turno
que não é mapa vira `agent.error` com origem `codigo`, nunca um processo morto.

A origem NUNCA é adivinhada: cada padrão em `FalhaDeTurno.origem/1` tem um
motivo escrito, e o que não casa com nenhum sai como **`codigo`** — a lacuna é
do nosso classificador, e essa é a origem que aponta a ação certa (ADR 0020).

Os eventos já gravados não se apagam — a tela os NOMEIA como resposta vazia
anterior a esta regra, em vez de mostrar branco.

- **Onde:** `apps/engine/lib/engine/agents/falha_de_turno.ex`,
  `criativo_server.ex`, `po_server.ex`, `arquiteto_server.ex`,
  `dev_lead_server.ex`, `infra_lead_server.ex` (`emit_falha/2`),
  `turno_assincrono.ex` (`tratar_resultado/2`, a segunda barreira),
  `apps/web/src/lib/session-falha.ts`
- **Teste:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (evento durável com origem; nunca grava resposta vazia; erro narrado no frame
  final também vira evento); `po_server_test.exs` (o frame final com erro não
  derruba o agente — GenServer de VERDADE, com `Process.alive?/1`);
  `arquiteto_server_test.exs` e `dev_lead_server_test.exs` (mesmo caminho, ciclo
  completo); `turno_assincrono_test.exs` (a segunda barreira narra em vez de
  derrubar); `apps/web/src/lib/session-falha.test.ts`
- **Origem:** execução real da FASE 13b

### RN-116 — Falha ao CRIAR um handoff não derruba o agente {#rn-116}

`confirm_readiness` (Criativo → PO) e `offer_infra_handoff`/`offer_dev_handoff`
(Arquiteto → Infra/Dev Lead) chamam a api pra criar o handoff DEPOIS de o
turno já ter rodado — no caso do Criativo, depois de o `product_brief` já
estar gravado no event log. Se essa chamada falhar (api fora, 5xx, etc.), o
handoff não existe, mas isso NUNCA derruba o GenServer do agente: a falha vira
`agent.error` durável, com `origem` (`FalhaDeTurno.origem/1`) e uma mensagem
que diz o que JÁ foi salvo (o product_brief, as regras) e o que não foi (o
handoff) — para o usuário saber que confirmar de novo é seguro, não repete
trabalho.

Era o oposto: as três chamadas usavam `{:ok, _handoff} = EngineApiClient.create_handoff(...)`
— um match rígido. `{:error, _}` virava `MatchError`, e como os três agentes
sobem com `restart: :temporary` num `DynamicSupervisor` `:one_for_one`, o
processo simplesmente SUMIA — sem `agent.error`, sem resposta no fio, só
silêncio. Do lado de quem observava: a informação (regras, product brief)
parecia ter "passado" (estava gravada), mas nada iniciava do lado do agente
seguinte, porque o handoff nunca chegou a existir. Reabrir a conversa não
resolvia sozinho — só uma NOVA mensagem reativa o processo (rehidratando do
event log), e só uma nova confirmação de prontidão tenta o handoff de novo.

A mensagem NÃO reusa `FalhaDeTurno.mensagem/1` (a de `RN-059`, "não consegui
completar este turno... nada foi gasto"): nos três call sites o trabalho já
rodou (ou nem precisava rodar, no caso de `offer_dev_handoff`) — dizer "nada
foi gasto" seria falso quando tokens já tinham sido gastos no turno de
consolidação. Reusa só `FalhaDeTurno.origem/1`, que classifica pelo FORMATO
do motivo (status HTTP, exceção de transporte), não por ser turno de LLM.

O `Engine.Harness.Tools.OfferHandoff` (a ferramenta que o PO usa via tool
call, dentro do ToolLoop) já tratava `{:error, reason}` sem crashar — o
defeito era só nestes três handlers server-driven, que chamam
`EngineApiClient.create_handoff/5` DIRETO em vez de passar pela ferramenta.

- **Onde:** `apps/engine/lib/engine/agents/criativo_server.ex`
  (`handle_call(:confirm_readiness, ...)`, `emit_falha_handoff/3`),
  `apps/engine/lib/engine/agents/arquiteto_server.ex`
  (`handle_call(:offer_infra_handoff, ...)`, `handle_call(:offer_dev_handoff, ...)`,
  `emit_falha_handoff/3`)
- **Teste:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  ("prontidão: falha ao criar o handoff NÃO derruba o processo, e vira
  agent.error durável"); `apps/engine/test/engine/agents/arquiteto_server_test.exs`
  (as quatro variantes de `offer_infra_handoff`/`offer_dev_handoff`, sucesso e
  falha)
- **Origem:** relato de uso real no projeto `exp-001` (Criativo → PO); a
  mesma falha estrutural foi achada por leitura de código nos dois handoffs
  do Arquiteto, sem reprodução separada para eles

### RN-058 — A chave que o AGENTE gasta é a do owner do workspace {#rn-058}

Credencial de LLM pertence a uma pessoa (`user_credentials.user_id`), e agente
não é pessoa. O turno de agente resolve a chave pelo **owner do workspace**
(`workspaces.created_by`), não por quem abriu a sessão nem por quem criou o
projeto: quem banca a conta banca os agentes, e isso não muda quando outra
pessoa da equipe começa a sessão.

`created_by` e não `workspace_members.role = 'owner'`: pode haver vários
owners, e "qualquer um deles" faria a chave usada variar sem ninguém decidir.

Antes disto o turno passava o **slug do agente** (`agentId ?? sessionId`) na
coluna de usuário. A consulta ia ao banco com `user_id = 'criativo'`, o
Postgres recusava o UUID inválido, e o erro virava **resposta vazia** no fio —
sem métrica, sem evento de falha, sem nada na tela. O efeito prático, que só
uma execução real revelou: **nenhum agente jamais usou um provider com
credencial**. Só `ollama` funcionava, porque para ele a busca é pulada — e foi
com modelo local que a Fase 4, o dogfooding da Fase 10 e todas as demos
rodaram.

O chat humano nunca teve o defeito: ele usa `actor.id`, que é o usuário de
verdade.

- **Onde:**
  `apps/api/src/application/use-cases/llm/resolve-credential-owner.use-case.ts`,
  `apps/api/src/application/use-cases/llm/stream-llm-turn.use-case.ts`,
  `apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts`
- **Teste:** `test/application/use-cases/llm/resolve-credential-owner.use-case.spec.ts`
  (o owner vence quem criou o projeto; a chave encontrada é a dele; projeto
  inexistente é 404 e não erro de banco)
- **Origem:** execução real da FASE 13b

### RN-056 — Faceta de capability vem do provider; silêncio preserva o que estava {#rn-056}

`supports_vision`, `supports_reasoning` e `generates_image` são **fato do
provider**, não opinião: saem do catálogo remoto no sync, com o mesmo fallback
de `supports_tool_calling` — remoto, depois local, depois `false`.

No OpenRouter (o único que publica isso hoje) as três saem de:
`architecture.input_modalities` contém `image`,
`supported_parameters` contém `reasoning`, e
`architecture.output_modalities` contém `image`. Aceitar imagem e **produzir**
imagem são eixos distintos: fundi-los mandaria o usuário para o modelo errado.

Antes, o sync lia `supportsVision` do que já estava GRAVADO e nunca consultava
o remoto — a coluna nascia `false` e não havia caminho para virar verdadeira.
Os 338 modelos do primeiro sync real ficaram todos `false`, incluindo 181 que o
provider declara como multimodais.

**Ausência de declaração não é declaração de ausência**
([ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)): o
parser OMITE o campo quando o provider se cala, e `undefined` preserva o valor
local. Por isso a tela usa as facetas só como filtro POSITIVO e nunca escreve
"não lê imagem" — `false` aqui quer dizer "o provider não declarou".

- **Onde:** `apps/api/src/infrastructure/llm/openrouter-provider.ts`
  (`temModalidade`, `parseCatalogoOpenRouter`),
  `apps/api/src/application/use-cases/llm/sync-model-catalog.use-case.ts`,
  `apps/api/src/db/schema/llm.ts` (`models`)
- **Teste:**
  `test/infrastructure/llm/openrouter-provider.contract.spec.ts`
  (`modalidade não declarada OMITE o campo em vez de afirmar false`);
  `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
  (`catálogo que se cala sobre modalidade preserva a faceta gravada`)
- **Origem:** [ADR 0051](../adr/0051-facetas-de-capability-e-curadoria-por-uso.md)

### RN-057 — "Para que serve" é curadoria do workspace, e marcar uso não liga o modelo {#rn-057}

Nenhum catálogo de provider publica "bom para código". Isso é **opinião de quem
opera**, descoberta usando — então mora em `workspace_models.uses`, ao lado da
outra decisão do workspace ([RN-052](#rn-052)), e não em `models`.

Vocabulário FECHADO — `codigo`, `documentacao`, `analise`, `imagem`,
`conversa` —, com prova de exaustividade em tempo de compilação nos dois lados.
Texto livre daria `code`, `coding` e `código` no mesmo filtro em uma semana.

Duas regras que mantêm os eixos separados:

1. **Marcar uso não liga o modelo.** `workspace_models.is_active` tem DEFAULT
   `true`, então a linha criada por uma marcação de uso é inserida com
   `is_active = false` explícito. Sem isso, opinar sobre um modelo o autorizaria
   a gastar, contra a [RN-043](#rn-043).
2. **Trocar o uso não desliga o que estava ligado.** `is_active` fica fora do
   `SET` do `ON CONFLICT`.

A lista de usos **substitui** a anterior, não soma: lista vazia é como se
desmarca tudo, e é um estado legítimo — "ninguém opinou" não é "não serve".

- **Onde:** `apps/api/src/domain/llm/model-uses.ts`,
  `apps/api/src/db/schema/llm.ts` (`workspace_models.uses`),
  `apps/api/src/infrastructure/persistence/drizzle/workspace-model.repository.ts`
  (`setUses`),
  `apps/api/src/application/use-cases/llm/set-model-uses.use-case.ts`
- **Teste:** `test/application/use-cases/llm/set-model-uses.use-case.spec.ts`
  (`marcar uso NÃO liga o modelo — a linha nova nasce inativa`,
  `trocar o uso não desliga o que já estava ligado`,
  `o uso vale só neste workspace`)
- **Origem:** [ADR 0051](../adr/0051-facetas-de-capability-e-curadoria-por-uso.md)

### RN-038 — Agente contado no resumo do workspace = gastou tokens este mês {#rn-038}

O resumo do dashboard de projetos ("N projetos ativos · M agentes · gasto
este mês") conta como "agente" quem tem pelo menos uma linha em
`token_usage` com `actor_kind = 'agent'` no mês corrente, somando todos os
projetos do workspace. Sem o filtro de `actor_kind`, um `user` mandando
chat ou um `system` registrando uso inflaria a contagem — `token_usage`
grava para qualquer tipo de ator, não só agente. O corte por mês usa
`created_at >= date_trunc('month', now())`; um agente que trabalhou só no
mês anterior não conta, mesmo que ainda apareça no roster de alguma
sessão. A contagem naturalmente inclui as subespecialidades de área da
Fase 8 (`qa-automacao`, `qa-performance-seguranca`, `infra-workflows`):
cada uma tem seu próprio `actor_id` quando gasta tokens.

- **Onde:** `apps/api/src/infrastructure/persistence/drizzle/token-usage.repository.ts`
  (`summarizeForWorkspaceThisMonth`)
- **Teste:** `test/application/use-cases/iam/get-workspace-summary.use-case.spec.ts`

---
