---
sidebar_position: 8
---

# Triaged backlog

Output of **FASE 13c**. Gathers the open findings from real execution
([achados-execucao-real.md](achados-execucao-real.md)) and the older items
that were scattered across ADRs and CLAUDE.md.

> This is a **proposal**. The classification and grouping below are an
> argument about what costs more to wait on; the priority decision belongs
> to the user.

> [!warning] Historical — do NOT read this as the live queue
> This is the FASE 13c triage, and it has not been kept in step with the
> repository. Measured on **2026-09-12**: at least **twelve** items still
> presented here as open **no longer reproduce** — the executor isolation
> (`terminal_executor.ex` refuses a missing container), the per-aggregate
> schema (ADR 0121), the semantic-gate golden set (ADR 0123), the
> `git_local_repos` backup, the install compose, "FASE 29 is planning-only",
> Dependabot, two runbook gaps, and alert severity, among others.
>
> The defect is **cadence, not content**: phases were closed without anyone
> coming back here to mark them. What survives — and what this file is worth
> keeping for — is the **reasoning** of the triage: why each item costs more
> to wait on than to do. Treat every state below as **unverified until
> re-measured**.

## How it's classified

**P1** — blocks the product from doing what it promises. **P2** — the
product does it, but lies or confuses whoever's looking. **P3** — quality,
with no one stuck.

**Cost**: P (one session), M (one small phase), G (its own phase, with an
ADR).

**Risk of waiting** is the column that breaks ties: a defect that corrupts
data or erases evidence costs more later than now; a cosmetic one costs
the same either way.

## The board

| proposed phase | items | prio | cost | risk of waiting |
|---|---|---|---|---|
| ~~A — Unblock the task~~ | ~~ADR 0052, O/B~~ | **DONE** | — | RN-072 and RN-073 |
| ~~B — Engine on a remote provider~~ | ~~N~~ | **DONE** | — | RN-076; ADR 0056 accepted |
| ~~F — Executor boundary and cap~~ | ~~S, U~~ | **DONE** | — | RN-074 and RN-075; ADR 0055 accepted |
| ~~C — The UI can't lie about agents~~ | ~~C, I, H, L, G~~ | **DONE** | — | all five items |
| ~~D — The wizard tells the truth and has an exit~~ | ~~D, E, F~~ | **DONE** | — | RN-078; E and F were already done |
| ~~G — The failure outcome tells the truth~~ | ~~P, Q, T~~ | **DONE** | — | RN-077 |
| ~~H — Session state doesn't lie~~ | ~~V~~ | **DONE** | — | RN-064 extended |
| ~~E — Quality of what agents produce~~ | ~~K, R, J~~ | **DONE** | — | RN-079, RN-080 and RN-081 |
| ~~— standalone~~ | ~~promotion-check with no spec~~ | **DONE** | — | 10 cases, mutation-verified |
| ~~I — The dev agent starts from zero~~ | ~~X, Y~~ | **DONE** | — | RN-085; Y closed in 13b, X in FASE 14d |

**Coverage: 19 of 19** of the real-execution findings, plus **eight new
ones** (W, X, Y, Z, AA, AB, AC, AD, AE) from the FASE 13b validation — see
[validacao-real.md](validacao-real.md).

Of these, **five closed**: W, Y, AA, AB and AC within 13b itself, and X via
FASE 14d ([RN-085](../business-rules/custo.md#rn-085)) — the iteration cap became
per agent TYPE, which was the shape the triage had proposed and the product
decision that was missing.

**Three remain open**, and none is a bug to fix:

| finding | what it is | why it isn't a fix |
|---|---|---|
| **Z** and **AD** | the verb allowlist doesn't converge — verb, form and invocation are distinct spaces | the allowlist does exactly what it promises, and the refusal of `bash` proves the boundary holds. It's a PRODUCT decision about policy by agent profile, with an ADR |
| **AE** | the QA agent tries to fix the code it's judging | nothing leaked: blocked by two independent barriers. The data point is the divergence between what the prompt asks and what the model does |

13b's practical conclusion has already been implemented and awaits
nothing: the path isn't loosening policy, it's making the agent WAIT for
the decision instead of dying
([ADR 0057](../adr/0057-o-gate-espera-a-aprovacao.md), extending 0052).

The phase letters (A–H) and the finding letters (B–V) collide by
inheritance from the two lists; where there's ambiguity the text says
"finding."

Two items left the open list since the first triage: **A**
([RN-067](../business-rules/custo.md#rn-067)) and **M**
([RN-066](../business-rules/custo.md#rn-066)), both closed and confirmed in
production. And **ADR 0052**, which was half of Phase A, was implemented
and proven by test — the wake delivery was fixed and covered end to end
afterward.

The rest (older items) is under [Older backlog](#older-backlog), with no
priority assigned: these are product decisions, not defects.

---

## Phase A — Unblock the task (P1) — **DONE**

**No dev agent had ever finished a task.** That was the fact that ordered
everything: the gate registry from FASE 15a shows `qa-verificada`,
`secops-segura` and both infra gates as *"never passed"* — not for lack of
execution, but because there was never a PR for any gate to judge.

| item | what it was | how it closed |
|---|---|---|
| **ADR 0052** | pending approval returned `status pending` as the tool's result and burned an iteration; the agent died at the cap without writing anything | the loop SUSPENDS and resumes ([RN-073](../business-rules/custo.md#rn-073)); the outcome delivery was fixed later — the event was born in an aggregate the engine's drain didn't read — and the path is now covered end to end |
| **O / B** | the session and dev agents were born on local `llama3.2:1b`, which ADR 0020 forbids in the semantic step | when the cascade lands on the workspace default, the inherited model is the **Creative agent's** ([RN-072](../business-rules/custo.md#rn-072)) |

The inheritance fills the **gap** and never overrides: session, agent or
project binding are explicit choices and still win. And the inherited
model goes through the same cascade filters — missing from the catalog or
without tool calling is not inherited.

Closing this phase **wasn't** enough, and that's its most useful finding:
the agent started walking and died of something else (Phase F, the
`413`). *"No dev agent had ever finished a task"* remained true — what
changed was the reason.

**Risk of waiting: high.** Until this closes, remote PR, QA/SecOps gates
and 13b's measurement stay dammed up behind it — and every dogfooding
round spends money just to reconfirm the same blockage.

## Phase B — Engine on a remote provider (P1) — **DONE**

**N** — `get_local_repo_path/1` returned `unsupported_provider` for
anything other than `local`, and four consumers stopped along with it. The
**api** speaks GitHub over HTTP; the **engine** works on the file system
and only knew local bare repos, so a remote project ran the conversational
half and stalled in the build half.

Closed via [ADR 0056](../adr/0056-o-engine-trabalha-em-repositorio-remoto.md)
and [RN-076](../business-rules/custo.md#rn-076): the engine requests the working
remote from the api, which holds the master key, and the credential comes
in **per invocation** — the origin recorded in `.git/config` is wiped.

**The finding that shrank the problem:** two of the four consumers never
actually needed a credential. `Diff` and `ProjectContext` only use the
branch NAME — they were stalling as collateral damage from a function
returning more than they'd asked for.

### What Phase B did NOT close

- **Isolation**, again. The token left the disk, but the agent still runs
  in the same container as the Brabo monorepo. It's the same pending item
  ADR 0055 already declared, and it now has two phases pointing at it.
- **Proof against a real GitHub.** `fetch` and `push` go through `GitAuth`,
  and the tests cover the local path end to end (a push that arrives at
  the other side's bare repo) and the named errors. What no test can give
  is a real remote repository with a real token — that's 13b's execution,
  which now has a way to happen.

## Phase F — Executor boundary and cap (P1) — **DONE**

The `hello-limpo` execution died here, and both items shared the same
root: the terminal executor had no limit — neither on **where** a command
could reach, nor on **how much** it returned.

| item | what it was | how it closed |
|---|---|---|
| **S** | accumulated context overflowed the provider's byte limit and the call came back `413`. Every terminal output stayed in the history and traveled along in every subsequent turn | a byte cap in the executor, with a marker addressed to the model ([RN-074](../business-rules/custo.md#rn-074)) |
| **U** | `/workspace` inside the executor is the **Brabo monorepo itself**, and `/data/project-workspaces/*/` grants access to other projects' worktrees | path scope in the decision ([RN-075](../business-rules/custo.md#rn-075), [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) accepted) |

Scope closed both sides at once: it **tightened** (an allowed verb
pointing outward stopped auto-approving) and it **loosened** (`cd`ing
inward stopped rejecting the composite command, which was the ladder's
most expensive defect).

### What Phase F did NOT close

Recorded here rather than declared done:

- **Isolation.** ADR 0055 is policy, and says so of itself. As long as the
  Brabo monorepo is mounted in the container that executes the commands,
  the boundary depends on the rule getting it right. Normalization is
  lexical: `..` is rejected, a symlink pointing outward from inside isn't
  detected.
- **ADR point 6 — generalizing "always allow."** Still records the literal
  command, which never matches again. It wasn't included because
  generalizing EXPANDS what a click authorizes (approving `cat foo` would
  end up allowing `cat` on anything), and that's a product decision that
  deserves its own scrutiny rather than a free ride.
- **ADR point 7 — the event recording which scope authorized it.** The
  decision's reason already says so, but it isn't persisted in
  `proposed_action.created`.

## Phase C — The UI can't lie about agents (P2) — **DONE**

Five items with the same root: the screen told a different story than
the event log.

| item | what the screen does | state |
|---|---|---|
| **C** | the live bubble comes labeled with the **model**; the agent only appears once the persisted event arrives — and the message stays duplicated until reload | **DONE** — the delta now carries the agent, and the refetch is deferred while the turn is streaming |
| **G** | the Creative agent's invitation doesn't appear on a created project, because the thread already has the bootstrap cards | **DONE** — the condition became "the conversation started," not "the thread is empty" |
| **L** | the footer button still reads "I'm ready to produce" after the handoff out of the Creative agent | **DONE** — it disappears once there's a handoff leaving the Creative agent |
| **H** | bootstrap events all appear as "activity in system" | **DONE** — the five types got their own family, with the step translated |
| **I** | changing the session's model retroactively rewrites old actions' labels | **DONE** — the card stopped asserting a model it has no way of knowing |

**C** was the most severe of the five and was flagged by you during the
run: it's the agent that speaks, the model is an execution detail.

**I deserved a decision, not just a fix.** The card received the
session's CURRENT model, and there's no source of truth for the model per
action — `proposed_actions` doesn't store it, and `token_usage` isn't
linked to the action. Between making one up and no longer asserting one,
the second is the only honest choice: who proposed it is already on the
card, in bold, and it's the **agent**, which is the part that doesn't
change. The label went away along with the prop, which was left with no
other consumer.

**H** turned into copywriting: the five `bootstrap.step_*` types got
their own family with the step translated into Portuguese, and only
`step_failed` is marked as bad — `degraded` and `skipped` are expected
outcomes, and painting them red would teach people to ignore red.
`create_rc_branch` still gets translated even though it's retired
(ADR 0030), because projects bootstrapped before have the event in the
log.

## Phase D — The wizard tells the truth and has an exit (P2) — **DONE**

| item | what it was | how it closed |
|---|---|---|
| **D** | `Protect branches` fails on a private repo on the free plan, and the wizard **warns about it beforehand**. The only action offered afterward was "Try again," which always fails | [RN-078](../business-rules/custo.md#rn-078) |
| **E** | the repository preview lied: `repo: brabo/{slug}` hardcoded, with the real owner coming from the PAT | already done (commit `4dd7a073`) — the label now shows only the slug, which is what's actually known |
| **F** | the "Branch policy" step listed `rc` among the permanent branches | already done (commit `4dd7a073`) |

**E and F were already fixed** by the time I went after them, in a commit
that closed four findings at once. Discovering that cost a read; the
backlog didn't know because it was written earlier.

**Item D was bigger than the description suggests.** It wasn't just "a
dead-end screen": `provision_failed` makes the dashboard **redirect the
project's click back to the provisioning page**, so the project became
unreachable forever, stuck on a step that can never succeed. The exit
needed a route, a use case and an event — not just a button.

**Only the protection step can be acknowledged**, and that's the decision
that matters: it's the last step and the only one whose failure still
leaves a usable repository. Offering "continue" on an earlier failure
would be a second lie on top of the first.

## Phase G — The failure outcome tells the truth (P2) — **DONE**

The same CLAUDE.md rule violated three times: **P** (`dev.blocked` with
`origin: null`), **Q** (`agent.error` with `"undetermined"`) and **T**
(a recurrence: `dev.blocked` with `"undetermined"` on a failure whose
`diagnosis` field named the cause on the SAME line).

Closed via [RN-077](../business-rules/custo.md#rn-077), and the root-cause
diagnosis is what changed the shape of the fix: **the classifier already
existed and would already have gotten it right** —
`FalhaDeTurno.origem/1` maps status ≥ 400 to `codigo`, which correctly
classifies finding T's `413`. The defect was never a missing rule; it was
`block_task` having `"undetermined"` as its **default**, with the call
sites passing nothing.

So the fix is structural, no longer another rule: **the default is
gone.** Forgetting the origin is now a compile error, instead of a
syntactically valid, semantically empty event.

`indeterminada` no longer exists. It meant *the classifier didn't
recognize this shape* — a gap in our own code —, and `codigo` is the
origin that points to the right action. `indeterminada` pointed to none,
which was exactly the finding's complaint.

## Phase H — Session state doesn't lie (P2) — **DONE**

**V** — session `1f94de49` showed `closed` since 23:34:42 and execution
kept going until 00:56.

The cause wasn't the state machine: it was **the heartbeat**. The session
was born at 23:34:12 and closed at 23:34:42 — exactly the 30s of
`SESSION_HEARTBEAT_TIMEOUT_MS`. [RN-064](../business-rules/custo.md#rn-064)
already required checking for pending work before closing, but "pending
work" only meant a **`offered` handoff** — and there was a `pending`
action since 23:34:13, created one second after the session was born.

An action awaiting a decision now counts. It's the same defect one level
below the handoff: someone is waiting on **you**, and an agent may be
suspended waiting on the outcome ([RN-073](../business-rules/custo.md#rn-073)).

**The rule's earlier version said, in writing, that including agent work
"without a test proving the interaction would be guessing."** The
execution produced the proof, and that's what separates this fix from a
guess.

### What Phase H did NOT close

- **A task `in_progress` with no pending action and no handoff.** The
  signal would require the api to read `dev_agent_states`, which belongs
  to the engine — a boundary decision, not a passing fix.
- **`closed` still accepting approval.** With the heartbeat fixed, the
  session stops closing with a dangling action, so the case becomes rare.
  Blocking the decision on an already-closed session is a behavior change
  with its own consequence: an orphaned action from an already-closed
  session would have no one left to decide it.

## Phase E — Quality of what agents produce (P3)

| item | what happens |
|---|---|
| **K** | running the Creative agent twice on the same project left 10 rules, 5 orphaned — no dedupe or warning |
| **R** | the PO generated two stories covering the same endpoint |
| **J** | the Psychologist runs on a freshly opened session with the previous session's hypotheses and an empty log, tries to cite non-existent events and gives up |

**DONE**, with a declared cut in the middle.

**J was mechanism, contrary to what this section assumed.** An empty log
is a verifiable condition, and the defect was in the count that decided
whether it was worth running: it summed the bootstrap's machine steps
and — worse — the trail the Psychologist itself leaves in the session
while analyzing it, which made an empty session look populated starting
from the first analysis, and more populated with every retry. Closed via
[RN-079](../business-rules/custo.md#rn-079), with the finding's session
reproduced as a test.

**K and R were the same prompt, and that's why they only closed as far as
code can reach.** An EXACT duplicate rule is refused at emission
([RN-080](../business-rules/custo.md#rn-080)); a story with an identical title
is refused and one that adds no coverage becomes a warning
([RN-081](../business-rules/custo.md#rn-081)) — a warning, not a block, because
a second cut of the same rule can be legitimate and it's the user who
judges.

What was **not** resolved, and is written into the three RNs instead of
left implicit: semantic duplicates. The exact pair from finding R —
"Deterministic public greeting endpoint" and "Public GET /hello endpoint
that returns an immediate greeting" — still gets through, because nothing
mechanical links the two. There's a test asserting this limit, so it's a
visible decision rather than a forgotten gap.

## Standalone

~~**`promotion-check` with no spec of its own**~~ — **DONE**. It was the
only required check in the family without a test (`pr-police`,
`approval-ladder` and `gate` all have one). Found while writing the gate
registry (FASE 15a, PR #145).

`scripts/ci/promotion-check.spec.ts` covers both pure functions, asserting
the RULE and not the implementation: which stamp each destination
requires (`qa` requires `dev`, `main` requires `qa`, `dev` requires
nothing), and what counts as a stamp for **that specific** commit — a tag
on another commit doesn't count, a tag for another stage doesn't count,
and a tag that failed to resolve a sha doesn't count as a stamp by
default. It's this set that keeps `qa` from receiving code that never
went through `dev`.

~~**The four sibling secrets of the production compose**~~ — **DONE**
([RN-114](../business-rules/custo.md#rn-114)). `AUTH_JWT_SECRET`,
`BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY` and `SECRET_KEY_BASE` had
development defaults in `docker/docker-compose.prod.yml`, which runs with
`NODE_ENV=production` — the same pattern
[ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md) had
already closed for `GIT_OAUTH_STATE_SECRET`, for the same reason: the
value is public, it's in this repository.

The worry recorded below — that each one deserved its own decision —
wasn't pointing at four different DECISIONS, only at three checks living
in different places: `passphraseAtual()` (`auth-key-material.ts`),
`tokenDeServicoAtual()` (`service-token.ts`) and the
`EnvelopeEncryptionService` constructor, each with the SAME rule as
`resolveOauthStateSecret()` (missing/example/short crashes the boot in
production). `CREDENTIALS_MASTER_KEY` refusing to BOOT isn't the same
problem it feared — it doesn't touch rotation at all, which still exists
via `CREDENTIALS_MASTER_KEY_PREVIOUS` + `rewrap-deks.ts`; the check only
stops the example key from reaching production. `SECRET_KEY_BASE` already
had the right `raise` in `runtime.exs` — the real defect was the compose
masking it with a public fallback, and the fix was just removing that
fallback, without touching any Elixir code.

~~**External review 2026-08-28, item #13 — dev containers ran as root**~~ —
**DONE**. `docker/api/Dockerfile`, `docker/web/Dockerfile` and
`docker/engine/Dockerfile` had no `USER` directive, so everything they
wrote to the bind mount (`node_modules`, `apps/api/dist`, and whatever an
agent generates inside a project in `mounted` execution mode) landed
root-owned on the host — the README and this doc's getting-started guide
both documented a manual `sudo chown -R $USER ...` workaround instead of
fixing the class of problem. `Dockerfile.prod` images were already
non-root; this was dev-only.

The fix maps the container's user to the HOST's UID/GID instead of running
as root and cleaning up after: `DEV_UID`/`DEV_GID` build args (read from
`.env`/the environment via `docker-compose.yml`, default `1000`/`1000`),
named `DEV_*` on purpose because `${UID}` is read-only in bash and isn't
exported to the environment by default — reading it straight from the
compose file would always see empty. Each Dockerfile creates a
group/user with that UID/GID only when it doesn't already collide with
one the base image ships (`node:24-alpine` already has `node` at 1000:1000)
and switches with `USER <uid>:<gid>` — numeric, so it doesn't matter which
username ends up owning that id. All root-only steps (`apk add`, `pip
install`, the gitleaks/hadolint/actionlint downloads) stay BEFORE the
switch; in the engine image, `_build`/`deps`/`.mix`/`.hex` — homed under
`/root` because `mix local.hex`/`mix local.rebar` write there, mounted as
named volumes by `docker-compose.yml` — are `mkdir`+`chown`'d to the target
UID/GID before `USER`, so a brand-new named volume inherits the right owner
on first mount (Docker populates a new volume from whatever already exists
at that path in the image).

Proven by running the real stack (`DEV_UID=$(id -u) DEV_GID=$(id -g)
docker compose -f docker/docker-compose.yml up --build postgres api web
engine`): all three containers came up with zero `EACCES`/permission
errors, and `apps/api/dist` on the host ended up owned by the host user,
not root. One real wrinkle, not a blocker: named volumes created by an
environment that predates this fix (`*_node_modules`, `engine_build`,
`engine_deps`, `engine_mix`, `engine_hex`) still hold content written by
the old root containers — upgrading needs a one-time `chown` of that
existing volume data (or dropping the volumes with `docker compose down
-v` and letting the next `up` recreate them), documented in the README and
getting-started guide alongside the `DEV_UID`/`DEV_GID` instructions.

---

## Older backlog

Items that already existed before this round. These aren't defects, they
are deferred product decisions — hence no priority here.

| item | where it was decided |
|---|---|
| ~~Budget per area~~ | **FIXED AND CLOSED.** `agent_areas` gained `budget_micros`/`spent_micros` — a THIRD independent ceiling next to project/session, additive (not the ADR 0064 cascade), mirroring `max_parallel`'s pattern on the same row ([RN-443](../business-rules.md#rn-443), [ADR 0110](../adr/0110-budget-por-area-aditivo-nao-cascata.md)) |
| Dev Lead and `module_map`-based areas | **left the backlog**: ADR 0053, implemented by FASE 14d |
| ~~Manual handoff to an agent of choice~~ | **CLOSED** — [ADR 0109](../adr/0109-handoff-manual-a-agente-a-escolha.md)/[RN-440](../business-rules.md#rn-440)/[RN-441](../business-rules.md#rn-441). `SessionPage.tsx` gained a picker over `addressableAgents()` (leads ∪ solo agents) POSTing to `POST .../sessions/:sessionId/handoffs` — the SAME `CreateHandoffUseCase` an agent's own `offer_handoff` uses, with `actor: {kind:'user'}` recording who decided. The Staff (ADR 0088) and `ux-designer` (ADR 0087), both found reachable only via the internal route, entered `AGENTES_DE_CHAT` in the same change |
| MFA, social login, OIDC, federation | [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) — social login (GitHub/GitLab) LEFT the ban and is implemented (ADR 0084); the rest stays out of scope |
| Deploy (`DEPLOY_ENABLED` + Environments) | the `operavel` gate is already declared `planned` |
| Return of `rc`/`rcfix` | [ADR 0030](../adr/0030-politica-de-branches-mecanizada.md) |
| ~~Community mode of the approval-ladder~~ | **FIXED AND CLOSED.** The reference "becomes a change to `aprovacao_humana` in the gate registry" was imprecise — it came from a speculative sentence in ADR 0054, not from something actually missing. The `community` mode is already implemented and tested since FASE 6 (`scripts/ci/approval-ladder.ts`), just switched off by `APPROVAL_MODE=solo` (default); `aprovacao_humana` for the `aprovacoes-da-escada` gate is already `true` in both modes, with no `APPROVAL_MODE` awareness in the schema. What was genuinely missing was the `TODO(humano)` in `branching-policy.md` — the criterion for who joins each approver list —, closed by `GOVERNANCE.md` (repository root). Actually activating the mode remains an operational decision (recruiting real people for the three roles), not an engineering pending item |
| ~~Currency preference with manual exchange rate~~ | **WON'T DO** — decision recorded. Converting would require a manually-maintained exchange rate, which ages; a wrong number is worse than an honest USD number (same principle already applied in `formatarCustoMicros`, `ProjectSettingsTab.tsx`) |
| Reactivate the Anamnese (`ANAMNESE_ENABLED=true`) | paused by user decision on 2026-08-10 — "today it isn't bringing much-value data" ([RN-115](../business-rules/autenticacao.md#rn-115)). No data was erased (hypotheses, proficiency profiles and instruction patches remain intact and visible); the pause is only on the new-round PATH, awaiting future refinement of what Anamnese derives before turning it back on |
| Reactivate the Psychologist (`PSYCHOLOGIST_ENABLED=true`) | paused by user decision on 2026-08-10, same reason and same pattern as Anamnese above ([RN-117](../business-rules/autenticacao.md#rn-117)). No data was erased (already-emitted analyses and hypotheses remain intact and visible); the pause is only on the new-round PATH (automatic and on-demand) |
| One-line installation, and signing what we publish | picked up by **FASE 29** ([fase-29-instalacao-de-uma-linha.md](fase-29-instalacao-de-uma-linha.md)), which is planning-only so far — nothing here is closed. FASE 28 refused the one-line installer in writing while artifacts stay unsigned (**BRB-005**), so the phase signs first and installs second. Planning measured three things this file did not record: `docker-compose.prod.yml` has no `ghcr.io` reference at all and calls itself the validation compose, so a new install compose is needed; `make test-restore` is a Kubernetes path and `backup.sh` covers only Postgres, so migrating a compose install had no proven route; and **`git_local_repos` — the bare repos of `local`-provider projects — is in no backup anywhere**, which is code loss on volume loss, in every environment. The BRB ids now have a canonical home in [the BRB register](../reference/brb.md), where three of the six items this phase inherited turned out to be already fixed — discoverable only by measuring, which is the argument for the register existing |
| Problems/lint/tests panel in the Code tab | declared pending in FASE 26 (`CLAUDE.md`) alongside blame, PR list and branch detail — those three closed in FASE 26b, this one didn't and was never picked up again. No data source exists yet (no lint/test-runner integration in the product); recorded here so it isn't silently dropped from tracking |

## Backlog of the runner/execution_mode (ADR 0104)

First finding of the "two ADRs diverging from each other" kind recorded in
this document — the table precedents below (the `fluxo.yml`×code audit,
already closed) were always doc-declarative × code, never ADR × ADR. The
table's shape is reused; the kind of finding is new.

**The divergence, closed by [ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
— reconciliation ACCEPTED, Wave 1 (RN-421/422/423) DONE:**

| # | Severity | Item | Evidence (file:line) |
|---|---|---|---|
| 1 | **CLOSED** (RN-423) | RN-170 required bind-mount at creation; RN-420 routed to the runner under the same `workspace_mode == 'local'` flag, with no bind-mount at all | `apps/api/src/application/use-cases/iam/confirm-project-workspace.use-case.ts` (the runner confirms and becomes the source of truth); `apps/engine/lib/engine/actions/terminal_executor.ex` (`decisao_de_execucao/1`, four outcomes — explicit refusal without a verified workspace/connected runner, never a fallback to the container) |
| 2 | **CLOSED** (RN-422) | The wizard only taught bind-mount, never the runner command, even though it already existed | `apps/web/src/routes/NewProjectWizard.tsx` — third entry in `MODOS_DE_WORKSPACE` (`runner`), with the command `brabo-runner --project <id> --dir <pasta>` right in the "Where the code will live" step, not just in the Terminal |
| 3 | **CLOSED** (RN-421) | A 2-value enum (`workspace_mode`) didn't express 3 physically distinct execution modes | `apps/api/src/db/migrations/0048_quiet_iron_fist.sql` (`project_execution_mode`, three values); `apps/api/src/domain/iam/project.entity.ts` (`PROJECT_EXECUTION_MODES`) |

**Correction recorded during Wave 1's implementation, CLOSED separately**
(not itself one of this document's numbered runner waves — see below):
item 4 of ADR 0104 stated that converting between the three modes of an
EXISTING project "becomes allowed without recreating the project." Wave 1
found that incorrect — `UpdateProjectDto` still deliberately excluded
`executionMode`/`workspacePath`, and only the three-value field at
CREATION had actually been delivered. **[ADR 0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md)
makes the sentence TRUE again**, via a dedicated route (`PUT
.../execution-mode`, `ConvertProjectExecutionModeUseCase`, RN-447..450) —
not by editing ADR 0104's accepted text, which stays as it was written,
wrong at the time and corrected here instead:

| item | cost | activation criterion | where it was decided |
|---|---|---|---|
| ~~Converting `execution_mode` on an EXISTING project, without recreating it~~ | **CLOSED** (RN-447..450) | — | [ADR 0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md) |

**Wave 2 — PAT, [ADR 0105](../adr/0105-personal-access-token-do-runner-escopado-por-construcao.md), DONE (RN-424/425/426; RN-427 closed later, same decision wave):**

The "long-lived account token" item in the original table had TWO textual
errors, corrected during implementation instead of being followed
blindly — recorded here because the table below repeated them:

1. **"argon2 hash in the database" was wrong.** The product's real
   pattern for a HIGH-entropy secret (256 bits of CSPRNG) is
   HMAC-SHA256 + pepper via `hashDeToken()`/`TokenFactory` — the same
   mechanism as refresh tokens and account tokens. Argon2 is for a
   LOW-entropy secret (password), where dictionary resistance matters;
   here it would just break the indexed lookup `WHERE token_hash = $1`
   for no gain.
2. **"reusing the refresh-token-family rotation infrastructure" was
   imprecise.** A PAT is presented repeatedly WITHOUT CHANGING — never
   consumed-and-reissued like a refresh token. Only the generation
   (`TokenFactory.gerar()`) and the hashing are reused; the whole
   family/rotation would be inventing a behavior the PAT doesn't need.

| # | Severity | Item | Evidence (file:line) |
|---|---|---|---|
| 1 | **CLOSED** (RN-424) | The PAT needed to authenticate `runner-ticket` without becoming a valid credential for any other route of the user | `apps/api/src/interfaces/http/auth/pat-route.decorator.ts` (`@RequirePatAuth()`), `apps/api/src/interfaces/http/auth/jwt-auth.guard.ts` (third early-out), `apps/api/src/interfaces/http/auth/pat-auth.guard.ts` (`PatAuthGuard`, applied only to `runnerTicket`) |
| 2 | **CLOSED** (RN-425) | High-entropy token validation without leaking which of the three refusal reasons (nonexistent/revoked/expired) applies; `last_used_at` not regressing on a legitimate reconnection | `apps/api/src/infrastructure/persistence/drizzle/personal-access-token.repository.ts` (`validarEUsar` — a single conditional UPDATE, no throttle on the same WHERE) |
| 3 | **CLOSED** (RN-426) | Issuing/revoking/listing without leaking one user's token to another | `apps/api/src/application/use-cases/auth/*-personal-access-token*.use-case.ts`, scoped by `userId` in the query's WHERE |
| 4 | **CLOSED** (RN-427) | `maintainer` revoking ANOTHER user's PAT (incident response — a dev leaving with a leaking token), declared out of scope at the time | `apps/api/src/application/use-cases/auth/*-personal-access-token-as-maintainer.use-case.ts`, `apps/api/src/interfaces/http/runner/personal-access-tokens.controller.ts` (`listAllPats`/`revokePatAsMaintainer`, separate routes, `@RequireRole('maintainer')`), scoped by `projectId` in the query's WHERE |

`apps/runner/src/auth.ts` completely lost interactive login, cookies and
`~/.brabo/runner-credentials.json` — it only validates the format and
passes through `--token`/`BRABO_ACCOUNT_TOKEN`, never written to disk by
the CLI.

**Wave 3 — npm distribution, [ADR 0106](../adr/0106-distribuicao-do-runner-via-tsup-e-npm-publish.md), DONE:**

| # | Severity | Item | Evidence (file:line) |
|---|---|---|---|
| 1 | **CLOSED** | `apps/runner` was `"private": true`, with `bin` pointing at a raw `.ts`, reachable only by cloning the monorepo | `apps/runner/tsup.config.ts` (`format: cjs`, `external: ['node-pty']`), `apps/runner/package.json` (`bin` → `dist/index.cjs`, `publishConfig.access: public`), `.github/workflows/publish-runner.yml` (publishes on every final tag, its own workflow, parallel to `release.yml`) |

Real finding during implementation, tested empirically before it went
into the code: the obvious fix for `index.ts`'s auto-run guard
(`import.meta.url === pathToFileURL(argv[1]).href`) was BROKEN in exactly
the case this wave exists to enable — invocation via the installed `bin`
(`npm install -g` creates a symlink, and `process.argv[1]` is never
resolved by realpath while `import.meta.url` always is). The final fix
applies `realpathSync` to `argv[1]` before comparing — see ADR 0106.

**Wave 4 — standalone binary, [ADR 0112](../adr/0112-binario-standalone-do-runner-via-bun-build-compile.md), DONE with an honest per-platform gap:**

| # | Severity | Item | Evidence (file:line) |
|---|---|---|---|
| 1 | **CLOSED** | `node-pty` resolves its native `.node` addon by a path COMPUTED at runtime — `bun build --compile` can't embed what it can't statically resolve, confirmed empirically (build succeeds, runtime throws `Cannot find module`) before designing a fix | `apps/runner/src/native-pty-loader.ts` (real extraction to `fs.mkdtempSync`, preserving `node-pty`'s original relative layout, then `import()` by absolute path — never `require('node-pty')` by package name); `apps/runner/scripts/build-bin.mjs` (generates `native-pty-embed.generated.ts`, one static `with { type: 'file' }` import per file, the only form Bun accepts for embedding) |
| 2 | **CLOSED** | `bun build --compile` silently bundled the FALLBACK `await import('node-pty')` (used only outside a compiled binary) and threw at runtime instead of at build time, wasting real debugging time on a misleading error before being isolated | `apps/runner/scripts/build-bin.mjs` (`--external node-pty` on the `bun build` invocation) |
| 3 | **CLOSED** | The ADR 0106 auto-run guard fix (`realpathSync` on `argv[1]`) throws `ENOENT`, uncaught, inside a compiled binary — `process.argv[1]` there is `/$bunfs/root/<name>`, a virtual path `realpathSync` can't resolve | `apps/runner/src/index.ts` (checks `import.meta.url.includes('/$bunfs/')` FIRST, runs `main()` unconditionally in that case) |
| 4 | **PARTIAL — the BUILD half is now proven, the ATTACH half is not** | Only `linux-x64` had been validated by REAL execution in this sandbox (`build:bin`+`smoke:bin` green, repeatedly, including the two bugs above found by running the real compiled binary); the other four were reasoned through by reading `node-pty`'s source, never executed on a real machine of that OS. The first real tag came on **2026-09-04 (`v4.0.0`)** and settled the build half: `linux-x64`, `linux-arm64`, `darwin-arm64` and `win32-x64` each built and passed `smoke:bin` on its native runner — **Windows included**, with its THREE native files and the `worker_threads` path, the likeliest candidate to break. What failed was the step AFTER the build, identically on all four: the attach ran ~3m25s before `release.yml` published the Release, so **no binary was ever attached to any Release**. `darwin-x64` (`macos-13`) never started at all — queued 40+ min, a separate and still uninvestigated question about that runner label. The attach now WAITS for the Release with a ceiling, so the next final tag is what proves the attach and `darwin-x64` | `.github/workflows/build-runner-binaries.yml` (5-target matrix, each on its own native runner; step "Anexar à GitHub Release" carries the measured race); ADR 0112's target-matrix table has the exact per-platform status |

No per-platform fallback (the cheaper "binary + `node-pty-native/` folder"
alternative, explicitly offered to and rejected by the product owner) was
implemented anywhere — nothing found in this investigation DISPROVED the
true single-file approach for any of the five targets. If a real tag build
shows one genuinely doesn't work this way (Windows is the likeliest
candidate), that becomes a NEW, single-platform item here — not something
to guess at and pre-emptively work around today. The `v4.0.0` build
answered that: no per-platform fallback is needed on the four that ran,
Windows included, and the single item it did produce is not per-platform
at all — it is the attach step racing `release.yml`.

**What's left for later — backlog prioritized by the product owner, in
this order:**

| item | cost | activation criterion | where it was decided |
|---|---|---|---|
| Runner exclusivity by `{project_id, machine_id}` instead of just `project_id` (`apps/engine/lib/engine/runners/registry.ex`) | M | DEFERRED — explicit activation criterion: a second dev actually using the same project simultaneously | ADR 0104 |
| Code-signing the standalone binaries (macOS notarization, Windows Authenticode) | M | operator action — needs the product owner to obtain/fund a signing identity, same category as `NPM_TOKEN` in ADR 0106 | ADR 0112 |
| Attaching the binaries to a Release, and `darwin-x64` running at all — the BUILD is proven on four platforms since `v4.0.0` (2026-09-04), the attach on none of them | — | happens automatically on the next `vX.Y.Z` tag, now that the attach step waits for the Release instead of reading its absence in the first instant. `darwin-x64` depends on a `macos-13` runner ever being scheduled | ADR 0112 |

`apps/runner/src/guard.ts` (best-effort lexical check of `cwd`) **is not
a backlog item** — it's an invariant declared since ADR 0103 and
REAFFIRMED by ADR 0104: the runner's real security boundary is
authentication + the usual approval pipeline + user consent, never
sandboxing.

## Backlog of the team model (ADR 0085) — AUDIT CLOSED

Output of the `fluxo.yml` × code audit
([auditoria-fluxo-vs-codigo.md](auditoria-fluxo-vs-codigo.md)). These were
items declared in the model (`docs/fluxo.yml`) about roles already
**active** — none was waiting for any `proposto`/`planned` role to
activate first. The plan's six waves closed, and this table is now
**empty**: the last item (B4, the PO reading `metricas-de-produto`)
closed with RN-407, no new ADR — the same pattern already established by
RN-164 (agent reads scoped to the project, no external effect). The audit
document has the full wave plan, with cost and verification criteria per
item, for anyone who wants the history.

**Closed since the audit** (not removed from the original reference, only
from this pending-items table): the `implementavel` gate (B3, ADR 0090);
`docs/gates.yml` out of date for `paralelismo-autorizado` (A1/B5, fixed
alongside A3–A5/A8 — wrong RN citations and labels in `fluxo.yml`); real
deployment frequency and lead time via `analise:funil` (part of B7, ADR
0089) — the rest of B7 (MTTR, change failure rate) didn't close: it
remains declared as a PERMANENT gap in `fluxo.yml` (role
`delivery-metricas`), not an engineering pending item; the Dev Lead →
dev delegation (B1) and RN-160 without backend revalidation (A6/B6) —
audit Wave 2, ADR 0094, RN-404/405; the `necessidade-validada` gate (B2)
— audit Wave 6 (the last), ADR 0095, RN-406; **product metrics → PO
(B4)** — the report (`analise:funil`, ADR 0089) already existed, all
that was missing was the PO READING `metricas-de-produto`; closed with the
`listar_metricas_de_produto` tool and the pure functions extracted into
`apps/api/src/application/services/funil-metrics.ts` (RN-407) — the
table's last pending item, closing the audit.

## External review backlog (2026-08-28)

An external, static-reading review (`melhorias-brabo-2026-08-28.md`,
working tree root, no suite executed) proposed 15 items. Checked against
this file, `architecture.md`'s
[technical debt table](../architecture.md#divida-tecnica),
[achados-execucao-real.md](achados-execucao-real.md), ADR 0020 and ADR
0027, plus the working tree itself. Same rule as the rest of this
document: **no P1/P2/P3 invented here** — cost below is the reviewer's
own estimate (P = one session, M = one small phase, G = its own phase
with an ADR), not a priority ranking, and the priority decision belongs
to the user.

### Genuinely new (no prior record anywhere)

| item | cost | evidence | note |
|---|---|---|---|
| ~~Checksum on CI-downloaded binaries (gitleaks, hadolint, actionlint, kustomize, kubeconform) + GitHub Actions pinned by commit SHA instead of tag~~ | P | `.github/workflows/ci.yml` had zero `sha256sum`/checksum verification; every action was pinned by mutable tag | **DONE** ([#408](https://github.com/daneiel/brabo/pull/408) + [#419](https://github.com/daneiel/brabo/pull/419)) — `sha256sum -c` after every `curl` in `ci.yml` and in `docker/engine/Dockerfile` (the dev image; `Dockerfile.prod` already did this). The pins took two PRs, and the reason is the finding: #408 moved the 9 actions **of `ci.yml`** to commit SHA and this row read as if that were all of them — the other 15 workflows stayed on mutable tags, including the four that carry credentials (`release.yml` → GHCR, `publish-runner.yml` → npm, `tag-release.yml`, `docs-deploy.yml` → `gh-pages`). #419 pinned the remaining 49 `uses:` and added the mechanism that was missing: `scripts/ci/actions-pinadas.ts` fails the `lint` job on any tag-pinned action, or any SHA without its version comment. Documented in [cadeia-de-suprimentos-do-ci.md](cadeia-de-suprimentos-do-ci.md), which also declares what is still trusted on faith (no Dependabot, no dependency provenance, no artifact signing) |
| ~~Pin `ollama/ollama:latest` in both composes~~ | P | `docker/docker-compose.yml:81,118` and `docker/docker-compose.prod.yml:328,346` were the only unpinned image in either file | **DONE** ([#401](https://github.com/daneiel/brabo/pull/401) + [#419](https://github.com/daneiel/brabo/pull/419)) — pinned to `ollama/ollama:0.33.1` in the 4 compose places; a **fifth** one, `deploy/k8s/base/ollama/job-model-loader.yaml`, was outside the reviewer's evidence (which only named the composes) and stayed on `latest` until #419 |
| ~~Generate `apps/web/src/lib/api-types.ts` from the OpenAPI export instead of hand-copying~~ | M | `apps/api/src/scripts/export-openapi.ts` exists; no `openapi:types` script and no `openapi-typescript` dependency anywhere; `api-types.ts`'s own header states it's hand-mirrored | **DONE** ([ADR 0116](../adr/0116-tipos-do-web-gerados-do-openapi.md)) — only `ActionType` migrated (the type with a proven, repeated production cost), not the whole file: `lib/api-types.generated.ts` is now generated by `openapi-typescript` from `docs/reference/openapi.json`, and `lib/api-types.ts` re-exports `ActionType` from it. `lib/aprovacoes.test.ts` stays, narrowed to content assertions the compiler can't make (exhaustiveness is now `tsc`-checked via `Record<ActionType, ...>`) |
| ~~Real-browser E2E (Playwright) for the critical path — cookie auth, CSRF, the Phoenix socket ticket, streaming~~ | M | no `playwright.config.*`, no `e2e/`, no `@playwright/test` dependency anywhere in the repo | **DONE** ([#420](https://github.com/daneiel/brabo/pull/420), [ADR 0120](../adr/0120-e2e-de-navegador-contra-o-compose-de-producao.md)) — `e2e/`, chromium only, running against the PRODUCTION compose `docker/smoke.sh` already brings up (`SMOKE_KEEP_UP=1`) and inside the same `images` job, since the four images are most of that job's wall clock. Two specs, both proven by mutation: the cookie/CSRF/cross-origin path (including survival across a reload, the only way to prove the in-memory access token was REBUILT from the cookie) and RN-108's single-use socket ticket, asserted on the observed WebSocket URL rather than on a status indicator. `e2e/` is not a workspace member — own lockfile, same shape as ADR 0117, for the same audit reason. Declared as NOT covered: cross-browser differences, inline approval and streaming |
| ~~Decompose `SessionPage.tsx` / `ProjectSettingsTab.tsx`~~ | G | `SessionPage.tsx` was 169 KiB with 25 test files importing it; `ProjectSettingsTab.tsx` was 90 KiB | **DONE** ([ADR 0122](../adr/0122-sessionpage-dividido-em-cinco-prs.md) + [ADR 0124](../adr/0124-hook-do-canal-de-turno-do-sessionpage.md) + [ADR 0125](../adr/0125-projectsettingstab-dividido-por-secao.md)) — the `SessionPage.tsx` half of this row is now COMPLETE across seven PRs total. ADR 0122's 5-PR mechanical decomposition merged one at a time (each before the next started, since the file was under active churn): PR 1 — pure timeline/turn helpers → `apps/web/src/lib/session-timeline.ts`. PR 2 — `StorySlide` → `apps/web/src/routes/StorySlide.tsx`. PR 3 — `StructuredQuestionCard` (plus its private helper `permiteOutra`) → `apps/web/src/routes/StructuredQuestionCard.tsx`. PR 4 — backlog-tree helpers (`urlDaPr`/`vinculoDeBacklog`/`montarArvoreDeBacklog`/`totalDeDescendentes`) → `apps/web/src/lib/session-backlog-tree.ts`, and `ItemDeBacklog` + `ContextAside` (the whole right-hand sidebar) → `apps/web/src/routes/ContextAside.tsx`. PR 5 — the six readiness derivations (`criativoActive`/`arquitetoActive`/`hasBusinessRule`/`hasPromotedStory`/`hasProductBrief`/`activeAgent`) → a `useSessionReadiness` hook in `apps/web/src/lib/session-readiness.ts`, the only PR of the five that wasn't a mechanical file move — declaring the turn-channel state cluster (`turnoViaCanal`/`statusAgent`/`pensandoVisivel`/`atividadeDoTurno`) explicitly out of scope, for its own future ADR. ADR 0124 is that ADR, two more PRs: a mechanical dedup PR (not itself ADR'd) that made `handleSend`/`handleReadiness`/`handleArchitectureReadiness` call the pre-existing `iniciarTurnoDoAgente`/`finalizarTurnoDoAgente` instead of duplicating their arm inline, then the extraction PR that moved the state, the `connectSessionHeartbeat` channel effect, and the three lifecycle functions into a `useTurnoDoAgente` hook in `apps/web/src/lib/session-turno.ts`. `SessionPage.tsx` went from 3 807 to 2 479 lines across all seven PRs; all 25 (now 24, one migrated to a `lib/` test in PR 1) `SessionPage.*.test.tsx` files passed unedited throughout. **ADR 0125 closes the row**, in ONE PR rather than five: `ProjectSettingsTab.tsx` (2 532 lines) splits into one file per section under `apps/web/src/routes/settings/` — 17 sections plus a two-symbol `settings/shared.ts` (`ORIGIN_TONE`, `formatarCustoMicros`; the other ten module-scope helpers had exactly one caller each and went into that caller's file) — and STAYS at its path as the entry and barrel, at 77 lines. The barrel is load-bearing, not cosmetic: `ProjectSettingsTab.test.tsx` imports 11 names from the path and `ProjectPage.test.tsx`/`project-tabs.test.tsx` both `vi.mock` it BY PATH. One PR and not five because the file was never shaped like `SessionPage.tsx` — the parent held nothing (17 JSX children, no hook, no query, no `t`, no role check), no section took more than `{projectId}` (two take no props), and 11 of the 17 were already exported. The 6 private sections gained an `export` on their own module (mechanical — the barrel has to import them) but are deliberately NOT re-exported by the barrel, so the tab's public surface is byte-identical in shape. Full web suite green — 142 files, 1 537 tests — with ZERO test files edited |
| ~~Cross-check pinned tool versions between `ci.yml` and `Dockerfile.prod` in CI itself~~ | P | `ci.yml:45-46` already asserted by comment that the versions must match, but nothing enforced it | **DONE** ([#408](https://github.com/daneiel/brabo/pull/408)) — new step in the `lint` job greps both files and fails on any `GITLEAKS_VERSION`/`HADOLINT_VERSION`/`ACTIONLINT_VERSION` mismatch |
| ~~Coverage floor (ratchet at the current value) in CI~~ | P–M | no `--coverage`/`--cover` flag and no threshold configured in any `vitest.config.*` or `mix.exs` across api/web/engine | **DONE** ([#410](https://github.com/daneiel/brabo/pull/410)) — floor set at the measured value (api 80/69/74/81, web 82/77/72/83, engine 78%, all vitest/`mix test --cover`); no `excoveralls` added, per the no-new-libs-without-justification rule |
| ~~Split `business-rules.md` by domain; extend `readme-version.ts`'s pattern to generate the RN/ADR counts in prose instead of hand-typing them~~ | M | `business-rules.md` is 650 KB with **334** `RN-XXX` headers going up to RN-466 — `README.md:200` still says "the 158 RNs," a far larger drift than aging text explains; the ADR count (115) in `README.md:211` is correct by comparison, so only the RN count needs fixing today | **DONE** ([#417](https://github.com/daneiel/brabo/pull/417) + [#418](https://github.com/daneiel/brabo/pull/418)) — in that order, and the order is the point: #417 taught `docs:check` to read the COUNT off the artifact (ADRs from the files in `docs/adr/`, RNs from the `### RN-NNN` headers, providers from the `capabilities` literals) and compare it against the prose, which is what stops the drift from coming back. #418 then split by **SIZE, not by subject** — Cost and Authentication alone were half the page — into `docs/business-rules/custo.md` and `docs/business-rules/autenticacao.md`, with not one comma of content changed and no `{#rn-NNN}` anchor renamed; 293 links were rewritten by script and the count still reads 334. The numbering never restarts per file, and the check sums the three by glob |
| ~~Unify `AGENTS.md`/`CLAUDE.md` (generation or symlink + check)~~ | P | not byte-identical as assumed — same size (35043 bytes), different MD5; one line already diverged (`AGENTS.md:444` vs `CLAUDE.md:444`, each self-referencing its own filename) | **DONE** ([#402](https://github.com/daneiel/brabo/pull/402)) — the self-referencing line was made neutral in both, then `AGENTS.md` became a symlink to `CLAUDE.md`; divergence is now impossible at the filesystem level, not just detected |
| ~~Repo hygiene: drop the leftover `KEYCLOAK_*` block from `.env` (already absent from `.env.example`) and retire `migrate-keycloak-users.ts`; move/archive `spike/session-engine` and `design_handoff_brabo/` out of the repo root; bind Neo4j's published ports to `127.0.0.1` in `docker-compose.prod.yml`~~ | P | Keycloak was removed since Phase 7 ([ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)); `docker-compose.prod.yml:80-82` published `7474`/`7687` unbound | **DONE** ([#403](https://github.com/daneiel/brabo/pull/403)) — script and its runbook section removed, `spike/`/`design_handoff_brabo/` removed from the tree (recoverable at commit `f5f771ac6`), Neo4j bound to `127.0.0.1` in prod. The `.env` `KEYCLOAK_*` cleanup itself is local/gitignored, not a repo change — still the user's to do |
| ~~Dev containers run as root; map the host uid/gid instead of the `sudo chown -R` workaround~~ | M | no `USER` directive in the dev Dockerfiles (api/web/engine); `README.md:160` and `getting-started.md` documented the workaround as accepted fact | **DONE** ([#406](https://github.com/daneiel/brabo/pull/406)) — see the detailed note in [Standalone](#standalone) above; `DEV_UID`/`DEV_GID` map the container to the host user, proven by running the real stack |
| ~~Give `website/` its own lockfile, outside the product's `pnpm audit`~~ | M | `website` is a `pnpm-workspace.yaml` member sharing the single lockfile; of the 13 security overrides, 8 trace to Docusaurus/website dependencies, 3 to the product side (`js-yaml` 5.x, `lodash`, `esbuild`), 1 is mixed (`undici`, also used by `apps/web`'s own `jsdom`) | **DONE** ([#414](https://github.com/daneiel/brabo/pull/414), [ADR 0117](../adr/0117-lockfile-proprio-para-o-website.md)) — auditing all 13 with `pnpm why <pkg> -r` found the split messier than this estimate: only 2 (`serialize-javascript`, `yaml@1.x`) were website-exclusive; 10, not 1, turned out mixed (`mermaid`/`dompurify`/`uuid`/`postcss`/`nanoid` also resolve through `apps/web`, `js-yaml`/`fast-uri`/`lodash` through `apps/api`) and stay duplicated in both `pnpm-workspace.yaml` and the new `website/pnpm-workspace.yaml`; `esbuild` was the only pure product-side one |

### Already-declared debt, still uncosted

These three already have a row in `architecture.md`'s
[technical debt table](../architecture.md#divida-tecnica) — the review
didn't discover them, it estimated a cost for something already on
record with none. **One of the three has since closed**, and it was the
one the review called the most expensive:

| debt | already declared at | reviewer's cost estimate |
|---|---|---|
| ~~Publish images to a registry so production deploy is executable end to end~~ | `architecture.md:552`, [ADR 0027](../adr/0027-fase5-backup-hardening-release.md) | **DONE** ([ADR 0119](../adr/0119-imagens-publicadas-no-ghcr-por-digest.md)) — the four images publish to GHCR (public) on every final tag, with what each tag published recorded BY DIGEST in `.release/images.json`; the overlay keeps the marker and `make imagens-do-release` applies it, so the repository never declares which release is in production. No third push exception: the file is a Release asset and rides the CHANGELOG PR. Found while doing it, and NOT in this estimate: the overlays listed three images, not four — the backup CronJob inherited `brabo-backup:prod`, unresolvable in any registry. Still not done and not claimed: nothing deploys automatically (`DEPLOY_ENABLED` still doesn't exist), and image signing/attestation stays out, with the runner binaries' code-signing item |
| Split `schema.ts` by aggregate (Drizzle supports multi-file schema with re-export) | `architecture.md:546` | M |
| Golden-set (5–10 cases, loose expected output, pinned model, allow-failure) for the gate's semantic path | `architecture.md:548`, [ADR 0020](../adr/0020-destravar-gates-qa-secops.md) | not estimated by the reviewer |

## What this triage does NOT do

It fixes nothing. The discipline that's held since Phase 10 continues:
each finding waits for the phase that addresses it, and fixing it outside
that phase erases the evidence of why it existed.

And it doesn't invent priority where there's no data: the items in the
older backlog got no P1/P2/P3 because their decision belongs to the
product, not to engineering — and a guess dressed up as a classification
would be worse than the raw list.
