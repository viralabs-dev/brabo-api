---
traducao_de: 630991643540998cb86812005eeb468f94a1b9c0
id: artifacts
title: 工件
sidebar_position: 4
description: 在 engine 中校验的十二种工件 schema，谁可以发出每一种，以及为什么大多数不能由模型发出。
keywords: [artifact, schema, emit_artifact, qa_verdict, business_rule, decision_record]
---

# 工件

工件是 agent 的**结构化且经过校验的**输出。具体来说：
日志中的一个 `artifact.<tipo>` 事件，其 payload 在写入之前已针对一个封闭的 schema 完成校验。

不存在工件表。校验只发生在一个地方——
`Engine.Harness.ArtifactSchemas`——缺少必填字段会**拒绝这次发出**，而不是写入一个只有一半的工件。

## 谁可以发出什么

这是本页最重要的区分，也很容易被忽略：

| 来源 | 含义 |
|---|---|
| **工具** | 模型决定发出，调用 `emit_artifact` |
| **服务器** | 结果发生时由代码发出；模型不做选择 |

**只有三种类型可以通过工具发出：** `note`、`business_rule` 和
`decision_record`。其余全部由服务器发出。

所有情况下的理由都一样：当工件是**某个结果的记录**时，让模型选择是否发出它，就等于允许它省略。一个放弃的 DevAgent 不应该能够决定不记录自己放弃了。

**会话类型不过滤任何工件。** [RN-097](../business-rules/api.md#rn-097)
给会话加了 `kind`（`consultiva` | `criativa`），并在事件追加处加了一道守卫，但它只覆盖**一种**类型——`execution.activated`——而没有任何工件是它。咨询型会话照样写入 `artifact.business_rule`：它不做的只是进入执行。看到类型规则的人往往会以为相反，而这里的错误假设会抹掉一整段对话的记录。

**会话的状态按行动者过滤。** 自 [RN-581](../business-rules/api.md#rn-581)
起，`closed`/`closed_abnormally` 的会话以 409 拒绝对话，而“对话”包括所有行动者为对话型 agent 的事件——因此来自创意、PO、架构师、Dev Lead、UX Designer、Staff 或 Infra Lead 的 `artifact.*` 不再进入已关闭的会话，而心理学家发出的同类工件——它运行在已关闭的会话**之上**——可以进入。决定的从来不是类型，而是行动者。

## schema

### `note` — 工具

| 字段 | 必填 |
|---|---|
| `title` | ✅ |
| `body` | ✅ |

### `business_rule` — 工具

| 字段 | 必填 |
|---|---|
| `title` | ✅ |
| `description` | ✅ |
| `origin` | ✅ — **非空列表** |

`origin` 引用产生该规则的对话事件。空列表会被拒绝：它是规则追溯到其被陈述之处的依据，没有它，规则就变成没有出处的断言。

:::caution 模型必须**知道**字段名
`emit_artifact` 工具的描述由这些 schema 生成
（`ArtifactSchemas.required/1`），并用英文点名每个必填字段，附带一个填好的示例。

这不是吹毛求疵：之前的描述只说“发出一个有类型的工件”并列出类型。在一次真实执行中，模型——用葡萄牙语对话——猜了 `titulo`/`descricao`/`comportamento`，那次对话的**四条业务规则被静默拒绝**。`origin` 用自由文本同样会被拒绝：它必须是列表，描述里把这一点写得清清楚楚（[RN-061](../business-rules/engine.md#rn-061)）。
:::

### `decision_record` — 工具

| 字段 | 必填 |
|---|---|
| `context` | ✅ |
| `options` | ✅ — 列表 |
| `choice` | ✅ |
| `consequences` | ✅ |

六个对话型 agent 中任何一个都可以发出的“精简 ADR”——
创意、PO、架构师、Dev Lead、UX Designer 和 Staff 都带有此类型的 `emit_artifact`
（[RN-505](../business-rules/engine.md#rn-505)）。故意不做字段间校验：`choice` 不必与某个
`options` 字面一致——自由文本更稳健，通用 schema 只检查键是否存在，与 `note`/`business_rule` 同一标准。

它复用**通用**模式，而不是专用模式
（`artifact.project_image`/`artifact.c4_diagram`，有版本、自有 TS schema、自有 HTTP 路由）：决策本质上是 append-only 的，而不是一个被替换的“现行”值。它刻意区别于 `open_adr_pr`
（仅限架构师，在 `docs/adr/*.md` 中提交真实文件并开一个必须人工批准的真实 PR）——两者并存，服务于不同规模的决策：`decision_record` 无摩擦、可在会话日志中搜索，适用于任何相关决策；`open_adr_pr` 用于决策大到值得成为仓库中真实文档的时候。

### `open_question` — 专用工具

| 字段 | 必填 |
|---|---|
| `questionId` | ✅ — uuid，由工具生成 |
| `pergunta` | ✅ — 最多 500 个字符 |
| `afeta` | ✅ — `{regras, historias, tarefas}`，id 列表 |
| `sugestao` | 可选 — 最多 300 个字符 |

agent 留给用户的一个疑问（ADR 0214，
[RN-862](../business-rules/engine.md#rn-862)）。不能通过 `emit_artifact` 发出：
只有创意、PO、架构师和 Dev Lead 通过专用工具 `declare_open_question` 发出它，该工具还会写入 `autor` 和 `sessionId`。api 用 `open_question.answered` 关闭它。

### `product_brief` — 服务器

| 字段 | 必填 |
|---|---|
| `title` | ✅ |
| `summary` | ✅ |
| `rules` | ✅ |

可校验，但**不能**通过工具发出。创意的服务器只在你确认就绪之后才发出它——绝不通过模型的工具调用。

自 [ADR 0185](../adr/0185-estou-pronto-fecha-os-dois-gates.md) 起，请求它的那次点击——“我准备好了——需求已验证”——还会写入 `necessity.validated`，其 `productBriefId: null`：brief 是那次 `readiness.confirmed` 之后的下一个 `product_brief`，把它带给 PO 的 handoff 以点击者的名义被接受
（[RN-657](../business-rules/api.md#rn-657)、[RN-658](../business-rules/api.md#rn-658)）。

### `task_blocked` — 服务器

| 字段 | 必填 |
|---|---|
| `taskId` | ✅ |
| `agentId` | ✅ |
| `reason` | ✅ |
| `diagnosis` | ✅ |

当 DevAgent 放弃任务时发出：测试套件无法通过、迭代上限、预算超支，或无信号的停止。它是结果的记录。

### `qa_verdict` 和 `secops_verdict` — 服务器

| 字段 | 必填 |
|---|---|
| `veredito` | ✅ — `approved`、`changes_requested` 或 `needs_user_decision`（[RN-862](../business-rules/engine.md#rn-862)），别无其他 |
| `resumo` | ✅ |
| `itens` | ✅ |
| `taskId` **或** `prActionId` | ✅ — 恰好一个 |
| `coverageMatrix` | 可选，仅 QA |

这里还有三项额外校验：

**裁定是封闭的**，取值与 api 的 gate 状态机相同。超出范围的值会让用例在后面崩溃——在发出时拒绝工件才是正确的失败位置。

**主体是互斥的。** 一个裁定针对**一个** dev 任务
（`taskId`）或**一个** infra PR（`prActionId`）——绝不两者都有，也绝不两者皆无。同一工件类型，不同消费者。

**`coverageMatrix` 故意是可选的。** 没有覆盖矩阵的 QA 裁定仍是有效裁定；因为缺一个字段而丢掉整个裁定，比写入一个不完整的裁定更糟。

SecOps 是确定性的——没有 LLM。QA 裁定来自 `emit_qa_verdict` 工具，单独计费。两种情况下模型都不选择是否发出。

### `infra_delegation_files` — 服务器

| 字段 | 必填 |
|---|---|
| `files` | ✅ — **非空**列表 |
| `summary` | ✅ |

Infra 领域**一个**被委派者的结果（Fase 8c，ADR 0038）——lead 本身
（Dockerfile/compose）或 Workflows 子 agent（CI 流水线）。
`InfraLeadServer` 在每个被委派者结束后发出它，只是为了在 `delegations` 表中有一个可引用的 `parecer_artifact_id`——从领域外永远看不到。api 看到的是合并后的 PR，经由 `open_infra_pr`（一贯的同一机制，Fase 8c 未改动）。

`files` 为空会被拒绝，理由与 `InfraGateRunner` 中的 `nada_a_validar/1` 相同（ADR 0021）：一个没有任何文件的被委派者什么也没完成，“空”绝不能冒充“完成”。

### `prototipo_navegavel` — 工具（`propose_prototype`，不是 `emit_artifact`）

| 字段 | 必填 |
|---|---|
| `personas` | ✅ — **非空**列表 |
| `jornadas` | ✅ — **非空**列表 |
| `prototipo` | ✅ — `telas` 非空 |
| `resumo` | ✅ |

UX Designer 产出的原型（ADR 0087），基于创意的
`necessidade-de-negocio`。它不是 `note`/`business_rule`——UX
Designer 通过 `propose_prototype` 发出，这是一个**专用**工具
（`Engine.Agents.UxDesignerTools`），本模块只校验**形式**，与 `product_brief` 同一机制：在这里可校验，却不在可通过 `emit_artifact` 发出的类型列表中。

`personas`/`jornadas` 为空，或 `prototipo` 没有任何页面，会按与 `business_rule.origin` 相同的规则被拒绝（见上方 `business_rule` 表格）：没有内容的工件不值得记录。成功的 `propose_prototype` 会结束本轮（与 `propose_execution_plan`/`propose_infra_pr` 同理）——没有 `proposed_action`，没有挂起：提出原型没有外部效果。

### `plano_de_teste` — 服务器

| 字段 | 必填 |
|---|---|
| `storyId` | ✅ |
| `taskId` | ✅ — 自 [ADR 0192](../adr/0192-plano-de-teste-depois-da-entrega.md) 起 |
| `planoDeTeste` | ✅ |
| `criteriosExecutaveis` | ✅ — **非空**列表 |
| `estrategiaDeAutomacao` | ✅ |

QA 策略的交付物（ADR 0090；`docs/fluxo.yml`，角色
`qa-estrategia`，`qa-lead` 的第二个时刻）。自
[ADR 0192](../adr/0192-plano-de-teste-depois-da-entrega.md)
（[RN-674](../business-rules/engine.md#rn-674)）起，它是**一个**任务的**交付**测试计划，在 dev agent 交付**之后**编写，基于 dev 的 worktree 和交付所触及的文件：它是 `qa-verificada` 周期的第一步
（`QaLeadServer.run_area/3`），作为**输入**被自动化子专业消费，并在修正轮中按 `taskId` 重新找到。在 ADR 0192 之前，它在 dev **之前**发出，并为 gate `implementavel` 提供输入。它来自
`emit_plano_de_teste`，但模型并不直接发出工件——
`Engine.Gates.QaEstrategiaAgent` 从工具调用中提取结果并调用 `ArtifactEmitter.emit/5`，与 `qa_verdict`/`task_blocked` 同一模式。

`criteriosExecutaveis` 为空会被拒绝，理由与
`infra_delegation_files` 相同：没有任何标准的计划不是计划。

### `threat_model` — 服务器

| 字段 | 必填 |
|---|---|
| `storyId` | ✅ |
| `threatModel` | ✅ |
| `requisitosDeSeguranca` | ✅ |

SecOps 的“第二个时刻”（RN-360，ADR 0090）——在代码存在之前，针对一个故事的**设计**做的 STRIDE-lite 检查清单，与 `qa-estrategia` 的第二时刻同一模式。`Engine.Gates.SecOpsAgentServer.run_design/2`
在 `Engine.Gates.AppSecAgent.run/3`（没有 `Terminal`，没有
`Diff`/`Scanner`/`DevAgentState`）以 `emit_threat_model` 结束循环之后发出——模型不选择发出，循环结束时由服务器发出。

`riscos` 不在必填字段中：空列表是有效回答（并非每个故事都带有剩余风险），而且工具已保证**键**存在——没有“遗忘”需要与“没有”区分。

工件总会被写入，但带走它的 **handoff** 不一定：自
[RN-636](../business-rules/engine.md#rn-636) 起，AppSec 只向没有待处理报价且在项目中未激活的目标
（`arquiteto`、`dev-lead`、`infra`）提供它。第二个故事的威胁模型留在日志中，没有自己的报价——第一个仍待处理的报价不会被替换
（[ADR 0182](../adr/0182-ciclo-de-vida-do-handoff.md)）。

## 不经过这里的工件

有些 `artifact.*` 事件类型存在于日志中，却不在此注册表里，因为它们由 **api** 而非 engine 发出：

| 事件 | 来源 |
|---|---|
| `artifact.module_map` | 架构师，经由 api 中的用例——每个模块可以携带 `resources`（cpus、memoryMb、pidsLimit），Infra 以它们的**总和**启动容器（[ADR 0199](../adr/0199-recurso-minimo-derivado-do-module-map.md)、[RN-683](../business-rules/api.md#rn-683)） |
| `artifact.insight` | 分析，经由 api 中的用例 |
| `artifact.project_image` | 架构师，经由 api 中的用例（[ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)、[RN-105](../business-rules/api.md#rn-105)） |
| `artifact.module_routing` | 架构师，经由 api 中的用例——现行 `module_map` 的每个模块一个候选镜像；架构师**提名**，Infra 在后续步骤中**选定**（[ADR 0131](../adr/0131-roteamento-de-modulos-para-infra.md)、[RN-487](../business-rules/api.md#rn-487)） |
| `artifact.module_contracts` | 架构师，经由 api 中的用例——按现行 `module_map` 的模块，列出它**暴露**的内容；dev agent 通过 `listar_contratos_de_modulos` 读取，而不是读其他模块的 worktree（[ADR 0200](../adr/0200-contrato-entre-modulos-artefato-do-arquiteto.md)、[RN-684](../business-rules/api.md#rn-684)） |

它们在 api 的领域中有自己的校验。这种不对称是历史原因，并已登记为
[技术债](../architecture.md#divida-tecnica)：理想情况是所有
`artifact.*` 都经过同一个注册表。

## 校验失败时

| 错误 | 原因 |
|---|---|
| `{:unknown_type, tipo}` | 类型不在十二种之内 |
| `{:missing_keys, [...]}` | 缺少必填字段，全部点名 |
| `:origem_invalida` | `business_rule.origin` 为空或不是列表 |
| `{:sujeito_invalido, chaves}` | 裁定同时有两个主体，或一个都没有 |
| `{:veredito_invalido, valor}` | 裁定不在 `approved` / `changes_requested` / `needs_user_decision` 之内 |
| `:invalid_payload` | payload 不是 map |

失败会作为工具结果返回给 agent。发出格式错误工件的模型会收到错误并可以修正——在 ToolLoop 的迭代上限之内。
