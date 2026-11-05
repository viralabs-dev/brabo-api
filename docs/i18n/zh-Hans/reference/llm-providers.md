---
id: llm-providers
title: LLM provider
sidebar_position: 9
description: 让 Ollama、OpenAI 和 Anthropic 可以互换的统一契约，包括按 provider 和按模型的 capability、目录同步、模型生命周期、规范化的错误以及不活动上限。
keywords: [LLM, provider, OpenAI, Anthropic, Ollama, capabilities, tool calling, streaming, 目录, 价格]
traducao_de: c416f2b0423a85b6939818014c69cb25bb5f2fa6
---

# LLM provider

Brabo 中的每个 agent 和每个聊天都通过一个统一的契约与模型对话。调用方不知道另一端是磁盘上的 Ollama、OpenAI 的 API 还是 Anthropic 的 API——也不应该知道。

决策见 [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)，不活动上限继承自 [ADR 0020](../adr/0020-destravar-gates-qa-secops.md)。

## 契约

`LLMProvider`（`apps/api/src/application/ports/llm-provider.port.ts`）有一个**必需**操作，而且它总是流式的：

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

两个可选操作遵循同样的**双向**契约：声明了 capability 的实现该方法，没有声明的就不暴露它。消费方通过检查 capability 来降级，绝不是在失败时才发现它。

tool calling 和 token 计数都没有单独的方法：工具放在 `options.tools` 中，一切都通过同一个流返回，作为四种 `ChatStreamChunk` 之一。

| chunk | 时机 |
| --- | --- |
| `text_delta` | 生成的一段文本 |
| `tool_calls` | 模型请求了工具（单个 chunk，不是增量的） |
| `usage` | token 计数，带 `estimated` 标记；当响应中提供时，还有真实成本（`costMicros`）、实际服务的模型（`resolvedModel`）、响应 id（`generationId`）以及 token 计数中缓存/推理的**部分**（`cachedInputTokens`、`reasoningTokens`，RN-666）——[ADR 0188](../adr/0188-o-custo-real-do-provider-vira-o-numero-do-metering.md) |
| `error` | 按 `code` 分类的失败——**绝不是异常** |

失败变成 chunk 而不是异常，是因为回合已经花掉了 token：即使响应没有到来，计量也必须发生。

## Capability：两层

**provider 的一层**是该后端能做什么的上限。**模型的一层**是 `models` 表中那一行能做什么。模型可以比 provider 弱，但绝不能更强。

| capability | 所在位置 | 用途 |
| --- | --- | --- |
| `streaming` | provider + `models.supports_streaming` | — |
| `toolCalling` | provider + `models.supports_tool_calling` | 拒绝 agent 的 binding（[RN-040](../business-rules/api.md#rn-040)） |
| `listModels` | 仅 provider | 启用/跳过目录同步（[RN-043](../business-rules/api.md#rn-043)） |
| `embeddings` | provider + 目录行上的 `supportsEmbeddings` | 允许/拒绝 embedding 调用（[RN-190](../business-rules/api.md#rn-190)） |
| `promptCaching` | provider + 配置 hook 中的模型过滤（OpenRouter 上为 `anthropic/*`） | 在稳定前缀上标记 `cache_control`（[RN-892](../business-rules/api.md#rn-892)）；只有 OpenRouter 为 `true`，于 2026-10-15 通过 smoke 证明 |
| `context_length` | `models.context_window` | 上下文预算 |
| `vision` | `models.supports_vision` | 过滤目录（[RN-056](../business-rules/api.md#rn-056)） |
| `reasoning` | `models.supports_reasoning` | 同上 |
| `image output` | `models.generates_image` | 同上 |

### 模态的三个维度

`supports_vision`、`supports_reasoning` 和 `generates_image` 是 **provider 的事实**：它们在同步时从远程目录中得出，回退规则与 tool calling 相同——先远程，再本地，最后 `false`。目前只有 OpenRouter 发布它们：

| 维度 | 在 OpenRouter 中的来源 | 2026-08-04 的目录中 |
| --- | --- | --- |
| `supports_vision` | `architecture.input_modalities` 包含 `image` | 338 个中有 181 个 |
| `generates_image` | `architecture.output_modalities` 包含 `image` | 338 个中有 11 个 |
| `supports_reasoning` | `supported_parameters` 包含 `reasoning` | 338 个中有 213 个 |

接受图像和**生成**图像是两个不同的轴：读一张图和画一张图解决的是不同的问题。

当 provider 没有声明某种模态时，解析器会**省略**该字段，而 `undefined` 在同步时保留本地值——没有声明不等于声明了没有。因此界面只把这些维度用作正向过滤：`false` 意味着"provider 没有声明"，绝不意味着"模型不会"（[ADR 0051](../adr/0051-facetas-de-capability-e-curadoria-por-uso.md)）。

:::caution 这**不**涵盖"最适合写代码"
没有任何 provider 的目录会发布某个模型擅长什么。这是运维者的策展，按 workspace 存放在 `workspace_models.uses` 中（[RN-057](../business-rules/api.md#rn-057)）——它不是 capability，从模型名推导它只会是一个打扮成数据的猜测。
:::

<!-- BEGIN:GENERATED:providers-capabilities -->

> ⚠️ 此区块由 `pnpm docs:generate` 生成。请勿手动编辑——下次构建会覆盖它。

读取自 `apps/api/src/infrastructure/llm/` 中的 `capabilities` 字面量——**11 个 provider**。

| provider | streaming | tool calling | list_models | embeddings | 路由偏好 | 凭据 | 模型来源 | 特性摘要 | 来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `9router` | 是 | 是 | 是 | 否 | 否 | API 密钥 | sync | URL por instalação; Credencial obrigatória; Preço = curadoria manual; Capabilities `false`; Usage corrigido; Token Saver desligado; Raciocínio redigido no OAuth do Claude; Camuflagem das ferramentas no OAuth do Claude; Qual upstream serviu | `apps/api/src/infrastructure/llm/nine-router-provider.ts` |
| `anthropic` | 是 | 是 | 是 | 否 | 否 | API 密钥 | sync + seed | — | `apps/api/src/infrastructure/llm/anthropic-provider.ts` |
| `bitdeer` | 是 | 是 | 否 | 否 | 否 | API 密钥 | seed | `Authorization: Bearer <chave>` CONFIRMADO; `GET /v1/models` existe e é autenticado; Três ids REAIS de modelo confirmados; Nenhuma peculiaridade de stream/erro confirmada | `apps/api/src/infrastructure/llm/bitdeer-provider.ts` |
| `deepinfra` | 是 | 是 | 是 | 否 | 否 | API 密钥 | sync + seed | O catálogo é PÚBLICO — sem autenticação nenhuma; `stream_options.include_usage` confirmado como suportado; Erro no formato padrão | `apps/api/src/infrastructure/llm/deepinfra-provider.ts` |
| `nvidia-nim` | 是 | 是 | 是 | 否 | 否 | API 密钥 | sync + seed | Sem cabeçalho dedicado; Tool calling é POR MODELO, não por API; `stream_options.include_usage` não confirmado | `apps/api/src/infrastructure/llm/nvidia-nim-provider.ts` |
| `ollama` | 是 | 是 | 是 | 是 | 否 | 无（本地） | sync + seed | — | `apps/api/src/infrastructure/llm/ollama-provider.ts` |
| `openai` | 是 | 是 | 是 | 否 | 否 | API 密钥 | sync + seed | — | `apps/api/src/infrastructure/llm/openai-provider.ts` |
| `opencode-zen` | 是 | 否 | 否 | 否 | 否 | API 密钥 | seed | Sem teste de conexão da credencial; Capabilities `false` | `apps/api/src/infrastructure/llm/opencode-zen-provider.ts` |
| `openrouter` | 是 | 是 | 是 | 否 | 是 | API 密钥 | sync | Cabeçalhos próprios; Id de modelo prefixado pelo upstream; Catálogo com preço na própria linha; Erro NO MEIO do stream; Custo real em `usage.cost`; Alias de roteamento livre (`~…`) é sincronizado mas não pode ser curado | `apps/api/src/infrastructure/llm/openrouter-provider.ts` |
| `together` | 是 | 是 | 是 | 否 | 否 | API 密钥 | sync + seed | Unidade de preço NÃO documentada explicitamente pela Together; Ids com namespace; `stream_options.include_usage` não confirmado; 429 leva `error_type: dynamic_request_limited \| dynamic_token_limited` | `apps/api/src/infrastructure/llm/together-provider.ts` |
| `vultr` | 是 | 是 | 否 | 否 | 否 | API 密钥 | seed | Tool calling CONFIRMADO com exemplo real; Sufixo `-normalize` | `apps/api/src/infrastructure/llm/vultr-provider.ts` |

没有 `list_models` 的 provider 会被目录同步跳过，原因记录在报告中——
绝不会被当作“目录返回为空”。
“模型来源”：`sync` 自行发现，`seed` 只通过
`apps/api/src/db/seed.ts` 进入，`sync + seed` 两者都有（seed 只是首次同步前的
引导）。“特性摘要”是下方该 provider 文字章节中的粗体标签——
每一项的原因写在那里，而不是这里。
“embeddings” 是 ADR 0075 的能力，只有在有执行证明时才为 `是`：
阅读文档不算数，每个 `否` 的原因写在字面量的注释里，
即最后一列所列的文件中。
“路由偏好” 是 ADR 0166 的能力（hub 按 `price`、`throughput` 或 `latency`
选择 upstream），规则相同：只有在针对真实 API 的 smoke 测试
返回所选 upstream 之后才为 `是`。
<!-- END:GENERATED:providers-capabilities -->

`supports_tool_calling` 的默认值是 `false`。这是故意的：自动同步（Fase 9c）发现的模型进入时不带任何没人验证过的承诺。种子中的模型显式声明这一 capability，migration `0026` 在已存在的数据库中做同样的回填——只针对种子的七行，绝不是对整张表盲目 `UPDATE`。

:::caution 手工插入的模型
`models` 没有编辑用的 HTTP 端点：添加模型的人要么通过 `seed.ts`，要么直接用 SQL。两种情况下，如果打算把这个模型绑定到某个 agent，**请声明 `supports_tool_calling`**——默认的 `false` 会让 binding 被拒绝，包括在 gate 演示脚本中该模型由 `DEMO_QA_MODEL` 指定的情况。
:::

## 模型目录：发现与生命周期

声明了 `listModels` 的 provider 能列出自己的目录。兼容基座实现它已经在说的那种方言的 `GET /models`，解析可以通过配置替换（`parseCatalogo`）——hub 在同一行中返回价格和窗口，这不能变成标准解析里的一个 `if`。

**Ollama 和 Anthropic 现在声明为 `true`**——这是 [ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) 留下的 backlog。它们之前声明为 `false` 不是因为缺少端点，而是因为格式还没有与官方文档核对过，而规则是不针对猜测的契约编程。两种格式都在写下第一行代码之前核对过：

- **Anthropic**——`GET /v1/models` 返回 `{ data: [{ id, display_name, max_input_tokens, ... }], has_more, last_id }`，**按游标**分页（不是按偏移）：`last_id` 成为下一页的 `after_id`，`limit` 为 1 到 1000。遍历分页的是官方 SDK 的 `client.models.list`，它自己就会分页——手工重写游标循环等于重写由供应商维护的代码。响应中**没有**价格，所以模型以无价格的状态进入，而不是带一个编造的价格。
- **Ollama**——`GET /api/tags` 在本地主机（`OLLAMA_HOST`，默认 `http://localhost:11434`）返回 `{ models: [{ name, model, size, ... }] }`。没有价格，本地运行时理应如此。

两者都在出错时**抛出**，正如契约要求：返回空列表会被对账逻辑理解为"全都消失了"，让整个目录不可用（[RN-043](../business-rules/api.md#rn-043)）。

### 两个独立的可用性轴

一个模型有两个**独立**的状态，混淆它们正是 Fase 9c 填补的漏洞：

| 位置 | 谁写入 | 含义 |
| --- | --- | --- |
| `workspace_models.is_active` | **该 workspace 的 owner**，通过策展页面 | 出现在选择器中，可以接受新的 binding |
| `models.availability` | **同步**，自行写入 | `unavailable` = 从 provider 的目录中消失了 |

一个模型可以同时是活动的**和**不可用的——正是这种重叠在界面上产生警告。当 provider 把它带回来时，owner 的选择仍然有效：同步永远不会重新开启有人故意关闭的东西。

自 [ADR 0049](../adr/0049-curadoria-de-modelo-por-workspace.md) 起，两个轴不再位于同一张表中。策展是**按 workspace** 的——`models.is_active` 曾是整个安装的一列，workspace A 的 owner 开启一个模型，也会为 B 开启它（[RN-052](../business-rules/api.md#rn-052)）。留在 `models` 中的是 provider 的事实：名称、价格、capability 和可用性，对所有人都一样。

**`workspace_models` 中没有行就是"关闭"。** 没有单独的"从未决定"状态，正因如此，RN-043 无需任何可能被同步覆盖的列也依然有效。

### 第三个轴：workspace 用这个模型做什么

`workspace_models.uses` 保存**按用途**的策展——`codigo`、`documentacao`、`analise`、`imagem`、`conversa`——这是 `apps/api/src/domain/llm/model-uses.ts` 中的一个封闭词汇表。这是任何目录都不会发布的东西：provider 声明 capability，但哪个模型**对这个团队**在代码上表现好，只有用了才知道。

它不与 `is_active` 混在一起：

- 标记一个用途**不会开启**模型——新行以显式的 `is_active = false` 诞生，与该列的 DEFAULT `true` 相反；
- 更换用途**不会关闭**已开启的东西；
- 列表**替换**之前的列表（空列表取消全部标记）。

路由：`POST /workspaces/:workspaceId/models/uses`，`owner`（[RN-057](../business-rules/api.md#rn-057)）。

### 三条对账规则

1. **新模型以未激活状态进入**——在任何 workspace 中都没有策展行。一个目录有数百行；把它们全部以激活状态倒进来会让选择变得不可能，并在没人决定的情况下开启昂贵的模型。
2. **消失的模型变为 `unavailable`，绝不删除。** `model_bindings` 和 `token_usage` 指向这一行；删除它会把成本历史一起带走。
3. **provider 的失败不会让任何东西变得不可用。** 401 意味着"我不知道那里有什么"，而不是"那里什么都没有"——因为一个被吊销的密钥就把一切标记为消失，会一次性弄掉该 provider 的所有 binding。该 provider 被**跳过**，报告中带有失败来源（`infra` | `modelo`）。

### 以及两条价格对账规则

4. **`manual_pricing` 优先于远程目录。** 这样标记的行有一个由某人根据 provider 文档输入的数字，同步不会改动它——即使目录带有自己的价格（[RN-051](../business-rules/api.md#rn-051)）。
5. **同步做出的每次价格变更都会在 `model_price_changes` 中留下一行**，来源为 `sync`，`changed_by` 为空（[RN-044](../business-rules/api.md#rn-044)）。

同步发现的**新**模型，在目录提供了价格时以 `manual_pricing = false` 诞生——来源是同步，由同步保持该行最新。**没有**价格时被发现，则以 `true` 诞生：该行在等待有人输入价格，标记它可以让这个数字免受第一个碰巧提供价格的目录影响。

### 级联在降级时重新验证 capability

`resolveBinding` 跳过不可用的候选并按优先级继续。当回合带有工具时，它还会在**每一级**跳过不支持 tool calling 的模型——否则 agent 的回退会落到一个只能聊天的模型上，悄无声息地违反 [RN-040](../business-rules/api.md#rn-040)：失败只会在之后的 ToolLoop 中表现为"agent 自己停了"。被跳过的内容在 `skipped` 中返回，界面会显示它。

优先级是 `session > agent > area > project > workspace`（[RN-020](../business-rules/api.md#rn-020)）。`area` 在 FASE 23 中加入：它是 lead 和其领域内子 agent 共享的**默认值**，而 agent 自己的 binding 是覆盖它的差异——它进入上面同样的 capability 重新验证，包括对 tool calling 的要求（[RN-102](../business-rules/api.md#rn-102)）。`agent` 和 `area` 作用域改为**按项目**（复合 `scope_id`，`<projectId>:<slug|chave>`）——此前 `agent` 是全局 slug，同一个 binding 对所有项目生效（[RN-103](../business-rules/api.md#rn-103)，[ADR 0064](../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)）。

在任何级别都没有值（或只有 workspace 的全局默认值）的子 agent 会继承其领域 lead **解析后**的 binding，响应带有指出该 lead 的 `herdadoDoLead`；`appsec` 继承 `secops`，`qa-estrategia` 继承 `qa`（[RN-703](../business-rules/api.md#rn-703)）。

### 谁调度，谁执行

engine 负责调度（一个会自我重新调度的 Oban worker，`MODEL_SYNC_INTERVAL_SECONDS`，默认 6 小时），api 负责执行，因为凭据和 provider 注册表由它保存。策展页面上的"更新目录"按钮调用**同一个**用例——不存在两种可能不一致的对账。

## 价格：从此往后生效，绝不追溯

`token_usage` 保存产生每个 `cost_micros` 的价格（`input_price_per_million_micros` 和 `output_price_per_million_micros`）。在 Fase 9c 之前，历史成本就已经是不可变的；缺的是**可复现**——没有记录价格，一旦有人修正了表格，`tokens × 价格 = 成本` 就不再成立。

自 [ADR 0188](../adr/0188-o-custo-real-do-provider-vira-o-numero-do-metering.md)（[RN-665](../business-rules/api.md#rn-665)）起，目录价格只有在响应不带真实成本时才是那个数字。当响应带有它（OpenRouter 的 `usage.cost`）时，它就是 `cost_micros`，两个价格列保存**隐含**价格（`成本 ÷ token 数`，由 `price_implicit` 标记），目录本应收取的费用放在旁边的 `catalog_cost_micros` 中——因此 `tokens × 价格 = 成本` 在每一行上都仍然成立，无论是真实的还是估算的。

每次价格变更都会在 `model_price_changes` 中写入一行，只追加，带有前/后的值对以及来源（`manual` | `sync`）。这对值故意一起记录：从上一行重建"之前"的值，要依赖于没有任何写入逃出被审计的路径，而这正是审计存在要证明的东西。

:::caution 有两处写入曾经逃逸
`sync` 来源自 Fase 9c 起就存在于领域中，却**没有任何写入产生它**：同步通过 `upsert` 更换价格，在被审计的路径之外。`seed.ts` 也是如此——而它会在已有种子数据的数据库上运行（k8s 的 `bootstrap.sh` 中的 `BRABO_FORCE_SEED=1`），所以在种子中修正价格会悄无声息地改掉数字。两者都开始接受审计；种子复用 `UpdateModelPricingUseCase` 而不是重复逻辑，并在 upsert **之前**调用它——在 upsert 之后，两个值已经相同，审计会认为无事可做。
:::

:::note 这不是 outbox 事件
`model_price_changes` 是独立的表，不是 `outbox_events` 中的一行。`Engine.Outbox.Drain.run_once/0` 按 `aggregate_type == "session"` 过滤——放在那里的价格行会永远保持 `processed_at` 为空，污染 outbox 的延迟指标。它是一个不可变的领域日志，就像 `session_events`。
:::

## Embeddings

契约的第二个操作（ADR 0075），也是 `chat` 之外唯一花费 token 的操作。只在 `capabilities.embeddings` 为 `true` 的地方存在。

```ts
const { vectors, dimensions, model, inputTokens, estimated } =
  await provider.embed(['primeiro trecho', 'segundo trecho'], {
    model: 'nomic-embed-text',
  });
```

**它是批量的，顺序是契约。** 索引一次接收 N 个片段，位置是输入与向量之间唯一的联系。因此最重要的保证是：**每个输入一个向量，否则报错**——绝不返回更短的列表。部分被拒绝的响应事后无法察觉；缺陷只会在搜索中出现，远离原因。出于同样的理由，契约拒绝空向量、同一响应中维度不同的向量以及空的输入列表。

**错误会抛出，而不是变成 chunk。** 在 `chat` 中，错误变成 chunk 是因为回合已经花了 token，计量必须发生；这里没有什么需要保留——要么 provider 返回了向量并收费，要么没返回也没收费。`code` 的分类与下表完全相同。

| 方言 | 端点 | 响应体 |
| --- | --- | --- |
| OpenAI 兼容基座 | `POST /embeddings` | `{ data: [{ index, embedding }], model, usage.prompt_tokens }` |
| Ollama | `POST /api/embed` | `{ model, embeddings: number[][], prompt_eval_count }` |

OpenAI 的 `index` 是与输入的联系，而文档**不承诺顺序**——所以基座在返回前按它排序。`EmbeddingOptions` 的 `dimensions` 字段（缩减向量）只在 OpenAI 中存在；Ollama 会忽略它而不是失败，因为在那里维度属于模型——结果总是声明返回内容的**真实**维度。

### 目前谁在做向量化

| provider | `embeddings` | 原因 |
| --- | --- | --- |
| `ollama` | **是** | 通过针对 daemon 0.32.1 的执行证明（`nomic-embed-text`，2 个输入 → 2 个 768 维向量） |
| `anthropic` | 否 | **没有** embedding 端点——文档指向一个第三方，那是另一个 provider |
| 其余七个 | 否 | 没有任何带凭据的 smoke 证明过它们的端点（[验收](../explanation/aceite-providers.md)） |

凭阅读文档来声明正是 ADR 0043 所禁止的，它曾造成两次线上回滚。不过基座的**方言**已经被证明：契约套件在开启 capability 的情况下对它再跑一遍——正是这一点让密钥存在时把某个 provider 改为 `true` 的成本很低。

Ollama 也是唯一发布**模型**层的：`/api/tags` 每行带有 `capabilities: ["embedding"]` 和 `details.embedding_length`，目录中的 `supportsEmbeddings` 和 `embeddingDimensions` 就来自这里。被要求做 embedding 的聊天模型会从 daemon 收到 **`501`**——这就是检查要提前进行的原因（[RN-190](../business-rules/api.md#rn-190)）。

:::note 花费尚未计量
`embed` 返回 `inputTokens`/`estimated` 以供计量使用，`calculateCostMicros(input, 0, …)` 也已经可用（embedding 没有输出 token）。缺的是结构性的东西：`token_usage.session_id` 是 **NOT NULL**，而索引仓库并不发生在会话之内。这是 ADR 0075 中声明的取舍——属于实现消费方的那一波。
:::

## 规范化的错误

没有人通过匹配供应商消息中的子串来做决定：决定依据 chunk 的 `code`。这些类位于 `apps/api/src/domain/llm/llm-provider-errors.ts`。

| provider 状态码 | `code` | 含义 |
| --- | --- | --- |
| 401, 403 | `auth` | 密钥缺失、无效或无权访问该模型 |
| 402 | `insufficient_credit` | provider 账户额度耗尽（RN-730） |
| 404 | `model_not_found` | 该 provider 上不存在这个模型 |
| 429 | `rate_limit` | 配额或吞吐量超限 |
| 413，或带上下文标记的 400 | `context_length` | prompt 放不进窗口 |
| — | `timeout` | provider 的**沉默**超过了不活动上限 |
| — | `connection` | 根本没有到达 provider |
| 其他任何状态 | `upstream` | 对方因其他原因失败 |

400 只有在响应体带有已知标记（`context_length_exceeded` 及其变体）时才会变成 `context_length`。按标记匹配是脆弱的，所以明确无误的 413 优先，不带标记的 400 落到 `upstream`，而不是对原因撒谎。

## 不活动上限 {#inactivity-ceiling}

这个上限与总时长无关，而是关于**沉默**。合法的回合可能很慢（模型在第一个 token 之前要处理数千个 prompt token），但绝不会沉默。这是 ADR 0020 的教训：当时 `fetch` 在 undici 固定的 300 秒时放弃，报出一个含糊的 "fetch failed"，agent 为一个从未被响应的请求记录了"模型停了"。

| provider | 机制 | env |
| --- | --- | --- |
| Ollama | `node:http` 的 socket 超时 | `OLLAMA_REQUEST_TIMEOUT_MS` |
| OpenAI 兼容基座 | 同上 | `LLM_REQUEST_TIMEOUT_MS` |
| Anthropic | 在 SDK 的流上套用 `withIdleTimeout` | `LLM_REQUEST_TIMEOUT_MS` |

Ollama 有自己的 env，因为本地模型到第一个 token 的延迟高出一个数量级。

## OpenAI 兼容基座

`OpenAICompatibleProvider` 只实现一次 `/chat/completions` 方言。九个 provider 由它派生：OpenAI（第一个实例）、OpenRouter（Fase 11a，hub）以及 Fase 11b 的五个——NVIDIA NIM、Together、DeepInfra、Bitdeer、Vultr。它们都只改变 `baseUrl`、认证头和开关——绝不改变解析（唯一被证明有必要的例外是在 capability 为 `true` 时各自的 `parseCatalogo`——见下面各 provider 的章节）。

```ts
interface OpenAICompatibleFlags {
  streamOptionsIncludeUsage: boolean;
  maxTokensField: 'max_tokens' | 'max_completion_tokens';
}
```

输出上限字段在**每次**调用中都会发送（RN-734）：调用方定义了就用 `options.maxTokens`，否则用 `MAX_TOKENS_PADRAO`（4096，与 Anthropic provider 的默认值相同）。没有这个字段，OpenRouter 会为每个进行中的调用按模型的**最大**输出预留额度，即使真实调用能放进余额也会返回 402。被这个上限截断的响应目前还不会被叙述：这个方言不读取 `finish_reason: "length"`。

当模型会推理（`models.supports_reasoning`）且 provider 的配置有 `campoDeRaciocinioDesligado`（目前只有 OpenRouter）时，输出上限变为可见输出 + `ORCAMENTO_DE_RACIOCINIO`（4096），因为推理计入 `max_tokens`（RN-741）。不会仅因为模型接受该参数就发送任何推理字段（RN-782）：2026-10-10 的付费测量（AT-467）显示，`reasoning: { max_tokens }` 在 `anthropic/claude-haiku-4.5` 上**开启**了推理（74% 的调用，成本 2.8 倍），而被 `anthropic/claude-haiku-5.5` **忽略**（请求 1024，花费 8192）。执行用的 dev agent（`dev-<modulo>`，不是 `dev-lead`）会收到 `reasoning: { enabled: false }`（RN-783，负责人的决定）：8 个响应中 0 个被截断，Haiku 5.5 上成本 -42%。模型目录中"思考"维度的帮助说明了这一点。直连的 Anthropic provider 不发送 `thinking`，所以那里模型不做推理。

每个开关的存在都是因为某个真实的 provider 有差异。没有需要它的 provider，就不要加开关。

## 规范化的差异 {#normalized-divergences}

三个 provider 都通过同一份契约，但方言并不相同。有差异的地方被规范化，而不是被隐藏：

| 主题 | Ollama | 兼容基座 | Anthropic |
| --- | --- | --- | --- |
| 格式 | NDJSON | SSE `data:` | 带命名事件的 SSE |
| 传输 | `node:http` | `node:http` | 官方 SDK + `withIdleTimeout` |
| tool call 的 id | 不发送——由我们生成 | 发送；缺失时由我们生成 | 发送 |
| tool call 的参数 | 已经反序列化 | 分片的字符串，按索引重组 | `input_json_delta`，由 SDK 重组 |
| 没有 `usage` 的响应 | 不发出 chunk | 本地计数，`estimated: true` | **不可能**——`usage` 在 `message_start` 中是必需的 |
| `tool` 角色 | 独立的消息 | `role: "tool"` + `tool_call_id` | `user` 回合内的 `tool_result` 块 |
| 在输出上限处被截断的响应 | 不读取 | `finish_reason: "length"` → `truncated` chunk | `stop_reason: "max_tokens"` → `truncated` chunk |
| 在 `user`/`tool` **之后**的 `system` | 保留在原位，`messages` 的最后一项 | 保留在原位，`messages` 的最后一项 | **上提**：追加到顶层的 `system` 参数（在已有 prompt 之后用 `\n\n` 连接），并从 `messages` 中移除 |

Anthropic 这一列代价最高：并行调用的结果必须在**同一个** `user` 回合中到达，所以连续的 `tool` 消息会被合并。

### 对话末尾的一条 `system` 消息（AT-161） {#a-system-message-at-the-end-of-the-conversation-at-161}

迟到 `system` 这一行之所以存在，是因为 AT-081 的语言指引计划在一个回合的每次调用中，于列表**末尾**发送**一条**短暂的 `role: "system"` 消息——第一次调用时在 `user` 之后，之后的调用中在 `tool` 之后。契约套件为九个 provider 中的每一个回答这条消息落在**序列化后的请求体**中的什么位置：每个测试框架声明 `posicaoDoSistemaTardio`，契约在两个位置上核对它，并核对文本恰好出现一次、对话其余部分保持顺序（`apps/api/test/contract/llm-provider.contract.ts`）。

| provider | 适配器 | 迟到 `system` 落在哪里 |
| --- | --- | --- |
| OpenAI、OpenRouter、NVIDIA NIM、Together、DeepInfra、Bitdeer、Vultr | 兼容基座（`toWireMessage`） | `messages` 末尾，`role: "system"` |
| Ollama | 自有（`messages` 原样发送） | `messages` 末尾，`role: "system"` |
| Anthropic | 自有（官方 SDK） | 顶层 `system` 的末尾；位置丢失 |

没有任何适配器丢弃或重复它。假服务器无法回答的是**真实**的 provider 是否接受这个请求体——它什么都接受。这是一个单独的手动 smoke，`apps/api/test/infrastructure/llm/sistema-tardio.smoke.spec.ts`，每个 provider 一个 `describe`，各自以验收 smoke 使用的同一个密钥为条件（另加 `ANTHROPIC_TEST_KEY`；Ollama 由 `OLLAMA_SISTEMA_TARDIO_SMOKE=1` 控制）。哪些已经运行过记录在 [provider 验收](../explanation/aceite-providers.md)中。没有这次运行，就迟到 `system` 的接受而言，provider **未被证明**——这是 ADR 0041/0042 的规则。

**观察，而非测量（AT-081 的缺口 2）：** 在 Anthropic 上，上提让指引改变了位于对话**之前**的顶层 `system` 块——所以它的文本每次变化都会改变请求的前缀，以及该前缀本可获得的任何 prompt caching。目前缓存在产品中不可观测（AT-082），所以这一点只是记录下来，没有量化。

## OpenRouter——第一个 hub（Fase 11a）

`OpenRouterProvider` 是带 `openrouterConfig()` 的 `OpenAICompatibleProvider`（`apps/api/src/infrastructure/llm/openrouter-provider.ts`）。它声明 `listModels: true`——当一个 capability 开启时，唯一改变的代码就是配置；其余由 `SyncModelCatalogUseCase` 处理。

发现并经过测试的特殊之处（`test/infrastructure/llm/openrouter-provider.contract.spec.ts`）：

- **自有的头**：`HTTP-Referer`（来自 `API_PUBLIC_URL`）和 `X-Title: "Brabo"`——按官方文档是可选的（用于 OpenRouter 网站上的署名/排名），因为没有成本所以总是发送；
- **以上游为前缀的模型 id**（`openai/gpt-4o-mini`、`anthropic/claude-3-5-sonnet`）：前缀是**请求的**供应商，不是实际响应的——见下面的 `extrairUpstreamProvider`；
- **价格就在行内的目录**：`GET /v1/models` 以 USD **每 token** 的十进制**字符串**返回 `pricing.prompt`/`pricing.completion`，不同于 OpenAI 只有 id 的简单模式 `{ data: [{ id }] }`。`parseCatalogoOpenRouter` 把它换算为每百万的 micro-USD（`* 1e12`，四舍五入——该列是 `bigint`）；
- **流中途的错误**：OpenRouter 会接受连接并开始发送文本，而那时它还不知道背后的真实 provider 会不会失败——这是 OpenAI 没有的失败方式，因为 OpenAI 不路由到第三方基础设施。该帧形如 `{"error":{"code":"...","message":"..."},"choices":[...]}`；真实存在的 `error` 字段就是信号。数字代码使用基座的同一个 `normalizeHttpStatus`；字符串代码通过子串映射（`mapearCodigoDeFrame`），以 `upstream` 作为安全默认值——绝不沉默，即使是映射之外的代码；
- **`usage.cost` 中的真实成本**（ADR 0188，RN-665）：流的最后一帧带有 hub 收取的费用，单位 USD；`extrairCustoRealOpenRouter` 把它换算为 micro-USD，计量把它作为那个数字记录。`is_byok: true` 时，该字段是 hub 的服务费，而不是推理费用，所以**不**读取它，该行回退到目录价格。`model`（像 `~deepseek/deepseek-flash-latest` 这样的别名解析到的带日期版本）和 `id`（`gen-…`）由基座为该方言的每个 provider 读取；
- **自由路由别名（`~…`）会被同步但不能被策展**（AT-271，[RN-679](../business-rules/api.md#rn-679)）：像 `~deepseek/deepseek-flash-latest` 这样的 id 总是重定向到该家族最新的模型，它在目录中的价格只是橱窗价，账单来自实际服务该调用的任何上游。同步把它保留在目录中（移除它会把一个已策展的模型标为 `unavailable`）；激活它是 422 `alias_de_roteamento_livre`，策展的读取会用 `freeRoutingAlias` 标记它。在规则之前激活的保持激活，可以被关闭——关闭后就不会再回来；
- **连接测试**：`GET /key`（官方文档）验证密钥，而不必在真正的聊天调用上花费 token。它是 LLM 一侧的第一个 `LLMCredentialConnectionTester`。自 [ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md) 起，它**不在登记时运行**：凭据被加密并保存，不做评判，验证是对已保存密钥的显式动作 `POST /users/me/credentials/{provider}/test`。没有声明测试的 provider（目前：`ollama`/`anthropic`/`openai`）返回 `nao_suportado`——绝不是虚假的 `ok`（[RN-055](../business-rules/api.md#rn-055)）。

Fase 11a 要求的真实凭据验收测试——登记、同步填充目录、策展激活，以及一次端到端的聊天会话，其成本冻结在 `token_usage` 中——是 `test/infrastructure/llm/openrouter-provider.smoke.spec.ts`。它从不在 CI 中运行：环境中没有 `OPENROUTER_TEST_KEY` 时，整个 `describe` 带着警告被跳过。与针对真实 API 的 git smoke（`github-provider.smoke.spec.ts`、`gitlab-provider.smoke.spec.ts`）是同一个模式。

## NVIDIA NIM（Fase 11b）

`NvidiaNimProvider` 是带 `nvidiaNimConfig()` 的 `OpenAICompatibleProvider`（`apps/api/src/infrastructure/llm/nvidia-nim-provider.ts`），指向**托管**端点（`integrate.api.nvidia.com`）——而不是自托管容器，那是另一个产品，地址也不同。

- **`listModels: false`**：`GET /v1/models` 存在（本次会话核对过官方文档），返回 `id`/`object`/`created`/`owned_by`，但找到的文档中没有任何每 token 价格——一个真实但对计量所需的按模型成本毫无用处的目录（两层 capability，ADR 0041）。该 provider 依靠**手工种子**（`apps/api/src/db/seed.ts`）运作，直到有人确认存在价格端点；
- **没有专用的头**：`Authorization: Bearer nvapi-...`——标准 bearer，密钥带 `nvapi-` 前缀只是 NVIDIA 的惯例；
- **tool calling 是按模型的，不是按 API 的**：只有特定模型（Llama 3.1 70B/405B、Nemotron 的变体……）真正支持它——但这从来不是配置开关，完全取决于 `models.supports_tool_calling`（种子/策展），这一点通过阅读基座的 `buildBody()` 得到确认：开关 `capabilities.toolCalling` 只决定是否发送 `tools` 参数，而不决定特定模型是否会用它；
- **`stream_options.include_usage` 未经确认**适用于托管端点（只在自托管的 NIM 软件中有文档）——`streamOptionsIncludeUsage: false`；基座的 `estimated` 回退覆盖了该字段永远不出现的情况；
- **连接测试**：没有专用的验证端点（没有找到"whoami"/余额端点）——用密钥调用 `GET /v1/models`，只看状态码（200 还是 401/403）。

:::info NVIDIA 不按 token 收费
对官方价格的搜索重新做了一遍，得到了比"没找到"更好的答案：**根本没有按 token 的价格可找**。官方文档（[docs.api.nvidia.com/nim/docs/product](https://docs.api.nvidia.com/nim/docs/product)）说托管端点是面向 Developer Program 成员的免费**原型**访问，生产环境需要 NVIDIA AI Enterprise 许可——"These licenses start at $4500 per GPU per year or ~ $1 per GPU per hour in the cloud." 单位是 GPU/小时，而不是 token。

因此，种子中的三个 NIM 模型使用的是通过与其他 provider 上的同等模型比较得出的**估算**价格，并且 `manual_pricing = true`：这足以让预算上限有东西可扣，也是在供应商的商业模式不按 token 计费期间所能做到的最大诚实。
:::

真实凭据的验收测试位于 `test/infrastructure/llm/nvidia-nim-provider.smoke.spec.ts`，以 `NVIDIA_NIM_TEST_KEY` 为条件。与 OpenRouter 不同，"同步"步骤什么都不会发现（capability 故意是 `false`）——smoke 确认该 provider 在报告中显示为 `pulado: 'sem_capability'`，并策展一个手工插入的模型，正如 owner 在生产中会做的那样。

## Together AI（Fase 11b）

`TogetherProvider` 是带 `togetherConfig()` 的 `OpenAICompatibleProvider`（`apps/api/src/infrastructure/llm/together-provider.ts`）。

- **`listModels: true`**：`GET /v1/models` 有文档，带 `pricing: {input, output, cached_input, base, hourly, finetune}`——只使用 `input`/`output`；
- **价格单位 Together 没有明确写在文档中**：值是**数字**（而不是 OpenRouter 那样的字符串），通过与公布的市场价格比较（together.ai/models 上 Llama 3.3 70B 为每 1M US$1.04——与官方 schema 示例 `"input": 0.3` 同一数量级），推断为**直接按每百万 token 的 USD**，而不是每 token。用真实密钥确认这一点的是 smoke（参见 `together-provider.smoke.spec.ts` 顶部的注释）——如果有一天被证明是错的，那是需要在这里和解析器中修正的发现，而不是需要掩盖的；
- **带命名空间的 id**：`meta-llama/Llama-3.3-70B-Instruct-Turbo`——OpenAI 风格的"扁平" id（`gpt-4o`）返回 404；
- **`stream_options.include_usage` 未在文档中确认**——与 NIM 一样谨慎处理，由 `estimated` 回退兜底；
- **429 的响应体带有 `error_type: dynamic_request_limited | dynamic_token_limited`**——没有单独测试，因为响应体仍然是 `{error: {message}}`，与基座的标准解析兼容；只有在哪天我们需要区分这两种速率限制时才重要；
- **连接测试**：没有专用端点——`GET /v1/models`，只看状态码。

真实凭据的验收测试位于 `test/infrastructure/llm/together-provider.smoke.spec.ts`，以 `TOGETHER_TEST_KEY` 为条件。

## DeepInfra（Fase 11b）

`DeepInfraProvider` 是带 `deepinfraConfig()` 的 `OpenAICompatibleProvider`（`apps/api/src/infrastructure/llm/deepinfra-provider.ts`），`baseUrl` 为 `https://api.deepinfra.com/v1/openai`（OpenAI 兼容的接口面——DeepInfra 在它之外还有原生端点，这里不使用）。

- **`listModels: true`**，本次会话中针对 `GET {baseUrl}/models` **实时**确认（与基座默认调用的是**同一个**端点，无需扩展）：响应每行带有 `metadata.pricing.{input_tokens,output_tokens}`（每百万的 USD，数字——与为 Together 推断的约定相同）和 `metadata.context_length`；
- **目录是公开的——完全不需要认证**，实时确认过（调用在没有 `Authorization` 头的情况下成功）。这有一个真实的后果：**DeepInfra 没有连接测试**（`llm-credential-connection-tester.ts` 中没有它的条目）——无效的密钥只会在第一次真正的**聊天**调用时被发现，而绝不会在登记时。没有找到任何其他公开文档化的、需要认证的验证端点；
- **目录在同一个列表中混合了聊天与图像/音频/视频/embedding**，每种类型的 `pricing` 格式不同（`per_image_unit`、`input_characters`、`output_seconds`……）——`parseCatalogoDeepInfra` 在尝试读取 `input_tokens`/`output_tokens` 之前按 `metadata.tags.includes('chat')` 过滤；没有这个过滤，图像模型会带着一个从根本不是"每 token"的字段编造出来的价格进入；
- **文档确认支持 `stream_options.include_usage`**（与 NIM/Together 不同）——`streamOptionsIncludeUsage: true`；
- **错误为标准格式** `{"error": {"message", "type", "param", "code"}}`——与基座的标准解析兼容，没有专用的 `parseErrorFrame`。

真实凭据的验收测试位于 `test/infrastructure/llm/deepinfra-provider.smoke.spec.ts`，以 `DEEPINFRA_TEST_KEY` 为条件——这是第一个**登记**步骤什么都不验证的 smoke；只有**聊天**步骤会发现坏密钥。

## Bitdeer（Fase 11b）

`BitdeerProvider` 是带 `bitdeerConfig()` 的 `OpenAICompatibleProvider`（`apps/api/src/infrastructure/llm/bitdeer-provider.ts`）——是本阶段五个中公开文档最浅的。

- **`listModels: false`**：没有公开找到任何目录/价格格式（价格页面由 JS 渲染，没有非交互式搜索可以访问的示例）——没有核对过的格式，就写不出诚实的 `parseCatalogo`。重新核对过：`bitdeer.ai/en/pricing/ai-models` 仍然在客户端组装表格（提供的 HTML 中**没有**任何模型名），除此之外没有价格文档。种子价格仍然是**估算**的；
- **`Authorization: Bearer <chave>` 已确认**（本次会话在 Bitdeer 的 embeddings API 文档中找到了真实的 curl 示例）——即使方言的其余部分完全没有示例；
- **`GET /v1/models` 存在且需要认证**（没有密钥时实时返回 401，本次会话确认）——它成为连接测试（只看状态码，与其他没有专用端点的一样）；
- **三个真实的模型 id 已确认**，来自 Bitdeer 自己博客中的配置示例（不是橱窗名称）：`moonshotai/Kimi-K2.5`、`zai-org/GLM-5`、`nvidia/NVIDIA-Nemotron-3-Super-120B-A12B`——在 `apps/api/src/db/seed.ts` 中以**估算**价格写入种子（该模型/家族在其他 provider 上的市场价，未经 Bitdeer 自己确认）；
- **没有确认任何流/错误方面的特殊之处**——Bitdeer 关于 "OpenAI REST API standards" 的声明没有附带真实的 `/chat/completions` 示例，所以契约测试不会填充任何文档没有证明的特殊性。smoke 是对该方言的**第一次**真实确认。

真实凭据的验收测试位于 `test/infrastructure/llm/bitdeer-provider.smoke.spec.ts`，以 `BITDEER_TEST_KEY` 为条件。

## Vultr Serverless Inference（Fase 11b）

`VultrProvider` 是带 `vultrConfig()` 的 `OpenAICompatibleProvider`（`apps/api/src/infrastructure/llm/vultr-provider.ts`）——五个中唯一一个 `listModels` 的决定相对原计划**在实现过程中改变了**的。

- **`listModels: false`**（原计划是 `true`）：基座**总是**调用 `{baseUrl}/models`（`openai-compatible-provider.ts`，`listModels()`），而 Vultr 自己的官方参考（`api.vultrinference.com`）描述 `GET /models` 只返回 `id`/`created`/`object`/`owned_by`/`features`——**没有价格**。文档中与价格相关的端点（`GET /provider`，带 `cost`/`contextWindow`）在本次会话测试的路径上**实时返回 404**——数据不足以写出一个不冒指向错误 URL 风险的 `parseCatalogo`（"脆弱的 true"）。`GET /v1/models` 本身已确认（没有密钥时实时返回 401，两次）——只是没有价格；
- **tool calling 已用真实示例确认**：官方文档（`docs.vultr.com/how-to-use-tool-calling-with-vultr-serverless-inference`）展示了 `kimi-k2-instruct` 以 `finish_reason: "tool_calls"` 响应——纯标准 OpenAI 方言，那个示例中没有奇怪的字段；另外两个种子模型（`llama-3.3-70b-instruct-fp8`、`deepseek-r1-distill-llama-70b`）没有 tool calling 的确认——它们是 `supportsToolCalling: false`；
- **`-normalize` 后缀**：最初的调研指向一个有文档的规范化代理——本次会话**无法**再次确认该文档（定向搜索在核对过的页面中没有找到这个词）。无论如何默认都不使用它（我们保留模型的原始 id）；
- **连接测试**：`GET /v1/models`，只看状态码。

:::tip Vultr 的价格是**官方**的，而且是统一费率
与 NIM 和 Bitdeer 不同，Vultr **公布**了费率——[在 Serverless Inference 的用量与成本文档中](https://docs.vultr.com/support/products/serverless/how-do-i-monitor-the-usage-and-cost-of-my-vultr-serverless-inference-subscription)："Requests are billed at $0.55 per 1,000,000 input tokens and $2.75 per 1,000,000 output tokens." 这是**服务**的费率，而不是按模型——文档不区分模型，这就是种子中三行重复同一对值（`550_000` / `2_750_000` micros）的原因。

之前那里的估算错在危险的方向：三个模型中有两个的**输出**价是 `400_000`，而真实值是 `2_750_000`。计量把输出成本低估了将近 7 倍——而输出正是写代码的 agent 账单的主要部分。

`manual_pricing` 仍然是 `true`，这并不矛盾：这个开关的意思是"价格是由一个人阅读文档后输入的，而不是来自同步"（`apps/api/src/db/schema.ts`）。改变的是，这个数字现在来自 provider 本身，而不是市场比较。
:::

真实凭据的验收测试位于 `test/infrastructure/llm/vultr-provider.smoke.spec.ts`，以 `VULTR_TEST_KEY` 为条件。

## Hub 与真实成本

在 **hub**（OpenRouter）中，出现在调用中的是 hub，但产生成本的是实际提供服务的 provider。计量会把两者都记录下来：

- `ChatUsageChunk.upstreamProvider`——当 hub 提供该信息时，由 provider 填写；
- `token_usage.upstream_provider`——自由文本，**可为空**。它不是 enum：这个集合属于 hub，会不经通知地变化，不该由我们来维护版本。`null` 意味着"不是来自 hub，或者 hub 没有提供"；
- 指标 `brabo_llm_tokens_total` 和 `brabo_llm_cost_micros_total` 增加了 `upstream_provider` 标签，执行仪表盘有一个按底层 provider 显示成本的面板。没有 hub 时，标签重复 provider 本身——如果标签为空，`sum by (upstream_provider)` 只会显示经过 hub 的部分，让其余部分看起来没有任何成本。

从帧中读取该字段是基座中的一个**配置 hook**（`extrairUpstreamProvider`），而不是解析中的一个 `if`：每个 hub 把这个信息放在不同的地方，而本阶段的规则是 provider 的特殊性要变成配置。

`models.manual_pricing` 标记一个根据 provider 文档输入、而不是同步得到的价格。目录同步在没有显式决定的情况下**不会覆盖**被标记行的价格——而当远程目录不提供价格时，保存的值会被保留而不是清零：缺失的字段意味着"provider 没说"，绝不意味着"免费"。

### 示例：同一个模型，hub × 直连

Fase 11a 的承诺（"'同一模型经由 hub'与'直连'之间的可比成本是可查询的"）只有在**同一个**模型出现在两边时才会成为真正的用途——如今任何 OpenAI/Anthropic 发布且同时在 OpenRouter 目录中的模型都是如此（例如 GPT-4o）：

```promql
# Razão de custo: servido via OpenRouter vs. servido direto pela OpenAI,
# no mesmo período. > 1 quer dizer que o hub saiu mais caro que o direto.
sum(rate(brabo_llm_cost_micros_total{provider="openrouter", upstream_provider="openai"}[1h]))
  /
sum(rate(brabo_llm_cost_micros_total{provider="openai"}[1h]))
```

这是 `upstream_provider` 所提供的挂钩——目前没有自动的消费方。预期的用法（记录为种子想法，尚未实现）是心理学家有一天根据同一个指标建议"这个模型直连比经由 hub 更便宜"。

## 契约套件

`apps/api/test/contract/llm-provider.contract.ts` 针对任何实现运行同一组测试，就像 git 套件自 Fase 2 起所做的那样。分工才是重点：**契约拥有断言，测试框架拥有方言。**

新的 provider 只需要编写测试框架——把每个场景翻译成自己的线路格式——就能继承以下测试：分帧断开的流、有和没有 usage、tool calling、四种错误以及沉默的服务器。假服务器是临时端口上一个真正的 `node:http`，而不是 `fetch` 的 mock：被测的恰恰是 socket 的行为。

## tool calling 与 engine 的救援

engine 的 `ToolCallRecovery`（ADR 0020）会恢复小模型用散文写出、而不是使用 `tools` 字段的调用。它是**救援，而不是许可**：它依赖模型碰巧写对格式，写不对时就沉默地失败。因此，把一个没有原生 tool calling 的模型绑定到 agent 会在领域中被拒绝，而不只是不被鼓励。
