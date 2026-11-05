---
traducao_de: c51acb4a5b495be1be6f3e263783d9fd5ad91911
id: git-providers
title: git provider
sidebar_position: 5
description: 让 Local、GitHub 和 GitLab 可以互换的十五个操作的契约，包括 capability、规范化错误和重试策略。
keywords: [git, GitProvider, GitHub, GitLab, capabilities, retry]
---

# git provider

Brabo 工作在一个真实的 git 仓库之上，有三个后端承担这一角色：**Local**（磁盘上的 bare 仓库）、**GitHub** 和
**GitLab**。领域代码不知道正在使用哪一个——它只与一个统一的契约对话。

相关决策见 ADR [0001](../adr/0001-git-provider-contract-shape.md) 至
[0005](../adr/0005-repo-bootstrap-idempotent-steps.md) 以及
[0028](../adr/0028-protecao-de-branch-divergencia-entre-providers.md)。

## 契约

`GitProviderContract`，位于 `packages/shared/src/index.ts`。契约有**十五个操作**——
第十个在 Fase 4a 随 PR 的 gate 加入；第 11 和第 12 个在 FASE 26 随代码标签页（只读）加入；第 13、14、15 个在 FASE 26b 加入，作为同一标签页已声明待办事项的基础（blame、可浏览的 PR、丰富的 branch——尚无消费它们的界面）：

| 操作 | 返回 |
|---|---|
| `createRepo` | `GitRepo` |
| `getRepo` | `GitRepo` |
| `createBranch` | `GitBranch` |
| `protectBranch` | — |
| `listBranches` | `GitBranch[]` |
| `commitFiles` | `GitCommitResult` |
| `getFileContent` | `string \| null` — 文件（或 branch）不存在时为 `null` |
| `openPullRequest` | `GitPullRequest` |
| `mergePullRequest` | `GitPullRequest` — 已合并的 PR 会被拒绝（`local` 中为 `GitPullRequestAlreadyMergedError`；GitHub 自己拒绝重复合并），[RN-663](../business-rules/api.md#rn-663)。在 `local` 中是真正的合并：目标是祖先时快进，否则生成一个有两个父提交的合并提交；冲突抛出 `GitMergeConflictError`（列出文件，目标 ref 不变，PR 保持打开，HTTP 409 `merge_conflict`）。GitHub/GitLab 通过自身 API 拒绝有冲突的合并，不做转换，[RN-704](../business-rules/api.md#rn-704) |
| `commentOnPullRequest` | —（PR 上的 QA/SecOps 裁定） |
| `listTree` | `GitTree \| null` — ref 或路径不存在时为 `null` |
| `getPullRequestDiff` | `GitPullRequestDiff \| null` — PR 不存在时为 `null` |
| `blame` | `GitBlame \| null` — 文件（或 ref）不存在时为 `null` |
| `listPullRequests` | `GitPullRequestList` — 每个 PR 的摘要，而非 `GitPullRequest[]` |
| `listBranchesDetailed` | `GitBranchDetailList` — 每个 branch 的 `ahead`/`behind`/关联 PR |

另有两个字段：`name` 和 `capabilities`。

### 两个读取操作（FASE 26）

`listTree` 列出树的**一层**，绝不是整棵树：代码标签页按需浏览，而在大仓库中一次请求全部，正是该阶段禁止的流量放大器。`path` 缺省或为 `""` 即根目录；每个条目带有完整的 `path` 和 `name`（叶子名）。

`getPullRequestDiff` 把 diff 规范化为 `status`
（`added|modified|removed|renamed`）、`additions`、`deletions` 和 `patch`。
`patch` 是 `string | null`，这个区分很重要：`null` 表示**没有返回**（二进制，或 patch 对响应来说太大），而 `""` 表示“返回了但为空”。把两者合并，会让界面对一个被修改的二进制文件显示“无更改”。

两种缺失沿用 `getFileContent` 已有的词汇——`null`，而不是异常——让代码标签页以同一种方式处理“不存在”。

**上限。** 两者都会截断，并通过 `truncated: true` 告知。数字放在
`apps/api/src/domain/git/git-read-limits.ts`（每层 1000 个条目，每个 diff 300 个文件），而**不**放在 `packages/shared`，后者 100% 只有类型——在那里写一个 `export const` 能通过 `tsc`，却会在生产环境中让 api 启动失败（由 `apps/api/test/packages-shared-so-tipos.spec.ts` 守护）。

### 三个基础操作（FASE 26b — RN-110/111/112）

为代码标签页三项已声明的待办（blame、丰富的 branch 下拉框、可浏览的 PR 列表）打下的基础——每一项的界面是后续一波，由三个独立的 agent 完成。三者沿用 `getFileContent`/`listTree`/`getPullRequestDiff` 已有的缺失词汇：资源不存在时为 `null`，绝不抛异常。

`blame(ref, path)` 为每一行标注最后触及它的提交——sha、作者、日期、消息的第一行。它是**唯一**使用 GraphQL 的操作：GitHub 的 REST API 没有 blame，只有 GraphQL API 有
（`repository.object(expression:).blame(path:)`）。GitLab 使用
`RepositoryFiles.allFileBlames`；Local 使用 `git blame --porcelain`。它在
`GIT_BLAME_LINE_LIMIT`（2000 行）处截断。

`listPullRequests(state?)` 返回 `GitPullRequestSummary[]`——id、编号、标题、作者、状态、branch、`updatedAt`——**而不是** `GitPullRequest[]`，后者是**写入**类型（打开/合并），从来没有标题和作者。`local` 从 Fase 4a 的**同一个** PR 旁路存储中列出。在 `GIT_PR_LIST_LIMIT`（100，一页，无后续分页）处截断。

`listBranchesDetailed(defaultBranch)` 是一个**独立**操作，不是 `listBranches` 的扩展——原因见下方 capability 表。每个被丰富的 branch 获得 `ahead`/`behind`（相对于 `defaultBranch`，**调用方**已知并传入——再问 provider 一次就多一次调用）以及关联的打开中的 PR（如果有）。provider 无法计算时（孤立 branch、无关联的历史），两个数字都为 `null`——诚实的降级，绝不编造数字。在
`GIT_BRANCH_DETAIL_LIMIT`（30 个 branch）处截断。

### **调用**的上限与**消费**的上限（FASE 26b）

上面两个数字限制的是 provider 在**一次**调用中返回的内容。消费它们的 HTTP 接口在同一个文件中有自己的上限，回答的是另一个问题：一次客户端请求能触发多少次**调用**。`listTree` 调一次便宜，调一千次很贵。

迫使这种区分的是**代码标签页的搜索**，它**不是本契约的操作**——三个 provider 都没有它。GitHub 和 GitLab 有平台级代码搜索，语义和限制各不相同；
`LocalGitProvider` 是一个 bare 仓库，没有任何类似功能。把它声明在这里，要么是在 local 中 capability 为 `false` 的第 13 个操作（一个在某个 provider 中消失的标签页），要么是某个平台的词汇泄漏进本就为阻止这一点而存在的规范化契约。

所以它**组合在应用层**
（`application/use-cases/git/read-project-code.use-case.ts`），基于
`listTree` + `getFileContent`，带三项预算——遍历的目录、打开的文件和返回的匹配——外加一个短 TTL 缓存
（`domain/git/git-read-cache.ts`），使浏览和搜索不重复相同的调用。付费的是**工作区 owner** 的凭据
（[RN-058](../business-rules/api.md#rn-058)/[RN-082](../business-rules/api.md#rn-082)），速率限制是 provider 的——见 [RN-095](../business-rules/api.md#rn-095)
和 [ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md)。

## Capability

并非每个后端都能做所有事，这一点是**声明的**，而不是在失败时发现的：

```ts
interface GitProviderCapabilities {
  readonly protectBranch: boolean;
  readonly pullRequests: boolean;
  readonly listTree: boolean;
  readonly pullRequestDiff: boolean;
  readonly blame: boolean;
  readonly pullRequestsList: boolean;
  readonly branchesDetailed: boolean;
}
```

| provider | `protectBranch` | `pullRequests` | `listTree` | `pullRequestDiff` | `blame` | `pullRequestsList` | `branchesDetailed` |
|---|---|---|---|---|---|---|---|
| Local | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| GitHub | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| GitLab | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

FASE 26 的两个 capability 和 FASE 26b 的三个 capability 在三者中都是 `true`，因为**契约测试套件在三者上都运行了它们**——这与 ADR 0041/0042 的标准相同，也适用于 git：capability 只有在被证明之后才声明，没有证明就声明 `false` 并降级。Local 在 bare 仓库上用
`git ls-tree`/`git diff`/`git blame --porcelain`/`git rev-list --left-right
--count` 满足它们，背后没有任何平台——它是三个 provider 中唯一针对**真实** git 测试的（`local-git-provider.contract.spec.ts`）；
GitHub 和 GitLab 针对 msw 的假后端运行，真实 smoke
（`{github,gitlab}-provider.smoke.spec.ts`）在环境中没有
`GITHUB_TEST_TOKEN`/`GITLAB_TEST_TOKEN` 时仍被跳过——与 FASE 13a 中已为 LLM provider 记录的情况相同。

`pullRequestsList` 值得单独一提：最初的假设是 `local` 没有 PR，“单一仓库的概念没有 PR”——这个假设站不住。Fase 4a 的 PR 旁路存储（为 dev agent 自给自足）本来就是数据源，`local` 的三个 capability 最终都是 `true`。

有一项声明的降级，它是**数据**层面的，而不是操作层面的：GitLab 在列出树时不提供文件大小（`RepositoryTreeSchema` 没有这个字段，按条目请求会让每个文件多一次请求），所以那里 `size` 返回 `null`。操作存在且可用；缺的是一列。

Local provider 在内部实现了 PR（没有服务器托管它们，但流程存在），而**不**实现 branch 保护——没有平台来施加它。在它上面调用 `protectBranch` 会抛出
`GitNotSupportedError`，一个显式错误，绝不是静默的空操作
（[RN-028](../business-rules/contracts.md#rn-028)）。

> **capability 不是闸门。** 平台的 branch 保护是纵深防御。阻止不当合并的是**领域中的上限**，它在三个 provider 中表现一致，包括完全没有保护的 Local（[RN-006](../business-rules/api.md#rn-006)）。
> [ADR 0028](../adr/0028-protecao-de-branch-divergencia-entre-providers.md)
> 记录了 GitHub 与 GitLab 之间的分歧，以及为什么它不改变保证。

## 规范化错误

每个 provider 把自身平台的错误转换为以下类之一。领域永远看不到 GitHub 的 422，也看不到 git 的 `fatal:`：

| 错误 | 何时 |
|---|---|
| `GitRepoAlreadyExistsError` | 创建已存在的仓库 |
| `GitRepoNotFoundError` | 仓库不存在或无访问权限 |
| `GitBranchNotFoundError` | branch 不存在 |
| `GitBranchAlreadyExistsError` | 创建已存在的 branch |
| `GitPermissionDeniedError` | 凭据有效，权限不足 |
| `GitNotSupportedError` | 操作超出该 provider 的 `capabilities` |
| `GitCredentialConnectionTestFailedError` | 凭据的连接测试失败——**不会**到达 HTTP：`TestStoredCredentialUseCase` 捕获它并返回 `refused`（[ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md)） |
| `GitProviderAuthError` | 凭据无效或已过期 |
| `InvalidOauthStateError` | OAuth 的 `state` 不匹配 |

**没有公共基类**，这是决定，不是遗忘：
[ADR 0002](../adr/0002-git-error-normalization.md) 记录了曾考虑并否决一个抽象 `GitError`，因为在没有 HTTP 过滤器需要它之前它不划算。

实践中最重要的区分是 `GitPermissionDeniedError` 与
`GitProviderAuthError`：前者意为“token 有效但不能做这件事”，后者意为“token 不可用”。把两者混淆，会让用户重新认证，而问题其实在于作用域。

## 重试

**只用于读取，绝不用于变更**
（[ADR 0003](../adr/0003-git-provider-retry-policy.md)）。

算法是 AWS 的 Full Jitter：
`sleep = random(0, min(maxDelay, base · 2^attempt))`，默认 4 次尝试。`apps/api/src/infrastructure/git/retry.ts`。

这种不对称就是整个决策：重试一个超时的 `listBranches` 无害；重试一个可能已经成功的 `commitFiles` 会产生重复提交。无法知道变更是否发生时，正确的做法是失败并让人来查看。

## 契约测试套件

一个统一的套件——`apps/api/test/contract/git-provider.contract.ts`——针对**三个** provider 运行。正是它保证“在 Local 中能用”不会变成“只在 Local 中能用”。

它也是让 `capabilities` 保持诚实的机制：声明 `protectBranch: true` 的 provider 必须通过保护测试；声明 `false` 的必须抛出 `GitNotSupportedError`。声明错误会在两个方向上都让套件失败。

套件附带两道守卫，位于
`apps/api/test/contract/git-provider-contract-callers.spec.ts`。第一道检查套件头部是否恰好列出调用它的地方。第二道是 FASE 26 的第 33 项：**在 `src/` 中没有消费者的契约操作会让 CI 失败**——一个三个 provider 都实现却无人调用的操作是永久的负担，也没有任何东西证明它在真实路径上可用。

让某个阶段先交付契约、后交付路由的阀门既窄又有名字：映射 `SEM_CONSUMIDOR_AINDA`，每个操作旁边写着将要消费它的阶段。它会自行关闭——操作一旦有了消费者，该条目就会**失败**，迫使编写路由的人删除它。

**自 FASE 26b 起该映射为空**，而且是被机制清空的，不是靠某人的记忆：一旦
`application/use-cases/git/read-project-code.use-case.ts` 开始调用
`listTree` 和 `getPullRequestDiff`，第二个测试就失败并点名这两个条目。是清空，而不是删除——阀门仍可供下一个在消费者之前诞生的契约使用。

:::caution 假后端必须和远程以同样的方式“撒谎”
套件针对远程 provider 使用假后端（msw）运行，而一个比真实 API 更**宽容**的假后端会让套件保持绿色，产品却坏了。空仓库就发生过这种事：GitHub 的假后端对不存在的 ref 返回 `404`，真实的 GitHub 返回
**`409 Git Repository is empty`**，于是每个新 GitHub 项目的 bootstrap 都在最开始的第一步就挂掉——而整个套件是绿的。向假后端添加用例时，要对照在线 API 核对响应，而不是对照看起来合理的东西。
:::

### 空仓库中的第一个提交

新建的 GitHub 仓库没有任何提交（`auto_init: false`），此时**整个 Git Data API** 都返回 `409`——ref、blob、tree、commit。无法通过它构建第一个提交。可行的是 Contents API
（`PUT /repos/:owner/:repo/contents/:path`），它一次性创建文件、提交和 branch；`commitFiles` 检测到仓库为空时就用它。

只有**一个**文件时——bootstrap 的情况，每一步提交一个——恰好产生一个提交，正如契约承诺。多于一个时，第一个通过 Contents API 产生（由它创建 branch），其余的经由正常路径进入第二个提交：两个提交而不是一个，这是声明的降级，因为替代方案是拒绝包含多个文件的初始提交。

`LocalGitProvider` 不经历这些：它的 `git init --bare` 通过一贯的路径接受第一个提交。

## Gitflow 的 bootstrap

准备项目仓库的五个步骤：常驻 branch
（`dev`、`qa`、`main`），在 provider 支持时加保护，以及基础文件。

原来是六步：有一个 `create_rc_branch` 步骤，用于在 `qa` 和 `main` 之间创建 `rc` 这一级。该级别通过
[ADR 0030](../adr/0030-politica-de-branches-mecanizada.md) 从策略中移除，这一步后来才从 bootstrap 中移除，当时发现了不一致——产品在**用户的仓库里**创建、保护并**记录**了一个它自己已放弃的四级阶梯。值 `create_rc_branch` 仍保留在数据库的 `bootstrap_step` 枚举中：旧的 bootstrap 有带它的行，而真实发生过的步骤不会被抹去。

两个属性，都经过测试
（[ADR 0005](../adr/0005-repo-bootstrap-idempotent-steps.md)，
[RN-029](../business-rules/api.md#rn-029)）：

**幂等**——每一步在行动之前先检查。运行两次不会重复任何东西。

**可恢复**——在第 4 步失败？恢复从第 4 步开始，而不是第 1 步。

每一步发出自己的事件，共有五种可能的结果：

| 事件 | 含义 |
|---|---|
| `bootstrap.step_started` | 已开始 |
| `bootstrap.step_completed` | 完成了工作 |
| `bootstrap.step_skipped` | 早已完成——**这是成功** |
| `bootstrap.step_degraded` | 在缺少某个 capability 的情况下完成（Local 中的 branch 保护） |
| `bootstrap.step_failed` | 失败；恢复从这里开始 |

`skipped` 和 `degraded` 故意与 `completed` 分开：因为仓库已就绪而全部跳过的 bootstrap，与全部执行了的 bootstrap 是不同的结果，而在没有 branch 保护下运行的又与两者都不同。把三者合并为“ok”，恰好会丢失之后有人会想要的信息。

## 采用现有仓库（Fase 12a）

项目可以指向一个**已经存在**的仓库，而不是新建一个。`project_repositories.origin` 说明是哪一种
（[RN-046](../business-rules/api.md#rn-046)）。

采用**只使用契约已有的东西**：`getRepo` 验证访问——它自 Fase 2 起就存在，却没有任何用例调用——诊断使用
`listBranches` 和 `getFileContent`。**契约没有加入任何新方法，契约测试套件也未改动。**

采用时**不**运行 bootstrap。产出的是一个**计划**：它将要做的事的序列化列表，通过调用每一步的 `check()` 获得——也就是提供幂等性的同一个方法——而不执行任何东西。然后用户批准整个计划，或按原样采用并免除 bootstrap
（[RN-045](../business-rules/api.md#rn-045)）。

| 事件 | 含义 |
|---|---|
| `bootstrap.repository_adopted` | 仓库归属该项目；其中没有任何改动 |
| `bootstrap.plan_approved` | 用户已批准——**只有从这里开始 bootstrap 才会在被采用的仓库上运行** |
| `bootstrap.adopted_as_is` | 用户免除了 bootstrap；计划被保留，作为未被应用内容的证据 |

**保护分歧只是有 × 无，仅此而已。** 契约把
`GitBranch.protected` 暴露为布尔值，而
[ADR 0028](../adr/0028-protecao-de-branch-divergencia-entre-providers.md)
推迟了规范化的 `ProtectionPolicy`——所以计划能说“`qa`
未受保护 → 将应用”和“`main` 已受保护 → 不动”，却不能说现有保护要求两名审阅者而我们的要求一名。**部分**受保护的 branch 视为未受保护，并可能被覆盖——始终在已批准的计划之内。

模板不认识的 branch（`develop`、`release/*`）成为**信息性诊断**，永远不会被触碰：被采用的仓库保有它自己的策略。

决策见 [ADR 0044](../adr/0044-adocao-de-repositorio-existente.md)。

## 凭据

git token 是用户机密：用信封加密（envelope encryption）加密，每条记录一个 DEK，绝不以明文出现在数据库或日志中。表是
`project_git_connections`，它与 LLM 凭据一起参与主密钥轮换——见
[runbook](../runbook.md#rotacao-da-chave-mestra)。

注册在数据库中使用自己的枚举（`credential_provider`），与 LLM provider **只在 TypeScript 类型层面**合并，不混用枚举
（[ADR 0004](../adr/0004-git-credential-registration.md)）。

两种连接方式：**PAT**（粘贴 token）和 **OAuth**（GitHub 和
GitLab）。OAuth 需要配置 `GITHUB_OAUTH_CLIENT_ID`/`_SECRET` 或 GitLab 的对应一对；没有它们，只能用 PAT
（[配置](configuration.md#git)）。

## 不存在的东西

Bitbucket 和 `GenericGitProvider` **不在范围内**——不是被遗忘的待办，而是决定。新增 provider 意味着实现全部十五个操作，诚实声明 capability，并通过契约测试套件。

**通过代码标签页写入同样不存在。** 七个读取操作
（`listTree`、`getPullRequestDiff`、`blame`、`listPullRequests`、
`listBranchesDetailed`，加上 `getFileContent` 和组合搜索）只读，仅此而已。通过标签页保存文件是未来的阶段，而当它到来时，写入是外部效果：它以 `proposed_action` 诞生，与所有 git 变更一样。让这一点可验证而不仅是意图的是：`CodeController` 没有**任何一个**写入动词——没有 `@Post`、没有 `@Put`、没有 `@Patch`、没有 `@Delete`——即使在 FASE 26b 给它加了三条路由之后。
