# ADR 0080 — Hybrid search: weights, threshold, and what counts as a citation

- **Status:** accepted
- **Date:** 2026-08-16
- **Prior context:** [ADR 0079](0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)
  (the `chunks` table, with vector and `tsvector` in the same row — foundation
  without pipeline or search), [ADR 0075](0075-embeddings-no-contrato-de-llm-provider.md)
  (`LLMProvider.embed?`, capability proven only against Ollama)

## Context

ADR 0079 left the table ready and empty: no pipeline writes to it, no search
reads from it. This wave (PROGRAM 28, Wave 4, front G2) needed to answer four
open questions, and all four are structural — a product decision, not an
implementation detail:

1. **Where does the text that becomes a chunk come from**, for the three
   honest scopes of ADR 0079 (`docs`, `adr`, `session`)?
2. **How to cut** a document/message into pieces — size, overlap — without an
   arbitrary number?
3. **What to do when the embedding provider doesn't respond?** The pipeline
   can't pretend it indexed completely when it only indexed the lexical half.
4. **How to combine** the vector signal (pgvector) with the lexical one
   (`tsvector`) into a single search, with what weight and what cutoff — and
   **what to return** as a citation, since it's this contract that Chat RAG
   (Wave 5, screen not yet built) will consume without being able to guess
   its shape.

## Decision

### 1. Text origin: the project's OWN repository, and the session's event log

`docs`/`adr` are indexed from the GIT repository of the project being
indexed — via `ReadProjectCodeUseCase`, the SAME surface the Code tab uses
(same owner credential resolution, RN-058/082; same container gate, RN-105;
same path check, RN-095; same cache). This is not documentation of Brabo as a
product: it's the `docs/`/`docs/adr/` convention that each MANAGED project
may have in its own repository. Reindexing without duplicating the tree scan
mattered more than separating the two scopes into two use cases —
`IndexProjectDocsUseCase` covers both, distinguishing by path PREFIX
(`docs/adr/` → `adr`, the rest → `docs`).

`session` is indexed from the TWO event types that make up a conversation:
`chat.message` (the human) and `agent.response` (the agent). The rest of the
event log (`tool.call`, `agent.status`, `tool.result`, gate events) stays out
— it's mechanism, not citable knowledge. Indexing a `tool.call` would make
search return a JSON payload as if it were prose; indexing `agent.error`
would cite a failure as if it were session subject matter. Each session
chunk keeps `metadata.sourceRef` with the id of the SOURCE event — the same
id `GetSessionEventUseCase` already resolves — so the citation can navigate
back to the exact point in the conversation.

### 2. Chunking: 1200 characters, 150 overlap, by PARAGRAPH/break

`CHUNK_TARGET_CHARS = 1200` (~300 tokens in Portuguese) aims for a passage
large enough to carry a complete idea — what an embedding vector needs so it
doesn't dilute meaning across unrelated topics — and small enough to become
a citation readable in seconds, not an entire document.
`CHUNK_OVERLAP_CHARS = 150` (12.5% of the target) exists because an exact cut
in the middle of a sentence makes the following piece lose its antecedent.

Both numbers are a **starting point to adjust, not science**: there is no
body of real questions run against this index yet to calibrate optimal chunk
size against retrieval quality — this program did not produce that data, and
inventing it would be pretending a precision that doesn't exist (the same
class of error that ADR 0042 refuses for model rating).

The cut prefers the nearest PARAGRAPH break to the target (`\n\n`), then a
WORD break (space), and only cuts mid-word if neither exists within a
200-character window — Markdown broken in the middle of a table is still
better than a citation that cuts a sentence in half. Markdown documents
(`docs`/`adr`) are split by HEADING first (preserving the `headingPath`
trail, the "section" part of the "file + section" citation), and only then
cut by size WITHIN each section.

Counting TOKENS instead of characters would require the embedding model's
own tokenizer, which `nomic-embed-text` does not expose locally (unlike the
`GptTokenizerEstimator` that `chat` already uses, calibrated for CHAT
models). Characters with a preference for a clean break is an honest
approximation.

### 3. Provider failure: index lexical, declare the gap — never pretend complete

The embedding model/provider are FIXED by constant
(`RAG_EMBEDDING_MODEL = 'nomic-embed-text'`, `RAG_EMBEDDING_PROVIDER =
'ollama'`), not resolved by catalog: `chunks.embedding` is `vector(768)`,
the real and DOCUMENTED dimension of that model (RN-222), and there is no
persisted column yet saying "which model is for embedding" — ADR 0075 left
that as future work, and this wave had no migration slot to resolve it (the
only migration in this wave, `0046`, belongs to front F1, for
`project_containers`).

When `ollama` doesn't respond — daemon down, timeout, model not pulled —
`RagEmbeddingService` **does not throw for the caller to handle chunk by
chunk**: it returns `available: false` and `null` for each requested vector.
The indexing pipeline writes the chunks ANYWAY, with `embedding: null` —
`search_vector` is `GENERATED ALWAYS AS` and doesn't depend on any provider
(ADR 0079), so the lexical half remains available even with the semantic
half down. The alternative — failing the whole indexing because half a
signal was missing — would throw away the half that worked. The indexing
report (`embedding: { available, embedded, skipped, reason }`) declares the
gap; nothing in the return says "complete indexing" when it wasn't.

The same degradation applies to SEARCH: if the query can't be vectorized,
search runs lexical-only and `vectorAvailable: false` warns — it never
pretends to have run the full hybrid.

### 4. Hybrid search: two independent queries, fusion by weighted sum

Vector and lexical are **two separate queries** against `chunks`
(`ChunkRepository.searchByVector`/`searchByLexicalQuery`), not a single one
with a JOIN — each takes advantage of the index built for it (HNSW for
cosine, GIN for `ts_rank`), the same design reasoning that led ADR 0079 to
put the two columns in the SAME row (so as not to lose the fusion) but does
not force the SAME query (so as not to lose the right index). The port
returns raw candidates; the use case (`HybridSearchUseCase`) fuses, weighs,
and cuts — the same boundary that already separates `ChunkRepository`
(stores data) from whoever decides what to do with it (RN-226).

**Weights: 0.6 vector, 0.4 lexical.** Normalized `ts_rank` (bit 32,
`rank/(rank+1)`) rarely goes above ~0.3 even for a strong match, while
cosine similarity for a genuinely relevant pair is usually between 0.5 and
0.85 — the two scales are NOT naturally comparable. The higher vector weight
recognizes this without erasing the lexical side: a lexical-only chunk can
still clear the threshold on its own (`0.4 * 0.3 = 0.12`, below the
threshold — so in practice a very strong lexical match alone still isn't
enough, which is intentional: text that only matches one word in common
shouldn't become a citation with no semantic backing at all).

**Threshold: 0.2.** Below it, "we found something weak" and "we found
nothing" become indistinguishable to whoever reads the response — a weak
citation presented as if it were strong is worse than no citation.

**None of the four numbers (weights, threshold, chunk size, overlap) comes
from calibration against real search-quality data.** There is not yet a
body of real questions run against this index — Chat RAG itself (Wave 5)
doesn't exist as a screen yet. They are a starting point, documented as
such, with the reasoning for each choice written down so they can be
revisited with data later, not recalculated from scratch.

### What counts as a citation

The return contract (`HybridSearchHit`) is: `chunkId`, `content`, combined
`score`, `vectorScore`/`lexicalScore` (each `null` when that signal didn't
find the chunk — not zero, which would confuse "didn't find" with "found and
similarity is zero"), `scope`, and `origin` — a union discriminated by
`kind`: `{ kind: 'file', sourcePath, headingPath?, title? }` for `docs`/
`adr`, or `{ kind: 'session', sessionId, eventId?, title? }` for `session`.
The discrimination exists so consumers never need to check two optional
fields to know which one is `null` — `tsc` makes the check exhaustive.

## Consequences

**"Index coverage" (the panel the handoff asks for) answers with what can be
answered HONESTLY today**: `GetRagCoverageUseCase` counts real `.md` files
in the repository against how many have a chunk, and project sessions
against how many have a chunk. It does not include "reindexed 12min ago" —
there is no indexing timestamp column per scope, and a guessed number would
lie.

**Reindexing is always MANUAL** (`POST .../rag/reindex`, `role:maintainer`,
idempotent full rebuild via `deleteByScope`/`deleteBySession` followed by
recreation). There is no push watcher and no session-close watcher —
decision already recorded in ADR 0079 ("reindexing is the responsibility of
whoever writes the pipeline"), and this wave wrote the pipeline ON DEMAND,
not reactively. Source code and Pull Requests remain outside the index, for
the same reason as ADR 0079.

**Embedding metering remains out of scope** (same cut as ADR 0075): the
fixed provider is local and free (`ollama`), so there is no cost to record
today; the day a paid embedding provider is added, this gap needs to close
first.

**HTTP already in this wave, ahead of the screen (Wave 5).** `POST
.../rag/search`, `POST .../rag/reindex`, and `GET .../rag/coverage` exist
because the Chat RAG screen depends on the search-and-citation contract to
be built without guessing its shape — the handoff already assumes "hybrid
search · embeddings + BM25 · threshold X" and a coverage panel, and both
only have real data after these three routes.
