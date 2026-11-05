---
id: aceite-providers
title: O aceite dos providers de LLM com credencial real
sidebar_label: Aceite dos providers
sidebar_position: 6
description: O documento vivo que rastreia quais smokes de provider já rodaram contra chave de verdade, quanto custaram, e o que cada um prova que o mock não prova.
keywords: [providers, LLM, smoke, aceite, Fase 11, ADR 0043, credencial]
---

# O aceite dos providers de LLM com credencial real

O [ADR 0043](../adr/0043-seis-providers-de-llm-e-o-fechamento-da-fase-9b.md)
entregou nove providers com a suite de contrato verde (o décimo, o 9Router, entrou depois, ADR 0222) — **contra mock**. Ele
mesmo registrou, em "o que fica para depois", que o aceite com credencial real
dos seis smokes continuava aberto. Este arquivo é onde esse "depois" é
rastreado: uma linha por provider, atualizada **toda vez que uma chave
aparece**. O ADR não é editado; ele é o registro da decisão, este é o registro
da prova.

A regra de ouro da casa vale aqui inteira: capability só é declarada quando
provada. Enquanto um smoke não rodou contra chave real, o que existe sobre
aquele provider é leitura de documentação oficial — boa, verificada linha a
linha na Fase 11, e ainda assim não é execução.

## Estado em 2026-09-25 — mensagem `system` depois de `user`/`tool` (AT-161)

Outro eixo, a mesma régua. A suite de contrato agora prova onde cada adapter
põe um `role: "system"` que chega DEPOIS de `user` ou `tool` (no fim de
`messages` em oito; içado para o `system` do topo no Anthropic — ver
[a tabela de divergências](../reference/llm-providers.md#a-system-message-at-the-end-of-the-conversation-at-161)).
Se o provider ACEITA esse corpo é o que
`sistema-tardio.smoke.spec.ts` pergunta, e só uma chamada real responde:

```bash
OLLAMA_SISTEMA_TARDIO_SMOKE=1 pnpm --filter api exec vitest run test/infrastructure/llm/sistema-tardio
# providers de nuvem: exporte a mesma *_TEST_KEY dos smokes de aceite (ANTHROPIC_TEST_KEY para o Anthropic)
```

| provider | `system` tardio aceito pelo provider real? | como |
|---|---|---|
| Ollama | ✅ **sim**, depois de `user` e depois de `tool` | daemon local 0.32.15, `qwen2.5-coder:7b`; os dois turnos terminaram com texto e sem chunk de erro |
| Anthropic | ❌ não provado | falta `ANTHROPIC_TEST_KEY` — e o corpo que ele envia não tem `system` tardio de qualquer forma (içado) |
| OpenAI | ❌ não provado | falta `OPENAI_TEST_KEY` |
| OpenRouter | ❌ não provado | falta `OPENROUTER_TEST_KEY` neste ambiente; num hub a resposta é por upstream, então uma rodada prova o upstream que a serviu |
| NVIDIA NIM | ✅ **sim** (só `user`, via o turno do smoke) | 22/10/2026, `nvidia/nemotron-3.5-lightning-30b-a3b`; o turno terminou com texto e sem chunk de erro |
| Together AI | ❌ não provado | falta `TOGETHER_TEST_KEY` |
| DeepInfra | ❌ não provado | falta `DEEPINFRA_TEST_KEY` |
| Bitdeer | ❌ não provado | falta `BITDEER_TEST_KEY` |
| Vultr | ❌ não provado | falta `VULTR_TEST_KEY` |
| 9Router | ❌ não provado | falta `NINE_ROUTER_TEST_KEY`/`NINE_ROUTER_TEST_MODEL` (só `free`/`auto:free`) |
| OpenCode Zen | ❌ não provado | smoke rodou em 29/10/2026 com chave real: grátis recusados (429 `FreeUsageLimitError`, política do fornecedor: grátis só no cliente OpenCode). Pago não provado |

O smoke prova só o ACEITE (o turno termina com texto, sem chunk de erro). Se
o modelo OBEDECE à orientação é pergunta de qualidade, e pertence à AT-082.

## Estado em 2026-08-14 — a capability de embedding (ADR 0075)

Eixo NOVO nesta lista. Até aqui "aceite" queria dizer o roteiro de CHAT; o
[ADR 0075](../adr/0075-embeddings-no-contrato-de-llm-provider.md) acrescentou
`embed` ao contrato, e a mesma régua vale: **capability só é `true` com prova
de execução**.

**Ollama fechou**, e é o único. Rodado contra o daemon local de verdade
(0.32.1), com o modelo puxado na hora:

```bash
docker exec brabo-dev-ollama-1 ollama pull nomic-embed-text
OLLAMA_EMBEDDING_SMOKE=1 pnpm --filter api test ollama-provider.embeddings
```

| o que | resultado |
|---|---|
| `POST /api/embed`, 2 entradas | 2 vetores, **768** dimensões cada |
| `prompt_eval_count` | **10** — `estimated: false`, veio do daemon |
| `/api/tags` do mesmo daemon | `nomic-embed-text` com `capabilities: ["embedding"]` e `embedding_length: 768`; `llama3.2:1b` com `["completion","tools"]` |
| modelo de CHAT pedindo embedding | **`501`** — "This server does not support embeddings" |

O `501` é o achado que mais valeu, e virou teste nos dois níveis: é a camada de
MODELO da capability falhando no lugar mais tarde possível, e a razão de
`assertCanEmbed` recusar antes ([RN-190](../business-rules/api.md#rn-190)). Custo
real: **US$ 0,00** — modelo local não tem preço, e por isso este é o único
aceite desta página que dá para repetir à vontade.

| provider | `embeddings` | rodou? | motivo |
|---|---|---|---|
| Ollama | ✅ **sim** | ✅ sim | daemon local, sem chave e sem custo |
| Anthropic | ❌ não | — | **não tem** endpoint de embedding próprio; a doc aponta para um terceiro, que é outro provider com outra chave e outro dialeto |
| OpenAI | ❌ não | ❌ pulado | `OPENAI_TEST_KEY` ausente |
| OpenRouter | ❌ não | ❌ pulado | tem chave, mas o smoke que rodou foi de **chat** — num hub, embedding roteia para provedor diferente, e a prova de um endpoint não é a do outro |
| Together AI | ❌ não | ❌ pulado | `TOGETHER_TEST_KEY` ausente |
| DeepInfra | ❌ não | ❌ pulado | `DEEPINFRA_TEST_KEY` ausente |
| NVIDIA NIM | ❌ não | ❌ pulado | `NVIDIA_NIM_TEST_KEY` ausente |
| Bitdeer | ❌ não | ❌ pulado | `BITDEER_TEST_KEY` ausente — irônico, já que a doc de embeddings deles é a única fonte autenticada que a Fase 11b encontrou |
| Vultr | ❌ não | ❌ pulado | `VULTR_TEST_KEY` ausente |
| 9Router | ❌ não | ❌ pulado | `NINE_ROUTER_TEST_KEY` ausente; capability `embeddings` fica `false` |
| OpenCode Zen | ❌ não | ❌ recusado | smoke rodou 29/10/2026 (429); capability `embeddings` fica `false` |

O que **está** provado sem credencial nenhuma é o DIALETO: a suite de contrato
roda uma segunda vez sobre a base OpenAI-compatível com a capability ligada, e
exercita ordenação por `index`, leitura de `usage.prompt_tokens`, recusa de
lote incompleto e erro normalizado por `code`. Virar um provider para `true`
quando a chave existir é mudar uma linha do literal e rodar o smoke — não
escrever parsing.

## Estado em 2026-08-07

Primeira execução paga desta lista. **OpenRouter fechou**; os outros cinco
seguem pulados por falta de chave — não há credencial deles em lugar nenhum do
ambiente, e o produto só tem a do OpenRouter cadastrada (a mesma usada na
execução do hello-limpo).

| provider | rodou? | resultado |
|---|---|---|
| OpenRouter | ✅ **sim** | roteiro completo verde, uma chamada paga |
| Together AI | ❌ pulado | `TOGETHER_TEST_KEY` ausente |
| DeepInfra | ❌ pulado | `DEEPINFRA_TEST_KEY` ausente |
| NVIDIA NIM | ✅ passou | chat em streaming + tool calling, 22/10/2026 (embedding segue `false`, sem prova) |
| Bitdeer | ❌ pulado | `BITDEER_TEST_KEY` ausente |
| Vultr | ❌ pulado | `VULTR_TEST_KEY` ausente |
| 9Router | ❌ pulado | `NINE_ROUTER_TEST_KEY` ausente |
| OpenCode Zen | ❌ recusado | smoke rodou 29/10/2026: 429 por política do fornecedor |

**Custo real, lido do `token_usage` do banco de teste:**

| provider | modelo | in | out | `cost_micros` | preço congelado | `estimated` |
|---|---|---|---|---|---|---|
| openrouter | `openai/gpt-4o-mini` | 20 | 3 | **5** | 150.000 /milhão | `false` |

Cinco micro-USD — **US$ 0,000005**, duas ordens de grandeza abaixo da
estimativa de "< US$ 0,001" da seção acima. `estimated: false` é o que importa
aqui: o consumo veio do provider, não do estimador local, e o preço gravado é o
congelado no momento do uso ([RN-044](../business-rules/api.md#rn-044)) — não o da
tabela `models` de hoje.

### O que o smoke encontrou no caminho

Ele **nunca tinha rodado**, e por isso tinha apodrecido em silêncio contra o
[ADR 0049](../adr/0049-curadoria-de-modelo-por-workspace.md), que moveu a
curadoria de `models.is_active` para `workspace_models`:

- afirmava `alvo.isActive === false` sobre o catálogo global — campo que não
  existe mais, e que vinha `undefined`. A afirmação certa da
  [RN-043](../business-rules/api.md#rn-043) hoje é `workspaceModels.isActive(...)`,
  porque **ausência de linha é o desligado**;
- montava `SetModelsActiveUseCase` e `SetModelBindingUseCase` com as assinaturas
  antigas, sem `workspaceId`/`curatedBy` e sem o repositório de curadoria.

Nada disso era detectável por CI: sem a chave, o `describe.skipIf` pula o
arquivo inteiro, e o typecheck da api roda sobre `tsconfig.build.json`, que
exclui `test/`. **Um aceite que nunca roda não é um aceite** — é o mesmo
mecanismo que deixou a tabela da Fase 10 como "não medido", e a lição vale
igual aqui.

Corrigido junto com a execução: o smoke agora afirma a RN-043 pelo caminho do
ADR 0049. Quando as outras cinco chaves existirem, os cinco smokes restantes
provavelmente terão apodrecido do mesmo jeito, e pelo mesmo motivo.

## Estado em 2026-08-03

Varredura do ambiente nesta data: **nenhuma** das seis variáveis está
exportada, e não há chave de provider sob outro nome no `.env`. Sem a variável,
o `describe.skipIf(!apiKey)` pula a suite inteira com um aviso — que é o
comportamento correto, não uma falha. Nenhuma chamada paga foi feita; o custo
desta rodada é **US$ 0,00**.

| provider | smoke | variável | modelo default | rodado? | motivo | custo real (`token_usage`) |
|---|---|---|---|---|---|---|
| OpenRouter | `openrouter-provider.smoke.spec.ts` | `OPENROUTER_TEST_KEY` | `openai/gpt-4o-mini` | ❌ pulado | chave ausente no ambiente | — |
| Together AI | `together-provider.smoke.spec.ts` | `TOGETHER_TEST_KEY` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | ❌ pulado | chave ausente no ambiente | — |
| DeepInfra | `deepinfra-provider.smoke.spec.ts` | `DEEPINFRA_TEST_KEY` | `deepseek-ai/DeepSeek-V3` | ❌ pulado | chave ausente no ambiente | — |
| NVIDIA NIM | `nvidia-nim-provider.smoke.spec.ts` | `NVIDIA_NIM_TEST_KEY` | `nvidia/nemotron-3.5-lightning-30b-a3b` | ✅ passou (22/10/2026) | chat em streaming, custo congelado e `tool_calls` provados | 1 teste, ~5 s |
| Bitdeer | `bitdeer-provider.smoke.spec.ts` | `BITDEER_TEST_KEY` | `moonshotai/Kimi-K2.5` | ❌ pulado | chave ausente no ambiente | — |
| Vultr | `vultr-provider.smoke.spec.ts` | `VULTR_TEST_KEY` | `kimi-k2-instruct` | ❌ pulado | chave ausente no ambiente | — |
| 9Router | `nine-router-provider.smoke.spec.ts` | `NINE_ROUTER_TEST_KEY` + `NINE_ROUTER_TEST_MODEL` | sem default (só `free`/`auto:free`) | ❌ pulado | chave ausente no ambiente | — |
| OpenCode Zen | `opencode-zen-provider.smoke.spec.ts` | `OPENCODE_ZEN_TEST_KEY` | `deepseek-v4.1-flash-free`, `glm-5.3-flash-free` | ❌ recusado | rodou em 29/10/2026: 429 `FreeUsageLimitError` (grátis só no cliente OpenCode) | — |

Os arquivos vivem em `apps/api/test/infrastructure/llm/`. O modelo default é
sobrescrevível por `<PROVIDER>_TEST_MODEL` — útil quando a conta não tem acesso
ao modelo da coluna.

## Quanto custa fechar cada linha

Barato de propósito. Cada smoke faz **exatamente um turno de chat**, com o
prompt `Responda só a palavra "ok", sem mais nada.` — ordem de 20 tokens de
entrada e um punhado de saída. Tudo o mais no roteiro é gratuito: a verificação
da credencial é um `GET /v1/models` (ou `GET /key`) status-only, e o sync de
catálogo (nos três que têm `listModels: true`) é leitura.

| | chamadas pagas | chamadas gratuitas | ordem de grandeza |
|---|---|---|---|
| por smoke | 1 turno de chat (~20 tokens in) | teste de conexão + sync | **< US$ 0,001** |
| os seis juntos | 6 turnos de chat | — | **< US$ 0,01** |

Mesmo no modelo mais caro da tabela isso não chega a um centavo de dólar por
execução. O que custa não é o token: é ter a chave.

## O que cada smoke prova — e não é o mesmo para todos

A divisão segue a capability, exatamente como o ADR 0041 desenhou:

**Com `listModels: true` — OpenRouter, Together, DeepInfra, NVIDIA NIM.** O sync bate na
API de verdade e popula o catálogo. É aqui que o **preço real** encontra o
parser. O caso mais importante é a Together: o ADR 0043 registra que a unidade
do preço (USD por milhão de tokens vs. por token) foi **inferida** por
comparação com preço de mercado, porque a documentação oficial não declara — e
o smoke tem uma faixa de sanidade justamente para isso
(`inputPricePerMillionMicros` entre 10.000 e 1.000.000.000; fora dela, o
diagnóstico é "unidade errada", não "modelo caro"). Se algum dia der errado, é
achado a corrigir no parser e aqui, nunca a silenciar. O smoke também confirma
o RN-043: o modelo descoberto entra **desativado**, e a ativação é curadoria
manual. A NIM é a exceção sem preço: o `GET /v1/models` real (84 modelos em
28/10/2026, AT-575) traz só `id`, então o modelo entra com preço 0 e
`manual_pricing` — o endpoint hospedado é gratuito de prototipação.

**Com `listModels: false` — Bitdeer, Vultr.** Nenhum dos dois
publica preço por token em documentação acessível. O sync, portanto, **tem de pular** com
`pulado: 'sem_capability'` — e o smoke afirma exatamente isso, o que torna a
capability declarada verificável em vez de confiada. O modelo entra por seed /
curadoria manual com `manual_pricing = true`, e o que o smoke valida de fato é
o **id do modelo** contra a API real — hoje estimativa lida da doc — e o
caminho de metering ponta a ponta com o preço congelado.

Nos seis, o passo **1b** verifica a chave real contra a API real por
`TestStoredCredentialUseCase` — `ok` em cinco, e `nao_suportado` na DeepInfra,
que é o único sem endpoint de teste declarado. Antes do
[ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md) essa
prova acontecia embutida no cadastro; ela não sumiu, mudou de lugar e ficou
explícita.

Nos seis, o passo final é o mesmo e é o que interessa ao produto: uma sessão de
chat completa, sem evento `error` nem `metering_failed`, com uma linha em
`token_usage` carregando o preço **congelado** no momento do uso
([RN-044](../business-rules/api.md#rn-044)) — não o preço de hoje da tabela
`models`.

## Como fechar uma pendência

```bash
export OPENROUTER_TEST_KEY=...          # a variável do provider em questão
# opcional, se a conta não tiver o modelo default:
# export OPENROUTER_TEST_MODEL=...

pnpm --filter api test -- openrouter-provider.smoke.spec.ts
```

Requisitos:

- o banco de teste de pé — `TEST_DATABASE_URL`, default
  `postgres://brabo:brabo@localhost:5432/brabo_test` (o mesmo de qualquer
  teste de integração da api; o smoke chama `truncateAll` antes de começar);
- crédito na conta do provider. Desde o
  [ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md) o
  cadastro não testa nada — quem verifica a chave é o passo 1b do smoke
  (`TestStoredCredentialUseCase`, status-only), e uma chave válida sem saldo só
  falha mesmo no turno de chat.

Depois de rodar, **atualize a linha da tabela** acima com a data, o veredito e
o custo real. O custo sai do banco, não da estimativa:

```sql
SELECT provider, model_name, input_tokens, output_tokens, cost_micros
FROM token_usage ORDER BY created_at DESC LIMIT 1;
```

Se o smoke reprovar, a linha vira `❌ reprovado` com o motivo, e o achado vira
correção no provider — nunca uma capability declarada na base da confiança.

## Por que isto é um documento vivo

A tabela não é um relatório de uma data: é o estado corrente do aceite. Cada
chave que aparecer fecha uma linha e as outras seguem abertas, visíveis. O
modo de falha que este arquivo existe para evitar é o da Fase 10, descrito na
[colheita do primeiro dogfooding](./primeiro-dogfooding.md): a tabela de
observação que ninguém preencheu e virou `não medido` para sempre. Aqui, o
número vem de `token_usage` por consulta, e o que não rodou está escrito como
não rodou.
