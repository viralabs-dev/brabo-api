---
id: git-providers
title: Git Providers
sidebar_label: Git Providers
sidebar_position: 5
description: The fifteen-operation contract that makes Local, GitHub, and GitLab interchangeable, with capabilities, normalized errors, and retry policy.
keywords: [git, GitProvider, GitHub, GitLab, capabilities, retry]
traducao_de: c51acb4a5b495be1be6f3e263783d9fd5ad91911
---

# Git Providers

Brabo works on top of a real git repository, and three backends serve that
role: **Local** (bare repos on disk), **GitHub**, and **GitLab**. The domain
code doesn't know which one is in use — it speaks to a single contract.

Decisions in ADRs [0001](../adr/0001-git-provider-contract-shape.md) through
[0005](../adr/0005-repo-bootstrap-idempotent-steps.md) and
[0028](../adr/0028-protecao-de-branch-divergencia-entre-providers.md).

## The contract

`GitProviderContract`, in `packages/shared/src/index.ts`. **Fifteen operations** —
the tenth entered in Phase 4a, with the PR gates; the 11th and 12th in PHASE 26, with
the Code tab (read-only); the 13th, 14th, and 15th in PHASE 26b, the foundation of
that same tab's declared pending items (blame, navigable PRs, rich branch —
no UI consuming them yet):

| operation | returns |
|---|---|
| `createRepo` | `GitRepo` |
| `getRepo` | `GitRepo` |
| `createBranch` | `GitBranch` |
| `protectBranch` | — |
| `listBranches` | `GitBranch[]` |
| `commitFiles` | `GitCommitResult` |
| `getFileContent` | `string \| null` — `null` if the file (or the branch) doesn't exist |
| `openPullRequest` | `GitPullRequest` |
| `mergePullRequest` | `GitPullRequest` — a PR already merged is refused (`GitPullRequestAlreadyMergedError` in `local`; GitHub refuses the repeated merge itself), [RN-663](../business-rules/api.md#rn-663). In `local` it is a real merge: fast-forward when the target is an ancestor, otherwise a two-parent merge commit; a conflict throws `GitMergeConflictError` (files listed, target ref untouched, PR stays open, HTTP 409 `merge_conflict`). GitHub/GitLab refuse a conflicting merge through their own API, untranslated, [RN-704](../business-rules/api.md#rn-704) |
| `commentOnPullRequest` | — (QA/SecOps verdict on the PR) |
| `listTree` | `GitTree \| null` — `null` if the ref or the path don't exist |
| `getPullRequestDiff` | `GitPullRequestDiff \| null` — `null` if the PR doesn't exist |
| `blame` | `GitBlame \| null` — `null` if the file (or the ref) doesn't exist |
| `listPullRequests` | `GitPullRequestList` — summary per PR, not `GitPullRequest[]` |
| `listBranchesDetailed` | `GitBranchDetailList` — `ahead`/`behind`/associated PR per branch |

Two more fields: `name` and `capabilities`.

### The two read operations (PHASE 26)

`listTree` lists **one level** of the tree, never the whole tree: the Code tab
navigates on demand, and asking for everything in a large repository is the
traffic amplifier the phase forbids. A missing or `""` `path` is the root; each
entry carries the full `path` and `name` (the leaf).

`getPullRequestDiff` normalizes the diff into `status`
(`added|modified|removed|renamed`), `additions`, `deletions`, and `patch`. The
`patch` is `string | null`, and the distinction matters: `null` means **it
didn't come back** (binary, or a patch too large for the response), while `""`
would mean "it came back empty". Collapsing the two would make the screen say
"no changes" for a changed binary.

Both absences follow the vocabulary `getFileContent` already used — `null`,
not an exception — so the Code tab treats "doesn't exist" in a single way.

**Ceilings.** Both cut off, and warn via `truncated: true`. The numbers live in
`apps/api/src/domain/git/git-read-limits.ts` (1000 entries per level, 300
files per diff) and **not** in `packages/shared`, which is 100% types — an
`export const` there survives `tsc` and breaks the api's boot in production
(guarded by `apps/api/test/packages-shared-so-tipos.spec.ts`).

### The three foundation operations (PHASE 26b — RN-110/111/112)

Foundation for the three declared pending items of the Code tab (blame, rich
branch dropdown, navigable PR list) — the UI for each is a later wave, in
three separate agents. All three follow the absence vocabulary
`getFileContent`/`listTree`/`getPullRequestDiff` already used: `null`, never
an exception, when the resource doesn't exist.

`blame(ref, path)` annotates each line with the commit that last touched it —
sha, author, date, first line of the message. It's the **only** operation
that speaks GraphQL: GitHub's REST API has no blame, only the GraphQL API
(`repository.object(expression:).blame(path:)`). GitLab uses
`RepositoryFiles.allFileBlames`; Local uses `git blame --porcelain`. It cuts
off at `GIT_BLAME_LINE_LIMIT` (2000 lines).

`listPullRequests(state?)` returns `GitPullRequestSummary[]` — id, number,
title, author, state, branches, `updatedAt` — **not** `GitPullRequest[]`,
which is the WRITE type (open/merge) and never had a title or author. `local`
lists from the SAME sidecar PR store from Phase 4a. It cuts off at
`GIT_PR_LIST_LIMIT` (100, one page, no follow-up pagination).

`listBranchesDetailed(defaultBranch)` is its **own** operation, not an
extension of `listBranches` — see the capabilities table below for why. Each
enriched branch gets `ahead`/`behind` (relative to `defaultBranch`, which the
CALLER already knows and passes — asking the provider for it again would be
one more call) and the open associated PR, if any. `null` in both numbers
when the provider can't compute it (orphan branch, unrelated history) —
honest degradation, never a made-up number. It cuts off at
`GIT_BRANCH_DETAIL_LIMIT` (30 branches).

### The CALL ceiling, and the CONSUMPTION ceiling (PHASE 26b)

The two numbers above limit what a provider returns in **one** call. The HTTP
surface that consumes them has its own ceilings, in the same file, and they
answer a different question: how many CALLS a single client request can
trigger. `listTree` is cheap once and expensive a thousand times.

What forces the distinction is the **Code tab search**, which is **not an
operation of this contract** — none of the three providers has it. GitHub and
GitLab have platform-level code search, with their own semantics and limits;
`LocalGitProvider` is a bare repo and has nothing like that. Declaring it here
would mean either a 13th operation with capability `false` on local (a tab
that disappears on one provider), or a platform's vocabulary leaking into the
normalized contract that exists precisely to prevent that.

So it stays **composed at the application layer**
(`application/use-cases/git/read-project-code.use-case.ts`), on top of
`listTree` + `getFileContent`, with three budgets — directories traversed,
files opened, and matches returned — plus a short-TTL cache
(`domain/git/git-read-cache.ts`) so browsing and searching don't repeat the
same calls. Who pays is the **workspace owner's** credential
([RN-058](../business-rules/api.md#rn-058)/[RN-082](../business-rules/api.md#rn-082)),
and the rate limit is the provider's — see [RN-095](../business-rules/api.md#rn-095)
and [ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md).

## Capabilities

Not every backend does everything, and that's **declared**, not discovered on
failure:

```ts
interface GitProviderCapabilities {
  readonly protectBranch: boolean;
  readonly pullRequests: boolean;
  readonly listTree: boolean;
  readonly pullRequestDiff: boolean;
  readonly blame: boolean;
  readonly pullRequestsList: boolean;
  readonly branchesDetailed: boolean;
}
```

| provider | `protectBranch` | `pullRequests` | `listTree` | `pullRequestDiff` | `blame` | `pullRequestsList` | `branchesDetailed` |
|---|---|---|---|---|---|---|---|
| Local | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| GitHub | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| GitLab | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

The two PHASE 26 capabilities, and the three from PHASE 26b, are `true` on all
three because the **contract suite exercises them on all three** — it's the
same criterion from ADRs 0041/0042, which also applies to git: a capability
is only declared once proven, and without proof it's declared `false` and
degrades. Local fulfills them with `git ls-tree`/`git diff`/`git blame
--porcelain`/`git rev-list --left-right --count` on the bare repo, with no
platform behind it at all — it's the only one of the three providers tested
against REAL git (`local-git-provider.contract.spec.ts`); GitHub and GitLab
run against msw's fake backends, and the real smoke tests
(`{github,gitlab}-provider.smoke.spec.ts`) remain skipped without
`GITHUB_TEST_TOKEN`/`GITLAB_TEST_TOKEN` in the environment — the same
situation already documented in PHASE 13a for the LLM providers.

`pullRequestsList` deserves a separate note: the original assumption was that
`local` wouldn't have PRs, "single-repository concept has no PR" — that
didn't hold up. The sidecar PR store from Phase 4a (self-contained for the
dev agents) is already the source, and all three `local` capabilities ended
up `true`.

One declared degradation, and it's about DATA, not about the operation: GitLab
doesn't bring file size in the tree listing (`RepositoryTreeSchema` has no
such field, and asking for it per entry would cost one request per file), so
`size` comes back `null` there. The operation exists and works; what's
missing is a column.

The Local provider implements PRs internally (there's no server to host
them, but the flow exists) and does **not** implement branch protection —
there's no platform to apply it. Calling `protectBranch` on it raises
`GitNotSupportedError`, an explicit error, never a silent no-op
([RN-028](../business-rules/contracts.md#rn-028)).

> **Capability isn't the gate.** Platform branch protection is defense in
> depth. What prevents an improper merge is the **domain-level ceiling**,
> which works the same way on all three providers, including Local, which has
> no protection at all ([RN-006](../business-rules/api.md#rn-006)). The
> [ADR 0028](../adr/0028-protecao-de-branch-divergencia-entre-providers.md)
> documents the divergence between GitHub and GitLab and why it doesn't
> change the guarantee.

## Normalized errors

Each provider translates its own platform's error into one of these classes.
The domain never sees a GitHub 422 or a git `fatal:`:

| error | when |
|---|---|
| `GitRepoAlreadyExistsError` | creating a repository that already exists |
| `GitRepoNotFoundError` | repository doesn't exist or no access |
| `GitBranchNotFoundError` | branch doesn't exist |
| `GitBranchAlreadyExistsError` | creating a branch that already exists |
| `GitPermissionDeniedError` | valid credential, insufficient permission |
| `GitNotSupportedError` | operation outside that provider's `capabilities` |
| `GitCredentialConnectionTestFailedError` | credential connection test failed — **doesn't** reach HTTP: `TestStoredCredentialUseCase` catches it and returns `refused` ([ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md)) |
| `GitProviderAuthError` | invalid or expired credential |
| `InvalidOauthStateError` | OAuth `state` doesn't match |

**There is no common base class**, and that was decided, not forgotten: the
[ADR 0002](../adr/0002-git-error-normalization.md) records that an abstract
`GitError` was considered and rejected for not paying for itself while no
single HTTP filter needs it.

The distinction that matters most in practice is `GitPermissionDeniedError`
versus `GitProviderAuthError`: the first means "the token is valid but can't
do this", the second "the token doesn't work". Confusing the two sends the
user to re-authenticate when the problem was scope.

## Retry

**Only on reads, never on mutations**
([ADR 0003](../adr/0003-git-provider-retry-policy.md)).

The algorithm is Full Jitter, AWS's:
`sleep = random(0, min(maxDelay, base · 2^attempt))`, with 4 attempts by
default. `apps/api/src/infrastructure/git/retry.ts`.

The asymmetry is the whole decision: retrying a `listBranches` that timed out
is harmless; retrying a `commitFiles` that may have gone through creates a
duplicate commit. When there's no way to know whether the mutation happened,
the right answer is to fail and let a human look.

## The contract suite

A single suite — `apps/api/test/contract/git-provider.contract.ts` — runs
against all **three** providers. It's what guarantees that "works on Local"
doesn't become "works only on Local".

It's also the mechanism that keeps `capabilities` honest: a provider that
declares `protectBranch: true` needs to pass the protection tests; one that
declares `false` needs to raise `GitNotSupportedError`. Declaring it wrong
breaks the suite in both directions.

Two guardrails accompany the suite, in
`apps/api/test/contract/git-provider-contract-callers.spec.ts`. The first
checks that the suite's header lists exactly who invokes it. The second is
item 33 of PHASE 26: **a contract operation with no consumer in `src/` fails
CI** — an operation all three providers implement and nobody calls is
permanent weight, and nothing proves it works on the real path.

The escape hatch for a phase to deliver a contract before the routes is
narrow and named: the `SEM_CONSUMIDOR_AINDA` map, with the phase that will
consume it written next to each operation. It closes itself — as soon as the
operation gets a consumer, the entry starts to **fail**, forcing whoever
wrote the route to delete it.

**The map has been empty since PHASE 26b**, and it was emptied by the
mechanism, not by anyone's memory: as soon as
`application/use-cases/git/read-project-code.use-case.ts` started calling
`listTree` and `getPullRequestDiff`, the second test failed pointing at the
two entries by name. Empty, and not removed — the escape hatch remains
available for the next contract that's born before its consumer.

:::caution The fake has to lie the same way the remote does
The suite runs against fake backends (msw) for the remote providers, and a
fake that's more GENEROUS than the real API leaves the suite green while the
product breaks. That's what happened with the empty repository: GitHub's fake
responded `404` to a nonexistent ref, GitHub actually responds
**`409 Git Repository is empty`**, and bootstrap died on the very first step
of every new GitHub project — with the whole suite green. When adding a case
to the fake, check the response against the live API, not against what seems
reasonable.
:::

### The first commit in an empty repository

A freshly created GitHub repository has no commit at all (`auto_init: false`),
and there the **entire Git Data API** responds `409` — refs, blobs, trees,
commits. There's no way to assemble the first commit through it. What works
is the Contents API (`PUT /repos/:owner/:repo/contents/:path`), which creates
the file, commit, and branch all at once; it's what `commitFiles` uses when
it detects the repo is empty.

With **one** file — bootstrap's case, which commits one per step — you get
exactly one commit, as the contract promises. With more than one, the first
is born via the Contents API (it's the one that creates the branch) and the
rest go into a second commit via the normal path: two commits instead of one,
a declared degradation because the alternative would be refusing the initial
multi-file commit.

`LocalGitProvider` doesn't go through any of this: its `git init --bare`
accepts the first commit via the usual path.

## Gitflow bootstrap

Five steps that prepare the project's repository: permanent branches
(`dev`, `qa`, `main`), protections where the provider supports them, and base
files.

There used to be six: there was a `create_rc_branch` step, which created the
`rc` rung between `qa` and `main`. The rung left the policy via
[ADR 0030](../adr/0030-politica-de-branches-mecanizada.md) and the step left
bootstrap afterward, once the mismatch was noticed — the product was
creating, protecting, and **documenting in the user's repository** a
four-rung ladder it had itself abandoned. The `create_rc_branch` value
remains in the database's `bootstrap_step` enum: old bootstraps have rows
with it, and a step that actually happened doesn't get erased.

Two properties, both tested
([ADR 0005](../adr/0005-repo-bootstrap-idempotent-steps.md),
[RN-029](../business-rules/api.md#rn-029)):

**Idempotent** — each step checks before acting. Running it twice doesn't
duplicate anything.

**Resumable** — failed on step 4? The resume starts at 4, not at 1.

Each step emits its own event, and there are five possible outcomes:

| event | means |
|---|---|
| `bootstrap.step_started` | started |
| `bootstrap.step_completed` | did the work |
| `bootstrap.step_skipped` | was already done — **this is success** |
| `bootstrap.step_degraded` | completed without a capability (branch protection on Local) |
| `bootstrap.step_failed` | failed; the resume starts here |

`skipped` and `degraded` exist separately from `completed` on purpose: a
bootstrap that skipped everything because the repository was already ready is
a different outcome from one that did everything, and one that ran without
branch protection is different from both. Collapsing all three into "ok"
would lose exactly the information someone will want later.

## Adopting an existing repository (Phase 12a)

A project can point to a repository that **already exists**, instead of
creating one. `project_repositories.origin` says which of the two it was
([RN-046](../business-rules/api.md#rn-046)).

Adoption uses **only what the contract already had**: `getRepo` validates
access — it had existed since Phase 2 and no use case called it — and the
diagnostic uses `listBranches` and `getFileContent`. **No new method entered
the contract, and the contract suite was left untouched.**

Bootstrap does NOT run on adoption. What comes out is a **plan**: the
serialized list of what it would do, obtained by calling each step's
`check()` — the same one that gives idempotency — without executing anything.
The user then either approves the whole plan, or adopts as-is and dismisses
bootstrap
([RN-045](../business-rules/api.md#rn-045)).

| event | means |
|---|---|
| `bootstrap.repository_adopted` | the repository became the project's; nothing in it was changed |
| `bootstrap.plan_approved` | the user approved it — **only from here does bootstrap run on an adopted repo** |
| `bootstrap.adopted_as_is` | the user dismissed bootstrap; the plan stays stored as evidence of what wasn't applied |

**Divergent protection is presence × absence, and only that.** The contract
exposes `GitBranch.protected` as a boolean, and
[ADR 0028](../adr/0028-protecao-de-branch-divergencia-entre-providers.md)
deferred a normalized `ProtectionPolicy` — so the plan can say "`qa` is
unprotected → would apply" and "`main` is already protected → won't touch",
but it can't say that the existing protection requires two reviewers and ours
would require one. A branch with PARTIAL protection counts as unprotected,
and can be overwritten — always within an approved plan.

A branch the template doesn't know about (`develop`, `release/*`) becomes an
**informational diagnostic** and is never touched: an adopted repository has
whatever policy it has.

Decision in [ADR 0044](../adr/0044-adocao-de-repositorio-existente.md).

## Credentials

Git tokens are user secrets: encrypted with envelope encryption, one DEK per
record, never in plaintext in the database or in logs. The table is
`project_git_connections`, and it takes part in the master key rotation
alongside LLM credentials — see the
[runbook](../runbook.md#rotacao-da-chave-mestra).

Registration uses a dedicated database enum (`credential_provider`), joined
with the LLM providers **only at the TypeScript type level**, without mixing
the enums
([ADR 0004](../adr/0004-git-credential-registration.md)).

Two connection paths: **PAT** (pasted token) and **OAuth** (GitHub and
GitLab). OAuth requires `GITHUB_OAUTH_CLIENT_ID`/`_SECRET` or the GitLab
pair configured; without them, PAT only
([configuration](configuration.md#git)).

## What doesn't exist

Bitbucket and a `GenericGitProvider` are **out of scope** — they aren't
forgotten backlog, they're a decision. Adding a new provider means
implementing all fifteen operations, honestly declaring the capabilities, and
passing the contract suite.

**Writing from the Code tab also doesn't exist.** The seven read operations
(`listTree`, `getPullRequestDiff`, `blame`, `listPullRequests`,
`listBranchesDetailed`, plus `getFileContent` and the composed search) are
read-only, and that's all. Saving a file from the tab is a future phase, and
when it comes, writing is an external effect: it's born as a
`proposed_action`, like every git mutation. What makes this verifiable
instead of just an intention is that `CodeController` doesn't have **a
single** write verb — no `@Post`, no `@Put`, no `@Patch`, no
`@Delete` — even after PHASE 26b added three routes to it.
