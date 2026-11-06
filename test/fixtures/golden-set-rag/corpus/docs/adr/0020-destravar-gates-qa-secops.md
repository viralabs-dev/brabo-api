# ADR 0020 — Unblocking the QA and SecOps gates: gitleaks on the tree, validated verdicts, and tool call in text

- Status: accepted — acceptance criterion CLOSED, but not deterministic with
  a local model (see the dedicated section)
- Date: 2026-07-25
- Phase: 4a (closing the deviations of the PR gates)

## Context

The PR gates (ADR 0013) were complete on paper — state machine with
immutable order and a correction cap, QAAgent with `emit_qa_verdict`
enforced, deterministic SecOpsAgent, `DevAgentServer.correct/3` on the same
branch, UI with the timeline — but **had never run the acceptance
criterion**. There was no gates demo: the `demo-dev-agent-real` stops at the
open PR.

Same move as ADR 0019 for the DevAgent: write the acceptance demo, run it
with a real LLM and real scanners, and fix whatever breaks. The reading
audit found four defects before the first run, one of them fatal; the ten
subsequent runs found six more, plus five inference-environment problems.

Acceptance criterion: on a task with (a) a rule with no test and (b) a
hardcoded secret, QA returns the first, the dev fixes it, SecOps blocks the
second, the dev fixes it, and the PR reaches `awaiting_user` with the 4
verdicts on the timeline. **It closed** — the real sequence is below.

What stands out most in this session: of the ten runs, NONE failed due to a
defect in the state machine, in gate enforcement, or in the return flow.
They failed because a scanner swept the wrong thing, an artifact wasn't
validated, a diagnostic guessed at the cause, context was silently
truncated, a GPU sat idle, and a planting instruction never expired.

## Decisions

### 1. gitleaks scanned the HISTORY, not the working tree (the fatal finding)

`Engine.Actions.GitleaksDetector.Live` ran `gitleaks detect --source
<worktree>`. In gitleaks 8.x, `detect` scans the **commit log**.

Consequence in the gate flow, proven in the container before any fix: the
dev commits the secret → SecOps rejects it → the dev removes the secret in a
NEW commit → the secret is still there in the branch's previous commit →
SecOps rejects again, every round, until the cap is hit and the task turns
`blocked`. **No secret fix was possible: the acceptance criterion was
unreachable.**

```
working tree already clean, secret only in the previous commit:
  gitleaks detect --source  -> 2 commits scanned, leaks found: 1   (rejects forever)
  gitleaks dir              -> no leaks found                      (approves, correct)
```

Fixed to `gitleaks dir <worktree>`. Two consequences recorded:

- The `GITLEAKS_VERSION` pin in `docker/engine/Dockerfile` becomes
  **load-bearing**: `dir` only exists starting at 8.19. An older binary
  returns an exit code outside `[0, 1]`, which already falls into
  `{:error, :scan_failed}` and the gate records "skipped" — it degrades,
  not breaks.
- It now scans the ENTIRE worktree tree (a superset of the diff). A
  secret pre-existing on the base branch fails every PR. That's the
  correct behavior for a gate, but it's broader than the "over the diff"
  ADR 0013 promised — line-by-line diff↔finding correlation remains out
  of scope.
- `gitleaks dir` reports an ABSOLUTE path (`detect` reported a relative
  one); the detector now relativizes it, because the path goes into the
  verdict the user reads and into the dev's correction prompt.

### 2. Verdicts weren't validated artifacts

The spec asks to "record the verdict as an **artifact**", but the two gates
were writing raw `session_event` `artifact.qa_verdict`/`artifact.secops_verdict`,
without going through `Engine.Harness.ArtifactSchemas` — the same deviation
ADR 0019 fixed for `task_blocked`.

- Both types enter `@schemas`, **outside** `@tool_emittable`: they're
  server-emitted (SecOps doesn't even have an LLM; the QA verdict comes
  from the `emit_qa_verdict` tool, enforced separately).
- The verdict's **subject** isn't a fixed required key: the dev gate uses
  `taskId` and `InfraGateRunner` uses `prActionId`, on the SAME artifact
  type. `check_extra/2` requires exactly one of the two — never both,
  never neither. The UI already handled the two structurally
  (`GateSubject`).
- `veredito` is validated against the api's state machine values: a
  verdict outside `approved`/`changes_requested` would make
  `RecordGateVerdictUseCase` blow up, so it's better to reject the
  artifact.
- `Engine.Harness.ArtifactEmitter` (new) concentrates "validate, then and
  only then write + broadcast". `AgentIo.emit_artifact/3` now delegates;
  the three server-side emitters (dev, dev gates, infra gate) use the
  same path.

### 3. A scanner could hang the gate

`run_scanner/3` — duplicated byte for byte between `SecOpsAgentServer` and
`InfraGateRunner` — called `System.cmd` **synchronously inside the
`handle_cast`**, with no timeout. A `semgrep --config auto` stuck on the
network would freeze the whole project's gate, with no diagnostic.

`Engine.Gates.Scanner` (new) unifies the two and applies the idiom from
`Engine.Actions.TerminalExecutor.execute/3`: `Task.async` + `Task.yield` +
`Task.shutdown(:brutal_kill)`, cap in `SECOPS_SCAN_TIMEOUT_MS` (default
180s, much more generous than the terminal's because semgrep scans the tree
and fetches rules over the network). Timeout reuses the "skipped" path that
already existed.

**The timeout test found a regression that the fix itself introduced:**
`Task.async` LINKS the task to the caller, so a detector raising an
exception would take down the gate's GenServer — worse than the original
synchronous call. The call to the detector is wrapped in `try/rescue/catch`
INSIDE the task, turning into a return value.

Semgrep also gained `--metrics=off` and excludes for
`node_modules`/`.git`. `--config auto` still depends on the network;
without it the gate records "skipped" — the acceptance run then depends
only on gitleaks.

### 4. QA had no token cap, and was burning a correction round on the cap

- `QaAgentServer` wasn't passing `token_budget_micros` to the ToolLoop
  (the DevAgent does). The gate reruns on EVERY correction, so the cost
  multiplies with no cap at all. It now uses the same `task_budget_micros`
  as the dev, which was already being read from the database via the same
  path as `max_gate_corrections`.
- A QA that didn't reach a verdict (iteration limit, budget, stalled
  model) turned into `changes_requested`. That **returned to the dev —
  who had nothing to fix — and burned one of the K corrections**; with
  repeated bad luck, a broken QA would block a perfectly fine task and the
  recorded verdict would blame the dev. It now blocks the task directly,
  with the real reason and without spending a correction, distinguishing
  the three outcomes (and using `ctx.last_error` to separate "the model
  stopped" from "the provider failed", the same way ADR 0019 did for the
  dev).

### 5. Local model emits a tool call as TEXT (the finding from the run)

On the first acceptance run, `qwen2.5-coder:7b` produced **exactly the
right work** — the two `write_file` calls and the correct `terminal` call,
with the planted secret and the missing test — but emitted everything as a
```json block in `content`, instead of using the native tool-calling
protocol. `ToolLoop` saw `toolCalls` empty, ended with `{:ok, ctx}`, and the
task died "stopped without finishing or reporting a block". The gate never
even got to open.

`Engine.Harness.ToolCallRecovery` (new) is consulted **only when
`toolCalls` came back empty** — a model that does real tool calling never
goes through there. It extracts top-level JSON objects from the text (a
brace-counting scan, aware of strings and escapes: the model emits several
concatenated objects in the SAME block, which isn't a valid JSON document).

The filter for what counts as a tool call was **tightened during the run
itself**: the first version accepted any object with `name` + `arguments`,
and a real QA emitted `{"name": "enviar(payload)", "parameters": {...}}` —
hallucinating a call to the BUSINESS function it was reviewing. Now `name`
must be in the loop's tool registry (`ctx.tool_specs`). With the name
anchored, `parameters` could be accepted as a synonym for `arguments`
without opening the door to arbitrary JSON. It's not a natural-language
parser: if the model just talked, the result is `[]` and the loop ends as
before.

### 6. A provider error IN THE RESPONSE BODY turned into "the model stopped"

ADR 0019 made `ToolLoop` store `ctx.last_error` when `llm_turn` returns
`{:error, _}`. But the api responds **200 with `error` in the body** when
the provider fails — only broken transport turns into `{:error, _}`. On
that path `last_error` stayed `nil` and whoever consumed the `{:ok, ctx}`
diagnosed "the model stopped without signaling" for what was actually an
infrastructure failure.

Found in the worst possible way: the QA gate died with `fetch failed` on
Ollama and the diagnostic recorded in the event log said "the model stopped
without calling `emit_qa_verdict`" — the system blamed the model for a
provider outage. `loop/1` now records the body's `error` too.

### 7. QA prompt as an explicit protocol

The QA's `initial_message` was a loose paragraph, while the DevAgent has the
repository's AGENTS.md guiding every step. It became a numbered script: the
story's rules listed one by one, which tool to use at each step, one
`coverageMatrix` line per rule, the `approved` criterion spelled out, and
the instruction to never call the functions of the code under review.

### 8. `fetch` with no configurable timeout in the Ollama provider

`ollama-provider.ts` used `fetch`, whose `headersTimeout` in undici is
FIXED at 300s — only configurable by passing a custom `dispatcher`, which
would require the `undici` dependency. In practice the engine's
`LLM_TURN_TIMEOUT_MS` was worthless: the api would give up first, with an
opaque `fetch failed`, and the agent would record "the model stopped" for a
request that was never answered.

Replaced with `node:http` (no new dependency), with
`OLLAMA_REQUEST_TIMEOUT_MS` (default 300000, no behavior change). The
semantics improved along with it: it's an INACTIVITY cap on the socket, not
a total-duration one — a legitimate turn can take minutes processing the
prompt, but it never stays silent for long. The provider had no test at
all; it gained one with a real fake Ollama (`node:http`), covering NDJSON
streaming with a line split across chunks, a silent server, status 500, and
connection refused.

It needs to be `>=` the engine's `LLM_TURN_TIMEOUT_MS`, or whoever gives up
first is the api, and the engine's cap stays decorative.

### 9. The gate's verdict prevails over the task's wording

The original task stays in context during correction (it's what defines
what to implement), and `correction_message` gave the verdict the same
weight. When the gate contradicts the wording — the classic case is SecOps
telling it to remove a secret that the task asked for — the agent would
obey the task and put the problem back. The prompt now explicitly says the
verdict PREVAILS.

Honestly: **this wasn't what closed the acceptance run** (see the
criterion section). It's the right thing to say and it still holds, but
what actually solved it was removing the contradictory instruction from
there.

### 10. `--metrics=off` broke semgrep entirely

Regression introduced by decision 3: `--config auto` REQUIRES telemetry to
be on ("Cannot create auto config when metrics are off"), so every scan
started exiting with an error and the gate recorded "semgrep failed,
skipped" — degrading gracefully, as designed, and precisely because of that
going unnoticed through four consecutive acceptance runs.

Replaced with a NAMED ruleset (`p/security-audit`), which runs with metrics
off. Sending the user's code profile to semgrep.dev just to run a security
gate isn't an acceptable trade-off. The rules still come from the registry
over the network on the first run; without network the gate keeps
recording "skipped".

## Acceptance criterion status: CLOSED, but NOT DETERMINISTIC

Closed on the 10th run, with local `qwen2.5-coder:7b`, exactly in the
sequence from the spec (`pnpm --filter api demo:pr-gates`, exit 0):

```
dev    → PR opened
qa     → changes_requested: story rules with no test
dev    → fixes (SAME branch, no new PR)
qa     → approved                        → awaiting_secops
secops → changes_requested: [gitleaks] src/credenciais.js:2 — GitHub PAT
dev    → fixes (SAME branch)
secops → approved                        → awaiting_user
```

**The 11th run, immediately after, did NOT close** — QA correctly flagged
the rule with no test, the dev fixed it, and on the second pass QA ended
the loop without calling `emit_qa_verdict`. Nothing to do with the fixes:
it's model variance. With local `qwen2.5-coder:7b` the SEMANTIC step of the
acceptance test (matching business rule to test, twice in a row on the same
PR) isn't reliable.

What this means and what it doesn't:

- **The gate machine is verified.** The complete sequence was produced by
  real agents against real scanners: immutable order, return on the same
  branch, correction cap, verdicts as artifacts, terminal
  `awaiting_user`. This doesn't regress between runs — what varies is the
  model's judgment.
- **The demo doesn't serve as an automated regression test** as long as
  it depends on a local 7B. It serves as an executable acceptance
  criterion, to be run deliberately. To make it reliable, point
  `DEMO_QA_MODEL` at an API model: the semantic gate is the role that
  fits worst in a small model, and the per-agent binding (`agent` scope,
  which wins over `project`) exists exactly for this.

The nine runs before the one that closed didn't fail on a gate defect a
single time — they failed on the inference environment and on a design
error in the demo itself. Worth recording because none of them were in
domain code:

### Inference environment (all now exposed in `docker-compose.yml`)

| variable | what was wrong |
|---|---|
| GPU | the `ollama` service had no reserved device: the RTX 4060 sat IDLE while a 5.9GB model ran at 100% on CPU. The QA's ~7,000-token prompt took ~50s just for ingestion. Became the opt-in override `docker-compose.gpu.yml` (`pnpm dev:gpu`), out of the main compose because without `nvidia-container-toolkit` on the host the reservation MAKES the service fail to start. On the GPU: `100% GPU`, 5.5GB in VRAM |
| `OLLAMA_CONTEXT_LENGTH` | default of 4096 SILENTLY truncating a prompt built for 128k — the agent would lose its own instructions and start imitating the tool schema, which is what was left at the end of the context |
| `OLLAMA_MAX_LOADED_MODELS` | with `OLLAMA_KEEP_ALIVE` high, models ACCUMULATE: 15.2GB of resident weights on a 15GB machine, and the agent responding empty for lack of memory |
| `OLLAMA_REQUEST_TIMEOUT_MS` | see decision 8 |
| `START_OUTBOX_DRAIN` / `START_ANAMNESE` | Psychologist and Anamnese consume LLM turns in parallel with the execution agents and would drop the dev's connection mid-cycle. **Warning: the guards only prevent NEW enqueuing** — there were up to 20 `AnamneseWorker` stuck `executing`, accumulated from previous runs, which run on the next boot regardless of the guard. The queue needs to be purged, not just the guard turned off |

### Demo design error: planting instruction that never expires

The secret was planted by telling the dev to write `const TOKEN =
"ghp_..."` in the TASK DESCRIPTION. But the description stays pinned in
context on EVERY correction round: after SecOps rejects it, the dev would
regenerate the file by copying the literal straight from the wording itself
— four times in a row, until the cap ran out. The `write_file` entries in
the event log show the token reappearing intact every round.

No prompt text beats a literal code snippet in the task (decision 9 tried,
and it wasn't enough). The planting was moved to the repository's SKELETON
(`src/credenciais.js`, committed on the base branch): the dev never
receives an order to write the secret, and fixing it to `process.env`
doesn't contradict anything. This only works because SecOps scans the
working tree and not just the diff — the accepted consequence of decision
1, which here became a requirement.

## Consequences

- Tests: `gitleaks_detector_test` runs the REAL binary (`:gitleaks` tag,
  automatically excluded when it doesn't exist) and pins the regression
  from item 1; `scanner_test` covers clean/found/absent/hung/exploding;
  `artifact_schemas_test` covers both subjects and the invalid verdict;
  `tool_call_recovery_test` uses the REAL text that got the demo stuck,
  and the name that is NOT a tool; `tool_loop_test` covers the error in
  the response body; `qa_agent_server_test` covers the block without
  burning a correction. Engine 227.
- `apps/api/scripts/demo-pr-gates.ts` (`pnpm --filter api demo:pr-gates`)
  is the executable acceptance criterion: it exits with a code != 0 when
  it doesn't close, and prints the verdict timeline for diagnostics.

## Scope & assumptions

The planted defects come from the **task description**, not from the
model's luck: it instructs implementing both story rules but testing only
the first, and declaring the literal token in the code. It's artificial on
purpose — what's under test is the gate, not the dev's diligence. The
secret is a synthetic GitHub PAT because gitleaks' default rules catch
`ghp_` by format + entropy, without the example-value allowlist that gets
in the way of AWS keys (`AKIA...EXAMPLE`).

The acceptance test's semantic step (QA matching FR to test) depends on the
model's judgment; `DEMO_MODEL` and `DEMO_QA_MODEL` allow swapping it per
agent. `awaiting_user` remains terminal: the merge is always manual by the
user.

Two lessons that matter beyond these gates:

- **The inference environment is part of the system, not background
  scenery.** Three of this session's problems weren't in any line of
  Elixir or TypeScript: they were in context size, model residency, and
  concurrency between agents. All of them manifested as the agent
  "stopping on its own" — the symptom the code was attributing to the
  model.
- **A diagnostic that guesses is worse than no diagnostic.** Twice in
  this session the system blamed the model for an infrastructure failure
  (item 6), and the fix to the QA gate (item 4) exists because the gate
  was blaming the DEV for QA's own failure. Every agent outcome should
  carry WHERE the failure came from, not just that one happened.
