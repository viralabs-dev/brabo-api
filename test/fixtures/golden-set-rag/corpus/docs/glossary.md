---
id: glossary
title: Glossary
sidebar_label: Glossary
sidebar_position: 9
description: Brabo's ubiquitous language — the terms that show up in the code, the screens, and the ADRs, with the meaning they carry here.
keywords: [glossary, ubiquitous language, harness, gate, handoff, DEK, outbox]
---

# Glossary

The terms below are **ubiquitous language**: the name shown on screen is
the same one in the code, in the event, and in the ADR. Several of them
exist elsewhere with a broader meaning — this page says what they mean
**in this system**.

Ordered by subject, because looking up "harness" without knowing it's an
agent concept is rare; the common path is arriving by topic.

---

## Session and event

**Session** — a conversation with effect, from start to close. It's the
unit of work, of cost, and of tracing: a session is a root trace in
observability and a budget scope. It moves through five states
([RN-001](business-rules.md#rn-001)).

**Event log** — the `session_events` table. Append-only: there's never an
`UPDATE`. Every row has a continuous `seq` within the session. It's the
source of truth for what happened, and what makes the Psychologist's
evidence traceable
([RN-002](business-rules.md#rn-002)).

**`seq`** — the event's order number within the session. Dense: starts at
1 and has no gaps. A gap in `seq` is corruption, and restore fails because
of it.

**`closing`** — a **transitional** state, not a resting one. A session
stuck in `closing` means the drain started and didn't finish; there's an
alert for that.

**Orphan** — a session `active` in the api with no live owner process in
the engine. It's the failure mode graceful shutdown exists to eliminate;
the operational definition is in the [runbook](runbook.md#quando-a-sessao-escapa).

**Outbox** — the *transactional outbox* pattern. The api writes the event
and the intent to publish it **in the same transaction**; the engine
consumes it later via Oban. It's what keeps "the event was written" and
"the engine found out" from ever diverging. There's no Redis — the queue
lives in Postgres.

---

## Agents

**Agent** — a long-running process with a role and an identity. Eleven
canonical roles today, defined in
`apps/engine/lib/engine/harness/agents.ex`:

| slug | role |
|---|---|
| `criativo` | runs ideation with the user and emits business rules |
| `po` | turns the brief into a backlog (epics, stories, tasks) with DoD and DoR |
| `arquiteto` | technical decisions (ADRs) and the module map |
| `dev-backend` · `dev-frontend` | implement; run in an isolated worktree |
| `infra` | provisioning, deploy, and environments — **proactive**, not an executor |
| `qa` | semantic gate: tests and acceptance criteria |
| `secops` | deterministic gate: secrets, security, compliance |
| `psicologo` · `psicologo-leve` | analyze sessions and propose hypotheses with evidence |
| `anamnese` | profiles the user's proficiency and proposes instruction patches |

The names are **product roles**, capitalized when used as a noun ("the
Architect proposed an ADR"). Devs are **dynamic**: one agent per
`module_map` module, not a fixed list.

**Area** (Phase 8b/8c, [ADR 0038](adr/0038-hierarquia-de-agentes.md)) —
`qa` and `infra` from the table above became area LEADs: they remain the
sole external contact (same slug, same behavior seen from outside), but
now **delegate** to subagents — `qa-automacao`/`qa-performance-seguranca`
(QA), `infra-workflows` (Infra). Delegation is an INTERNAL area mechanism,
never a handoff; what the area returns to the outside remains a single
artifact (`qa_verdict`, `open_infra_pr`) — the consumer never knows more
than one agent is behind it.

**Harness** — the mandatory wrapper for every agent. No LLM call or tool
call happens outside it. Five pieces:

| piece | does |
|---|---|
| **PromptAssembler** | builds the prompt in **ordered layers** with a token budget per layer and **deterministic** truncation — same context, same prompt |
| **ContextManager** | compacts when the context grows |
| **ToolLoop** | the tool-request → execution → result loop, with an iteration ceiling |
| **InstructionFiles** | resolves the `AGENTS.md` files in increasing precedence order (root → directory → database) |
| **Hooks** | interception points around the loop |

**Layer** (of the prompt) — a block with an `id`, content, and a
truncation policy (`truncate_tail`, `keep_or_drop`, `drop_whole_units`).
The budget is per layer, and that's what makes truncation predictable
instead of "whatever fits, fits".

**ToolLoop** — the agent's loop. A turn is: assemble the prompt → call the
model → the model requests a tool → the tool becomes a `proposed_action`
→ policy decides → executes → the result goes back into the context. It
has an iteration ceiling; once exhausted, the agent ends with a blocking
artifact.

**Turn (conversational agent)** — one round of work by one of the five
session-scoped conversational agents (Creative, PO, Architect, Dev Lead,
Staff — the last one from ADR 0088, dormant for automatic triggering, but
activatable via manual handoff): one streamed call to the LLM plus the
tool loop it triggers. Since [RN-122](business-rules.md#rn-122) it runs on
a supervised `Task` (`Engine.Agents.TurnoAssincrono`), no longer inside
the `handle_call` that received the message — that's what lets the
composer's **"Stop"** button actually cancel the turn (kills the task,
cuts the connection to the api) instead of just stopping the client-side
render. Each one has its OWN ceiling on loop rounds (Creative and PO 12,
Architect, Dev Lead, and Staff 14) — it's a constant on the agent's own
server, not the `ToolLoop`'s ceiling
(`Engine.Harness.Iteracoes`), which applies to execution and gate agents.
Staff is the only one with no `kickoff/1`: it stays idle until the first
`user_message`, because there's no session artifact to synthesize an
opening from. Of the four that existed at the time, the Creative agent
was the last to get the loop, via
[RN-163](business-rules/autenticacao.md#rn-163): until then it called the model once
per turn and promised a correction that never happened. That own ceiling
also stopped being silent: once exhausted, it emits the SAME
`toolloop.limit_reached` ([RN-166](business-rules/autenticacao.md#rn-166)), because
it's the same fact and whoever reads the event log shouldn't need a
second name for it.

**Handoff** — the explicit handover of work from one agent to another.
Explicit because the destination and the reason are recorded in the event
log, instead of one agent implicitly "taking over" another's context.

**Artifact** — an agent's structured, validated output. Eleven closed
schemas (`note`, `business_rule`, `product_brief`, `decision_record`,
`plano_de_teste`, `prototipo_navegavel`, `threat_model`, `task_blocked`,
`qa_verdict`, `secops_verdict`, `infra_delegation_files`): a missing field
fails the emission. It's how a gate's verdict becomes data, not text.
`business_rule` fails for a second reason: a title already registered in
the project ([RN-080](business-rules/custo.md#rn-080)) — since an artifact is an
immutable event, emission is the only moment where a duplicate can be
refused.

**Worktree** — `git worktree`: a working copy isolated per dev agent, over
the same repository. Two devs touch different branches without stepping
on each other. It's per **agent**, not per task: whoever claims the next
task replaces the directory, and that's what forces the agent to hold onto
it while a gate still needs to read it.

**Workspace mode** — where a project's code lives on disk, chosen at
creation and **frozen** afterward
([ADR 0072](adr/0072-projeto-local-ou-container.md),
[RN-169](business-rules/autenticacao.md#rn-169)). `container` is the managed folder
under `PROJECT_WORKSPACES_ROOT` — the default and the usual behavior;
`local` is an absolute path of the user's own, which only works if it's
mounted into the container. Don't confuse it with IAM's **workspace**
(the grouping of projects and members): same word for different things,
and mode is about disk.

**Dev agent states** — `working` (implementing), `awaiting_approval`
(proposed a commit/push/PR and one is pending approval — **no gate opens
without a PR**, [RN-050](business-rules/custo.md#rn-050)), `awaiting_gate` (PR
open, waiting for the verdict), `idle` (no claimable task, process alive),
and `idle_tripped` (circuit breaker tripped, only exits via explicit
rearm — [RN-047](business-rules/custo.md#rn-047)). The first three hold the
worktree.

`idle` covers **three** different reasons, on purpose: the queue was empty,
the claim failed, and — since
[RN-502](business-rules.md#rn-502) — the project has no container
REGISTERED `running`, which stops the claim before it happens. There is no
fourth status for that last one: `idle` is the only state a wake still
rescues, and every `handle_info/2` guard is keyed to it. What tells the three
apart is the EVENT (`dev.idle`, `dev.error`, `dev.blocked_by_container`),
which is durable, never the status.

---

## Approval

**`proposed_action`** — every action with an external effect (a terminal
command, commit, push, PR, merge, spend) is **born** here, it never
executes directly. Thirteen types. Six states
([RN-003](business-rules.md#rn-003)).

**`permissions.json`** — the project's policy file. Matches a command
pattern (structured, not substring) and returns `allow`, `deny`, or
`require_approval`.

**`deny` beats `allow`** — the rule that runs through the whole system.
The decision evaluates IAM → `agent_autonomy` → `permissions.json`, and
`deny` at any stage returns immediately
([RN-004](business-rules.md#rn-004)).

**Ceiling** — a downgrade applied **after** the whole policy, that no
configuration can promote past. There are two: merging into a protected
branch ([RN-006](business-rules.md#rn-006)) and an instruction patch
([RN-007](business-rules.md#rn-007)). A ceiling is the difference between
"no by default" and "no".

**`agent_autonomy`** — a project's agent operating mode: `manual` (every
action asks for approval) or automatic. It's the first switch to flip in
a cost incident.

**Protected branch** — `dev`, `qa`, `rc`, `main`. Merging into any of them
is **always** a human decision. The equivalent protection on the platform
(GitHub/GitLab) diverges between providers and is **not** the gate — the
domain is the gate
([ADR 0028](adr/0028-protecao-de-branch-divergencia-entre-providers.md)).

---

## Gates and execution

**Gate** — a mandatory gateway between the dev's PR and the merge. Two:
**QA** (semantic, runs an LLM) and **SecOps** (deterministic, runs a
scanner). The order is immutable:
`awaiting_qa → awaiting_secops → awaiting_user`
([RN-014](business-rules.md#rn-014)).

**`awaiting_user`** — the gate machine's terminal state. Terminal on
purpose: the system never merges.

**`changes_requested`** — the gate returning work to the dev, **on the
same branch**. Doesn't open a new PR.

**Cycle K** — the ceiling on corrections per task. Every return consumes
one round; once exhausted, the task is blocked with a reason instead of
spinning forever. The subagent inherits the base agent's ceiling
([RN-015](business-rules.md#rn-015)).

**`task_blocked`** — the artifact emitted when a task stalls: carries
`reason` and `diagnosis`. It's a readable record of failure, not silence.

**`implementavel` (implementable) gate** — a PRE-DEV gateway, before a dev
agent or worktree exists: the Dev Lead assesses whether a story is
implementable from the **test plan** that QA-strategy produces.
`dono: dev-lead`, `aprovacao_humana: true`, `severidade: warn`
([ADR 0090](adr/0090-qa-estrategia-e-appsec-segundo-momento.md)).

**QA-strategy** — the `qa-lead` in a second MOMENT (same process, a
deliverable separate from the PR verdict): it produces the **test plan**
(synthesis, executable criteria, automation strategy) for ONE story,
before the dev agent writes any code. Never suspends — none of its tools
go through the action pipeline.

**AppSec** — the `secops` in a second MOMENT, the same shape QA-strategy has
over `qa-lead`: the SAME process (`SecOpsAgentServer.run_design/2`) produces a
STRIDE-lite **threat model** over a story's DESIGN — no worktree, no
`task_id`, before any code or PR exists. It never approves or rejects
anything; it ends by emitting `artifact.threat_model` and handing it off to
the architect, the Dev Lead and Infra. Triggered by the Dev Lead's
`assess_implementability`, in parallel, once per story
([RN-360](business-rules.md#rn-360), [RN-539](business-rules.md#rn-539),
[ADR 0090](adr/0090-qa-estrategia-e-appsec-segundo-momento.md)).

---

## Backlog and architecture

**Business rule (RN)** — a unit emitted by the Creative agent and tied to
stories. A rule with no story is a **coverage gap**, not an error
([RN-011](business-rules.md#rn-011)).

**Story** — four states; leaving `draft` requires a DoD, a DoR, at least
one functional requirement, and at least one linked rule
([RN-010](business-rules.md#rn-010)).

**DoD / DoR** — Definition of Done and Definition of Ready. Here they're
not ceremony: without both, the story doesn't change state.

**`module_map`** — the system's module map, from the Architect. Defines
how many dev agents exist (one per module) and which module each story
belongs to. Can't have a cycle ([RN-013](business-rules.md#rn-013)); a
removed module demotes the stories that depended on it
([RN-012](business-rules.md#rn-012)).

**Project image (`artifact.project_image`)** — the Architect's decision
about which container runs the project's code: an OCI image (explicit tag
required, `latest` refused), a network posture (`none` by default,
`egress` authorized), and a resource ceiling. Versioned in the event log,
like the `module_map`. Until it exists, the `sem_decisao` (no decision)
state keeps the Code tab closed
([RN-105](business-rules/autenticacao.md#rn-105)).

---

## Cost

**Metering** — the record of consumption per call in `token_usage`:
tokens, cost in micros, latency, model, agent. It's a **record, not a
refund**.

**Budget** — a spending ceiling with an exclusive scope: project **or**
session, never both ([RN-017](business-rules/custo.md#rn-017)). Notifies at
70/90/100% without repeating.

**`policy`** — the budget's behavior at the ceiling: `block` refuses the
call, `allow` only records it. A project on `allow` **doesn't stop on its
own** — it's the most common cause of "the budget didn't hold"
([RN-019](business-rules/custo.md#rn-019)).

**Binding** — the tie between a scope and an LLM model. Resolves in a
cascade: **session > agent > area > project > workspace**, the first one
that exists ([RN-020](business-rules/custo.md#rn-020)). That's why you can put
an expensive model just on QA. `area` is the DEFAULT that a lead and its
subagents share, and the agent can diverge from it
([RN-102](business-rules/custo.md#rn-102)).

**Capability facet** — what the **provider declares** about a model:
reads image, generates image, does thinking, accepts `tools`. Comes from
the remote catalog at sync time; `false` means "didn't declare it", never
"doesn't do it"
([RN-056](business-rules/custo.md#rn-056)).

**Model use** — what **this workspace** uses that model for (`codigo`,
`documentacao`, `analise`, `imagem`, `conversa`). It's the operator's
opinion, not a capability: no catalog publishes "good for code". Tagging a
use **doesn't enable** the model in the picker
([RN-057](business-rules/custo.md#rn-057)).

---

## Psychologist and Anamnesis

**Hypothesis** — the Psychologist's output: a claim about the team with
`evidenceEventIds` pointing at real events from the analyzed session. With
no valid evidence it isn't recorded ([RN-021](business-rules.md#rn-021)).

**Termination cause** — a deterministic classification of why something
failed: `infra`, `modelo`, `código`, or `política`. Comes from the
recorded reason, never from the LLM's judgment and never by elimination
([RN-023](business-rules.md#rn-023)).

**`proficiency_profile`** — the user's proficiency profile maintained by
Anamnesis, per competency. Six process competencies, **closed** (`git`,
`agile`, `arquitetura`, `testes`, `seguranca`, `infra`), plus the
technical stacks derived from the `module_map`. Nothing outside the
catalog has a write path ([RN-024](business-rules.md#rn-024)) — Anamnesis
profiles technical competency, not the person.

**`instruction_patch`** — a versioned proposal to change an agent's
instruction. Never auto-approvable ([RN-007](business-rules.md#rn-007));
a denied one isn't re-proposed ([RN-026](business-rules.md#rn-026));
rollback creates a new version instead of deleting
([RN-027](business-rules.md#rn-027)).

---

## Git and secrets

**GitProvider** — the normalized twelve-operation contract that Local,
GitHub, and GitLab implement. A single contract suite runs against all
three.

**Capability** — a declaration of what that provider supports. An
unsupported operation is rejected with an explicit error, never a silent
failure ([RN-028](business-rules.md#rn-028)).

**Gitflow bootstrap** — the six steps that prepare the repository
(permanent branches, protections, base files). Idempotent and resumable:
`skip` is success ([RN-029](business-rules.md#rn-029)).

**Envelope encryption** — every user secret is encrypted with its own
**DEK** (data encryption key), and the DEK is "wrapped" by
`CREDENTIALS_MASTER_KEY`. Rotating the master key re-wraps the DEKs
without touching the ciphertext — that's why rotation is interruptible
([runbook](runbook.md#rotacao-da-chave-mestra)).

**`wrapped_dek`** — the wrapped DEK, as stored in the database. **Doesn't
identify which key wrapped it** — that property is what makes rotation a
three-step procedure instead of a variable swap.

---

## Infra

**Oban** — the Elixir queue library that uses **Postgres** as its backend.
Queue depth (`oban_queue_depth`) is the metric that drives the engine's
HPA.

**Drain** — the engine's `preStop` phase: `/ready` turns 503, new sessions
are refused, and every session on the node is offered to a live peer.
Whatever isn't adopted closes as `closed_abnormally / node_shutdown` —
correct termination, not an orphan.

**Adoption** — another node taking over a session's process. Happens
during drain (active handoff) and in the `SessionAdoptionWorker`, which
sweeps every 30s to cover `kill -9` and OOMKill, where `preStop` doesn't
run.

**`:global`** — Erlang's distributed registry. Guarantees **one owner per
session across the whole cluster**; without a formed Erlang cluster, each
replica becomes an island
([ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md)).

**Root trace** — one session = one trace, spanning api ↔ engine. The
`traceparent` stays persisted in `sessions.trace_parent`, and it's what
you use to navigate in Tempo. The `trace_id` is born in the **web** (the
browser generates the `traceparent`) and exists even without a collector:
exporting is a decision separate from instrumenting
([ADR 0035](adr/0035-observabilidade-legivel-e-trace-sem-coletor.md)).

**Path across layers** — the sequence of boundaries a request crosses in
the api (`interfaces` → `application` → `infrastructure`), with each
step's duration, emitted as **one** log line per request. It comes from
an `AsyncLocalStorage` fed by the `@Traced` decorator, not from a span —
that's what makes it work without a collector. See
[observability](explanation/observability.md).

**Layer** — in the path above, the boundary's label: `interfaces`,
`application`, `domain`, or `infrastructure`. Corresponds to the
directories under `apps/api/src/` and the dependency rule between them.
