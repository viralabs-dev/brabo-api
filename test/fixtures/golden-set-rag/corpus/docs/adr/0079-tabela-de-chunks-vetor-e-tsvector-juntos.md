# ADR 0079 — Chunks table: vector and `tsvector` on the same row

- **Status:** accepted
- **Date:** 2026-08-15
- **Prior context:** [ADR 0075](0075-embeddings-no-contrato-de-llm-provider.md)
  (embeddings in the `LLMProvider` contract, a foundation with no consumer
  yet — `embed?` proven only against Ollama), [ADR 0072](0072-projeto-local-ou-container.md)
  (a CHECK in the database to bind a mutually-exclusive pair of columns, the
  same pattern used here for `session_id`/`source_path`), [ADR 0078](0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)
  (why the tab stays labeled "Chat", not "Chat RAG" — this migration does
  NOT change that label)

## Context

The Chat RAG the design handoff announces (`design_handoff_brabo/designs/Brabo
Chat.dc.html`) needs somewhere to store indexed chunks with an embedding
vector — today NO table exists for that. ADR 0075 got the contract ready
(`LLMProvider.embed?`, capability proven on Ollama with `nomic-embed-text`,
768-dimension vectors), but nothing yet writes to or reads from an index:
without a table, the contract is a door with no room behind it.

Two questions needed a decision before the migration could be generated, and
both are structural, not implementation details:

1. **Do vector and lexical search live in the same table, or two?** Wave 4
   (out of scope for this migration) is going to build HYBRID search —
   semantic (`pgvector`, cosine similarity) and lexical (`tsvector`,
   Postgres full-text) combined. If the two lived in separate tables, every
   hybrid search would need a `chunk_id` JOIN, and the two tables could
   diverge (a chunk with a vector but no lexical entry, or the reverse) with
   nothing in the database preventing it.
2. **Which scopes does the index cover?** The handoff hints at "search
   within the project", which is too vague to design a column around. The
   investigation found EXACTLY three text sources the product already
   produces and knows the origin of: `docs/` files, ADRs (which are also
   files, but with their own identity — an ADR is citable by number, a
   generic doc isn't), and sessions (the event log already has plenty of
   text). Source code and Pull Requests were left out ON PURPOSE: both
   change on every `push`, and indexing them without a reindexing watcher
   would make the index **lie** about coverage — the same class of error
   ADR 0042 already rejects for model capability ("declare without
   proving"). Three honestly-covered scopes are worth more than five with a
   made-up number.

One more point wasn't a product decision, but a technical finding with a
deployment consequence: `docker/postgres/init.sql:2` runs `CREATE EXTENSION
IF NOT EXISTS vector`, but that file only runs on the FIRST initialization of
the Postgres volume. An environment with an old volume — including,
possibly, production — may not have the extension installed, and creating it
requires a privilege the application role may not have.

## Decision

**A single table, `chunks`, with `embedding vector(768)` and `search_vector
tsvector` as sibling columns on the same row.** `search_vector` is
`GENERATED ALWAYS AS (to_tsvector('portuguese', content)) STORED` — never
written by the application, always coherent with `content` by Postgres's own
construction, and ready in the same transaction as the `INSERT` (it doesn't
depend on any LLM provider responding). `embedding` is NULLABLE: the
indexing pipeline (Wave 4) doesn't exist yet, and making the CHUNK (the text
excerpt) wait for the VECTOR would mix two failures of different nature —
document parsing versus a network call to a provider — into one atomic
write.

**HNSW index over `embedding` (`vector_cosine_ops`), not IVFFlat.** IVFFlat
needs rows already loaded to train its lists (`lists`) — built over an empty
table, which is exactly this table's state at birth (no indexing pipeline
yet), the index stays bad until someone manually rebuilds it after
populating it. HNSW builds the graph incrementally, insertion by insertion,
with no training step — the index is good from the very first row.
`vector_cosine_ops` because it's the metric text embeddings generally
expect (similarity ranking shouldn't change with the vector's magnitude).

**GIN index over `search_vector`** — the lexical half, ready for Wave 4's
hybrid search to use via `@@`/`ts_rank`, with nothing to compute at query
time.

**The three scopes (RN-219) are a `pgEnum` — `docs` | `adr` | `session` —
and `session_id`/`source_path` are mutually exclusive via CHECK, not by
application convention**, the same pattern ADR 0072 used for
`workspace_mode`/`workspace_path`: `scope = 'session'` requires `session_id`
to be filled and rejects `source_path`; `docs`/`adr` require `source_path`
(the source file's relative path) and reject `session_id`. The guard lives
in the database because whoever writes this table is a pipeline (Wave 4)
that won't necessarily go through the same use case every time — a batch
reindexing script is an obvious candidate to bypass application-only
validation.

**The migration loads `CREATE EXTENSION IF NOT EXISTS vector` itself**,
instead of assuming `docker/postgres/init.sql` has already run.
`IF NOT EXISTS` is idempotent — local (where the extension is already
installed, confirmed by `SELECT * FROM pg_extension WHERE extname='vector'`
before writing this ADR) and a fresh environment go through the same line
with no visible behavior difference.

**This migration is born on a `breaking/` branch, not `feature/`.** Creating
an extension requires the application role to have `CREATEDB` (or for the
extension to be marked "trusted" by the DBA). Locally the role is
superuser (confirmed by `SELECT rolsuper FROM pg_roles WHERE
rolname=current_user`), but nothing guarantees that in production — managed
Postgres providers frequently don't grant superuser to the application. If
the migration fails there, it's an action for the OPERATOR before deploy
(run `CREATE EXTENSION vector;` once, as superuser), not a product bug —
exactly the criterion CLAUDE.md already uses to decide `breaking/` versus
`bugfix/`/`feature/`: "a change that requires operator action before deploy
is born in `breaking/` even when the content is a fix".

## Consequences

**What this migration delivers is only the FOUNDATION**: the table, the
indexes, the basic write/read repository (`ChunkRepository`). It doesn't
write a single row — there's no indexing pipeline, no hybrid search, no UI.
The tab stays "Chat" (ADR 0078); nothing changes in the label until Wave 4
delivers what the name "Chat RAG" promises.

**Reindexing `docs`/`adr` is the responsibility of whoever writes the
pipeline (Wave 4), not this migration** — the table has no hash/version
column for the source file to detect changes, because that decision belongs
to whoever actually runs the reindexing and knows which strategy (content
hash, `mtime`, commit version) makes sense for the watcher that doesn't
exist yet.

**Source code and PRs remain outside the index.** If they're added someday,
the decision has to come with a push-triggered reindexing mechanism — it
isn't a trivial extension of the `chunk_scope` enum, because this table's
honest-coverage guarantee depends on every scope having a clear story for
"when does this chunk go stale".

**In production, this migration may stop at `CREATE EXTENSION`** if the
application role lacks the privilege — intentional behavior (fail loud and
early) rather than the table being born without the `vector` type available
and failing more confusingly down the line, on the first `INSERT` attempt.
