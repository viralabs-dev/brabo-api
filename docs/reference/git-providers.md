---
id: git-providers
title: Providers de git
sidebar_label: Providers de git
sidebar_position: 5
description: O contrato de quinze operações que torna Local, GitHub e GitLab intercambiáveis, com capabilities, erros normalizados e política de retry.
keywords: [git, GitProvider, GitHub, GitLab, capabilities, retry]
---

# Providers de git

O Brabo trabalha em cima de um repositório git de verdade, e três backends
cumprem esse papel: **Local** (repositórios bare em disco), **GitHub** e
**GitLab**. O código de domínio não sabe qual está em uso — ele fala com um
contrato único.

Decisões nos ADRs [0001](../adr/0001-git-provider-contract-shape.md) a
[0005](../adr/0005-repo-bootstrap-idempotent-steps.md) e
[0028](../adr/0028-protecao-de-branch-divergencia-entre-providers.md).

## O contrato

`GitProviderContract`, em `packages/shared/src/index.ts`. O contrato tem **quinze operações** —
a décima entrou na Fase 4a, com os gates de PR; a 11ª e a 12ª na FASE 26, com
a aba Código (só leitura); a 13ª, a 14ª e a 15ª na FASE 26b, a fundação das
pendências declaradas dessa mesma aba (blame, PRs navegáveis, branch rica —
ainda sem tela que as consuma):

| operação | devolve |
|---|---|
| `createRepo` | `GitRepo` |
| `getRepo` | `GitRepo` |
| `createBranch` | `GitBranch` |
| `protectBranch` | — |
| `listBranches` | `GitBranch[]` |
| `commitFiles` | `GitCommitResult` |
| `getFileContent` | `string \| null` — `null` se o arquivo (ou a branch) não existe |
| `openPullRequest` | `GitPullRequest` |
| `mergePullRequest` | `GitPullRequest` — PR já mergeada é recusada (`GitPullRequestAlreadyMergedError` no `local`; o GitHub recusa ele mesmo o merge repetido), [RN-663](../business-rules/api.md#rn-663). No `local` é um merge de verdade: fast-forward quando o alvo é ancestral, senão um commit de merge com dois pais; conflito lança `GitMergeConflictError` (arquivos listados, ref alvo intocada, PR continua aberta, HTTP 409 `merge_conflict`). GitHub/GitLab recusam o merge com conflito pela própria API, sem tradução, [RN-704](../business-rules/api.md#rn-704) |
| `commentOnPullRequest` | — (veredito de QA/SecOps na PR) |
| `listTree` | `GitTree \| null` — `null` se a ref ou o caminho não existem |
| `getPullRequestDiff` | `GitPullRequestDiff \| null` — `null` se a PR não existe |
| `blame` | `GitBlame \| null` — `null` se o arquivo (ou a ref) não existe |
| `listPullRequests` | `GitPullRequestList` — resumo por PR, não `GitPullRequest[]` |
| `listBranchesDetailed` | `GitBranchDetailList` — `ahead`/`behind`/PR associada por branch |

Mais dois campos: `name` e `capabilities`.

### As duas operações de leitura (FASE 26)

`listTree` lista **um nível** da árvore, nunca a árvore inteira: a aba Código
navega sob demanda, e pedir tudo num repositório grande é o amplificador de
tráfego que a fase proíbe. `path` ausente ou `""` é a raiz; cada entrada traz o
`path` completo e o `name` (a folha).

`getPullRequestDiff` normaliza o diff em `status`
(`added|modified|removed|renamed`), `additions`, `deletions` e `patch`. O
`patch` é `string | null`, e a distinção importa: `null` quer dizer **não
voltou** (binário, ou patch grande demais para a resposta), enquanto `""`
quereria dizer "voltou vazio". Fundir os dois faria a tela dizer "sem
mudanças" para um binário alterado.

As duas ausências seguem o vocabulário que `getFileContent` já usava — `null`,
não exceção — para a aba Código tratar "não existe" de um jeito só.

**Tetos.** As duas cortam, e avisam por `truncated: true`. Os números moram em
`apps/api/src/domain/git/git-read-limits.ts` (1000 entradas por nível, 300
arquivos por diff) e **não** em `packages/shared`, que é 100% tipos — um
`export const` ali sobrevive ao `tsc` e quebra o boot da api em produção
(guardado por `apps/api/test/packages-shared-so-tipos.spec.ts`).

### As três operações de fundação (FASE 26b — RN-110/111/112)

Fundação para as três pendências declaradas da aba Código (blame, dropdown de
branch rico, lista de PRs navegável) — a tela de cada uma é onda posterior, em
três agentes separados. As três seguem o vocabulário de ausência que
`getFileContent`/`listTree`/`getPullRequestDiff` já usavam: `null`, nunca
exceção, quando o recurso não existe.

`blame(ref, path)` anota cada linha com o commit que a tocou por último —
sha, autor, data, primeira linha da mensagem. É a **única** operação que fala
GraphQL: a API REST do GitHub não tem blame, só a API GraphQL
(`repository.object(expression:).blame(path:)`). O GitLab usa
`RepositoryFiles.allFileBlames`; o Local usa `git blame --porcelain`. Ela corta
em `GIT_BLAME_LINE_LIMIT` (2000 linhas). O Local lê a saída do `git` com teto de
64 MiB por chamada (`GIT_MAX_BUFFER`); o padrão do Node, 1 MiB, derrubava
`show`, `blame` e o diff de arquivo maior que isso.

`listPullRequests(state?)` devolve `GitPullRequestSummary[]` — id, número,
título, autor, estado, branches, `updatedAt` — **não** `GitPullRequest[]`, que
é o tipo de ESCRITA (abrir/mergear) e nunca teve título nem autor. O `local`
lista do MESMO armazenamento lateral de PRs da Fase 4a. Corta em
`GIT_PR_LIST_LIMIT` (100, uma página, sem paginação seguinte).

`listBranchesDetailed(defaultBranch)` é operação **própria**, não extensão de
`listBranches` — veja na tabela de capabilities abaixo o porquê. Cada branch
enriquecida ganha `ahead`/`behind` (relativos a `defaultBranch`, que o
CHAMADOR já sabe e passa — perguntá-la de novo ao provider seria uma chamada a
mais) e a PR associada aberta, se houver. `null` nos dois números quando o
provider não consegue calcular (branch órfã, histórico sem relação) —
degradação honesta, nunca número inventado. Corta em
`GIT_BRANCH_DETAIL_LIMIT` (30 branches).

### O teto da CHAMADA e o teto do CONSUMO (FASE 26b)

Os dois números acima limitam o que um provider devolve em **uma** chamada. A
superfície HTTP que os consome tem tetos próprios, no mesmo arquivo, e eles
respondem outra pergunta: quantas CHAMADAS um único pedido do cliente pode
disparar. `listTree` é barato uma vez e caro mil vezes.

O que força a distinção é a **busca da aba Código**, que **não é operação
deste contrato** — nenhum dos três providers a tem. GitHub e GitLab têm busca
de código de plataforma, com semântica e limites próprios; o
`LocalGitProvider` é um repositório bare e não tem nada parecido. Declará-la
aqui seria ou uma 13ª operação com capability `false` no local (uma aba que
some num provider), ou o vocabulário de uma plataforma vazando para o contrato
normalizado que existe justamente para impedir isso.

Então ela fica **composta na camada de aplicação**
(`application/use-cases/git/read-project-code.use-case.ts`), em cima de
`listTree` + `getFileContent`, com três orçamentos — diretórios percorridos,
arquivos abertos e ocorrências devolvidas — mais um cache de TTL curto
(`domain/git/git-read-cache.ts`) para navegar e buscar não repetirem as mesmas
chamadas. Quem paga é a credencial do **owner do workspace**
([RN-058](../business-rules/api.md#rn-058)/[RN-082](../business-rules/api.md#rn-082)),
e o rate limit é o do provider — veja a [RN-095](../business-rules/api.md#rn-095)
e o [ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md).

## Capabilities

Nem todo backend faz tudo, e isso é **declarado**, não descoberto na falha:

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

As duas capabilities da FASE 26, e as três da FASE 26b, são `true` nos três
porque a **suíte de contrato as exercita nos três** — é o mesmo critério dos
ADRs 0041/0042, que vale também para git: capability só é declarada depois de
provada, e sem prova declara-se `false` e degrada. O Local as cumpre com
`git ls-tree`/`git diff`/`git blame --porcelain`/`git rev-list --left-right
--count` no repositório bare, sem plataforma nenhuma por trás — é o único dos
três providers testado contra git REAL (`local-git-provider.contract.spec.ts`);
GitHub e GitLab rodam contra os backends falsos do msw, e os smokes reais
(`{github,gitlab}-provider.smoke.spec.ts`) continuam pulados sem
`GITHUB_TEST_TOKEN`/`GITLAB_TEST_TOKEN` no ambiente — a mesma situação já
documentada na FASE 13a para os providers de LLM.

`pullRequestsList` merece nota à parte: a suposição original era que o `local`
não teria PRs, "conceito de repositório único não tem PR" — ela não se
sustentou. O armazenamento lateral de PRs da Fase 4a (autossuficiente para os
dev agents) já é a fonte, e as três capabilities do `local` terminaram `true`.

Uma degradação declarada, e ela é de DADO, não de operação: o GitLab não traz o
tamanho do arquivo na listagem da árvore (`RepositoryTreeSchema` não tem esse
campo, e pedi-lo por entrada custaria um request por arquivo), então `size`
volta `null` ali. A operação existe e funciona; o que falta é uma coluna.

O provider Local implementa PRs internamente (não há servidor para hospedá-las,
mas o fluxo existe) e **não** implementa proteção de branch — não há
plataforma para aplicá-la. Chamar `protectBranch` nele lança
`GitNotSupportedError`, um erro explícito, nunca um no-op silencioso
([RN-028](../business-rules/contracts.md#rn-028)).

> **Capability não é o portão.** A proteção de branch da plataforma é defesa
> em profundidade. O que impede um merge indevido é o **teto no domínio**, que
> funciona igual nos três providers, inclusive no Local, que não tem proteção
> nenhuma ([RN-006](../business-rules/api.md#rn-006)). O
> [ADR 0028](../adr/0028-protecao-de-branch-divergencia-entre-providers.md)
> documenta a divergência entre GitHub e GitLab e por que ela não muda a
> garantia.

## Erros normalizados

Cada provider traduz o erro da própria plataforma para uma destas classes. O
domínio nunca vê um 422 do GitHub nem um `fatal:` do git:

| erro | quando |
|---|---|
| `GitRepoAlreadyExistsError` | criar repositório que já existe |
| `GitRepoNotFoundError` | repositório não existe ou sem acesso |
| `GitBranchNotFoundError` | branch não existe |
| `GitBranchAlreadyExistsError` | criar branch que já existe |
| `GitPermissionDeniedError` | credencial válida, permissão insuficiente |
| `GitNotSupportedError` | operação fora das `capabilities` daquele provider |
| `GitCredentialConnectionTestFailedError` | o teste de conexão da credencial falhou — **não** chega ao HTTP: `TestStoredCredentialUseCase` o captura e devolve `refused` ([ADR 0050](../adr/0050-credencial-sempre-cifrada-verificacao-explicita.md)) |
| `GitProviderAuthError` | credencial inválida ou expirada |
| `InvalidOauthStateError` | o `state` do OAuth não confere |

**Não há classe base comum**, e isso foi decidido, não esquecido: o
[ADR 0002](../adr/0002-git-error-normalization.md) registra que um `GitError`
abstrato foi considerado e rejeitado por não se pagar enquanto nenhum filtro
HTTP precisa dele.

A distinção que mais importa na prática é `GitPermissionDeniedError` contra
`GitProviderAuthError`: o primeiro quer dizer "o token é válido mas não pode
fazer isto", o segundo "o token não funciona". Confundir os dois manda o
usuário se autenticar de novo quando o problema era escopo.

## Retry

**Só em leitura, nunca em mutação**
([ADR 0003](../adr/0003-git-provider-retry-policy.md)).

O algoritmo é o Full Jitter, da AWS:
`sleep = random(0, min(maxDelay, base · 2^attempt))`, com 4 tentativas por
padrão. `apps/api/src/infrastructure/git/retry.ts`.

A assimetria é a decisão inteira: repetir um `listBranches` que estourou o
tempo é inofensivo; repetir um `commitFiles` que pode ter passado cria commit
duplicado. Quando não há como saber se a mutação aconteceu, a resposta certa é
falhar e deixar um humano olhar.

## A suíte de contrato

Uma suíte única — `apps/api/test/contract/git-provider.contract.ts` — roda
contra os **três** providers. É ela que garante que "funciona no Local" não
vire "funciona só no Local".

É também o mecanismo que mantém as `capabilities` honestas: um provider que
declara `protectBranch: true` precisa passar nos testes de proteção; um que
declara `false` precisa lançar `GitNotSupportedError`. Declarar errado quebra a
suíte nos dois sentidos.

Duas guardas acompanham a suíte, em
`apps/api/test/contract/git-provider-contract-callers.spec.ts`. A primeira
confere que o cabeçalho da suíte lista exatamente quem a invoca. A segunda é o
item 33 da FASE 26: **operação do contrato sem consumidor em `src/` reprova o
CI** — uma operação que os três providers implementam e ninguém chama é peso
permanente, e nada prova que ela funciona no caminho real.

A válvula para uma fase entregar contrato antes das rotas é estreita e
nomeada: o mapa `SEM_CONSUMIDOR_AINDA`, com a fase que vai consumi-la escrita
ao lado de cada operação. Ela se fecha sozinha — assim que a operação ganha
consumidor, a entrada passa a **reprovar**, obrigando quem escreveu a rota a
apagá-la.

**O mapa está vazio desde a FASE 26b**, e foi esvaziado pelo mecanismo, não
pela memória de alguém: assim que
`application/use-cases/git/read-project-code.use-case.ts` passou a chamar
`listTree` e `getPullRequestDiff`, o segundo teste reprovou apontando as duas
entradas pelo nome. Vazio, e não removido — a válvula continua disponível para
o próximo contrato que nascer antes do consumidor.

:::caution O falso tem de mentir do mesmo jeito que o remoto
A suíte roda contra backends falsos (msw) para os providers remotos, e um falso
mais GENEROSO que a API real deixa a suíte verde enquanto o produto quebra. Foi
o que aconteceu com o repositório vazio: o falso do GitHub respondia `404` para
uma ref inexistente, o GitHub de verdade responde
**`409 Git Repository is empty`**, e o bootstrap morria no primeiríssimo passo
de todo projeto GitHub novo — com a suíte inteira verde. Ao acrescentar um caso
ao falso, confira a resposta contra a API viva, não contra o que parece
razoável.
:::

### O primeiro commit num repositório vazio

Um repositório GitHub recém-criado não tem commit nenhum (`auto_init: false`),
e ali a **Git Data API inteira** responde `409` — refs, blobs, trees, commits.
Não há como montar o primeiro commit por ela. O que funciona é a Contents API
(`PUT /repos/:owner/:repo/contents/:path`), que cria arquivo, commit e branch
de uma vez; é o que `commitFiles` usa quando detecta que o repositório está
vazio.

Com **um** arquivo — o caso do bootstrap, que commita um por passo — sai
exatamente um commit, como o contrato promete. Com mais de um, o primeiro nasce
pela Contents API (é ele que cria a branch) e o resto entra num segundo commit
pelo caminho normal: dois commits em vez de um, degradação declarada porque a
alternativa seria recusar o commit inicial com vários arquivos.

O `LocalGitProvider` não passa por nada disso: o `git init --bare` dele aceita
o primeiro commit pelo caminho de sempre.

## Bootstrap do Gitflow

Cinco passos que preparam o repositório do projeto: branches permanentes
(`dev`, `qa`, `main`), proteções onde o provider as suporta, e arquivos base.

Eram seis: havia um passo `create_rc_branch`, que criava o degrau `rc` entre
`qa` e `main`. O degrau saiu da política pelo
[ADR 0030](../adr/0030-politica-de-branches-mecanizada.md) e o passo saiu do
bootstrap depois, quando se notou o descompasso — o produto criava, protegia e
**documentava no repositório do usuário** uma escada de quatro degraus que ele
mesmo tinha abandonado. O valor `create_rc_branch` continua no enum
`bootstrap_step` do banco: bootstraps antigos têm linhas com ele, e um passo
que aconteceu de verdade não se apaga.

Duas propriedades, as duas testadas
([ADR 0005](../adr/0005-repo-bootstrap-idempotent-steps.md),
[RN-029](../business-rules/api.md#rn-029)):

**Idempotente** — cada passo confere antes de agir. Rodar duas vezes não
duplica nada.

**Retomável** — falhou no passo 4? A retomada começa no 4, não no 1.

Cada passo emite seu próprio evento, e há cinco desfechos possíveis:

| evento | quer dizer |
|---|---|
| `bootstrap.step_started` | começou |
| `bootstrap.step_completed` | fez o trabalho |
| `bootstrap.step_skipped` | já estava feito — **isto é sucesso** |
| `bootstrap.step_degraded` | concluiu sem uma capability (proteção de branch no Local) |
| `bootstrap.step_failed` | falhou; a retomada começa aqui |

`skipped` e `degraded` existem separados de `completed` de propósito: um
bootstrap que pulou tudo porque o repositório já estava pronto é um desfecho
diferente de um que fez tudo, e um que rodou sem proteção de branch é
diferente dos dois. Fundir os três em "ok" perderia exatamente a informação
que alguém vai querer depois.

## Adotar um repositório existente (Fase 12a)

Um projeto pode apontar para um repositório que **já existe**, em vez de criar
um. `project_repositories.origin` diz qual dos dois foi
([RN-046](../business-rules/api.md#rn-046)).

A adoção usa **só o que o contrato já tinha**: `getRepo` valida o acesso —
existia desde a Fase 2 e nenhum caso de uso a chamava — e o diagnóstico usa
`listBranches` e `getFileContent`. **Nenhum método novo entrou no contrato, e a
suíte de contrato ficou intocada.**

O bootstrap NÃO roda na adoção. O que sai é um **plano**: a lista serializada
do que ele faria, obtida chamando o `check()` de cada passo — o mesmo que dá a
idempotência — sem executar nada. O usuário então aprova o plano inteiro, ou
adota como está e dispensa o bootstrap
([RN-045](../business-rules/api.md#rn-045)).

| evento | quer dizer |
|---|---|
| `bootstrap.repository_adopted` | o repositório passou a ser do projeto; nada nele foi mudado |
| `bootstrap.plan_approved` | o usuário aprovou — **só a partir daqui o bootstrap roda num repositório adotado** |
| `bootstrap.adopted_as_is` | o usuário dispensou o bootstrap; o plano fica guardado como prova do que não foi aplicado |

**Proteção divergente é presença × ausência, e só isso.** O contrato expõe
`GitBranch.protected` como booleano, e o
[ADR 0028](../adr/0028-protecao-de-branch-divergencia-entre-providers.md)
adiou uma `ProtectionPolicy` normalizada — então o plano consegue dizer "`qa`
está desprotegida → aplicaria" e "`main` já está protegida → não toca", mas não
consegue dizer que a proteção existente exige dois revisores e a nossa exigiria
um. Branch com proteção PARCIAL conta como desprotegida, e pode ser
sobrescrita — sempre dentro de um plano aprovado.

Branch que o template não conhece (`develop`, `release/*`) vira
**diagnóstico informativo** e nunca é tocada: um repositório adotado tem a
política que tiver.

Decisão no [ADR 0044](../adr/0044-adocao-de-repositorio-existente.md).

## Credenciais

Tokens de git são segredos de usuário: criptografados com envelope encryption,
uma DEK por registro, nunca em texto puro no banco nem em logs. A tabela é
`project_git_connections`, e ela participa da rotação da chave mestra junto com
as credenciais de LLM — veja o
[runbook](../runbook.md#rotacao-da-chave-mestra).

O cadastro usa um enum próprio no banco (`credential_provider`), unido aos
providers de LLM **só no nível do tipo TypeScript**, sem misturar os enums
([ADR 0004](../adr/0004-git-credential-registration.md)).

Dois caminhos de conexão: **PAT** (token colado) e **OAuth** (GitHub e
GitLab). O OAuth exige `GITHUB_OAUTH_CLIENT_ID`/`_SECRET` ou o par do GitLab
configurado; sem eles, só PAT
([configuração](configuration.md#git)).

## O que não existe

Bitbucket e um `GenericGitProvider` estão **fora de escopo** — não são backlog
esquecido, são decisão. Acrescentar um provider novo é implementar todas as
quinze operações, declarando as capabilities com honestidade, e passar na
suíte de contrato.

**Escrever pela aba Código também não existe.** As sete operações de leitura
(`listTree`, `getPullRequestDiff`, `blame`, `listPullRequests`,
`listBranchesDetailed`, mais `getFileContent` e a busca composta) são só
leitura, e é isso. Salvar arquivo pela aba é fase futura, e quando vier,
escrever é efeito externo: nasce como `proposed_action`, como toda mutação de
git. O que torna isso verificável em vez de só intenção é que o
`CodeController` não tem **um único** verbo de escrita — nenhum `@Post`,
nenhum `@Put`, nenhum `@Patch`, nenhum `@Delete` — mesmo depois de a FASE 26b
acrescentar três rotas a ele.
