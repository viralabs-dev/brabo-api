# ADR 0104 — `execution_mode` in three values, and the workspace is born `unverified` when the runner is the one who verifies it

- **Status:** Accepted
- **Date:** 2026-08-22
- **Context:** ADRs 0072 and 0103 were never reconciled with each other
- **Revises (without softening) the ground of:** [ADR 0072](0072-projeto-local-ou-container.md), [ADR 0103](0103-runner-local-execucao-na-maquina-do-usuario.md)

## Context

Two ADRs of this product describe physically incompatible executions under
the SAME field name, and nobody had reconciled the two until now.

[ADR 0072](0072-projeto-local-ou-container.md) created
`projects.workspace_mode` (`'container'|'local'`) + `workspace_path`. In
`local` mode, [RN-170](../business-rules/autenticacao.md#rn-170) validates at CREATION
time that the folder is **mounted via bind-mount** inside both the api's AND
the engine's containers — `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
(`validarCaminhoDeWorkspaceLocal`) runs `access(W_OK|X_OK)` **inside the
api container's process**, and refuses with 400 when it doesn't find it. The
web wizard (`apps/web/src/routes/NewProjectWizard.tsx:71,462-468`) only
teaches how to edit `docker/docker-compose.yml` with a bind-mount line — no
other instruction exists.

[ADR 0103](0103-runner-local-execucao-na-maquina-do-usuario.md) created
`apps/runner`: a CLI that runs on the user's MACHINE, **with no bind-mount
at all**, connecting to the engine via a Phoenix channel (`/runner`, topic
`terminal:<projectId>`) authenticated by a single-use ticket issued by the
engine itself. It executes agent commands already approved by the normal
pipeline and opens a real interactive PTY terminal — the Terminal tab
(`apps/web/src/routes/code/TerminalPanel.tsx`) already uses real
`@xterm/xterm` for this. [RN-420](../business-rules.md#rn-420), which
decides when to route a command to the runner instead of the usual
`System.cmd`, reuses the SAME `workspace_mode == "local"` condition (plus a
connected runner) — ADR 0103 never created a third value for the field.

The practical result: today, to USE the runner — which exists precisely to
do away with bind-mount — the user is still forced to go through ADR 0072's
bind-mount validation just to create the project. The two halves of the
product cite the same 2-value enum to describe two executions that have
nothing physically in common: a folder mounted in both containers, and a
folder that only exists on the user's machine. Confirmed by direct reading
of the code: `apps/api/src/db/schema.ts:238-240`
(`projectWorkspaceModeEnum = pgEnum('project_workspace_mode', ['container',
'local'])`) and `apps/api/src/domain/iam/project.entity.ts`
(`PROJECT_WORKSPACE_MODES = ['container', 'local']`, whose existing comment
already warns of the risk of confusing the homonym with the
`GitProviderName` `'local'` — a risk this ADR inherits and needs to preserve
when renaming the field).

This finding came up while investigating "what's missing for the product to
actually access the user's folder and terminal outside the scope of
Docker" — it wasn't recorded anywhere as a formal divergence before this
session.

## Decision

1. **`execution_mode` replaces `workspace_mode`, with three values:**
   `container` (default, the usual behavior — everything inside Docker),
   `mounted` (the former `local` — bind-mount, RN-170 keeps applying, now
   conditioned on this value) and `runner` (the folder only exists on the
   user's machine, with no bind-mount at all). The name changes because
   `local` already carried the ambiguity with `GitProviderName`, and would
   go on to need to carry TWO incompatible physical semantics (mounted vs.
   not-mounted) under the same label — `execution_mode` names the real axis
   the field decides (WHERE the command executes), no longer "where the
   code lives," which the two new modes answer in ways that can't share
   validation.

2. **RN-170 becomes conditional on `execution_mode = 'mounted'`.** For
   `execution_mode = 'runner'`, creation still validates the LEXICAL part of
   the path (absolute, no `..` in any segment, outside the root and system
   folders, no overlap with the Brabo checkout in either direction) — none
   of that depends on container I/O, and it keeps applying because it's the
   same scope that authorizes the agent's terminal
   ([ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)). What
   changes is the DISK part (exists, is a folder, is writable): for
   `mounted` it keeps running at creation, inside the api container, as
   today; for `runner` that check is DEFERRED — there's no way for the api
   to confirm something that only exists on the user's machine. Who has the
   authority to do that `access()` is the runner, running on the real host.

3. **A project in `execution_mode = 'runner'` is born with `workspace:
   unverified`, promoted to `verified` when the first runner connects and
   confirms the path on the host.** Same spirit as a pending state with
   event evidence that `docs/gates.yml` already uses for gate `status:
   planned` + `evidencia: event_log` — the declared folder is accepted
   immediately (creation doesn't block waiting for a runner that doesn't
   exist yet), but the product doesn't assert "the path is valid" until it
   has proof that someone, on the right machine, confirmed it. The exact
   MECHANISM — the event name, the route the runner calls to confirm, where
   the state is stored — is left for the implementation session: this ADR
   declares the EXISTENCE of the state and the promotion CRITERION, not the
   mechanics.

4. **A consequence, not a request in its own right: converting
   `execution_mode` between the three values stops requiring recreating the
   project.** Today the mode is only chosen at creation (ADR 0072, item 1)
   — with the difference between values reduced to a column (plus the
   verification state from item 3), this stops being a structural
   limitation. **All conversion directions become allowed**, with no
   restriction of its own declared here — `container ⇄ mounted ⇄ runner`, in
   either direction. The mechanics of each transition (what happens to the
   worktree/state when switching, whether there's a confirmation of its own
   per direction) is left for the implementation session; this ADR only
   declares that conversion is allowed in any direction.

### Delivery order for what's left for later

This decision (items 1–3 above) is **P1**: without it, the runner exists but
nobody can reach it without first mounting the folder it was designed to do
away with. What's left for later, in the order the product owner has
already set (full detail in
[backlog.md](../explanation/backlog.md#backlog-of-the-runnerexecution_mode-adr-0104)):

- **Runner distribution** (`tsup` → single package + `npm publish
  @brabo/runner`) — today it's `"private": true` with `bin` pointing to a
  raw `.ts`, only reachable by cloning the whole monorepo.
- **Long-lived account token (PAT)**, replacing the login replay of
  `apps/runner/src/auth.ts` — needs to come BEFORE distribution, because
  publishing today would distribute a password+cookie flow saved to disk.
- **Runner exclusivity by `{project_id, machine_id}`**, instead of just
  `project_id` — DEFERRED until a real activation criterion exists (a
  second dev actually simultaneous on the same project).
- **`guard.ts` best-effort** — not a gap to close, see Consequences.

## Consequences

**What hurts, and isn't resolved by this ADR:** `ALTER TYPE ... ADD VALUE`
has transactional restrictions in several PostgreSQL versions (it can't be
used in the same transaction where the new value is referenced). The
migration that introduces the enum's third value needs to handle this
explicitly (two steps, or recreating the type) — recorded here as a
technical risk for the implementation session, not resolved in this
document.

**What stays DECLARED as an invariant, not as a gap:**
`apps/runner/src/guard.ts` remains, and will remain, a best-effort LEXICAL
check — vulnerable to TOCTOU and to a symlink created after the check, with
no sandbox, no separate user, no real technical limit. This was already
declared in ADR 0103; this ADR explicitly REAFFIRMS it, because
`execution_mode = 'runner'` stops being a conditional bonus (`local` mode +
a runner connected by chance) and becomes a FIRST-CLASS path at project
creation — and a first-class path runs the risk of being read, by someone
who didn't follow ADR 0103, as a promise of isolation that never existed.
The runner's real security boundary remains, only: authentication (the CLI
identifies itself with the user's account token) + the usual approval
pipeline (every agent command is born a `proposed_action`, including ADR
0102's absolute ceilings) + the user's consent to run the binary on their
own machine.

**What this ADR does NOT do:**

- It doesn't implement any line of code, migration, route, or UI — it's a
  recorded decision; the implementation session executes it on top of
  `origin/dev`.
- It doesn't design the exact mechanism of the `unverified`/`verified`
  state (event, route, where it's stored) — it only declares that it exists
  and the promotion criterion.
- It doesn't implement any conversion between `execution_mode` values — it
  only declares that all directions become allowed.
- It doesn't change the external-effect boundary (RN-106/RN-418): `git
  push`, opening a PR, and deploy remain unconditional `require_approval`,
  inside or outside the scope, in any `execution_mode`.
- It doesn't change the path-scope policy nor the terminal allowlist (ADR
  0055) — what changes is only where/when the disk is checked at project
  creation.
