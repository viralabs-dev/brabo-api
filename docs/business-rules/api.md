---
id: rn-api
title: 'Business rules — API'
sidebar_label: API
description: 'The business rules hosted at the api root.'
keywords: [business rules, api]
idioma_original: en
---
# API

## Session

Brabo executes engineering work through AI agents. Two forces shape virtually
every rule here:

**The agent is not trustworthy by construction.** It's a language model: it
can hallucinate, get stuck in a loop, or request something destructive. The
rules exist so the possible damage is bounded by structure, not by prompt
quality.

**Spend is real and continuous.** Every turn consumes a paid token. Budget,
ceiling, and metering aren't administrative conveniences — they're what
stops an agent loop from turning into a loss.

### Actors

| actor | who it is | authority |
|---|---|---|
| **User** | the person. Roles: `viewer`, `developer`, `maintainer`, `owner` | final decision on any action with external effect; merge is theirs exclusively |
| **Agent** | long-running process with a role (Creative, PO, Architect, Dev, Infra, QA, SecOps, Psychologist, Anamnesis) | proposes; never decides alone what policy doesn't allow |
| **System** | api and engine | enforces policy, records the event, measures cost |

The vocabulary is in the [glossary](../glossary.md).

---

## Business context

### RN-001 — The session has five states and closed transitions {#rn-001}

`created → active → closing → closed`, with `closed_abnormally` reachable
from any non-terminal state. **From `closing` there's never a way back to
`active`**, and terminal states have no exit.

```mermaid
stateDiagram-v2
  [*] --> created
  created --> active
  created --> closed_abnormally: provisioning failure
  active --> closing
  active --> closed_abnormally
  closing --> closed
  closing --> closed_abnormally
  closed --> [*]
  closed_abnormally --> [*]
```

- **Where:** `src/domain/sessions/session-state-machine.ts:29`
- **Test:** `test/domain/sessions/session-state-machine.spec.ts`
- **Edge case:** `closing` is a **transient** state. A session stuck there
  means the drain started and didn't complete — there's an alert for that,
  see the [runbook](../runbook.md).

### RN-002 — Every session event is immutable and `seq` is dense {#rn-002}

There's never an `UPDATE` on `session_events`. `seq` is unique per session
(`unique(session_id, seq)`) and has no gaps: it starts at 1 and is contiguous.

- **Where:** `src/db/schema/sessions.ts` (table `session_events`)
- **Test:** verified on restore — `docker/backup/restore.sh` fails if
  `count(*) ≠ max(seq) − min(seq) + 1` or `min(seq) ≠ 1`
- **Why:** it's what makes the Psychologist's evidence traceable and the
  backup verifiable. State that needs to change lives in its own table,
  alongside.

## Action approval

The heart of the system. Every action with an external effect is born as a
`proposed_action`.

### RN-003 — The action has six states, and denied is terminal {#rn-003}

```mermaid
stateDiagram-v2
  [*] --> pending
  [*] --> auto_approved: policy allowed it
  pending --> approved: user approves
  pending --> denied: user denies
  approved --> executed
  approved --> failed
  auto_approved --> executed
  auto_approved --> failed
  denied --> [*]
  executed --> [*]
  failed --> [*]
```

- **Where:** `src/domain/actions/action-state-machine.ts:36`
- **Test:** `test/domain/actions/action-state-machine.spec.ts`
- **Edge case:** an approved action that executed becomes `executed`,
  **not** still `approved`. Counting approvals by `status = 'approved'`
  gives the wrong number — the correct criterion is `decided_by IS NOT
  NULL`.

### RN-004 — The decision is evaluated in three stages, and `deny` wins immediately {#rn-004}

Order: **(a) IAM → (b) `agent_autonomy` → (c) `permissions.json`**. Each
stage can only **raise** permissiveness; a silent stage never lowers the
previous one. `deny` at any stage returns immediately.

- **Where:** `src/domain/actions/decide.ts:118`
- **Test:** `test/domain/actions/decide.spec.ts` (10 KB — the largest in
  the domain)

### RN-005 — Minimum role per action type {#rn-005}

Before any policy, IAM: each `ActionType` requires a minimum effective
role. Without it, `deny` with an explicit reason.

- **Where:** `src/domain/actions/decide.ts:115` (`MIN_ROLE_FOR_ACTION_TYPE`)
- **Test:** `test/domain/actions/decide.spec.ts`

### RN-006 — Ceiling: merge into a protected branch is never auto-approvable {#rn-006}

`dev`, `qa`, `rc`, and `main` are protected. A `git_merge` targeting one of
them is downgraded from `auto_approve` to `require_approval` **after** all
the policy has run. Neither `agent_autonomy` nor `permissions.json` can
promote it.

`rc` stays on the list even after the step left the policy
([ADR 0030](../adr/0030-politica-de-branches-mecanizada.md)) and the bootstrap
stopped creating it ([RN-029](#rn-029)). This list decides what the lock
**refuses**, and repositories bootstrapped by earlier versions still have
the branch: protecting one that doesn't exist costs nothing; unprotecting
one that exists costs dearly.

- **Where:** `src/domain/actions/decide.ts:511` (`isProtectedBranch`, o teto da trava de merge) + `protected-branches.ts:4`
- **Test:** `test/domain/actions/decide.spec.ts`
- **Origin:** [ADR 0011](../adr/0011-infra-dev-agents-worktrees-merge-lock.md) §1
- **Note:** the equivalent protection **on the platform** (GitHub/GitLab)
  diverges between providers and isn't the gate — see
  [ADR 0028](../adr/0028-protecao-de-branch-divergencia-entre-providers.md).

### RN-007 — Ceiling: an instruction patch is never auto-approvable {#rn-007}

Changing an agent's instruction always requires a human decision. The
feature's value is in the human seeing the diff; auto-approving would be
the agent rewriting itself.

- **Where:** `src/domain/actions/decide.ts:168`
- **Test:** `test/domain/actions/decide.spec.ts`
- **Origin:** [ADR 0016](../adr/0016-anamnese-proficiencia-patches-instrucao.md) §8

### RN-008 — Command matching is by pattern, not substring {#rn-008}

`permissions.json` matches a terminal command by structured pattern, with
the command properly tokenized — not by `includes()`.

- **Where:** `src/domain/actions/command-matcher.ts`
- **Test:** `test/domain/actions/command-matcher.spec.ts`

---

## Backlog

### RN-009 — The story has four states, and `done` is terminal {#rn-009}

`draft → ready → in_progress → done`. Rework is allowed: `ready → draft` and
`in_progress → ready`.

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> ready: passes readiness check (RN-010)
  ready --> in_progress
  ready --> draft: rework
  in_progress --> done
  in_progress --> ready: returned
  done --> [*]
```

- **Where:** `src/domain/backlog/story-state-machine.ts:27`
- **Test:** `test/domain/backlog/story-state-machine.spec.ts`

### RN-010 — `draft → ready` requires four things, validated in the domain {#rn-010}

For a story to become `ready` it needs, **all of them**:

1. `dod` not empty — Definition of Done
2. `dor` not empty — Definition of Ready
3. at least 1 functional requirement (`rf`)
4. at least 1 linked business rule (`businessRuleIds`)

The error names **exactly what's missing**, not a generic "invalid".

- **Where:** `src/domain/backlog/story-readiness.ts:39`
- **Test:** `test/domain/backlog/story-readiness.spec.ts`
- **Origin:** [ADR 0009](../adr/0009-agente-po-backlog-rastreabilidade.md) §3
- **Why:** it's what stops the PO from dumping a vague story into the dev
  queue.

### RN-011 — Business rule with no story is a finding, not an error {#rn-011}

Rule→story coverage is computed, and what has no story shows up as
**pending** — information, not a failure.

- **Where:** `src/domain/backlog/coverage.ts`
- **Test:** `test/domain/backlog/coverage.spec.ts`

### RN-013 — The module graph cannot have a cycle {#rn-013}

- **Where:** `src/domain/architecture/module-graph.ts`
- **Test:** `test/domain/architecture/module-graph.spec.ts`

---

## PR Gates

### RN-014 — The gate order is immutable and `awaiting_user` is terminal {#rn-014}

`awaiting_qa → awaiting_secops → awaiting_user`. Approving QA **never**
skips straight to the user. `changes_requested` sends it back to the dev
**on the same branch**, with no new PR.

```mermaid
stateDiagram-v2
  [*] --> awaiting_qa
  awaiting_qa --> awaiting_secops: QA approves
  awaiting_qa --> awaiting_qa: changes_requested (back to dev)
  awaiting_secops --> awaiting_user: SecOps approves
  awaiting_secops --> awaiting_secops: changes_requested
  awaiting_user --> [*]: merge is the human's
```

- **Where:** `src/domain/execution/pr-gate-state-machine.ts:24`
- **Test:** `test/domain/execution/pr-gate-state-machine.spec.ts`
- **Origin:** [ADR 0013](../adr/0013-gates-qa-secops-pr.md) §1
- **Edge case:** `awaiting_user` is terminal **by design** — the system
  never merges (RN-006).

### RN-015 — Cycle K: the correction ceiling is finite and inherited {#rn-015}

Every gate return consumes a lap. Once the ceiling is exhausted, the task
is **blocked** with a reason, instead of spinning forever. A subagent
created by parallelization **inherits** the base agent's ceiling.

Since Phase 8b the ceiling also applies to the QA AREA, with no code
change: `QaLeadServer` is the only caller of `record_gate_verdict`, so one
gate round — no matter how many specializations it consulted underneath —
still consumes exactly ONE lap. See
[RN-036](engine.md#rn-036).

- **Where:** `DEFAULT_MAX_GATE_CORRECTIONS = 3` in
  `src/application/use-cases/execution/record-gate-verdict.use-case.ts:21`;
  applied in `activate-execution.use-case.ts:89` and, in the engine, in
  `qa_lead_server.ex:268` and `secops_agent_server.ex:142`
- **Test:** `apps/engine/test/engine/gates/qa_automacao_agent_test.exs`
  (the specialization returns `{:blocked, ...}` without calling the api)
  and `qa_lead_server_test.exs` (the Lead NEVER calls
  `record_gate_verdict` in that case — that's what stops the correction
  from being burned)
- **Origin:** [ADR 0017](../adr/0017-lock-de-workspace-e-monitor-de-dev-agents.md) §4

### RN-017 — Budget has an exclusive scope: project **or** session {#rn-017}

A `budget` references a project or a session, never both — guaranteed by
a `check` in the database, not just in code.

- **Where:** `src/db/schema/llm.ts` (`budgets_scope_check`)
- **Test:** the constraint is the guarantee

### RN-018 — Budget notification at 70%, 90%, and 100%, without repeating {#rn-018}

Each threshold fires **once**; the last one notified is persisted in
`budgets.last_threshold_notified`.

- **Where:** `src/domain/llm/budget-threshold.ts:1`
- **Test:** `test/domain/llm/budget-threshold.spec.ts`

### RN-019 — `policy = 'block'` refuses the call; `'allow'` only records {#rn-019}

- **Where:** `src/domain/llm/budget-threshold.ts:4`
- **Edge case:** a project in `allow` **doesn't stop itself** at the
  ceiling. It's the most common cause of "the budget didn't hold" — see
  the [runbook](../runbook.md).

### RN-020 — The model is resolved by cascade, from most specific to most general {#rn-020}

`session > agent > area > project > workspace`. The first one that
exists wins. `area` entered in PHASE 23 — see [RN-102](#rn-102) for its
position and what changes for whoever already read this cascade.

- **Where:** `src/domain/llm/binding-resolver.ts`
- **Test:** `test/domain/llm/binding-resolver.spec.ts`

## Psychologist and Anamnesis {#psicologo-e-anamnese}

### RN-021 — A hypothesis without valid evidence is not recorded {#rn-021}

The `evidenceEventIds` must point to events **that exist and belong to the
analyzed session**. Validation is atomic per batch: one invalid id fails the
entire batch.

- **Where:** `src/domain/psychologist/hypothesis-evidence.ts`
- **Test:** `test/domain/psychologist/hypothesis-evidence.spec.ts`
- **Origin:** [ADR 0015](../adr/0015-psicologo-real-toolloop-hipoteses-evidencia.md) §3

### RN-022 — The hypothesis lifecycle is compare-and-swap {#rn-022}

`proposed → accepted | dismissed`. Two concurrent decisions on the same
hypothesis: one wins, the other gets a conflict — not 500, not silence.

- **Where:** `src/domain/psychologist/hypothesis-lifecycle.ts`
- **Test:** `test/domain/psychologist/hypothesis-lifecycle.spec.ts`
- **Origin:** [ADR 0022](../adr/0022-fechamento-4b-psicologo.md) §7

### RN-024 — The Anamnese only profiles competencies from the catalog — a structural guardrail {#rn-024}

Process competencies are **six**, closed: `git`, `agile`, `arquitetura`,
`testes`, `seguranca`, `infra`. Plus the technical stacks derived from the
`module_map`. Anything else — "anxiety", "mental health" — **has no
write path**: it's a domain error, not a prompt instruction.

- **Where:** `src/domain/anamnese/competency-catalog.ts:16`
- **Test:** `test/domain/anamnese/competency-catalog.spec.ts`
- **Origin:** [ADR 0016](../adr/0016-anamnese-proficiencia-patches-instrucao.md) §1
- **Why:** the Anamnese profiles **technical competence**, not the person. The limit
  is structural because a prompt instruction is not a guarantee.

### RN-025 — Deleting the profile really deletes it, and the opt-out prevents re-derivation {#rn-025}

- **Where:** `src/domain/anamnese/proficiency-profile.entity.ts` +
  table `anamnese_opt_outs`
- **Origin:** [ADR 0016](../adr/0016-anamnese-proficiencia-patches-instrucao.md) §2

### RN-026 — A denied instruction patch is not proposed again {#rn-026}

The comparison is on the **normalized** content, not on the literal text:
reindenting the same patch doesn't turn it into a new proposal. There's no
dedup table — the source is the `proposed_action` history itself with `actionType =
instruction_patch` and `status = denied`.

- **Where:** `src/domain/instructions/patch-dedup.ts:22`
- **Test:** `test/domain/instructions/patch-dedup.spec.ts`

### RN-027 — Instruction rollback is a **forward** operation {#rn-027}

Reverting creates a new version with the old content; it doesn't delete history. The
versions table is append-only.

- **Where:** `src/domain/instructions/`
- **Origin:** [ADR 0016](../adr/0016-anamnese-proficiencia-patches-instrucao.md) §4

---

## Git

### RN-029 — The Gitflow bootstrap is idempotent and resumable {#rn-029}

Five steps; each one checks before acting and can be resumed from the point where it
failed. `skip` is success, not error.

There used to be six. The sixth created the `rc` branch, a rung that
[ADR 0030](../adr/0030-politica-de-branches-mecanizada.md) removed from the policy —
the bootstrap kept creating, protecting, and **documenting in the user's
repository** a ladder the product had already abandoned (finding #3 of the first
dogfooding). The value `create_rc_branch` remains in the `bootstrap_step` enum:
old rows reference it, and a step that really happened isn't erased from
history.

- **Where:** `src/application/use-cases/git/bootstrap-steps.ts` +
  `domain/git/repo-bootstrap.entity.ts` (`RETIRED_BOOTSTRAP_STEPS`)
- **Test:** `test/domain/git/repo-bootstrap-status.spec.ts`
- **Origin:** [ADR 0005](../adr/0005-repo-bootstrap-idempotent-steps.md)

---

### RN-030 — Presenting an already-used refresh revokes the whole family {#rn-030}

Each refresh consumes the presented token and issues a child with the **same**
`family_id` and the same `family_started_at`. Presenting a token that was already
consumed is the signature of a theft — someone is using a copy — and the
response is to revoke every live token of that family, with a security
event.

The legitimate user is logged out along with it. That is the correct behavior, not a
defect: on the server side, a client double-submit and a thief's replay
are identical.

- **Where:** `src/domain/auth/refresh-token.ts:50` +
  `application/use-cases/auth/refresh.use-case.ts:98`
- **Test:** `test/application/use-cases/auth/rotacao-e-reuso.spec.ts`
- **Edge case:** whoever presents a token from an **already revoked** family is a
  downstream victim, not a new theft: it records `refresh_revoked` and does **not** fire a second
  cascade. Without that distinction, each tab of the legitimate user would raise a false
  alarm during the incident.
- **Origin:** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-031 — Login failure is counted per e-mail and per IP, and the lockout escalates {#rn-031}

A 15-minute sliding window in Postgres, without Redis. Two buckets per
attempt and the most restrictive wins: e-mail (5 failures → 30s, 8 → 5min, 12 →
15min) and IP (20 → 30s, 30 → 2min). A successful login clears the
e-mail bucket; the IP one drains only over time.

The bucket key is the **normalized e-mail**, never the user id. With the id, the
bucket would only exist after finding the account, and the lockout itself would become
an existence oracle.

- **Where:** `src/domain/auth/lockout-policy.ts:97` +
  `infrastructure/persistence/drizzle/drizzle-login-throttle.ts:74`
- **Test:** `test/application/use-cases/auth/lockout.spec.ts`
- **Edge case:** while locked, the attempt is **not** recorded. If it were, an
  attacker would keep the victim's account locked forever just by continuing to
  try — the lockout would become a denial of service against the one it protects.
- **Why:** the IP bucket cannot be cleared on success; whoever has a valid
  account would reset the window at will and spray guesses without limit.
- **Origin:** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-032 — No response distinguishes an existing account from a nonexistent one {#rn-032}

Any response other than the uniform failure is only reachable **after** a
successful password check. On login, nonexistent e-mail, wrong password and
locked account return the same 401 and spend the same time — the no-account branch
verifies against a dummy hash generated with **the same parameters** as the real one. On
registration and on the reset request, known and unknown addresses return 202.

- **Where:** `src/application/use-cases/auth/login.use-case.ts:79` +
  `register.use-case.ts:74`
- **Test:** `test/application/use-cases/auth/enumeracao.spec.ts`
- **Edge case:** the per-e-mail lockout check runs **after** argon2, not
  before. Exiting earlier is the optimization any reviewer would suggest, and it is
  exactly the leak — the test turns red if someone introduces it.
- **Edge case:** the user MIGRATED from Keycloak (exists in `users`, with no row in
  `auth_credentials`) also gets the uniform 401 — and the "set
  password" link is sent silently. Answering `password_pending` would confirm that
  the address exists **and** that it is a legacy account. That is why `findByEmail` is a LEFT
  JOIN in a single query: two chained queries would make this branch pay one
  extra round trip to the database, and the clock would reveal what the body hides.
- **Why:** what is claimed is "no branch skips the expensive work and none
  produces a distinguishable response", **not** constant time. See the consequences
  in the ADR.
- **Origin:** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md),
  migrated-user edge case in
  [ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

### RN-033 — Verification and reset tokens are valid only once {#rn-033}

Consumption by conditional UPDATE with `returning`: the UPDATE itself is the guard.
Zero rows covers nonexistent, of another purpose, already consumed, invalidated and
expired — all with the same response. Requesting a new link invalidates the previous one.
Completing a reset revokes **all** of the user's sessions and issues no tokens.

- **Where:** `src/infrastructure/persistence/drizzle/account-token.repository.ts:76`
- **Test:** `test/application/use-cases/auth/tokens-de-conta.spec.ts`
- **Edge case:** two simultaneous submissions do not both pass. The race is the
  **normal** case, not the exception: corporate e-mail scanners open every link of
  every message, so the robot usually consumes the token before the human clicks.
- **Why:** the reset issues no session on purpose — logging in directly from
  a link received by e-mail would make compromising the e-mail equal to taking over the
  account, with no second step.
- **Origin:** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-034 — The web session lives in an httpOnly cookie, with CSRF {#rn-034}

The refresh token goes in a `brabo_refresh` cookie (`httpOnly`, `SameSite=Strict`,
`Path=/auth`, `Secure` in production) and does **not** appear in the body of any
response. The access token, of 15 minutes, stays in memory on the client and travels in
`Authorization: Bearer`.

`/auth/refresh` and `/auth/logout` require `X-CSRF-Token` equal to the
`brabo_csrf` cookie, compared in constant time.

- **Where:** `src/interfaces/http/auth/session-cookies.ts:53` +
  `interfaces/http/auth/auth.controller.ts`
- **Test:** `test/interfaces/session-cookies.spec.ts`
- **Edge case:** a CSRF failure is **403**, not 401. With 401 the client would try
  to renew the session and enter a loop — the credential is fine, what is wrong
  is the request.
- **Why:** also returning the refresh in the body would cancel out `httpOnly` —
  an XSS reading the login response would be enough, and it would take the long session instead of
  the 15 minutes of the access token.
- **Origin:** [ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

### RN-035 — Internal engine ↔ api traffic requires the service secret {#rn-035}

The 32 `/internal/*` routes are `@ServiceRoute()`: they stay outside the user JWT and
outside the rate limit. What authenticates is the `EngineServiceGuard`, comparing
`X-Brabo-Service-Token` with `BRABO_SERVICE_TOKEN` in constant time. The same
secret holds in both directions, and `BRABO_SERVICE_TOKEN_PREVIOUS` is accepted only on
verification, so that rotation has no unavailability window.

- **Where:** `src/interfaces/http/auth/engine-service.guard.ts:44` +
  `infrastructure/security/service-token.ts` +
  `apps/engine/lib/engine_web/plugs/verify_service_token.ex`
- **Test:** `apps/engine/test/engine_web/plugs/verify_service_token_test.exs`,
  `test/interfaces/route-surface.spec.ts` and, for rotation on the api side
  (previous accepted only on verification, the caller sends the current one, once the
  previous is removed the old one fails), `test/infrastructure/security/service-token.spec.ts`
  (describe "rotação do BRABO_SERVICE_TOKEN") and
  `test/interfaces/engine-service.guard.spec.ts` ([RN-597](#rn-597))
- **Edge case:** the rate limit exemption comes from the route METADATA, not from the guard. The
  `RateLimitGuard` is an `APP_GUARD` and runs before any controller guard —
  when it decides, the `EngineServiceGuard` has not run yet.
- **Origin:** [ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

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

- **Onde:** `src/infrastructure/persistence/drizzle/token-usage.repository.ts`
  (`summarizeForWorkspaceThisMonth`)
- **Teste:** `test/application/use-cases/iam/get-workspace-summary.use-case.spec.ts`

---

### RN-040 — Agent binding requires native tool calling {#rn-040}

Binding a model to an **agent** (`scope = 'agent'`) is only allowed if the
model has `supports_tool_calling`. An agent only exists inside the
ToolLoop, and the ToolLoop only works if the model knows how to **ask for**
tools; without that, the failure would show up later as "the agent stopped
without finishing", which is exactly the diagnosis by elimination that
[ADR 0020](../adr/0020-destravar-gates-qa-secops.md) forbade. The refusal is a
422 and the message points to the **"suited for agents"** filter — without that
pointer the rule becomes a dead end.

The engine's `ToolCallRecovery` recovers calls the model wrote in prose, but
it is a **rescue, not a license**: it depends on the model getting the format
right by chance.

Only `agent` validates. `workspace` and `project` are the fallback of the human
chat and `session` is a conversation — none of them runs a ToolLoop, and
locking them would forbid chat-only models in the product. The `context-manager`
agent is covered by construction: it is a slug **inside** the `agent` scope, not
a scope of its own.

**Additive note — the filter now arrives CHECKED, and the SCOPE is what turns
it on.** The paragraph above says the refusal points to the "suited for agents"
filter, "otherwise the rule becomes a dead end" — and for a long time it was
one: the prop that opens the picker with the filter checked had existed since
Phase 9c and **no production screen passed it**. An agent's picker opened
offering a chat-only model whose click existed only to be refused. The two
screens that write to a validated scope now open filtered — `ModelsSection`
(agent and the area's box on the lead's row, RN-912) — and the yardstick for who
turns it on is not the screen but `assertModelFitsBindingScope`: where the api
REFUSES, the filter is checked; where it does not refuse, the person chooses.
That is why the SESSION picker still has no filter — checking it there would
hide a model the api accepts. **This does not eliminate the 422**: the filter
covers one of the three causes, and the other two
([RN-043](#rn-043) — disabled in the workspace, gone from the provider) remain
reachable, with the unavailable one still LISTED and marked; the refusal
outcome of [RN-470](web.md#rn-470) remains what tells what happened. And it is
the INITIAL state of a checkbox, not a lock: unchecking lists everything again.

**The consequence: the current model that the filter hides is STATED.**
`workspace` and `project` never required tool calling, and the routes that
resolve the binding of an agent or an area call `ResolveModelBindingUseCase`
**without** `exigeToolCalling` — so a chat-only default at those levels is
resolved normally and becomes the row's current one. With the filter checked,
the trigger showed a name that the open list did not contain, with no option
checked. The picker now names the model and the cause; it CAN name the cause
because there is only one filter there. When the whole list is empty, what
speaks is still the empty-list text, which already says to uncheck — two
warnings about the same checkbox would be noise.

**A correction of fact, not of the text above:** "Only `agent` validates"
describes Phase 9a. Since [ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)
`area` enters the SAME validation — it is not a generic fallback, the only
consumer of an area's model is one of its agents ([RN-102](#rn-102)) — and
that is why there are TWO screens that turn the filter on.

- **Where:** `src/domain/llm/model-capabilities.ts:38`;
  `apps/web/src/components/ModelPicker.tsx` (the filter and the hidden-current
  warning), `apps/web/src/routes/settings/ModelsSection.tsx` (who turns it on,
  in the agent picker and in the picker of the lead that follows the area)
- **Test:** `test/domain/llm/model-capabilities.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`;
  `apps/web/src/routes/settings/filtro-de-aptos.test.tsx` and
  `apps/web/src/routes/SessionPage.filtro-de-aptos.test.tsx` (the two screens
  that turn it on, and the one that does not)
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

- **Where:** `src/infrastructure/llm/openai-compatible-provider.ts:167`
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

- **Where:** `src/application/use-cases/llm/record-llm-usage.use-case.ts:73`
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

- **Where:** `src/application/use-cases/llm/sync-model-catalog.use-case.ts:160`,
  `src/domain/llm/binding-resolver.ts:63`,
  `src/domain/llm/model-capabilities.ts:49`
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

- **Where:** `src/application/use-cases/llm/update-model-pricing.use-case.ts:44`,
  `src/application/use-cases/llm/sync-model-catalog.use-case.ts:213`,
  `src/db/seed.ts:376`
- **Test:** `test/application/use-cases/llm/update-model-pricing.use-case.spec.ts`,
  `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
- **Origin:** [ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)

### RN-045 — An adopted repository is only changed by an approved plan {#rn-045}

Adopting an existing repository **diagnoses without acting**. Adoption
validates access (`getRepo`), writes the project rows and produces a **plan**:
the serialized list of what the bootstrap would do, obtained by calling each
step's `check()` — the same one that has given idempotency since
[RN-029](#rn-029) — without ever running the corresponding mutation.

While `repo_bootstraps.plan_decision` is **null**, no mutation runs. The gate
sits **before** the executor, not inside it: the bootstrap runner is the same
as in Phase 2, unfiltered, and it is simply not called. Added to the guard that
already skipped protected branches, there is no code path that touches a branch
outside an approved plan.

The two outcomes:

- **approve** is all or nothing (approving loose steps would break the
  `dev←main, qa←dev` cascade). What runs is the plan **re-derived** at execution
  time: equal to or smaller than the one shown, **never larger** — a branch that
  became protected in the meantime is skipped;
- **adopt as is** waives the bootstrap, records the decision and does **not**
  move the cursor to fake convergence. The plan is kept as evidence of what was
  deliberately not applied.

Deciding on a regenerated plan is refused (409): the decision carries the
`planGeneratedAt` the user saw, and a "yes" given on something else does not
count.

Normal provisioning refuses (409) to run on an adopted repository — without
that guard, the resume path would run the bootstrap on a third party's
repository with no plan at all.

**Known limit:** "divergent protection" here is presence × absence, because
that is all the contract exposes (`GitBranch.protected` is a boolean, and
[ADR 0028](../adr/0028-protecao-de-branch-divergencia-entre-providers.md)
postponed a normalized `ProtectionPolicy`). A branch with PARTIAL protection
counts as "unprotected" and can be overwritten — but only inside an approved
plan.

- **Where:** `src/application/use-cases/git/decide-bootstrap-plan.use-case.ts`,
  `src/application/use-cases/git/bootstrap-plan.ts`,
  `src/application/use-cases/git/bootstrap-steps.ts:112`
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

- **Where:** `src/db/schema/git.ts`, `src/db/migrations/0031_special_winter_soldier.sql`,
  `src/domain/git/repo-bootstrap.entity.ts`
- **Test:** `test/application/use-cases/git/adopt-repository.use-case.spec.ts`
- **Origin:** [ADR 0044](../adr/0044-adocao-de-repositorio-existente.md)

### RN-048 — Story promotion is the user's by default; the mode changes who triggers it, never what gets validated {#rn-048}

`projects.story_promotion` chooses WHO promotes a story from `draft` to
`ready`:

- **`manual`**: the PO leaves the story complete
  and it stays `draft` with `stories.proposed_ready = true`. **None of
  its tasks are claimable** — `claimNext` requires `story.status =
  'ready'` — and it's the user who promotes it, individually or in
  batch, from the Backlog.
- **`auto`** (new project's default since [RN-659](#rn-659)):
  the PO promotes on its own upon finishing a complete story. This was
  the behavior that predated Phase 12c; `manual` was the default from
  12c until RN-659 (migration `0065`), which changed only the column
  default — projects created in between keep `manual`.

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
it — it's the reverse of the rearm order in [RN-047](engine.md#rn-047), and for a
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

- **Where:** `src/domain/backlog/story-promotion.ts`,
  `src/db/migrations/0033_absurd_domino.sql`,
  `src/application/use-cases/backlog/promote-stories.use-case.ts`,
  `src/application/use-cases/backlog/return-story.use-case.ts`,
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

- **Where:** `src/application/use-cases/actions/propose-action.use-case.ts`,
  `.../approve-action.use-case.ts`, `.../deny-action.use-case.ts`
- **Test:** `test/application/use-cases/actions/approve-deny-action.use-case.spec.ts`
  (describe `the decision in the event log`)
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

- **Where:** `src/application/use-cases/llm/sync-model-catalog.use-case.ts`
  (`resolverPreco`), `src/db/schema/llm.ts:137`
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

- **Where:** `src/db/schema/llm.ts` (`workspace_models`),
  `src/application/use-cases/llm/set-models-active.use-case.ts`,
  `src/application/use-cases/llm/set-model-binding.use-case.ts`
  (`workspaceDoEscopo`)
- **Test:** `test/application/use-cases/llm/set-models-active.use-case.spec.ts`
  (`activating in one workspace does NOT turn on the model in its neighbor`)
- **Origin:** [ADR 0049](../adr/0049-curadoria-de-modelo-por-workspace.md)

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
| `idle_tripped` | nothing — only the explicit rearm unlocks it ([RN-047](engine.md#rn-047)) |

Firing `:work` for everyone would be worse than the defect: it claims
unconditionally, and for an `awaiting_gate` agent it would mean dropping
the worktree the gate is sweeping — on top of bypassing the circuit
breaker with a click.

- **Where:** `src/application/use-cases/execution/activate-execution.use-case.ts`,
  `src/infrastructure/persistence/drizzle/session.repository.ts`
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

## PR Gates

### RN-054 — External handoff addresses the area's lead or an agent with no area — never a subagent {#rn-054}

Whoever talks to an area **from outside** talks to the lead. A handoff
addressed to a subagent (`qa-automacao`, `qa-performance-seguranca`,
`infra-workflows`) is refused with a typed error that **names the lead**
the caller should have addressed — refusing without saying the right path
would just trade a hierarchy breach for a stuck agent.

The refusal happens **before** the INSERT. Refusing afterward would leave
a ghost handoff in the table and a `handoff.offered` — an immutable
event — asserting an offer the policy doesn't allow.

Internal delegation (lead → subagent) does **not** go through here: it's
private to the area, has its own table (`delegations`) and its own path
(`RecordDelegationUseCase`). The rule is about the area's external
boundary, not about what happens inside it.

ADR 0038 called for this validation, naming the place —
`CreateHandoffUseCase` is the only one in the system that writes
`toAgent` — and it had never been implemented (finding #12 of the first
dogfooding). The engine's `offer_handoff` passed `to_agent` through as a
free string, so until now nothing stopped an agent from breaching the
hierarchy.

**Area, lead, and members have ONE source** since PHASE 18:
`src/domain/agents/agent-areas.ts`. The list used to be
hand-written in three places (api, web, engine) and the test only
compared api against web — the engine silently diverged. Now
`apps/web/src/lib/agent-areas.generated.ts` and
`apps/engine/lib/engine/agents/areas.ex` are produced by
`pnpm --filter api gerar:areas`, and the test fails what's stale on disk.
Since AT-046 the same generator also writes `SOLO_CONVERSATIONAL_AGENTS`
(RN-440) into the web file — and only there, since the engine has no reader
for it.
The list is still the CATALOG; `agent_areas` is the per-project STATE
(RN-094), and the two answer different questions.

- **Where:** `src/domain/agents/agent-areas.ts`
  (`assertHandoffTargetAllowed`, `HandoffToSubagentError`),
  `src/application/use-cases/agents/create-handoff.use-case.ts`
- **Test:** `test/domain/agents/agent-areas.spec.ts` (the rule + the check
  that the derived copies don't diverge from the source),
  `test/application/use-cases/agents/create-handoff.use-case.spec.ts`
  (refusal with no row and no event)
- **Origin:** [ADR 0038](../adr/0038-hierarquia-de-agentes.md), closed from
  finding #12 of the [first dogfooding](../explanation/primeiro-dogfooding.md)

---

## Credentials {#credenciais}

An LLM key and the user's git token live in the same table
(`user_credentials`), under the same envelope encryption. This section applies
to both.

### RN-055 — A credential is always encrypted and saved; verifying is a separate action, with three answers {#rn-055}

Registration **doesn't judge the credential**: it encrypts and saves, even if the provider
would refuse it. Verifying is an explicit action on the **already saved**
credential — the api decrypts, calls the provider, and returns only the verdict. The plain
text never comes back in any response, not in pieces, not in the refusal reason.

It used to be the opposite: registration tested before persisting and refused to save
([ADR 0004](../adr/0004-git-credential-registration.md), extended to LLM
keys in Phase 11a). The real failure mode was the opposite of what was predicted — since the field
is write-only and the screen never redisplays what was typed, a refusal left the
user **with no credential and without the text to fix it**.

The verdict has **three** values, and the third is mandatory:

| | when |
|---|---|
| `ok` | the provider accepted |
| `recusado` | the provider rejected — carries **its** reason |
| `nao_suportado` | there's no verified test endpoint (`ollama`, `anthropic`, `openai`) |

Without `nao_suportado`, a provider whose tester is a NO-OP would come back `ok` and the screen
would assert a verification that never happened. It's the capability rule of
[ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)
applied here: only what was proven is declared. That's why the port declares
`supports()` — the silence of `test()` alone is ambiguous.

A bad key **is not an HTTP exception**: the use case catches
`LLMCredentialConnectionTestFailedError`/`GitCredentialConnectionTestFailedError`
and returns a result, with 200. The only exception is when there's no credential for
(user, provider) — 404, because then there's nothing to test.

- **Where:**
  `src/application/use-cases/credentials/test-stored-credential.use-case.ts`,
  `src/application/use-cases/llm/upsert-user-credential.use-case.ts`,
  `src/application/use-cases/git/register-git-credential.use-case.ts`,
  `src/application/ports/llm-credential-connection-tester.port.ts`
  (`supports`)
- **Test:**
  `test/application/use-cases/credentials/test-stored-credential.use-case.spec.ts`
  (the three results, the git×LLM dispatch, the 404, and the absence of the secret in the
  response); `test/application/use-cases/llm/upsert-user-credential.use-case.spec.ts`
  and `test/application/use-cases/git/register-git-credential.use-case.spec.ts`
  (the unconditional save, which is the inversion)
- **Origin:** [ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md)

---

### RN-056 — A capability facet comes from the provider; silence preserves what was there {#rn-056}

`supports_vision`, `supports_reasoning` and `generates_image` are a **fact of the
provider**, not an opinion: they come from the remote catalog on sync, with the
same fallback as `supports_tool_calling` — remote, then local, then `false`.

On OpenRouter (the only one that publishes this today) the three come from:
`architecture.input_modalities` contains `image`,
`supported_parameters` contains `reasoning`, and
`architecture.output_modalities` contains `image`. Accepting an image and
**producing** an image are distinct axes: merging them would send the user to the
wrong model.

Before, the sync read `supportsVision` from what was already STORED and never
consulted the remote — the column was born `false` and there was no path to
become true. The 338 models of the first real sync all stayed `false`, including
181 that the provider declares as multimodal.

**Absence of a declaration is not a declaration of absence**
([ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)): the
parser OMITS the field when the provider is silent, and `undefined` preserves the
local value. That is why the screen uses the facets only as a POSITIVE filter and
never writes "does not read images" — `false` here means "the provider did not
declare".

- **Where:** `src/infrastructure/llm/openrouter-provider.ts`
  (`temModalidade`, `parseCatalogoOpenRouter`),
  `src/application/use-cases/llm/sync-model-catalog.use-case.ts`,
  `src/db/schema/llm.ts` (`models`)
- **Test:**
  `test/infrastructure/llm/openrouter-provider.contract.spec.ts`
  (`modalidade não declarada OMITE o campo em vez de afirmar false`);
  `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
  (`catálogo que se cala sobre modalidade preserva a faceta gravada`)
- **Origin:** [ADR 0051](../adr/0051-facetas-de-capability-e-curadoria-por-uso.md)

### RN-057 — "What it is for" is the workspace's curation, and marking a use does not turn the model on {#rn-057}

No provider catalog publishes "good for code". That is the **opinion of whoever
operates**, discovered by using — so it lives in `workspace_models.uses`, next to
the workspace's other decision ([RN-052](#rn-052)), and not in `models`.

A CLOSED vocabulary — `codigo`, `documentacao`, `analise`, `imagem`,
`conversa` —, with an exhaustiveness proof at compile time on both sides.
Free text would give `code`, `coding` and `código` in the same filter within a
week.

Two rules that keep the axes separate:

1. **Marking a use does not turn the model on.** `workspace_models.is_active` has
   DEFAULT `true`, so the row created by a use mark is inserted with an explicit
   `is_active = false`. Without that, having an opinion about a model would
   authorize it to spend, against [RN-043](#rn-043).
2. **Changing the use does not turn off what was on.** `is_active` stays out of
   the `ON CONFLICT` `SET`.

The list of uses **replaces** the previous one, it does not add: an empty list is
how everything is unchecked, and it is a legitimate state — "nobody gave an
opinion" is not "it does not fit".

- **Where:** `src/domain/llm/model-uses.ts`,
  `src/db/schema/llm.ts` (`workspace_models.uses`),
  `src/infrastructure/persistence/drizzle/workspace-model.repository.ts`
  (`setUses`),
  `src/application/use-cases/llm/set-model-uses.use-case.ts`
- **Test:** `test/application/use-cases/llm/set-model-uses.use-case.spec.ts`
  (`marcar uso NÃO liga o modelo — a linha nova nasce inativa`,
  `trocar o uso não desliga o que já estava ligado`,
  `o uso vale só neste workspace`)
- **Origin:** [ADR 0051](../adr/0051-facetas-de-capability-e-curadoria-por-uso.md)

### RN-058 — The key the AGENT spends is the workspace owner's {#rn-058}

An LLM credential belongs to a person (`user_credentials.user_id`), and an agent
is not a person. The agent's turn resolves the key through the **workspace owner**
(`workspaces.created_by`), not through whoever opened the session nor whoever
created the project: whoever pays the bill pays for the agents, and that does not
change when another team member starts the session.

`created_by` and not `workspace_members.role = 'owner'`: there can be several
owners, and "any of them" would make the key used vary with nobody deciding.

Before this, the turn passed the **agent's slug** (`agentId ?? sessionId`) in the
user column. The query went to the database with `user_id = 'criativo'`, Postgres
refused the invalid UUID, and the error became an **empty reply** in the thread —
with no metric, no failure event, nothing on screen. The practical effect, which
only a real run revealed: **no agent ever used a provider with a credential**.
Only `ollama` worked, because for it the lookup is skipped — and it was with a
local model that Phase 4, Phase 10's dogfooding and all the demos ran.

The human chat never had the defect: it uses `actor.id`, which is the real user.

- **Where:**
  `src/application/use-cases/llm/resolve-credential-owner.use-case.ts`,
  `src/application/use-cases/llm/stream-llm-turn.use-case.ts`,
  `src/application/use-cases/llm/run-llm-turn.use-case.ts`
- **Test:** `test/application/use-cases/llm/resolve-credential-owner.use-case.spec.ts`
  (the owner wins over whoever created the project; the key found is theirs; a
  nonexistent project is 404 and not a database error)
- **Origin:** real run of PHASE 13b

### RN-060 — The keys' spend is the owner's, and only they see it {#rn-060}

The consumption report by credential (`GET /workspaces/:id/credential-spend`)
requires **`owner`** on the workspace. Not `maintainer`: since
[RN-058](#rn-058) the agents of all projects spend the owner's credential, and
their bill is not the business of someone who only operates a project.

The report groups by **provider**, because that is the credential's unit — one
key per provider, per person. A single total would not match any bill.

And it separates **agent** from **person**: both come out of the same key since
RN-058, and "are my agents expensive?" is a different question from "do I use the
chat a lot?". That is why this is the only cost aggregate in the product **without**
the `actor_kind = 'agent'` filter of [RN-038](#rn-038) — here the question is how
much left the key, and the owner's own chat comes out of it.

Spend on an **already-removed** credential stays in the report, marked: the
consumption happened, and hiding it would give a total that does not close with
the provider's statement.

No secret crosses: the response has provider, tokens and cost — never the key, not
even encrypted ([ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md)).

- **Where:**
  `src/application/use-cases/llm/get-credential-spend.use-case.ts`,
  `src/interfaces/http/llm/budgets.controller.ts`,
  `apps/web/src/components/CredentialSpendSection.tsx`
- **Test:** `test/application/use-cases/llm/get-credential-spend.use-case.spec.ts`
  (groups by provider; separates agent from person; a removed key stays marked);
  `apps/web/src/components/CredentialSpendSection.test.tsx`
- **Origin:** the user's decision together with RN-058

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

The refusal goes back to the model via the tool-result ([RN-061](engine.md#rn-061)):
it reads that one already exists and moves on to
`assign_story_modules`, which is step 2 of its kickoff. That's why the
turn does **not** end when the map is emitted — the Architect still has
three steps ahead (linking stories, proposing an ADR, recording
tensions), and ending there would kill all three.

- **Where:** `src/application/use-cases/architecture/create-module-map.use-case.ts`
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

- **Where:** `src/application/use-cases/architecture/assign-story-modules.use-case.ts`,
  `src/application/use-cases/architecture/create-module-map.use-case.ts`,
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
  the session ([RN-064](web.md#rn-064)), it stays `active` **forever**.

Three paths did this: `provision-repository` (two calls),
`adopt-repository`, and `activate-execution` — the last of which creates
the session where the **dev agents** run.

The proof by contrast, from a real execution: the wizard's session had
no `session.created`, had an empty `engine.session_states`, and
`REFUSED JOIN`; the session opened via the normal route had the event,
the state row, and `JOINED`.

The test is about the SOURCE on purpose: a behavior test would prove one
path at a time, and the defect here is the path no one thought of.

- **Where:** `src/application/use-cases/sessions/create-session.use-case.ts`
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

- **Where:** `src/domain/actions/dev-terminal-patterns.ts`,
  seeded by `application/use-cases/execution/activate-execution.use-case.ts`
- **Test:** `test/domain/actions/dev-terminal-patterns.spec.ts`
  (`allows ls -la`; `a composite command doesn't hitch a ride on the
  allowed segment`)
- **Origin:** PHASE 13b real execution

### RN-070 — Every declared gate points to the evidence that proves it {#rn-070}

No entry in `config/gates.yml` exists without `evidencia`, and the registry
cannot claim more than it verifies: a `block` gate requires `verificacao:
script`, and a `planned` gate carries no evidence of something that has not
happened yet.

Evidence is a **locator**, not prose: `event_log` carries the event types and
the payload filter that tells them apart from their neighbors; `teste` and `ci`
carry the path, and a target that disappeared FAILS. It is the same failure mode
the docmap calls a dead glob — a rule that never fires and pretends to cover.

**That last statement is about the REPOSITORY, and is never evaluated at
runtime.** The registry is validated in two layers: `validarRegistro` (the
content — `block` needs `script`, the four human gates remain human, `active`
needs evidence, no duplicate id, no orphan `entrada`) holds wherever the file
is read and is what the api loader calls; `validarLocalizadores` (the target
file is on disk) only makes sense inside a checkout, and is enforced by the
real file's test and by phase 2 of `validacao-gates.ts`.

The two used to be a single function, and that cost a production defect,
measured on the installed v6.1.0: `GET /gates` returned `500` with
`RegistroDeGatesInvalido` listing the eleven targets as missing — twelve 5xx in
about 55 minutes, on every installation. The production image carries
`/app/config/gates.yml` and nothing else; `test/`, `scripts/ci/`
and `.github/` never enter it. The rule was not loosened — it was moved to
where the question exists. Do not put it back in the loader: `arquivoExiste` in
a process that has no repository answers about another tree.

The screen hid this: [RN-084](#rn-084) makes the `PrGateTimeline` fall back to
the full pipeline when the route fails, so the 500 only showed up in the api
logs.

Three types because not every gate lives in the event log:
[`merge-protegida`](#rn-014) is a ceiling in a pure rule
that emits no event of its own (what guarantees it is a test) and `backmerge` is
CI with state in `.release/gate.json`. Downgrading them to `warn` for that
reason would lie about the hardest locks in the product.

The filter matters as much as the type: `qa-verificada` and `secops-segura`
write the SAME `pr.gate_changed`, and the same type fires on the OPENING of the
gate, with no `veredito` — without the filter, opening would count as passing.
The same goes for the two infra PR gates. That is why no pair (`event_types` +
`filtro`) can repeat.

The filter only reaches the PAYLOAD, on purpose: accepting an arbitrary column
would open up the whole query. Who promoted a story (human or the PO) lives in
the `actor_kind` column and stays outside the declarative vocabulary.

- **Where:** `src/domain/gates/gate-registry.ts`
  (`validarRegistro` and `validarLocalizadores`), registered in
  `config/gates.yml`, measured in `scripts/validacao-gates.ts`;
  the loader that deliberately calls only the first is
  `src/infrastructure/gates/gate-registry.loader.ts`
- **Test:** `test/domain/gates/gate-registry.spec.ts`
  (`é válido: nenhum problema acumulado`; `todo alvo de prova citado
  existe no repositório`; `validarRegistro ignora o disco: alvo ausente
  não é problema DELE`; `nenhum par (event_types + filtro) se repete
  entre gates`) and
  `test/infrastructure/gates/gate-registry.loader.spec.ts`
  (`carrega o registro real sem exigir os alvos que a imagem não leva`,
  against a root rebuilt like the production image tree)
- **Origin:** PHASE 15a (ADR 0054); the split into two layers came from the 500
  on `GET /gates` measured on the installed v6.1.0 (AT-086)

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

- **Where:** `src/domain/gates/gate-registry.ts`
  (`GATES_HUMANOS_IMUTAVEIS`); the ceiling in
  `src/domain/actions/decide.ts`
- **Test:** `test/domain/gates/gate-registry.spec.ts`
  (`%s cannot have aprovacao_humana false`); the ceiling in
  `test/domain/actions/decide.spec.ts`
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

- **Where:** `src/domain/llm/binding-resolver.ts`
  (`herdarModeloDeStart`), applied in
  `application/use-cases/llm/resolve-model-binding.use-case.ts`
- **Test:** `test/domain/llm/binding-resolver.spec.ts`
  (`fills the gap`; `does NOT override %s's explicit choice`)
- **Origin:** findings B and O of the real execution (PHASE 13c, phase A)

### RN-075 — A terminal command is evaluated by where it touches, not only by the verb {#rn-075}

The project folder (`<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>` — the bare
UUID in a project from before [RN-109](#rn-109), `<slug>-<8 chars of the
id>` in a new project) is the **scope**.
A `terminal` command that touches any path outside it is **never** auto-approved,
however much the verb is in `allow`. Inside it, `cd` stops requiring permission —
it is the scope declaration, not a verb.

Four properties the tests fix:

- **Tightens:** a released `Terminal(cat)` stops auto-executing
  `cat /workspace/apps/engine/.../git_executor.ex`. That was finding U: the match
  is by VERB, so the agent read the code of the platform that was running it, and
  reached other projects' worktrees.
- **Loosens:** `cd <inside> && cat README.md` becomes `auto_approve`. That was the
  costliest defect of the ladder — the dev agent always emits `cd <path> &&
  <verb>`, `cd` was in no `allow`, and a compound command requires ALL segments to
  match.
- **Permits without exempting:** inside the scope, a verb outside `allow` still
  asks. Being in the project folder does not make `curl … | sh` safe.
- **Outside the scope is `require_approval`, never `deny`:** the agent may have a
  legitimate reason to look outside, and the decision remains the user's.

`deny` still wins first, and the two ceilings ([RN-006](#rn-006),
[RN-007](#rn-007)) remain untouched. Without a root given to `decide()`, the
verdict is the one from before this rule — no caller has its behavior changed by
omission.

The normalization is **lexical**, not `realpath`: `<root>/../..` is resolved and
failed, but a symbolic link from inside pointing outside is not detected.
`decide()` is pure by contract and resolving a symlink would require I/O in the
domain. Scope is policy; isolation is another problem, declared open in the ADR.

**No regex over the input, on purpose.** Stripping the root's trailing slashes
was `.replace(/\/+$/, '')`, and CodeQL flagged polynomial ReDoS
(`js/polynomial-redos`, HIGH): the pattern forces the engine to try every
starting position and scan to the end, degrading to O(n²). Now it is an O(n) scan,
equivalent even in the degenerate case — the root `/` becomes an empty string in
both, and that is what makes `startsWith('/')` hold for every absolute path.
Whoever "simplifies" it back to a regex reopens the alert.

- **Where:** `src/domain/actions/path-scope.ts`,
  `domain/actions/decide.ts` (scope ceiling and the `cd` in scope),
  root derived in
  `infrastructure/filesystem/project-workspaces-root.ts`
- **Test:** `test/domain/actions/path-scope.spec.ts` and
  `test/domain/actions/decide.spec.ts`
  (describe `decide — escopo de caminho`)
- **Origin:** [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md),
  finding U, Phase F of the [backlog](../explanation/backlog.md)

The scope only holds as long as it itself is inside the root — what guarantees
that is [RN-092](#rn-092).

### RN-078 — A failure to protect branches can be acknowledged, and only that one {#rn-078}

`protect_branches` fails on a private repository on GitHub's free plan — and the
wizard **warns of this before starting**. The user can acknowledge the failure and
go on; the bootstrap closes and the project becomes reachable.

**What this unlocks is bigger than it seems.** The only button offered after the
failure was "Try again", which always fails for the same reason. And
`provision_failed` makes the dashboard **redirect the project's click back to the
provisioning page** — the project was unreachable forever, stuck on a step that
has no way to succeed.

**Only the protection can be acknowledged.** It is the LAST step and the only one
whose failure leaves a usable repository: the repo exists, the files were
committed, the branches were created. Failing to create the repository or to
commit is something else — there "going on" would produce a project with nowhere
to work, and the button would be a second lie on top of the first. The refusal
says so, instead of just denying.

**The product's guarantee does not change.** The merge ceiling ([RN-006](#rn-006))
is enforced in `decide.ts`, not by the provider's protection. Going on without it
removes the second layer, GitHub's — not Brabo's. That is what makes this way out
honest instead of a shortcut.

The decision goes to the event log with the **user** as actor and the original
error in the payload: going on without protection is their choice, and whoever
reads later needs to know exactly what was waived.

- **Where:** `src/application/use-cases/git/acknowledge-protection-failure.use-case.ts`,
  route in `interfaces/http/git/git.controller.ts`, button in
  `apps/web/src/routes/ProvisioningPage.tsx`
- **Test:** `test/application/use-cases/git/acknowledge-protection-failure.use-case.spec.ts`
  (unlocks; the decision in the log with the actor; and the refusal for an earlier
  failure)
- **Origin:** finding D, Phase D of the [backlog](../explanation/backlog.md)

### RN-081 — A repeated story: an equal title refuses, an equal justification warns {#rn-081}

Two different answers for two different problems:

- an **identical title** in the project is an error, not a choice: the story is
  **refused** and nothing is created;
- the **same justification** — all the business rules the story cites were already
  covered by another — is a suspicion, not an error. The story **is created** and a
  `backlog.story_overlap_warned` goes out. A second cut of the same rule may be
  legitimate, so the user is the judge; the product only refuses to let it pass
  unnoticed.

**Contained, not intersecting.** Two stories sharing a rule is normal, and warning
about it would become noise nobody reads. The signal only exists when the new one
adds no coverage at all. A story that cites no rule generates no warning: treating
the empty set as a subset of everything would accuse all of them.

**The limit is the same as [RN-080](engine.md#rn-080), and the finding's pair crosses
it:** "Public endpoint for a deterministic greeting" and "Public GET /hello endpoint
that answers an immediate greeting" cover the same endpoint with different titles and
justifications — nothing mechanical links them, and they still pass. There is a test
asserting this, so the limit is visible instead of implicit.
Since [RN-681](#rn-681) the pair is WARNED about by embedding — it still passes,
and the test that asserts THIS mechanism's limit still holds.

- **Where:** `src/domain/backlog/story-overlap.ts`,
  `src/application/use-cases/backlog/create-story.use-case.ts`
- **Test:** `test/domain/backlog/story-overlap.spec.ts`,
  `test/application/use-cases/backlog/create-story.use-case.spec.ts`
- **Origin:** finding R, Phase E of the [backlog](../explanation/backlog.md)

### RN-082 — An action's git credential is the workspace OWNER's {#rn-082}

When the api executes a git action against a remote provider (`pr_open`,
`git_merge`), the token comes from the **workspace owner** — the same resolver as
[RN-058](#rn-058), not from whoever decided the action.

**Resolving by who decided only worked with a human click.** An action
auto-approved by policy has no decider: `decided_by` stays `NULL`, the token stays
`undefined`, and GitHub answers `Requires authentication`. In practice, with
autonomy on — which is the mode ADR 0055 exists to make viable — **no dev agent
could open a PR on a remote provider**.

**The contrast that exposed the defect** happened within a single run: in the same
run, `git_push` passed and `pr_open` failed. The push is executed by the ENGINE,
which already injected the owner's credential ([RN-076](engine.md#rn-076)); the PR
is opened by the API, which was out of symmetry.

It did not show up before because every earlier validation used the
`LocalGitProvider`, where the token is not even consulted.

The principle is the same as RN-058, and it is worth repeating because it is what
keeps the two rules from diverging over time: **whoever pays the bill pays for the
agents**, and that does not change depending on who clicks. That is why the
resolver is REUSED instead of reimplemented.

- **Where:** `src/application/use-cases/actions/execute-git-action.use-case.ts`,
  reusing `application/use-cases/llm/resolve-credential-owner.use-case.ts`
- **Test:** `test/application/use-cases/actions/execute-git-action.use-case.spec.ts`
  (an auto-approved `pr_open`, with `decidedBy: null`, asks for the owner's credential)
- **Origin:** finding AA, [real validation of 13b](../explanation/validacao-real.md)

### RN-083 — The lead decides the parallelism; above the ceiling, you authorize {#rn-083}

How many agents come up stops being a number in the code: the **area lead**
evaluates it. But its decision is not sovereign over SPENDING — up to
`agent_areas.max_parallel` (born with **5** in `dev`, [RN-910](#rn-910)) it brings
them up and goes on; **above that it becomes a `proposed_action` of type
`parallelize`**, through the same pipeline as every action with an external effect.

**The ceiling belongs to the SESSION, not the module.** It is the only part of the
rule that is not obvious, and the one an inattentive refactor undoes: counting per
module would allow N modules × 2 agents without any authorization — the earlier
hole under another name. There is a test asserting exactly that.

**A zero or negative ceiling is an invalid configuration, not "no limit".**
Treating it as unlimited would turn a typo into unrestricted spending, which is the
opposite of what the pipeline exists to do.

**Who ASKS is the lead; who DECIDES is you.** The `proposed_action` is born with the
lead as actor, and the decision stays in the event log with your name — it is that
distinction that makes the story reconstructable later ([ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md)).

The reason travels in the IMMUTABLE payload, with the three numbers (how many there
are, how many it asks for, what the ceiling is): whoever reads it six months from
now needs to understand what was authorized without reconstructing the session's
state.

`AcceptParallelizationUseCase` does not change: it is still the one that EXECUTES,
both on the direct path and when the action is approved. Absorbing it from the
inside, instead of rewriting it, is what keeps the Phase 4 suite green without
modification — which is the proof that the swap did not leak into the external
contract.

**The ceiling is configurable per area, and only by you.** `PATCH
/projects/:projectId/agent-areas/:key/max-parallel` requires `maintainer` — the
same role as activating execution, and for the same reason: changing the ceiling
is deciding how much the product can spend without asking. There is no automatic
path to raise it. Anamnesis may PROPOSE, when it notices that the authorization
became routine, and the proposal still goes through this route after you accept —
a product that raises its own spending ceiling is exactly what the approval
pipeline exists to prevent.

Changing the ceiling applies to the NEXT requests. What is already awaiting a
decision keeps waiting: the action carries in its payload the ceiling that held
when it was created, and reinterpreting it under the new ceiling would change what
you are about to decide after reading.

- **Where:** `src/domain/execution/paralelismo.ts` (the pure rule),
  `application/use-cases/execution/request-parallelization.use-case.ts`,
  `application/use-cases/execution/set-area-max-parallel.use-case.ts`,
  exposed in `interfaces/http/execution/execution.controller.ts` and configured
  in `apps/web/src/routes/settings/ParallelismSection.tsx`
- **Test:** `test/domain/execution/paralelismo.spec.ts`,
  `test/application/use-cases/execution/request-parallelization.use-case.spec.ts`,
  `test/application/use-cases/execution/set-area-max-parallel.use-case.spec.ts`
  and `apps/web/src/routes/ProjectSettingsTab.test.tsx` (`ParallelismSection`)
- **Gate:** `config/gates.yml` (`paralelismo-autorizado`) — `status: active`
  since the fluxo.yml × code audit (finding A1/B5); the mechanism itself did not
  change, only the registry entry that stayed `planned` by mistake since PHASE 14d, see
  [gates.md](../explanation/gates.md#a-registry-can-age-in-the-wrong-direction--stale-not-inactive)
- **Origin:** [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md), PHASE 14d

### RN-084 — The displayed pipeline derives from the gate registry {#rn-084}

The team panel shows the stage a PR is at **deriving it from
`config/gates.yml`**, not from a list written on the screen. A gate that leaves
the registry disappears from the pipeline; a `planned` gate never appears.

**The rule exists because of a specific form of aging.** Before PHASE 15b the
screen had the stages fixed in the component, and the registry (PHASE 15a)
described the gates elsewhere. Nothing linked the two: adding a gate to the YAML
did not change the screen, and removing one left the screen showing a stage that
no longer existed — without any test failing, because the two sources were each
right on their own. It is the same rot that `docs/.docmap.yml` exists to prevent,
and the answer is the same: a single source, with the consumption enforced.

Three edge decisions, all so the screen **degrades** instead of vanishing:

- a PR gate that the screen does not yet know how to draw is **ignored**, it does
  not break the render — the registry may gain a gate before the screen gains the
  label;
- the **labels belong to the screen**, not the registry: the YAML describes
  engineering, and the screen talks to whoever is waiting for a PR;
- **without a registry** (the route failed), it shows the full pipeline instead of
  an empty one — a generic pipeline informs more than nothing.

- **Where:** `apps/web/src/components/PrGateTimeline.tsx` (`etapasDaEsteira`),
  reading `GET /gates` (`src/interfaces/http/gates/gates.controller.ts`)
- **Test:** `apps/web/src/components/PrGateTimeline.test.ts`
  (`gate que SAI do registro some da tela`, `gate de PR que a tela ainda não
  sabe desenhar é IGNORADO`, `sem registro, mostra a esteira completa`)
- **Origin:** [ADR 0054](../adr/0054-gates-como-registro-declarativo.md), PHASE 15b

### RN-086 — Spending on more agents is never self-approved {#rn-086}

The two actions that touch **how much the product may spend on its own** —
`parallelize` (exceeding the ceiling now) and `raise_max_parallel` (changing the
ceiling) — are never auto-approvable. Not by `agent_autonomy`, not by
`permissions.json`. It is the same class of guarantee as the merge lock and the
instruction patch ceiling.

**Without this, the ceiling of [RN-083](#rn-083) would be decorative.** A
`permissions.json` with `Parallelize()` in `allow` would make every overrun
approve itself — the rule that exists to REQUIRE the user's decision would come to
waive it. And `raise_max_parallel` is the gravest case: it would be the product
raising its own spending limit, exactly what the approval pipeline exists to
prevent.

**Anamnesis may PROPOSE, and that is what it does.** When authorizing one more
agent becomes routine, the ceiling is wrong, and the first to notice is whoever
reads the history. The signal already reached it: the user's decisions in the
window come from `proposed_actions`, with `actionType` and `status`.

The threshold is **three approvals and no denial**, and both halves matter:

- **two are not routine — they are two.** Three is what separates "it happened"
  from "it is always happening";
- **one denial brings down the whole signal**, however many approvals there are. If
  the user refused even once, the ceiling is doing their job, and proposing to
  raise it would be reading the signal backwards.

Proposing a ceiling **equal to or lower than** the current one is refused by the
api: Anamnesis runs periodically and would re-propose the same thing every round,
filling with noise a queue the user needs to read.

Approving applies the value from the **payload**, not one recalculated on the
spot — it is the number you read when deciding.

- **Where:** `src/domain/actions/decide.ts` (the ceiling),
  `application/use-cases/execution/propose-max-parallel.use-case.ts`,
  `execute-max-parallel-raise.use-case.ts`,
  `apps/engine/lib/engine/anamnese/tools/propose_max_parallel.ex` and the threshold in
  `apps/engine/lib/engine/workers/anamnese_worker.ex` (`nota_de_paralelismo/1`)
- **Test:** `test/domain/actions/decide.spec.ts`
  (`decide — teto do paralelismo`),
  `test/application/use-cases/execution/propose-max-parallel.use-case.spec.ts`,
  `execute-max-parallel-raise.use-case.spec.ts`,
  `apps/engine/test/engine/anamnese/tools_test.exs` and
  `test/engine/workers/anamnese_worker_test.exs` (`duas aprovacoes NAO sao
  rotina`, `uma NEGACAO derruba o sinal`)
- **Origin:** [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md), PHASE 14d

## Painel de projetos

### RN-090 — The dashboard reads the workspace, not one project at a time {#rn-090}

The card grid and the sidebar dots are fed by **one** request
per cycle — `GET /workspaces/:workspaceId/projects-summary` —, and the number of
requests **doesn't grow with the number of projects**.

The card shows git provider, provisioning status, budget, agent
chips, and last activity; the sidebar shows the status dot and the unread
counter. All of that came from seven POLLED queries per project, which made
23 projects cost 3,824 requests per minute against a limit of 300
(`RateLimitGuard`) — the screen knocked itself down with 429 before finishing
loading. [RN-088](web.md#rn-088) made the app stop insisting when that happens;
this one reduces the request.

Two boundaries the rule fixes, which are not implementation detail:

- **The api answers facts, not a roster.** `roster` brings what happened in the event
  log (execution activated, modules, gate already opened, delegated subagents, infra
  accepted). Who is area lead, which icon each agent has, and how members
  become a chip remain the web's — and the PRESENCE rule is a single one
  (`rosterFromFacts`), shared with the team panel, so that a new agent
  doesn't appear in one place and go missing in the other.
- **The bell drawer only fetches when open.** It was, until
  [RN-091](#rn-091), the only read that was still one request per
  project — the "where I stopped reading" cutoff is a `seq` kept in the browser
  (`read-state`), which the server doesn't know. Today the browser **sends** that
  cutoff, and the drawer is also a single request.

Accepted and desired side effect: `gatesEverOpened` and `delegatedSubagents`
now cover the ENTIRE session. The client derived from the last 200 events and
lost chips in long sessions (see
[ADR 0021](../adr/0021-fechamento-4a-infra-e-painel.md)) — the text of
`deriveAgentRoster` always said "has opened at some point".

- **Where:**
  `src/application/ports/projects-summary-repository.port.ts`,
  `src/infrastructure/persistence/drizzle/projects-summary.repository.ts`,
  `src/interfaces/http/iam/workspaces.controller.ts`
  (`getProjectsSummary`), `apps/web/src/lib/hooks.ts` (`useProjectsSummary`),
  `apps/web/src/lib/agent-status.ts` (`rosterFromFacts`),
  `apps/web/src/routes/Dashboard.tsx`, `apps/web/src/routes/Shell.tsx`
- **Test:** `apps/web/src/routes/Dashboard.fanout.test.tsx` (30 projects
  cost the same as 3; no per-project endpoint is called);
  `test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (the number of database queries doesn't grow with N);
  `apps/web/src/lib/agent-status.test.ts` (the api's facts produce the same
  chips as the event log)
- **Origin:** dashboard of 23 projects measured in the browser — 3,824 req/min
  before, 12 after

### RN-091 — The browser sends where it stopped reading; the bell is one request {#rn-091}

With the notifications drawer **open**, its content comes from **one** request
per cycle — `POST /workspaces/:workspaceId/unread-events` — and the number of
requests **does not grow with the number of projects**.

It is the missing half of [RN-090](#rn-090). That one brought the dashboard down
from 3,824 to 12 req/min, but the bell kept fetching one project at a time:
23 projects with the drawer open measured **286 req/min** against the limit of
300 (`RateLimitGuard`). It passed, and would vanish with one more project.

**The obstacle, and why the way out is this one.** There is no "mark as read"
on the server, on purpose: the cutoff is a `seq` per project kept in each
browser's `localStorage` (`read-state`). There were two ways out, and the
difference between them is a PRODUCT one:

- stop re-polling while the drawer is open changes how fresh what the user sees
  is — **refused**, nobody asked for that trade;
- the browser **sending** the `project → afterSeq` map returns exactly the same
  data at the same cadence. **It is pure batching: nothing changes for whoever
  looks at the screen**, neither freshness nor content.

**It is a `POST` that mutates nothing**, and the api answers `200` (never `201`)
to say so. The verb was chosen because it is the only one with a BODY: there are
dozens of pairs, and in a query string that becomes a long URL — which a proxy
truncates — besides putting the user's project ids in the access log, against
the rule of not passing personal data through the query string.

Three semantic guarantees the route fixes, because batching reads with
different cutoffs is where the easy mistake lives:

- **an empty map returns empty**, without touching the database. "I asked
  nothing" is not "give me everything";
- **each project respects ITS cutoff** — `seq` strictly greater than its own;
- **the ceiling of 50 events is per project**, the same one `GET .../events`
  applies without `limit`. A limit on the whole response would let the noisy
  project eat the quota of the quiet ones.

A cursor pointing to a project of another workspace is **ignored**, not
refused: it comes from the caller's local storage and may be a leftover from an
old workspace.

- **Where:**
  `src/application/ports/projects-summary-repository.port.ts`
  (`unreadEventsForWorkspace`),
  `src/infrastructure/persistence/drizzle/projects-summary.repository.ts`,
  `src/interfaces/http/iam/workspaces.controller.ts`
  (`getUnreadEvents`), `src/interfaces/http/iam/dto/unread-events.dto.ts`,
  `apps/web/src/lib/notifications.ts` (`useNotificationGroups`),
  `apps/web/src/lib/api-client.ts` (`getUnreadEvents`)
- **Test:** `apps/web/src/routes/Dashboard.fanout.test.tsx` (with the drawer
  OPEN: one request, and 30 projects cost the same as 3);
  `test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (the number of database queries does not grow with N; empty map, per-project
  cutoff, per-project ceiling and workspace isolation)
- **Origin:** measured residual of [RN-090](#rn-090) — 286 req/min with the
  drawer open in a workspace of 23 projects

### RN-092 — The `projectId` is a path segment, and the scope never leaves the root {#rn-092}

`projectScopeRoot()` **refuses** a `projectId` that is not a simple path segment
(`^[A-Za-z0-9_-]{1,64}$`), throwing instead of building the path.

The reason is that the id arrives from `@Param('projectId')` with no validation
pipe, and Express **decodes the segment's percent-encoding before handing it
over**: a `..%2F..%2Fetc` arrives as `../../etc`, and the `join` would resolve
outside the root without complaining. The function's two consumers suffer, and the
second is the serious one:

- `permissions.json` would be read **and written** at an arbitrary path;
- the scope of [RN-075](#rn-075) authorizes a `terminal` command under that
  folder. A scope that escapes the root is the approval policy pointing at the
  wrong place — a SECURITY failure, not a file-not-found.

The check is deliberately **wider than UUID** (it accepts letter, digit, hyphen and
underscore) so as not to tie down the id's format, and narrow enough that the result
never escapes. And it stays **where the root is derived**, not in each caller, for
the same reason that made the function exist: the two derivations must agree, and a
duplicated check is a check that one day diverges.

The happy path does not change — every real id is a UUID coming from the database.

- **Where:** `src/infrastructure/filesystem/project-workspaces-root.ts`
  (`projectScopeRoot`)
- **Test:** `test/infrastructure/filesystem/project-workspaces-root.spec.ts`
- **Origin:** [ADR 0058](../adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md),
  CodeQL `js/path-injection` alerts

### RN-093 — In production, the api does not boot with the example OAuth `state` key {#rn-093}

`resolveOauthStateSecret()` **brings the boot down** when `NODE_ENV === 'production'`
and `GIT_OAUTH_STATE_SECRET` is absent, equals the repository's example literal, or
has fewer than 16 characters. Outside production the development default still
holds.

That key signs the git OAuth `state`, and the `state` is the only thing that keeps
the callback `GET /git/oauth/:provider/callback` — a public route, by necessity —
from being forged. With the key known, anyone signs a `state` for
`{projectId, userId, provider}` of their choice and makes the callback record, in the
project pointed to by that payload, the git token obtained from the provider.

**Why reject the literal, and not just the empty one.** The default was in the
`.env.example` of an open source repository — it is a published secret, not a weak
secret. And `docker-compose.prod.yml` supplied it as a fallback, so on the real error
path the variable was **defined**: a "not empty" check would walk right over the
whole defect.

The resolution stays in a single function, and not in each caller, for the same
reason as [RN-092](#rn-092) — there were two copies of the same literal, and copies
diverge. Diverging here, the callback would refuse every legitimate `state`.

- **Where:** `src/infrastructure/security/oauth-state-secret.ts`
  (`resolveOauthStateSecret`), called at boot in `src/main.ts`
- **Test:** `test/infrastructure/security/oauth-state-secret.spec.ts`
- **Origin:** [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md)

### RN-094 — The agent area is born with the project {#rn-094}

Creating a project records the three areas (`dev`, `qa`, `infra`) in `agent_areas`,
with each one's lead and the **enumerable** members in `agent_area_members` — in the
SAME transaction as the creation. If the seeding fails, the project is not born: a
project without an area is a project where RN-083 reads an empty table and falls to
the default without anyone having decided anything.

**This is the fix of a defect, not a new capability.** `agent_areas` has existed
since PHASE 14d and was never written — `AgentAreaRepository.upsert` had a test and
NO caller. In production the table was empty, `GET /projects/:projectId/agent-areas`
returned `[]`, and the four use cases that read it operated on nothing. It is the
same failure as PHASE 14d itself, written in CLAUDE.md: **testing the piece is not
testing the path to it**. That is why this rule's test enters through the use case
the route calls, with a real repository: a fake here would prove exactly what was
already proven and broken.

**It seeds in TWO places, and each answers a different question.** Project creation
makes the area EXIST — the Settings screen reads it in a project that never
executed. Execution activation says who the MEMBERS of the `dev` area are: one
`dev-<modulo>` per `module_map` module, which did not exist when the project was
born. While there are no recorded members, what upholds the addressing rule (RN-087)
is the `ehDevDeModulo` predicate, which does not consult the database.

**The seeding sends the BIRTH ceiling, and only on the INSERT.** Since
[RN-910](#rn-910) the area is born with the catalog's value (dev 5, qa 4, infra 2),
but the `upsert` writes it only when the row does not exist yet: activation is
repeatable, and a ceiling you raised does not silently go back to its birth value —
the product undoing your decision. The backfill migration `0038` makes the area
exist and stops there; what aligns the existing projects is `0073` (RN-910).

Projects created before this are covered by migration `0038`, with `ON CONFLICT DO
NOTHING` in both tables. Without it, the defect would be fixed only for whoever
started from scratch.

- **Where:**
  `src/application/use-cases/agents/seed-agent-areas.use-case.ts`,
  called by `application/use-cases/iam/create-project.use-case.ts` and
  `application/use-cases/execution/activate-execution.use-case.ts`;
  canonical list in `src/domain/agents/agent-areas.ts`;
  backfill in `src/db/migrations/0038_wandering_lila_cheney.sql`
- **Test:**
  `test/application/use-cases/iam/create-project-semeia-areas.spec.ts` (the
  path, against the database, including the failure that brings creation down),
  `test/db/agent-areas-backfill.spec.ts` (the migration really run, twice) and
  `test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  (the dev members, and the ceiling never sent)
- **Origin:** PHASE 18, defect found in the investigation of the 16–26 program;
  the table comes from [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md)

### RN-095 — Repository reading is contained to the project and limited {#rn-095}

The code-reading surface (`GET /projects/:projectId/code/{tree,file,search}`
and the PR diff) has **two** guarantees, and both are of the same kind: the product
refusing to do what the client asked.

**Containment.** Every file path coming from the client goes through
`caminhoDeRepositorioContido()`, which anchors the request in the project folder and
refuses what leaves it — `../`, absolute, or a NUL byte. It is a single function, in
the same file as the `projectScopeRoot` of [RN-092](#rn-092), reusing the terminal
scope's primitives (`normalizarCaminho`/`dentroDoEscopo`). **No route validates a
path on its own**, and that is what the rule asserts: four implementations of the
same containment would be four chances to diverge, and CLAUDE.md already records
that the decision was to keep the check central and pay the price in the CodeQL
panel (it does not see a barrier in another function).

It returns the **normalized** path, and the caller uses what came back. Returning
the original would allow checking `b` and sending `a/../b` to the provider — the
most common way for containment to exist and not hold.

The vector is not "reading the wrong file". In `github`/`gitlab` the path becomes a
URL segment of the provider's API, so a `../` **switches endpoint** with the
workspace owner's credential in hand ([RN-058](#rn-058)/[RN-082](#rn-082)). In
`local` it becomes the right side of `git show <ref>:<path>`. The `ref` is checked in
the same place, for the same reason, and `..` in it is refused because for git
`dev..main` is a range of commits, not a revision.

**Limit.** Tree and diff already come cut by the contract (`GIT_TREE_ENTRY_LIMIT`,
`GIT_DIFF_FILE_LIMIT`, PHASE 26a). The **search** does not: it is not an operation
of the contract — it is composed over `listTree` and `getFileContent`, and is the
only read whose cost grows with the repository's SIZE instead of the request's size.
Three budgets stop it (directories traversed, files opened, matches returned), a
short-TTL cache avoids repeating the same calls, and `truncated` says that the cut
happened. Without them, a `viewer` would spend the owner's credential and rate limit
at will — the same family of defect as the dashboard's 3,824 req/min
([RN-090](#rn-090)).

Cutting is always **visible**: every response that may have been cut says so in a
field. `filesScanned` goes along in the search because the cost nobody sees is the
cost nobody fixes.

**Reading does not become a `proposed_action`.** Reading is not an external effect,
and turning it into an approval action would fill the queue with noise until nobody
read the real ones. The phase's freeze is the other side of this: the tab is
read-only, and writing — when it comes — is born a `proposed_action`.

- **Where:**
  `src/infrastructure/filesystem/project-workspaces-root.ts`
  (`caminhoDeRepositorioContido`),
  `src/application/use-cases/git/read-project-code.use-case.ts`,
  `src/domain/git/git-read-limits.ts`,
  `src/domain/git/git-read-cache.ts`,
  `src/interfaces/http/git/code.controller.ts`
- **Test:**
  `test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (the containment in isolation),
  `test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (the malicious path refused in the three routes **before** the provider is called,
  and each of the three budgets stopping the search),
  `test/domain/git/git-read-cache.spec.ts`
- **Origin:** PHASE 26b, item 34 of the 16–26 program; the containment extends
  [RN-092](#rn-092) ([ADR 0058](../adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md))

## Session

### RN-097 — The session's kind is creation intent; execution stays an event {#rn-097}

The session is born `consultiva` (consultative) or `criativa` (creative),
chosen by **whoever opens it** and recorded in `sessions.kind`. `consultiva`
is just conversation; `criativa` is the one that produces — it opens ideation
with the Creative agent and is the **only** one that enters execution. The
kind **never changes**: there's no route that swaps it.

The risk in this rule isn't the field, it's the **second source of truth**.
The product already knew how to say whether a session is executing, and knew
it through another path: `findActiveExecutionSession` looks for the `active`
session that carries the `execution.activated` event (it's what makes
reactivation land on the session where the dev agents already are, finding
#11 of the first dogfooding). The two coexist under a rule that keeps them
from fighting:

- **`kind` classifies creation INTENT.** A `criativa` session that never
  activated execution **is not** the current execution session, and the
  event-based derivation keeps not looking at `kind` — if it started to, every
  open creative session would become a candidate to receive the dev agents.
- **The event classifies execution STATE**, as always.
- **`execution.activated` on a `consultiva` session is an ERROR** (409), never
  silent conversion. This is the point that decides which of the two sources
  wins: letting the event promote the kind would be exactly having them write
  over each other.

The guard lives in the **funnel** — `AppendSessionEventUseCase` — not in
`ActivateExecutionUseCase`, because both paths that write an event (the
user's route and the engine's `/internal/*`) go through it. The extra session
read is only paid when the event is the execution one. The refusal happens
**before** `incrementSeq`: a refused attempt can't consume `seq`, or
[RN-002](#rn-002) would break.

The column's DEFAULT is `consultiva` — the kind that can do **less**: a row
arriving through a path that doesn't go through the route (migration,
maintenance SQL) doesn't earn the right to execute. The migration's
**backfill** does the opposite and is deliberate, by the 0033 reasoning: at
the moment it runs, every session predates the distinction, and some are
sessions where dev agents are working — waking them up as `consultiva` would
make reactivating an in-progress project fail without anyone having decided
anything.

- **Where:** `src/domain/sessions/session-kind.ts:50`
  (`podeAtivarExecucao`), `src/db/schema/sessions.ts:68` (the column),
  `src/application/use-cases/sessions/append-session-event.use-case.ts:53`
  (the guard)
- **Test:** `test/application/use-cases/sessions/session-kind-e-nome.spec.ts`
- **Origin:** [ADR 0061](../adr/0061-tipo-da-sessao-na-criacao.md)

## Painel de projetos

### RN-100 — The bell's order is SQL's, not the front end's {#rn-100}

The notifications drawer shows events **from most recent to
oldest**, and when a project has more unread than the 50 ceiling the ones that
appear are the **NEWEST**.

**The ordering is the database's out of necessity, not taste.** The query cuts at
50 **per project** with a window function
(`row_number() OVER (PARTITION BY session_id ORDER BY seq DESC)`), and it's what
decides **which** 50 events survive — not just in what order they come out. With
`ASC`, the 50 **oldest** survived, and a `.sort()` on the client would sort
by recency precisely the window the query had already chosen wrongly:
in a project with 300 unread, the 251st event would appear as "the most recent".
That's why there's no sorting at all in the front-end path, and the comment in the
component says there can't be.

**The consequence, and why the read cutoff didn't change.** The cutoff is a per-project `seq`
in `localStorage`, and **there's no mark-as-read endpoint**, by
decision recorded in [RN-091](#rn-091). A `seq` cutoff marks a
**prefix**; the drawer now shows a **suffix**. Marking as read "the 50
displayed" is inexpressible without a set of reads **per event** — a new table,
out of scope. The only two expressible cutoffs remain "nothing" and
"everything up to now".

The way out wasn't changing the semantics (it keeps advancing to the last `seq`,
exactly as before), it was **to stop hiding what that advance swallows**:

- each project shows the **total** unread, not the window size, and
  declares how many were left out (`+ N mais antigos`);
- the button now says what it does — `marcar as N como lidas` — when there's something
  outside the window;
- the missing number comes from **subtraction**, not a request: `latestSeq`
  minus the cutoff already comes in the workspace summary ([RN-090](#rn-090)).

Since the cutoff's semantics didn't change, **there's no ADR** for this rule: what changed
was which window the query chooses and what the drawer declares about it.

- **Where:**
  `src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
  (`unreadEventsForWorkspace`),
  `src/application/ports/projects-summary-repository.port.ts`,
  `src/interfaces/http/iam/dto/iam.response.dto.ts`
  (`ProjectUnreadEventsResponseDto`),
  `apps/web/src/lib/notifications.ts` (`useNotificationGroups`),
  `apps/web/src/components/NotificationBell.tsx`
- **Test:**
  `test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  ("with more unread than the ceiling, the MOST RECENT come back, from new to
  old" — asserts the SET before the order);
  `apps/web/src/components/NotificationBell.test.tsx` (renders in the order
  received, without reordering; the counter is the total; the button says how many it marks);
  `apps/web/src/lib/notifications.test.tsx` (what was left out of the window comes out
  by subtraction, without a second request);
  `apps/web/src/routes/Dashboard.fanout.test.tsx` (the drawer is still
  ONE request)
- **Origin:** user request on the first real navigation — "Bell and
  notifications must always sort by last modified date descending
  to the oldest"

---

### RN-101 — The same spending, two audiences: the bill is the owner's, the consumption is whoever spent's {#rn-101}

The product answers **two different questions** about `token_usage`, and neither is
a cut of the other.

**The owner's is by CREDENTIAL.** `GET /workspaces/:id/credential-spend` remains as
[RN-060](#rn-060) left it — by provider, requiring `owner`, answering "how much left
my key". Alongside it, `GET /workspaces/:id/spend-report` (also `owner`) breaks the
workspace down by **model, provider, project, actor and day** — the provider axis
came in through [RN-186](#rn-186). The owner sees both because they are the only
person who can see both.

**The member's is by ACTOR.** `GET /projects/:id/spend/me` (role `viewer`) returns,
in tokens and **estimated** cost, what **the caller** consumed in that project, by
session and by day. It **does not break down by provider nor by credential** — the
key that ran is the owner's ([RN-058](#rn-058)), and a slice of their bill is not
what the member is asking.

The actor is **not a parameter**: it comes from the authenticated user, and there is
nowhere to write another person's id. "A member does not see another actor's row" is
a property of the use case's signature, not a check someone can forget to call.

**An agent does not enter the member's account.** `token_usage` records who SPENT,
not who ordered the spending; attributing the agent to whoever started it would be
inventing a datum the table does not have. An agent's spending appears in the owner's
report, whose key it is.

**The `provider` axis exists, and the member does not reach it.** Until
[ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md) it simply did not
exist in the aggregation, and it was the absence that contained the member's view.
Today `sumGroupedBy` has six dimensions (`model`, `provider`, `project`, `actor`,
`session`, `day`) and the containment changed shape, not strength: what contains is
the TYPE — see [RN-186](#rn-186) and [RN-187](#rn-187). What did not change is that
two providers serving the same model name still fall into a single row in the
`model` dimension.

- **Where:**
  `src/application/use-cases/llm/get-my-spend.use-case.ts`,
  `src/application/use-cases/llm/get-workspace-spend-report.use-case.ts`,
  `src/application/ports/token-usage-repository.port.ts`,
  `src/interfaces/http/llm/spend.controller.ts`,
  `apps/web/src/routes/ProjectSpendTab.tsx`
- **Test:** `test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  (the member does not see another actor's row, nor an agent's, nor the owner's; the
  filter is by the pair `(kind, id)`; the response carries no provider);
  `apps/web/src/routes/ProjectSpendTab.test.tsx`
- **Origin:** [ADR 0063](../adr/0063-duas-audiencias-para-o-mesmo-gasto.md) (PHASE 22),
  revised by [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-102 — The area's model is an inheritable default; diverging is the agent's decision, and going back to inheriting erases the decision {#rn-102}

The binding cascade gained a level: `session > agent > **area** > project >
workspace`. `area` sits BETWEEN agent and project — it is the DEFAULT that the
lead and the subagents of an area share (`qa`/`qa-automacao`/
`qa-performance-seguranca`, `infra`/`infra-workflows`, `dev`/`dev-<module>`), and
the agent's own binding is the DIVERGENCE that overrides it. If the area came
ABOVE the agent it would always win, and "inheritable default" would in practice
be "imposed default" — no agent could choose another model.

The new level enters the SAME capability revalidation as
[RN-041](#rn-041)/[RN-043](#rn-043): an area model that vanished from the
provider or that does not do tool calling is SKIPPED and recorded in `skipped`,
exactly as `agent` already was. `assertModelFitsBindingScope` (RN-040) now
requires `supports_tool_calling` in the `area` scope too — it is never read by
the human chat, only by an agent, so letting it through would postpone the same
silent failure by one level.

**"Going back to inheriting" deletes the binding, it never copies the model from
the lower level to the upper one.** Writing to the agent the model the area
decided would look the same on screen and is not: it would become a COPY, and
the area's next change would leave that agent behind with nobody noticing.
Inheriting is the ABSENCE of its own decision, and undoing a divergence is
removing the row — `DELETE
/projects/:id/agent-bindings/:slug` and `DELETE
/projects/:id/area-bindings/:key`, both 204, both 404 when the scope already
inherits (idempotency that would LIE if it were a silent 204: deleting what did
not exist and really deleting are different answers for the same screen).

Changing the AREA's model requires `maintainer`, and not `developer` like the
individual agent's — for the same reason as the parallelism ceiling
([RN-083](#rn-083)): the area's binding reaches the lead and ALL the subagents
at once, and choosing a model is deciding how much the product spends without
asking.

**The SCREEN now honors BOTH minimums, and they are two.** Until now
`ModelsSection` — the table of model per agent — checked no role at all: the
`ModelPicker` in the CURRENT MODEL column and the "go back to inheriting" in the
ORIGIN column appeared clickable to everyone, `viewer` included, and the api
refused with 403. The way out was NOT to copy the gate from the sibling section
(`owner || maintainer`): that would trade the defect for its INVERSE, locking a
`developer` out of an action that `PUT`/`DELETE .../agent-bindings/:slug`
accepts — and the inverse is worse, because offering what will be refused at
least ends in a toast, while losing a capability is invisible to whoever lost
it. The minimum belongs to the ENDPOINT, not the section, and the two sections
are neighbors on the SAME screen with different minimums. The comparison left
the screens and became `roleAtLeast` (`apps/web/src/lib/roles.ts`), over the
`ROLE_ORDER` that already existed — same name as the backend function, because
it is the same rule on both sides of the wire; writing the hierarchy by hand
(`role === 'owner' || role === 'maintainer'`) gets it right by accident while
the minimum is high and gets it wrong silently when it is low. An ABSENT role
(query in flight, or failed) reaches nothing: erring on the side of disabling
is fixed by reloading.

**The CONTROL disappears, never the INFORMATION** (ADR 0064). Whoever cannot
edit still sees the current model in the trigger and the whole origin chain
([RN-470](web.md#rn-470)), and the "go back to inheriting" stays on the row,
inert — it is what SAYS that agent diverged, and hiding it would erase a state
that can be read without being able to change it. The reason they are dimmed is
stated ONCE, in text, in the section legend, and not by `title` on each row: a
tooltip on a `disabled` element does not open in Chromium (the browser does not
dispatch mouse events on a disabled control), and an explanation that does not
show is the same absence with more code.

**None of this is a security boundary, and the limit is declared.** What
refuses is still the `RolesGuard`. The role the screen reads is the WORKSPACE's
(`useCurrentWorkspaceWithRole`) and what authorizes on the other side is the
PROJECT's EFFECTIVE role (`ResolveEffectiveRoleUseCase.forProject`), which a
`project_members` row OVERRIDES in both directions — so whoever has their own
role in the project may see here a disabled control that the api would accept.
Closing that would require a role query PER PROJECT that the web does not have
yet, and it is the same gap that the area's box (RN-912) also carries; inventing
a second source of role in only one section would be worse than the gap.

> **Additive note ([RN-471](web.md#rn-471)):** the gap in the paragraph above is
> ONE, not one per section, and where the screen ALREADY does the per-project
> role query it closes instead of being declared. The **Members** section
> fetches `listProjectMembers`, which is `findMemberRole` for everyone at once,
> and composes `projectRole ?? workspaceRole` — exactly what `forProject` does.
> That is not the second source of role this paragraph refuses: it is the SAME
> composition, from data that section already has in hand. The two model
> sections stay with the approximation because they do not have that data. Be
> careful reading "OVERRIDES in both directions" above: it is literal, and three
> OpenAPI descriptions claim the opposite — see RN-471.

- **Where:** `src/domain/llm/binding-resolver.ts` (precedence),
  `src/domain/llm/model-capabilities.ts` (`area` capability),
  `src/application/use-cases/llm/resolve-model-binding.use-case.ts`
  (the agent's area comes from the `agent-areas.ts` catalog, with no round trip
  to the database), `src/application/use-cases/llm/clear-model-binding.use-case.ts`,
  `src/interfaces/http/llm/model-bindings.controller.ts`
  (`area-bindings`, `DELETE` on `agent-bindings` and `area-bindings`),
  `apps/web/src/routes/settings/ModelsSection.tsx` (Origin column with
  "go back to inheriting"; since RN-912 erasing the area is unchecking the
  lead's box, and the `maintainer` gate stays on `roleAtLeast` without changing
  its minimum),
  `src/interfaces/http/llm/model-bindings.controller.ts:273` and `:301`
  (`developer` on both agent endpoints — these lines did NOT change),
  `apps/web/src/lib/roles.ts:49` (`roleAtLeast` — the comparison that was
  missing),
  `apps/web/src/routes/settings/ModelsSection.tsx:93` (`podeEditar`, and why
  `developer` and not `maintainer`), `:379` (the disabled picker), `:446` (the
  disabled button, and why the reason does not go in `title`), `:546` (the
  legend that states the reason)
- **Test:** `test/domain/llm/binding-resolver.spec.ts`,
  `test/domain/llm/model-capabilities.spec.ts`,
  `test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`,
  `test/application/use-cases/llm/clear-model-binding.use-case.spec.ts`,
  `apps/web/src/routes/ProjectSettingsTab.test.tsx`,
  `apps/web/src/routes/settings/papel-na-tabela-de-agentes.test.tsx`
  (`viewer` does not edit and the click does not reach the api; `developer`
  edits and the PUT/DELETE arrives; an absent role is inert; the row's
  information survives the dimmed control; and the case that prevents
  "making the two sections uniform" — the same `developer` sees the agents table
  enabled and the areas one disabled, at the same time)
- **Origin:** [ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) (PHASE 23)

### RN-103 — The agent binding is PER PROJECT, no longer global {#rn-103}

Until PHASE 23, `scope = 'agent'` stored a global SLUG
(`scope_id = 'qa'`), and `PUT /projects/:id/agent-bindings/:slug` received
`:projectId` in the route and DISCARDED it on purpose — choosing the Architect's
model on a project's screen changed its model in ALL projects.
That stopped being sustainable when the area became an inheritable default (RN-102):
the area is per project, and a global agent binding ABOVE a per-project default
would make the same agent resolve different models only where an area existed —
and would make "go back to inheriting" erase a decision that reached projects
nobody is looking at.

The way out was to make `agent` per project too, and not to demote the area below
the agent: the `scope_id` of `agent` and of `area` became COMPOSITE —
`<projectId>:<agent slug|area key>` — instead of inventing a new table just to hold
one project per binding. A project UUID and an agent slug never contain `:`, which
makes the first `:` an unambiguous separator; the read cuts at it, and not at all of
them, so that a slug with `:` (none exists today, but nothing prevents it) does not
become three pieces.

A `scope_id` without the project (the old format) is REFUSED on write, not accepted
and ignored: recording it would create a binding the cascade would never find
again — invisible, rather than an error. Migration 0040 spreads each existing global
agent binding into one row per project (preserving what each project resolved before
the change) and deletes the old format; it SPREADS and does not delete because the
global row never stored information on who it "belonged" to — inventing an owner
project would be inventing data that did not exist.

- **Where:** `src/domain/llm/binding-scope-id.ts` (format and
  validation), `src/application/use-cases/llm/set-model-binding.use-case.ts`
  (`workspaceDoEscopo` now derives the workspace for `agent`/`area` too —
  RN-043's curation was not verifiable in them before), `src/db/migrations/0040_tearful_night_nurse.sql`
- **Test:** `test/domain/llm/binding-scope-id.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`,
  `test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`
  ("o binding de agente é POR PROJETO: o vizinho não o enxerga")
- **Origin:** [ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) (PHASE 23)

### RN-105 — Without an image decided by the Arquiteto, the container does not start and Code does not open {#rn-105}

The Code tab (`GET /projects/:id/code/*`, [ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md))
answers **409** while the project is in `sem_decisao` — the initial state
of every project. `sem_decisao` becomes `decidido` only when the Arquiteto emits
`artifact.project_image` through the `choose_project_image` tool, with an OCI image
with an explicit tag (`latest` refused), `rationale` and network posture.

The check lives in the SAME funnel as the path containment of
[RN-095](#rn-095) (`ReadProjectCodeUseCase.alvo`), and not in each of the seven
routes (tree, file, search, PR diff, [blame](contracts.md#rn-110), [PR
list](contracts.md#rn-111) and [detailed branches](contracts.md#rn-112), FASE 26b) — a check
duplicated in seven callers is a check that one day diverges in one of them
([ADR 0058](../adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md)).
Count corrected here: this record said "four routes" since FASE 26,
and became outdated when FASE 26b added the last three to the same
funnel without anyone revising this number.

The artifact has no table: it is the event itself in the event log, versioned
(`version` grows with each emission, the current one is the one with the highest `version`), the same
way as `artifact.module_map`. Revising the image is emitting a new version,
never overwriting the previous one.

- **Where:** `src/domain/containers/project-container.ts`,
  `src/application/use-cases/containers/decidir-imagem-do-projeto.use-case.ts`,
  `src/application/use-cases/containers/obter-container-do-projeto.use-case.ts`,
  `src/application/use-cases/git/read-project-code.use-case.ts` (method
  `portaoDoContainer`), `apps/engine/lib/engine/harness/tools/choose_project_image.ex`
- **Test:**
  `test/domain/containers/project-container.spec.ts`,
  `test/application/use-cases/containers/container-do-projeto.use-case.spec.ts`,
  `test/application/use-cases/git/read-project-code.use-case.spec.ts`
  ("o portão do container" block)
- **Edge case:** 409 and not 403 — nothing is wrong with the requester or with their
  permission; the resource does not exist yet IN THIS STATE. And it is not 404: the tab
  exists, it is just not unlocked. The message says what is missing, so the screen shows
  the reason instead of a mute error (RN-088).
- **Origin:** [ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-106 — `git push`, PR and deploy do not go out through the terminal — even within the project scope {#rn-106}

**REVISED by [RN-418](#rn-418) (ADR 0102, GLOBAL decision of the product
owner)**: the `deny` this record describes became an ABSOLUTE CEILING
(unconditional `require_approval`) — the rest of this entry is history,
faithful to what held until the revision.

Inside the project container the agent is free (ADR 0065): the verb allowlist
of [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) does not
converge (findings Z and AD — verb, form and invocation are distinct spaces), and the
way out is the wall, not a longer list. But three effects cross the
wall and reach the world, and the user's decision was verbatim: *"agente livre
para o que quiser desde que não seja comandos de git ligado ao deploy e ao PR —
estas ações ainda devem ser humanas"*.

`decide()` recognizes `git push`, `git remote add/set-url`, `git merge`, the provider
CLIs (`gh pr create`, `gh pr merge`, `glab mr create/merge`, releases and
workflow dispatch) and the common deploy commands (`kubectl apply`, `helm
upgrade`, `terraform apply`, `docker push`, `npm publish`, ...) by token
PREFIX, ignoring global flags in between (`git -C /tmp push` matches). Any
segment of the compound command that matches is **`deny`** — not `require_approval`:
"always allow" writes the pattern into `allow`, and one click would be enough for the
second door to stay open forever. `deny` beats `allow` at any
stage, and it is applied BEFORE any permissive stage in `decide()`.

Denying does not take power away from the agent: the message redirects to the TYPED action
(`git_push`, `git_merge`, `pr_open`) — which is born a `proposed_action`, has its own
minimum role and records in the event log what was pushed and where. It is the
path the dev agent already uses (`agent_io.ex` proposes `git_push`); what changes is
that it is now guaranteed by `deny`, not just agreed by convention.

- **Where:** `src/domain/actions/external-effect.ts`,
  `src/domain/actions/decide.ts` ("FRONTEIRA DO CONTAINER" block)
- **Test:** `test/domain/actions/external-effect.spec.ts`,
  `test/domain/actions/decide.spec.ts` (describe "a fronteira do
  container")
- **Edge case:** the boundary does NOT override the merge lock on a protected branch
  (RN-014, always manual) nor the path scope (RN-095/ADR 0055) — the three
  rules coexist, each one vetoing for a different reason.
- **Origin:** [ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-109 — The workspace folder name is frozen at creation, and an old project keeps the UUID {#rn-109}

A project's physical folder in `PROJECT_WORKSPACES_ROOT` was the bare UUID —
unreadable when opened on disk. `projects.workspace_dir_name` (NOT NULL, UNIQUE)
started storing the real name: `<slug>-<8 chars do id>` for a
NEW project (`workspaceDirNameFor` in
`src/infrastructure/filesystem/project-workspaces-root.ts`), generated
in code — the id is born from `crypto.randomUUID()` in
`CreateProjectUseCase`, not from Postgres's `defaultRandom()`, because the folder
name needs the id BEFORE the insert. The 8 characters follow the same
convention as the session label (`apps/web/src/lib/session-label.ts`).

The name is FROZEN at creation time and never recomputed: `UpdateProjectUseCase`
allows editing the `slug` later, and that does NOT touch `workspace_dir_name` — renaming the
physical folder, with a working tree and agent worktrees possibly open, is
a real risk the decision avoids by construction, not by the caller's
discipline.

A project created BEFORE this migration (0042) kept the physical folder it already
had: the backfill writes `workspace_dir_name = id` for every existing row —
the same value that was already true on disk — and NEVER renames any
directory. A `BEFORE INSERT` trigger (`projects_workspace_dir_name_default_trg`)
applies the SAME fallback (`id::text`) to any insert that arrives without the
field — a safety net for whoever forgets to write it (never the main
path, which always writes it explicitly), and what keeps the dozens of
existing test fixtures, which do not know this concept, working
without needing to rewrite each one.

Path derivation from the name (`projectScopeRoot`, RN-092/RN-075)
started receiving `workspace_dir_name` instead of the raw `projectId` — same
charset validation, same purity. The engine reads the SAME column
(`Engine.Projects.Project.workspace_dir_name/1`) to resolve
`Engine.Actions.Workspace.workspace_dir/1`, never recomputing the name from
the id: the two derivations (api and engine) are, in practice, the same
read against the same database — that is what guarantees RN-075 (terminal
scope) and RN-092 (code reading) keep pointing to the SAME
folder the engine really uses.

- **Where:** `src/db/schema/iam.ts` (`projects.workspaceDirName`),
  `src/db/migrations/0042_tough_captain_midlands.sql`,
  `src/infrastructure/filesystem/project-workspaces-root.ts`
  (`workspaceDirNameFor`, `projectScopeRoot`),
  `src/application/use-cases/iam/create-project.use-case.ts`,
  `apps/engine/lib/engine/projects/project.ex`
  (`workspace_dir_name/1`, `all_workspace_dirs/0`),
  `apps/engine/lib/engine/actions/workspace.ex` (`workspace_dir/1,2`),
  `apps/engine/lib/engine/dev/worktree_cleanup.ex`
- **Test:**
  `test/db/workspace-dir-name-migration.spec.ts` (trigger, equivalent
  backfill, uniqueness),
  `test/application/use-cases/iam/create-project-semeia-areas.spec.ts`
  (`workspaceDirName` is born `<slug>-<8 chars>`, two projects with the same
  slug in different workspaces do not collide on folder),
  `test/infrastructure/filesystem/project-workspaces-root.spec.ts`
- **Edge case:** the parallelism ceiling and the merge gate do not change — RN-109 is only
  the folder NAME, never policy. Renaming the slug after creation does not
  rename the folder; the folder is only read through the stored `workspace_dir_name`.
- **Origin:** ADR 0066 (revises ADR 0055).

### RN-114 — The four sibling secrets of `GIT_OAUTH_STATE_SECRET` also do not boot in production with the example value {#rn-114}

[ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md) closed the
pattern for `GIT_OAUTH_STATE_SECRET` and left it declaredly open that the same
failure mode held for four sibling secrets, all with a development default in
`docker-compose.prod.yml`: `AUTH_JWT_SECRET`, `BRABO_SERVICE_TOKEN`,
`CREDENTIALS_MASTER_KEY` and `SECRET_KEY_BASE`. This RN closes the four,
replicating exactly the same rule — it is not a new decision, it is the same
decision applied to the siblings.

In production (`NODE_ENV === 'production'`), each resolver **brings the boot down**
when the variable is absent/only whitespace, equals the repository's example
literal (which is public — it is in `.env.example`), or has fewer than 16
characters. Outside production the development default still holds, because
`docker compose up` without a `.env` has to work.

- `AUTH_JWT_SECRET` — derives the Ed25519 pair that signs the access token. With
  the public default, anyone forges a valid access token.
- `BRABO_SERVICE_TOKEN` — authenticates the internal api ↔ engine traffic. With
  the public default, anyone calls the `/internal/*` routes without going through
  the `EngineServiceGuard`.
- `CREDENTIALS_MASTER_KEY` — wraps the DEKs that encrypt the user's credentials
  (LLM keys, git tokens). With the public default, anyone decrypts the whole store.
  **Out of scope here**: any rotation mechanism — that one already exists
  (`CREDENTIALS_MASTER_KEY_PREVIOUS` + `src/scripts/rewrap-deks.ts`) and does not
  change; this is only the BOOT check.
- `SECRET_KEY_BASE` (engine) — already brought the boot down without the variable
  (`runtime.exs`, `:prod` block, standard Phoenix boilerplate). The real defect was
  not a missing check in Elixir: it was `docker-compose.prod.yml` supplying the
  public literal as a fallback, which made the variable always arrive DEFINED and
  masked the `raise` that already existed. The fix here was only removing the
  compose's fallback — no line of Elixir changed.

The same reason as ADR 0059 applies to rejecting the literal, and not just the
empty one: `docker-compose.prod.yml` supplied the four literals as a fallback, so
on the real error path the variables were **defined** — a "not empty" check would
walk right over the whole defect.

- **Where:** `src/infrastructure/security/auth-key-material.ts`
  (`passphraseAtual`), `src/infrastructure/security/service-token.ts`
  (`tokenDeServicoAtual`) and
  `src/infrastructure/security/envelope-encryption.service.ts`
  (`EnvelopeEncryptionService`, check in the constructor) — the first two
  called at boot in `src/main.ts`, the third exercised when
  `NestFactory.create` assembles the provider graph. `SECRET_KEY_BASE` in
  `apps/engine/config/runtime.exs` (unchanged) with the fallback removed from
  `docker/docker-compose.prod.yml`
- **Test:** `test/infrastructure/security/auth-key-material.spec.ts`,
  `test/infrastructure/security/service-token.spec.ts` and the describe
  `validação de produção` in
  `test/infrastructure/security/envelope-encryption.service.spec.ts`
- **Origin:** [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md)

### RN-127 — The Code tab's `ref`/`path` refuse to arrive as an ARRAY, not only as a path outside the scope {#rn-127}

`@Query('ref') ref?: string` and `@Query('path') path?: string`
(`code.controller.ts`) extract the raw value with no DTO/`class-validator` in
between, and the global `ValidationPipe` (`main.ts`) does not help: it skips a
native primitive type (`String`) by Nest's design, so nothing intercepts
`ref`/`path` before they arrive as a method argument. Express delivers
`?ref=a&ref=b` as an **array**, not a string — TypeScript's `string` annotation
only exists at compile time.

An array escaped BOTH checks that [RN-095](#rn-095) already did treating the value
as a string: `ref.includes('..')` has EXACT-ELEMENT semantics (not substring) on an
array, and `REF_VALIDO.test(ref)` calls `.toString()` on the array before
matching — a value such as `['x/../y']` contained `..` and still would pass both.

`garantirQueryEscalar(valor, criarErro)` refuses the array BEFORE any other check,
in a single place, reused by the TWO points that treated the query as a string:
`caminhoDeRepositorioContido` (same file as RN-092/095) and
`ReadProjectCodeUseCase.alvo` (`ref`). The concrete error (`CaminhoForaDoEscopoError`
or `BadRequestException`) is decided by the caller, passed as a factory — the central
function does not decide the error type, only the shape of the check.

The happy path does not change: every legitimate `ref`/`path` was already a string.

- **Where:** `src/infrastructure/filesystem/project-workspaces-root.ts`
  (`garantirQueryEscalar`, used in `caminhoDeRepositorioContido`),
  `src/application/use-cases/git/read-project-code.use-case.ts`
  (`alvo`, `ref`)
- **Test:**
  `test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (`garantirQueryEscalar` in isolation and `caminhoDeRepositorioContido` refusing
  an array), `test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (`ref`/`path` as an array are 400 in `tree`, which all the other routes
  reuse via `alvo`)
- **Origin:** CRITICAL CodeQL alert (type confusion in an HTTP query param)
  blocking the qa→main promotion, found during PR #256; extends
  [RN-095](#rn-095)

### RN-128 — `sessionId`/`projectId`/`agent`/`agentId` are validated BEFORE becoming a URL segment of the internal request to the engine {#rn-128}

`HttpApiToEngineClient` interpolates these values in a template string to
build the `/internal/*` URL — with no DTO/`class-validator` in between, just like
[RN-127](#rn-127): they come from `@Param`/session lookup without a validation
pipe at some point of the chain, and nothing guarantees their shape before
interpolation. A malicious value could inject an extra path segment
or characters that break the built URL — the `EngineServiceGuard` authenticates
the CALLER (RN-035), it does not CHECK what the caller sends in the URL.

`garantirSegmentoDeUrlInterna` reuses the same width as
`NOME_DE_PASTA_VALIDO` (RN-092/109) — hex, hyphen and underscore, 1 to 64
chars — and is called in TWO places, covering ALL the methods that
interpolate an id in a URL, not only the ones CodeQL reported:

- inside `postCommand`, which most methods already use
  (`startAgent`, `sendAgentMessage`, `confirmReadiness`, `cancelAgentTurn`,
  `offerInfraHandoff`, `invalidateInstructions`,
  `startExecution`, `acceptParallelization`, `rearmDevAgent`,
  `reviseStory`) — the caller lists the `(nome, valor)` tuples it already
  interpolated into the `path`, and `postCommand` validates ALL of them before building the
  request;
- directly in `reanalyzeSession`/`runAnamnese`, which do not go through
  `postCommand` (they need to distinguish 503 from a transport failure) and
  that is why they were the only two points CodeQL reached.

The happy path does not change: `sessionId`/`projectId` are always a UUID from the
database, and `agent`/`agentId` are always a short slug.

- **Where:** `src/infrastructure/http-clients/api-to-engine-client.ts`
  (`garantirSegmentoDeUrlInterna`, `postCommand`)
- **Test:** `test/infrastructure/http-clients/api-to-engine-client.spec.ts`
  (a malformed id is refused BEFORE touching the network — proven by pointing
  `ENGINE_URL` to a port nothing listens on — and the happy path does
  make the request)
- **Origin:** CRITICAL CodeQL alert (internal request URL built
  with an unvalidated value) blocking the qa→main promotion, found during
  PR #256; same pattern as [RN-092](#rn-092)

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
- **reuses `GetSessionPendingWorkUseCase`** ([RN-073](engine.md#rn-073)) — the
  SAME guard that holds off closing on inactivity heartbeat: an offered
  handoff, a pending `proposed_action`, or an agent `working` with no
  subsequent `idle` prevent closing;
- goes through `closing` before `closed` — the state machine
  (`active -> closing -> closed`) doesn't allow the direct jump.

A failure or pending state here NEVER propagates to whoever called
`execute()`: the
ativação da execução já aconteceu e é o efeito principal; fechar o chat de
origem é um efeito colateral *best-effort*.

- **Onde:** `src/application/use-cases/execution/activate-execution.use-case.ts`
  (`closeOriginSession`), `src/interfaces/http/execution/dto/activate-execution.dto.ts`
  (`originSessionId`), `src/interfaces/http/execution/execution.controller.ts`
- **Teste:** `test/application/use-cases/execution/activate-execution.use-case.spec.ts`,
  describe `fecha a sessão de origem (RN-135)` — fecha sem pendência,
  NÃO fecha com pendência, NÃO fecha sessão já não-`active`, chamador
  antigo sem o parâmetro não fecha nada, e nunca fecha a própria sessão de
  execução mesmo se `originSessionId` coincidir com ela
- **Origem:** achado de investigação de código — sessão criativa com
  execução ativada continuava `active` na lista mesmo com 35 eventos de
  dev agents dentro dela

### RN-139 — The Executors tab reads the CURRENT execution session, never the project's most recent one {#rn-139}

`ProjectExecutorsTab` fetched the dev agent/QA events by the session that
`useLatestSession` returned — the project's one with the most recent `createdAt`, without
filtering by `kind` nor requiring `execution.activated`. It worked only by
**coincidence**: the execution session tends to be the newest. As soon as
any session is born after it — a new ideation, a consultative chat — the
tab starts looking at that new session, empty of execution events,
silently: no hint on screen said which session was being displayed.

The correct read already existed in the backend: `findActiveExecutionSession`
(`SessionRepository`) — the most recent `active` session that carries
`execution.activated` — but it was only used internally by
`ActivateExecutionUseCase` to decide whether to reactivate or create. The fix exposes
the SAME criterion over HTTP, instead of duplicating it in the front:

- **`GET /projects/:projectId/execution/session`** (`role:viewer`) returns the
  current session or `null` — it never infers from the most recent;
- `ProjectExecutorsTab` swaps `useLatestSession` for `useActiveExecutionSession`
  (a new hook over the route above) as the source of the session the whole tab reads;
- the tab header always shows WHICH session is being displayed — its
  label (hashtag + name) linking to `SessionPage`, or "Nenhuma execução
  ativa" when `null` — never implicit again. The three states of
  [RN-088](web.md#rn-088) apply to the session fetch itself: loading, error
  (with `trace_id`) and empty (`null`) are three distinct renders, never an
  `if (!sessão) return null` that collapses them.

- **Where:**
  `src/application/use-cases/execution/get-active-execution-session.use-case.ts`,
  `src/interfaces/http/execution/execution.controller.ts` (`getSession`),
  `apps/web/src/lib/hooks.ts` (`useActiveExecutionSession`),
  `apps/web/src/routes/ProjectExecutorsTab.tsx`
- **Test:**
  `apps/web/src/routes/ProjectExecutorsTab.test.tsx` — shows the execution
  session even with a more recent session existing in the project, an explicit
  "nenhuma execução ativa" state, and a network error handled (not blank)
- **Origin:** finding from code investigation + live test — the same
  class of defect RN-088 closed for 429, now for "which session the
  screen is looking at"

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
  token after the key (`git config user.name "novo valor"`) is a WRITE,
  and prefix matching doesn't distinguish "no more tokens" from "one
  more token" without inventing a new argument-counting parser — the
  same limitation that already blocks a bare `git branch`.
  `--global`/`--system` were never anchored.

- **Where:** `src/domain/actions/dev-terminal-patterns.ts`
- **Test:** `test/domain/actions/dev-terminal-patterns.spec.ts` (describe
  `read-only git subcommands (found live)` — covers the composite chain
  observed live auto-approving, and each mutating variant with the SAME
  command word — `git branch -D`, `git remote add`, `git worktree add`,
  `git config --global user.name` — staying in `require_approval`)
- **Origin:** query against a real session's database, found during use

### RN-145 — The Arquiteto also has a readiness button, and the SAME confirmation offers Infra and Dev Lead {#rn-145}

`OfferInfraHandoffUseCase` (`POST .../agents/arquiteto/handoff-infra`) already
existed since Fase 4a — it writes `architecture.readiness_confirmed` and calls the
engine, which offers the handoff to Infra and, in the SAME confirmation, to the Dev Lead
(FASE 14d/ADR 0053). What was missing was the way to reach it: no
place in the frontend called the endpoint. The "Confirmar arquitetura pronta" button
exists for the Criativo since always ("Estou pronto para produzir",
[RN-131](web.md#rn-131)/[RN-142](engine.md#rn-142)) — the Arquiteto had no
equivalent at all, and without the click the handoff was never born: the priority fix of the
card in the thread ([RN-125](web.md#rn-125)) had no practical effect, because there was nothing
to show.

`arquitetoActive` mirrors `criativoActive` (there is an `agent.activated` for the
Arquiteto in this session) and `arquiteturaJaDeclarada` mirrors
`prontidaoJaDeclarada` (there is ANY handoff leaving the Arquiteto — the proof
that the confirmation already happened, since `OfferInfraHandoffUseCase` creates
at least the Infra one in the same call). The button appears in the composer only
when the first is true and the second is not — it disappears after the click
for the same reason the Criativo's disappears after readiness.

Unlike the Criativo, the Arquiteto has NO server guardrail
blocking the confirmation without a `module_map` — `ArquitetoServer.offer_infra_handoff`
refuses nothing, unlike `CriativoServer.confirm_readiness`
([RN-142](engine.md#rn-142)). The button is only disabled during `streaming`; not replicating
here the Overview's `disabled={!hasModuleMap}` is a deliberate decision, by the
same reasoning that already holds for "Ativar execução" on the Dev Lead card
([RN-137](web.md#rn-137)) — when this card exists, the Arquiteto has already decided the
architecture.

- **Where:** `src/interfaces/http/agents/agents.controller.ts`
  (`handoffInfra`, pre-existing route), `apps/web/src/lib/api-client.ts`
  (`confirmArchitectureReadiness`), `apps/web/src/routes/SessionPage.tsx`
  (`arquitetoActive`, `arquiteturaJaDeclarada`, `handleArchitectureReadiness`,
  "Confirmar arquitetura pronta" button)
- **Test:**
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`, describe
  "problema 1" — button absent without the Arquiteto active, the happy path calls the
  dedicated endpoint, failure shows an error toast, and the button disappears with the
  architecture already declared
- **Origin:** code investigation — the endpoint and the engine logic
  existed since Fase 4a/14d with NO UI path to them

### RN-146 — `agent.response` carries the name of the model that generated the response {#rn-146}

The model name only existed in `token_usage`, with no link to the specific
`agent.response` event it produced — `SessionPage.tsx` showed the
FIXED string `"modelo"` next to the agent's name, never the real name.

The change crosses the three layers, all with the SAME field name
(`modelName`), so no translation between them is needed:

1. **api** — `StreamLlmTurnUseCase`/`RunLlmTurnUseCase` already resolved the
   model (`resolveModelBinding` → `models.findById`) to call the
   provider; the `final` frame/`RunLlmTurnResult` gain `modelName: string |
   null`. `null` only when the turn failed BEFORE resolving a model (no
   binding, or binding to a nonexistent model) — in the other cases,
   including budget exceeded, the binding had already resolved and the name
   travels even in the error frame.
2. **engine** — the four conversational agents (`criativo_server.ex`,
   `po_server.ex`, `arquiteto_server.ex`, `dev_lead_server.ex`) extract
   `Map.get(frame, "modelName")` from the `final` frame and include it in the payload of
   `emit_response`/`agent.response` (`%{content: content, modelName:
   model_name}`).
3. **web** — `SessionPage.tsx` reads `event.payload.modelName`. An event
   WRITTEN before this change does not have the key (`undefined`), and a turn
   whose api resolved no model writes `null` — both degrade to
   the generic label `"modelo"`, never to `undefined`/`null` on screen; the
   same pattern that `text === ''` already uses for a response prior to RN-059.

- **Where:** `src/application/use-cases/llm/stream-llm-turn.use-case.ts`
  (`LlmTurnStreamEvent`), `src/application/use-cases/llm/run-llm-turn.use-case.ts`
  (`RunLlmTurnResult`), `src/interfaces/http/internal/dto/internal.response.dto.ts`
  (`LlmTurnResponseDto`/`LlmTurnStreamEventResponseDto`),
  `apps/engine/lib/engine/agents/{criativo,po,arquiteto,dev_lead}_server.ex`
  (`emit_response/3`), `apps/web/src/routes/SessionPage.tsx` (the timeline's
  `agent.response` block)
- **Test:** `test/application/use-cases/llm/run-llm-turn.use-case.spec.ts`,
  `test/application/use-cases/llm/stream-llm-turn.use-case.spec.ts`
  (`modelName` on the happy path, on the provider error and without binding),
  `apps/engine/test/engine/agents/{criativo,po,arquiteto,dev_lead}_server_test.exs`
  (`agent.response` carries the model name; edge case of the frame without the key),
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`, describe
  "problema 2" — real name, old event without the key, `modelName: null`
- **Origin:** code investigation — confirmed that the data already existed in
  `token_usage`, but never reached the event payload

### RN-149 — The Container level of the C4 diagram is derived from the module_map, never retyped by the model {#rn-149}

`create_c4_diagram` (a new Arquiteto tool) generates the two Mermaid
syntaxes of the C4 diagram (Context + Container, Simon Brown's model). The tool
call carries only `system_name`/`system_description`/`actors` — the modules and
the Container-level dependencies are NOT part of the input: the use case
fetches the project's CURRENT `module_map` (`ModuleMapRepository.findCurrent`,
the same read as `GetArchitectureUseCase`) and derives the Container level from it,
with the SAME names and dependencies that `create_module_map` already validated without
cycles.

The obvious alternative — letting the model describe the modules again in the diagram's tool
call, as it already does for `create_module_map` — was discarded
on purpose: a second place where the model writes "the modules are X, Y,
Z" is a second place where that list can diverge from the first, and the
divergence would be SILENT — nothing would refuse a diagram with a module that
no longer exists in the real map. Deriving from the repository closes that divergence
by construction: the diagram can become OUTDATED if the `module_map` changes
later (re-emitting is generating again, without a lock — see ADR 0068), but it never
LIES about what existed at the moment it was generated.

Without a current `module_map`, `create_c4_diagram` is refused with 400 — there is no
Container level without modules to draw, and the error message instructs the
Arquiteto to call `create_module_map` first (RN-061: the refusal comes back
through the tool-result, with the whole reason).

The `artifact.c4_diagram` artifact is versioned in the event log without a table
of its own — the same design as `artifact.project_image` (ADR 0065): the current one is
the one with the highest `version`, and revising is generating again, never overwriting.

- **Where:** `src/domain/architecture/c4-diagram.ts`
  (`gerarDiagramaContexto`/`gerarDiagramaContainer`, pure),
  `src/application/use-cases/architecture/create-c4-diagram.use-case.ts`,
  `src/application/use-cases/architecture/get-c4-diagram.use-case.ts`,
  `apps/engine/lib/engine/harness/tools/create_c4_diagram.ex`,
  `apps/web/src/components/C4DiagramView.tsx` (rendering, three states —
  RN-088), `apps/web/src/lib/mermaid-render.ts` (`mermaid` stays isolated
  here, dynamic `import()`)
- **Test:** `test/domain/architecture/c4-diagram.spec.ts` (valid Mermaid
  syntax from a sample `module_map`, dangling edge
  ignored, deduplicated ids),
  `test/application/use-cases/architecture/create-c4-diagram.use-case.spec.ts`
  (without module_map it refuses with 400 and writes nothing; Container reflects the real
  modules/dependencies; versions on re-emitting),
  `apps/engine/test/engine/harness/tools/create_c4_diagram_test.exs`,
  `apps/web/src/components/C4DiagramView.test.tsx` (success becomes SVG, a syntax
  error becomes a readable Alert without breaking the screen, an empty diagram does not try
  to render)
- **Origin:** user request — the Arquiteto's C4 diagram in the project
  Overview (ADR 0068)

### RN-151 — The project badge in the sidebar is pending approvals, not unread activity {#rn-151}

The number next to each project's name in `Shell.tsx` came from
`useProjectsUnread` — `latestSeq` (the most recent `seq` already written in the session)
minus the "last seen" cursor the browser keeps in
`read-state.ts`. That counts ANY new event — `tool.call`,
`agent.response`, chat — not only a pending decision. A test project
showed "392" in the sidebar (accumulated activity from a real execution) while
the Approvals tab of the SAME project showed "8" (the real count). A
number that does not correspond to anything actionable when clicked is worse than none.

The dashboard read model (`ProjectsSummaryRepository.summarizeForWorkspace`,
RN-090) gained `pendingApprovalsCount`: `COUNT(*)` of `proposed_actions` with
`status = 'pending'`, aggregated by `project_id` in one more query in the
existing `Promise.all` — same format as `storiesAwaitingPromotion`
(RN-048), without growing the number of database round trips per project. The sum is over the
WHOLE project, all sessions — deliberately different from the Approvals tab
(`ProjectApprovalsTab.tsx`), which shows only the pending items of the MOST
RECENT session: the badge is per PROJECT, not per session, and a pending item in an
old session is still a pending item.

`Shell.tsx` stopped importing `useProjectsUnread` — its only consumer
there was this badge. `Dashboard.tsx`/`ProjectCard.tsx` gained the same wiring:
the `unreadCount` prop of `ProjectCard` never had a caller (`ProjectCardContainer`
did not pass it), and became `pendingApprovalsCount` with the same value as the sidebar
— two screens, one number, one source.

- **Where:** `src/application/ports/projects-summary-repository.port.ts`
  (`ProjectCardSummary.pendingApprovalsCount`),
  `src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
  (`summarizeForWorkspace`, aggregate query over `proposed_actions`),
  `apps/web/src/routes/Shell.tsx`, `apps/web/src/routes/Dashboard.tsx`,
  `apps/web/src/components/ProjectCard.tsx`
- **Test:**
  `test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (`pendingApprovalsCount soma o projeto INTEIRO...`, only `pending` counts, does not
  leak between projects, the number of queries stays constant),
  `apps/web/src/routes/Shell.test.tsx` (pending approvals badge)
- **Origin:** user finding while navigating the app — sidebar badge showing
  "392" against a real "8" in the Approvals tab of the same project

---

### RN-153 — "Auto mode": the `ApprovalCard` turns on autonomy for ANY future action of an agent {#rn-153}

> **Revised by [RN-603](#rn-603)** (ADR 0167): `decide()` started receiving
> also the ORIGIN of the autonomy, and auto mode (the wildcard in
> `auto_approve`) no longer goes through the path scope ceiling. What follows
> below about `decide()` "not changing" describes the original design.

Before this RN, `agent_autonomy` only knew how to grant autonomy per
`(projeto, agente, TIPO de ação)` — one row per type, upsert of ONE rule
at a time (`SetAgentAutonomyUseCase`,
`src/application/use-cases/actions/set-agent-autonomy.use-case.ts`).
Trusting an agent broadly required one row per type — `terminal`,
`write_file`, `pr_open`… — and a new type was born without a rule, back to
`require_approval`.

"Auto mode" is the special value `actionType: "*"` in the SAME table and the SAME
endpoint (`PUT /projects/:projectId/agent-autonomy`) — it is not a new mechanism,
it is the existing column (`agent_autonomy.action_type`, free `text`, no enum
nor FK — `src/db/schema/agents.ts`) accepting one more value. The wildcard
means "autonomy for any action type of THIS agent" and is resolved
in `DrizzleAgentAutonomyRepository.findMode`
(`src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts`):
it fetches the SPECIFIC rule and the wildcard in the same query, and the specific one
always wins — writing `terminal: deny` with `"*": auto_approve` already on
keeps denying `terminal` for that agent, and releasing the rest. `decide()`
(`src/domain/actions/decide.ts`) does not change: it receives the
`PermissionPolicy` already resolved in `ctx.autonomyMode`, exactly as before
the wildcard existed — that is why the absolute ceilings hold without needing to
know that "auto mode" exists (see [RN-154](#rn-154)).

The `ApprovalCard` (`apps/web/src/components/ApprovalCard.tsx`) gains the
"Modo automático" button next to "Sempre permitir", visible only when: (a) the
action is `pending`, (b) whoever proposed it is an AGENT (`actor.kind === 'agent'` —
there is no agent autonomy to grant to a user) and (c) the caller
(`ProjectApprovalsTab.tsx`/`SessionPage.tsx`) has already confirmed the
`maintainer`/`owner` role in the workspace — the same requirement as the endpoint
(`@RequireRole('maintainer')`, unchanged). The `onActivateAutoMode` prop is
`undefined` for whoever lacks the role — the card HIDES the button instead of
showing it disabled, and the check lives in the caller, not in the card
(a presentational component, with no query of its own).

**Turning it off** reuses the manual/auto toggle the agent card already had (Fase
8d) — no new screen. `AgentTeamGrid.tsx` starts looking for the agent's wildcard
rule BEFORE the representative one (`autonomyActionTypeFor`): if it
exists, the card's toggle reflects and edits the WILDCARD, no longer the
representative type — turning off is writing the same wildcard as
`require_approval`, and the toggle on the agent card is exactly that
"turn off".

- **Where:** `src/domain/actions/decide.ts`
  (`AGENT_AUTONOMY_ALL_ACTIONS`, `AgentAutonomyActionType`),
  `src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts`
  (`findMode` with precedence specific > wildcard),
  `src/interfaces/http/actions/dto/set-agent-autonomy.dto.ts`
  (accepts `"*"`), `apps/web/src/components/ApprovalCard.tsx` ("Modo
  automático" button), `apps/web/src/components/AgentTeamGrid.tsx` (the toggle
  starts prioritizing the wildcard), `apps/web/src/routes/ProjectApprovalsTab.tsx`
  and `apps/web/src/routes/SessionPage.tsx` (`handleActivateAutoMode`, role
  gate via `useCurrentWorkspaceWithRole`)
- **Test:**
  `test/infrastructure/persistence/drizzle/agent-autonomy.repository.spec.ts`
  (precedence specific > wildcard; the wildcard is per agent; turning off is
  rewriting the wildcard as `require_approval`),
  `test/application/use-cases/actions/propose-action.use-case.spec.ts`
  (auto mode auto-approves a common action WITHOUT hitting `permissions.json`; a specific
  rule in `deny` beats the wildcard),
  `test/interfaces/http/actions/agent-autonomy.controller.spec.ts`
  (`PUT`/`GET` still require `maintainer`; the DTO accepts `"*"` and refuses a
  string outside the list), `apps/web/src/components/ApprovalCard.test.tsx`
  (button disappears without `onActivateAutoMode`; click calls the callback; the note
  explains the ceilings that keep asking for a decision)
- **Origin:** user request — "Sempre permitir" only writes a specific command
  pattern, and `agent_autonomy` only covered one action type at a time;
  what was missing was trusting an agent broadly with a single click

### RN-154 — The three absolute ceilings keep blocking EVEN with "auto mode" on {#rn-154}

> **Revised by [RN-603](#rn-603)** (ADR 0167): the ceilings listed here
> remain in force in auto mode; what stopped holding for it was the
> PATH SCOPE ceiling (ADR 0055), which was never on this list.

The design of "auto mode" ([RN-153](#rn-153)) is deliberately incapable of
piercing the three ceilings that already existed in `decide()` — they are applied
LAST, over `current.policy`, without looking at where the permissiveness came from
(`agent_autonomy` with a specific type, wildcard, or `permissions.json` — the
function never knew how to distinguish the origins, and still does not):

1. **Merge into a protected branch** (`git_merge` with target in
   `dev`/`qa`/`rc`/`main`, [RN-006](#rn-006)) — the merge lock
   (`isProtectedBranch`) downgrades `auto_approve` to `require_approval`
   always, even with `"*": auto_approve` on for the agent.
2. **`instruction_patch`** ([RN-007](#rn-007)) — changing another
   agent's instruction requires the human to see the diff; auto mode does not change that.
3. **`parallelize`/`raise_max_parallel`** ([RN-086](#rn-086)) — raising the
   parallelism ceiling, or asking for more agents above it, remains the user's
   decision; an agent with auto mode on cannot self-grant
   more spending power.

The proof is by CONSTRUCTION, not case by case: since the three ceilings check
only `current.policy === 'auto_approve'` — never the origin —, and "auto mode" can only
reach `current.policy === 'auto_approve'` through the SAME path
that a specific `agent_autonomy` rule already used
(`ctx.autonomyMode`), the ceilings that already contained `agent_autonomy` keep
containing the wildcard without needing new code. The real risk was not the
ceiling — it was someone, when generalizing `agent_autonomy` to accept `"*"`,
inserting the wildcard check BEFORE the ceilings and reopening the door; that is why
`AGENT_AUTONOMY_ALL_ACTIONS` was resolved entirely in the REPOSITORY
(before `decide()` runs), and `decide()` itself gained no new
line — only enough to have no place where the wildcard could pierce.

- **Where:** `src/domain/actions/decide.ts` (the three ceiling blocks,
  lines ~207–258, unchanged by this feature)
- **Test:**
  `test/application/use-cases/actions/propose-action.use-case.spec.ts`
  ("auto mode NÃO auto-aprova merge em branch protegida", "... instruction_patch",
  "... parallelize/raise_max_parallel" — all three with `agent_autonomy` "*"
  written as `auto_approve` and the verdict remaining `require_approval`)
- **Origin:** design constraint confirmed by the user when asking for "auto
  mode" — the three ceilings are the guarantee that cannot regress

### RN-155 — timeline ordering uses the `proposed_action.created` link, never the raw `action.seq` {#rn-155}

The `timeline` of `SessionPage.tsx` orders events and proposed actions by a
single comparable numeric axis. For events, it is `event.seq` (gapless, per
session). For actions, it is the `seq` of the correlated `proposed_action.created` event
(found by `payload.actionId === action.id`, written by
`ProposeActionUseCase` in the SAME transaction that creates the action) — never
`action.seq`, which is a unique and global `bigserial` of the whole
`proposed_actions` table, shared by all sessions and projects of the
system, and therefore incomparable with `event.seq` (a deliberate contrast, see
`src/db/schema/actions.ts`). Comparing the two directly produced an
unpredictable order every time an `ApprovalCard` entered the mix with normal
events. Actions without that link (only the Gitflow bootstrap —
`git_repo_create`/`git_branch_create`, which only write outbox) degrade
to a position interpolated by `createdAt`, anchored on the last previous
event.

- **Where:** `apps/web/src/routes/SessionPage.tsx` (`ordemDaAcaoNaTimeline`)
- **Test:** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **Origin:** finding from PR #286 — approval cards appeared out of order
  in the timeline, mixed with normal events

### RN-169 — The project chooses where the code lives: Local or Container {#rn-169}

**REVISED by [RN-421](#rn-421) (ADR 0104)**: `workspace_mode`/`local`
became an `execution_mode` of THREE values (`container`/`mounted`/`runner`,
migration `0048`) — the rest of this entry is history, faithful to what held until
the revision.

A project is born with a **workspace mode** (`projects.workspace_mode`,
migration `0043`), and it is what decides where the scope root is derived from:

- **`container`** (DEFAULT, and the behavior that always existed): the folder
  MANAGED by the product, `join(PROJECT_WORKSPACES_ROOT, workspace_dir_name)`
  ([RN-109](#rn-109));
- **`local`**: a folder OF THE USER, at the absolute path of
  `projects.workspace_path`.

The pair is tied by a CHECK in the database
(`(workspace_mode = 'local') = (workspace_path IS NOT NULL)`), and not only by the
use case: the column is read by TWO processes (api and engine) and written by
seed/backfill scripts that do not go through it. `local` without a path would be a
terminal scope pointing nowhere; `container` with a path would be
a second source of truth waiting to diverge from the first.

The derivation remains **unique** — `projectScopeRoot` started receiving the
location (`{workspaceDirName, workspaceMode, workspacePath}`) and picks the
branch; none of the four consumers ([RN-092](#rn-092)) gained validation
of its own. The engine resolves the same locator in the QUERY (folder name in
`container`, absolute path in `local`) and distinguishes the two by the leading
slash, which is unambiguous because the folder name is validated against
`^[A-Za-z0-9_-]{1,64}$`.

Two explicit consequences of the `local` mode:

1. **The Arquiteto's image gate ([RN-105](#rn-105)) does NOT apply.**
   **REVOKED by [RN-494](broker.md#rn-494) (ADR 0135)**: the
   exemption ended — the three modes now require the image decision
   before opening the Code tab. The rest of this item is history. A Local
   project does not start a container, so the Code tab unlocked without waiting for a decision
   that was never going to happen. The exemption lived in the same funnel as the gate in the
   api, and the screen agreed: `ProjectCodeTab` did not even ask for the
   container state ([RN-107](web.md#rn-107)) when the project was Local — if
   only the api exempted it, the tab would remain blocked on screen by a
   nonexistent decision.
2. **The `permissions.json` lives in the user's folder**, together with the code —
   because the policy has to be read from the SAME root that the terminal scope
   authorizes.

`workspace_mode` is not to be confused with the `GitProviderName` `'local'`: one says where the
CODE lives on disk, the other where the git REPOSITORY lives, and the two choices
are orthogonal.

- **Where:** `src/db/schema/iam.ts` (`projects`),
  `src/infrastructure/filesystem/project-workspaces-root.ts`
  (`projectScopeRoot`), `src/domain/iam/project.entity.ts`,
  `src/application/use-cases/git/read-project-code.use-case.ts`
  (`portaoDoContainer`), `apps/web/src/routes/ProjectCodeTab.tsx`,
  `apps/engine/lib/engine/projects/project.ex`,
  `apps/engine/lib/engine/actions/workspace.ex` (`workspace_dir/2`),
  `apps/engine/lib/engine/dev/worktree_cleanup.ex` (which was the second
  hand-written derivation, and started using the single one),
  `apps/web/src/routes/NewProjectWizard.tsx`
- **Test:** `test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (describe "projectScopeRoot no modo local"),
  `test/infrastructure/filesystem/fs-permissions-file-store.spec.ts`
  (the permissions.json in the user's folder),
  `test/application/use-cases/iam/create-project-modo-de-workspace.spec.ts`,
  `test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (a Local project does not go through the gate),
  `test/interfaces/http/iam/project-dto-modo-de-workspace.spec.ts`
  (the mode is frozen: PATCH does not change it),
  `apps/web/src/routes/ProjectCodeTab.test.tsx` (the screen also exempts the gate),
  `apps/engine/test/engine/actions/workspace_test.exs`
  (describe "workspace_dir/2 com o localizador já resolvido"),
  `apps/web/src/routes/NewProjectWizard.test.tsx`
- **Architectural decision:** [ADR 0072](../adr/0072-projeto-local-ou-container.md)
- **Origin:** user request (their decision, with the free-path variant
  explicitly chosen)

### RN-170 — A Local path is validated at CREATION, and the refusal teaches {#rn-170}

**REVISED by [RN-422](#rn-422) (ADR 0104)**: creation validation started
to DIVERGE by mode — `mounted` (the renamed `local`) keeps touching the disk
as described here, `runner` validates only the LEXICON, without I/O — the rest of this
entry is history, faithful to what held until the revision.

Creating a project in `local` mode with a path the api cannot reach produces a
project that **hangs later** — on the first tool of the first agent, far
from the screen where the decision was made. That is why creation **refuses with 400**, and the
message says what needs to be done.

The path must be:

1. **absolute**, with no `..` or `.` in any segment (the stored path is the
   path that is read; `/srv/app/../../etc` is `/etc` and does not look like it);
2. **existing and a folder** inside the api container;
3. **writable by the process** (`access(W_OK|X_OK)`) — the images run non-root
   ([ADR 0024](../adr/0024-fase5-imagens-producao-ci.md)), and a host folder with
   another owner arrives mounted as read-only in practice;
4. **outside the root and the system folders** (`/`, `/etc`, `/usr`, `/var`,
   `/data`… and everything below them): the project root is the scope that AUTHORIZES the
   agent's terminal ([ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md)),
   and a project rooted at `/etc` turns "the agent writes in its project"
   into "the agent rewrites the container";
5. **with no overlap with the Brabo checkout, in BOTH directions** — the folder that
   CONTAINS the monorepo and the folder INSIDE it. The second case is the problem that
   ADR 0055 reports actually happening.

The stored path is the **normalized** one, not the raw string: validating one string and
storing another is how validation stops holding the next day. A `workspacePath`
sent together with `workspace_mode: container` is REFUSED, not ignored — a field
silently discarded becomes "but I configured it".

The LEXICAL part (items 1, 4 and 5) runs **also on read**, on each derivation of
`projectScopeRoot`: the only way to bypass creation is to write directly into the
database, and what is gained there is a terminal scope at `/`. The DISK part
(items 2 and 3) runs only at creation, where the user can still fix it.

The refusal for a missing folder brings the mount instruction — the file, the two
services and the line (`- <caminho>:<caminho>`), with the pointer to
[the runbook](../runbook.md). Mounting only in the api produces a project the api accepts and the
engine does not see: it validates what it sees, and has no way of knowing what is
mounted in the other container.

- **Where:** `src/infrastructure/filesystem/project-workspaces-root.ts`
  (`validarCaminhoDeWorkspaceLocal`, `CaminhoLocalInvalidoError`),
  `src/application/use-cases/iam/create-project.use-case.ts`
  (`caminhoValidado`), `src/interfaces/http/iam/dto/create-project.dto.ts`,
  `apps/web/src/lib/wizard.ts` (`caminhoLocalParecePlausivel`)
- **Test:** `test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (describe "validarCaminhoDeWorkspaceLocal"),
  `test/application/use-cases/iam/create-project-modo-de-workspace.spec.ts`
  (describe "a criação RECUSA o caminho que travaria depois"),
  `apps/web/src/lib/wizard.test.ts`, `apps/web/src/routes/NewProjectWizard.test.tsx`
- **Architectural decision:** [ADR 0072](../adr/0072-projeto-local-ou-container.md)
- **Origin:** a guard required by the free-path variant (ADR 0072)

---

### RN-186 — `provider` is a dimension of the owner's report, and only theirs {#rn-186}

`sumGroupedBy` accepts `provider` as a dimension, and
`GET /workspaces/:id/spend-report` returns the `porProvider` list alongside model,
project, actor and day. [ADR 0063](../adr/0063-duas-audiencias-para-o-mesmo-gasto.md)
had left the axis out; [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)
gave it back **without revoking the argument**: breaking spending down by provider
is still breaking it down by CREDENTIAL, and that is why the axis lives in a route
that already requires `owner` ([RN-060](#rn-060)) — the same yardstick as
`credential-spend`, which still answers the BILL question (by month, with the link
to the key that exists today).

`GET /projects/:id/spend/me` **gained nothing**. The asymmetry is the design: the
two answers are still not a cut of each other ([RN-101](#rn-101)).

The `model` dimension **did not change**: two providers serving the same model name
still fall into a single row. Whoever wants the breakdown by credential has the list
of their own, and crossing the two dimensions would multiply the ranking's rows
without answering a question the two separate lists do not already answer.

- **Where:** `src/application/ports/token-usage-repository.port.ts:150`
  (`SpendDimension`),
  `src/infrastructure/persistence/drizzle/token-usage.repository.ts:255`
  (the `GROUP BY`), `src/application/use-cases/llm/get-workspace-spend-report.use-case.ts:112`,
  `src/interfaces/http/llm/spend.controller.ts:56`
- **Test:** `test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  ("quebra por PROVIDER, e o mesmo nome de modelo em dois providers segue UMA
  linha")
- **Origin:** [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-187 — The member's view does not reach `provider`, and the TYPE is what guarantees it {#rn-187}

While the axis did not exist, what contained the member's view was the **absence**
of an argument to pass. With the axis back, the containment became the signature's:
`sumGroupedBy` has **two overloads**, and the one that accepts a scope with
`actor` — the member audience's, and the only one they have — only receives
`SpendDimensionDoAtor`, which is `Exclude<SpendDimension, 'provider'>`.
`sumGroupedBy('provider', escopoComAtor)` **does not compile**.

Neither the repository nor the use case has an `if` over that combination, on
purpose: a runtime check would give the impression that the guarantee is dynamic,
when what upholds it is the compiler — and an `if` is the kind of thing the next
refactoring removes without any test turning red.

The barrier is double and the two halves are independent: the member's route
**also has no dimension parameter** (only `projectId` and `dias`), so an invented
query such as `?dimensao=provider` is discarded by Nest before reaching the handler.

`Exclude` instead of a second hand-written list is deliberate: a new dimension is
born reachable by both audiences, and taking it out of the member's reach becomes an
explicit act **at this point** — never an oversight in another file.

- **Where:** `src/application/ports/token-usage-repository.port.ts:121`
  (the two overloads), `:147` (`SpendDimensionDoAtor`), `:163`/`:173` (the two
  scopes), `src/application/use-cases/llm/get-my-spend.use-case.ts:73`,
  `src/interfaces/http/llm/spend.controller.ts:98`
- **Test:** `test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  ("não compila pedir `provider` com escopo de ator" — a `@ts-expect-error` that
  `tsc` fails as an UNUSED directive if the barrier falls; and "só pede as
  dimensões `session` e `day`"),
  `test/interfaces/spend.controller.spec.ts` (the member's route accepts
  `dias` and nothing else)
- **Origin:** [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-188 — Person and agent are a partition of the list by actor, with no extra query {#rn-188}

The owner's report brings `porOwner` (rows with `actor_kind = 'user'`) and
`porAgente` (`actor_kind = 'agent'`) besides `porAtor`, which remains whole.
The two blocks are **derived** from `porAtor` in the use case — `actorKind` has come
in the row since PHASE 22 —, and not two queries with `where actor_kind`. The reason
is measured: [ADR 0063](../adr/0063-duas-audiencias-para-o-mesmo-gasto.md) showed
that the cost of these queries grows with the size of `token_usage` and not with that
of the request, so sweeping the window two more times to separate what is already
separated in memory would be expensive for the wrong reason.

An `actor_kind` that is neither person nor agent (today, `system`) **enters neither
block** and stays visible in `porAtor` and in the total. Opening a third block for it
would say the product has an audience that it does not have.

The label "By owner" comes from the design handoff and holds through
[RN-058](#rn-058) — it is the owner's key that all these rows spend. Who the
workspace's owner is remains the `ownerId` field, not each row's `actorKind`.

- **Where:** `src/application/use-cases/llm/get-workspace-spend-report.use-case.ts:120`
- **Test:** `test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  ("separa PESSOA de AGENTE em dois blocos, sem perder a lista por ator")
- **Origin:** [ADR 0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

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

- **Where:** `src/application/ports/llm-provider.port.ts:61`,
  `src/infrastructure/llm/embedding-result.ts:26`
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

- **Where:** `src/domain/llm/embedding-capability.ts:64`,
  `src/infrastructure/llm/ollama-provider.ts:319`
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

- **Where:** `src/infrastructure/llm/ollama-provider.ts:73`,
  `src/infrastructure/llm/openai-compatible-provider.ts:325`
- **Test:** `test/contract/llm-provider.contract.ts`,
  `test/infrastructure/llm/openai-compatible-provider.contract.spec.ts`,
  `test/infrastructure/llm/ollama-provider.embeddings.smoke.spec.ts`
  (manual, against the real daemon)
- **Origin:** [ADR 0075](../adr/0075-embeddings-no-contrato-de-llm-provider.md)

### RN-198 — Activities groups by REAL base agent/instance, never by an invented counter {#rn-198}

The sidebar's Activities section is the same grouping logic as
`AgentTimelineTree.tsx`/`timeline-tree.ts` (already used in the project's
Overview), moved to a new place — not rewritten. `montarArvore` already
groups by `evento.actor.id`; the novelty is `agruparPorInstancia`
(`apps/web/src/lib/timeline-tree.ts`), which decides which branches form a
two-level visual group.

The "instance" is not a renumbered counter (`-01`/`-02`) — it is the REAL
`agent_id` the product already writes: `devAgentId`/`extraDevAgentId`
(`src/application/use-cases/execution/activate-execution.use-case.ts:27-38`)
produce `dev-<modulo>` and `dev-<modulo>-2` (suffix always exactly `-2`,
because the ceiling is TWO per module, [RN-154](#rn-154)). A branch only becomes an
"extra instance" of another if the base agent (without the suffix) ALSO has a
branch in the same list — otherwise it is the agent itself. An agent with one instance
opens directly on the events; with two, it reveals a second level, one row per
instance, each with its own count — reusing
`getAgentLastSeenSeq`/`setAgentLastSeenSeq` (`read-state.ts`) which already existed
for the tree's novelty counter.

Scope: only the project of the CURRENT ROUTE (`pathname`), not all projects of the
workspace — aggregating all would require an events query PER project, the
same class of N+1 that RN-090/091 closed in the dashboard. It reuses the SAME pair
of hooks that `AgentTimelineTree`/`SessionPage` already use
(`useActiveExecutionSession` + `useSessionEvents`, same `queryKey`) — zero
new requests when the two screens are mounted together.

What opens/closes is persisted in `brabo.sidebar.agents`, with the handoff's
format adapted to the real ids: `agenteBase` (open group, e.g.:
`dev-backend`) or `${agenteBase}/${instancia}` (a specific instance
open, e.g.: `dev-backend/dev-backend-2`).

- **Where:** `apps/web/src/lib/timeline-tree.ts` (`agruparPorInstancia`,
  `GrupoDeAgente`), `apps/web/src/routes/Shell.tsx:237-311`
  (`GrupoDeAtividade`, `InstanciaDeAgente`), `apps/web/src/routes/Shell.tsx:376-399`
  (scope and persistence)
- **Test:** `apps/web/src/lib/timeline-tree.test.ts` (describe
  "agruparPorInstancia"), `apps/web/src/lib/sidebar-state.test.ts`
- **Origin:** PROGRAMA 28, Onda 1/frente B0 (finding, no code) and Onda
  2/frente B (implementation)

### RN-213 — The cost alert is a read of `lastThresholdNotified`, never a recomputation {#rn-213}

`alertaDeOrcamento` does not reimplement `crossedThresholds`
(`src/domain/llm/budget-threshold.ts`): it reads the field the backend
already writes at the moment a real call crosses 70/90/100%, and only decides
the color (`warning` below 90, `danger` from 90 on) and whether the text should
warn of an active block (`policy === 'block' && spentMicros >=
limitMicros`). No new business rule — purely presentation of
data that already exists.

- **Where:** `apps/web/src/lib/spend.ts` (`alertaDeOrcamento`)
- **Test:** `apps/web/src/lib/spend.test.ts` (describe "alertaDeOrcamento
  (RN-213)"); `apps/web/src/routes/ProjectSpendTab.test.tsx` (describe "o
  orçamento do projeto")

### RN-219 — The three scopes of the chunk index are honest, and mutually exclusive by CHECK {#rn-219}

The Chat RAG index covers only three text sources whose origin the product already
knows: `docs`, `adr` and `session`. Source code and Pull Requests are left
out on purpose — indexing them without a reindexing watcher on every
`push` would make the index lie about coverage, the same class of error that
ADR 0042 already refuses for model capability. `session_id`/`source_path`
are mutually exclusive by CHECK, not by application convention, the same
pattern as `projects.workspace_mode`/`workspace_path` (ADR 0072): `scope =
'session'` requires `session_id` and refuses `source_path`; `docs`/`adr` require
`source_path` and refuse `session_id`. The lock stays in the database because whoever will
write this table is a pipeline (Onda 4) that does not necessarily go through
the same use case every time.

- **Where:** `src/db/schema/rag.ts` (`chunkScopeEnum` and the two CHECKs
  of the `chunks` table)
- **Test:** `test/infrastructure/persistence/chunk.repository.spec.ts`
  ("recusa chunk de docs sem source_path — o CHECK da migração 0045, não
  validação de aplicação")
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-220 — Vector and lexical search live on the same row, never in separate tables {#rn-220}

`chunks.embedding` (pgvector) and `chunks.search_vector` (tsvector) are
sibling columns of the SAME table, not two tables linked by `chunk_id`.
Separating them would require a JOIN on every hybrid search (Onda 4) and would open room
for the two to diverge — a passage with a vector but no lexical entry, or
vice versa — with no database mechanism preventing it. One row, one source
of truth for both halves of the search.

- **Where:** `src/db/schema/rag.ts` (`chunks` table)
- **Test:** `test/infrastructure/persistence/chunk.repository.spec.ts`
  (the three specs write and read both columns on the same row)
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-221 — `search_vector` is never written by the application — it is a GENERATED column {#rn-221}

`search_vector` is `GENERATED ALWAYS AS (to_tsvector('portuguese', content))
STORED`. No use case, repository or script writes to it —
Postgres keeps it consistent with `content` by construction, ready in the same
transaction as the `INSERT`, without depending on any LLM provider answering
(unlike `embedding`, which only arrives when an indexing pipeline
exists).

- **Where:** `src/db/schema/rag.ts` (`search_vector` column)
- **Test:** `test/infrastructure/persistence/chunk.repository.spec.ts`
  ("grava um chunk de docs com vetor e devolve o search_vector gerado pela
  GENERATED ALWAYS AS")
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-222 — The vector dimension is documented, not guessed, and `embedding` arrives after the chunk {#rn-222}

`chunks.embedding` is `vector(768)` — the real dimension of Ollama's
`nomic-embed-text`, the only provider that today declares `capabilities.embeddings:
true` (RN-191, ADR 0075). A vector index has a FIXED dimension: changing the
embedding model in the future is a new migration, never a runtime parameter.
The column is NULLABLE: this table stores the CHUNK (cut text), and the
VECTOR may arrive later via an asynchronous indexing pipeline that does not
exist yet (Onda 4) — without that, chunking would have to wait for embedding,
mixing two failures of different nature (document parsing versus a
network call to a provider) in a single atomic write.

- **Where:** `src/db/schema/rag.ts` (`embedding` column)
- **Test:** `test/infrastructure/persistence/chunk.repository.spec.ts`
  ("grava um chunk de docs com vetor..." writes with `embedding` filled;
  the other two specs write without it, confirming nullability)
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md); [RN-191](#rn-191)

### RN-223 — The vector index is HNSW, not IVFFlat, because the table is born empty {#rn-223}

IVFFlat needs rows already loaded to train the lists (`lists`) and
performs poorly if built over an empty table — which is exactly the state
of this table at birth, with no indexing pipeline yet (Onda 4). HNSW
builds the graph incrementally, insertion by insertion, with no training
step — good from the first row. `vector_cosine_ops` because it is the
metric text embeddings generally expect (the similarity
ranking should not change with the vector's magnitude).

- **Where:** `src/db/migrations/0045_shallow_randall.sql`
  (`chunks_embedding_idx`)
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-225 — A migration that may require operator privilege is born in `breaking/` {#rn-225}

Creating an extension requires the application role to have `CREATEDB` (or the
extension to be marked "trusted" by the DBA). Locally the role is a
superuser, but nothing guarantees that in production — managed Postgres
providers often do not give superuser to the application. If
the migration fails there, it is an OPERATOR action before the deploy (running `CREATE
EXTENSION vector;` once, as superuser), not a product bug — the
CLAUDE.md criterion for being born in `breaking/` instead of
`feature/`/`bugfix/`.

- **Where:** branch `breaking/tabela-de-chunks`,
  `src/db/migrations/0045_shallow_randall.sql` (a comment that
  documents the decision inside the migration itself)
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-226 — `ChunkRepository` covers only basic write/read; `createMany` is a batch operation {#rn-226}

The port only has `create`, `createMany`, `findById` and `listByProject` — hybrid
search (vector + lexical, weights, threshold) belongs to Onda 4 (G2) and deliberately
does NOT come in here: the port stores data, the use case decides what to do with
it. `createMany` exists because an indexing cuts N passages of a
document/session at once, avoiding N round trips per indexed
document.

- **Where:** `src/application/ports/chunk-repository.port.ts`,
  `src/infrastructure/persistence/drizzle/chunk.repository.ts`
- **Test:** `test/infrastructure/persistence/chunk.repository.spec.ts`
  ("createMany grava um lote e listByProject filtra por escopo, sem
  misturar docs e session")
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

## PROGRAM 28 — Wave 4, front G2: indexing pipeline and hybrid search of the RAG Chat (RN-231..238, ADR 0080) {#programa-28-onda-4-frente-g2-pipeline-de-indexacao-e-busca-hibrida-do-chat-rag-rn-231-238-adr-0080}

The first-party auth RNs live in
**[Business rules — Authentication](autenticacao.md)**.

They left here for SIZE, not for subject: together with Cost they were half of a
640 KB page. The content did not change, and the `#rn-NNN` anchors are the
same — what changed was the file that hosts them.

## Authentication {#autenticacao}

### RN-231 — `ChunkRepository` gains DELETE and both halves of hybrid search {#rn-231}

The Wave 3 port (RN-226) only covered basic write/read. Wave 4
added `deleteByScope`/`deleteBySession` (for idempotent reindexing
by full rebuild — delete and recreate, never UPDATE) and
`searchByVector`/`searchByLexicalQuery` (the two halves of hybrid search,
each an independent query, taking advantage of the index built for it —
HNSW or GIN). `deleteByScope` is typed `Exclude<ChunkScope, 'session'>`:
deleting `session` for a whole project would delete sessions that aren't being
reindexed now, so a session is only deleted by `deleteBySession`.

- **Where:** `src/application/ports/chunk-repository.port.ts`
  (lines 105-146), `src/infrastructure/persistence/drizzle/chunk.repository.ts`
- **Test:** `test/infrastructure/persistence/chunk.repository.spec.ts`
  — describes "Onda 4 (G2)" (delete by scope/session, search by
  vector/lexical, happy and empty case of each)
- **ADR:** [0080](../adr/0080-busca-hibrida-pesos-limiar-e-citacao.md)

### RN-232 — Source of the indexed text: `docs`/`adr` from the project's OWN repository, `session` only from `chat.message`/`agent.response` {#rn-232}

`docs`/`adr` are indexed via `ReadProjectCodeUseCase` — the same surface
as the Code tab, with the same owner credential, the same container gate
(RN-105), and the same path check (RN-095) — never Brabo's documentation
as a product. `session` indexes only two event types
(`chat.message`, `agent.response`); the rest of the event log (`tool.call`,
`agent.status`, `agent.error`...) is mechanism/failure, not citable
knowledge.

- **Where:** `src/application/use-cases/rag/index-project-docs.use-case.ts`
  (lines 16-17, 64), `src/application/use-cases/rag/index-session.use-case.ts`
  (line 29, 45)
- **Test:** `test/application/use-cases/rag/index-project-docs.use-case.spec.ts`,
  `test/application/use-cases/rag/index-session.use-case.spec.ts`
  (happy cases + "project without docs/" + "event without payload.text is
  ignored")
- **ADR:** [0080](../adr/0080-busca-hibrida-pesos-limiar-e-citacao.md)

### RN-233 — Embedding provider unavailable: saves without a vector and declares the gap, never pretends complete indexing {#rn-233}

When `ollama`/`nomic-embed-text` doesn't respond, `RagEmbeddingService.embedMany`
doesn't throw — it returns `available: false` and `null` per requested entry. The
pipeline saves the chunks anyway (`embedding: null`; `search_vector` is
`GENERATED ALWAYS AS` and doesn't depend on any provider), and the indexing
report declares the gap (`embedding: { available, embedded, skipped,
reason }`). The same degradation applies to search: `HybridSearchUseCase` runs with only
the lexical signal and `vectorAvailable: false` warns.

- **Where:** `src/application/use-cases/rag/rag-embedding.service.ts`
  (lines 53-58)
- **Test:** `test/application/use-cases/rag/rag-embedding.service.spec.ts`
  — "CASO DE FALHA: provider sem a capability..." and "CASO DE FALHA: provider
  que lança no meio do lote..."; `index-project-docs.use-case.spec.ts`/
  `index-session.use-case.spec.ts` — "CASO DE FALHA: provider de embedding
  indisponível grava os chunks SEM vetor..."; `hybrid-search.use-case.spec.ts`
  — "quando o embedding está indisponível, degrada para busca só léxica"
- **ADR:** [0080](../adr/0080-busca-hibrida-pesos-limiar-e-citacao.md)

### RN-234 — Hybrid search: two independent queries, weighted fusion (0.6/0.4), threshold 0.2, and the citation contract {#rn-234}

`searchByVector`/`searchByLexicalQuery` are SEPARATE queries (never a
JOIN), fused in `HybridSearchUseCase` by weighted sum
(`RAG_SEARCH_WEIGHT_VECTOR = 0.6`, `RAG_SEARCH_WEIGHT_LEXICAL = 0.4` — the
scales of cosine and normalized `ts_rank` aren't comparable by
nature) and cut at `RAG_SEARCH_SCORE_THRESHOLD = 0.2`. None of the
four numbers comes from calibration with real data — they're a documented
starting point. The citation (`HybridSearchHit`) exposes
`chunkId`/`content`/separate scores (`null`, not zero, when the signal didn't
find the chunk)/`origin` as a union discriminated by `kind` (`file` with
`sourcePath`/`headingPath`, `session` with `sessionId`/`eventId`).

- **Where:** `src/application/use-cases/rag/hybrid-search.use-case.ts`
  (lines 44-113), `src/domain/rag/rag-search-limits.ts`
  (lines 60-93), `src/domain/rag/rag-citation.ts` (lines 12-71)
- **Test:** `test/application/use-cases/rag/hybrid-search.use-case.spec.ts`
  (fusion/ordering/threshold, out-of-range query, lexical-only degradation,
  session origin) and `test/infrastructure/persistence/chunk.repository.spec.ts`
  (the actual SQL queries, against real pgvector/tsvector)
- **ADR:** [0080](../adr/0080-busca-hibrida-pesos-limiar-e-citacao.md)

### RN-235 — Chunking: 1200 characters, 150 of overlap, by paragraph/heading {#rn-235}

`CHUNK_TARGET_CHARS = 1200` (~300 tokens in Portuguese),
`CHUNK_OVERLAP_CHARS = 150` (12.5%), with the cut preferring a paragraph
break, then a word break, within a 200-character window.
Markdown (`docs`/`adr`) is split by HEADING before being cut by
size, preserving `headingPath`. Numbers documented as an adjustable starting
point, not calibrated against real retrieval-quality data
(there isn't, yet, a body of real questions run against
this index).

- **Where:** `src/domain/rag/chunking.ts` (lines 30-31, 53
  onward)
- **Test:** `test/domain/rag/chunking.spec.ts` (text that
  fits/doesn't fit, empty text, real overlap, pathological text with no
  space, nested headings, markdown without heading)
- **ADR:** [0080](../adr/0080-busca-hibrida-pesos-limiar-e-citacao.md)

### RN-236 — Reindexing is always MANUAL, an idempotent full rebuild {#rn-236}

There's no watcher on push nor on session close. `ReindexProjectUseCase`
runs `docs`/`adr` once and one `IndexSessionUseCase` per project session,
each indexing deleting the scope/session before recreating — running twice
in a row doesn't duplicate. Triggered by `POST /projects/:projectId/rag/reindex`,
`role:maintainer`.

- **Where:** `src/application/use-cases/rag/reindex-project.use-case.ts`
  (line 36)
- **Test:** `test/application/use-cases/rag/reindex-project.use-case.spec.ts`
  (aggregates docs+sessions, embeddingAvailable false when any run
  fails, nonexistent project)
- **ADR:** [0080](../adr/0080-busca-hibrida-pesos-limiar-e-citacao.md)

### RN-237 — Index coverage is a REAL count, never an invented "N minutes ago" {#rn-237}

`GetRagCoverageUseCase` counts real `.md` files in the project's
repository against how many have a chunk, and the project's sessions against how many have a
chunk. There's no per-scope indexing timestamp column, and the
response includes no "reindexed Xmin ago" — a guessed number
would lie (same ruler as ADR 0042 for a model's grade).

- **Where:** `src/application/use-cases/rag/get-rag-coverage.use-case.ts`
  (line 47)
- **Test:** `test/application/use-cases/rag/get-rag-coverage.use-case.spec.ts`
- **ADR:** [0080](../adr/0080-busca-hibrida-pesos-limiar-e-citacao.md)

### RN-238 — The three RAG HTTP routes split role by who CHANGES what the product spends {#rn-238}

`POST .../rag/search` and `GET .../rag/coverage` are `role:viewer` (pure
read); `POST .../rag/reindex` is `role:maintainer`, because it triggers N
calls to the project's repository and to the embedding provider — the same
"changes what the product spends without asking" ruler as the area
parallelism ceiling (RN-083).

- **Where:** `src/interfaces/http/rag/rag.controller.ts` (lines
  50, 57, 81, 98), `docs/security-surface.md`
- **Test:** `test/interfaces/route-surface.spec.ts`
  (role classification, closed tags, OpenAPI metadata of the three
  routes)
- **ADR:** [0080](../adr/0080-busca-hibrida-pesos-limiar-e-citacao.md)

## PROGRAM 28 — Wave 4, front E2: row virtualization and minimap in the Code tab (RN-239..242) {#programa-28-onda-4-frente-e2-virtualizacao-de-linha-e-minimapa-na-aba-code-rn-239-242}

### RN-243 — The container lifecycle is a TABLE, and none of its rows calls Docker {#rn-243}

`project_containers` (migration `0046`) records the mutable STATE of a project's
container — distinct from `artifact.project_image` in the event log (ADR
0065), which is the Arquiteto's immutable DECISION. Neither
`RegistrarTransicaoDeContainerUseCase` nor
`ObterCicloDeVidaDoContainerUseCase` calls a Docker daemon: no product
service mounts `/var/run/docker.sock` nor runs `privileged`
today, and granting that is a security decision outside the scope of this rule.
A real orchestrator, when it exists, CONSUMES this table after really
acting — never the other way around.

- **Where:** `src/domain/containers/container-lifecycle.ts`,
  `src/application/use-cases/containers/registrar-transicao-de-container.use-case.ts`
- **Test:** `test/application/use-cases/containers/ciclo-de-vida-do-container.use-case.spec.ts`
- **ADR:** [0081](../adr/0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)

### RN-244 — The container state machine: only `removed` exits by reprovisioning {#rn-244}

`provisioning → running ⇄ stopped`, with `failed` reachable from
`provisioning`/`running`/`stopped`, and `removed → provisioning` as the
ONLY exit from `removed` — no state is truly terminal, because a
project can reprovision with an image revised by the Arquiteto.
A transition outside the table throws `InvalidContainerTransitionError`, which the
use case translates to 409 — same format as `session-state-machine.ts`
and `pr-gate-state-machine.ts`.

- **Where:** `src/domain/containers/container-lifecycle.ts`
  (`ALLOWED_TRANSITIONS`)
- **Test:** `test/domain/containers/container-lifecycle.spec.ts`
- **ADR:** [0081](../adr/0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)

### RN-245 — The first transition requires the image already decided, and FREEZES version and resources {#rn-245}

There's no row until the first call with `to: 'provisioning'`, and it's only
accepted if the Arquiteto has already decided the project's image (RN-105) —
the same gate that already protects the Code tab, applied at the source instead of
duplicated. The version of `artifact.project_image` and the resources declared
at that instant are FROZEN in the new row (`image_version`, `cpus`,
`memory_mb`, `pids_limit`): a later revision of the artifact doesn't
retroactively change what an already provisioned instance promises.

- **Where:** `src/application/use-cases/containers/registrar-transicao-de-container.use-case.ts`
- **Test:** `test/application/use-cases/containers/ciclo-de-vida-do-container.use-case.spec.ts`
  — "a primeira transição (provisioning) cria a linha…" and "sem decisão de
  imagem do Arquiteto, não há o que provisionar"
- **ADR:** [0081](../adr/0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)

### RN-246 — A project in `local` mode has no container lifecycle {#rn-246}

A project with `workspace_mode: 'local'` (ADR 0072, RN-169) runs in the
usual AGENT container — it doesn't bring up its own container. Requesting
any transition for a `local` project is refused with 400 BEFORE
touching the table, at the source, not filtered later in the UI.

- **Where:** `src/application/use-cases/containers/registrar-transicao-de-container.use-case.ts`
- **Test:** `test/application/use-cases/containers/ciclo-de-vida-do-container.use-case.spec.ts`
  — "projeto em modo `local` não tem ciclo de vida de container (ADR 0072)"
- **ADR:** [0081](../adr/0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)

### RN-247 — One row per project: `project_id` is unique {#rn-247}

There's only ONE current container per project at a time — the same design
as `dev_agent_states` in the engine (ADR 0045). The unique constraint lives in the
DATABASE (`project_containers_project_id_unique`), not only in the use case:
`create` called twice for the same project fails on write, never
producing a silent second row.

- **Where:** `src/db/migrations/0046_chilly_forgotten_one.sql`
- **Test:** `test/infrastructure/persistence/drizzle/container.repository.spec.ts`
  — "só uma linha por projeto — create duplicado viola a constraint única"
- **ADR:** [0081](../adr/0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)

### RN-248 — Resource ceiling DECLARED, not enforced — the field exists for when there is an orchestrator {#rn-248}

`cpus`/`memory_mb`/`pids_limit` record what the Arquiteto's artifact
promised at provisioning time, but no process today makes the
kernel respect that ceiling — there's no orchestrator calling `docker run
--cpus … --memory … --pids-limit …`. The field is born anyway because
postponing the column until the orchestrator exists would force a corrective
migration on the day it arrived; declaring without enforcing is honest
as long as the table doesn't lie about ENFORCING (no screen or API
response today asserts "the container is limited to X" — only "the recorded
intent was X").

- **Where:** `src/db/schema/containers.ts` (`projectContainers`)
- **Test:** `test/infrastructure/persistence/drizzle/container.repository.spec.ts`
  — "create nasce em `provisioning`, com a versão e os recursos passados"
- **ADR:** [0081](../adr/0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)

## PROGRAMA 28 — Onda 5, frente G3: a tela do Chat RAG (RN-252..254, ADR 0082)

### RN-267 — `GET /projects/:projectId/container/lifecycle` is the first HTTP exposure of the container lifecycle {#rn-267}

ADR 0081 created `ObterCicloDeVidaDoContainerUseCase` without a route, on purpose
("exposing one would be guessing a contract" before a real consumer existed).
Wave 5/F2 is that consumer (RN-268), and the route is born as a faithful mirror of the
use case: `null` when the project has never been provisioned — the result
expected today, because no real orchestrator transitions
`project_containers` in production (`RegistrarTransicaoDeContainerUseCase` has
no caller at all outside tests) — or the recorded state
(`status`/`imageVersion`/`resources`/`failureReason`/`statusChangedAt`), NEVER
confirmed against a Docker daemon, because there's no Docker client in the
product (RN-243). Same permission as the sibling route (`GET
/projects/:projectId/container`): `viewer`, GET, no `@Post` — whoever
would transition the lifecycle is an orchestrator that doesn't exist yet.

- **Where:** `src/interfaces/http/containers/containers.controller.ts`
  (`cicloDeVida`), `src/interfaces/http/containers/dto/containers.response.dto.ts`
  (`CicloDeVidaDoContainerResponseDto`)
- **Test:** `test/interfaces/http/containers/containers.controller.spec.ts`
- **Edge case:** `id`/`projectId`/`containerId` of the internal row do NOT leak into the
  response — the HTTP contract isn't the same shape as the database row.
- **ADR:** [0083](../adr/0083-terminal-mostra-estado-real-do-container.md)
  (revises [0081](../adr/0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md))

### RN-272 — The social login callback decides in ORDER: known identity, then link by e-mail, then new account {#rn-272}

`SocialLoginCallbackUseCase` resolves the provider's identity in three
steps, in this order, and never out of it: `(provider, providerUserId)`
already linked → direct login; no link but the e-mail matches an existing
account → decides by [RN-274](#rn-274)/[RN-275](#rn-275); neither of the
two → provisions a new account ([RN-278](#rn-278)). The lookup key of the
first step is always `providerUserId`, never e-mail — it prevents changing
the e-mail at the provider from "losing" the link.

- **Where:** `src/application/use-cases/auth/social-login-callback.use-case.ts`
- **Test:** `test/application/use-cases/auth/social-login-callback.use-case.spec.ts`
  — the seven cases of `SocialLoginCallbackUseCase`
- **ADR:** [0084](../adr/0084-login-social-github-e-gitlab.md)

### RN-273 — The social login `state` has its OWN purpose, even though signed with the same key as the git connection flow {#rn-273}

`domain/auth/social-oauth-state.ts` signs with `GIT_OAUTH_STATE_SECRET` —
the SAME HMAC key as the `state` of "connect git to project X"
(`domain/git/oauth-state.ts`) — but the payload carries
`purpose: 'social_login'`, checked BEFORE any other field. A
`state` from the git connection flow, even with a valid signature, is
refused here: without the discriminator, accepting it would amount to logging in as the
`userId` of whoever started that connection — privilege escalation.

- **Where:** `src/domain/auth/social-oauth-state.ts`
- **Test:** `test/domain/auth/social-oauth-state.spec.ts`
  — "RN-273: rejeita um state do fluxo de CONEXÃO de git, mesma chave"
- **ADR:** [0084](../adr/0084-login-social-github-e-gitlab.md)

### RN-274 — Linking a social identity to an existing account requires an e-mail VERIFIED by the provider {#rn-274}

When the e-mail returned by the provider matches an already registered account,
the link only happens if the provider marks that e-mail as verified
(`emailVerified: true`) — GitHub via `GET /user/emails`, GitLab via
`confirmed_at`. A typed but unverified e-mail is not proof of
identity: anyone can register someone else's e-mail at an OAuth
provider. Accepting the link without that check would open account takeover —
whoever already has `alguem@empresa.com` on Brabo didn't ask for someone else's
GitHub, with that address only TYPED, to inherit the account. The refusal is
`403`, and no link is saved.

- **Where:** `src/application/use-cases/auth/social-login-callback.use-case.ts`
  (`vincularAContaExistente`)
- **Test:** `test/application/use-cases/auth/social-login-callback.use-case.spec.ts`
  — "RECUSA vincular quando o e-mail bate mas NÃO está verificado pelo provider"
- **ADR:** [0084](../adr/0084-login-social-github-e-gitlab.md)

### RN-275 — Provisioning a NEW account doesn't require a verified e-mail — only linking to an existing one does {#rn-275}

RN-274's e-mail verification protects an account that already exists; when
there's no matching account, there's nothing to protect, only a new account to
be born. Requiring a verified e-mail in that case would make the common path
more expensive (most GitHub users have a verified e-mail, but not all, and
refusing the login for that would be friction with no corresponding security
gain) without reducing any risk — the worst case is a new account
with an unproven e-mail, the same risk that password registration already
implicitly accepts until the click on the verification link.

- **Where:** `src/application/use-cases/auth/social-login-callback.use-case.ts`
  (`provisionarContaNova`)
- **Test:** `test/application/use-cases/auth/social-login-callback.use-case.spec.ts`
  — "provisiona conta nova mesmo com e-mail NÃO verificado"
- **ADR:** [0084](../adr/0084-login-social-github-e-gitlab.md)

### RN-276 — `providerUserId`, never e-mail or login, is the social identity key {#rn-276}

`social_identities` has a unique index on `(provider, provider_user_id)` —
the provider's stable NUMERIC id. E-mail and login (username) can
change owner or value at the provider without notice; using them as a key
would make an e-mail change on GitHub "lose" the link of whoever already had
an account, or worse, silently inherit the link of another person who
reused that address later.

- **Where:** `src/db/migrations/0047_complete_hannibal_king.sql`,
  `src/application/ports/social-identity-repository.port.ts`
- **Test:** `test/application/use-cases/auth/social-login-callback.use-case.spec.ts`
  — "identidade já conhecida: login direto, sem criar segunda linha"
- **ADR:** [0084](../adr/0084-login-social-github-e-gitlab.md)

### RN-277 — Social login asks for MINIMAL scope, never the repository connection one {#rn-277}

`buildLoginAuthorizeUrl` asks for `read:user user:email` (GitHub) and
`read_user` (GitLab) — never the `repo`/`api` that the git CONNECTION flow
asks for. Entering the account shouldn't grant access to any repository;
the two flows reuse the SAME OAuth app (RN-281) but ask for different
authorizations, decided at authorization time, not in the app's configuration.

- **Where:** `src/infrastructure/git/github-oauth-client.ts`,
  `src/infrastructure/git/gitlab-oauth-client.ts`
  (`buildLoginAuthorizeUrl`)
- **Test:** `test/application/use-cases/auth/social-login-callback.use-case.spec.ts`
  — "StartSocialLoginUseCase › caminho feliz"
- **ADR:** [0084](../adr/0084-login-social-github-e-gitlab.md)

### RN-278 — An account provisioned by social login is born WITHOUT a password — the same "pending" state as the Keycloak migration {#rn-278}

Provisioning by social login writes one row in `users` and NONE in
`auth_credentials` — the same pair the Keycloak migration already left
for "account without a password yet" (see RN-032 and `migracao-keycloak.spec.ts`).
`LoginUseCase` and `ResetPasswordUseCase` already handle that state; no
second "pending password" mechanism was needed for social login.

- **Where:** `src/application/ports/auth-credential-repository.port.ts`
  (`criarUsuarioSemCredencial`),
  `src/infrastructure/persistence/drizzle/auth-credential.repository.ts`
- **Test:** `test/application/use-cases/auth/social-login-callback.use-case.spec.ts`
  — "caminho feliz: provisiona um usuário NOVO, sem senha (RN-278)"
- **ADR:** [0084](../adr/0084-login-social-github-e-gitlab.md)

### RN-279 — Linking by verified e-mail also verifies the existing account's e-mail {#rn-279}

When an account registered by password (and never verified) is linked to
a social identity whose e-mail the provider marks as verified, the
account gets `emailVerifiedAt` filled in as a side effect. The
provider has just proven, through an independent path, exactly what
clicking the verification link would prove — it makes no sense for the account
to remain blocked from password login (RN-032) after proving possession
of the e-mail through another equally strong path.

- **Where:** `src/application/use-cases/auth/social-login-callback.use-case.ts`
  (`vincularAContaExistente`)
- **Test:** `test/application/use-cases/auth/social-login-callback.use-case.spec.ts`
  — "vincula a conta existente (…) e marca o e-mail dela como verificado (RN-274/279)"
- **ADR:** [0084](../adr/0084-login-social-github-e-gitlab.md)

### RN-280 — Social login refuses a DISABLED account, same ruler as password login {#rn-280}

A social identity linked to an account with `auth_credentials.disabled_at`
filled in is refused with `403`, both on direct login (already known
identity) and on the attempt to link. Disabling an account can't
be bypassed by switching the sign-in method.

- **Where:** `src/application/use-cases/auth/social-login-callback.use-case.ts`
  (`entrarComIdentidadeConhecida`, `vincularAContaExistente`)
- **Test:** `test/application/use-cases/auth/social-login-callback.use-case.spec.ts`
  — "recusa login de identidade vinculada a conta DESABILITADA"
- **ADR:** [0084](../adr/0084-login-social-github-e-gitlab.md)

### RN-281 — Social login reuses the SAME OAuth app as the git connection — no new environment variable {#rn-281}

`GITHUB_OAUTH_CLIENT_ID`/`_SECRET` and `GITLAB_OAUTH_CLIENT_ID`/`_SECRET`
remain the only registered client id/secret. What changes per
flow is the `redirect_uri` (`/auth/oauth/<provider>/callback` versus
`/git/oauth/<provider>/callback`) and the `scope` (RN-277) — both
decided at request time. OPERATOR action is still needed
(registering the second callback URL in each provider's app), documented
in `.env.example` — it's that requirement, not a new env var, that justifies
the branch being born `breaking/`.

- **Where:** `.env.example`,
  `src/application/use-cases/auth/start-social-login.use-case.ts`
- **Test:** manual (registration in the OAuth app) — there's no way to
  automatically test a configuration external to the product
- **ADR:** [0084](../adr/0084-login-social-github-e-gitlab.md)

### RN-282 — The social login access token never travels in the URL nor in the callback body {#rn-282}

`GET /auth/oauth/:provider/callback` writes the session cookies
(`definirCookiesDeSessao`, the SAME function as password login) and
redirects to `WEB_ORIGIN/`. The web boot (`restaurarSessao()`,
called on every page load) exchanges the freshly written refresh for an
access token — no new client-side code besides the buttons and the
error route alias.

- **Where:** `src/interfaces/http/auth/auth.controller.ts`
  (`oauthCallback`)
- **Test:** `test/interfaces/route-surface.spec.ts` — covers the
  public classification and the route's OpenAPI metadata; the complete
  cookie→boot flow is E2E, outside the scope of unit testing
- **ADR:** [0084](../adr/0084-login-social-github-e-gitlab.md)

### RN-283 — A social login callback failure doesn't leak the reason in the URL {#rn-283}

Any failure (invalid `state`, code rejected by the provider, disabled
account, unverified e-mail) redirects to
`WEB_ORIGIN/login?oauth_error=1` — a single generic signal, never the
real reason. Same pattern as the git connection callback
(`WEB_ORIGIN/git-error`).

- **Where:** `src/interfaces/http/auth/auth.controller.ts`
  (`oauthCallback`, `catch` block)
- **Test:** `test/application/use-cases/auth/social-login-callback.use-case.spec.ts`
  — covers the failure outcomes the controller maps to the same
  generic redirect
- **ADR:** [0084](../adr/0084-login-social-github-e-gitlab.md)

---

## Analytics and delivery-metricas: the two roles become a REPORT (RN-320..322, ADR 0089) {#analytics-e-delivery-metricas-os-dois-papeis-viram-relatorio-rn-320-322-adr-0089}

A conscious decision of the product owner to BRING FORWARD the construction of
the `analytics` and `delivery-metricas` roles (`packages/contracts/fluxo.yml`,
`status: proposto`) without waiting for the organic trigger each one already
declared. The two become a single SCRIPT — `scripts/analise-funil.ts` — in the
same format as `medir-execucao.ts` (Phase 13b): `NestFactory.createApplicationContext`,
mandatory `--projeto <uuid>`, pure read via Drizzle, no write at all. The shape
is the one the flow itself already prescribed: `analytics` is "absorbed by
`medicao`" and `delivery-metricas` "never becomes an agent" — no GenServer, no
LLM agent.

### RN-320 — `analise-funil.ts` is a script, never an agent — same skeleton as `medir-execucao.ts` {#rn-320}

The command is `pnpm --filter api analise:funil -- --projeto <uuid> [--json]`.
It only reads `proposed_actions` (filtered by `actionType IN (git_commit, pr_open,
git_merge)`) and `projects`, never writes. The guard
`if (process.argv[1]?.endsWith('analise-funil.ts')) void main();` at the end of the
file is the same as `medir-execucao.ts`: without it, importing the module in the
test would bring up all of Nest and take down the process at the argument
parser's `process.exit`.

- **Where:** `scripts/analise-funil.ts:64-73` (`lerOpcoes`),
  `:256-319` (`main`), `:390` (execution guard)
- **Test:** `test/scripts/analise-funil.spec.ts` (only the pure
  functions — the part that talks to the database is exercised by real execution,
  same pattern as `medir-execucao.spec.ts`)
- **ADR:** [0089](../adr/0089-analytics-e-delivery-metricas-como-relatorio.md)

### RN-321 — The funnel counts SESSIONS per stage, only `executed` actions, and lead time uses the execution's `updated_at` {#rn-321}

`calcularFunil` counts how many sessions produced at least one `git_commit`,
`pr_open`, and `git_merge` with `status: 'executed'` — a session with three
commits enters only once in each stage it reached, never three times. A stage's
conversion rate is `sessions-of-the-stage / sessions-of-the-previous-stage`, and is
`null` (not `0`, not `Infinity`) when the denominator is zero — there's no
"conversion from" anything to measure. `calcularLeadTimes` uses the `updated_at` of the
`proposed_actions` row, not `created_at`: it's the instant when
`ExecuteGitActionUseCase#record` actually wrote the `execution_result`
(`updateExecutionResult` bumps `updatedAt`), not when the action was
PROPOSED — the same distinction that `token_usage`/frozen price already make in
another context (RN-042). A merge whose `updated_at` precedes the commit's (two
batches in the same session, or incoherent data) is discarded, never becoming a negative lead
time.

- **Where:** `scripts/analise-funil.ts:115-160` (`calcularFunil`),
  `:170-193` (`calcularLeadTimes`)
- **Test:** `test/scripts/analise-funil.spec.ts` (describe
  "calcularFunil", "calcularLeadTimes")
- **ADR:** [0089](../adr/0089-analytics-e-delivery-metricas-como-relatorio.md)

### RN-322 — Real deployment frequency filters merges into a PROTECTED branch; three metrics stay DECLARED absent, never approximated {#rn-322}

`deploymentFrequencyPorDia` only counts `git_merge` `executed`s whose
`executionResult.targetBranch` is in `PROTECTED_BRANCHES`
(`src/domain/actions/protected-branches.ts`) — a merge into a feature
branch isn't a deploy. It crosses by REFERENCE with the `backmerge` gate
(`config/gates.yml`): its evidence is CI, in `.release/gate.json`, out of
reach of a script that only reads the database, so there's no data join, only the
same branch slice the gate observes.

Three metrics leave the report with a "Not measured, on purpose" section
instead of an approximate number:

1. **Complete product funnel (ideation → commit).** `sessions` has no
   `storyId` — [RN-230](web.md#rn-230) already declares the gap in the Criativo tab.
   Closing it requires a new schema, outside the scope of this front (no
   migration).
2. **Evidence of adoption per feature.** It isn't data that's missing to collect: 
   Brabo doesn't instrument the projects it BUILDS, and there's no
   path at all for that telemetry to exist today.
3. **MTTR and change failure rate.** They require a real production INCIDENT
   signal — the same dependency `packages/contracts/fluxo.yml` already records for
   `secops-runtime`/`platform` (`status: proposto`/`planned`, activation
   synchronized with `DEPLOY_ENABLED`).

- **Where:** `scripts/analise-funil.ts:220-247`
  (`deploymentFrequencyPorDia`), `:372-386` (printed "Not measured" section)
- **Test:** `test/scripts/analise-funil.spec.ts` (describe
  "deploymentFrequencyPorDia")
- **ADR:** [0089](../adr/0089-analytics-e-delivery-metricas-como-relatorio.md)

---

## The `implementavel` gate activates — QA-strategy as the second moment of the qa-lead (RN-340/341, ADR 0090) {#o-gate-implementavel-ativa-qa-estrategia-como-segundo-momento-do-qa-lead-rn-340-341-adr-0090}

### RN-340 — The `implementavel` gate decides the story BEFORE the dev agent writes code {#rn-340}

`config/gates.yml` declared the `implementavel` gate (owner `dev-lead`) since
PHASE 14d with `status: planned` — never activated. [ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)
activates it: the Dev Lead's `assess_implementability` tool proposes the
**implementability opinion** of a story (`implementavel`/`inviavel` +
justification) as a `proposed_action`, the SAME pattern as
`propose_execution_plan` ([RN-284](engine.md#rn-284)) — three outcomes
(`{:ok, texto} | {:pending, action_id} | {:error, texto}`), minimum role
`maintainer` in `decide.ts`, and DELIBERATELY outside the block of absolute
ceilings (it's an initial decision, not exceeding a ceiling).

**The opinion depends on the test plan, which is a PREREQUISITE, not an
argument.** `run_assessment/2` reads the story's most recent `artifact.plano_de_teste`
in the HISTORY of the Dev Lead's own session (emitted by the
QA-strategy, [RN-341](contracts.md#rn-341)):

1. **No plan yet** — triggers `Engine.Gates.Dispatcher.run_qa_estrategia/3`
   (the same test-swappable indirection that `run_qa/2`/`run_secops/2` already use)
   and returns `{:error, texto}` asking to try again shortly. A tool
   error is an INPUT to the loop, not the end of the line ([RN-163](engine.md#rn-163)): the
   Dev Lead has a ceiling of 14 iterations to try again. The wait window
   is accepted and declared — QA-strategy runs in a separate process
   (`qa-lead`), and a synchronous `run/2` can't block waiting for the
   result without coupling the two processes.
2. **With a plan** — builds the opinion with the test plan EMBEDDED in the payload
   (synthesis and executable criteria), so the user can decide without needing to
   open two events, and proposes the action.

**Since [RN-674](engine.md#rn-674) (ADR 0192) the two steps above NO LONGER hold.**
The test plan is born AFTER the dev's delivery and feeds `qa-verificada`;
`run_assessment/2` neither reads nor triggers a plan, proposes the opinion on the
FIRST call, over the story and the `module_map` the Dev Lead already has in context,
and the payload lost `planoDeTeste`/`criteriosExecutaveis`.
`Dispatcher.run_qa_estrategia/3` was removed. The rest of this rule (proposal, three
outcomes, minimum role, outside the absolute ceilings) remains the same.

- **Where:** `apps/engine/lib/engine/agents/dev_lead_tools.ex`
  (`run_assessment/2`, `spec_assess_implementability/0`),
  `dev_lead_server.ex` (`run_tool/3`); `src/domain/actions/decide.ts`
  (`assess_implementability`); `config/gates.yml` (`implementavel`,
  `status: active`)
- **Test:** `apps/engine/test/engine/agents/dev_lead_tools_test.exs`
  (describe "assess_implementability"), `dev_lead_server_test.exs`
  (describe "suspensão em aprovação" — the two new tests),
  `test/domain/actions/decide.spec.ts` (describe "parecer de
  implementabilidade do Dev Lead")
- **Origin:** [ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md)

## `secops-runtime` — abuse report over `rate_limit_hits` (RN-375..377, ADR 0091) {#secops-runtime-relatorio-de-abuso-sobre-rate-limit-hits-rn-375-377-adr-0091}

A conscious decision of the product owner to bring forward the `secops-runtime`
role (`packages/contracts/fluxo.yml`, `camada_seguranca`), which was born
`proposto` with the separation criterion "production with real traffic (after
`DEPLOY_ENABLED` + `platform` active)". That trigger did not fire — there is no
production traffic. What exists today is `rate_limit_hits` (`RateLimitGuard`,
ADR 0027): one row per counted request, written even under dev/CI traffic.
`secops-runtime` enters as a SCRIPT (`pnpm --filter api relatorio:seguranca-runtime`),
not an LLM agent nor a `GenServer` — there is no decision to make, only data to
aggregate.

### RN-375 — The report declares the window, never pretends a longer history {#rn-375}

`DomainGaugesCollector.pruneRateLimit`
(`src/infrastructure/observability/domain-gauges.collector.ts:177-186`)
deletes hits older than `2 × RATE_LIMIT_WINDOW_MS` (240s with the default of
60s), every `METRICS_GAUGE_INTERVAL_MS` (15s by default) — the table never
keeps more than a few minutes. `relatorio-seguranca-runtime.ts` prints
TWO windows, never just one: the CONFIGURED one (the pruning's theoretical ceiling) and the
OBSERVED one (what the data actually covers, from the first to the last
`occurred_at` read). When the two coincide, the report says explicitly
that it's a sign of pruning — older hits may have existed and have already been
deleted — never "there were no more hits than that".

### RN-376 — The ranking works only with what `bucket_key` keeps: bucket and when {#rn-376}

`RateLimitGuard.registrarEContar`
(`src/interfaces/http/shared/rate-limit.guard.ts:150-170`) records only
`bucket_key` (`user:<uuid>` or `ip:<endereço>`) and `occurred_at` — there's NO
route, HTTP method, nor block reason. `rankingDeBaldes` and
`interpretarBalde` (`scripts/relatorio-seguranca-runtime.ts`)
classify by these two fields and only them; a `bucket_key` outside the
`user:`/`ip:` format falls into `desconhecido` instead of blowing up, so the script doesn't
break if a future `RateLimitGuard` writes another format. Asking for an "IP
ranking by route" would be inventing a dimension the table never kept.

## The `dbre` role becomes two mechanical scripts (RN-400..403, ADR 0093) {#o-papel-dbre-vira-dois-scripts-mecanicos-rn-400-403-adr-0093}

### RN-400 — The migration opinion is STATIC SQL analysis, and ignores the risk pattern when it appears only in a comment {#rn-400}

`lintarConteudo` (the pure core of `lint-migracao.ts`) scans each `.sql` of
`src/db/migrations/` line by line, without depending on `--projeto`
or a database — the risk it finds is SCHEMA risk, not load risk, and that's why it
doesn't depend on any real data volume (the separation criterion that
`packages/contracts/fluxo.yml` already declared for the role). Five patterns, each with the
reason attached to the finding: `DROP TABLE`/`TRUNCATE` (total loss,
irreversible), `DROP COLUMN` (loss of the column, irreversible),
`ALTER COLUMN ... TYPE`/`SET DATA TYPE` (can rewrite the whole table),
and `ADD COLUMN ... NOT NULL` without `DEFAULT` (fails against a non-empty table —
the pattern `0042_tough_captain_midlands.sql` consciously avoided,
with nullable-first-then-backfill-then-`SET NOT NULL`).

A line starting with `--` (comment) is ignored on purpose: this
repository explains in prose, in the SQL itself, why a pattern was
AVOIDED — analyzing the comment's text would find the pattern exactly in the
sentence describing why it wasn't used.

- **Where:** `scripts/lint-migracao.ts` (`REGRAS`, line 75;
  `lintarConteudo`, line 126)
- **Test:** `test/scripts/lint-migracao.spec.ts` — each pattern
  individually, a combination of several in the same migration, and "ignora o
  padrão de risco quando ele aparece só em COMENTÁRIO"
- **ADR:** [0093](../adr/0093-dbre-linter-de-migracao-e-relatorio-de-backup.md)

## fluxo.yml × code audit — Wave 2: RN-160 in the backend and Dev Lead → dev delegation (RN-404/405, ADR 0094) {#auditoria-fluxo-yml-codigo-onda-2-rn-160-no-backend-e-delegacao-dev-lead-dev-rn-404-405-adr-0094}

Closes the last two findings of the audit (section D,
`docs/explanation/auditoria-fluxo-vs-codigo.md`): B6 (RN-160 guaranteed only on
the client) and B1 (the Dev Lead → `dev-<modulo>` delegation declared by ADR
0053 item 5 and never implemented).

### RN-404 — "Confirm architecture ready" (RN-160) is revalidated in the BACKEND, not only disabled in the UI {#rn-404}

[RN-160](web.md#rn-160) guaranteed the rule ("at least 1 promoted story before the
double Arquiteto→Dev Lead/Infra handoff") only by disabling the button in
`SessionPage.tsx` — a direct HTTP call to
`POST /agents/arquiteto/handoff-infra`, without going through the UI, ignored the rule
entirely. `OfferInfraHandoffUseCase.execute` now queries
`StoryRepository.findByProject(projectId)` and refuses with `BadRequestException`
when NO story of the project has `status !== 'draft'` — the check comes
BEFORE recording `architecture.readiness_confirmed` and BEFORE any
call to the engine (`offerInfraHandoff`; `offerDevHandoff` was removed in
[RN-672](#rn-672)): a refusal can't
leave a trace of a half-offered handoff in the event log, which is immutable.
`StoryRepository` was chosen (and not `ListBacklogUseCase`) for being
lighter — it doesn't need to build the epic→story→task tree to answer
"is there any non-draft?".

- **Where:** `src/application/use-cases/agents/offer-infra-handoff.use-case.ts`
  (lines 27-34, the check; injection of `StoryRepository` in the constructor)
- **Test:** `test/application/use-cases/agents/offer-infra-handoff.use-case.spec.ts`
  — zero promoted stories refuses with ZERO calls to the engine and ZERO events
  recorded; with at least one `ready`/`in_progress`/`done`, it follows the normal flow
- **ADR:** [0094](../adr/0094-delegacao-dev-lead-vira-dado.md)

## fluxo.yml × code audit — Wave 6 (last): the `necessidade-validada` gate (RN-406, ADR 0095) {#auditoria-fluxo-yml-codigo-onda-6-ultima-o-gate-necessidade-validada-rn-406-adr-0095}

### RN-408 — `MAIL_TRANSPORT=smtp` gates boot by the RN-114 pattern, without the public default {#rn-408}

Closes the backlog item "Real SMTP in MailSender" ([ADR 0096](../adr/0096-smtp-real-no-mailsender.md)).
`resolverConfigSmtp()` validates `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`/
`SMTP_FROM` in the SAME format as [RN-114](#rn-114) — in production
(`NODE_ENV === 'production'`), each one takes down the boot if missing, whitespace
only, or (in the case of `SMTP_HOST`) equal to the example literal
published (commented out) in `.env.example`. `SMTP_FROM` has one more
check: it must match `"Nome <email@dominio>"` or just `email@dominio`.
An invalid `SMTP_PORT` (non-numeric or outside 1–65535) also takes down the boot
in production.

The difference from the original RN-114 is structural, not of rigor: the four
secrets of RN-114 (`AUTH_JWT_SECRET` and company) HAVE a public development
default, and it's the existence of that default that makes "not
empty" an insufficient check. Here there's no default at all — `SMTP_HOST`
stays blank if nobody sets it —, so the whole ruler is only applied
when `NODE_ENV=production` AND `MAIL_TRANSPORT=smtp`. Outside production, or
with the transport at `log` (the default, including in production), none of the
five variables is required: sending real e-mail is opt-in by the operator, and
without that explicit opt-in the behavior stays the usual log-only
one — including in production, so that whoever already runs the product today doesn't
break on updating.

The validation runs inside the constructor of `SmtpMailSender`, exercised by the
`useFactory` of `AuthUseCasesModule` when assembling Nest's provider graph
(`NestFactory.create()`) — not by an eager call in `main.ts`, like
the four secrets of the original RN-114. The difference is deliberate: those
four protect a path that ANY request can exercise at any
moment, so failing before coming up matters. `SmtpMailSender` is only
instantiated when the operator opted for `smtp`, and `AuthUseCasesModule` is
imported unconditionally (via `AuthHttpModule`), so validation
still happens at boot — the same design `CREDENTIALS_MASTER_KEY` already uses
(validated in the constructor of `EnvelopeEncryptionService`, exercised by the
same graph assembly).

- **Where:** `src/infrastructure/mail/smtp-config.ts`
  (`resolverConfigSmtp`, `resolverModoDeTransporte`),
  `src/infrastructure/mail/smtp-mail-sender.ts` (`SmtpMailSender`,
  calls `resolverConfigSmtp()` in the constructor),
  `src/application/use-cases/auth/auth-use-cases.module.ts`
  (`useFactory` of the `MailSender`)
- **Test:** `test/infrastructure/mail/smtp-config.spec.ts`
  (same pattern as `auth-key-material.spec.ts`/`service-token.spec.ts`),
  `test/infrastructure/mail/smtp-mail-sender.spec.ts`
- **Origin:** [ADR 0096](../adr/0096-smtp-real-no-mailsender.md), extending the
  pattern of [RN-114](#rn-114) (which in turn extends
  [ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md))

---

## Automatic personal workspace at sign-up (RN-410) {#workspace-pessoal-automatico-no-cadastro-rn-410}

A finding while navigating the product after a database reset: the dashboard's
"New project"/"+" button did NOTHING, with no error at all. The root cause was
in two layers. The visible one: `Dashboard.tsx` only opens the
`NewProjectWizard` when `useCurrentWorkspace()` finds a workspace
(`list[0]?.workspace` of `GET /workspaces`); with none, the click has nowhere
to go. The deep one: `RegisterUseCase` created the user and the credential but
NEVER a workspace, and the same was true of `SocialLoginCallbackUseCase` in the
branch that provisions a new account — EVERY new sign-up, by password or by
social login, hit that wall. It had only not shown up before because
`db/seed.ts` always creates a workspace along with the demo data, and no
product screen calls `createWorkspace` (the route, the use case and the HTTP
client exist — they just have no caller in the UI).

### RN-410 — Every NEW account is born with a personal workspace, in the SAME transaction as the account {#rn-410}

`RegisterUseCase` (e-mail/password registration) and `SocialLoginCallbackUseCase`
(provisioning a new account via social login) create the workspace and
add the user as `owner` — the same `create`/`addMember` pair that
`CreateWorkspaceUseCase` already uses — inside the SAME transaction that already creates
user and credential. It isn't a second call to the use case: that one opens its
OWN transaction, and the point is that a user without a workspace never exists if something
fails midway.

Name and slug come from ONE pure function,
`nomeESlugDoWorkspacePessoal(nome, email, userId)`
(`src/domain/auth/personal-workspace.ts`), reused by both
creation points — so the rule doesn't diverge in two files, the same
reason behind `normalizarEmail`/`exigirSenhaValida` living in the
domain. The name uses the given `nome` (social login uses the provider's login),
with the e-mail's local-part as a fallback when there's no name —
it never invents either. The slug is kebab-case of the same text, ALWAYS
suffixed with `userId.slice(0, 8)` (same pattern as
`extraDevAgentId`/`workspaceDirName`/session label): `workspaces.slug`
is `UNIQUE` in the database and nothing in the product does retry-on-conflict, so two
sign-ups with an equal name or local-part would collide without the suffix. A name or
e-mail with NO alphanumeric character degrades to the
literal `workspace-<8 chars>`, never to an empty string.

- **Where:** `src/domain/auth/personal-workspace.ts`
  (`nomeESlugDoWorkspacePessoal`),
  `src/application/use-cases/auth/register.use-case.ts`,
  `src/application/use-cases/auth/social-login-callback.use-case.ts`
  (method `provisionarContaNova`)
- **Test:** `test/domain/auth/personal-workspace.spec.ts` (name
  with/without `nome`, fallback to the e-mail's local-part, accent/uppercase
  becoming ASCII kebab-case, `workspace-<id>` fallback with no alphanumeric
  character at all, slug always unique thanks to the suffix);
  `test/application/use-cases/auth/register.use-case.spec.ts`
  (a new account gets a workspace with the user as `owner`, a duplicate e-mail
  doesn't create a second); `test/application/use-cases/auth/
  social-login-callback.use-case.spec.ts` (same proof in the branch that
  provisions a new account via social login)
- **ADR:** none — the fix of a path that should have done this from
  the start, not a new structural decision
- **Origin:** found by real use, navigating the product — not a planned
  backlog item

## "N agents online" on the dashboard — LIVE status, never historical presence (RN-409, ADR 0097) {#n-agentes-online-no-dashboard-status-ao-vivo-nunca-presenca-historica-rn-409-adr-0097}

### RN-412 — `dev.awaiting_gate`/`dev.awaiting_approval` hold the session; the effective compaction window is consistent with the transport {#rn-412}

Found by real USE ("on PRs it's always blowing up with entity too
large"), with two defects that chain together. The QA/SecOps gate
died with `413 request entity too large` → the dev agent waiting for the
verdict stayed stuck in `dev.awaiting_gate` indefinitely → that
state was NOT one of the three [RN-411](ci.md#rn-411) held → the
30s heartbeat closed the session from underneath → the Executors tab required
an active session (`findActiveExecutionSession`) and erased the entire roster,
even with real work hanging.

**The cause of the 413 was Brabo's own api, never the LLM
provider** — see [ADR 0098](../adr/0098-limites-de-transporte-e-janela-efetiva-de-compactacao.md).
Two fixes, both necessary (one without the other only postpones the
overflow):

1. `src/main.ts` never configured Express's body limit —
   the 100 KB default applied, the narrowest bottleneck in the
   engine→api direction (Phoenix accepts up to 8 MB). `POST
   /internal/sessions/:sessionId/llm-turn` resends the conversation's ENTIRE
   history on each `ToolLoop` iteration, and 3-4 tool results of
   32 KiB (RN-150's individual ceiling) already added up to more than 100 KB.
   `API_JSON_BODY_LIMIT` (default `10mb`) closes that end.
2. `Engine.Harness.ContextManager.Default` had two defects that
   made compaction unreachable before the body overflowed:
   `estimate/1` counted only `content`, so `assistant` messages
   with heavy `toolCalls` cost ~zero tokens in the estimate; and the
   compaction window used only `context_window` (128,000 tokens in the
   gate agents — `qa_automacao_agent.ex`, `qa_performance_seguranca_agent.ex`,
   `qa_estrategia_agent.ex`, `appsec_agent.ex`, `dev_agent_server.ex`),
   giving ~350 KB before compacting (`threshold` 0.7 × window). The
   EFFECTIVE window is now `min(context_window, teto_de_transporte)`
   (`transport_max_body_bytes`, a single config, default 8 MiB), and the cut
   always happens at an ITERATION BOUNDARY of the `ToolLoop`
   (`group_by_iteration/1`) — never separating an `assistant` message
   with `toolCalls` from the `role: "tool"` that answer it, which would break the
   provider's tool-use protocol.

**The pending-work ruler** (`DEV_PENDING_TYPES`,
`get-session-pending-work.use-case.ts`) gained two types:
`dev.awaiting_gate` (the original argument — the gate now shouldn't
die anymore, but locking the session because of it was never correct, it's
defense in depth) and `dev.awaiting_approval`, by an argument
DIFFERENT from what RN-411 had discarded: the
approval/denial decision writes `proposed_actions.status` SYNCHRONOUSLY in the
`ApproveActionUseCase` transaction (the second signal no longer sees
`pending` there), but the dev agent's resumption is ASYNCHRONOUS — only after
`avisarQuemEsperava()` writes `task.action_settled`/`task.pr_settled`
to the outbox does `Engine.Outbox.Drain` enqueue the Oban job that
wakes `DevAgentServer`. In that window, nothing held the session: the same
defect as RN-411, one level deeper.

**The Executors/Overview tabs** had the sibling defect on the web side:
`executionActivated` was derived from `events.some((e) => e.type ===
'execution.activated')` over the window of only 200 events of
`useSessionEvents` (`{ limit: 200, latest: true }`) — `execution.activated`
is among the FIRST events of an execution session and left the window in
any real session. The correct value already existed, aggregated over ALL
events (`bool_or(...)`, [RN-090](#rn-090)), in the workspace summary
(`ProjectCardSummary.roster.executionActivated`) — `ProjectExecutorsTab.tsx`
and `ProjectOverviewTab.tsx` now consume it instead of deriving from the
window. `gatesEverOpened` suffers from the SAME class of defect and was
DECLARED as a known limitation, not fixed here — fixing it
would require changing the signature of `deriveAgentRoster`/`rosterFactsFromEvents`,
outside the scope of this fix.

- **Where:** `src/main.ts`, `apps/engine/lib/engine/harness/context_manager.ex`,
  `apps/engine/lib/engine/harness/tokenizer.ex`,
  `src/application/use-cases/sessions/get-session-pending-work.use-case.ts`,
  `apps/web/src/routes/ProjectExecutorsTab.tsx`, `apps/web/src/routes/ProjectOverviewTab.tsx`
- **Test:** `test/main.spec.ts` (1 MB body accepted; above the
  limit → 413); `apps/engine/test/engine/harness/context_manager_test.exs`
  (heavy toolCalls trigger compaction; `:pinned` survives; the transport
  ceiling forces compaction even with a large model window);
  `get-session-pending-work.use-case.spec.ts` (last event
  `dev.awaiting_gate`/`dev.awaiting_approval` → `pending: true`);
  `ProjectExecutorsTab.test.tsx`/`ProjectOverviewTab.test.tsx` (a session
  with >200 events still shows the roster via the aggregated summary)
- **Origin:** found by real use — "on PRs it's always blowing up with
  entity too large", investigated together with the product owner

---

### RN-416 — The graph is DERIVED memory, rebuildable by projection from the outbox {#rn-416}

The alternative of the engine writing to Neo4j directly was REFUSED — it would open
a second write path besides the event log, breaking the guarantee of a
single source of truth. `GraphProjector` (api) drains a SECOND outbox
row, the usual same transaction, `aggregateType: 'graph_projection'`
— a value the engine-side `Engine.Outbox.Drain` never matches (its
filter is `aggregate_type IN ('session', 'task')`), avoiding the race that
would exist if it reused `'session'` (the engine already drains and marks that type in
~2s). Same pattern as `deny-action.use-case.ts`, which already writes in two
`aggregateType`s in the same transaction.

Instrumented at two points: `AppendSessionEventUseCase` (for
`handoff.offered`, `psychologist.hypothesis_proposed`,
`anamnese.profile_updated` — payload only `{eventId}`, the projector REREADS the
complete envelope from the event log at projection time, never trusting a
potentially stale copy) and `TransitionSessionUseCase` (for
`session.closed`/`session.closed_abnormally`, which don't go through
`session_events`). `GraphProjector` is a poller (~2s, same shape as
`DomainGaugesCollector`) that calls the write use cases already
existing from the previous foundation — idempotency lives IN THEM (natural
key per type: `Hipotese.id`, `Handoff(sessionId,seq)`,
`PerfilAnamnese(userId,dimensao)`, `Interacao.sessionId` with range
extension). A `GraphUnavailableError` in the middle of a batch STOPS the whole cycle
(the rest would fail for the same reason) — the row stays unprocessed and
retries on its own in the next cycle, with no intervention.

- **Where:** `src/application/graph-projection/graph-projector.ts`;
  `src/domain/graph/graph-projection-events.ts`;
  `src/application/use-cases/sessions/append-session-event.use-case.ts`,
  `transition-session.use-case.ts`
- **Test:** `graph-projector.spec.ts` (happy path of the four types;
  evidence→seq resolution of a hypothesis; `GraphUnavailableError` leaves the
  row unmarked and stops the cycle; the following cycle reprocesses
  successfully; reprocessing the SAME row twice doesn't duplicate in the graph);
  new tests in `append-session-event.use-case.spec.ts`/
  `transition-session.use-case.spec.ts` (a projectable type writes the second
  row; a non-projectable type writes nothing extra)
- **Origin:** see [ADR 0101](../adr/0101-memoria-relacional-como-projecao-do-event-log.md)

---

### RN-418 — External git effect and privileged command (sudo/doas) become an absolute ceiling, never `deny` {#rn-418}

**Revised by [RN-713](#rn-713)** (AT-385, 02/10): with automatic mode (the
wildcard in `auto_approve`), push and PR are auto-approved.

**Revised by [RN-689](#rn-689)** (AT-347, owner's decision of 01/10): the
ceiling below also applies to the TYPED actions `git_push` and `pr_open`, which
until then only had the minimum role and were born `auto_approved` by the
wildcard, by a specific rule or by `permissions.json`. The rest of this entry
remains in force.

Revises [RN-106](#rn-106) by a GLOBAL and explicit decision of the product
owner: `git push`, PR opening, deploy (the same prefix detection that RN-106
already had) and `sudo`/`doas` (new — matched by VERB in
`comandoPrivilegiadoNoComando`, scanning every segment of the command) stop
being an unconditional `deny` and become an ABSOLUTE CEILING — unconditional
`require_approval`, in the SAME final block and SAME code pattern as the other
ceilings (protected merge, `instruction_patch`,
`parallelize`/`raise_max_parallel`, path scope):
`current.policy === 'auto_approve'` → overwritten. Never auto-approvable by
`agent_autonomy` (including the `"*"` wildcard of automatic mode) nor by
`permissions.json`.

The condition that makes this safe — without which the ceiling would be
decorative — is the half that closes "always allow" AT THE SOURCE:
`ApproveAlwaysActionUseCase`/`patternsForAction` refuse to write an `allow`
pattern for a terminal action with an external git effect or a privileged
command. The specific instance can still be approved by the normal flow
(`ApproveActionUseCase`); only the click that would write a pattern forever is
refused, with a clear message. It is the same argument RN-106 originally used to
justify `deny` — resolved at the origin, no longer blocking the symptom.

An automatic security warning flagged this change during implementation
(rewriting a rule the product documented as an absolute `deny` deserves
scrutiny) — the product owner explicitly confirmed, after reviewing, that this
was the decision.

- **Where:** `src/domain/actions/decide.ts` (absolute-ceilings block),
  `src/domain/actions/external-effect.ts`
  (`comandoPrivilegiadoNoComando`, `mensagemDeComandoPrivilegiado`),
  `src/application/use-cases/actions/approve-always-action.use-case.ts`
- **Test:** `decide.spec.ts` (`git push` with auto mode `"*"` AND with an
  `allow` matching in `permissions.json` resolve to `require_approval`;
  `sudo` likewise; the earlier ceilings remain intact — full regression);
  `approve-always-action.use-case.spec.ts` ("always allow" on git with an
  external effect/sudo does not write a pattern; an ordinary command still
  writes normally — regression); `external-effect.spec.ts`
- **Origin:** see [ADR 0102](../adr/0102-revisao-do-adr-0065-teto-absoluto-substitui-deny.md)

---

## ADR 0104 Wave 1 — `execution_mode` with three values, workspace verified by the runner {#onda-1-do-adr-0104-execution-mode-em-tres-valores-workspace-verificado-pelo-runner}

ADR 0072 (RN-169/RN-170) and ADR 0103 (RN-419/RN-420) never talked to each
other: the runner reused the same `workspace_mode == 'local'` flag with no
bind-mount at all, so really using the runner still required going through the
MOUNTED FOLDER validation. ADR 0104 reconciles the two. Migration `0048`
recreates the enum (`project_workspace_mode` → `project_execution_mode`,
`local` → `mounted`) in a single transaction — `ALTER TYPE ... ADD VALUE`
cannot be referenced in the same transaction in which it was added — and adds
`workspace_verified_at` (nullable).

### RN-421 — `execution_mode` has THREE values: `container`/`mounted`/`runner` {#rn-421}

`projects.workspace_mode` (two values) became `projects.execution_mode`
(three): `container` (DEFAULT, unchanged), `mounted` (the old `local`,
RENAMED — same behavior, same disk validation on creation), and
`runner` (NEW: a user folder without bind-mount, confirmed by the
`brabo-runner` CLI). The database CHECK became `(execution_mode <>
'container') = (workspace_path IS NOT NULL)` — it covers both non-
`container` modes with the SAME condition, with no explicit `OR` per value.

`projectScopeRoot`/`Project.workspace_dir_name` (api and engine) derive the
root by the SAME rule in both non-`container` modes: the user's path
is the root, distinguished from the managed folder name by the leading slash. What
changes between `mounted` and `runner` isn't WHERE the root is — it's WHEN/WHO
confirms that it really exists ([RN-422](#rn-422)/[RN-423](runner.md#rn-423)).

- **Where:** `src/db/migrations/0048_quiet_iron_fist.sql`,
  `src/db/schema/iam.ts` (`projectExecutionModeEnum`),
  `src/domain/iam/project.entity.ts` (`PROJECT_EXECUTION_MODES`),
  `src/infrastructure/filesystem/project-workspaces-root.ts`
  (`projectScopeRoot`), `apps/engine/lib/engine/projects/project.ex`
- **Test:** `test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (describe "projectScopeRoot nos modos mounted/runner"),
  `apps/engine/test/engine/projects/project_test.exs`
- **Architectural decision:**
  [ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
- **Origin:** reconciliation requested by the product owner, between ADRs 0072
  and 0103

### RN-422 — Creation validation DIVERGES by mode: `mounted` touches disk, `runner` only the lexicon {#rn-422}

`CreateProjectUseCase.caminhoValidado` gained a third branch. `mounted`
remains exactly as `local` was (RN-170, history): it refuses with `400`
a path that doesn't exist, isn't a folder, or isn't writable inside the
container, with the mounting instruction. `runner` validates only the
LEXICON — the same list of prohibitions (absolute, no `..`, outside root/system
folder, no overlap with Brabo's checkout) — without touching disk:
only the runner, running on the real HOST, has the authority to confirm that
the folder exists. The project is born with `workspace_verified_at: null`.

`caminhoDeWorkspaceLocalValido` (the lexical predicate) was EXPORTED from
`project-workspaces-root.ts` to be reused on both sides that need
it without touching disk: the creation of a `runner` project and the runner's
confirmation ([RN-423](runner.md#rn-423)) — the same function, never two copies that one day
diverge.

- **Where:** `src/application/use-cases/iam/create-project.use-case.ts`
  (`caminhoValidado`), `src/infrastructure/filesystem/project-workspaces-root.ts`
  (`caminhoDeWorkspaceLocalValido`, exported), `src/interfaces/http/iam/dto/create-project.dto.ts`
- **Test:** `test/application/use-cases/iam/create-project-modo-de-workspace.spec.ts`
  (`runner` block), `test/interfaces/http/iam/project-dto-modo-de-workspace.spec.ts`,
  `apps/web/src/lib/wizard.test.ts` (`canAdvanceFromWorkspace` for `runner`)
- **Architectural decision:**
  [ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
- **Origin:** reconciliation of ADR 0104

### RN-424 — A PAT authenticates ONLY `runner-ticket`, by construction — never dual-auth with JWT on that route {#rn-424}

A Personal Access Token (`brb_…`) never authorizes any route other than
`POST /projects/:projectId/runner-ticket`. The guarantee isn't an `if` that
a new route could forget to check: it's structural. `@RequirePatAuth()`
marks the handler with `IS_PAT_ROUTE_KEY`; `JwtAuthGuard` (the global
`APP_GUARD`) checks that metadata BEFORE trying JWT `verify()` and returns
`true` without validating anything — the same bypass shape that `IS_PUBLIC_KEY` and
`IS_SERVICE_ROUTE_KEY` already use. `PatAuthGuard`, applied only to that handler
via `@UseGuards()`, is what actually authenticates: it extracts the bearer, refuses
(401) any value not starting with `brb_` without querying the
repository — it never tries to validate as JWT on that route, and no other
route accepts `brb_…` as a bearer.

After `PatAuthGuard` populates `request.user`, `RolesGuard`/
`ResolveEffectiveRoleUseCase` keep running, unchanged — belt and
suspenders: if the PAT's owner loses sufficient role in the project through the
normal path (`ProjectMember`/workspace), the token stops authorizing even without
having been explicitly revoked.

The alternative considered and refused: the global `JwtAuthGuard` recognizing
the `brb_` prefix and populating `request.user` directly, for ANY route. That
would authorize the PAT for everything the user's role allows in the rest of the api —
the "only asks for a runner ticket" scope would become decorative.

- **Where:** `src/interfaces/http/auth/pat-route.decorator.ts`
  (`IS_PAT_ROUTE_KEY`/`@RequirePatAuth()`),
  `src/interfaces/http/auth/jwt-auth.guard.ts` (the third
  early-out), `src/interfaces/http/auth/pat-auth.guard.ts`
  (`PatAuthGuard`), `src/interfaces/http/runner/runner-tickets.controller.ts`
  (`runnerTicket`, the only marked handler)
- **Test:** `test/interfaces/pat-auth.guard.spec.ts`,
  `test/interfaces/jwt-auth.guard.spec.ts` (`@RequirePatAuth()`
  passes without trying `verify()`), `test/interfaces/http/runner/runner-tickets.controller.spec.ts`
  (`runnerTicket` has the decorator, `terminalTicket` doesn't)
- **Architectural decision:**
  [ADR 0105](../adr/0105-personal-access-token-do-runner-escopado-por-construcao.md)

### RN-425 — PAT validation collapses nonexistent/revoked/expired into a single answer; wrong scope is 403; `last_used_at` is never throttled {#rn-425}

`PersonalAccessTokenRepository.validarEUsar(hash)` is ONE query:
`UPDATE personal_access_tokens SET last_used_at = now() WHERE token_hash
= $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at >
now()) RETURNING id, user_id, project_id`. Zero rows returns `null`, and
the guard answers **401 for "doesn't exist", "revoked", and "expired" with the
SAME message** — whoever presents a stolen or expired token doesn't
find out which of the three is the reason (same pattern as
`AccountTokenRepository.consumir()`).

Incorrect project scope is a DIFFERENT category: if the `project_id`
returned by the query doesn't match the route's `:projectId`, it's **403**, not
401 — the token really authenticated, it just has no right to THIS project.

`last_used_at` is updated UNCONDITIONALLY, in the SAME validation
query — never with a throttle (e.g. "only if `last_used_at` is `NULL`
or older than 5 minutes") in the same `WHERE`. A throttle there is a real
bug: a PAT presented twice in under 5 minutes would fall out
of the `WHERE` the second time (because `last_used_at` would be "too
fresh"), and the query would return zero rows for a **valid** token —
rejecting a legitimate reconnection with 401. The runner's retry loop
reconnects in seconds, not minutes. The cost of not throttling is a
one-row `UPDATE` by unique index per call — irrelevant in the
real worst case (up to 10 attempts in a row, the runner's ceiling).

- **Where:** `src/infrastructure/persistence/drizzle/personal-access-token.repository.ts`
  (`validarEUsar`), `src/interfaces/http/auth/pat-auth.guard.ts`
- **Test:** `test/infrastructure/persistence/personal-access-token.repository.spec.ts`
  (nonexistent/revoked/expired → `null`; "toca `last_used_at` sempre
  que válido, sem throttle" — regression of the bug above),
  `test/interfaces/pat-auth.guard.spec.ts` (wrong scope → 403,
  not 401)
- **Architectural decision:**
  [ADR 0105](../adr/0105-personal-access-token-do-runner-escopado-por-construcao.md)

### RN-426 — Listing/revoking a PAT is scoped to the user's OWN tokens, in the query's WHERE — no cross-user admin in this wave {#rn-426}

`ListPersonalAccessTokensUseCase`/`RevokePersonalAccessTokenUseCase`
filter by `userId` inside the SQL query (`WHERE user_id = $1 AND ...`),
never fetching everything and filtering afterwards in memory. Each user only
sees and only revokes their OWN tokens — including within a project
where they're `maintainer`.

`revogar(id, userId, motivo)` is IDEMPOTENT: if the `UPDATE` (with the same
`WHERE user_id = $1`) finds no row because it was already revoked, a
second tie-breaking query returns the row (revoking again isn't an
error); if it finds none because the token doesn't exist OR doesn't belong to the
calling user, it returns `null` — the SAME answer (404 in the controller) for
both cases, so as not to leak the existence of someone else's token through the
status code.

**Closed by RN-427**: a `maintainer` revoking another user's PAT —
the incident response case (a dismissed dev with a leaking token) — which
this section declared out of scope left the backlog and is implemented.
This ruler (self-revocation, scope by `userId`) didn't change at all.

- **Where:** `src/application/use-cases/auth/list-personal-access-tokens.use-case.ts`
  (`ListPersonalAccessTokensUseCase`), `src/application/use-cases/auth/revoke-personal-access-token.use-case.ts`,
  `src/infrastructure/persistence/drizzle/personal-access-token.repository.ts`
  (`listarDoUsuarioNoProjeto`, `revogar`)
- **Test:** `test/application/use-cases/auth/list-personal-access-tokens.use-case.spec.ts`,
  `test/application/use-cases/auth/revoke-personal-access-token.use-case.spec.ts`,
  `test/infrastructure/persistence/personal-access-token.repository.spec.ts`
  (revoking another user's token → `null`)
- **Architectural decision:**
  [ADR 0105](../adr/0105-personal-access-token-do-runner-escopado-por-construcao.md)

---

### RN-427 — A `maintainer` revokes the PAT of ANY user of the project, scoped by `project_id` — incident response {#rn-427}

An extension of RN-426's model, not a new architecture decision: the same
pattern already used to close RN-407 (PO reading product metrics) over
an already decided model, with no ADR of its own. It closes the cut that ADR 0105
declared "outside this wave" — real incident response (a dismissed dev
with a leaking token), where waiting for the user themselves to revoke isn't an option.

`ListPersonalAccessTokensAsMaintainerUseCase`/
`RevokePersonalAccessTokenAsMaintainerUseCase` are NEW use cases,
on SEPARATE routes (`GET .../personal-access-tokens/all`,
`DELETE .../personal-access-tokens/:tokenId/admin`, both
`@RequireRole('maintainer')`) — never an `if` inside the
self-service handlers, the same principle already used in the rest of the product for
authorization by level (`OfferInfraHandoffUseCase`). The
self-revocation route (RN-426) doesn't change at all.

`listarDoProjeto` brings ALL of the project's tokens — with no
`userId` filter — with an `innerJoin` on `users` for the owner's e-mail, the same pattern
the project members listing already uses: without the e-mail, a
`maintainer` seeing "revoke whose token?" would only have a raw UUID, and the
item's very reason (incident response) asks to know WHO the owner is.

`revogarComoMaintainer(id, projectId, motivo)` is the same idempotent
design as `revogar()` — a conditional `UPDATE` followed by a tie-breaking `SELECT`
when the `UPDATE` finds no row —, but the `WHERE` compares
`project_id`, never `user_id`: a `maintainer` revokes any owner
WITHIN their project, never a token of another project. With no row
at all (the token doesn't exist OR belongs to another project), it returns `null` — the
SAME answer (404) for both cases, the same discipline of not leaking
existence that RN-426 already applied.

- **Where:** `src/application/use-cases/auth/list-personal-access-tokens-as-maintainer.use-case.ts`,
  `src/application/use-cases/auth/revoke-personal-access-token-as-maintainer.use-case.ts`,
  `src/infrastructure/persistence/drizzle/personal-access-token.repository.ts`
  (`listarDoProjeto`, `revogarComoMaintainer`),
  `src/interfaces/http/runner/personal-access-tokens.controller.ts`
  (`listAllPats`, `revokePatAsMaintainer`),
  `apps/web/src/routes/settings/PersonalAccessTokensSection.tsx`
  (sub-list visible only to `owner`/`maintainer`)
- **Test:** `test/application/use-cases/auth/list-personal-access-tokens-as-maintainer.use-case.spec.ts`,
  `test/application/use-cases/auth/revoke-personal-access-token-as-maintainer.use-case.spec.ts`,
  `test/infrastructure/persistence/personal-access-token.repository.spec.ts`
  (`listarDoProjeto`/`revogarComoMaintainer`),
  `test/interfaces/http/runner/personal-access-tokens.controller.spec.ts`,
  `apps/web/src/routes/ProjectSettingsTab.test.tsx`
- **Architectural decision:**
  [ADR 0105](../adr/0105-personal-access-token-do-runner-escopado-por-construcao.md)
  (extension of the existing model, no new ADR)

---

### RN-430 — PRs are project-wide; the decision uses the action's own sessionId, never the most recent one {#rn-430}

The `prs` tab resolves the defect of `ProjectApprovalsTab.tsx`, which scoped the
"PRs in review" section to `usePendingActions(projectId, latestSession?.id)`
— a pending review from a previous session disappeared as soon as a new
session was born. The listing comes straight from the provider (`GET
/projects/:id/code/pull-requests`, already project-wide by design); the
crossing with the corresponding `proposed_action` (e.g. `git_merge`) uses
`ProposedActionRepository.findPendingByProject(projectId, actionType?)`,
new, next to the already existing one scoped by session. The decision
(approve/deny/always allow) uses the `sessionId` the
`ProposedAction` itself carries, never `latestSession` — the action may have been born
in a session different from the current one.

The PRs tab is the first real producer of `git_merge` through the UI (`actor.kind:
'user'`); the protected branch lock in `decide.ts` (RN-154) remains
absolute regardless of who proposes. `git_merge` gained its own body in the
approval card instead of the raw JSON dump (the same defect that
RN-096 already fixed for other types).

- **Where:** `src/application/ports/proposed-action-repository.port.ts`,
  `src/infrastructure/persistence/drizzle/proposed-action.repository.ts`,
  `src/application/use-cases/actions/list-project-pending-actions.use-case.ts`,
  `src/interfaces/http/actions/project-actions.controller.ts`
  (`GET /projects/:projectId/actions?status=pending&actionType=`),
  `apps/web/src/routes/ProjectPrsTab.tsx`, `apps/web/src/components/ApprovalCard.tsx`
- **Test:** `list-project-pending-actions.use-case.spec.ts` (a pending action
  from an old session found project-wide; filter by actionType; never
  returns a decided action); `propose-action.use-case.spec.ts` (git_merge with
  a real payload from the PRs tab stays pending even with `GitMerge()` in allow, and
  with the agent_autonomy wildcard on); `ProjectPrsTab.test.tsx` (PRs from
  multiple sessions appear together; the decision uses the action's sessionId, not the
  most recent session's); `ApprovalCard.test.tsx` (`git_merge`'s own
  body)
- **ADR:** none — extension of an already existing read path, without
  changing the decision pipeline
- **Origin:** product owner's request — "there are no ways to manage PRs"

---

## The Runner folder explorer becomes three columns, and creating a `runner` project stops waiting for the final step (RN-436/436) {#o-explorador-de-pasta-do-runner-vira-tres-colunas-e-a-criacao-de-um-projeto-runner-deixa-de-esperar-o-passo-final-rn-436-436}

### RN-439 — `POST .../runner-ticket` authenticates AND authorizes in the SAME guard; `RolesGuard` (global) abstains on an `@RequirePatAuth()` route {#rn-439}

`POST /projects/:projectId/runner-ticket` answered `403 "Não autenticado"`
for EVERY PAT, even a valid one, freshly issued, scoped to the right project —
found in a LIVE verification of `brabo-runner` connecting to a real
project, never by an automated test. Root cause: `JwtAuthGuard` and
`RolesGuard` are the two `APP_GUARD`s — GLOBAL — and a global guard ALWAYS
runs BEFORE a route's LOCAL guard (`@UseGuards`), regardless of the order of the
decorators in the controller. `JwtAuthGuard` already knew how to abstain on this route (the
`IS_PAT_ROUTE_KEY` bypass already existed, without populating `request.user`,
counting on `PatAuthGuard` to authenticate afterwards); `RolesGuard` didn't,
and refused every call with `request.user` still empty — `PatAuthGuard`
never got to run. The controller's comment described the order
backwards ("`RolesGuard` runs AFTER `PatAuthGuard`"), and it never was so.

The fix followed the SAME pattern `JwtAuthGuard` already used for this
problem: `RolesGuard` gained the twin bypass (`IS_PAT_ROUTE_KEY` →
returns `true` without checking `request.user`), delegating the entire authorization
to whoever becomes the ONLY guard running after `request.user` is
populated on this route — `PatAuthGuard` itself, which now also reads
`@RequireRole` (via `Reflector`) and resolves the effective role
(`ResolveEffectiveRoleUseCase.forProject`), refusing with the SAME message
`RolesGuard` would use ("Papel insuficiente para esta ação"). The logic is
duplicated between the two guards ON PURPOSE — `RolesGuard` lives in `iam`,
`PatAuthGuard` lives in `auth`, and a cross dependency just to reuse
~10 lines wouldn't be worth it.

A SECOND defect was hidden behind the first, and only showed up when
the integration test started exercising the two guards TOGETHER: `PatAuthGuard`
compared the RAW token directly against `personal_access_tokens.token_hash`
in `validarEUsar` — which always expects the HASH (`hashDeToken`, HMAC-SHA256+
pepper, the same one `TokenFactory`/`IssuePersonalAccessTokenUseCase` use
to write). Fixed to `this.tokens.validarEUsar(hashDeToken(token))`.
While `RolesGuard` refused everything before, this second bug never got
to manifest — fixing only the first would have swapped an always-403 for an
always-401, and the runner would still never really connect.

- **Where:** `src/interfaces/http/iam/roles.guard.ts` (the
  `IS_PAT_ROUTE_KEY` bypass); `src/interfaces/http/auth/pat-auth.guard.ts`
  (authorization by role + token hash); `src/interfaces/http/runner/runner-http.module.ts`
  (`IamUseCasesModule` imported, for the `ResolveEffectiveRoleUseCase` that
  `PatAuthGuard` now needs); comment fixed in
  `src/interfaces/http/runner/runner-tickets.controller.ts`
- **Test:** `test/interfaces/pat-auth.guard.spec.ts` (authorization
  by role in isolation + token hash); `test/interfaces/roles.guard.spec.ts`
  (`IS_PAT_ROUTE_KEY` bypass); `test/interfaces/http/runner/runner-tickets.guards.integration.spec.ts`
  (NEW — brings up `JwtAuthGuard`+`RolesGuard`+`PatAuthGuard` in a real Nest, with
  `supertest`, in the SAME relative order as `AppModule`: it's the test that
  was missing, because each guard was only exercised in isolation before this).
  Also verified LIVE: `brabo-runner` really connected to a
  real `runner` project with a PAT issued after the fix
- **ADR:** [0105](../adr/0105-personal-access-token-do-runner-escopado-por-construcao.md)
  — a bug fix in the implementation of the decision already made there (PAT
  authenticates this route), not a new decision
- **Origin:** found running `brabo-runner` for real against a real
  project and isolating with `curl` directly — never by an automated test, because
  no suite exercised `RolesGuard` and `PatAuthGuard` in the same
  request

### RN-440 — `addressableAgents()` is the CLOSED catalog of the manual handoff, stricter than `assertHandoffTargetAllowed` {#rn-440}

Manual handoff to an agent of choice (backlog, ADR 0109): `assertHandoffTargetAllowed`
(ADR 0038) only refuses an area SUBAGENT — an agent citing "abc" as a
target would pass through it without error, because an AGENT only cites targets it already
knows from its own instruction. That stops being true when whoever
chooses is a HUMAN, in a `<select>` fed by a client that may
diverge from the backend. `addressableAgents()` (`src/domain/agents/agent-areas.ts`)
is the CLOSED catalog — area leads (`AGENT_AREAS.map(a => a.lead)`) ∪
`SOLO_CONVERSATIONAL_AGENTS` (`criativo`, `po`, `arquiteto`, `ux-designer`,
`staff`) — and `RequestManualHandoffUseCase` refuses with 400 any
`toAgent` outside it, BEFORE calling `CreateHandoffUseCase`.

`SOLO_CONVERSATIONAL_AGENTS` is its OWN list, not derived from the
`apps/web/src/lib/agents.ts` roster (which also lists gate agents and the
Psicólogo/Anamnese, none addressable by handoff). The direction of the derivation
is from the api to the web: since AT-046 the web's copy is no longer a MANUAL
mirror and comes out of the SAME generator as the areas (`pnpm --filter api gerar:areas`,
Phase 18), in `apps/web/src/lib/agent-areas.generated.ts`, which `agents.ts`
only reexports. `agent-areas.spec.ts` fails when the disk diverges from what the
generator produces, and the generated list comes out `as const satisfies readonly AgentKey[]`
— a name the web's roster doesn't know breaks the web's build. The engine
does NOT receive the list (there's no consumer there). Even with both copies
locked, what decides what's accepted is still
`RequestManualHandoffUseCase`.

- **Where:** `src/domain/agents/agent-areas.ts` (`addressableAgents`,
  `SOLO_CONVERSATIONAL_AGENTS`); `src/application/use-cases/agents/request-manual-handoff.use-case.ts`;
  `scripts/gerar-areas.ts` (`renderWeb`, which writes the list into the
  web); `apps/web/src/lib/agent-areas.generated.ts` (GENERATED copy,
  reexported by `apps/web/src/lib/agents.ts`)
- **Test:** `test/domain/agents/agent-areas.spec.ts`
  (`describe('addressableAgents (ADR 0109)')` and
  `describe('a lista solo sai do gerador para o web (AT-046)')`, plus the
  freshness check of the web's file); `test/application/use-cases/agents/request-manual-handoff.use-case.spec.ts`
  (refuses a subagent AND refuses an unknown agent); `apps/web/src/lib/agents.test.ts`
- **ADR:** [0109](../adr/0109-handoff-manual-a-agente-a-escolha.md)
- **Origin:** team model backlog — an item open since PHASE 13c,
  closed by the real case of the Staff (ADR 0088) and of the UX Designer (ADR 0087),
  both with engine plumbing ready and no human path to them

---

### RN-441 — `POST .../sessions/:sessionId/handoffs` requires `developer`; a manual handoff is born `offered`, with no new state {#rn-441}

The only path to write `toAgent` is still `CreateHandoffUseCase`
(ADR 0038) — not a second mechanism. `RequestManualHandoffUseCase`
resolves `fromAgent` on its own (the session's most RECENT `agent.activated`,
via `SessionEventRepository.listByTypeInSession` — the same criterion as
`activeAgent` in `SessionPage.tsx`, finding 9-fix; a session with no agent
activated yet falls to the `"usuario"` sentinel, never a guessed name) and
calls `CreateHandoffUseCase.execute` passing `actor: {kind: 'user', id:
userId}` — `CreateHandoffInput` gained the optional field `actor?: Actor`
for that, with default `{kind:'agent', id: fromAgent}` preserving the
usual behavior for the internal caller (the engine). The handoff
is born `offered`, the SAME way as an automatic one, and the already existing accept card
(`offeredHandoff`/`handleAcceptHandoff` in `SessionPage.tsx`)
picks it up on its own on the next `useHandoffs` poll — with NO change to the
accept path. *(It didn't pick it up, and nobody saw it until AT-253: the card matched the
offer by ACTOR, and the manual one's actor is the person. Fixed in
[RN-631](web.md#rn-631), which matches by `handoffId`.)*

The route (`POST projects/:projectId/sessions/:sessionId/handoffs`) requires
the `developer` role, the same as `handoffs/:handoffId/accept` (RN-136: those who
CONVERSE on this screen). `ux-designer` and `staff` entered `AGENTES_DE_CHAT`
(`SessionPage.tsx`) in the same change — the two `message/2` clauses already
existed in `agent_command_controller.ex` (ADR 0087/0088), verified by
reading BEFORE writing any web line, and neither of them had a
human path to itself.

- **Where:** `src/interfaces/http/agents/agents.controller.ts`
  (`requestManual`); `src/interfaces/http/agents/dto/request-manual-handoff.dto.ts`;
  `src/application/use-cases/agents/create-handoff.use-case.ts`
  (`actor?: Actor`); `apps/web/src/routes/SessionPage.tsx`
  (`AGENTES_DE_CHAT`, `.manualHandoffRow`, `handleRequestManualHandoff`);
  `apps/web/src/lib/api-client.ts` (`requestManualHandoff`)
- **Test:** `test/interfaces/http/agents/agents.controller.spec.ts`
  (required role); `test/application/use-cases/agents/request-manual-handoff.use-case.spec.ts`
  (derived `fromAgent`, `"usuario"` sentinel, `actor: user`);
  `docs/security-surface.md` + `test/interfaces/route-surface.spec.ts`
  (`role:developer` classification at runtime)
- **ADR:** [0109](../adr/0109-handoff-manual-a-agente-a-escolha.md)
- **Origin:** team model backlog (see RN-440)

---

### RN-443 — Area budget is ADDITIVE to the project/session ones, never a cascade; only `maintainer` changes the ceiling {#rn-443}

Closes the "budget per area" item of ADR 0038's cut, open since
PHASE 8. `agent_areas` gains `budget_micros` (nullable — `null` is NO
CEILING, the default) and `spent_micros` (`NOT NULL DEFAULT 0`), mirroring
exactly `max_parallel`: same row, same decision owner, same
`AgentAreaRepository`. It's **not** the model binding cascade of ADR
0064 (`session > agent > area > project > workspace`, "the most specific
wins") — the two mechanisms use the word "area" and have nothing else in
common. The area budget is a THIRD independent ceiling alongside the
project and session ones that already existed: `CheckBudgetGateUseCase.execute` now
resolves the `agentId`'s area (via `areaDo`, a pure function, without touching the database
unless it finds a match) and checks all three in parallel — any one
blocked already refuses the call, with no hierarchy among them.

`RecordLlmUsageUseCase` increments the actor's area `spent_micros` WHENEVER
it belongs to one (lead or member — `areaDo` returns an area for both),
with or without a configured `budget_micros`: the area's real spend becomes visible
even before anyone configures a ceiling. An actor without an area (user in the chat,
agent outside any area) records nothing — it isn't a silent omission,
it's the correct behavior when there's nothing to increment.

`SetAreaBudgetUseCase` requires `maintainer` (same ruler as
`SetAreaMaxParallelUseCase` — changing how much the product can spend without
asking), converts dollar→micro-USD in the controller (same convention as
`BudgetsController`) and emits no domain event (project config, with no
session to record into — the same reasoning already recorded in
`SetAreaMaxParallelUseCase`). `null` CLEARS the ceiling — a required field that
accepts `null` as a valid value (`ValidateIf`, not `IsOptional`), the same
pattern as `RenameSessionDto`.

- **Where:** `src/db/schema/agents.ts` (`agentAreas`, columns
  `budgetMicros`/`spentMicros` and the two CHECKs); `src/domain/llm/area-budget.ts`
  (`isAreaBudgetExceeded`); `src/application/use-cases/llm/check-budget-gate.use-case.ts`;
  `src/application/use-cases/llm/record-llm-usage.use-case.ts`;
  `src/application/use-cases/execution/set-area-budget.use-case.ts`;
  `src/infrastructure/persistence/drizzle/agent-area.repository.ts`
  (`setBudget`/`incrementSpent`); `src/interfaces/http/execution/execution.controller.ts`
  (`PUT agent-areas/:key/budget`); `apps/web/src/routes/settings/BudgetSection.tsx`
- **Test:** `test/application/use-cases/llm/check-budget-gate.use-case.spec.ts`
  (describe `budget de área — aditivo, não cascata`: an exceeded area blocks
  with project/session OK and vice versa, no ceiling never blocks, an agent without an
  area isn't affected); `test/application/use-cases/llm/record-llm-usage.use-case.spec.ts`
  (describe `gasto por área`: increments for the member and the lead, does nothing
  harmful without an area, adds up with no ceiling configured);
  `test/application/use-cases/execution/set-area-budget.use-case.spec.ts`
  (writes, clears with `null`, refuses negative/NaN/Infinity, zero is valid);
  `test/infrastructure/persistence/drizzle/agent-area.repository.spec.ts`
  (`setBudget`/`incrementSpent`, atomicity under concurrency)
- **ADR:** [0110](../adr/0110-budget-por-area-aditivo-nao-cascata.md)
- **Origin:** backlog item approved by the product owner in an explicit
  planning session — `docs/explanation/backlog.md`, "Older
  backlog" table

---

### RN-447 — Converting the `execution_mode` of an EXISTING project refuses (409) while any of the project's dev agents is not `idle` {#rn-447}

`ConvertProjectExecutionModeUseCase` (`PUT .../execution-mode`, role
`maintainer`) reads `engine.dev_agent_states` DIRECTLY (cross-schema, same
physical database — the same path as RN-409) by `project_id`, across ALL
of the project's sessions, not only the most recent one. Any status other than
`idle` (`working`/`blocked`/`idle_tripped`/`awaiting_gate`/
`awaiting_approval`) refuses the conversion: `Engine.Dev.DevAgentServer` does NOT
re-resolve the worktree on its own — `workspace_root` is captured ONCE, at the
worktree's creation, and swapping the column underneath it would leave the agent
writing in a scope that `permissions.json` and the terminal policy
(ADR 0055) have already abandoned. The decision is to REFUSE and explain (same
"refuse and teach" pattern as RN-088/RN-422) — never to drain or force the migration of
a live agent.

`idle_tripped` counts as ACTIVE here, unlike RN-409 (which excludes it from
`onlineAgentCount`): the two questions are different — "is someone
watching this agent work now" (RN-409) versus "is there a scope pointer
that would become stale" (here). An agent with the circuit breaker
tripped still has `workspace_root` captured, waiting for human
unblocking — it isn't "idle" for conversion purposes, even though it isn't
"online" for counting purposes.

The same (mode, path) as today is a NO-OP: the dev agent check doesn't even run —
resubmitting the form without changing anything shouldn't cost a sweep of
active agents.

- **Where:** `src/application/use-cases/iam/convert-project-execution-mode.use-case.ts`;
  `src/application/ports/dev-agent-activity.port.ts`;
  `src/infrastructure/persistence/drizzle/dev-agent-activity.repository.ts`
- **Test:** `test/application/use-cases/iam/convert-project-execution-mode.use-case.spec.ts`
  (refuses with an active dev agent, writing nothing; a no-op doesn't check);
  `test/infrastructure/persistence/drizzle/dev-agent-activity.repository.spec.ts`
  (`idle` doesn't count, everything else counts, isolation between projects)
- **ADR:** [0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md)
- **Origin:** a fix recorded in `docs/explanation/backlog.md` during
  the implementation of Wave 1 of the runner (ADR 0104), closed in this Wave 2

---

### RN-448 — `permissions.json` is RELOCATED on conversion — the content never changes, only the path {#rn-448}

`PermissionsFileStore.move(from, to)` reads the file at the OLD location
(`projectScopeRoot(localAntiga)`), writes the SAME content at the NEW
location, and deletes the old one (best-effort — if it no longer exists, there's nothing to
delete). The content (`allow`/`deny`/`ask` patterns) carries neither path nor
mode inside it, so there's nothing to REWRITE, only to move.
`from === to` (no effective root changed) is a no-op.

Confirmed by reading `projectScopeRoot` (`project-workspaces-root.ts`):
for `mounted`/`runner` the root IS the `workspacePath`, treated as a path
INSIDE THE API'S CONTAINER — in `runner`, that was already true BEFORE this
delivery (with no bind-mount, the file lives in a folder that only coincides in
STRING with the user's real folder, disconnected from it). The conversion doesn't
change that existing property, it only relocates it consistently —
with no special case for `runner` besides using `move()` like any other
pair.

- **Where:** `src/application/ports/permissions-file-store.port.ts`
  (`move`); `src/infrastructure/filesystem/fs-permissions-file-store.ts`
- **Test:** `test/infrastructure/filesystem/fs-permissions-file-store.spec.ts`
  (content survives and is deleted from the origin; an origin without a file writes empty
  without throwing; `from === to` is a no-op)
- **ADR:** [0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md)

---

### RN-449 — Leaving `container`, the container lifecycle is ended (`removed`) BEFORE the column changes {#rn-449}

`ConvertProjectExecutionModeUseCase` calls
`RegistrarTransicaoDeContainerUseCase` (ADR 0081) to take the
`project_containers` row to `removed` — via `stopped` first when it's
`running` (`container-lifecycle.ts` has no direct
`running -> removed` edge) — BEFORE writing the new `execution_mode`. The order is
mandatory: `RegistrarTransicaoDeContainerUseCase` refuses (400) any
transition in a project that isn't in `execution_mode = 'container'`
AT THE MOMENT of the call, so calling it after swapping the column would always
fail. With no container row (a project that never provisioned), no
transition is triggered.

Entering `container` from `mounted`/`runner` does NOT auto-provision
anything — the Arquiteto's image gate (RN-105) and the normal lifecycle
apply from then on, as for any `container` project — never a
shortcut that skips the gate because the project "already had code somewhere".

- **Where:** `src/application/use-cases/iam/convert-project-execution-mode.use-case.ts`
  (`removerContainerSeExistir`)
- **Test:** `test/application/use-cases/iam/convert-project-execution-mode.use-case.spec.ts`
  (`running` goes through `stopped`; `provisioning` goes directly; with no row,
  no transition; entering `container` never triggers a transition)
- **ADR:** [0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md)

---

### RN-450 — `workspaceVerifiedAt` resets on EVERY real conversion, even going back to `runner` with the "same" path {#rn-450}

It only makes sense in `execution_mode: 'runner'` (RN-423): a timestamp
proving that a CONNECTED runner confirmed the path on the real host.
Any conversion that actually changes the (mode, path) pair — including one
that lands in `runner` again with a seemingly equal path — resets the
field, forcing a NEW confirmation: the old timestamp attests a
verification that happened under a DIFFERENT pair, and carrying it forward
would assert a confirmation that never happened for the new state. The
no-op (RN-447) is the only exception — nothing changes, so nothing resets.

- **Where:** `src/application/use-cases/iam/convert-project-execution-mode.use-case.ts`
- **Test:** `test/application/use-cases/iam/convert-project-execution-mode.use-case.spec.ts`
  (`runner -> container` resets; no-op preserves)
- **ADR:** [0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md)

---

## An attached local folder becomes the fourth scope of the RAG index, read by the BROWSER (RN-455..457, ADR 0113) {#pasta-local-anexada-vira-o-quarto-escopo-do-indice-rag-lido-pelo-navegador-rn-455-457-adr-0113}

A request from the product owner: attach a folder from the user's OWN machine
to a project as reading reference for the agents — without requiring the
`brabo-runner` CLI (ADR 0103), unlike `execution_mode: runner` (ADR 0104),
which needs a real HOST path because it routes commands there. The browser
reads the CONTENT of the files (`File.text()`) and the RELATIVE path inside the
chosen folder (`File.webkitRelativePath`) — never an absolute machine path,
because the browser's `File` API does not expose one, to any site. What crosses
the network is text the browser already had the right to read, the same trust
model as any ordinary file upload.

### RN-455 — `chunks.scope` gains `'local'`, reusing the entire RAG pipeline {#rn-455}

`ChunkScope` goes from `'docs' | 'adr' | 'session'` to include `'local'`
(migration `0052`, `ALTER TYPE ... ADD VALUE`) — additive, with no data
migration, no new CHECK: the two CHECKs of `chunks` (migration `0045`) are already
written as "is `session` or isn't", so `local` falls on the same side as
`docs`/`adr` (has `source_path`, doesn't have `session_id`) with no change
at all besides the enum value. `origemDoChunk` (`domain/rag/rag-citation.ts`)
needed no new branch: a `local` chunk carries `sourcePath`
exactly like `docs`/`adr`, so it falls into the `kind: 'file'` the citation already
knew how to render.

- **Where:** `src/db/schema/rag.ts` (`chunkScopeEnum`),
  `src/db/migrations/0052_chunks_local_scope.sql`,
  `src/application/ports/chunk-repository.port.ts` (`ChunkScope`),
  `src/application/use-cases/rag/index-local-folder.use-case.ts`
- **Test:** `test/application/use-cases/rag/index-local-folder.use-case.spec.ts`
  (happy path and full rebuild), `test/interfaces/http/rag/rag.controller.spec.ts`
- **ADR:** [0113](../adr/0113-pasta-local-anexada-via-navegador-vira-chunks-scope-local.md)
- **Origin:** product owner's request

### RN-457 — `maintainer`, and reattaching is the MECHANISM to resync — never the generic "Reindex now" {#rn-457}

`POST .../rag/local` requires `maintainer`, the same ruler as `POST .../rag/reindex`
(RN-238): both call the embedding provider and replace what the
project had already indexed. `ReindexProjectUseCase` was NOT extended to
cover `local` — it reindexes by reading from a source the SERVER can
revisit (the project's repository, the event log), and `local` has no
source at all to revisit: the text only exists in the browser of whoever
attached it, and the server never kept any host path (there isn't one).
Calling `deleteByScope(projectId, 'local')` on the generic button would delete the
attached reference with no way to recreate it — reattaching the folder (a new
upload) IS the resync mechanism, and it's a deliberately
separate button. Both use cases carry a cross comment explaining
why, so that a future "fix" doesn't rewire the two and silently
delete the user's material.

- **Where:** `src/interfaces/http/rag/rag.controller.ts`
  (`anexarPastaLocal`, `@RequireRole('maintainer')`),
  `src/application/use-cases/rag/reindex-project.use-case.ts`
  (comment "Por que `local` NÃO entra aqui")
- **Test:** `test/interfaces/http/rag/rag.controller.spec.ts`
- **ADR:** [0113](../adr/0113-pasta-local-anexada-via-navegador-vira-chunks-scope-local.md)
- **Origin:** product owner's request

### RN-458 — `local` coverage has its OWN shape, and `lastAttachedAt` is the ONLY real exception to "never Xmin" (RN-237) {#rn-458}

`RagCoverage.local` doesn't reuse `RagFileCoverage` (RN-237, ADR 0080): there's no
"total in the repository" to compare — an attached folder has no total
the server can recount. `RagLocalCoverage` shows what is
indexed NOW (`filesIndexed`, `folderName`) and `lastAttachedAt`, a
REAL `MAX(chunks.created_at)` over the scope — the only declared exception
to the rule of never showing a guessed "reindexed Xmin ago", because here the
real value EXISTS and is cheap to compute (the same `todosOsChunks` that
`GetRagCoverageUseCase` already fetches).

- **Where:** `src/application/use-cases/rag/get-rag-coverage.use-case.ts`
  (`RagLocalCoverage`), `apps/web/src/components/rag/RagCoveragePanel.tsx`
- **Test:** `test/application/use-cases/rag/get-rag-coverage.use-case.spec.ts`,
  `apps/web/src/components/rag/RagCoveragePanel.test.tsx`
- **ADR:** [0113](../adr/0113-pasta-local-anexada-via-navegador-vira-chunks-scope-local.md)
- **Origin:** product owner's request

## Ollama nativo no bootstrap dev e pull de modelo Hugging Face (RN-461..463, ADR 0114/0115)

### RN-462 — A Hugging Face model pull requires explicit two-step confirmation; it never runs on its own {#rn-462}

`POST .../huggingface/pull-requests` only CREATES the request, in
`pending_confirmation` — no download starts. Only a SEPARATE call,
`POST .../pull-requests/:id/confirm`, moves the request to
`confirmed` → `pulling` and actually calls `OllamaProvider.pullModel`.
`ConfirmModelPullUseCase` REFUSES (409) to confirm a request that is no longer
in `pending_confirmation` — the state transition IS the second
confirmation, not a separate flag, and that's why it isn't re-executable. An
Ollama failure during the pull marks the request `failed` with a `failedReason`
prefixed by the origin (`infra`/`modelo`/`código`, ADR
0020's vocabulary) — never a silent failure, and nothing is activated in the catalog when it fails.

- **Where:** `src/application/use-cases/llm/huggingface/request-model-pull.use-case.ts:23`
  (`RequestModelPullUseCase`),
  `src/application/use-cases/llm/huggingface/confirm-model-pull.use-case.ts:45`
  (`ConfirmModelPullUseCase`),
  `src/interfaces/http/llm/huggingface-models.controller.ts:109-165`
  (the two routes, `role:maintainer`)
- **Test:** `test/application/use-cases/llm/huggingface/request-model-pull.use-case.spec.ts`
  (creates in `pending_confirmation`, nothing more),
  `test/application/use-cases/llm/huggingface/confirm-model-pull.use-case.spec.ts`
  (the happy path activates in the catalog; an Ollama failure marks `failed` with the
  right origin — `modelo`/`infra`; refuses to reconfirm a request that has already
  left `pending_confirmation`; 404 for a request nonexistent in the
  workspace)
- **ADR:** [0115](../adr/0115-pedido-de-pull-de-modelo-huggingface-tabela-propria.md)
- **Origin:** product owner's request

### RN-463 — An allowlist of official publishers; community requires explicit opt-in with a security warning {#rn-463}

Search on the Hugging Face Hub filters to OFFICIAL publishers by default —
`HUGGINGFACE_OFFICIAL_PUBLISHERS`, a CLOSED vocabulary curated by hand
(`meta-llama`, `google`, `mistralai`, `microsoft`, `Qwen`, `deepseek-ai`,
`openai`, `nvidia`), compared by EXACT case equality — a lowercase
reupload (`qwen/...`) doesn't inherit the official org's seal (`Qwen/...`).
`includeCommunity=true` brings all the rest, each result marked
`official: true|false`, never hiding the distinction. On screen, the
community toggle is born OFF and, while on, shows a security
warning (`Alert tone="danger"`) — the opt-in and the warning are the same gesture,
never a preference the user turns on once and forgets is on.

- **Where:** `src/domain/llm/huggingface-official-publishers.ts:17-41`
  (`HUGGINGFACE_OFFICIAL_PUBLISHERS`/`isOfficialPublisher`),
  `src/application/use-cases/llm/huggingface/search-huggingface-models.use-case.ts:28-39`
  (default filter), `apps/web/src/components/HuggingFaceModelBrowser.tsx:190-203`
  (toggle + warning `Alert`)
- **Test:** `test/domain/huggingface/huggingface-official-publishers.spec.ts`
  (recognizes an allowlisted publisher; refuses a third-party reupload;
  case-sensitive; a `repoId` without `/` never matches),
  `test/application/use-cases/llm/huggingface/search-huggingface-models.use-case.spec.ts`
  (only official ones by default; `includeCommunity` brings all, marked),
  `apps/web/src/components/HuggingFaceModelBrowser.test.tsx`
  (the toggle is born off and only shows the warning when on; search respects
  `includeCommunity`)
- **ADR:** [0115](../adr/0115-pedido-de-pull-de-modelo-huggingface-tabela-propria.md)
- **Origin:** product owner's request

## Runner configuration by the browser (RN-464..466, ADR 0118) {#configuracao-do-runner-pelo-navegador-rn-464-466-adr-0118}

### RN-464 — Runner device key: self-service registration/revocation; NO maintainer view in this round (declared cut) {#rn-464}

> **Revised by [RN-687](web.md#rn-687) ([ADR 0203](../adr/0203-aposenta-o-fluxo-do-runner-pelo-navegador.md), 01/10):**
> the browser flow was RETIRED, and `POST .../runner-device-keys` left with
> it — along with `RegisterRunnerDeviceKeyUseCase` and its test, cited below as
> they were. `GET`/`DELETE` and self-service revocation remain; the new key is
> born in the terminal (RN-551) and who registers it is the installer (RN-552).
> The project keys already registered remain valid and revocable.

`runner_device_keys` stores only the PUBLIC Ed25519 key of a runner device —
generated in the browser, never the private one. `POST/DELETE
.../runner-device-keys` require minimum role `developer` and are authenticated
by the normal SESSION JWT (unlike `runner-ticket`: the caller here is the
already-logged-in browser registering its own device, not the runner running
without a session). `RegisterRunnerDeviceKeyUseCase` validates only the minimal
SHAPE of the JWK (`kty:"OKP"`, `crv:"Ed25519"`, `x` present) — the deep
validation (is it really a valid Ed25519 point) is left to `jose.importJWK` at
the time of use, in RN-465. `RevokeRunnerDeviceKeyUseCase` is IDEMPOTENT and
scoped to the calling `userId` — same design as `revogar()` of RN-426 — and
returns 404 both for a nonexistent key and for another user's key, the same
discipline of not leaking existence.

**Declared asymmetry with the PAT**: unlike RN-427 (`maintainer` revokes the
PAT of ANY user of the project, incident response), the device key does NOT
today have an equivalent `maintainer` route — only self-revocation. The
docblock of `RunnerDeviceKeysController` declares this explicitly as a cut of
this round, not an oversight: extending the same RN-427 pattern to device keys
is direct future work, if it comes to be requested.

- **Where:** `src/db/schema/auth.ts:338` (`runnerDeviceKeys`),
  `src/application/use-cases/auth/register-runner-device-key.use-case.ts`,
  `src/application/use-cases/auth/revoke-runner-device-key.use-case.ts`,
  `src/interfaces/http/runner/runner-device-keys.controller.ts`
- **Test:** `test/application/use-cases/auth/register-runner-device-key.use-case.spec.ts`,
  `test/application/use-cases/auth/revoke-runner-device-key.use-case.spec.ts`
- **ADR:** [0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
- **Origin:** request from the product owner

### RN-465 — `POST .../runner-ticket` accepts a PAT OR a device key (Ed25519, TTL ≤60s) — a second form of DEVICE credential, never dual-auth with a session JWT (distinction from RN-439) {#rn-465}

> **Revised by [RN-687](web.md#rn-687) ([ADR 0203](../adr/0203-aposenta-o-fluxo-do-runner-pelo-navegador.md), 01/10):**
> nothing in this RN changed in the guard — the `PatAuthGuard` still accepts the
> JWT of a PROJECT key, and that is why a runner configured by the browser
> before ADR 0203 does not break. What ceased to exist is creating a NEW project
> key: the browser no longer generates the pair.

`PatAuthGuard` gained a second path, next to the unchanged PAT (`brb_...`): a
bearer in compact JWT format (three segments) is treated as a device key. The
guard reads the header's `kid` (without verifying the signature yet), looks up
the corresponding ACTIVE public key in `runner_device_keys`, and only then
verifies the EdDSA signature with `jose.importJWK`/`jwtVerify`. A short and
MANDATORY TTL: `exp - iat` cannot exceed 60s — checked against the token's
SIGNED lifetime, not against "now", closing the replay window of a leaked JWT
from the moment it was signed. The `userId`/`projectId` used to authorize always
come from the RECORD saved in the database, never from a JWT claim — the token
only needs to prove possession of the private key, never claim who the owner is.
`projectId` is checked TWICE (the JWT claim against the route, and the key's
registered project against the route) — the same 401 vs 403 discipline the PAT
path already uses: a valid token/key for the WRONG project is a different
category from an invalid token/key. The runner signs this JWT in
`assinarTicketComChaveDeDispositivo` (`apps/runner/src/auth.ts`), with the
private JWK already LOADED in memory — never reading a file there, preserving
the "no file I/O" guarantee of `auth.ts` (what reads the file is the separate
module of RN-466).

**This does NOT reopen RN-439**: RN-439 settled the guarantee that
`runner-ticket` never accepts the LOGIN JWT as a credential — it still stands.
The device key is a DIFFERENT JWT, self-signed by the runner itself with a key
whose private part the api never saw, with no user `sub` at all — just a second
way of proving "I am the device of such-and-such user in this project", as
scoped as the PAT it complements. Accepting the session JWT here would make
`RolesGuard`/`@RequireRole` authorize that user for everything their role
allows in the rest of the api, blowing the `runner:project:<id>` scope —
exactly what RN-439 prevented.

- **Where:** `src/interfaces/http/auth/pat-auth.guard.ts:104-216`
  (`autenticarChaveDeDispositivo`), `apps/runner/src/auth.ts:143-188`
  (`assinarTicketComChaveDeDispositivo`, `obterTicketDoRunnerComCredencial`)
- **Test:** `test/interfaces/pat-auth.guard.spec.ts` (describe
  "chave de dispositivo (JWT EdDSA autoassinado, ao lado do PAT)" — happy path,
  invalid signature, revoked key, the claim's `projectId` does not match the
  route, key registered in another project, TTL too long, `kid` with no
  matching key), `apps/runner/src/auth.spec.ts` (describe
  "assinarTicketComChaveDeDispositivo"/"obterTicketDoRunnerComCredencial")
- **ADR:** [0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
- **Origin:** request from the product owner

## Os dois tetos de rebaixamento em `project_members` (RN-472)

### RN-472 — Nobody downgrades the workspace `owner`, and nobody downgrades themselves {#rn-472}

[RN-471](web.md#rn-471) recorded that `ResolveEffectiveRoleUseCase.forProject` is
`projectRole ?? workspaceRole` — the project row OVERRIDES the workspace one, in
both directions. What it didn't keep is the consequence:
`AddProjectMemberUseCase` was a one-line passthrough to the upsert, and
neither of the two write paths looked at WHO the target is. Any
`maintainer` could (a) downgrade the **workspace `owner`** to `viewer` in a
project, taking the owner out of their own project, and (b) **downgrade themselves with no way to
undo it**, because undoing is the same route, which requires `maintainer`.

**The override STAYS in both directions.** `forProject` doesn't change. Restricting
someone in a sensitive project (workspace `developer` → `viewer` in project X) is a
deliberate capability, and "the higher of the two" would eliminate it — the
`resolve-effective-role.use-case.spec.ts` fixes the upward half since Phase 1.
What comes in are TWO ceilings, and only them:

| ceiling | what it refuses | status |
|---|---|---|
| 1 | a role below `owner` for whoever is the WORKSPACE `owner` | 403 |
| 2 | a role below what the CALLER has today, when the target is themselves | 403 |

**The `owner` is `workspace_members.role`, never `workspaces.created_by`.** Both
exist in `db/schema/iam.ts` and they're not the same thing: `created_by` is a historical
fact, and it's the `role` that authorization uses in all the rest of the system
(`forWorkspace` is `workspaces.findMemberRole`; `created_by` doesn't appear in any
authorization path). Reading `created_by` would shield the creator who has already
transferred ownership and leave uncovered the current `owner` who created
nothing — the hole the ceiling exists to close.

**Ceiling 2 is "themselves", with no threshold** — not "below `maintainer`". The
version with a threshold would copy a number from the controller's `@RequireRole` into the
domain and would age silently if the route changed its minimum. The price, declared: the
`owner` who wanted to set themselves as `maintainer` in their own project (a
reversible move) is also refused, and now needs another `maintainer`. **Raising**
one's own role isn't a downgrade and still passes.

**The ceilings live in the USE CASE, with the rule in the domain — not in `RolesGuard`.**
The guard authorizes the CALLER against the route's `@RequireRole` and doesn't see the body
(`dto.role`) nor the target (`dto.userId`); the two ceilings are about the TARGET and about the
actor↔target relation. The SHAPE is that of `domain/actions/decide.ts` (RN-154/RN-418):
a pure function, the message next to the condition, with no configuration key. What doesn't
carry over is the outcome — there the ceiling becomes `require_approval` over an agent's
`proposed_action`, here the call is already human and synchronous and there's no queue
to send it to.

**403, not 409 nor 400:** it's an authorization refusal — the caller has the
route's role and doesn't have authority for this move. Waiting changes nothing (it isn't a
state conflict) and the body is valid (the same body with another target would pass).

**What the ceilings do NOT cover, and remains possible:** downgrading another `maintainer` who
isn't a workspace `owner`; **self-downgrade through REMOVAL** —
`RemoveProjectMemberUseCase` got no ceiling, and removing one's own row drops
the effective role to the workspace role, which is benign when the workspace holds it and
irreversible when it doesn't (`maintainer` only through the project row, `viewer`
in the workspace); self-PROMOTION, which was already possible before; and downgrading the `owner`
IN THE WORKSPACE (`POST workspaces/:workspaceId/members` still has no ceiling). The two
removal cases are FIXED in tests, including the open one.

**The screen is left for later, and the refusal shows up.** `MembersSection` computes ceiling
2 on its own, but not ceiling 1: `listProjectMembers` returns the role of the PROJECT
ROW, and the target's workspace role isn't within the client's reach. Half a
gate would be a `Select` honest about one refusal and silent about the other — the
second source of role RN-471 writes against. Meanwhile,
`handleRoleChange` already shows `mensagemDaApi(erro, …)` in a toast (RN-471), and it's the
api's sentence that says which ceiling was hit.

- **Where:** `src/domain/iam/tetos-de-rebaixamento.ts`
  (`rebaixaOwnerDoWorkspace`, `ehAutoRebaixamento`, and the two messages),
  `src/application/use-cases/iam/add-project-member.use-case.ts`
  (where both are applied, before the upsert),
  `src/interfaces/http/iam/projects.controller.ts` (the `@CurrentUser()`
  that gives the actor, and the two fixed descriptions),
  `src/interfaces/http/iam/dto/add-member.dto.ts` (the third),
  `src/application/use-cases/iam/resolve-effective-role.use-case.ts`
  (UNTOUCHED — `projectRole ?? workspaceRole` stays as it is),
  `src/db/schema/iam.ts` (`workspaces.created_by` × `workspace_members.role`)
- **Test:** `test/application/use-cases/iam/tetos-de-rebaixamento.use-case.spec.ts`
  (both ceilings refusing; a workspace `owner` receiving project `owner`
  passes; self-downgrade also when the actor's role comes from the project
  row; self-promotion passes; the TWO legitimate capabilities preserved —
  downgrading another person, and a workspace `viewer` becoming `maintainer` in the
  project; self-removal allowed; and the removal that still downgrades whoever called it,
  fixed as a declared gap)
- **Origin:** [ADR 0127](../adr/0127-tetos-de-rebaixamento-em-project-members.md),
  on the finding from the review of #444 recorded in RN-471

---

## The `kid` is the link, and the refusal has a name (RN-475) {#o-kid-e-o-vinculo-e-a-recusa-tem-nome-rn-475}

### RN-477 — Provisioning that fails SAYS it failed, and the wait for it has a ceiling {#rn-477}

Repository provisioning runs **entirely inside the POST** — there's no
worker nor queue behind it (the OpenAPI description that promised "continues in
the background" was wrong and was fixed). A failure, therefore, has already
happened when the response arrives. This RN is about the screen never asserting
"provisioning" about work that has already ended badly.

**Every failure becomes a DURABLE state, and there were two paths that didn't.** The
first is `step.check()`, which was outside every `try/catch` in the
`BootstrapRunner` and does network IO: a 401 from an expired token, a 403, or a
timeout went up without touching the row, which stayed `pending` with
`lastError: NULL`. The second is the refusal in `createRepo`, which happens **before
the row exists** — `repo_bootstraps` is only born after the provider
confirms the repository, so the project was left with ZERO rows. Now the
first writes `status: 'failed'` + `lastError` in a single place (the step's
`catch`) and emits `bootstrap.step_failed`; and the second is read by the
status endpoint from the failed `proposed_action` `git_repo_create`.

**The creation failure does NOT invent a step.** `failedStep` stays `null`: the
repository never came to exist, so none of the six Gitflow steps was
attempted, and naming one to fill in the sentence would be swapping a silence for
wrong information. The screen has its own title for that case, without `{{step}}`.

**The screen shows the reason and offers a way out.** The empty-bodied `.catch(() => {})`
of `ProvisioningPage` — whose comment asserted that "the failure appears via
bootstrapQuery", which was false on both paths above — now keeps the
api's message and displays it. The "Try again" button no longer depends on
`status === 'provision_failed'`: it also appears when the POST refused,
which is precisely when there's no failure status to depend on.

**The wait has a CEILING and three states that don't collapse**, exactly like
[RN-474](web.md#rn-474) and for the same reason: the 1s poll was infinite. After 3
minutes without converging, the screen says it stopped following, **declares that this
doesn't prove failure** (provisioning runs inside the request, and a
slow provider may still be working) and offers "look again" —
which rearms the wait **without** triggering a second POST, because a second POST
would create one more bootstrap session.

**The dashboard card knows.** The read model queries the failed `git_repo_create`
actions together with the bootstrap rows, so a project that failed before a
cursor existed no longer appears without any badge — and the click once again leads
to the provisioning screen, which only redirected on `provision_failed`.

- **Where:** `src/application/use-cases/git/bootstrap-runner.ts:181`
  (the step's `catch`, the only place that declares failure),
  `src/domain/git/repo-bootstrap-status.ts:29` (the second argument),
  `src/application/use-cases/git/get-repo-bootstrap-status.use-case.ts:59`
  (the creation failure read from the `proposed_action`),
  `src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
  (the card's badge), `apps/web/src/routes/ProvisioningPage.tsx` (reason, retry,
  and ceiling)
- **Test:**
  `test/application/use-cases/git/provision-repository.use-case.spec.ts`
  (a failure in CHECK becomes `failed` with reason and event; a failure to CREATE leaves no
  row but the status reports it, with null `failedStep`),
  `test/domain/git/repo-bootstrap-status.spec.ts` (no row with a creation
  failure; with a row the old failure is ignored; pure `pending`),
  `apps/web/src/routes/ProvisioningPage.test.tsx` (the reason appears; the retry
  exists without `provision_failed`; the wait stops and says what it doesn't know; a title without
  a step doesn't invent one)
- **Origin:** real use by the product owner — provisioning stayed "Pending"
  forever, and the cause (`permissão negada: /data/git-repos/exp001.git`, a
  development Docker volume that was born `root`) was recorded only in
  `proposed_actions.execution_result`, which no screen reads

## A busca do RAG deixa rastro, e o rastro congela os pesos (RN-479..481)

### RN-478 — `permissions.json` lives where the api REACHES, the terminal scope points to the HOST {#rn-478}

The project root had **one** derivation (`projectScopeRoot`) and **two**
consumers with opposite needs. That was right while the two modes
with a user folder were bind-mount; it stopped being so when `runner` mode
was born ([RN-423](runner.md#rn-423), [ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)),
because it's deliberately **without** bind-mount.

| consumer | needs | why |
|---|---|---|
| terminal scope ([ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md)) | the **host's** path | that's where the command runs — on the user's machine, through the runner |
| `permissions.json` (the api reads **and writes**) | a path **the api reaches** | it writes it from inside its container |

**They're two derivations, and both live in the same file** — the source remains
single, what split was the question. `projectScopeRoot` stays **unchanged**;
`permissionsFilePath` is new and diverges from it at a single point: in
`runner` mode the file goes to
`<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>/permissions.json`, the managed
root, keyed by the name [RN-109](#rn-109) freezes at creation.
`container` and `mounted` don't change — in `mounted` the folder **is** a bind-mount, and
moving the file would break projects that already have it on disk with no gain.

**Why the managed root and not the user's disk**, given the code is
there: `permissions.json` is **policy**, not project code. Who reads it is the
api; the runner never reads it (it receives an already approved command) and the engine doesn't touch it at
any point — all mentions of it in `apps/engine/lib` are comments.
Keeping it on the user's machine would make it editable by whoever it restricts, and
unreadable precisely when the runner is disconnected, which is when the decision
needs to remain valid.

**What this fixed.** Execution activation is the first **write** of the
file, and it did `mkdir -p` of a host path inside the api's
container: `EACCES: permission denied, mkdir '/home/<usuario>'` → **500**. The
**read** degraded silently (ENOENT → `EMPTY_PERMISSIONS_FILE`), and that's why
the bigger effect slipped through unseen: **in a `runner` project the
`permissions.json` never existed**, and `decide()` always fell to
`require_approval` because of a file that wasn't there.

**Declared cost:** for a `runner` project, the policy file no longer
lives next to the code — whoever looks for it in the project folder won't find it.

**A typed refusal, and 400 instead of 500.** The derivation's two `throw new Error(...)`
become `LocalizacaoDeProjetoInvalidaError`, in the mold of
`CaminhoLocalInvalidoError`: a readable `motivo` in pt-BR, and
`ActivateExecutionUseCase` maps it to **400**. An incoherent project row (the
(mode, path) pair only becomes invalid by being written outside
creation) now says what to fix instead of becoming a body-less 500. The
Overview screen now shows that message — it printed the constant
"Could not activate execution" while the twin button in the session chat
already used `mensagemDaApi`: same button, two diagnoses.

**The gap that REMAINS, declared:** the engine has the **same** defect and it wasn't
fixed here. `Engine.Actions.Workspace.ensure!/4` does
`File.mkdir_p!(workspace_dir(project_id))`, which in a `runner` project is the
host's path — the dev agent's working tree has nowhere to be born. It doesn't become a
500 (the `rescue` of `ensure_remoto/2` returns `{:error, …}`), it becomes a dev agent that
doesn't work. Fixing it in isolation would be materializing a worktree on the host through a path
that container execution replaces; what changes now is only the
**message**, which names the cause instead of passing on a raw "permission denied".

- **Where:**
  `src/infrastructure/filesystem/project-workspaces-root.ts:231`
  (`projectScopeRoot`, unchanged) and `:319` (`permissionsFilePath`, the second
  derivation), with `LocalizacaoDeProjetoInvalidaError` at `:219`,
  `src/infrastructure/filesystem/fs-permissions-file-store.ts:77`
  (the only caller of the file's path),
  `src/application/use-cases/execution/activate-execution.use-case.ts:176`
  (the 400), `src/interfaces/http/execution/execution.controller.ts:74`
  (the OpenAPI annotation, which promised 409 for two cases that were never
  409), `apps/web/src/routes/ProjectOverviewTab.tsx:485`
  (`mensagemDaApi`), `apps/engine/lib/engine/actions/workspace.ex:61`
  (the message of the gap that remains)
- **Test:**
  `test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (`permissionsFilePath` in the three modes; and the **non-regression** of
  `projectScopeRoot` still returning the host's path in
  `runner`/`mounted` — unifying the two back would break ADR 0055),
  `test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  (with the REAL `FsPermissionsFileStore`: the file lands in the managed root
  and the host folder stays untouched; an incoherent row becomes a 400 that teaches),
  `apps/web/src/routes/ProjectOverviewTab.test.tsx` (the api's message on
  screen), `apps/engine/test/engine/actions/workspace_runner_test.exs` (the failure
  names the cause in a `runner` project, and passes intact in the other modes)
- **Origin:** real use by the product owner — "Activate execution" answering 500
  on the `exp002` project

---

### RN-479 — Every hybrid search writes a row in `rag_searches`, with FROZEN weights; and telemetry never takes down the search {#rn-479}

`src/domain/rag/rag-search-limits.ts` declares, in its own comment,
that **none** of the four hybrid search numbers (the two weights, the threshold, and the
number of candidates) comes from calibration with real data. It didn't because there was
no way to: the search left no trace at all — neither a table row nor an event.
Calibrating without measuring would be trading one guess for another.

`HybridSearchUseCase` now writes, on each search, what it returned
(`hits`, with the 1-based **rank** of each excerpt), under which conditions
(`degraded`/`vector_available`), how long it took (`latency_ms`), who searched
(`actor_kind`/`actor_id`), and in which session — or in NONE.

**Why a TABLE and not just a session event.** `session_events.session_id` is
`NOT NULL`, and a search coming from the RAG tab is a PROJECT one: it has no session.
Recording it only as an event would lose exactly the searches in which a human looked at
the scores and judged, which are the ones carrying the real signal. It's the same
class of problem that forced the embedding metering cut
([ADR 0075](../adr/0075-embeddings-no-contrato-de-llm-provider.md),
`token_usage.session_id NOT NULL`), and the way out is the same: an own table, with
NULLABLE `session_id`.

**`pesos` frozen in the row is the point.** `pesosVigentes()` copies the values of the
moment into the record — the same discipline as the frozen price in
metering ([ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md))
and the `image_version` in `project_containers`. Without the copy, the first
calibration that touched `RAG_SEARCH_WEIGHT_VECTOR` would make all the
previous measurement start meaning something else, silently — and "did it improve after the
change?", the only question telemetry exists to answer, would become
impossible to ask.

**Recording telemetry NEVER takes down the search, and also doesn't fail SILENTLY.** Whoever
asks shouldn't lose the answer because the measuring instrument went down; and
the repository is explicit about failure that becomes silence ([RN-059](engine.md#rn-059)).
So a failing INSERT becomes a log with the origin classified (`infra`,
[RN-023](engine.md#rn-023)) and `searchId: null` in the response — which isn't the same as "there was
no result": it's "there's nothing to attach a vote to", and the screen needs both
separate so as not to offer a control the api would refuse
([RN-088](web.md#rn-088)).

`degraded` and `vector_available` are two columns on purpose, and today's redundancy
(`degraded = !vector_available`) is declared in the schema instead of
hidden: `vector_available` is a fact about the PROVIDER — it's what makes
`medir:rag` fail —, and `degraded` is the word of the CONTRACT with the engine, whose
definition may grow.

- **Where:** `src/domain/rag/rag-telemetry.ts` (`pesosVigentes`,
  `RagSearchHitTelemetry`), `src/db/schema/rag.ts` (`ragSearches`),
  `src/application/use-cases/rag/hybrid-search.use-case.ts`
  (`registrarBusca`),
  `src/infrastructure/persistence/drizzle/rag-telemetry.repository.ts`
- **Test:**
  `test/application/use-cases/rag/hybrid-search.use-case.spec.ts`
  (the row written with rank and weights; the weights being a COPY and not the same object;
  the tab's search without a session; and the FAILURE CASE — an insert that fails doesn't take down the
  search and returns `searchId: null`)
- **ADR:** [0129](../adr/0129-telemetria-de-busca-do-rag-como-tabela.md) — why
  it's a TABLE and not an event, and why the weights go frozen;
  [0080](../adr/0080-busca-hibrida-pesos-limiar-e-citacao.md), whose numbers this
  RN does **not** revise: it provides the instrument to revise them later
- **Origin:** the product owner's plan, Part 2 / Stage 1

### RN-480 — The vote on an excerpt is the only TRUTH signal of the measurement, and it requires the reference the search returned {#rn-480}

Latency and degradation rate say whether the search RAN; only the vote says whether it
GOT IT RIGHT. `rag_feedback` keeps that vote — two values (`util`/`irrelevante`)
and not a 1-to-5 scale, because a fine scale invites differences of ruler
between voters that no aggregation recovers later.

**The reference is mandatory, and the two refusals are 400s that TEACH.**
A `searchId` that doesn't exist in that project, and a `chunkId` that wasn't among the
hits of that search, are refused before any write. It isn't decorative
rigor: the **rank** of the voted excerpt is what separates two diagnoses that
`precision@1` confuses — a poor index doesn't return the right excerpt in any
position, a wrong weight returns the right excerpt at rank 7. A vote without rank produces
a meaningless number, which is worse than no number.

The refusal applies on both paths: through the tab it becomes a 400 on screen; through the agent it becomes an
**error tool-result** the model can fix in the next iteration
([RN-061](engine.md#rn-061)/[RN-163](engine.md#rn-163)), never a crash.

**One vote per actor per excerpt per search** (`unique (search_id, chunk_id,
actor_id)`, with `onConflictDoUpdate`): changing one's mind overwrites one's own
vote. Without the lock, whoever clicked twice would weigh double in `precision@k` and
the metric would start measuring enthusiasm.

The role is `viewer`, the SAME as `search` — whoever can read the result is whoever can
judge it ([RN-102](#rn-102): the minimum is the endpoint's, and voting neither spends nor
configures anything). The agent's tool is `:direct`, never `proposed_action`:
grading an excerpt isn't an external effect, and turning it into an action to approve
would fill the queue with noise.

- **Where:** `src/db/schema/rag.ts` (`ragFeedback`, `ragVerdictEnum`),
  `src/application/use-cases/rag/record-rag-feedback.use-case.ts`,
  `apps/engine/lib/engine/harness/tools/rag_feedback.ex`,
  `apps/web/src/components/rag/RagCitationCard.tsx` (the two controls, where the
  score already is)
- **Test:**
  `test/application/use-cases/rag/record-rag-feedback.use-case.spec.ts`
  (the returned rank; and the three FAILURE CASES — unknown `searchId`,
  `chunkId` outside the hits, a search from another project),
  `apps/engine/test/engine/harness/tools/rag_feedback_test.exs` (the refusal
  coming back as a tool-result with the api's message, never a crash; `:direct`; and the
  registration in the six agents that already had `rag_search`),
  `apps/web/src/components/rag/RagCitationCard.test.tsx` (the three states of the
  control, and its absence without `searchId`),
  `test/scripts/medir-rag.spec.ts` (`precision@k` over the judged ones)
- **ADR:** [0129](../adr/0129-telemetria-de-busca-do-rag-como-tabela.md)
- **Origin:** the product owner's plan, Part 2 / Stage 1

### RN-486 — REGISTERED state and OBSERVED state never merge, and "didn't look" has its own reason {#rn-486}

`project_containers` keeps what was REGISTERED. The daemon answers what is
OBSERVED. Before the broker the table had no way to lie (`container_id` was
always `NULL`); now it has, and the read says so instead of hiding it.

**The lifecycle route returns both, separately.** A container killed from outside
appears as registered `running` and observed `exited`, and that's how it has to
appear. The reconciliation is ON READ, not a background daemon.

**`observado: null` alone isn't an answer.** It means two different
things, and `naoObservado` is what separates them: `null` there means the
observation HAPPENED and came back empty — the positive statement "I looked and there's no
container" —, while `broker-nao-configurado`, `broker-sem-resposta`, and
`broker-recusou` mean it wasn't possible to look, each with a different
fix. Inheriting the registered state in those three cases is exactly what
[RN-468](web.md#rn-468) forbids: an environment signal says what it KNOWS, and a proxy doesn't become a
guarantee.

**No broker refusal takes down the read.** The registered lifecycle is
legitimate information on its own and existed before the broker; losing it because the
broker is down would trade data we have for data we don't.

**Declared gap:** an orphan container of a project that never had a lifecycle
row doesn't appear on that route — it reads the registered first. What finds orphans is
the sweep by `brabo.managed=true`, and the page that consumes it doesn't exist yet.

- **Where:**
  `src/application/use-cases/containers/obter-estado-observado-do-container.use-case.ts`
  (the three reasons and the `null` that isn't a reason),
  `src/interfaces/http/containers/containers.controller.ts` (the route that
  returns both),
  `src/application/ports/container-broker.port.ts` (the `null` of
  `inspect` is absence; failure THROWS)
- **Test:**
  `test/application/use-cases/containers/spec-e-observacao-de-container.use-case.spec.ts`
  ("I looked and there's none" and "I couldn't look" don't collapse; without `BROKER_URL` the
  broker isn't even called; a refusal becomes a reason with detail, never an exception)
- **ADR:** [0130](../adr/0130-broker-de-container.md)

### RN-487 — The Arquiteto routes module by module, but only NOMINATES — the Infra elects {#rn-487}

`route_modules_to_infra` produces ONE list — one item `{modulo, imagemCandidata,
porque}` per module of the current `module_map` — and it becomes the
`artifact.module_routing` event, with no table: the same design as `artifact.module_map`/
`artifact.project_image`/`artifact.c4_diagram`, the event IS the artifact.

**The candidate image goes through the SAME rule as `choose_project_image`,
applied per item.** `validarDecisaoDeImagem` already refuses an image without an explicit
tag/digest, `latest`, and a `rationale` with fewer than 10 characters — reimplementing
that rule per module would create a second version of it to diverge from the
first sooner or later. `validarRoteamento`
(`domain/architecture/module-routing.ts`) delegates, and only adds what is
SPECIFIC to the list: empty is refused (it isn't a decision), and a repeated module
too (two images for the same module are ambiguous — which one holds?).

**A module outside the current `module_map` is refused naming the VALID
modules**, the same ruler as `AssignStoryModulesUseCase` (`missingModules`):
listing only what's wrong would force the model to guess against a map
it can't reread; listing the right names ends the search on the first
refusal.

**With no current `module_map`, there's no module — refused with 400, never
invented.** It's the same refusal as `create_c4_diagram` when the module_map is missing,
and for the same reason: there's no module, there's no infra to route. The
`build_kickoff/1`'s `ArquitetoServer` — the ONLY place from which the model
learns the ORDER of the tools — lists `route_modules_to_infra` as the step that
follows `create_module_map`.

**`:direct`, never `proposed_action`.** Routing has no external effect — it doesn't
bring up a container, doesn't change anything outside the event log — and is an INTERNAL
architecture decision, of the same caliber as `choose_project_image`/`create_c4_diagram`.
Putting this in the approval queue would mix a draft the Infra will still
review with decisions that already have a real effect.

**The Arquiteto nominates, the Infra elects — and this delivery is only the half that
nominates.** The half that ELECTS among the nominations (or refuses them all) is the
Infra Lead's, with its own `proposed_action`, in a separate PR. What exists here
is the auditable list in the event log, before the Infra has a tool to act
on it — the same sequencing that already held for the `module_map` existing
before `create_c4_diagram` needed it.

- **Where:** `src/domain/architecture/module-routing.ts`
  (`validarRoteamento`, `EVENTO_MODULE_ROUTING`),
  `src/application/use-cases/architecture/route-modules-to-infra.use-case.ts`,
  `src/application/use-cases/architecture/get-module-routing.use-case.ts`,
  `src/interfaces/http/internal/internal-sessions.controller.ts`
  (`POST .../module-routing`),
  `apps/engine/lib/engine/harness/tools/route_modules_to_infra.ex`,
  `apps/engine/lib/engine/agents/arquiteto_server.ex` (`build_kickoff/1`, step 4)
- **Test:**
  `test/domain/architecture/module-routing.spec.ts` (empty list,
  repeated module, and the delegation to `validarDecisaoDeImagem` — `latest` and
  short `rationale`),
  `test/application/use-cases/architecture/route-modules-to-infra.use-case.spec.ts`
  (happy path with two modules; no current module_map; a module outside the
  map; versioning when routing again),
  `apps/engine/test/engine/harness/tools/route_modules_to_infra_test.exs`
  (`:direct`; normalization of the tool call's keys; the api's refusal becoming an
  error tool-result, never a crash — RN-061)
- **ADR:** [0131](../adr/0131-roteamento-de-modulos-para-infra.md)
- **Origin:** the product owner's plan, Part 1 / PR 1.4

### RN-490 — The RAG accuracy golden-set measures by FILE PATH, in the TOP-5, never by exact chunk or rank 1 {#rn-490}

The `rag-acertivo` gate (`config/gates.yml`) measures whether the hybrid search returns the
right file for 17 questions composed from real RNs/ADRs of this
repository (golden-set, ADR 0123's mold applied to RAG). The criterion of
"got it right" has two deliberate decisions, and both avoid measuring the wrong
question:

- **File path, never exact chunk.** The chunking (1200/150) is
  precisely one of the parameters this program exists to be able to revise
  (ADR 0080) — locking the golden-set to the chunk would make ANY chunking
  adjustment break the 17 cases, even when the right file kept
  being retrieved.
- **TOP-5, never only the first position.** That's how the product uses the
  result: Chat RAG cites SEVERAL excerpts per response
  (`RagCitationCard`, plural), not only the first. Measuring against rank 1
  would measure a question the UI doesn't ask. `5`, and not the real route's
  `RAG_SEARCH_RESULT_LIMIT` (10), so as not to test a looser k than most
  real searches use.

The criterion is a PURE function (`acertouCaminhoEsperado`/`rankDoCaminhoEsperado`),
consumed by the seed (`seed-golden-set-rag.ts`) and tested in isolation — the same
discipline as `gate-registry.ts`: the decision of "this matched" doesn't depend on
how the result arrived.

The golden-set runs **manually** (`mix golden_set.rag`), never in the regular `mix test`
— the same decision already recorded for the QA golden-set (ADR 0123):
without an API LLM secret or new infra, there was no way to run a real Ollama
in CI. Excluded by a PERMANENT tag (`:golden_set_rag`) in
`test_helper.exs`, never by detecting "Ollama reachable" — the same reason
as on the QA side: this machine already has Ollama up all the time. The floor is a
RATCHET (`>=`, never `>`), a count and not a percentage, keyed by the
EMBEDDING model (`nomic-embed-text`, today the only one the product supports) and
written only by a human.

**Revised by RN-498:** "there's no way to run a real Ollama in CI" was
true in Stage 2 and stopped being so in Stage 3 (ADR 0138) — a dedicated,
scheduled workflow now really runs `mix golden_set.rag` against a
real Ollama in CI. The permanent exclusion in `test_helper.exs` above
STILL holds as is: it protects the regular `mix test` (and the machine of
any developer with Ollama up), never the new workflow, which invokes
the tag explicitly, just as was always necessary.

- **Where:** `src/domain/rag/golden-set-criterio.ts`,
  `scripts/seed-golden-set-rag.ts`,
  `apps/engine/test/engine/rag/rag_golden_test.exs`,
  `apps/engine/test/fixtures/golden_set_rag/floor.json`
- **Test:** `test/domain/rag/golden-set-criterio.spec.ts`
- **ADR:** [0132](../adr/0132-golden-set-de-acerto-do-rag.md)
- **Origin:** the product owner's plan, Part 2 / Stage 2

### RN-493 — A terminal inside the real container gains an auto-approval FLOOR, without touching the absolute ceilings {#rn-493}

When `containerExecutionActive` is true (the same REGISTERED `running`
of RN-492, queried by `ProposeActionUseCase` only for `actionType ===
'terminal'` in an `execution_mode: container` project), the INITIAL value of
`current` inside `decide()` stops being `require_approval` and becomes
`auto_approve` — a FLOOR, not a new ceiling: the stages that follow
(`agent_autonomy`, `permissions.json`) can still LOWER that floor
exactly as they already lowered the default `require_approval` (an explicit
`deny` or an `ask` matching the command win the same way), and the FIVE
absolute ceilings of `decide.ts` (scope, git push/privileged command, protected
merge, `instruction_patch`, parallelism) keep running ON TOP,
byte for byte as they were — including when the `auto_approve` came from the floor, and
not from an explicit rule.

**The justification is a SECOND boundary, not the absence of the first.** The
lexical terminal scope (`terminalNoEscopo`, ADR 0055) keeps running
over the SAME HOST paths as always — the `cwd`/`command` arriving at
`decide()` are NEVER translated to `/work` (that translation only happens
later, in the engine — RN-492). Inside the real container, a STRONGER
boundary is added on top of the lexical one: Docker's mount namespace, which the
process physically doesn't cross, plus the `/work` validation the
broker already does (`DiretorioForaDoEscopoError`). It's defense in depth — the
lexical scope isn't replaced, it's redundant.

- **Where:** `src/domain/actions/decide.ts`
  (`DecideContext.containerExecutionActive`, the conditional initial
  `current`), `src/application/use-cases/actions/propose-action.use-case.ts`
- **Test:** `test/domain/actions/decide.spec.ts` (describe "decide
  — piso do container ativo do projeto": auto-approves with no rule at all;
  unchanged without `containerExecutionActive`; doesn't affect a non-terminal action;
  explicit `agent_autonomy`/`permissions.json` lower the floor; insufficient
  IAM denies before the floor; scope still wins on top;
  git push/sudo stay `require_approval`),
  `test/application/use-cases/actions/propose-action.use-case.spec.ts`
  (describe "piso do container ativo": terminal auto-approves and EXECUTES with a
  running container; doesn't affect `container_start`; without a `running` row,
  unchanged; embedded deny/git push/sudo keep winning)
- **ADR:** [0134](../adr/0134-dev-agents-executam-dentro-do-container.md)
- **Origin:** the product owner's plan, Part 1 / PR 1.6

### RN-495 — `container_stop`/`container_remove` are born as `proposed_action`, and only `container_remove` enters the absolute ceiling {#rn-495}

Closes the gap that the comment on `ContainerBrokerPort` (ADR 0130) and the
CLAUDE.md declared since PR 1.5: `stop`/`remove` had a ready HTTP CLIENT
(`HttpContainerBrokerClient.stop`/`.remove`) and ZERO callers — the
global containers page (`/containers`, RN-496) is the first. The two are
NEVER an agent action: only a human clicking "Stop"/"Remove" on a row
of the screen proposes them.

**`container_stop` follows `container_start`'s EXACT caliber** (RN-491):
`maintainer`, `require_approval` by default, CAN be configured
`auto_approve` (never seeded) — `ExecuteContainerStopUseCase` asks the broker
to stop and, only when the registered state still said `running`, registers the
`running -> stopped` transition (`container-lifecycle.ts`). Already registered
`stopped`/`provisioning`/`failed`: the broker is called anyway (it's
idempotent — stopping what's no longer running is a no-op on the Docker side),
but NO transition is written — inventing one the state machine didn't
really describe would be the same defect RN-486 already named for the
observed state.

**`container_remove` is the MOST destructive of the three — it discards the container and
requires reprovisioning from scratch (`container-lifecycle.ts`: `removed` only exits by
provisioning again, never "coming back to life") — and that's why it enters the SAME
absolute ceiling of `decide.ts` as git push/privileged command (RN-418):
never auto-approvable, neither by `agent_autonomy` nor by `permissions.json`,
even with "automatic mode" on.** The "always allow" gap is
closed AT THE SOURCE, by the same mechanism as RN-418: `ApproveAlwaysActionUseCase`
refuses (400) to write the pattern for `container_remove` — the whole click is
refused, and whoever wants to remove approves the instance through the normal flow
(`POST .../approve`). On the web, `ApprovalCard.podeSemprePermitir` hides the
"always allow" button for `container_remove`, the same ruler that already applies
to `instruction_patch`.

**`ContainerBrokerPort.remove` is `docker rm --force`** — it removes even a
`running` container, in a single call. The state machine has NO direct
`running -> removed` (only `running -> stopped/failed`, and only FROM THERE to
`removed`): `ExecuteContainerRemoveUseCase` registers BOTH hops when the
registered state still said `running` (`stopped`, then `removed`), reflecting what
really happened on the Docker side without widening the state machine with a shortcut
that would only exist here.

**Neither of the two decides an image** — unlike `container_start`, which
reuses `DecidirImagemDoProjetoUseCase` to emit a new version of
`artifact.project_image`. `stop`/`remove` only ask the broker to act on
the container that already exists.

- **Where:** `src/domain/actions/decide.ts` (`ACTION_TYPES`,
  `MIN_ROLE_FOR_ACTION_TYPE`, the absolute ceiling of `container_remove`),
  `src/domain/actions/command-matcher.ts` (`ACTION_TYPE_LABELS`),
  `src/domain/containers/container-stop-remove-execution-result.ts`,
  `src/application/use-cases/actions/execute-container-stop.use-case.ts`,
  `src/application/use-cases/actions/execute-container-remove.use-case.ts`,
  `src/application/use-cases/actions/approve-action.use-case.ts`,
  `src/application/use-cases/actions/propose-action.use-case.ts`,
  `src/application/use-cases/actions/approve-always-action.use-case.ts`,
  `apps/web/src/lib/aprovacoes.ts`, `apps/web/src/components/ApprovalCard.tsx`
  (`podeSemprePermitir`)
- **Test:**
  `test/domain/actions/decide.spec.ts` ("container_stop, a página
  global de containers" — CAN auto_approve; "teto de container_remove" —
  NEVER can),
  `test/application/use-cases/actions/execute-container-stop.use-case.spec.ts`,
  `test/application/use-cases/actions/execute-container-remove.use-case.spec.ts`
  (both hops from `running`; a single hop from `stopped`/
  `failed`; idempotency; `BrokerRecusouError`/`BrokerIndisponivelError`
  never propagate),
  `test/application/use-cases/actions/approve-always-action.use-case.spec.ts`,
  `apps/web/src/lib/aprovacoes.test.ts`,
  `apps/web/src/routes/ContainersPage.test.tsx`
- **Architectural decision:** [ADR 0136](../adr/0136-pagina-global-de-containers.md)
- **Origin:** the product owner's plan, Part 1 / PR 1.8

### RN-496 — The global containers page asks the broker with a CEILING, and never merges registered with observed {#rn-496}

The same family as RN-486/RN-468, applied to a NEW screen: `GET
workspaces/:workspaceId/containers` (`/containers`, cross-project) returns
one row per workspace project that already has `project_containers`
(`ContainersOverviewRepository`, THREE batch queries, never one per
project — the same spirit as `ProjectsSummaryRepository`), but asking the
broker for the OBSERVED state is a NETWORK call per project, and it doesn't fit
in a SQL query.

**The ceiling (ADR 0060) is by TWO rulers, not one.** First, only
`provisioning`/`running` rows are ELIGIBLE — a `stopped`/`failed`/
`removed` container doesn't need the daemon's confirmation for the screen to make sense
(nobody expects it to be up). Second, among the eligible ones, at
most `TETO_DE_VERIFICACOES_POR_CARGA` (20, revisable) are asked of the
broker PER LOAD — in parallel, never in series. What's left out of
either ruler carries `naoVerificado`
(`fora_do_escopo_da_verificacao` | `teto_de_verificacoes_atingido`), the
screen's OWN field — never confused with `naoObservado`
(`broker-nao-configurado`/`broker-sem-resposta`/`broker-recusou`), which is
about the broker HAVING BEEN asked and not having answered. A row outside the
ceiling has `observado`/`naoObservado`/`detalheDaObservacao` all `null`: the
screen never invents an answer the broker didn't give.

**The image read is the FROZEN one, not the current one.** `imageVersion` in
`project_containers` points to the version of `artifact.project_image` that
was current when the row was born — the Arquiteto may have revised the
decision AFTERWARDS. The screen resolves the image text by fetching the
`artifact.project_image` event whose version matches `imageVersion`
(`decisaoNaVersao`, `domain/containers/project-container.ts`), never the
most recent decision — showing the most recent would lie about which image the
container that really came up uses. `null` when that version's event
isn't found (never invented).

**The pending container `proposed_action` (if any) travels in the SAME
batch read**, matched by `projectId IN (...)` like the other two — it's
what lets the screen swap the three action buttons for the inline
`ApprovalCard` without a fourth query per project.

- **Where:** `src/application/ports/containers-overview-repository.port.ts`,
  `src/infrastructure/persistence/drizzle/containers-overview.repository.ts`,
  `src/application/use-cases/containers/obter-visao-geral-de-containers.use-case.ts`,
  `src/domain/containers/project-container.ts` (`decisaoNaVersao`,
  `versaoDoPayload`), `src/interfaces/http/containers/containers-overview.controller.ts`,
  `apps/web/src/routes/ContainersPage.tsx`, `apps/web/src/lib/hooks.ts`
  (`useContainersOverview`)
- **Test:**
  `test/infrastructure/persistence/drizzle/containers-overview.repository.spec.ts`
  (only projects with `project_containers` enter; FROZEN image, not the
  current one; cross-session `acaoPendente`; the number of queries doesn't grow with the
  number of projects),
  `test/application/use-cases/containers/obter-visao-geral-de-containers.use-case.spec.ts`
  (eligibility by status; ceiling per load; `naoObservado` never confused
  with `naoVerificado`),
  `test/interfaces/http/containers/containers-overview.controller.spec.ts`,
  `apps/web/src/routes/ContainersPage.test.tsx`
- **Architectural decision:** [ADR 0136](../adr/0136-pagina-global-de-containers.md)
- **Origin:** the product owner's plan, Part 1 / PR 1.8

## The single base of mounted projects (RN-500) {#a-base-unica-dos-projetos-montados-rn-500}

### RN-500 — There's ONE base for mounted projects, it's mounted by identity, and absent means "don't offer the mode" {#rn-500}

`BRABO_PROJECTS_BASE` is the **only** folder of the operator's computer that
Brabo's containers see. It's mounted by **identity** (`$X:$X`) in the
`api` and `engine` services, which means the path is the SAME on the host and
inside both containers.

The identity isn't a style preference. The `projects.workspace_path` string
is typed by the user and shown back to them; with host ≠ container the
product would have to choose which of the two to keep, and any choice makes the screen
lie to someone. And it's what makes `projectScopeRoot` (api) and
`Engine.Actions.Workspace.workspace_dir/2` (engine) remain correct **without
a single new line of code** — the leading-slash discriminator still holds, and the
terminal scope of ADR 0055 keeps authorizing exactly the folder the
user sees.

**Absent is a NORMAL state, not an error.** `baseDeProjetos()` returns `null` when
the variable isn't defined or is empty, and NEVER throws. `null` travels to the
client through `GET /workspaces/:workspaceId/projects-base` (`maintainer`, the same
minimum as `POST .../projects`, because it's to decide what that route offers
that the value exists) and that's how project creation learns **not to offer**
the Mounted folder mode. Offering a mode the installation doesn't honor produces a
project that locks up later, at the first tool of the first agent, far from the
screen where the decision was made — it's the same lesson as RN-170.

`dentroDaBaseDeProjetos` reuses `dentroDoEscopo`, the same function as the terminal
scope, and not a prefix comparison written again: the trap is
exactly the one it already solves — `/home/voce/brabo2` is **not** inside
`/home/voce/brabo`, although the string starts the same. The base itself counts as
inside; with a `null` base, nothing is inside.

**The base is its OWN variable**, never `PROJECT_WORKSPACES_HOST_DIR`. The three
reasons are in the ADR, and the first has data consequences: a managed workspace
is named by `workspace_dir_name` (UNIQUE) and a mounted project is
named by the user, so `<base>/loja` and a `container` project with
`workspace_dir_name = loja` would land in the SAME physical folder, with
`init_from_bare!` doing `git init` inside the other's project.

**The checkout guard lives in the preflight, and it's the only place where it's
possible.** `pnpm dev` **refuses to come up** when the base overlaps Brabo's
checkout, in both directions. The api can't do that check: it compares
against `process.cwd()`, which inside its container is `/workspace`, and never sees
the real path on disk. Without that guard, whoever clones Brabo into `$HOME/brabo` and
points the base there passes all the existing validation and makes the dev agents
execute inside the product's own tree — ADR 0055's failure coming in
through a door it doesn't watch.

**What this RN does NOT do:** it doesn't require a `mounted` project to be inside
the base. `caminhoDeWorkspaceLocalValido` and `projectScopeRoot` stay intact —
that predicate runs on every READ, and a legacy mounted project outside the base
would start blowing up when read. The base is a CREATION and CONVERSION rule, and comes
in the next RN.

- **Where:** `src/infrastructure/filesystem/project-workspaces-root.ts:67`
  (`baseDeProjetos`) and `:92` (`dentroDaBaseDeProjetos`);
  `src/interfaces/http/iam/workspaces.controller.ts:197`
  (`GET :workspaceId/projects-base`); `scripts/dev/base-de-projetos.mjs` and the
  call in `scripts/dev/preflight.mjs`; `docker/docker-compose.yml` and
  `docker/docker-compose.prod.yml` (services `api`, `engine`, `broker`)
- **Test:**
  `test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (`describe('baseDeProjetos / dentroDaBaseDeProjetos')`) and
  `scripts/dev/base-de-projetos.spec.ts`
- **ADR:** [0141](../adr/0141-base-unica-dos-projetos-montados.md)
- **Origin:** the product owner's plan, PR 1

---

## The mounted folder is born when the container comes up (RN-501) {#a-pasta-montada-nasce-quando-o-container-sobe-rn-501}

### RN-501 — `mounted` validates only the LEXICON and the base at creation; the folder is MATERIALIZED later, by whoever has authority over the disk {#rn-501}

Creating a `mounted` project **stopped touching disk**. It requires two
things, and both are lexical:

1. the same predicate `runner` already used (`caminhoDeWorkspaceLocalValido`) —
   absolute, no `..`, outside the root and system folders, not overlapping
   Brabo's checkout (RN-422/RN-423);
2. being **inside `BRABO_PROJECTS_BASE`** ([RN-500](#rn-500)), which is the only
   folder of the computer the api's and the engine's containers see.

The project is born with `workspaceVerifiedAt: null`, exactly like a `runner`.

**Why postpone.** The requirement is the product owner's and it's literal: *"if it's a Mounted
folder, the bind-mount must be created AFTER the architect's decision"*. Disk
validation ran at CREATION, which is the first screen of the flow, and the
Arquiteto's decision happens many sessions later — requiring the folder ready at creation is
requiring it before any decision exists. And it's what prevented `mounted` from being a
first-class choice: a path SUGGESTED by the wizard
(`<base>/<slug>`) is, by construction, a path that doesn't exist yet.

The difference between `mounted` and `runner` was never *what counts as a
valid path* — it's **when and who** confirms the disk. In `runner` it's the CLI connecting;
in `mounted` it's the materialization.

**Without a configured base, the MODE isn't available.** The refusal says so, with the
variable's name and what the operator needs to do — it never pretends the path
was what was wrong. Outside the base, the refusal **names the base** and **suggests**
`<base>/<the name the person asked for>`, never the bare base, which would teach putting
the project at the root of all of them. Both messages come from ONE source
(`motivoDeForaDaBaseDeProjetos`), because the two doors that apply the rule —
creation/conversion and materialization — refuse for the same reason.

**The materialization** (`materializarWorkspaceMontado`) is `mkdir -p` plus the usual three
disk questions (does it exist? is it a folder? can it be written?), with the refusal
for being outside the base **before** the `mkdir` — otherwise a path written outside
the product would make the api create a folder anywhere it reaches. Two
callers:

- **`ExecuteContainerStartUseCase`** — the normal one. When the Infra brings up the
  container, the folder is created, proven writable, and `workspace_verified_at` is
  stamped by the SAME path `ConfirmProjectWorkspaceUseCase` uses. Failing
  is a **NAMED** `failed`, never a throw nor a 500 — the same discipline as
  `BrokerIndisponivelError`/`RunnerNaoConectadoError` —, and the lifecycle
  does **not** get marked `provisioning`: marking it and only then finding out that
  it can't write would leave `project_containers` asserting a state that
  never existed. The message names the variable, the path, the probable cause (the folder's
  owner on the host; the images run non-root, ADR 0024), and the next step
  ("approve `container_start` again").
- **`ConvertProjectExecutionModeUseCase`** — the exception, declared. Conversion
  has no container step to hang the work on, and right after it MOVES
  `permissions.json` to `permissionsFilePath(localNova)`, which in `mounted` is the
  user's folder. Moving a file into a nonexistent folder fails, so
  here mkdir-at-decision is right — before the transaction, so the refusal doesn't
  leave a transaction open, and becoming a 400.

**What this RN does NOT do, and it's the easiest regression to cause.** The base rule
does **not** go into `caminhoDeWorkspaceLocalValido`. That predicate runs on EVERY
READ, through `projectScopeRoot` (terminal scope, `permissions.json`, Code
tab), and a LEGACY `mounted` project — created when the bind-mount was one compose
line per project, therefore outside the base — would start blowing up with
`LocalizacaoDeProjetoInvalidaError` when simply read. The base is a
**creation and conversion** rule; the lexicon is **forever**.

**No migration, and the database CHECK stays intact.** `mounted` keeps writing
a NON-null `workspace_path`, so
`(execution_mode <> 'container') = (workspace_path IS NOT NULL)` remains
satisfied. Postponing **verification** never touches the **pairing** invariant.

**Declared consequence:** between creating the project and bringing up the container,
`workspace_path` points to a folder that may not exist. Nothing breaks
(`projectScopeRoot` is lexical; `permissions.json` degrades to
`EMPTY_PERMISSIONS_FILE`, which is `require_approval` on everything), but the screen needs to
SAY so — a screen that shows a path without saying it doesn't exist yet is a
screen asserting what it doesn't know.

- **Where:** `src/application/services/workspace-location.ts:93`
  (lexicon) and `:108` (base);
  `src/infrastructure/filesystem/project-workspaces-root.ts:575`
  (`motivoDeForaDaBaseDeProjetos`), `:624`
  (`validarWorkspaceMontadoEmDisco`, the former `validarCaminhoDeWorkspaceLocal`),
  and `:705` (`materializarWorkspaceMontado`);
  `src/application/use-cases/iam/convert-project-execution-mode.use-case.ts:139`;
  `src/application/use-cases/actions/execute-container-start.use-case.ts:133`
  and `:334`
- **Test:**
  `test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (`describe('materializarWorkspaceMontado')` and the non-regression "projeto
  mounted LEGADO, FORA da base, continua resolvendo sem lançar");
  `test/application/use-cases/iam/create-project-modo-de-workspace.spec.ts`
  (`describe('mounted valida só o léxico + a base na criação')`);
  `test/application/use-cases/iam/convert-project-execution-mode.use-case.spec.ts`;
  `test/application/use-cases/actions/execute-container-start.use-case.spec.ts`
  (`describe` "ExecuteContainerStartUseCase — materialização do mounted")
- **ADR:** [0142](../adr/0142-validacao-de-workspace-montado-adiada.md), which
  references [0141](../adr/0141-base-unica-dos-projetos-montados.md)
- **Origin:** the product owner's plan, PR 2

---

## A mounted project brings up its container through the BROKER (RN-503) {#projeto-montado-sobe-container-pelo-broker-rn-503}

### RN-503 — A `mounted` project brings up a container through the BROKER, and what crosses the network is a discriminated locator — never an absolute path {#rn-503}

A project in Mounted folder mode **couldn't get any container** until now, and
for two independent blocks: `ExecuteContainerStartUseCase` sent every
mode other than `container` to the RUNNER (which requires a connected `brabo-runner`),
and the broker refused at the source any mode that wasn't
`container`, with `ModoDeExecucaoNaoSuportadoError`.

Both existed for the same reason of GEOMETRY, not because of the mode's name: the folder
of a mounted project was in an arbitrary place on the operator's disk, which the
server's Docker daemon had no reason to see. ADR 0141 (RN-500)
changed that geometry — every mounted project now lives under **one** base
mounted by identity —, and that's what, and only what, this rule harvests.

**The branching is now by DESTINATION, not by mode.** `container` **and**
`mounted` go to the BROKER; only `runner` goes to the runner, because its folder
remains on a machine this server doesn't reach (ADR 0137). The same holds for
the three lifecycle actions — `container_start`, `container_stop`, and
`container_remove`: they HAVE to change together, otherwise a mounted project's container
comes up on the server and the request to stop goes looking for it on the user's machine,
leaving up, with no way to stop it, what is up.

**ADR 0130's invariant doesn't move: no absolute path crosses the
network.** The broker is root-equivalent on the host and COMPOSES the `-v` from ITS
roots; if the api sent `/home/voce/brabo/loja`, the bind-mount's containment
would come to depend on the api being correct, which is exactly the dependency
the broker exists not to have. What changes is that now there are TWO roots on the
other side, so the spec needs to SAY against which of them the relative piece
applies — and it says so, in a discriminated locator:

| `localizacao.tipo` | segment | broker root |
|---|---|---|
| `gerenciada` | `workspace_dir_name` (RN-109) | `PROJECT_WORKSPACES_HOST_ROOT` |
| `montada` | the RELATIVE path under the base | `BRABO_PROJECTS_HOST_BASE` |
| `indisponivel` | — (there's a `motivo`) | none |

**Three states and not two**, because the third really exists and has two
different fixes: a `runner` project (the folder is on another machine — the
fix is the runner, on the other side) and a LEGACY `mounted` project created outside the
base (the fix is moving the folder). Collapsing them into a `null` would make the same
absence send whoever operates to the wrong place. The folder that IS the base itself
also falls here, and doesn't become an empty segment: `<raiz>/` would mount the whole base
— the folder of ALL mounted projects — inside the container of a single one.

**The lack of one root is never supplied by the other.** Without
`BRABO_PROJECTS_HOST_BASE`, a mounted project's `start` refuses **naming the
variable** (`BaseDeProjetosNaoConfiguradaError`, origin `infra`, 503) and doesn't
touch any container — the same mold as `RaizDeWorkspacesNaoConfiguradaError`.
Falling to the other root by omission would be the worst possible outcome: the
managed root is named by `workspace_dir_name` and the base is named by the
user, so the same name points to different folders and the container would come up with
ANOTHER project's folder, with nothing indicating why. For the same reason, the
list of modes the broker serves is an ALLOWLIST: a new mode in the enum is born
refused, with a message, instead of accepted by omission.

**The composition still goes through three barriers, not one.** The api refuses
what isn't under the base (`segmentoSobABaseDeProjetos`); the broker refuses
a segment that isn't relative (`segmentoDeProjetoValidado` — `..`, absolute,
empty, double slash, NUL); and the concatenation's result still goes through
`raizDeProjetoValidada` before becoming a `-v`. Validating the segment and not validating the
concatenation would be trusting string arithmetic.

**`mounted` ELECTS the image, like `container` — it doesn't read the current one like the runner.**
It isn't aesthetic symmetry: it's the only design that works. The broker composes
from `artifact.project_image`, going to FETCH it from the api. An Infra election
that wasn't recorded in that artifact would be inert — the container would come up with the
image the Arquiteto decided, the payload the human approved would say another, and
nothing in the record would expose the difference. The runner's path can read
the current one precisely because there the api SENDS the spec's fields through the channel; there the
artifact isn't the source the other side consults.

**What this rule does NOT do:** it materializes no folder — whoever creates the folder
of the mounted project is [RN-501](#rn-501), in the SAME use case and **before**
this branching, precisely because the server's daemon needs the folder to exist
to mount it. It also doesn't touch the image gate (RN-105 already applies to the three
modes since RN-494) and doesn't change who PROPOSES `container_start` — the Infra Lead
can still propose for a project with no connected runner and no decided
image, the gap declared since RN-494.

- **Where:**
  `src/application/use-cases/containers/obter-spec-de-container.use-case.ts`
  (`LocalizacaoDoProjeto`, `localizacaoDoProjeto`);
  `src/infrastructure/filesystem/project-workspaces-root.ts`
  (`segmentoSobABaseDeProjetos`);
  `src/interfaces/http/internal/dto/container-spec-internal.response.dto.ts`;
  `src/application/use-cases/actions/execute-container-start.use-case.ts`,
  `…/execute-container-stop.use-case.ts`, `…/execute-container-remove.use-case.ts`
  (the `!== 'runner'` branching);
  `packages/docker-port/src/docker-port.ts` (`segmentoDeProjetoValidado`);
  `apps/broker/src/config.ts` (`baseDeProjetosNoHost`) and
  `apps/broker/src/operacoes.ts` (`raizDoProjetoNoHost`,
  `garantirModoSuportado`, `BaseDeProjetosNaoConfiguradaError`,
  `LocalizacaoIndisponivelError`)
- **Test:**
  `test/application/use-cases/containers/spec-e-observacao-de-container.use-case.spec.ts`
  (`describe('… o localizador discriminado (RN-503)')`);
  `test/application/use-cases/actions/execute-container-{start,stop,remove}.use-case.spec.ts`;
  `packages/docker-port/src/docker-port.spec.ts`
  (`describe('segmentoDeProjetoValidado')`); `apps/broker/src/operacoes.spec.ts`
  and `apps/broker/src/config.spec.ts`
- **ADR:** [0130](../adr/0130-broker-de-container.md),
  [0141](../adr/0141-base-unica-dos-projetos-montados.md)
- **Origin:** the product owner's plan, PR 3

---

## The decision artifact of the conversational agents (RN-505) {#o-artefato-de-decisao-dos-conversacionais-rn-505}

### RN-508 — `container_start_via_runner`: a second action type to bring up the container, exclusive to `runner`, and the Infra Lead refuses blind proposals BEFORE proposing {#rn-508}

`container_start` (ADR 0130/0133) requires `imagem`/`network`/`resources`/
`rationale` — the Infra ELECTS a candidate from the Arquiteto's routing. Until
this delivery, the same action type also served `execution_mode: runner`
(`ExecuteContainerStartUseCase.executeViaRunner`), but the runner's path
NEVER read any of those four fields: the image that comes up is the one already
DECIDED (there's no routing to elect against, because the broker never
reaches a `runner` project's folder). Asking for 4 fields the dispatch always
discarded is the defect that motivates a separate ACTION being born instead of a
"smart" `container_start` branching by mode.

**`container_start_via_runner` only has `rationale` (optional).** The same caliber
as `container_start` (`maintainer`, `require_approval` by default, never
seeded in auto-approval, configurable in `permissions.json` like the
other three container actions — it doesn't enter the absolute ceiling of
`container_remove`). `ExecuteContainerStartUseCase` loses the whole `runner`
branch (`executeViaRunner`, `ApiToEngineClient`/`ObterSpecDeContainerUseCase`
leave the constructor) — it becomes exclusive to `container`/`mounted`, both through the
BROKER (RN-503). The extracted code becomes
`ExecuteContainerStartViaRunnerUseCase`, a sibling file. The lifecycle
dance (`provisioning -> running`) the two paths shared
by copy becomes `SubirCicloDeVidaDoContainerUseCase`
(`.../containers/`) — extracted so as not to duplicate the state machine's
rationale in the two files.

**The Infra Lead queries LOCALLY, without HTTP, before proposing.** The new tool
(`Engine.Infra.Tools.ProposeContainerStartViaRunner`) is intercepted by
`Engine.Infra.InfraLeadServer.dispatch_calls/2`, which reads `Project.get/1`
(execution_mode) and `Engine.Runners.Registry.connected?/1` (runner connected)
— BOTH reads are already local, in the same BEAM process — BEFORE calling
`propose_action`. It refuses with a NAMED reason (never proposes blindly) when the
project is in `container` (use `propose_container_start`), in `mounted`
(likewise, since RN-503), or in `runner` with no runner connected now. This
gap — "proposing without knowing whether it'll work" — is the SAME one `propose_container_start`
has had since RN-494, declared and accepted for that tool (touching the Infra Lead's
prompt/instruction would be outside the API/domain scope); the NEW tool
is born without it, because it's born knowing how to refuse.

**The specification the api composes is the one the runner VALIDATES, and that is now
proven.** `EspecificacaoDeContainerParaRunner` is the fields of
`EntradaDeEspecificacao` (`packages/docker-port`) minus `raizDoProjeto`, which
only the runner knows — TEN, not nine. It was born with nine, without `projectId`, and
the consequence was that this path NEVER brought up any container since it
existed: the engine passes the map on opaquely, the runner hands it to
`especificacaoValidada`, which requires `projectId` as non-empty text, and the action
ended `failed` with *"especificação de container recusada em `projectId`:
esperava texto não vazio, recebi undefined"* — and from there the CORRECT block of
[RN-507](runner.md#rn-507)/[RN-502](engine.md#rn-502) did the rest, with no dev agent
claiming a task. The data always existed (`SpecDeContainer.projectId`, the
same one the BROKER receives through `GET .../container-spec`, and that's why only
`runner` mode broke); it just wasn't copied. Three green suites didn't catch it because each one built
its own fixture: the use case's test asserted what it itself
expected, the runner's built a fixture WITH `projectId`, and the
engine doesn't look at the map. What is now guaranteed is the CHAIN — the payload
`ExecuteContainerStartViaRunnerUseCase` composes, going through the
real `especificacaoValidada` —, and the test also locks the set of
fields: `raizDoProjeto` is the only one the api doesn't send, so a new field on one
side without the other fails.

- **Where:** `src/domain/actions/decide.ts` (`container_start_via_runner`);
  `src/application/use-cases/actions/
  execute-container-start-via-runner.use-case.ts` (new);
  `src/application/use-cases/containers/
  subir-ciclo-de-vida-do-container.use-case.ts` (new);
  `src/application/use-cases/actions/propose-action.use-case.ts`;
  `src/application/use-cases/actions/approve-action.use-case.ts`;
  `src/application/ports/api-to-engine-client.port.ts`
  (`EspecificacaoDeContainerParaRunner`, the ten fields);
  `apps/web/src/lib/aprovacoes.ts`;
  `apps/engine/lib/engine/infra/tools/propose_container_start_via_runner.ex`
  (new); `apps/engine/lib/engine/infra/infra_lead_server.ex`
- **Test:**
  `test/application/use-cases/actions/execute-container-start.use-case.spec.ts`,
  `test/application/use-cases/actions/
  execute-container-start-via-runner.use-case.spec.ts` (new),
  `test/contract/
  especificacao-de-container-para-runner.contract.spec.ts` (the CHAIN —
  the payload composed by the api against the real `especificacaoValidada`),
  `apps/web/src/lib/aprovacoes.test.ts`,
  `apps/engine/test/engine/infra/tools/
  propose_container_start_via_runner_test.exs` (new),
  `apps/engine/test/engine/infra/infra_lead_server_test.exs`
- **ADR:** [0145](../adr/0145-docker-pre-requisito-do-runner.md)
- **Origin:** the product owner's decision — Docker becomes a real prerequisite of
  `runner` mode, with no fallback to the host

---

## The folder browser served by the api (RN-504) {#o-navegador-de-pastas-servido-pela-api-rn-504}

### RN-509 — A module Dev Agent's "Always allow" scopes to `agent_autonomy`, PER AGENT — no longer the whole project's `permissions.json` {#rn-509}

`ApproveAlwaysActionUseCase` always wrote to `permissions.json/allow` —
**WHOLE PROJECT** scope, shared by any actor. That
meant "always allowing" a command for `dev-checkout` released the
SAME command for `dev-auth`, for `dev-lead`, and for any future agent
of the project: the intent of whoever clicked ("I trust THIS agent with THIS") had
no way to be expressed — only "I trust anyone with this" existed.

**The write now branches by ACTOR**, inside the SAME use case (not
a new one — duplicating the two absolute-ceiling guards for out-of-scope
terminal/`git_push`/`sudo` and for `container_remove` in two places would be the
same defect RN-418/RN-495 already exist to avoid):

- An `agent` actor whose id is `dev-<modulo>` (ADR 0053/PHASE 14d — the
  DYNAMIC `dev` area, one agent per `module_map` module): writes to
  `agent_autonomy(projectId, agentId, actionType) = auto_approve`, through the
  SAME `AgentAutonomyRepository.upsert` that
  `activate-execution.use-case.ts` already calls to seed the three git actions
  per module. `permissions.json` stays untouched.
- Any other actor — `user`, `system`, an `agent` agent that isn't a
  module dev, and `dev-lead` — keeps going to the usual `permissions.json/allow`,
  whole-project scope, exactly as before.

**`dev-lead` is the exception that needs its own name.** `ehDevDeModulo`
(`agent-areas.ts`) is PURE `agentId.startsWith('dev-')`, on purpose — and
that classifies `dev-lead` as `true`. What excludes the lead from its own area
is `ehMembroDe`, not `ehDevDeModulo` alone ("the lead isn't a member of its own
area" holds for any area — duplicating the exclusion inside the predicate
left both copies unreachable by tests, a finding recorded in the
comment of `agent-areas.ts` itself). That's why the branch uses
`ehDevDeModulo(actor.id) && actor.id !== DEV_LEAD`: without the second term,
"always allow" clicked on a `dev-lead` action would write module autonomy
under the LEAD's agentId by accident — an agent that isn't a member of
`dev`, has no module, and that the area never looks at via `agent_area_members`.

**The two absolute ceilings of `decide.ts` keep running BEFORE the branch,
without changing order.** Terminal with a git external effect (`git push`, `gh pr
create`) or privileged (`sudo`/`doas`) — RN-106/RN-418 — and
`container_remove` — RN-495 — keep refusing the WHOLE click (400, the action
not even approved), for ANY actor, before the project is even fetched.
Scoping the write per agent isn't a second door to the same ceiling: the
two refusal `if`s stay where they were, and the new branch comes after.

**The `permission.granted` event carries one payload OR the other, never one
pretending to be the other.** `{ pattern }` remains the format of the
`permissions.json` path (the text pattern written to the file); the new path
emits `{ agentId, actionType }` — there's no "pattern" at all to show when
the write is a table row keyed by agent.

**No data migration.** Old "always allow" entries written
for a module dev in `permissions.json`, from before this rule existed,
stay there exactly as they were — they just no longer receive MORE entries of that
kind from then on. A conscious decision by the product owner, not a forgotten
gap.

- **Where:**
  `src/application/use-cases/actions/approve-always-action.use-case.ts`
  (the `ehAgenteDeModulo` branch), `src/domain/agents/agent-areas.ts`
  (`ehDevDeModulo`, `DEV_LEAD` — consumed, not altered),
  `src/application/ports/agent-autonomy-repository.port.ts`
  (`upsert`, already existing, no new method)
- **Test:**
  `test/application/use-cases/actions/approve-always-action.use-case.spec.ts`
  (describes `escopo por Dev Agent de módulo (RN-509)`: happy path
  `dev-checkout` writes `agent_autonomy` and doesn't leak to `dev-auth`; BOTH
  absolute ceilings refusing the whole click for a module-dev actor;
  `dev-lead` and a `user` actor — including with an id starting with `dev-` —
  stay on the old path)
- **Origin:** the product owner's plan, Front 2

---

## The mirror destination is per project (RN-515) {#o-destino-do-espelho-e-por-projeto-rn-515}

### RN-515 — The mirror destination is declared PER PROJECT and is never global; `null` is the normal state; and the api validates ONLY the lexicon, saying it is only the lexicon {#rn-515}

The `espelho` capability ([RN-514](engine.md#rn-514), [ADR 0147](../adr/0147-agente-local-com-capacidades.md))
copies the agents' work to a user folder **outside** the mounted
base — which is the reason it exists, because a bind mount does not cross a network
nor reach a path outside what was mounted. This rule decides **where that
destination lives and how the user declares it**; it does **not** copy any file.

**PER PROJECT, never global.** The destination is the `projects.mirror_path` column and the
project's `mirrorPath` field, written by
`PUT /projects/:projectId/mirror-path` (`maintainer`, the same minimum as
`execution-mode` and `projects-base`: the route speaks of a path on the
operator's computer). Never a global setting in the runner, never an environment variable:
a global destination would make project B's artifact land in project
A's folder, and the user would find that out **through the content, not through an error** (ADR 0147,
point 4).

**`null` is the NORMAL state, not a pending item.** The column is nullable and is born
null; a project without a mirror is the majority, and the product never picks a destination
on its own. Clearing is `{"mirrorPath": null}` — the key is **mandatory**, and
omitting it is **400**: a body that omits the field would be indistinguishable from "clear",
and clearing silently is precisely the defect. Clearing **always** works,
even in a `container` project, otherwise a converted row would be stuck in the
state the rule forbids.

**Only the LEXICON, and the api SAYS it is only the lexicon.** The api **does not see** the machine
where the destination will exist — it is the situation of the `runner` mode
([RN-423](runner.md#rn-423)), not that of `mounted`, where the folder ends up inside the base the
api actually reaches. It reuses `caminhoDeWorkspaceLocalValido`, the **same**
predicate as creation and conversion (absolute, no `..`/`.`, never the root nor a
system folder, never overlapping the Brabo checkout), instead of a fourth
copy of the same rule — and it does **not** require `BRABO_PROJECTS_BASE`, because the mirror
destination is by definition the folder the base does not cover. The refusal message
declares that the disk was not verified and who verifies it.

**The two directions of the same loop.** A destination **inside** the `workspacePath` and
a destination that **contains** the `workspacePath` are the same refusal seen from two sides
(ADR 0147, point 2): writing the mirror inside the source makes the mirror copy
itself, and a source inside the destination nests the copy on every round.
Refusing one and allowing the other would be closing the door and leaving the window open. The
comparison is by **SEGMENT** (`dentroDoEscopo`), never raw `startsWith`:
`/base-outra` is **not** inside `/base`, and refusing it would penalize a perfectly
legitimate sibling folder.

**This is the LEXICAL half of the guard, and only it.** The other is `realpath`, and it belongs to the
RUNNER (`espelho-guard.ts`, ADR 0147 point 2), on the machine where both paths
really exist. A symlink in any segment of the destination pointing
back to the source passes through here unseen — the api has no disk on which to
resolve it. **The api did not guarantee the loop**; it prevented the WRITTEN loop.

**`container` is refused, and the refusal is NAMED.** The source of a
`container` project is a managed volume **on the server**, and whoever would copy is a
process on the **user's** machine, which does not see it. Accepting and never copying
would be worse than refusing, because it would look configured. `mounted` and `runner`
can. For the same reason, **converting the mode ZEROES the destination**
([RN-447](#rn-447)..450): in `container` it could not exist, and even between
`mounted` and `runner` the conversion MOVES the source against which both directions
of the loop were validated.

**The value comes back in every project read** (`ProjectResponseDto.mirrorPath`),
so the mirror implementation and the status screen do not need a new route.
There is no dedicated read endpoint.

**And it is NOT a `proposed_action`.** Writing the mirror is configuration the
user declared, not an agent asking to act — ADR 0147 is explicit
about it, and syncing via a terminal command would fall into the scope of
[ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) and become a
queue of routine approvals.

- **Where:** `src/db/schema/iam.ts` (`mirror_path` column, nullable,
  no CHECK — the `container` refusal lives in the use case because the mode is
  CONVERTIBLE); `src/db/migrations/0056_lovely_firelord.sql`;
  `src/domain/iam/project.entity.ts` (`mirrorPath`);
  `src/application/services/workspace-location.ts`
  (`validarDestinoDeEspelho` — the reused lexicon, the `container` refusal and the
  two directions of the loop);
  `src/application/use-cases/iam/set-project-mirror-path.use-case.ts`;
  `src/application/use-cases/iam/convert-project-execution-mode.use-case.ts`
  (the conversion zeroing the destination);
  `src/interfaces/http/iam/dto/set-mirror-path.dto.ts` (`@IsDefined`
  + `@ValidateIf`, never `@IsOptional`, which would collapse `null` and `undefined`);
  `src/interfaces/http/iam/projects.controller.ts`
  (`PUT :projectId/mirror-path`, `maintainer`);
  `src/interfaces/http/iam/dto/iam.response.dto.ts`
- **Test:**
  `test/application/use-cases/iam/set-project-mirror-path.use-case.spec.ts`
  (writes, normalizes, clears, clears even in `container`, refuses
  non-absolute/`..`/root/system folder/Brabo checkout, the two directions
  of the loop, `/base-outra` vs `/base` NOT being inside, `container` refused,
  404); `test/interfaces/http/iam/projects-execution-mode.controller.spec.ts`
  (`describe "destino do espelho (RN-515)"` — `maintainer` and the passing through of
  `null`);
  `test/application/use-cases/iam/convert-project-execution-mode.use-case.spec.ts`
  (the conversion zeroing the destination);
  `test/interfaces/route-surface.spec.ts` (the route classified in
  `docs/security-surface.md`)
- **ADR:** [0147](../adr/0147-agente-local-com-capacidades.md), point 4
- **Origin:** PHASE 28, session 6 (half A — where the destination lives; the copy, the
  `mirror_sync` and the second `realpath` pass are half B, in the engine and
  in the runner)

---

## The mirror state is visible, and the three states do not collapse (RN-517) {#o-estado-do-espelho-e-visivel-e-os-tres-estados-nao-colapsam-rn-517}

### RN-517 — The outcome of each mirror round comes back through the channel and becomes TELEMETRY in its own table; "never synced", "synced and copied nothing" and "failed" are THREE answers, and success and error coexist {#rn-517}

Session 8 of PHASE 28 and **point 7** of
[ADR 0147](../adr/0147-agente-local-com-capacidades.md).
[RN-516](runner.md#rn-516) made the mirror really copy and left `mirror_sync`
**fire-and-forget** — with no `mirror_sync_result` in the protocol, on purpose,
because the telemetry format was this delivery's decision. It is this one that closes the
loop.

**The path is that of `workspace_confirm`, and no other.** The runner pushes
`mirror_sync_result` on the `terminal:<projectId>` channel **after** the round
ends; the engine handles it in `handle_in/3` and RELAYS it to the api over internal
HTTP (`POST /internal/projects/:projectId/mirror-sync-result`), which writes through the use
case. The engine **does not write the table** — a second write path
would be the second source of the same truth, and the first thing to diverge. It is the
only precedent of the runner telling something about itself, and that is why the
ADR named it.

**Never an optimistic "ok".** The reported outcome is the REAL one: the three counts
that `sincronizarEspelho` returned (copied, skipped, refused — never
recounted) or the named error. ALL THREE exits of `tratarMirrorSync` report,
and with different messages: the refusal for a non-granted destination, the copy failure
and the success. `ok` is NEVER deduced from there being a count or a message — neither
in the runner, nor in the engine's translation, nor in the api's use case: deducing
would make a round that copied **0** files (perfectly normal)
indistinguishable from one that never even ran.

**A TABLE, and not the event log.** `project_mirror_states`, one row per project
(unique `project_id`, same design as `project_containers`). The reason is the
same one that made `rag_searches` become a table ([RN-479](#rn-479)):
`session_events.session_id` is `NOT NULL` and a mirror round **has no
session** — the event log would lose the whole thing, not part of it. And it is
not a `proposed_action` under any circumstances: writing the mirror is configuration
the user declared, not an agent asking to act.

**The THREE states of [RN-088](web.md#rn-088), and they do not collapse.** "Never
synced" is the **absent** row. "Synced and copied nothing" is a
present row with `files_copied = 0` — an outcome, not an emptiness. "Failed" is
`last_error_at` more recent than `last_synced_at`. They are three different
answers, the person acts differently on each one, and a dash serving all three
would be the screen refusing to name what it knows ([RN-470](web.md#rn-470)).

**Success and error COEXIST in the same row.** The two writes mention
**disjoint** columns: the success one does not touch `last_error`/`last_error_at`, the failure one
does not touch any success column, and neither erases the other. What
decides which one is CURRENT is the comparison of the two timestamps
(`deriveMirrorSyncStatus`, a pure domain function), and that is what lets the screen
say *"the last round failed — last good copy yesterday, with 412 files"*.
A destructive write of one side over the other would throw away precisely the
most useful information the screen has while the mirror is broken. Two
smaller choices in the same direction: a failure WITHOUT a destination does not erase the destination of the
last copy that worked, and an exact timestamp tie resolves to `failed` —
between asserting that everything is fine and asserting that something failed, the safe assertion
is the one that makes the person look.

**`destination` is FROZEN**, like `image_version` in `project_containers` and
the weights in `rag_searches` ([RN-479](#rn-479)): it is the REAL destination of that
round, resolved by `realpath` on the user's machine after the `mkdir -p`.
Reading `projects.mirror_path` at display time would state the destination of NOW over
a copy from yesterday — and the two really diverge, because the grant travels in the
join and only changes when the runner reconnects ([RN-516](runner.md#rn-516)). When they diverge,
the screen SAYS so.

**Writing telemetry never takes down what it measures.** The copy has already finished
when the report goes out; the engine's `handle_in` only LOGS the api's refusal and returns
`{:noreply, socket}` in both branches, and the runner's channel stays alive. Without a channel
(the connection dropped between the request and the end of the copy) the runner does not report and does not
throw — the round that happened is not undone because of that. And a project whose
destination was CLEARED midway still records: the round happened, and its error is
what usually explains what happened.

**On the screen**, the row goes into `AmbienteDoProjeto` (the side column of the
Overview, next to those of execution mode and runner) and **only exists in a project that
has `mirrorPath`** — in a project without a mirror, "never synced" would be an
invented absence, the same argument that already held for the runner row. An
ABSOLUTE date with a caveat and never a green "it's up" dot, by the same
precedent as `workspaceVerifiedAt`: the timestamp says a round happened,
not that the folder is up to date with what changed afterwards (the trigger is a named
moment, the commit — never a watcher). The `status` arrives RESOLVED from the api: the
rule deciding which timestamp counts has a single source, and it is what decides which
of the three sentences the person reads.

**`viewer` role to READ, `maintainer` to write the destination** — the rule of
[RN-102](#rn-102) applied: the minimum belongs to the ENDPOINT, and this one only reads. The destination already
travels in every project read (`GET /projects/:projectId`, `viewer`), so
requiring `maintainer` here would lock information away from whoever already sees it in the same
project, which is the worse of the two defects because it is invisible to whoever lost the
capability.

- **Where:** `src/db/schema/iam.ts` (`project_mirror_states`, in the
  `iam` aggregate because that is where the destination lives — there is no `domain/runners`);
  `src/db/migrations/0057_brave_silver_centurion.sql`;
  `src/domain/iam/mirror-state.ts` (`deriveMirrorSyncStatus`, the rule
  of the three states, pure); `src/application/ports/mirror-state-repository.port.ts`
  (TWO write methods, not one upsert with everything optional — that is what makes the
  disjunction an invariant of the type, not a convention of the caller);
  `src/infrastructure/persistence/drizzle/mirror-state.repository.ts`;
  `src/application/use-cases/iam/record-mirror-sync.use-case.ts` and
  `.../get-project-mirror-state.use-case.ts`;
  `src/interfaces/http/internal/internal-projects.controller.ts`
  (`POST .../mirror-sync-result`);
  `src/interfaces/http/iam/projects.controller.ts`
  (`GET .../mirror-state`, `viewer`);
  `apps/engine/lib/engine/sessions/engine_api_client.ex`
  (`report_mirror_sync/2`);
  `apps/engine/lib/engine_web/channels/terminal_channel.ex`
  (`handle_in("mirror_sync_result", …)` and the vocabulary translation);
  `apps/runner/src/channel.ts` (`MirrorSyncResultMessage`,
  `enviarMirrorSyncResult`); `apps/runner/src/index.ts` (`tratarMirrorSync`
  reports the three exits); `apps/web/src/components/AmbienteDoProjeto.tsx`
- **Test:**
  `test/application/use-cases/iam/mirror-sync-telemetry.use-case.spec.ts`
  (the three states in the pure function and in the read; error that does not erase the success;
  changed destination; count 0; message without text and long message; project
  without a destination that still records);
  `test/infrastructure/persistence/drizzle/mirror-state.repository.spec.ts`
  (the invariant of the disjoint columns against the real database — a fake
  would prove the fake);
  `apps/engine/test/engine_web/channels/terminal_channel_test.exs`
  (`describe "mirror_sync_result"` — the relay with translation, the `filesCopied: 0`
  that does not vanish, an absent field that does NOT become `nil`, a missing `sucesso` that becomes
  `ok: false`, `:web` ignored, and the api that refuses without taking down the channel);
  `apps/runner/src/index-handlers.spec.ts`
  (`describe "o desfecho é reportado em mirror_sync_result"` — real count,
  empty repository as success, named failure, refusal without a destination, and the
  dropped connection that neither reports nor throws);
  `apps/web/src/components/AmbienteDoProjeto.test.tsx`
  (`describe "linha do espelho"` — without `mirrorPath` the row disappears and does not even query;
  the three states with three sentences; no liveness vocabulary; changed
  destination stated)
- **ADR:** [0147](../adr/0147-agente-local-com-capacidades.md), point 7
- **Origin:** PHASE 28, session 8. Declared and NOT done: no alarm,
  no notification and no automatic retry of a round that failed —
  the next round happens at the next named moment, as always, and the screen
  is the only place where the failure shows up today

---

## Device key revocation stops being blind, and reaches the live connection (RN-519..520) {#a-revogacao-de-chave-de-dispositivo-deixa-de-ser-cega-e-alcanca-a-conexao-viva-rn-519-520}

### RN-519 — Nobody revokes what they cannot see: the device key gains a listing for its OWN owner, and the `maintainer` view stays out by DECISION {#rn-519}

Session 7 of PHASE 28 and **point 6** of
[ADR 0147](../adr/0147-agente-local-com-capacidades.md). Revocation had existed since
[ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
(`DELETE /projects/:projectId/runner-device-keys/:deviceKeyId`, `developer`,
204, idempotent) — **and there was no way to see what one revokes.**

**The real cut was bigger than the docblock said.** It declared the absence
as *"without the `maintainer` view (list/revoke any user's) that the
PAT has"*. But `PersonalAccessTokensController` has **five** routes — `@Post()`,
`@Get()` and `@Delete(':tokenId')` for the user themself, plus `@Get('all')` and
`@Delete(':tokenId/admin')` for `maintainer` ([RN-427](#rn-427)) — and the device
key one had **two**. It was not only the `maintainer` view that was missing: the
listing for the OWN owner was missing. An orphan key (tab closed in the middle of the flow of
[RN-473](web.md#rn-473)) was inert, invisible and permanent, with no screen at all on which to
revoke it — the gap that `CLAUDE.md` already declared.

**`@Get()` comes in, `developer`, in the same format the PAT already has** and scoped to
the user themself in the repository's WHERE, never in a filter of the use case.

**The revoked one STAYS in the list.** Same choice as `listarDoUsuarioNoProjeto`
of the PAT: whoever revoked needs to see they revoked, and making the row disappear would make the screen
claim the key never existed. `revokedAt` is what separates the two, and
a null `lastUsedAt` is the sign of the ORPHAN — registered and never used by any
runner.

**Never the public JWK.** It is not a secret, but it serves no purpose here: the list
exists to revoke, and for that `id`, name and the three dates suffice. The private
half the api never saw.

**The `maintainer` view stays OUT — now by decision, not by omission.**
The PAT's two admin routes were born from incident response ([RN-427](#rn-427)):
a dismissed dev with a SHARED secret circulating. A device key is not
that animal — the private key never leaves the browser that generated it, so there is no
secret in someone else's hands to contain. What the `DELETE` here gained in exchange was
REACH ([RN-520](#rn-520)), not breadth.

- **Where:** `src/interfaces/http/runner/runner-device-keys.controller.ts:99`
  (`@Get()`, `listDeviceKeys`, `developer`);
  `src/application/use-cases/auth/list-runner-device-keys.use-case.ts:24`;
  `src/application/ports/runner-device-key-repository.port.ts:90`
  (`listarDoUsuarioNoProjeto`);
  `src/infrastructure/persistence/drizzle/runner-device-key.repository.ts:69`;
  `src/interfaces/http/runner/dto/runner-device-key-list.response.dto.ts:19`
  (the TWO type locks, `Wire`/`MesmasChaves`, unlike the registration
  DTO)
- **Test:**
  `test/application/use-cases/auth/list-runner-device-keys.use-case.spec.ts`
  (delegation with `userId`/`projectId` in the right order; the revoked one that stays in the
  list; the orphan with a null `lastUsedAt`; a repository that rejects and propagates);
  `test/interfaces/http/runner/runner-device-keys.controller.spec.ts`
  (the THREE routes at `developer`; the delegation; the route that does not return an empty
  list by mistake)
- **ADR:** [0147](../adr/0147-agente-local-com-capacidades.md), point 6
- **Origin:** PHASE 28, session 7. Declared and NOT done: **no screen at all**.
  This delivery is the server-side half; the `CLAUDE.md` gap closes by
  half — the api can now list and revoke, and `apps/web` still has nowhere
  to do it
- **The other half CLOSED in [RN-561](web.md#rn-561):** the Settings tab gained the
  section that lists and revokes, marking the KIND of each key. What remains
  open from here is the `maintainer` view (above, by decision) and the
  `{projeto, usuário}` target of the disconnection ([RN-520](#rn-520))

---

### RN-520 — Revoking stops only preventing a NEW ticket and now takes down the LIVE connection; the target is `{projeto, usuário}` and never `{chave}`, and taking down never takes down the revocation {#rn-520}

> **Revised by [RN-685](#rn-685) ([ADR 0201](../adr/0201-revogacao-por-chave.md)):**
> the socket ticket now stores WHICH credential requested it, and revoking a
> key (and a PAT) takes down only the connections opened WITH IT — another runner of the
> same user, with another key or with a PAT, stays up. The "declared cost"
> below no longer holds. The `{projeto, usuário}` pair survives as the target of
> member removal ([RN-615](#rn-615)), as that of the LEGACY connection (ticket without a
> credential) during the rollout, and as plan B when the engine does not know the
> per-credential route.

The other half of **point 6** of
[ADR 0147](../adr/0147-agente-local-com-capacidades.md). Revoking a device
key prevented the NEXT ticket and nothing else: an already connected `brabo-runner`
kept the `terminal:<projectId>` channel up — executing approved
commands, serving PTY, starting containers — with the revoked key, until it dropped
on its own.

**The one that sends the command is the api; the one that reaches the pid is the engine.** The api calls
`POST /internal/projects/:projectId/runner/disconnect` (the same internal HTTP with
the usual service token, never a second mechanism), and the engine finds the channel
via `Engine.Runners.Registry.whereis/1` — the pid it already handed out. The engine
**does not query the keys table** and the api **does not talk to the channel**; neither
of the two does the other's work, the same division as `EngineWeb.ContainerCommandController`
([RN-497](produto.md#rn-497)).

**The precision that exists is `{projeto, usuário}`, and the one that does not exist is
`{chave}` — by construction, not by taste.** `Engine.Runners.SocketTicket`
stores `project_id`, `user_id` and `kind`, and only that; the api requests the ticket with
`{userId, kind}`. The identity of the CREDENTIAL that originated the ticket (the PAT, or the
`kid` of the device key — [RN-475](web.md#rn-475)) dies in `PatAuthGuard` and
never reaches the socket. Carrying it there would require a new column in
`runner_socket_tickets`, a new field in the internal request and a new assign in
`connect/3`: an auth contract change, outside this delivery.

**A DECLARED cost, and named in the code, not only here:** a runner of the SAME
user connected with a PAT, or with another key of the same project, also drops. It
reconnects on its own — the next round requests a new ticket, and the credential that
is still valid gets one. Whoever was revoked does not, and that is where the revocation bites.
A runner of ANOTHER user on the same project **does not drop**: the comparison is
`socket.assigns.user_id`, inside the channel process, which is the only one that can
read it — and the `de_outro_dono` outcome goes back to the requester instead of an `:ok` that does not
describe what happened.

**It takes down the TRANSPORT, not just the channel process.** Stopping only the channel
would leave the socket alive and the Phoenix client re-entering the topic forever with
an already consumed ticket — silent degradation, exactly the defect ADR
0147 exists not to repeat. `EngineWeb.RunnerSocket.id/1` stops being `nil` and
now names the connection (`runner_socket:<kind>:<projectId>:<userId>`), and the
channel uses Phoenix's documented mechanism, `Endpoint.broadcast(id,
"disconnect", %{})`. It is through it that the runner NOTICES the drop: `onDisconnected`
resolves the round, the loop requests a new ticket and the api refuses.

**A side effect NEVER takes down the main effect.** The `DELETE` stays 204 and
idempotent: engine down, no runner connected or a timeout cannot
make the revocation fail nor become 5xx. The call to the engine lives in a
`try/catch` that only LOGS, inside the use case — the SAME rule as
`rag_searches` ([RN-479](#rn-479)) and `mirror_sync_result`
([RN-517](#rn-517)). And the four outcomes are information, not error: `sem_runner`
is the normal case of whoever revokes an orphan key ([RN-519](#rn-519)), and an UNKNOWN
outcome coming from the engine becomes `timeout` and never `derrubado` — between asserting
that the connection dropped and asserting that maybe not, the safe assertion is the one that does not
promise what is not known.

**Revoke FIRST, take down afterwards**, and the project comes from the revoked ROW, never from the
URL: the route's `projectId` was already ignored in the `DELETE`, and reading it here would make a
divergent `projectId` take down the runner of a project that has nothing to do with this
key.

- **Where:** `src/application/use-cases/auth/revoke-runner-device-key.use-case.ts:63`
  (the order, the row's project and the `try/catch` that only logs);
  `src/application/ports/api-to-engine-client.port.ts:433`
  (`disconnectRunnerOfUser`, `DesfechoDeDesconexaoDeRunner`);
  `src/infrastructure/http-clients/api-to-engine-client.ts:477`;
  `apps/engine/lib/engine/runners/revogacao.ex:92` (`derrubar/3`);
  `apps/engine/lib/engine_web/channels/terminal_channel.ex:697`
  (`handle_info({:derrubar_por_revogacao, …})`);
  `apps/engine/lib/engine_web/channels/runner_socket.ex:79` (`id/1`, which stopped
  being `nil`);
  `apps/engine/lib/engine_web/controllers/runner_connection_command_controller.ex:27`;
  `apps/engine/lib/engine_web/router.ex:86`
- **Test:**
  `test/application/use-cases/auth/revoke-runner-device-key.use-case.spec.ts`
  (`describe "a revogação alcança a conexão viva"` — the row's project; the
  revoke→take-down order; engine down not taking down the revocation; a 404 that
  takes down nobody);
  `test/infrastructure/http-clients/api-to-engine-client.spec.ts`
  (the route and the body; unknown outcome becoming `timeout`; a 500 that THROWS,
  for the use case to handle);
  `apps/engine/test/engine/runners/revogacao_test.exs` (no runner; the owner; the
  other owner; the ceiling; a malformed argument that does not raise);
  `apps/engine/test/engine_web/channels/terminal_channel_test.exs`
  (`describe "revogação alcança a conexão viva"` — the REAL channel that stops and
  releases the presence in the `Registry`, the other owner's one that stays up, the `:web` that
  is never a target);
  `apps/engine/test/engine_web/controllers/runner_connection_command_controller_test.exs`
  (the 200s with an outcome, and the 400 of a malformed request)
- **ADR:** [0147](../adr/0147-agente-local-com-capacidades.md), point 6
- **Origin:** PHASE 28, session 7. Declared and NOT done: revocation does not
  reach a runner connected in ANOTHER project with the same key — that case
  does not exist, because `runner_device_keys.project_id` ties the key to a single
  project; and no screen triggers this yet (the web half of [RN-519](#rn-519))

### RN-521 — The `/containers` page lists EVERY project of the workspace and becomes the HUMAN path to start the container, branched by `execution_mode` {#rn-521}

> **Extended by [RN-574](#rn-574) (ADR 0161):** a fourth local refusal
> reason, `sem_broker_na_instalacao`, for `container`/`mounted` in an
> installation without a container broker — after "already up" and before
> "no image decided".
>
> **Extended by [RN-590](#rn-590) (AT-105):** the same reading holds in the
> mode conversion, in stop/remove and in the Infra Lead's proposal (409 refusal
> from the api when proposing).

Starting a project's container had **one** path: the Infra Lead, inside
a session, calling its tool. In a real execution of `exp004` (`runner`
mode) `container_start_via_runner` failed due to the defect that
[RN-508](#rn-508) closed — and there was no way to TRY AGAIN. Five dev agents
spent hours emitting `dev.blocked_by_container`
([RN-502](engine.md#rn-502)), and the only way out was to open a new session and talk to an
agent to re-execute a machine operation.

The global containers page ([ADR 0136](../adr/0136-pagina-global-de-containers.md),
[RN-495](#rn-495)) was already the place where a HUMAN decides a container's
lifecycle — but it did not even show the project: the rule was "one row per project
that already has `project_containers`", and a start that fails BEFORE recording leaves
no row at all. The screen hid exactly the project for which it
needed to exist.

**The THIRD state has its own name, and it is not `stopped`.** The read model becomes a
LEFT JOIN (it was INNER) and `registrado` becomes `null` for those that never provisioned —
it is not a new value of `ContainerLifecycleStatus` (`stopped` is a container that
EXISTED and stopped), and it is not "not observed" (which is about the daemon having been
asked). The screen prints **"never provisioned"** and the Observed column says
`sem_container_registrado`, the third reason of `naoVerificado` — the three do not
collapse ([RN-088](web.md#rn-088)/[RN-486](#rn-486)).

**The list widened; the BUDGET did not.** Asking the broker for the observed state is a
network call per project, with a ceiling of 20 per load
(`TETO_DE_VERIFICACOES_POR_CARGA`). A project without `project_containers` has nothing
to observe, so it is never eligible and **never takes up a slot**: in a workspace
with hundreds of empty projects, those with a real container stay
verified exactly as before. And it remains THREE batch queries, however
many projects there are — none inside a loop.

**The action branches by `execution_mode`, with the same rule as the backend
([RN-497](produto.md#rn-497)/[RN-503](#rn-503)):** `container` and `mounted` propose
`container_start` (broker, on the server) and `runner` proposes
`container_start_via_runner` (local agent, on the user's machine). The TWO
payloads are different on purpose and are not copied: `container_start` carries
the image ELECTION (image, network, resources), read from the project's current decision
at click time; `container_start_via_runner` has a schema **with only `rationale`**
([RN-508](#rn-508)), because it starts the ALREADY decided image and elects nothing.

**The screen does NOT propose what is already known to fail — and says the reason in place
of the button.** Three refusals, each with its own text, in the order "state of the WORLD
before the capability of whoever is looking" (so a `viewer` still reads "the image remains to be
decided", and not only "you cannot"):

1. **no image decided** — the gate of [RN-105](#rn-105), which holds in all THREE
   modes since [RN-494](broker.md#rn-494); without `artifact.project_image` there is nothing to
   start;
2. **`runner` that never had a confirmed folder** (null `workspaceVerifiedAt`,
   [RN-423](runner.md#rn-423)) — no local agent ever connected, so the action
   would fail for sure. The same honesty the Infra Lead's tool already
   practices when refusing LOCALLY before proposing ([RN-508](#rn-508));
3. **role below `maintainer`** — the minimum is that of the ENDPOINT
   ([RN-102](#rn-102)): both types require `maintainer` in `decide.ts`, and the
   comparison comes from `roleAtLeast`, never from a hand-written list of roles. What is
   taken away is the CONTROL, never the INFORMATION ([ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)):
   whoever cannot still sees state, image and resources, and the reason is said ONCE
   in TEXT — `title` on a `disabled` element does not open in Chromium.

**And what the screen does NOT know, it declares instead of promising.**
`workspaceVerifiedAt` is the record of ONE confirmation and never a heartbeat
([RN-468](web.md#rn-468)): non-null does not prove a local agent connected NOW, and the api
has no presence signal (what knows about now is the Phoenix channel, in the engine).
So the `runner` row offers the button **with a written caveat** — "if it is not
running now, the action fails when approved" — instead of a green
dot that would lie.

**No ceiling moved.** Every proposal on this screen is a `proposed_action`,
always with a HUMAN clicking, never an agent; `container_remove` stays at the
absolute ceiling ([RN-418](#rn-418)) and `decide.ts` stays byte for byte. The role read
is the WORKSPACE one, and the gap is declared: the effective one is
`projectRole ?? workspaceRole` ([RN-471](web.md#rn-471)), and fetching `project_members`
per row would be the network N+1 this page exists not to pay —
whoever was DEMOTED in a project still sees the button and gets a 403, which is the
repairable defect (it ends in a toast), not the invisible one.

- **Where:**
  `src/infrastructure/persistence/drizzle/containers-overview.repository.ts:96`
  (the LEFT JOIN, the `ORDER BY` and `temImagemDecidida`);
  `src/application/ports/containers-overview-repository.port.ts:20`
  (`executionMode`/null `lifecycle`/`temImagemDecidida`/`workspaceVerifiedAt`);
  `src/application/use-cases/containers/obter-visao-geral-de-containers.use-case.ts:33`
  (`sem_container_registrado`) and `:101` (`elegivelParaVerificacao`, which is what
  keeps the budget intact);
  `src/interfaces/http/containers/containers-overview.controller.ts:60`;
  `apps/web/src/routes/containers-subida.ts:114` (`decidirSubida`, the whole
  rule, pure);
  `apps/web/src/routes/ContainersPage.tsx:119` (the two payloads)
- **Test:**
  `test/application/use-cases/containers/obter-visao-geral-de-containers.use-case.spec.ts`
  (the third state with its own reason; 25 empty projects that do NOT push
  the 20 with a real container out of verification);
  `test/infrastructure/persistence/drizzle/containers-overview.repository.spec.ts`
  (a project without `project_containers` in the list; `temImagemDecidida`;
  pending `container_start_via_runner`; the THREE queries that do not grow);
  `test/interfaces/http/containers/containers-overview.controller.spec.ts`
  (the nested `registrado` and the `null` that survives the conversion);
  `apps/web/src/routes/containers-subida.test.ts` (the branching by mode, the
  three refusals, the caveat, the role hierarchy);
  `apps/web/src/routes/ContainersPage.test.tsx` (the REAL scenario of `exp004`:
  a `runner` project, no row, image decided, folder confirmed → the action
  proposed is `container_start_via_runner` with a payload of only `rationale`, and
  `GET .../container` is not even called)
- **ADR:** [0136](../adr/0136-pagina-global-de-containers.md) (the page),
  [0145](../adr/0145-docker-pre-requisito-do-runner.md) (the action type),
  [0133](../adr/0133-infra-elege-imagem-do-roteamento.md) (the other one)
- **Origin:** real execution of `exp004`, decision of the product owner. Declared
  and NOT done: the screen does not know whether a local agent is connected NOW (there
  is no presence signal in the api), and the role read is the workspace one, not the
  project's effective one

## The repository is born at the handoff to the Dev Lead (RN-522) {#o-repositorio-nasce-no-handoff-para-o-dev-lead-rn-522}

### RN-522 — The repository is provisioned on ACCEPTING the Arquiteto → Dev Lead handoff, always `local`, and the failure never takes down the acceptance {#rn-522}

> **Revised by [RN-582](#rn-582) ([ADR 0165](../adr/0165-o-repositorio-nasce-no-handoff-ao-arquiteto.md)):**
> the TRIGGER became accepting the handoff to the **Arquiteto**. Accepting to the Dev
> Lead described below keeps provisioning, as an idempotent second door,
> and the rest of this rule (always `local`, failure as an event, adopted is not
> a failure) still holds. The text below is that of the original decision.

[RN-541](web.md#rn-541) took provisioning out of creation and declared that the trigger
would come next. This is the trigger — and without it a created project would stay without a
repository **forever**, because `ProvisioningPage` was the only caller of
`provisionRepository` in the web and creation stopped navigating there.

The moment is **accepting the handoff from the Arquiteto to the Dev Lead**, and not
execution activation. They are DISTINCT instants, in this order: accepting the handoff
activates the Dev Lead; activating execution is when the dev agents start claiming
tasks. It is at the first that "development has started" becomes true, and it is
what the product owner asked for — *"quando o arquiteto passar o handoff para o
desenvolvedor iniciar o desenvolvimento"*.

The branch lives in `AcceptHandoffUseCase`, next to the `'infra'` branch that already existed
and for the same ordering reason: the effect happens **before** `activateAgent`, so
that the agent wakes up in a project that already has somewhere to work.

**Always `local`.** It is the only provider that asks for no credential at all — the
`if (providerName !== 'local')` of `ProvisionRepositoryUseCase` never gets to
resolve a secret, and `LocalGitProvider.createRepo` does not even read the `accessToken`
the signature accepts. That is what makes **automatic** provisioning
possible: nobody chose hosting in the middle of the acceptance, so there is no credential
to fetch nor question to ask. Publishing to a remote provider remains a
separate path (adoption, or conversion in Settings) — declared, not
forgotten. Accepted side effect: `protectBranch: false` in the local provider makes
the last bootstrap step **degrade** (`step_degraded`), never fail.

**The failure becomes an EVENT, never an exception.** This use case has no transaction:
when provisioning runs, `updateStatus('accepted')` and the
`handoff.accepted` event are already COMMITTED. A throw would return a 500 to the user about
a handoff that, in the database, was accepted — and would also prevent the `activateAgent` right
below, leaving the Dev Lead not waking up because of a git failure. So the
outcome goes to the event log as `repository.provision_failed`, with `origem` and
the real message, and the acceptance proceeds. It is the usual rule: a failure records the origin
and never becomes an empty response.

**What is NOT a failure:** a project that ADOPTED a repository. `ProvisionRepository`
refuses that case with `ConflictException` on purpose — bootstrapping a third-party
repository only runs by plan approval (RN-045) —, but the project HAS a
repository, so there is nothing to provision and recording that as a failure would lie
about its state. The branch queries `findByProjectId` and exits before. A
`created` repository that already exists is **not** skipped: it falls into the normal use case, which is
idempotent by design ("running again does not fail"), and that is how an
interrupted bootstrap completes.

- **Where:**
  `src/application/use-cases/agents/accept-handoff.use-case.ts` — the
  `dev-lead` branch in `execute` and the private method `provisionarRepositorio`, with
  the `try/catch` and the early exit for the adopted repository;
  `src/application/use-cases/agents/agents-use-cases.module.ts` (the
  import of `GitUseCasesModule` — the arrow is `agents → git`, and `git` does not import
  `agents`, so there is no cycle)
- **Test:**
  `test/application/use-cases/agents/accept-handoff.use-case.spec.ts`
  — happy path ("aceitar para o Dev Lead provisiona `local` com o slug do
  projeto"), the two failure cases ("provisionamento que falha NÃO derruba o
  aceite nem a ativação" and "a falha vira evento nomeado, com origem e a mensagem
  real"), and the limits ("aceitar para OUTRO agente não provisiona nada",
  "projeto que ADOTOU repositório não provisiona, e isso não é falha",
  "repositório já CRIADO cai no caso de uso, que é idempotente por desenho")
- **Origin:** request of the product owner — *"o gatilho deve vir quando o arquiteto
  passar o handoff para o desenvolvedor iniciar o desenvolvimento"*

## The MACHINE key that the installer registers (RN-552) {#a-chave-de-maquina-que-o-instalador-registra-rn-552}

### RN-552 — An internal route registers the MACHINE device key, for the installation's SOLE user, and registering REPLACES {#rn-552}

Session 7 of [PHASE 30](../explanation/fase-30-runner-por-maquina.md), closing
point 4 of [ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) on the
kind of key [ADR 0154](../adr/0154-chave-de-dispositivo-de-maquina.md)
created. It is the gap [RN-543](produto.md#rn-543) declared in writing and left open
on purpose, by the `DEPLOY_ENABLED` rule: *"no api route creates a machine
key yet; that is `install.sh`, and it is born with the first caller"*. The
caller arrived — it is session 6's installer —, so the route is born.

**The route.** `POST /internal/machine-device-keys`, `engine-service`. Body
`{ name, publicKeyJwk }`, response `201` with
`{ id, userId, name, createdAt, replacedKeyIds }`. No `GET` and no `DELETE`.

**The credential is the SERVICE TOKEN, and the alternative was refused for a written
reason.** It is the same installer, in the same minute, in the step following that of
[RN-546](produto.md#rn-546): the `BRABO_SERVICE_TOKEN` was generated by `install.sh` itself
and written to `.env` with mode `600`, so presenting it proves control of the
**machine** — which is exactly what this step wants to prove. The real candidate
on the other side was the freshly created user's credential, and it contradicts
ADR 0155 itself: the password is read in the TTY, *"used and discarded"*, and point 5
declares that *"the installer does not log in for anyone"*, which is why the
first account's response does not return a session token. Requiring it here would force
the installer to create, on the machine, the live session that ADR refused to create.

**What that choice costs, declared and not hidden.** A leaked
`BRABO_SERVICE_TOKEN` can now **manufacture** a durable access
credential for a user — not only talk to the internal routes. It is stated
here, in [`security-surface.md`](../security-surface.md) and in the controller's
docblock, next to the sibling declaration of the first account. What the key grants
did not increase: it gives the local agent exactly the projects its owner already
reaches at `developer`, resolved against the requested project ([RN-543](produto.md#rn-543)).

**The route does not know how to choose whose key it is.** **There is no `userId` in the body.** The
owner is the installation's SOLE user, resolved by
`UserRepository.usuarioUnicoDaInstalacao()` (`LIMIT 2`, never `LIMIT 1`: with
one row it would be impossible to distinguish "there is exactly one" from "there are many"); with
zero or more than one, `409` and **nothing is written**. It is the exact analogue of the condition
of [RN-546](produto.md#rn-546) — about the INSTALLATION, never about the requested argument —, and
it is what prevents whoever has the token from choosing the victim. Declared consequence:
in an installation with two people the route no longer works, for anyone. It goes
silent as the first account one goes silent, and for the same reason — it belongs to the
MOMENT of installation, not to the product's life.

**Registering REPLACES, never accumulates.** Every active MACHINE key of the owner is
revoked in the SAME transaction, and the ids come back in `replacedKeyIds`. A
reinstalled machine is a legitimate case and keeps passing; a thousand machine keys become
impossible — and not by a number that ages, but because the set of live
machine keys of a user never exceeds one. The revocation comes
BEFORE the registration: revoking afterwards would leave a window with both alive, and
failing in the middle would leave the installation with two machine credentials and no
way of knowing which is the new one. Only the MACHINE ones fall (`project_id IS NULL`): the
PROJECT ones came from the browser ([ADR 0118](../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)),
in a flow this route does not know, and taking them down would erase the pairing of
whoever already uses the product — the error [RN-545](runner.md#rn-545) named when refusing
to convert someone else's installation silently.

**The response returns the `id` because it becomes the `kid`.** It is the lesson of
[RN-475](web.md#rn-475), the most expensive in this area: the record's id is written INSIDE
the private JWK, in the `kid`, and the whole chain only PASSES IT ON — the local agent reads
`jwk.kid`, the ticket JWT carries it in the header, `PatAuthGuard` finds the public key
by it. Nobody derives that id from anything else, and it was for lacking it that the browser's
automatic mode never authenticated. The `userId` also comes back, RESOLVED
by the api: the caller does not send it, and returning it lets the installer **check**
against the account it just created instead of assuming.

**The private key never travels, and one that arrives is REFUSED.** The pair is generated on the
machine and only the public half goes up — the same design as the browser, for the same
reason, keeping true the sentence [RN-519](#rn-519) uses. The shape
validation became a SINGLE rule in the domain (`exigirJwkPublicaEd25519`), called by the
TWO registrars: two copies would diverge on the first day one of them
changed, as the password policy of [RN-546](produto.md#rn-546) already resolves. And it gained
a case neither of the two had: a JWK with **`d`** answers `400` saying what
arrived. `d` is the private half of an OKP JWK (RFC 8037 §2) and only arrives by
the mistake of whoever serialized the whole pair — before, it passed the check (it has
`kty`, `crv` and `x` like any public one) and was **written**. Refusing is the
answer; the message names what came, because a generic "invalid JWK" would make
the person try again with the same file.

**Its own kind in the auth trail.** `machine_device_key_registered`: this is the
only durable credential of a user that is born without that user authenticating
anything — what proves is control of the machine. Under suspicion of a service token
leak, it is that row that says when and for whom it was created, and the
`metadata` carries the ids it replaced, never the JWK nor the name.

**No `GET` and no `DELETE`, and what that costs.** Listing through here would publish,
to whoever only has the machine's token, the credentials inventory of a person;
revoking already exists where there is a human owner
(`DELETE /projects/:projectId/runner-device-keys/:deviceKeyId`, which matches by
`{id, usuário}` and never by project). The asymmetry has a price, and it is
declared: in an installation that has no project yet, **no screen reaches
a machine key** — and that is precisely why registering REPLACES instead
of leaving orphans behind, which would be alive and unreachable.

**What did NOT come in:** a public route (same race as [RN-546](produto.md#rn-546));
`userId` in the body; a machine key for an installation with a team (declared above
as a gap, not as an accident); a new table (a machine key is still
a row of `runner_device_keys` with `project_id NULL`, [ADR 0154](../adr/0154-chave-de-dispositivo-de-maquina.md)
point 1) — and **no migration**, because the column is already nullable since
[RN-543](produto.md#rn-543).

- **Code:** `src/interfaces/http/internal/internal-machine-device-keys.controller.ts:87`
  (the route's `@Post()`, and the docblock with the credential choice),
  `src/application/use-cases/auth/registrar-chave-de-maquina.use-case.ts:122`
  (the resolved owner), `:124` (the `409`), `:136` (the replacement before the
  registration) and `:146` (`projectId: null`, what makes it a machine key),
  `src/domain/auth/jwk-de-dispositivo.ts:33` (the single rule) and `:59`
  (the refusal of the private key),
  `src/infrastructure/persistence/drizzle/user.repository.ts:31`
  (`usuarioUnicoDaInstalacao`, `LIMIT 2`),
  `src/infrastructure/persistence/drizzle/runner-device-key.repository.ts:148`
  (`revogarChavesDeMaquina`, the two `IS NULL`),
  `src/domain/auth/auth-event.ts` (`machine_device_key_registered`),
  `src/interfaces/http/internal/dto/machine-device-key-internal.dto.ts`
  and `…/machine-device-key-internal.response.dto.ts`
- **Test:** `test/application/use-cases/auth/registrar-chave-de-maquina.use-case.spec.ts`
  (happy path with a null `projectId` and resolved owner; the `409` without a sole
  user, without writing anything; the replacement BEFORE the registration; the private key
  refused before opening a transaction; the trail without the JWK);
  `test/domain/auth/jwk-de-dispositivo.spec.ts` (the single rule, with the
  `d` and the curve's precedence);
  `test/interfaces/http/internal/internal-machine-device-keys.controller.spec.ts`
  (the response contract, the body WITHOUT an owner, and the guard's three);
  `test/infrastructure/persistence/drizzle/user.repository.spec.ts`
  (one user returns; two return `null`, never "the first");
  `test/infrastructure/persistence/drizzle/runner-device-key.repository.spec.ts`
  (the replacement against the real Postgres, and what it does NOT take down);
  `test/interfaces/route-surface.spec.ts` (the route classified)
- **ADR:** [0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) point 4, on
  the kind created by [0154](../adr/0154-chave-de-dispositivo-de-maquina.md)

## The self-demotion ceiling also on REMOVAL (RN-556) {#o-teto-de-auto-rebaixamento-tambem-na-remocao-rn-556}

### RN-556 — Removing one's own `project_members` row is refused with 403 when the net effect is a demotion {#rn-556}

> **About the number.** The jump from [RN-542](produto.md#rn-542) to 556 is deliberate: the
> range 543–555 is reserved for PHASE 30, which has already allocated it in branches in
> flight. Allocating here would produce the collision this repository has already observed three
> times at the same instant (ADR 0148 ×2, RN-522 ×2, RN-523 ×2), resolved afterwards
> by DATE. Nothing was skipped by mistake.

[ADR 0127](../adr/0127-tetos-de-rebaixamento-em-project-members.md) put the two
ceilings of [RN-472](#rn-472) only on the WRITE path and declared the third
movement open, in writing and with the estimated cost: *"`RemoveProjectMemberUseCase`
did NOT gain a ceiling… The premise that 'removal is always benign' is false, and it stays
written here so as not to be rediscovered"*. This RN closes that door — it is
`BRB-001`, security P1.

**Removing does not erase a role, it SWAPS the effective role.** `ResolveEffectiveRoleUseCase.forProject`
is `projectRole ?? workspaceRole` ([RN-471](web.md#rn-471)), and the overlay holds in
BOTH directions. Remove the project row, and the effective one starts resolving by the second
term — which can be SMALLER. A `maintainer` whose authority came from the
project row, `viewer` in the workspace, removed their own row and fell to `viewer`
with no way back through the screen: restoring is `POST :projectId/members`, which requires the
just-abandoned `maintainer`. Without any workspace role, the fall is to NO
access.

**It is ceiling 2, not a new ceiling.** `ehAutoRebaixamento` compares TODAY's effective
role with the AFTER one, and never needed to know by which route the second arrived:
in `add` the after-role comes from the body, in removal it comes from the workspace.
`remocaoEhAutoRebaixamento` is that application, and it DELEGATES — it reimplements no
comparison at all. It exists as its own function for ONE case the other's signature
cannot state: an actor without a workspace role, where the after-role is
"none", which is not a `Role`. That case is the maximum demotion and refuses.

| movement | outcome |
|---|---|
| removing one's own row, workspace with the SAME role | passes — it is how someone leaves the list |
| removing one's own row, workspace with a LOWER role | **403** |
| removing one's own row, WITHOUT a workspace role | **403** — the fall is to no access |
| removing ANOTHER person's row, even if they fall | passes — the usual legitimate capability |
| removing the row that restricted the WORKSPACE `owner` | passes — it can only RAISE |

**Ceiling 1 gains no counterpart, and the absence is a decision.** `owner` is the top of
`ROLE_ORDER`: removing the project row of someone who is `owner` in the workspace can only
raise their effective role, or keep it. More than harmless, it is the ONLY way to
undo a restriction ceiling 1 prevents from being created. A ceiling there would refuse only
benign movements and make permanent the state ADR 0127 was born to
eliminate. It is written next to the function and pinned in a test.

**Without a threshold, like ceiling 2 — and the price comes with it.** The refusal is "oneself",
not "below `maintainer`", for the same reason as RN-472: a threshold would copy a
number from the controller's `@RequireRole` into the domain and would age
silently if the route changed its minimum. The declared price is the self-removal of whoever
has `owner` in the project and `maintainer` in the workspace: reversible, and refused
too. It was the only benign movement that passed before and now refuses; it stays
reachable by another `maintainer`.

**The message is its OWN.** Whoever clicked "remove" did not ask to change any
role, so `MENSAGEM_TETO_AUTO_REBAIXAMENTO_POR_REMOCAO` states the MECHANISM —
without the project row the role falls to the workspace's, and coming back requires the
abandoned role — instead of reusing the `add` sentence, which would talk about a movement
the person did not make.

**The screen does not change, and the refusal shows up.** `MembersSection.handleRemove` already
shows `mensagemDaApi(erro, …)` in a toast ([RN-471](web.md#rn-471)), so the api's sentence
arrives without a line of web. Unlike ceiling 1, this gate IS computable on the
client — but computing only it would produce the half-gate ADR 0127 refused.

- **Code:** `src/domain/iam/tetos-de-rebaixamento.ts`
  (`remocaoEhAutoRebaixamento` and `MENSAGEM_TETO_AUTO_REBAIXAMENTO_POR_REMOCAO`,
  plus the comment saying why ceiling 1 has no counterpart),
  `src/application/use-cases/iam/remove-project-member.use-case.ts`
  (the signature with `atorId` and the two role reads),
  `src/interfaces/http/iam/projects.controller.ts`
  (`@CurrentUser()` on `@Delete(':projectId/members/:userId')`, the corrected
  description and the `@ApiForbiddenResponse`),
  `src/application/use-cases/iam/resolve-effective-role.use-case.ts`
  (UNTOUCHED — `projectRole ?? workspaceRole` stays as is)
- **Test:** `test/application/use-cases/iam/tetos-de-rebaixamento.use-case.spec.ts`,
  block *"Teto 2 pela outra porta — a remoção da própria linha"* (the three
  refusals; the benign self-removal; removing another person; and the removal that
  returns the project to the workspace `owner`). The first of them is ADR 0127's gap
  test INVERTED, with the name keeping its origin
- **ADR:** [0156](../adr/0156-teto-de-auto-rebaixamento-na-remocao.md), which
  references [0127](../adr/0127-tetos-de-rebaixamento-em-project-members.md) and
  closes the gap it declared
- **Origin:** `BRB-001`, Security P1 of the maintainer's registry — the gap
  ADR 0127 wrote with the sentence *"whoever closes it sees the test fail"*

---

## Master key rotation stops being trial and error (RN-562, RN-563) {#a-rotacao-da-chave-mestra-deixa-de-ser-tentativa-e-erro-rn-562-rn-563}

### RN-562 — Master key rotation is proven end to end, in both tables {#rn-562}

The procedure with the worst outcome in the [Runbook](../runbook.md#rotacao-da-chave-mestra)
now has a NAMED verification: a test walks through the whole rotation —
**encrypt with K1, publish K2, rewrap, discard K1 and still decrypt** — against
`user_credentials` **and** `project_git_connections`, with a real Postgres.

**Why integration, and not one more unit case.** What already existed
(`envelope-encryption.service.spec.ts`, the `rotação da chave mestra` describe)
exercises `encrypt`/`decrypt`/`rewrap` in memory, and that does not prove the only thing
step 3 of the runbook depends on: that the script walks through **both**
tables. Converting half the holdings and reporting success, discarding the old key
would make the other half unreadable forever. The proof of that is the assertion about
the two rows — and it fails when the script's list of tables shrinks.

**Idempotency goes into the same test**, because it is the property the runbook
promises to whoever interrupts the script: the second round reports
`re-embrulhados=0` and `já na chave atual=1` in both tables.

**An unreadable row does not abort the others.** A record wrapped by a
THIRD key — the case the runbook calls "came from another environment" — is
counted, identified by table and id, and lets the others continue; its
envelope stays untouched.

**What the test required of the code:** `rewrap-deks.ts` was a `main()` fired
at MODULE LOAD, so importing it from a spec would run the rotation. The core
became `reenvelopar(db, cofre, reportarFalha)`, exported, and `main()` — which reads
the environment, opens the pool, prints and chooses the exit code — now runs only
under `require.main === module`. The script's name and the runbook's invocation
(`node scripts/rewrap-deks.js`) did NOT change.

**No key and no secret is literal in the test**: both are born from
`randomBytes` each round. A constant passphrase in a fixture is a string that looks like
a secret going into history, and gitleaks sweeps branches.

- **Code:** `src/scripts/rewrap-deks.ts:93` (`reenvelopar`, the
  exported function), `:100` (the list of the two tables, which is what the test pins),
  `:209` (the `require.main === module` that prevents the import from rotating)
- **Test:** `test/scripts/rewrap-deks.spec.ts` — the happy path
  (the sequence K1 → K1+K2 → rewrap → only K2), idempotency, and the
  failure case of the row from another environment, which also asserts that the report does NOT carry
  any secret
- **Origin:** AT-033 (EP-015/HS-022), finding `BRB-010`

### RN-563 — The envelope says which key wrapped it, and that label never decides whether it opens {#rn-563}

`user_credentials` and `project_git_connections` gain a **nullable** `key_id text`
— the fingerprint of the master key that wrapped that DEK. With it, the
question that decides step 3 of the rotation (*"is there still a credential on the old
key?"*) becomes a query:

```sql
select count(*) from user_credentials      where key_id is distinct from '<atual>'
union all
select count(*) from project_git_connections where key_id is distinct from '<atual>';
```

`IS DISTINCT FROM`, e nunca `<>`: with `<>`, a linha de `key_id` — the
holdings prior to this column — would disappear from the count, and *"I don't know which key"* would become
*"it is already on the current one"*, which is the reading that makes someone discard the old key
too early.

**The value is `HMAC-SHA256(chave derivada, 'brabo-master-key-id')` truncated to 8
bytes**, and not a counter in `.env` nor a hash of the passphrase. There is no new
oracle, and that was MEASURED, not assumed: whoever reads the database already has a perfect
verification oracle — the envelope itself is AES-256-GCM, which authenticates, so
testing a candidate passphrase already cost one `scrypt` and one decipher. Testing it
against the fingerprint costs the SAME `scrypt`. And there is no new variable for the
operator to get wrong: the value is a pure function of the key they already published.

**The label is OBSERVABILITY, never AUTHORITY.** `decrypt` stays byte for byte
as it was — tries the current one, falls back to the previous one, GCM decides — and `rewrap`
keeps deciding "it is already on the current key" by ATTEMPT. Trusting the label
would make a row that LIES (label "current", envelope on the old key) be skipped
silently, stay out of the re-wrapped count, and step 3 would make it
unreadable forever. Incoherent metadata becomes secret loss; that is why
the test that pins this rule is that of a lying row being re-wrapped
anyway.

**What the label buys on failure:** when NEITHER of the two keys opens, the
message stops being generic and names the case — "came from another environment"
(unknown label), "incoherent label or tampered record" (label says
current and does not open) and "has no key_id" (row prior to this column) are
different diagnoses with different actions. None of these messages carries
the passphrase, derived key or secret content — only fingerprints.

**No migration of the holdings.** The `key_id` is born at the next write (`encrypt` e
`rewrap` o gravam). As linhas de hoje ficam `NULL`, and in an existing installation
the query only becomes valid after the first rotation. Forcing a rewrap of
everything just to fill the column would turn observability into a risky operation
on all credentials.

**The operator needs the current fingerprint**, otherwise the column compares
against nothing: the api records it at boot in one line, and the rotation warning
that already existed now names BOTH.

- **Code:** `src/infrastructure/security/envelope-encryption.service.ts:130`
  (`impressaoDigital`), `:107` (a linha de boot), `:113` (the warning with the
  two), `:226` (the `rewrap`), `:251` (`diagnosticoDaChave`);
  `src/db/schema/llm.ts:259` e `src/db/schema/git.ts:76`
  (a coluna nas duas tabelas); migration
  `src/db/migrations/0059_key_id_no_envelope.sql`
- **Teste:** o describe `key_id da chave mestra` em
  `test/infrastructure/security/envelope-encryption.service.spec.ts`
  — the happy path (stable and deterministic fingerprint, written by `encrypt`
  e por `rewrap`), **the proof that the label does not decide** (a lying row is
  re-wrapped), the legacy row without a label, and the two failure cases
  (message that names the key without leaking a secret; "no label" stated as such).
  The real SQL query is in
  `test/scripts/rewrap-deks.spec.ts`, incluindo o caso da linha `NULL`
  contando como pendente
- **ADR:** [0158](../adr/0158-o-id-da-chave-mestra-gravado-no-envelope.md)
- **Origem:** AT-034 (EP-015/HS-022), finding `BRB-016`

---

## A chave de dispositivo ganha tela, e a tela diz o alcance de revogar (RN-561)

### RN-567 — `proposed_action.created` says WHICH rule decided: the `reason` of `decide()` now survives when the action passes {#rn-567}

`decide()` always returned a pair — `policy` and `reason` —, and the reason is
written at every return point: insufficient IAM, the container
floor ([RN-492](engine.md#rn-492)), `agent_autonomy`, the lines of
`permissions.json`, the compound command, and each absolute ceiling. But
`ProposeActionUseCase` only kept it in one place: `rejectionReason`, which
`initialStatusFor` fills in **only** when the policy denies. On an
auto-approval — the outcome that most needs auditing — the event log
said *"the policy decided"* ([RN-049](#rn-049)) and
never *which* rule. `status` made auto-approval distinguishable from a
click; the reason is the next step.

**The rule:** the payload of the SESSION event `proposed_action.created` gains
`reason`, with the string from `decide()` **as is**, in all THREE outcomes —
`auto_approved`, `pending` and `denied`. No second "structured" rule is born:
the string is already the source, and a parallel enum would diverge from it on the
first new ceiling. In `denied` the value is the SAME that becomes
`rejectionReason`.

**The outbox does NOT gain the field, and that is a decision.** The outbox row
`proposed_action.created` is an api↔engine contract, and no engine consumer
reads the reason; widening a contract without a consumer is the cut that
[ADR 0153](../adr/0153-deploy-enabled-o-gatilho-que-ninguem-cria.md) names. The
`session_event.appended` row that `AppendSessionEventUseCase` writes for the
same event carries only `eventId`/`seq`/`type`, so the reason also does not
leak through it.

**Absent is not "no reason".** An event written before this rule does not have the
field, and there is no reprocessing nor new column: whoever reads treats an absent `reason`
as "not recorded". Every new event has the field, because
`Decision.reason` is a mandatory `string` in the type.

Nothing in `decide()` changes — no ceiling, no verdict, no string. The
screen also does not change in this rule: the reason comes to EXIST in the log, and
showing it is another delivery. (Since [RN-614](web.md#rn-614) the screen shows it on the
event's line in the log panel and in the `ApprovalCard`, through the same sentence.)

**What the reason does NOT say, declared:** it names the rule, not the scope's
ROOT — point 7 of [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md)
asked for *which root* authorized, and `escopo: cd dentro da pasta do projeto` does not
carry the path. (The root started going in the event in its OWN field since
[RN-609](#rn-609), relative and never absolute.) In the compound command, the reason says all segments
hit `allow`, without saying which pattern matched which segment. And the
lines of `permissions.json` repeat the command's TOKENS in the text (the `label` of
`matchAgainstFile`) — the same command that already lives in
`proposed_actions.payload` and on the approval card.

- **Code:** `src/application/use-cases/actions/propose-action.use-case.ts:264`
  (`reason` in the session event payload), `:223` (the comment on the outbox
  without the field), `:227` (the outbox payload, intact), `:356` (the
  `rejectionReason`, which stays only on `deny`);
  `src/domain/actions/decide.ts:292` (`Decision`, the string's source)
- **Test:** `test/application/use-cases/actions/propose-action.use-case.spec.ts:902`
  (happy path: auto-approval records `agent_autonomy: auto_approve`),
  `:948` (`require_approval` by default and by the merge lock ceiling),
  `:1047` (`deny` with the same text as `rejectionReason`), `:999` (the outbox
  without `reason`)
- **ADR:** [0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md),
  [0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) (point 7,
  partially)
- **Origin:** AT-066

### RN-569 — The graph is rebuilt from the event log by the SAME translator as the live projector, without touching the outbox, and never comes out as a silent success {#rn-569}

[ADR 0152](../adr/0152-backup-de-volumes-contra-compose.md) (decision 4) refused
a backup of `neo4j_data` based on a premise — *the graph can be discarded
because it can be rebuilt* — whose mechanism did not exist: `grep` for
`reprojet`/`reproject` in `apps/` and `scripts/` came back empty, and
`application/graph-projection/` only had the FORWARD projector. While it did not
exist, the graph was not discardable: it was lost.

**The rule:** `src/scripts/reprojetar-grafo.ts`
(`pnpm --filter api grafo:reprojetar`; `node scripts/reprojetar-grafo.js` in the
image) rebuilds the graph by sweeping the source. Five decisions, each with a
reason:

1. **A single translator.** The event → node/edge translation LEFT `GraphProjector`
   for `GraphEventTranslator`, and both paths call it — the projector reaches the
   source through an outbox row, the reprojection through a cursor. Two translators
   would diverge, and the divergent one would be the one that runs once a year. The projector's injection
   surface did NOT change (it builds the translator with the dependencies it
   already received). A test fails a new type in `GRAPH_PROJECTABLE_EVENT_TYPES`
   without a translation.
2. **The sources are two, and they are the real ones.** `handoff.offered`,
   `psychologist.hypothesis_proposed` and `anamnese.profile_updated` come from
   `session_events`; the `Interacao` comes from `sessions` in
   `closed`/`closed_abnormally`, because closing a session is a pure transition and leaves
   no event in the log. `PromptTemplate`/`PromptVersion` do NOT come from the event log and
   are NOT reprojected — they come back through `scripts/dev/seed-prompts.ts`.
3. **Idempotent, in batches, and never deletes.** Every write is a `MERGE` on a natural
   key; running again is the way to resume. `session_events` is swept in
   `id` order (ULID, the primary key), 200 per batch, and `--after-event`
   resumes after the printed cursor. With `--project`, only that
   project's sessions.
4. **It does not touch the outbox.** The live projector keeps its progress in
   `outbox_events.processed_at`; the reprojection neither reads nor writes that table, and
   that is why it runs with the api up without stealing, reopening or marking rows.
5. **Never a silent success.** A disabled graph is refused BEFORE reading the log (an
   empty scope "would pass" with zero projected); a Neo4j that drops midway stops with
   the last completed event; a nonexistent project is refused without writing anything; and
   an item with an incoherent payload is counted, named, and the process exits with 1.

**What this rule does NOT close:** `PerfilAnamnese` is a snapshot per user +
dimension, WITHOUT a project — the last to write wins —, so a round with
`--project` may leave it at that project's value when another wrote later;
the full round restores the global last one. There is no time measurement on a large
event log (the only real round was the dev compose, 98 events, 2.5 s), and the
proof on the local cluster that BRB-018 asks for was not done — it remains open.

- **Code:** `src/application/graph-projection/graph-event-translator.ts:15`
  (`EVENTOS_DO_LOG_PROJETAVEIS`), `:31` (`FECHAMENTOS_DE_SESSAO`), `:56` (the
  translator), `:75` (`projetarEvento`), `:99` (`projetarFechamentoDeSessao`);
  `src/application/graph-projection/graph-projector.ts:77` (the projector
  builds the SAME translator), `:141` (reaches the source through the outbox and delegates);
  `src/scripts/reprojetar-grafo.ts:124` (`montarTradutor`), `:145`
  (`reprojetarGrafo`), `:154` (the refusal before reading), `:163` and `:169` (nonexistent
  project), `:187` (the events phase, by cursor), `:213` (the named
  interruption), `:218` (the failure counted without aborting the rest), `:230` (the phase of the
  closed sessions), `:301` (`lerArgumentos`), `:370` (only the direct invocation
  reprojects); `package.json:44` (`grafo:reprojetar`); `Makefile:61`
  (`test-reprojecao`)
- **Test:** `test/scripts/reprojetar-grafo.spec.ts:349` (forward projector
  → delete the subgraph → reproject the whole log → same count of nodes and
  edges and same list of keys; the identical second round; the outbox intact),
  `:394` (per project), `:417` (nonexistent project, nothing written — failure
  case), `:432` (unavailable graph is a named error — failure case), `:441`
  (unknown argument refused), `:452` (the translator covers exactly the
  projectable types); `test/application/graph-projection/graph-projector.spec.ts`
  (the forward projector, unchanged, over the extracted translator). The first four
  require Neo4j up and SKIP without it — the api's CI does not bring up Neo4j.
- **Origin:** AT-032 (BRB-018) — the premise of ADR 0152 without a mechanism

### RN-573 — The creation wizard only preselects the mode the installation executes: without a broker, `runner` is the suggested one and `container`/`mounted` stay inert with the reason in text {#rn-573}

In a real installation of v6.1.0 (AT-085), the wizard preselected `mounted`
— `install.sh` always writes `BRABO_PROJECTS_BASE`, and with a known base
[RN-513](web.md#rn-513) preselected the mode. But the installation by Release has no
container broker (the image is not published, decision 7 of
[ADR 0150](../adr/0150-instalador-de-uma-linha.md)), and `container`/`mounted` only
start a container through the broker ([RN-503](#rn-503)). Result: six
`dev.blocked_by_container` and two `container.start_failed` — nobody works
on the project, forever ([RN-502](engine.md#rn-502)).

**The rule ([ADR 0161](../adr/0161-a-tela-so-oferece-o-modo-que-a-instalacao-executa.md)):**

1. **The api says whether there is a broker, on the route the wizard already reads.**
   `GET workspaces/:workspaceId/projects-base` now returns
   `brokerConfigurado` next to `projectsBase` — the same question ("what mode does
   this INSTALLATION execute?"), the same minimum (`maintainer`), no new route.
   The source is `ContainerBrokerPort.configurado()`, the same as the read of the
   observed state. It says `BROKER_URL` exists, never that the broker answers.
2. **Three states, which do not collapse.** Broker **confirmed**: RN-513 intact.
   **Confirmed** absence: `container` and `mounted` stay on the screen, **inert**
   (the control leaves, the information stays — [RN-102](#rn-102)),
   the reason is stated ONCE in text below the cards, and `runner` is the
   preselected one. **I don't know** (loading, failing query, absent field):
   does not become "it has" — `mounted` is NOT preselected, the revision of RN-513 — and
   also does not become "it doesn't have": no card locks and nothing is asserted in text;
   `container` stays selected, as before.
3. **The human choice does not point to what does not run.** Whoever clicked a mode
   before the answer arrived, and the answer confirms it does not execute here,
   falls to `runner` — the same rule that already knocked `mounted` down when the base
   disappears.

**What this rule does NOT close:** the mode conversion
([RN-559](web.md#rn-559)) still offers `container`/`mounted` in an installation
without a broker; the installer does not ask whether to turn the broker on, because its image
cannot be obtained by a Release installation (measured — see ADR 0161); and in the
development compose, which brings up the broker by default ([RN-512](infra.md#rn-512)) but
leaves `BROKER_URL` empty until someone puts it in `.env`, the warning shows up — and it is
right, because without the variable the api never calls the broker.

- **Code:** `src/interfaces/http/iam/workspaces.controller.ts:404`
  (`getProjectsBase`, `:256` the new field),
  `src/interfaces/http/iam/dto/iam.response.dto.ts:554`,
  `src/interfaces/http/iam/iam-http.module.ts` (the broker module
  imported only for the `configurado()` question);
  `apps/web/src/routes/NewProjectWizard.tsx:257` (`brokerConfirmado`), `:260`
  (`semBrokerConfirmado`), `:270` (`modoExecutavel`), `:283` (the current mode),
  `:716` (the inert card), `:728` (the reason in text);
  `apps/web/src/locales/{pt-BR,en}/newProject.json` (`workspace.noBroker`)
- **Test:** `test/interfaces/http/iam/workspaces-projects-base.controller.spec.ts:59`
  (with `BROKER_URL`, `true`), `:69` (without, `false` even with a base — failure
  case), `:79` (only whitespace counts as absent), `:52` (the minimum stays
  `maintainer`); `apps/web/src/routes/NewProjectWizard.test.tsx:504` (without a
  broker: `runner` preselected, the two cards inert, the reason in text),
  `:523` (unknown broker: does not preselect `mounted` nor lock anything), `:534`
  (a click on `container` before the answer falls to `runner`), `:479`
  (a failing query does not assert absence)
- **Origin:** AT-085 — real installation of v6.1.0 on 2026-09-14, decided by the
  maintainer on 2026-09-18

### RN-574 — `/containers` refuses before the click the start of `container`/`mounted` in an installation without a broker, with its own reason in text {#rn-574}

The same installation of AT-085 allowed approving, through the containers page
([RN-521](#rn-521)), two `container_start` that could only end `failed` with
`BrokerIndisponivelError`. The page already refused locally what it knew would
fail — no image, `runner` without a confirmed folder, role below
`maintainer` — and did not know about this one.

**The rule ([ADR 0161](../adr/0161-a-tela-so-oferece-o-modo-que-a-instalacao-executa.md)):**

1. **The list says whether there is a broker, on every row.**
   `GET workspaces/:workspaceId/containers` gains `brokerConfigurado` per row,
   with the SAME value in all of them, read ONCE per load — it is the installation's
   configuration, and swapping the list for an envelope would break the contract.
2. **A fourth refusal reason, `sem_broker_na_instalacao`,** for `container`
   and `mounted` when `brokerConfigurado !== true` ("I don't know" does not become "it has").
   It comes right after "already up" and BEFORE "no image decided": in an
   installation with nobody to start the container, telling to decide the image would be pointing to
   the wrong door. The text says what (this installation does not start containers for
   these two modes), why (no broker, empty `BROKER_URL`) and what is not
   affected (`runner`).
3. **`runner` never falls into it.** What depends on the broker is decided by the SAME
   branching by destination of `acaoDeSubidaDoModo` (`usaBroker`), not by a
   second rule.

**What this rule does NOT close:** stop and remove did not get the refusal (without a
broker there is no registered `container`/`mounted` container up to stop,
and the case was not measured), and the Infra Lead still does not know about an absent broker
— it refuses by MODE ([RN-566](engine.md#rn-566)), and proposing `container_start` in an
installation without a broker remains possible by the agent.

- **Code:** `src/application/use-cases/containers/obter-visao-geral-de-containers.use-case.ts:71`
  (the field), `:150` (read once per load);
  `src/interfaces/http/containers/dto/containers.response.dto.ts:408`;
  `apps/web/src/routes/containers-subida.ts:33` (the reason), `:94`
  (`usaBroker`), `:122` (the refusal);
  `apps/web/src/locales/{pt-BR,en}/containers.json`
  (`actions.bloqueio.sem_broker_na_instalacao`)
- **Test:** `test/application/use-cases/containers/obter-visao-geral-de-containers.use-case.spec.ts:252`
  (without a broker, `false` on every row — failure case), `:264` (with a broker,
  `true`); `apps/web/src/routes/containers-subida.test.ts:54` (`container` and
  `mounted` refuse before the image), `:75` (`runner` is not affected), `:84`
  (absent field refuses), `:93` (already up keeps saying so);
  `apps/web/src/routes/ContainersPage.test.tsx:562` (inert button and the reason
  in text, never proposes), `:726` (`runner` keeps starting)
- **Origin:** AT-085 — real installation of v6.1.0 on 2026-09-14, decided by the
  maintainer on 2026-09-18

---

## The container broker on the installation, with consent (RN-575) {#o-broker-de-container-na-instalacao-com-consentimento-rn-575}

### RN-581 — The conversation in progress holds the session for up to 8h, and the closed session refuses conversation {#rn-581}

In `exp001` the heartbeat closed the session 30 seconds after the tab stopped, with
the Criativo having just asked — and the event log kept receiving
events for four minutes after `closed_at`. Two defects, one on each
side of the closing: none of the pending-work signals of
[RN-064](web.md#rn-064) saw a conversation waiting for the user
(a Criativo that finished its turn is `idle`, without a handoff, without an action, without
`dev.*`), and nothing — neither the events funnel, nor the conversation use cases, nor
the engine — looked at the session's state before writing.

**The rule, on the heartbeat side:**

1. **A conversation waiting for the user is pending work.** It is the FIFTH signal of
   `pending-work`: the session's most recent end-of-turn event
   (`agent.response`, `chat.structured_question` or `agent.error` on the
   agent's side; `chat.message` or `chat.structured_question_answered` on the
   user's side) is the AGENT's, and the actor is a conversational one. `agent.error` counts as
   end of turn on purpose: by [RN-059](engine.md#rn-059) the
   agent says in the thread what happened, and the next move is the user's. Speech from someone who
   does not converse (Psicólogo, dev agent) does not hold.
2. **It is the only signal with a CEILING: 8 hours**, counted from the END of the agent's turn
   (the `created_at` of that event), not from the last heartbeat. The api returns the
   instant (`aguardandoUsuarioDesde`) and the engine applies the ceiling
   (`SESSION_CONVERSATION_IDLE_TIMEOUT_MS`, default `28800000`). Past it, the
   session closes `closed` with its OWN cause, `conversation_idle_timeout` — not
   `heartbeat_timeout`, because whoever reads `termination_reason` (the Psicólogo, a
   per-session metric) needs to separate the tab that vanished from the conversation nobody
   resumed. The `TerminationClassifier` reads it as `:timeout`: the api knows six
   causes in the hypotheses, and opening a seventh would be changing that contract.
   **The ceiling also holds with the tab OPEN** (AT-152): the `SessionServer` has its own
   clock (`:conversation_idle_check`, every 5 min — no environment
   variable, only the test hook `:session_conversation_idle_check_ms`),
   independent of the heartbeat — the tab's ping neither resets nor postpones it. On each round it reads the pending item and only CLOSES by ceiling (same cause,
   `conversation_idle_timeout`); api down, no pending item or a pending item without an
   instant only reschedule, because what closes due to api down is still
   the heartbeat. Before, the ceiling was only checked when the heartbeat expired, and
   an open tab (ping every ~10s) made it unreachable: an immortal session.
3. **A signal without a ceiling wins.** With an `offered` handoff, a `pending` action, an agent in
   a turn or a dev agent working, the instant comes back `null` and the session stays without a
   ceiling, as it always did. That is why the signal is the LAST in the list.
4. **A present and unreadable instant is an ERROR, never `nil`.** `nil` with
   `pending: true` is a pending item without a ceiling; a broken format would become an immortal
   session. As an error, it falls into the api-down path — it closes by
   heartbeat, saying why.

**The rule, on the closed session side:**

5. **A `closed`/`closed_abnormally` session refuses a CONVERSATION event** with a NAMED
   409: `{ message, reason: "sessao_encerrada", status, type }`. `closing`
   still accepts — the lock is on TERMINAL state.
6. **"Conversation" has two clauses, and both are necessary.** The TYPE only
   exists as conversation (`chat.message`, `chat.structured_question[_answered]`,
   `agent.status`, `agent.activated`, `handoff.offered`/`accepted`,
   `readiness.confirmed`, `necessity.validated`,
   `architecture.readiness_confirmed`), OR the ACTOR is a conversational agent (the
   six plus `dev-lead` and `infra`). An ALLOWLIST by type was measured
   and refused: those who legitimately write to a closed session are the
   CONSUMERS of the closing — the Psicólogo runs a `ToolLoop` against it and writes
   `tool.call`, `agent.response`, `agent.error`; the Anamnese writes its own
   outcomes —, and they speak the SAME generic vocabulary as the Criativo. The type is
   the same; who differs is the actor.
7. **The human decision about an action keeps coming in.** `action.approved`/
   `action.denied` and the execution outcomes are not conversation: the action is an item of
   a DURABLE queue that survives the session, and refusing the decision would leave a
   pending item impossible to resolve. The normal case does not even get here (a
   `pending` action holds the session, signal 2 of RN-064); it only exists when the session
   died through another door.
8. **The refusal leaves no trace.** The state comes from the SAME `UPDATE` that reserves the
   `seq` (with no extra query on the hottest path, under the same row lock
   as the transition), and the refusal throws inside the transaction: the increment comes back, the
   `seq` stays without a hole. The human chat, which writes `chat.message` without the funnel,
   has the same lock. The use cases with an effect BEFORE the event refuse before
   the effect: `CreateHandoff` before creating the row, `AcceptHandoff` before
   marking `accepted` (which would activate the next agent), `ActivateAgent` before
   calling the engine.
9. **The closing STOPS the conversational agents.** `SessionLifecycleWorker`, through which
   every closing goes (heartbeat, idle conversation, human, crash), stops the session's
   conversational agents on ALL nodes (`Engine.Agents.Conversacionais`,
   via `:erpc` — the registry is local and the job lands on any replica). The turn in
   progress is ABANDONED in the `terminate/2` of the six servers
   (`TurnoAssincrono.abandonar/1`): the task dies without writing or broadcasting anything,
   because writing would be asking the api for what it refuses. There is no answer to give:
   since [RN-578](engine.md#rn-578) (ADR 0163) whoever triggered the turn already received `:ok`
   on acceptance. For the same reason the `offer_dev_handoff` the Arquiteto kept
   for the turn's closing does NOT run when the closing is the session's — the handoff
   would be refused (since [RN-672](#rn-672) there is nothing to keep anymore: the
   handoff to the Dev Lead comes from the Infra). The Infra Lead, which runs the turn inside `handle_call`, is
   killed if it does not exit within 5s.
10. **The refusal is never silent in the engine.** Almost every caller of
    `append_event/3` discards the return; the client logs the 409
    `sessao_encerrada` as a warning, and the return stays the same.
11. **The screen recognizes the 409 by the CODE and says the session closed** (AT-154).
    `ehRecusaDeSessaoEncerrada` checks `status === 409` AND
    `body.reason === "sessao_encerrada"` — never the text, and never only the 409, which
    is also "turn in progress". In the four conversation actions (send a
    message, answer a structured question, confirm the readiness of the Criativo and
    of the Arquiteto) the screen shows its own sentence instead of the generic error, redoes
    the session read (it is the new `status` that makes the composer disappear) and does NOT lose
    what was typed: the message goes back to the draft and shows up read-only
    in place of the composer, and the form's answers stay in the fields. The
    sentence does not promise "Reopen" — the action does not exist. And the "Close" button stays
    inert in BOTH terminal states (`sessaoEhTerminal`, the mirror of
    `isTerminal`), not only in `closed` (AT-155).

**What this rule does NOT close:** the ceiling is only checked when the HEARTBEAT expires —
with the tab open and sending heartbeats, the session stays alive without a ceiling, as
always (whoever is looking is not an idle conversation). The stateless human chat's
answer to a turn that STARTED with the session open comes in even if it closes
midway (the actor is the model, and the spend has already been measured). `deploy/k8s/` does not carry
`SESSION_CONVERSATION_IDLE_TIMEOUT_MS`, and since AT-153 that is a DECISION written
in the engine's Deployment, not a pending item: there nothing intercepts the environment, the
absence is the `runtime.exs` default, and writing the number would make a second
copy with no guard against diverging — changing the ceiling there is an `env:` item in the
overlay's engine patch. The THREE composes map it with the code's default (the
installation one only since AT-153, and until then the line in an installation's `.env` was
inert), guarded by `scripts/ci/teto-ocioso-nos-composes.spec.ts`. Since AT-154 the screen handles the
409 with its own sentence (item 11); the screen's other actions that write to a
closed session keep showing the api's message.

- **Code:** `apps/web/src/lib/sessao-encerrada.ts`
  (`ehRecusaDeSessaoEncerrada`, `sessaoEhTerminal`);
  `src/domain/sessions/conversa-em-sessao-encerrada.ts:56`
  (`AGENTES_CONVERSACIONAIS`), `:67` (`TIPOS_DA_CONVERSA`), `:95`
  (`ehEventoDeConversa`), `:117` (`garantirQueSessaoAceitaEvento`);
  `src/application/use-cases/sessions/append-session-event.use-case.ts:44`
  (`conflitoDeSessaoEncerrada`), `:114` (the state in the same `UPDATE` as the `seq`),
  `:241` (`garantirQueAceita`);
  `src/infrastructure/persistence/drizzle/session.repository.ts:117`
  (`incrementSeq`);
  `src/application/use-cases/llm/send-chat-message.use-case.ts:78`
  (the human chat); `src/application/use-cases/agents/create-handoff.use-case.ts:67`,
  `accept-handoff.use-case.ts:90`, `activate-agent.use-case.ts:52`;
  `src/application/use-cases/sessions/get-session-pending-work.use-case.ts:30`
  (`FALA_DO_AGENTE`), `:238` (the fifth signal);
  `src/infrastructure/persistence/drizzle/session-event.repository.ts:124`
  (`findLatestOfTypesInSession`);
  `apps/engine/lib/engine/sessions/session_server.ex:115` (the pending item with
  an instant), `:141` (`handle_info` of its own clock, AT-152), `:168`
  (`conversa_ociosa`), `:193` (`encerrar`), `:222`
  (`conversation_idle_timeout_ms`); `apps/engine/lib/engine/sessions/monitor.ex:185`
  (`classify`); `apps/engine/lib/engine/psychologist/termination_classifier.ex:46`;
  `apps/engine/lib/engine/sessions/engine_api_client.ex:1193`
  (`narrar_recusa_de_sessao_encerrada`), `:1545` (`pendencia_da_resposta`);

  `apps/engine/lib/engine/sessions/engine_api_client.ex:1193`
  (`narrar_recusa_de_sessao_encerrada`), `:1545` (`pendencia_da_resposta`);
  `apps/engine/lib/engine/agents/conversacionais.ex:49` (`parar_da_sessao`),
  `:69` (`parar_da_sessao_no_cluster`);
  `apps/engine/lib/engine/agents/turno_assincrono.ex:471` (`abandonar`);
  `apps/engine/lib/engine/workers/session_lifecycle_worker.ex:88`
  (`parar_conversacionais`); `apps/engine/config/runtime.exs:79`
- **Test:** `test/application/use-cases/sessions/conversa-em-sessao-encerrada.spec.ts:144`
  (a closed session refuses `chat.message` with a named 409 — failure case),
  `:167` (no event and no `seq` consumed), `:183` (Psicólogo and Anamnese
  keep coming in), `:211` (a decision about an action keeps coming in), `:223`
  (an active session accepts — happy path), `:244` (`closing` accepts), `:258`
  (`SendAgentMessage` does not call the engine), `:263` (no orphan handoff),
  `:276` (the acceptance activates nobody), `:309` (the activation does not bring up the
  agent); `test/application/use-cases/sessions/get-session-pending-work.use-case.spec.ts:478`
  (the Criativo answered: pending with the instant), `:519` (the user spoke
  last), `:546` (whoever does not converse does not hold), `:563` (a signal without a ceiling wins);
  `apps/engine/test/engine/sessions/session_lifecycle_test.exs:87` (within the
  ceiling, reschedules), `:106` (above the ceiling, `conversation_idle_timeout`,
  `closed`), `:124` (the default is 8h), `:151` (a pending item without an instant stays without a
  ceiling), `:152` and `:194` (AT-152: with the tab open — pings — the idle conversation
  beyond the ceiling closes, and within the ceiling it does not close); `apps/engine/test/engine/sessions/pendencia_de_conversa_test.exs:28`
  (an invalid instant becomes an error); `apps/engine/test/engine/agents/conversacionais_test.exs:60`
  (stops only the session's ones), `:85` (AT-204: a pid already dead in the Registry does not enter the list of stopped ones), `:126` (`session.closed` stops the live Criativo);
  `apps/engine/test/engine/agents/turno_assincrono_test.exs:161` (abandoning does not
  write nor broadcast, and does not answer again), `:194` (the `terminate/2` abandons);
  `apps/engine/test/engine/psychologist/termination_classifier_test.exs:20`
- **Origin:** AT-072 — `exp001`; the maintainer's decisions on 2026-09-18 (8h
  ceiling and its own cause; a closed session refuses conversation, named)

## The repository is born at the acceptance of the handoff to the Architect, and execution does not start without it (RN-582) {#o-repositorio-nasce-no-aceite-do-handoff-ao-arquiteto-e-a-execucao-nao-comeca-sem-ele-rn-582}

### RN-582 — Accepting the handoff to the Arquiteto provisions the repository; accepting to the Dev Lead is the second, idempotent door; and `execution/activate` without a repository is a named 409 {#rn-582}

It revises the TRIGGER of [RN-522](#rn-522), which fulfilled the promise of
[RN-541](web.md#rn-541). The mechanism does not change — the same `ProvisionRepositoryUseCase`,
called by the same `AcceptHandoffUseCase`, always `local`, with the failure becoming
`repository.provision_failed` and never taking down the acceptance. Structural decision
in [ADR 0165](../adr/0165-o-repositorio-nasce-no-handoff-ao-arquiteto.md).

**What the real installation showed (AT-092, v6.1.0, 2026-09-14).** The Arquiteto
proposed `open_adr_pr` three times before the repository existed; the handoffs to
`infra` and `dev-lead` were offered together, only the `infra` one was accepted, and
`POST /projects/:id/execution/activate` answered **201**. The tables
`project_repositories`, `project_git_connections` and `repo_bootstraps` stayed
empty — the project without a repository forever. Two defects: the trigger came
AFTER those who need the repository (Arquiteto and Infra Lead write to it
before the Dev Lead), and the only trigger was SKIPPABLE (activating execution does not require
accepting to the Dev Lead).

**1. The trigger is accepting the handoff to `arquiteto`.** The Arquiteto is only activated
by an `accepted` handoff addressed to it (`canActivateAgent`), and that handoff
is born from the PO (`offer_handoff(to_agent: "arquiteto")`) or from the user (manual
handoff) — both doors go through the same acceptance. Provisioning runs
BEFORE `activateAgent`: the Arquiteto wakes up in a project that already has somewhere to
write. Consequence: the Infra Lead, activated by a handoff FROM the Arquiteto, never
again wakes up without a repository.

**2. Accepting to `dev-lead` keeps provisioning, as a SECOND DOOR.** It is the
way out for a project that went through the Arquiteto before this rule (the `exp001` of
AT-092: Arquiteto accepted, Dev Lead `offered`) and the natural resumption of a
provisioning that failed at the acceptance to the Arquiteto. With the `created` repository
already up, the second call creates nothing — no repository, no session, no
bootstrap row, no branch, no commit —, and that is proven by BOTH
doors in sequence against the real Postgres and `LocalGitProvider`.

**3. `execution/activate` without a repository is REFUSED with 409**, right after the
`module_map` check and BEFORE any effect (persisted budget,
`permissions.json`, session, engine, event). The sentence is chosen by the state of the
project's handoffs, read by `HandoffRepository.findByProject` (from all
sessions — the handoff to the Arquiteto lives in the PO's): handoff to the Arquiteto
`offered` → accept it; otherwise to the Dev Lead `offered` → accept it; otherwise one of the
two already `accepted` → provisioning left no repository, see the
`repository.provision_failed` and use the provisioning page
(`/projects/:id/provisioning?provider=local`); otherwise → no handoff to the
Arquiteto was accepted. A handoff offered to ANOTHER agent never becomes an
acceptance instruction (accepting the Infra provisions nothing). An ADOPTED repository counts as a
repository. Refusing and not provisioning here is a decision: provisioning inside
activation would hide a git effect, and the agents before it would remain
without a repository.

**4. The screen removes the control and states the reason once, in text** (the rule of
[RN-102](#rn-102) and [ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)). In the Execution section of the Overview, with
`GET .../git/repository` answering a CONFIRMED `null`, "Activate execution" stays
inert in place, the text says where the repository is born, and there is a link to
provision. On the card of the handoff to the Dev Lead, inside the session, the
"Activate execution" shortcut leaves and the card says that accepting that handoff provisions the
repository. Loading or with an error, nothing locks — "I don't know" does not become "it doesn't
have", and the backend refuses anyway. Accepting a handoff invalidates the
repository query, because the acceptance may have created it.

**The technical session does not displace the working one (AT-131).** The session the
provisioning opens (`repo_bootstraps.session_id`, named `git-bootstrap`) is born
in the MIDDLE of the Arquiteto's phase, and choosing "the most recent" only by `createdAt` put
it in place of the working session until the next one was born (ADR 0165 left that
declared). Now the two reads by `createdAt` of the workspace summary
(`latestSessionId` and the cut of the unread ones) order by "is a bootstrap session"
BEFORE `createdAt`, and the Overview (`useLatestSession`) does the same. The technical one
is only the most recent when it is the ONLY one — in the manual provisioning flow it is in it
that the project starts. The api reads the marker through `repo_bootstraps`; the web only has the
session's NAME, and renaming it makes the two diverge (the Overview then treats the
summary as being of another session and does not use it). The criterion does not change what ADR 0165
decided (where the repository is born), which is why there is no new ADR.

> **Revised by [RN-592](#rn-592) (AT-183):** the web stopped reading the NAME — the
> session listing returns the `technical` marker, through the same link in
> `repo_bootstraps`, and renaming the session no longer makes the two diverge.

**The activation refusal does not tell to accept a handoff from a closed session
([RN-581](#rn-581), AT-131).** Accepting a handoff in a terminal session is 409
`sessao_encerrada`, checked BEFORE the handoff becomes `accepted` — so nothing is
half provisioned. The refusal sentence now queries the state of the session of
each `offered` handoff: only the one living in an OPEN session becomes "accept it"; if the
only `offered` one is in a closed session, the sentence says so and points to the
provisioning page. A session not found counts as open ("I don't know" does not become
"closed"). The events provisioning writes do not fall under RN-581: the actor
is `system` and the destination is the freshly created `git-bootstrap` session. What remains
NOT covered: the Overview and the handoff card in the session read the state of the
repository, not that of each session, and did not change.

- **Where:**
  `src/application/use-cases/agents/accept-handoff.use-case.ts:66`
  (`AGENTES_QUE_PROVISIONAM_O_REPOSITORIO`, trigger and second door) and `:141`
  (the branch, before `activateAgent`);
  `src/application/use-cases/execution/activate-execution.use-case.ts:143`
  (the refusal, before any effect);
  `src/domain/execution/repositorio-para-executar.ts:50`
  (`motivoDeExecucaoSemRepositorio`, and the two agent names the acceptance
  also uses); `src/infrastructure/persistence/drizzle/handoff.repository.ts:55`
  (`findByProject`); `apps/web/src/routes/ProjectOverviewTab.tsx:369` and `:511`;
  `apps/web/src/routes/SessionPage.tsx:147`; `apps/web/src/routes/session-timeline-montagem.tsx:495`;
  `apps/web/src/lib/session-acoes-de-handoff.ts:122`;
  `apps/engine/lib/engine/projects/project_repository.ex:74` (the refusal text
  of [RN-577](engine.md#rn-577), which named the old trigger and changes along with it)
- **Test:**
  `test/application/use-cases/agents/accept-handoff.use-case.spec.ts`
  ("aceitar para o Arquiteto provisiona `local` com o slug do projeto", "o
  repositório nasce ANTES de o Arquiteto acordar", "aceitar para o Dev Lead
  continua provisionando `local` (segunda porta)");
  `test/application/use-cases/agents/accept-handoff-provisiona-uma-vez.spec.ts`
  (the two doors against the database: "UM createRepo, UMA linha, nenhuma falha", and
  "o exp001: Arquiteto aceito SEM repositório, e a segunda porta provisiona");
  `test/application/use-cases/execution/activate-execution.use-case.spec.ts:725`
  ("sem repositório: 409, e NENHUM efeito antes da recusa", "a frase nomeia o
  handoff ao Dev Lead pendente — a saída do exp001", "repositório ADOTADO conta
  como repositório"); `test/domain/execution/repositorio-para-executar.spec.ts`;
  `test/infrastructure/persistence/handoff-por-projeto.repository.spec.ts`;
  `apps/web/src/routes/ProjectOverviewTab.test.tsx:409`, `:427` and `:440`;
  `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx:575`;
  `apps/engine/test/engine/agents/arquiteto_server_test.exs:134` and
  `apps/engine/test/engine/infra/infra_lead_server_test.exs:520` (the refusal
  names the new trigger)
- **Origin:** AT-092 — real installation of v6.1.0 on 2026-09-14, decided by the
  maintainer on 2026-09-18

### RN-583 — The hub's routing criterion belongs to the binding, travels with it, and is frozen in the metering {#rn-583}

A model binding may store a **routing criterion** —
`routing_preference`: `price`, `throughput` or `latency` — that tells the HUB
how to choose the upstream that serves the model. Nullable: `null` is the usual
behavior, nothing goes on the wire and the hub decides on its own.

1. **It travels with the binding that won, it never cascades on its own.** The
   cascade is still one of bindings: the winning level brings the model AND its
   criterion. The level the cascade SKIPS (model unavailable, without tool calling)
   takes its criterion with it — only the criterion surviving would produce a
   combination nobody chose.
2. **Writing in three forms.** In the `PUT .../model-binding` of the five scopes,
   an **absent** `routingPreference` preserves the stored one if the new model's
   provider declares the capability, and becomes `null` if it does not; **`null`**
   clears; a **value** for a provider without the capability is **422**
   (`RoutingPreferenceNotSupportedError`). Invariant: no binding stores a criterion
   for a provider that does not declare it.
3. **It freezes what WENT ON THE WIRE.** `token_usage.routing_preference` is
   recorded per call, next to the `upstream_provider` of [RN-042](#rn-042): the
   criterion sent, and `null` when the binding had none or when the provider does not
   declare the capability (what was not sent is not the provenance of anything). The
   same yardstick as the frozen price (ADR 0042).
4. **A PROVIDER capability, only with proof.**
   `LLMProviderCapabilities.routingPreference` is mandatory in the nine, and is
   `true` ONLY on OpenRouter since 2026-09-29 (AT-158): the smoke with a real
   credential (`openrouter-provider.roteamento.smoke.spec.ts`) showed the criterion
   CHANGING the upstream that served — on `meta-llama/llama-3.3-70b-instruct`,
   `price` landed on DeepInfra and `throughput` on Groq (`latency` was Groq in one
   measurement and CoreWeave in the other), while without a criterion the hub
   alternated Novita/DeepInfra. The proof is the DIFFERENCE, not the acceptance: the
   old default's model (`~deepseek/deepseek-v4-flash-latest`) returned the SAME
   upstream for the three criteria and for none, and that does not distinguish "the
   hub respected it" from "there was no choice". The other eight stay `false`, and
   for them the feature remains DORMANT: the route refuses with 422, the screen says
   in text that the provider does not have the option proven, and nothing changes on
   the wire. What the proof does NOT assert: which upstream each criterion chooses —
   that is the hub's decision and changes over time.

- **Where:** `src/domain/llm/routing-preference.ts:56` (writing),
  `src/domain/llm/routing-preference.ts:75` (what goes on the wire),
  `src/domain/llm/binding-resolver.ts:100` (travels with the binding),
  `src/application/use-cases/llm/record-llm-usage.use-case.ts:118`
  (freezes in the metering),
  `src/infrastructure/llm/openrouter-provider.ts:353` (`openrouterConfig`,
  the proven capability)
- **Test:** `test/domain/llm/routing-preference.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`,
  `test/application/use-cases/llm/run-llm-turn.use-case.spec.ts`,
  `test/infrastructure/llm/openrouter-provider.contract.spec.ts`; the manual proof
  of the capability is `test/infrastructure/llm/openrouter-provider.roteamento.smoke.spec.ts`
- **Origin:** [ADR 0166](../adr/0166-preferencia-de-roteamento-no-binding-de-modelo.md) (AT-090)

### RN-590 — The artifacts' `docs/` folder is rebuilt from the event log by the SAME translator as the live projector, without touching the outbox, and never comes out as a silent success {#rn-590}

[ADR 0148](../adr/0148-artefatos-projetados-em-arquivo.md) called the `docs/` folder
rebuildable and declared, in cost 3, that **there was no reprojection
command**: deleting the folder did not rebuild it, because the outbox rows were already
marked. It is the same gap [RN-569](#rn-569) closed for the graph,
in a second consumer. Measured by reading the code: a Postgres restore, the
loss of the `project_workspaces` volume and the `execution_mode` conversion (which does not
touch `docs/`) leave the folder absent or in the old place, and nothing rewrites it.

**The rule:** `src/scripts/reprojetar-artefatos.ts`
(`pnpm --filter api artefatos:reprojetar`; `node scripts/reprojetar-artefatos.js`
in the image) sweeps `session_events` and rewrites the folder. As in RN-569:

1. **A single translator.** The event → agent folder, file name and
   Markdown translation LEFT `ArtifactProjector` for `ArtifactEventTranslator`; the
   projector reaches the event through an outbox row, the reprojection through a cursor, and
   both call it. The projector's surface (constructor, `drainOnce`) did not
   change. The list of what is projected remains
   `ARTIFACT_PROJECTABLE_EVENT_TYPES` — a new type goes in there and is translated in the
   same place, never in a second translator.
2. **Idempotent and never deletes.** The name is a function of the event (versioned:
   `<tipo>.md`; append-only: with the `seq`), so running again rewrites the same
   files; resuming is running again, or `--after-event` from the printed
   cursor. A file the user put in `docs/` stays.
3. **It does not touch the outbox** (`aggregate_type = 'artifact_projection'`): it runs with the
   api up without stealing, reopening or marking rows.
4. **Never a silent success.** Unlike the graph, there is no destination that stops everything
   (a write failure belongs to the ITEM, ADR 0148): each failure is counted and named with the
   event's id, the rest is written, and the process exits with 1. A nonexistent `--project`
   is refused without writing.

**What this rule does NOT close:** (a) the versioned ones (`module_map`,
`module_routing`, `project_image`, `c4_diagram`) show the LAST event in
`id` order; `--after-event` starting between two versions may leave an
older one — only the full round guarantees the current one; (b) it writes to the project's CURRENT
location, and needs to see the same disk as the api; (c) it does not recreate
`qa_verdict`/`secops_verdict`/`task_blocked`/`infra_delegation_files`, which were never
a file; (d) no time measurement on a large event log; (e) it does NOT go into
backup — it is derived, the argument of [ADR 0152](../adr/0152-backup-de-volumes-contra-compose.md).

- **Code:** `src/application/artifact-projection/artifact-event-translator.ts:21`
  (`ArtifactEventTranslator`), `:24` (`projetarEvento`);
  `src/application/artifact-projection/artifact-projector.ts:64`
  (the projector builds the SAME translator), `:131` (delegates);
  `src/scripts/reprojetar-artefatos.ts:96` (`reprojetarArtefatos`),
  `:115` (the translator), `:137` (cursor sweep over `session_events`),
  `:163` (the failure counted without aborting), `:185` (`lerArgumentos`), `:241` (only the
  direct invocation reprojects); `package.json:45` (`artefatos:reprojetar`)
- **Test:** `test/scripts/reprojetar-artefatos.spec.ts:215` (forward
  projector → delete the folder → reproject → same paths and contents; identical second
  round; outbox intact), `:254` (never deletes), `:265` (per project),
  `:275` (nonexistent project — failure case), `:289` (write failure counted
  without aborting the rest — failure case), `:314` (unknown argument);
  `test/application/artifact-projection/artifact-projector.spec.ts`
  (the forward projector, unchanged, over the extracted translator)
- **Origin:** AT-128 — the gap ADR 0148 declared (cost 3)

### RN-591 — The installation without a broker is stated in the mode conversion, in stop/remove and in the Infra Lead's proposal, by the same source as RN-574 {#rn-591}

[RN-573](#rn-573)/[RN-574](#rn-574) (ADR 0161) taught project
**creation** and the **start** in `/containers` to know the installation has no
broker (empty `BROKER_URL`). The closing declared the rest out: the mode
conversion, stop/remove and the Infra Lead. This rule takes the three doors, with the SAME
source — `ContainerBrokerPort.configurado()` — and no new route. It says that
the variable EXISTS, never that the broker answers (that remains
`naoObservado`, [RN-486](#rn-486)).

1. **Mode conversion (`ExecutionModeSection`).** The
   `brokerConfigurado` field already came in `GET .../projects-base`, which the section already reads.
   Converting to `container`/`mounted` with a **CONFIRMED** absence (`false`)
   leaves the button inert and states the reason in text; "querying", a failing
   query and an absent field do NOT assert anything — "I don't know" becomes neither "it has" nor "it doesn't
   have" — and do not block. Converting to `runner`, or to the mode the project
   already has, is never blocked. It is a SCREEN rule, like the creation one: the
   `PUT projects/:projectId/execution-mode` does not apply it.
2. **Stop/remove on `/containers`.** `container_stop`/`container_remove` in
   `container`/`mounted` also go through the broker
   ([RN-495](#rn-495)), so without it they can only end in failure: the screen leaves
   "Stop"/"Remove" inert with its own text (`sem_broker_para_parar`), `!==
   true` as in the start. `runner` never falls here.
3. **The api refuses when proposing.** `ProposeActionUseCase` answers 409
   `sem_broker_na_instalacao`, BEFORE creating the proposal, for
   `container_start`/`container_stop`/`container_remove` in a project that is not
   `runner` when `configurado()` is `false`. It is the decision of HOW the Infra Lead
   knows without HTTP in the loop: the engine does not read `BROKER_URL` (a second source
   would diverge from `configurado()`), and the call the tool ALREADY made returns the
   refusal. `dispatch_container_start/2` now delivers to the model the TEXT of the
   api's message (`container_start recusado: …`), as a tool
   result ([RN-163](engine.md#rn-163)), and not the raw
   tuple. [RN-566](engine.md#rn-566) stays as it was: refusal by MODE, local.

**What it does NOT close:** the blind proposal due to the absence of an IMAGE remains
possible ([RN-566](engine.md#rn-566) already declared it); the api's refusal also holds for
whoever calls without being the agent, which is what is wanted — the approval would only end
`failed`; and the `PUT execution-mode` keeps accepting the conversion by a direct
call.

- **Code:** `src/application/use-cases/actions/propose-action.use-case.ts:90`
  (409 refusal), `apps/web/src/routes/containers-subida.ts:181`
  (`semBrokerParaCicloDeVida`) and `:192` (`conversaoSemBroker`),
  `apps/web/src/routes/settings/ExecutionModeSection.tsx` (inert button),
  `apps/engine/lib/engine/infra/infra_lead_server.ex:886`
  (`motivo_da_recusa_da_api`)
- **Test:** `test/application/use-cases/actions/propose-action.use-case.spec.ts:207`
  (409 in the three actions, and `container_stop` stays `pending` with a broker),
  `apps/web/src/routes/containers-subida.test.ts` (the two functions, three
  states), `apps/web/src/routes/settings/conversao-de-modo.test.tsx`,
  `apps/web/src/routes/ContainersPage.test.tsx`,
  `apps/engine/test/engine/infra/infra_lead_server_test.exs` (the 409's text
  reaches the model)
- **Origin:** AT-105 — declared out of scope by ADR 0161

### RN-592 — The session listing says which one is the technical one, through the link in `repo_bootstraps`, and the screen reads the marker instead of the name {#rn-592}

[RN-582](#rn-582) (AT-131) made the provisioning's technical session — that of
`repo_bootstraps.session_id` — stop displacing the working session as "the
most recent", but with TWO criteria: the api recognized it by the link in
`repo_bootstraps`, and the web by the NAME (`git-bootstrap`). The name is a label the
user renames ([RN-098](web.md#rn-098)), so renaming the session made the Overview
and the workspace summary disagree about which was the working session.

1. **The api returns the marker.** Each item of `GET /projects/:projectId/sessions`
   carries `technical: boolean` (`SessionListItemResponseDto`), `true` only for the
   session of `repo_bootstraps.session_id` of THAT project (one per project,
   `unique(project_id)`). It is the SAME criterion as the workspace summary
   (`sessaoTecnicaDeBootstrap`), never the name: renaming does not change the marker, and
   a working session called `git-bootstrap` does not become technical.
2. **Only the listing carries it.** The marker is not a column of `sessions` nor a field
   of the `Session` entity: the GET of a session and the responses of
   create/rename/transition stay with `SessionResponseDto`, without it. It is the
   listing the screen sorts to find "the most recent".
3. **The screen reads the marker.** `sessaoMaisRecente` (`useLatestSession`) skips the
   session with `technical: true` and only returns it when it is the ONLY one — the rule of
   RN-582 unchanged, with the source swapped. The web's `SessaoListada` type takes the
   field from the OpenAPI GENERATED type.

**What it does NOT close:** the Overview and the handoff card in the session still do not
query the state of each handoff's session (the gap RN-582 declared);
deciding whether they start querying it is a separate decision, outside this rule.

- **Code:** `src/application/use-cases/sessions/list-sessions-for-project.use-case.ts:30`
  (`execute`), `src/interfaces/http/sessions/dto/sessions.response.dto.ts:110`
  (`SessionListItemResponseDto`), `apps/web/src/lib/hooks.ts:147`
  (`sessaoMaisRecente`)
- **Test:** `test/application/use-cases/sessions/list-sessions-for-project.use-case.spec.ts:81`
  (link and not name; another project's technical session does not mark),
  `apps/web/src/lib/sessao-mais-recente.test.ts:28` (renamed stays out) and
  `:36` (a working session called `git-bootstrap` is not technical)
- **Origin:** AT-183 — finding of AT-131

### RN-595 — Every `_PREVIOUS` a service reads reaches it through the three composes, empty by default {#rn-595}

The three zero-downtime rotations (`AUTH_JWT_SECRET`, `BRABO_SERVICE_TOKEN`,
`CREDENTIALS_MASTER_KEY`) depend on the process seeing the old value in a
`_PREVIOUS` variable during the window. Compose does not pass the host
environment through, and none of the three was in the `environment:` of any compose: setting the
`_PREVIOUS` in `.env` had no effect, and whoever followed the runbook performed, without
knowing, the dry swap that rotation exists to avoid. Now the api receives the
three, and the engine and the broker receive `BRABO_SERVICE_TOKEN_PREVIOUS`, in the dev,
production and installation composes, always with an EMPTY default — set means
rotation in progress, and a filled default would leave the installation
forever in the middle of one. Empty is the same as absent in the three readers.

- **Where:** `docker/docker-compose.yml`, `docker/docker-compose.prod.yml` and
  `docker/docker-compose.install.yml` (services `api`, `engine` and `broker`);
  the readers are `src/infrastructure/security/auth-key-material.ts:136`
  (`passphraseAnterior`), `src/infrastructure/security/service-token.ts:92`
  (`tokenDeServicoAnterior`), `src/infrastructure/security/envelope-encryption.service.ts:93`,
  `apps/engine/config/runtime.exs:70` and `apps/broker/src/config.ts:85`
- **Test:** `scripts/ci/previous-nos-composes.spec.ts` — DERIVES from the code of the
  three services the list of `_PREVIOUS` read and fails the one that is missing, or comes
  with a non-empty default, in any of the three composes; the "ExternalSecret
  do k8s" block fails the `ExternalSecret` without `dataFrom.extract`, a `_PREVIOUS` in
  `data:` and the api/engine Deployment without `envFrom: brabo-secrets`
- **Kubernetes (AT-220, maintainer decision):** the Pods read
  `envFrom: brabo-secrets`, and the `ExternalSecret`
  (`deploy/k8s/base/common/externalsecrets.yaml`) pulls the WHOLE `brabo` object
  from the store via `dataFrom.extract` — the `_PREVIOUS` comes in when it exists
  and leaves when it is removed, on the next sync. It cannot be listed in
  `data:`: ESO has no optional key, and an absent property (the normal
  state) fails the sync of the whole Secret. Declared cost: EVERY
  key of the object becomes an api, engine, migrations and backup variable, and a
  MANDATORY key that is absent no longer fails the sync — the
  consumer is what flags it. Sync through a real ESO was exercised by hand on a disposable
  k3d, not in CI
- **Origin:** AT-201 (finding from AT-196), same class as RN-540; Kubernetes half
  in AT-220

### RN-597 — Changing the pepper is a global logout {#rn-597}

The pepper that keys the HMAC of opaque tokens has no `_PREVIOUS`, and changing it
has a consequence, not a procedure: every refresh token in circulation, every open
e-mail verification and password reset link, and every personal
access token (PAT) can no longer be found, because the hash recomputed with the
new pepper does not match the stored one. The refused refresh records
`refresh_unknown` (and not `refresh_reuse_detected`), the link says "Link inválido
ou expirado", and the lockout buckets change key — a locked account unlocks. The
PASSWORD survives (argon2id with per-record salt, no pepper): changing the pepper
costs a login, never an account, and the api starts normally with the new value.

Until [RN-613](#rn-613), a pepper without its own value fell back to
`AUTH_JWT_SECRET`, and rotating the JWT was also rotating the pepper, with all the
consequences above. Since then the pepper is mandatory in production and never
borrowed from the JWT.

- **Where:** `src/infrastructure/security/auth-key-material.ts:212`
  (`pepper`), `:228` (`hashDeToken`), `:247` (`baldeDeEmail`);
  `src/interfaces/http/auth/pat-auth.guard.ts:142`
- **Test:** `test/application/use-cases/auth/rotacao-dos-segredos.spec.ts`,
  against the test Postgres
- **Edge case:** the TARGET of "changing" includes the mistake of whoever separates the pepper from the JWT
  by generating a new value instead of copying the current one — it is the same change, and logs out
  the same way (pinned in the same spec, "a ordem errada").
- **Origin:** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md),
  AT-196

### RN-598 — The PREVIOUS service token goes through the same rule as the current one {#rn-598}

During rotation, `BRABO_SERVICE_TOKEN_PREVIOUS` opens `/internal/*` just as much
as the current one. It goes through ONE rule, the same as the current one (`exigirTokenDeProducao`),
and no copy of it. Surrounding whitespace is discarded, and a value made only of
whitespace counts as absent. In production, the public development literal
(`dev-service-token-change-me`) and a value with fewer than 16 characters after
the trim BRING DOWN the api boot, with a message naming
`BRABO_SERVICE_TOKEN_PREVIOUS`. Before this, the variable was compared raw: a
previous with the example value opened the internal door to anyone who
had read this repository, without any error. Mandatoriness is the
only part of the current one's rule that is NOT copied, because outside rotation the
absent previous is the normal state. A previous equal to the current one (after
the trim) still does not count as rotation.

- **Where:** `src/infrastructure/security/service-token.ts:63`
  (`exigirTokenDeProducao`), `:92` (`tokenDeServicoAnterior`);
  `src/main.ts:50` (`tokenDeServicoAnterior`), which runs at boot next to the current one
- **Test:** `test/infrastructure/security/service-token.spec.ts` (describe
  "tokenDeServicoAnterior (RN-598)")
- **Edge case:** this RN is the api side. The engine and the broker apply the same
  rule since [RN-601](engine.md#rn-601).
- **Origin:** AT-205 (finding from AT-196)

### RN-603 — Auto mode releases the path scope, and only it {#rn-603}

Product owner decision on 2026-09-26 (AT-226,
[ADR 0167](../adr/0167-modo-automatico-libera-o-escopo-de-caminho.md)): with
"Modo automático" on for an agent — the `"*"` wildcard of
[RN-153](#rn-153) resolved as `auto_approve` —, the agent runs ANY
terminal command without asking for approval, INCLUDING outside the project folder.
The path scope ceiling of ADR 0055 stops holding for that agent.
Measured on `exp001` (`mounted` mode, container up): 51 commands asked for
approval with the mode on, 47 only for citing `/work` or `/tmp` — the dev agent
runs in the container and the scope compares against the HOST root.

`decide()` starts receiving the ORIGIN of the autonomy (`ctx.autonomyOrigin`:
`'especifica'` or `'curinga'`), resolved by the SAME repository that already
resolved the precedence — `findMode` became a read of `resolve`, not a
second rule. Only the wildcard in `auto_approve` is auto mode
(`modoAutomaticoDoAgente`); an absent origin counts as specific. In auto
mode, two prompts cease to exist: the SCOPE ceiling and the
`require_approval` that the COMPOUND command synthesizes when a segment has no
rule at all in `permissions.json` (the file with no opinion, which never downgrades
an earlier stage) — without the second, `cd /work && npm test` would keep asking.

Everything remains as it was, in auto mode too: `deny` (from the file, from the
built-in patterns or from specific autonomy) wins; an `ask` WRITTEN in the
file asks; the external-effect/privileged-command ceiling (push, PR,
deploy, `sudo`/`doas`, [RN-418](#rn-418)) runs first and does not
look at the origin; merge into a protected branch, `instruction_patch`,
`parallelize`/`raise_max_parallel` and `container_remove` are never
auto-approvable ([RN-154](#rn-154)). A specific rule for the type beats the wildcard
in the repository and arrives as `'especifica'`: `terminal: require_approval` with the
wildcard on keeps asking. Turning off (the agent card's toggle writes the
wildcard as `require_approval`) restores the ceiling. Since
[RN-670](#rn-670) (ADR 0189) the specific `auto_approve`
under the `auto_approve` wildcard — what a dev agent's "Sempre permitir" writes —
resolves as the WILDCARD, and no longer turns off auto mode; and, outside it, the
scope compares against the REAL execution folder ([RN-669](#rn-669)).

The screen says, before the click, what the mode releases and what keeps asking: the
`ApprovalCard` note appears in BOTH variants (chat and Approvals queue),
and the agent card shows a sentence under the toggle — only when the WILDCARD is
on, because the toggle over the representative type writes a specific rule,
which does not release the scope.

- **Where:** `src/domain/actions/decide.ts:309` (`modoAutomaticoDoAgente`),
  `src/domain/actions/decide.ts:370` (the synthesized verdict of the
  compound ignored), `src/domain/actions/decide.ts:455` (the scope
  ceiling skipped),
  `src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts:25`
  (`resolve`, with the origin),
  `src/application/use-cases/actions/propose-action.use-case.ts:221`
  (`autonomyOrigin`), `apps/web/src/components/AgentTeamGrid.tsx:114`
  (`autonomyHint`), `apps/web/src/components/ApprovalCard.tsx:313` (the note
  in both variants)
- **Test:** `test/domain/actions/decide.spec.ts` ("modo automático
  libera o escopo de caminho (RN-603)": out of scope and compound auto-approve;
  push/`sudo`/`deny`/written `ask` remain; a specific rule and a wildcard
  turned off do not release; the other ceilings do not change),
  `test/application/use-cases/actions/propose-action.use-case.spec.ts`
  (end to end with the real repository),
  `test/infrastructure/persistence/drizzle/agent-autonomy.repository.spec.ts`
  (`resolve` returns the origin), `apps/web/src/components/AgentTeamGrid.test.tsx`,
  `apps/web/src/components/AgentCard.test.tsx`,
  `apps/web/src/components/ApprovalCard.test.tsx`
- **Origin:** product owner decision (AT-226) after the test on `exp001`

### RN-604 — The call to the broker has a ceiling PER OPERATION, and the blown ceiling says it was the ceiling {#rn-604}

The broker's HTTP client applied ONE ceiling, 5 s, to the five operations. The
docblock justified it by the screen READ path ([RN-486](#rn-486)), and
it also held for `exec` — whose request CARRIES its own `timeoutMs` — and
for `start`, which waits for the `docker run` and the image pull it does.
Reproduced in AT-233: a fake broker answering an `exec` in 6 s, with a
`timeoutMs` of 8 s, came back as `BrokerIndisponivelError('sem-resposta')` —
"the container broker did not answer … The operation was aborted due to
timeout". That is, every terminal command over 5 s in a
`container`/`mounted` project with a `running` container ([RN-492](engine.md#rn-492)) failed
saying the broker was down, while the command kept running.

And the engine cut too: the `container-exec` call did not pass
`receive_timeout` and fell back to Req's default, 15 s — the SAME default as
`TERMINAL_ACTION_TIMEOUT_MS`. Reproduced with a fake api (Bandit) that
answers in 16 s: `{:error, %Req.TransportError{reason: :timeout}}`. Raising the
ceiling only in the api would fix nothing.

The rule:

1. **`inspect` stays short (5 s)** — it is the read of `/containers` and of the
   lifecycle route, and a screen that waits for the broker's worst case is worse than
   one that declares "not observed".
2. **`exec` DERIVES from `timeoutMs`** (or from the broker's 15 s default, when
   it comes without one): broker context (10 s) + `ps` (30 s) + the larger of the
   command and the diagnostic `docker version` (30 s) + 5 s of margin. The
   broker cuts the command at `timeoutMs` and ANSWERS `timedOut: true`; the api
   has to be waiting when the answer arrives.
3. **`start`/`stop`/`remove` wait for the broker's OWN worst case**: context
   \+ `ps` + the operation (the `run` with the pull; the `stop` with the 10 s of grace;
   `rm --force`) + the `docker version` it runs when it fails, plus the
   margin. Waiting for that is waiting for the broker's ANSWER, including its
   named refusal. The math was born with 105 s and forgot the SECOND `ps` of the
   `resolver` (the managed one and the namesake): the real worst case was 130 s. Since
   [RN-605](contracts.md#rn-605) it counts the six control calls of `start` and gives
   195 s.
4. **The engine waits longer than the api**: `timeoutMs` + 90 s. The chain is broker <
   api < engine, and the tests on both sides check it (the api mirrors the
   engine's slack as `FOLGA_DO_EXEC_NO_ENGINE_MS`, and the engine's test reads that
   number from the api's source).
5. **A blown ceiling has its own reason**: `BrokerIndisponivelError` gains
   `teto-excedido`, distinct from `sem-resposta` (connection refused, DNS), and the
   message names the operation and the number — and, in the long ones, the consequence: the
   command may keep running in the container; the `run`/pull may have happened,
   so check `/containers` before repeating. In the screen's read
   `teto-excedido` falls into the SAME `naoObservado: 'broker-sem-resposta'` as
   always, with the text in `detalhe` — no new value in the DTO.

The numbers on the other side (`TIMEOUT_DE_CONTROLE_MS`,
`TIMEOUT_DE_EXEC_PADRAO_MS`, the `TIMEOUT_MS` of the broker's context client)
are MIRRORED in named constants, not imported: the api does not consume the
Docker port package. Nothing changes in the broker's containment ([ADR
0130](../adr/0130-broker-de-container.md)), in `DockerPort` nor in
[RN-502](engine.md#rn-502).

**Declared, not closed:**

- **A pull of more than 30 s keeps failing — in the broker.** The pull runs under the
  Docker port's `TIMEOUT_DE_CONTROLE_MS` (30 s), and a big image does not
  come up on the first attempt. Since [RN-605](contracts.md#rn-605) the overflow has a NAME
  (`PullExcedeuTetoError`, origin `infra`) instead of "code -1" with
  `origem: null`; the ceiling itself did not go up, by the maintainer's decision.
- **Node's `fetch` waits for headers for at most 300 s.** An `exec` with
  `timeoutMs` above ~255 s is cut by undici before this rule's ceiling;
  the error comes out `teto-excedido` naming the 300 s. The outer hop
  (`/internal/actions/execute`, api → engine) also has no explicit ceiling and
  falls into the same 300 s, so `TERMINAL_ACTION_TIMEOUT_MS` above ~210 s
  does not arrive whole.
- **A sick broker at `ps`** (the `docker ps` taking the whole 30 s and the
  diagnosis another 30) may exceed the `exec` ceiling with a short command;
  it comes out `teto-excedido`, with the right name.

- **Code:**
  `src/infrastructure/http-clients/container-broker.client.ts:276` (`tetoDaOperacao`),
  `:241` (`TETO_DE_MUTACAO_MS`), `:253` (`FOLGA_DO_EXEC_NO_ENGINE_MS`),
  `:306` (`erroDeTransporte`);
  `src/application/ports/container-broker.port.ts:96` (`MotivoDeBrokerIndisponivel`);
  `apps/engine/lib/engine/sessions/engine_api_client.ex:2062` (`teto_do_container_exec_ms`)

  `apps/engine/lib/engine/sessions/engine_api_client.ex:2062` (`teto_do_container_exec_ms`)
- **Test:** `test/infrastructure/http-clients/container-broker.client.spec.ts:286`
  (the reproduction, against a `node:http` broker that takes 6 s), `:182` (the
  ceiling of each operation in the `AbortSignal`), `:204` and `:229` (`teto-excedido`
  naming operation and number), `:245` (the undici ceiling), `:330` (describe
  `tetoDaOperacao`, including the order broker < api < engine);
  `test/application/use-cases/containers/spec-e-observacao-de-container.use-case.spec.ts:298`
  (the screen keeps saying `broker-sem-resposta`);
  `test/application/use-cases/containers/executar-comando-no-container.use-case.spec.ts:98`;
  `apps/engine/test/engine/sessions/engine_api_client_container_exec_test.exs:72`
  (the reproduction on the engine side, real HTTP with Bandit), `:91` (the slack
  mirrored in the api)
- **Origin:** AT-233

### RN-609 — `proposed_action.created` says WHICH root the scope compared, relative and never absolute {#rn-609}

[RN-567](#rn-567) put in the event the RULE that decided (`reason`) and declared
what stayed out: point 7 of
[ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) asks for *which
scope* authorized, and `escopo: cd dentro da pasta do projeto` does not say which
folder the scope was that day. The root changes — mode conversion, a new
base —, and the event is the only place that keeps what held at the instant of the
decision.

**The rule:** the payload of the SESSION event `proposed_action.created` of a
`terminal` action gains `scopeRoot`, with three fields — `executionMode`,
`ancora` and `segmento`:

| mode | `ancora` | `segmento` |
|---|---|---|
| `container` | `raiz_gerenciada` | the `workspace_dir_name` — the root IS `<PROJECT_WORKSPACES_ROOT>/<segmento>` |
| `mounted` | `base_de_projetos` | the piece under `BRABO_PROJECTS_BASE`, through the SAME `segmentoSobABaseDeProjetos` the broker uses |
| `mounted` (without a base, outside it, or the base itself) | `indisponivel` | `null` |
| `runner` | `nome_da_pasta` | the `workspace_dir_name` — identifies the folder without being relative to anything the server knows |

**Never the absolute path, and that is the decision (AT-147, the maintainer's).** The
event log is read by every project member and an event is not rewritten; in
`mounted`/`runner` the root is a folder on the user's machine, with their `$HOME`
in the path. That is why `indisponivel` exists: falling back to the absolute path
"so as not to lose information" would be exactly the leak. In `runner` the agent's local
base never crosses the network, so there is no relative segment the
server can compute — the `ancora` says the value is a NAME and not a
path.

**Only in `terminal`.** It is the only type in which `decide()` consults the scope
(`terminalNoEscopo`); in the others the field does not exist, instead of existing
saying something the decision did not use. The derivation is that of `projectScopeRoot` —
`raizDoEscopoNoEvento` lives next to it, in the same file, and it is not a second
rule: what it does is EXPRESS the same root without the absolute part.

**Additive, and absent is not "no root".** An event written before this rule, or
of another type, does not have the field; there is no reprocessing nor new column. The
outbox does not carry it, for the same reason as [RN-567](#rn-567) (no
consumer in the engine). Nothing in `decide()` changes, no ceiling, and the screen does not
change — where it shows up is another delivery (AT-148). (Since
[RN-614](web.md#rn-614) the root shows up together with the reason, on the event's line in the log
panel and in the `ApprovalCard`, always relative and with its own text for
`indisponivel`.) The web reads the payload as a
generic record, so old and new events go through the same read.

**Declared:** in `mounted`, the segment is relative to the base configured AT THE
INSTANT of the decision — if the base changes later, the old segment keeps
saying what was true then, which is the point. And the separation between scope and
`permissions.json` ([RN-478](#rn-478)) does not go into the field: it describes the
SCOPE's root, never where the policy file lives.

- **Code:** `src/infrastructure/filesystem/project-workspaces-root.ts:907`
  (`raizDoEscopoNoEvento`), `:901` (`RaizDoEscopoNoEvento`), `:117`
  (`segmentoSobABaseDeProjetos`, reused);
  `src/application/use-cases/actions/propose-action.use-case.ts:302`
  (`scopeRoot` only in `terminal`);
  `src/domain/actions/decide.ts:636` (`terminalNoEscopo`, the only
  consumer of the scope)
- **Test:** `test/application/use-cases/actions/propose-action.use-case.spec.ts:1143`
  (`container`), `:1123` (`mounted`), `:1123` (`runner`), `:1123` (the absolute
  path under `/home/usuario/…` NEVER leaks, in all three cases, including outside
  the base), `:1213` (`indisponivel`), `:1163` (another type and the outbox without the
  field), `:1183` (earlier event, without the field, through the same read);
  `test/infrastructure/filesystem/project-workspaces-root.spec.ts:772`
  (the pure function, in the three modes and in the three cases of `indisponivel`)
- **ADR:** [0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) (point 7)
- **Origin:** AT-147 (EP-025/HS-043)

### RN-611 — The MACHINE key gains listing and revocation per ACCOUNT, without `:projectId`: only the machine ones, only the user's own, and the revocation is the SAME as always {#rn-611}

The gap [RN-552](#rn-552) and [RN-561](web.md#rn-561) declared in writing:
*"in an installation that has no PROJECT yet, listing and revocation — both
via `/projects/:projectId/runner-device-keys` — have no project to
answer against"*. The one-line installation ([RN-547](produto.md#rn-547)) creates EXACTLY that
situation: the account and the machine key are born **before** any project, and the
key stayed alive and unreachable. The maintainer's decision (AT-118): **yes, in the
Account**.

**Two new routes, and only two.** `GET /users/me/machine-device-keys` lists and
`DELETE /users/me/machine-device-keys/:deviceKeyId` revokes (204, idempotent).
No `@RequireRole`, like `users/me/credentials` and `users/me/preferences`: the
scope is the person THEMSELF, and there is no project nor workspace to resolve
a role against. The `userId` comes from the session JWT and goes into the `WHERE`; no
parameter names another person, and the `maintainer` view over someone else's key
stays **out** by the decision of [RN-519](#rn-519) — this route does not reopen it through
another door.

**Only the MACHINE kind.** The listing returns ONLY `project_id IS NULL`
(`especie: "maquina"`), revoked ones INCLUDED (the rule of RN-519: making the
row disappear would make the screen assert the key never existed). The PROJECT ones have a home —
their project's `device-keys` section, where the reach of revoking them is stated — and
bringing them into the Account would make the Account take down a project's pairing without naming
the project. For the same reason, revocation via the account refuses a PROJECT key with
**404**, the SAME response as for a key that does not exist or belongs to another person: the
question goes to the SAME listing as the screen, filtered by `userId`, so there is no way to
ask about someone else's key and learn that it exists.

**What revoking actually takes down, and the target does NOT change.** Revocation via the account is
not a new revocation: `RevokeMachineDeviceKeyUseCase` checks that the key is
among the caller's machine ones and DELEGATES to `RevokeRunnerDeviceKeyUseCase`, byte
for byte. It writes the row and, for the machine key, asks the engine for a
`disconnectRunnerOfUser` per project in `runner` mode the owner reaches
([RN-520](#rn-520)/[RN-543](produto.md#rn-543)). The target remains `{projeto, usuário}` and
**never** `{chave}`: another runner of the same user in those projects drops along,
even with a PAT or another key, and reconnects if its credential is still valid.
In an installation **without a project**, the list of projects is empty and the revocation only
writes the row — and that is enough: the machine agent waiting for the first
project ([RN-550](runner.md#rn-550)) has no connection at all to take down, and the next
ticket it asks for is refused. Changing the target remains its own front,
with an ADR (AT-013).

**"Registering replaces the previous one" STAYS.** [RN-552](#rn-552) had two reasons
to revoke the previous machine key on each registration: (a) the service token
cannot manufacture durable credentials in series, and a reinstalled machine cannot
leave behind a live key nobody remembers to revoke; (b) the
orphan would be UNREACHABLE. This RN knocks down (b) and leaves (a) intact — it does not
depend on a screen. What changes is that the replaced one now SHOWS UP, revoked, in the
Account; and since nobody revoked it through the screen, the section says in TEXT that reinstalling
revokes the previous one, so the row is not read as an incident.

**The screen lives in the Account** (`/account`), the page that already existed for what follows the
person across projects. It lists name, creation date, last use and status, and
inherits the WHOLE vocabulary of [RN-561](web.md#rn-561)/[RN-548](web.md#rn-548):
`lastUsedAt` is RECORDED use, never connection, and null has its own text ("never
used"); "active"/"revoked" talks about the ROW and never about an agent up — and "active"
is **not** green, because the machine kind never gets green and there there are only
those. There is no kind column: with a single kind it would repeat the same
word on every row, and what it carried in the project section — the REACH — is
stated in the caption and in the confirmation ("takes down the local agent in ALL your
projects in runner mode; with no project at all, it only prevents the key from being used
again"), together with RN-520's collateral cost. Loading, failed, empty,
revoked and never used are five states with five texts
([RN-088](web.md#rn-088)/[RN-470](web.md#rn-470)). With no minimum role
on the endpoint, the screen does not invent one: `roleAtLeast` here would lock out whoever can, the
worse defect of the two.

**Revoking through one list invalidates ALL of them.** The machine key shows up in the
Account's list (`['machine-device-keys']`) and in that of EVERY project of the owner
(`['runner-device-keys', projectId]`, read by `RunnerOnboardingPanel` and by the
`device-keys` section). `invalidarChavesDeDispositivo` invalidates the per-project one by
PREFIX (every project in the cache) and the Account's always, and BOTH revocation
screens call it — before, revoking through the project section invalidated only that of the
open project, and the other lists kept announcing the revoked one.

- **Code:** `src/interfaces/http/runner/machine-device-keys.controller.ts:48`
  (`MachineDeviceKeysController`), `:69` (`listMachineDeviceKeys`), `:93`
  (`revokeMachineDeviceKey`);
  `src/application/use-cases/auth/list-machine-device-keys.use-case.ts:33`
  (`ListMachineDeviceKeysUseCase`);
  `src/application/use-cases/auth/revoke-machine-device-key.use-case.ts:33`
  (`RevokeMachineDeviceKeyUseCase`);
  `src/infrastructure/persistence/drizzle/runner-device-key.repository.ts:97`
  (`listarDeMaquinaDoUsuario`);
  `apps/web/src/routes/MachineDeviceKeysSection.tsx:73`
  (`MachineDeviceKeysSection`);
  `apps/web/src/lib/chaves-de-dispositivo-queries.ts:31`
  (`invalidarChavesDeDispositivo`);
  `apps/web/src/lib/api-client.ts:455` (`listMachineDeviceKeys`);
  `apps/web/src/locales/{en,pt-BR}/machineKeys.json`
- **Test:** `test/application/use-cases/auth/machine-device-keys.use-case.spec.ts`
  (the list only by user, the revoked one included; the REAL revocation taking down
  `{projeto, usuário}` in each project; without a project, it only writes; a key outside the
  caller's is 404 without revoking anything);
  `test/interfaces/http/runner/machine-device-keys.controller.spec.ts`
  (without `@RequireRole`, 204, `userId` from the JWT, the 404 propagated);
  `test/infrastructure/persistence/drizzle/runner-device-key.repository.spec.ts`
  (against Postgres: only the user's machine ones, the replaced one revoked in the
  list, another user's out, installation without a project);
  `apps/web/src/routes/MachineDeviceKeysSection.test.tsx` (list, the five
  states, the confirmation with the reach, the invalidation of the Account AND of every
  project — also proven over a project entry in the cache —, the failure with
  the api's sentence, and the two languages);
  `test/interfaces/route-surface.spec.ts` (the two routes classified
  `jwt` in `docs/security-surface.md`)
- **Declared and NOT closed:** (1) the revocation target remains
  `{projeto, usuário}` (RN-520, AT-013); (2) the `maintainer` view stays
  out (RN-519); (3) the route that CREATES a machine key still serves only an
  installation of ONE person (RN-552) — the Account lists and revokes, it does not create.
- **Origin:** AT-118 (EP-003/HS-007)

### RN-613 — `AUTH_TOKEN_PEPPER` is mandatory and its own; whoever migrates sets it with the current `AUTH_JWT_SECRET` {#rn-613}

The HMAC pepper of opaque tokens (refresh, account links, PATs, lockout
bucket) no longer falls back to `AUTH_JWT_SECRET`. The silent fallback
(`AUTH_TOKEN_PEPPER ?? passphraseAtual()`) turned every "zero-downtime"
JWT rotation into a pepper change, and it was the COMMON path: the production
and installation composes did not even pass the variable through. In production the api REFUSES
to start without it, and the refusal states the fix — *"defina com o valor ATUAL de
AUTH_JWT_SECRET para não deslogar ninguém"* —, because the obvious fix (generating
a random one) is the one that logs everyone out. With the pepper equal to the old JWT the
hash is byte for byte the previous one, refresh tokens and PATs remain valid, and
from then on the JWT rotates on its own. A pepper equal to the JWT is NOT refused: it is the
legitimate state of every migrated installation. The JWT rules (RN-114) apply:
blank, the two example literals from the repository and fewer than 16 characters
bring down the boot. Outside production a development default of its OWN applies
(`dev-auth-token-pepper-change-me`), never the JWT's.

The `install.sh` does the migration: a NEW installation generates a random pepper;
if there is a previous `.env` in the folder, it is READ (never executed) before being
overwritten, and its pepper is kept — or, without a pepper, it is born with its
`AUTH_JWT_SECRET`. The terminal says where the value came from, never the value.

- **Where:** `src/infrastructure/security/auth-key-material.ts:168`
  (`pepperAtual`), `:212` (`pepper`); `src/main.ts:46` (the boot
  check); `install.sh:702` (`valor_no_env_anterior`), `:734` (`gerar_segredos`),
  `:831` (`dizer_a_origem_do_pepper`); the variable in the three composes
  (`docker/docker-compose.yml`, `docker-compose.prod.yml`,
  `docker-compose.install.yml`), in `docker/smoke.sh` and in `.env.example`
- **Test:** `test/infrastructure/security/auth-key-material.spec.ts`
  (describe "pepperAtual (RN-613)": refusal without pepper even with JWT, the
  message, the examples, the floor, equal to the JWT accepted, the dev default);
  `test/application/use-cases/auth/rotacao-dos-segredos.spec.ts` (describe "a
  migração do RN-613": the refresh stored with the OLD formula remains valid with the
  pepper equal to the old JWT and survives the JWT change; the
  `AUTH_JWT_SECRET` describe: without pepper outside production, changing the JWT does not log out);
  `scripts/dev/install-env.spec.ts` (describe "o AUTH_TOKEN_PEPPER do
  instalador (RN-613)", against `docker compose config`, whole value)
- **Edge case:** the installer only sees the `.env` of the folder it runs in. An installation
  whose `.env` lives elsewhere, a custom compose and Kubernetes with
  `ExternalSecret` do the migration by hand, through the runbook — in Kubernetes the
  `AUTH_TOKEN_PEPPER` property already existed in the `ExternalSecret` and in
  `bootstrap.sh`, and a provider that lacks it already failed the sync.
  And the installer migration wipes the volumes (ADR 0150): the refresh only
  survives for whoever restores the Postgres dump, which is the case that matters.
- **Origin:** AT-210 (finding from AT-196), maintainer decision: migration with the
  current value

### RN-615 — WORKSPACE member removal is born with ceiling 2 inherited: removing oneself is 403, and it is that clause that holds the last owner, without counting {#rn-615}

The fifth door of the ceilings line ([RN-472](#rn-472), [RN-556](#rn-556),
[RN-557](produto.md#rn-557)), and the route
[ADR 0157](../adr/0157-teto-de-auto-movimento-no-upsert-de-workspace.md) refused to
open in passing. Until now `WorkspacesController` had no member `@Delete`, and
offboarding was a write to the database. The maintainer's decision
(AT-115/HS-006): **the route is born, protected by a CLAUSE.**

**The route.** `DELETE /workspaces/:workspaceId/members/:userId`, `owner` (the SAME
minimum as the upsert), 204, idempotent.

**The ceiling is inherited, with no new rule.** `remocaoEhAutoRebaixamento` receives the
actor's WORKSPACE role as today's effective one and `null` as the AFTER role — in the
workspace there is no level above to catch the fall, so removing one's own
row is always a fall to "no access", the branch the function already stated
for a project without a workspace row. Removing ONESELF is **always 403**, with
its own sentence: *"Você não pode remover a si mesmo deste workspace: aqui não há
papel acima para segurar a queda, e sem a linha você perde o workspace e todos
os projetos dele. Voltar exige o owner que você estaria abandonando. Peça a
outro owner."*

**The last owner, by the SAME clause.** Only `owner` calls the route; nobody removes
themselves; so every successful removal leaves at least the CALLER as
`owner`. Removing the last one would require them to remove themselves — the refused movement. The
count stays refused (ADR 0157, point 2). The route's `owner` minimum is HALF
of the proof, and that is why it is asserted in a test.

| movement | outcome |
|---|---|
| removing ONESELF from the workspace, whether or not there is another owner | **403** |
| removing ANOTHER `owner` | passes — it is how ownership is revoked entirely |
| removing the HOLDER (`created_by`), by another owner | **409** `criador_do_workspace` — [RN-616](#rn-616) |
| removing any other person | passes |
| removing someone with no workspace row | 204 — their project rows in the workspace go out the same |

**The cascade, in one transaction.** The `workspace_members` row; the
`project_members` rows of the removed person in THIS workspace's projects (without them the
`projectRole ?? workspaceRole` overlay of [RN-471](web.md#rn-471) would keep them
inside every project in which they had their own row); and their credentials
tied to those projects — PROJECT device keys and PATs —, revoked
with the reason `workspace_member_removed`. After the commit, their runner's live
connection drops in EACH project of the workspace through the path of
[RN-520](#rn-520), in a `try/catch` that only logs: an engine down does not take down the
removal.

**Declared and NOT done:** the MACHINE key (it belongs to the account and serves other
workspaces; here it stops reaching because the role resolves to none); the
already connected SESSION socket and the removed person's `:web` terminal (they stay until they drop;
the new ticket is refused); a screen (there is no workspace members section in the
`apps/web`). The HOLDER (`workspaces.created_by`) does not leave through this route — that is
[RN-616](#rn-616).

- **Code:** `src/interfaces/http/iam/workspaces.controller.ts:262`
  (`removeMember`);
  `src/application/use-cases/iam/remove-workspace-member.use-case.ts:79`
  (`RemoveWorkspaceMemberUseCase`);
  `src/domain/iam/tetos-de-rebaixamento.ts:88`
  (`MENSAGEM_TETO_AUTO_REMOCAO_DO_WORKSPACE`), `:248`
  (`remocaoEhAutoRebaixamento`);
  `src/infrastructure/persistence/drizzle/workspace.repository.ts:84`
  (`removeMember`);
  `src/infrastructure/persistence/drizzle/project.repository.ts:167`
  (`removeMemberFromWorkspaceProjects`);
  `src/infrastructure/persistence/drizzle/runner-device-key.repository.ts:169`
  (`revogarChavesDeProjetoNoWorkspace`);
  `src/infrastructure/persistence/drizzle/personal-access-token.repository.ts:187`
  (`revogarDoUsuarioNoWorkspace`)
- **Test:**
  `test/application/use-cases/iam/remove-workspace-member.use-case.spec.ts`
  (against Postgres: removes another member with the whole cascade and nothing outside the
  workspace; removes another owner; an engine down does not take it down; idempotent;
  refuses oneself without writing anything; its own sentence; the sole owner does not leave; with
  two owners, whoever removes stays);
  `test/interfaces/http/iam/workspaces-members.controller.spec.ts`
  (`owner` on both member routes, 204, the actor/target order, the 403 propagated);
  `test/interfaces/route-surface.spec.ts` (the route classified in
  `docs/security-surface.md`)
- **ADR:** [0173](../adr/0173-remocao-de-membro-de-workspace.md)
- **Origin:** AT-115 (EP-002/HS-006)

---

### RN-616 — The workspace HOLDER does not leave through member removal: 409 `criador_do_workspace` until transferring, and holdership only goes to another `owner` {#rn-616}

The maintainer's decision on the question [RN-615](#rn-615) left open
(AT-115, [ADR 0173](../adr/0173-remocao-de-membro-de-workspace.md), point 7).
`workspaces.created_by` authorizes nothing — what authorizes is the role
([RN-472](#rn-472)) —, but it is through it that the LLM credential the
agents spend and the git one of agent actions are resolved
([RN-058](#rn-058)), as well as the owner of the spend report
([RN-060](#rn-060)). Removing the creator would leave the
agents spending the credential of someone no longer in the workspace. The column comes to
be called, in the rule, the **holder**.

**The refusal.** `DELETE /workspaces/:workspaceId/members/:userId` with target = holder
is **409** with `code: "criador_do_workspace"`: *"Não é possível remover o titular
do workspace: a credencial de LLM que os agentes gastam, a de git das ações de
agente e o relatório de gasto são dele (RN-058/RN-060). Transfira antes a
titularidade para outro owner (PUT /workspaces/:workspaceId/owner-of-record) e
remova depois."* RN-615's ceiling comes first: the holder trying to remove themselves
gets the self-removal 403.

**The transfer.** `PUT /workspaces/:workspaceId/owner-of-record`, `owner`,
body `{ userId }`, answers the workspace (200). The destination must ALREADY be `owner`
of the workspace, otherwise **409** `titular_precisa_ser_owner` (*"A titularidade só vai
para quem já é owner deste workspace: o titular paga o que os agentes gastam
(RN-058). Promova a pessoa a owner antes, ou escolha outro owner."*). It writes
`created_by` in a transaction with the role read; transferring to the current
holder is idempotent. Any `owner` can transfer, including to ANOTHER
owner who did not ask — declared, it is the same authority that removes owners.

**The spend, from the commit on.** `ResolveCredentialOwnerUseCase` returns the new
holder: the agent turn looks for THEIR credential for the model's provider,
and git actions for their git credential. Without a credential, the outcome is the one that
already existed — the turn ends with *"Nenhuma credencial cadastrada para
<provider>"* and the git remote read fails naming whose credential is
missing. The transfer does NOT check this beforehand (declared in the ADR). The recorded
spend does not move: `token_usage` does not keep the holder, and the whole report,
history included, comes to belong to the new holder. No domain event: there remains
a log line with from/to/who.

- **Code:** `src/domain/iam/titularidade-do-workspace.ts:22`
  (`CODIGO_CRIADOR_DO_WORKSPACE`), `:38` (`removeOTitular`);
  `src/application/use-cases/iam/remove-workspace-member.use-case.ts:120`
  (`removeOTitular`);
  `src/application/use-cases/iam/transfer-workspace-ownership.use-case.ts:39`
  (`TransferWorkspaceOwnershipUseCase`);
  `src/infrastructure/persistence/drizzle/workspace.repository.ts:98`
  (`transferirTitularidade`);
  `src/interfaces/http/iam/workspaces.controller.ts:324`
  (`transferOwnership`)
- **Test:**
  `test/application/use-cases/iam/remove-workspace-member.use-case.spec.ts`
  (`describe` "o TITULAR não sai": the 409 with code and nothing written; the holder
  removing themselves gets the 403; after transferring, removing the old
  creator passes and the new holder becomes the protected one — and `describe`
  "TransferWorkspaceOwnershipUseCase": to an owner it writes `created_by`; to a
  `maintainer` and to a non-member it is 409 `titular_precisa_ser_owner`; to the
  current holder it is idempotent);
  `test/interfaces/http/iam/workspaces-members.controller.spec.ts`
  (`owner` and the transfer's delegation)
- **ADR:** [0173](../adr/0173-remocao-de-membro-de-workspace.md), point 7
- **Origin:** AT-115 (EP-002/HS-006)

---

## The language of the agents' replies (RN-618..620, RN-622..624, ADR 0177) {#o-idioma-das-respostas-dos-agentes-rn-618-620-rn-622-624-adr-0177}

Epic EP-028 was born from a conversation in Portuguese answered in Spanish. The
maintainer's decisions of 2026-09-28 (AT-168, AT-169) fixed where the language
of the REPLIES lives — account, session and project — and the precedence among
the sources. None of these rules touches the language of the INTERFACE
([RN-432](web.md#rn-432)).

### RN-618 — The answers' language belongs to the PERSON: a choice in the account, an override per session, and the precedence that always ends in a language {#rn-618}

1. **Open list, canonical form.** The answers' language is any BCP-47
   code whose language subtag the api's ICU recognizes, written canonically
   (`pt-br` becomes `pt-BR`) — never the interface's `pt-BR`/`en` enum, which
   stays closed. `und`, private use and free text are refused with a 400
   that names the rule.
2. **A new account is born on AUTOMATIC.** `users.response_language` is `NULL`
   ("automatic") until the person chooses; the api shows and accepts `automatico`
   as the name of that state.
3. **Interface and answers are independent.** `PATCH /users/me/preferences`
   accepts `locale` and `responseLanguage` as OPTIONAL; sending one does not touch the
   other, a body with neither is 400, and an invalid `responseLanguage` refuses the
   WHOLE body before writing any field.
4. **The detected one only holds when confirmed.** The language detected from the
   person's messages (detection is [RN-624](#rn-624)) only goes into `users.detected_language` together
   with `detected_language_confirmed_at` — a CHECK refuses one without the other.
   Detection alone changes nothing.
5. **A session override belongs only to whoever set it.**
   `PUT projects/:projectId/sessions/:sessionId/response-language`
   (`developer`, the role for sending a message to an agent — the override only changes
   the answers to the person's own messages) sets a language in that session
   for WHOEVER CALLS; `language: null` (mandatory key) releases it and goes back to
   inheriting from the account. The `GET` (`viewer`) returns the caller's effective one. The
   key is the session×user pair: another participant of the same session is never
   affected, and there is no route to read or touch another person's.
6. **The precedence**, resolved per person and never per session: session
   override > account choice > confirmed detected > `users.locale`. Since
   `users.locale` is `NOT NULL`, the chain always ends in a language, and the origin
   (`sessao`/`conta`/`detectado`/`interface`) travels with it. A one-off request
   inside a message ("translate to English") is not a step: what
   serves it is the model.

**Who consumes:** since [RN-622](engine.md#rn-622) the effective one reaches the model — the
api calls `ResolverIdiomaDaRespostaUseCase` with the AUTHOR of each message to an
agent and the session, and the engine puts the guidance at the end of each LLM call
of that turn. The Account stopped saying the value "does not reach yet".

- **Code:** `src/domain/iam/idioma-de-resposta.ts:56`
  (`normalizarIdiomaBcp47`), `:118` (`resolverIdiomaDaResposta`);
  `src/db/schema/iam.ts:104` (`responseLanguage`), `:111`
  (`detectedLanguage`), `:128` (`users_idioma_detectado_so_confirmado`);
  `src/db/schema/sessions.ts:124` (`sessionLanguageOverrides`);
  `src/application/use-cases/iam/resolver-idioma-da-resposta.use-case.ts:44`
  (`ResolverIdiomaDaRespostaUseCase`);
  `src/application/use-cases/iam/update-user-preferences.use-case.ts:25`
  (`idiomaDaRespostaOuRecusa`), `:47` (`UpdateUserPreferencesUseCase`);
  `src/application/use-cases/iam/idioma-da-resposta-na-sessao.use-case.ts:19`
  (`IdiomaDaRespostaNaSessaoUseCase`);
  `apps/web/src/routes/ResponseLanguageSection.tsx`
- **Test:** `test/domain/iam/idioma-de-resposta.spec.ts:12` (the
  rule, and what it refuses — failure case), `:40` (the precedence);
  `test/application/use-cases/iam/idioma-da-resposta.use-case.spec.ts:96`
  (new account on automatic), `:124` (writes canonical, does not touch the interface),
  `:158` (invalid writes nothing — failure case), `:188` (the override does not
  reach the other participant), `:209` (404 for a session of another project);
  `test/infrastructure/persistence/session-language-override.repository.spec.ts:73`
  (the CHECK in the database), `:93` (upsert by the pair);
  `apps/web/src/routes/ResponseLanguageSection.test.tsx:76` (effective with
  origin, without the old "does not reach yet" warning), `:115` (a typed
  code only saves on the button)
- **Origin:** AT-162, on the decisions of AT-168 (answers 1, 2, 3, 4 and 6)
  and AT-169 (answer 2); specification of AT-079

### RN-619 — The project has a language, that of everything without a human author, and it is born from the language of whoever creates it {#rn-619}

1. **What it governs** (the maintainer's decisions: AT-168 answer 8, AT-169
   answer 1): the language of SHARED artifacts (product brief, business
   rules, ADRs) and of turns WITHOUT a human author (opening by `kickoff`,
   dev agents, gates, commit message, PR body). What an agent
   answers to a PERSON remains their answers' language
   ([RN-618](#rn-618)).
2. **Always a concrete language.** `projects.language` is `NOT NULL`, a canonical
   BCP-47 code by the SAME rule as RN-618 — but without "automatic", which is
   resolving from a person's messages and does not fit what has no person.
   `automatico` and an unrecognized code are 400, and the project is not born (or
   does not change).
3. **New project**: the `language` requested at creation, canonicalized; without a
   request, the EFFECTIVE answers language of WHOEVER CREATES
   (`ResolverIdiomaDaRespostaUseCase`, without a session: account choice >
   confirmed detected > interface language). The note's proposal was the
   creator's `users.locale`; the whole chain was chosen because whoever
   has already said in which language they want to work should not see the project be born
   in another — and, without a choice or detection, it IS the `users.locale`.
4. **Projects that already existed**: migration `0062_idioma_do_projeto` writes the
   language of the workspace HOLDER (`workspaces.created_by`, whose credential the
   agents spend — RN-058/RN-616), through the same chain. At the
   migration nobody had a choice or detection yet, so the value is their
   `users.locale`. The holder, and not "an owner" from `workspace_members`,
   because they are ONE and the migration cannot choose between two.
5. **Who changes it**: `PATCH /projects/:projectId` with `language` (`maintainer`,
   the route's minimum), and the "Project language" section in Settings, with the
   control inert and the reason in text for whoever does not reach it (RN-102). The
   column's `pt-BR` default is only the net for whoever inserts outside the use
   case (seed, script, fixture).

**Who consumes, and what remains:** since [RN-622](engine.md#rn-622) the engine reads the
column (`Engine.Projects.Project`, directly from Postgres) and sends it to the model in
every LLM call of a turn WITHOUT a human author, and since [RN-623](engine.md#rn-623)
also as the language of the shared artifact an agent writes DURING a
turn with a human author — the divergence this rule declared closed.

- **Code:** `src/db/schema/iam.ts:262` (`language`);
  `src/db/migrations/0062_idioma_do_projeto.sql` (the backfill);
  `src/application/use-cases/iam/idioma-do-projeto.ts:13`
  (`idiomaDoProjetoOuRecusa`);
  `src/application/use-cases/iam/create-project.use-case.ts:72`
  (`language`); `src/application/use-cases/iam/update-project.use-case.ts:18`
  (`idiomaDoProjetoOuRecusa`);
  `src/interfaces/http/iam/dto/iam.response.dto.ts:233`
  (`language`); `apps/web/src/routes/settings/ProjectLanguageSection.tsx`
- **Test:** `test/application/use-cases/iam/idioma-do-projeto.use-case.spec.ts:63`
  (born with the creator's language), `:74` (the account choice beats the
  interface), `:100` (invalid and `automatico` — failure case, the project is not
  born), `:132` (an invalid PATCH changes nothing), `:152` (the migration writes the
  holder's); `apps/web/src/routes/settings/idioma-do-projeto.test.tsx:84`
  (current and the declaration of what does not follow it yet), `:125` (below
  `maintainer`: the value stays, the control stays inert)
- **Origin:** AT-243, on the decisions of AT-168 (answer 8) and AT-169
  (answer 1)

### RN-624 — The api detects the author's language from their own messages and ASKS; only the confirmed one becomes a preference {#rn-624}

[RN-618](#rn-618) left the "confirmed detected" step ready and empty.
Maintainer decision (AT-168 answers 4, 6 and 7): **detect, ASK whether the
language is right, and the confirmed one becomes the default** — per person, global, with the
question on the screen where the language is already shown and corrected.

1. **The yardstick is ONE, and lives in the api.** The heuristic of AT-080, measured by
   AT-160 (contrastive markers of `pt`/`es`/`en`, the stripping of code, log,
   quotation, URL and identifier), moved from `scripts/idioma/` to
   `src/domain/iam/heuristica-de-idioma.ts`, and the instrument
   REEXPORTS it from there — what the product runs is what the instrument measures. The rule
   of WHAT counts as evidence (only actor `user`; in the form, only the answers, and the
   echo with the agent's labels skipped) is also a single one, `evidenciasDoAutor`,
   used by the real-corpus extraction and by the detection. Local, no LLM, no
   new dependency.
2. **The sample comes from the event log, the hysteresis is recomputed.** Detection reads the person's 11
   most recent pieces of evidence across ALL sessions (the window of 10 plus
   the one the hysteresis recomputes) and decides when the TWO last evaluations of the
   sample point to the same language (`idiomaConcordante`). No detection state
   is stored: the evaluation of the previous message is recomputed with the window
   that ended at it. The read is served by a PARTIAL index
   (`session_events_evidencia_de_idioma_idx`, actor `user` and the two evidence
   types): measured with 200 thousand events, 0.056 ms through the index against 13.5 ms
   for the scan without it.
3. **The thresholds are PROVISIONAL.** `PARAMETROS_PROVISORIOS` are the
   candidates of AT-080 with ONE difference, the minimum evidence of 10 words and
   not 20 — in the SYNTHETIC corpus, at 10 the coverage of decidable cases goes from 42.2%
   to 58.9% with the same three errors (all in a language outside the three). List
   `at080`; threshold 0.8, margin 0.3, sample 10 messages / 2,000 characters,
   hysteresis 2. The synthetic corpus was written by the same hand that wrote the
   heuristic: none of these numbers is calibrated, and the owner recalibrates them with
   the real corpus (`pnpm --filter @brabo/scripts idioma:medir --real`), changing
   the object, which is the only place the api reads them from.
4. **When it asks.** `GET .../sessions/:sessionId/response-language`
   returns `detectionQuestion` with the language to ask about, or `null`. It does not
   ask when: the detection does not agree (short text, "ok", code, log,
   mixed); the effective one comes from an EXPLICIT choice — session override or Account —,
   because confirming would record a step BELOW them and the reply would not change;
   the detected one is already the effective one, compared by SUBTAG (`pt` does not diverge from
   `pt-BR` — the heuristic only knows the language); or the person already declined that
   language.
5. **Detection never changes anything on its own.** Only
   `POST /users/me/preferences/detected-language` writes: `confirm` writes the
   pair `detected_language` + `detected_language_confirmed_at` (the CHECK of
   RN-618) and deletes the old decline of the same language — and it is 409
   `deteccao_mudou`, without writing, when the messages no longer point to the language
   (the column says "detected" and cannot hold what the heuristic did not
   detect); `decline` writes the decline to `detected_language_declines` (one
   row per person and language, with the date), and THAT language is not asked about
   again. What is stored is the language and the person's decision — never country,
   nationality or proficiency.
6. **Where the question appears.** In a small card anchored just below the
   language indicator of the session bar ([RN-620](web.md#rn-620)): "Detectamos que
   você escreve em espanhol (es) — usar espanhol (es) nas respostas?", with
   "Usar", "Não" and "Agora não". No modal, without covering the composer; "Agora não"
   only hides it on this screen, without writing, and the question comes back on the next read.
   Sending a message (or answering a form) rereads the indicator, because the
   new message is the evidence that can make the question appear.
7. **Failure never blocks anything.** Detection runs on the language READ, and not
   inside `SendAgentMessageUseCase`: the evidence is already in the event log, the
   question survives a page reload and appears in any session, and
   sending the message does not go through it — it gains no latency and has no way to
   fail because of it. On the read, any failure (database, heuristic) becomes a
   `warning` and `detectionQuestion: null`; the language keeps being shown.
8. **Cost:** CPU measured on the synthetic corpus, on this machine — 11.6 µs to
   clean and classify a message, 110 µs per detection (11 messages, two
   evaluations), plus the indexed read of item 2. Zero tokens.

**What this rule does NOT close, declared:** the heuristic knows three languages,
and the language list is open — Galician and French can become `es`/`pt` (the
synthetic errors), and under this rule the cost is a wrong question, which the
person declines. A message in Spanish in a Portuguese window leaves the
sample undetermined while it is in it (no question, no change). And the
heuristic file cannot have `import`: the instrument runs it by type
stripping, and `scripts/idioma/` has its own tsconfig without `verbatimModuleSyntax`
to accept the `export`s of a CommonJS module.

- **Code:** `src/domain/iam/heuristica-de-idioma.ts:175`
  (`PARAMETROS_PROVISORIOS`), `:457` (`evidenciasDoAutor`), `:500`
  (`mensagensNecessarias`), `:520` (`idiomaConcordante`);
  `src/domain/iam/deteccao-de-idioma.ts:43` (`idiomaAPerguntar`);
  `src/application/use-cases/iam/detectar-idioma-do-autor.use-case.ts:57`
  (`DetectarIdiomaDoAutorUseCase`), `:66` (`detectar`), `:88` (`pergunta`),
  `:123` (`responder`);
  `src/infrastructure/persistence/drizzle/deteccao-de-idioma.repository.ts:27`
  (`ultimasEvidencias`), `:75` (`confirmar`);
  `src/db/schema/iam.ts:144` (`detectedLanguageDeclines`);
  `src/db/schema/sessions.ts:168`
  (`session_events_evidencia_de_idioma_idx`);
  `src/interfaces/http/iam/session-response-language.controller.ts:66`
  (`comPergunta`); `src/interfaces/http/iam/user-preferences.controller.ts:94`
  (`answerDetected`); `apps/web/src/routes/SessionLanguageIndicator.tsx`;
  `scripts/idioma/heuristica.ts` (the reexport)
- **Test:** `test/domain/iam/deteccao-de-idioma.spec.ts:29` (the
  provisional ones), `:42` (two evaluations agree), `:48` (one alone is not enough),
  `:52` (undetermined does not point — failure case), `:77` (the form echo
  skipped), `:105`..`:158` (when it asks);
  `test/application/use-cases/iam/detectar-idioma-do-autor.use-case.spec.ts:109`
  (asks without writing), `:116` (confirm), `:131` (declining does not ask
  again), `:142` (undetermined does not ask — failure case), `:148` (explicit
  Account), `:159` (error in detection becomes "no question" — failure case),
  `:169` (409 `deteccao_mudou`);
  `test/infrastructure/persistence/deteccao-de-idioma.repository.spec.ts:87`
  (only the author, all sessions), `:166` (the partial index), `:200` (the pair and the
  deleted decline); `apps/web/src/routes/SessionLanguageIndicator.test.tsx:117`
  ("Usar"), `:148` ("Não"), `:162` ("Agora não" does not write), `:172` (409 becomes
  toast)
- **Origin:** AT-163, on the decisions of AT-168 (answers 4, 6 and 7), the
  specification of AT-080 and the measurement of AT-160

## Deciding in the chat, where the owner is (RN-626) {#decidir-no-chat-onde-o-dono-esta-rn-626}

### RN-628 — The executed merge closes the PR's task: `done`, exactly once {#rn-628}

The QA/SecOps gate ends in `awaiting_user` and nothing else touched the task's
`status`: in real use on 29/09 `pr-6` was merged three times and the tasks stayed
in `in_review` (AT-275).

1. **After the merge, never in place of it.** `git_merge` is still an
   unconditional `require_approval` ([RN-418](#rn-418)); the rule runs INSIDE
   `ExecuteGitActionUseCase`, in the transaction that records the merge result,
   and only when the provider returned `state: 'merged'` (an open PR, or a merge
   that failed, does not touch the task).
2. **The task is found by the PR that opened it.** Every `pr_open` of the
   project whose `pullRequestId` is that of the merged PR and which carries
   `storyTaskId` in the payload. A PR without a task (infra, ADR) changes
   nothing.
3. **Idempotent.** `TaskRepository.markDoneIfNotDone` is an `UPDATE … WHERE
   status <> 'done'`: repeating the merge of the same PR returns `null`, does not
   move again and does NOT write the event. When it moves, it writes ONE
   immutable event `backlog.task_status_changed` (`cause: 'pr_merged'`,
   `pullRequestId`, `actionId`), append-only, no UPDATE on an event table. No
   migration.
4. **Declared boundary (AT-249).** This rule does NOT refuse the merge of an
   already-merged PR nor does it consult `gate_status`. The refusal of the
   already-merged PR (and of the repeated proposal) came later, in
   [RN-663](#rn-663), before the merge gets here; the pending gate, by the
   owner's decision, is only a warning on screen.

- **Where:** `src/application/use-cases/actions/execute-git-action.use-case.ts:295`
  (`settleMerge`), `src/infrastructure/persistence/drizzle/backlog.repository.ts:480`
  (`markDoneIfNotDone`)
- **Test:** `test/application/use-cases/actions/execute-git-action.use-case.spec.ts`
  ("git_merge marca a tarefa como done": happy path, repeated, open PR/failed
  merge, PR without a task)
- **Origin:** AT-275

### RN-630 — Who is active in the session is read from the WHOLE session, not from the last 200 events {#rn-630}

"Who is active" and "who receives the composer" came from the `agent.activated` seen
in the 200-event window (`latest: true`). In a long session the activations of the
Arquiteto and the Infra left the window; handoff offers addressed to them
went back to looking acceptable and the "hi" went to the last agent that still
appeared. It is the defect class of RN-180 (a silent ceiling makes the
screen assert about what it did not read), already closed for the presence of QA/SecOps in
[RN-568](web.md#rn-568).

**The rule:** the project summary ([RN-090](#rn-090)) returns
`roster.activatedAgents` — the agents with at least one `agent.activated` in the
most recent session, one per agent, the most recently activated (by `seq`)
first. Four decisions:

1. **The source is still the event log.** No derived column, no
   index and no migration: the field enters the SAME per-session scan that
   already computes `executionActivated`/`gatesEverOpened` (`array_agg ... filter`),
   so the number of database round trips of the summary does not change (the constant-count
   spec still holds). The reserved migration 0066 was not used.
2. **No new HTTP per poll.** The field travels in the summary the screens already read
   ([RN-579](engine.md#rn-579)).
3. **The client ADDS it to the window and only trusts it with the summary of the SAME session**
   (`latestSessionId === sessionId`), as in RN-568: activation is monotonic
   (an activated agent does not deactivate), so the window only gives false negatives. A summary
   of another session does not count; with no summary, the window decides alone.
4. **The api says what happened, not who receives.** The explicit, visible
   recipient in the chat (AT-251) and acceptance by `handoffId` (AT-253) consume this
   field in the web and are NOT part of this rule.

**Declared gap:** this round only delivers the api CONTRACT. `apps/web`
(`session-readiness.ts`, `session-handoffs.ts`) keeps reading the window until
AT-251/AT-253 start consuming `roster.activatedAgents`.

> **Closed in [RN-631](web.md#rn-631) (AT-251):** the composer recipient and the
> handoff offers of the Session screen ADD `roster.activatedAgents` to the window,
> with the same-session guard. `criativoActive`/`arquitetoActive`
> (`session-readiness.ts`) still read only the window.

- **Where it lives:** `src/infrastructure/persistence/drizzle/projects-summary.repository.ts:212`
  (`activatedAgents`); `src/application/ports/projects-summary-repository.port.ts:32`
  (`activatedAgents`)
- **Tests:** `test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  ("activatedAgents cobre ativações anteriores à janela de 200 eventos" and
  "activatedAgents é da sessão MAIS RECENTE: ativação de sessão antiga não vale")
- **Origin:** AT-252

### RN-635 — One pending handoff offer per target in the project; the one that stops being valid becomes `superseded` {#rn-635}

`handoffs` only recorded `offered`/`accepted`, with no expiry, supersession or
dedupe: a double click on "architecture ready" gave 2× Infra and 2× Dev Lead, and
an offer to an already active agent stayed actionable forever (AT-291,
[ADR 0182](../adr/0182-ciclo-de-vida-do-handoff.md)).

1. **At most ONE `offered` per (project, target).** `decidirOferta` decides:
   with no pending one, it creates; pending in the SAME session and with no new artifact (the new one is
   `null` or equal), it returns the existing one (`desfecho: ja_oferecido`, no row
   nor event); any other case creates the new one and replaces the pending one
   (`substituiu_oferta`) — returning the old one would lose the new artifact, or
   leave the requester with nothing to accept in the session they are in.
2. **Whoever replaces records.** The row becomes `superseded` and a
   `handoff.superseded` event is born (`handoffId`, `toAgent`, `motivo`, `substitutaId`) in the
   session of the OLD offer, actor `system`, even with the session closed. The
   original `handoff.offered` is not touched.
3. **Serialized per target.** `CreateHandoffUseCase` runs in a transaction with
   `pg_advisory_xact_lock` of the (project, target) pair: two tabs arriving together
   produce ONE row. Duplicates from before converge on the next offer or
   activation, with an event; the migration rewrites no row.
4. **An already active agent receives no offer:** 409 `reason: agente_ja_ativo`, without
   row or event. Active = `agent.activated` in a NON-terminal session of the
   project. The `message` is the text the model reads: `offer_handoff` passes it on
   verbatim, and `FalhaDeTurno.origem/1` classifies it as `politica`.
5. **Activating supersedes.** `ActivateAgentUseCase` (acceptance and direct activation) and
   `ActivateExecutionUseCase` (per `dev-<modulo>`) supersede, after
   activating, every pending offer to the agent in any session of the project; the
   accepted one is not touched, and a refused activation supersedes nothing.
6. **"Architecture ready" is idempotent.** `OfferInfraHandoffUseCase` does not
   trigger the target (`infra`, `dev-lead`) that already has a pending offer or is
   active; with both like that, it neither records nor calls the engine
   (`desfecho: ja_oferecido`, `jaAtendidos` with each one's reason).

- **Where:** `src/domain/sessions/ciclo-de-vida-do-handoff.ts:71`
  (`decidirOferta`), `:104` (`mensagemDeAgenteJaAtivo`);
  `src/application/use-cases/agents/ciclo-de-vida-do-handoff.service.ts:43`
  (`sessaoOndeEstaAtivo`), `:71` (`substituir`), `:97`
  (`substituirOfertasAoAtivar`);
  `src/application/use-cases/agents/create-handoff.use-case.ts:109`
  (`travarOfertasDoDestino`);
  `src/infrastructure/persistence/drizzle/handoff.repository.ts:94`
  (`travarOfertasDoDestino`);
  `src/application/use-cases/agents/activate-agent.use-case.ts:88`
  (`substituirOfertasAoAtivar`);
  `src/application/use-cases/execution/activate-execution.use-case.ts:327`
  (`substituirOfertasAoAtivar`);
  `src/application/use-cases/agents/offer-infra-handoff.use-case.ts:96`
  (`jaAtendido`);
  `apps/engine/lib/engine/harness/tools/offer_handoff.ex:132`
  (`agente_ja_ativo`); `apps/engine/lib/engine/agents/falha_de_turno.ex:67`
  (`agente_ja_ativo`); `src/db/migrations/0064_ciclo_de_vida_do_handoff.sql`
- **Test:** `test/application/use-cases/agents/ciclo-de-vida-do-handoff.spec.ts`
  (against Postgres: repeated in the same session, concurrent double click,
  new artifact, another closed session, data from before the ADR, active agent and
  active in a closed session, activation that supersedes and refused activation);
  `test/application/use-cases/agents/offer-infra-handoff.use-case.spec.ts`
  ("ADR 0182: segundo clique…", "ADR 0182: só aciona o destino que falta…");
  `test/application/use-cases/agents/activate-agent.use-case.spec.ts`;
  `test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  ("ciclo de vida do handoff");
  `apps/engine/test/engine/harness/tools/offer_handoff_test.exs`;
  `apps/engine/test/engine/agents/falha_de_turno_test.exs`;
  `apps/web/src/lib/session-handoffs.test.ts` (the screen: `superseded` does not become an
  actionable card in the thread, in the out-of-window strip nor in the Infra card)
- **Origin:** AT-291

### RN-637 — The screen reads the TAIL of the session's actions, and the old pending one comes back with it {#rn-637}

`GET /projects/:projectId/sessions/:sessionId/actions` ordered by ascending `seq`
with a ceiling of 200, and `usePendingActions` never paginated: from the
201st action of a session on — which a real execution easily reaches, a dev agent
proposes dozens of commands per task — the NEW pending one was outside the only
page read and vanished from the thread, the Executores and Aprovações (AT-296), precisely
when someone was waiting for it.

**The rule:**

1. **The route accepts `latest=true` and `status=pending`.** `latest` brings the `limit`
   actions with the highest `seq`, returned in ASCENDING order and without `nextCursor`,
   ignoring `afterSeq` — the same contract as the events' `latest` (ADR 0021).
   `status` only accepts `pending` (another value is 400, without querying); combined
   with `latest`, it brings the newest pending ones without the decided ones taking up the
   window. Without the two parameters the contract is the previous one.
2. **The screen asks two questions, and the second only when needed.**
   `buscarAcoesDaSessao` reads the tail (200); only if it comes back FULL does it also request the
   pending ones and merge by `id`, in ascending `seq`. An old pending one that the
   tail pushed out is still a decision to be made and does not vanish for having
   waited too long. The short session — the common case — still costs ONE
   request, and a failing read of pending ones brings the query down (the screen says
   it failed, never pretends an empty queue — RN-088).

**What this rule does NOT close:** with more than 200 PENDING ones in a session, the oldest
beyond them stay out (the ceiling is the same `limit`); and what the thread shows
as DECIDED is still the tail — an old decided action, outside the 200 newest,
does not appear in the thread. Pending items of the WHOLE project are another read
([RN-638](web.md#rn-638)).

- **Code:** `src/infrastructure/persistence/drizzle/proposed-action.repository.ts:96`
  (`listPaginated`), `:113` (the `latest` branch);
  `src/interfaces/http/actions/actions.controller.ts:105` (`list`),
  `:114` (the `status` refusal);
  `src/application/ports/proposed-action-repository.port.ts`
  (`ListProposedActionsOptions`);
  `apps/web/src/lib/acoes-da-sessao.ts:48` (`buscarAcoesDaSessao`), `:30`
  (`juntarCaudaEPendentes`); `apps/web/src/lib/hooks.ts:432`
  (`usePendingActions`)
- **Test:** `test/infrastructure/persistence/proposed-action-latest.repository.spec.ts`
  (without `latest` the new pending one stays out — the defect; with `latest` it
  is in the tail; `status=pending` returns the old one; and it does not bring another session);
  `test/interfaces/http/actions/actions-list.controller.spec.ts`
  (passing on the parameters and the 400 — failure case);
  `apps/web/src/lib/acoes-da-sessao.test.ts` (short session in one request;
  a full tail with 250 actions returns pending 3 and 250; a failing read of pending ones
  brings the query down)
- **Origin:** AT-296 (HS-076)

### RN-642 — "Always allow" approves and writes the pattern in the SAME transaction; a click on an already-approved action is a named success {#rn-642}

In real use on 29/09, 45 of 173 clicks on "Always allow" returned 409
(AT-310): the pattern was written BEFORE approving, and an action that had
already left `pending` (double click, the same pending item in two panels,
another tab) threw 409 with the pattern ALREADY written and WITHOUT the
`permission.granted` event.

1. **Same transaction, after the transition.** `ApproveActionUseCase` accepts an
   `aoAprovar` that runs INSIDE the decision's transaction, after
   `assertTransition` passes and before execution; it is through it that the
   pattern (`permissions.json/allow` or `agent_autonomy`, [RN-509](#rn-509)) and
   the `permission.granted` are written. "Approve first, write after" in
   separate transactions was refused: it would trade the defect for an action
   that is approved (and even executed) with the pattern failing afterwards.
   `agent_autonomy` and the event are atomic with the decision; `permissions.json`
   is a file and does not enter a transaction — it is only written after the
   transition is valid, and failing to write it undoes the approval. What
   remains, declared, is the window of the COMMIT failing after the file was
   written.
2. **The event follows the write, and only the write.** A pattern that already
   exists is not rewritten nor narrated again (`padraoGravado: false`).
3. **An already-approved action is a named success.** If the transition is
   refused because the action is already `approved`/`auto_approved`/`executed`/
   `failed`, the response is 201 with `desfecho: 'ja_aprovada'` (the normal path
   returns `'aprovada'`), without executing again, writing the pattern only if it
   is missing — with the event. An invalid transition coming from EXECUTION,
   after the decision was confirmed, does NOT become `ja_aprovada`: it
   propagates as always.
4. **A REFUSED action is still 409, named** (`reason: 'acao_ja_recusada'`),
   without writing a pattern or an event: freeing forever what someone just
   refused is not idempotency.
5. **Ceilings intact.** `git push`/PR/deploy, `sudo`/`doas`
   (`motivoDeRecusaSempreAprovar`, [RN-418](#rn-418)) and `container_remove`
   are still refused with 400 BEFORE any state read — even with the action
   already approved. The pattern is still the action's EXACT one (generalization
   by verb is AT-257, outside this).
6. **The ceiling's TYPES too (AT-320).** Measured in the audit of 30/09: the api
   only refused the `git push` TYPED in the terminal; the TYPED `git_push` went
   through and wrote `GitPush()` into `allow` (or the module's autonomy), and the
   `ApprovalCard` offered the button. `TIPOS_SEM_SEMPRE_PERMITIR` is the SINGLE
   list — `git_push`, `pr_open`, `git_merge` (whole: the `GitMerge()` pattern
   would hold for every destination), `container_remove`, `instruction_patch`,
   `parallelize`, `raise_max_parallel` — and `motivoDeRecusaDoSempreAprovar`
   judges terminal by the command and the rest by the type. The refusal is 400
   with `reason: 'teto_do_sempre_permitir'` and `actionType`. The web hides the
   button through the copy in `apps/web/src/lib/sempre-permitir.ts`, checked
   against the api's by a test; a terminal command keeps the button (repeating
   the parser on the screen would be a second yardstick) and receives the api's
   refusal. When it was born, it did NOT change `decide()` nor the seeding; since
   [RN-689](#rn-689) both change — `git_push`/`pr_open` are in the ceiling of
   `decide()` and activation seeds only `git_commit` —, and the pattern the
   click would write for them would be inert.

- **Where:** `src/application/use-cases/actions/approve-always-action.use-case.ts:109`
  (`execute`), `:190` (`cliqueSobreAcaoJaDecidida`), `:240`
  (`gravarPadraoSeFaltar`), `src/application/use-cases/actions/approve-action.use-case.ts:279`
  (`approve`), `src/domain/actions/sempre-permitir.ts:30`
  (`TIPOS_SEM_SEMPRE_PERMITIR`), `:65` (`motivoDeRecusaDoSempreAprovar`),
  `apps/web/src/lib/sempre-permitir.ts:15` (`TIPOS_SEM_SEMPRE_PERMITIR`)
- **Test:** `test/application/use-cases/actions/approve-always-action.use-case.spec.ts`
  ("ordem e idempotência (RN-642)": double click, concurrent clicks, action
  approved by another path, refused → named 409 without a pattern, a pattern
  that fails undoes the approval, ceilings with the action already approved;
  "tipos do teto (AT-320)"), `test/domain/actions/sempre-permitir.spec.ts`,
  `apps/web/src/lib/sempre-permitir.test.ts` (the web's copy equal to the api's),
  `apps/web/src/components/ApprovalCard.test.tsx` (typed git without the button)
- **Origin:** AT-310, AT-320

## A closed session can be reopened (RN-649/RN-650) {#a-sessao-encerrada-pode-ser-reaberta-rn-649-rn-650}

### RN-649 — A `closed`/`closed_abnormally` session reopens to `active` with the log intact, and the previous closing becomes a new event {#rn-649}

[RN-001](#rn-001) said the terminal states have no way out. Since
[ADR 0183](../adr/0183-reabrir-sessao-encerrada.md) there is ONE, and only one: the
reopening, from `closed` or `closed_abnormally` to `active`, through its own
path. The GENERIC transition keeps refusing `closed → active` with 409, and
`closing → active` remains forbidden through any path.

1. **What comes back is the whole session.** The event log is not touched — the conversation,
   the business rules, the answered questions, the handoff offers and
   acceptances. A conversational agent stopped at closing comes back through the
   idempotent `start_agent` on the first message and rebuilds the history
   ([RN-580](engine.md#rn-580)). The conversation comes in again because the refusal of
   [RN-581](#rn-581) reads the session's state, which is now `active`.
2. **The previous closing is not erased.** The `sessions` row loses
   `closed_at` and `termination_reason`; the NEW event `session.reopened`, in the
   same `seq` ([RN-002](#rn-002)) and with the human actor who reopened, carries
   `{from, to, closedAt, terminationReason}`. No event is edited nor
   renumbered, and the `kind` does not change ([RN-097](#rn-097)).
3. **A session with execution does not reopen** — 409 `sessao_com_execucao`. Reopening a
   session with `execution.activated` would return it to `findActiveExecutionSession`
   ([RN-139](#rn-139)). The owner's decision,
   confirmed in [ADR 0184](../adr/0184-reabrir-sessao-decisoes-do-dono.md).
4. **No deadline.** Every closed session is reopenable (the owner's decision, ADR 0184).
5. **The engine is called before the transaction**, as in activation: its failure
   leaves the session closed, with no event. Any non-terminal state is 409
   `sessao_nao_encerrada`.
6. **The closing the reopening undid does not stop the live session.** The
   `SessionLifecycleWorker` reads the session's `status` and ignores, with a log, the
   `session.closed`/`session.closed_abnormally` job of a session the api already says is
   non-terminal.
7. **The Psicólogo's second automatic analysis stays blocked** by the
   `alreadyAnalyzed` that already existed; manual reprocessing continues. The second
   graph consolidation extends the window of the same `Interacao`.

- **Where:** `src/domain/sessions/session-state-machine.ts:66`
  (`canReopen`), `:70` (`assertReopen`);
  `src/domain/sessions/reabertura-de-sessao.ts:24`
  (`SessaoComExecucaoNaoReabreError`), `:44`
  (`garantirQueSessaoSemExecucaoReabre`), `:58` (`payloadDaReabertura`);
  `src/application/use-cases/sessions/reopen-session.use-case.ts:53`
  (`execute`), `:96` (`garantirQuePodeReabrir`);
  `apps/engine/lib/engine/workers/session_lifecycle_worker.ex:59`
  (`encerrar_se_ainda_encerrada`);
  `apps/engine/lib/engine/sessions/project_session.ex:48` (`status`)
- **Test:** `test/domain/sessions/session-state-machine.spec.ts:56`
  (only terminals reopen; `closing` never goes back);
  `test/application/use-cases/sessions/reopen-session.use-case.spec.ts:121`
  (`closed` reopens, log preserved, `session.reopened` with the previous
  closing — happy path), `:151` (`closed_abnormally`), `:163` (the conversation
  comes in again), `:186` (`closing` is 409 without engine or event — failure
  case), `:208` (a session with execution is 409 `sessao_com_execucao`), `:239`
  (engine down: nothing changes);
  `apps/engine/test/engine/workers/session_lifecycle_worker_test.exs:66`
  (closing of an already `active` session does not stop the process), `:82` (closing of a
  `closed` session stops it, as always)
- **Origin:** AT-071 (HS-048), about `exp001`

### RN-650 — Reopening is `developer`, through its own route, and the screen only offers the button to whoever reaches the role {#rn-650}

`POST projects/:projectId/sessions/:sessionId/reopen` requires `developer` — the
SAME role as the generic transition that closes the session: whoever can declare it
finished can bring it back. It answers 200 with the session. `viewer` is 403.
[ADR 0183](../adr/0183-reabrir-sessao-encerrada.md) had set `maintainer`
as a provisional default; the owner decided `developer` on 2026-09-30
([ADR 0184](../adr/0184-reabrir-sessao-decisoes-do-dono.md)), confirming along with it
the other two decisions — no deadline, and a session with `execution.activated`
refused.

On the Session screen, the closed session's strip shows "Reopen session" with a
sentence about what comes back. Below `developer` (`roleAtLeast`, WORKSPACE role —
the gap of [RN-471](web.md#rn-471) already declared on the screen) the button stays inert and the
reason is stated in TEXT. The api's refusal (409 for a session with execution, 403) becomes a
toast with its sentence. The thread narrates `session.reopened` as "session reopened",
with the cause of the previous closing when it was recorded.

- **Where:** `src/interfaces/http/sessions/sessions.controller.ts:214`
  (`reopen`); `apps/web/src/lib/api-client.ts:634` (`reopenSession`);
  `apps/web/src/routes/SessionPage.tsx:158` (`podeReabrir`);
  `apps/web/src/lib/session-acoes-da-sessao.ts:77` (`handleReopen`); `apps/web/src/routes/SessionComposer.tsx:383` (the button);
  `apps/web/src/lib/activity.ts:633` (the thread's sentence)
- **Test:** `test/interfaces/http/sessions/sessions-reopen.controller.spec.ts:22`
  (`developer`, the same as the generic transition), `:36` (viewer does not reach the
  route's role; developer, maintainer and owner do), `:49` (200);
  `apps/web/src/routes/SessionPage.reabrir-sessao.test.tsx:143` (developer
  reopens through its own route — happy path), `:167` (maintainer and owner
  too), `:178` (viewer/no role: inert with the reason in text — failure
  case), `:191` (the api's refusal becomes a toast), `:213` (an active session does not offer);
  `apps/web/src/lib/activity.test.ts` ("reabertura de sessão")
- **Origin:** AT-071; role decided in AT-337

## Acompanhar ao vivo sem martelar (RN-639)

### RN-654 — The resolved bindings of all agents and areas come in a single read {#rn-654}

[RN-645](web.md#rn-645) measured 49 requests on loading the Configurações tab, and 20
of them were the RESOLVED binding of each agent (17) and of each area (3), one route
per key. Three sections read those keys — models per agent, models per area
and best models per capability —, and the 300 req/min ceiling is the USER's
([RN-579](engine.md#rn-579)).

**The rule:**

1. **`GET projects/:projectId/model-bindings/resolved?agents=…&areas=…`**
   returns `{ agents: [{ key, binding }], areas: [{ key, binding }] }`, in the
   requested order and without repetition. Each `binding` is EXACTLY what the
   individual route would respond for that key (`GET .../agent-bindings/:slug`,
   `GET .../area-bindings/:key`): the same cascade `workspace › projeto › área ›
   agente` without a session, the same origins the screen turns into a chain
   ([RN-470](web.md#rn-470)), the Criativo inheritance, and `null` when no level has a
   model. There is no new cascade: the use case calls `ResolveModelBindingUseCase`
   key by key, with the input the individual route would pass.
2. **The minimum role is that of the individual read routes, `viewer`.** Whoever does not
   reach the project gets the SAME 403.
3. **The read is contained**
   ([ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md)): the keys come in a
   comma-separated list, with the slug alphabet (lowercase, digits, `-`, `_`), and are at
   most 64 combined (`TETO_DE_CHAVES_NO_LOTE`). A malformed key or a batch above
   the ceiling is 400 naming the reason, never a key silently discarded — the response
   would assert about fewer keys than the screen requested.
4. **The web reads the batch through ONE `queryKey`** (`['model-bindings-resolved',
   projectId]`), served by one request to the three Configurações sections and,
   since AT-339, also to the Visão geral and the Executores tab
   (`useBindingsDosAgentes`): the roster agents the catalog knows come from
   that SAME key — the cache one tab warmed serves the other without a
   request —, and those the catalog does not know (the `dev-<modulo>`) come from ONE
   extra batch read, under the same prefix and in slices of the same ceiling. Every
   write of an agent or area binding rereads the whole batch by that
   PREFIX, which reaches both reads; no per-agent key is left to
   invalidate. The failure of these reads leaves the agent card without a model —
   "I don't know", never an asserted model — and does not fall back to the per-agent route.
5. **The batch failure does not become "no model".** With a single read, the failure is of
   all keys at once: the section states the reason ONCE, with the api's sentence
   and the action to reread, and each row says "não lido" in place of the chain. While
   the batch does not respond, the row says "lendo…". "Sem modelo em nenhum nível" stays
   reserved for the `null` the api asserted.

**Numbers:** the tab load dropped from 49 to 30 requests
(`configuracoes.orcamento.test.tsx`, on `dev` at 94e5dc721d); the idle minute
stays at 64, all from the frame. In AT-339, the Executores tab load dropped
from 29 to 27 and the Visão geral's from 33 to 31 (`duas-abas.orcamento.test.tsx`,
with the base roster of three agents — with team and modules, the drop is one per
card), and going from Configurações to the Visão geral stopped fetching any
binding (before, 3).

**What this rule does NOT close:** the per-key routes still exist in the api
(no screen reads them anymore). A `dev-<modulo>` whose key exceeds 64 characters
would be refused by the batch format, and the read of the extras would fail entirely —
not measured on a real project, and declared.

- **Code:** `src/application/use-cases/llm/resolve-model-bindings-em-lote.use-case.ts:12`
  (`TETO_DE_CHAVES_NO_LOTE`), `:37` (`lerListaDeChaves`), `:77`
  (`ResolveModelBindingsEmLoteUseCase`);
  `src/interfaces/http/llm/model-bindings.controller.ts:233`
  (`getResolvedBindings`); `apps/web/src/lib/api-client.ts:1217`
  (`getResolvedModelBindings`); `apps/web/src/lib/bindings-resolvidos.ts:43`
  (`invalidarBindingsResolvidos`), `:69` (`useBindingsResolvidos`), `:111`
  (`useBindingsDosAgentes`); `apps/web/src/routes/ProjectOverviewTab.tsx:144`
  and `apps/web/src/routes/ProjectExecutorsTab.tsx:155` (who calls it);
  `apps/web/src/components/AgentTeamGrid.tsx:46` (`bindingDoAgente`);
  `apps/web/src/routes/settings/LeituraDosBindings.tsx:19`
  (`AvisoDeBindingsNaoLidos`), `:40` (`MarcaDeBindingNaoLido`)
- **Test:** `test/interfaces/http/llm/model-bindings-em-lote.integration.spec.ts:182`
  (happy path against Postgres: viewer reads the batch, and each key equals the
  individual route), `:256` (refusal by role, the same 403 as the individual
  route), `:275` (malformed key), `:287` (batch above the ceiling);
  `apps/web/src/routes/settings/bindings-em-lote.test.tsx:150` (the two sections
  render from ONE call, without a per-key route), `:182` (the batch failure is
  stated and no row becomes "sem modelo"), `:217` (reading, not "sem modelo");
  `apps/web/src/routes/configuracoes.orcamento.test.tsx:233` (the load reads the
  batch once and fits in 30), `:279` (going to the Visão geral does not fetch a
  binding); `apps/web/src/routes/ProjectOverviewTab.test.tsx:472` (the card's
  model comes from ONE batch read, without a per-agent route), `:493` (the refused
  batch does not invent a model nor fall back to the per-agent route);
  `apps/web/src/routes/ProjectExecutorsTab.test.tsx:524` (the `dev-<modulo>`
  outside the catalog comes from the extras read), `:547` (refused extras
  leave the card without a model); `apps/web/src/routes/duas-abas.orcamento.test.tsx:334`
  (the load of the two tabs reads the batch once and fits in 27 and 31)
- **Origin:** AT-334 (owner decision on the gap declared in
  [RN-645](web.md#rn-645)); AT-339 (the Visão geral and the Executores tab in the batch)

## Reading the workspace members (RN-655) {#a-leitura-dos-membros-do-workspace-rn-655}

### RN-655 — `GET workspaces/:id/members` is `viewer`, and returns only id, name, e-mail and role {#rn-655}

The session thread ([RN-652](web.md#rn-652)) only named whoever had a row in
`project_members`; whoever joins the project only through the WORKSPACE role became
"Outro membro", because there was no route that read the workspace members
(owner decision, AT-335). The route is born next to the three member WRITE
routes (`POST`/`DELETE` of member and `PUT owner-of-record`, all `owner`), and its
minimum is NOT theirs: the minimum is the ENDPOINT's ([RN-102](#rn-102)), and reading the list
is not maintaining it. It is `viewer`, that of the neighbouring reads (`GET workspaces/:id`,
`.../projects`) and that of `GET projects/:id/members`, which it completes — whoever
opens a session needs to know who spoke in it, and a workspace `viewer` already
sees every project of the workspace.

The response has the SAME shape as the project read — `userId`, `name`,
`email`, `role` (the WORKSPACE role) — and nothing else: no `createdAt`, no
account state. A nonexistent workspace is 404, and a non-member is refused
by the `RolesGuard` (403). There is still no workspace members SCREEN: the
read exists to name, and the write routes remain API-only.

- **Code:** `src/interfaces/http/iam/workspaces.controller.ts:216`
  (`listMembers`);
  `src/application/use-cases/iam/list-workspace-members.use-case.ts:16`
  (`execute`);
  `src/infrastructure/persistence/drizzle/workspace.repository.ts:127`
  (`listMembers`)
- **Test:**
  `test/application/use-cases/iam/list-workspace-members.use-case.spec.ts:75`
  (the response shape, against Postgres — happy path), `:96` (workspace
  nonexistent is 404), `:104` (the minimum is `viewer`), `:112` (`viewer` passes the
  guard), `:125` (a non-member gets 403)
- **Origin:** AT-335

## The policy reason on each Approvals card (RN-656) {#o-motivo-da-politica-em-cada-cartao-de-aprovacoes-rn-656}

### RN-656 — The session events read filters by `actionId`, and each card of the Aprovações tab reads its own reason through it {#rn-656}

The action does not keep the policy reason: it lives in `proposed_action.created`
([RN-567](#rn-567), [RN-609](#rn-609)). The Aprovações tab reads the
PROJECT queue ([RN-638](web.md#rn-638)) and the log of ONE session, so since AT-333 it
said in a single note how many actions were left without a reason ([RN-614](web.md#rn-614)).
Owner decision (AT-336): each card shows its OWN.

**What was measured.** The two options for the card were an `actionId` filter on the
events read or a route that read the event by action. The filter is the
smaller: it reuses the route (`GET .../sessions/:sessionId/events`, `viewer`), the DTO and the
use case, and the action already carries the `sessionId` of the session that proposed it. No
index or migration is born: the predicate on `payload->>'actionId'` runs
INSIDE the session, which the unique index `(session_id, seq)` already narrows. A
PROJECT read by `actionId` would require a new route to find the session the
card already knows.

**The rule in the api.** `actionId` returns only the events whose `payload.actionId` is
that action, in the requested session — it never crosses sessions. It combines with the other
parameters and `limit` counts only the matching ones; `seq` stops being contiguous in the
page, so whoever filters does NOT derive omitted ones by subtraction
([RN-180](web.md#rn-180)). Empty is 400: a filter that vanishes with the wrong string
would return the whole log to whoever asked for an action's reason.

**The rule on the screen.** `useDecisoesDaPolitica`: an action whose event is in the log
the tab ALREADY loaded uses that one, without a request; the others read by action, in
their session, with `staleTime: Infinity` — an event is immutable, so each action
costs ONE read while the cache lives and the queue polls without repeating any.
Nothing is requested while the tab is still loading its own log. A read that
responds WITHOUT the event gives the "motivo não registrado" sentence (never silent); only the
read that FAILS leaves the card silent, and that one, and only that one, is what the top
note counts (*"de N das M ações abaixo"*). Since AT-340 the cards of the
pending items from OTHER sessions in the chat ([RN-626](web.md#rn-626),
`PendenciasDeOutrasSessoes`, also in the Executores tab) go through the SAME hook and
the SAME cache: every action there is from another session, so none is covered
by the screen's log and each one reads by action — only the DRAWN ones, within the
block's card ceiling, and one the Aprovações tab already read costs nothing there (and
vice versa). A read that fails also silences the card and is stated once, at the top
of the block. The "needs you" panel does NOT use this path: it reads no
log and opening it does not trigger a query, so the card there stays silent, as
[RN-614](web.md#rn-614) already said — a decision, not a gap. No ceiling changes.

- **Code:** `src/interfaces/http/sessions/sessions.controller.ts:260`
  (`listEvents`);
  `src/infrastructure/persistence/drizzle/session-event.repository.ts:61`
  (the filter);
  `apps/web/src/lib/decisao-da-politica-queries.ts:35` (`useDecisoesDaPolitica`);
  `apps/web/src/routes/ProjectApprovalsTab.tsx:307` (who calls it), `:481` (the
  failure note), `:499` (the reason on each card);
  `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:74` (the chat calls the
  same hook), `:145` (the reason on each card), `:181` (the failure note)
- **Test:**
  `test/application/use-cases/sessions/list-session-events-por-acao.use-case.spec.ts:80`
  (only the action's events, with the reason — happy path, against Postgres),
  `:109` (does not cross sessions), `:123` (a session of another project is 404),
  `:134` (empty `actionId` is 400);
  `apps/web/src/routes/ProjectApprovalsTab.test.tsx:267` (an action of another session
  reads the reason by action, and the one in the loaded log does not become a request), `:294`
  (absent event says "não registrado"), `:304` (the failing read is stated
  once, counting only it);
  `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx:204` (the chat
  card reads the reason by action, in its session, and remounting does not reread), `:228`
  (the failing read silences the card and is stated once)
- **Origin:** AT-336; AT-340 (the pending items from other sessions in the chat)

- **Origin:** AT-329 (finding N2 of `docs/explanation/auditoria-visual-rodada-29.md`)

## One click closes readiness, need and the PO's acceptance (RN-657/RN-658) {#um-clique-fecha-a-prontidao-a-necessidade-e-o-aceite-do-po-rn-657-rn-658}

### RN-657 — "I'm ready — the need is validated" closes BOTH gates in one POST, with the `product_brief` produced after the click {#rn-657}

Revises [RN-406](contracts.md#rn-406) by the owner's decision (30/09, AT-311): the
Creative's button was renamed **"I'm ready — the need is validated"**
(pt-BR: "Estou pronto — a necessidade está validada"), and it is the label that
makes the click the MERIT judgment that [ADR 0095](../adr/0095-gate-necessidade-validada.md)
required separately — the person declares both things, with the words of both.
`POST .../sessions/:id/readiness` writes, in this order:

1. `readiness.confirmed`, actor the person, with the mark
   `{ necessidadeValidada: true, aceiteImplicitoDoPo: true }` (the mark is what
   [RN-658](#rn-658) reads; an old event, with payload `{}`, accepts nothing);
2. the command to the engine (the turn that consolidates the `product_brief`,
   [RN-142](engine.md#rn-142));
3. only if the engine ACCEPTED the turn, `necessity.validated`, actor the same
   person, with `productBriefId: null` (the brief does not exist yet — it is
   born from the turn the click triggers), `via: 'readiness.confirmed'` and the
   `readinessEventId` from step 1.

The engine's refusal (409 turn in progress, 422 no business rule) bubbles up
BEFORE step 3: without an accepted turn there is no brief on the way, and the
need is NOT validated. The gate stays `warn` (`config/gates.yml`) — nothing
downstream consults it. The screen no longer has the "Confirm need validated"
button; the title of the enabled button says what the click closes, and the
success notice says the PO enters when the summary is ready.

- **Code:** `src/application/use-cases/agents/confirm-readiness.use-case.ts:26` (`ConfirmReadinessUseCase`),
  `:42` (`necessity.validated`);
  `src/domain/sessions/estou-pronto.ts:27` (`MARCA_DO_ESTOU_PRONTO`);
  `apps/web/src/routes/SessionComposer.tsx:315` (the button's title);
  `apps/web/src/lib/session-acoes-da-sessao.ts:143` (`handleReadiness`)
- **Test:** `test/application/use-cases/agents/confirm-readiness.use-case.spec.ts:49`
  (the two events, with the mark and the brief to come — happy path), `:72`
  (422 from the engine: only readiness is recorded — failure case);
  `apps/web/src/routes/SessionPage.estou-pronto.test.tsx:150` (one click,
  need-validated notice, no separate button), `:169` (refusal: nothing is said
  to be validated)
- **ADR:** [0185](../adr/0185-estou-pronto-fecha-os-dois-gates.md), which revises
  [0095](../adr/0095-gate-necessidade-validada.md)
- **Origin:** AT-311 (survey of AT-309, finding 1)

### RN-658 — Acceptance of the Creative→PO handoff is implicit in "I'm ready": the SAME events, with the person as actor and the `implicito` mark {#rn-658}

The owner's decision (30/09, AT-312): the separate click to accept the PO goes
away. The Creative→PO handoff is born AFTER the click (it is the turn the click
triggers that offers it, `CriativoServer.executar_confirm_readiness/1`), so the
acceptance does not fit in the click's POST: it happens in the internal route
that CREATES the offer (`POST /internal/sessions/:id/handoffs`), right after
`CreateHandoffUseCase`, and goes through the SAME `AcceptHandoffUseCase` as the
card.

Measured before changing, acceptance through the card writes: the row's
transition to `accepted`, `handoff.accepted` (actor the person,
`{handoffId, toAgent}`), `agent.activated` (actor the person, `{agent}`) and,
per [RN-635](#rn-635), the `handoff.superseded` of the other offers to the PO in
the project. Implicit acceptance writes exactly those, with the SAME human actor
— whoever clicked, read from the marked `readiness.confirmed` —, and adds the
mark `implicito: { via: 'readiness.confirmed', readinessEventId }` to the payload
of `handoff.accepted` and of `agent.activated`. No event is edited, no system
actor takes the person's place, and acceptance through the card remains without
the mark.

It is accepted only when ALL hold (`decidirAceiteImplicitoDoPo`): the offer is
`criativo` → `po`, `offered`, from THIS session, and carries as artifact the
`product_brief` born AFTER the most recent marked `readiness.confirmed`.
Otherwise the offer stays `offered` and the card appears as always: a session
prior to ADR 0185 (no mark), a brief prior to the click, and the MANUAL handoff,
which never carries an artifact ([RN-633](web.md#rn-633) — the "I'm ready" stays
on screen after it). The failure of the acceptance does NOT go up to the engine
(the offer was created, and the Creative would say "I could not offer" — false):
it becomes a durable `agent.error`, actor `system`/`aceite-implicito`, with
origin (`infra` or `politica`) and `reason: aceite_implicito_falhou`. The 400 of
"not `offered`" is not a failure: someone decided the offer through another path
in the meantime, and that is already in the log. The screen passes the
composer's recipient to the PO on the click (the gesture of calling it,
[RN-631](web.md#rn-631)); until it enters, the choice does not count and the
Creative keeps receiving. No ceiling moves: accepting the PO does not provision
a repository (only the Architect and the Dev Lead do, [RN-582](#rn-582)), nor
does it merge or push.

- **Code:** `src/domain/sessions/estou-pronto.ts:62` (`decidirAceiteImplicitoDoPo`);
  `src/application/use-cases/agents/aceite-implicito-do-po.use-case.ts:37` (`AceiteImplicitoDoPoUseCase`),
  `:45` (`seCouber`);
  `src/interfaces/http/internal/internal-sessions.controller.ts:439` (`handoff`);
  `src/application/use-cases/agents/accept-handoff.use-case.ts:135` (`implicito` in `handoff.accepted`);
  `src/application/use-cases/agents/activate-agent.use-case.ts:80` (`implicito` in `agent.activated`)
- **Test:** `test/application/use-cases/agents/aceite-implicito-do-po.use-case.spec.ts:105`
  (accepts on behalf of whoever clicked — happy path), `:129` (acceptance failure
  becomes `agent.error` and does not go up — failure case), `:120`, `:146`;
  `test/domain/sessions/estou-pronto.spec.ts:58`, `:72`, `:83`, `:94`;
  `test/application/use-cases/agents/accept-handoff.use-case.spec.ts:318`
  (same events, human actor and mark), `:338` (no mark through the card)
- **ADR:** [0185](../adr/0185-estou-pronto-fecha-os-dois-gates.md)
- **Origin:** AT-312 (survey of AT-309, step 4)

## The policy reason on each Approvals card (RN-656) {#o-motivo-da-politica-em-cada-cartao-de-aprovacoes-rn-656-1}

### RN-659 — A new project is born with automatic story promotion; an existing project stays in the mode it had {#rn-659}

The default of `projects.story_promotion` goes from `manual` to `auto` (owner's
decision on 30/09, AT-313): each complete story from the PO is born `ready`,
without the per-story promotion click that the survey of AT-309 counted as +N
steps. The validation is the SAME in both modes (RN-048); only who triggers it
changes.

The change is to the column's DEFAULT, by migration `0065`
(`ALTER COLUMN … SET DEFAULT 'auto'`), and nothing else: no row is rewritten, so
a project that was born `manual` stays `manual` until someone changes it in
Settings. Creation does NOT send the field — the value is the column's default,
a single source —, and both screens STATE the value: the Confirm step of
creation shows "Story promotion: automatic — the PO promotes", with where to
change it, and the Settings section says that a new project is born in
Automatic and that changing it there applies only to that project. The two
validation scripts that exercise the manual flow (`validacao-fase-12.ts`,
`validacao-real.ts`) now ask for `manual` explicitly.

- **Code:** `src/db/schema/iam.ts:287` (`storyPromotion`);
  `src/db/migrations/0065_default_de_promocao_auto.sql`;
  `apps/web/src/routes/NewProjectWizard.tsx:978` (the Confirm row);
  `apps/web/src/routes/settings/PromotionSection.tsx:75` (the default's note)
- **Test:** `test/db/story-promotion-migration.spec.ts:29` (a new project is
  born `auto` — happy path), `:40` (an existing project in `manual` does not
  change — failure case); `apps/web/src/routes/NewProjectWizard.test.tsx:254`
  (Confirm states the value); `apps/web/src/routes/ProjectSettingsTab.test.tsx:625`
  (an old project stays `manual` and the screen states the default), `:646` (the
  api refuses the change and the screen says it did not save)
- **Origin:** AT-313 (survey of AT-309, step 5); revises the default of
  [RN-048](#rn-048)

### RN-660 — The PO's handoff to the Arquiteto is accepted by the SYSTEM when the backlog is covered and the repository is local and without credentials {#rn-660}

The `po → arquiteto` offer that the engine creates (`POST
/internal/sessions/:id/handoffs`) is accepted without a click, in the same request and
AFTER the offer's transaction, when the four conditions hold
(`decidirAceiteAutomatico`, pure):

1. the offer is `offered`;
2. the **backlog is covered**: the project has at least ONE business rule
   (`artifact.business_rule`) and NONE without a story that cites it in
   `businessRuleIds` — the SAME `computeCoverage` as the Backlog tab and the
   PO's read (RN-164). Zero rules is not covered;
3. the repository is **local and without credentials**: the project has no repository (the
   acceptance provisions `local`) or has a `local` one, and has no git connection
   (OAuth) in `project_git_connections`;
4. whoever opened the session still has `developer` in the project (effective role,
   RN-471) — the minimum of the human acceptance route.

The acceptor is still `AcceptHandoffUseCase`: the repository is born there,
before `activateAgent` (RN-582, ADR 0165), on behalf of whoever opened the session. The
acceptance is auditable: `handoff.accepted` and `agent.activated` come out with the
SYSTEM actor `handoff-auto-accept`, and `handoff.accepted` carries `automatico: true`,
`emNomeDe` and the `criterio` (`regras`, `cobertas`, `repositorio`). A condition that
fails records nothing — the offer stays with the usual button, and the response to the
engine says the reason (`regras_sem_historia`, `repositorio_nao_local`,
`credencial_de_git_no_projeto`…). A failure AFTER deciding "yes" does not bubble up: it becomes
the `handoff.auto_accept_failed` event (origin `infra`) and the thread shows it. With the
acceptance done, the `offer_handoff` tool tells the PO that the Arquiteto has already been
activated. A remote repository or one with credentials still asks for the click, and the
manual handoff (ADR 0109) too.

- **Code:** `src/domain/sessions/aceite-automatico-do-handoff.ts:81`
  (`decidirAceiteAutomatico`), `:74` (`backlogCoberto`);
  `src/application/use-cases/agents/aceitar-handoff-automaticamente.use-case.ts:44`
  (`AceitarHandoffAutomaticamenteUseCase`);
  `src/application/use-cases/agents/accept-handoff.use-case.ts:91`
  (`AceitePeloSistema`);
  `src/interfaces/http/internal/internal-sessions.controller.ts:439`
  (`handoff`); `apps/engine/lib/engine/harness/tools/offer_handoff.ex:59`;
  `apps/web/src/routes/session-timeline-montagem.tsx:604` (the notice in the thread)
- **Test:** `test/application/use-cases/agents/aceitar-handoff-automaticamente.use-case.spec.ts:73`
  (covered backlog and no repository: accepted by the system — happy path),
  `:89` (rule without a story: not accepted and nothing recorded — failure case),
  `:99` (remote repository), `:109` (git connection), `:128` (failure becomes
  `handoff.auto_accept_failed`);
  `test/domain/sessions/aceite-automatico-do-handoff.spec.ts:37`,
  `:49` (each refusal reason);
  `test/application/use-cases/agents/accept-handoff.use-case.spec.ts:323`
  (system actor, criterion and provisioning before activating);
  `apps/web/src/routes/SessionPage.handoff-aceite-automatico.test.tsx:174`,
  `:196`; `apps/engine/test/engine/harness/tools/offer_handoff_test.exs:38`
  (not run in this session: no Elixir in the environment)
- **Origin:** AT-314, [ADR 0186](../adr/0186-aceite-automatico-do-handoff-ao-arquiteto.md)

## The Infra Lead does not announce a bring-up it did not do (RN-668) {#o-infra-lead-nao-anuncia-subida-que-nao-fez-rn-668}

### RN-663 — PR merge refuses an already-merged PR and a repeated proposal; a pending gate is only a warning {#rn-663}

Real use on 29/09 measured both holes: `pr-6` had THREE `git_merge`
`executed`, and `pr-4` was merged with the task in `awaiting_qa`. The api did
not deduplicate `git_merge` per PR (only the screen did, and only within the
same list), and `LocalGitProvider` returned the already-merged PR without error
— the executor recorded a second `executed` for the same merge.

1. **Proposal.** A `git_merge` of a PR that an earlier execution already merged
   (`executed` with `state: 'merged'`) is 409 `pr_ja_mergeado`; with a LIVE
   proposal for the same PR (`pending`, `approved` or `auto_approved`), 409
   `merge_ja_proposto`. In both, nothing is created. Denied or failed do not
   count: whoever denied or saw it fail can try again. The comparison is by the
   payload's `pullRequestId`, across the whole project (any session).
2. **Approval.** Approving a pending `git_merge` whose PR ANOTHER proposal
   already merged is 409 `pr_ja_mergeado`, before any effect, and the action
   stays `pending` for whoever sees it denied. A sibling that is merely LIVE
   does not prevent deciding this one.
3. **Provider.** `LocalGitProvider` refuses to merge an already-merged PR with
   `GitPullRequestAlreadyMergedError`, and the target does not move — aligned
   with GitHub, which refuses the repeated merge.
4. **A pending gate is a WARNING, never a refusal** (owner's decision, 30/09).
   The PRs tab and the chat's "Merge" say in TEXT which gate is missing
   (`qa-verificada` with `awaiting_qa` or the gate not yet opened,
   `secops-segura` with `awaiting_secops`), and the button and the card stay
   active. `awaiting_user`, a `done` task and a PR without a task do not warn.
   The "blocked gate" (task `blocked`) stays as it was.
5. **No ceiling moves.** Merge into a protected branch stays unconditional,
   human `require_approval` ([RN-418](#rn-418), `decide.ts`): this rule only
   prevents proposing or approving what there is nothing to merge. Declared: two
   simultaneous proposals for the same PR are not serialized (there is no
   per-PR lock), and it is rule 2 that holds the second one.

- **Code:** `src/domain/actions/merge-de-pr.ts:56` (`recusaDeMerge`),
  `:40` (`mergeouAPr`);
  `src/application/use-cases/actions/propose-action.use-case.ts:124` (`recusaDeMerge`);
  `src/application/use-cases/actions/approve-action.use-case.ts:306` (`recusaDeMerge`);
  `src/infrastructure/git/local-git-provider.ts:339` (`GitPullRequestAlreadyMergedError`);
  `apps/web/src/lib/gate-do-merge.ts:19` (`gatePendenteNoMerge`);
  `apps/web/src/routes/ProjectPrsTab.tsx:236` (`gatePendenteNoMerge`);
  `apps/web/src/routes/session-timeline-montagem.tsx:1249` (`gatePendenteNoMerge`)
  `apps/web/src/routes/ProjectPrsTab.tsx:236` (`gatePendenteNoMerge`);
  `apps/web/src/routes/session-timeline-montagem.tsx:1249` (`gatePendenteNoMerge`)
- **Test:** `test/application/use-cases/actions/propose-action.use-case.spec.ts:664`
  (`merge_ja_proposto`), `:687` (`pr_ja_mergeado` — failure case), `:696`

  `apps/web/src/routes/session-timeline-montagem.tsx:1249` (`gatePendenteNoMerge`)
- **Test:** `test/application/use-cases/actions/propose-action.use-case.spec.ts:664`
  (`merge_ja_proposto`), `:687` (`pr_ja_mergeado` — failure case), `:696`
  (denied does not block, another PR does not collide — happy path);
  `test/application/use-cases/actions/approve-deny-action.use-case.spec.ts:473`;
  `test/infrastructure/git/local-git-provider.contract.spec.ts:150`;
  `apps/web/src/routes/ProjectPrsTab.test.tsx:266`, `:300`, `:315`;
  `apps/web/src/routes/MergearNoChat.test.tsx:135`, `:148`;
  `apps/web/src/lib/gate-do-merge.test.ts:5`, `:18`
- **Origin:** AT-249 (item A3/extra E3 of the analysis of the real use of 29/09)

### RN-665 — O custo real que o provider devolve é o número do metering; o catálogo fica onde ele não vem {#rn-665}

Decisão do dono (30/09): **o custo real vira o número**. Quando a resposta de
uma chamada de LLM diz quanto o provider cobrou — no OpenRouter, `usage.cost`
no frame final do stream —, esse valor é o `token_usage.cost_micros` da linha,
o que o turno devolve ao engine (e o laço soma ao orçamento local), o que
incrementa os budgets de projeto, sessão e área, e o que os relatórios de
gasto somam. Sem ele, o preço congelado do catálogo produz o número, como no
[ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md).

1. **Uma regra, três caminhos.** `RunLlmTurnUseCase`, `StreamLlmTurnUseCase`
   e `SendChatMessageUseCase` passam pela mesma `custoDaChamada`; não há
   segunda régua.
2. **Preço implícito, marcado.** Com custo real, as duas colunas de preço
   gravam `custo ÷ tokens` (o mesmo valor: o provider devolve UM custo) e
   `price_implicit = true` — o que mantém `tokens × preço = custo`
   ([RN-044](#rn-044)) sem fingir um preço de tabela. Sem custo real,
   `price_implicit = false` e as colunas são as do catálogo.
3. **O catálogo ao lado.** `catalog_cost_micros` grava o que o preço de
   catálogo teria cobrado, só nas linhas cujo número é o real (`null` nas
   outras) — é a distância entre estimativa e fatura, por linha.
4. **`estimated` segue falando dos TOKENS** ([RN-041](#rn-041)). A linha
   com custo real tem `estimated = false` porque o custo só chega com o
   `usage` do provider; quem marca o CUSTO como real é `price_implicit`.
5. **O que a resposta disse sobre si é gravado.** `resolved_model_name` (o
   `model` do frame — o alias resolvido) e `generation_id` (o `id`, `gen-…` no
   OpenRouter), por todo provider do dialeto. `model_name` continua sendo o do
   catálogo, a dimensão dos relatórios.
6. **Só quem provou lê o custo.** O hook `extrairCustoReal` existe só no
   OpenRouter; provider sem ele ignora um `usage.cost` presente. Custo que não
   é número finito e não negativo é "não disse" (zero de verdade é custo real),
   e com `is_byok: true` o custo NÃO é lido: é a taxa do hub, e a inferência é
   cobrada por fora — a linha cai no catálogo.

- **Onde:** `src/domain/llm/custo-da-chamada.ts:43` (`custoDaChamada`),
  `src/application/use-cases/llm/run-llm-turn.use-case.ts:288` (`custoDaChamada`),
  `src/application/use-cases/llm/stream-llm-turn.use-case.ts:327` (`custoDaChamada`),
  `src/application/use-cases/llm/send-chat-message.use-case.ts:286` (`custoDaChamada`),
  `src/infrastructure/llm/openai-compatible-provider.ts:410` (`extrairCustoReal`),
  `src/infrastructure/llm/openrouter-provider.ts:272` (`extrairCustoRealOpenRouter`),
  `src/db/schema/llm.ts:375` (`priceImplicit`)
- **Teste:** `test/domain/llm/custo-da-chamada.spec.ts`,
  `test/infrastructure/llm/openrouter-provider.contract.spec.ts` (resposta
  gravada: custo, modelo resolvido, id; BYOK; sem `cost`; provider sem o
  hook), `test/application/use-cases/llm/run-llm-turn.use-case.spec.ts`,
  `test/application/use-cases/llm/stream-llm-turn.use-case.spec.ts`,
  `test/application/use-cases/llm/send-chat-message.use-case.spec.ts`; com
  credencial, o smoke manual `openrouter-provider.smoke.spec.ts`
- **Origem:** [ADR 0188](../adr/0188-o-custo-real-do-provider-vira-o-numero-do-metering.md)
  (AT-270)

### RN-666 — O metering grava quanto da entrada veio de cache e quanto da saída foi raciocínio {#rn-666}

Cada linha de `token_usage` grava duas PARTES que o provider informa no
`usage` do dialeto OpenAI: `cached_input_tokens`
(`prompt_tokens_details.cached_tokens` — quantos dos `input_tokens` foram
servidos de cache, cobrados a uma fração do preço) e `reasoning_tokens`
(`completion_tokens_details.reasoning_tokens` — quantos dos `output_tokens`
foram raciocínio).

1. **Parte, nunca soma.** `input_tokens`/`output_tokens` continuam sendo os
   totais que o provider disse, e já incluem as partes; nada é somado a eles
   e nenhum custo é recalculado por elas — o número do custo é o da
   [RN-665](#rn-665).
2. **"Não disse" não é zero.** `null` = o provider não informou; 0 = informou
   que não houve. Valor que não é inteiro não negativo é "não disse".
3. **A medição diz quanto foi cache.** `medir-execucao.ts` passa a mostrar,
   por agente, o cache lido e o raciocínio com a porcentagem do total, SÓ sobre
   as chamadas que informaram (e em quantas, quando não foram todas), e
   "não medido" quando nenhuma informou — além de em quantas chamadas o custo
   é o real.
4. **Lido para todo provider do dialeto**, porque os dois campos são da
   própria OpenAI; quem não os manda fica com `null`. O Anthropic informa cache
   no protocolo dele (`cache_read_input_tokens`) e isso NÃO é lido aqui — fica
   `null`, declarado; o Ollama não informa.

- **Onde:** `src/infrastructure/llm/openai-compatible-provider.ts:414` (`cachedInputTokens`),
  `src/infrastructure/llm/openai-compatible-provider.ts:817` (`contagem`),
  `src/application/use-cases/llm/run-llm-turn.use-case.ts:230` (`cachedInputTokens`),
  `src/application/use-cases/llm/record-llm-usage.use-case.ts:121` (`cachedInputTokens`),
  `src/db/schema/llm.ts:395` (`cachedInputTokens`),
  `scripts/medir-execucao.ts:89` (`formatarParteMedida`)
- **Teste:** `test/infrastructure/llm/openrouter-provider.contract.spec.ts`
  (resposta gravada com as duas partes; sem os detalhes; valor inválido e
  zero), `test/application/use-cases/llm/run-llm-turn.use-case.spec.ts`,
  `test/scripts/medir-execucao.spec.ts` (`formatarParteMedida`)
- **Origem:** [ADR 0188](../adr/0188-o-custo-real-do-provider-vira-o-numero-do-metering.md)
  (AT-272)

### RN-669 — The path scope compares against the REAL execution folder: `/work` and the container's `/tmp` when it is up {#rn-669}

The scope ceiling of ADR 0055 compared every command against the project's
folder on the HOST, including when the command runs INSIDE the container
(RN-492/RN-502). In real use on 29/09, the 37 "scope" requests were `/work/...`
and `/tmp` compared against `/home/<usuario>/projetos-brabo/<projeto>` (AT-258).

With a `running` container REGISTERED on a `container` or `mounted` project, the
scope root is `/work` — the mount point, where the project's folder and
`.worktrees` live — plus the container's OWN `/tmp`. The `cwd` arrives as a host
path and is translated to `/work` by the same rule as the engine
(`cwd_para_container/2`): the root becomes `/work`, what is under it becomes
`/work/...`, what is outside stays as it came and stays outside. In `mounted`
the translation is bijective. Without a container, the root remains the
project's folder on the host, and the host's `/tmp` stays OUTSIDE.

It applies to whoever is not in autopilot (the specific `terminal` rule): the
autopilot does not go through the scope ([RN-603](#rn-603), kept by
[RN-670](#rn-670)). `projectScopeRoot` neither changes nor merges with
`permissionsFilePath` ([RN-478](#rn-478)); the auto-approval FLOOR remains only
for `container` mode ([RN-493](#rn-493)). `runner` is left out, on purpose: the
api does not know whether the runner will route to the container or to the host
(RN-558). A command argument with a HOST path now counts as outside when there is
a container — the engine translates only the `cwd`, and inside the container that
path does not exist.

- **Code:** `src/domain/actions/path-scope.ts:153` (`cwdNoContainer`),
  `:174` (`comandoNoEscopoDoContainer`), `:112` (`comandoNoEscopo`, now with
  several roots), `:137` (`PONTO_DE_MONTAGEM_DO_CONTAINER`);
  `src/domain/actions/decide.ts:289` (`execucaoNoContainer`), `:648`
  (`execucaoNoContainer`, in `terminalNoEscopo`);
  `src/application/use-cases/actions/propose-action.use-case.ts:174`
  (`containerExecutionActive`, separate from `execucaoNoContainer`)
- **Test:** `test/domain/actions/decide.spec.ts:1274` (with a container
  `/work`, `.worktrees`, `/tmp` and `..` inside — happy path; `/etc`, another
  project, `/workspace`, `/tmp/../etc` outside; without a container `/tmp` and
  `/work` outside — failure cases); `test/domain/actions/path-scope.spec.ts:216`
  (and the copy of `/work` locked against `packages/docker-port`);
  `test/application/use-cases/actions/propose-action.use-case.spec.ts:1141`
  (`mounted` mode with and without a container, and without the floor)
- **Origin:** AT-258 (item A12 of the analysis of the real use of 29/09), owner's
  decision of 01/10, [ADR 0189](../adr/0189-o-piloto-automatico.md)

### RN-670 — Automatic mode is the AUTOPILOT, and "Always allow" does not turn it off {#rn-670}

Owner's decision of 01/10 ([ADR 0189](../adr/0189-o-piloto-automatico.md)):
[RN-603](#rn-603) is NOT revoked. The wildcard
`*: auto_approve` approves EVERYTHING, including the compound synthesized from
`permissions.json`, a path outside the folder, `git commit` and creation of a
LOCAL branch. Still outside, never auto-approvable: push/PR/merge/deploy through
the terminal and `sudo`/`doas` ([RN-418](#rn-418)), merge into a protected
branch, `container_remove`, `instruction_patch` and parallelism. An explicit
`deny` wins, and an `ask` written in the file asks. The guarantee that this does
not reach Brabo's code is the container containment — a single folder, at
`/work`, strictly below the broker's root, no Docker socket nor privilege —,
proven in `apps/broker/src/contencao-do-brabo.spec.ts`; what the proof does NOT
cover is declared in ADR 0189.

**"Always allow" does not turn the autopilot off (AT-255).** The dev agent's
click writes `terminal: auto_approve` ([RN-509](#rn-509)), and the repository
returned that specific one BEFORE the wildcard, with origin `especifica` —
`decide()` stopped recognizing automatic mode (97 + 37 requests in real use on
29/09, with the mode lit on screen). Now the specific `auto_approve` under the
wildcard `auto_approve` resolves as the WILDCARD. A specific that says something
else (`require_approval`, `deny`) still wins, and with the toggle back to manual
the specific written by the click goes back to counting on its own, with the
scope. The click still writes the specific; what decides whether it already
exists is the resolution's `especifica` field, never the resolved mode.

**The screen says what the autopilot releases and what it does not**, with ONE
list in the three places where the mode is turned on: the Executors' batch card
([RN-661](web.md#rn-661), open), the `ApprovalCard` and the agent card's toggle
(collapsed). The "does not release" is the text RN-661 already had, reused.

- **Code:** `src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts:25`
  (`resolve`), `:67` (`modoEspecifico`, the autopilot's exception);
  `src/application/ports/agent-autonomy-repository.port.ts:5`
  (`AutonomiaResolvida`, with `especifica`);
  `src/application/use-cases/actions/approve-always-action.use-case.ts:263`
  (`especifica`); `src/domain/actions/decide.ts:309`
  (`modoAutomaticoDoAgente`); `apps/web/src/components/OQueOPilotoLibera.tsx:16`
  (`OQueOPilotoLibera`); `apps/web/src/components/ApprovalCard.tsx:434`,
  `apps/web/src/components/AgentCard.tsx:164`,
  `apps/web/src/components/ModoAutomaticoDoTime.tsx:134`
- **Test:** `test/application/use-cases/actions/approve-always-action.use-case.spec.ts:850`
  (the measured scenario: wildcard + "Always allow" still goes without a request
  — happy path; toggle in manual goes back to the scope — failure case);
  `test/infrastructure/persistence/drizzle/agent-autonomy.repository.spec.ts:115`;
  `test/domain/actions/decide.spec.ts:1210` (commit and local branch
  free; push, merge, PR, deploy and `doas` still ask);
  `apps/broker/src/contencao-do-brabo.spec.ts:105` (the containment);
  `apps/web/src/components/ModoAutomaticoDoTime.test.tsx:86`,
  `apps/web/src/components/ApprovalCard.test.tsx:145`,
  `apps/web/src/components/AgentCard.test.tsx:81`
- **Origin:** AT-259 and AT-255 (items A9 and A13 of the analysis of the real use
  of 29/09), owner's decision of 01/10

### RN-671 — Infra brings up the container at handoff acceptance: the server proposes, and the seeded autonomy approves {#rn-671}

Owner's decision on 01/10 ([ADR 0190](../adr/0190-a-infra-sobe-o-container-no-aceite.md)),
revising the "never seeded" of [RN-491](web.md#rn-491). In real use on 29/09
Infra announced the bring-up "in parallel" and did not propose it; the container
only came up through `/containers` (AT-260).

1. **The seed.** Accepting the handoff addressed to `infra` writes, besides
   `open_infra_pr: auto_approve` and `terminal: deny`, the autonomy
   `container_start: auto_approve`. Only that one among the container ones:
   `container_start_via_runner` and `container_stop` are still never seeded, and
   `container_remove` stays on the absolute ceiling ([RN-495](#rn-495)).
2. **The trigger belongs to the SERVER.** In the Infra Lead's kickoff, BEFORE
   the first trip to the model, if there is a current routing
   (`artifact.module_routing` `roteado`, with a candidate) and a
   `container`/`mounted` project, the server proposes `container_start` through
   the SAME path as the `propose_container_start` tool: the local refusals by
   mode and state ([RN-566](engine.md#rn-566), [RN-610](engine.md#rn-610)), then
   `propose_action`, where the api refuses without a broker ([RN-591](#rn-591)),
   resolves the autonomy and, if auto-approved, executes the bring-up, electing
   the image through `DecidirImagemDoProjetoUseCase` with
   `decidedBy: 'infra-lead'` ([RN-491](web.md#rn-491)). `runner` has no server
   step: it goes through `container_start_via_runner`, proposed by the model and
   decided by a human.
3. **The election is deterministic.** The candidate with the greatest number of
   modules; on a tie, the first one in the routing. Network `none`, default
   resources, and a `rationale` saying it was the server. *(Revised by
   [RN-683](#rn-683): the resources are omitted and the api brings it up with the
   minimum derived from the `module_map`, not with the default.)*
4. **The trail says who called.** Durable `tool.call` (with `origem: "servidor"`)
   and `tool.result`, and no tool message in the model's history; the kickoff
   says in text what has ALREADY happened (the status returned, or the reason for
   the refusal).
5. **The closing of [RN-668](engine.md#rn-668) remains true.** The server's
   bring-up marks the turn as the tool's: proposed, the closing is silent;
   refused, it says it was refused. A proposal DENIED by the policy (status
   `denied`, like a session opened by someone who is not `maintainer`) counts as
   a refusal, in both origins.

No ceiling moves: the minimum role remains `maintainer` (the effective one of
whoever opened the session), a `deny` in `permissions.json` still wins, and
`/containers` does not change (it proposes as a human, and the agent autonomy
does not apply to it). Declared: the card's manual/auto toggle writes the
wildcard, and the specific rule wins — putting Infra in "manual" does not turn
this seed off.

- **Code:** `src/application/use-cases/agents/accept-handoff.use-case.ts:38`
  (`INFRA_AUTONOMY_SEEDS`);
  `apps/engine/lib/engine/infra/infra_lead_server.ex:259` (`handle_cast`),
  `:710` (`propor_container_start`), `:791` (`subir_no_aceite`), `:794`
  (`eleger_candidata`), `:1435` (`passo_da_subida`)

  `:626` (`propor_container_start`), `:707` (`subir_no_aceite`), `:759`
  (`eleger_candidata`), `:1319` (`passo_da_subida`)
- **Test:** `test/application/use-cases/agents/accept-handoff.use-case.spec.ts:250`
  (the seed, and only it — happy path), `:267` (another agent does not seed —
  failure case);
  `apps/engine/test/engine/infra/infra_lead_server_test.exs:1263` (the server
  elects and proposes before the model — happy path), `:1458` (`mounted`), `:1468`
  (`runner` does not come up through the server), `:1377` (no routing), `:1387`
  (the api refuses without a broker — failure case), `:1427` (container already
  `running`), `:1439` (denied by the policy), `:1580` (`eleger_candidata/1`)
- **Origin:** AT-260 (item A14 of the analysis of the real use of 29/09)

### RN-672 — The handoff to the Dev Lead leaves from Infra, and only with the project's container `running` {#rn-672}

Owner's decision on 01/10 ([ADR 0190](../adr/0190-a-infra-sobe-o-container-no-aceite.md),
AT-262). Until now "Confirm architecture ready" offered TWO handoffs — to Infra
and to the Dev Lead (PHASE 14d, `handoff-duplo` in `packages/contracts/fluxo.yml`)
—, and the Dev Lead could be accepted before the container in which the dev
agents work existed ([RN-502](engine.md#rn-502)). In real use on 29/09 both were
born from the same confirmation (session `be70`, seq 252/254).

1. **The architecture confirmation offers only to Infra.**
   `OfferInfraHandoffUseCase` has one destination (`infra`); the engine port's
   `offerDevHandoff`, the route `POST /internal/sessions/:id/agent/offer-dev-handoff`
   and the Architect's `:offer_dev_handoff`/`handoff_dev_pendente` ceased to
   exist. `ja_oferecido` now means "Infra already had an offer or was active".
2. **Who offers the Dev Lead is the Infra Lead's server**, through
   `create_handoff_if_absent/5` (`infra → dev-lead`, ADR 0182): a pending offer
   in any session of the project comes back as it is, and an already-active Dev
   Lead (409 `agente_ja_ativo`) is not a failure. It is not a tool: the model does
   not decide when the Dev Lead enters.
3. **Only with the container REGISTERED as `running`** (the local read of
   `ProjectContainerLifecycle`). The question is asked at two moments: at the end
   of every Infra turn (`concluir`) — the common case, because the server's
   bring-up at acceptance ([RN-671](#rn-671)) runs inside the kickoff — and when
   the outbox's `container.running` arrives outside a turn (later approval,
   `/containers`, `container_start_via_runner`): `Engine.Outbox.Drain` now also
   enqueues `Engine.Workers.InfraOfereceDevLeadWorker`, which notifies the
   project's Infra Lead through PubSub.
4. **A failure that is not "already served" is a durable `agent.error`** with
   origin ([RN-116](engine.md#rn-116)), without bringing the turn down; the end
   of Infra's next turn tries again.

It stays as it was: the second repository gate at acceptance by the Dev Lead
([RN-582](#rn-582)) — the acceptance is the same, only who offers changed — and
the execution activation chained at acceptance (RN-161). Declared: the outbox
notice is at-most-once, like `Engine.Dev.Wake`; with no Infra Lead up at that
instant, the offer waits for the end of its next turn.

- **Code:** `src/application/use-cases/agents/offer-infra-handoff.use-case.ts:15`
  (`ALVOS_DA_CONFIRMACAO`);
  `apps/engine/lib/engine/infra/infra_lead_server.ex:1169` (`oferecer_ao_dev_lead`),
  `:1164` (`concluir`), `:368` (`handle_info`), `:1075`

  `:1057` (`concluir`), `:345` (`handle_info`), `:1074`
  (`topico_do_container`);
  `apps/engine/lib/engine/workers/infra_oferece_dev_lead_worker.ex:29` (`perform`);
  `apps/engine/lib/engine/outbox/drain.ex:107` (`handlers_for`)
- **Test:** `apps/engine/test/engine/infra/infra_lead_server_test.exs:1490`
  (container `running` at the end of the turn: offers — happy path), `:1504`
  (without `running`: does not offer — failure case), `:1515` (the notice
  outside a turn), `:1532` (the notice with a turn in progress), `:1544` (409 is
  not a failure; 500 becomes `agent.error`);
  `apps/engine/test/engine/agents/arquiteto_server_test.exs:256` (the Architect
  no longer offers to the Dev Lead);
  `apps/engine/test/engine/workers/infra_oferece_dev_lead_worker_test.exs:9`;
  `apps/engine/test/engine/outbox/drain_test.exs:266`;
  `test/application/use-cases/agents/offer-infra-handoff.use-case.spec.ts:104`,
  `:147`
- **Origin:** AT-262 (item A16 of the analysis of the real use of 29/09)

---

### RN-675 — "Always allow" writes VERB + SUBCOMMAND, one pattern per segment of the command {#rn-675}

Owner's decision of 01/10 (AT-257, which closes AT-170 — point 6 of ADR 0055,
the unit of generalization; [ADR 0189](../adr/0189-o-piloto-automatico.md)).
Until now the click wrote the WHOLE command, byte by byte
(`Terminal(<comando>)`): the next command was almost never the same — 173 clicks
in real use on 29/09 —, and the compound became ONE pattern whose content only
matched the FIRST segment, so `cd src && npm test` released only `cd src`.

Now each SEGMENT of the command (the same cut as `decide()`: `&&`, `||`, `;`,
`|`, `&`) becomes a pattern, and the unit is:

- the verb alone (`ls`) → the verb;
- verb + word (`npm test`, `git status`, `mix test`, `npx vitest`) → both.
  "Word" is a letter at the start, with no `/`, `.`, `=`, glob or flag; an
  argument that looks like a word (`cd src`) stays as a subcommand — the NARROW
  side of the doubt, because telling the two apart would require a list of
  verbs, which is the space that findings Z/AD say does not converge;
- verb + an argument that is not a word (`cat src/x.ts`, `cd ../lib`) → the verb;
- verb + FLAG (`ls -la src`, `git -C /x status`) → the EXACT segment: the form
  with a flag is where verb and invocation diverge, and generalizing there would
  be choosing a form from inside the code;
- a unit that is a PREFIX of a ceiling of [RN-418](#rn-418) (`git remote`,
  `gh pr`) → the EXACT segment; and if even the exact one is a prefix (`git`
  alone), no pattern for that segment.

Matching remains the usual one (token prefix), the click on a command with an
external or privileged effect remains refused whole beforehand
(`motivoDeRecusaDoSempreAprovar`, 400 `teto_do_sempre_permitir`), the ceiling of
`decide()` runs after the file, and the path scope keeps limiting WHERE outside
the autopilot ([RN-669](#rn-669)). Who can write is who already could (the
endpoint's role, unchanged); the precedence with automatic mode is that of
[RN-670](#rn-670). The module dev agent's "Always allow" still goes to
`agent_autonomy` ([RN-509](#rn-509)), with no pattern. Only the patterns that
are MISSING are written and narrated; `permission.granted` carries `patterns`
(the written list) and `pattern` (the same list joined by comma, for the
timeline).

- **Code:** `src/domain/actions/pattern-for-action.ts:22`
  (`patternsForAction`), `:62` (`unidadeDoSegmento`), `:43` (`SUBCOMANDO`);
  `src/domain/actions/external-effect.ts:237` (`padraoAlcancaTeto`);
  `src/application/use-cases/actions/approve-always-action.use-case.ts:277`
  (`faltam`), `:315` (`patternsForAction`)
- **Test:** `test/domain/actions/pattern-for-action.spec.ts:18`
  (the unit, happy path), `:103` (a segment that is a ceiling prefix writes
  nothing — failure case); `test/domain/actions/external-effect.spec.ts:11`
  (`padraoAlcancaTeto`);
  `test/application/use-cases/actions/approve-always-action.use-case.spec.ts:936`
  (the click on a compound releases the next one with the same verbs; another
  subcommand still asks; a compound that pushes remains refused);
  `apps/web/src/components/ApprovalCard.test.tsx:253` (the note states the unit)
- **Origin:** AT-257 (item A11 of the analysis of the real use of 29/09) and
  AT-170 (EP-025), owner's decision of 01/10

## O git credenciado roda no host do runner (RN-676)

### RN-677 — Accepting the Dev Lead only brings it in to plan; APPROVING its plan is what activates execution {#rn-677}

> **Revises [RN-161](web.md#rn-161)** (owner's decision, 01/10): accepting the
> handoff to the Dev Lead no longer chains `POST .../execution/activate`, for
> EVERY role. The explicit "Activate execution" shortcut on the card
> ([RN-137](web.md#rn-137)) and the one on the Overview remain — they are a click
> of their own, not the acceptance.

Real use on 29/09 measured the inversion: execution was activated at the
handoff acceptance at 06:45:01 — the web chained the activation for
`maintainer`/`owner` (`session-acoes-de-handoff.ts`, RN-161) —, and the Dev
Lead's plan, proposed at 06:47:47, stayed `pending` and was never used. The plan
had no consumer: `propose_execution_plan` had no execution pipeline and, once
approved, stayed `approved` forever. Measured on `dev` before changing: the
acceptance backend (`AcceptHandoffUseCase`) NEVER emitted `execution.activated`;
the only one that emits it is `ActivateExecutionUseCase`, called only by the
`execution/activate` route.

**The rule:**

1. **The Dev Lead's acceptance only activates it to plan.** `handleAcceptHandoff`
   accepts and nothing else; `AcceptHandoffUseCase` does not change — it still
   provisions the repository as an idempotent second gate ([RN-582](#rn-582)).
2. **Approving `propose_execution_plan` ACTIVATES execution.** The action gained
   an executor in the api, `ExecuteExecutionPlanUseCase`, called by manual
   approval (`ApproveActionUseCase`) and by auto-approval (`ProposeActionUseCase`
   — the type is not in the absolute ceilings of `decide.ts`, so it CAN be
   configured as auto-approvable). It writes the tasks' module ([RN-678](#rn-678))
   and calls the SAME `ActivateExecutionUseCase` as the button — no second
   yardstick: the 409 without a repository (RN-582), the 409 of
   `execution.activated` in an advisory session ([RN-097](#rn-097)) and the
   idempotent reactivation by `findActiveExecutionSession` are still there,
   untouched.
3. **Who activates is who APPROVED** (`decidedBy`); in auto-approval, whoever
   opened the session — against whom `decide()` resolved the role. Both require
   `maintainer`, the same minimum as `execution/activate`, so the resolution of
   the effective role of the dev agents' `git_*` (the execution session's
   `createdBy`) does not change owner.
4. **The Dev Lead's session does NOT close** (it is not passed as
   `originSessionId`, [RN-135](#rn-135)): it is in it that it resumes the
   suspended turn and narrates the outcome.
5. **The outcome is named and durable.** The action ends `executed` with
   `{ sessaoDeExecucao, modulos, tarefasAtribuidas }` or `failed` with the
   `motivo` (the api's sentence, e.g. the 409 without a repository), plus the
   event `execution.plan_applied`/`execution.plan_failed` on the timeline. The
   Dev Lead reads the real outcome on resuming ("execution ACTIVATED in session
   …" or "activation failed: …"), never "plan recorded". Failing does not undo
   the approval: the human's decision is already recorded.

- **Where:** `src/application/use-cases/execution/execute-execution-plan.use-case.ts:89`
  (`execute`); `src/application/use-cases/actions/approve-action.use-case.ts:216`
  (`executeExecutionPlan`); `src/application/use-cases/actions/propose-action.use-case.ts:401`
  (`executeExecutionPlan`); `apps/web/src/lib/session-acoes-de-handoff.ts:91`
  (`handleAcceptHandoff`); `apps/engine/lib/engine/agents/dev_lead_tools.ex:220`
  (`classificar`); `apps/engine/lib/engine/agents/dev_lead_server.ex:730`
  (`texto_do_desfecho`); `apps/web/src/lib/aprovacoes.ts:327`
  (`propose_execution_plan`)
- **Test:** `test/application/use-cases/execution/execute-execution-plan.use-case.spec.ts:106`
  (approved activates as whoever approved — happy path), `:129` (auto-approved:
  whoever opened the session), `:151` (activation refused for lack of a
  repository becomes `failed` with the sentence — failure case);
  `test/application/use-cases/actions/approve-deny-action.use-case.spec.ts:399`
  (approving calls the executor and notifies the Dev Lead);
  `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx:396`
  (accepting does not activate, in the three roles), `:416` (the explicit
  shortcut remains); `apps/web/src/lib/aprovacoes.test.ts:118` (the sentence says
  approving activates);
  `apps/engine/test/engine/agents/dev_lead_tools_test.exs:134`, `:141`;
  `apps/engine/test/engine/agents/dev_lead_server_test.exs:426`, `:457`
- **Architectural decision:** [ADR 0194](../adr/0194-aprovar-o-plano-ativa-a-execucao.md)
- **Origin:** AT-263 (item A17 of the analysis of the real use of 29/09)

### RN-678 — The task belongs to a module, assigned by the Dev Lead in the plan, and only that module's dev picks it up {#rn-678}

In real use on 29/09 `dev-input-keyboard` picked up "Implement the piece's
automatic drop loop" and `dev-board-engine` picked up "Map keys…": the task had
no module, the story had several, and `claimNext` let any dev of any module of
the story pick up any of its tasks (`s.module_ids ? $1`).

**The rule:**

1. **The task has a module** — `tasks.module`, nullable `text` (migration
   `0068_modulo_da_tarefa`). Who assigns it is the **Dev Lead**, in the
   execution plan: `propose_execution_plan` gained `tarefas: [{ taskId, modulo }]`,
   and its kickoff lists the pending tasks of the PROJECT's backlog with the
   `task_id` and the story's modules.
2. **The valid set is the current `module_map`.** The api reads the plan
   (`lerPlanoDeExecucao`, a pure function) at the PROPOSAL and refuses with 400
   `plano_de_execucao_invalido`, without creating the action, when: the plan has
   no `tarefas`; a task has no `taskId` or is **without a module**; the module
   (of the task or of the plan) is **outside the `module_map`**; the task appears
   twice; or does not exist in this project. The sentence names the task, the
   module and the valid modules, and goes back to the Dev Lead as a tool error
   (loop input, [RN-163](engine.md#rn-163)), for it to correct.
3. **Approval re-reads** the plan against the `module_map` of that moment (it may
   have changed): a refusal becomes `failed` without writing anything and without
   activating. If it passes, the modules are written BEFORE the activation, so no
   freshly-started dev agent looks for a task with no owner.
4. **Only that module's dev picks it up.** `claimNext` and
   `countClaimableByModule` use the SAME predicate (`daTarefaDoModulo`): a task
   with a module belongs to whoever has that module, and to nobody else — the
   story's `module_ids` stop deciding. A task **without** a module is only
   pickable when the story has ONE module only, and it is the dev's: it is the
   only case where "that module's dev" is not ambiguous, and it is the path of
   whoever activated through the Overview without a plan. A task without a module
   in a story with several waits for the next plan.

Left out, declared: a task created AFTER the plan is born without a module (the
PO does not assign it); the `task.became_claimable` notice is still routed by the
STORY's modules (waking one dev too many picks up nothing, it only costs a
query); and the plan's per-module `agentes` is still informational — activation
brings up one dev per module of the `module_map`, as before, and extra
parallelism still goes through `parallelize` ([RN-083](#rn-083)).

- **Where:** `src/domain/execution/plano-de-execucao.ts:39`
  (`lerPlanoDeExecucao`); `src/infrastructure/persistence/drizzle/backlog.repository.ts:707`
  (`daTarefaDoModulo`), `:403` (`claimNext`), `:391` (`assignModules`);
  `src/application/use-cases/actions/propose-action.use-case.ts:141`
  (`recusaNaProposta`); `src/application/use-cases/execution/execute-execution-plan.use-case.ts:67`
  (`recusaNaProposta`); `src/db/schema/backlog.ts:187` (`module`);
  `apps/engine/lib/engine/agents/dev_lead_tools.ex:390`
  (`tarefas_do_backlog`); `apps/engine/lib/engine/agents/dev_lead_tools.ex:204`
  (`erro_da_proposta`)
- **Test:** `test/domain/execution/plano-de-execucao.spec.ts:22`
  (happy path), `:41` (task without a module — failure case), `:49` (module
  outside the `module_map`), `:80` (repeated and from another project);
  `test/application/use-cases/execution/claim-next-task.use-case.spec.ts:127`
  (story with two modules: only the dev of the task's module), `:152` (no module
  and several modules: nobody), `:169` (the task's module wins);
  `test/application/use-cases/actions/propose-action.use-case.spec.ts:289`
  (named 400, no proposal);
  `test/application/use-cases/execution/execute-execution-plan.use-case.spec.ts:135`
  (module outside the map at approval: nothing written, nothing activated);
  `apps/engine/test/engine/agents/dev_lead_tools_test.exs:110`, `:118`;
  `apps/engine/test/engine/agents/dev_lead_server_test.exs:131`
- **Architectural decision:** [ADR 0194](../adr/0194-aprovar-o-plano-ativa-a-execucao.md)
- **Origin:** AT-274 (item A28 / extra E5 of the analysis of the real use of 29/09)

### RN-679 — A curadoria recusa o alias de roteamento livre do OpenRouter {#rn-679}

Decisão do dono (01/10): **o alias `~` não entra na curadoria** — só modelo
com upstream fixo. O alias de roteamento livre do OpenRouter (o id que começa
com `~`, como `~deepseek/deepseek-flash-latest`) "sempre redireciona para o
último da família": o catálogo publica um preço de VITRINE (no uso real de
29/09, o do endpoint mais barato da família), a lista de endpoints vem vazia,
e quem cobra é o upstream que atendeu. Não há upstream contra o qual o preço
congelado do [ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
signifique alguma coisa. A alternativa — preçar por upstream — foi recusada.

1. **A régua é do provider.** `ehAliasDeRoteamentoLivre` é `provider =
   'openrouter'` E nome começando com `~`; o mesmo prefixo noutro provider não
   é alias e não recusa.
2. **Ativar recusa, com código.** `POST .../models/activate` com
   `isActive: true` e algum alias no lote é **422** com
   `code: "alias_de_roteamento_livre"`, os `modelIds` recusados e uma frase que
   os nomeia. O lote INTEIRO é recusado, como o 404 do id inexistente
   ([RN-043](#rn-043)): nem o modelo de upstream fixo do mesmo lote é ligado.
   A tela de catálogo mostra a frase da api num toast de título próprio, e
   casa pelo `code`, nunca pelo texto.
3. **O sync NÃO filtra o alias.** Ele continua no catálogo — sumir dali faria
   o sync marcar `unavailable` o que já estava curado, e a cascata pularia os
   bindings dele em silêncio. A leitura da curadoria o MARCA:
   `freeRoutingAlias`, derivado de provider e nome na leitura, nunca gravado.
   A linha mostra o selo e o motivo em TEXTO antes de alguém tentar ativar.
4. **O que já estava curado segue funcionando.** É mensurável (o nome com `~`
   na linha do OpenRouter), e a saída escolhida é a menos surpreendente: o
   alias ativo antes da regra **continua ativo** — os bindings dele seguem
   resolvendo, o seletor segue mostrando —, sai marcado no catálogo, e pode
   ser DESLIGADO. Desligado, não volta. Nada é apagado e nenhum binding é
   reescrito. Binding NOVO para um alias ainda ativo não é recusado aqui: a
   regra é da curadoria, e o binding segue a [RN-043](#rn-043).

- **Onde:** `src/domain/llm/alias-de-roteamento-livre.ts:23` (`ehAliasDeRoteamentoLivre`),
  `:41` (`AliasDeRoteamentoLivreError`),
  `src/application/use-cases/llm/set-models-active.use-case.ts:59` (`AliasDeRoteamentoLivreError`),
  `src/infrastructure/persistence/drizzle/workspace-model.repository.ts:67` (`freeRoutingAlias`),
  `src/interfaces/http/shared/llm-binding-error.filter.ts:60` (`code`),
  `apps/web/src/components/ModelCatalogSection.tsx:606` (`recusaDeAliasLivre`)
- **Teste:** `test/application/use-cases/llm/set-models-active.use-case.spec.ts`
  (lote recusado inteiro com código e ids; upstream fixo ativa; `~` fora do
  OpenRouter ativa; alias curado antes da regra segue ativo, marcado, desliga
  e não volta), `test/interfaces/http/shared/llm-binding-error.filter.spec.ts`,
  `apps/web/src/components/ModelCatalogSection.test.tsx` (selo e motivo;
  toast da recusa; toast genérico para outro erro)
- **Origem:** AT-271 (item A25 da análise do uso real de 29/09); complementa a
  [RN-665](#rn-665)

### RN-681 — História e regra parecidas com uma existente geram AVISO por embedding, nunca recusa; o gasto da checagem é linha própria do metering {#rn-681}

Depois de gravar uma história (`create_story`) ou uma regra de negócio
(`emit_artifact` de `business_rule`), a api compara o TÍTULO dela com os das
existentes do mesmo tipo no PROJETO, por cosseno entre vetores do modelo de
embedding do RAG, e AVISA quando a mais próxima está a partir do limiar.

1. **Aviso, nunca recusa.** O item já existe quando a checagem roda. O aviso
   volta ao agente no resultado da ferramenta — a frase nomeia o parecido, o
   id e o número — e fica no log como `backlog.semantic_duplicate_warned`. A
   duplicata EXATA continua recusada antes, pela [RN-080](engine.md#rn-080) e pela
   [RN-081](#rn-081), e por isso título normalizado igual sai da comparação.
2. **O limiar é 0,80 e é PONTO DE PARTIDA, não calibrado** (ADR 0198, como os
   pesos do [ADR 0080](../adr/0080-busca-hibrida-pesos-limiar-e-citacao.md)):
   os vetores reais do par do achado R e dos pares que não são duplicata não
   puderam ser gravados no ambiente em que a regra nasceu. A prova roda sozinha
   quando `vetores.json` for gravado; até lá ela é PULADA com aviso.
3. **Sem provider de embedding a checagem é PULADA e DITA** — capability
   ausente, daemon fora, timeout: `backlog.semantic_duplicate_check_skipped`
   com o motivo no log e na frase ao agente. Nunca falha a emissão.
4. **O gasto entra no metering como linha própria**: ator
   `system`/`duplicata-semantica`, provider e modelo do RAG, saída zero, preço
   do catálogo quando o modelo está nele. É a ÚNICA exceção ao corte do
   [ADR 0075](../adr/0075-embeddings-no-contrato-de-llm-provider.md) — a
   indexação e a busca do RAG seguem fora —, e cabe porque a emissão acontece
   dentro de sessão.
5. **Tetos:** as 100 existentes mais recentes (o resultado diz quantas de
   quantas quando corta) e 10 s de relógio para a checagem inteira.

- **Onde:** `src/domain/backlog/duplicata-semantica.ts:35` (`LIMIAR_DE_DUPLICATA_SEMANTICA`),
  `:44` (`TETO_DE_COMPARACOES_DE_DUPLICATA`), `:53` (`TETO_DE_TEMPO_DA_CHECAGEM_MS`),
  `:107` (`ehDuplicataSemantica`),
  `src/application/use-cases/backlog/verificar-duplicata-semantica.use-case.ts:111` (`VerificarDuplicataSemanticaUseCase`),
  `:241` (`medir`), `:285` (`narrar`), `:349` (`fraseParaOAgente`),
  `src/application/use-cases/backlog/create-story.use-case.ts:193` (`semanticDuplicate`),
  `src/interfaces/http/internal/internal-sessions.controller.ts:643` (`semanticDuplicateCheck`),
  `src/application/use-cases/rag/rag-embedding.service.ts:106` (`uso`),
  `apps/engine/lib/engine/harness/tools/emit_artifact.ex` (`aviso_semantico`),
  `apps/engine/lib/engine/harness/tools/create_story.ex` (`aviso_semantico`)
- **Teste:** `test/application/use-cases/backlog/verificar-duplicata-semantica.use-case.spec.ts`
  (avisa acima do limiar; o gasto vira linha própria; abaixo não narra; sem
  provider pula dizendo; teto de tempo; teto de comparações; regra pelos
  eventos; metering e log que falham não derrubam),
  `test/application/use-cases/backlog/create-story.use-case.spec.ts`
  (`duplicata semântica (RN-681)`), `test/domain/backlog/duplicata-semantica.spec.ts`,
  `test/domain/backlog/limiar-de-duplicata.calibracao.spec.ts` (o NÚMERO —
  pulada até os vetores serem gravados),
  `apps/engine/test/engine/harness/duplicata_semantica_test.exs`,
  `apps/web/src/lib/activity.test.ts` (`duplicata semântica (RN-681)`)
- **Origem:** [ADR 0198](../adr/0198-duplicata-semantica-por-embedding-com-limiar-que-so-avisa.md)
  (AT-171, achado R)

## Anamnesis reconnected: eligible subject and profile fact (RN-680) {#a-anamnese-religada-sujeito-elegivel-e-fato-do-perfil-rn-680}

### RN-682 — An advisory session with no agent asks for an agent: the composer does not send without a recipient, and the chat route refuses by name {#rn-682}

Until now, the message of an **advisory** session with no agent went to the SSE
of `POST .../chat` (`SendChatMessageUseCase`), which sends the bound model only
the current text — no history, no system prompt, no tool — and records the reply
with the MODEL NAME as the actor. Measured in real use on 29/09: session 5d66
answered "I have no access to previous conversations". The owner's decision
(01/10) is that, with no active agent, the advisory session **asks to choose an
agent** — the same yardstick as [RN-584](engine.md#rn-584) (no default
recipient) reaching the last case that still had one: the raw model.

**The measurement, before the fix:** the chat route had ONE client, the screen
(`handleSend`, only when there was no recipient — which, since
[RN-631](web.md#rn-631), only happened in the advisory session with no agent: the
creative one always has the Creative as an option). The `curl` that the seed
prints is a development hint, in a creative session. The use case has a SECOND
legitimate consumer: the provider smokes (`*-provider.smoke.spec.ts`) use it
directly as an end-to-end instrument (credential → call → metering) in a session
with no agent. That is why the api's refusal lives in the ROUTE, and the use case
does not change.

**The rule:**

1. **The screen does not send without a recipient.** "Send" and Enter are locked
   with zero options, as they already were with two and no choice; the SSE branch
   left `handleSend`.
2. **The recipient row SHOWS who can be called.** With no option, the manual
   handoff selector ([RN-440](#rn-440)) moves inside it — "To", the list, and
   "Call" —, and the selector above disappears so the same choice is not in two
   places. The list is the agents that converse (`AGENTES_DE_CHAT`, the ones the
   engine matches with a clause of their own) and that the manual handoff
   reaches, minus whoever has already entered and **minus the Creative**: the
   advisory session promises in the invitation that it does not enter, because
   opening ideation is what the creative session does ([RN-097](#rn-097)).
   Calling offers the handoff; accepting it in the thread makes the agent the
   recipient (RN-631).
3. **The api refuses the same case for any client.** `POST .../chat` in an
   advisory session in which no `agent.activated` was recorded is **422**
   `{reason: "destinatario_ausente"}`, with the sentence that points to
   `.../agents/:agent/message`, BEFORE any effect: nothing is recorded and no
   model is called. The refusal comes out as an HTTP response and not as an
   `error` frame inside a 200 stream — the handler returns
   `Promise<Observable>`, and a rejection before the SSE header becomes the
   normal response.

**What this rule does NOT close, declared:**

- **The route still answers through the raw model outside that case**: in a
  creative session with no agent (the seed's `curl`) and in an advisory session
  WITH an agent, for whoever calls it by hand. The screen calls it in neither;
  the owner's decision was about the advisory session with no agent, and closing
  the whole route is a separate decision.
- Free chat with history, the other option of AT-254, was not done.

- **Code:** `src/domain/sessions/chat-sem-destinatario.ts:24`
  (`chatSemDestinatarioRecusado`), `:17` (`MOTIVO_CHAT_SEM_DESTINATARIO`);
  `src/application/use-cases/llm/garantir-destinatario-do-chat.use-case.ts:27`
  (`GarantirDestinatarioDoChatUseCase`);
  `src/interfaces/http/llm/chat.controller.ts:82` (`chat`);
  `apps/web/src/lib/session-destinatario.ts:347` (`agentesParaChamar`);
  `apps/web/src/routes/SessionPage.tsx:684` (`handleSend`);
  `apps/web/src/routes/SessionComposer.tsx:276`
- **Test:** `test/application/use-cases/llm/garantir-destinatario-do-chat.use-case.spec.ts:82`
  (advisory session with no agent — failure case), `:96`, `:113`, `:120`;
  `test/interfaces/http/llm/chat.controller.spec.ts:56` (422 as an HTTP
  response), `:79` (happy path);
  `apps/web/src/routes/SessionPage.destinatario-do-chat.test.tsx:458` (does not
  send — failure case), `:471` (list and Call — happy path);
  `apps/web/src/lib/session-destinatario.test.ts:93`;
  `apps/web/src/routes/SessionPage.ideacao-automatica.test.tsx:177`
- **Origin:** AT-254 (item A8 of the analysis of the real use of 2026-09-29),
  owner's decision of 01/10

## O plano de teste nasce depois da entrega do dev (RN-674, ADR 0192)

### RN-683 — Infra brings up the container with the SMALLEST eligible resource, derived from what the Architect declares per module in the `module_map` {#rn-683}

Owner's decision on 01/10 ([ADR 0199](../adr/0199-recurso-minimo-derivado-do-module-map.md),
AT-261). Until now an omitted `resources` became `RECURSOS_PADRAO` (2 cpus,
4096 MiB, 512 pids) and the server's bring-up at acceptance
([RN-671](#rn-671)) always omitted it: every container was born with the
default, with no notion of a minimum.

1. **Each module declares its own.** The `module_map` gains `resources`
   (`cpus`, `memoryMb`, `pidsLimit`) per module — what THAT module needs alone in
   the container. The `create_module_map` tool asks for it; the api accepts it
   absent and refuses with 400, at map creation: a HALF declaration (the three or
   none), a non-positive value or one above the ceiling, and a SUM across modules
   above the ceiling. The field lives in the artifact's JSON, no migration.
2. **The minimum is the SUM, field by field.** A project has ONE container
   (`project_id UNIQUE` in `project_containers`) and the modules run in it at the
   same time; the maximum across modules would undersize the container whenever
   two were up.
3. **A module with no declaration: floor at today's default.** No number is
   invented. When there is a module with no declaration, the minimum is the
   greater of the sum of the declared ones and `RECURSOS_PADRAO`, field by field,
   and the `rationale` NAMES who did not declare. With no declaration at all
   (every map prior to this rule), and with no current `module_map`, the minimum
   is exactly today's default.
4. **The execution of `container_start` resolves field by field.** Omitted
   becomes the minimum (the server's bring-up sends everything omitted); below
   the minimum is a named `failed`, without recording an image decision or
   bringing anything up; above holds up to the ceiling, which does not change.
   The `rationale` of the recorded `artifact.project_image` gains "Minimum
   resources (RN-683): …" with the summed modules and the map version.
5. **One yardstick only.** The api derives; the engine sums nothing, and the
   server's bring-up says in the rationale that the resources are the derived
   minimum.

Out, declared: `choose_project_image` (the Architect decides the image and its
resources) and `container_start_via_runner` (brings up the already-decided image)
do not change; the refusal below the minimum happens at execution, not at
proposal.

- **Code:** `src/domain/containers/recursos-minimos.ts:70`
  (`validarRecursosDoModulo`), `:108` (`derivarRecursosMinimos`), `:150`
  (`validarSomaNoTeto`), `:171` (`resolverRecursosDaSubida`), `:206`
  (`explicarRecursosMinimos`);
  `src/application/use-cases/architecture/create-module-map.use-case.ts:134`
  (`normalizarModulo`);
  `src/application/use-cases/actions/execute-container-start.use-case.ts:175`
  (`resolverRecursosDaSubida`);
  `apps/engine/lib/engine/harness/tools/create_module_map.ex:103` (`normalize`);
  `apps/engine/lib/engine/infra/infra_lead_server.ex:805`
  (`rationale_do_servidor`)
- **Test:** `test/domain/containers/recursos-minimos.spec.ts:18`
  (sum — happy path), `:35` (old map = default), `:41` (floor and named),
  `:54` (sum above the ceiling — failure case), `:94` (below the minimum);
  `test/application/use-cases/architecture/create-module-map.use-case.spec.ts:190`
  (writes), `:208` (half — failure case), `:217` (sum at the ceiling);
  `test/application/use-cases/actions/execute-container-start.use-case.spec.ts:530`
  (server bring-up with the sum), `:556` (no declaration), `:575` (above),
  `:588` (below — failure case), `:608` (no map);
  `apps/engine/test/engine/harness/tools/create_module_map_test.exs:94`, `:109`;
  `apps/engine/test/engine/infra/infra_lead_server_test.exs:1307`
- **Origin:** AT-261 (item A15 of the analysis of the real use of 29/09)

## Anamnesis reconnected: eligible subject and profile fact (RN-680) {#a-anamnese-religada-sujeito-elegivel-e-fato-do-perfil-rn-680-1}

### RN-684 — The contract between modules is a versioned artifact of the Architect, and the dev agent reads it through the tool, never in another dev's worktree {#rn-684}

Owner's decision (01/10), recorded in
[ADR 0200](../adr/0200-contrato-entre-modulos-artefato-do-arquiteto.md). In real
use on 29/09, `dev-board-engine` spent 5 of its 24 tool steps reading other
modules' worktrees to discover their interface: the `module_map` says who
depends on whom, never what a module exposes. It applies
[RN-164](engine.md#rn-164) to the dev agents.

1. **The artifact is `artifact.module_contracts`**, with no table, like
   `module_routing` and `c4_diagram`: the current one is the one with the
   greatest `version`, tie-broken by `seq`. Each declaration carries the WHOLE
   list and REPLACES the previous one; changing a contract is a new version from
   the Architect.
2. **Per module, only what it EXPOSES**: `{modulo, expoe: [{tipo, assinatura,
   descricao}]}`, `tipo` in `funcao | rota | evento | dado`, `assinatura`
   mandatory (up to 300 characters), from 1 to 40 items. What it CONSUMES is the
   current `module_map`'s `dependsOn`, derived on read — never retyped.
3. **The api refuses with 400 and the whole reason** (which goes back to the
   model, RN-061): empty list, repeated module, module outside the current
   `module_map` (listing the valid ones) or without a `module_map`, `expoe` empty
   or above 40, unknown `tipo`, `assinatura` empty or above 300. Nothing is
   written.
4. **An artifact SEPARATE from the `module_map`**, never a field of it: revising
   one does not reissue the other.
5. **The dev reads through `listar_contratos_de_modulos`**, `:direct`, in the
   `Engine.Dev.Tools` registry: project scope by the route, NO parameter, the
   dev's module coming from `ctx.module`. It shows its own in full and those it
   consumes; who consumes it and the rest, by name only; a ceiling of 120 items
   with the cut stated. The contract of a module that left the map is STATED,
   never attributed.
6. **The dev's kickoff says where to read another module's interface**, and that
   it is not in another dev agent's worktree. With no contract for a shown
   module, the tool says to implement from what the story and the task say and,
   if an interface is missing, `report_blocked` naming the module — never
   re-read the worktree.

- **Code:** `src/domain/architecture/module-contracts.ts:110`
  (`validarContratos`);
  `src/application/use-cases/architecture/declare-module-contracts.use-case.ts:55`
  (`execute`), `:80` (`missingModules`);
  `src/application/use-cases/architecture/get-module-contracts.use-case.ts:23`
  (`execute`);
  `src/application/use-cases/architecture/list-module-contracts.use-case.ts:42`
  (`execute`);
  `src/interfaces/http/internal/internal-sessions.controller.ts:783`
  (`moduleContracts`);
  `src/interfaces/http/internal/internal-projects.controller.ts:178`
  (`moduleContracts`);
  `apps/engine/lib/engine/harness/tools/declare_module_contracts.ex:91` (`run`);
  `apps/engine/lib/engine/harness/tools/listar_contratos_de_modulos.ex:43`
  (`run`), `:66` (`renderizar`);
  `apps/engine/lib/engine/dev/tools.ex:36` (`ListarContratosDeModulos`);
  `apps/engine/lib/engine/dev/dev_agent_server.ex:497` (`module`), `:501`;
  `apps/engine/lib/engine/agents/arquiteto_server.ex:112`, `:335`, `:399`
- **Test:** `test/application/use-cases/architecture/module-contracts.use-case.spec.ts:173`
  (writes version 1 — happy path), `:185` (the current one replaces), `:210`
  (module outside the map — failure case), `:222` (without a `module_map`), `:123`
  (the domain refusals), `:239` and `:257` (the dev's read);
  `apps/engine/test/engine/harness/tools/declare_module_contracts_test.exs:26`,
  `:65` (refusal from the api); `apps/engine/test/engine/harness/tools/listar_contratos_de_modulos_test.exs:71`,
  `:76`, `:97`, `:109`, `:128`; `scripts/jev/kickoff.spec.ts:19`. The ExUnit
  tests did not run through `mix` in this environment (`repo.hex.pm` 403; they ran
  in a standalone harness with the modules compiled by hand); CI proves them.
- **Origin:** AT-276 (item A30 of the analysis of the real use of 2026-09-29),
  owner's decision of 01/10

### RN-685 — Revoking a credential takes down only the connections opened WITH it: the socket ticket stores the credential, and the target stops being `{project, user}` {#rn-685}

Revises [RN-520](#rn-520). Until now, revoking a device key took down the
runner's live connection by the `{project, user}` pair, because the credential's
identity died in the `PatAuthGuard`: a runner of the SAME user connected with a
PAT or with another key fell together, and the MACHINE key
([RN-543](produto.md#rn-543)) multiplied this by project. Revoking a PAT took
nothing down.

**The ticket stores WHICH credential requested it.** `runner_socket_tickets`
(the engine's table) gains `credential_kind` (`device_key` | `pat`) and
`credential_id` (the `kid`, which is the record id — [RN-475](web.md#rn-475) —,
or the PAT id), both NULLABLE: the `terminal` ticket belongs to the web tab and
has no device credential, and the `runner` one issued by an earlier api arrives
without it. The `PatAuthGuard` annotates the credential AFTER authorizing
(`request.credencialDeDispositivo`), the `runner` ticket carries it to the engine
and the `terminal` one never does; an incomplete pair or an unknown kind becomes
ABSENT, never an invented credential.

**The socket stores the credential, and so does its id.** `connect/3` puts
`assigns.credencial`, and the id becomes
`runner_socket:<kind>:<projectId>:<userId>:<kind>:<id>` when it exists — the
`disconnect` that the channel broadcasts for its own id reaches only that
credential.

**The revocation of ONE credential:**

1. **voids its PENDING tickets** — the request made seconds before the
   revocation does not get in after it (`consumed_at`, the same "already used"
   state, no new state);
2. **asks EVERY runner in the cluster** whether it was born from this credential
   — only the channel knows —, and only whoever was born from it falls. The
   machine key is ONE request, and it falls in every project in which it opened a
   connection, including one the api would not list;
3. answers with a BALANCE (`derrubados`, `legados`, `intocados`, `semResposta`,
   `ticketsAnulados`) — zero taken down is the normal case of the orphan key
   ([RN-519](#rn-519)).

It applies to the three revocations: the key's (per project and by the Account,
[RN-611](#rn-611)) and the two for PATs (the owner's, [RN-426](#rn-426), and the
`maintainer`'s, [RN-427](#rn-427)). It revokes FIRST, takes down after, and
taking down remains a side effect that only LOGS — the `DELETE` is still 204 and
idempotent.

**What already fell keeps falling** (the prohibition of AT-013). The LEGACY
connection — ticket without a credential — of the same owner, in one of the
projects the KEY revocation sends as scope (the row's, or the machine's
candidates), falls by the pair as before; the PAT gains no legacy scope, because
it took nothing down. And if the engine does not know the per-credential route
(404 from an earlier engine), the key revocation goes back to the pair,
`disconnectRunnerOfUser`, project by project.

**The `{project, user}` pair remains, with another owner:** it is the target of
member removal ([RN-615](#rn-615)), which removes the PERSON, whatever the
credential.

**The screen states the precision** ([RN-561](web.md#rn-561)): the revoke
confirmation — device keys in Settings and machine keys in the Account — swaps
*"another runner of yours also falls"* for *"only what connected with THIS key
falls"*. The label changes, not the behavior.

- **Where:** `src/interfaces/http/auth/pat-auth.guard.ts:151`
  (`credencialDeDispositivo`, the PAT), `:236` (`credencialDeDispositivo`, the
  key);
  `src/interfaces/http/runner/runner-tickets.controller.ts:67`
  (`runnerTicket`);
  `src/application/use-cases/runner/request-runner-ticket.use-case.ts:55`
  (`execute`);
  `src/application/use-cases/auth/revoke-runner-device-key.use-case.ts:71`
  (`execute`), `:109` (`derrubarConexoesDaChave`);
  `src/application/use-cases/auth/derrubar-conexoes-do-pat.ts:21`
  (`derrubarConexoesDoPat`);
  `src/infrastructure/http-clients/api-to-engine-client.ts:693`
  (`disconnectRunnerCredential`);
  `apps/engine/lib/engine/runners/socket_ticket.ex:107` (`emitir`), `:207`
  (`anular_pendentes_da_credencial`);
  `apps/engine/lib/engine/runners/revogacao.ex:131` (`derrubar_credencial`);
  `apps/engine/lib/engine/runners/registry.ex:64` (`todos`);
  `apps/engine/lib/engine_web/channels/runner_socket.ex:81` (`socket_id`);
  `apps/engine/lib/engine_web/channels/terminal_channel.ex:772`
  (`handle_info`), `:879` (`desfecho_da_revogacao_por_credencial`);
  `apps/engine/lib/engine_web/controllers/runner_connection_command_controller.ex:58`
  (`disconnect_credential`);
  `apps/engine/priv/repo/migrations/20261001120000_add_credential_to_runner_socket_tickets.exs`;
  `apps/web/src/routes/settings/RunnerDeviceKeysSection.tsx:346`,
  `apps/web/src/routes/MachineDeviceKeysSection.tsx:202`
- **Test:**
  `test/application/use-cases/auth/revoke-runner-device-key.use-case.spec.ts`
  (`describe "o alvo da queda é a CHAVE"` — happy path; `describe "CASO DE
  FALHA: o engine não atende o pedido por chave"` — plan B by the pair; the
  machine in one request only);
  `test/application/use-cases/auth/machine-device-keys.use-case.spec.ts`;
  `test/application/use-cases/auth/revoke-personal-access-token.use-case.spec.ts`
  and `revoke-personal-access-token-as-maintainer.use-case.spec.ts`;
  `test/interfaces/pat-auth.guard.spec.ts` (the credential annotated on both
  paths, and not annotated on refusal);
  `test/interfaces/http/runner/runner-tickets.guards.integration.spec.ts`
  (the real PAT up to the request to the engine);
  `test/application/use-cases/runner/request-runner-ticket.use-case.spec.ts`
  (`terminal` never carries a credential);
  `test/infrastructure/http-clients/api-to-engine-client.spec.ts`
  (`describe "o alvo é a CREDENCIAL"`, including the 404 that THROWS);
  `apps/engine/test/engine_web/channels/terminal_channel_test.exs`
  (`describe "revogação por CREDENCIAL"` — the real channel that falls, the same
  user's PAT that stays up, the machine in two projects without a list, the
  legacy by the pair, the pending ticket voided);
  `apps/engine/test/engine/runners/socket_ticket_test.exs`,
  `apps/engine/test/engine_web/channels/runner_socket_test.exs`,
  `apps/engine/test/engine_web/controllers/runner_connection_command_controller_test.exs`
  (200 with a balance, 400 for a malformed credential);
  `apps/web/src/routes/settings/chaves-de-dispositivo.test.tsx`,
  `apps/web/src/routes/MachineDeviceKeysSection.test.tsx` (the precision
  sentence, and the old-target one that does not come back)
- **ADR:** [0201](../adr/0201-revogacao-por-chave.md)
- **Origin:** AT-013 (HS-008, EP-003), owner's decision on 01/10. Declared and
  NOT done: the ticket WITHOUT a credential (from an earlier api) is not voided on
  revocation — there is nothing to compare, and the window is 30 s, only at
  rollout; and the ExUnit tests only run in CI (`repo.hex.pm` gives 403 in the
  environment where they were written)

## The RN-418 ceiling also holds through the typed door (RN-689) {#o-teto-da-rn-418-vale-tambem-pela-porta-tipada-rn-689}

### RN-689 — Typed `git_push` and `pr_open` are never auto-approvable: the RN-418 ceiling holds for the command AND for the action {#rn-689}

**Revised by [RN-713](#rn-713)** (AT-385, 02/10): automatic mode (the wildcard in
`auto_approve`) now releases `git_push` and `pr_open`.

Revises [RN-418](#rn-418), by the owner's decision (01/10). Until now the
external-effect ceiling of `decide()` only looked at `actionType === 'terminal'`:
the TYPED `git push` became `require_approval`, and the message said to use the
typed action `git_push` — which, with the minimum role (`maintainer`) met, was
born `auto_approved` by ANY of the three stages: the `"*"` wildcard of automatic
mode ([RN-153](#rn-153), the autopilot of [RN-670](#rn-670)), a specific
`agent_autonomy` rule (execution activation seeded `git_push`/`pr_open` in
`auto_approve` for each `dev-<modulo>`) or an `allow` in `permissions.json`.
Measured in `decide.spec.ts` before the fix: the six cases (two types × three
stages) came out `auto_approve`.

**The rule:** `git_push` and `pr_open` enter the absolute-ceilings block — if the
verdict up to there is `auto_approve`, it becomes unconditional
`require_approval`, with the named reason ("external-effect ceiling (RN-418): …
is never auto-approvable"), which goes into `proposed_action.created`. `deny`
already returned before and still wins; the ORIGIN of the autonomy does not
matter. The "always allow" of both was already refused at the source
([RN-642](#rn-642), `TIPOS_SEM_SEMPRE_PERMITIR`), and it is that half that keeps
the ceiling from being decorative.

**The seeding follows:** `DEV_AUTO_GIT_ACTIONS` becomes only `git_commit` — at
activation and at the parallelization acceptance. Seeding push and PR would be
writing an autonomy that `decide()` never honors, the screen promising what does
not happen (the argument of RN-642). Rows already written stay in the database,
inert. The dev agent still follows the path of [RN-050](engine.md#rn-050): commit
executed, push and PR `pending`, agent in `awaiting_approval` holding the
worktree until `task.pr_settled`; only then does the gate open.

OUT, on purpose: `git_merge` (its own protected-branch ceiling); `git_commit`
(stays on the machine, RN-670); `open_adr_pr` and `open_infra_pr` (they open a
real PR on the provider, but the owner's decision does not cover them —
`open_infra_pr` is seeded `auto_approve` at Infra's acceptance,
[RN-671](#rn-671)); the bootstrap actions
(`git_repo_create`/`git_branch_create`/`git_branch_protect`, which do not go
through `decide()`); and `deploy`, which is not a `proposed_action` type — it only
exists as the destination of the terminal command's message.

- **Where:** `src/domain/actions/decide.ts:427` (`ehAcaoTipadaComEfeitoExterno`);
  `src/domain/actions/external-effect.ts:258`
  (`ACOES_TIPADAS_COM_EFEITO_EXTERNO`), `:266` (`ehAcaoTipadaComEfeitoExterno`),
  `:280` (`mensagemDoTetoDaAcaoTipada`);
  `src/application/use-cases/execution/activate-execution.use-case.ts:71`
  (`DEV_AUTO_GIT_ACTIONS`)
- **Test:** `test/domain/actions/decide.spec.ts:1375` (both types with the
  wildcard, a specific rule and `allow` come out `require_approval`; `deny` still
  wins — failure case; `git_commit` and `git_merge` to a non-protected branch stay
  out); `test/application/use-cases/actions/propose-action.use-case.spec.ts:953`
  (with Postgres: born `pending` with the reason in the event);
  `test/application/use-cases/execution/activate-execution.use-case.spec.ts:473`
  and `accept-parallelization.use-case.spec.ts:141` (seed only `git_commit`);
  `test/application/use-cases/actions/approve-always-action.use-case.spec.ts:795`
  ("always allow" refused, 400 `teto_do_sempre_permitir`)
- **Origin:** AT-347, owner's decision on 01/10

### RN-696 — The proficiency level per competency reaches the agents that talk to the person {#rn-696}

Measured in the code: until now the `proficiency_profiles` that Anamnesis writes
did not reach any agent — only the Psychologist's FACTS accepted by the person
([RN-680](engine.md#rn-680)) went into the turn. The profile was only a screen.

**The rule:** the api reads the per-competency level of the message's AUTHOR in
this project (`listByUser`) and adds it to the SAME `perfilDoAutor` text that the
engine puts as an ephemeral `system` message in the turn
(`Engine.Harness.PerfilDoAutor`) — no agent server changes. Only
`competency: level` goes, with the guidance to calibrate how many questions to
ask; the `rationale` and the evidence do NOT go, and a level outside the scale is
discarded. A ceiling of 12 competencies, and the whole text stays under the
`TETO_DO_TEXTO` of 2,000 characters. A failure on the read is logged, and the turn
goes on without it, independent of the graph read. `fatosDoPerfil` in
`chat.message` still counts only the Psychologist's facts.

Left OUT, and a pending product decision: what Anamnesis observes about the
AGENT's behavior (the loop, the user cancelling the turn) becoming a
product-improvement signal, separate from the person's profile.

> **TODO(human):** is the product-improvement signal coming from Anamnesis an
> event (`anamnese.agent_signal`, with no person subject) or a table of its own,
> who reads it (Staff? an improvements screen?) and how long does it live? It is
> a new data boundary and calls for an ADR (0205 reserved).

- **Where:** `src/domain/anamnese/proficiencia-do-autor.ts:22`
  (`textoDaProficienciaDoAutor`);
  `src/application/use-cases/agents/send-agent-message.use-case.ts:152`
  (`resolverPerfil`), `:203` (`resolverProficiencia`)
- **Test:** `test/application/use-cases/agents/send-agent-message.use-case.spec.ts:254`
  (the level goes, the rationale does not), `:274` (read fails, the message goes
  on — failure case); `test/domain/anamnese/proficiencia-do-autor.spec.ts`
- **Origin:** AT-356 (half 1)

### RN-703 — Subagente sem modelo herda o modelo resolvido do lead da área {#rn-703}

"Aplicar a todos os agentes" (RN-476) grava um binding por agente do catálogo
de Configurações — 17 linhas —, e subagente que o engine roda fora dessa lista
ficava sem modelo em nível nenhum: o `appsec` terminava com `agent.error`
origem `infra` ("Nenhum modelo vinculado para esta sessão"), e o mesmo valia
para todo `dev-<modulo>` além de `dev-backend`/`dev-frontend` e para a
`qa-estrategia`. Quando a cascata de um SUBAGENTE não acha valor (ou só acha o
default global do workspace, que ninguém escolheu para o projeto), ele usa o
binding RESOLVIDO do lead da área dele: o lead da área do catálogo
(`agent-areas.ts`), ou — para `appsec` → `secops` e `qa-estrategia` → `qa`, que
o engine roda por dentro de um lead mas não recebem handoff — uma tabela ao
lado, que só serve a esta herança. A resposta leva `herdadoDoLead` com o lead,
e `origin` continua sendo a do binding dele (RN-470: a tela não afirma
configuração própria). O filtro de tool calling (RN-040) vale na resolução do
lead como na do subagente. Se ainda assim não há modelo, a mensagem de falha
diz onde configurar.

- **Onde:** `src/application/use-cases/llm/resolve-model-binding.use-case.ts:76`
  (`leadDoSubagente`); `src/domain/agents/agent-areas.ts:139` (`leadDoSubagente`);
  `src/domain/llm/binding-resolver.ts:66` (`MENSAGEM_SEM_MODELO`)
- **Teste:** `test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`
  (`appsec` herda do `secops` e `dev-api` do `dev-lead`; lead também sem modelo
  segue `null` — caso de falha)
- **Origem:** AT-367

---

## The installer offers the local models, and does not confuse dev with an installation (RN-691, RN-692) {#o-instalador-oferece-os-modelos-locais-e-nao-confunde-o-dev-com-uma-instalacao-rn-691-rn-692}

### RN-704 — The local repository's merge is a real merge, and a conflict is a named refusal {#rn-704}

- **Rule:** the `mergePullRequest` provider's `local` fast-forwards only when
  the target is an ancestor of the source; with the two diverged, it builds a merge commit
  with both parents (`git merge-tree --write-tree` + `commit-tree`, without a
  worktree, message `Merge pull request #N from <branch>`, identity `Brabo
  Bot`). The target ref is moved by `update-ref` with the expected old value,
  so a concurrent merge fails instead of overwriting. A conflict throws
  `GitMergeConflictError` with the conflicting files: the ref stays intact, the PR
  stays `open`, the `git_merge` action ends `failed` with the reason in
  `action.failed`, and over HTTP the error is 409 `merge_conflict`.
- **Measurement (AT-377):** two PRs from the same base commit (#3 and #4) merged in
  sequence: `dev` ended up with only #4, and #3's commits stopped being
  its ancestors. The old `update-ref` was a forced reset.
- **Where:** `src/infrastructure/git/local-git-provider.ts:783` (`mergeShas`),
  `src/domain/git/git-errors.ts:89` (`GitMergeConflictError`),
  `src/interfaces/http/shared/git-provider-error.filter.ts`
- **Test:** `test/infrastructure/git/local-git-provider.contract.spec.ts`
  ("duas PRs divergentes sem conflito: os dois commits ficam no alvo, por
  commit de merge"; failure case: "conflito: recusa nomeada com os arquivos,
  alvo intacto e PR aberta")
- **Declared gap:** GitHub and GitLab refuse the conflicting merge through their
  own API (405/406), without translation to `GitMergeConflictError`.
- **Origin:** AT-377

### RN-705 — The merge refusal appears in the PRs tab, and the failure records the action's type {#rn-705}

- **Rule:** a git action that fails records `execution_result` with the `kind` of
  the action ITSELF (`git_merge`, `pr_open`, `git_commit`, `git_push`), `failed:
  true`, the `error` and, in `git_merge`, the `pullRequestId`; before, every
  failure recorded `{kind: 'git_push', branch: ''}`. The merge conflict
  (`GitMergeConflictError`, RN-704) also records `conflictingFiles` and a
  `backlog.task_merge_conflict` event on each task of the PR. `GET
  projects/:projectId/actions` accepts `status=failed` (only with `actionType`),
  and the PRs tab reads from there the last merge refusal of each open PR: the
  reason, the files and the sentence that the conflict must be resolved first. It
  is a WARNING in text, like the pending gate's (RN-663): the "Merge" button
  stays active and the decision remains human. Approving the merge invalidates
  the PR list, and so does the channel's `action.git_merge`/`action.failed`
  notice; the "PRs in review" list in Approvals stops showing a `done` task. The
  merge card names the human actor through the members read (RN-655) and shows the
  PR NUMBER (`#3`, not `#pr-3`), and the local provider records the PR's author
  (`<agente>[bot]`).
- **Measurement (AT-383/AT-382, 02/10, test shop):** #6 ended `failed` with the
  conflict in `package.json` and the PRs tab kept showing "OPEN" with the "Merge"
  button, with no text at all; the action recorded `kind: git_push`. After an
  executed merge, the PR stayed in "Open" until reload, the card showed the
  user's UUID and `#pr-3`, and every local PR was "unknown author".
- **Where:** `src/application/use-cases/actions/execute-git-action.use-case.ts:72` (`resultadoDaFalha`),
  `src/application/use-cases/actions/list-project-pending-actions.use-case.ts:22` (`execute`),
  `apps/web/src/routes/ProjectPrsTab.tsx:69` (`ultimaRecusaDeMerge`),
  `apps/web/src/lib/canal-vivo.ts:134` (`alvosDoEvento`)
- **Test:** `test/application/use-cases/actions/execute-git-action.use-case.spec.ts`
  ("conflito de merge → kind git_merge, arquivos no resultado e evento na
  tarefa"; failure case: "falha que não é conflito não grava arquivos nem
  evento de conflito"), `apps/web/src/routes/ProjectPrsTab.test.tsx` ("conflito
  de merge: mostra motivo e arquivos..."; "recusa de OUTRA PR não aparece
  nesta"), `test/infrastructure/git/local-git-provider.contract.spec.ts`
  ("grava o autor ao abrir...")
- **Declared gap (closed in [RN-715](#rn-715)):** the conflict does NOT wake the
  task's dev agent to rebase and resend. The path the QA uses
  (`DevAgentServer.correct/3`) only acts with the agent in `:awaiting_gate` ON THE
  SAME task, and at merge the gate has already ended (`task.gate_resolved` with
  `done` takes the agent to `finish_task`, which zeroes task, worktree and branch
  and claims another). Reusing it requires deciding how the agent re-adopts an
  `in_review` task on the existing branch and whether the gate runs again after
  the rebase — a design decision, not taken here. The task stays `in_review`,
  with the durable `backlog.task_merge_conflict`.
- **Origin:** AT-383, AT-382

## Automatic mode releases push and PR (RN-713) {#o-modo-automatico-libera-push-e-pr-rn-713}

### RN-713 — With the agent's automatic mode, `git_push` and `pr_open` are auto-approved; only the wildcard releases {#rn-713}

Revises [RN-418](#rn-418) and [RN-689](#rn-689), only the push and PR half, by the
owner's decision (02/10, AT-385). With the `agent_autonomy` wildcard
`actionType: "*"` in `auto_approve` (automatic mode, [RN-153](#rn-153), the
autopilot of [RN-670](#rn-670)), typed `git_push` and `pr_open` and the same
effect through the terminal command (`git push`, `git remote add/set-url`,
`gh pr create`, `glab mr create`) come out `auto_approve`, with the reason
"automatic mode (RN-713)" in `proposed_action.created` ([RN-567](#rn-567)).

Only the wildcard releases: a specific `auto_approve` rule without it, "Always
allow" (refused at the source, [RN-642](#rn-642)) and `allow` in
`permissions.json` stay under the RN-418 ceiling, and activation still seeds only
`git_commit`. Still an absolute ceiling even in automatic mode: merge (typed on a
protected branch, and `git merge`/`gh pr merge` through the terminal), deploy,
`sudo`/`doas`, `container_remove`, `instruction_patch` and parallelism. The
toggle back to manual restores approval.

- **Where:** `src/domain/actions/decide.ts:309` (`modoAutomaticoDoAgente`),
  `:324` (`decide`); `src/domain/actions/external-effect.ts:294`
  (`mensagemDoModoAutomaticoNoEfeitoExterno`);
  `apps/web/src/components/OQueOPilotoLibera.tsx`
- **Test:** `test/domain/actions/decide.spec.ts` (the autopilot releases
  `git push`/`gh pr create` and the typed ones; `git merge`, `gh pr merge` and
  `sudo` stay `require_approval`; specific and `allow` without the wildcard stay
  under the ceiling; wildcard in `require_approval` asks for approval — failure
  cases); `test/application/use-cases/actions/propose-action.use-case.spec.ts`
  (with Postgres: auto-approved and executed, reason in the event; a specific rule
  alone is born `pending`); `apps/web/src/components/ModoAutomaticoDoTime.test.tsx`,
  `AgentCard.test.tsx`, `ApprovalCard.test.tsx` (the screen says push and PR are
  released)
- **Architectural decision:** [ADR 0204](../adr/0204-modo-automatico-libera-push-e-pr.md)
- **Origin:** AT-385, owner's decision on 02/10

## The installer offers the local models, and does not confuse dev with an installation (RN-691, RN-692) {#o-instalador-oferece-os-modelos-locais-e-nao-confunde-o-dev-com-uma-instalacao-rn-691-rn-692-1}

### RN-715 — A merge conflict returns the task to the owning dev agent, and the gates judge again {#rn-715}

- **Rule:** when the approved merge of a PR is refused because of a conflict with
  `dev` (`GitMergeConflictError`, [RN-704](#rn-704)), each task of the PR that is
  `in_review` goes back to `in_progress` with `gate_status` zeroed (the old
  QA/SecOps verdicts do not hold for the branch that is about to change), records
  `backlog.task_status_changed` with `cause: merge_conflict` and puts
  `task.merge_conflict` in the outbox, with the agent that proposed the `pr_open`
  (the OWNER), the PR and the conflicting files. The engine delivers it to the
  owner through `Engine.Dev.Wake`; when free, it RE-ADOPTS the PR's branch
  (`WorktreeManager.adopt/3`, the same `garantir_base`, without losing the
  commits) and runs the CORRECTION loop with the reason in the text: bring in
  `origin/dev` through `git fetch`/`git merge`, resolve the files, run the suite.
  At `report_done` it proposes commit and push through the usual path (the
  current approval policy decides) and the gate RESTARTS from QA (`open_gate` +
  QA), with no new `pr_open` — the PR is the same branch. No new task state:
  `in_progress` with the cause in the event.
- **Named outcomes:** an owner with no row in `dev_agent_states` — the task is
  BLOCKED (`conflito de merge sem dev agent para resolvê-lo`, origin `infra`); an
  owner with the breaker open (`idle_tripped`) — blocked, origin `politica`; the
  branch does not come back (`adopt` fails) — blocked, origin `infra`. A busy owner
  (`working`/`awaiting_gate`/`awaiting_approval`) receives the conflict again in
  30 s. The merge refusal ([RN-705](#rn-705)) does not depend on any of this: the
  action is already `failed`, with the reason, before the engine acts. A task that
  is no longer `in_review` (repeated merge) is neither reopened nor wakes anyone,
  and a PR opened by a human has no owner to wake.
- **Measurement (AT-383, 02/10, test shop):** #6 ended `failed` because of a
  conflict in `package.json`, and the task stayed `in_review` with nobody to
  resolve it.
- **Where:** `src/application/use-cases/actions/execute-git-action.use-case.ts:392` (`devolverAoDono`),
  `src/infrastructure/persistence/drizzle/backlog.repository.ts:490` (`reabrirPorConflitoDeMerge`),
  `apps/engine/lib/engine/workers/dev_agent_wake_worker.ex:151` (`task.merge_conflict`),
  `apps/engine/lib/engine/dev/dev_agent_server.ex:350` (`handle_info`),
  `apps/engine/lib/engine/dev/dev_agent_server.ex:831` (`trigger_gate_recheck`),
  `apps/engine/lib/engine/dev/worktree_manager.ex:47` (`adopt`)
- **Test:** `test/application/use-cases/actions/execute-git-action.use-case.spec.ts` ("conflito de merge → kind git_merge, arquivos no
  resultado e evento na tarefa"; failure: "RN-715: tarefa que já não está em
  revisão não é reaberta nem acorda ninguém"),
  `apps/engine/test/engine/dev/dev_agent_server_test.exs` (describe "conflito
  de merge (RN-715)": re-adopts, reason in the turn, commit+push with no new PR,
  gate reopens from QA; failures: branch that does not come back and open
  breaker),
  `apps/engine/test/engine/workers/dev_agent_wake_worker_test.exs` ("dono que
  não existe: bloqueia a task com motivo nomeado, nada calado"),
  `apps/engine/test/engine/dev/worktree_manager_test.exs` ("readotar a branch
  da PR preserva os commits dela")
- **Declared gap:** the redelivery to a busy owner lives in memory — an engine
  restart in that window loses it, and the task stays `in_progress` until
  intervention (same family as the gap of `Engine.Dev.Wake`, ADR 0045). The agent
  integrates `dev` by MERGE, not rebase: the force push that a rebase would
  require does not exist in the git executor. `NoopDevAgentServer` does not handle
  the conflict.
- **Origin:** AT-383

### RN-716 — Anamnesis does not record a level for what it did not observe, and approving is not mastering {#rn-716}

- **Rule:** a proficiency profile is only recorded when the evidence includes at
  least one event written by the profiled PERSON themself that is not an approval
  click (`proposed_action.approved`, `handoff.accepted`, `readiness.confirmed`).
  Evidence only from other actors is "not observed" — absence of opportunity,
  never little knowledge —, and "not observed" is a state of its own: the batch is
  refused with a named reason, nothing is recorded and no
  `anamnese.profile_updated` is born. An approval next to an interaction by the
  person is still accepted. The message of the person who points out an agent
  failure is a deviation of the AGENT and not a trait of theirs: the prompt says
  so, and the record lives in [RN-717](engine.md#rn-717).
- **Measurement (AT-376):** in the test shop of 02/10, "Git → beginner" and
  "Infra → beginner" without the person having interacted with either, and
  "approves 2 ADRs without hesitating" as advanced architecture.
- **Where:** `src/domain/anamnese/proficiency-validation.ts:53`
  (`ehEvidenciaObservadaDaPessoa`), `src/domain/anamnese/proficiency-validation.ts:74`
  (`validateProficiencyBatch`), `src/application/use-cases/anamnese/record-proficiency.use-case.ts:189`
  (`resolveKnownEventIds`), rules in the kickoff (`prompts/anamnese-kickoff.md`
  v3 and the inline fallback of `anamnese_worker.ex`)
- **Test:** `test/domain/anamnese/proficiency-validation.spec.ts`
  ("RN-716: aprovação ao lado de interação da pessoa passa"; failures: "só
  evidência de outro ator é \"não observado\"", "aprovação sem leitura não é
  evidência"), `test/application/use-cases/anamnese/record-proficiency.use-case.spec.ts`
  ("evidência só de aprovação não grava perfil nem profile_updated")
- **Declared gap:** recognizing the REPAIR message in the profile batch is up to
  the model (prompt); the code does not classify message text.
- **Origin:** AT-376

## One cache key, one question (RN-718) {#uma-chave-de-cache-uma-pergunta-rn-718}

### RN-720 — The PO completes the story that already exists, and does not offer the handoff to the Architect with an uncovered rule {#rn-720}

**Context:** in the real use of test-shop-2 (02/10) the PO created twelve stories
with no linked rule, read in `listar_regras_de_negocio` that seven of the eight
rules had NO coverage, wrote that it had no tool to edit a story and called
`offer_handoff` to the Architect anyway — stating in the thread that the coverage
was complete and that the system would accept on its own. The automatic
acceptance of [RN-660](#rn-660) did not happen (the criterion did not close), and
the story it recreated triggered the semantic-duplicate warning
([RN-681](#rn-681)).

**The rule:**

1. The PO has `complete_story`: it completes an EXISTING `draft` story of the
   project — the `business_rule_ids` given are ADDED to those already linked
   (completing never unlinks a rule; an id that is not an
   `artifact.business_rule` is 400), lists given and non-empty replace the current
   ones and omitted ones stay. A story that is not `draft` is 409; from another
   project, 404. After writing, promotion follows the SAME criterion as
   `create_story` (`isPromotable`; `auto` goes to `ready`, `manual` sets
   `proposedReady`), and the write records `backlog.story_completed`.
2. The PO's `offer_handoff` to the Architect is REFUSED, without creating an
   offer, while there is a rule without a story or an incomplete `draft` story
   (without `proposedReady`) — and the result lists both, with id and title, and
   says to complete with `complete_story`. The coverage is the api's
   (`computeCoverage`, the same as the automatic acceptance), never a second
   calculation in the engine; a read failure does not become a refusal. Other
   agents and destinations do not go through the check.
3. When the PO's `emit_artifact` of a `business_rule` returns with the similarity
   warning (`status: warned`), the result adds that the rule looks like it CHANGES
   an existing one and that it should ask the user (`ask_structured_questions`)
   which one holds before going on (AT-389: the user said "flat fee of R$ 10", the
   Creative recorded "R$ 10 per order" and the PO emitted "R$ 10 per roaster").
   The rule already recorded is not undone; the warning remains a warning.

The PO's kickoff states the three things.

- **Where:** `src/application/use-cases/backlog/complete-story.use-case.ts:52`
  (`CompleteStoryUseCase`);
  `src/interfaces/http/internal/internal-sessions.controller.ts:541`
  (`completeStoryRoute`); `apps/engine/lib/engine/harness/tools/complete_story.ex:47`
  (`run`); `apps/engine/lib/engine/harness/tools/offer_handoff.ex:52`
  (`recusa_por_cobertura`); `apps/engine/lib/engine/harness/tools/emit_artifact.ex:188`
  (`pergunte_antes`)
- **Test:** `test/application/use-cases/backlog/complete-story.use-case.spec.ts`
  (links the rule and proposes promotion; `auto` goes to `ready`; nonexistent
  rule, another project and `ready` story refused);
  `apps/engine/test/engine/harness/tools/offer_handoff_test.exs` (describe
  "cobertura (RN-720)": refuses with the list, complete coverage offers and the
  automatic acceptance follows); `apps/engine/test/engine/harness/tools/complete_story_test.exs`;
  `apps/engine/test/engine/harness/duplicata_semantica_test.exs` (the warning on
  the PO says to ask; outside the PO or without a warning, it does not)
- **Declared gap:** the PO's server still offers on its own at the end of the turn
  through RN-700, which already required coverage; the refusal here belongs to the
  TOOL. Whether the semantic duplicate warned in the real case of test-shop-2 was
  not measured in this change (that run's database was not read).
- **Origin:** AT-388, AT-389

## Anamnesis does not pay twice for the same window, and the gate rescue does not restart a cycle that is waiting for someone (RN-722) {#a-anamnese-nao-paga-duas-vezes-pela-mesma-janela-e-o-resgate-de-gate-nao-reinicia-ciclo-que-espera-alguem-rn-722}

### RN-727 — A draft story is corrected and archived, by the PO and by the user, without erasing anything {#rn-727}

- **Rule:** a `draft` story WITHOUT a task in execution (`in_progress` or
  `in_review`) can have its title corrected and can be ARCHIVED — by the PO (tools
  `update_story`, which also corrects the description, and `archive_story`) and by
  the user in the Backlog tab ("Edit title" and "Archive", with confirmation). The
  two doors go through the SAME yardstick (`recusaDeCorrecaoDeHistoria`), and the
  refusal is a NAMED 409: `historia_arquivada`, `historia_nao_draft` or
  `historia_com_tarefa_em_execucao`, with the sentence that the model and the
  toast show. Archiving does NOT erase: the `stories` row gains
  `archived_at`/`archived_reason` (migration `0069`,
  [ADR 0212](../adr/0212-historia-arquivada.md)), the tasks stay, and the NEW
  event `backlog.story_archived` stores who, why and which tasks; editing records
  `backlog.story_updated` with the previous title. The archived story leaves the
  backlog (`listar_backlog` included — the PO does not see it so as not to
  complete it again), the coverage (`computeCoverage` reads only the non-archived),
  the promotion queue, the Dev Lead's plan and the claim, and its tasks leave with
  it, through the story; transition, `complete_story` and `create_task` refuse an
  archived story. The user's minimum role is that of the other backlog writes
  (promote/return, RN-048): `developer`; below it the buttons are inert with the
  reason in text, and the same goes for a story outside `draft` or with a task in
  execution. Each story shows how many tasks it has.
- **Where:** `src/domain/backlog/correcao-de-historia.ts:33`
  (`recusaDeCorrecaoDeHistoria`),
  `src/application/use-cases/backlog/corrigir-historia.use-case.ts:47`
  (`editar`), `:95` (`arquivar`),
  `src/infrastructure/persistence/drizzle/backlog.repository.ts:97`
  (`findByProject`), `:403` (`claimNext`),
  `src/interfaces/http/backlog/backlog.controller.ts:205`
  (`updateTitle`), `:219` (`archive`),
  `src/interfaces/http/internal/internal-sessions.controller.ts:579`
  (`updateStoryRoute`), `:612` (`archiveStoryRoute`),
  `apps/engine/lib/engine/harness/tools/update_story.ex:45` (`run`),
  `apps/engine/lib/engine/harness/tools/archive_story.ex:38` (`run`),
  `apps/web/src/routes/ProjectBacklogTab.tsx:80` (`motivoDeCorrecaoInerte`)
- **Test:** `test/application/use-cases/backlog/corrigir-historia.use-case.spec.ts`
  (happy: title and archive with event; failure: an `in_progress`/`in_review`
  task is 409 `historia_com_tarefa_em_execucao` with no write),
  `test/application/use-cases/execution/claim-next-task.use-case.spec.ts`
  ("não pega task de story ARQUIVADA, nem a conta, nem a lista", against
  Postgres), `test/interfaces/http/backlog/backlog-corrigir-historia.controller.spec.ts`
  (the role of the two routes is that of promoting; `viewer` does not reach),
  `apps/engine/test/engine/harness/tools/corrigir_historia_test.exs` (the named
  refusal reaches the model), `apps/web/src/routes/ProjectBacklogTab.test.tsx`
  ("corrigir história (RN-727)": happy, task in execution and role below
  `developer` leave it inert with the reason)
- **Origin:** AT-406 (TP-01 of 03/10: the PO created two duplicate stories, called
  `delete_story` and received "unknown tool"; the duplicates gained tasks and
  entered the plan), owner's decision of 03/10 ("PO and user")

### RN-729 — The infra PR targets `dev` and says where to merge; the sidebar opens only the open project {#rn-729}

- **Rule:** four clauses measured in TP-01 (03/10).
  (1) The infra PR (`open_infra_pr`) follows [RN-664](engine.md#rn-664): the
  `feature/infra-setup` branch is born from `dev` and the PR targets `dev` — the
  dev agent's worktree is born from `dev`, so the Dockerfile merged into `main`
  never reached it. A repository without `dev` fails named by the provider, with no
  fallback to the default. The PR carries the author `<agente>[bot]`
  (`infra[bot]` when the actor is not an agent), the same identity as
  [RN-705](#rn-705). In Approvals, each infra PR in review gains "Merge in the PRs
  tab", which switches the frame to the PRs tab (where the merge lives). (2) Opening
  a project COLLAPSES the others in the sidebar and scrolls the list to it; on the
  Dashboard none is forced expanded; the chevron still toggles by hand. (3) The
  text fields of the "New project" wizard (name, path, adopted repository) carry
  `SEM_AUTOFILL`, the same set as [RN-693](web.md#rn-693). (4) Deciding a merge in
  the PRs tab invalidates the project's whole pending queue, so the sidebar's "PRs"
  counter does not keep showing the already-executed merge until the next poll; and
  the QA (or SecOps) lead stops saying "working" when, after the last opinion, an
  area subagent records `delegation.failed` — it becomes `failed`. No new query nor
  poll.
- **Where:** `src/application/use-cases/actions/execute-infra-pr.use-case.ts:71`
  (`ExecuteInfraPrUseCase`),
  `apps/web/src/routes/ProjectApprovalsTab.tsx:106` (`ProjectApprovalsTab`),
  `apps/web/src/routes/Shell.tsx:562` (`idDoProjetoAtual`),
  `apps/web/src/routes/NewProjectWizard.tsx:155` (`NewProjectWizard`),
  `apps/web/src/routes/ProjectPrsTab.tsx:141` (`invalidateMergeActions`),
  `apps/web/src/lib/agent-status.ts:222` (`gateStatus`)
- **Test:** `test/application/use-cases/actions/execute-infra-pr.use-case.spec.ts`
  ("a branch nasce de dev, a PR mira dev e leva infra[bot]"; failure:
  "repositório sem dev falha nomeado, sem cair na default"),
  `apps/web/src/routes/Shell.test.tsx` ("abrir um projeto recolhe o visitado
  antes e rola até o aberto", "no Dashboard nenhum projeto fica forçado
  expandido"), `apps/web/src/routes/NewProjectWizard.test.tsx` ("o campo de
  nome não convida o autofill"), `apps/web/src/lib/agent-status.test.ts`
  ("delegação falhada depois do parecer encerra o trabalhando")
- **Origin:** AT-411, AT-412, AT-413, AT-415

### RN-730 — The provider's 402 has its own `code`, and it is that which decides exhausted credit {#rn-730}

- **Rule:** the LLM provider's HTTP 402 is normalized as
  `insufficient_credit` (before it fell into `upstream`), in the same status table
  of ADR 0041 — the other statuses stay as they were. The `code` travels to the
  engine as `errorCode` next to `error`, in the `llm-turn` body and in the
  `final` frame of `llm-turn/stream` (`null` without an error or with an error that is not the
  provider's, like budget and missing binding). In the engine,
  `FalhaDeTurno.credito_esgotado?/1` decides first by the `code`
  (`insufficient_credit` is credit; another `code` is not, even with the sentence), and
  the conversational agents' `{:final, texto, code}` frame gives origin `infra` by the
  code. RN-726's text recognition stays only as a SAFETY NET: an api older than
  the field, and a path that only carries the message.
- **Where:** `src/domain/llm/llm-provider-errors.ts:38`
  (`LLMInsufficientCreditError`), `:86` (`normalizeHttpStatus`),
  `src/application/use-cases/llm/run-llm-turn.use-case.ts:270`
  (`streamErrorCode`),
  `src/application/use-cases/llm/stream-llm-turn.use-case.ts:305`
  (`streamErrorCode`),
  `apps/engine/lib/engine/agents/falha_de_turno.ex:91` (`credito_esgotado?`),
  `:71` (`origem`), `apps/engine/lib/engine/harness/tool_loop.ex:168`
  (`last_error_code`), `apps/engine/lib/engine/dev/dev_agent_server.ex:902`
  (`handle_outcome`)
- **Test:** `test/contract/llm-provider.contract.ts` (`erro_402 vira
  chunk de erro com code "insufficient_credit"`; failure: `erro_500` stays
  `upstream`), run by all provider contract suites;
  `apps/engine/test/engine/agents/falha_de_turno_test.exs` ("insufficient_credit
  é crédito esgotado e origem infra, sem frase nenhuma"; failure: "outro code não
  é crédito, mesmo com a frase; sem code, o texto é a rede")
- **Origin:** AT-416 (the declared gap of RN-726)

### RN-734 — The OpenAI-compatible path ALWAYS sends the output ceiling {#rn-734}

- **Rule:** every chat call through the `/chat/completions` dialect (the providers
  born from `OpenAICompatibleProvider`, OpenRouter included) carries the output
  ceiling field — `max_tokens` or `max_completion_tokens`, according to
  `maxTokensField` — even when the caller does not set `maxTokens`. With no
  setting, the value is `MAX_TOKENS_PADRAO` (4096), the SAME `DEFAULT_MAX_TOKENS`
  of `anthropic-provider.ts`, so that the agent has the same ceiling in both
  dialects. The reason is credit RESERVATION: without the field, OpenRouter
  reserves per call the model's MAXIMUM output and refuses with 402 ("would exceed
  your available credits given your current in-flight requests") with a balance
  that would cover the real call. Today no caller (engine → `llm-turn`) sets
  `maxTokens`, so the default applies to all agents. A response cut by the ceiling
  (`finish_reason: "length"`) is read and narrated since
  [RN-737](#rn-737) (RN-698 narrates the ITERATIONS ceiling, not the tokens one).
  Hypothesis NOT measured with a real key: that the reservation explains the 402
  in TP-01.
- **Where:** `src/infrastructure/llm/openai-compatible-provider.ts:38`
  (`MAX_TOKENS_PADRAO`), `:634` (`flags`)
- **Test:** `test/infrastructure/llm/openai-compatible-provider.contract.spec.ts`
  (without `maxTokens` the body carries `max_tokens: 4096`; with `maxTokens: 123`
  it carries 123; with `maxTokensField: 'max_completion_tokens'` the field changes
  and `max_tokens` is not sent)
- **Origin:** AT-419 (TP-01 of 03/10: US$ 1.79 free and a 402 on the Dev Lead's
  call and on the dev agent's)

### RN-737 — An answer cut by the output ceiling is flagged, not executed, and stated {#rn-737}

- **Rule:** the api reads the stop reason in both dialects — `finish_reason:
  "length"` in OpenAI-compatible (OpenRouter included) and `stop_reason:
  "max_tokens"` in Anthropic — and, only when the answer was cut by the output
  ceiling (RN-734), returns `truncated: true` in the `llm-turn` response and in the
  `final` frame of `llm-turn-stream` (additive field; absent in the normal case).
  The engine notes the signal in the turn's process, on every LLM call: (a) the
  tool call of a cut answer is NOT executed — it goes back to the loop
  as a named error ("a resposta foi cortada pelo limite de tokens… Reenvie o
  argumento em partes menores"), which the model reads and fixes (RN-163); (b) the
  cut text closing gains, AFTER the model's text and without rewriting it,
  the line in the turn's language (RN-622, mold of RN-731): `pt*` "Resposta
  cortada pelo limite de tamanho.", any other — or none — "Response cut
  off by the length limit.". Ollama does not read the stop reason (out of
  scope, declared).
- **Where:** `src/infrastructure/llm/openai-compatible-provider.ts:314`
  (`cortadaPeloTeto`),
  `src/infrastructure/llm/anthropic-provider.ts:229` (`finalMessage`),
  `src/application/use-cases/llm/run-llm-turn.use-case.ts:234`
  (`truncated`),
  `src/application/use-cases/llm/stream-llm-turn.use-case.ts:301`
  (`truncated`),
  `apps/engine/lib/engine/harness/resposta_cortada.ex:43` (`registrar`),
  `:89` (`descarregar`),
  `apps/engine/lib/engine/harness/argumentos_de_ferramenta.ex:26` (`executar`),
  `apps/engine/lib/engine/agents/texto_do_turno.ex:65` (`payload_do_turno`)
- **Test:** `test/contract/llm-provider.contract.ts` ("resposta
  cortada pelo teto de saída emite o sinal truncated" and "resposta normal não
  traz o sinal de corte", run with a fake server by the
  OpenAI-compatible and Anthropic harnesses),
  `apps/engine/test/engine/harness/resposta_cortada_test.exs` (a tool of a
  cut answer does not run and returns a named error; a normal answer runs; a cut
  closing gains the line in pt-BR without rewriting; a normal closing intact; pt/en)
- **Origin:** AT-423 (gap declared in RN-734)

### RN-739 — The diagnosis carries the provider's whole error body, and the bubble stays short {#rn-739}

- **Rule:** the message of the normalized provider error (ADR 0041) carries the
  error body up to `LIMITE_DO_DETALHE` = 4,000 characters (it was 200, and cut
  OpenRouter's JSON before the `metadata.reason`, which says the nature of the
  error). That message is the text of the final frame and becomes, verbatim, the
  `reason` of the `agent.error` (`FalhaDeTurno.diagnostico/1`, RN-733). The
  bubble's sentence does NOT grow with it: outside the credit case (which already
  has a short sentence), the narrated text enters the bubble cut at 300
  characters with "…".
- **Where:** `src/domain/llm/llm-provider-errors.ts:164`
  (`LIMITE_DO_DETALHE`), `apps/engine/lib/engine/agents/falha_de_turno.ex:284`
  (`@teto_da_bolha`), `:289` (`curto`)
- **Test:** `test/domain/llm/llm-provider-errors.spec.ts` (the 402
  carries `"metadata":{"reason":"insufficient_credits"` whole; a body above the
  ceiling is cut), `apps/engine/test/engine/agents/falha_de_turno_test.exs`
  (RN-739: the `reason` contains the `metadata`; a long error is cut in the bubble
  and not in the diagnosis)
- **Origin:** AT-424 (TP-01, 3rd round, 03/10: `reason` cut at
  `…"code":402,"metadata":{"reason":"in…`)

### RN-741 — Reasoning has its own budget and does not eat the visible output {#rn-741}

- **Rule:** when the binding's model reasons (`models.supports_reasoning`, from the
  catalog), the LLM use cases send `reasoning: true` to the provider. A provider
  with `campoDeRaciocinio` configured (today only OpenRouter) sends an EXPLICIT
  reasoning budget — `reasoning: { max_tokens: ORCAMENTO_DE_RACIOCINIO }`, 4096 —
  and the call's `max_tokens` becomes the visible output (the ceiling of RN-734)
  PLUS that budget, so that the text and the tool call keep their own ceiling.
  Reasoning is never turned off (`exclude`/`enabled: false` are not sent). A model
  without reasoning, and a provider without the configuration, send the body from
  before, byte for byte. The direct `anthropic-provider` does not send `thinking`,
  so the model does not reason through it and the hole does not exist — declared,
  no change. The shape of the field was read from OpenRouter's docs (Reasoning
  Tokens: `reasoning.max_tokens`; the call's `max_tokens` must be greater than it).
  **Revised by [RN-782](#rn-782)/[RN-783](#rn-783) (AT-467):** the measurement with
  a credential on 10/10 showed that Haiku 5.5 IGNORES `reasoning.max_tokens`; the
  field stopped being sent and the headroom in `max_tokens` stayed.
- **Where:** `src/infrastructure/llm/openai-compatible-provider.ts:48`
  (`ORCAMENTO_DE_RACIOCINIO`), `:640` (`controla`)
- **Test:** `test/infrastructure/llm/openai-compatible-provider.contract.spec.ts`
  (`raciocínio com orçamento próprio (RN-741)`: budget and summed ceiling; without
  reasoning the body does not change; a provider without the field does not invent
  a budget)
- **Origin:** AT-427 (TP-01, 08/10: `anthropic/claude-haiku-5.5` with
  `output_tokens = reasoning_tokens = 4096` in two consecutive PO calls)

### RN-752 — A merged infra PR leaves "PRs de infra em revisão" {#rn-752}

- **Rule:** the `GET .../infra-artifacts` read (the "PRs de infra em
  revisão" section of the Aprovações tab) does not return the infra artifact whose PR has already been
  merged. The artifact's gate ends in `awaiting_user` and nothing moves it after
  the merge; instead of a new column, the yardstick is DERIVED: the artifact's PR is the
  `pullRequestId` of the result of the `open_infra_pr` that opened it (`prActionId`),
  and it is merged when an `git_merge` `executed` of the project
  returned `state: 'merged'` for that id — the same matching by
  `pullRequestId` that closes the tasks (RN-628). A merge that failed or is still
  pending removes nothing from the list. The "infra PR ready to merge" notice in the
  thread or in the "needs you" panel was NOT done here.
- **Where:** `src/application/use-cases/execution/list-infra-artifacts.use-case.ts:26`
  (`execute`)
- **Test:** `test/application/use-cases/execution/list-infra-artifacts.use-case.spec.ts`
  (an executed merge removes the PR; a failed or pending merge keeps it)
- **Origin:** AT-436 (TP-01: after "Merge" → "Aprovar" in the PRs tab, the PR
  stayed with Dev ✓ QA ✓ SecOps ✓ and "Você" pending)

### RN-758 — Jev's cut never removes the agent's obligation tool {#rn-758}

- **Rule:** when Jev cuts the step's menu ([RN-625](engine.md#rn-625), P3), the
  menu gets the agent's FLOOR back: for the PO, `create_story`, `create_task` and,
  since [RN-942](#rn-942), `declare_open_question`; for the Architect,
  `create_module_map`, `route_modules_to_infra`, `declare_module_contracts`,
  `propose_adr` and `create_c4_diagram`. Only what is in that step's catalog
  enters — the floor never adds a tool the agent did not have, and on every
  fallback the whole catalog stays as before. The floor is STATIC per agent, and
  that is declared: the api has no cheap signal of which obligation is pending at
  that step, so it holds whenever there is a cut. The dev agents are left without
  a floor, on purpose (their obligation changes at each step; for them only
  [RN-759](#rn-759) holds) — except `report_done`/`report_blocked`, which enter
  their floor since [RN-839](#rn-839).
- **Where:** `src/domain/llm/tool-router.ts:397` (`menuComPiso`) and
  `src/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.ts:248`
  (`menuComPiso`)
- **Test:** `test/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.spec.ts`
  (the PO with the menu `["listar_backlog","create_story"]` keeps `create_task`;
  the Architect with 2 of 9 keeps the five artifact tools)
- **Origin:** AT-445 (TP-01 of 09/10: the PO without `create_task` answered "I do
  not have a tool to create tasks" and closed with 8 stories without tasks; the
  Architect with 2 of 9 closed without routing, contracts, ADR or C4)

### RN-759 — The cut step tells the model that the menu is a cut {#rn-759}

- **Rule:** when the Jev's cut is applied (`aplicado: true`), the call
  to the provider for THAT step carries, at the end, an EPHEMERAL `system` message that
  says how many and which tools the step received, that the others remain
  available in the next rounds and that the agent must not conclude that it lacks
  a tool nor end the turn waiting for it. It never enters the
  agent's history nor the event log, and does not exist without a cut nor on fallback.
  It is assembled in the api, and not in the engine's facade like [RN-622](engine.md#rn-622),
  because only the api knows the menu after the Jev. Not applying the cut on the round
  that closes the turn was evaluated and not done: the api does not know before the
  answer that the round will be the last.
- **Where:** `src/domain/llm/tool-router.ts:416` (`avisoDeRecorte`) and
  `src/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.ts:263`
  (`avisoDeRecorte`)
- **Test:** `test/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.spec.ts`
  (the notice arrives as the last message with a cut; without a cut and on fallback, the
  messages are the request's)
- **Origin:** AT-445 (the dev agent blocked a task "sem ferramenta para
  editar arquivos" while having `write_file`)

### RN-761 — An installed dependency does not enter the repository: base `.gitignore`, a commit that excludes it and a gate that flags it {#rn-761}

- **Rule:** three layers, with the SAME list of directories (`node_modules`,
  `deps`, `_build`, `.venv`, `venv`, `__pycache__`, `vendor`, `target`):
  1. the repository bootstrap (the three providers and adoption) gains the step
     `commit_gitignore`, which commits a base `.gitignore` to `main` BEFORE `dev`
     is born, so every working branch inherits it. It is the single point because
     EVERY created or adopted repository goes through it, before any agent writes;
     Infra through the `module_map` would arrive after the dev's first commit and
     only in the projects that go through it. The step only CREATES the file: an
     existing `.gitignore`, even a different one, belongs to the user and does not
     enter the plan;
  2. the dev agent's commit (`git_commit`) and the commit that preserves the
     worktree on blocking ([RN-743](engine.md#rn-743)) stage everything EXCEPT
     those directories, at any depth (pathspec `:(exclude,glob)`), even without a
     `.gitignore`;
  3. the SecOps gate flags, as a finding (`changes_requested`), a directory of the
     list that appears in the PR diff, with the file count.
  The two copies of the list (api and engine) are checked by a test. Declared: a
  dependency file ALREADY tracked before this rule is not removed by the commit
  (the exclusion does not stage a removal); a project already bootstrapped only
  gets the `.gitignore` if the bootstrap runs again; in `runner` mode the commit
  runs through the same `GitExecutor` and the same exclusion holds wherever the
  engine runs git.
- **Where:** `src/application/use-cases/git/bootstrap-templates.ts:38`
  (`gitignoreContent`), `src/application/use-cases/git/bootstrap-steps.ts:164`
  (`soSeAusente`), `apps/engine/lib/engine/actions/diretorios_de_dependencia.ex:37`
  (`argumentos_do_add`), `:47` (`commitados`),
  `apps/engine/lib/engine/gates/secops_agent_server.ex:162`
  (`dependencias_commitadas`)
- **Test:** `test/application/use-cases/git/bootstrap-plan.spec.ts`
  (the empty repository plans the 3 files; the user's `.gitignore` does not enter
  the plan), `test/application/use-cases/git/provision-repository.use-case.spec.ts`
  (the local one converges the 6 steps),
  `apps/engine/test/engine/actions/git_executor_test.exs` (`commit exclui
  diretórios de dependência mesmo sem .gitignore`),
  `apps/engine/test/engine/actions/diretorios_de_dependencia_test.exs` (the list
  is the same as the api's; SecOps flags `node_modules`)
- **Origin:** AT-446 (TP-01 of 09/10: a PR with 1,453 files, 1,437 in
  `node_modules/`, approved by QA and SecOps)

### RN-762 — The block by an exhausted correction cycle records the `politica` origin {#rn-762}

- **Rule:** when the gate exhausts the correction ceiling (`maxGateCorrections`)
  and the task is blocked with "ciclo de correção esgotado (gate)", the
  `backlog.task_blocked` and the task's row carry `origin: "politica"` — the
  ceiling is a configuration decision, not a real failure (ADR 0020 vocabulary,
  RN-059 rule). Before, it came out `origin: null`. The infra artifact block for
  the same reason (`infra.artifact_blocked`) has no origin field and stays as it
  is, declared.
- **Where:** `src/application/use-cases/execution/record-gate-verdict.use-case.ts:215`
  (`politica`)
- **Test:** `test/application/use-cases/execution/record-gate-verdict.use-case.spec.ts`
  (the exhausted cycle calls `MarkTaskBlockedUseCase` with `'politica'`; the
  approved verdict does not block)
- **Origin:** AT-450 (TP-01 of 09/10: `backlog.task_blocked` with
  `origin: null`)

### RN-770 — Small things on the project screen: ADR PR author, Infra's model, the dev's PR title, the execution badge, path and table {#rn-770}

- **Rule:** (1) the ADR PR carries the agent's identity (`<agente>[bot]`, else
  `arquiteto[bot]`), like the infra one ([RN-729](#rn-729)) — the PRs tab stops
  saying "unknown author"; (2) the Infra Lead's `agent.response` carries the final
  frame's `modelName`, like the other conversational agents — the bubble stops
  saying "model not recorded"; (3) the dev agent's PR title opens with the TASK and
  then the story (`<task> — <story>`), so that three PRs of the same story do not
  look like the same one with the end cut off; (4) with execution active (the same
  predicate as [RN-769](web.md#rn-769)), the session bar says "Execution" instead
  of the recorded `kind` (`criativa`, which does not change —
  [RN-097](#rn-097)) and the composer does not offer the Creative before it is
  activated; (5) in the creation confirmation, each path segment is `nowrap`: the
  break only happens after the slash, never at the hyphen; (6) the Markdown table
  in the balloon has a floor of `12rem` PER COLUMN and grows by fraction, with the
  container at `min-content` — with `max-content` it took the width of the text
  with no break (measured in Chromium: 2,236px in a 708px balloon) and the last
  column vanished.
- **Where:** `src/application/use-cases/actions/execute-adr-pr.use-case.ts:96`
  (`openPullRequest`); `apps/engine/lib/engine/infra/infra_lead_server.ex:1599`
  (`gravar_texto_do_turno`); `apps/engine/lib/engine/dev/dev_agent_server.ex:1188`
  (`propose_pr`); `apps/web/src/lib/session-destinatario.ts:228`
  (`agentesEmConversa`) and `apps/web/src/lib/session-kind.ts:69`
  (`tipoDaSessao`); `apps/web/src/routes/NewProjectWizard.tsx:1143`
  (`quebraPorSegmento`); `apps/web/src/components/ui/MarkdownMessage.tsx:178`
  (`TabelaMarkdown`)
- **Test:** `test/application/use-cases/actions/execute-adr-pr.use-case.spec.ts`,
  `apps/engine/test/engine/infra/infra_lead_server_test.exs` ("agent.response
  carrega o nome do modelo"), `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  (happy flow), `apps/web/src/lib/session-destinatario.test.ts`,
  `apps/web/src/lib/session-kind.test.ts`, `apps/web/src/routes/NewProjectWizard.test.tsx`,
  `apps/web/src/components/ui/MarkdownMessage.test.tsx`
- **Origin:** AT-455 (TP-01 of 09/10, findings 2, 3, 8, 9, 16 and 18)

### RN-776 — An execution task waiting for someone holds the execution session {#rn-776}

- **Rule:** the heartbeat does not close the project's CURRENT execution session
  (the most recent `active` one with `execution.activated`) while there is a task
  of a non-archived story BLOCKED, with a PR in `awaiting_user`, or returned by a
  merge conflict ([RN-715](#rn-715), `backlog.task_merge_conflict` in this
  session) and still `in_progress`. It is the sixth signal of
  [RN-064](web.md#rn-064), without a ceiling, like the other signals that wait for
  a person; it comes before the idle-conversation signal ([RN-581](#rn-581)),
  which remains the only one with a ceiling. An OLD execution session of the same
  project is not held by the task: the task belongs to the project, and without
  that cut it would be immortal.
- **Where:** `src/application/use-cases/sessions/get-session-pending-work.use-case.ts:242`
  (`findPendenteDaExecucao`), `src/infrastructure/persistence/drizzle/backlog.repository.ts:252`
  (`findPendenteDaExecucao`)
- **Test:** `test/application/use-cases/sessions/get-session-pending-work.use-case.spec.ts`
  (blocked, a PR waiting for merge and a conflict hold; with nothing, it closes; an
  old execution session is not held)
- **Origin:** AT-457 (TP-01 of 09/10: both execution sessions closed 2–8 s after
  `dev.idle`, with a blocked task and a PR waiting for the merge)

### RN-777 — Unblocking the task wakes the dev of ITS module {#rn-777}

- **Rule:** `task.became_claimable` with cause `task_unblocked` carries as
  `modules` the TASK's module (`tasks.module`, [RN-678](#rn-678)) when it
  exists, and the story's only when the task has no module — the claim is by the
  task's module, so it is its dev that has to wake. A merge conflict
  already wakes the owner ([RN-715](#rn-715)); with the execution session up
  ([RN-776](#rn-776)), the owner keeps a row in `dev_agent_states` to
  be woken.
- **Where:** `src/application/use-cases/execution/unblock-task.use-case.ts:68`
  (`modules`)
- **Test:** `test/application/use-cases/execution/unblock-task.use-case.spec.ts`
  (a task with a module wakes that module's dev)
- **Origin:** AT-457

### RN-782 — Accepting the reasoning parameter is not asking for reasoning {#rn-782}

- **Rule:** revises [RN-741](#rn-741). A model with `supportsReasoning` (in
  OpenRouter, `reasoning` in `supported_parameters` — 341 of 478 models, that
  is, "accepts the parameter", not "reasons") keeps the SLACK in the ceiling:
  `max_tokens` = visible output (RN-734) + `ORCAMENTO_DE_RACIOCINIO` (4096). What
  goes away is the `reasoning: { max_tokens }` field: it is NO longer sent to
  any model. Paid measurement of 10/10 (AT-467): on
  `anthropic/claude-haiku-4.5`, which does not reason without the field, it SWITCHED ON
  reasoning in 74% of calls at 2.8× the cost; on
  `anthropic/claude-haiku-5.5` it was IGNORED (asked for 1024, spent 8192 on reasoning
  alone). The decision of what to ask for lives in a single point, `opcoesDeRaciocinio`,
  called by the three turn use cases. RN-741's TODO(humano) closes with
  that measurement.
- **Where:** `src/domain/llm/raciocinio-do-agente.ts:18`
  (`opcoesDeRaciocinio`), `src/infrastructure/llm/openai-compatible-provider.ts:640`
  (`controla`), `src/application/use-cases/llm/run-llm-turn.use-case.ts:200`
  (`opcoesDeRaciocinio`)
- **Test:** `test/infrastructure/llm/openai-compatible-provider.contract.spec.ts`
  (`modelo que raciocina: folga no teto e NENHUM campo de raciocínio (RN-782)`,
  body byte for byte), `test/domain/llm/raciocinio-do-agente.spec.ts`
- **Origin:** AT-467 (paid measurement of 10/10)

### RN-783 — The execution dev agents run with reasoning switched off {#rn-783}

- **Rule:** owner decision of 10/10. For a `dev-<modulo>` agent (the Dev Lead,
  `dev-lead`, is conversational and stays out) with a
  `supportsReasoning` model, a provider that can say "off" (today only
  OpenRouter, `campoDeRaciocinioDesligado`) sends `reasoning: { enabled: false }`,
  keeping the slack of [RN-782](#rn-782). Measured on Haiku 5.5: 0 of 8 answers
  cut and −42% cost. Conversational agents and gates do not change (no field), and a
  model without `supportsReasoning` sends nothing. It is not silent: the help of the
  model catalog's "thinking" facet says that in the execution dev agents and,
  since RN-838, in the Automação QA reasoning goes switched off (the chosen minimum; the selector and the bubble do not change).
- **Where:** `src/domain/llm/raciocinio-do-agente.ts:23`
  (`raciocinioDesligadoParaOAgente`), `src/infrastructure/llm/openrouter-provider.ts:251`
  (`campoDeRaciocinioDesligadoOpenRouter`)
- **Test:** `test/infrastructure/llm/openai-compatible-provider.contract.spec.ts`
  (`dev agent: raciocínio desligado explícito, com a folga (RN-783)`),
  `test/domain/llm/raciocinio-do-agente.spec.ts` (dev-* switches off;
  criativo and dev-lead only the slack; without `supportsReasoning`, nothing)
- **Origin:** AT-467 (owner decision of 10/10)

### RN-784 — The Architect's state reads enter Jev's floor {#rn-784}

- **Rule:** revises [RN-758](#rn-758) and [RN-772](engine.md#rn-772) (owner's
  decision). The Architect's floor gains `listar_adrs_propostas` and
  `listar_backlog`: Jev's cut never removes them, so that the Architect does not
  state ADR status or backlog tasks without being able to consult them
  ([RN-773](engine.md#rn-773)). It still holds that the floor only gives back what
  is in the step's catalog.
- **Where:** `src/domain/llm/tool-router.ts:315` (`PISO_DO_MENU`)
- **Test:** `test/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.spec.ts`
  (`Arquiteto recortado pelo Jev: as leituras de estado (ADRs propostas,
  backlog) continuam no menu (RN-784)`)
- **Origin:** AT-460 (TP-01 of 09/10: Jev removed from the Architect's menu the
  reads of AT-454)

### RN-785 — A requirement that depends on another story not yet done is an observation in the QA gate {#rn-785}

- **Rule:** besides the sibling tasks ([RN-765](engine.md#rn-765)), the cut that
  QA-strategy and QA-automation receive brings the NOT-completed tasks of the
  OTHER stories of the same module, with the story's title (`moduleOpenTasks` in
  `GET .../dev-context`). The module is the task's, else the request's, else the
  story's; an archived story stays out. A contained read (ADR 0060): at most 20,
  with the real total in `moduleOpenTasksTotal` and the cut stated in the cut. A
  requirement of the delivery that depends on what another story will still
  deliver (a route, a screen) goes to the `resumo` as an observation and does not
  fail. The yardstick is a PROMPT one, as in RN-765.
- **Where:** `src/application/use-cases/execution/get-dev-task-context.use-case.ts:210`
  (`tarefasAbertasDoModulo`), `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20`
  (`texto`)
- **Test:** `test/application/use-cases/execution/get-dev-task-context.use-case.spec.ts`
  (only the open task of the other story of the same module; archived out; ceiling
  with the real total) and `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  (the open tasks and the cut in the text). The QA golden-set did not gain a case
  (the verdict requires a paid call) — declared.
- **Origin:** AT-461 (TP-01 of 09/10, session `80e3ce09`: the task "JWT
  middleware" was failed because "there are no routes to create, list, delete links
  nor for the dashboard in the diff", routes of other stories not yet done)

### RN-786 — The QA gate reads the module's contract, and a divergence with the story is an observation {#rn-786}

- **Rule:** the cut that QA-strategy and QA-automation receive brings the CURRENT
  contract of the task's module (`artifact.module_contracts`,
  [RN-684](#rn-684)), in `moduleContract` of `GET .../dev-context`, as the source
  of the INTERFACE. The module is the task's, else the request's, else the story's
  only one; a story with more than one module and a task without a module is
  ambiguous and goes without a contract. When the story and the contract diverge
  on an interface name (route, function, event), a delivery that follows the
  contract is not failed for that: the opinion names the DIVERGENCE in the `resumo`
  (the story says X, the contract says Y), for the user and the Architect. A PROMPT
  yardstick, like [RN-765](engine.md#rn-765). Since [RN-792](engine.md#rn-792) the
  Architect checks the contract against the routes cited in the stories when
  declaring it.
- **Where:** `src/application/use-cases/execution/get-dev-task-context.use-case.ts:255`
  (`moduloDoContrato`), `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:66`

- **Where:** `src/application/use-cases/execution/get-dev-task-context.use-case.ts:255`
  (`moduloDoContrato`), `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:70`
  (`secao_do_contrato`)
- **Test:** `test/application/use-cases/execution/get-dev-task-context.use-case.spec.ts`
  (the contract of the story's module; without a contract or with an ambiguous
  module, `null`) and
  `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs` (the contract section
  with the divergence yardstick; without a contract, no section)
- **Origin:** AT-462 (TP-01 of 09/10, session `80e3ce09`: the story asked for
  `GET /painel`, the contract declared `GET /panel`, the dev followed the contract
  and QA failed it by the story)

### RN-802 — A estimativa do plano do Dev Lead soma o dobro da primeira tarefa de cada módulo {#rn-802}

O cartão de aprovação do `propose_execution_plan` (RN-709) dizia "até N × teto",
ignorando que a primeira tarefa de cada módulo tem o dobro do teto (RN-774).
Agora a api leva no payload, ao lado de `orcamentoPorTarefaMicros`, o
`multiplicadorDaPrimeiraDoModulo`, e a frase soma o teto EFETIVO:
(tarefas − módulos com tarefa) × teto + módulos com tarefa × multiplicador ×
teto, dizendo "a primeira de cada módulo vale o dobro". Com 8 tarefas num
módulo e teto de US$ 0,50: até US$ 4,50. É limite superior: a primeira de um
módulo que já teve tarefa reivindicada não ganha o dobro, e a frase continua
dizendo "até". Sem o multiplicador no payload (proposta antiga), a conta antiga.

O multiplicador é APLICADO só no engine (`Engine.Dev.TetoDaTarefa`); a api tem
um espelho declarado, porque a tela não deve copiar a constante e o engine não
é consultado na proposta. Mudar um exige mudar o outro.

- **Onde:** `src/application/use-cases/execution/activate-execution.use-case.ts:83` (`MULTIPLICADOR_DA_PRIMEIRA_TAREFA_DO_MODULO`);
  `src/application/use-cases/actions/propose-action.use-case.ts:242` (`multiplicadorDaPrimeiraDoModulo`);
  `apps/web/src/lib/aprovacoes.ts:350` (`multiplicador`)
- **Teste:** `apps/web/src/lib/aprovacoes.test.ts` (it "RN-802 (AT-473)": 8 tarefas, 1 módulo → US$ 4,50; 3 tarefas, 2 módulos → US$ 2,50; sem orçamento, sem número — caso de falha);
  `test/application/use-cases/actions/propose-action.use-case.spec.ts` ("plano válido nasce pending")
- **Origem:** AT-473

### RN-809 — The Arquiteto's module and image obligations enter the Jev's floor {#rn-809}

- **Rule:** extends [RN-758](#rn-758) and [RN-784](#rn-784). The
  Arquiteto's floor gains `assign_story_modules` and `choose_project_image`, steps 2 and
  3 of its kickoff (`arquiteto_server.ex`): the Jev's cut never removes them, and the
  Arquiteto does not end saying the tool "não está disponível nesta
  etapa" with stories without a module and an undecided image. `emit_insight` (step
  8, tension record) and `emit_artifact` stay out of the floor: they are not
  obligations of the stage. It still holds that the floor only gives back what is in the
  step's catalog.
- **Where:** `src/domain/llm/tool-router.ts:315` (`PISO_DO_MENU`)
- **Test:** `test/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.spec.ts`
  (`Arquiteto recortado pelo Jev sem assign_story_modules/choose_project_image:
  as duas continuam no menu (RN-809)`)
- **Origin:** AT-481 (TP-01: the cut left 7 of 11 tools and the
  Arquiteto did not distribute the stories by module)

### RN-812 — An open PR from the same branch is reused, never duplicated {#rn-812}

- **Rule:** before opening the PR of a `pr_open`, the executor asks the
  provider (`listPullRequests`, only the open ones) whether there is already an OPEN PR with the same
  source and the same target. If there is, it is reused: the action closes
  `executed` with its URL and id and `reaproveitada: true`, without opening another —
  the task's push already updated it. In real use the task reopened after a
  block opened pr-9 from the same branch with pr-8 open, and the PRs tab showed
  both. A provider without the listing, or a listing that fails, does not prevent opening: the
  usual path goes on. The PR of the branch that [RN-797](engine.md#rn-797)
  closes as "already in dev" stays as it was: that one is not closed on the provider.
- **Where:** `src/application/use-cases/actions/execute-git-action.use-case.ts:32`
  (`prAbertaDaBranch`), `src/application/use-cases/actions/execute-git-action.use-case.ts:204`
  (`prAbertaDaBranch`)
- **Test:** `test/application/use-cases/actions/execute-git-action.use-case.spec.ts`
  ("pr_open com PR aberta da mesma branch → reaproveita, sem abrir outra";
  "pr_open: listar PRs falha → abre a PR como sempre")
- **Origin:** AT-485 (TP-01 of 10/10)

### RN-827 — The context panel counts the whole session, and the window only gives the detail {#rn-827}

- **Rule:** the NUMBERS of the "Contexto da sessão" panel — business rules,
  recorded decisions and artifacts per agent — come from an aggregate of the WHOLE
  session counted on the server (`GET .../sessions/:sessionId/context-summary`,
  `viewer`, a read without a new table), ADDED to the window of events the screen already
  loaded in the mold of [RN-568](web.md#rn-568): the counts are monotonic, so
  the greater of the two holds. The DETAIL (the rule's card, the decision, the
  backlog tree) is still the window's, and the cut notice ("Mostrando N de
  M") only appears in the section whose detail is partial; an agent whose artifacts
  were all before the window gets the group with the total. An ABSENT aggregate
  (loading or failed) is "I did not read": the panel falls back to the declared cut of
  [RN-180](web.md#rn-180)/[RN-701](web.md#rn-701), and an empty "Arquivos tocados" says it did not
  read, never "Nada ainda". The aggregate does NOT poll ([RN-579](engine.md#rn-579),
  [RN-632](web.md#rn-632)): it is reread when the window sees a new artifact or a new
  commit/PR action (the query's key), on focus and on remount.
- **Where:** `src/infrastructure/persistence/drizzle/session-context-summary.repository.ts:22`
  (`resumir`), `apps/web/src/lib/contexto-da-sessao.ts:15`
  (`useContextoDaSessaoInteira`), `apps/web/src/lib/contexto-da-sessao.ts:34`
  (`totalDaSessao`), `apps/web/src/routes/ContextAside.tsx:174` (`resumo`)
- **Test:** `test/infrastructure/persistence/drizzle/session-context-summary.repository.spec.ts`
  ("conta a sessão INTEIRA, além de qualquer cauda de 200…"),
  `test/application/use-cases/sessions/get-session-context-summary.use-case.spec.ts`
  (failure: "sessão de outro projeto é 404 e não lê nada"),
  `apps/web/src/routes/ContextAside.sessao-inteira.test.tsx` ("com o agregado
  maior que a janela, mostra o total da sessão…"; failure: "sem o agregado, os
  arquivos dizem \"não li\"…")
- **Origin:** AT-498 (TP-01 of 10/10: a 301-event session showed 0 rules
  out of 11 and 2 decisions out of 6)

### RN-828 — "Arquivos tocados" includes the linked execution session, with a ceiling and the real total {#rn-828}

- **Rule:** the aggregate's list of touched files ([RN-827](#rn-827)) joins
  the `git_commit`/`git_push` of the requested session and of the EXECUTION session linked to
  it — the one the Dev Lead's plan approved IN THIS session activated
  (`executionResult.sessaoDeExecucao` of an executed `propose_execution_plan`),
  of the same project. A session without that link does not enter. The list goes from the most
  recent to the oldest, cut at 100 (`TETO_DE_ARQUIVOS_TOCADOS`), and the
  `total` states the real number; the screen declares the cut when it cuts.
- **Where:** `src/infrastructure/persistence/drizzle/session-context-summary.repository.ts:31`
  (`ligadas`), `apps/web/src/routes/ContextAside.tsx:366` (`filesTouched`)
- **Test:** `test/infrastructure/persistence/drizzle/session-context-summary.repository.spec.ts`
  ("…e soma os arquivos da execução ligada"; failure: "corta a lista de arquivos
  no teto e devolve o total real; não lê sessão sem ligação")
- **Origin:** AT-498

### RN-838 — The Automação QA runs with reasoning switched off {#rn-838}

- **Rule:** extends [RN-783](#rn-783) (owner decision of 10/10). The
  `qa-automacao` gate now gets the same treatment as the execution dev agents:
  with a `supportsReasoning` model, a provider that can say "off"
  sends `reasoning: { enabled: false }`, keeping the slack of
  [RN-782](#rn-782). QA-strategy (`qa-estrategia`) and the other gates do not
  change. The measurement that motivated it: the gates' reasoning rose from 44 thousand to 211
  thousand tokens per round, and their cost from US$ 0.15 to US$ 0.55.
- **Where:** `src/domain/llm/raciocinio-do-agente.ts:39`
  (`raciocinioDesligadoParaOAgente`)
- **Test:** `test/domain/llm/raciocinio-do-agente.spec.ts`
  (`QA de Automação desliga; QA-estratégia e outros gates não (RN-838)`;
  `falha: QA de Automação com modelo sem supportsReasoning não manda nada`)
- **Origin:** AT-504 (owner decision of 10/10)

### RN-839 — `report_done` and `report_blocked` enter the dev agents' Jev floor {#rn-839}

- **Rule:** revises [RN-758](#rn-758)/[RN-759](#rn-759) (owner decision of
  10/10). The execution dev agents (`dev-<modulo>`, never `dev-lead`)
  stop being without a floor ONLY for the two task outcome tools:
  the Jev's cut never removes `report_done` nor `report_blocked`. The rest of
  their step stays cuttable, with RN-759's cut notice. Like every
  floor, it only gives back what is in the step's catalog.
- **Where:** `src/domain/llm/tool-router.ts:356` (`pisoDoMenu`)
- **Test:** `test/domain/llm/piso-dos-dev-agents.spec.ts`
  (`recorte que deixa só \`terminal\` para dev-api: report_done e
  report_blocked continuam`; `falha: dev-lead e outro agente não ganham as
  ferramentas de desfecho`)
- **Origin:** AT-499 (follow-up, owner decision of 10/10)

### RN-840 — each gate agent's verdict tool enters the Jev's floor {#rn-840}

- **Rule:** extends [RN-758](#rn-758) and [RN-839](#rn-839) to the
  GATE agents. The Jev's cut never removes from each one its VERDICT tool, and
  only its own: `qa-automacao` → `emit_qa_verdict`, `qa-performance-seguranca` →
  `emit_perf_seguranca_verdict`, `qa-estrategia` → `emit_plano_de_teste`,
  `appsec` → `emit_threat_model`. Without it the gate ran the suite and stopped without a
  verdict, with the delegation failing with origin `modelo` and the ready task
  blocked. An agent outside the gates gets no verdict tool, and the floor
  only gives back what is in the step's catalog.
- **Where:** `src/domain/llm/tool-router.ts:315` (`PISO_DO_MENU`)
- **Test:** `test/domain/llm/tool-router-piso-dos-gates.spec.ts`
  (ids and tools checked against the engine's `.ex`; a cut that leaves
  only `terminal`/`read_file` ends with the verdict; failure: `criativo`,
  `dev-api` and `dev-lead` get no verdict tool; the floor does not
  add a tool outside the catalog)
- **Origin:** AT-509 (TP-01, 12th run)

### RN-844 — The context panel lists the rules, the decisions and the PR files of the whole session {#rn-844}

- **Rule:** an extension of [RN-827](#rn-827) and [RN-828](#rn-828). The aggregate
  `GET .../sessions/:sessionId/context-summary` returns, besides the numbers, the
  ITEMS: the session's business rules (`itensDeRegras`: title, description and how
  many origins it cites) and recorded decisions (`itensDeDecisoes`: choice and
  context), most recent first, up to 50 of each (`TETO_DE_ITENS_DO_CONTEXTO`); the
  total stays in `regras`/`decisoes`. With the aggregate, the panel lists these
  items instead of the window of 200 events — a rule that fell before the window
  still shows up — and the cut says "Showing the N most recent of M". "Files
  touched" now includes the files of the PRs (executed
  `pr_open`/`open_adr_pr`/`open_infra_pr`, with `pullRequestId`) of the session and
  of the linked execution session, read from the SAME diff as the PRs tab
  (`ReadProjectCodeUseCase.pullRequestDiff`), before the commit-payload files, at
  the ceiling of 100 with the real total. A contained read
  ([ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md)): no free parameter, at
  most 20 diffs per call (`TETO_DE_PRS_LIDAS`); a PR beyond the ceiling or whose
  diff failed enters `prsNaoLidas`, and the screen says how many were left out. With
  the aggregate and nothing to list, the empty state says what did not happen (no
  file in a PR or commit of this session or the linked execution), never "Nothing
  yet". The use case lives in the git module because it is the one that reads the
  repository; a session of another project is still 404 without reading any PR.
- **Where:** `src/infrastructure/persistence/drizzle/session-context-summary.repository.ts:140`
  (`itensDeRegras`), `src/infrastructure/persistence/drizzle/session-context-summary.repository.ts:184`
  (`prsDasSessoes`), `src/application/use-cases/git/resumir-contexto-da-sessao.use-case.ts:37`
  (`prs`), `apps/web/src/routes/ContextAside.tsx:197` (`businessRules`),
  `apps/web/src/routes/ContextAside.tsx:222` (`decisoes`)
- **Test:** `test/infrastructure/persistence/drizzle/session-context-summary.repository.spec.ts`
  ("RN-844: devolve os ITENS de regra e decisão fora de qualquer cauda, com
  teto de 50"; "RN-844: lista as PRs executadas da sessão e da execução
  ligada…"), `test/application/use-cases/git/resumir-contexto-da-sessao.use-case.spec.ts`
  ("lê os arquivos das PRs das sessões lidas…"; failures: "corta no teto de
  arquivos, conta PR fora do teto e diff que falhou em prsNaoLidas" and "sessão
  de outro projeto é 404 e não lê PR nenhuma"),
  `apps/web/src/routes/ContextAside.sessao-inteira.test.tsx` ("…lista os itens
  do servidor (RN-844)"; "agregado sem arquivo diz O QUE não houve…")
- **Origin:** AT-513 (TP-01 of 11/10: 9 rules without a list, "showing 1 of 4"
  decisions and "Files touched: Nothing yet" with 12 merged PRs)

### RN-847 — A merged PR keeps stating the files it changed {#rn-847}

- **Rule:** extension of [RN-844](#rn-844). In the LOCAL git provider, the diff of
  a PR was `target...source` also after the merge — and then the merge base is the
  source's own tip, so the merged PR returned ZERO files (measured
  in a test: `[]` for fast-forward and for a merge commit), and the
  "Contexto da sessão" panel said "Nenhum arquivo nas PRs" with 14 merged PRs,
  with nothing in `prsNaoLidas` (the diff did not fail, it came empty). Now the merge
  records in the PR's store the merge base and the source tip at the moment of the merge
  (`mergedBaseSha`/`mergedHeadSha`), and the merged PR's diff is
  `mergedBaseSha...mergedHeadSha`. A PR merged before those fields falls back to the
  target's merge commit (first parent) whose second parent is the source tip;
  one merged by fast-forward without the fields cannot be reconstructed and
  stays empty (declared gap). GitHub and GitLab already return the merged PR's
  diff through the platform itself. On screen, the context summary is reread
  on the SAME triggers that reread the PR list ([RN-841](web.md#rn-841)): the channel's
  `prs` target (with its 2 s window, no extra fetch) and the change of the
  backlog signature, by prefix `['session-context-summary', projectId]`.
- **Where:** `src/infrastructure/git/local-git-provider.ts:374`
  (`mergedBaseSha`), `src/infrastructure/git/local-git-provider.ts:862`
  (`rangeDoDiff`), `apps/web/src/lib/canal-vivo.ts:221` (`prs`),
  `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:105` (`invalidateQueries`)
- **Test:** `test/infrastructure/git/local-git-provider.contract.spec.ts`
  ("PR mergeada por fast-forward devolve os arquivos que mudou"; "PR mergeada
  por commit de merge devolve só os arquivos dela"; "PR mergeada antes de os
  SHAs serem gravados acha o commit de merge"),
  `apps/web/src/lib/contexto-da-sessao.test.tsx` ("o merge que chega pelo canal
  relê o resumo"; "CASO DE FALHA: evento que não mexe em PR não relê o
  resumo"), `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx`
  ("RN-841: a tarefa que entra em awaiting_user relê as PRs…"). The read failure
  adding to `prsNaoLidas` stays covered by
  `test/application/use-cases/git/resumir-contexto-da-sessao.use-case.spec.ts`
  ("corta no teto de arquivos, conta PR fora do teto e diff que falhou em
  prsNaoLidas").
- **Origin:** AT-518 (TP-01, 13th: "Nenhum arquivo nas PRs nem nos commits"
  with 14 merged PRs, and the tab not rereading the summary)

### RN-848 — The effect of an action executed inside an internal request notifies the session channel {#rn-848}

- **Rule:** extension of [RN-579](engine.md#rn-579) (AT-157). The api does not notify the channel
  of a write that came from the engine (`/internal/*`), because its facade notifies the
  event IT asked to record. What the api records on its own as the
  EFFECT of an auto-approved action executed inside that request
  (`infra.pr_opened`, `adr.pr_opened`, `action.*`) no facade notifies, and
  now it is notified: `ProposeActionUseCase` executes the action under the mark
  `runComoEfeitoDeAcao`, and the notifier only stays silent with engine origin WITHOUT that
  mark. The event the engine asked for (including `proposed_action.created`)
  stays without a notice from the api, so it does not go out twice.
- **Where:** `src/application/efeito-de-acao.ts:18` (`ehEfeitoDeAcao`),
  `src/application/use-cases/actions/propose-action.use-case.ts:319`
  (`runComoEfeitoDeAcao`),
  `src/infrastructure/http-clients/session-channel-notifier.ts:73`
  (`ehEfeitoDeAcao`)
- **Test:** `test/application/use-cases/sessions/aviso-ao-canal-da-sessao.spec.ts`
  ("AT-516: efeito de ação executada dentro de /internal avisa o canal, uma
  vez"; failure/regression: "escrita vinda do engine (/internal) não é avisada de
  novo pela api")
- **Origin:** AT-516 (the auto-approved infra PR only entered the chat's "PRs prontas"
  ~5 min later, through the fallback poll)

### RN-852 — The infra PR declares how to run the deliverable, and that becomes an artifact {#rn-852}

- **Rule:** `open_infra_pr` REQUIRES `run` = `{command, urls, envExample}`
  (ADR 0213): `command` non-empty text up to 300 characters; `urls` from 1 to 5
  items `{label (up to 60), url, kind}`, with `url` starting with
  `http://localhost:` or `http://127.0.0.1:` and `kind` ∈ `api_docs` | `web`;
  boolean `envExample`. The api refuses on PROPOSAL with 400 `run_invalido`
  (text that goes back to the Infra Lead) and revalidates on EXECUTION, which fails named
  without committing. With the PR opened (or fixed), the api emits
  `artifact.run_instructions` `{command, urls, envExample, prUrl, version}` —
  versioned, without a table, the highest `version` is the current one (the design of
  `artifact.project_image`), and projected into `docs/` like the other
  versioned ones. `GET /projects/:projectId/run-instructions` (`viewer`) returns
  the current one (`+ version, eventId, declaredAt`) or `null`. It is DECLARED by the
  Infra, never verified on the reader's machine (RN-468). And the Infra's
  context (`/internal/.../infra-context`) now carries `projectImage`, the
  current image, network and resources decision, `null` without a decision.
- **Where:** `src/domain/infra/run-instructions.ts:77` (`recusaDoRun`),
  `src/application/use-cases/actions/propose-action.use-case.ts:155`
  (`recusaDoRun`),
  `src/application/use-cases/actions/execute-infra-pr.use-case.ts:111`
  (`recusaDoRun`), `:328` (`EVENTO_INSTRUCOES_DE_EXECUCAO`),
  `src/application/use-cases/execution/get-run-instructions.use-case.ts:26`
  (`execute`),
  `src/application/use-cases/execution/get-infra-context.use-case.ts:89`
  (`projectImage`)
- **Test:** `test/application/use-cases/actions/propose-action.use-case.spec.ts`
  ("sem `run`: 400 `run_invalido`, sem proposta"; "URL fora de localhost: 400
  nomeando o campo"; "`run` válido: a proposta nasce"),
  `test/application/use-cases/actions/execute-infra-pr.use-case.spec.ts`
  ("PR aberta emite artifact.run_instructions com prUrl e versão seguinte";
  failure: "`run` inválido na execução falha sem commitar nem emitir"),
  `test/application/use-cases/execution/get-run-instructions.use-case.spec.ts`
  ("devolve o vigente — o de maior version"; "null sem artefato, e o de outro
  projeto não vaza"),
  `test/application/use-cases/execution/get-infra-context.use-case.spec.ts`
  ("RN-852: projectImage é a decisão vigente…"; "…null sem decisão de imagem")
- **Origin:** AT-517 (the TP-01 deliverable did not say how to run it on the
  user's machine)

### RN-856 — Unblocking does not close the execution, and the orphan in-progress task has a way back {#rn-856}

- **Rule:** three halves of a single defect (TP-01 measured 1 s between
  "Desbloquear" and the dev's claim, and the heartbeat closed the session in it). (1) The
  sixth signal of [RN-064](web.md#rn-064) ([RN-776](#rn-776))
  also counts, in the current execution session, a `todo` task of a
  `ready` story whose module belongs to a dev agent of THIS execution (an actor of a `dev.*` event
  in the session) and an `in_progress` task assigned to one of them — without a ceiling, like the
  others. (2) The claim resumes, BEFORE the `todo` queue, the `in_progress` task that
  already belongs to the agent (same `assigned_to`, outside a gate, not blocked); its
  branch, if it exists and is not merged, is the worktree's starting point
  (the `WorktreeManager`'s resumption). (3) Closing the execution session
  ([RN-763](engine.md#rn-763)) also blocks an `in_progress` task owned by a `dev-*`
  that no `dev_agent_states` row holds, with the same reason and origin
  `politica`; the list only comes for an EXECUTION session, so closing a
  consultative one of the same project blocks nothing.
- **Where:** `src/infrastructure/persistence/drizzle/backlog.repository.ts:252`
  (`findPendenteDaExecucao`), `:403` (`claimNext`), `:221` (`listEmCursoDeDev`),
  `src/application/use-cases/sessions/get-session-pending-work.use-case.ts:49`
  (`em_curso_de_dev`),
  `apps/engine/lib/engine/dev/encerramento_da_sessao.ex:133` (`bloquear_orfas`)
- **Test:** `test/application/use-cases/sessions/get-session-pending-work.use-case.spec.ts`
  ("tarefa recém-desbloqueada (todo) do módulo de um dev da execução segura a
  sessão"; "tarefa todo de módulo SEM dev na execução não segura"; "tarefa
  in_progress atribuída a dev da execução segura a sessão"; "listEmCursoDeDev
  lista a in_progress de dev só para sessão de EXECUÇÃO"),
  `test/application/use-cases/execution/claim-next-task.use-case.spec.ts`
  ("retoma a in_progress que já é DELE antes da fila todo"; "não retoma a
  in_progress dele que está em gate"),
  `apps/engine/test/engine/dev/encerramento_da_sessao_test.exs` ("bloqueia a
  task em curso ÓRFÃ…"; "sem nenhuma linha, a órfã também é bloqueada…")
- **Origin:** AT-522 (TP-01, 14th: session `538a0ba5` closed 1 s after the
  unblock, an `in_progress` task stuck on `dev-api` without a process)

### RN-857 — The dev agent's correction step has write and terminal in the Jev's cut {#rn-857}

- **Rule:** when the Jev's cut (RN-625) decides the menu of an execution dev agent
  (`dev-<modulo>`, never `dev-lead`) and the LAST `user`
  message of the step is the correction verdict the engine assembles — a gate asking for
  correction ("pediu correção nesta PR") or a merge refused due to conflict (RN-715)
  —, the menu gains `write_file` and `terminal` besides the outcome floor
  (RN-839). The criterion is the text the api already receives, without a new field; the
  fixed floor of every step does not widen (RN-759), another agent does not gain it, and the floor only
  adds what is in the step's catalog (P3).
- **Where:** `src/domain/llm/tool-router.ts:373` (`PISO_DA_CORRECAO_DO_DEV`),
  `:384` (`ehPassoDeCorrecao`), `:397` (`menuComPiso`),
  `src/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.ts:248` (`menuComPiso`)
- **Test:** `test/domain/llm/tool-router-correcao-do-dev.spec.ts`
  ("dev agent em correção recebe write_file e terminal"; "passo comum de
  leitura do dev não alarga"; "outro agente com a mesma mensagem não ganha";
  "as marcas existem no texto que o engine monta")
- **Origin:** AT-523

### RN-858 — An agent's open question is a durable record, and only the session author answers it {#rn-858}

- **Rule:** the doubt an agent leaves for the user becomes the
  `artifact.open_question` event (append-only, in the log of the session where it is born) with
  `{questionId (uuid), pergunta (até 500), sugestao (até 300, opcional),
  afeta: {regras, historias, tarefas}, autor, sessionId}` — the events funnel
  refuses with 400 a payload outside that shape, whether it comes from the engine or the
  api. It closes with `open_question.answered` `{questionId, resposta,
  aceitouSugestao, decisionEventId, respondidaPor}`; the STATUS comes from the log
  (open = without `answered`), never from a table. `GET
  /projects/:projectId/open-questions?status=open|answered|all` (`viewer`,
  default `open`) lists the most recent first, with a ceiling of 50 and the `total`
  (RN-180), and states in `autorDaSessao` who can answer. `POST
  .../open-questions/:questionId/answer` with `{resposta}` or
  `{aceitarSugestao: true}` is only accepted from the AUTHOR of the originating session (403
  `so_o_autor_da_sessao`); already answered is 409 `pergunta_ja_respondida`,
  a question from another project is 404 and an empty answer (or a suggestion that does not
  exist) is 400. Answering records, in one transaction, an `artifact.decision_record`
  with the user as actor (`context` = the question, `choice` = the answer,
  `consequences` = what it affects, plus `questionId` and `afeta`) and the
  `open_question.answered`, notifies the session channel (through the funnel, RN-579) and asks
  the engine to resume the PARKED QA gate of each affected task
  (the RN-724 path) — best effort: a gate that was not parked or an
  engine that is down does not undo the answer. ADR 0214.
- **Where:** `src/domain/open-questions/pergunta-em-aberto.ts:44`
  (`validarPerguntaEmAberto`), `:112` (`respostaEscolhida`),
  `src/application/use-cases/sessions/append-session-event.use-case.ts:101`
  (`EVENTO_PERGUNTA_EM_ABERTO`),
  `src/application/use-cases/backlog/perguntas-em-aberto.use-case.ts:72`
  (`listar`), `:106` (`responder`), `:273` (`resumeParkedGate`),
  `src/interfaces/http/backlog/open-questions.controller.ts:51`
  (`list`), `:81` (`answer`)
- **Test:** `test/application/use-cases/backlog/perguntas-em-aberto.use-case.spec.ts`
  ("o autor responde: decision_record (ator usuário, com questionId) e
  answered, e o gate é religado"; "aceitar a sugestão grava a sugestão como
  escolha"; failures: "quem não é o autor da sessão recebe 403
  so_o_autor_da_sessao, sem escrever"; "já respondida é 409
  pergunta_ja_respondida"; "pergunta de outro projeto é 404"; "o funil de
  eventos recusa com 400 antes de qualquer escrita")
- **Origin:** AT-521 (TP-01: four questions from the Criativo vanished from the field of
  view and the flow went on without answers)

### RN-859 — The user's decision reaches whoever works, and unlocks correcting the `ready` story {#rn-859}

- **Rule:** `GET /internal/sessions/:sessionId/dev-context` returns
  `decisoes`: the project's `artifact.decision_record`s whose `afeta` touches the
  task, its story or a rule the story cites — most recent
  first, at most 10, with the question and the decision cut at 1,500
  characters each (`{id, questionId, pergunta, decisao, decididaEm}`).
  A decision without `afeta` does not enter. They win over RF/DoR when they conflict (the
  dev's kickoff and the QA cut show them — engine). And the story correction
  yardstick (RN-727, `recusaDeCorrecaoDeHistoria`) is revised
  (ADR 0214, over ADR 0212): a `ready` story is also correctable when the
  request cites a `questionId` the user HAS ALREADY answered — an open or
  nonexistent question unlocks nothing, and the `in_progress`/`in_review` task lock
  still applies. Both PO doors accept the `questionId`: `update_story`
  (title/description, the event carries it) and `complete_story` (RF/DoD/DoR; the
  story stays `ready`, without a new promotion, and `backlog.story_completed` carries
  the `questionId`).
- **Where:** `src/application/use-cases/execution/get-dev-task-context.use-case.ts:122`
  (`decisoesDaTarefa`), `:374` (`decisoesDoContexto`),
  `src/domain/backlog/correcao-de-historia.ts:33`
  (`recusaDeCorrecaoDeHistoria`),
  `src/application/use-cases/backlog/corrigir-historia.use-case.ts:126`
  (`respostaDoUsuario`),
  `src/application/use-cases/backlog/complete-story.use-case.ts:82`
  (`corrigindoReady`)
- **Test:** `test/application/use-cases/execution/get-dev-task-context.use-case.spec.ts`
  ("devolve só as que afetam a tarefa, a história ou uma regra dela, mais
  recentes primeiro"; "decisão sem afeta não entra; teto de 10 e texto cortado
  em 1 500"),
  `test/application/use-cases/backlog/corrigir-historia.use-case.spec.ts`
  ("história ready citando pergunta RESPONDIDA é corrigida, e o evento a
  cita"; failures: "história ready citando pergunta AINDA ABERTA segue
  recusada"; "história ready com tarefa em revisão segue recusada mesmo com a
  resposta"),
  `test/application/use-cases/backlog/complete-story.use-case.spec.ts`
  ("história ready com pergunta respondida tem RF/DoR corrigidos e segue
  ready"; "história ready com pergunta ainda aberta é recusada")
- **Origin:** AT-521 (QA failed three times reading the DoR of a `ready`
  story nobody could correct, after the user had already decided)

### RN-860 — The QA gate waits for the user without spending the correction cycle {#rn-860}

- **Rule:** the gate verdict (`POST /internal/sessions/:sessionId/gates/verdict`)
  accepts the verdict `needs_user_decision`, only from the `qa` gate, with `pergunta`
  (up to 500) and `sugestao` (up to 300) or an `openQuestionId` that already exists — without
  either it is 400. The state machine keeps the SAME gate and does NOT
  increment the correction counter, not even at the ceiling, so the cycle does not reach the
  `politica` block of RN-762. Without `openQuestionId`, the api records the
  `artifact.open_question` (actor and author `qa-agent`, in the execution session,
  affecting the task and its story), the `pr.gate_changed` goes out with
  `esperandoUsuario: true` and the `openQuestionId` (it is through it that the screen shows
  the task as "waiting for you"), and the response returns `nextAction:
  "await_user"` with the `openQuestionId` — the engine parks the cycle (ADR 0207)
  and the answer to the question restarts it (RN-858). No outbox row is born
  in that outcome. ADR 0214.
- **Where:** `src/domain/execution/pr-gate-state-machine.ts:63`
  (`nextGateStatus`),
  `src/application/use-cases/execution/record-gate-verdict.use-case.ts:135`
  (`esperaUsuario`), `:171` (`nextAction`)
- **Test:** `test/domain/execution/pr-gate-state-machine.spec.ts`
  ("needs_user_decision mantém o gate e NÃO incrementa o contador, nem no
  teto"),
  `test/application/use-cases/execution/record-gate-verdict.use-case.spec.ts`
  ("needs_user_decision no teto: grava a pergunta, não conta correção, não
  bloqueia"; failure: "needs_user_decision sem pergunta nem openQuestionId é
  recusado")
- **Origin:** AT-521 (the Automação QA failed four times "not confirmed
  by the user" until the cycle ran out)

### RN-870 — The verdict only waits for a question that exists and is open {#rn-870}

- **Rule:** `POST /internal/sessions/:sessionId/gates/verdict` with
  `needs_user_decision` and `openQuestionId` checks, BEFORE any write
  (comment on the PR, gate state, event), that the question exists in the project
  and is open. Nonexistent or from another project: 404
  `reason: "pergunta_nao_encontrada"`. Already answered: 409
  `reason: "pergunta_ja_respondida"` with the user's decision in `decisao` —
  without a write and without `pr.gate_changed`. The state comes from the log (RN-858).
- **Where:** `src/application/use-cases/execution/record-gate-verdict.use-case.ts:85`
  (`exigirPerguntaAberta`), `src/domain/open-questions/pergunta-em-aberto.ts:154`
  (`estadoDaPergunta`)
- **Test:** `test/application/use-cases/execution/record-gate-verdict.use-case.spec.ts`
  ("pergunta aberta: estaciona sem gravar outra"; failure: "inexistente ou de
  outro projeto: 404 nomeado, sem escrita", "já respondida: 409 com a decisão,
  sem escrita nem pr.gate_changed")
- **Origin:** AT-526, ADR 0215

### RN-871 — `afeta.regras` accepts the rule's exact title and stores the id {#rn-871}

- **Rule:** in the events funnel, an `artifact.open_question` whose
  `afeta.regras` carries the exact TITLE of a project `artifact.business_rule`
  is recorded with the rule's id (the most recent, if the title repeats); whatever
  is neither an id nor an exact title is refused with 400 naming the values. In the
  dev's context, `decisoes` also matches by the titles of the story's rules, for the
  decisions recorded before this rule.
- **Where:** `src/domain/open-questions/pergunta-em-aberto.ts:179`
  (`resolverRegrasDoAfeta`), `src/application/use-cases/sessions/append-session-event.use-case.ts:117`
  (`resolverRegrasDoAfeta`), `src/application/use-cases/execution/get-dev-task-context.use-case.ts:134`
  (`decisoesDoContexto`)
- **Test:** `test/application/use-cases/backlog/perguntas-em-aberto.use-case.spec.ts`
  ("título exato é convertido para o id da regra"; failure: "texto que não é id
  nem título de regra: 400 sem escrita"),
  `test/application/use-cases/execution/get-dev-task-context.use-case.spec.ts`
  ("decisão legada com TÍTULO de regra em afeta.regras casa pelo título")
- **Origin:** AT-526, ADR 0215

### RN-872 — The project's other decisions reach the dev and QA, in their own section {#rn-872}

- **Rule:** `GET /internal/sessions/:sessionId/dev-context` returns, besides
  `decisoes` (those touching the task, RN-859), `decisoesDoProjeto`: the other
  `artifact.decision_record`s of the project, most recent first, in the same
  format. The ceiling of 10 is SHARED — the task's come first and consume
  the ceiling before. It revises ADR 0214's sentence "a decision without `afeta` does not enter" for
  this list. The field is additive (an engine that does not know it ignores it).
- **Where:** `src/application/use-cases/execution/get-dev-task-context.use-case.ts:134`
  (`decisoesDoContexto`), `src/interfaces/http/internal/dto/internal.response.dto.ts:237`
  (`decisoesDoProjeto`)
- **Test:** `test/application/use-cases/execution/get-dev-task-context.use-case.spec.ts`
  ("as que não tocam a tarefa vêm em decisoesDoProjeto; teto de 10 somado, as
  da tarefa primeiro")
- **Origin:** AT-526, ADR 0215

### RN-886 — OpenRouter's budget 403 is exhausted credit, with limit, spend and reset {#rn-886}

- **Rule:** OpenRouter's 403 with `Budget limit exceeded` /
  `limit_source: openrouter_guardrail_budget` (the key's monthly guardrail) is NOT
  a rejected credential: the api normalizes it into the SAME `insufficient_credit` as the
  402 (RN-730) — without a new code in the contract — and the rest of the credit path
  applies the same: origin `infra` (RN-726), a pause without automatic resumption (never
  transient, RN-864). The short sentence, in the turn's language (RN-733), states the
  limit, the spend and the reset read from the body (`limit_usd`, `spend_usd`,
  `resets_at`, whatever comes) and asks the OpenRouter admin to raise the
  budget; the dev blocks the task with that sentence in the reason, instead of
  "parou sem concluir nem reportar bloqueio" with origin `codigo`. A 403 without the
  marker stays `auth`.
- **Where:** `src/domain/llm/llm-provider-errors.ts:86` (`normalizeHttpStatus`),
  `:140` (`pareceOrcamento`); `apps/engine/lib/engine/agents/falha_de_turno.ex:212`
  (`orcamento_esgotado`), `:226` (`frase_de_orcamento`), `:163`
  (`credito_esgotado?`); `apps/engine/lib/engine/dev/dev_agent_server.ex:957`
  (`motivo_de_credito`)
- **Test:** `test/domain/llm/llm-provider-errors.spec.ts` ("o 403 de
  orçamento vira insufficient_credit com o corpo inteiro"; failure: "403 sem
  marcador de orçamento continua credencial rejeitada");
  `apps/engine/test/engine/agents/falha_de_turno_test.exs` ("RN-886: o 403 de
  orçamento do OpenRouter")
- **Origin:** AT-534

### RN-891 — The interface has four languages, with pt-BR as default and fallback {#rn-891}

- **Rule:** the interface language (`users.locale`) accepts `pt-BR`, `en`, `ru`
  and `zh-Hans`, and refuses any other; the account default stays `pt-BR`.
  In the web, `pt-BR` is the default and the `fallbackLng` (revises RN-432, which made
  `en` the web default). The choice recorded in the account always wins; without it, the
  browser suggests: `pt*` → `pt-BR`; `zh`, `zh-CN`, `zh-SG`, `zh-Hans*` →
  `zh-Hans`; `ru*` → `ru`; `en*` → `en`; the rest (German, traditional
  Chinese…) → `pt-BR`. A locale without a catalog in `locales/` does not break boot:
  the screen falls back to pt-BR and the Account selector, with the native labels, says
  "tradução em andamento". `<html lang>` follows the active language. Key
  parity compares each existing locale with the pt-BR source.
- **Where:** `src/domain/iam/user.entity.ts:8` (`USER_LOCALES`),
  `apps/web/src/lib/idioma.ts:65` (`resolverIdiomaDoNavegador`),
  `apps/web/src/lib/i18n.ts:72` (`fallbackLng`)
- **Test:** `test/interfaces/http/iam/user-preferences-locale.dto.spec.ts`
  ("aceita pt-BR, en, ru e zh-Hans"; "recusa idioma fora da lista");
  `apps/web/src/lib/idioma.test.ts` ("idioma sem catálogo cai no pt-BR, nunca
  no inglês"); `apps/web/src/lib/i18n-paridade.test.ts`
- **Origin:** AT-548, ADR 0216 (items 1–4)

### RN-892 — The call's stable prefix is marked for the prompt cache, and the capability is turned on only in OpenRouter, proven {#rn-892}

Measured in TP-01 (15/10): `anthropic/claude-haiku-5.5` through OpenRouter
received 8.40 M input tokens with **0** cached, and the input was US$ 0.84 of
the US$ 1.02. Anthropic models only read from the cache the prefix marked with
`cache_control: { type: "ephemeral" }` on a text content block (up to four
points, 5 min TTL — https://openrouter.ai/docs/features/prompt-caching).

1. **Provider capability, mandatory.** `LLMProviderCapabilities.promptCaching`
   is `true` on OpenRouter and (RN-1008) on direct Anthropic, and `false` on the
   other seven. Declaring it without the `marcarCacheDePrompt` hook fails at
   construction. When off, the body is byte for byte what it was before.
2. **Model layer in the config.** On OpenRouter only `anthropic/*` gets a point;
   the others cache on their own and come back intact.
3. **Two points, over what does not change.** The last `system` of the prefix
   (instructions, and the tools before them) and the last `user`/`tool` before the
   final `system` tail. The tail — language (RN-622), environment (RN-706), flow
   (RN-711), profile (RN-680) — stays AFTER the last point, and the order of the
   messages never changes.
4. **Proof (ADRs 0041/0042).** On 2026-10-15 the smoke ran with a real credential
   (`OPENROUTER_TEST_KEY=… pnpm --filter api exec vitest run
   test/infrastructure/llm/openrouter-provider.cache.smoke.spec.ts`) and the
   second call to `anthropic/claude-haiku-5.5` came back with
   `cached_input_tokens=8011`; only then did OpenRouter's capability become
   `true`. Turning on another provider requires the equivalent smoke. The gain
   shows up in the metering through [RN-666](#rn-666).

- **Code:** `src/infrastructure/llm/openrouter-provider.ts:302` (`marcarCacheDePromptOpenRouter`);
  `src/infrastructure/llm/openai-compatible-provider.ts:661` (`mensagens`)
- **Test:** `test/infrastructure/llm/openrouter-provider.contract.spec.ts` ("pontos de cache de prompt (RN-892)": on marks the two points; off is byte for byte; a capability without the hook fails — failure case)
- **Origin:** AT-543

### RN-894 — An epic with the same title as another in the project is refused {#rn-894}

- **Rule:** `create_epic` refuses (400) the epic whose normalized title is equal
  to that of another epic of the SAME project, and the refusal gives the model the
  id of the existing one: "The epic «title» (id …) already exists in this
  project — use this id in epic_id". The yardstick is the SAME as the story's
  (finding R, `tituloDuplicado`), with no second copy. The SEMANTIC duplicate
  ([RN-681](#rn-681)) does not apply to an epic: only an equal title. Nothing is
  created nor written to the event log when it refuses.
- **Where:** `src/application/use-cases/backlog/create-epic.use-case.ts:25` (`tituloDuplicado`)
- **Test:** `test/application/use-cases/backlog/create-epic.use-case.spec.ts:41`
  (creates without an equal title) and `:49` (refuses the equal title with the
  existing one's id)
- **Origin:** AT-581

### RN-902 — Recreating the container freezes the current image decision, and an outdated image is warned about {#rn-902}

- **Rule:** the transition `removed → provisioning` and `failed → provisioning`
  RE-READS the current image decision and rewrites `imageVersion` and `resources`
  of the `project_containers` row (before, only the row's creation froze them, and
  the Image column stayed on the old version after Remove → Bring up). Without a
  current decision it is 409 ([RN-105](#rn-105)). `stopped → running` does NOT
  change the version: the reused container is the old one. The `/containers` page
  gains `decisaoVigente` and `imagemDesatualizada` per row — the divergence
  compares CONTENT (image, network, resources), never the version number, because
  Infra's election writes v+1 with the same content at each bring-up — and, with a
  divergent `running`/`stopped`/`provisioning`, the row says in text "Stop →
  Remove → Bring up again" and now says why "Bring up again" does not apply the
  new image. The result of `choose_project_image` carries `containerDePe` and the
  text warns that the decision only holds when the container is recreated.
  "Recreate" in a single action does NOT exist; no approval ceiling changes
  ([RN-495](#rn-495)).
- **Where:** `src/application/use-cases/containers/registrar-transicao-de-container.use-case.ts:131`
  (`recongelar`), `src/domain/containers/project-container.ts:373`
  (`containerDivergeDaDecisao`),
  `apps/engine/lib/engine/harness/tools/choose_project_image.ex:99`
  (`mensagem_de_fixada`)
- **Test:** `test/application/use-cases/containers/ciclo-de-vida-do-container.use-case.spec.ts`
  ("recongela versão e recursos", "sem decisão vigente é 409", "mantém a versão
  congelada"); `test/domain/containers/project-container.spec.ts`
  (`containerDivergeDaDecisao`);
  `test/infrastructure/persistence/drizzle/containers-overview.repository.spec.ts`
  ("imagemDesatualizada compara CONTEÚDO");
  `apps/web/src/routes/ContainersPage.test.tsx` (warning and reason);
  `apps/engine/test/engine/harness/tools/choose_project_image_test.exs`
- **Origin:** AT-595 (TP-01 20th: the v3 `egress` decision did not reach the v2
  `none` container and the Image column stayed at v2)

### RN-906 — The api refuses the `none` network when a module's stack downloads dependencies {#rn-906}

- **Rule:** when deciding the project's image, if the network is `none` and some
  module of the current `module_map` has a `stack` that matches, by whole WORD, the
  closed list of ecosystems that download dependencies (node, npm, pnpm, yarn,
  python, pip, elixir, mix, go, rust, cargo, ruby, java, maven, gradle, php,
  dotnet...), the api answers 400 naming the module, the stack and the term, and
  asks for `egress`. Nothing is recorded and the network is never switched on its
  own: `egress` is the user's authorization. It applies to the Architect
  (`choose_project_image`) and to Infra's election, which go through the same use
  case (in Infra, `container_start` ends `failed` with the reason, without calling
  the broker). Without a `module_map` or with a stack that does not match, only the
  warning of RN-735 follows. No configurable exception. Revises RN-735 (warning →
  refusal in that case).
- **Where:** `src/application/use-cases/containers/decidir-imagem-do-projeto.use-case.ts:80`
  (`stackQueBaixaDependencias`)
- **Test:** `test/application/use-cases/containers/container-do-projeto.use-case.spec.ts`
  (refusal in both callers; `egress`, a stack that does not match and no map pass);
  `test/domain/containers/project-container.spec.ts` (word matching);
  `test/application/use-cases/actions/execute-container-start.use-case.spec.ts`
- **Origin:** AT-593 (EP-031).

### RN-907 — OpenRouter receives a session key per agent, and the conversation stays pinned to the upstream that served it {#rn-907}

Without a key, the hub treats each dev agent task (another first message) as a
new conversation and draws another upstream — 17 in TP-01 of the 18th round, with
the cache hit rate falling. Brabo now sends the key.

1. **Format.** `session_id` = `brabo:<sessionId>:<agentId>`, and
   `brabo:<sessionId>` without an agent — per agent + session, never per project.
   It is built by the two turn use cases and travels in `ChatOptions.sessionKey`.
2. **Provider capability, mandatory.** `LLMProviderCapabilities.stickySession` is
   `true` only on OpenRouter and `false` on the other eight; declaring it without
   the `campoDeSessao` hook fails at construction. When off, or without a key, the
   body is byte for byte what it was before.
3. **Proof (ADRs 0041/0042).** On 2026-10-21 the smoke ran with a real credential
   on `deepseek/deepseek-v4.1-flash`: with the key, 6 of 6 calls on the same
   upstream (Together); without it, 4 upstreams in 6. Turning on another provider
   requires the equivalent smoke.
4. **No table.** The key is derivable from `token_usage` (`session_id` +
   `actor_id`), and the effect is measured in `upstream_provider`,
   `cached_input_tokens` and `cost_micros` (RN-665/666).
   `provider.order`/`allow_fallbacks` stay out (ADR 0221).

- **Code:** `src/infrastructure/llm/openrouter-provider.ts:236` (`campoDeSessaoOpenRouter`);
  `src/domain/llm/routing-preference.ts:88` (`chaveDeSessao`);
  `src/application/use-cases/llm/run-llm-turn.use-case.ts:243` (`chaveDeSessao`)
- **Test:** `test/infrastructure/llm/openrouter-provider.contract.spec.ts` ("chave de sessão (ADR 0221, RN-907)": with capability and key it carries `session_id`; without a key or off it does not; a capability without the hook fails — failure case); `test/application/use-cases/llm/stream-llm-turn.use-case.spec.ts`; `run-llm-turn.use-case.spec.ts`; smoke `openrouter-provider.sessao.smoke.spec.ts`
- **Origin:** AT-580; ADR [0221](../adr/0221-upstream-preso-por-sessao.md)

### RN-909 — 9Router is the 10th provider: URL per installation, mandatory credential, public curated price {#rn-909}

- **Rule:** the `9router` provider talks to a gateway on the owner's machine. The base URL is `NINE_ROUTER_BASE_URL` (default `http://host.docker.internal:20128/v1`), read at each use by the provider and by the connection test (`GET /models` with the key). The credential is mandatory. The provider capabilities are `false` (only `listModels`, `streaming` and, since [RN-950](#rn-950), `toolCalling`, proven by a smoke with a key) until a smoke with a key proves the rest (ADR 0041). The models' price is not discovered: it enters by manual curation and, by the owner's decision, a subscription model records the public price of the equivalent API, not zero. The provider sends `x-9router-token-saver: off` on every call, so that 9Router does not compress the `tool_result`.
- **Where:** `src/infrastructure/llm/nine-router-provider.ts:171` (`nineRouterConfig`)
- **Test:** `test/infrastructure/llm/nine-router-provider.contract.spec.ts:109` (capabilities, environment URL, header, connection test, parse of the synthetic fixture); manual smoke in `nine-router-provider.smoke.spec.ts`.
- **Origin:** AT-576a (EP-026), ADR 0222, owner's decision of 22/10.

### RN-910 — The default ceiling per area is 5 in dev, 4 in qa and 2 in infra {#rn-910}

Each agent area is born with a parallelism ceiling that comes from the catalog:
`dev` 5, `qa` 4, `infra` 2 (AT-599, owner's request of 22/10). Migration `0073`
applied the same values to **all** existing projects, overwriting what had already
been decided — the owner's decision, taken knowing that a ceiling set on purpose is lost.

- **Today only the `dev` ceiling is applied at execution.** `RequestParallelizationUseCase`
  reads the `dev` area when deciding parallelism. `qa` and `infra` have the value stored,
  shown and editable, but no code consults it: raising their ceiling changes no execution at all.
- **The `dev` ceiling only bites with 3 modules or more.** The maximum number of dev agents
  is one per module plus one extra (`dev-<modulo>-2`), that is, 2 × modules (RN-083).
  With 2 modules the maximum is 4, below 5.
- **Only the INSERT uses the catalog value.** Seeding again does not touch the row
  (RN-094). The column stays `default(2)`: that value only appears in a raw INSERT,
  outside the use case.
- **Where:** `src/domain/agents/agent-areas.ts:73` (`maxParallelPadrao`);
  `src/application/use-cases/agents/seed-agent-areas.use-case.ts:53`
  (`maxParallelAoNascer`); `src/infrastructure/persistence/drizzle/agent-area.repository.ts:62`
  (`nascer`); `src/application/use-cases/execution/request-parallelization.use-case.ts:13`
  (`MAX_PARALLEL_PADRAO`); migration `src/db/migrations/0073_paralelismo_padrao_por_area.sql`.
- **Test:** `test/application/use-cases/iam/create-project-semeia-areas.spec.ts`
  (a new project is born with 5/4/2), `test/infrastructure/persistence/drizzle/agent-area.repository.spec.ts`
  (seeding again does not undo the altered ceiling), `test/db/paralelismo-padrao-migration.spec.ts`
  (rows with 2, 3 and 7 end at 5/4/2) and `test/application/use-cases/execution/request-parallelization.use-case.spec.ts`
  (the default of 5 decides the dev's parallelism).

### RN-914 — The reasoning budget is per model, only for those that respect it {#rn-914}

- **Rule:** revises [RN-782](#rn-782) ([ADR 0223](../adr/0223-orcamento-de-raciocinio-por-modelo.md)). A model with `models.reasoning_budget` filled in (curated by hand, never by the sync) and `supportsReasoning` sends `reasoning: { max_tokens: N }` and `max_tokens` = visible output + N ([RN-741](#rn-741)); only on the provider that knows how to control reasoning (today OpenRouter) and never on the agent with reasoning turned off ([RN-783](#rn-783)). Today only `qwen/qwen3.7-flash` (N = 2048), proven on 22/10: 1024 requested, 1024 spent. A model without a budget follows RN-782, body byte for byte. `deepseek/deepseek-v4.1-flash` stays without a budget: `reasoning.max_tokens`, `effort` and `reasoning_effort` were ignored (8192 of reasoning). `effort` is never sent. The limit contains the reasoning but does not guarantee the tool call.
- **Where:** `src/domain/llm/raciocinio-do-agente.ts:18` (`opcoesDeRaciocinio`), `src/infrastructure/llm/openai-compatible-provider.ts:640` (`controla`), `src/db/schema/llm.ts:159` (`reasoningBudget`), `src/db/migrations/0074_orcamento_de_raciocinio.sql`
- **Test:** `test/infrastructure/llm/openai-compatible-provider.contract.spec.ts` (`modelo com orçamento de raciocínio (RN-914)`), `test/domain/llm/raciocinio-do-agente.spec.ts`
- **Origin:** AT-569 (paid measurement of 22/10, `~/brabo-gravacoes/raciocinio-smoke-2026-10-22/resultados.jsonl`)

### RN-915 — Reasoning is counted in the stream and aborted at the limit; the aborted cost is estimated and later reconciled {#rn-915}

Complements [RN-914](#rn-914) ([ADR 0224](../adr/0224-raciocinio-abortado-no-stream.md)).

1. **Abort.** With `reasoning_budget` and reasoning on, the provider sums the
   characters of `delta.reasoning`; when `characters/4 > N` it destroys the connection
   and emits `truncated` with `motivo: "raciocinio"` (the cut by `max_tokens` has no
   reason). Without a budget (or with reasoning off), nothing is counted.
2. **Estimate on the spot.** The aborted response carries no `usage`: output = characters/4,
   input by the estimator, at the catalog price, `estimated`, `price_implicit` and
   `custo_a_reconciliar` (only if there is a generation id).
3. **Reconciliation.** Periodic (`CUSTO_RECONCILIACAO_INTERVAL_MS`), idempotent: swaps
   for the `total_cost` of `GET /generation?id=` only on 200, only a marked row and from the last
   24 h; a 404 or error leaves the row as it is. The estimate goes to `catalog_cost_micros`.
   The budget/area `spentMicros` is not corrected.

- **Code:** `src/infrastructure/llm/openai-compatible-provider.ts:391` (`limiteDeRaciocinio`);
  `src/application/use-cases/llm/reconciliar-custo-estimado.use-case.ts:57` (`execute`)
- **Test:** `test/infrastructure/llm/raciocinio-abortado.spec.ts` (aborts and estimates; without a budget it does not count);
  `test/application/use-cases/llm/reconciliar-custo-estimado.use-case.spec.ts` (200 swaps, 404 keeps);
  `test/infrastructure/persistence/token-usage.repository.spec.ts` (swaps only once)
- **Origin:** AT-589; ADR [0224](../adr/0224-raciocinio-abortado-no-stream.md)

### RN-916 — A response cut by reasoning is retried ONCE with reasoning turned off {#rn-916}

Revises [RN-782](#rn-782) and [RN-783](#rn-783) (the turned-off state stops being only the dev agents') and coexists with [RN-915](#rn-915).

1. **Trigger.** The response came `truncated`, without text and without a tool call, and reasoning ate the budget: `reasoningTokens >= (the model's reasoningBudget ?? 4096) − 256` (headroom `FOLGA_DO_ORCAMENTO_DE_RACIOCINIO`, the same order of magnitude as the `usage` error and the characters/4 count), or the stream was aborted by RN-915 (without `usage`, the abort is already the proof of the overrun).
2. **Once.** The api repeats the call with `reasoningOff`, in the three paths (`run-llm-turn`, `stream-llm-turn`, `send-chat-message`). If the second also truncates, the outcome is today's (`truncated`); there is never a third. Nothing was emitted to the client on the first, so the retry is invisible.
3. **Metering.** BOTH calls record a row in `token_usage`; the first, at the price/cost the provider reported (or the aborted estimate of RN-915, with reconciliation).
4. **It does not retry** without reasoning requested, with reasoning already off (dev agents, RN-783) or with a provider that does not know how to turn it off (`aceitaRaciocinioDesligado`, OpenRouter and Anthropic; see [RN-1001](#rn-1001), which fixes the decorator that hid the flag): there the outcome follows the previous one.

- **Code:** `src/domain/llm/raciocinio-do-agente.ts:66` (`devoRetentarSemRaciocinio`);
  `src/application/use-cases/llm/run-llm-turn.use-case.ts:359` (`devoRetentarSemRaciocinio`)
- **Test:** `test/domain/llm/raciocinio-do-agente.spec.ts` (headroom, abort and the refusals); `test/application/use-cases/llm/run-llm-turn.use-case.spec.ts` (retries and records two rows; a second truncated has no third; truncated with text does not retry); `test/application/use-cases/llm/stream-llm-turn.use-case.spec.ts` (same in the stream)
- **Origin:** AT-587

### RN-917 — OpenRouter receives a price ceiling per call, and with no upstream within the ceiling the call is repeated ONCE without it {#rn-917}

Revises [RN-583](#rn-583) (`sort` stops being the only `provider` field that goes on the wire) and coexists with [RN-907](#rn-907) (the `session_id`) and [RN-916](#rn-916) (the same retry loop).

1. **Ceiling.** `provider.max_price = { prompt, completion }` = the model's catalog price (`inputPricePerMillionMicros`/`outputPricePerMillionMicros`) × `FATOR_DO_TETO_DE_PRECO` (1.5, owner's decision of 27/10), in US$ per million. Fixed in the code and on by default in the provider that declares `priceCeiling` (only OpenRouter, proven by a smoke); a price of 0 at either end, or a provider without the capability, sends no ceiling. Changing the factor is a new ADR (0225).
2. **Merge.** The ceiling's `provider` object is merged with the binding's `sort` one (RN-583): both go together in the same body, one never erases the other.
3. **No upstream within the ceiling.** The 404 of a call that carried a ceiling is the error `LLMPriceCeilingError` (`code: price_ceiling`), never `LLMModelNotFoundError`. The three turn paths (`run-llm-turn`, `stream-llm-turn`, `send-chat-message`) repeat the call ONCE without a ceiling, warn in the log and do not fail the turn; there is never a third for this reason.
4. **Metering.** `token_usage.price_ceiling_factor` freezes the factor that WENT ON THE WIRE (`null` = nothing sent, including in the repeat without a ceiling), on the model of `routing_preference`.

- **Code:** `src/domain/llm/routing-preference.ts:108` (`tetoDePreco`); `src/domain/llm/routing-preference.ts:132` (`devoRetentarSemTeto`); `src/infrastructure/llm/openrouter-provider.ts:221` (`campoDeTetoDePrecoOpenRouter`); `src/infrastructure/llm/openai-compatible-provider.ts:604` (`camposDoHub`); `src/application/use-cases/llm/stream-llm-turn.use-case.ts:372` (`devoRetentarSemTeto`); `src/db/schema/llm.ts:414` (`priceCeilingFactor`)
- **Test:** `test/domain/llm/routing-preference.spec.ts` (factor, price 0, only OpenRouter declares); `test/infrastructure/llm/openrouter-provider.contract.spec.ts` (`sort` and ceiling merged in the body, without the capability nothing goes, a 404 with a ceiling is `price_ceiling` and without a ceiling remains `model_not_found`); `test/application/use-cases/llm/stream-llm-turn.use-case.spec.ts` (repeats once without a ceiling, factor `[1.5, null]` in the metering); `test/infrastructure/llm/openrouter-provider.teto.smoke.spec.ts` (manual, real API)
- **Origin:** AT-606; ADR [0225](../adr/0225-teto-de-preco-do-upstream-no-openrouter.md)

### RN-921 — The thread's "Resume" button is a human gesture, with no ceiling, and only applies to the interrupted turn {#rn-921}

- **Rule:** the `agent.error` with `reason: turno_interrompido_por_reinicio` gains in the thread the card `RetomarTurnoInterrompido` (goal and steps of the last plan, "Stopped at", button). The click calls `POST /projects/:projectId/sessions/:sessionId/agents/:agent/resume` (`developer`; 200 `{ok:true}`; 404 foreign session; 409 `turno_nao_interrompido` when the agent's last outcome is not the interruption or there is a turn in progress; 409 `agente_sem_retomada`), which asks the engine `POST /internal/sessions/:sessionId/agent/resume`: it records `agent.turn_resumed` with `automatica: false` and sends `:retomar_turno_interrompido` to the SAME `TurnoAssincrono`. No ceiling: each click is a resume. The card disappears when something follows the error, and the automatic resume becomes a discreet line. The diary's "no outcome" does NOT appear on the screen (the event does not carry it).
- **Where:** `src/interfaces/http/sessions/agent-resume.controller.ts:23` (`AgentResumeController`), `src/application/use-cases/sessions/resume-agent-turn.use-case.ts:29` (`execute`), `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:638` (`resume`), `apps/web/src/routes/RetomarTurnoInterrompido.tsx:23` (`ehTurnoInterrompido`)
- **Test:** `test/interfaces/http/sessions/agent-resume.controller.spec.ts` (happy, two 409 refusals, 404, role); `apps/web/src/routes/RetomarTurnoInterrompido.test.tsx`; ExUnit of `agent_command_controller`
- **Origin:** AT-582 (EP-031); [ADR 0226](../adr/0226-diario-vivo-e-retomada-dos-agentes.md).

### RN-926 — The credentialed-providers route returns only the names, and the key is the HOLDER's {#rn-926}

- **Rule:** `GET workspaces/:workspaceId/llm-providers/credentialed` (`viewer`, the minimum for reading members, [RN-655](#rn-655)) returns `{ providers: LLMProviderName[] }` with the LLM providers in which the workspace HOLDER (`workspaces.created_by`, the person whose credential the agents spend, [RN-058](#rn-058)) has a registered credential. Only names, in the order of the canonical list: never a secret, id, date or `key_id`. `ollama` has no credential and never appears; a git token (`github`/`gitlab`) neither. Another member's credential does not count. It is the source of "has a key" for the providers screens and the catalog (AT-607); the screen comes later.
- **Where:** `src/application/use-cases/llm/list-credentialed-providers.use-case.ts:20` (`execute`), `src/interfaces/http/llm/models.controller.ts:80` (`credentialed`)
- **Test:** `test/application/use-cases/llm/list-credentialed-providers.use-case.spec.ts:44` (`titular com duas chaves: só os dois nomes`; another member's key does not count)
- **Origin:** AT-607 (EP-026).

### RN-927 — The runner records the user's LLM API key through `POST /runner/llm-credentials`, only with a machine key, without overwriting without confirmation {#rn-927}

- **Rule:** `POST /runner/llm-credentials` (`@RequirePatAuth()`, `PatAuthGuard`) receives `{ provider, apiKey, origem, substituir? }` and delegates to the same `UpsertUserCredentialUseCase` (envelope with `key_id`, ADR 0158) for the user who owns the credential. A route without `:projectId`: the guard refuses with 403 a credential tied to a project, and every PAT is a project one, so only the MACHINE device key gets in (the first route in which it writes a user secret). A provider outside `LLM_PROVIDER_NAMES_COM_CREDENCIAL` is 400; an existing credential of the provider without `substituir: true` is 409 `credencial_existente`, without touching the existing one. The response is `{ provider, substituida }`. The value never goes to a log (the audit carries provider and `origem`), URL, event, exception or response, and the route does not test the connection (ADR 0050). Only an API key is importable; a subscription login token is not (ADR 0230).
- **Where:** `src/application/use-cases/llm/import-runner-llm-credential.use-case.ts:22` (`execute`), `src/interfaces/http/runner/runner-llm-credentials.controller.ts:33` (`RunnerLlmCredentialsController`)
- **Test:** `test/application/use-cases/llm/import-runner-llm-credential.use-case.spec.ts` (writes encrypted with `key_id` and without the value in log/response; 409 without replacing; replace; invalid provider); 401/403 of the guard in `test/interfaces/pat-auth.guard.spec.ts`; `route-surface.spec.ts`
- **Origin:** AT-611 (EP-026), ADR 0230.

### RN-932 — The container network is an artifact declared by a human and only applies in the recreated container {#rn-932}

- **Rule:** `artifact.container_network` (`{ ports[{host,container,protocol:'tcp'}], dns[], extraHosts[{name,ip}] }`) is versioned, with no table, and the current one is the one with the greatest `version`. Only a `maintainer` human writes it (`PUT /projects/:projectId/container/network`; `GET` is `viewer`), with the SAME yardstick as the docker-port (host 1024-65535 outside the installation's ports, up to 10 ports without duplicates, up to 3 DNS by literal IP, up to 10 hosts with IPv4 and a name outside the reserved ones); the refusal is 400 `rede_invalida` naming the field. Writing is NOT an external effect. The `container-spec` returns `ports`, `dns` and `extraHosts` (or `null`; `runner` always `null`, runner later) and the change only applies in a recreated container (RN-934). The api does not import the docker-port, so the yardstick is mirrored and parity is proven by a test.
- **Where:** `src/domain/containers/rede-do-container.ts:86` (`validarRedeDoContainer`), `src/interfaces/http/containers/containers.controller.ts:91` (`declarar`), `src/application/use-cases/containers/obter-spec-de-container.use-case.ts:135` (`execute`).
- **Test:** `test/contract/rede-do-container-paridade.spec.ts` (parity with the docker-port), `test/application/use-cases/containers/spec-e-observacao-de-container.use-case.spec.ts` (spec returns the network; `runner` all `null`).
- **Origin:** AT-608 (EP-030), ADR 0228.

### RN-933 — `run.app` declares the app's command and only the autopilot waives approval of the infra PR {#rn-933}

- **Rule:** the `run` of `open_infra_pr` accepts an optional `app: { command, port }` (command up to 300 code points, one line, no NUL; port 1024-65535; `null` is equivalent to absent, as in the engine) validated at proposal and at execution; without `app`, everything is byte for byte what it was before. With `run.app`, the SPECIFIC rule `open_infra_pr: auto_approve` (the acceptance seed) is NOT enough and the decision becomes `require_approval`; only the agent's `auto_approve` WILDCARD (autopilot, RN-603/RN-670) auto-approves. The `container-spec` returns `comandoDoApp` from the current `run.app.command`, or `null`.
- **Where:** `src/domain/infra/run-instructions.ts:77` (`recusaDoRun`), `src/domain/actions/decide.ts:614` (`comAppDeclarado`), `src/application/use-cases/actions/propose-action.use-case.ts:208` (`comAppDeclarado`), `src/application/use-cases/containers/obter-spec-de-container.use-case.ts:171` (`comandoDoApp`).
- **Test:** `test/domain/infra/run-app.spec.ts`, `test/domain/actions/decide.spec.ts` (no app + specific = auto; with app + specific = approval; with app + wildcard = auto).
- **Origin:** AT-610 (EP-030), ADR 0228.

### RN-934 — `container_recreate` removes and brings up again, under the absolute ceiling of `container_remove` {#rn-934}

- **Rule:** `container_recreate` (`maintainer`) is a `proposed_action` never auto-approvable, not even with the wildcard, and "always allow" is refused at the source (same list as `container_remove`). Execution does `remove` and `start` through the broker passing through `running -> stopped -> removed -> provisioning -> running`; a broker refusal or unavailability becomes a named `failed` (if the bring-up fails, the reason says the container has already been removed). `runner` is refused naming "runner later". The sentence in `aprovacoes.ts` exists and the web test fails a type without a sentence.
- **Where:** `src/domain/actions/decide.ts:597` (`container_recreate`), `src/application/use-cases/actions/execute-container-recreate.use-case.ts:44` (`execute`), `apps/web/src/lib/aprovacoes.ts:117` (`container_recreate`).
- **Test:** `test/application/use-cases/actions/execute-container-recreate.use-case.spec.ts`, `test/domain/actions/decide.spec.ts` (ceiling), `apps/web/src/lib/aprovacoes.test.ts`.
- **Origin:** AT-608 (EP-030), ADR 0228.

### RN-935 — Infra declares the QA instance's services (`run.qa`), and the api keeps one instance per task with a ceiling of 1 per project {#rn-935}

- **Rule:** `open_infra_pr` accepts `run.qa = { services: [...] }` (optional, `null` = absent; up to 6 services with a unique name `[a-z][a-z0-9-]{0,31}`; `image` WITH a digest `@sha256:<64 hex>`; `env` up to 20 one-line variables `[A-Z_][A-Z0-9_]*`; `tmpfs` up to 3 absolute paths; `shared` boolean). The same yardstick holds at proposal (400 `run_invalido`) and at execution, and who declares is Infra, not a product catalog (owner's decision, 29/10). A task's instance is a row of `project_qa_environments` (`provisioning|running|failed|removed`, unique `(project, task)`), and a unique partial index guarantees in the database ONE active per project: bringing up another task's with one active is 409 `instancia_de_qa_ocupada`. `runner` is refused (409 `qa_nao_suporta_runner`, "runner later"). The container key is `chaveDeQa(taskId)` (the first 8 `[a-z0-9]` of the id, without hyphen), computed only by the api.
- **Where:** `src/domain/infra/run-instructions.ts:160` (`recusaDoQa`), `src/domain/containers/instancia-de-qa.ts:15` (`chaveDeQa`), `src/db/schema/containers.ts:87` (`projectQaEnvironments`), `src/application/use-cases/containers/instancia-de-qa.use-case.ts:80` (`start`).
- **Test:** `test/domain/infra/run-qa.spec.ts`, `test/application/use-cases/containers/instancia-de-qa.use-case.spec.ts`.
- **Origin:** AT-612 (EP-030), ADR 0229.

### RN-936 — Bringing up the QA instance is the action `qa_environment_start`, seeded `auto_approve` for QA; removing is automatic and outside the `container_remove` ceiling {#rn-936}

- **Rule:** `qa_environment_start` (`developer`, payload `{ taskId }`) is a `proposed_action` seeded `auto_approve` for `qa-automacao` at execution activation; when auto-approved or approved, the api brings the instance up through the broker (a named `failed` if the ceiling is occupied, if the project is `runner` or if the broker refuses). REMOVAL is not a proposal: `POST /internal/projects/:projectId/qa-environments/:taskId/remove` is idempotent and only reaches what the broker labels `brabo.papel=qa`, so it does not enter the absolute ceiling of `container_remove`/`container_recreate`. The `container-exec` accepts `alvo: { qa: true, taskId }` coming from the engine (never from the model) to run in the instance; without a `running` instance it returns `sucesso: false`. The type's sentence exists in `aprovacoes.ts` and the web test fails a type without a sentence.
- **Where:** `src/domain/actions/decide.ts:196` (`qa_environment_start`), `src/application/use-cases/actions/execute-qa-environment-start.use-case.ts:25` (`execute`), `src/application/use-cases/containers/instancia-de-qa.use-case.ts:120` (`remove`), `apps/web/src/lib/aprovacoes.ts:438` (`qa_environment_start`).
- **Test:** `test/application/use-cases/containers/instancia-de-qa.use-case.spec.ts`, `test/domain/actions/decide.spec.ts`, `apps/web/src/lib/aprovacoes.test.ts`.
- **Origin:** AT-612 (EP-030), ADR 0229.

### RN-937 — The QA `container-spec` and the cleanup of orphans {#rn-937}

- **Rule:** `GET /internal/projects/:id/container-spec?papel=qa&task=<ref>` returns the normal context with `comandoDoApp: null`, `ports: null` and `qa: { chave, services }` (those of `run.qa`, `[]` if absent). `task` is the full id OR the 8-key (the `dev` broker sends the key), resolved INSIDE the project: a nonexistent task or one from another project is 404, an ambiguous key is 409 `tarefa_ambigua`. `POST /internal/qa-environments/sweep` receives from the engine the `taskIdsEmVoo` and removes every active or `failed` instance outside that list. Declared gap: the broker does not yet have an operation to remove the shared service nor the network `brabo-qa-<wd>`, which stay until that operation exists.
- **Where:** `src/application/use-cases/containers/obter-spec-de-container.use-case.ts:135` (`execute`), `src/application/use-cases/containers/instancia-de-qa.use-case.ts:140` (`limparOrfas`), `src/interfaces/http/internal/internal-qa-environments.controller.ts:90` (`sweep`).
- **Test:** `test/application/use-cases/containers/instancia-de-qa.use-case.spec.ts`.
- **Origin:** AT-612 (EP-030), ADR 0229.

### RN-938 — The `terminal` only goes to the QA instance when the actor is `qa-automacao` and the task belongs to the project {#rn-938}

- **Rule:** the api forwards `payload.alvo = { qa: true, taskId }` of a `terminal` `proposed_action` to the engine's `/internal/actions/execute` ONLY if the action's actor is `qa-automacao` and the `taskId` belongs to the action's project. In any other case (another agent, malformed `alvo`, a task from another project) the `alvo` is discarded with the warning `terminal.alvo_de_qa_descartado` in the log and the command goes the usual way: no other agent diverts a command to the QA instance.
- **Where:** `src/application/use-cases/actions/execute-terminal-action.use-case.ts:40` (`alvoDeQa`), `src/infrastructure/http-clients/api-to-engine-client.ts:166` (`executeTerminalAction`).
- **Test:** `test/application/use-cases/actions/alvo-de-qa-no-terminal.spec.ts`.
- **Origin:** AT-612 (EP-030), ADR 0229.

### RN-942 — Jev's cut never removes from the PO the tool for declaring a doubt {#rn-942}

- **Rule:** extends [RN-758](#rn-758). The PO's floor gains `declare_open_question`, because rule 3 of the PO's obligations says to declare the doubt instead of inventing or omitting, and Jev's cut ([RN-625](engine.md#rn-625)) removed it from every step after the first: the PO put the gap in the story's margin and no `artifact.open_question` was born. It still holds that the floor only gives back what is in the step's catalog.
- **Where:** `src/domain/llm/tool-router.ts:315` (`PISO_DO_MENU`).
- **Test:** `test/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.spec.ts` (a cut PO keeps `declare_open_question`; a catalog without it does not gain it).
- **Origin:** AT-615 (EP-030).

### RN-948 — Deliverable hygiene: SQLite database out of the commit, command folder stated, README routes preserved {#rn-948}

- **Rule:** extends [RN-761](#rn-761), [RN-900](engine.md#rn-900) and [RN-706](engine.md#rn-706)/[RN-850](engine.md#rn-850). Three parts, no new gate. (1) A second list, `ARQUIVOS_DE_DADOS` (`*.db`, `*.db-*`, `*.sqlite`, `*.sqlite-*`, `*.sqlite3`, `*.sqlite3-*`), in the SAME three layers as RN-761: the bootstrap's base `.gitignore`, the `:(exclude,glob)**/<pattern>` exclusion in the dev agent's `git add` and a finding of its own from SecOps ("runtime data file committed", which names the path). The test that crosses the api and engine lists crosses both. (2) The environment message of the agent with a module says that `npm`/`pip`/`mix` run in the module's folder in the SAME call, never `cd … 2>/dev/null;` (the failed `cd` fell to the root and left an empty `package-lock.json`), within the ceiling of 1,500 characters. (3) The dev's kickoff names the ROOT `README.md`, without repeating the section in a folder's README, and `write_file` refuses to rewrite a README that loses a route heading (`### GET /links`) present in the old one, on the model of RN-900. Declared: a repository already bootstrapped does not gain the new `.gitignore`; an intentional `.db` fixture stays out of the commit (rename it to version it); the guard does not cover a write through the `terminal`. Outside this RN: `expires_at` × `expiresAt`.
- **Where:** `src/application/use-cases/git/bootstrap-templates.ts:29` (`ARQUIVOS_DE_DADOS`), `apps/engine/lib/engine/actions/diretorios_de_dependencia.ex:37` (`argumentos_do_add`), `apps/engine/lib/engine/gates/secops_agent_server.ex:162` (`dependencias_commitadas`), `apps/engine/lib/engine/harness/ambiente_do_agente.ex:178` (`modulo`), `apps/engine/lib/engine/harness/tools/write_file.ex:62` (`recusa_de_secao_perdida`), `apps/engine/lib/engine/dev/dev_agent_server.ex:604` (`initial_message`).
- **Test:** `apps/engine/test/engine/actions/diretorios_de_dependencia_test.exs` (list crossed with the api, a real add that stages only `src/a.js`, SecOps names the `.db`), `test/application/use-cases/git/bootstrap-plan.spec.ts` (the six patterns in the `.gitignore`), `apps/engine/test/engine/harness/ambiente_do_agente_test.exs`, `apps/engine/test/engine/harness/tools/write_file_test.exs`, `apps/engine/test/engine/dev/report_done_instrucao_test.exs`.
- **Origin:** AT-623 (EP-031), deliverable `entregavel3` (commits 956fa5c, 8e593b0).

### RN-949 — A tool call written as text does not become a reply in the thread {#rn-949}

- **Rule:** when the LLM call carries `tools`, comes without `toolCalls` and the
  text carries the call written as markup (`<function_calls>`, `<invoke
  name="X">` with X a tool of the step, `<tool_call>{json}` with the `name` of a
  tool; with or without the `antml:` prefix), the api repeats the SAME call ONCE
  (its own flag, independent of RN-916/917; both calls enter the metering). If it
  repeats, the outcome is a NAMED failure: `final` with
  `content: ''`, `error` naming the format and the model and `errorCode:
  'tool_call_as_text'` (a MODEL error, RN-059/163), never a reply. In the stream,
  the api stops forwarding deltas from the first marker and holds back the tail
  that may be the beginning of one: the raw text does not leave the api. A fenced
  block, inline code, prose, a name that is not a tool and a call without `tools`
  do not count; loose JSON stays with `ToolCallRecovery` (ADR 0020). Owner's
  decision: the XML is NOT parsed nor executed (RN-040: rescue is not a license).
  Declared limit: the legitimate prefix of the 1st attempt stays in the bubble in
  progress until the turn closes.
- **Where:** `src/domain/llm/chamada-em-texto.ts:10`
  (`marcacaoDeChamadaEmTexto`),
  `src/application/use-cases/llm/run-llm-turn.use-case.ts:347`
  (`semChamadaEmTexto`),
  `src/application/use-cases/llm/stream-llm-turn.use-case.ts:386`
  (`semChamadaEmTexto`)
- **Test:** `test/domain/llm/chamada-em-texto.spec.ts`,
  `test/application/use-cases/llm/run-llm-turn.use-case.spec.ts` and
  `stream-llm-turn.use-case.spec.ts` (`chamada escrita como texto`: twice
  a named failure with 2 usage rows; a clean second one answers)
- **Origin:** AT-633 (session `2b5161d0`, seq 4: `<invoke name="emit_artifact">`
  appeared as a reply in the thread)

### RN-950 — 9Router receives the tools, the binding checks the provider's capability and a tool without capability throws {#rn-950}

- **Rule:** revises [RN-909](#rn-909) and completes [RN-040](#rn-040) with the SECOND layer of ADR 0041. (1) `nineRouterConfig` declares `toolCalling: true`, proven by a smoke with a real key on 31/10: 3/3 calls on `cc/claude-haiku-5-5` came back with structured `tool_calls`, 10/10 consistent at temperature 0 and a 3-round loop intact. Before, the `false` capability made `buildBody` silently drop `tools` and the Creative wrote the call as XML in the thread (AT-637). (2) `assertModelFitsBindingScope` also checks the PROVIDER in the `agent` and `area` scopes: a binding whose provider declares `toolCalling: false` is refused with 422 (`ModelNotFitForAgentScopeError`, cause `provider`), with its own sentence. `workspace`, `project` and `session` stay free. (3) `buildBody` with tools requested and capability `false` THROWS a named error instead of dropping. Providers affected: only `opencode-zen` has `toolCalling: false` besides the earlier 9Router; new agent/area bindings to it become 422 and chat without tools stays the same. An old binding to it stays recorded and the agent's turn fails named.
- **Where:** `src/infrastructure/llm/nine-router-provider.ts:171` (`nineRouterConfig`), `src/domain/llm/model-capabilities.ts:95` (`assertModelFitsBindingScope`), `src/application/use-cases/llm/set-model-binding.use-case.ts:56` (`toolCalling`), `src/infrastructure/llm/openai-compatible-provider.ts:633` (`buildBody`)
- **Test:** `test/domain/llm/model-capabilities.spec.ts` (refusal by provider in `agent`/`area`; free scopes), `test/infrastructure/llm/nine-router-provider.contract.spec.ts` (capability `true`), `test/contract/llm-provider.contract.ts` (a provider without the capability throws named); manual smoke in `nine-router-provider.smoke.spec.ts`.
- **Origin:** AT-637 (EP-026), TP-01 of 31/10 and the measurement of AT-631.

### RN-952 — The owner's report cuts by project and by session, and the member sees the project's total without a credential {#rn-952}

Revises [RN-101](#rn-101) (the member stops seeing ONLY their own consumption) and coexists with [RN-060](#rn-060), [RN-186](#rn-186) and [RN-187](#rn-187).

1. **Cut.** `GET workspaces/:workspaceId/spend-report?projectId=` (`owner`) limits the report to ONE project and also returns `porSessao`. A project of another workspace is 404, the same as a nonexistent one: the filter never becomes a read across workspaces.
2. **Member.** `GET projects/:projectId/spend/team` (`viewer`) returns the project's total and the cost per agent (`porAgente`) and per catalog area (`porArea`, `sem-area` when there is none). Never provider nor credential: the route has no dimension parameter and the use case only asks for `actor` (ADR [0233](../adr/0233-membro-ve-o-gasto-do-projeto-sem-credencial.md), which revises [0063](../adr/0063-duas-audiencias-para-o-mesmo-gasto.md)).

- **Code:** `src/application/use-cases/llm/get-workspace-spend-report.use-case.ts:98` (`NotFoundException`); `src/application/use-cases/llm/get-project-spend-team.use-case.ts:29` (`GetProjectSpendTeamUseCase`); `src/interfaces/http/llm/spend.controller.ts:147` (`getProjectSpendTeam`)
- **Test:** `test/application/use-cases/llm/spend-audiencias.use-case.spec.ts` (cut by project with session, 404 across workspaces, member without provider); `test/interfaces/spend.controller.spec.ts` (roles of the routes)
- **Origin:** AT-632

### RN-953 — The non-owner sees their OWN consumption in the workspace, summed by project {#rn-953}

Coexists with [RN-101](#rn-101): the actor comes from the token, never from the route.

`GET workspaces/:workspaceId/spend/me` (`viewer`) returns only the caller's rows, by project and by day. Actor scope: the `provider` dimension does not compile (RN-187), and the route has no dimension parameter.

- **Code:** `src/application/use-cases/llm/get-my-workspace-spend.use-case.ts:32` (`GetMyWorkspaceSpendUseCase`); `src/interfaces/http/llm/spend.controller.ts:120` (`getMyWorkspaceSpend`)
- **Test:** `test/application/use-cases/llm/spend-audiencias.use-case.spec.ts` (sum by project, never another actor's row)
- **Origin:** AT-632

### RN-954 — The model's billing is a CURATED mark, and the subscription is separate from the paid US$ {#rn-954}

Coexists with [RN-665](#rn-665) (OpenRouter's real cost) and the frozen price of ADR 0042.

1. **Mark.** `models.billing` is `api` (default), `subscription` or `free`, recorded by curation in `PATCH workspaces/:workspaceId/models/:modelId/billing` (`owner`, the level of `…/pricing`). The sync never touches it and the `token_usage` row does not change.
2. **Report.** Every bucket and the total gain `assinaturaMicros` = the sum of the cost of `subscription` models, contained in `costMicros`; what is paid in US$ is `costMicros − assinaturaMicros`.

- **Code:** `src/db/schema/llm.ts:175` (`modelBillingEnum`); `src/infrastructure/persistence/drizzle/token-usage.repository.ts:394` (`assinaturaMicros`); `src/interfaces/http/llm/models.controller.ts:302` (`updateBilling`)
- **Test:** `test/application/use-cases/llm/spend-audiencias.use-case.spec.ts` (subscription separate from paid)
- **Origin:** AT-632

### RN-958 — 9Router's usage is corrected in the provider: −2,000 only on 0.5.112, and the top-level cache counts {#rn-958}

Completes [RN-666](#rn-666) (item 4) for 9Router. 0.5.112 ADDS 2,000 to `prompt_tokens` in the final frame, including over the usage it estimates itself; recording it as it came inflated `input_tokens` and, through [RN-665](#rn-665), the cost.

1. **Only on the known version.** The provider reads `currentVersion` from `GET <origin>/api/version` (public, ceiling of 2 s, 5 min cache on success and 1 min on failure) before the stream. Only the table's version (`0.5.112`) has `prompt_tokens` reduced by 2,000, with a floor at 0; subtracting on a version that fixed the bug would record LESS than what was charged.
2. **Another or unreadable version** (404, slow, invalid body): records as it came and logs ONE warning per version. The turn never fails because of the read.
3. **Cache.** `cached_tokens` at the TOP of the usage becomes `prompt_tokens_details.cached_tokens` (and then `cachedInputTokens`) when the latter did not come; absent remains "did not say" ([RN-666](#rn-666) item 2).
4. **Declared, not patched.** On `cc/*` 9Router discards `cache_read_input_tokens` when filtering the usage in the stream, so that upstream's cache does NOT reach Brabo; `cache_creation` has no column; the non-stream path does not exist in the base.
5. **Optional hook** `normalizarUsage` in `OpenAICompatibleConfig`: only 9Router configures it; the other providers read the usage as always.

- **Code:** `src/infrastructure/llm/nine-router-provider.ts:118` (`normalizarUsage9Router`); `:99` (`versaoDo9Router`); `src/infrastructure/llm/openai-compatible-provider.ts:188` (`normalizarUsage`)
- **Test:** `test/infrastructure/llm/nine-router-provider.contract.spec.ts` (version 0.5.112, another, 404, slow, invalid body, floor, top-level cache, other providers without the hook)
- **Origin:** AT-638

### RN-959 — 9Router's 503 that wraps an upstream 4xx is classified by the status inside {#rn-959}

- **Rule:** completes [RN-864](engine.md#rn-864) and RN-909. When all of 9Router's accounts are in cooldown because of an upstream 4xx, it answers 503 with `[<status>]: <msg> (reset after Ns)`. The provider reads the status inside: 404 becomes `model_not_found`, 401/403 `auth`, 402 `insufficient_credit` (RN-730), 429 `rate_limit`. A 5xx inside, absent or a body without `reset after` stay a transient `upstream`. The body's shape comes from reading the 9Router 0.5.112 bundle; the smoke with a key confirms it.
- **Where:** `src/infrastructure/llm/nine-router-provider.ts:153` (`classificarErro9Router`), applied by `src/infrastructure/llm/openai-compatible-provider.ts:305` (`classificarErroHttp`).
- **Test:** `test/infrastructure/llm/nine-router-provider.contract.spec.ts` (503 with each inner status and the three cases that stay `upstream`); `apps/engine/test/engine/agents/falha_de_turno_test.exs` (`model_not_found` is not transient).
- **Origin:** AT-639 (EP-026).

### RN-960 — The `GraphStore` reconnects after a boot without Neo4j, and the warning states the cause {#rn-960}

- **Rule:** refines ADR 0099. A boot in which Neo4j did not yet answer left the driver `null` for the life of the process. Now, with a config present, the next operation tries to connect again, at most once every 30 s; without a config it never tries, and `onModuleInit` still does not throw. The `GraphProjector` warning includes the cause of the driver's error.
- **Where:** `src/infrastructure/graph/graph-store.ts:105` (`reconectarSeNecessario`), `src/application/graph-projection/graph-projector.ts:106` (`drainOnce`).
- **Test:** `test/infrastructure/graph/graph-store.spec.ts` ("RN-960"), `test/application/graph-projection/graph-projector.spec.ts` ("RN-960").
- **Origin:** AT-642 (EP-030).

### RN-961 — The cut warning says that the tools outside it can be requested in this step {#rn-961}

- **Rule:** revises [RN-759](#rn-759) (owner's decision of 31/10, AT-643). The ephemeral `system` warning of the cut step no longer says that the tools outside the cut "come back in the next rounds" nor that it "comes back in the next one": the cut belongs to the STEP, and RN-759 told the agent to wait for a step that, for the model, may not come. The new text states the truth of ADR 0179: the others remain available and can be requested in this very step, and the agent must not conclude that it does not have the tool nor end the turn waiting for it; if it needs one of them and answers without a tool, the step is redone with the full catalog (the repetition of rule 10 of ADR 0179, through the mechanism the facade already has). It does not change the floor, Jev's policy nor the menu assembly: only the warning's text.
- **Where:** `src/domain/llm/tool-router.ts:416` (`avisoDeRecorte`).
- **Test:** `test/domain/llm/aviso-de-recorte.spec.ts` (fixes the new text and fails the old one, "voltam nas próximas voltas" and "volta no seguinte").
- **Origin:** AT-643 (EP-030): `write_file` and `terminal` left the dev's menu in Jev, and the warning said to wait for a round the model had no way to request.

### RN-964 — Price and billing are curated on the Providers screen, and manual editing protects the number from the sync {#rn-964}

Completes [RN-044](#rn-044) (the manual path now marks `manual_pricing`), [RN-954](#rn-954) (the mark gains a screen) and [RN-963](web.md#rn-963) (the same sentence for the subscription without a price).

1. **Manual editing marks.** Changing the price with origin `manual` records `manual_pricing = true` in the same write as the price. Origin `sync` does not touch the mark.
2. **The sync respects the mark.** A `manual_pricing` row keeps the recorded price even when the remote catalog brings another; only the catalog without a price and the non-manual row follow the remote.
3. **A price equal to the current one remains a no-op** (RN-044): it records neither a new mark nor an audit row.
4. **Scope.** `models` is GLOBAL to the installation: the price applies to all workspaces. The screen says so in text.

- **Code:** `src/application/use-cases/llm/update-model-pricing.use-case.ts:51` (`manualPricing`); `src/application/use-cases/llm/sync-model-catalog.use-case.ts:286` (`resolverPreco`)
- **Test:** `test/application/use-cases/llm/update-model-pricing.use-case.spec.ts` (manual editing marks `manualPricing`; sync origin does not mark)
- **Origin:** AT-634

### RN-965 — The catalog suggests the price of the model's MANUFACTURER and 9Router's billing tier, and the human applies it {#rn-965}

Completes [RN-964](#rn-964) (price curation on the screen) and [RN-954](#rn-954) (`billing` mark), by the owner's decision of 01/11 (AT-640): a model's price is what its manufacturer publishes, whichever provider serves it.

1. **A table curated in the domain, without scraping a page.** Each row of `PRECOS_DO_FABRICANTE` covers exact ids and stores the price in micros, the source link (manufacturer's domain, checked by a test) and the date it was checked. The first delivery brings only Anthropic; a new manufacturer enters by PR, with the source checked.
2. **Matching by exact equality.** In `9router` only the first segment (the alias) is stripped before matching; in the other providers the name stays as is. A variant that does not match stays "no suggestion", never guessed. `openrouter` is out on purpose: its price comes from the sync and the real cost from `usage.cost` ([RN-665](#rn-665)).
3. **Tier by the 9Router 0.5.112 alias**, computed on read and without recording: `cc`/`cx` → `subscription`; alias `ollama` or id ending in `:free`, `/free` or `-free` → `free`; the rest → `api`. Without the panel credential.
4. **A suggestion, not a write.** The curation route returns `sugestao` per model; nothing is recorded on its own (ADR 0042). Who applies it is the `owner`, through the screen of [RN-964](#rn-964).

- **Code:** `src/domain/llm/sugestao-do-catalogo.ts:18` (`sugestaoDoModelo`); `src/domain/llm/precos-do-fabricante.ts:96` (`precoDoFabricante`)
- **Test:** `test/domain/llm/sugestao-do-catalogo.spec.ts` (alias, free, subscription, openrouter without a suggestion, exact equality); `test/domain/llm/precos-do-fabricante.spec.ts` (repeated id, future date, invalid price, link outside the domain)
- **Origin:** AT-640

### RN-966 — 9Router 0.5.112 does three things behind the scenes: `off` turns off RTK/Headroom/Caveman/Ponytail and not the Custom Prompt; Claude's OAuth redacts the reasoning; and it disguises the tools {#rn-966}

- **Rule:** completes [RN-909](#rn-909) with what the 0.5.112 build of 9Router does behind the gateway, measured in the bundle and declared without new code. (1) The `x-9router-token-saver` header with value `off` (case-insensitive) turns off, together, RTK, Headroom, Caveman and Ponytail; the Custom Prompt does NOT go through it and stays as the panel left it. The provider sends the header on every call, and the effect is confirmed by the measurement of AT-631 (`ok` without it = 1,262 tokens). (2) For Claude's OAuth account (`cc/*`) 9Router sends `redact-thinking-2026-02-12` in `Anthropic-Beta`: the thinking comes back redacted and without `reasoning_tokens`, so the stream's reasoning count ([RN-915](#rn-915)) and the retry without reasoning ([RN-916](#rn-916)) go blind on that path, and `reasoning_tokens` records absent ("did not say", [RN-666](#rn-666)). (3) With an `sk-ant-oat` token 9Router renames the tools, adds about 20 fake Claude Code tools and sends Claude Code headers; there is no configuration that turns this off. Brabo neither fixes nor turns off the disguise: the risk is the model calling a fake tool and the terms of use, and that is why TP-01 went back to OpenRouter.
- **Where:** `src/infrastructure/llm/nine-router-provider.ts:38` (`NINE_ROUTER_TOKEN_SAVER_HEADER`), `src/infrastructure/llm/nine-router-provider.ts:172` (`nineRouterConfig`)
- **Test:** `test/infrastructure/llm/nine-router-provider.contract.spec.ts:140` (header `off` fixed in the contract). Effects (2) and (3) live in 9Router's bundle, not in the repository: there is no test for them, and the smoke with a key is the only one that would exercise them.
- **Origin:** AT-641 (EP-026), survey of 31/10 on 9Router 0.5.112 (`chunks/8895.js`, `chunks/8499.js`, `chunks/2380.js`, `chunks/2598.js`), derived from AT-631.

### RN-969 — The agent's window occupancy in the session is the `input_tokens` of its last call, excluding Jev {#rn-969}

Completes [RN-101](#rn-101) (consumption per agent) without a new route: `GET projects/:projectId/sessions/:sessionId/token-usage` now brings `lastCall` per agent.

1. **Last call.** `lastCall = { inputTokens, modelName, contextWindow }` is the most recent `token_usage` row of the agent in the session; its `input_tokens` is what it put in the window.
2. **Jev out.** Rows with `model_name = MODELO_DO_JEV` are ignored (it records on behalf of the agent, ADR 0179); an agent with only Jev has `lastCall: null`.
3. **The window of that call's model** (LEFT JOIN `models`), not the current binding's. A null `context_window` becomes `contextWindow: null`: "I do not know", never 0%.
4. **The sums do not change**, and no new request is born (RN-632).
5. **Where the screen shows it (owner's decision, 02/11).** In the Session topbar, next to the budget meter, for the composer's RECIPIENT agent: a trigger in percentage (`—` with a null window, never 0%) and a card "N of M tokens on the last call · model". It reads the SAME `queryKey` `['session-token-usage', …]` of `session-destinatario.ts`, with no poll of its own; with no call, no recipient or 403, nothing appears.

- **Code:** `src/infrastructure/persistence/drizzle/token-usage.repository.ts:155` (`sumBySessionGroupedByActor`); `apps/web/src/routes/JanelaDoAgente.tsx:12` (`JanelaDoAgente`); `apps/web/src/lib/session-destinatario.ts:223` (the `actorId` is the same id that feeds the recipient options)
- **Test:** `test/infrastructure/persistence/token-usage.repository.spec.ts` (lastCall: last call, Jev ignored, null window, actor with only Jev); `apps/web/src/routes/SessionTopbar.test.tsx` (percentage, null window, no call)
- **Origin:** AT-654

### RN-983 — The click on a consulted source is recorded in a table of its own and is never a vote {#rn-983}

- **Rule:** the click on a link in the "Consulted in this turn" block (RN-982) becomes a row in `source_clicks`, with PROJECT scope like `rag_searches` (RN-479): `projectId`, `sessionId` (nullable), `eventId` (the `agent.response`), `tipo`, `ref`/`searchId`/`chunkId` and the user who clicked, frozen with no session/event FK. It is NOT a vote: the only truth signal of the RAG remains `rag_feedback` (RN-480), which this table never feeds, because a click measures curiosity. `POST /projects/:projectId/source-clicks` is `viewer` (whoever reads can click). Recording the measurement never brings down what it measures: the failure becomes a log of origin `infra` and an explicit `null`, and the click navigates all the same. On the web, the click fires the POST without waiting for the response (one POST per click, no poll nor new query, RN-579); a source that is only text does not record.
- **Where:** `src/application/use-cases/rag/record-source-click.use-case.ts:18` (`execute`), `src/db/schema/rag.ts:299` (`sourceClicks`), `src/interfaces/http/rag/source-clicks.controller.ts:36` (`registrar`), `apps/web/src/lib/api-client.ts:1456` (`sendSourceClick`).
- **Test:** `test/application/use-cases/rag/record-source-click.use-case.spec.ts`, `apps/web/src/components/ai-elements/sources.test.tsx` ("RN-983"), `test/interfaces/route-surface.spec.ts`.
- **Origin:** AT-716 slice 4 (EP-031).

### RN-984 — Quick access by role only exists with `BRABO_AMBIENTE=local` {#rn-984}

`GET`/`POST /auth/dev-login` list the roles and issue the session of an account
`<role>@brabo.dev` (`owner`, `maintainer`, `developer`, `viewer`) without a
credential. They only exist when `BRABO_AMBIENTE=local` AND the image carries no
mark or carries `local` (ADR 0245): otherwise the module is not registered and
the route gives 404. The Actions image is built marked `dev` or `prd`, so not even
`BRABO_AMBIENTE=local` in the `.env` turns it on. The route resolves only the
role's fixed e-mail, issues through the same `EmitirSessaoUseCase` as login,
audits `dev_login` and, on the installation, guarantees the accounts with a
discarded RANDOM password in a workspace of their own (RN-546 stays intact: there
is no known password). With no user at all on the installation it answers 409.

- **Where:** `src/infrastructure/security/ambiente.ts:13`
  (`acessoRapidoLigado`), `src/interfaces/http/acesso-rapido/acesso-rapido.controller.ts:34`
  (`AcessoRapidoController`), `src/application/use-cases/acesso-rapido/acesso-rapido.use-case.ts:27`
  (`AcessoRapidoUseCase`)
- **Test:** `test/infrastructure/security/ambiente.spec.ts`,
  `test/interfaces/http/acesso-rapido/acesso-rapido.http.spec.ts`,
  `test/application/use-cases/acesso-rapido/acesso-rapido.use-case.spec.ts`,
  `scripts/ci/ambiente-nas-actions.spec.ts`, `e2e/testes/autenticacao.spec.ts`

### RN-986 — The chat attachment accepts text/code and image, with the type taken from the bytes and ceilings {#rn-986}

- **Rule:** `POST /projects/:projectId/sessions/:sessionId/attachments` (`developer`, JSON `{nome, base64}`) stores the file in `chat_attachments`. The MIME comes from the BYTES, never from the name nor the header: png, jpeg, gif and webp by signature; text/code if it is valid UTF-8 and has no NUL byte (`text/plain`); the rest is 415. Ceilings: 5 MB per image and 512 KB per text, above that 413 (rejects, never truncates). A closed session refuses with the 409 `sessao_encerrada` of RN-581. JSON with base64 instead of multipart because 5 MB become ~6.7 MB and fit in the 10 MB body (`main.ts`), with no new parser. No antivirus, a gap declared in `docs/security-surface.md` and in ADR 0246.
- **Where:** `src/domain/sessions/anexos.ts:32` (`classificarAnexo`), `src/application/use-cases/sessions/anexos-do-chat.use-case.ts:37` (`enviar`), `src/interfaces/http/sessions/attachments.controller.ts:54` (`enviar`), `src/db/schema/sessions.ts:303` (`chatAttachments`).
- **Test:** `test/application/use-cases/sessions/anexos-do-chat.use-case.spec.ts` ("RN-986"), `test/interfaces/route-surface.spec.ts`.
- **Origin:** AT-715 slice 1, lane L1 (EP-031), ADR 0246.

### RN-987 — The `chat.message` stores only the attachment's reference, never the bytes {#rn-987}

- **Rule:** `POST .../agents/:agent/message` accepts `anexos?: string[]` (ids), at most 4, all from the SAME session and by the SAME author — otherwise 400. The event records `anexos: [{id, nome, mime, tamanho}]`; the log is append-only and does not bloat with bytes. The same list of references travels to the engine in `anexos` (omitted when empty). Whoever needs the bytes (L2, the api on the call to the provider) reads them through `ChatAttachmentRepository`.
- **Where:** `src/application/use-cases/sessions/anexos-do-chat.use-case.ts:91` (`referencias`), `src/application/use-cases/agents/send-agent-message.use-case.ts:67` (`execute`), `src/infrastructure/http-clients/api-to-engine-client.ts:210` (`sendAgentMessage`), `src/interfaces/http/agents/dto/send-agent-message.dto.ts:34` (`anexos`).
- **Test:** `test/application/use-cases/sessions/anexos-do-chat.use-case.spec.ts` ("RN-987").
- **Origin:** AT-715 slice 1, lane L1 (EP-031), ADR 0246.

### RN-988 — Every project `viewer` reads the attachment, scoped to project and session {#rn-988}

- **Rule:** `GET .../attachments/:attachmentId` (`viewer`) returns the bytes with the recorded `Content-Type`, `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment` for what is not an image. The query matches id, project AND session: an attachment from another session or project is 404, the same as a nonexistent one. Whoever sees the event sees the attachment (owner's decision, 02/11). Attachments die with the session (cascade).
- **Where:** `src/application/use-cases/sessions/anexos-do-chat.use-case.ts:80` (`ler`), `src/interfaces/http/sessions/attachments.controller.ts:87` (`ler`).
- **Test:** `test/application/use-cases/sessions/anexos-do-chat.use-case.spec.ts` ("RN-988"), `test/interfaces/route-surface.spec.ts`.
- **Origin:** AT-715 slice 1, lane L1 (EP-031), ADR 0246.

### RN-989 — An image only goes to a model with proven vision; without it, the agent is warned {#rn-989}

- **Rule:** the `llm-turn` accepts in a message's `content` a list of parts `{type:'text',text}` and `{type:'anexo',id}` (the engine sends the id, never bytes). The api swaps the id for the attachment of the SAME session (`ChatAttachmentRepository.find`): an image becomes an `image` part (data URL in the OpenAI format) ONLY when the provider declares `capabilities.vision` AND the model has `supports_vision` — the two layers of ADR 0041; `vision` is born `false` in all of them and only becomes `true` with a real smoke: today it is `true` ONLY on OpenRouter, PROVEN on 2026-11-03 by `test/infrastructure/llm/openrouter-provider.visao.smoke.spec.ts` (AT-715) with `google/gemini-2.5-flash` and an 8x8 red PNG — the model answered "red". The other ten stay `false`. Without both, the image does not leave the api and in its place goes the text `[imagem <nome> não enviada: o modelo atual não lê imagem]`, which is the warning to the agent. A text attachment goes delimited (`[anexo: <nome>]` … `[fim do anexo: <nome>]`) with or without vision; an id that does not resolve becomes `[anexo <id> indisponível]`. Plain text remains `string`. The image's tokens enter the metering through the provider's `usage` (ADR 0188), with no new code.
- **Where:** `src/domain/llm/anexos-no-turno.ts:23` (`resolverAnexos`), `src/application/use-cases/llm/run-llm-turn.use-case.ts:173` (`resolverAnexos`), `src/application/use-cases/llm/stream-llm-turn.use-case.ts:186` (`resolverAnexos`).
- **Test:** `test/domain/llm/anexos-no-turno.spec.ts`, `test/infrastructure/llm/openai-compatible-provider.visao.spec.ts`; capability proof: `test/infrastructure/llm/openrouter-provider.visao.smoke.spec.ts` (manual, with a credential).
- **Origin:** AT-715 slice 1, lane L2 (EP-031), ADR 0246.

### RN-991 — A message may have several recipients, and the log says which {#rn-991}

- **Rule:** `POST /projects/:projectId/sessions/:sessionId/messages` (`developer`) receives `destinatarios` (1 to 7) and records ONE `chat.message` with `payload.destinatarios`; an agent's route only records `[agent]`. Each agent receives the delivery with the SAME `mensagemId`, through the usual path (turn, RN-673 queue, the engine's named refusal). Whoever the engine refuses comes back as `recusada` with `motivo`, without bringing the others down; a closed session is 409 `sessao_encerrada` (RN-581). With the `mensagemId` shared, `chat.message_delivered` and `chat.message_cancelled` only close the copy of the agent they refer to. Revises RN-584/631.
- **Where:** `src/application/use-cases/agents/send-agent-message.use-case.ts:96` (`executeVarios`), `src/interfaces/http/agents/agents.controller.ts:115` (`messages`), `apps/engine/lib/engine/agents/fila_de_mensagens.ex:76` (`pendentes`).
- **Test:** `test/application/use-cases/agents/send-message-to-agents.use-case.spec.ts`, `apps/engine/test/engine/agents/fila_de_mensagens_test.exs`.
- **Origin:** AT-717 (EP-031), ADR 0247.

### RN-993 — The model's reasoning is recorded whole outside the `content`, appears live and only `developer` or above reads it; it never goes back to the model {#rn-993}

- **Rule:** the provider returns the reasoning TEXT as a `reasoning` chunk (OpenRouter's `delta.reasoning`, the DeepSeek/vLLM dialect's `delta.reasoning_content`, Anthropic's `thinking_delta`) and never in the `content`. The `stream-llm-turn` forwards each piece as a `raciocinio` frame and the `final` frame carries `raciocinio` with the WHOLE text of the step, with no cut; the non-stream `llm-turn` returns the same field. Anthropic receives `thinking` when the model reasons and reasoning was not turned off: `adaptive` with `display: "summarized"` and without `budget_tokens` in the current models (4.6 onward and the 5 family; the default `display` would return empty text, and the text that arrives is a SUMMARY, never the raw one), `enabled` with `budget_tokens` in the old ones (`pensamentoAdaptativo`, `src/infrastructure/llm/anthropic-provider.ts:395`); `reasoningOff` does not send `thinking`. The signed `thinking` blocks come back in `message.thinkingBlocks` so the engine returns them intact in the `assistant` turn that asked for tools. The engine records the text in `agent.response.payload.raciocinio` (the engine's lane) and it does not enter rehydration, the RAG nor the graph. The session's event reads (`GET .../events`, `GET .../events/:eventId` and Anamnesis's event by id) remove `payload.raciocinio` from `agent.response` for an effective role below `developer` (`projectRole ?? workspaceRole`, RN-471), through ONE output filter. The `reasoningText` capability is `false` in all providers until there is a smoke with a credential (ADR 0041).
- **Capability:** `reasoningText` is `true` only in Anthropic and OpenRouter, PROVEN with a real credential on 2026-11-03: `anthropic-provider.raciocinio.smoke.spec.ts` (`claude-haiku-5-5` and `claude-sonnet-5-5`, output 0 in both; the text is the reasoning SUMMARY, `display: summarized`, never the raw one) and `openrouter-provider.raciocinio.smoke.spec.ts` (`deepseek/deepseek-r1-0528`, `deepseek/deepseek-r1` left OpenRouter and gives 404). The other nine providers stay `false`; turning on another requires the equivalent smoke with a credential.
- **Where:** `src/infrastructure/llm/openai-compatible-provider.ts:381` (`textoDoRaciocinio`), `src/infrastructure/llm/anthropic-provider.ts:484` (`toThinkingBlocks`), `src/domain/sessions/raciocinio-do-evento.ts:16` (`filtrarRaciocinio`), `src/interfaces/http/sessions/sessions.controller.ts:260` (`listEvents`), `:333` (`getEvent`), `src/application/use-cases/sessions/create-socket-ticket.use-case.ts:69` (`podeVerRaciocinio` in the socket ticket, column `session_socket_tickets.pode_ver_raciocinio`, which the engine reads when consuming it, RN-108). Engine (AT-676): `RaciocinioDoTurno` accumulates the turn's reasoning and `TextoDoTurno.payload_do_turno` records it as `raciocinio`/`raciocinioTotal` outside the `content`; it returns the `thinkingBlocks` in the `assistant` message with `toolCalls` (`apps/engine/lib/engine/agents/raciocinio_do_turno.ex:34` (`anexar_blocos`)); the stream's `raciocinio` frame becomes the ephemeral event `agent.reasoning_delta` (`apps/engine/lib/engine/sessions/engine_api_client.ex:1841` (`consume_sse`)); and the `intercept` of the `session:<id>` channel only delivers the delta, and only leaves `raciocinio` in the `agent.response`, to the socket whose ticket has `pode_ver_raciocinio` (`apps/engine/lib/engine_web/channels/session_channel.ex:42` (`handle_out`)). A missing or null column counts as false.
- **Test:** `test/infrastructure/llm/raciocinio-texto.spec.ts` (the two fields, `thinking_delta`, adaptive/summarized × enabled by model, blocks returned in the next body, `reasoningText` false), `test/domain/sessions/raciocinio-do-evento.spec.ts` (`viewer` does not receive, `developer`+ receives), `test/application/use-cases/sessions/create-socket-ticket.use-case.spec.ts` (ticket `true` for `developer`, `false` for `viewer`), `test/application/use-cases/llm/stream-llm-turn.use-case.spec.ts` and `run-llm-turn.use-case.spec.ts` (`raciocinio` frame, `final` with the whole text, `content` intact); manual smoke `openrouter-provider.raciocinio.smoke.spec.ts`. Engine: `apps/engine/test/engine/agents/raciocinio_do_turno_test.exs` (frame accumulates and `final` replaces, payload with `content` intact, rehydration without reasoning, `thinkingBlocks` on the 2nd call) and `apps/engine/test/engine_web/channels/session_channel_test.exs` (`intercept` with and without the flag).
- **Origin:** AT-676 (EP-031), api lane; ADR 0249.

### RN-995 — The agent catalog comes from the engine and is read-only: identity and tools from the engine, current instruction from the database, no composed prompt and no schema, and engine down is "I do not know", never "no tools" {#rn-995}

- **Rule:** `GET /projects/:projectId/agent-catalog` (`viewer`, RN-102) returns, per agent, the code's identity, the project's CURRENT instruction (`agent_instructions`, only the current version) and the tools (`nome` and `descricao`, the pt-BR text the model reads; the other languages fall back to it, ADR 0216). The source of the tools and the identity is the engine, through `GET /internal/agents/catalog` (service token) — a single source, no copy in the api. It does not expose `parameters` (the JSON schema), the turn's composed prompt, the graph template nor credential or model. It is the FULL catalog: Jev's per-step cut (RN-625) may show less to the model. A contained read (ADR 0060): one call to the engine and one query to the database, no free parameter; `conteudo` cuts at 8,000 characters with `conteudoTotal` (the model of RN-589) and `descricao` at 1,000. Engine down: `identidade` and `ferramentas` come `null` with `motivoSemCatalogo: 'engine_indisponivel'` and the instructions from the database keep coming (RN-470). The per-module dev agents (`dev-api`) inherit the engine's single `dev-*` entry. In the engine: `GET /internal/agents/catalog` (service token, no parameter) returns, per agent, the code's identity and the tools (`nome`, `descricao` up to 1,000 characters). The source is each of the seven conversational agents' `tool_specs/0` and the execution and gate registries; nothing is copied. It does not return `parameters`, the composed prompt nor the graph template. It is the FULL catalog: Jev (RN-625) cuts the menu per step. Psychologist and Anamnesis are left out.
- **Where:** `src/application/use-cases/agents/get-agent-catalog.use-case.ts:39` (`execute`), `src/infrastructure/http-clients/api-to-engine-client.ts:280` (`getAgentCatalog`), `src/interfaces/http/agents/agent-catalog.controller.ts:32` (`get`); engine side: lane E1 of AT-686 (`Engine.Agents.CatalogoDeFerramentas`); engine: `apps/engine/lib/engine/agents/catalogo_de_ferramentas.ex:38` (`listar`), `apps/engine/lib/engine_web/controllers/agent_catalog_controller.ex:9` (`index`), `apps/engine/lib/engine_web/router.ex:79`, `apps/engine/lib/engine/agents/po_server.ex:824` (`tool_specs`).
- **Test:** `test/application/use-cases/agents/get-agent-catalog.use-case.spec.ts` (join, ceilings, `dev-*`, engine down), `test/interfaces/route-surface.spec.ts` (the route and the role); engine: `apps/engine/test/engine/agents/catalogo_de_ferramentas_test.exs` (matches each source, description ceiling, 401 without a token and 200 with).
- **Origin:** AT-686 (EP-031), lanes A1 (api) and E1 (engine).

### RN-997 — The Anthropic catalog is born with a dated list price and the SDK's `supportsReasoning`; a manual price is never overwritten {#rn-997}

- **Rule:** Anthropic's `/v1/models` does not report a price, and the synced model was born with price 0 (a zero-cost spend, with no warning). `listModels` returns the price from the manufacturer's SINGLE table of [RN-965](#rn-965) (`precoDoFabricante`, micro-USD per million), matching by ID and, if not found, by the ID without the date suffix (`-YYYYMMDD`); an ID outside the table stays without a price ([RN-042](#rn-042)). `supportsReasoning` comes from the SDK's `capabilities.thinking.supported`; with null `capabilities` the family applies (every `claude-` that is not 3.x reasons). The sync treats the price as it already did (RN-044): a `manual_pricing` row always wins, and a new model WITH a list price is born `manual_pricing = false`. The price frozen in the metering does not change. An old row already `manual_pricing = true` (born without a price) stays as it is: correcting it is the `owner`'s curation.
- **Where:** `src/infrastructure/llm/anthropic-provider.ts:492` (`precoDeLista`), `src/domain/llm/precos-do-fabricante.ts` (`PRECOS_DO_FABRICANTE`, `precoDoFabricante`), `src/application/use-cases/llm/sync-model-catalog.use-case.ts` (`resolverPreco`).
- **Test:** `test/infrastructure/llm/anthropic-provider.catalogo.spec.ts` (price with and without date suffix, unknown ID without a price, `supportsReasoning`); `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts` (a manual price is not overwritten).
- **Origin:** owner's request of 03/11; ADR 0251 (references [0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)).

### RN-1000 — On direct Anthropic, reasoning off is PER MODEL, the adaptive one gains the headroom and `thinking_tokens` reaches the metering {#rn-1000}

- **Rule:** revises [RN-741](#rn-741) and [RN-782](#rn-782)/[RN-783](#rn-783) for the `anthropic` provider. The sentence of RN-741 "the direct `anthropic-provider` does not send `thinking`, so the model does not reason" became false: in ADAPTIVE-thinking models (the 5.5s) omitting `thinking` is adaptive at the default effort, and Haiku 5.5 thought up to `max_tokens` with reasoning "off" (TP-01 of 05/11: 10 of 10 tasks blocked with "reasoning-only response"). (1) With `reasoningOff` the body is PER MODEL (`raciocinioDesligado`, owner's decision of 05/11): Haiku 5.5 → `thinking: { type: 'disabled' }` (really off, with no headroom); Sonnet 5.5 → `thinking: { type: 'between_tools' }` (thinks only between tool calls, with headroom); Opus 5.5 → `output_config: { effort: 'low' }` with headroom, DECLARED as REDUCED, not off — `disabled` is a 400 on Opus and on Sonnet 5.5; an unknown adaptive model → nothing (the model's default) with the headroom, because reducing requires proof; an old model (3.x, 4.0..4.5) without `thinking` does not think, and omitting is already turning off. (2) With reasoning on in the adaptive one, `max_tokens` is the visible output + `reasoningBudget ?? 4096` — the same headroom as RN-741, because there the ceiling is TOTAL (before, it stayed 4096 TOTAL and Infra was cut off). (3) The provider declares `aceitaRaciocinioDesligado: true` ([RN-916](#rn-916)). (4) `reasoningTokens` comes from `usage.output_tokens_details.thinking_tokens` of the last `message_delta` (SDK 0.113 does not copy it to the final message), only when it is an integer >= 0; otherwise it is omitted and the column stays NULL ([RN-666](#rn-666)).
- **Proof (paid smoke of 05/11, `ANTHROPIC_TEST_KEY`):** Haiku/Sonnet/Opus 5.5 with `reasoningOff` and a tool: accepted, called the tool, did not truncate, `thinking_tokens` 0; `thinking: disabled` on Opus 5.5 → 400 (`"thinking.type.disabled" is not supported for this model`); Haiku 5.5 on: 303 of 308 output tokens were reasoning; swapping the `system` between two rounds resending the reasoning block was ACCEPTED. Cost: ~US$ 0.009.
- **Where:** `apps/api/src/infrastructure/llm/anthropic-provider.ts:521` (`corpoDeRaciocinio`), `:562` (`raciocinioDesligado`), `:583` (`tokensDeRaciocinio`), `:80` (`aceitaRaciocinioDesligado`)
- **Test:** `apps/api/test/infrastructure/llm/raciocinio-texto.spec.ts` (body per model with `reasoningOff`, headroom in the adaptive one and with a budget, `thinking_tokens` from the `message_delta` and omitted when it is not an integer >= 0, the capability), `apps/api/test/infrastructure/llm/anthropic-provider.raciocinio.smoke.spec.ts` (manual, skips without the key)
- **Origin:** AT-739 (EP-030), findings 2 and 8 of TP-01 of 05/11; ADR 0257 (revises item 4 of [ADR 0223](../adr/0223-orcamento-de-raciocinio-por-modelo.md) for Anthropic).

### RN-1001 — The tracing decorator forwards `aceitaRaciocinioDesligado`, so the retry without reasoning really runs {#rn-1001}

- **Rule:** revises [RN-916](#rn-916), whose text said the provider capability `aceitaRaciocinioDesligado` was "today only OpenRouter". It now holds for OpenRouter and Anthropic ([RN-1000](#rn-1000)). Defect declared: `TracedLLMProvider` forwarded only `name`, `capabilities`, `chat`, `listModels` and `embed`; since the registry wraps EVERY provider, `provider.aceitaRaciocinioDesligado` was `undefined` in production and the RN-916 retry never ran, for any provider. The decorator now copies the flag from the wrapped provider in its constructor (`undefined` stays `undefined`: a provider that does not declare it does not expose it). The other optional members of the `LLMProvider` port (`listModels`, `embed`) were already forwarded.
- **Code:** `apps/api/src/infrastructure/llm/traced-llm-provider.ts:78` (`aceitaRaciocinioDesligado`)
- **Test:** `apps/api/test/infrastructure/llm/traced-llm-provider.spec.ts` (keeps `true`, stays `undefined`, and the real `LLMProviderRegistryImpl.get('anthropic')` returns `true`)
- **Origin:** AT-743 (EP-030)

### RN-1002 — The agent closes the open question the user answered in chat; the human answer and the agent share one core {#rn-1002}

- **Rule:** extends [RN-858](#rn-858)/[RN-860](#rn-860) (ADR 0214, owner decision of 05/11: the agent closes). `POST /internal/projects/:projectId/open-questions/:questionId/answer` (service token) takes `{ sessionId, agentId, resposta?, messageEventId? }` and writes the SAME `artifact.decision_record` + `open_question.answered` pair as the click, through one shared core (`fechar`), then resumes the parked QA gate of each affected task. `respondidaPor` is the author of the chat session (`sessionId`); the agent goes in `viaAgente` (and `messageEventId` when sent). Without `resposta` the question suggestion is the answer; with neither, 400. Unknown question, a question of another project, or a session outside the project: 404. Already closed: `200 { status: 'already_answered' }`, never 409 (idempotent for the agent). The human `responder` is unchanged (`so_o_autor_da_sessao`, 409).
- **Where:** `apps/api/src/application/use-cases/backlog/perguntas-em-aberto.use-case.ts` (`responderPeloAgente`, `fechar`), `apps/api/src/interfaces/http/internal/internal-open-questions.controller.ts`.
- **Test:** `apps/api/test/application/use-cases/backlog/perguntas-em-aberto.use-case.spec.ts` (closes with `decision_record`, 404 for another project, second call `already_answered`).
- **Origin:** AT-741 (EP-030), finding 4 of the TP-01 of 05/11; engine side is RN-1003.

### RN-1004 — The Dev Lead's execution plan is refused when a module with no task is a dependency of a module that has one {#rn-1004}

- **Rule:** extends [RN-678](#rn-678). `lerPlanoDeExecucao` now receives the current `module_map` WITH each module's `dependsOn`, not just the names. After the per-task checks, if a module with NO task in the plan appears in the `dependsOn` of a module that HAS a task, the plan is refused with 400 `plano_de_execucao_invalido`, naming the pair: "deploy depende de api, que ficou sem tarefa — crie a tarefa de fundação de api". A leaf module without a task stays legitimate ([RN-709](web.md#rn-709)); the check runs at proposal and at approval, like the rest of the reading.
- **Code:** `apps/api/src/domain/execution/plano-de-execucao.ts` (`lerPlanoDeExecucao`), `apps/api/src/application/use-cases/execution/execute-execution-plan.use-case.ts` (`lerPlano`)
- **Test:** `apps/api/test/domain/execution/plano-de-execucao.spec.ts` (`fundação com dono`: the plan without `db`/`api` is refused naming `deploy` -> `api`; with a task in `db`, `api` and `deploy` it passes)
- **Origin:** AT-742 (EP-030), TP-01 finding 9 of 05/11; ADR 0259.

### RN-1005 — The claim does not hand out a module's task while a task of a module in its direct `dependsOn` is open {#rn-1005}

- **Rule:** extends [RN-678](#rn-678). `claimNext` skips the `todo` queue for module M while any task NOT `done` belongs to a module listed in the `dependsOn` of M in the project's current `module_map` (the same source as [RN-1004](#rn-1004)). Only the DIRECT dependencies count (no transitive walk); a task without `module` counts for the module of a single-module story, as in the claim itself. Without a `module_map`, or when M is not in it, the claim behaves as before. The agent's own orphaned `in_progress` task ([RN-856](#rn-856)) is not affected.
- **Code:** `apps/api/src/infrastructure/persistence/drizzle/backlog.repository.ts` (`claimNext`, `semDependenciaAberta`)
- **Test:** `apps/api/test/infrastructure/persistence/drizzle/backlog-claim-depends-on.repository.spec.ts` (open task in `api` -> `deploy` gets nothing; `api` done -> it gets the task; direct only; no map)
- **Origin:** AT-742 (EP-030); ADR 0259.

### RN-1007 — Claude Haiku 5.5 on Anthropic direct has a curated reasoning allowance of 12288 tokens {#rn-1007}

- **Rule:** revises [RN-1000](#rn-1000), whose adaptive allowance defaults to 4096 when `models.reasoning_budget` is NULL. At the default, a reasoning gate on `claude-haiku-5-5` got `max_tokens` 4096 + 4096 = 8192 total and was cut off while still thinking (TP-01 round 25, `qa-estrategia`: 8192 of 8192 output tokens spent reasoning), including a cut WITH text that [RN-916](#rn-916) does not retry. Curated data per [ADR 0223](../adr/0223-orcamento-de-raciocinio-por-modelo.md): migration `0083` sets `reasoning_budget = 12288` on the `anthropic` / `claude-haiku-5-5` catalog row, so adaptive `max_tokens` = visible output + 12288 (16384 at the default 4096). No code change: `corpoDeRaciocinio` already reads `reasoningBudget`. The migration is idempotent and touches no other model (not the same name under another provider, not other Anthropic models). With NULL the allowance falls back to 4096 (8192 total). Not adopted: `effort: low` on the gates (the docs warn the agent skips checks) and turning the budget into `effort`.
- **Code:** `apps/api/src/db/migrations/0083_folga_do_haiku_5_5.sql`, `apps/api/src/infrastructure/llm/anthropic-provider.ts` (`corpoDeRaciocinio`)
- **Test:** `apps/api/test/db/folga-do-haiku-migration.spec.ts` (only that row, idempotent), `apps/api/test/infrastructure/llm/raciocinio-texto.spec.ts` (12288 gives 16384 and `adaptive`; NULL gives 8192), `apps/api/test/infrastructure/llm/anthropic-provider.folga.smoke.spec.ts` (manual, paid, skipped without a key)
- **Origin:** AT-743 (EP-030), owner decision of 05/11 (allowance 12288, ceiling 16384).

### RN-1008 — The direct Anthropic provider uses prompt caching, sums the cache parcels into the input and prices the call from the vendor table {#rn-1008}

- **Rule:** revises [RN-892](#rn-892) item 1 (`promptCaching` was "only OpenRouter") and completes [RN-666](#rn-666) for the direct Anthropic provider. Measured in TP-01 (25th, 05/11): 463 calls, 10.12 M input tokens, `cached_input_tokens` = 0, US$ 2.28 of the US$ 2.62 total was input. (1) `system` goes out in up to two blocks: the PREFIX (the `system` messages before the first non-system one) carries `cache_control: {type: "ephemeral"}` (TTL 5 min); the TAIL (late `system` messages, hoisted to the top by this dialect) follows without a point. Text and order do not change. (2) One more point goes on the last block of the last `user` turn (tool results are `user` turns), mirroring [RN-892](#rn-892); an empty text gets no point. (3) `usage`: Anthropic's `input_tokens` is only the NON-cached part, so `inputTokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens` and `cachedInputTokens = cache_read_input_tokens`; without the fields `cachedInputTokens` is absent ("did not say", [RN-666](#rn-666)). (4) Cost (owner's option A, ADR 0188): when any cache parcel is non-zero the provider emits `costMicros` from the four parcels times `precoDoFabricante(model)`: input 1x, cache read 0.1x (0.05x on Opus 5.5), cache write 1.25x, output 1x; the api records it with `priceImplicit` and `catalogCostMicros`. A model outside the table emits no cost ([RN-042](#rn-042)); with no cache parcel the catalog path already gives the same number. (5) `capabilities.promptCaching` is `true`, proven by `anthropic-provider.cache.smoke.spec.ts` before merge.
- **Code:** `apps/api/src/infrastructure/llm/anthropic-provider.ts` (`blocosDeSistema`, `marcarCacheDaConversa`, `usageDeEntrada`)
- **Test:** `apps/api/test/infrastructure/llm/anthropic-provider.contract.spec.ts` ("prompt caching (RN-1008)": blocks and points, last user point, usage sum, cost by four parcels, out-of-table model); smoke `anthropic-provider.cache.smoke.spec.ts` (manual)
- **Origin:** AT-744 (EP-030)

