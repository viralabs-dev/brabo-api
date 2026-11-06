# ADR 0123 — Golden-set of regression cases for the QA Automation agent's semantic judgment

- **Status:** accepted
- **Date:** 2026-08-30
- **References (without editing):** [ADR 0020](0020-destravar-gates-qa-secops.md)
  (the finding this closes — its own acceptance criterion documents the
  QA gate's semantic step as non-deterministic with a local model, and
  names the fix direction this ADR builds: "point at an API model instead
  of hoping").

## Context

ADR 0020 closed the PR gates' acceptance criterion, but with a caveat
spelled out in its own title section: **CLOSED, but NOT DETERMINISTIC**.
Against local `qwen2.5-coder:7b`, the criterion — QA matching a business
rule to a test, twice on the same PR — closed only on the 10th of 11 runs.
The 11th, run immediately after with no code change, did not close: the
model ended the loop without calling `emit_qa_verdict`. ADR 0020 names this
explicitly as the semantic step being "the role that fits worst in a small
model" and states the fix direction without building it: "point
`DEMO_QA_MODEL` at an API model."

That direction never became a mechanism — it stayed documented, not built.
An external code review of this session's work, ranked 15 findings by
priority; 14 of 15 closed as this session progressed. The 15th and last was
this one, proposed with no build cost attached: "a golden-set (5-10 cases,
loose expected output, fixed model, allow-failure to start) would turn 'the
demo depends on a 7B's judgment' into a trend signal."

Three facts, confirmed by reading code rather than assumed, shaped what
could be built today:

1. **The judgment can be invoked in isolation, without the full state
   machine.** `Engine.Gates.QaAutomacaoAgent.run/5` is already called this
   way in `qa_automacao_agent_test.exs` — no `QaLeadServer`, no
   `GateState`, no PR, no git repository, no backlog. The only thing
   separating that existing test from a real golden-set is swapping the
   fake LLM client for the real one.
2. **The real client requires the api actually running, reachable.**
   `Engine.Sessions.EngineApiClient.Live.llm_turn/5` reads
   `Application.fetch_env!(:engine, :api_url)`, populated only by
   `config/runtime.exs` (via `API_URL`) — never by `config/test.exs`. This
   is not a unit test in the usual sense: it is, in practice, "run against
   the dev stack," the same posture `demo-pr-gates.ts` already has.
3. **CI is not possible today — confirmed, not assumed.** Zero mention of
   `ollama` in `.github/workflows/`; the compose service sits behind
   `profiles: ["local-llm"]`, never started by `docker/smoke.sh`. Zero LLM
   secret in the repository. And the CI's own culture rejects silent
   allow-failure: `pr-police.yml` is the only place in the repo using
   `continue-on-error`, and even there the error is re-raised in a final
   step. There is no check today that can go red with no consequence.
   Wiring this into CI needs an API LLM secret or new infrastructure (a
   GPU runner, an Ollama pull step) — a decision for a human, not
   something to build by choosing.

## Decision

**Where it lives.** `apps/engine/test/engine/gates/qa_automacao_agent_golden_test.exs`,
`use Engine.DataCase`, reusing the same `dev_state`/`dev_context`
construction as `qa_automacao_agent_test.exs`. It is ExUnit, not a new Mix
task: there is no `Mix.Task` of its own anywhere in `apps/engine/lib`
today, and an isolated test is already this codebase's natural shape for
this class of thing — unlike the api side, where `demo-pr-gates.ts` is a
script because no "call the function directly" equivalent exists there.

**A permanent exclusion tag, never availability detection.** The
`test_helper.exs` pattern for gitleaks/hadolint/yamllint/actionlint
auto-includes a tagged test when the binary is found on the machine — right
for a free, deterministic tool, and wrong here. This development machine
already has Ollama running continuously; auto-inclusion by reachability
would make the golden-set fire inside *any* `mix test`, spending tokens with
no warning and introducing real flakiness in a suite that is 100%
deterministic today.

```elixir
ExUnit.start(exclude: [:golden_set_qa | binary_exclusions])
```

Only `mix test --only golden_set_qa` runs it, plus a `mix golden_set.qa`
alias for discoverability — the same discipline `demo-pr-gates.ts` already
states in its own header comment: "NOT deterministic ... run deliberately,
not in CI." `setup_all` skips (via ExUnit's `{:skip, reason}` return from
the test body, not a raised failure) when the api is unreachable at
`API_URL` — an environment prerequisite, not a code defect.

**Seeding via an external TS script, called through `System.cmd`.** The
engine has no way to create the real rows (project, session, model
binding) without duplicating business logic that lives in the api's own
use cases — and there is no raw-Ecto path that reaches the right database
anyway. This is the plumbing cost this ADR states plainly rather than
hides: `apps/api/scripts/seed-golden-set-qa.ts` is a **cross-language
`System.cmd`**, new to this repository (zero prior precedent of an Elixir
test shelling out to `pnpm`/`ts-node`).

A second, non-obvious reason it has to be this shape: the golden test uses
`Engine.DataCase`, whose sandbox points at the isolated `engine_test`
database (the same convention `qa_automacao_agent_test.exs` already uses).
The seed script runs inside the *api's own* process, writing to the real
dev database (`DATABASE_URL`) that the *running* api and engine servers
actually use. These are two different databases — nothing `Engine.Repo`
reads in the golden test would see rows the seed script wrote, or vice
versa. Consequently `Engine.Actions.Workspace`/`Engine.Dev.WorktreeManager`
(which read `project_repositories` via `Engine.Repo`) cannot materialize
the worktree for this test's cases: **the seed script does its own git
checkout** (a plain `git clone` of the bare repo it just provisioned) and
returns the ready worktree path in its JSON output. The golden test only
ever consumes that JSON — it never queries Postgres to find anything.

The seed script:

- Creates one user + one workspace, and one project per case (a
  provisioned local git repo is 1:1 with a project — `ProjectRepository.remoto_de_trabalho/1`
  does a single-row lookup by `project_id`).
- Resolves **or creates** the `models` row for `GOLDEN_SET_QA_MODEL`
  (default `qwen2.5-coder:latest`) — unlike the older demos, which throw if
  the model isn't already in the fixed seed catalog (`seed.ts`'s
  `MODEL_SEEDS`). The golden-set targets arbitrary local Ollama models by
  design, and pinning it to a fixed catalog would mean editing `seed.ts`
  every time someone wants to measure a new one.
- Activates the model for the workspace (`SetModelsActiveUseCase`) — a step
  the older demo scripts skip, and which currently makes `SetModelBindingUseCase`
  throw `ModelNotBindableError('inativo')` when it is missing
  (`workspace_models` absence means "off," RN-043/ADR 0049). This looks
  like drift in the older demos, not something this ADR should silently
  fix there — they are out of scope.
- Binds the model at `chaveDeAgente(project.id, 'qa-automacao')` —
  **`'qa-automacao'`, never `'qa'`**: since Phase 8b the subagent that
  actually runs is `qa-automacao`/`qa-performance-seguranca`; binding
  `'qa'` is a no-op (the cascade falls through to the project binding).
  Copied from `demo-pr-gates-area-qa.ts:281`, not from the older
  `demo-pr-gates.ts`, which still uses the stale key.
- Calls `SeedAgentAreasUseCase.execute(project.id)` — without it,
  `agent_areas` stays empty for a project created by a raw insert (instead
  of through `CreateProjectUseCase`), and the **first** LLM turn the QA
  agent makes fails with a 404 from `RecordLlmUsageUseCase`
  (`AgentAreaRepository.incrementSpent` requires the row to exist — metering
  is mandatory, RN-036, never best-effort). Found empirically: the first
  real run of this harness returned `blocked(infra)` on all six cases
  before this call was added.
- Provisions the repo, commits the case's skeleton, then materializes the
  worktree **inside `projectScopeRoot(project)`** (`git clone`, *before*
  writing `permissions.json` — cloning needs an empty target directory).
  This ordering and location are load-bearing, not incidental: ADR 0055's
  path-scope cap in `decide()` refuses to auto-approve *any* `terminal`
  action whose `cwd` falls outside the project's own scope root, no matter
  how well the command matches an `allow` pattern. A first version of this
  script cloned into a separate scratch directory under `os.tmpdir()` — every
  case came back `awaiting_approval` forever, because `npm test` never
  cleared the scope check. Found empirically, the same way as the
  `agent_areas` gap above.
- Adds `DEV_TERMINAL_ALLOW_PATTERNS` to the project's `permissions.json`
  (same mechanism `ActivateExecutionUseCase` already uses) — without it,
  `decide()`'s default is `require_approval` for every `terminal` call, and
  `emit_qa_verdict` can never see a `terminal` with exit 0 in history.
- Creates and activates one session per case (`CreateSessionUseCase` +
  `TransitionSessionUseCase`).
- Prints one JSON object to stdout — `{"model": "...", "cases": [{"id",
  "projectId", "sessionId", "worktreePath", "story", "task",
  "expectedVerdict"}, ...]}`.

No cleanup — same posture as `demo-pr-gates.ts` (a timestamp suffix, never
deleted).

**The six cases**, each probing a different judgment table an evaluator LLM
can genuinely get wrong — not six variations on the same test:

1. `rf-covered` — RF_1 from `demo-pr-gates.ts`, verbatim (covered) →
   `approved`. Positive control, already proven end to end.
2. `rf-uncovered` — RF_2 from `demo-pr-gates.ts`, verbatim (explicitly
   uncovered) → `changes_requested`. Negative control, already proven.
3. `rf-single-clean` — RF_1 from `demo-pr-gates-area-qa.ts` (single rule,
   covered, clean approval) → `approved`.
4. `rf-mismatched-filename` — a rule about `enviar()`, covered by a test
   living in `test/outro-modulo.test.js` (not `enviar.test.js`) →
   `approved`. Probes whether the QA reads test *content*, not just
   filename convention.
5. `rf-partial-coverage` — a rule that names both a happy path and an
   explicit failure case (`cancelar(pedido)` marks status, and throws when
   already delivered); only the happy path has a test → `changes_requested`.
   Probes whether the QA rubber-stamps partial coverage as complete.
6. `rf-skipped-test` — the only test "covering" the rule is `test.skip(...)`
   → `changes_requested`. Probes whether the QA counts a disabled test as
   coverage.

The two near-misses ADR 0020 already documents (tool-call hallucination,
QA trying to fix the code under review) are deliberately **not** added
here — they are already deterministic, cheap regression at
`apps/engine/test/engine/harness/tool_call_recovery_test.exs:79`, with no
real model involved. Adding them here would duplicate that coverage while
diluting what this harness actually measures: rule-vs-test judgment, not
general QA misbehavior.

**A floor, not a binary gate.** Same ratchet philosophy as
`scripts/ci/coverage-floor.ts`'s `verificarPiso` (`>=`, never `>`; the file
is edited only by a human; the script never rewrites it) — matching
exactly what "loose expected output, allow-failure to start" already asked
for. `apps/engine/test/fixtures/golden_set_qa/floor.json` is keyed by
**model** (switching models legitimately changes the achievable floor) and
stores a count plus a total (`{"passRate": N, "of": 6}`, not a percentage) —
so a golden-set that later grows past six cases can't have an old entry
silently misread. No entry for the model in use → the test **fails**,
reporting the observed pass count and asking a human to add the entry —
never auto-written, the same non-negotiable `coverage-floor.ts` already
established.

**One test, not six.** All six cases run inside a single `test` block
(tagged `@moduletag :golden_set_qa`), not six separate ones. `mix test`
gives no ordering guarantee between tests in a module; splitting into six
would risk a floor assertion reading an incomplete subset if a would-be
"seventh, aggregate" test ran before the others finished seeding context.
Running all six and aggregating at the end is also what lets a human read
all six outcomes together for debugging, printed to stdout.

**`ownership_timeout` had to become configurable in `Engine.DataCase`.**
Found empirically running against `gpt-oss:20b`: a real LLM turn against a
large model loading for the first time can run for minutes without
touching Postgres. `Ecto.Adapters.SQL.Sandbox`'s default 60s
`ownership_timeout` reclaimed the golden test's checked-out connection
mid-call; the *next* query through `Engine.Repo` — instruction files,
inside `ToolLoop.Default.init/1`, which every gate agent goes through
regardless of whether it customizes agent instructions — died with "owner
process exited," misreporting a model-speed characteristic as
infrastructure failure. `Engine.DataCase.setup_sandbox/1` now reads an
optional `tags[:ownership_timeout]` (nil preserves the existing 60s default
for every other test in the suite); the golden test tags itself
`ownership_timeout: :infinity`.

## Consequences

**CI wiring is a declared `TODO(humano)`, not built.** It needs an API LLM
secret or new infrastructure (a GPU runner, an Ollama model-pull step) —
this is not a choice this session can make; it needs a human decision and,
in the infra case, budget. Recorded in `CLAUDE.md`'s "Pendências com dono
humano" section, the same place this class of blocker already lives.

**Real measured pass rates (2026-08-30, native host processes — api via
`pnpm --filter api start:dev`, engine via `mix phx.server`, both pointed at
one local Postgres and the machine's own Ollama at `localhost:11434`, no
Docker Compose in this particular run):**

| model | runs (pass/6) |
|---|---|
| `qwen2.5-coder:latest` | 1, 3, 2, 4, 5 |
| `gpt-oss:20b` | 5, 4 |

`qwen2.5-coder:latest` is markedly unreliable — the dominant failure mode
across runs was the model calling the `terminal` tool with an **empty
`command` argument**, which `decide()` correctly refuses to auto-approve
(no pattern matches an empty string), leaving the case stuck
`awaiting_approval` forever. This is the exact class of tool-calling
unreliability ADR 0020 already found with this model family — reproduced
here as a *measured trend* instead of a one-off anecdote.

`gpt-oss:20b` is markedly more reliable (4-5/6 across two runs, ~4x
slower per case). Its one recurring miss was `rf-partial-coverage` —
rubber-stamping a rule with an untested failure case as `approved` — which
is exactly the judgment gap that case exists to surface, not a fixture
defect.

Given this, **`gpt-oss:20b` is the recommended default going forward for
any workflow that depends on the QA gate's semantic step being trustworthy**
— the same conclusion ADR 0020 predicted without being able to measure it.
`GOLDEN_SET_QA_MODEL`/the seed script's default stays `qwen2.5-coder:latest`
for now (changing a demo/harness default is a separate decision from
recording what was measured); the floor file's two entries make both
models' real ceilings visible side by side for whoever makes that call.

The floor recorded (`floor.json`) is deliberately below the best observed
run for each model — a ratchet, not an aspiration:
`qwen2.5-coder:latest` at 1/6, `gpt-oss:20b` at 4/6.

**Mechanism proven, but the seed script's plumbing is now load-bearing new
surface.** Two api-side gaps this ADR's own empirical runs found —
`agent_areas` not seeded for a project created by raw insert, and the
worktree needing to live inside `projectScopeRoot` for `decide()`'s
path-scope cap to ever auto-approve anything — are not defects in the
gates or in `decide()`; they are exactly the kind of "the demo forgot a
step `ActivateExecutionUseCase` normally takes care of" gap ADR 0020 itself
found repeatedly. Recorded here rather than hidden, the same way ADR 0020
recorded its own nine failed runs before the tenth closed.
