---
id: llm-providers
title: LLM Providers
sidebar_position: 9
description: The single contract that makes Ollama, OpenAI, and Anthropic interchangeable, with capabilities per provider and per model, catalog sync, model lifecycle, normalized errors, and an inactivity ceiling.
keywords: [LLM, provider, OpenAI, Anthropic, Ollama, capabilities, tool calling, streaming, catalog, pricing]
traducao_de: c416f2b0423a85b6939818014c69cb25bb5f2fa6
---

# LLM Providers

Every agent and every chat in Brabo talks to a model behind a single
contract. The caller doesn't know whether an Ollama on disk, the OpenAI
API, or the Anthropic API is on the other side — and it shouldn't.

Decided in [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md),
with the inactivity ceiling inherited from [ADR 0020](../adr/0020-destravar-gates-qa-secops.md).

## The contract

`LLMProvider` (`apps/api/src/application/ports/llm-provider.port.ts`) has one
REQUIRED operation, and it's always streaming:

```ts
abstract class LLMProvider {
  abstract readonly name: LLMProviderName;
  abstract readonly capabilities: LLMProviderCapabilities;
  abstract chat(
    messages: ChatMessage[],
    options: ChatOptions,
  ): AsyncGenerator<ChatStreamChunk>;

  /** Only when `capabilities.listModels` (Phase 9c). */
  listModels?(apiKey?: string): Promise<ModeloDoCatalogo[]>;
  /** Only when `capabilities.embeddings` (ADR 0075). */
  embed?(
    inputs: readonly string[],
    options: EmbeddingOptions,
  ): Promise<EmbeddingResult>;
}
```

The two optional ones follow the same **two-sided** contract: whoever declares the
capability implements the method, and whoever doesn't declare it doesn't expose it. The
consumer degrades by checking the capability, never by discovering it on failure.

There's no separate method for tool calling or token counting: the
tools go in `options.tools` and everything comes back through the same stream, as one of
the four `ChatStreamChunk` types.

| chunk | when |
| --- | --- |
| `text_delta` | a piece of generated text |
| `tool_calls` | the model requested tools (single chunk, not incremental) |
| `usage` | token count, with the `estimated` flag; and, when the response says so, the real cost (`costMicros`), the model that served (`resolvedModel`), the response id (`generationId`) and the cached/reasoning PARTS of the token counts (`cachedInputTokens`, `reasoningTokens`, RN-666) — [ADR 0188](../adr/0188-o-custo-real-do-provider-vira-o-numero-do-metering.md) |
| `error` | failure classified by `code` — **never an exception** |

A failure becomes a chunk, not an exception, because the turn has already spent
tokens: metering needs to happen even when the response didn't come.

## Capabilities: two layers

**The provider's** is the ceiling of what that backend knows how to do. **The
model's** is what that row in the `models` table knows how to do. A model can be
poorer than the provider, never richer.

| capability | where it lives | used for |
| --- | --- | --- |
| `streaming` | provider + `models.supports_streaming` | — |
| `toolCalling` | provider + `models.supports_tool_calling` | reject agent binding ([RN-040](../business-rules/api.md#rn-040)) |
| `listModels` | provider only | enable/skip catalog sync ([RN-043](../business-rules/api.md#rn-043)) |
| `embeddings` | provider + `supportsEmbeddings` on the catalog row | allow/reject the embedding call ([RN-190](../business-rules/api.md#rn-190)) |
| `promptCaching` | provider + the model filter in the config hook (`anthropic/*` on OpenRouter) | mark `cache_control` on the stable prefix ([RN-892](../business-rules/api.md#rn-892)); `true` only on OpenRouter, proven by smoke on 2026-10-15 |
| `context_length` | `models.context_window` | context budget |
| `vision` | `models.supports_vision` | filter the catalog ([RN-056](../business-rules/api.md#rn-056)) |
| `reasoning` | `models.supports_reasoning` | same |
| `image output` | `models.generates_image` | same |

### The three modality facets

`supports_vision`, `supports_reasoning`, and `generates_image` are **provider
fact**: they come out of the remote catalog during sync, with the same fallback as
tool calling — remote, then local, then `false`. Today only OpenRouter
publishes them:

| facet | where it comes from in OpenRouter | in the 2026-08-04 catalog |
| --- | --- | --- |
| `supports_vision` | `architecture.input_modalities` contains `image` | 181 of 338 |
| `generates_image` | `architecture.output_modalities` contains `image` | 11 of 338 |
| `supports_reasoning` | `supported_parameters` contains `reasoning` | 213 of 338 |

Accepting image and **producing** image are distinct axes: reading a diagram and
drawing one solve different problems.

The parser **omits** the field when the provider doesn't declare the modality, and
`undefined` preserves the local value during sync — absence of a declaration isn't a
declaration of absence. That's why the screen uses the facets only as a positive filter:
`false` means "the provider didn't declare it," never "the model can't do it"
([ADR 0051](../adr/0051-facetas-de-capability-e-curadoria-por-uso.md)).

:::caution This does NOT cover "best for code"
No provider catalog publishes what a model is good for. That's curation
by whoever operates it, and it lives in `workspace_models.uses`, per workspace
([RN-057](../business-rules/api.md#rn-057)) — it's not a capability, and deriving it
from the model's name would be a guess dressed up as data.
:::

<!-- BEGIN:GENERATED:providers-capabilities -->

> ⚠️ Block generated by `pnpm docs:generate`. Do not edit by hand — the next build overwrites it.

Read from the `capabilities` literals in `apps/api/src/infrastructure/llm/` — **11 providers**.

| provider | streaming | tool calling | list_models | embeddings | routing preference | credential | model origin | summarized quirks | source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `9router` | yes | yes | yes | no | no | API key | sync | URL por instalação; Credencial obrigatória; Preço = curadoria manual; Capabilities `false`; Usage corrigido; Token Saver desligado; Raciocínio redigido no OAuth do Claude; Camuflagem das ferramentas no OAuth do Claude; Qual upstream serviu | `apps/api/src/infrastructure/llm/nine-router-provider.ts` |
| `anthropic` | yes | yes | yes | no | no | API key | sync + seed | — | `apps/api/src/infrastructure/llm/anthropic-provider.ts` |
| `bitdeer` | yes | yes | no | no | no | API key | seed | `Authorization: Bearer <chave>` CONFIRMADO; `GET /v1/models` existe e é autenticado; Três ids REAIS de modelo confirmados; Nenhuma peculiaridade de stream/erro confirmada | `apps/api/src/infrastructure/llm/bitdeer-provider.ts` |
| `deepinfra` | yes | yes | yes | no | no | API key | sync + seed | O catálogo é PÚBLICO — sem autenticação nenhuma; `stream_options.include_usage` confirmado como suportado; Erro no formato padrão | `apps/api/src/infrastructure/llm/deepinfra-provider.ts` |
| `nvidia-nim` | yes | yes | yes | no | no | API key | sync + seed | Sem cabeçalho dedicado; Tool calling é POR MODELO, não por API; `stream_options.include_usage` não confirmado | `apps/api/src/infrastructure/llm/nvidia-nim-provider.ts` |
| `ollama` | yes | yes | yes | yes | no | none (local) | sync + seed | — | `apps/api/src/infrastructure/llm/ollama-provider.ts` |
| `openai` | yes | yes | yes | no | no | API key | sync + seed | — | `apps/api/src/infrastructure/llm/openai-provider.ts` |
| `opencode-zen` | yes | no | no | no | no | API key | seed | Sem teste de conexão da credencial; Capabilities `false` | `apps/api/src/infrastructure/llm/opencode-zen-provider.ts` |
| `openrouter` | yes | yes | yes | no | yes | API key | sync | Cabeçalhos próprios; Id de modelo prefixado pelo upstream; Catálogo com preço na própria linha; Erro NO MEIO do stream; Custo real em `usage.cost`; Alias de roteamento livre (`~…`) é sincronizado mas não pode ser curado | `apps/api/src/infrastructure/llm/openrouter-provider.ts` |
| `together` | yes | yes | yes | no | no | API key | sync + seed | Unidade de preço NÃO documentada explicitamente pela Together; Ids com namespace; `stream_options.include_usage` não confirmado; 429 leva `error_type: dynamic_request_limited \| dynamic_token_limited` | `apps/api/src/infrastructure/llm/together-provider.ts` |
| `vultr` | yes | yes | no | no | no | API key | seed | Tool calling CONFIRMADO com exemplo real; Sufixo `-normalize` | `apps/api/src/infrastructure/llm/vultr-provider.ts` |

A provider without `list_models` is SKIPPED by the catalog sync, with the reason
logged in the report — never treated as "the catalog came back empty".
"Model origin": `sync` discovers on its own, `seed` only comes in via
`apps/api/src/db/seed.ts`, `sync + seed` has both (seed is just bootstrap
before the first sync). "Summarized quirks" are the bold LABELS from the
provider's prose section below — the why for each one lives there, not here.
"embeddings" is the ADR 0075 capability, and it is only `yes` with PROOF of
execution: reading the docs doesn't count, and the reason for each `no` is in
the literal's comment, in the file named in the last column.
"routing preference" is the ADR 0166 capability (a hub choosing the upstream
by `price`, `throughput` or `latency`), under the same rule: `yes` only after
a smoke against the real API returns the chosen upstream.
<!-- END:GENERATED:providers-capabilities -->

The default for `supports_tool_calling` is `false`. This is deliberate: a model
discovered by automatic sync (Phase 9c) comes in without a promise nobody
verified. Seed models declare the capability explicitly, and migration
`0026` does the same backfill on already-existing databases — targeted at
the seed's seven rows, never a blind `UPDATE` on the table.

:::caution Manually inserted model
`models` has no HTTP edit endpoint: whoever adds a model does it via
`seed.ts` or direct SQL. In both cases, **declare
`supports_tool_calling`** if you intend to bind that model to an agent — the
`false` default causes the binding to be rejected, including when the model is
pointed to by `DEMO_QA_MODEL` in the gate demo scripts.
:::

## Model catalog: discovery and lifecycle

Whoever declares `listModels` knows how to list its own catalog. The compatible base
implements the `GET /models` of the dialect it already speaks, with parsing swappable
via configuration (`parseCatalogo`) — a hub returns price and window on the same
row, and that can't turn into an `if` inside the standard parsing.

**Ollama and Anthropic now declare `true`** — the backlog that
[ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
left open. They declared `false` not for lack of an endpoint, but because the
format hadn't been verified against the official doc, and the rule is not to code
against a guessed contract. Both formats were verified before a single line of
code was written:

- **Anthropic** — `GET /v1/models` returns
  `{ data: [{ id, display_name, max_input_tokens, ... }], has_more, last_id }`,
  paginated **by cursor** (not by offset): `last_id` becomes the `after_id` of
  the next page, with `limit` from 1 to 1000. The one that walks the pages is the
  official SDK's `client.models.list`, which already auto-paginates — redoing
  the cursor loop by hand would mean rewriting vendor-maintained code. Price
  **doesn't come** in the response, so the model comes in without a price instead
  of an invented one.
- **Ollama** — `GET /api/tags` returns `{ models: [{ name, model, size, ... }] }`
  on the local host (`OLLAMA_HOST`, default `http://localhost:11434`). No price,
  as fits a local runtime.

Both THROW on error, as the contract requires: returning an empty list
would be read by reconciliation as "everything disappeared" and would make the
whole catalog unavailable ([RN-043](../business-rules/api.md#rn-043)).

### The two independent availability axes

A model has two INDEPENDENT states, and confusing them was the hole
Phase 9c closed:

| where | who writes it | what it means |
| --- | --- | --- |
| `workspace_models.is_active` | the **owner of that workspace**, via the curation screen | shows up in the selector and can receive a new binding |
| `models.availability` | **sync**, alone | `unavailable` = disappeared from the provider's catalog |

A model can be active AND unavailable at the same time — that overlap
is what generates the warning on the screen. When the provider brings it back, the owner's
choice still holds: sync never re-enables what someone turned off on purpose.

The two axes stopped living in the same table in
[ADR 0049](../adr/0049-curadoria-de-modelo-por-workspace.md). Curation is
**per workspace** — `models.is_active` used to be a column for the whole
installation, and a workspace-A owner turning on a model turned it on for B too
([RN-052](../business-rules/api.md#rn-052)). What's left in `models` is provider fact: name,
price, capabilities, and availability, the same for everyone.

**Absence of a row in `workspace_models` IS "off."** There's no separate
"never decided" state, and that's how RN-043 keeps holding without any
column that sync could run over.

### The third axis: what the workspace uses the model for

`workspace_models.uses` holds curation BY USE — `codigo`, `documentacao`,
`analise`, `imagem`, `conversa` — a closed vocabulary in
`apps/api/src/domain/llm/model-uses.ts`. It's what no catalog publishes: the
provider declares the capability, but which model performs well at code **for
this team** is only found out by using it.

It doesn't mix with `is_active`:

- marking a use **doesn't turn on** the model — the new row is born with `is_active =
  false` explicit, against the column's `true` DEFAULT;
- switching the use **doesn't turn off** what was on;
- the list **replaces** the previous one (an empty list unmarks everything).

Route: `POST /workspaces/:workspaceId/models/uses`, `owner`
([RN-057](../business-rules/api.md#rn-057)).

### The three reconciliation rules

1. **New model comes in INACTIVE** — with no curation row in any workspace.
   A catalog has hundreds of rows; dumping them all active would make choosing
   impossible and would turn on an expensive model without anyone deciding.
2. **A model that disappeared becomes `unavailable`, never deleted.** `model_bindings`
   and `token_usage` point to the row; deleting it would take the cost history
   with it.
3. **Provider failure doesn't make anything unavailable.** A 401 means "I don't
   know what's there," not "there's nothing there" — marking everything as gone
   because of a revoked key would take down every binding for that provider at
   once. The provider is SKIPPED, with the failure's origin (`infra` | `modelo`)
   in the report.

### And the two price reconciliation rules

4. **`manual_pricing` wins over the remote catalog.** A row marked this way has a
   number someone typed in from the provider's doc, and sync doesn't touch it —
   not even when the catalog brings its own price
   ([RN-051](../business-rules/api.md#rn-051)).
5. **Every price change made by sync leaves a row in `model_price_changes`**, with
   origin `sync` and `changed_by` null ([RN-044](../business-rules/api.md#rn-044)).

A NEW model discovered by sync is born `manual_pricing = false` when the
catalog reported a price — the origin is sync, and it's sync that keeps the row
up to date. Discovered WITHOUT a price, it's born `true`: the row is waiting for
someone to type one in, and marking it already protects that number from the first
catalog that happens to report a price.

### The cascade revalidates capability when dropping a level

`resolveBinding` skips the unavailable candidate and follows the precedence. When
the turn carries tools, it also skips whoever doesn't do tool calling **at every
level** — without this, an agent's fallback would land on a chat-only model and
would silently violate [RN-040](../business-rules/api.md#rn-040): the failure would
only show up later, in the ToolLoop, as "the agent stopped on its own." What was
skipped comes back in `skipped`, and the UI shows it.

The precedence is `session > agent > area > project > workspace`
([RN-020](../business-rules/api.md#rn-020)). `area` came in during PHASE 23: it's the
STANDARD that a lead and its area's subagents share, and the agent's own binding
is the divergence that overrides it — it enters the same capability revalidation
above, including the tool calling requirement
([RN-102](../business-rules/api.md#rn-102)). The `agent` and `area` scopes became
PER PROJECT (`scope_id` composite, `<projectId>:<slug|chave>`) — before,
`agent` was a global slug and the same binding held for every project
([RN-103](../business-rules/api.md#rn-103), [ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)).

A subagent with no value in any level (or only the global workspace default)
inherits the RESOLVED binding of its area lead, and the response carries
`herdadoDoLead` naming the lead; `appsec` inherits from `secops` and
`qa-estrategia` from `qa` ([RN-703](../business-rules/api.md#rn-703)).

### Who schedules and who executes

The engine schedules (an auto-rescheduled Oban worker, `MODEL_SYNC_INTERVAL_SECONDS`,
6h by default) and the api executes, because it holds the credentials and the
provider registry. The "Update catalog" button on the curation screen calls the
**same** use case — there aren't two reconciliations that could diverge.

## Price: applies going forward, never retroactively

`token_usage` stores the price that produced each `cost_micros`
(`input_price_per_million_micros` and `output_price_per_million_micros`). Historical
cost was already immutable before Phase 9c; what was missing was being
**reproducible** — without the recorded price, `tokens × price = cost` would stop
adding up the moment someone corrected the table.

Since [ADR 0188](../adr/0188-o-custo-real-do-provider-vira-o-numero-do-metering.md)
([RN-665](../business-rules/api.md#rn-665)) the catalog price is the number
only when the response doesn't carry the real cost. When it does (OpenRouter's
`usage.cost`), that is `cost_micros`, both price columns hold the IMPLICIT price
(`cost ÷ tokens`, flagged by `price_implicit`), and what the catalog would have
charged goes alongside in `catalog_cost_micros` — so `tokens × price = cost`
still holds on every row, real or estimated.

Every price change writes a row in `model_price_changes`, append-only,
with the before/after pair and the origin (`manual` | `sync`). The pair is written
together on purpose: reconstructing the "before" from the previous row would
depend on no write having escaped the audited path, which is exactly what the
audit exists to prove.

:::caution Two writes were escaping
The `sync` origin existed in the domain since Phase 9c and **no write
produced it**: sync swapped the price via `upsert`, outside the audited path.
`seed.ts` did the same — and it runs against an already-seeded database
(`BRABO_FORCE_SEED=1` in the k8s `bootstrap.sh`), so fixing a price in the seed
swapped the number in silence. Both started auditing; the seed reuses the
`UpdateModelPricingUseCase` instead of repeating the logic, and calls it
**before** the upsert — after it, the two values would already be equal and the
audit would treat it as a no-op.
:::

:::note Not an outbox event
`model_price_changes` is its own table, not a row in `outbox_events`. The
`Engine.Outbox.Drain.run_once/0` filters on `aggregate_type == "session"` — a
price row there would sit with `processed_at` null forever and would pollute
the outbox lag metric. It's an immutable domain log, like `session_events`.
:::

## Embeddings

The contract's second operation (ADR 0075), and the only one besides `chat` that spends
tokens. Only exists where `capabilities.embeddings` is `true`.

```ts
const { vectors, dimensions, model, inputTokens, estimated } =
  await provider.embed(['primeiro trecho', 'segundo trecho'], {
    model: 'nomic-embed-text',
  });
```

**It's batched, and order is contract.** An index receives N snippets at once, and
the position is the only link between input and vector. Hence the guarantee that
matters most: **one vector per input, or an error** — never a shorter list. A
partially rejected response is undetectable later; the defect would only surface
in search, far from the cause. For the same reason the contract rejects an empty
vector, mismatched dimensions within the same response, and an empty input list.

**The error throws, it doesn't become a chunk.** In `chat` the error becomes a
chunk because the turn has already spent tokens and metering needs to happen; here
there's nothing to preserve — either the provider returned the vectors and
charged, or it didn't return them and didn't charge. The `code` taxonomy is
exactly the same as the table below.

| dialect | endpoint | response body |
| --- | --- | --- |
| OpenAI-compatible base | `POST /embeddings` | `{ data: [{ index, embedding }], model, usage.prompt_tokens }` |
| Ollama | `POST /api/embed` | `{ model, embeddings: number[][], prompt_eval_count }` |

OpenAI's `index` is the link to the input, and the doc **doesn't promise order** —
that's why the base sorts by it before returning. The `dimensions` field of
`EmbeddingOptions` (reduce the vector) only exists for OpenAI; Ollama ignores it,
instead of failing, because there the dimension belongs to the model — and the
result always declares the REAL dimension of what came back.

### Who embeds today

| provider | `embeddings` | why |
| --- | --- | --- |
| `ollama` | **yes** | proven by execution against daemon 0.32.1 (`nomic-embed-text`, 2 inputs → 2 vectors of 768) |
| `anthropic` | no | it **doesn't have** an embedding endpoint — the doc points to a third party, which is another provider |
| the other seven | no | no smoke test with a credential has proven their endpoint ([acceptance](../explanation/aceite-providers.md)) |

Declaring by reading the doc is what ADR 0043 forbids, and it cost two live
reversals. The base's DIALECT, though, is proven: the contract suite runs a
second time over it with the capability turned on — that's what makes it cheap to
flip a provider to `true` once the key exists.

Ollama is also the only one that publishes the MODEL layer: `/api/tags` brings
`capabilities: ["embedding"]` and `details.embedding_length` per row, and that's
where `supportsEmbeddings` and `embeddingDimensions` in the catalog come from. A
chat model asked for embedding gets a **`501`** from the daemon — the reason the
check happens beforehand ([RN-190](../business-rules/api.md#rn-190)).

:::note The spend still isn't measured
`embed` returns `inputTokens`/`estimated` to feed the metering, and
`calculateCostMicros(input, 0, …)` already works (embedding has no output in
tokens). What's missing is structural: `token_usage.session_id` is **NOT NULL**,
and indexing a repository doesn't happen inside a session. Cut declared in
ADR 0075 — it belongs to the wave that implements the consumer.
:::

## Normalized errors

No one decides anything by substring-matching the vendor's message: the decision
is made by the chunk's `code`. The classes live in
`apps/api/src/domain/llm/llm-provider-errors.ts`.

| provider status | `code` | means |
| --- | --- | --- |
| 401, 403 | `auth` | key missing, invalid, or without access to the model |
| 402 | `insufficient_credit` | the provider account has no credit left (RN-730) |
| 404 | `model_not_found` | the model doesn't exist on that provider |
| 429 | `rate_limit` | quota or throughput exceeded |
| 413, or 400 with a context marker | `context_length` | the prompt doesn't fit the window |
| — | `timeout` | the provider went **silent** past the inactivity ceiling |
| — | `connection` | never even reached the provider |
| anything else | `upstream` | it failed on the other side for some other reason |

A 400 only becomes `context_length` when the body carries a known marker
(`context_length_exceeded` and variants). Matching by marker is fragile, so
413 — which is unambiguous — comes first, and a 400 without a marker falls into
`upstream` instead of lying about the cause.

## Inactivity ceiling {#inactivity-ceiling}

The ceiling isn't about total duration, it's about **silence**. A legitimate turn
can take a long time (a model processes thousands of prompt tokens before the
first token), but it never goes quiet. That's the lesson from ADR 0020, where
`fetch` gave up at undici's fixed 300s with an opaque "fetch failed" and the agent
recorded "the model stopped" for a request that was never answered.

| provider | mechanism | env |
| --- | --- | --- |
| Ollama | `node:http` socket timeout | `OLLAMA_REQUEST_TIMEOUT_MS` |
| OpenAI-compatible base | same | `LLM_REQUEST_TIMEOUT_MS` |
| Anthropic | `withIdleTimeout` over the SDK stream | `LLM_REQUEST_TIMEOUT_MS` |

Ollama has its own env because a local model has a different order of magnitude of
latency until the first token.

## The OpenAI-compatible base

`OpenAICompatibleProvider` implements the `/chat/completions` dialect exactly once.
Nine providers are born from it: OpenAI (the first instance), OpenRouter (Phase
11a, the hub), and the five from Phase 11b — NVIDIA NIM, Together, DeepInfra,
Bitdeer, Vultr. All of them change `baseUrl`, the auth header, and flags — never
the parsing (the only exception proven necessary was each one's own
`parseCatalogo`, when the capability is `true` — see the per-provider sections
below).

```ts
interface OpenAICompatibleFlags {
  streamOptionsIncludeUsage: boolean;
  maxTokensField: 'max_tokens' | 'max_completion_tokens';
}
```

The output cap field is sent on EVERY call (RN-734): `options.maxTokens`
when the caller sets it, otherwise `MAX_TOKENS_PADRAO` (4096, the same
default as the Anthropic provider). Without the field, OpenRouter reserves
credit for the model's MAXIMUM output per in-flight call and answers 402
even when the real call would fit the balance. A reply cut by this cap is
not narrated yet: this dialect does not read `finish_reason: "length"`.

When the model reasons (`models.supports_reasoning`) and the provider config
has `campoDeRaciocinioDesligado` (only OpenRouter today), the output cap becomes
visible output + `ORCAMENTO_DE_RACIOCINIO` (4096), because reasoning counts
inside `max_tokens` (RN-741). No reasoning field is sent just because the model
accepts the parameter (RN-782): the paid measurement of 2026-10-10 (AT-467)
showed `reasoning: { max_tokens }` turning reasoning ON for
`anthropic/claude-haiku-4.5` (74% of calls, 2.8x the cost) and being IGNORED by
`anthropic/claude-haiku-5.5` (1024 asked, 8192 spent). Execution dev agents
(`dev-<module>`, not `dev-lead`) get `reasoning: { enabled: false }` (RN-783,
owner's decision): 0 of 8 replies cut, -42% cost on Haiku 5.5. The model
catalog's "thinking" facet help says so. The direct Anthropic provider sends no
`thinking`, so the model does not reason there.

Each flag exists because a real provider diverges. Don't add a flag without a
provider that needs it.

## Normalized divergences {#normalized-divergences}

The three providers pass the same contract, but the dialects aren't identical.
What diverges is normalized, not hidden:

| topic | Ollama | Compatible base | Anthropic |
| --- | --- | --- | --- |
| format | NDJSON | SSE `data:` | SSE with named events |
| transport | `node:http` | `node:http` | official SDK + `withIdleTimeout` |
| tool call ids | doesn't send — we generate | sends; we generate if missing | sends |
| tool call arguments | already deserialized | sliced string, reassembled by index | `input_json_delta`, reassembled by the SDK |
| response without `usage` | doesn't emit a chunk | counts locally with `estimated: true` | **impossible** — `usage` is mandatory in `message_start` |
| `tool` role | its own message | `role: "tool"` + `tool_call_id` | `tool_result` block inside a `user` turn |
| response cut at the output cap | not read | `finish_reason: "length"` → `truncated` chunk | `stop_reason: "max_tokens"` → `truncated` chunk |
| `system` AFTER `user`/`tool` | kept in place, last item of `messages` | kept in place, last item of `messages` | **hoisted**: appended to the top-level `system` parameter (`\n\n`-joined after the prompt already there) and removed from `messages` |

The Anthropic row is the costliest: results from parallel calls need to arrive in
the **same** `user` turn, so consecutive `tool` messages are grouped.

### A `system` message at the end of the conversation (AT-161) {#a-system-message-at-the-end-of-the-conversation-at-161}

The late-`system` row exists because the language guidance of AT-081 plans to
send **one** ephemeral `role: "system"` message at the END of the list, on
every call of a turn — after `user` on the first call, after `tool` on the
following ones. The contract suite answers, for each of the nine providers,
where that message lands in the **serialized body**: each harness declares
`posicaoDoSistemaTardio` and the contract checks it in both positions, plus
that the text appears exactly once and the rest of the conversation keeps its
order (`apps/api/test/contract/llm-provider.contract.ts`).

| provider | adapter | where the late `system` lands |
| --- | --- | --- |
| OpenAI, OpenRouter, NVIDIA NIM, Together, DeepInfra, Bitdeer, Vultr | compatible base (`toWireMessage`) | end of `messages`, `role: "system"` |
| Ollama | own (`messages` sent as-is) | end of `messages`, `role: "system"` |
| Anthropic | own (official SDK) | end of the top-level `system`; position lost |

No adapter drops or duplicates it. What the fake server cannot say is whether
the REAL provider accepts that body — it accepts anything. That is a separate,
manual smoke, `apps/api/test/infrastructure/llm/sistema-tardio.smoke.spec.ts`,
one `describe` per provider, each gated on the same key the acceptance smokes
use (plus `ANTHROPIC_TEST_KEY`; Ollama by `OLLAMA_SISTEMA_TARDIO_SMOKE=1`).
Which ones have run is tracked in
[provider acceptance](../explanation/aceite-providers.md). Without that run, a
provider is **not proven** to accept a late `system` — the ADR 0041/0042 rule.

**Observation, not measured (AT-081 gap 2):** on Anthropic the hoist means the
guidance changes the top `system` block, which comes BEFORE the conversation —
so every change in its text changes the request prefix, and with it whatever
prompt caching the prefix would get. Cache is not observable in the product
today (AT-082), so this is recorded, not quantified.

## OpenRouter — the first hub (Phase 11a)

`OpenRouterProvider` is `OpenAICompatibleProvider` with `openrouterConfig()`
(`apps/api/src/infrastructure/llm/openrouter-provider.ts`). It declares
`listModels: true` — the only piece of code that changes when a capability turns
on is the config; `SyncModelCatalogUseCase` already handles the rest.

Quirks found and tested
(`test/infrastructure/llm/openrouter-provider.contract.spec.ts`):

- **Own headers**: `HTTP-Referer` (from `API_PUBLIC_URL`) and `X-Title:
  "Brabo"` — optional per the official doc (attribution/ranking on the
  OpenRouter site), always sent because they cost nothing;
- **Model id prefixed by the upstream** (`openai/gpt-4o-mini`,
  `anthropic/claude-3-5-sonnet`): the prefix is the REQUESTED vendor, not the one
  that responded — see `extrairUpstreamProvider` below;
- **Catalog with pricing on its own row**: `GET /v1/models` returns
  `pricing.prompt`/`pricing.completion` as a decimal STRING in USD **per
  token**, unlike OpenAI's plain id-only `{ data: [{ id }] }` pattern.
  `parseCatalogoOpenRouter` converts to micro-USD per million
  (`* 1e12`, rounded — the column is `bigint`);
- **Error IN THE MIDDLE of the stream**: OpenRouter accepts the connection and
  starts sending text before it knows whether the real backing provider is going
  to fail — a failure mode OpenAI doesn't have, because it doesn't route to
  third-party infrastructure. The frame comes as
  `{"error":{"code":"...","message":"..."},"choices":[...]}`; a truthy `error`
  field is the signal. A numeric code uses the base's same `normalizeHttpStatus`;
  a string code is mapped by substring
  (`mapearCodigoDeFrame`) with `upstream` as a safe default — never silence, even
  for a code outside the map;
- **Real cost in `usage.cost`** (ADR 0188, RN-665): the last stream frame
  carries what the hub charged, in USD; `extrairCustoRealOpenRouter` turns it
  into micro-USD and the metering records it as the number. With
  `is_byok: true` the field is the hub's fee, not the inference, so it is NOT
  read and the row falls back to the catalog. `model` (the dated version an
  alias like `~deepseek/deepseek-flash-latest` resolved to) and `id` (`gen-…`)
  are read by the base for every provider of the dialect;
- **Free-routing alias (`~…`) is synced but cannot be curated** (AT-271,
  [RN-679](../business-rules/api.md#rn-679)): an id like
  `~deepseek/deepseek-flash-latest` always redirects to the latest model of the
  family, its catalog price is a showcase price, and the bill comes from
  whichever upstream served the call. Sync keeps it in the catalog (dropping
  it would mark an already-curated one `unavailable`); activating it is 422
  `alias_de_roteamento_livre`, and the curation read marks it with
  `freeRoutingAlias`. One activated before the rule stays active and can be
  turned off — once off, it does not come back;
- **Connection test**: `GET /key` (official doc) validates the key without
  spending tokens on an actual chat call. It's the first `LLMCredentialConnectionTester`
  on the LLM side. Since [ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md)
  it **doesn't run at registration**: the credential is encrypted and stored
  without judgment, and verification is the explicit action
  `POST /users/me/credentials/{provider}/test`, on the already-stored key.
  A provider with no declared test (today: `ollama`/`anthropic`/`openai`) returns
  `nao_suportado` — never a fake `ok` ([RN-055](../business-rules/api.md#rn-055)).

The real-credential acceptance test that Phase 11a requires — registration, sync
populating the catalog, curated activation, and an end-to-end chat session with
cost frozen in `token_usage` — is
`test/infrastructure/llm/openrouter-provider.smoke.spec.ts`. It never runs in
CI: without `OPENROUTER_TEST_KEY` in the environment, the whole `describe` is
skipped with a warning. Same mold as the git-against-real-API smoke tests
(`github-provider.smoke.spec.ts`, `gitlab-provider.smoke.spec.ts`).

## NVIDIA NIM (Phase 11b)

`NvidiaNimProvider` is `OpenAICompatibleProvider` with `nvidiaNimConfig()`
(`apps/api/src/infrastructure/llm/nvidia-nim-provider.ts`), pointed at the
**hosted** endpoint (`integrate.api.nvidia.com`) — not the self-hosted
container product, which is a different product with a different address.

- **`listModels: false`**: `GET /v1/models` exists (official doc verified in
  this session) and returns `id`/`object`/`created`/`owned_by`, but no doc found
  brings a per-token price — a real catalog, but unusable for the per-model cost
  that metering requires (capabilities in two layers, ADR 0041). The provider
  lives off a **manual seed**
  (`apps/api/src/db/seed.ts`) until someone confirms a pricing endpoint, if one
  exists;
- **No dedicated header**: `Authorization: Bearer nvapi-...` — standard bearer,
  the key only has the `nvapi-` prefix by NVIDIA convention;
- **Tool calling is PER MODEL, not per API**: only specific models (Llama
  3.1 70B/405B, Nemotron variants, ...) actually support it — but this is never a
  config flag, it's entirely `models.supports_tool_calling`
  (seed/curation), confirmed by reading `buildBody()` in the base: the
  `capabilities.toolCalling` flag only decides whether the `tools` parameter is
  sent, not whether the specific model knows how to use it;
- **`stream_options.include_usage` not confirmed** for the hosted endpoint (only
  documented for the self-hosted NIM software) —
  `streamOptionsIncludeUsage: false`; the base's `estimated` fallback covers the
  case where the field never comes;
- **Connection test**: no dedicated validation endpoint (no
  "whoami"/balance endpoint found) — `GET /v1/models` with the key, only the
  status matters (200 vs 401/403).

:::info NVIDIA doesn't charge by token
The search for an official price was redone and landed on an answer better than
"I couldn't find it": **there's no per-token price to find**. The official doc
([docs.api.nvidia.com/nim/docs/product](https://docs.api.nvidia.com/nim/docs/product))
says the hosted endpoint is free **prototyping** access for a Developer Program
member, and that production requires an NVIDIA AI Enterprise license —
"These licenses start at $4500 per GPU per year or ~ $1 per GPU per hour in the
cloud." The unit is GPU/hour, not token.

The three NIM models in the seed therefore stay with an **estimated** price by
comparison with equivalents on other providers, and `manual_pricing = true`:
that's enough for the budget ceiling to have something to deduct, and it's the
maximum honesty possible while the vendor's business model isn't per token.
:::

The real-credential acceptance test lives in
`test/infrastructure/llm/nvidia-nim-provider.smoke.spec.ts`, gated by
`NVIDIA_NIM_TEST_KEY`. Unlike OpenRouter, the "sync" step discovers nothing (the
capability is `false` on purpose) — the smoke confirms the provider is
`pulado: 'sem_capability'` in the report and curates a manually inserted model,
exactly as an owner would in production.

## Together AI (Phase 11b)

`TogetherProvider` is `OpenAICompatibleProvider` with `togetherConfig()`
(`apps/api/src/infrastructure/llm/together-provider.ts`).

- **`listModels: true`**: `GET /v1/models` documented with `pricing:
  {input, output, cached_input, base, hourly, finetune}` — only `input`/
  `output` are used;
- **Price unit NOT explicitly documented by Together**: the values are NUMBERS
  (not strings like OpenRouter) and, by comparison with published market price
  (Llama 3.3 70B at US$1.04/1M on together.ai/models — the same order of
  magnitude as the official schema's `"input": 0.3` example), the inference is
  **USD per MILLION tokens directly**, not per token. The smoke test is what
  confirms this against a real key (see the comment at the top of
  `together-provider.smoke.spec.ts`) — if it's ever proven wrong, it's a finding
  to fix here and in the parser, not to silence;
- **Namespaced ids**: `meta-llama/Llama-3.3-70B-Instruct-Turbo` — a
  "flattened" OpenAI-style id (`gpt-4o`) responds 404;
- **`stream_options.include_usage` not confirmed** in the doc — same cautious
  treatment as NIM, the `estimated` fallback covers it;
- **429 carries `error_type: dynamic_request_limited | dynamic_token_limited`**
  in the body — not tested separately because the body is still
  `{error: {message}}`, compatible with the base's standard parsing; only
  relevant if we ever need to distinguish the two rate-limit types;
- **Connection test**: no dedicated endpoint — `GET /v1/models` status-only.

The real-credential acceptance test lives in
`test/infrastructure/llm/together-provider.smoke.spec.ts`, gated by
`TOGETHER_TEST_KEY`.

## DeepInfra (Phase 11b)

`DeepInfraProvider` is `OpenAICompatibleProvider` with `deepinfraConfig()`
(`apps/api/src/infrastructure/llm/deepinfra-provider.ts`), `baseUrl`
`https://api.deepinfra.com/v1/openai` (the OpenAI-compatible surface —
DeepInfra also has native endpoints outside of it, not used here).

- **`listModels: true`**, confirmed LIVE in this session against
  `GET {baseUrl}/models` (the SAME endpoint the base already calls by default,
  no extension needed): the response brings `metadata.pricing.
  {input_tokens,output_tokens}` (USD per million, number — same convention
  inferred for Together) and `metadata.context_length` per row;
- **The catalog is PUBLIC — no authentication at all**, confirmed live (the
  call worked with no `Authorization` header). This has a real
  consequence: **there's no connection test for DeepInfra**
  (`llm-credential-connection-tester.ts` has no entry for it) — an invalid key
  would only be discovered on the first real CHAT call, never at registration.
  No other publicly documented authenticated validation endpoint was found;
- **The catalog mixes chat with image/audio/video/embedding in the SAME
  list**, each type with a different `pricing` shape
  (`per_image_unit`, `input_characters`, `output_seconds`, ...) —
  `parseCatalogoDeepInfra` filters by `metadata.tags.includes('chat')` before
  trying to read `input_tokens`/`output_tokens`; without the filter, an image
  model would come in with a fabricated price from a field that isn't "per
  token" at all;
- **`stream_options.include_usage` confirmed supported** in the doc (unlike
  NIM/Together) — `streamOptionsIncludeUsage: true`;
- **Error in standard shape** `{"error": {"message", "type", "param", "code"}}`
  — compatible with the base's standard parsing, no dedicated `parseErrorFrame`.

The real-credential acceptance test lives in
`test/infrastructure/llm/deepinfra-provider.smoke.spec.ts`, gated by
`DEEPINFRA_TEST_KEY` — and it's the first smoke where the REGISTRATION step
doesn't validate anything, only the CHAT step would discover a bad key.

## Bitdeer (Phase 11b)

`BitdeerProvider` is `OpenAICompatibleProvider` with `bitdeerConfig()`
(`apps/api/src/infrastructure/llm/bitdeer-provider.ts`) — the shallowest public
doc of the five in this phase.

- **`listModels: false`**: no catalog/price shape was found publicly (the
  pricing page renders via JS, with no example reachable by a non-interactive
  search) — with no verified shape, there's no honest `parseCatalogo` to write.
  Re-verified: `bitdeer.ai/en/pricing/ai-models` still assembles the table
  client-side (the served HTML carries **no** model name) and there's no
  pricing doc outside of it. The seed's price stays ESTIMATED;
- **`Authorization: Bearer <chave>` CONFIRMED** (real curl example found in
  Bitdeer's embeddings API doc during this session) — even when the rest of
  the dialect had no example at all;
- **`GET /v1/models` exists and is authenticated** (401 live with no key,
  confirmed this session) — becomes the connection test (status-only, same as
  the others with no dedicated endpoint);
- **Three REAL model ids confirmed** in configuration examples from Bitdeer's
  own blog (not showcase names): `moonshotai/Kimi-K2.5`,
  `zai-org/GLM-5`, `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B` — seeded in
  `apps/api/src/db/seed.ts` with ESTIMATED price (market for the model/family on
  other providers, not confirmed by Bitdeer itself);
- **No stream/error quirk confirmed** — Bitdeer's "OpenAI REST API standards"
  claim wasn't accompanied by a real `/chat/completions` example, so the
  contract test doesn't hydrate any particularity the doc didn't prove. The
  smoke test is the FIRST real confirmation of the dialect.

The real-credential acceptance test lives in
`test/infrastructure/llm/bitdeer-provider.smoke.spec.ts`, gated by
`BITDEER_TEST_KEY`.

## Vultr Serverless Inference (Phase 11b)

`VultrProvider` is `OpenAICompatibleProvider` with `vultrConfig()`
(`apps/api/src/infrastructure/llm/vultr-provider.ts`) — the only one of the five
where the `listModels` decision **changed during implementation** relative to
the original plan.

- **`listModels: false`** (the original plan pointed to `true`): the base
  ALWAYS calls `{baseUrl}/models` (`openai-compatible-provider.ts`,
  `listModels()`), and Vultr's own official reference
  (`api.vultrinference.com`) describes `GET /models` as returning only
  `id`/`created`/`object`/`owned_by`/`features` — **no price**. The endpoint the
  doc associates with price (`GET /provider`, with `cost`/
  `contextWindow`) returned **404 live** on the path tested this session — not
  enough data to write a `parseCatalogo` without risking pointing to the wrong
  URL ("fragile true"). `GET /v1/models` itself is confirmed (401 live with no
  key, twice) — it just has no price;
- **Tool calling CONFIRMED with a real example**: official doc
  (`docs.vultr.com/how-to-use-tool-calling-with-vultr-serverless-inference`)
  shows `kimi-k2-instruct` responding with `finish_reason: "tool_calls"` — plain
  standard OpenAI dialect, no odd field in that specific example; the other two
  seeded models (`llama-3.3-70b-instruct-fp8`,
  `deepseek-r1-distill-llama-70b`) have no tool calling confirmation —
  `supportsToolCalling: false` for them;
- **`-normalize` suffix**: initial research pointed to a documented
  normalizing proxy — it was NOT possible to reconfirm that doc this session (a
  targeted search didn't find the term on the pages checked). Not used by
  default anyway (we keep the raw model id);
- **Connection test**: `GET /v1/models`, status-only.

:::tip Vultr's price is OFFICIAL, and it's a flat rate
Unlike NIM and Bitdeer, Vultr **publishes** the rate —
[in the Serverless Inference usage-and-cost doc](https://docs.vultr.com/support/products/serverless/how-do-i-monitor-the-usage-and-cost-of-my-vultr-serverless-inference-subscription):
"Requests are billed at $0.55 per 1,000,000 input tokens and $2.75 per
1,000,000 output tokens." It's a **service** rate, not a per-model one — the
doc doesn't differentiate by model, and that's why the seed's three rows repeat
the same pair (`550_000` / `2_750_000` micros).

The estimate that was there before erred in the dangerous direction:
`400_000` for **output** on two of the three models, against the real
`2_750_000`. Metering was underestimating output cost by almost 7× — and
output is what dominates the bill for an agent that writes code.

`manual_pricing` stays `true`, and that's not a contradiction: the flag means
"price typed by a person reading the doc, instead of coming from sync"
(`apps/api/src/db/schema.ts`). What changed is that the number is now the
provider's own, not a market comparison.
:::

The real-credential acceptance test lives in
`test/infrastructure/llm/vultr-provider.smoke.spec.ts`, gated by
`VULTR_TEST_KEY`.

## Hubs and real cost

In a **hub** (OpenRouter), the one that shows up in the call is the hub, but the
one that costs is the provider that actually served it. Metering records both:

- `ChatUsageChunk.upstreamProvider` — the provider fills it in when the hub
  reports it;
- `token_usage.upstream_provider` — free text and **nullable**. Not an enum: the
  set belongs to the hub, changes without notice, and isn't ours to version.
  `null` means "didn't come from a hub, or the hub didn't report it";
- the `brabo_llm_tokens_total` and `brabo_llm_cost_micros_total` metrics gained
  the `upstream_provider` label, and the executive dashboard has a
  cost-per-underlying-provider panel. Without a hub, the label repeats the
  provider itself — with an empty label, `sum by (upstream_provider)` would show
  only what went through a hub and would make it look like the rest cost
  nothing.

Reading the field off the frame is a **configuration hook** in the base
(`extrairUpstreamProvider`), not an `if` inside the parsing: each hub puts the
information in a different place, and the phase's rule is that provider
particularity becomes configuration.

`models.manual_pricing` marks a price typed from the provider's doc instead of
synced. Catalog sync **doesn't overwrite** the price of a marked row without an
explicit decision — and when the remote catalog doesn't report a price, the
stored value is preserved instead of zeroed out: an absent field means "the
provider didn't say," never "it's free."

### Example: the same model, hub × direct

Phase 11a's promise ("comparable cost between 'same model via hub' and 'direct'
is queryable") only becomes real use when the SAME model shows up on both
sides — today that's the case for any model OpenAI/Anthropic publish that's also
in OpenRouter's catalog (e.g., GPT-4o):

```promql
# Cost ratio: served via OpenRouter vs. served directly by OpenAI,
# in the same period. > 1 means the hub came out more expensive than direct.
sum(rate(brabo_llm_cost_micros_total{provider="openrouter", upstream_provider="openai"}[1h]))
  /
sum(rate(brabo_llm_cost_micros_total{provider="openai"}[1h]))
```

This is the hook that `upstream_provider` enables — today with no automatic
consumer. The intended reading (recorded as a seed, not implemented) is for the
Psychologist to one day suggest "this model comes out cheaper direct than via
hub" from that same metric.

## The contract suite

`apps/api/test/contract/llm-provider.contract.ts` runs the same battery against
any implementation, as the git suite has done since Phase 2. The split is the
point: **the contract owns the assertions, the harness owns the dialect.**

A new provider only has to write the harness — translating each scenario into its
own wire format — and inherits the tests for a split-frame stream, usage present
and absent, tool calling, the four errors, and the silent server. The fake
server is a real `node:http` on an ephemeral port, not a `fetch` mock: what's
under test is precisely socket behavior.

## Tool calling and the engine's rescue

The engine's `ToolCallRecovery` (ADR 0020) recovers calls a small model wrote in
prose instead of using the `tools` field. It's a **rescue, not a license**: it
depends on the model getting the format right by chance and fails silently when
it doesn't. That's why binding a model without native tool calling to an agent is
rejected in the domain, and not merely discouraged.
