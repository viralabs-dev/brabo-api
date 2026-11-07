# Findings from the real execution of the pipeline

> Gathered in a browser-driven execution session on **2026-08-05**, with an
> API model (not local) and a real git provider. It is the input for the
> FASE 13c triage: each item has a file:line or event that proves it, and
> none was fixed "in passing" — those that were closed have a named PR.


Project CREATED (not adopted) on GitHub via the wizard. Real repo: `daneiel/hello-api`,
private. Wizard session: `f15b0cc9`. Healthy session: `36abf7e7`.

## Fixed during execution (were blocking)

1. **The meter wasn't metering** (PR #136, merged) — `db.execute`
   destructured as an array + agent read from the event's actor instead of
   the payload.
2. **`llm_turn_stream` without `receive_timeout`** (PR #137, merged) — fell
   into Req's default 15s; the 4 conversational agents only pass through
   there.
3. **`ApprovalCard` crashed the session screen** (to be committed) — the
   web's `ActionType` was a subset of the backend's; `ACTION_ICON[actionType]`
   → `undefined` for `git_repo_create`/`git_branch_create`/`git_branch_protect`,
   which is exactly what EVERY project created on a provider generates. The
   "generic fallback" only existed in the comment. It only failed to appear
   for an ADOPTED project (no bootstrap).

## Open — for the 13c triage

### A. The provisioning session is born without an engine process (SEVERE)

> **CLOSED** — became [RN-067](../business-rules/custo.md#rn-067). The four call
> sites cited below started creating sessions through `CreateSessionUseCase`
> (`provision-repository:119` and `:125`, `adopt-repository`, `activate-execution`),
> and the rule declares it the **only** place that creates a session. Kept
> registered here because the contrast proof below is what made the defect
> visible.

`CreateSessionUseCase` is the only place that emits `session.created` on
the outbox. Sessions created directly in the repository, bypassing it:
- `apps/api/src/application/use-cases/git/provision-repository.use-case.ts:112` and `:121`
- `apps/api/src/application/use-cases/git/adopt-repository.use-case.ts:176`
- `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts:156`
  ← this is the session where the DEV AGENTS run

Effect: the engine never knows the session exists → eternal `REFUSED JOIN`,
no channel, no live updates, no heartbeat, and the session **never closes**
(stays `active` forever). The UI only complains in the console.

Contrast proof:
| session | `session.created` | `engine.session_states` | channel |
|---|---|---|---|
| wizard `f15b0cc9` | no | empty | `REFUSED JOIN` |
| normal route `36abf7e7` | yes | `active` | `JOINED` |

### B. Start model (USER DECISION)
The session is always born on the workspace default (`llama3.2:1b`, local)
— ADR 0020 forbids small local 7B/1B in the semantic step, and it had to
be manually swapped in both sessions. Request: configurable start model,
inheriting the **Creative agent's** in this scenario, since it's always
the project's entry point.

### C. It's the model that talks, not the agent (DEFECT, flagged by the user)
The live-streamed bubble comes labeled with the MODEL's name
("DeepSeek V4 Flash Latest"); only when the persisted event arrives does
the agent (`po`) appear. Effects: the wrong name appears first, and the
message ends up DUPLICATED on screen (stream bubble + event bubble). The
stream isn't reconciled with the persisted event.

### D. An impossible step traps the wizard with no way out
`Protect branches` fails on a private repo on the free plan — the wizard
itself WARNS about this beforehand. But the only action offered afterward
is "Try again," which will always fail. Missing: acknowledge and move on.

### E. The repository preview lies
`apps/web/src/routes/NewProjectWizard.tsx:331` has `repo: brabo/{slug}`
hardcoded. The real owner comes from the PAT (`createForAuthenticatedUser`),
i.e. `daneiel/hello-api`. The error reaches the CONFIRMATION screen.

### F. The wizard announces `rc`
The "Branch policy" step lists `rc` among the permanent branches and
`rc ← qa` in the cascade. The current policy only has `dev`/`qa`/`main`;
the return of `rc` is in ADR 0030's backlog.

### G. The Creative agent's invitation doesn't show up in a created project
The "It's your turn" empty state only renders with an empty thread. In a
created project the thread already has the bootstrap cards, so the user
never gets invited.

### H. Generic activity feed
The 10 bootstrap events all appear as "activity in system," without
saying what happened.

### I. The action card shows the session's CURRENT model
Changing the session's model retroactively rewrites the label on old
action cards. `token_usage` freezes the right price; it's just the screen.

### J. The Psychologist runs on an empty session

> **CLOSED** — became [RN-079](../business-rules/custo.md#rn-079). The analysis
> only runs when there's an ANALYZABLE event, and "analyzable" discounts
> the bootstrap's machine steps and the analysts' own trail — without that
> second discount, the first analysis would make the session look
> populated forever. With no material, `psychologist.analysis_skipped`
> fires and nothing is spent. The finding's session is reproduced as a
> test (14 events, none analyzable).
In session `b2fceb9e`, freshly opened: it received the previous session's
hypotheses along with the new one's log (empty), tried to cite
non-existent `seq 60-78`, had the evidence rejected twice and gave up
(`psychologist.analysis_failed`). Validation held back the invention — but
running an analysis on a session with no event is wasted spend.

### K. Duplicate business rule isn't deduplicated

> **PARTIALLY CLOSED** — became [RN-080](../business-rules/custo.md#rn-080).
> An EXACT duplicate (same title, ignoring case, accents and spacing) is
> refused at emission time, scoped to the project — it's BETWEEN sessions
> that it arises. **Semantic** duplicates remain open, and are declared as
> such: telling "Greeting with name" apart from "Whoever calls can
> identify themselves" is judgment, not an `if`.
Running the Creative agent twice on the same project left 10 rules, 5
orphaned ("discovered — no story"). An artifact of my own script, not of
the product, but it shows there's no dedupe or warning.

### L. The footer button goes stale
Still reads "I'm ready to produce" after the thread has already handed
off to the PO.

## Worked as designed (worth recording too)
- RN-059: durable `agent.error`, with `origem: infra`, agent speaking in
  the thread and going back to `idle` (seen 2x in the 15s timeouts).
- The Psychologist's evidence validation rejecting made-up event ids.
- GitHub Gitflow bootstrap: 4/5 steps, real repo with `main`/`dev`/`qa`.
- `proposed_action` pipeline: 6 bootstrap actions, auto-approved by policy.
- 12c: manual promotion as the default, `story_promotion_proposed` as a
  proposal.
- Rule ↔ story traceability, separating covered from discovered.
- Live bootstrap progress, with the failure showing GitHub's message.

### M. THE ARCHITECT IS BLIND TO ITS OWN module_map (P1 — the run's failure)

> **CLOSED** — became [RN-066](../business-rules/custo.md#rn-066) and is
> confirmed in production in this page's final section: 4 calls to
> `assign_story_modules` instead of 18, zero made-up name, 1 module_map
> instead of 4.

Session `36abf7e7`, seq 80-131. The Architect emitted the map (modules
`saudacao` and `api_http`) and then **could not read it back**. There's no
tool to read the current module_map, and `assign_story_modules`'s refusal
doesn't return the valid names. Result: brute force.

18+ guesses: `api`, `core`, `http`, `greeting`, `domain`, `web`,
`hello-api`, `hello`, `greeting-api`, `saudacao` (got it right by luck),
`app`, `server`, `publico`, `public-api`, `api-publica`, …

In its own words (seq 94, 99, 124):
> "the names I tried (`api`, `core`) don't match. I'll **discover the valid
> names by testing plausible candidates**"
> "I need to **discover the real names** of the 2 modules. I'll **test
> additional candidates**."

Three consequences, in order of severity:

1. **Wrong data, declared correct.** All 4 stories ended up under
   `["saudacao"]`, including the one for the ENDPOINT. `api_http` ended up
   with no story at all. And the closing message (seq 130) asserts:
   "All 4 stories were successfully linked to the modules." The log ends
   with a confident lie.
2. **Breaks downstream execution.** `activate-execution` spins up one dev
   agent PER MODULE. With everything under `saudacao`, the `api_http`
   module gets no agent and the designed architecture isn't the one that
   gets built.
3. **No `tool.result` is recorded** for `assign_story_modules`. The whole
   loop is invisible in the event log — you can only infer it from the
   repeated `tool.call`s.

Loop cost: 9 LLM calls from the architect, 27,804 in / 8,012 out. Session
total: 7,271 micros (US$ 0.007) — cheap only because it's a flash model.

The module_map loop (PR #135) was a SYMPTOM of this: the Architect kept
re-emitting the map precisely to try to fix names it couldn't read back.
#135 fixed the data corruption; the blindness remains.

## Execution (project 17229425, execution session dbb84ce8) — 2026-08-05

### N. THE EXECUTION HALF ONLY WORKS WITH THE `local` PROVIDER (P1, blocks 13b)
`Engine.Projects.ProjectRepository.get_local_repo_path/1` returns
`{:error, {:unsupported_provider, "github"}}` for any provider other than
`local`. It's documented as a scope cut in its own moduledoc:

> "Only supports the 'local' provider (remote github/gitlab are out of
> scope for the terminal executor for now)"
> — `apps/engine/lib/engine/projects/project_repository.ex:25-27`

Five call sites depend on it:
- `lib/engine/dev/worktree_manager.ex:20` — the dev agent's worktree
- `lib/engine/actions/terminal_executor.ex:39` — command execution
- `lib/engine/gates/diff.ex:17` — the diff QA and SecOps read
- `lib/engine/harness/project_context.ex:30` — project context

Observed effect: I activated execution on the GitHub project, the 3 dev
agents spun up, each grabbed a task, and all 3 got blocked in the same
second with `failed to prepare the worktree`.

The asymmetry is the key: the **api** speaks GitHub over HTTP (it's the
one that created the repo, committed the template, and created dev/qa).
The **engine** works on the file system and only knows local bare repos.
So a GitHub project runs the CONVERSATIONAL half (Creative agent, PO,
Architect) and the bootstrap, but not the BUILD half.

Consequence for FASE 13b: the CLAUDE.md script ("ADOPTED project, forked
via remote GithubProvider, real DevAgent, dev implements → remote PR →
gates") **isn't executable today**. This isn't a bug to fix in passing:
supporting remote requires clone, credentials inside the engine and push —
a feature with an ADR.

### O. The dev agent is born on the local model (same root as finding B)
The three dev agents came up on `Llama 3.2 1B (local)`, inherited from the
workspace default. ADR 0020 forbids small local models in the semantic
step, and a dev agent writing code is the most expensive semantic step
that exists.

### P. Blocking event with no origin
`{"origin": null, "reason": "failed to prepare the worktree", "diagnosis":
"{:unsupported_provider, \"github\"}"}`. CLAUDE.md requires every failure
outcome to record an ORIGIN (infra | model | code | policy). Here it's
`code` (a known product limit) and it came back `null`. The diagnosis
saved the day, but the rule wasn't followed.

### Q. `agent.error` with "undetermined origin"
On the Creative agent, an aborted turn: the thread showed
`failure · undetermined origin`. RN-059 worked (durable error, agent
spoke, clean recovery), but "undetermined" isn't one of the four origins —
it's diagnosis by elimination, which ADR 0020 forbids.

### R. The PO generated overlapping stories

> **PARTIALLY CLOSED** — became [RN-081](../business-rules/custo.md#rn-081).
> Identical title is refused; a story that adds no coverage over the rules
> it cites becomes `backlog.story_overlap_warned`, a warning rather than a
> block. **This finding's exact pair still passes** — different titles and
> justifications for the same endpoint have nothing mechanical linking
> them. There's a test asserting that limit, so it stays visible rather
> than implicit.
"Deterministic public greeting endpoint" and "Public GET /hello endpoint
that returns an immediate greeting" cover the same endpoint. No dedupe or
warning.

## Hello-clean run (project `9c7c84f0`, session `1f94de49`) — 2026-08-06

Real dev agent, DeepSeek V4 Flash via OpenRouter, with the approval
pipeline on and every action decided by hand. The task was "Expose a
public GET /api/saudacao route." It never started: **18 turns, 292,211
input tokens, US$ 0.0275 and zero lines written**, and the run ended in a
provider error.

### S. Accumulated context overflows the provider's limit and KILLS the run (P1)

On turn 18 the model call came back
`{413, %{"message" => "request entity too large", "statusCode" => 413}}`,
the `ToolLoop` had no way to continue and the task got blocked
(`dev.blocked`, `artifact.task_blocked`, seq 151–152).

The cause is mechanical and cumulative: every terminal command dumps its
entire output into the loop's history, and that history travels along in
**every** subsequent turn. The largest SUCCESSFUL request recorded in
`token_usage` was 28,993 input tokens; the one that failed never got to
record usage. The overflow is one of **request size in bytes**, not
context window — a `find` or a `git ls-files` with a long output weighs
much more in bytes than in useful tokens.

This connects directly to [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md),
from an angle the ADR didn't foresee: the approval ladder doesn't just
make execution more expensive, it **kills** it. Every question to the user
pushes the agent into one more exploratory command, whose output stays in
the history forever. The run ends in a 413 before the first line of code
gets written.

What the triage needs to decide is whose job the fix is — the
`ContextManager`'s (compact or truncate tool output by size, not just by
age), the terminal executor's (a byte cap per output, with a truncation
marker) or both. Today there's no cap anywhere on the path.

- **Evidence:** `session_events` seq 150–152 of session `1f94de49`;
  `token_usage` for actor `dev-http-api`.

### T. The failure's origin is STILL outside the four (recurrence of P and Q)

The `dev.blocked` from finding S recorded:

```json
{
  "origem": "indeterminada",
  "reason": "parou sem concluir nem reportar bloqueio",
  "diagnosis": "falha na chamada ao modelo: {413, %{\"message\" => \"request entity too large\", \"statusCode\" => 413}}"
}
```

Not a new finding: it's the **third** occurrence of the same rule being
violated, and is therefore recorded as a recurrence rather than a separate
item. [P](#p-blocking-event-with-no-origin) caught `origin: null` on a
`dev.blocked`; [Q](#q-agenterror-with-undetermined-origin) caught
`"indeterminada"` on an `agent.error`. Here the two meet: a blocking
event, value `"indeterminada"`.

What this occurrence adds, and what makes the case stronger than the
previous ones: **the origin was trivially derivable**. A known HTTP status
from the provider is unambiguously `model` — the `diagnosis` field itself
names it on the very line where `origem` gives up. It's not an edge case,
it's the error path not looking at what it just wrote itself.

The `reason` also lies: "stopped without concluding or reporting a block"
describes silence, and what happened was a failure with an identified
cause. Anyone reading only the `reason` in the panel would conclude the
model got lost.

- **Evidence:** `session_events` seq 151 of session `1f94de49`.
- **Rule violated:** CLAUDE.md ("every failure outcome records its
  ORIGIN — infra | model | code | policy — never diagnosis by
  elimination"), originating in
  [ADR 0020](../adr/0020-destravar-gates-qa-secops.md).

### U. The terminal executor has no project boundary (P1)

Inside the container that runs the actions, `/workspace` is the **Brabo
monorepo itself** — not the project's worktree, which lives at
`/data/project-workspaces/<projectId>/.worktrees/<agentId>`.

The `hello-limpo` dev agent spent turns there thinking it was its own
project: it read `apps/engine/mix.exs`, and even proposed
`cat lib/engine/actions/git_executor.ex` and
`sed -n '1,120p' lib/engine/dev/context_builder.ex` — the platform's own
git executor and context builder that was running it.

And the reach doesn't stop at Brabo. A `for` over
`/data/project-workspaces/*/` listed **another project's** worktree
(`dbd3e508-e0c7-4e29-b134-5d393f518269`) with its commits and files; the
next step the agent proposed was entering it to read `git remote -v` and
`git log`. It was refused by hand.

None of this is model malice: it's looking for its own project and the
file system doesn't say where it ends. In a multi-tenant deployment, the
same command would read another customer's repository.

[ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md)
designs the POLICY half of this and explicitly says it doesn't solve the
other half: path scoping depends on the rule getting it right, and what's
missing is **isolation** — per-project mount, or per-project container.
This finding is the half the ADR left explicitly open.

- **Evidence:** `proposed_actions` `d1bfeda3` (refused) and `56374def`
  (approved, listed the other project) of session `1f94de49`.

### V. The session shows `closed` while execution keeps going (P2)

`sessions.status` for `1f94de49` has been `closed` since **23:34:42**,
thirty seconds after it was born. Execution kept going until **00:56** —
over an hour of an agent working, proposing actions and spending tokens
in a session the database considers over.

Both sides end up incoherent at the same time: the UI shows "Session
closed — cannot send messages" **and** renders the approval cards, which
work normally. Approving in a closed session actually executes the
command.

This contradicts the state machine CLAUDE.md declares
(`created → active → closing → closed | closed_abnormally`): `closed`
should be terminal. It also poisons any per-session measurement — duration,
cost and "how many sessions ended well" all read a state that doesn't
describe what happened.

Didn't investigate who wrote the `closed` or why; that's work for whatever
phase addresses it, not for the triage.

- **Evidence:** `sessions.updated_at` = 23:34:42 with `status = closed`;
  `session_events` for the same session up to seq 152, at 00:56:46.

## Confirmed in production this round
- **RN-066** (Architect's blindness): 4 calls to `assign_story_modules`
  instead of 18, zero made-up name, 1 module_map instead of 4, each story
  in the semantically correct module. Session cost dropped from 7,271 to
  3,259 micros.
- **RN-067** (session with no process): execution session `dbb84ce8`
  appears in `sessions` AND in `engine.session_states` — before,
  `activate-execution`'s session was born orphaned.

## Running the Phase 12 validation — 2026-08-07

First real run of `pnpm --filter api validacao:fase-12`, item 13a.1's
pending task. The criterion closed (exit `0`), but only after four fixes —
three in the INSTRUMENT and one in the PRODUCT. The instrument's are
counted in [validacao-fase-12.md](validacao-fase-12.md); this is the
product's.

### W. The dev agent DIES when the module's queue empties (P1) — CLOSED

With an empty queue, `POST /internal/sessions/:id/tasks/claim` responds
`201` with `content-length: 0`. The use case returns `null`, but NestJS
serializes that as an EMPTY body — `Req` receives `""`, which is not
`nil`.

`AgentIo.try_claim/2` matched the "task found" clause and called
`run_task("")`, blowing up with `BadMapError` in `Map.get("", "id", nil)`.
Since the server is `restart: :temporary`, the agent died for good, with
`Monitor` erasing the state row right behind it.

**Applies to the REAL dev agent**, not just the Noop: `try_claim/2` lives
in the shared `AgentIo`. And it fires on the most common outcome there is
— the queue running out. The effect is the exact opposite of what Phase
12b delivered: instead of a supervised, event-wakeable `dev.idle`, a dead
process.

The suite never caught it because the fake correctly returns `nil`.
**Only real execution exposes it** — which is, literally, this phase's
thesis.

> **CLOSED** — fixed at the boundary (`EngineApiClient.claim_task/4`
> normalizes an empty body) and guarded in the contract
> (`AgentIo.try_claim/2` accepts `""` alongside `nil`), without touching
> the route's HTTP status. Exception to the FASE 13 freeze authorized by
> the user, for the same reason as Phase F: the measurement wasn't
> reachable without this. Verified by mutation.

## Real execution with remote GitHub (FASE 13b) — 2026-08-07

First execution against a real remote repository (`daneiel/test`), with a
real dev agent and `openai/gpt-5-mini`. The chain up to promotion went
through in full; the dev agent didn't. Detail and measurement in
[validacao-real.md](validacao-real.md).

### X. The dev agent burns the iteration cap in an empty repository (P1)

Task *"Expose GET /saudacao"* in a freshly provisioned repository — only
the Gitflow template, no code. The agent spent all eight iterations on
`search_workspace`/`read_file` looking for "where's the project," **never
ran a single terminal command and never wrote a file**. Block:
"iteration limit reached", origin `model`, diagnosis "(no terminal run)".

The `model` origin is technically true and practically useless: the model
didn't make a bad judgment call, it never got to judge at all. Cost: 8
calls, 205 output tokens.

It's the **first** scenario where the dev agent starts from absolute zero
— every previous test and demo started from a workspace with existing
code.

### Y. `search_workspace` doesn't distinguish "empty" from "found nothing" — CLOSED

The first five calls all returned "no results," and the agent read that as
"search harder" instead of "there's nothing here." It was the actionable
piece of finding X.

> **CLOSED** — the tool now responds differently for different situations.
> A workspace with no files at all returns *"the workspace is EMPTY […]
> CREATE the necessary files (write_file) instead of continuing to
> search"*; a workspace with files returns the count, saying the search
> worked and it's the term that doesn't match.
>
> **The fix is the message, not the cap.** The agent didn't need more
> iterations — it needed to know there was nothing to search for. And the
> finding's case (only bootstrap's `.github/` and `docs/`) is NOT empty —
> there's a test asserting that in that case the right answer is the
> count, not the instruction to create.
>
> **A new run was made, and X did NOT close.** Same outcome —
> "iteration limit reached," 8 calls, no PR. The behavior changed (one
> search instead of five), the result didn't. The hypothesis that the
> message was the cause was WRONG: of the eight iterations, seven are
> exploration, leaving one to write, commit, push and open a PR.
>
> **The cap WAS the cause.** With `TOOL_LOOP_MAX_ITERATIONS=25` the dev
> agent explored, wrote THREE files and ran `npm test` — and stopped at
> `dev.awaiting_approval`, not at a block. The cap of 8 was designed for a
> conversational agent and doesn't fit a dev agent that needs to
> understand the repository before acting
> (`apps/engine/config/runtime.exs:100`).
>
> X stops being "burns the cap exploring" and becomes **"the cap is wrong
> for this agent."** The product fix is NOT raising the global default —
> the Creative agent doesn't need 25 iterations to converse. It's a cap
> per agent type, and that's a product decision: it goes into the triage.
>
> **CLOSED in FASE 14d** ([RN-085](../business-rules/custo.md#rn-085)). The cap
> became per-type in `Engine.Harness.Iteracoes`: `8` for conversational
> agents, `60` for the dev agent and QA subagent. The criterion for who
> gets to go up isn't "works a lot" — it's having a
> `token_budget_micros` underneath holding down spend, and that's why
> `infra-workflows` uses a heavy tool and **stays at 8**: it runs without
> a budget, and for it the cap is the only guardrail there is.

### Z. The terminal allowlist governs the VERB; scope only protects the PATH

With the cap resolved, execution started stopping at terminal approvals.
The 2026-08-06 request was *"always allow commands as long as they're
inside the project's folder"*; ADR 0055 delivered a CAP (outside the
folder never auto-approves), while the verb is still governed by a closed
list.

Whitelisting `npm`/`pnpm`/`node`/`npx` wasn't enough: the agent ran
`ls -la`. Every new verb falls into `require_approval`.

This isn't a defect in ADR 0055, which never promised to promote a verb —
it's the gap between what was asked and what was delivered, and it's what
keeps the ladder standing.

### Worked as designed (worth recording too)

The **Psychologist diagnosed on its own**, at the heavy tier, reading the
failed execution's event log — and named both causes more precisely than
any script assertion could: the absence of a terminal `tool.call`, and
`search_workspace` misleading the agent. The product's introspection
works.

### AA. Auto-approved `pr_open` has no credential and always fails on remote (P1)

> **CLOSED** — became [RN-082](../business-rules/custo.md#rn-082). The api
> started resolving git credentials by the workspace OWNER, reusing the
> same resolver as RN-058 instead of reimplementing the rule. Verified by
> mutation.

Found in the 5th execution of 13b, the first in which the chain reached
the PR.

`ExecuteGitActionUseCase` resolves the git token from **`action.decidedBy`**
— the user who DECIDED the action (`execute-git-action.use-case.ts:100`).
When policy auto-approves, no one decides: `decided_by` ends up NULL,
`accessToken` ends up `undefined`, and GitHub responds
`Requires authentication`.

The contrast within the same run is the proof:

| action | who executes | credential | outcome |
|---|---|---|---|
| `git_push` | **engine** | injected from the owner (`git_auth.ex`, RN-076) | ✅ executed |
| `pr_open` | **api** | `action.decidedBy` → NULL | ❌ failed |

The push reached GitHub — the branch `feature/task-d4b36a5b` exists on the
remote. What failed was only the REST call that opens the PR.

It's the same class of issue that
[RN-058](../business-rules/custo.md#rn-058) fixed for LLM ("the key the agent
spends is the OWNER's"): the api's git path still resolves by "who
decided," rather than by "whose workspace it is."

**Practical consequence:** with autonomy configured — which is exactly the
mode Phase F exists to enable — no dev agent can open a PR on a remote
provider. The path only works when a human clicks each PR, which is
precisely the declared-unviable ladder.

### AB. The GATE agent doesn't know how to wait for approval — becomes an `infra` failure (P1)

> **CLOSED** — [ADR 0057](../adr/0057-o-gate-espera-a-aprovacao.md). The
> gate agents now SUSPEND and resume, like the dev agent has since
> ADR 0052: the subagent returns `{:awaiting, ...}` with the whole `ctx`,
> `QaLeadServer` holds the in-flight state, subscribes to `Wake` for the
> subagents, and continues the area from where it stopped once the
> decision arrives.
>
> While pending, the area **doesn't** consolidate, doesn't emit a verdict
> and doesn't block the task — it waits. A refusal also resumes, with the
> reason in place of the result.
>
> Declared limit: a restart in the middle of the wait loses the loop,
> because `pendente` lives in the lead's memory. The gate runs again via
> the `Dispatcher` when the task returns to the cycle.

### AC. Redirection (`2>/dev/null`) makes any command unapprovable (P1)

> **CLOSED on both pieces.**
>
> 1. `parseCommand` stopped treating `>`/`>>`/`<` as a separator — they
>    don't chain any command. The target still counts as a TOKEN of the
>    segment, on purpose: that's what keeps `echo x > /etc/passwd` still
>    barred by the scope cap. The verb became correct without the path
>    becoming free.
> 2. `/dev/null`, `/dev/stdin`, `/dev/stdout` and `/dev/stderr` stopped
>    counting as user paths. That's the exact list and **not** all of
>    `/dev` — there's a test asserting `/dev/sda` remains out of scope,
>    because opening up `/dev` would trade a nuisance for a hole.
>
> Verified by mutation in both directions: loosening `/dev` breaks the
> disk test, and disabling the chaining breaks 11 tests.

Found in the 7th execution of 13b, after widening the allowlist to 25
verbs. The QA agent ran:

```
ls -la && echo "---" && cat package.json 2>/dev/null; echo "---"; ls *.md 2>/dev/null
```

**Every verb was already allowed** — `ls`, `echo`, `cat`. Even so it
became `require_approval`. Running the pure functions against the command:

```
segmentos: [["ls","-la"],["echo","---"],["cat","package.json","2"],["/dev/null"],…]
tokens de caminho: ["/dev/null","/dev/null"]
no escopo? false
```

`parseCommand` treats `>` as a segment separator, so `2>/dev/null` becomes
**a segment of its own**. This breaks in two independent ways:

1. the `/dev/null` segment has `/dev/null` itself as its "verb," which
   will never be in `allow` — and a composite command requires EVERY
   segment allowed;
2. `/dev/null` is an ABSOLUTE path token outside the project folder, so
   the [RN-075](../business-rules/custo.md#rn-075) cap downgrades to
   `auto_approve`.

**The impact is large because `2>/dev/null` is idiomatic.** Models use it
all the time to silence expected errors. In practice, any command with
output redirection is unapprovable by policy — only clears with a human
click.

It's not a missing verb: it's the command's **form**. Widening the
allowlist doesn't fix it, and the 7th execution proves it — 25 verbs
allowed, and it still got stuck.

Two distinct pieces for triage:

- the `>`-based segmentation in `command-matcher.ts` (pre-existing, and
  debatable: redirection isn't command composition like `&&` and `|`);
- the scope cap treating `/dev/null` as a user path (`path-scope.ts`,
  from Phase F).

### AD. The agent wraps commands in `bash -lc`, and the allowlist has no answer (P1)

Eighth execution of 13b, with findings Y, AA, AB and AC already fixed. The
dev agent made ONE tool call:

```
bash -lc npm test --silent
```

The verb is `bash`. It's not in `allow`, and it became `require_approval`.

**The refusal is correct, and it's important that it is.** Allowing
`bash` would nullify the entire allowlist: `bash -lc <anything>` bypasses
the verb check, including the built-in `deny`s. An allowlist that accepts
`bash` isn't an allowlist.

But this closes the argument that executions 6, 7 and 8 had been
building:

| execution | what got stuck | what I did |
|---|---|---|
| 6th | `head` outside the list | widened to 25 verbs |
| 7th | `2>/dev/null` (FORM, not verb) | fixed the parser and the scope (AC) |
| 8th | `bash -lc` (INVOCATION) | — |

Each round revealed a new category, and none of them was "missing a
verb." **The verb allowlist doesn't converge** against an agent that
freely chooses how to invoke what it wants to run — and the three forms
(verb, form, invocation) are different spaces, not points on one list.

What this does NOT mean: that the allowlist is wrong. It does exactly what
it promises, and `bash`'s refusal proves the boundary works. What it
doesn't do is enable agent autonomy without human intervention.

Two directions for triage, and they're different in nature:

1. **Suspendable gate agents** (finding AB, half open). Doesn't eliminate
   approval — makes the agent WAIT for it instead of dying, so the user's
   click unblocks it instead of refusing it. It's the path ADR 0052
   already opened for the dev agent.
2. **Policy by agent profile.** A dev agent in an isolated worktree is
   different from an agent touching the user's workspace. Today both use
   the same `permissions.json`. This is a product decision with an ADR.

### AE. The QA agent tries to fix the code it's judging (P2)

In the final executions of 13b, with LLM-based gates finally running, the
QA subagent **tried to fix the code it was evaluating** — against its own
role. Whoever judges doesn't fix: a gate that edits what it's analyzing
stops being a gate and becomes just another author, and the verdict ends
up being about its own work.

**It didn't succeed, and the reason is structural before it's political.**
The QA tool registry is
`[ReadFile, SearchWorkspace, Terminal, EmitQaVerdict]`
(`apps/engine/lib/engine/gates/qa_tools.ex:10`): **there is no
`write_file`**. To write, it would have to go through `terminal` — and
there it runs into two barriers that already existed for other reasons:

1. the **verb allowlist**, which governs what can run
   ([RN-075](../business-rules/custo.md#rn-075) and findings Z/AD);
2. the **path scope cap**, which downgrades any command outside the
   project folder to `require_approval`.

They are **independent** barriers: neither was designed for this case,
and that's exactly why the containment is reliable — it doesn't depend on
the prompt convincing the model.

**Why it's P2 and not P1.** Nothing leaked: the behavior was attempted and
blocked. What the finding records is a **divergence between what the
prompt asks and what the model does**, and that divergence is the data —
it shows that the instruction alone doesn't hold the role, and that the
structural barrier is what does.

**What isn't measured.** How many times it tried, in which exact
execution, and with what command: executions 9 and 10 don't have the
detail recorded in [validacao-real.md](validacao-real.md), which covers up
to the eighth. Recording the finding without those numbers is deliberate
— the alternative was making them up, and Phase 10's lesson was precisely
that a number recalled from memory isn't worth anything.

**Direction for triage**, and it's the same as finding AD's "policy by
agent profile": the right tool for a gate isn't the same as an author's.
Today the difference is achieved by omission (the QA's registry doesn't
include `write_file`), which works but isn't declared anywhere as a
guarantee — it'll vanish the day someone adds the tool "for convenience."

## Executions with TWO modules — 2026-08-08 and 2026-08-09

Two stories, one in `api` and one in `web`, two dev agents coming up
**at the same time**. Running it this way matters because the parallelism
cap in [RN-083](../business-rules/custo.md#rn-083) only means something when
there's genuinely independent work — with a single module, the Dev Lead
refuses to parallelize, and rightly so.

There were three rounds, and their order is the argument:

1. **2026-08-08, the one that broke.** `dev-web` grabbed the task and died
   with `fatal: not a git repository` **before the first turn**: zero
   token spent, task blocked, agent `idle`. It's finding AF below.
2. **2026-08-08, right after the fix.** `dev-web` went from **0 to 16
   calls**, and both modules were implemented in parallel.
3. **2026-08-09 (project `9443f1f1`, session `94428b1f`), the measured
   one.** Clean run with the fix already in place, extracted entirely by
   `medir:execucao`: **3m56s, 33 calls, < US$ 0.01**, no engine restart,
   no silent turn, and both gates (`qa` and `secops`) approving. Serves
   as the baseline cost for a two-module execution.

### AF. Two dev agents coming up together corrupt each other's workspace (P1)

`Engine.Actions.Workspace.ensure!/4` serializes per-project working tree
initialization with `:global.trans` — precisely for the case of N dev
agents coming up when execution is activated. The lock was correct. **The
guard that decided whether it was worth grabbing, wasn't.**

The fast path, without the lock, asked whether `.git` existed
(`apps/engine/lib/engine/actions/workspace.ex:51`). And `init_from_bare!`
starts with `git init`, which creates `.git` on the **first line** —
before the `fetch` and before the `checkout`. Whoever hit that window read
"ready," skipped the lock entirely, and ran `git worktree add` against a
half-baked repository:

```
fatal: not a git repository
```

**Why it went ten executions without showing up.** The window only exists
if a second agent arrives *during* initialization, and activation only
spins up one agent per module. With a single entry in `module_map` there
was never a second agent. This defect belongs to Phase 14d (parallelism)
and needed the first genuinely parallel execution to reveal itself.

**The fix** is an on-disk marker, `.brabo-workspace-pronto`, written only
at the **end** of initialization; the fast path now checks for it instead.
The lock didn't move — the criterion for "already ready" changed, and now
it's only true when it actually is. A workspace created before the marker
existed is **adopted and stamped**, never re-initialized: re-initializing
would wipe uncommitted work.

**What this teaches about the test that missed it.** There was already a
test with 8 concurrent `ensure/3` calls, and it **passed with the bug**.
All 8 start together, all see an empty directory, all go for the lock —
the window is never exercised. Trying to reproduce it by timing doesn't
work either: against a local bare repo the `fetch` finishes too fast, and
a test racing after the window always passes without proving anything.

What closed the hole in
`apps/engine/test/engine/actions/workspace_test.exs` was **constructing
the intermediate state by hand** instead of trying to time it: a `git init`
in the directory, with no fetch and no checkout, which is exactly what the
second agent was seeing. With the old guard, `ensure!` returns the
directory and never writes the marker — and it's the marker's absence
that the assertion checks for. The other two tests guard the migration
(a pre-marker workspace isn't re-initialized) and the real case of two
concurrent `ensure!` calls.

It's the same pattern as the three gaps in Phase 14d itself, recorded
there: **testing the piece isn't testing the path to it.** Here the piece
(the lock) was correct and tested; it was the path to it that decided
wrong.
