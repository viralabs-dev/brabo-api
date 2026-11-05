---
traducao_de: 2f301391630d5be632e27036026760d416d43da1
---

# api 的暴露面

每一条已注册的路由，连同其认证分类，以及那些保持开放的路由的理由。相关决策见
[ADR 0027](adr/0027-fase5-backup-hardening-release.md)。

> **本文档是一个测试的事实来源**，而不是某个测试的副本。
> `apps/api/test/interfaces/route-surface.spec.ts` 启动应用，
> 枚举**运行时注册**的路由，并与下方表格比对。没有对应行的新路由**会让测试失败**；
> 分类与实际注解不符的行**会让测试失败**；孤立的行（不匹配任何路由）**会让测试失败**。
> 文档不会悄无声息地过时。

## 分类 {#classifications}

| 值 | 含义 |
|---|---|
| `public` | `@Public()`——无需 token。每一条都在下方说明理由 |
| `engine-service` | `EngineServiceGuard`：`X-Brabo-Service-Token` 等于共享密钥。这是 api↔engine 的内部接口面，位于 JWT 之外 |
| `role:<role>` | 已认证，并受领域 RBAC（`@RequireRole`）限制 |
| `jwt` | 已认证，路由上不要求角色——范围来自资源本身 |

## 十五条公开路由 {#the-fifteen-public-routes}

在 Fase 6 之前只有四条。Fase 7a 一次性加了八条——first-party 认证——，ADR 0084 又加了两条，即社交登录，而 runner 设备密钥那一波加上了二进制文件的代理。每一条都在下方说明理由。再开放任何一条，仍然需要修改 `route-surface.spec.ts` 中的断言，该断言逐字列出公开路由，以强制进行讨论。

### 基础设施 {#infrastructure}

**`GET /live`**——存活探针（liveness）。刻意不访问数据库：只要进程还活着就响应。在这里要求 token，会让 kubelet 在认证路径第一次抖动时就重启 pod，把一次降级变成彻底宕机。

**`GET /health`**——就绪探针（readiness），执行 `select 1`。同样的道理：调用方是 kubelet，它不带 token。只透露数据库是否响应。

**`GET /metrics`**——Prometheus 抓取，同样不带任何 token。暴露由网络控制，而非认证：NetworkPolicy 只对 `monitoring` 命名空间开放，生产环境的 Ingress 会屏蔽该路径。没有 `@Public()`，抓取目标会显示为 `down`，而其余一切都是绿色。

**`GET /git/oauth/:provider/callback`**——GitHub/GitLab OAuth 的回调。用户的浏览器从提供方跳转到这里，没有 api 会话。但它并非不受限制：`state` 参数通过 HMAC（`GIT_OAUTH_STATE_SECRET`）校验，没有有效的 `state`，调用会被拒绝。

这项保证的价值恰好等于密钥的价值，这也是它不再有默认值的原因：在生产环境中，如果使用仓库里的示例密钥（它是公开的），api **拒绝启动**（ADR 0059，
[RN-093](business-rules/api.md#rn-093)）。一旦密钥为人所知，这条路由在实际上又变得不受限制——任何人都能为任意项目签发一个 `state`。

**`GET /runner-releases/binary`**——从 GitHub Releases 代理 runner 的独立二进制文件，使浏览器永远不直接与 GitHub 通信。公开的理由与 `/metrics`/JWKS 相同：二进制文件本身不是秘密，而要求会话才能下载让人得以认证的工具本身，是本末倒置。`platform` 是一个封闭的允许列表（`linux-x64`/`linux-arm64`/`darwin-arm64`——发布矩阵构建的三个目标；`darwin-x64` 在
[ADR 0174](adr/0174-runner-sem-binario-darwin-x64.md) 中移除，`win32-x64` 在
[ADR 0187](adr/0187-runner-sem-binario-win32-x64.md) 中移除，两者都会以专门的消息被拒绝，并指向 npm 包），从不原样插入 GitHub 的 URL——堵住了开放参数会留下的 SSRF/路径注入向量。解析出的资源 URL（绝不是二进制的字节）在内存中缓存几分钟，仅为了在并发下载时保持在 GitHub 未认证请求的速率限制之下；自 FASE 29 第 3 次会话起，解析后的 `checksums.txt`——几百字节的*文本*——也在同一条目中被记忆，因此哈希和二进制总是来自同一个 release。

自 [RN-525](business-rules/produto.md#rn-525)（[ADR 0149](adr/0149-assinatura-dos-artefatos-publicados.md)）起，这条路由不再传输未经校验的字节：它把下载内容的 sha256 与该 release 的 `checksums.txt` 比对，无法完成时响应 **502 并附带命名的 `motivo`**——包括 release 根本没有发布清单的情况，这是*拒绝*，绝不是带着警告提供字节。请狭义地理解这项保证：它是**针对清单的完整性，而不是来源证明**。这条路由**不**校验清单的 `cosign` 签名（`checksums.txt.bundle`），因此能改写 Release 的人可以同时改写两个文件并通过。关闭这个缺口的两种方式都已测量过，目前被否决——镜像中带 `cosign` 要 155 MB，而 `@sigstore/verify` 会让一条 `@Public()` 路由依赖第二个第三方主机（`tuf-repo-cdn.sigstore.dev`），去校验一个还没有任何 Release 携带的东西。*校验*签名的消费者是 `install.sh`。由于校验哈希意味着读取全部字节，下载内容会写入 `/tmp` 下的临时文件（pod 的 `emptyDir`，因根文件系统只读而挂载），上限 256 MiB，只有在哈希匹配后才返回——绝不在 512Mi 的进程内存中缓冲。

### First-party 认证 {#first-party-auth}

七条 `/auth/*` 路由加上 JWKS。**它们都必须公开，出于同一个结构性原因：**它们是*获取* access token 的途径，而全局的 `JwtAuthGuard` 要求有一个。放在 guard 后面的认证路由会索要它自己签发的凭据。`logout` 是唯一可以要求认证的，但刻意没有：它已经携带了真正重要的凭据——cookie 中的 refresh，以及配对的 CSRF——而且即使 access token 已过期，退出也必须能工作。

> **保护这些路由的不是速率限制。** `RateLimitGuard` 豁免 `@Public()` 路由——这是刻意的，以免把 `/health` 卡到 kubelet 重启 pod。守住这个接口面的是用例内部按邮箱和按 IP 的**渐进式锁定**。它不是可选的加固：它是这里唯一存在的防线。
> 参见
> [RN-030](business-rules/api.md#rn-030) 和 [RN-031](business-rules/api.md#rn-031)。

**`POST /auth/register`**——注册。无论是新地址还是已注册地址都响应 `202`；对于后者，不创建任何东西，地址所有者会收到一条通知。按 REST 常识应返回的 `409 Conflict`，会把用户列表交给任何拿着字典的人。

**`POST /auth/login`**——认证。不存在的邮箱、错误的密码和被锁定的账户都返回**相同**的 401 响应，并耗费**相同**的时间（没有账户的分支会用参数相同的虚构哈希进行比对）。

**`POST /auth/refresh`**——轮换。refresh token 本身就是凭据，所以这条路由不能再要求另一个。

**`POST /auth/logout`**——吊销所出示 token 所属的整个家族。总是 `204`，即使是未知 token：在这里响应 401 会成为 token 有效性的预言机。

**`POST /auth/verify-email`**、**`POST /auth/request-password-reset`**、
**`POST /auth/reset-password`**——账户流程。按定义，到达这里的人还没有会话。凭据是通过邮件送达的一次性 token；无效、过期或已使用的链接得到完全相同的响应。

**`GET /.well-known/jwks.json`**——签发 access token 的 Ed25519 密钥对中**公开**的一半。与 `/metrics` 同理：消费者没有 token，要求一个就等于为了校验凭据而索要凭据。发布公钥正是这种格式的全部目的——绝不能从这里流出的是 JWK 的 `d` 分量，由测试锁定。

### 社交登录（ADR 0084） {#social-login-adr-0084}

**`GET /auth/oauth/:provider/start`**——直接重定向到提供方（GitHub/GitLab）。公开的结构性原因与其他七条相同：它本身就是入口，在会话存在之前。它生成的 `state` 以*自有*用途通过 HMAC 签名（`signSocialOauthState`/[RN-273](business-rules/api.md#rn-273)）——绝不是上面 `GET /git/oauth/:provider/callback` 的同一个 `state`，尽管两条路由用*同一个*密钥 `GIT_OAUTH_STATE_SECRET` 签名。payload 中的 `purpose` 字段正是阻止一个流程的 `state` 被另一个流程的校验器接受的东西。

**`GET /auth/oauth/:provider/callback`**——接收提供方的回调。与 git 连接回调同理：浏览器到达时没有会话，`state` 通过 HMAC 校验，路由从不返回 JSON——它总是重定向，成功时到 `WEB_ORIGIN/`（会话 cookie 已写入），失败时到 `WEB_ORIGIN/login?oauth_error=1`，不在 URL 中说明原因。

## 说明 {#notes}

- **`POST /workspaces/:workspaceId/projects` 决定 agent 将在哪里写入，这就是它为什么是安全接口面上的路由，而不仅仅是登记用的路由**
  （[ADR 0072](adr/0072-projeto-local-ou-container.md)/
  [ADR 0104](adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)，
  [RN-169](business-rules/api.md#rn-169)/[RN-421](business-rules/api.md#rn-421)/
  [RN-422](business-rules/api.md#rn-422)）。请求体新增了 `executionMode`
  （`container`——默认值，也是一贯的行为——，`mounted`，即改名后的旧 `local`，或 `runner`）和 `workspacePath`。在 `mounted`/`runner` 下，填写的绝对路径成为 ADR 0055 中**终端范围的根**：在这里输入的，就是 agent 可以读写的。没有新增路由，也没有改变角色（`RequireRole('maintainer')`，一如既往）——改变的是这条路由所授予的范围。

  自 [ADR 0142](adr/0142-validacao-de-workspace-montado-adiada.md)
  （[RN-501](business-rules/api.md#rn-501)）起，两种非 `container` 模式在创建时校验*同样*的东西：只有*词法*形式——绝对路径、不含 `..`、绝不是根目录或系统目录、在任一方向上都绝不与 Brabo 的 checkout 重叠（RN-422/RN-423）——不做任何磁盘 I/O。`mounted` 增加一条自己的规则：路径必须位于 `BRABO_PROJECTS_BASE` 之内，这是两个容器都能看到的机器上唯一的文件夹（ADR 0141）；没有配置 base 时，拒绝信息会说明此安装中该*模式*不可用，而不是归咎于路径。

  **这次变更中与安全相关的部分，是那些*没有*变的东西。** 填写的路径仍然是终端范围的根，词法谓词仍然是包住它的东西——它在每一次推导根目录时运行，*读取*时也运行，因为直接写数据库是绕过创建的唯一途径。被推迟的是*磁盘*检查（存在吗？是目录吗？这个进程能写入吗？），它从未包住任何东西：它回答的是"这能不能工作"，而不是"这是否被允许"。它现在在 `materializarWorkspaceMontado` 中运行，即 Infra 启动容器时（以及作为声明的例外，在模式转换时），base 规则在 `mkdir -p` *之前*被重新应用——因此在产品之外写入的路径不会让 api 在它能触及的任意位置创建文件夹。

  base 规则刻意放在词法谓词之外：后者在每次读取时运行，一个位于 base 之外的*遗留* `mounted` 项目会仅仅因为被读取就失败。`runner` 仍由 runner 自己确认，它是对真实主机唯一有权威的一方（RN-423，见下方的
  `POST /internal/projects/:projectId/workspace-verification`）；`mounted` 改由物化步骤确认，同样会写入 `workspace_verified_at`。之后模式会被**冻结**：`UpdateProjectDto` 刻意省略这两个字段，否则 `PartialType(CreateProjectDto)` 会在一个毫无防护的 `PATCH` 中暴露它们。
- **`GET /workspaces/:workspaceId/containers` 现在列出 workspace 的*所有*项目，它所支撑的页面成为了人工*启动*容器的途径**
  （[RN-521](business-rules/api.md#rn-521)，
  [ADR 0136](adr/0136-pagina-global-de-containers.md)）。角色没变（`viewer`，一如既往），范围也没变：它仍然只对调用者能看到的 workspace 项目作出响应。变的是行集——从未部署过容器的项目原来*缺席*，现在以 `registrado: null` 出现，这是*第三种*状态，既不是 `stopped`，也不是"无法观察"。读取仍以同样方式受限：无论项目数量多少，都是三次批量查询，每次加载最多调用 broker `TETO_DE_VERIFICACOES_POR_CARGA`（20）次，没有容器的行永远不符合条件，因此永远不会挤掉真实行的名额。

  **这个页面上没有任何东西直接执行操作。** 停止、移除和启动都是 `proposed_action`，总是由*人*点击，绝不是 agent，`decide.ts` 的任何上限都没有被触动：两种启动类型都要求 `maintainer`，`container_remove` 处于特权命令家族的绝对上限中
  （[RN-418](business-rules/api.md#rn-418)）——永远不可自动批准，"始终允许"在源头即被拒绝。界面按 `execution_mode` 对启动操作分支，与后端完全一致
  （[RN-497](business-rules/produto.md#rn-497)/[RN-503](business-rules/api.md#rn-503)）：
  `container`/`mounted` 提议 `container_start`（broker），`runner` 提议
  `container_start_via_runner`（本地 agent），各自带上其 schema 实际接受的 payload。

  界面自身的拒绝是诚实，而不是强制：没有已决定的镜像时它不提供按钮（RN-105 的闸门，自
  [RN-494](business-rules/broker.md#rn-494) 起在*三种*模式下都有效），对于没有任何本地 agent 确认过其文件夹的 `runner` 项目也不提供，对低于 `maintainer` 的角色也不提供——并以文字说明是三者中的哪一个。**真正拒绝的仍然是
  `RolesGuard` 和用例。** 这里读取的角色是 *workspace* 角色，而不是项目的有效角色（`projectRole ?? workspaceRole`，
  [RN-471](business-rules/web.md#rn-471)）：在某个项目内被降级的成员仍会看到按钮并收到 403，这是为了不在一个跨项目的页面上承担 `project_members` 的 N+1 查询而声明的代价。
- **`PUT /projects/:projectId/mirror-path` 在*用户*的机器上记录一个路径，而 api 永远看不到那台机器**（[RN-515](business-rules/api.md#rn-515)，
  [ADR 0147](adr/0147-agente-local-com-capacidades.md)，第 4 点）。它保存 `espelho` 能力复制项目工作的目标位置——一个位于挂载 base *之外*的文件夹，这正是 bind mount 够不到、而本地 agent 需要够到它的原因。

  最低要求是 `maintainer`，与上面的 `execution-mode` 和 `projects-base` 相同，理由也相同：这条路由涉及的是操作者自己文件系统上的路径，而不是项目元数据。

  api 在这里能校验的*只有*词法形式，拒绝消息也这样说明。它复用 `caminhoDeWorkspaceLocalValido`——绝对路径、不含 `..`/`.`、绝不是根目录、绝不是系统目录、绝不与 Brabo 自身的 checkout 重叠——与 `runner` 下的创建完全一样
  （[RN-423](business-rules/runner.md#rn-423)），理由也相同：这里没有可以询问的磁盘。它*不*要求 `BRABO_PROJECTS_BASE`，因为位于 base 之外正是目的所在。

  有两种拒绝是这条路由特有的。目标不能位于 `workspacePath` 之内，也不能包含它——同一个环从两侧看，因为把镜像写进来源自身会让镜像复制自己——并且比较按*段*进行（`dentroDoEscopo`），所以 `/base-outra` 不在 `/base` 之内。另外，`execution_mode: container` 的项目不能有任何目标：它的来源是*服务器上*托管的卷，而负责复制的进程运行在*用户*的机器上，看不到它。两者都是 **400**。

  防护的另一半——用 `realpath` 解析符号链接，使目标任意段中的链接都不会指回来源内部——属于 *RUNNER*，在两个路径真实存在的那台机器上。**这条路由不建立这项保证**；它只排除*写出来*的环。清除是 `mirrorPath: null`，而且该键是必需的：省略它与请求清除无法区分，而悄无声息地清除正是缺陷所在。写入镜像从来不是 `proposed_action`——这是用户声明的配置，而不是 agent 请求执行操作。
- **`GET /projects/:projectId/mirror-state` 是 `viewer`，比*写入*目标的路由低一级**（[RN-517](business-rules/api.md#rn-517)，
  [ADR 0147](adr/0147-agente-local-com-capacidades.md)，第 7 点）。它返回最近一轮镜像做了什么：三种状态中现在是哪一种（`never` | `synced` | `failed`）、最近一次成功的同步及其计数、那一轮冻结的目标，以及最后一次错误。

  与 `PUT .../mirror-path`（`maintainer`）的不对称是刻意的，正是
  [RN-102](business-rules/api.md#rn-102) 规则的应用：最低要求属于*端点*，而这个端点只*读*。目标本身已经包含在项目的每次读取中（`GET /projects/:projectId`，`viewer`），因此在这里要求 `maintainer` 会把同一项目中已经能看到它的人挡在外面——两种缺陷中更糟的那一种，因为失去能力的人看不见它。

  值得说明它*不*暴露什么：没有文件名、没有内容、除调用者已经能读取的目标之外没有任何路径。计数就是计数。
- **`GET /workspaces/:workspaceId/projects-base` 透露了操作者文件系统拓扑的一部分，这就是它不是 `viewer` 的原因**
  （[ADR 0141](adr/0141-base-unica-dos-projetos-montados.md)，
  [RN-500](business-rules/api.md#rn-500)）。它返回
  `{ projectsBase: string | null }`——以同一路径挂载进 `api` 和 `engine` 容器的那个唯一的主机文件夹，所有 `mounted` 项目都位于其下。`null` 是不提供"挂载"模式的安装的正常状态，项目向导正是借此得知不要提供此安装无法兑现的模式。

  最低要求是 `maintainer`：与上面的 `POST
  /workspaces/:workspaceId/projects` *相同*，因为决定那条路由提供什么，是这个值的唯一用途。沿用相邻 `projects-*` 读取的 `viewer`——它们在同一个 controller 中并列——会把一个主机绝对路径交给所有能查看 workspace 的人，而换不来任何能力。`workspaceId` 不参与计算：base 是*安装*的配置，对每个 workspace 都相同，这个参数只是为了给 `RolesGuard` 一个范围。

  自 [ADR 0161](adr/0161-a-tela-so-oferece-o-modo-que-a-instalacao-executa.md)
  （[RN-573](business-rules/api.md#rn-573)）起，响应还带有
  `brokerConfigurado: boolean`——即 `BROKER_URL` 是否已定义，由
  `ContainerBrokerPort.configurado()` 读取。它透露安装拓扑中的一个比特（是否存在持有 Docker socket 的 broker），绝不透露其地址，最低要求仍然是 `maintainer`。同一个比特也出现在
  `GET /workspaces/:workspaceId/containers`（`viewer`，
  [RN-574](business-rules/api.md#rn-574)）的每一行中，这是一次刻意的放宽：那个页面需要在点击*之前*说明 `container`/`mounted` 无法启动
  ，而能看到该页面的人原本就可以在任何一行处于 `provisioning`/`running` 时，通过
  `naoObservado: broker-nao-configurado` 推断出 broker 的缺失。它说明变量存在，绝不说明 broker 在响应。
- **`GET /workspaces/:workspaceId/project-folders` 根据客户端提供的路径返回目录列表，它的全部安全性在于*一个*约束**（[RN-504](business-rules/web.md#rn-504)，
  [ADR 0141](adr/0141-base-unica-dos-projetos-montados.md)）。它之所以存在，是因为项目向导一下子失去了它的两种"浏览文件夹"机制：`FolderBrowserModal` 通过 *RUNNER* 的 websocket 浏览，`RunnerOnboardingPanel` 使用 `showDirectoryPicker`，后者返回浏览器句柄，绝不返回绝对路径。随着 runner 退出项目创建流程，浏览器无法列出文件系统——于是由 api 来列，而 api 只能看到一个文件夹：挂载项目的 base。

  约束就是这个 base，别无其他。`path` 可选，默认是
  `BRABO_PROJECTS_BASE`；任何提供的 `path` 都必须满足
  `dentroDaBaseDeProjetos`——与 ADR 0055 的终端范围使用的同一个 `dentroDoEscopo`，因此即使字符串开头相同，`/home/you/brabo2` 也*不*在
  `/home/you/brabo` 之内。越出 base 是 **400**，不是 403：403 会暗示别的角色能看到它，而没有任何角色能看到。请求是格式错误，而不是授权不足。`..` 和 `.` 直接被拒绝而不是被解析，理由与创建时的谓词拒绝它们相同——解析就意味着接受读取的路径不是请求的路径。

  上限是契约的一部分，而不是实现细节：只列目录，最多 500 个（截断*之前*排序），从不递归，排除以点开头的条目，符号链接会被报告但从不跟随——因此指向 base 之外的链接不是离开 base 的出口。被排除的东西会被*计数*（`arquivos`、`simbolicos`、`truncado`），所以装满代码的文件夹永远不会看起来是空的
  （[RN-180](business-rules/web.md#rn-180)）。没有配套的 POST：创建文件夹属于挂载 workspace 的物化步骤，绝不属于选择器。

  最低要求是 `maintainer`，与上面的 `POST
  /workspaces/:workspaceId/projects` 和 `projects-base` 相同，理由再进一步：`projects-base` 透露操作者机器上的*一个*路径，这条路由透露它下面的*拓扑*。不能创建项目的人，对可以创建项目的文件夹列表无事可做。
- **`GET /`** 是 NestJS 脚手架的 "Hello World!"
  （`src/app.controller.ts`）。它在 guard 之后，不泄露任何东西，但也毫无用处——可以考虑移除。它被记录在这里而不是被删除，因为那是产品决策，超出了这次会话的范围。
- **`GET /internal/projects/:projectId/git-remote` 是产品中唯一返回*已解密*秘密的路由**——workspace owner 的 git token
  （[ADR 0056](adr/0056-o-engine-trabalha-em-repositorio-remoto.md)）。
  它之所以存在，是因为 engine 在文件系统上工作，却没有主密钥；把主密钥复制到 engine 会让产品最敏感秘密的影响范围翻倍。有两个性质让它站得住脚：它返回的 `origin` 是**干净的**（凭据在单独的字段里，绝不嵌入 URL），消费者必须在每次调用时注入它，绝不写入文件——见 `Engine.Actions.GitAuth` 以及
  [RN-076](business-rules/engine.md#rn-076) 中的推理。如果这条路由有一天开始返回已认证的 URL，token 就会落进 `.git/config`，位于 dev agent 拥有自动批准读取权限的文件夹内。

  在 `runner` 模式下，这种按调用注入要多走一跳——`exec` 消息的 `env` 字段（[RN-507](business-rules/runner.md#rn-507)）——并止步于容器边界：产品的 Docker 端口**没有 `env` 字段**，这是刻意的（[ADR 0130](adr/0130-broker-de-container.md)），因此通过 `docker exec` 路由进容器的命令永远无法携带 token。这个约束一直成立；没有成立的是报告。在 [RN-558](business-rules/runner.md#rn-558) 之前，runner **照样**运行该命令，装好 credential helper、变量为空，由此产生的认证失败与坏 token 或网络故障无法区分——而且是在*常见*路径上，因为 RN-507 要求的已登记 `running` 容器，正是由这同一个 runner 启动的。现在 runner 在执行任何东西之前就**拒绝**这一组合（凭据存在、容器活跃），engine 将该拒绝的来源归类为 `politica` 而不是 `codigo`。拒绝的文本不点名变量及其值，只说有多少个。凭据仍然不会越过容器边界，而自
  [ADR 0193](adr/0193-git-credenciado-no-host-do-runner.md)
  （[RN-676](business-rules/runner.md#rn-676)）起它也不需要越过：engine 标记已认证的 `fetch`（`gitCredenciado: true`，只在一处设置，
  `RunnerRouter.exec_git_credenciado/5`），runner 在主机上运行*这一条*命令，`env` 在那里到达子进程；dev agent 的命令仍然走 `docker exec`。信任边界是这个标记，而不是 `env`：只要有活跃容器，带 `env` 却*没有*标记的命令仍被拒绝，因此凭据字段永远不会成为容器的出口。ADR 0130 的任何端口都没有改变。
- **PO 的三条读取路由**——`GET /internal/projects/:projectId/business-rules`、
  `GET /internal/projects/:projectId/backlog`（[RN-164](business-rules/engine.md#rn-164)）
  和 `GET /internal/projects/:projectId/product-metrics`（[RN-407](business-rules/contracts.md#rn-407)）——
  不返回任何秘密，并且**除项目 id 外不接受任何东西**：没有搜索词，没有分页，没有过滤器。这是刻意的。给 agent 用的读取路由是模型选择调用的接口面，而参数是模型可以随意书写的地方；这里没有可写的地方。范围由路径封闭在项目内，每次调用的成本是常数（backlog 三次读取，规则两次，产品指标是一次按索引过滤 `proposed_actions` 的查询）。
- **dev agent 的契约读取**——`GET /internal/projects/:projectId/module-contracts`
  （[RN-684](business-rules/api.md#rn-684)，[ADR 0200](adr/0200-contrato-entre-modulos-artefato-do-arquiteto.md)）
  ——遵循同一规则：没有秘密，除项目 id 外没有别的，现行 `module_map` 的每个模块一个条目。写入的孪生路由
  `POST /internal/sessions/:sessionId/module-contracts` 只接收 Arquiteto 的声明（每个模块暴露什么），并对照现行 `module_map` 校验每个名称；两条路由都不触碰任何 worktree。
- **`POST /internal/projects/:projectId/workspace-verification`**（RN-423，
  ADR 0104）只由 engine 调用，在 runner 连接并通过通道发送
  `workspace_confirm` 之后——绝不由 runner 直接调用，它没有 service token。runner 是路径的*事实来源*（它*覆盖* `workspacePath`，不要求与创建时输入的一致），但提供的路径仍要经过与创建时*相同*的词法检查（`caminhoDeWorkspaceLocalValido`）——即使来自 runner，系统根目录和与 Brabo checkout 的重叠仍然被禁止。如果项目不处于 `runner` 模式，则 `400`。

  自 [ADR 0151](adr/0151-base-consentida-no-runner.md)
  （[RN-529](business-rules/runner.md#rn-529)）起，runner 还可以带着一个**base** 启动——那台机器上的一个文件夹，每个项目是它的一个子文件夹。关于它，有两点属于本页。第一，base 是**本地的，从不经网络到达**：它来自 `--base` 或
  `$XDG_CONFIG_HOME/brabo/runner.json`，绝不来自服务器的某个字段，因此
  [ADR 0130](adr/0130-broker-de-container.md)/
  [ADR 0144](adr/0144-a-segunda-raiz-do-broker.md) 的不变式在这一侧同样成立——根目录归执行者所有，只有**相对段**在传输。
  `resolverPastaDoProjetoNaBase` 在词法上拒绝*绝对*段，而不是重新解释它。第二，base **不**参与 `--dir` 的校验，正如 base 规则位于 api 的词法谓词之外：文件夹早于 base 的项目继续工作。这道防护是 `guard.ts` 的*第三个*姊妹，复用
  `dentroDoEscopo`/`realpathMaisProximo`/`semBarraFinal` 以及同样的"先词法、后 `realpath`"双重检查——并以书面形式继承同样的 TOCTOU 保留意见：尽力而为，绝不是安全边界。

  自 [RN-532](business-rules/runner.md#rn-532)（同一 ADR，第 3 至 6 点）起，这个 base 有了一个*消费者*：`workspace_create`/`workspace_create_result` 这一对。关于它，有三点属于本页。第一，**没有新增写入路由**：创建文件夹后，runner 推送已经存在的
  `workspace_confirm`，正是它——通过这同一个端点——写入 `workspace_verified_at`。engine 仍不写这张表，唯一写入时间戳的路径仍然唯一。第二，传输的是**相对段**，绝不是绝对路径，runner 在词法上拒绝绝对路径。第三，`workspace` 能力是四种能力中唯一一个其声明取决于 runner 的*状态*而非其版本的——只有在 base 获得同意后才会声明——因此服务器得知存在 base，靠的正是这个声明，别无其他。join 时没有人*要求*它：没有 base 的 runner 照常连接并服务它的项目，只有 `workspace_create` 会被拒绝，并给出*命名的*响应。创建这个文件夹是经同意的配置，而不是 agent 请求执行操作：它**不是** `proposed_action`，`decide.ts` 的任何上限都没有获得例外。
- **`POST /internal/projects/:projectId/container-exec`**（[RN-492](business-rules/engine.md#rn-492)，
  [ADR 0134](adr/0134-dev-agents-executam-dentro-do-container.md)）只由 engine 调用，当 `Engine.Actions.TerminalExecutor` 判定某条终端命令属于项目的真实容器时。它转发给
  `ContainerBrokerPort.exec`——api 从不自己运行命令。与下面的 `container-spec` 不同，这里是 *ENGINE* 调用 api，而不是 broker；响应体从不因 broker 拒绝或 broker 不可达而抛出（`{ sucesso: false, motivo }` 是正常形式，依据 RN-486——一行 `running` 从不保证容器此刻正在运行），因此一个已死的容器只是一次普通的失败命令，而不是 5xx。
- **`POST /internal/projects/:projectId/mirror-sync-result`**（[RN-517](business-rules/api.md#rn-517)，
  [ADR 0147](adr/0147-agente-local-com-capacidades.md)，第 7 点）只由 engine 调用，在 runner 通过通道推送 `mirror_sync_result` 之后——绝不由 runner 直接调用，它没有 service token。形式和路径与上面的 `workspace-verification` 相同，理由也相同：runner 是唯一知道用户机器上发生了什么的一方，engine 负责转发，而不是自己写表。

  它记录*遥测*，别无其他：`project_mirror_states` 中的一行，绝不是事件日志（一轮镜像没有会话，而
  `session_events.session_id` 是 `NOT NULL`），也绝不是 `proposed_action`。请求体携带一个结果、三个计数和一条错误消息——没有任何 api 会据以行动的路径，没有执行任何东西，没有授予任何东西。记录永远不会拖垮它所测量的东西：调用这里时复制已经结束，这里的拒绝只会被 engine 写进日志。
- **`GET /internal/projects/:projectId/container-spec`**（[ADR 0130](adr/0130-broker-de-container.md)，
  [RN-485](business-rules/produto.md#rn-485)）是唯一一条调用者*不是* engine 的 `engine-service` 路由——调用者是容器 **broker**，产品中唯一能访问 Docker daemon 的进程。分类命名的是*机制*（`BRABO_SERVICE_TOKEN` 位于自己的请求头中，以常数时间比较），而不是发送方，而秘密刻意相同：三个服务运行在同一个集群中，读取同一个 Secret，因此第二个秘密只会造成分隔的假象而没有分隔任何东西（完整推理见 `service-token.ts`）。让这条路由值得存在的是调用方向：broker 不是*接收*容器 spec，而是来这里*读取*项目身份、执行模式和 Arquiteto 的现行镜像决策，然后自己组装 spec。在请求体中传输的 spec，会让一个等同 root 的进程的约束取决于调用方是否正确。它**不返回任何绝对路径**——bind 的源路径由 daemon 对照*主机*文件系统解析，所以 api 容器内部的路径会悄无声息地挂载一个空文件夹。取而代之传输的是 `localizacao`
  （[RN-503](business-rules/api.md#rn-503)，
  [ADR 0144](adr/0144-a-segunda-raiz-do-broker.md)）：一个可辨识的定位器，说明由 broker 的*两个*根中的哪一个来解析文件夹（`gerenciada` → `PROJECT_WORKSPACES_HOST_ROOT`，`montada` →
  `BRABO_PROJECTS_HOST_BASE`，或带原因的 `indisponivel`），外加该根未覆盖的*相对*段。api 永远不知道这些根在主机上的位置，broker 永远不知道项目的任何信息——任何一方单独都无法写出任意路径，这就是约束。broker 拒绝 `start` 时会点名缺失的根，绝不退回到另一个根，并在拼接结果变成 `-v` 之前重新校验该段（`..`、绝对路径、空、`NUL` 均被拒绝）以及拼接结果。它也丢弃
  `rationale`，该字段存在是为了让人审阅决策，在 `docker run` 中没有消费者。
- **`GET /internal/projects/:projectId/container-spec` 新增了
  `usuarioDaPasta`，分类未变**——仍是
  `engine-service`，仍然只由 broker 调用（[ADR 0180](adr/0180-container-com-o-dono-da-pasta.md)，
  [RN-627](business-rules/contracts.md#rn-627)）。该字段是 api 通过 `stat` 看到的项目文件夹的 `{ uid, gid }`，或 `null`（runner 模式、文件夹不可达、root 的文件夹）。broker 重新校验它（1..2^31-1 范围内的整数；`0` 会被点名拒绝）并用作 `--user`；它从不从请求体读取用户，因此仍然不存在调用方可以写入 `privileged`、`cap_add` 或挂载的字段。它以比之前*更少*的权限运行容器（非 root 而不是 root），`--cap-drop ALL` 保持不变。
- **`POST /projects/:projectId/runner-ticket` 和其他路由一样被归类为 `role:developer`，但*不*接受会话 JWT**（ADR 0105，
  RN-424）——只接受 Personal Access Token（`brb_…`）*或* runner 的设备密钥（Ed25519，见下文）。自动分类（`route-surface.spec.ts`）不区分这些机制，因为角色*要求*是一样的；变的只是 `request.user` 如何建立。在这条路由上，`PatAuthGuard` 取代 `JwtAuthGuard` 运行（`@RequirePatAuth()`，与
  `@ServiceRoute()`/`EngineServiceGuard` 相同的结构模式——通过元数据转向，绝不是新路由可能忘记的 `if`），而且它是 api 中*唯一*接受这些凭据格式的地方：在其他任何路由上，`brb_...` 都会正常地在 JWT 校验中失败，设备密钥 JWT 也一样（它的 `kid` 永远无法对照会话 token 签发者自己的密钥解析）。`/projects/:projectId/personal-access-tokens` 下的五条路由（签发/列出/吊销自己的 PAT，外加两条 `maintainer` 路由——RN-427，列出/吊销项目中*任何*用户的）仍然是普通的会话 JWT——只有由 *TOKEN 本身*认证的那条路由改变了机制。
- **`GET /runner/projects` 被归类为 `jwt`，但*不*接受任何会话 JWT**（[RN-543](business-rules/produto.md#rn-543)，
  [ADR 0154](adr/0154-chave-de-dispositivo-de-maquina.md)）。这是*机器*级 agent 发现它所服务项目的路由，也是第一条路径中没有 `:projectId` 的
  `@RequirePatAuth()` 路由——而这恰恰是它要解决的问题：调用者还不知道有哪些项目。两个后果，都由测试锁定：
  - **只有*机器*凭据能进入**（`runner_device_keys.project_id`
    为 NULL）。绑定到某个项目的凭据——PAT，或 ADR 0118 流程的设备密钥——描述的是一个项目，没有东西可发现；`PatAuthGuard` 以 403 和一条*专门*的消息拒绝它，绝不是"项目错误"那条，那会在原因上撒谎。拒绝"A 的密钥用于 B"的比较*没有*被移除：它只对 `null` 消失，两个方向都已锁定。
  - **没有 `@RequireRole`，因为没有可以据以解析角色的项目。** 最低 `developer`——与 `runner-ticket` *相同*——在
    `ListRunnerProjectsUseCase` 内*逐行*应用，使用产品唯一的标尺（`ResolveEffectiveRoleUseCase.forProject`）。没有任何放宽：输出的恰好是 `runner-ticket` 本来就会为该用户授权的项目集合。自动分类器读取 `@RequireRole`，看不到机制，于是落到 `jwt`——与本文档已在上文为 `runner-ticket` 用文字纠正的近似相同。这条路由从不接触会话 JWT：`JwtAuthGuard` 在 `@RequirePatAuth()` 路由上弃权，`PatAuthGuard` 校验的公钥来自 `runner_device_keys`，绝不来自会话签发者。

  它返回项目 id、名称、`workspaceDirName` 和校验状态——绝不返回绝对路径。在线路上传输的是*段*，根目录属于执行者，这与 broker（ADR 0144）和 runner base（ADR 0151）是同一个不变式。

  自 [RN-544](business-rules/runner.md#rn-544) 起，这条路由有了它的*消费者*：不带 `--project` 运行时，`brabo-runner` 在启动时调用它，并为**列出的每个项目打开一个连接**——而自
  [RN-550](business-rules/runner.md#rn-550) 起，当列表返回**空**时，它会按声明的节奏（15s、30s，然后每 60s 重复）持续调用，直到第一个项目出现。这种等待的上限在失败一侧，而不在等待一侧：连续十次调用失败，进程以 1 退出并说明次数，任何响应（包括空响应）都会把计数器归零，一旦有连接存活，等待就**停止**——有存活连接时列表只在启动时读取，原因见下文。每个连接的根在
  `<base>/<workspaceDirName>`，经过同样的防护
  （`resolverPastaDoProjetoNaBase`，然后是 RN-434/RN-435）。关于这一点，有三件事属于本页。第一，**engine 中什么都没变**：主题
  `terminal:<projectId>`、socket id 和 ticket 描述的是一个*连接*，N 个连接逐字节满足它们——对同一项目第二个 runner 的拒绝没有被触动，镜像
  （[RN-516](business-rules/runner.md#rn-516)）和 `workspace_create`
  （[RN-532](business-rules/runner.md#rn-532)）也没有，它们本来就随*那个*连接的 join 授权一起传输。第二，发现用的 JWT **不带 `projectId` claim**——防护比较 `payload.projectId !==
  request.params.projectId`，在路径中没有项目的路由上，两者都必须是 `undefined`；在那里签一个编造的项目 id 会被以一个说错原因的 403 拒绝。第三，**runner 从不猜测自己密钥的种类**：在磁盘上，机器密钥和项目密钥是同一种文件（带 `kid` 的私有 JWK），知道种类的是服务器，带名字的 403 会原样转达其消息和修正方式（`--project`），而不是被压扁成一个通用的连接失败。
  新模式要求*两者都有*：一个机器凭据和一个**经同意的 base**——没有 base，就无从推导每个项目的文件夹，而编造一个会在用户磁盘上写入一个他从未同意的路径；两者缺一，不带 `--project` 运行仍会打印用法。
- **`/runner` socket 的客户端*绝不能*让 `phoenix.js` 自行重连**（[RN-108](business-rules/web.md#rn-108)）。ticket 是一次性的，而内置的自动重连会重复*同样*的 `params`——因此不带 `reconnectAfterMs` 构造的 socket 会永远重试一个已失效的 ticket。这不是假设：`apps/runner/src/channel.ts` 曾经就是这样发布的，而它自己的 docblock 却声称相反，并在真实使用中测得——同一个 ticket 每 ~5.13s 被拒一次（库内部退避的上限），几个小时内 61 次 `REFUSED CONNECTION TO EngineWeb.RunnerSocket`，再加上 runner *自己*的重试策略，一分钟 530 个请求，而 `RATE_LIMIT_USER` 的上限是 300 req/min。这个限制是**按用户**的，所以拒绝服务落在了账户所有者的*浏览器*上，表现为 429——不涉及未认证的第三方，但一个构造不当的客户端就足以把自己的用户锁在外面。重连始终由调用方自己的策略负责，每次尝试都用新 ticket；该选项现在在类型中是*必填*的（`OpcoesDoSocket`），并由一个针对传给构造函数的选项的测试断言，因为一个只检查"能连上"的测试一直都是通过的。
- **两条 `/projects/:projectId/runner-device-keys` 路由*是*普通的会话 JWT**，与上面的 `runner-ticket` 相反——调用者是界面（设置中的设备密钥部分，以及识别已配对机器的
  `RunnerOnboardingPanel`）。在
  [ADR 0203](adr/0203-aposenta-o-fluxo-do-runner-pelo-navegador.md)
  （[RN-687](business-rules/web.md#rn-687)）之前还有第三条，一个 `POST`，浏览器借此登记它刚生成的 Ed25519 公钥（ADR 0118）。该流程已退役，路由随之移除，因为它没有其他调用者：密钥现在在机器上生成——`brabo-runner
  device-key create`（[RN-551](business-rules/runner.md#rn-551)）生成密钥对，并把私有部分以 600 模式写入磁盘，位于 `$XDG_CONFIG_HOME/brabo/`（否则为
  `~/.config/brabo/`）——并由安装程序通过下面的内部路由登记。私有部分仍然从不越过线路；越过的只有公开 JWK 和登记的 `id`。
  这个 CLI 刻意没有的，是一个用来登记的凭据——登记由持有 service token 的一方负责（安装程序，
  [ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md) 第 1 点），因此每一方恰好持有一个秘密，谁也看不到对方的。runner 读取的文件永远不会在没有 `kid` 的情况下存在：`create` 写入一个读取方会忽略的 `.parcial` 名称，`finish --id <id>` 加盖 id 并重命名。在 ADR 0203 *之前*由浏览器登记的项目密钥继续有效：`PatAuthGuard` 仍然接受它们，`GET` 列出它们，`DELETE` 吊销它们。`GET` 列出调用者自己的密钥，包括已吊销的（[RN-519](business-rules/api.md#rn-519)）——这正是让吊销变得可达的东西，在它出现之前，孤立的密钥（在自动配置流程中途关闭了标签页）是不可见且永久的。它从不返回公开 JWK：列表的存在是为了吊销，`lastUsedAt: null` 是孤立密钥的信号。`DELETE` 以幂等方式吊销调用者自己的密钥，格式与自助吊销 PAT 相同。之后在 `runner-ticket` 上接受由该密钥私有部分签名的 JWT 的是 `PatAuthGuard`，通过等于本表 `id` 的 `kid` 头查找；防护检查密钥未被吊销，但从不检查过期——密钥本身不过期，过期的只是 runner 每次用它签发的短 TTL JWT（≤60s，`exp - iat`）。自
  [RN-543](business-rules/produto.md#rn-543) 起，`GET` 返回*两种*，并*说明*哪个是哪个（`especie`）：*机器*密钥（`projectId: null`）服务其所有者的每个项目，因此出现在每个项目的列表中——否则它在每个界面上都将不可见且永久，正是 RN-519 已修复的缺陷在新种类中重生。创建*机器*密钥的路由是下面的
  `POST /internal/machine-device-keys`
  （[RN-552](business-rules/api.md#rn-552)）——另一条路由、另一个凭据、另一个调用者。它登记的密钥*材料*在机器上生成：
  `brabo-runner device-key create`
  （[RN-551](business-rules/runner.md#rn-551)）在本地生成 Ed25519 密钥对，只打印公开 JWK，因此私有部分从不传输。自
  [RN-547](business-rules/produto.md#rn-547) 起，`install.sh` 在安装结束时**把两者串起来**，并用得到的密钥安装机器 unit
  （[ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md)）——这让这条路由声明的代价变得真实，而不是假设。
  吊销*机器*密钥会请求 engine 在所有者能触及的*每个* runner 模式项目中断开存活的 runner——每个项目一次 `{project, user}` 调用，不触碰 engine。
- ***机器*密钥也可以按*账户*访问，路径中没有项目**（[RN-611](business-rules/api.md#rn-611)）：`GET /users/me/machine-device-keys`
  和 `DELETE /users/me/machine-device-keys/:deviceKeyId`，归类为 `jwt`，因为范围就是调用者本人，与 `/users/me/*` 的其余部分一样。
  它们之所以存在，是因为一行命令的安装在任何项目*之前*就创建了账户和机器密钥，而其他每个列表都需要 `:projectId`：在那里，密钥是存活的，却无法触及。它们刻意狭窄——只有*机器*密钥（项目密钥返回 404，与不存在或属于他人的密钥相同，因此不泄露任何东西），并且只有*调用者*的（`userId` 来自会话 JWT 并进入 `WHERE`；没有参数可以指定另一个用户，`maintainer` 视图被排除在外，正如 RN-519 所决定的）。
  `DELETE` 是与按项目路由相同的吊销，委托给同一个用例：断开*用*该密钥打开的存活连接，在每个项目中（自 [RN-685](business-rules/api.md#rn-685) 起目标是密钥，而不是
  `{project, user}`）；还没有项目时，它只记录吊销，这就是全部需要停止的东西——处于等待中的机器 agent（RN-550）没有连接，它的下一个 ticket 会被拒绝。
- **吊销设备密钥现在会触及*存活*连接，目标是 `{project, user}`——绝不是 `{key}`**
  （[RN-520](business-rules/api.md#rn-520)，[ADR 0147](adr/0147-agente-local-com-capacidades.md)
  第 6 点）。`DELETE` 原来只阻止*下一个* ticket：已连接的 `brabo-runner` 会保持 `terminal:<projectId>` 通道存活，用已吊销的密钥运行已批准的命令，直到它自己掉线。api 现在请求 engine（`POST /internal/projects/:projectId/runner/disconnect`）断开它，engine 找到通道的 pid——api 从不与通道通信，engine 从不读取密钥表。
  *不存在*的精度是按凭据的，这是 ticket 路径的性质，而不是偏好：`runner_socket_tickets` 只保存
  `project_id`/`user_id`/`kind`，别无其他，因此哪个 PAT 或哪个 `kid` 打开了那个 socket，在 `PatAuthGuard` 处就消失了，从未到达 engine。**声明的代价：** *同一*用户用 PAT 或同一项目的另一个密钥连接的 runner 也会掉线——并会自己重连，因为下一轮会请求新 ticket，而仍然有效的凭据能拿到它。同一项目中另一个用户的 runner 保持运行。断开连接是*附带效果*：engine 宕机、没有已连接的 runner 或超时，都绝不能让 `DELETE`（204，幂等）失败或变成 5xx——与 `rag_searches`（[RN-479](business-rules/api.md#rn-479)）和
  `mirror_sync_result`（[RN-517](business-rules/api.md#rn-517)）同一把尺子。
  **由 [RN-685](business-rules/api.md#rn-685)
  （[ADR 0201](adr/0201-revogacao-por-chave.md)）修订：现在目标是*密钥*。**
  ticket 记录请求它的凭据（`kid`，或 PAT 的 id），吊销会请求 engine
  （`POST /internal/runner/disconnect-credential`）作废该凭据的待用 ticket，并只断开由它产生的 runner——上面声明的代价消失了：同一用户用 PAT 或另一个密钥的 runner 保持运行。PAT 的吊销（自己的，或以 `maintainer` 身份）现在也会断开它的连接。用部署之前的 ticket（不带凭据）打开的连接仍按 `{project, user}` 这一对掉线，而不认识该路由的 engine 会让 api 退回到 `runner/disconnect`；这对组合的路由也保留为移除成员时的目标。
  PAT 拥有的 `maintainer` 视图（RN-427，列出/吊销*任何*用户的）对设备密钥是*排除在外*的——现在是出于决定，而非遗漏：那一对路由诞生于应对一个*共享*秘密在外流传的事故，而设备密钥的私有部分从不离开生成它的机器。这句话原来写的是"生成它的浏览器"，而
  [RN-551](business-rules/runner.md#rn-551) 扩大了生成方却没有削弱这个断言：终端现在是第二个生成器，私有部分仍然从不传输——离开的是公开 JWK。*改变*的是它存放的位置：在浏览器中生成的密钥落在用户选择的项目文件夹中，由 CLI 生成的落在 `$XDG_CONFIG_HOME/brabo/`，模式 600。两者都不是 api 可以触及的，上面的决定正依赖于此。
- **`engine-service` 路由并不是凭命名约定而"内部"的。**
  保护它们的是 `EngineServiceGuard` 以常数时间比较
  `X-Brabo-Service-Token` 与共享秘密，外加 NetworkPolicy。`/internal` 前缀是给人看的标志。它们通过 `@ServiceRoute()` 位于 **JWT 之外**：用户 token 在这里不起作用，service token 在其他任何路由上也不起作用——两种机制从不重叠（[RN-035](business-rules/api.md#rn-035)）。
- **`POST /internal/first-account` 是第二条创建*用户*的路径，并且在生产环境中可用**（[RN-546](business-rules/produto.md#rn-546)，
  [ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md)）。在这里声明，而不是留待被人发现。普通注册是第一条路径，没有被触动；这一条之所以存在，是因为一行命令的全新安装没法让任何人进入——生成的 `.env` 没有邮件变量，`MAIL_TRANSPORT` 落到 `log`，而注册在等待一封没人发送的邮件。

  它在构造上是狭窄的，有三个独立的原因。**它是
  `engine-service`**，所以打开它的是 `BRABO_SERVICE_TOKEN`——由 `install.sh` 自己生成并以 `600` 模式写入，使它成为对*机器*而非邮箱的控制证明。**只要安装中有*任何*用户，它就以 `409` 拒绝**，这是关于安装而非所请求邮箱的条件，因此不能用不同的地址反复调用，一旦有人存在它就永远沉默（包括迁移恢复之后，[RN-530](business-rules/infra.md#rn-530)）。
  **而且没有新增公开路由**：一个公开的"创建第一个 owner"是一个
  安装者与端口扫描者之间的竞速，而第一个 workspace 的 `owner` 不是任何人能通过 HTTP 找回的角色。

  账户诞生时邮箱已被验证，这是这条路由唯一放宽的东西——只针对一个命名的情形，绝不针对另一条路径。验证所证明的是*"这个人控制着这个邮箱"*；运行安装程序的人已经证明了对机器、`.env` 和 Docker daemon 的控制。密码在 TTY 中输入，无回显读取，用 argon2id 哈希后丢弃：绝不进入 `.env`，绝不进入标记文件，绝不进入日志，也绝不由任何代码生成。

  有一个窗口是声明而非关闭的："是否存在用户？"的检查在事务内运行，但 `READ COMMITTED` 无法阻止两个使用不同邮箱的并发调用同时通过。关闭它需要对"没有行"加 advisory lock，而约束并不在那里——能到达这条路由的人已经持有 service token，也就是已经控制了这个安装。
- **`POST /internal/machine-device-keys` 从机器秘密*铸造出持久的用户凭据***（[RN-552](business-rules/api.md#rn-552)，
  [ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md) 第 4 点）。这是 service token 拥有的最锋利的边缘，在这里声明的理由与上面的姊妹路由相同：创建第一个账户之后，安装程序的下一步是配对本地 agent，而配对需要凭据——唯一存在的凭据绑定在某个*项目*上，而这个安装还一个项目都没有。

  **代价，明明白白地说：** 泄露的 `BRABO_SERVICE_TOKEN` 现在可以*制造*一个设备密钥，以用户身份访问带角色检查的路由（`POST .../runner-ticket`，并经由它访问 runner 通道），而不仅仅是与内部路由通信。替代凭据——刚创建的用户本人的凭据——被考虑过并被否决，因为它与 [ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md) 本身相矛盾：密码在 TTY 中读取，*用后即弃*，第 5 点声明安装程序*"不替任何人登录"*，这正是第一个账户的响应刻意不带会话 token 的原因。在这里要求它，会迫使安装程序在机器上创建那个 ADR 拒绝创建的存活会话。

  三个约束位于*路由*中，而不是这段文字里。**请求体中没有 `userId`**：所有者是安装中*唯一*的用户，由 api 解析，因此 token 永远买不到"铸造哪个凭据"的选择——零个用户或多于一个时，它以 `409` 拒绝且不写入任何东西，与第一个账户的条件形式相同（关于安装，绝不关于参数），一旦安装有了团队就永久沉默。**登记即替换**：所有者现有的机器密钥在同一事务中被吊销，因此重装的机器是正当情形，而一千个机器密钥是不可能的——上限来自条款，而不是一个会过时的数字。**私有 JWK 会被点名拒绝**：存在 `d` 时响应 `400` 并说明收到了什么，依据与浏览器登记相同的领域规则，因为保存私有部分是这条路由最坏的结局。

  密钥授予的东西没有被扩大：它给予本地 agent 的恰好是所有者已经以 `developer` 身份能触及的项目，按所请求的项目解析（[RN-543](business-rules/produto.md#rn-543)）。有两个缺口是声明而非隐藏的：这里没有 `GET` 也没有 `DELETE`（列出会把一个人的凭据清单公开给只持有机器秘密的人；吊销已经存在于有人类所有者的地方），而在一个还没有任何项目的安装中，没有任何界面能触及机器密钥——这正是登记选择替换而不是留下孤儿的原因。
- **`/docs` 和 `/docs-json` *不在*表中，这是已知的缺口。** Swagger UI 由 `SwaggerModule.setup()` 在 Express 层挂载，而不是作为 controller，测试通过 `DiscoveryService` 枚举——它在结构上看不到它们。两者只在
  `NODE_ENV !== 'production'`（`main.ts`）时存在，是公开的，提供与
  [生成的参考文档](reference/api.html)发布的同一份文档。记录在这里而不是略去：测试触及不到的东西必须写在文字里。
- **`GET /projects/:projectId/agent-areas` 开始返回真实数据，分类未变**——仍是 `role:developer`，而上限的 `PATCH` 仍是 `role:maintainer`。在 FASE 18 之前，`agent_areas` 表从未被写入，路由对所有人都响应 `[]`，这让分类看起来是偶然的宽松，而不是决定。随着区域与项目一同诞生（[RN-094](business-rules/api.md#rn-094)），划分回到了 FASE 14d 的本意：**读取**上限是执行者的工作；**更改**它是在不询问的情况下决定产品花多少钱，这就是它要求与激活执行相同角色的原因。
- **五条 `/projects/:projectId/rag/*` 路由按与区域并行上限（RN-083）相同的标准划分角色**（PROGRAMA 28，Onda 4——
  RN-231..234，ADR 0080）：`search` 和 `coverage` 是 `role:viewer`（对已索引内容的纯读取），`reindex` 是 `role:maintainer`——它对项目仓库和 embedding 提供方发起 N 次调用，这与在其他昂贵触发路由上证明更高角色合理的"不询问就改变产品的花费"是同一回事。`local`（RN-455，ADR 0113）同样是
  `role:maintainer`，理由相同：它调用 embedding 提供方，并替换项目在该范围内已索引的内容。请求体是浏览器读取的*文本*，绝不是主机路径。
  `feedback`（RN-480）是 `role:viewer`，与 `search` *相同*的角色，上面的标准就是原因：投票不花费也不配置任何东西——它是观察，也是 RAG 测量（`medir:rag`）唯一的真实信号。把它提到 `maintainer` 会掏空这个信号而保护不了任何东西。投票仍在服务器上受约束：来自另一个项目的 `searchId`，或不在那次搜索结果中的 `chunkId`，是 400——没有位置的投票什么也测量不了。
- **四条 `/projects/:projectId/code/*` 路由是 `role:viewer` 且*只读***（FASE 26b）。查看项目代码与查看项目是同一权限——与 `GET /projects/:id/git/repository` 的划分相同。有三点让这种看似的宽松成为决定而不是疏忽：
  - **controller 中没有写入动词**，也不能有：代码标签页是用来读的，写入是外部效果，以 `proposed_action` 的形式诞生，属于后续阶段。这个文件里出现 `@Post` 是阶段的变更，而不是路由的变更；
  - **路径只在*一个*地方被约束**（[RN-095](business-rules/api.md#rn-095)），通过 [RN-092](business-rules/api.md#rn-092) 的同一个中央检查——而约束在这里比角色更重要，因为在远程提供方中，路径会成为提供方 API 的 URL 段，一个 `../` 换掉的是**端点**，而不是文件；
  - **花费的凭据是 workspace owner 的**
    （[RN-058](business-rules/api.md#rn-058)/[RN-082](business-rules/api.md#rn-082)），与写入时一样。读取消耗提供方的速率限制，这就是搜索有预算的原因：没有上限，`viewer` 可以随意膨胀 owner 的账单。
- **`GET /workspaces/:workspaceId/spend-report` 开始返回按提供方的切分，而这是按*凭据*的切分**
  （[ADR 0076](adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)，
  [RN-186](business-rules/api.md#rn-186)/[RN-187](business-rules/api.md#rn-187)）。
  没有新路由，也没有角色变更——仍是 `role:owner`，一如既往——但它*授予*的东西变了，这正是本说明存在的原因。ADR [0063](adr/0063-duas-audiencias-para-o-mesmo-gasto.md) 正是出于这个原因拒绝了这个维度；0076 经产品所有者决定对其进行了修订。现在守住边界的是*两道*独立的屏障：
  `GET /projects/:projectId/spend/me`（`role:viewer`）没有任何维度参数，而*类型*拒绝这种组合——带 `actor` 的范围只接受 `Exclude<SpendDimension, 'provider'>`，因此在成员视图中请求 provider 无法编译。第二道比之前的保证（"维度不存在"）弱，这就是为什么要两道。
- **`POST /projects/:projectId/sessions/:sessionId/socket-ticket` 在表中是
  `role:viewer`，但那是*下限*，不是上限**
  （RN-108）。`@RequireRole('viewer')` 覆盖 `scope: "heartbeat"`——已经存在的心跳/实时事件 socket；`scope: "terminal"` 要求 `developer`，在 `CreateSocketTicketUseCase` *内部*对照 `request.effectiveRole`（`RolesGuard` 已经解析的那个）检查，因为最低角色取决于请求*体*，而不仅仅是路由——与 `domain/actions/decide.ts` 中
  `MIN_ROLE_FOR_ACTION_TYPE.terminal` 相同的模式。目前没有真实路径请求 `scope: "terminal"`（交互式终端的 socket 属于 FASE 25）；这个值已经为它出现的那一天准备好了。
- **`POST /projects/:projectId/members` 在表中是 `role:maintainer`，这个角色是*必要*但不*充分*的**
  （[ADR 0127](adr/0127-tetos-de-rebaixamento-em-project-members.md)，
  [RN-472](business-rules/api.md#rn-472)）。它是上面 `socket-ticket` 说明的镜像：那里表中的角色是下限，请求体可以提高它；这里表中的角色是 `RolesGuard` 施加的整道闸门，然后用例**即使对拥有它的人也以 403 拒绝两种动作**——降级 *WORKSPACE* 的 `owner`，以及降级*自己*。没有新路由，也没有角色变更（`RequireRole('maintainer')`，一如既往）；变的是分类不再是"谁能在这里做什么"的完整答案。这不能放在 `RolesGuard` 中的原因与 `socket-ticket` 说明给出的相同——决定取决于请求*体*（`dto.role`）及其*目标*（`dto.userId`），而 guard 看不到——因此规则是
  `domain/iam/tetos-de-rebaixamento.ts` 中的纯函数，由
  `AddProjectMemberUseCase` 应用，采取 `domain/actions/decide.ts` 中绝对上限的*形式*（[RN-418](business-rules/api.md#rn-418)）：没有配置键，没有任何东西能打开它们。受保护的 `owner` 是 `workspace_members.role`，绝不是 `workspaces.created_by`。
  上限*不*覆盖的内容写在 ADR 和 RN 中。
- **`DELETE /projects/:projectId/members/:userId` 也是 `role:maintainer`，也不够**——自我降级上限的第二道门
  （[ADR 0156](adr/0156-teto-de-auto-rebaixamento-na-remocao.md)，
  [RN-556](business-rules/api.md#rn-556)）。ADR 0127 让这条路由没有上限，基于一个被证明是错误的前提——*"移除是良性的"*。删除 `project_members` 中的行并不会删除一个角色：它**替换**了有效角色，因为 `forProject` 是 `projectRole ?? workspaceRole`
  （[RN-471](business-rules/web.md#rn-471)）。一个通过项目行成为 `maintainer`、在 workspace 中是 `viewer` 的人会降级自己，而且在界面上不可逆——恢复该行是 `POST :projectId/members`，它要求刚刚放弃的 `maintainer`；在 workspace 中**没有**任何角色时，就跌落到没有访问权限。上限现在由 `RemoveProjectMemberUseCase` 施加，它不得不开始接收*执行者*（路由原来不传，因此不可能施加任何上限），规则*复用*
  `ehAutoRebaixamento`——`remocaoEhAutoRebaixamento` 委托给它，用 workspace 角色替代请求的角色，绝不是第二把尺子。
  上限 1 在这里**没有**对应，这是由测试锁定的决定：`owner` 是 `ROLE_ORDER` 的顶端，因此移除项目行只能*提升*该用户的有效角色——而这正是撤销上限 1 禁止创建的那种限制的方式。声明的代价，因为上限 2 没有阈值：从项目 `owner` 自我移除为 workspace `maintainer` 是可逆的，也同样被拒绝——唯一改变结果的良性动作，仍可由另一个 `maintainer` 完成。
- **`POST /workspaces/:workspaceId/members` 在表中是 `role:owner`，这也不再是完整答案**——这个家族中的第三条路由
  （[ADR 0157](adr/0157-teto-de-auto-movimento-no-upsert-de-workspace.md)，
  [RN-557](business-rules/produto.md#rn-557)）。ADR 0127 将这条路由命名为*高一层范围*的同类缺陷，ADR 0156 将其留作单独决定；它原是一个十二行的转发，**从不接收执行者**，因此不可能施加任何上限。这里比项目中更糟，有两个项目中不存在的原因：没有更高一层来接住跌落（在项目中，降级自己会把有效角色降到 workspace 的角色，后者常常能接住），而且这个 controller 中**根本没有成员的 `@Delete`**（已测量）——撤销就是这同一条路由，要求刚刚放弃的 `owner`。因此 `AddWorkspaceMemberUseCase` 现在接收执行者，并**以 403 拒绝更改*自己*的角色，两个方向都拒绝**。上限**不计算 owner 数量**，这是刻意的：条款没有会过时的数字（ADR 0127 的标准），而且它已经产生了计数本来要保证的不变式——workspace 永远不会降到零个 owner，因为移除最后一个需要那个 owner 自己来做。上限 1 **在这个范围内没有对应**，经过考虑而没有镜像：它是关于*层级反转*的规则，而 `@RequireRole('owner')` 已经让反转不可能——能调用的人永远不会低于被触及的人。加上它，再加上缺失的移除路由，会让 `owner` 成为一个吸收态，没有人能通过 HTTP 离开，而这正是 ADR 0127 要消除的那类状态。
  因此，降级**另一个** owner 仍然被允许——这是撤销所有权的唯一方式，并且可以由任何剩下的 owner 通过同一条路由逆转。
- **`DELETE /workspaces/:workspaceId/members/:userId` 是 `role:owner`，是同一家族的第五道门**
  （[ADR 0173](adr/0173-remocao-de-membro-de-workspace.md)，
  [RN-615](business-rules/api.md#rn-615)）。撰写 ADR 0157 时它还不存在——上面关于"没有成员的 `@Delete`"的那句话描述的是那个时刻。它承载同样的上限而没有新规则：`remocaoEhAutoRebaixamento`，以 workspace 角色作为当前有效角色，以*无*作为之后的角色，因为没有更高一层接住跌落——所以**移除自己总是 403**。同一条款保护了**最后一个 owner**，无需计数：只有 `owner` 调用这条路由，没有人移除自己，因此每次成功调用至少留下调用者作为 `owner`。移除**另一个** owner 是允许的（这是彻底撤销所有权的方式），上限 1 在这里仍然没有对应——`@RequireRole('owner')` 继续阻止层级反转。移除还会在一个事务中**级联**：目标在此 workspace 中的 `project_members` 行（没有
  它，"项目覆盖 workspace"的规则会让他留在他拥有自己行的每个项目中）、他的*项目*设备密钥，以及他在这里的 PAT（每个 PAT 都属于一个项目）；提交之后，他在每个项目中存活的 runner 连接会以尽力而为的方式，通过 RN-520 的路径被断开。声明而未做的：机器密钥（属于整个账户；由于角色解析为无，它们不再能触及这个 workspace），以及已连接的会话 socket。**名义所有者**（`workspaces.created_by`，agent 消耗的是其 LLM 和 git 凭据，RN-058）不能被移除：409
  `criador_do_workspace`，直到 `PUT /workspaces/:workspaceId/owner-of-record`
  （`role:owner`，目标必须已经是 `owner`，否则 409
  `titular_precisa_ser_owner`）将其转移——[RN-616](business-rules/api.md#rn-616)。
  任何 owner 都可以转移它，包括转给另一个没有提出请求的 owner。
- **`GET /workspaces/:workspaceId/members` 是 `role:viewer`，而不是旁边三条写入路由的 `owner`**（[RN-652](business-rules/web.md#rn-652)，
  AT-335）。最低要求属于端点（RN-102）：读取列表不等于维护它。`viewer` 是相邻读取所用的
  （`GET /workspaces/:workspaceId`、`/projects`），也是
  `GET /projects/:projectId/members` 所用的——这条路由正是对它的补充，因为仅凭 workspace 角色进入项目的人没有项目行。能打开会话的人可以看到谁在会话中发言，而 workspace 的 `viewer` 本来就能看到 workspace 的每个项目。响应体与项目读取的形式相同——`userId`、`name`、`email`、`role`——别无其他（没有 `createdAt`，没有账户状态）。
- **自我*提升*现在在两条成员关系路由上都被拒绝**，这也改变了
  `POST /projects/:projectId/members`。ADR 0127 曾把它记录为保留的能力（*"上限是关于下降的"*）；ADR 0157 修订了这一点。两半是同一个动作——一个人独自决定自己拥有什么权限——而上升的那一半是唯一**提升特权**的，恰恰是 ADR 0127 可以声称其上限从不做的事。重写*相同*的角色仍然通过：幂等的 upsert 不是动作。比较只在一处：`autoMovimentoDoProprioPapel` 返回*方向*而不是布尔值（调用者需要它来选择消息），`ehAutoRebaixamento` 作为它的一种读取方式保留下来，使*移除*这道门继续只看到向下的那一半，正如 ADR 0156 所决定的。
- **没有角色的 `jwt` 并不意味着没有授权。** 在
  `/users/me/*` 中，范围是用户本人；在 `GET /workspaces` 中，列表已经按调用者的成员关系过滤。
- **`X-Brabo-Service-Token` 现在在日志中被脱敏**
  （[ADR 0035](adr/0035-observabilidade-legivel-e-trace-sem-coletor.md)）。
  它承载 api↔engine 的全部流量，却**不在** pino 的 `redact` 列表中：如果它落入被记录的错误体，就会以明文并带着保留期进入 Loki。`serviceToken`、`privateKey`、
  `encryptedDek` 和 `dek` 一并加入。完整列表在
  `apps/api/src/infrastructure/observability/logger.config.ts`，并有一个测试断言每条路径——这个列表是契约，而不是方便。
- **CORS 的 `allowedHeaders` 是显式的**，列表必须包含 web 发送的每个请求头：`Content-Type`、`Authorization`、
  `X-CSRF-Token` 和 `traceparent`。缺一个不会让任何测试失败（没有测试做预检），却会让浏览器出错。
- **engine 只在健康检查路由上有 CORS**
  （[ADR 0037](adr/0037-cors-do-engine-e-a-porta-como-contrato.md)）。
  `/health`、`/live` 和 `/ready` 对 `WEB_ORIGIN` 的来源返回
  `Access-Control-Allow-Origin`；**`/internal/*` 和 `/metrics` 不返回**，而排除正是要点。13 条内部路由是带共享秘密的服务器到服务器通信（[RN-035](business-rules/api.md#rn-035)）；那里的 CORS 什么也启用不了——api 的 HTTP 客户端忽略这些请求头——，但它会**向浏览器宣告它是那个通道的预期客户端**。有一个测试断言其不存在，另一个断言路径列表恰好有三项，从而让边界的移动出现在 diff 中。
- **未知来源会得到响应，而不是 `403`。** 在两个服务中，请求都会被处理，返回时不带该请求头；阻止读取的是浏览器，决定权在它。响应 `403` 会破坏所有不发送 `Origin` 的客户端——kubelet 的探针、
  `curl`、`docker/smoke.sh`。
- **`POST .../delegations` 与其他内部路由一样是 engine-service**（Fase 8b 的 QA，Fase 8c 的 Infra——ADR 0038）——每个区域的 lead 记录每个被委派者的结果（`completed`/`failed`/`dispensed`），与该区域用来对外报告汇总结果的调用*分开*（QA 中的 `gates/verdict`，Infra 中的 `open_infra_pr`）。范围是会话，而不是任务——`taskId` 在请求体中可选。委派从不作为 handoff 可见。
- **`POST /projects/:projectId/execution/activate` 在请求体中新增了可选的 `originSessionId`，分类未变**
  ——仍是 `role:maintainer`（RN-135）。该字段让已拥有该角色的人关闭发起请求的*聊天*会话，但有两个约束防止用它关闭别人的会话：`findInProject(projectId, originSessionId)` 会静默拒绝不属于路径中*本*项目的 id，并且只有当 `GetSessionPendingWorkUseCase`（与不活动心跳相同的防护，[RN-073](business-rules/engine.md#rn-073)）确认那里没有挂起的 handoff、动作或回合时才会关闭。它永远不会关闭调用本身刚刚激活的执行会话。
- **`GET /internal/sessions/:sessionId/pending-work` 新增了
  `aguardandoUsuarioDesde`，没有任何路由改变分类**
  （[RN-581](business-rules/api.md#rn-581)）。仍是 `engine-service`：该字段是对话型 agent 回合结束的时刻，从 engine 已经写入的同一事件日志中读取，只决定 engine 让会话保持打开多久。同一条 RN 让追加对话的会话路由（`POST .../agents/:agent/message`、聊天、handoff、`POST .../agents/:agent/start`、
  `POST /internal/sessions/:sessionId/events`）在终止态会话上响应 **409**
  `sessao_encerrada`——这是按*状态*的拒绝，在角色检查之后，绝不是新角色。会话响应中的 `terminationReason` 新增了一个有文档的值，`conversation_idle_timeout`。
- **当项目没有仓库时，`POST /projects/:projectId/execution/activate` 以 `409` 拒绝，分类未变**
  ——仍是 `role:maintainer`（[RN-582](business-rules/api.md#rn-582)，
  [ADR 0165](adr/0165-o-repositorio-nasce-no-handoff-ao-arquiteto.md)）。拒绝发生在任何效果之前。消息根据项目的 handoff 选择，在其*所有*会话中读取——因此它可以说"接受给 Arquiteto/Dev Lead 的 handoff"。它透露的只是该 handoff 存在及其状态，项目的任何 `viewer` 都已经能通过 `GET .../sessions/:sessionId/handoffs` 读到；它从不点名会话或用户。
- **向已在项目中活跃的 agent 提供 handoff 是 `409`
  `agente_ja_ativo`，分类未变**——人工路由
  `POST .../sessions/:sessionId/handoffs` 仍是 `role:developer`，内部路由仍是 `engine-service`（[RN-635](business-rules/api.md#rn-635)，
  [ADR 0182](adr/0182-ciclo-de-vida-do-handoff.md)）。与上面的拒绝不同，这个*会*点名一个会话：消息说明目标在同一项目的哪个会话中活跃，因为这是 agent 作为工具结果读到的文本，也是人需要用来去找它对话的指针。项目的任何 `viewer` 都已经能列出其会话并在每个会话中读取 `agent.activated`，因此没有任何东西跨越项目边界。同样的路由现在响应*当前*的提议，而不是总是新的一行（`desfecho`），内部路由接受 `seAusente`——一个只能让调用写入*更少*的键。
- **内部的 `POST /internal/sessions/:sessionId/handoffs` 现在可以*接受*它创建的 Criativo→PO 提议，分类未变**——仍是 `engine-service`（[RN-658](business-rules/api.md#rn-658)，
  [ADR 0185](adr/0185-estou-pronto-fecha-os-dois-gates.md)）。engine 并没有获得激活 agent 的权力：做决定的是 api，依据一个*人*通过 `POST .../readiness`（`role:developer`，与通过卡片接受相同的最低要求）记录的 `readiness.confirmed`，并把这个人记录为执行者。engine 无法伪造这个标记——它从不写 `readiness.confirmed`——而且提议必须携带在那次点击之后、在同一会话中产生的 `product_brief`。`POST .../agents/criativo/validate-necessity` 保留路由和角色，在 web 中没有调用者（[RN-657](business-rules/api.md#rn-657)）。
- **`GET /projects/:projectId/execution/session` 是 `role:viewer`，与 `GET /sessions/:sessionId` 角色相同**
  （[RN-139](business-rules/api.md#rn-139)）。它返回项目*当前*的执行会话——`active` 且已记录 `execution.activated`——或 `null`；绝不是项目最近的会话，那正是执行者标签页原来读取的东西，它会在另一个会话在其后诞生的那一刻悄无声息地切换会话。
- **`GET /workspaces/:workspaceId/projects-summary` 新增了
  `roster.activatedAgents`，分类未变**——仍是
  `role:viewer`。该字段是在项目最近会话中有 `agent.activated` 的 agent id 列表（[RN-630](business-rules/api.md#rn-630)），在已经产生 `executionActivated` 和 `gatesEverOpened`（[RN-568](business-rules/web.md#rn-568)）的同一次逐会话扫描中计算。它不点名用户、会话或凭据，也不增加查询。
- **`POST .../llm-turn` 和 `POST .../llm-turn-stream` 在响应体/最终帧中新增了 `modelName`，分类未变**——一如既往仍是 `engine-service`
  （[RN-146](business-rules/api.md#rn-146)）。模型名称本来就为调用提供方而被解析；它只是开始传回 engine，后者将其包含在 `agent.response` 的 payload 中。没有读取新数据，没有暴露新凭据——它就是 `token_usage` 中已经出现的那个名称。
- **`PUT /projects/:projectId/agent-autonomy` 开始接受
  `actionType: "*"`——"自动模式"（[RN-153](business-rules/api.md#rn-153)）
  ——分类未变：**仍是 `role:maintainer`，与旁边的 `GET` 相同。区别在于请求体现在*授权*了什么，而不是谁能调用：通配符一次性为 agent 的*任何*动作类型授予自主权，而不是像以前那样一次一种类型。解析（*具体*规则总是胜过通配符）完全位于仓储层（`DrizzleAgentAutonomyRepository.findMode`），绝不在 `decide()` 中——后者仍然只接收已经解析好的 `PermissionPolicy`，与通配符出现之前完全一样。这就是三个绝对上限——在受保护分支上合并、`instruction_patch`、`parallelize`/`raise_max_parallel`——即使通配符处于 `auto_approve` 也仍然阻止的原因（[RN-154](business-rules/api.md#rn-154)）：它们对 `current.policy === 'auto_approve'` 作出反应，从不关心它来自哪里，无需在 `decide()` 中加入任何例外就能继续有效。`ApprovalCard.tsx` 只向已知拥有 `maintainer`/`owner` 的客户端提供写入通配符的按钮——但真正保证角色的是这同一个、未改变的 `@RequireRole('maintainer')`。
- **Jev 工具路由器是一次新的*出站*调用，携带 agent 上下文**
  （[ADR 0179](adr/0179-o-laco-pergunta-ao-jev-qual-ferramenta.md)，
  [RN-625](business-rules/engine.md#rn-625)）。在对 OpenRouter 模型发起聊天调用之前，api 用 workspace owner 的 OpenRouter 密钥向 `https://openrouter.ai/api/alpha/decisions`（Decisions API，alpha）发 POST——与聊天已在消耗的*同一个*密钥，在同一个用例中解密，绝不记录，也绝不返回。传输的是 `state`：agent id、用户的最后一条消息（截断到 6,000 个字符）、系统消息的开头（1,500）以及最多六次最近的工具调用，参数和结果各截断到 500 个字符——外加工具的*名称*和*描述*，绝不包括它们的 `parameters`。这是聊天调用已经发送给同一个 OpenRouter 账户的内容，只是更小的一片，但现在它会到达其后的第二个模型（`typesafe/jev-1.13`）。开关按 workspace 设置（`PUT /workspaces/:workspaceId/tool-router`，`role:owner`，默认开启），并且只在使用 OpenRouter 聊天模型时触发。路由器缩小工具菜单，仅此而已：它不能批准、拒绝或扩大任何东西，模型在菜单之外发起的调用仍会在同一策略下成为 Proposed Action。调用的任何失败都会回落到完整目录。
- **`POST .../actions/:actionId/approve_always` 在响应中新增了 `desfecho` 和
  `padraoGravado`，分类未变**——仍是 `role:developer`（[RN-642](business-rules/api.md#rn-642)）。批准和写入的模式现在共享一个事务；点击一个已经*批准*的动作会以 `201` 和 `desfecho: "ja_aprovada"` 响应，而不是
  `409`，而*被拒绝*的动作仍以 `409`（`acao_ja_recusada`）响应，且不写入任何东西。RN-418 的上限和 `container_remove` 仍会在读取任何状态之前以 `400` 被拒绝，因此幂等路径永远不会写入上限禁止的模式。
- **一个 git 错误获得了新的命名响应：`409 merge_conflict`**——没有路由、角色或 guard 变化（[RN-704](business-rules/api.md#rn-704)）。
  `GitProviderErrorFilter` 将 `GitMergeConflictError`（本地仓库的合并发现冲突）映射为 `409`，消息中带有冲突文件；目标 ref 保持不变，pull request 保持打开。在审批流水线中，`git_merge` 动作以该消息结束为 `failed`，与 `GitPullRequestAlreadyMergedError` 相同的路径。
- **`GET /projects/:projectId/actions` 接受 `status=failed`**——同一条路由，同样的 `developer` 角色（[RN-705](business-rules/api.md#rn-705)）。此前只接受
  `pending`；`failed` 列出项目中执行失败的动作，并且*要求* `actionType`（没有它则 `400`），使读取针对一种类型，而绝不是整个历史。它返回与待处理读取相同的 `ProposedAction` 形式；失败的 git 动作现在携带它自己的 `kind`、错误消息，以及在合并冲突时冲突文件的名称——同一角色已经能在 diff 中读到的仓库路径。

## 表格 {#table}

<!-- INÍCIO DA TABELA — o teste parseia daqui até o fim do documento. -->

| método | caminho | classificação |
|---|---|---|
| GET | `/.well-known/jwks.json` | public |
| POST | `/auth/login` | public |
| POST | `/auth/logout` | public |
| GET | `/auth/oauth/:provider/callback` | public |
| GET | `/auth/oauth/:provider/start` | public |
| POST | `/auth/refresh` | public |
| POST | `/auth/register` | public |
| POST | `/auth/request-password-reset` | public |
| POST | `/auth/reset-password` | public |
| POST | `/auth/verify-email` | public |
| GET | `/gates` | jwt |
| GET | `/git/oauth/:provider/callback` | public |
| GET | `/health` | public |
| GET | `/live` | public |
| GET | `/metrics` | public |
| GET | `/runner-releases/binary` | public |
| POST | `/internal/sessions/:sessionId/actions` | engine-service |
| GET | `/internal/sessions/:sessionId/anamnese-context` | engine-service |
| POST | `/internal/sessions/:sessionId/anamnese-window` | engine-service |
| POST | `/internal/sessions/:sessionId/delegations` | engine-service |
| GET | `/internal/sessions/:sessionId/dev-context` | engine-service |
| POST | `/internal/sessions/:sessionId/epics` | engine-service |
| GET | `/internal/sessions/:sessionId/events` | engine-service |
| GET | `/internal/sessions/:sessionId/pending-work` | engine-service |
| POST | `/internal/sessions/:sessionId/events` | engine-service |
| POST | `/internal/sessions/:sessionId/gates/verdict` | engine-service |
| POST | `/internal/sessions/:sessionId/handoffs` | engine-service |
| POST | `/internal/sessions/:sessionId/hypotheses` | engine-service |
| GET | `/internal/sessions/:sessionId/infra-artifacts/:prActionId/files` | engine-service |
| GET | `/internal/sessions/:sessionId/infra-context` | engine-service |
| POST | `/internal/sessions/:sessionId/infra-gates/verdict` | engine-service |
| POST | `/internal/sessions/:sessionId/instruction-patches` | engine-service |
| POST | `/internal/sessions/:sessionId/max-parallel-proposals` | engine-service |
| POST | `/internal/sessions/:sessionId/llm-turn` | engine-service |
| POST | `/internal/sessions/:sessionId/llm-turn-stream` | engine-service |
| POST | `/internal/sessions/:sessionId/c4-diagram` | engine-service |
| POST | `/internal/sessions/:sessionId/module-map` | engine-service |
| POST | `/internal/sessions/:sessionId/module-routing` | engine-service |
| POST | `/internal/sessions/:sessionId/module-contracts` | engine-service |
| POST | `/internal/sessions/:sessionId/project-image` | engine-service |
| POST | `/internal/sessions/:sessionId/proficiency` | engine-service |
| POST | `/internal/models/sync` | engine-service |
| GET | `/internal/graph/prompt-templates/:name` | engine-service |
| POST | `/internal/graph/prompt-templates` | engine-service |
| POST | `/internal/rag/search` | engine-service |
| POST | `/internal/rag/feedback` | engine-service |
| GET | `/internal/gates` | engine-service |
| GET | `/internal/projects/:projectId/git-remote` | engine-service |
| GET | `/internal/projects/:projectId/business-rules` | engine-service |
| GET | `/internal/projects/:projectId/backlog` | engine-service |
| GET | `/internal/projects/:projectId/product-metrics` | engine-service |
| GET | `/internal/projects/:projectId/module-contracts` | engine-service |
| POST | `/internal/projects/:projectId/workspace-verification` | engine-service |
| POST | `/internal/projects/:projectId/container-exec` | engine-service |
| POST | `/internal/projects/:projectId/mirror-sync-result` | engine-service |
| GET | `/internal/projects/:projectId/container-spec` | engine-service |
| POST | `/internal/first-account` | engine-service |
| POST | `/internal/machine-device-keys` | engine-service |
| GET | `/internal/sessions/:sessionId/psychologist-context` | engine-service |
| POST | `/internal/sessions/:sessionId/stories` | engine-service |
| POST | `/internal/sessions/:sessionId/stories/:storyId/complete` | engine-service |
| POST | `/internal/sessions/:sessionId/stories/:storyId/update` | engine-service |
| POST | `/internal/sessions/:sessionId/stories/:storyId/archive` | engine-service |
| POST | `/internal/sessions/:sessionId/semantic-duplicate-check` | engine-service |
| POST | `/internal/sessions/:sessionId/story-modules` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/:taskId/block` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/:taskId/unblock` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/:taskId/gate/open` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/:taskId/status` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/claim` | engine-service |
| GET | `/internal/sessions/:sessionId/tasks/in-progress-by-dev` | engine-service |
| POST | `/internal/sessions/:sessionId/termination` | engine-service |
| GET | `/` | jwt |
| GET | `/runner/projects` | jwt |
| GET | `/llm/provider-capabilities` | jwt |
| GET | `/users/me/credentials` | jwt |
| POST | `/users/me/credentials` | jwt |
| POST | `/users/me/credentials/:provider/test` | jwt |
| DELETE | `/users/me/credentials/:provider` | jwt |
| POST | `/users/me/git-credentials` | jwt |
| GET | `/users/me/machine-device-keys` | jwt |
| DELETE | `/users/me/machine-device-keys/:deviceKeyId` | jwt |
| GET | `/users/me/preferences` | jwt |
| PATCH | `/users/me/preferences` | jwt |
| POST | `/users/me/preferences/detected-language` | jwt |
| GET | `/workspaces` | jwt |
| POST | `/workspaces` | jwt |
| DELETE | `/projects/:projectId` | role:maintainer |
| GET | `/projects/:projectId` | role:viewer |
| PATCH | `/projects/:projectId` | role:maintainer |
| PUT | `/projects/:projectId/execution-mode` | role:maintainer |
| PUT | `/projects/:projectId/mirror-path` | role:maintainer |
| GET | `/projects/:projectId/mirror-state` | role:viewer |
| GET | `/projects/:projectId/models` | role:viewer |
| GET | `/projects/:projectId/actions` | role:developer |
| GET | `/projects/:projectId/agent-autonomy` | role:maintainer |
| PUT | `/projects/:projectId/agent-autonomy` | role:maintainer |
| DELETE | `/projects/:projectId/agent-bindings/:agentSlug` | role:developer |
| GET | `/projects/:projectId/agent-bindings/:agentSlug` | role:viewer |
| PUT | `/projects/:projectId/agent-bindings/:agentSlug` | role:developer |
| DELETE | `/projects/:projectId/area-bindings/:areaKey` | role:maintainer |
| GET | `/projects/:projectId/area-bindings/:areaKey` | role:viewer |
| PUT | `/projects/:projectId/area-bindings/:areaKey` | role:maintainer |
| GET | `/projects/:projectId/agent-costs` | role:developer |
| GET | `/projects/:projectId/agents/:agent/instruction-versions` | role:viewer |
| POST | `/projects/:projectId/agents/:agent/instruction-versions/:version/rollback` | role:maintainer |
| POST | `/projects/:projectId/anamnese/run` | role:maintainer |
| GET | `/projects/:projectId/architecture` | role:viewer |
| GET | `/projects/:projectId/backlog` | role:viewer |
| GET | `/projects/:projectId/budget` | role:maintainer |
| PUT | `/projects/:projectId/budget` | role:maintainer |
| GET | `/projects/:projectId/agent-areas` | role:developer |
| PATCH | `/projects/:projectId/agent-areas/:key/max-parallel` | role:maintainer |
| PUT | `/projects/:projectId/agent-areas/:key/budget` | role:maintainer |
| GET | `/projects/:projectId/code/blame` | role:viewer |
| GET | `/projects/:projectId/code/branches` | role:viewer |
| GET | `/projects/:projectId/code/file` | role:viewer |
| GET | `/projects/:projectId/code/pull-requests` | role:viewer |
| GET | `/projects/:projectId/code/pull-requests/:pullRequestId/diff` | role:viewer |
| GET | `/projects/:projectId/code/search` | role:viewer |
| GET | `/projects/:projectId/code/tree` | role:viewer |
| POST | `/projects/:projectId/rag/search` | role:viewer |
| POST | `/projects/:projectId/rag/reindex` | role:maintainer |
| POST | `/projects/:projectId/rag/local` | role:maintainer |
| POST | `/projects/:projectId/rag/feedback` | role:viewer |
| GET | `/projects/:projectId/rag/coverage` | role:viewer |
| GET | `/projects/:projectId/container` | role:viewer |
| GET | `/projects/:projectId/container/lifecycle` | role:viewer |
| GET | `/projects/:projectId/coverage` | role:viewer |
| GET | `/projects/:projectId/events/:eventId` | role:viewer |
| POST | `/projects/:projectId/execution/activate` | role:maintainer |
| GET | `/projects/:projectId/execution/session` | role:viewer |
| GET | `/projects/:projectId/git/:provider/connect` | role:maintainer |
| POST | `/projects/:projectId/git/:provider/repository` | role:maintainer |
| POST | `/projects/:projectId/git/:provider/repository/adopt` | role:maintainer |
| GET | `/projects/:projectId/git/bootstrap` | role:viewer |
| GET | `/projects/:projectId/git/bootstrap/plan` | role:viewer |
| POST | `/projects/:projectId/git/bootstrap/plan/approve` | role:maintainer |
| POST | `/projects/:projectId/git/bootstrap/plan/skip` | role:maintainer |
| POST | `/projects/:projectId/git/bootstrap/acknowledge-protection-failure` | role:maintainer |
| GET | `/projects/:projectId/git/repository` | role:viewer |
| GET | `/projects/:projectId/hypotheses` | role:viewer |
| POST | `/projects/:projectId/hypotheses/:hypothesisId/accept` | role:developer |
| POST | `/projects/:projectId/hypotheses/:hypothesisId/dismiss` | role:developer |
| GET | `/projects/:projectId/infra-artifacts` | role:viewer |
| GET | `/projects/:projectId/instruction-versions` | role:viewer |
| GET | `/projects/:projectId/members` | role:viewer |
| POST | `/projects/:projectId/members` | role:maintainer |
| DELETE | `/projects/:projectId/members/:userId` | role:maintainer |
| GET | `/projects/:projectId/model-binding` | role:viewer |
| PUT | `/projects/:projectId/model-binding` | role:maintainer |
| GET | `/projects/:projectId/model-bindings/resolved` | role:viewer |
| GET | `/projects/:projectId/permissions` | role:maintainer |
| PUT | `/projects/:projectId/permissions` | role:maintainer |
| POST | `/projects/:projectId/personal-access-tokens` | role:developer |
| GET | `/projects/:projectId/personal-access-tokens` | role:developer |
| GET | `/projects/:projectId/personal-access-tokens/all` | role:maintainer |
| DELETE | `/projects/:projectId/personal-access-tokens/:tokenId` | role:developer |
| DELETE | `/projects/:projectId/personal-access-tokens/:tokenId/admin` | role:maintainer |
| GET | `/projects/:projectId/open-questions` | role:viewer |
| POST | `/projects/:projectId/open-questions/:questionId/answer` | role:viewer |
| GET | `/projects/:projectId/run-instructions` | role:viewer |
| GET | `/projects/:projectId/runner-device-keys` | role:developer |
| DELETE | `/projects/:projectId/runner-device-keys/:deviceKeyId` | role:developer |
| GET | `/projects/:projectId/proficiency` | role:viewer |
| DELETE | `/projects/:projectId/proficiency/me` | role:viewer |
| POST | `/projects/:projectId/proficiency/me/opt-in` | role:viewer |
| GET | `/projects/:projectId/psychologist/analyses` | role:viewer |
| GET | `/projects/:projectId/psychologist/status` | role:viewer |
| POST | `/projects/:projectId/runner-ticket` | role:developer |
| POST | `/projects/:projectId/terminal-ticket` | role:viewer |
| GET | `/projects/:projectId/sessions` | role:viewer |
| POST | `/projects/:projectId/sessions` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId` | role:viewer |
| PATCH | `/projects/:projectId/sessions/:sessionId` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/actions` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions/:actionId/approve` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions/:actionId/approve_always` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/actions/:actionId/deny` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/cancel` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/message` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/messages/:messageId/cancel` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/start` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/structured-question/:questionSetId/answer` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agentId/rearm` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/arquiteto/handoff-infra` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/criativo/validate-necessity` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/budget` | role:developer |
| PUT | `/projects/:projectId/sessions/:sessionId/budget` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/chat` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/events` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/events` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/events/:eventId` | role:viewer |
| GET | `/projects/:projectId/sessions/:sessionId/context-summary` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/execution/parallelize` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/handoffs` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/handoffs` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/handoffs/:handoffId/accept` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/model-binding` | role:viewer |
| PUT | `/projects/:projectId/sessions/:sessionId/model-binding` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/psychologist/reanalyze` | role:maintainer |
| POST | `/projects/:projectId/sessions/:sessionId/readiness` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/response-language` | role:viewer |
| PUT | `/projects/:projectId/sessions/:sessionId/response-language` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/socket-ticket` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/tasks/:taskId/unblock` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/token-usage` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/transition` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/reopen` | role:developer |
| POST | `/projects/:projectId/tasks/:taskId/gates/:gate/resume` | role:developer |
| GET | `/projects/:projectId/spend/me` | role:viewer |
| POST | `/projects/:projectId/stories/:storyId/return` | role:developer |
| PATCH | `/projects/:projectId/stories/:storyId/title` | role:developer |
| POST | `/projects/:projectId/stories/:storyId/archive` | role:developer |
| POST | `/projects/:projectId/stories/promote` | role:developer |
| DELETE | `/workspaces/:workspaceId` | role:owner |
| GET | `/workspaces/:workspaceId` | role:viewer |
| PATCH | `/workspaces/:workspaceId` | role:maintainer |
| GET | `/workspaces/:workspaceId/members` | role:viewer |
| POST | `/workspaces/:workspaceId/members` | role:owner |
| DELETE | `/workspaces/:workspaceId/members/:userId` | role:owner |
| PUT | `/workspaces/:workspaceId/owner-of-record` | role:owner |
| PUT | `/workspaces/:workspaceId/tool-router` | role:owner |
| GET | `/workspaces/:workspaceId/model-binding` | role:viewer |
| PUT | `/workspaces/:workspaceId/model-binding` | role:maintainer |
| GET | `/workspaces/:workspaceId/credential-spend` | role:owner |
| GET | `/workspaces/:workspaceId/spend-report` | role:owner |
| GET | `/workspaces/:workspaceId/huggingface/models` | role:maintainer |
| POST | `/workspaces/:workspaceId/huggingface/pull-requests` | role:maintainer |
| POST | `/workspaces/:workspaceId/huggingface/pull-requests/:id/confirm` | role:maintainer |
| GET | `/workspaces/:workspaceId/huggingface/pull-requests/:id` | role:maintainer |
| POST | `/workspaces/:workspaceId/models/activate` | role:owner |
| GET | `/workspaces/:workspaceId/models/catalog` | role:maintainer |
| POST | `/workspaces/:workspaceId/models/sync` | role:owner |
| POST | `/workspaces/:workspaceId/models/uses` | role:owner |
| GET | `/workspaces/:workspaceId/models/:modelId/price-changes` | role:maintainer |
| PATCH | `/workspaces/:workspaceId/models/:modelId/pricing` | role:owner |
| GET | `/workspaces/:workspaceId/projects` | role:viewer |
| POST | `/workspaces/:workspaceId/projects` | role:maintainer |
| GET | `/workspaces/:workspaceId/projects-base` | role:maintainer |
| GET | `/workspaces/:workspaceId/project-folders` | role:maintainer |
| GET | `/workspaces/:workspaceId/projects-status` | role:viewer |
| GET | `/workspaces/:workspaceId/projects-summary` | role:viewer |
| GET | `/workspaces/:workspaceId/summary` | role:viewer |
| POST | `/workspaces/:workspaceId/unread-events` | role:viewer |
| GET | `/workspaces/:workspaceId/containers` | role:viewer |
