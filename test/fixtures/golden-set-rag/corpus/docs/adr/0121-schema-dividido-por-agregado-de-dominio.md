# ADR 0121 — The schema split by domain aggregate, behind a barrel

- **Status:** accepted
- **Date:** 2026-08-29
- **References (without editing):** [ADR 0038](0038-fase8-hierarquia-de-areas.md)
  and [ADR 0053](0053-fase14d-dev-lead-e-areas-dinamicas.md) (the aggregate
  boundaries this split mirrors), [ADR 0117](0117-lockfile-proprio-para-o-website.md)
  (same shape of reasoning: a boundary is worth drawing when the shared thing
  charges a price nobody chose to pay).

## Context

`apps/api/src/db/schema.ts` was 2 452 lines holding **51 `pgTable`
declarations and 34 `pgEnum` declarations** — everything from `users` to
`huggingface_model_pull_requests`, from the event log to the RAG chunks.

This was already declared technical debt. `docs/architecture.md`'s debt
table has carried a row for it since the table existed: "the repo's
most-changed file … concentrates the tables into a single file", with the
consequence spelled out in the row itself — **a second collaborator
touching the schema at the same time hits a conflict, guaranteed**, because
every schema change lands in the same file regardless of which part of the
product it belongs to. The number in that row (35 tables) was already stale
by 16 tables, which is its own evidence: the file grew faster than the
paragraph describing it.

Three concrete costs, none of them hypothetical:

1. **Every merge of two schema changes is a textual conflict**, even when
   the two changes are in unrelated aggregates — an auth column and a
   backlog constraint have nothing to do with each other and still meet in
   the same hunk.
2. **`git log --follow` on the schema is useless.** The file's history is
   the union of every product area's history, so "when did `chunks` change
   and why" requires reading commits about `refresh_tokens`.
3. **Reading it requires knowing where to scroll.** The file was already
   internally organised by `// --- section ---` comments that named product
   areas — the split doesn't invent a taxonomy, it promotes one the file
   was already keeping by hand.

## Decision

### 1. One file per domain aggregate, under `apps/api/src/db/schema/`

The buckets **mirror `apps/api/src/domain/*`**, the aggregate boundaries the
codebase already commits to. No new taxonomy: if the domain layer has a
folder for it, the schema has a file with that name.

| file | tables | enums |
|---|---|---|
| `iam.ts` | 5 | 4 |
| `sessions.ts` | 5 | 5 |
| `llm.ts` | 7 | 6 |
| `actions.ts` | 1 | 2 |
| `agents.ts` | 4 | 1 |
| `instructions.ts` | 2 | 0 |
| `backlog.ts` | 3 | 3 |
| `architecture.ts` | 2 | 0 |
| `git.ts` | 3 | 5 |
| `psychologist.ts` | 2 | 0 |
| `anamnese.ts` | 4 | 0 |
| `auth.ts` | 9 | 3 |
| `rag.ts` | 1 | 1 |
| `containers.ts` | 1 | 1 |
| `huggingface.ts` | 1 | 1 |
| `backup.ts` | 1 | 2 |
| **total** | **51** | **34** |

Three placements needed a decision rather than a lookup, and each one is
recorded as a comment at the top of the file that owns it:

- **`handoffs` goes to `sessions.ts`, not `agents.ts`.** The entity is
  `domain/sessions/handoff.entity.ts`: a handoff only exists inside a
  session, and the domain layer already said so.
- **`user_credentials` goes to `llm.ts`, not `iam.ts` or `git.ts`**, even
  though `credential_provider` spans LLM keys *and* git tokens. The entity
  is `domain/llm/user-credential.entity.ts` and `domain/git` has no
  counterpart — the split follows the domain layer, including where the
  domain layer's own choice is a compromise.
- **`backup.ts` is the one file with no matching `domain/` folder.** Backup
  is operational infrastructure with no business rule of its own. Forcing
  it into `architecture.ts` or `containers.ts` would have made the mapping
  lie about what an aggregate is, to avoid a 60-line file. A small honest
  file costs less than a wrong boundary.

### 2. Enums live with the table that calls them, because the module graph has to stay acyclic

A cross-file foreign key is safe under a cycle: `.references(() => otherTable.column)`
takes a **lazy callback** precisely so forward references resolve. A
cross-file **enum** is not: `storyPromotionModeEnum('story_promotion')` runs
at module-evaluation time, and a cycle whose edge points the wrong way
throws `ReferenceError: Cannot access '…' before initialization` at import,
not at query time.

So three enums sit where their only caller sits, rather than where a subject
grouping would put them:

- `project_execution_mode` and `story_promotion` live in **`iam.ts`**, not
  `git.ts`/`backlog.ts`. `projects` is the sole consumer of both. Putting
  them in the "subject" file would have made `iam.ts` depend on `git.ts` and
  `backlog.ts` at evaluation time while both already depend on `iam.ts`
  lazily — two cycles, and `iam` is the first module the barrel evaluates,
  which is the failing direction.
- `failure_origin` lives in **`backlog.ts`**, shared by
  `tasks.blocked_origin` and `delegations.failure_origin`. `agents.ts`
  already imports `tasks` from `backlog.ts` (for `delegations.task_id`), so
  `agents → backlog` is the direction that already exists; the reverse would
  have closed the loop.

The resulting import graph is a DAG: `iam.ts` and `backup.ts` import nothing
from their siblings, everything else flows outward from them. That property
is the thing to preserve when a table is added — not the alphabet.

### 3. `schema.ts` becomes a barrel; not one consumer changes

`apps/api/src/db/schema.ts` is now 25 lines of `export * from './schema/<file>'`,
in the original file's reading order (identity, session, LLM, actions,
agents, then outward to the edges) rather than alphabetical — the order is
the schema's index.

Every one of the **144 modules that import from `…/db/schema`** — 46 under
`src/`, 98 under `test/` and `scripts/` — keeps working with zero edits,
because they still import from the same specifier and the barrel re-exports
everything. That includes
`infrastructure/persistence/drizzle/drizzle-client.ts`, whose
`import * as schema` → `drizzle(pool, { schema })` sees the identical set of
exports it saw before.

### 4. `drizzle.config.ts` keeps pointing at the barrel

`schema: './src/db/schema.ts'` is unchanged. `drizzle-kit` resolves the
module with esbuild and follows the `export *` chain, so it discovers all 51
tables through the barrel — verified, not assumed: `pnpm --filter api
db:generate` prints the full table inventory and then **"No schema changes,
nothing to migrate"**. A glob (`'./src/db/schema/*.ts'`) was the fallback if
that had failed; it didn't, and the barrel is the better pointer because it
is also the entry point the application code uses — one place that decides
what "the schema" means, not two that can drift.

### 5. The acceptance bar is a zero-diff migration, not a passing test suite

The move is purely mechanical: not one table, column, enum value, index name
or constraint expression changed. The proof is `db:generate` producing **no
new migration file and no diff** against the snapshot in
`src/db/migrations/meta/` — a stricter check than the test suite, because
Drizzle diffs the *inferred SQL*, so a flipped `notNull`, a changed default
or a renamed index would show up there even if every test still passed.

## Consequences

- **Two people can change the schema at once without conflicting**, as long
  as they're working on different aggregates — which is the normal case, and
  the exact thing the debt row said was impossible.
- **`git log` on a schema file is now readable.** `git log --follow
  apps/api/src/db/schema/auth.ts` answers "what happened to auth's tables",
  a question that had no answer before. The cost: the history *before* this
  commit still lives on `schema.ts`, and `--follow` won't cross the split
  (it follows renames, not one-to-many splits). Archaeology older than this
  ADR goes through the old path.
- **`docs/.docmap.yml`'s `schema-e-migrations` rule had to grow a glob.** It
  watched the literal `apps/api/src/db/schema.ts`; after the split, a new
  CHECK constraint inside `schema/llm.ts` wouldn't touch the barrel at all,
  and the rule would have gone **silently blind to exactly what it exists to
  watch** — constraints, which its own note calls out as usually being
  business rules. `apps/api/src/db/schema/**` is now watched alongside the
  barrel, which is still a real file that changes whenever a table is born
  or dies.
- **A new table now costs two edits, not one**: the table in its aggregate
  file, and — only if the file is new — a line in the barrel. Adding a table
  to an existing file costs the same as before.
- **The acyclic import graph is now an invariant nobody enforces.** There is
  no test asserting it; a future enum placed in the wrong file will fail
  loudly at import time (a `ReferenceError` on boot, not a subtle bug), but
  it will fail in whoever's terminal, not in review. Declared, not solved.
- **Migrations are untouched.** `src/db/migrations/` and its snapshot are
  byte-identical; this ADR closes the "single file" half of the debt row and
  nothing else. The api↔engine schema-contract debt is a different, still-open
  row and stays open.

## Discarded alternatives

- **Split by layer instead of by aggregate** (all enums in one file, all
  tables in another, all indexes elsewhere): produces files nobody has a
  reason to open, and puts `budgets_scope_check` two files away from
  `budgets`. It also wouldn't fix the conflict problem, since every change
  still touches the enum file.
- **A shared `columns.ts` re-exporting the drizzle column builders**, so each
  file imports one thing. Rejected: it adds a module that exists only to
  save keystrokes, hides which primitives a file actually uses, and makes the
  import list stop being a summary of what the file does.
- **Leave `schema.ts` as the real file and add the split alongside it**
  (deprecating gradually): two sources of truth for the same tables, and
  `drizzle-kit` would see the duplicates. Rejected outright.
- **Change the 144 consumers to import from the specific aggregate file.**
  Tempting — it would make each module's dependency on the schema explicit —
  but it turns a mechanical, zero-diff move into a 144-file change that has
  to be reviewed line by line, and it can be done later, per file, whenever
  someone touches one of them. The barrel doesn't prevent it; it just doesn't
  demand it today.
