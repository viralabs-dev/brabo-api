---
id: llm-providers
title: Providers de LLM
sidebar_label: Providers de LLM
sidebar_position: 9
description: O contrato único que torna Ollama, OpenAI e Anthropic intercambiáveis, com capabilities por provider e por modelo, sincronização do catálogo, ciclo de vida do modelo, erros normalizados e teto de inatividade.
keywords: [LLM, provider, OpenAI, Anthropic, Ollama, capabilities, tool calling, streaming, catálogo, preço]
---

# Providers de LLM

Todo agente e todo chat do Brabo fala com um modelo atrás de um contrato
único. Quem chama não sabe se do outro lado está um Ollama em disco, a API da
OpenAI ou a API da Anthropic — e não deveria saber.

Decidido no [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md),
com o teto de inatividade herdado do [ADR 0020](../adr/0020-destravar-gates-qa-secops.md).

## O contrato

`LLMProvider` (`apps/api/src/application/ports/llm-provider.port.ts`) tem uma
operação OBRIGATÓRIA, e ela é sempre streaming:

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

As duas opcionais seguem o mesmo contrato de **dois lados**: quem declara a
capability implementa o método, e quem não a declara não o expõe. O consumidor
degrada checando a capability, nunca descobrindo-a na falha.

Não há método separado para tool calling nem para contagem de tokens: as
ferramentas vão em `options.tools` e tudo volta pelo mesmo stream, como um dos
quatro tipos de `ChatStreamChunk`.

| chunk | quando |
| --- | --- |
| `text_delta` | um pedaço de texto gerado |
| `tool_calls` | o modelo pediu ferramentas (chunk único, não incremental) |
| `usage` | contagem de tokens, com a marca `estimated`; e, quando a resposta diz, o custo real (`costMicros`), o modelo que serviu (`resolvedModel`), o id da resposta (`generationId`) e as PARTES em cache/raciocínio das contagens de tokens (`cachedInputTokens`, `reasoningTokens`, RN-666) — [ADR 0188](../adr/0188-o-custo-real-do-provider-vira-o-numero-do-metering.md) |
| `error` | falha classificada por `code` — **nunca uma exceção** |

A falha vira chunk, e não exceção, porque o turno já gastou tokens: o metering
precisa acontecer mesmo quando a resposta não veio.

## Capabilities: duas camadas

**A do provider** é o teto do que aquele backend sabe fazer. **A do modelo** é
o que aquela linha da tabela `models` sabe fazer. Um modelo pode ser mais pobre
que o provider, nunca mais rico.

| capability | onde mora | serve para |
| --- | --- | --- |
| `streaming` | provider + `models.supports_streaming` | — |
| `toolCalling` | provider + `models.supports_tool_calling` | recusar binding de agente ([RN-040](../business-rules/api.md#rn-040)) |
| `listModels` | só provider | habilitar/pular a sincronização do catálogo ([RN-043](../business-rules/api.md#rn-043)) |
| `embeddings` | provider + `supportsEmbeddings` na linha do catálogo | permitir/recusar a chamada de embedding ([RN-190](../business-rules/api.md#rn-190)) |
| `reasoningText` | só provider | devolver o TEXTO do raciocínio como chunk `reasoning` ([RN-993](../business-rules/api.md#rn-993)); `true` só na Anthropic e no OpenRouter, provados em 2026-11-03 (`anthropic-provider.raciocinio.smoke.spec.ts`, `openrouter-provider.raciocinio.smoke.spec.ts`); na Anthropic o texto é o resumo; os outros nove seguem `false` |
| `promptCaching` | provider + o filtro de modelo no hook de configuração (`anthropic/*` no OpenRouter) | marcar `cache_control` no prefixo estável ([RN-892](../business-rules/api.md#rn-892)); `true` só no OpenRouter, provado por smoke em 2026-10-15 |
| `stickySession` | só provider | mandar `session_id` e prender a conversa ao upstream que a atendeu ([RN-907](../business-rules/api.md#rn-907)); `true` só no OpenRouter, provado por smoke em 2026-10-21 |
| `priceCeiling` | só provider | mandar `provider.max_price` = catálogo × 1,5 e repetir uma vez sem teto no 404 ([RN-917](../business-rules/api.md#rn-917)); `true` só no OpenRouter, provado por smoke em 2026-10-28 |
| `context_length` | `models.context_window` | orçamento de contexto |
| `vision` | `models.supports_vision` | filtrar o catálogo ([RN-056](../business-rules/api.md#rn-056)); `true` só no OpenRouter (provider), provado por smoke em 2026-11-03 ([RN-989](../business-rules/api.md#rn-989)) |
| `reasoning` | `models.supports_reasoning` | idem |
| `image output` | `models.generates_image` | idem |

### As três facetas de modalidade

`supports_vision`, `supports_reasoning` e `generates_image` são **fato do
provider**: saem do catálogo remoto na sincronização, com o mesmo fallback do
tool calling — remoto, depois local, depois `false`. Hoje só o OpenRouter as
publica:

| faceta | de onde vem no OpenRouter | no catálogo de 2026-08-04 |
| --- | --- | --- |
| `supports_vision` | `architecture.input_modalities` contém `image` | 181 de 338 |
| `generates_image` | `architecture.output_modalities` contém `image` | 11 de 338 |
| `supports_reasoning` | `supported_parameters` contém `reasoning` | 213 de 338 |

Aceitar imagem e **produzir** imagem são eixos distintos: ler um diagrama e
desenhar um resolvem problemas diferentes.

O parser **omite** o campo quando o provider não declara a modalidade, e
`undefined` preserva o valor local na sincronização — ausência de declaração
não é declaração de ausência. Por isso a tela usa as facetas só como filtro
positivo: `false` quer dizer "o provider não declarou", nunca "o modelo não
sabe" ([ADR 0051](../adr/0051-facetas-de-capability-e-curadoria-por-uso.md)).

:::caution Isto NÃO cobre "melhor para código"
Nenhum catálogo de provider publica para que um modelo é bom. Isso é curadoria
de quem opera, e mora em `workspace_models.uses`, por workspace
([RN-057](../business-rules/api.md#rn-057)) — não é capability, e derivá-la
do nome do modelo seria um palpite vestido de dado.
:::

<!-- BEGIN:GENERATED:providers-capabilities -->

> ⚠️ Bloco gerado por `pnpm docs:generate`. Não edite à mão — o próximo build o sobrescreve.

Lido dos literais `capabilities` em `apps/api/src/infrastructure/llm/` — **11 providers**.

| provider | streaming | tool calling | list_models | embeddings | preferência de roteamento | credencial | origem dos modelos | quirks resumidos | fonte |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `9router` | sim | sim | sim | não | não | chave de API | sync | URL por instalação; Credencial obrigatória; Preço = curadoria manual; Capabilities `false`; Usage corrigido; Token Saver desligado; Raciocínio redigido no OAuth do Claude; Camuflagem das ferramentas no OAuth do Claude; Qual upstream serviu | `apps/api/src/infrastructure/llm/nine-router-provider.ts` |
| `anthropic` | sim | sim | sim | não | não | chave de API | sync + seed | — | `apps/api/src/infrastructure/llm/anthropic-provider.ts` |
| `bitdeer` | sim | sim | não | não | não | chave de API | seed | `Authorization: Bearer <chave>` CONFIRMADO; `GET /v1/models` existe e é autenticado; Três ids REAIS de modelo confirmados; Nenhuma peculiaridade de stream/erro confirmada | `apps/api/src/infrastructure/llm/bitdeer-provider.ts` |
| `deepinfra` | sim | sim | sim | não | não | chave de API | sync + seed | O catálogo é PÚBLICO — sem autenticação nenhuma; `stream_options.include_usage` confirmado como suportado; Erro no formato padrão | `apps/api/src/infrastructure/llm/deepinfra-provider.ts` |
| `nvidia-nim` | sim | sim | sim | não | não | chave de API | sync + seed | Sem cabeçalho dedicado; Tool calling é POR MODELO, não por API; `stream_options.include_usage` não confirmado | `apps/api/src/infrastructure/llm/nvidia-nim-provider.ts` |
| `ollama` | sim | sim | sim | sim | não | nenhuma (local) | sync + seed | — | `apps/api/src/infrastructure/llm/ollama-provider.ts` |
| `openai` | sim | sim | sim | não | não | chave de API | sync + seed | — | `apps/api/src/infrastructure/llm/openai-provider.ts` |
| `opencode-zen` | sim | não | não | não | não | chave de API | seed | Sem teste de conexão da credencial; Capabilities `false` | `apps/api/src/infrastructure/llm/opencode-zen-provider.ts` |
| `openrouter` | sim | sim | sim | não | sim | chave de API | sync | Cabeçalhos próprios; Id de modelo prefixado pelo upstream; Catálogo com preço na própria linha; Erro NO MEIO do stream; Custo real em `usage.cost`; Alias de roteamento livre (`~…`) é sincronizado mas não pode ser curado | `apps/api/src/infrastructure/llm/openrouter-provider.ts` |
| `together` | sim | sim | sim | não | não | chave de API | sync + seed | Unidade de preço NÃO documentada explicitamente pela Together; Ids com namespace; `stream_options.include_usage` não confirmado; 429 leva `error_type: dynamic_request_limited \| dynamic_token_limited` | `apps/api/src/infrastructure/llm/together-provider.ts` |
| `vultr` | sim | sim | não | não | não | chave de API | seed | Tool calling CONFIRMADO com exemplo real; Sufixo `-normalize` | `apps/api/src/infrastructure/llm/vultr-provider.ts` |

Provider sem `list_models` é PULADO pela sincronização do catálogo, com o motivo
no relatório — nunca tratado como "o catálogo voltou vazio".
"Origem dos modelos": `sync` descobre sozinho, `seed` só entra por
`apps/api/src/db/seed.ts`, `sync + seed` tem os dois (o seed é só o bootstrap
antes da primeira sincronização). "Quirks resumidos" são os RÓTULOS em negrito da
seção de prosa do provider abaixo — o porquê de cada um mora lá, não aqui.
"embeddings" é a capability do ADR 0075, e só é `sim` com PROVA de execução:
ler a documentação não conta, e o motivo de cada `não` está no comentário do
literal, no arquivo da última coluna.
"preferência de roteamento" é a capability do ADR 0166 (um hub escolhendo o upstream
por `price`, `throughput` ou `latency`), sob a mesma régua: `sim` só depois de
um smoke contra a API real devolver o upstream escolhido.
<!-- END:GENERATED:providers-capabilities -->

O default de `supports_tool_calling` é `false`. É de propósito: um modelo
descoberto pela sincronização automática (Fase 9c) entra sem uma promessa que
ninguém verificou. Os modelos do seed declaram a capability explicitamente, e
a migration `0026` faz o mesmo backfill em bancos que já existiam — mirando as
sete linhas do seed, nunca um `UPDATE` cego na tabela.

:::caution Modelo inserido à mão
`models` não tem endpoint HTTP de edição: quem acrescenta um modelo o faz pelo
`seed.ts` ou por SQL direto. Nos dois casos, **declare
`supports_tool_calling`** se pretende vincular esse modelo a um agente — o
default `false` faz o binding ser recusado, inclusive quando o modelo é
apontado por `DEMO_QA_MODEL` nos scripts de demonstração de gate.
:::

## Onde a pessoa vê e edita os providers

Os providers têm página própria, `/providers`, no rodapé do menu ao lado de
Containers (AT-577). Desde a RN-911 (AT-597) ela é o ÚNICO lugar de credencial, catálogo e gasto
por chave: as Configurações do projeto só escolhem modelo. Ela compõe, com
os mesmos endpoints e `queryKey`s: chaves, a tabela do que cada provider
sabe fazer (lida de `GET /llm/provider-capabilities`, uma coluna por chave da
resposta), o catálogo de modelos e, só para `owner`, o gasto por chave. O
critério de roteamento do OpenRouter continua sendo do modelo do agente ou da
área, escolhido nas Configurações do projeto.

A api já expõe quais providers têm chave do TITULAR do workspace (a pessoa cuja
chave os agentes gastam, RN-058): `GET workspaces/:workspaceId/llm-providers/credentialed`,
`viewer`, resposta `{ providers: [...] }` só com nomes e sem `ollama` (RN-926, AT-607).
Desde a RN-931 a tela a consome: a tabela do que cada provider sabe fazer lista só
os providers ATIVOS (local ou com chave do titular), cada um com o nome e a cor do
card de credencial, e uma linha diz quantos ficaram de fora e quais. O catálogo de
modelos é um painel com uma aba por provider ativo; o provider sem chave que ainda
tem modelo ativo aparece como aba marcada "sem chave do titular", para dar para
desativá-lo. Se a rota não responde, as telas mostram todos os providers.

## Catálogo de modelos: descoberta e ciclo de vida

Quem declara `listModels` sabe listar o próprio catálogo. A base compatível
implementa o `GET /models` do dialeto que ela já fala, com o parsing trocável
por configuração (`parseCatalogo`) — um hub devolve preço e janela na mesma
linha, e isso não pode virar um `if` dentro do parsing padrão.

**Ollama e Anthropic agora declaram `true`** — o backlog que o
[ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
deixou aberto. Eles declaravam `false` não por falta de endpoint, mas porque o
formato não tinha sido conferido contra a doc oficial, e a regra é não
programar contra contrato adivinhado. Os dois formatos foram conferidos antes
de escrever uma linha de código:

- **Anthropic** — `GET /v1/models` devolve
  `{ data: [{ id, display_name, max_input_tokens, ... }], has_more, last_id }`,
  paginado **por cursor** (não por offset): `last_id` vira o `after_id` da
  próxima página, com `limit` de 1 a 1000. Quem percorre as páginas é o
  `client.models.list` do SDK oficial, que já pagina sozinho — refazer o laço
  do cursor à mão seria reescrever código mantido pelo fornecedor. Preço **não
  vem** na resposta: o modelo entra com o preço de LISTA datado do provider
  (`PRECO_DE_LISTA_ANTHROPIC`, [RN-997](../business-rules/api.md#rn-997)), e
  sem preço, em vez de com um inventado, quando o id não está na tabela.
  Desde a [RN-965](../business-rules/api.md#rn-965) a tela de curadoria
  SUGERE o preço que o fabricante publica (tabela curada
  `apps/api/src/domain/llm/precos-do-fabricante.ts`, cada linha com link e
  data da fonte), e quem aplica é o `owner`; a mesma tabela vale para o
  modelo da Anthropic servido por outro provider (o `cc/` do 9Router, por
  exemplo), por igualdade exata do id. No 9Router a sugestão traz também a
  faixa de cobrança pelo alias (`cc`/`cx` assinatura, `:free`/`ollama`
  grátis, o resto API).
- **Ollama** — `GET /api/tags` devolve `{ models: [{ name, model, size, ... }] }`
  no host local (`OLLAMA_HOST`, default `http://localhost:11434`). Sem preço,
  como cabe a um runtime local.

Os dois LANÇAM no erro, como o contrato exige: devolver lista vazia seria lido
pela reconciliação como "sumiu tudo" e deixaria o catálogo inteiro
indisponível ([RN-043](../business-rules/api.md#rn-043)).

### Os dois eixos independentes de disponibilidade

Um modelo tem dois estados INDEPENDENTES, e confundi-los era o buraco que a
Fase 9c fechou:

| onde | quem escreve | o que quer dizer |
| --- | --- | --- |
| `workspace_models.is_active` | o **owner daquele workspace**, pela tela de curadoria | aparece no seletor e pode receber binding novo |
| `models.availability` | a **sincronização**, sozinha | `unavailable` = sumiu do catálogo do provider |

Um modelo pode estar ativo E indisponível ao mesmo tempo — é essa sobreposição
que gera o aviso na tela. Quando o provider o traz de volta, a escolha do owner
continua valendo: a sincronização nunca religa o que alguém desligou de
propósito.

Os dois eixos deixaram de morar na mesma tabela no
[ADR 0049](../adr/0049-curadoria-de-modelo-por-workspace.md). A curadoria é
**por workspace** — `models.is_active` era uma coluna da instalação inteira, e
o owner do workspace A ligando um modelo o ligava também para o B
([RN-052](../business-rules/api.md#rn-052)). O que ficou em `models` é fato
do provider: nome, preço, capabilities e disponibilidade, iguais para todos.

**Ausência de linha em `workspace_models` É "desligado".** Não há um estado
separado de "nunca decidido", e é assim que a RN-043 continua valendo sem
coluna nenhuma que a sincronização pudesse atropelar.

### O terceiro eixo: para que o workspace usa o modelo

`workspace_models.uses` guarda a curadoria POR USO — `codigo`, `documentacao`,
`analise`, `imagem`, `conversa` — um vocabulário fechado em
`apps/api/src/domain/llm/model-uses.ts`. É o que nenhum catálogo publica: o
provider declara a capability, mas qual modelo rende bem em código **para este
time** só se descobre usando.

Ele não se mistura com `is_active`:

- marcar um uso **não liga** o modelo — a linha nova nasce com `is_active =
  false` explícito, contra o DEFAULT `true` da coluna;
- trocar o uso **não desliga** o que estava ligado;
- a lista **substitui** a anterior (lista vazia desmarca tudo).

Rota: `POST /workspaces/:workspaceId/models/uses`, `owner`
([RN-057](../business-rules/api.md#rn-057)).

### As três regras de reconciliação

1. **Modelo novo entra INATIVO** — sem linha de curadoria em workspace nenhum.
   Um catálogo tem centenas de linhas; despejá-las todas ativas tornaria a
   escolha impossível e ligaria um modelo caro sem ninguém decidir.
2. **Modelo que sumiu vira `unavailable`, nunca é apagado.** `model_bindings`
   e `token_usage` apontam para a linha; apagá-la levaria o histórico de custo
   junto.
3. **Falha do provider não torna nada indisponível.** Um 401 quer dizer "não
   sei o que tem lá", não "não tem nada lá" — marcar tudo como sumido por causa
   de uma chave revogada derrubaria de uma vez todo binding daquele provider. O
   provider é PULADO, com a origem da falha (`infra` | `modelo`) no relatório.

### E as duas regras de reconciliação de preço

4. **`manual_pricing` vence o catálogo remoto.** Uma linha marcada assim tem um
   número que alguém digitou a partir da doc do provider, e a sincronização não
   mexe nele — nem quando o catálogo traz preço próprio
   ([RN-051](../business-rules/api.md#rn-051)).
5. **Toda mudança de preço feita pela sincronização deixa uma linha em
   `model_price_changes`**, com origem `sync` e `changed_by` nulo
   ([RN-044](../business-rules/api.md#rn-044)).

Um modelo NOVO descoberto pela sincronização nasce `manual_pricing = false`
quando o catálogo informou preço — a origem é a sincronização, e é ela que
mantém a linha em dia. Descoberto SEM preço, nasce `true`: a linha está
esperando alguém digitar um, e marcá-la já protege esse número do primeiro
catálogo que por acaso informe preço.

### A cascata revalida a capability ao descer de nível

`resolveBinding` pula o candidato indisponível e segue a precedência. Quando o
turno leva ferramentas, ele também pula quem não faz tool calling **em todo
nível** — sem isso, o fallback de um agente pousaria num modelo só de chat e
violaria em silêncio a [RN-040](../business-rules/api.md#rn-040): a falha só
apareceria depois, no ToolLoop, como "o agente parou sozinho". O que foi pulado
volta em `skipped`, e a interface o mostra.

A precedência é `session > agent > area > project > workspace`
([RN-020](../business-rules/api.md#rn-020)). `area` entrou na FASE 23: é o
PADRÃO que um lead e os subagentes da área dele compartilham, e o binding
próprio do agente é a divergência que o sobrepõe — ele entra na mesma
revalidação de capability acima, inclusive a exigência de tool calling
([RN-102](../business-rules/api.md#rn-102)). Os escopos `agent` e `area`
passaram a ser POR PROJETO (`scope_id` composto, `<projectId>:<slug|chave>`) —
antes, `agent` era um slug global e o mesmo binding valia para todo projeto
([RN-103](../business-rules/api.md#rn-103), [ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)).

Um subagente sem valor em nível nenhum (ou só com o default global do
workspace) herda o binding RESOLVIDO do lead da área dele, e a resposta leva
`herdadoDoLead` nomeando o lead; `appsec` herda de `secops` e `qa-estrategia`
de `qa` ([RN-703](../business-rules/api.md#rn-703)).

### Quem agenda e quem executa

O engine agenda (um worker do Oban que se reagenda, `MODEL_SYNC_INTERVAL_SECONDS`,
6h por padrão) e a api executa, porque é ela que guarda as credenciais e o
registro de providers. O botão "Atualizar catálogo" da tela de curadoria chama
o **mesmo** caso de uso — não há duas reconciliações que possam divergir.

## Preço: vale daqui para frente, nunca retroativo

`token_usage` guarda o preço que produziu cada `cost_micros`
(`input_price_per_million_micros` e `output_price_per_million_micros`). O custo
histórico já era imutável antes da Fase 9c; o que faltava era ser
**reproduzível** — sem o preço gravado, `tokens × preço = custo` deixaria de
fechar no momento em que alguém corrigisse a tabela.

Desde o [ADR 0188](../adr/0188-o-custo-real-do-provider-vira-o-numero-do-metering.md)
([RN-665](../business-rules/api.md#rn-665)) o preço do catálogo só é o número
quando a resposta não traz o custo real. Quando traz (o `usage.cost` do
OpenRouter), ele é o `cost_micros`, as duas colunas de preço guardam o preço
IMPLÍCITO (`custo ÷ tokens`, marcado por `price_implicit`), e o que o catálogo
teria cobrado vai ao lado em `catalog_cost_micros` — então `tokens × preço =
custo` continua valendo em toda linha, real ou estimada.

Toda mudança de preço grava uma linha em `model_price_changes`, append-only,
com o par antes/depois e a origem (`manual` | `sync`). O par é gravado junto de
propósito: reconstruir o "antes" a partir da linha anterior dependeria de
nenhuma escrita ter escapado do caminho auditado, que é exatamente o que a
auditoria existe para provar.

:::caution Duas escritas escapavam
A origem `sync` existia no domínio desde a Fase 9c e **nenhuma escrita a
produzia**: a sincronização trocava o preço por `upsert`, fora do caminho
auditado. O `seed.ts` fazia o mesmo — e ele roda contra banco já semeado
(`BRABO_FORCE_SEED=1` no `bootstrap.sh` do k8s), então corrigir um preço no seed
trocava o número em silêncio. Os dois passaram a auditar; o seed reusa o
`UpdateModelPricingUseCase` em vez de repetir a lógica, e o chama **antes** do
upsert — depois dele, os dois valores já seriam iguais e a auditoria trataria
como nada a fazer.
:::

:::note Não é evento da outbox
`model_price_changes` é tabela própria, não uma linha em `outbox_events`. O
`Engine.Outbox.Drain.run_once/0` filtra por `aggregate_type == "session"` — uma
linha de preço ali ficaria com `processed_at` nulo para sempre e poluiria a
métrica de atraso da outbox. É um log de domínio imutável, como `session_events`.
:::

## Embeddings

A segunda operação do contrato (ADR 0075), e a única além de `chat` que gasta
tokens. Só existe onde `capabilities.embeddings` é `true`.

```ts
const { vectors, dimensions, model, inputTokens, estimated } =
  await provider.embed(['primeiro trecho', 'segundo trecho'], {
    model: 'nomic-embed-text',
  });
```

**É em lote, e a ordem é contrato.** Um índice recebe N trechos de uma vez, e a
posição é o único vínculo entre entrada e vetor. Daí a garantia que mais
importa: **um vetor por entrada, ou erro** — nunca uma lista mais curta. Uma
resposta parcialmente recusada é indetectável depois; o defeito só apareceria
na busca, longe da causa. Pelo mesmo motivo o contrato recusa vetor vazio,
dimensões diferentes dentro da mesma resposta e lista de entradas vazia.

**O erro lança, não vira chunk.** No `chat` o erro vira chunk porque o turno já
gastou tokens e o metering precisa acontecer; aqui não há nada a preservar — ou
o provider devolveu os vetores e cobrou, ou não devolveu e não cobrou. A
taxonomia de `code` é exatamente a mesma da tabela abaixo.

| dialeto | endpoint | corpo da resposta |
| --- | --- | --- |
| base OpenAI-compatível | `POST /embeddings` | `{ data: [{ index, embedding }], model, usage.prompt_tokens }` |
| Ollama | `POST /api/embed` | `{ model, embeddings: number[][], prompt_eval_count }` |

O `index` da OpenAI é o vínculo com a entrada, e a doc **não promete ordem** —
por isso a base ordena por ele antes de devolver. O campo `dimensions` de
`EmbeddingOptions` (reduzir o vetor) só existe na OpenAI; o Ollama o ignora, em
vez de falhar, porque ali a dimensão é do modelo — e o resultado sempre declara
a dimensão REAL do que voltou.

### Quem vetoriza hoje

| provider | `embeddings` | por quê |
| --- | --- | --- |
| `ollama` | **sim** | provado por execução contra o daemon 0.32.1 (`nomic-embed-text`, 2 entradas → 2 vetores de 768) |
| `anthropic` | não | **não tem** endpoint de embedding — a doc aponta para um terceiro, que é outro provider |
| os outros sete | não | nenhum smoke com credencial provou o endpoint deles ([aceite](../explanation/aceite-providers.md)) |

Declarar lendo a doc é o que o ADR 0043 proíbe, e custou duas reversões ao
vivo. O DIALETO da base, porém, está provado: a suite de contrato roda uma
segunda vez sobre ele com a capability ligada — é isso que torna barato virar
um provider para `true` quando a chave existir.

O Ollama também é o único que publica a camada do MODELO: `/api/tags` traz
`capabilities: ["embedding"]` e `details.embedding_length` por linha, e é daí
que vêm `supportsEmbeddings` e `embeddingDimensions` no catálogo. Um modelo de
chat a quem se pede embedding recebe **`501`** do daemon — o motivo de a
checagem acontecer antes ([RN-190](../business-rules/api.md#rn-190)).

:::note O gasto ainda não é medido
`embed` devolve `inputTokens`/`estimated` para alimentar o metering, e
`calculateCostMicros(input, 0, …)` já funciona (embedding não tem saída em
tokens). O que falta é estrutural: `token_usage.session_id` é **NOT NULL**, e
indexar um repositório não acontece dentro de sessão. Corte declarado no
ADR 0075 — pertence à onda que implementa o consumidor.
:::

## Erros normalizados

Ninguém decide nada casando substring da mensagem do fornecedor: a decisão é
tomada pelo `code` do chunk. As classes moram em
`apps/api/src/domain/llm/llm-provider-errors.ts`.

| status do provider | `code` | quer dizer |
| --- | --- | --- |
| 401, 403 | `auth` | chave ausente, inválida ou sem acesso ao modelo |
| 402 | `insufficient_credit` | a conta do provider ficou sem crédito (RN-730) |
| 404 | `model_not_found` | o modelo não existe naquele provider |
| 429 | `rate_limit` | cota ou vazão estourada |
| 413, ou 400 com marcador de contexto | `context_length` | o prompt não cabe na janela |
| — | `timeout` | o provider ficou **calado** além do teto de inatividade |
| — | `connection` | nem chegou ao provider |
| qualquer outro | `upstream` | falhou do outro lado por outro motivo |

Um 400 só vira `context_length` quando o corpo traz um marcador conhecido
(`context_length_exceeded` e variantes). Casar por marcador é frágil, então o
413 — que é inequívoco — vem primeiro, e um 400 sem marcador cai em `upstream`
em vez de mentir sobre a causa.

## Teto de inatividade {#inactivity-ceiling}

O teto não é sobre duração total, é sobre **silêncio**. Um turno legítimo pode
demorar (um modelo processa milhares de tokens de prompt antes do primeiro
token), mas nunca fica calado. É a lição do ADR 0020, em que o `fetch` desistia
nos 300s fixos do undici com um "fetch failed" opaco e o agente gravava "o
modelo parou" para uma requisição que nunca foi respondida.

| provider | mecanismo | env |
| --- | --- | --- |
| Ollama | timeout de socket do `node:http` | `OLLAMA_REQUEST_TIMEOUT_MS` |
| base OpenAI-compatível | idem | `LLM_REQUEST_TIMEOUT_MS` |
| Anthropic | `withIdleTimeout` sobre o stream do SDK | `LLM_REQUEST_TIMEOUT_MS` |

O Ollama tem env própria porque um modelo local tem outra ordem de grandeza de
latência até o primeiro token.

## A base OpenAI-compatível

`OpenAICompatibleProvider` implementa o dialeto `/chat/completions` uma única
vez. Nove providers nascem dela: OpenAI (a primeira instância), OpenRouter
(Fase 11a, o hub) e os cinco da Fase 11b — NVIDIA NIM, Together, DeepInfra,
Bitdeer, Vultr. Todos mudam `baseUrl`, o cabeçalho de autenticação e flags —
nunca o parsing (a única exceção que se provou necessária foi o `parseCatalogo`
próprio de cada um, quando a capability é `true` — ver as seções por provider
abaixo).

```ts
interface OpenAICompatibleFlags {
  streamOptionsIncludeUsage: boolean;
  maxTokensField: 'max_tokens' | 'max_completion_tokens';
}
```

O campo de teto de saída vai em TODA chamada (RN-734): `options.maxTokens`
quando quem chama o define, senão `MAX_TOKENS_PADRAO` (4096, o mesmo default
do provider Anthropic). Sem o campo, o OpenRouter reserva crédito para a saída
MÁXIMA do modelo por chamada em voo e responde 402 mesmo quando a chamada real
caberia no saldo. Uma resposta cortada por esse teto ainda não é narrada: este
dialeto não lê `finish_reason: "length"`.

Quando o modelo raciocina (`models.supports_reasoning`) e a configuração do
provider tem `campoDeRaciocinioDesligado` (hoje só o OpenRouter), o teto de
saída vira saída visível + `ORCAMENTO_DE_RACIOCINIO` (4096), porque o
raciocínio conta dentro de `max_tokens` (RN-741). Nenhum campo de raciocínio é
enviado só porque o modelo aceita o parâmetro (RN-782): a medição paga de
2026-10-10 (AT-467) mostrou `reasoning: { max_tokens }` LIGANDO o raciocínio no
`anthropic/claude-haiku-4.5` (74% das chamadas, 2,8x o custo) e sendo IGNORADO
pelo `anthropic/claude-haiku-5.5` (1024 pedidos, 8192 gastos). Os dev agents de
execução (`dev-<modulo>`, não o `dev-lead`) recebem `reasoning: { enabled: false }`
(RN-783, decisão do dono): 0 de 8 respostas cortadas, -42% de custo no Haiku
5.5. A ajuda da faceta "pensamento" do catálogo de modelos diz isso. O provider
Anthropic direto não envia `thinking`, então ali o modelo não raciocina.

Exceção por modelo (RN-914, ADR 0223): com `models.reasoning_budget` preenchido
(curado à mão; hoje só `qwen/qwen3.7-flash`, 2048, provado em 22/10) o corpo
leva `reasoning: { max_tokens: N }` e o teto vira saída visível + N. O
`deepseek/deepseek-v4.1-flash` ignorou `max_tokens` e `effort` na medição: o
limite dele (2048, migração 0075) é imposto ABORTANDO o stream quando o
`delta.reasoning` passa de caracteres/4 > N, com custo estimado e reconciliado
depois (RN-915, ADR 0224). `effort` nunca é enviado, e o limite não garante a
tool call.

Cada flag existe porque um provider real diverge. Não acrescente flag sem um
provider que precise dela.

## Divergências normalizadas {#normalized-divergences}

Os três providers passam no mesmo contrato, mas os dialetos não são idênticos.
O que diverge é normalizado, não escondido:

| assunto | Ollama | base compatível | Anthropic |
| --- | --- | --- | --- |
| formato | NDJSON | SSE `data:` | SSE com eventos nomeados |
| transporte | `node:http` | `node:http` | SDK oficial + `withIdleTimeout` |
| ids de tool call | não manda — nós geramos | manda; geramos se faltar | manda |
| argumentos de tool call | já desserializados | string fatiada, remontada pelo índice | `input_json_delta`, remontado pelo SDK |
| resposta sem `usage` | não emite chunk | conta localmente com `estimated: true` | **impossível** — `usage` é obrigatório no `message_start` |
| papel `tool` | mensagem própria | `role: "tool"` + `tool_call_id` | bloco `tool_result` dentro de um turno `user` |
| resposta cortada no teto de saída | não lido | `finish_reason: "length"` → chunk `truncated` | `stop_reason: "max_tokens"` → chunk `truncated` |
| `system` DEPOIS de `user`/`tool` | mantido no lugar, último item de `messages` | mantido no lugar, último item de `messages` | **içado**: acrescentado ao parâmetro `system` de topo (unido com `\n\n` depois do prompt que já está lá) e removido de `messages` |

A linha da Anthropic é a mais cara: resultados de chamadas paralelas precisam
chegar no **mesmo** turno `user`, então mensagens `tool` consecutivas são
agrupadas.

### Uma mensagem `system` no fim da conversa (AT-161) {#a-system-message-at-the-end-of-the-conversation-at-161}

A linha do `system` tardio existe porque a orientação de idioma da AT-081
prevê enviar **uma** mensagem efêmera `role: "system"` no FIM da lista, em toda
chamada de um turno — depois de `user` na primeira chamada, depois de `tool`
nas seguintes. A suite de contrato responde, para cada um dos onze providers,
onde essa mensagem pousa no **corpo serializado**: cada harness declara
`posicaoDoSistemaTardio` e o contrato a confere nas duas posições, além de o
texto aparecer exatamente uma vez e o resto da conversa manter a ordem
(`apps/api/test/contract/llm-provider.contract.ts`).

| provider | adaptador | onde o `system` tardio pousa |
| --- | --- | --- |
| OpenAI, OpenRouter, NVIDIA NIM, Together, DeepInfra, Bitdeer, Vultr, 9Router, OpenCode Zen | base compatível (`toWireMessage`) | fim de `messages`, `role: "system"` |
| Ollama | próprio (`messages` enviado como está) | fim de `messages`, `role: "system"` |
| Anthropic | próprio (SDK oficial) | fim do `system` de topo; posição perdida |

Nenhum adaptador a descarta nem a duplica. O que o servidor falso não sabe
dizer é se o provider REAL aceita esse corpo — ele aceita qualquer coisa. Isso
é um smoke manual à parte, `apps/api/test/infrastructure/llm/sistema-tardio.smoke.spec.ts`,
um `describe` por provider, cada um condicionado à mesma chave que os smokes de
aceite usam (mais `ANTHROPIC_TEST_KEY`; o Ollama por
`OLLAMA_SISTEMA_TARDIO_SMOKE=1`). Quais já rodaram está registrado no
[aceite de providers](../explanation/aceite-providers.md). Sem essa rodada, um
provider **não está provado** quanto a aceitar `system` tardio — a regra dos
ADRs 0041/0042.

**Observação, não medida (lacuna 2 da AT-081):** na Anthropic o içamento faz a
orientação mudar o bloco `system` do topo, que vem ANTES da conversa — então
toda mudança no texto dela muda o prefixo da requisição, e com ele qualquer
prompt caching que o prefixo teria. Cache não é observável no produto hoje
(AT-082), então isto fica registrado, não quantificado.

## OpenRouter — o primeiro hub (Fase 11a)

`OpenRouterProvider` é `OpenAICompatibleProvider` com `openrouterConfig()`
(`apps/api/src/infrastructure/llm/openrouter-provider.ts`). Ele declara
`listModels: true` — a única peça de código que muda quando uma capability liga
é a configuração; o `SyncModelCatalogUseCase` já cuida do resto.

Peculiaridades encontradas e testadas
(`test/infrastructure/llm/openrouter-provider.contract.spec.ts`):

- **Cabeçalhos próprios**: `HTTP-Referer` (de `API_PUBLIC_URL`) e `X-Title:
  "Brabo"` — opcionais pela doc oficial (atribuição/ranking no site do
  OpenRouter), sempre enviados porque não custam nada;
- **Id de modelo prefixado pelo upstream** (`openai/gpt-4o-mini`,
  `anthropic/claude-3-5-sonnet`): o prefixo é o fornecedor PEDIDO, não o que
  respondeu — ver `extrairUpstreamProvider` abaixo;
- **Catálogo com preço na própria linha**: `GET /v1/models` devolve
  `pricing.prompt`/`pricing.completion` como STRING decimal em USD **por
  token**, ao contrário do padrão simples só com id `{ data: [{ id }] }` da
  OpenAI. `parseCatalogoOpenRouter` converte para micro-USD por milhão
  (`* 1e12`, arredondado — a coluna é `bigint`);
- **Erro NO MEIO do stream**: o OpenRouter aceita a conexão e começa a mandar
  texto antes de saber se o provider real por trás vai falhar — um modo de
  falha que a OpenAI não tem, porque não roteia para infraestrutura de
  terceiros. O frame vem como
  `{"error":{"code":"...","message":"..."},"choices":[...]}`; um campo `error`
  verdadeiro é o sinal. Código numérico usa o mesmo `normalizeHttpStatus` da
  base; código em string é mapeado por substring (`mapearCodigoDeFrame`) com
  `upstream` como default seguro — nunca silêncio, nem para código fora do mapa;
- **Custo real em `usage.cost`** (ADR 0188, RN-665): o último frame do stream
  traz o que o hub cobrou, em USD; `extrairCustoRealOpenRouter` o converte em
  micro-USD e o metering o grava como o número. Com `is_byok: true` o campo é a
  taxa do hub, não a inferência, então NÃO é lido e a linha cai no catálogo.
  `model` (a versão datada para a qual um alias como
  `~deepseek/deepseek-flash-latest` resolveu) e `id` (`gen-…`) são lidos pela
  base para todo provider do dialeto;
- **Alias de roteamento livre (`~…`) é sincronizado mas não pode ser curado**
  (AT-271, [RN-679](../business-rules/api.md#rn-679)): um id como
  `~deepseek/deepseek-flash-latest` sempre redireciona para o modelo mais novo
  da família, o preço dele no catálogo é preço de vitrine, e a conta vem de
  qualquer upstream que tenha servido a chamada. A sincronização o mantém no
  catálogo (tirá-lo marcaria `unavailable` um já curado); ativá-lo é 422
  `alias_de_roteamento_livre`, e a leitura da curadoria o marca com
  `freeRoutingAlias`. Um ativado antes da regra continua ativo e pode ser
  desligado — desligado, não volta;
- **Teste de conexão**: `GET /key` (doc oficial) valida a chave sem gastar
  tokens numa chamada de chat de verdade. É o primeiro
  `LLMCredentialConnectionTester` do lado de LLM. Desde o
  [ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md) ele
  **não roda no cadastro**: a credencial é cifrada e guardada sem julgamento, e
  a verificação é a ação explícita
  `POST /users/me/credentials/{provider}/test`, sobre a chave já guardada. Um
  provider sem teste declarado (hoje: `ollama`/`anthropic`/`openai`) devolve
  `nao_suportado` — nunca um `ok` falso ([RN-055](../business-rules/api.md#rn-055)).

O teste de aceite com credencial real que a Fase 11a exige — cadastro,
sincronização povoando o catálogo, ativação curada e uma sessão de chat ponta a
ponta com custo congelado em `token_usage` — é
`test/infrastructure/llm/openrouter-provider.smoke.spec.ts`. Ele nunca roda em
CI: sem `OPENROUTER_TEST_KEY` no ambiente, o `describe` inteiro é pulado com
um aviso. Mesmo molde dos smokes de git contra API real
(`github-provider.smoke.spec.ts`, `gitlab-provider.smoke.spec.ts`).

## NVIDIA NIM (Fase 11b)

`NvidiaNimProvider` é `OpenAICompatibleProvider` com `nvidiaNimConfig()`
(`apps/api/src/infrastructure/llm/nvidia-nim-provider.ts`), apontado para o
endpoint **hospedado** (`integrate.api.nvidia.com`) — não o container
auto-hospedado, que é outro produto com outro endereço.

- **`listModels: true`** (AT-575, provado em 28/10/2026): `GET /v1/models` devolve
  `id`/`object`/`created`/`owned_by` (84 modelos no smoke real, entre eles
  `nemotron-3.5-lightning-30b-a3b`, `nemotron-3-ultra-550b-a55b` e
  `nemotron-3-nano-omni-30b-a3b-reasoning`), sem preço: o parser padrão basta e
  o sync grava preço 0 com `manual_pricing`. Sem a capability o sync pulava o
  provider e a curadoria (ADR 0042) não tinha modelo para ativar;
- **Sem cabeçalho dedicado**: `Authorization: Bearer nvapi-...` — bearer
  padrão, a chave só tem o prefixo `nvapi-` por convenção da NVIDIA;
- **Tool calling é POR MODELO, não por API**: só modelos específicos (Llama
  3.1 70B/405B, variantes do Nemotron, ...) o suportam de fato — mas isso nunca
  é flag de configuração, é inteiramente `models.supports_tool_calling`
  (seed/curadoria), confirmado lendo `buildBody()` na base: a flag
  `capabilities.toolCalling` só decide se o parâmetro `tools` é enviado, não se
  o modelo específico sabe usá-lo;
- **`stream_options.include_usage` não confirmado** para o endpoint hospedado
  (só documentado para o software NIM auto-hospedado) —
  `streamOptionsIncludeUsage: false`; o fallback `estimated` da base cobre o
  caso em que o campo nunca vem;
- **Teste de conexão**: sem endpoint de validação dedicado (nenhum endpoint de
  "whoami"/saldo encontrado) — `GET /v1/models` com a chave, só o status
  importa (200 vs 401/403).

:::info A NVIDIA não cobra por token
A busca por um preço oficial foi refeita e chegou a uma resposta melhor que
"não achei": **não há preço por token para achar**. A doc oficial
([docs.api.nvidia.com/nim/docs/product](https://docs.api.nvidia.com/nim/docs/product))
diz que o endpoint hospedado é acesso gratuito de **prototipação** para membro
do Developer Program, e que produção exige licença NVIDIA AI Enterprise —
"These licenses start at $4500 per GPU per year or ~ $1 per GPU per hour in the
cloud." A unidade é GPU/hora, não token.

Os três modelos NIM do seed ficam, portanto, com preço **estimado** por
comparação com equivalentes em outros providers, e `manual_pricing = true`:
basta para o teto de orçamento ter o que descontar, e é o máximo de
honestidade possível enquanto o modelo de negócio do fornecedor não for por
token.
:::

O teste de aceite com credencial real mora em
`test/infrastructure/llm/nvidia-nim-provider.smoke.spec.ts`, condicionado a
`NVIDIA_NIM_TEST_KEY`. O passo de sincronização lista o catálogo de verdade e
confere que o modelo curado veio do `/v1/models`.

## Together AI (Fase 11b)

`TogetherProvider` é `OpenAICompatibleProvider` com `togetherConfig()`
(`apps/api/src/infrastructure/llm/together-provider.ts`).

- **`listModels: true`**: `GET /v1/models` documentado com `pricing:
  {input, output, cached_input, base, hourly, finetune}` — só `input`/
  `output` são usados;
- **Unidade de preço NÃO documentada explicitamente pela Together**: os
  valores são NÚMEROS (não strings como no OpenRouter) e, por comparação com o
  preço de mercado publicado (Llama 3.3 70B a US$1,04/1M em together.ai/models
  — a mesma ordem de grandeza do exemplo `"input": 0.3` do schema oficial), a
  inferência é **USD por MILHÃO de tokens direto**, não por token. Quem
  confirma isso contra uma chave real é o smoke (ver o comentário no topo de
  `together-provider.smoke.spec.ts`) — se um dia se provar errado, é achado a
  corrigir aqui e no parser, não a calar;
- **Ids com namespace**: `meta-llama/Llama-3.3-70B-Instruct-Turbo` — um id
  "achatado" no estilo da OpenAI (`gpt-4o`) responde 404;
- **`stream_options.include_usage` não confirmado** na doc — mesmo tratamento
  cauteloso do NIM, o fallback `estimated` cobre;
- **429 leva `error_type: dynamic_request_limited | dynamic_token_limited`**
  no corpo — não testado à parte porque o corpo continua sendo
  `{error: {message}}`, compatível com o parsing padrão da base; só importa se
  um dia precisarmos distinguir os dois tipos de rate limit;
- **Teste de conexão**: sem endpoint dedicado — `GET /v1/models`, só o status.

O teste de aceite com credencial real mora em
`test/infrastructure/llm/together-provider.smoke.spec.ts`, condicionado a
`TOGETHER_TEST_KEY`.

## DeepInfra (Fase 11b)

`DeepInfraProvider` é `OpenAICompatibleProvider` com `deepinfraConfig()`
(`apps/api/src/infrastructure/llm/deepinfra-provider.ts`), `baseUrl`
`https://api.deepinfra.com/v1/openai` (a superfície OpenAI-compatível — a
DeepInfra também tem endpoints nativos fora dela, não usados aqui).

- **`listModels: true`**, confirmado AO VIVO nesta sessão contra
  `GET {baseUrl}/models` (o MESMO endpoint que a base já chama por padrão, sem
  extensão necessária): a resposta traz `metadata.pricing.
  {input_tokens,output_tokens}` (USD por milhão, número — a mesma convenção
  inferida para a Together) e `metadata.context_length` por linha;
- **O catálogo é PÚBLICO — sem autenticação nenhuma**, confirmado ao vivo (a
  chamada funcionou sem cabeçalho `Authorization`). Isso tem uma consequência
  real: **não há teste de conexão para a DeepInfra**
  (`llm-credential-connection-tester.ts` não tem entrada para ela) — uma chave
  inválida só seria descoberta na primeira chamada de CHAT real, nunca no
  cadastro. Nenhum outro endpoint autenticado de validação documentado
  publicamente foi encontrado;
- **O catálogo mistura chat com imagem/áudio/vídeo/embedding na MESMA
  lista**, cada tipo com um formato de `pricing` diferente
  (`per_image_unit`, `input_characters`, `output_seconds`, ...) —
  `parseCatalogoDeepInfra` filtra por `metadata.tags.includes('chat')` antes
  de tentar ler `input_tokens`/`output_tokens`; sem o filtro, um modelo de
  imagem entraria com um preço fabricado a partir de um campo que nem é "por
  token";
- **`stream_options.include_usage` confirmado como suportado** na doc (ao
  contrário de NIM/Together) — `streamOptionsIncludeUsage: true`;
- **Erro no formato padrão** `{"error": {"message", "type", "param", "code"}}`
  — compatível com o parsing padrão da base, sem `parseErrorFrame` dedicado.

O teste de aceite com credencial real mora em
`test/infrastructure/llm/deepinfra-provider.smoke.spec.ts`, condicionado a
`DEEPINFRA_TEST_KEY` — e é o primeiro smoke em que o passo de CADASTRO não
valida nada; só o passo de CHAT descobriria uma chave ruim.

## Bitdeer (Fase 11b)

`BitdeerProvider` é `OpenAICompatibleProvider` com `bitdeerConfig()`
(`apps/api/src/infrastructure/llm/bitdeer-provider.ts`) — a doc pública mais
rasa dos cinco desta fase.

- **`listModels: false`**: nenhum formato de catálogo/preço foi encontrado
  publicamente (a página de preços renderiza por JS, sem exemplo alcançável
  por uma busca não interativa) — sem formato conferido, não há
  `parseCatalogo` honesto a escrever. Reconferido:
  `bitdeer.ai/en/pricing/ai-models` continua montando a tabela no cliente (o
  HTML servido **não** traz nome de modelo nenhum) e não há doc de preço fora
  dela. O preço do seed segue ESTIMADO;
- **`Authorization: Bearer <chave>` CONFIRMADO** (exemplo real de curl achado
  na doc da API de embeddings da Bitdeer nesta sessão) — mesmo com o resto do
  dialeto sem exemplo nenhum;
- **`GET /v1/models` existe e é autenticado** (401 ao vivo sem chave,
  confirmado nesta sessão) — vira o teste de conexão (só o status, como os
  outros sem endpoint dedicado);
- **Três ids REAIS de modelo confirmados** em exemplos de configuração do
  próprio blog da Bitdeer (não nomes de vitrine): `moonshotai/Kimi-K2.5`,
  `zai-org/GLM-5`, `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B` — semeados em
  `apps/api/src/db/seed.ts` com preço ESTIMADO (mercado do modelo/família em
  outros providers, não confirmado pela própria Bitdeer);
- **Nenhuma peculiaridade de stream/erro confirmada** — a afirmação de
  "OpenAI REST API standards" da Bitdeer não veio acompanhada de um exemplo
  real de `/chat/completions`, então o teste de contrato não hidrata
  particularidade nenhuma que a doc não provou. O smoke é a PRIMEIRA
  confirmação real do dialeto.

O teste de aceite com credencial real mora em
`test/infrastructure/llm/bitdeer-provider.smoke.spec.ts`, condicionado a
`BITDEER_TEST_KEY`.

## Vultr Serverless Inference (Fase 11b)

`VultrProvider` é `OpenAICompatibleProvider` com `vultrConfig()`
(`apps/api/src/infrastructure/llm/vultr-provider.ts`) — o único dos cinco em
que a decisão de `listModels` **mudou durante a implementação** em relação ao
plano original.

- **`listModels: false`** (o plano original apontava `true`): a base chama
  SEMPRE `{baseUrl}/models` (`openai-compatible-provider.ts`, `listModels()`),
  e a própria referência oficial da Vultr (`api.vultrinference.com`) descreve
  `GET /models` como devolvendo só `id`/`created`/`object`/`owned_by`/`features`
  — **sem preço**. O endpoint que a doc associa a preço (`GET /provider`, com
  `cost`/`contextWindow`) devolveu **404 ao vivo** no caminho testado nesta
  sessão — dado insuficiente para escrever um `parseCatalogo` sem arriscar
  apontar para a URL errada ("true frágil"). O próprio `GET /v1/models` está
  confirmado (401 ao vivo sem chave, duas vezes) — só não tem preço;
- **Tool calling CONFIRMADO com exemplo real**: a doc oficial
  (`docs.vultr.com/how-to-use-tool-calling-with-vultr-serverless-inference`)
  mostra `kimi-k2-instruct` respondendo com `finish_reason: "tool_calls"` —
  dialeto OpenAI padrão puro, sem campo estranho naquele exemplo; os outros
  dois modelos semeados (`llama-3.3-70b-instruct-fp8`,
  `deepseek-r1-distill-llama-70b`) não têm confirmação de tool calling —
  `supportsToolCalling: false` para eles;
- **Sufixo `-normalize`**: a pesquisa inicial apontou um proxy normalizador
  documentado — NÃO foi possível reconfirmar essa doc nesta sessão (uma busca
  dirigida não achou o termo nas páginas conferidas). Não é usado por padrão de
  qualquer forma (mantemos o id cru do modelo);
- **Teste de conexão**: `GET /v1/models`, só o status.

:::tip O preço da Vultr é OFICIAL, e é tarifa única
Ao contrário de NIM e Bitdeer, a Vultr **publica** a tarifa —
[na doc de uso e custo do Serverless Inference](https://docs.vultr.com/support/products/serverless/how-do-i-monitor-the-usage-and-cost-of-my-vultr-serverless-inference-subscription):
"Requests are billed at $0.55 per 1,000,000 input tokens and $2.75 per
1,000,000 output tokens." É tarifa do **serviço**, não por modelo — a doc não
diferencia por modelo, e é por isso que as três linhas do seed repetem o mesmo
par (`550_000` / `2_750_000` micros).

A estimativa que estava lá antes errava na direção perigosa: `400_000` de
**saída** em dois dos três modelos, contra os `2_750_000` reais. O metering
subestimava o custo de saída em quase 7× — e saída é o que domina a conta de um
agente que escreve código.

`manual_pricing` continua `true`, e não é contradição: a flag quer dizer "preço
digitado por uma pessoa lendo a doc, em vez de vir da sincronização"
(`apps/api/src/db/schema.ts`). O que mudou é que o número agora é o do próprio
provider, não uma comparação de mercado.
:::

O teste de aceite com credencial real mora em
`test/infrastructure/llm/vultr-provider.smoke.spec.ts`, condicionado a
`VULTR_TEST_KEY`.

## 9Router (AT-576a, ADR 0222)

`NineRouterProvider` é `OpenAICompatibleProvider` com `nineRouterConfig()`
(`apps/api/src/infrastructure/llm/nine-router-provider.ts`) — o décimo
provider (ADR 0043 era o dos nove). O 9Router é um gateway local do dono
(`github.com/decolua/9router`), com endpoint OpenAI-compatível e painel na
mesma porta, e roteia por **combos** (nome estável → lista de modelos/contas com
fallback).

- **URL por instalação**: `NINE_ROUTER_BASE_URL`, padrão
  `http://host.docker.internal:20128/v1`, lida a cada uso (molde do
  `OLLAMA_HOST`). Os composes de instalação e de produção ganham
  `extra_hosts: host.docker.internal:host-gateway` na api; sem ele o padrão não
  resolve no Docker Engine nativo do Linux;
- **Credencial obrigatória**: a chave de API é criada no painel do 9Router. O
  teste de conexão é `GET /models` com a chave, na URL do ambiente;
- **`listModels: true`**, com `parseCatalogo9Router`: lê `capabilities` do
  `GET /v1/models` (tools, reasoning, janela de contexto). A fixture de teste
  (`apps/api/test/fixtures/nine-router/models.sintetica.json`) é **SINTÉTICA**,
  montada do formato descrito no levantamento, não capturada do 9Router real;
- **Preço = curadoria manual** (ADR 0042): a resposta não traz preço nem
  `usage.cost` (não achado no build v0.5.104). Por decisão do dono (22/10), o
  modelo de assinatura registra o **preço público da API equivalente**, não zero:
  o orçamento conta o custo de oportunidade;
- **Capabilities `false`** (além de `listModels`, `streaming` e `toolCalling`, esta última desde a RN-950; `streaming` é exigida por todo provider na suite de contrato) até o smoke com chave:
  `routingPreference` (combo não é `provider.sort`), `embeddings`,
  `promptCaching`, `stickySession`, `priceCeiling`;
- **Usage corrigido** (AT-638, RN-958): a 0.5.112 soma 2 000 a `prompt_tokens`; o provider lê a versão em `/api/version` e subtrai só nela, grava como veio nas outras (com aviso) e lê o `cached_tokens` do topo. O cache de `cc/*` o 9Router descarta no stream;
- **Token Saver desligado**: o "RTK Token Saver" do 9Router comprime
  `tool_result`, e o modelo leria algo diferente do que o log gravou. O provider
  manda `x-9router-token-saver: off` em toda chamada. **Achado no 9Router 0.5.112** (RN-966): o bundle (`chunks/8895.js`) lê esse cabeçalho e o valor `off`, sem caixa, desliga RTK, Headroom, Caveman e Ponytail juntos. O Custom Prompt NÃO passa por ele: o cabeçalho não o desliga (desligado no painel desde 22/10);
- **Raciocínio redigido no OAuth do Claude** (RN-966): para a conta OAuth do Claude (`cc/*`) o 9Router manda `Anthropic-Beta` com `redact-thinking-2026-02-12`. O pensamento volta redigido e sem `reasoning_tokens`. Por isso a contagem de raciocínio do stream (RN-915) e a retentativa sem raciocínio (RN-916) ficam cegas nesse caminho, e `reasoning_tokens` grava ausente ("não disse", RN-666);
- **Camuflagem das ferramentas no OAuth do Claude** (RN-966): com o token `sk-ant-oat` o 9Router renomeia as ferramentas (sufixo, desfeito na volta), acrescenta cerca de 20 ferramentas falsas do Claude Code e envia `User-Agent: claude-cli/…`, `X-App: cli` e o `Anthropic-Beta` de Claude Code. Não há configuração que desligue. Riscos: o modelo chamar uma ferramenta falsa (ex.: `Read`/`Bash` que o Brabo não tem) e termos de uso — por isso o TP-01 voltou ao OpenRouter (AT-631). Usar API key ou outro provider.
- **Qual upstream serviu**: o único cabeçalho com a conexão
  (`x-9router-connection-id`) aparece só no caminho de vídeo no build lido; no
  chat, não medido. O smoke imprime os cabeçalhos `x-*` da resposta.

O aceite com chave real mora em
`test/infrastructure/llm/nine-router-provider.smoke.spec.ts`, condicionado a
`NINE_ROUTER_TEST_KEY` e `NINE_ROUTER_TEST_MODEL` (só modelo `free`/`auto:free`).

## OpenCode Zen (AT-568, ADR 0227)

`OpenCodeZenProvider` é `OpenAICompatibleProvider` com `openCodeZenConfig()`
(`apps/api/src/infrastructure/llm/opencode-zen-provider.ts`) — o décimo primeiro
provider. A doc pública do Zen mostra três dialetos; só o `/chat/completions`
(`https://opencode.ai/inference/openai/v1`) cabe na base. Os modelos de
`/responses`, `/v1/messages` e Google, e o Jev do Zen, ficam fora.

**Medido em 29/10/2026 (smoke com chave real):** `deepseek-v4.1-flash-free` e
`glm-5.3-flash-free` respondem `429 FreeUsageLimitError` por API de terceiro
("Free models work in OpenCode ... subscribe to OpenCode Go"). Os grátis só valem
dentro do cliente OpenCode. Os modelos pagos do Zen exigem saldo na conta ou o
OpenCode Go; essa via não foi provada.

- **`listModels: false`**: a lista de modelos mora em `/inference/v1/models`, e
  não em `{baseUrl}/models`, que a base chama. O catálogo vem do seed curado
  (ADR 0042). O seed NÃO traz modelo: os grátis saíram em 29/10/2026, porque o
  fornecedor os recusa por API. Modelo pago entra por curadoria na tela;
- **Sem teste de conexão da credencial**: a lista de modelos é pública, e um
  teste por ela passaria com chave inválida;
- **Capabilities `false`** além de `streaming` (exigido pela suite de contrato)
  e `streamOptionsIncludeUsage: false` até o smoke com chave provar.

O aceite com chave real mora em
`test/infrastructure/llm/opencode-zen-provider.smoke.spec.ts`, condicionado a
`OPENCODE_ZEN_TEST_KEY` (modelos `-free`, custo US$ 0). Ele prova stream, tool
call e `usage` com `stream_options`. Rodou em 29/10/2026: **reprova** com 429
`FreeUsageLimitError`, a recusa do fornecedor para o grátis por API.

## Hubs e custo real

Num **hub** (OpenRouter), quem aparece na chamada é o hub, mas quem custa é o
provider que de fato serviu. O metering grava os dois:

- `ChatUsageChunk.upstreamProvider` — o provider o preenche quando o hub o
  informa;
- `token_usage.upstream_provider` — texto livre e **anulável**. Não é enum: o
  conjunto é do hub, muda sem aviso e não cabe a nós versioná-lo. `null` quer
  dizer "não veio de hub, ou o hub não informou";
- as métricas `brabo_llm_tokens_total` e `brabo_llm_cost_micros_total`
  ganharam o rótulo `upstream_provider`, e o dashboard executivo tem um painel
  de custo por provider subjacente. Sem hub, o rótulo repete o próprio
  provider — com rótulo vazio, `sum by (upstream_provider)` mostraria só o que
  passou por hub e faria parecer que o resto não custou nada.

Ler o campo do frame é um **hook de configuração** na base
(`extrairUpstreamProvider`), não um `if` dentro do parsing: cada hub põe a
informação num lugar diferente, e a regra da fase é que particularidade de
provider vira configuração.

`models.manual_pricing` marca um preço digitado a partir da doc do provider em
vez de sincronizado. A sincronização do catálogo **não sobrescreve** o preço de
uma linha marcada sem decisão explícita — e quando o catálogo remoto não
informa preço, o valor guardado é preservado em vez de zerado: campo ausente
quer dizer "o provider não disse", nunca "é de graça".

### Exemplo: o mesmo modelo, hub × direto

A promessa da Fase 11a ("custo comparável entre 'mesmo modelo via hub' e
'direto' é consultável") só vira uso real quando o MESMO modelo aparece dos
dois lados — hoje é o caso de qualquer modelo que OpenAI/Anthropic publiquem e
que também esteja no catálogo do OpenRouter (por exemplo, GPT-4o):

```promql
# Razão de custo: servido via OpenRouter vs. servido direto pela OpenAI,
# no mesmo período. > 1 quer dizer que o hub saiu mais caro que o direto.
sum(rate(brabo_llm_cost_micros_total{provider="openrouter", upstream_provider="openai"}[1h]))
  /
sum(rate(brabo_llm_cost_micros_total{provider="openai"}[1h]))
```

Este é o gancho que `upstream_provider` habilita — hoje sem consumidor
automático. A leitura pretendida (registrada como semente, não implementada) é
o Psicólogo um dia sugerir "este modelo sai mais barato direto que via hub" a
partir dessa mesma métrica.

## A suite de contrato

`apps/api/test/contract/llm-provider.contract.ts` roda a mesma bateria contra
qualquer implementação, como a suite de git faz desde a Fase 2. A divisão é o
ponto: **o contrato é dono das asserções, o harness é dono do dialeto.**

Um provider novo só precisa escrever o harness — traduzindo cada cenário para
o próprio formato de fio — e herda os testes de stream com frame partido, usage
presente e ausente, tool calling, os quatro erros e o servidor calado. O
servidor falso é um `node:http` de verdade numa porta efêmera, não um mock de
`fetch`: o que está sob teste é justamente o comportamento do socket.

## Tool calling e o resgate do engine

O `ToolCallRecovery` do engine (ADR 0020) recupera chamadas que um modelo
pequeno escreveu em prosa em vez de usar o campo `tools`. É **resgate, não
licença**: depende de o modelo acertar o formato por acaso e falha calado
quando não acerta. Por isso vincular a um agente um modelo sem tool calling
nativo é recusado no domínio, e não apenas desencorajado.
