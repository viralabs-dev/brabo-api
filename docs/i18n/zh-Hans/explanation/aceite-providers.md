---
traducao_de: 17fe83498b0a1eea177367926431ffddda3ce9ff
id: aceite-providers
title: 使用真实凭据对 LLM provider 进行验收
sidebar_label: provider 的验收
sidebar_position: 6
description: 一份活文档，追踪哪些 provider smoke 已经针对真实 key 运行过、花了多少钱，以及每一个证明了 mock 证明不了的什么。
keywords: [providers, LLM, smoke, 验收, Fase 11, ADR 0043, 凭据]
---

# 使用真实凭据对 LLM provider 进行验收

[ADR 0043](../adr/0043-seis-providers-de-llm-e-o-fechamento-da-fase-9b.md) 交付了九个 provider，契约
测试套件全绿——**针对 mock**。它自己在“留待以后”中记录了：六个 smoke 使用真实凭据的验收仍未完成。
本文件就是追踪这个“以后”的地方：每个 provider 一行，**每次出现一个 key 时**都更新。ADR 不作编辑；
它是决策的记录，这里是证明的记录。

本项目的金科玉律在这里完全适用：能力只有在被证明后才被声明。在一个 smoke 针对真实 key 运行之前，
关于该 provider 存在的只是对官方文档的阅读——很好，在阶段 11 中逐行核对过，但仍然不是执行。

## 2026-09-25 的状态——在 `user`/`tool` 之后的 `system` 消息（AT-161） {#estado-em-2026-09-25--mensagem-system-depois-de-usertool-at-161}

另一个维度，同一把尺子。契约测试套件现在证明了每个适配器把一条在 `user` 或 `tool` **之后**到达的
`role: "system"` 放在哪里（在八个中放在 `messages` 的末尾；在 Anthropic 中提升到顶部的 `system`——见
[分歧表](../reference/llm-providers.md#a-system-message-at-the-end-of-the-conversation-at-161)）。
provider 是否**接受**这样的请求体，是 `sistema-tardio.smoke.spec.ts` 所问的，而只有真实调用能回答：

```bash
OLLAMA_SISTEMA_TARDIO_SMOKE=1 pnpm --filter api exec vitest run test/infrastructure/llm/sistema-tardio
# providers de nuvem: exporte a mesma *_TEST_KEY dos smokes de aceite (ANTHROPIC_TEST_KEY para o Anthropic)
```

| provider | 真实 provider 接受迟到的 `system` 吗？ | 方式 |
|---|---|---|
| Ollama | ✅ **是**，在 `user` 之后和在 `tool` 之后都接受 | 本地 daemon 0.32.15，`qwen2.5-coder:7b`；两个回合都以文本结束，没有错误 chunk |
| Anthropic | ❌ 未证明 | 缺少 `ANTHROPIC_TEST_KEY`——而且它发送的请求体无论如何都没有迟到的 `system`（被提升了） |
| OpenAI | ❌ 未证明 | 缺少 `OPENAI_TEST_KEY` |
| OpenRouter | ❌ 未证明 | 本环境缺少 `OPENROUTER_TEST_KEY`；在 hub 中，响应取决于上游，因此一轮只能证明为它提供服务的那个上游 |
| NVIDIA NIM | ❌ 未证明 | 缺少 `NVIDIA_NIM_TEST_KEY` |
| Together AI | ❌ 未证明 | 缺少 `TOGETHER_TEST_KEY` |
| DeepInfra | ❌ 未证明 | 缺少 `DEEPINFRA_TEST_KEY` |
| Bitdeer | ❌ 未证明 | 缺少 `BITDEER_TEST_KEY` |
| Vultr | ❌ 未证明 | 缺少 `VULTR_TEST_KEY` |

smoke 只证明**接受**（回合以文本结束，没有错误 chunk）。模型是否**遵从**这个指引是质量问题，属于
AT-082。

## 2026-08-14 的状态——embedding 能力（ADR 0075） {#estado-em-2026-08-14--a-capability-de-embedding-adr-0075}

这个列表中的**新**维度。到此为止，“验收”指的是**聊天**脚本；
[ADR 0075](../adr/0075-embeddings-no-contrato-de-llm-provider.md) 把 `embed` 加入了契约，同一把尺子
适用：**只有有执行证明时，能力才是 `true`**。

**Ollama 已关闭**，而且是唯一一个。针对真实的本地 daemon（0.32.1）运行，模型当场拉取：

```bash
docker exec brabo-dev-ollama-1 ollama pull nomic-embed-text
OLLAMA_EMBEDDING_SMOKE=1 pnpm --filter api test ollama-provider.embeddings
```

| 内容 | 结果 |
|---|---|
| `POST /api/embed`，2 个输入 | 2 个向量，每个 **768** 维 |
| `prompt_eval_count` | **10**——`estimated: false`，来自 daemon |
| 同一 daemon 的 `/api/tags` | `nomic-embed-text` 带 `capabilities: ["embedding"]` 和 `embedding_length: 768`；`llama3.2:1b` 带 `["completion","tools"]` |
| 聊天模型请求 embedding | **`501`**——“This server does not support embeddings” |

`501` 是最有价值的发现，它在两个层面都变成了测试：这是能力的**模型**层在尽可能晚的地方失败，也是
`assertCanEmbed` 提前拒绝的原因（[RN-190](../business-rules/api.md#rn-190)）。实际成本：
**US$ 0,00**——本地模型没有价格，因此这是本页唯一可以随意重复的验收。

| provider | `embeddings` | 运行了？ | 原因 |
|---|---|---|---|
| Ollama | ✅ **是** | ✅ 是 | 本地 daemon，没有 key，没有成本 |
| Anthropic | ❌ 否 | — | **没有**自己的 embedding 端点；文档指向一个第三方，那是另一个 provider，有另一个 key 和另一种方言 |
| OpenAI | ❌ 否 | ❌ 跳过 | 缺少 `OPENAI_TEST_KEY` |
| OpenRouter | ❌ 否 | ❌ 跳过 | 有 key，但运行的 smoke 是**聊天**的——在 hub 中，embedding 会路由到不同的提供方，一个端点的证明不是另一个端点的证明 |
| Together AI | ❌ 否 | ❌ 跳过 | 缺少 `TOGETHER_TEST_KEY` |
| DeepInfra | ❌ 否 | ❌ 跳过 | 缺少 `DEEPINFRA_TEST_KEY` |
| NVIDIA NIM | ❌ 否 | ❌ 跳过 | 缺少 `NVIDIA_NIM_TEST_KEY` |
| Bitdeer | ❌ 否 | ❌ 跳过 | 缺少 `BITDEER_TEST_KEY`——颇具讽刺，因为他们的 embedding 文档是阶段 11b 找到的唯一经认证的来源 |
| Vultr | ❌ 否 | ❌ 跳过 | 缺少 `VULTR_TEST_KEY` |

**在**没有任何凭据的情况下**已经**证明的是**方言**：契约测试套件在开启该能力的 OpenAI 兼容基础上
第二次运行，覆盖按 `index` 排序、读取 `usage.prompt_tokens`、拒绝不完整的批次以及按 `code` 归一化的
错误。当 key 存在时，把一个 provider 改为 `true` 只需修改字面量中的一行并运行 smoke——而不用编写
解析代码。

## 2026-08-07 的状态 {#estado-em-2026-08-07}

这个列表中第一次付费执行。**OpenRouter 已关闭**；另外五个因缺少 key 仍被跳过——环境中任何地方都
没有它们的凭据，产品只登记了 OpenRouter 的（与 hello-limpo 执行中使用的相同）。

| provider | 运行了？ | 结果 |
|---|---|---|
| OpenRouter | ✅ **是** | 完整脚本通过，一次付费调用 |
| Together AI | ❌ 跳过 | 缺少 `TOGETHER_TEST_KEY` |
| DeepInfra | ❌ 跳过 | 缺少 `DEEPINFRA_TEST_KEY` |
| NVIDIA NIM | ❌ 跳过 | 缺少 `NVIDIA_NIM_TEST_KEY` |
| Bitdeer | ❌ 跳过 | 缺少 `BITDEER_TEST_KEY` |
| Vultr | ❌ 跳过 | 缺少 `VULTR_TEST_KEY` |

**实际成本，从测试数据库的 `token_usage` 读取：**

| provider | 模型 | in | out | `cost_micros` | 冻结的价格 | `estimated` |
|---|---|---|---|---|---|---|
| openrouter | `openai/gpt-4o-mini` | 20 | 3 | **5** | 150.000 /百万 | `false` |

五个微美元——**US$ 0,000005**，比下文“< US$ 0,001”的估算低两个数量级。这里重要的是
`estimated: false`：用量来自 provider，而不是本地估算器，而记录的价格是使用时刻冻结的价格
（[RN-044](../business-rules/api.md#rn-044)）——而不是今天 `models` 表中的价格。

### smoke 在路上发现了什么 {#o-que-o-smoke-encontrou-no-caminho}

它**从未运行过**，因此已经悄无声息地相对
[ADR 0049](../adr/0049-curadoria-de-modelo-por-workspace.md) 腐烂了，后者把策展从 `models.is_active`
移到了 `workspace_models`：

- 它在全局目录上断言 `alvo.isActive === false`——这个字段已不存在，得到的是 `undefined`。
  [RN-043](../business-rules/api.md#rn-043) 如今正确的断言是 `workspaceModels.isActive(...)`，
  因为**没有行就是关闭**；
- 它用旧的签名组装 `SetModelsActiveUseCase` 和 `SetModelBindingUseCase`，没有
  `workspaceId`/`curatedBy`，也没有策展的仓库。

这些都无法被 CI 发现：没有 key 时，`describe.skipIf` 会跳过整个文件，而 api 的类型检查基于
`tsconfig.build.json` 运行，它排除了 `test/`。**一个从不运行的验收不是验收**——这正是让阶段 10 的
表格停留在“未测量”的同一个机制，教训在这里同样适用。

随执行一起修正：smoke 现在通过 ADR 0049 的路径断言 RN-043。当其他五个 key 存在时，剩下的五个 smoke
很可能以同样的方式、出于同样的原因已经腐烂了。

## 2026-08-03 的状态 {#estado-em-2026-08-03}

这一天对环境的扫描：六个变量**一个都**没有导出，`.env` 中也没有以其他名称存放的 provider key。没有
该变量时，`describe.skipIf(!apiKey)` 会带着警告跳过整个测试套件——这是正确的行为，而不是失败。没有
进行任何付费调用；这一轮的成本是 **US$ 0,00**。

| provider | smoke | 变量 | 默认模型 | 运行了？ | 原因 | 实际成本（`token_usage`） |
|---|---|---|---|---|---|---|
| OpenRouter | `openrouter-provider.smoke.spec.ts` | `OPENROUTER_TEST_KEY` | `openai/gpt-4o-mini` | ❌ 跳过 | 环境中缺少 key | — |
| Together AI | `together-provider.smoke.spec.ts` | `TOGETHER_TEST_KEY` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | ❌ 跳过 | 环境中缺少 key | — |
| DeepInfra | `deepinfra-provider.smoke.spec.ts` | `DEEPINFRA_TEST_KEY` | `deepseek-ai/DeepSeek-V3` | ❌ 跳过 | 环境中缺少 key | — |
| NVIDIA NIM | `nvidia-nim-provider.smoke.spec.ts` | `NVIDIA_NIM_TEST_KEY` | `meta/llama-3.2-3b-instruct` | ❌ 跳过 | 环境中缺少 key | — |
| Bitdeer | `bitdeer-provider.smoke.spec.ts` | `BITDEER_TEST_KEY` | `moonshotai/Kimi-K2.5` | ❌ 跳过 | 环境中缺少 key | — |
| Vultr | `vultr-provider.smoke.spec.ts` | `VULTR_TEST_KEY` | `kimi-k2-instruct` | ❌ 跳过 | 环境中缺少 key | — |

这些文件位于 `apps/api/test/infrastructure/llm/`。默认模型可以通过 `<PROVIDER>_TEST_MODEL` 覆盖——
在账户无权访问该列中的模型时很有用。

## 关闭每一行要花多少钱 {#quanto-custa-fechar-cada-linha}

刻意做得便宜。每个 smoke **恰好做一个聊天回合**，prompt 为
`Responda só a palavra "ok", sem mais nada.`——大约 20 个输入 token 和少量输出。脚本中的其他一切都是
免费的：凭据校验是只看状态的 `GET /v1/models`（或 `GET /key`），而目录同步（在三个具有
`listModels: true` 的 provider 中）是读取操作。

| | 付费调用 | 免费调用 | 数量级 |
|---|---|---|---|
| 每个 smoke | 1 个聊天回合（约 20 token 输入） | 连接测试 + 同步 | **< US$ 0,001** |
| 六个合计 | 6 个聊天回合 | — | **< US$ 0,01** |

即使用表中最贵的模型，每次执行也不到一美分。花钱的不是 token：而是拥有 key。

## 每个 smoke 证明了什么——而且并非对每个都一样 {#o-que-cada-smoke-prova--e-não-é-o-mesmo-para-todos}

划分依据是能力，正如 ADR 0041 所设计的：

**有 `listModels: true` 的——OpenRouter、Together、DeepInfra。** 同步会访问真实的 API 并填充目录。
**真实价格**就在这里与解析器相遇。最重要的情形是 Together：ADR 0043 记录了价格的单位（每百万 token 的
USD 还是每 token）是通过与市场价格比较**推断**出来的，因为官方文档没有声明——而 smoke 恰恰为此有一个
合理性区间（`inputPricePerMillionMicros` 在 10.000 和 1.000.000.000 之间；超出范围时，诊断是“单位
错误”，而不是“模型昂贵”）。如果哪天出了错，那是要在解析器和这里修正的发现，绝不能被压下。smoke 还
确认了 RN-043：发现的模型以**停用**状态进入，激活是手动策展。

**有 `listModels: false` 的——NVIDIA NIM、Bitdeer、Vultr。** 三者都没有在可访问的文档中公布每
token 的价格（NIM 甚至不按 token 收费：商业单位是 GPU/小时）。因此同步**必须跳过**，返回
`pulado: 'sem_capability'`——而 smoke 正是断言这一点，这让声明的能力变得可验证，而不是被信任。模型
通过 seed / 手动策展进入，带 `manual_pricing = true`，smoke 真正校验的是对照真实 API 的**模型 id**——
如今是从文档读来的估计——以及带冻结价格的端到端计量路径。

在六个 provider 中，步骤 **1b** 都通过 `TestStoredCredentialUseCase` 针对真实 API 校验真实的 key——
五个返回 `ok`，DeepInfra 返回 `nao_suportado`，它是唯一没有声明测试端点的。在
[ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md) 之前，这项证明内嵌在登记中；
它没有消失，而是换了位置并变得显式。

在六个 provider 中，最后一步都一样，也是产品关心的：一个完整的聊天会话，没有 `error` 或
`metering_failed` 事件，并在 `token_usage` 中有一行带着使用时刻**冻结**的价格
（[RN-044](../business-rules/api.md#rn-044)）——而不是今天 `models` 表中的价格。

## 如何关闭一个待办 {#como-fechar-uma-pendência}

```bash
export OPENROUTER_TEST_KEY=...          # a variável do provider em questão
# opcional, se a conta não tiver o modelo default:
# export OPENROUTER_TEST_MODEL=...

pnpm --filter api test -- openrouter-provider.smoke.spec.ts
```

要求：

- 测试数据库处于运行状态——`TEST_DATABASE_URL`，默认
  `postgres://brabo:brabo@localhost:5432/brabo_test`（与 api 的任何集成测试相同；smoke 在开始前会调用
  `truncateAll`）；
- provider 账户中有余额。自
  [ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md) 起，登记不测试任何东西——
  校验 key 的是 smoke 的步骤 1b（`TestStoredCredentialUseCase`，只看状态），而一个有效但没有余额的
  key 只会在聊天回合时才真正失败。

运行之后，**更新上表中的那一行**，写上日期、裁决和实际成本。成本来自数据库，而不是估算：

```sql
SELECT provider, model_name, input_tokens, output_tokens, cost_micros
FROM token_usage ORDER BY created_at DESC LIMIT 1;
```

如果 smoke 失败，该行变为 `❌ reprovado` 并附上原因，而发现会变成 provider 中的修正——绝不是基于信任
声明的能力。

## 为什么这是一份活文档 {#por-que-isto-é-um-documento-vivo}

这张表不是某个日期的报告：它是验收的当前状态。每出现一个 key 就关闭一行，其他的保持开放、可见。本文件
存在要避免的失败模式是阶段 10 的那种，描述在
[第一次 dogfooding 的收获](./primeiro-dogfooding.md) 中：一张没人填写、永远变成 `não medido` 的观察表。
在这里，数字通过查询来自 `token_usage`，没有运行的就写明没有运行。
