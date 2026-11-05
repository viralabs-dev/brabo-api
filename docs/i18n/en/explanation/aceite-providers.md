---
traducao_de: 17fe83498b0a1eea177367926431ffddda3ce9ff
id: aceite-providers
title: Acceptance of LLM providers with real credentials
sidebar_label: Provider acceptance
sidebar_position: 6
description: The living document that tracks which provider smokes have already run against a real key, how much they cost, and what each one proves that the mock doesn't.
keywords: [providers, LLM, smoke, acceptance, Phase 11, ADR 0043, credential]
---

# Acceptance of LLM providers with real credentials

[ADR 0043](../adr/0043-seis-providers-de-llm-e-o-fechamento-da-fase-9b.md)
delivered nine providers with the contract suite green — **against a mock**.
It registered, in "what's left for later," that acceptance with real
credentials for the six smokes remained open. This file is where that
"later" is tracked: one line per provider, updated **every time a key shows
up**. The ADR is not edited; it is the record of the decision, this is the
record of the proof.

The house's golden rule applies here in full: a capability is only declared
when proven. As long as a smoke hasn't run against a real key, what exists
about that provider is a reading of official documentation — good, verified
line by line in Phase 11, and still not execution.

## State as of 2026-09-25 — a `system` message after `user`/`tool` (AT-161)

Another axis, same rule. The contract suite now proves where each adapter puts
a `role: "system"` that arrives AFTER `user` or `tool` (end of `messages` in
eight; hoisted into the top `system` in Anthropic — see
[the divergences table](../reference/llm-providers.md#a-system-message-at-the-end-of-the-conversation-at-161)).
Whether the provider ACCEPTS that body is what
`sistema-tardio.smoke.spec.ts` asks, and only a real call answers it:

```bash
OLLAMA_SISTEMA_TARDIO_SMOKE=1 pnpm --filter api exec vitest run test/infrastructure/llm/sistema-tardio
# cloud providers: export the same *_TEST_KEY as the acceptance smokes (ANTHROPIC_TEST_KEY for Anthropic)
```

| provider | late `system` accepted by the real provider? | how |
|---|---|---|
| Ollama | ✅ **yes**, after `user` and after `tool` | local daemon 0.32.15, `qwen2.5-coder:7b`; both turns ended with text and no error chunk |
| Anthropic | ❌ not proven | `ANTHROPIC_TEST_KEY` missing — and the body it sends has no late `system` anyway (hoisted) |
| OpenAI | ❌ not proven | `OPENAI_TEST_KEY` missing |
| OpenRouter | ❌ not proven | `OPENROUTER_TEST_KEY` missing in this environment; in a hub the answer is per upstream, so one run proves the upstream that served it |
| NVIDIA NIM | ❌ not proven | `NVIDIA_NIM_TEST_KEY` missing |
| Together AI | ❌ not proven | `TOGETHER_TEST_KEY` missing |
| DeepInfra | ❌ not proven | `DEEPINFRA_TEST_KEY` missing |
| Bitdeer | ❌ not proven | `BITDEER_TEST_KEY` missing |
| Vultr | ❌ not proven | `VULTR_TEST_KEY` missing |

The smoke proves ACCEPTANCE only (the turn ends with text, no error chunk). If
the model OBEYS the guidance is a quality question, and belongs to AT-082.

## State as of 2026-08-14 — the embedding capability (ADR 0075)

NEW axis in this list. Until now "acceptance" meant the CHAT script; the
[ADR 0075](../adr/0075-embeddings-no-contrato-de-llm-provider.md) added
`embed` to the contract, and the same rule applies: **a capability is only
`true` with proof of execution**.

**Ollama closed**, and it's the only one. Run against the real local daemon
(0.32.1), with the model pulled on the spot:

```bash
docker exec brabo-dev-ollama-1 ollama pull nomic-embed-text
OLLAMA_EMBEDDING_SMOKE=1 pnpm --filter api test ollama-provider.embeddings
```

| what | result |
|---|---|
| `POST /api/embed`, 2 inputs | 2 vectors, **768** dimensions each |
| `prompt_eval_count` | **10** — `estimated: false`, came from the daemon |
| `/api/tags` of the same daemon | `nomic-embed-text` with `capabilities: ["embedding"]` and `embedding_length: 768`; `llama3.2:1b` with `["completion","tools"]` |
| CHAT model asked to embed | **`501`** — "This server does not support embeddings" |

The `501` is the finding that mattered most, and it became a test at both
levels: it's the MODEL layer of the capability failing at the latest
possible point, and the reason `assertCanEmbed` refuses earlier
([RN-190](../business-rules/api.md#rn-190)). Real cost: **US$ 0.00** — a local
model has no price, and that's why this is the only acceptance on this page
that can be repeated freely.

| provider | `embeddings` | ran? | reason |
|---|---|---|---|
| Ollama | ✅ **yes** | ✅ yes | local daemon, no key and no cost |
| Anthropic | ❌ no | — | **has no** embedding endpoint of its own; the doc points to a third party, which is another provider with another key and another dialect |
| OpenAI | ❌ no | ❌ skipped | `OPENAI_TEST_KEY` missing |
| OpenRouter | ❌ no | ❌ skipped | has a key, but the smoke that ran was **chat** — in a hub, embedding routes to a different provider, and proof of one endpoint isn't proof of the other |
| Together AI | ❌ no | ❌ skipped | `TOGETHER_TEST_KEY` missing |
| DeepInfra | ❌ no | ❌ skipped | `DEEPINFRA_TEST_KEY` missing |
| NVIDIA NIM | ❌ no | ❌ skipped | `NVIDIA_NIM_TEST_KEY` missing |
| Bitdeer | ❌ no | ❌ skipped | `BITDEER_TEST_KEY` missing — ironic, since their embeddings doc is the only authenticated source Phase 11b found |
| Vultr | ❌ no | ❌ skipped | `VULTR_TEST_KEY` missing |

What **is** proven without any credential at all is the DIALECT: the
contract suite runs a second time over the OpenAI-compatible base with the
capability turned on, and exercises ordering by `index`, reading
`usage.prompt_tokens`, refusal of an incomplete batch, and error normalized
by `code`. Flipping a provider to `true` once the key exists is changing one
line of the literal and running the smoke — not writing new parsing.

## State as of 2026-08-07

First paid run of this list. **OpenRouter closed**; the other five remain
skipped for lack of a key — there's no credential for them anywhere in the
environment, and the product only has OpenRouter's registered (the same one
used in the hello-clean run).

| provider | ran? | result |
|---|---|---|
| OpenRouter | ✅ **yes** | full script green, one paid call |
| Together AI | ❌ skipped | `TOGETHER_TEST_KEY` missing |
| DeepInfra | ❌ skipped | `DEEPINFRA_TEST_KEY` missing |
| NVIDIA NIM | ❌ skipped | `NVIDIA_NIM_TEST_KEY` missing |
| Bitdeer | ❌ skipped | `BITDEER_TEST_KEY` missing |
| Vultr | ❌ skipped | `VULTR_TEST_KEY` missing |

**Real cost, read from the test database's `token_usage`:**

| provider | model | in | out | `cost_micros` | frozen price | `estimated` |
|---|---|---|---|---|---|---|
| openrouter | `openai/gpt-4o-mini` | 20 | 3 | **5** | 150,000 /million | `false` |

Five micro-USD — **US$ 0.000005**, two orders of magnitude below the
"< US$ 0.001" estimate from the section above. `estimated: false` is what
matters here: the consumption came from the provider, not from the local
estimator, and the recorded price is the one FROZEN at the moment of use
([RN-044](../business-rules/api.md#rn-044)) — not today's price in the `models`
table.

### What the smoke found along the way

It had **never run before**, and had therefore silently rotted against
[ADR 0049](../adr/0049-curadoria-de-modelo-por-workspace.md), which moved
curation from `models.is_active` to `workspace_models`:

- it asserted `alvo.isActive === false` against the global catalog — a
  field that no longer exists, and that came back `undefined`. The correct
  assertion per [RN-043](../business-rules/api.md#rn-043) today is
  `workspaceModels.isActive(...)`, because **absence of a row IS off**;
- it assembled `SetModelsActiveUseCase` and `SetModelBindingUseCase` with the
  old signatures, missing `workspaceId`/`curatedBy` and the curation
  repository.

None of this was detectable by CI: without the key, `describe.skipIf`
skips the whole file, and the api's typecheck runs over `tsconfig.build.json`,
which excludes `test/`. **An acceptance test that never runs isn't an
acceptance test** — it's the same mechanism that left the Phase 10 table as
"not measured," and the lesson applies here too.

Fixed alongside the run: the smoke now asserts RN-043 through the ADR 0049
path. When the other five keys exist, the five remaining smokes will
probably have rotted the same way, for the same reason.

## State as of 2026-08-03

Environment scan on this date: **none** of the six variables are exported,
and there's no provider key under another name in `.env`. Without the
variable, `describe.skipIf(!apiKey)` skips the whole suite with a warning —
which is the correct behavior, not a failure. No paid call was made; this
round's cost is **US$ 0.00**.

| provider | smoke | variable | default model | ran? | reason | real cost (`token_usage`) |
|---|---|---|---|---|---|---|
| OpenRouter | `openrouter-provider.smoke.spec.ts` | `OPENROUTER_TEST_KEY` | `openai/gpt-4o-mini` | ❌ skipped | key missing in environment | — |
| Together AI | `together-provider.smoke.spec.ts` | `TOGETHER_TEST_KEY` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | ❌ skipped | key missing in environment | — |
| DeepInfra | `deepinfra-provider.smoke.spec.ts` | `DEEPINFRA_TEST_KEY` | `deepseek-ai/DeepSeek-V3` | ❌ skipped | key missing in environment | — |
| NVIDIA NIM | `nvidia-nim-provider.smoke.spec.ts` | `NVIDIA_NIM_TEST_KEY` | `meta/llama-3.2-3b-instruct` | ❌ skipped | key missing in environment | — |
| Bitdeer | `bitdeer-provider.smoke.spec.ts` | `BITDEER_TEST_KEY` | `moonshotai/Kimi-K2.5` | ❌ skipped | key missing in environment | — |
| Vultr | `vultr-provider.smoke.spec.ts` | `VULTR_TEST_KEY` | `kimi-k2-instruct` | ❌ skipped | key missing in environment | — |

The files live in `apps/api/test/infrastructure/llm/`. The default model is
overridable by `<PROVIDER>_TEST_MODEL` — useful when the account doesn't
have access to the model in the column.

## How much it costs to close each line

Deliberately cheap. Each smoke does **exactly one chat turn**, with the
prompt `Respond only with the word "ok", nothing else.` — on the order of
20 input tokens and a handful of output. Everything else in the script is
free: the credential check is a status-only `GET /v1/models` (or
`GET /key`), and the catalog sync (in the three with `listModels: true`) is
a read.

| | paid calls | free calls | order of magnitude |
|---|---|---|---|
| per smoke | 1 chat turn (~20 tokens in) | connection test + sync | **< US$ 0.001** |
| all six together | 6 chat turns | — | **< US$ 0.01** |

Even at the table's most expensive model this doesn't reach a cent of a
dollar per run. What costs isn't the token: it's having the key.

## What each smoke proves — and it's not the same for everyone

The split follows the capability, exactly as ADR 0041 designed:

**With `listModels: true` — OpenRouter, Together, DeepInfra.** The sync
hits the real API and populates the catalog. This is where the **real
price** meets the parser. The most important case is Together: ADR 0043
records that the price unit (USD per million tokens vs. per token) was
**inferred** by comparing against market price, because the official
documentation doesn't declare it — and the smoke has a sanity range for
exactly this
(`inputPricePerMillionMicros` between 10,000 and 1,000,000,000; outside it,
the diagnosis is "wrong unit," not "expensive model"). If this ever goes
wrong, it's a finding to fix in the parser and here, never to be silenced.
The smoke also confirms RN-043: the discovered model comes in
**deactivated**, and activation is manual curation.

**With `listModels: false` — NVIDIA NIM, Bitdeer, Vultr.** None of the three
publishes a per-token price in accessible documentation (NIM doesn't even
bill per token: the commercial unit is GPU/hour). The sync, therefore, **has
to skip** with `pulado: 'sem_capability'` — and the smoke asserts exactly
that, which makes the declared capability verifiable instead of trusted.
The model comes in via seed / manual curation with `manual_pricing = true`,
and what the smoke actually validates is the **model id** against the real
API — today an estimate read from the doc — and the metering path
end-to-end with the frozen price.

Across all six, step **1b** verifies the real key against the real API via
`TestStoredCredentialUseCase` — `ok` in five, and `nao_suportado` in
DeepInfra, the only one without a declared test endpoint. Before
[ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md)
this proof happened embedded in registration; it didn't disappear, it moved
and became explicit.

Across all six, the final step is the same and is what matters to the
product: a complete chat session, with no `error` or `metering_failed`
event, with one line in `token_usage` carrying the price **frozen** at the
moment of use
([RN-044](../business-rules/api.md#rn-044)) — not today's price in the `models`
table.

## How to close a pending item

```bash
export OPENROUTER_TEST_KEY=...          # the variable of the provider in question
# optional, if the account doesn't have the default model:
# export OPENROUTER_TEST_MODEL=...

pnpm --filter api test -- openrouter-provider.smoke.spec.ts
```

Requirements:

- the test database up — `TEST_DATABASE_URL`, default
  `postgres://brabo:brabo@localhost:5432/brabo_test`. Since
  `perf/banco-por-worker-nos-testes-da-api`, that value only names the BASE
  Vitest derives names from (`apps/api/test/support/test-db-name.ts`); this
  single spec still runs on one Vitest worker and connects to that worker's
  own database (`brabo_test_w1`, cloned from a migrated template), the same
  mechanism any of the api's integration tests use — the smoke calls
  `truncateAll` before starting;
- credit in the provider's account. Since
  [ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md)
  registration tests nothing — who verifies the key is smoke step 1b
  (`TestStoredCredentialUseCase`, status-only), and a valid key with no
  balance only fails at the actual chat turn.

After running, **update the table's row** above with the date, the verdict
and the real cost. The cost comes from the database, not from the estimate:

```sql
SELECT provider, model_name, input_tokens, output_tokens, cost_micros
FROM token_usage ORDER BY created_at DESC LIMIT 1;
```

If the smoke fails, the row becomes `❌ failed` with the reason, and the
finding becomes a fix in the provider — never a capability declared on
trust.

## Why this is a living document

The table isn't a report from a single date: it's the current state of
acceptance. Each key that shows up closes a line and the others remain
open, visible. The failure mode this file exists to avoid is Phase 10's,
described in the
[first dogfooding harvest](./primeiro-dogfooding.md): the observation
table that no one filled in and that became "not measured" forever. Here,
the number comes from `token_usage` per query, and what hasn't run is
written down as not having run.
