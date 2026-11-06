---
id: autenticacao
title: 'Regras de negócio — Autenticação'
sidebar_label: Autenticação
description: 'As RNs do auth first-party: refresh com rotação, sessão em cookie, PAT, OAuth e chave de dispositivo.'
keywords: [regras de negócio, autenticação, refresh, cookie, PAT, OAuth]
---

# Autenticação

> Estas RNs saíram de [`business-rules.md`](../business-rules.md) sem
> mudar uma vírgula do conteúdo: a página única passava de 640 KB e
> estas duas seções sozinhas eram metade dela. As âncoras `#rn-NNN`
> continuam idênticas — só o arquivo que as hospeda mudou.

Regras do auth first-party. Todas valem no domínio da api, que desde a 7.2 é
também o **emissor** dos tokens de acesso — o Keycloak saiu num corte atômico,
sem período de coexistência.
Decisões em [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)
e [ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md).

### RN-030 — Reapresentar um refresh já usado revoga a família inteira {#rn-030}

Cada refresh consome o token apresentado e emite um filho com o **mesmo**
`family_id` e o mesmo `family_started_at`. Apresentar um token que já foi
consumido é a assinatura de um roubo — alguém está usando uma cópia — e a
resposta é revogar todos os tokens vivos daquela família, com evento de
segurança.

O usuário legítimo é deslogado junto. Isso é o comportamento correto, não um
defeito: do lado do servidor, um duplo-submit do cliente e um replay de ladrão
são idênticos.

- **Onde:** `apps/api/src/domain/auth/refresh-token.ts:50` +
  `application/use-cases/auth/refresh.use-case.ts:98`
- **Teste:** `test/application/use-cases/auth/rotacao-e-reuso.spec.ts`
- **Borda:** quem apresenta um token de família **já revogada** é vítima a
  jusante, não novo roubo: registra `refresh_revoked` e **não** dispara segunda
  cascata. Sem essa distinção, cada aba do usuário legítimo geraria um alarme
  falso durante o incidente.
- **Origem:** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-031 — Falha de login é contada por e-mail e por IP, e o bloqueio escala {#rn-031}

Janela deslizante de 15 minutos no Postgres, sem Redis. Dois baldes por
tentativa e o mais restritivo vence: e-mail (5 falhas → 30s, 8 → 5min, 12 →
15min) e IP (20 → 30s, 30 → 2min). Um login bem-sucedido limpa o balde do
e-mail; o de IP drena só por tempo.

A chave do balde é o **e-mail normalizado**, nunca o id do usuário. Com id, o
balde só existiria depois de encontrar a conta, e o próprio lockout viraria
oráculo de existência.

- **Onde:** `apps/api/src/domain/auth/lockout-policy.ts:97` +
  `infrastructure/persistence/drizzle/drizzle-login-throttle.ts:74`
- **Teste:** `test/application/use-cases/auth/lockout.spec.ts`
- **Borda:** enquanto bloqueado, a tentativa **não** é registrada. Se fosse, um
  atacante manteria a conta da vítima travada para sempre só continuando a
  tentar — o lockout viraria negação de serviço contra quem ele protege.
- **Por quê:** o balde de IP não pode ser limpo no sucesso; quem tem uma conta
  válida zeraria a janela à vontade e pulverizaria palpites sem limite.
- **Origem:** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-032 — Nenhuma resposta distingue conta existente de inexistente {#rn-032}

Qualquer resposta diferente da falha uniforme só é alcançável **depois** de uma
verificação de senha bem-sucedida. No login, e-mail inexistente, senha errada e
conta bloqueada devolvem o mesmo 401 e gastam o mesmo tempo — o ramo sem conta
verifica contra um hash dummy gerado com **os mesmos parâmetros** do real. No
registro e no pedido de reset, endereço conhecido e desconhecido devolvem 202.

- **Onde:** `apps/api/src/application/use-cases/auth/login.use-case.ts:79` +
  `register.use-case.ts:74`
- **Teste:** `test/application/use-cases/auth/enumeracao.spec.ts`
- **Borda:** a checagem de bloqueio por e-mail roda **depois** do argon2, não
  antes. Sair mais cedo é a otimização que qualquer revisor sugeriria, e é
  exatamente o vazamento — o teste fica vermelho se alguém a introduzir.
- **Borda:** o usuário MIGRADO do Keycloak (existe em `users`, sem linha em
  `auth_credentials`) também recebe o 401 uniforme — e o link de "definir
  senha" é disparado em silêncio. Responder `password_pending` confirmaria que
  o endereço existe **e** que é conta legada. Por isso `findByEmail` é um LEFT
  JOIN numa consulta só: duas consultas encadeadas fariam esse ramo pagar uma
  ida a mais ao banco, e o relógio revelaria o que o corpo esconde.
- **Por quê:** o que se afirma é "nenhum ramo pula o trabalho caro e nenhum
  produz resposta distinguível", **não** tempo constante. Ver as consequências
  no ADR.
- **Origem:** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md),
  borda do migrado em
  [ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

### RN-033 — Token de verificação e de reset vale uma vez só {#rn-033}

Consumo por UPDATE condicional com `returning`: o próprio UPDATE é a guarda.
Zero linhas cobre inexistente, de outro propósito, já consumido, invalidado e
expirado — todos com a mesma resposta. Pedir um link novo invalida o anterior.
Concluir um reset revoga **todas** as sessões do usuário e não emite tokens.

- **Onde:** `apps/api/src/infrastructure/persistence/drizzle/account-token.repository.ts:76`
- **Teste:** `test/application/use-cases/auth/tokens-de-conta.spec.ts`
- **Borda:** dois envios simultâneos não passam os dois. A corrida é o caso
  **normal**, não a exceção: scanner de e-mail corporativo abre todo link de
  toda mensagem, então o robô costuma consumir o token antes do humano clicar.
- **Por quê:** o reset não emite sessão de propósito — logar direto a partir de
  um link recebido por e-mail faria comprometer o e-mail equivaler a tomar a
  conta, sem segundo passo.
- **Origem:** [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)

### RN-034 — A sessão da web vive em cookie httpOnly, com CSRF {#rn-034}

O refresh token vai num cookie `brabo_refresh` (`httpOnly`, `SameSite=Strict`,
`Path=/auth`, `Secure` em produção) e **não** aparece no corpo de nenhuma
resposta. O access token, de 15 minutos, fica em memória no cliente e viaja no
`Authorization: Bearer`.

`/auth/refresh` e `/auth/logout` exigem `X-CSRF-Token` igual ao cookie
`brabo_csrf`, comparado em tempo constante.

- **Onde:** `apps/api/src/interfaces/http/auth/session-cookies.ts:53` +
  `interfaces/http/auth/auth.controller.ts`
- **Teste:** `test/interfaces/session-cookies.spec.ts`
- **Borda:** falha de CSRF é **403**, não 401. Com 401 o cliente tentaria
  renovar a sessão e entraria em laço — a credencial está boa, quem está errada
  é a requisição.
- **Por quê:** devolver o refresh também no corpo anularia o `httpOnly` —
  bastaria um XSS ler a resposta do login, e levaria a sessão longa em vez dos
  15 minutos do access.
- **Origem:** [ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

### RN-035 — O tráfego interno engine ↔ api exige o segredo de serviço {#rn-035}

As 32 rotas `/internal/*` são `@ServiceRoute()`: ficam fora do JWT de usuário e
fora do rate limit. Quem autentica é o `EngineServiceGuard`, comparando
`X-Brabo-Service-Token` com `BRABO_SERVICE_TOKEN` em tempo constante. O mesmo
segredo vale nos dois sentidos, e `BRABO_SERVICE_TOKEN_PREVIOUS` é aceito só na
verificação, para a rotação não ter janela de indisponibilidade.

- **Onde:** `apps/api/src/interfaces/http/auth/engine-service.guard.ts:44` +
  `infrastructure/security/service-token.ts` +
  `apps/engine/lib/engine_web/plugs/verify_service_token.ex`
- **Teste:** `apps/engine/test/engine_web/plugs/verify_service_token_test.exs`
  e `test/interfaces/route-surface.spec.ts`
- **Borda:** a isenção de rate limit vem do METADADO da rota, não do guard. O
  `RateLimitGuard` é `APP_GUARD` e roda antes de qualquer guard de controller —
  quando ele decide, o `EngineServiceGuard` ainda não rodou.
- **Origem:** [ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)

### RN-128 — `sessionId`/`projectId`/`agent`/`agentId` são validados ANTES de virar segmento de URL da requisição interna ao engine {#rn-128}

`HttpApiToEngineClient` interpola estes valores em template string pra
montar a URL de `/internal/*` — sem DTO/`class-validator` no meio, igual
à [RN-127](../business-rules/custo.md#rn-127): eles chegam de `@Param`/lookup de sessão sem pipe de
validação em algum ponto da cadeia, e nada garante a forma deles antes da
interpolação. Um valor malicioso poderia injetar segmento de path extra
ou caracteres que quebram a URL montada — o `EngineServiceGuard` autentica
o CHAMADOR (RN-035), não CONFERE o que o chamador manda na URL.

`garantirSegmentoDeUrlInterna` reusa a mesma largura de
`NOME_DE_PASTA_VALIDO` (RN-092/109) — hex, hífen e sublinhado, 1 a 64
chars — e é chamada em DOIS lugares, cobrindo TODOS os métodos que
interpolam id em URL, não só os que o CodeQL reportou:

- dentro de `postCommand`, que a maioria dos métodos já usa
  (`startAgent`, `sendAgentMessage`, `confirmReadiness`, `cancelAgentTurn`,
  `offerInfraHandoff`, `offerDevHandoff`, `invalidateInstructions`,
  `startExecution`, `acceptParallelization`, `rearmDevAgent`,
  `reviseStory`) — o chamador lista as tuplas `(nome, valor)` que já
  interpolou no `path`, e `postCommand` valida TODAS antes de montar a
  requisição;
- direto em `reanalyzeSession`/`runAnamnese`, que não passam por
  `postCommand` (precisam distinguir 503 de falha de transporte) e por
  isso eram os dois únicos pontos que o CodeQL alcançou.

O caminho feliz não muda: `sessionId`/`projectId` são sempre UUID vindo do
banco, e `agent`/`agentId` são sempre slug curto.

- **Onde:** `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  (`garantirSegmentoDeUrlInterna`, `postCommand`)
- **Teste:** `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts`
  (id malformado é recusado ANTES de tocar a rede — provado apontando
  `ENGINE_URL` pra uma porta que nada escuta — e o caminho feliz chega a
  fazer a requisição)
- **Origem:** alerta CRÍTICO do CodeQL (URL de requisição interna montada
  com valor não validado) bloqueando a promoção qa→main, achado durante a
  PR #256; mesmo padrão do [RN-092](../business-rules/custo.md#rn-092)

### RN-105 — Sem imagem decidida pelo Arquiteto, o container não sobe e o Code não abre {#rn-105}

A aba Code (`GET /projects/:id/code/*`, [ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md))
responde **409** enquanto o projeto estiver em `sem_decisao` — o estado inicial
de todo projeto. `sem_decisao` vira `decidido` só quando o Arquiteto emite
`artifact.project_image` pela ferramenta `choose_project_image`, com imagem OCI
de tag explícita (`latest` recusado), `rationale` e postura de rede.

A checagem mora no MESMO funil que a contenção de caminho da
[RN-095](../business-rules/custo.md#rn-095) (`ReadProjectCodeUseCase.alvo`), e não em cada uma das sete
rotas (árvore, arquivo, busca, diff de PR, [blame](#rn-110), [lista de
PRs](#rn-111) e [branches detalhadas](#rn-112), FASE 26b) — checagem
duplicada em sete chamadores é checagem que um dia diverge em um deles
([ADR 0058](../adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md)).
Contagem corrigida aqui: este registro dizia "quatro rotas" desde a FASE 26,
e ficou desatualizado quando a FASE 26b acrescentou as três últimas ao mesmo
funil sem que ninguém revisasse este número.

O artefato não tem tabela: é o próprio evento no event log, versionado
(`version` cresce a cada emissão, o vigente é o de maior `version`), do mesmo
jeito que `artifact.module_map`. Revisar a imagem é emitir uma versão nova,
nunca sobrescrever a anterior.

- **Onde:** `apps/api/src/domain/containers/project-container.ts`,
  `apps/api/src/application/use-cases/containers/decidir-imagem-do-projeto.use-case.ts`,
  `apps/api/src/application/use-cases/containers/obter-container-do-projeto.use-case.ts`,
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts` (método
  `portaoDoContainer`), `apps/engine/lib/engine/harness/tools/choose_project_image.ex`
- **Teste:**
  `apps/api/test/domain/containers/project-container.spec.ts`,
  `apps/api/test/application/use-cases/containers/container-do-projeto.use-case.spec.ts`,
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (bloco "o portão do container")
- **Borda:** 409 e não 403 — nada está errado com quem pediu nem com a
  permissão dele; o recurso ainda não existe NESTE ESTADO. E não é 404: a aba
  existe, só não está liberada. A mensagem diz o que falta, para a tela mostrar
  o motivo em vez de um erro mudo (RN-088).
- **Origem:** [ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-106 — `git push`, PR e deploy não saem pelo terminal — mesmo dentro do escopo do projeto {#rn-106}

**REVISADA pela [RN-418](../business-rules.md#rn-418) (ADR 0102, decisão GLOBAL do dono do
produto)**: o `deny` que este registro descreve virou TETO ABSOLUTO
(`require_approval` incondicional) — o resto desta entrada é histórico,
fiel ao que valia até a revisão.

Dentro do container do projeto o agente é livre (ADR 0065): o allowlist de
verbos do [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) não
converge (achados Z e AD — verbo, forma e invocação são espaços distintos), e a
saída é a parede, não uma lista mais longa. Mas três efeitos atravessam a
parede e chegam no mundo, e a decisão do usuário foi textual: *"agente livre
para o que quiser desde que não seja comandos de git ligado ao deploy e ao PR —
estas ações ainda devem ser humanas"*.

`decide()` reconhece `git push`, `git remote add/set-url`, `git merge`, os CLIs
de provider (`gh pr create`, `gh pr merge`, `glab mr create/merge`, releases e
workflow dispatch) e os comandos de deploy comuns (`kubectl apply`, `helm
upgrade`, `terraform apply`, `docker push`, `npm publish`, ...) por PREFIXO de
tokens, ignorando flags globais no meio (`git -C /tmp push` casa). Qualquer
segmento do comando composto que case é **`deny`** — não `require_approval`:
"sempre permitir" grava o padrão em `allow`, e um clique bastaria para a
segunda porta ficar aberta para sempre. `deny` vence `allow` em qualquer
estágio, e é aplicado ANTES de qualquer estágio permissivo em `decide()`.

Negar não tira poder do agente: a mensagem redireciona para a ação TIPADA
(`git_push`, `git_merge`, `pr_open`) — que nasce `proposed_action`, tem papel
mínimo próprio e registra no event log o que foi empurrado e para onde. É o
caminho que o dev agent já usa (`agent_io.ex` propõe `git_push`); o que muda é
que agora está garantido por `deny`, não só combinado por convenção.

- **Onde:** `apps/api/src/domain/actions/external-effect.ts`,
  `apps/api/src/domain/actions/decide.ts` (bloco "FRONTEIRA DO CONTAINER")
- **Teste:** `apps/api/test/domain/actions/external-effect.spec.ts`,
  `apps/api/test/domain/actions/decide.spec.ts` (describe "a fronteira do
  container")
- **Borda:** a fronteira NÃO se sobrepõe à trava de merge em branch protegida
  (RN-014, sempre manual) nem ao escopo de caminho (RN-095/ADR 0055) — as três
  regras coexistem, cada uma vetando por um motivo diferente.
- **Origem:** [ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-107 — A aba Code tem um QUARTO estado: bloqueada por decisão pendente {#rn-107}

Os três estados da [RN-088](../business-rules.md#rn-088) (carregando/erro/vazio) não descrevem
`sem_decisao` ([RN-105](#rn-105)): não é carregando (a api já respondeu), não é
erro (ela respondeu CERTO) e não é vazio (não falta dado — falta uma DECISÃO,
que é outra coisa). Tratar `sem_decisao` como "vazio" mostraria um editor sem
arquivos, convidando a pensar que o repositório está vazio; tratar como "erro"
faria a tela sugerir "tentar de novo" para algo que só o Arquiteto resolve.

A aba pergunta o estado do container ANTES de tentar ler código
(`GET /projects/:id/container`), em vez de esperar a primeira árvore ou
arquivo devolver 409 — a mesma checagem que a api já faz no funil de
`ReadProjectCodeUseCase` (RN-105), só que perguntada primeiro, para o quarto
estado nascer como mensagem própria e não como o rodapé de um erro genérico.
Enquanto bloqueada, a tela reconsulta sozinha a cada 15s — depois de decidida
a imagem não muda sem ação humana nova, e ficar reconsultando um estado
estável seria a mesma família de tráfego desnecessário da PÓS-FASE 15.

A apresentação do quarto estado foi EXTRAÍDA para `ContainerImageGateNotice`
(`apps/web/src/components/ContainerImageGate.tsx`) — achado de uso: a aba PRs
(`apps/web/src/routes/code/PrListAndDiff.tsx`, consumida por
`ProjectPrsTab.tsx` e por `CodeDiffPanel.tsx`) chama `getCodePullRequests`/
`getCodeDiff`, que passam pelo MESMO funil (RN-105) e podem devolver o MESMO
409 — mas, ao contrário desta aba, sem perguntar antes. Ela mostrava esse 409
no banner de erro genérico com "Tentar de novo", a afordância errada para um
estado que só o Arquiteto resolve. `isContainerImageGateError`
(`apps/web/src/lib/api-client.ts`) identifica a causa pelo `status === 409`
— única causa de `ConflictException` em `ReadProjectCodeUseCase.alvo` — e
`PrListAndDiff` troca o banner por `ContainerImageGateNotice` quando ela bate,
sem pré-checagem própria (reage ao 409 da query que já ia rodar).

- **Onde:** `apps/web/src/routes/ProjectCodeTab.tsx`,
  `apps/web/src/routes/ProjectCodeTab.module.css`,
  `apps/web/src/components/ContainerImageGate.tsx` (apresentação
  compartilhada), `apps/web/src/routes/code/PrListAndDiff.tsx` (consumidor
  reativo ao 409), `apps/web/src/lib/api-client.ts`
  (`isContainerImageGateError`)
- **Teste:** `apps/web/src/routes/ProjectCodeTab.test.tsx` ("o gate"),
  `apps/web/src/routes/code/CodeDiffPanel.test.tsx`,
  `apps/web/src/routes/ProjectPrsTab.test.tsx` ("o gate do container não é
  erro genérico")
- **Borda:** a checagem no front NÃO substitui a da api — é conveniência de
  UX. Se a api mudar de estado entre a consulta do gate e a leitura de
  verdade, a rota de leitura ainda recusa com 409 (RN-105); o front só evita
  o caso comum de mostrar o editor vazio por um instante. A aba PRs não faz
  pré-checagem: ela descobre o bloqueio quando a query já falhou, porque não
  há árvore/arquivo nenhum ali para o instante "vazio" que a pré-checagem da
  aba Code evita.
- **Origem:** [ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

### RN-110 — `blame` é a 13ª operação do `GitProviderContract`, com o mesmo vocabulário de ausência das outras leituras {#rn-110}

Fundação da pendência de blame declarada na FASE 26 (nenhuma tela consome
ainda — vem na onda seguinte). `blame(ref, path)` devolve `GitBlame | null`,
`null` significando exatamente o que já significa em `getFileContent`/
`listTree`: arquivo ausente naquela ref, ou ref inexistente. Dois vocabulários
de "não existe" para a mesma aba fariam a tela tratar o mesmo caso de duas
formas — a mesma razão que já valia para as duas operações anteriores.

Cada provider computa por meios PRÓPRIOS, porque não há endpoint comum: o
GitHub não tem blame na REST (só GraphQL — a única operação do provider que
fala GraphQL), o GitLab tem `repository/files/:path/blame`, e o local sai de
`git blame --porcelain`, o único dos três testado contra um repositório de
verdade nesta sessão (os outros dois só contra os backends fake do teste de
contrato — sem `GITHUB_TEST_TOKEN`/`GITLAB_TEST_TOKEN` no ambiente, quem prova
contra a API real é o smoke manual). `GIT_BLAME_LINE_LIMIT` (2000) corta
arquivo genuinamente enorme — já cortado por bytes na rota de conteúdo, mas
`blame` lê o arquivo inteiro do provider antes de decidir.

- **Onde:** `packages/shared/src/index.ts` (`BlameInput`, `GitBlame`,
  `GitBlameLine`, capability `blame`),
  `apps/api/src/infrastructure/git/{github,gitlab,local}-provider.ts`,
  `apps/api/src/domain/git/git-read-limits.ts` (`GIT_BLAME_LINE_LIMIT`),
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (método `blame`), `apps/api/src/interfaces/http/git/code.controller.ts`
  (`GET /projects/:id/code/blame`)
- **Teste:** `apps/api/test/contract/git-provider.contract.ts` (bloco "blame"),
  exercitado pelos três specs de provider — o do `local` contra git de
  verdade — e `read-project-code.use-case.spec.ts` (bloco "blame")
- **Origem:** FASE 26b (fundação das pendências declaradas da FASE 26/
  [ADR 0060](../adr/0060-superficie-de-leitura-de-codigo.md))

### RN-111 — `listPullRequests` é a 14ª operação do `GitProviderContract`; a lista navegável abre o mesmo diff por id {#rn-111}

`CodeDiffPanel.tsx` consome `listPullRequests(state?)` numa lista clicável
(id/número/título/autor/estado/branches, com filtro por estado); clicar num
item reusa o MESMO fluxo de diff por id que já existia — não há caminho novo
de leitura, só como CHEGAR ao id sem precisar saber de cor. Quem já sabe o id
(ex.: veio de Aprovações) continua podendo colar direto.

`listPullRequests(state?)` devolve um RESUMO por PR
(`GitPullRequestSummary`: id, número, título, autor, estado, branches,
`updatedAt`) — não `GitPullRequest`, que é o tipo de ESCREVER (abrir/mesclar) e
nunca teve título nem autor porque nenhuma das duas operações precisava. Um
tipo próprio evita que a escrita ganhe campos que só a leitura usa.

O `local` TEM PR — o store sidecar da Fase 4a já é a fonte, e a suposição do
enunciado ("PR não existe no conceito de repositório local puro") não se
sustentou: o self-contained dos dev agents criou PR local desde então. As três
capabilities são `true`. `GIT_PR_LIST_LIMIT` (100) é uma página só, sem
paginação de seguimento — navegação humana, não sincronização de histórico.

- **Onde:** `packages/shared/src/index.ts` (`ListPullRequestsInput`,
  `GitPullRequestSummary`, `GitPullRequestList`, capability
  `pullRequestsList`), `apps/api/src/infrastructure/git/{github,gitlab,
  local}-provider.ts`, `apps/api/src/domain/git/git-read-limits.ts`
  (`GIT_PR_LIST_LIMIT`), `read-project-code.use-case.ts` (método
  `pullRequests`), `code.controller.ts` (`GET /projects/:id/code/pull-requests`),
  `apps/web/src/routes/code/CodeDiffPanel.tsx` (lista clicável, filtro por
  estado, reuso do fluxo de diff por id)
- **Teste:** `git-provider.contract.ts` (bloco "listPullRequests"),
  `read-project-code.use-case.spec.ts` (bloco "lista de PRs"),
  `apps/web/src/routes/code/CodeDiffPanel.test.tsx`
- **Origem:** FASE 26b

### RN-112 — `listBranchesDetailed` é operação PRÓPRIA, separada de `listBranches` {#rn-112}

Fundação do dropdown rico, agora consumida por `CodeBranchPicker.tsx`
(`ahead`/`behind`, badge de PR — a onda seguinte à FASE 26b fechou a
pendência que `CodeShell.tsx` declarava). A decisão foi NÃO estender `listBranches` — a
13ª operação original, que o bootstrap de Gitflow chama sem precisar de nada
disso: enriquecer custa uma chamada extra ao provider POR BRANCH (duas no
GitLab, que não tem endpoint que devolva os dois lados de uma comparação numa
chamada só, ao contrário de `compareCommitsWithBasehead` do GitHub e de `git
rev-list --left-right --count` no local). Encostar esse custo em toda
adoção/criação de branch transformaria o bootstrap numa varredura cara. As
duas operações convivem no contrato: `listBranches` pro bootstrap,
`listBranchesDetailed` (a 15ª) pra aba Code — `GitBranchDetail` estende
`GitBranch` só na FORMA, nunca no CONTRATO de quem chama.

`ahead`/`behind` são sempre relativos à branch DEFAULT do repositório
(`ListBranchesDetailedInput.defaultBranch`, que o chamador já sabe — pedi-la
de novo ao provider seria uma chamada a mais só pra redescobrir o que já
tinha). `null` nos dois quando o provider não consegue computar (branch órfã,
histórico não relacionado) é degradação honesta, nunca um número inventado.
`GIT_BRANCH_DETAIL_LIMIT` (30) corta pelas mesmas razões de tráfego do item 34
da FASE 26 — sem ele, um repositório com centenas de branches viraria centenas
de chamadas por abertura do dropdown.

- **Onde:** `packages/shared/src/index.ts` (`ListBranchesDetailedInput`,
  `GitBranchDetail`, `GitBranchDetailList`, `GitBranchPullRequestRef`,
  capability `branchesDetailed`), `apps/api/src/infrastructure/git/{github,
  gitlab,local}-provider.ts`, `git-read-limits.ts`
  (`GIT_BRANCH_DETAIL_LIMIT`), `read-project-code.use-case.ts` (método
  `branches`), `code.controller.ts` (`GET /projects/:id/code/branches`);
  no web, `apps/web/src/lib/api-client.ts` (`getCodeBranches`) e
  `apps/web/src/routes/code/CodeBranchPicker.tsx` — o dropdown em si, aberto
  a partir de `CodeShell.tsx`
- **Teste:** `git-provider.contract.ts` (bloco "listBranchesDetailed"),
  `read-project-code.use-case.spec.ts` (bloco "branches detalhadas"),
  `apps/web/src/routes/code/CodeBranchPicker.test.tsx`
- **Borda:** o método `branches()` mora no MESMO caso de uso das outras seis
  leituras (`ReadProjectCodeUseCase`), não perto do bootstrap — é uma LEITURA
  da aba Code, com a mesma resolução de credencial e o mesmo portão de
  container (RN-105) que as demais; tratá-la como operação de bootstrap
  duplicaria os dois. Uma ref fora da lista de branches (tag ou sha) segue
  alcançável — o rodapé do dropdown tem um campo manual, porque
  `listBranchesDetailed` não enumera essas duas coisas.
- **Origem:** FASE 26b (fundação); onda seguinte fechou a UI

### RN-113 — Blame no editor é anotação SOB DEMANDA — um toggle, nunca embutida na leitura do arquivo {#rn-113}

A UI que consome a fundação da [RN-110](#rn-110) entra aqui: o editor da aba
Code (`CodeEditor.tsx`) só chama `getCodeBlame` quando o usuário liga o toggle
"Blame" — nunca junto da leitura de arquivo, que já dispara sozinha ao abrir
uma aba. O motivo é o mesmo dos orçamentos de leitura composta (ADR 0060):
blame é uma SEGUNDA chamada ao provider por arquivo aberto, e um arquivo perto
do teto (`GIT_BLAME_LINE_LIMIT`, 2000 linhas) já é caro o bastante para não
pagá-lo de graça em toda navegação. `truncated` (que a RN-110 já expõe) vira
aviso visível, no mesmo padrão do aviso de `fileQuery.data.truncated`.

Linhas consecutivas do MESMO commit mostram autor e sha curto só na PRIMEIRA
linha do bloco — repetir o mesmo texto em cada linha de um bloco de dezenas
de linhas seria ruído, não anotação; a linha só some do texto, nunca some da
anotação (o `title` do elemento continua com data completa e resumo do
commit em qualquer linha do bloco).

- **Onde:** `apps/web/src/routes/code/CodeEditor.tsx`,
  `apps/web/src/routes/code/CodeEditor.module.css`
- **Teste:** `apps/web/src/routes/code/CodeEditor.test.tsx`
- **Origem:** onda de UI da FASE 26b (blame — dropdown rico de branches e
  lista de PRs são UI de outros dois agentes, sem risco de colisão)

### RN-115 — A Anamnese pode ser pausada globalmente; a pausa é do PRODUTO, nunca apaga dado {#rn-115}

`ANAMNESE_ENABLED` (env var do engine, boolean, default `false` a partir
desta regra) decide se uma rodada NOVA da Anamnese pode acontecer — periódica
(`AnamneseSchedulerWorker`) ou sob demanda (`AnamneseCommandController`).
Decisão de PRODUTO do usuário em 2026-08-10 ("hoje ele não está trazendo
dados de muito valor"), não bug — ver docs/explanation/backlog.md. Desativada,
NENHUM dado existente é tocado: hipóteses, perfis de proficiência e patches
de instrução já gravados continuam intactos e visíveis, e o opt-out POR
MEMBRO (RN-025) continua um conceito separado — a pausa é do SISTEMA, não do
perfilamento individual.

`AnamneseSchedulerWorker.kickoff/0` (chamado uma vez no boot) NÃO agenda o
job periódico quando desativado, em vez de agendar e deixar `perform/1`
no-opar a cada tick — mais barato (a fila do Oban não recebe um job a cada
`ANAMNESE_INTERVAL_SECONDS` só para não fazer nada) e mais claro para quem
inspeciona a fila. **Correção em 2026-08-10** (achado real em execução, não
hipótese): a versão original desta regra deixava `perform/1` incondicional
de propósito, para a corrente entre rodadas não carregar a decisão de
ligar/desligar consigo — mas isso significava que uma corrente já agendada
ANTES de a flag existir (ou de alguém desativá-la) continuava se
reagendando pra sempre, rodando Anamnese de verdade com a flag dizendo
`false`. Foi exatamente o que aconteceu num Postgres de dev mais antigo que
o PR original, remediado manualmente cancelando os jobs agendados.
`perform/1` agora confere `enabled?/0` a cada tick, igual `kickoff/0`: se
desativado, nem `enqueue_projects/0` nem o reagendamento acontecem, e a
corrente morre ali — o que também AUTO-CURA sozinho o cenário de job antigo
que ainda dispara uma vez, sem precisar de intervenção manual.

`AnamneseCommandController.run/2` (rota sob demanda, "reanalisar agora" nas
Configurações) responde **503** com corpo `{"error": "anamnese_desativada"}`
quando desativado — distinto de propósito do 409 vazio que já existia para
"projeto sem sessão" (os dois eram fáceis de confundir num 409 puro, e são
causas bem diferentes). `RunAnamneseUseCase`, do lado api, converte o 503 do
engine em `ServiceUnavailableException` com `reason: "anamnese_disabled"` no
corpo — nunca um 500 genérico nem um 409 reaproveitado. A web
(`ProjectSettingsTab.tsx`) descobre o estado no primeiro clique de "Rodar
agora" (não há hoje uma leitura prévia do estado global) e, a partir daí,
desabilita o botão e mantém a explicação VISÍVEL na tela — não só um toast
que some (RN-088: nunca falha silenciosa ou confusa).

- **Onde:** `apps/engine/lib/engine/workers/anamnese_scheduler_worker.ex`
  (`enabled?/0`, `kickoff/0`),
  `apps/engine/lib/engine_web/controllers/anamnese_command_controller.ex`,
  `apps/engine/config/runtime.exs`,
  `apps/api/src/domain/anamnese/anamnese-disabled.error.ts`,
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  (`runAnamnese`), `apps/api/src/application/use-cases/anamnese/run-anamnese.use-case.ts`,
  `apps/web/src/routes/settings/ProficiencySection.tsx`
- **Teste:**
  `apps/engine/test/engine/workers/anamnese_scheduler_worker_test.exs`
  (`kickoff/0` não agenda desativado, agenda ativado, default desligado;
  `perform/1` desativado no meio da corrente não faz fan-out nem reagenda),
  `apps/engine/test/engine_web/controllers/anamnese_command_controller_test.exs`
  (503 distinto de 409, com e sem sessão),
  `apps/api/test/application/use-cases/anamnese/run-anamnese.use-case.spec.ts`,
  `apps/web/src/routes/ProjectSettingsTab.test.tsx` (`ProficiencySection`)
- **Borda:** a flag é GLOBAL (todos os projetos/workspaces), não por projeto
  — ao contrário do teto de paralelismo (RN-083) ou do modelo herdável por
  área (RN-102), que são decisões por escopo. Ligar de volta é
  `ANAMNESE_ENABLED=true` e reiniciar o engine; não há botão na UI para isso
  (é operacional, não uma preferência de projeto).
- **Origem:** sem ADR — decisão de produto reversível, não mudança estrutural
  de arquitetura. Ver docs/explanation/backlog.md.

### RN-117 — O Psicólogo pode ser pausado globalmente; a pausa é do PRODUTO, nunca apaga dado {#rn-117}

`PSYCHOLOGIST_ENABLED` (env var do engine, boolean, default `false`) decide
se uma rodada NOVA do Psicólogo pode acontecer — automática (fechamento de
sessão, roteado pelo `Engine.Outbox.Drain`) ou sob demanda
(`PsychologistCommandController.reanalyze/2`). Mesma decisão de PRODUTO do
usuário em 2026-08-10 já aplicada à Anamnese (RN-115, "hoje ele não está
trazendo dados de muito valor") — não bug, ver docs/explanation/backlog.md.
Desativado, NENHUM dado existente é tocado: análises e hipóteses já
emitidas continuam intactas e visíveis.

Diferente da Anamnese (cujo gatilho automático é um TICK periódico que a
própria flag decide se reagenda), o gatilho automático do Psicólogo é o
fechamento de sessão — o `Engine.Outbox.Drain` roteia
`session.closed`/`session.closed_abnormally` pra `PsychologistWorker` só
quando `PsychologistWorker.enabled?/0` é true (`Drain.handlers_for/1`);
desativado, só `SessionLifecycleWorker` roda, e o job do Psicólogo nem
nasce. `PsychologistWorker.perform/1` continua incondicional de propósito —
mas NÃO é mais "o mesmo padrão" do `AnamneseSchedulerWorker` (ver a correção
de 2026-08-10 na RN-115 acima): lá `perform/1` passou a conferir a flag
porque ele PRÓPRIO reagenda a corrente a cada tick, e um job antigo
disparando incondicionalmente reabria a Anamnese com a flag desligada. O
Psicólogo não tem corrente nenhuma que se reagende sozinha — cada job nasce
de UM evento (`session.closed`), e quem decide é o `Drain` no momento em que
RECEBE o evento, não o worker no momento em que RODA; um job de Psicólogo
já enfileirado antes de desligar a flag é, no máximo, a última rodada
pendente, nunca uma corrente infinita. Por isso a suite pré-existente de
`PsychologistWorker` (que chama `perform/1` direto) não precisou mudar.

`PsychologistCommandController.reanalyze/2` (rota sob demanda,
"Reanalisar" na aba Insights) responde **503** com corpo
`{"error": "psicologo_desativado"}` quando desativado, sem sequer criar o
job. `ReanalyzeSessionUseCase`, do lado api, converte o 503 do engine em
`ServiceUnavailableException` com `reason: "psychologist_disabled"` no
corpo — nunca um 500 genérico. Isto descobre a pausa quando já existe uma
análise para reprocessar; a tela SEM hipótese nenhuma tem uma leitura
prévia própria, que não existia aqui — ver [RN-454](../business-rules.md#rn-454).

- **Onde:** `apps/engine/lib/engine/workers/psychologist_worker.ex`
  (`enabled?/0`), `apps/engine/lib/engine/outbox/drain.ex`
  (`handlers_for/1`),
  `apps/engine/lib/engine_web/controllers/psychologist_command_controller.ex`,
  `apps/engine/config/runtime.exs`,
  `apps/api/src/domain/psychologist/psychologist-disabled.error.ts`,
  `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts`
  (`reanalyzeSession`),
  `apps/api/src/application/use-cases/execution/reanalyze-session.use-case.ts`,
  `apps/web/src/routes/ProjectInsightsTab.tsx`
- **Teste:**
  `apps/engine/test/engine/outbox/drain_test.exs` (`session.closed` só
  enfileira o Psicólogo quando ativado),
  `apps/engine/test/engine_web/controllers/psychologist_command_controller_test.exs`
  (503 sem criar job, 202 com job enfileirado quando ativado),
  `apps/api/test/application/use-cases/execution/reanalyze-session.use-case.spec.ts`,
  `apps/web/src/routes/ProjectInsightsTab.test.tsx`
- **Borda:** a flag é GLOBAL (todos os projetos/workspaces), como a da
  Anamnese. Ligar de volta é `PSYCHOLOGIST_ENABLED=true` e reiniciar o
  engine; não há botão na UI para isso.
- **Origem:** sem ADR — decisão de produto reversível, não mudança estrutural
  de arquitetura. Ver docs/explanation/backlog.md.

### RN-108 — O socket da sessão exige um ticket opaco de uso único, não o JWT reaproveitado {#rn-108}

`EngineWeb.SessionSocket.connect/3` recusava a conexão inteira só com o
`session_id` (UUID) precisando existir no Registry — quem descobrisse o UUID
entrava no canal `session:<id>` e recebia todos os broadcasts ao vivo da
sessão. Fechar isso era limitação deliberada documentada no próprio módulo
desde a Fase 3.

`POST /projects/:projectId/sessions/:sessionId/socket-ticket` (`scope:
"heartbeat"|"terminal"`) emite um ticket opaco (32 bytes de CSPRNG,
`TokenFactory`), TTL de **30 segundos**, uso único. `scope: "heartbeat"` exige
papel `viewer`; `scope: "terminal"` exige `developer` — o mesmo papel mínimo
de `MIN_ROLE_FOR_ACTION_TYPE.terminal` em `domain/actions/decide.ts` (hoje
nenhum caminho pede `terminal` de verdade; o valor nasce certo para a FASE 25,
o terminal interativo). A api persiste só o HASH (SHA-256 **puro**, não
`hashDeToken`/HMAC — o engine não tem o pepper da api, e um token de 256 bits
de CSPRNG não precisa de pepper contra dicionário, mesmo raciocínio que o
próprio `hashDeToken` já registra), nunca o token bruto.

O consumo é do ENGINE, que lê `session_socket_tickets` direto (mesmo padrão de
`Engine.Outbox.Event` sobre `outbox_events` — nunca changeset/insert, só a
escrita estreita que o uso único exige) em DUAS etapas:
`SocketTicket.validar/1` (peek, sem marcar nada — chamado por `connect/3`,
que ainda não sabe qual `session_id` vai ser pedido) e
`SocketTicket.consumir/2` (`UPDATE` condicional exigindo o `session_id` do
tópico bater com o da linha — chamado por `SessionChannel.join/3`, que
também confere o `project_id` do ticket contra o da sessão, defesa em
profundidade contra ticket de um projeto abrindo canal de outro). Sem ticket,
ou com um inválido: a conexão inteira é recusada (`{:error, %{reason:
"unauthorized"}}`), não só o join do canal.

O web (`session-channel.ts`) busca um ticket NOVO antes de TODA
`socket.connect()` — inclusive em reconexão automática, que existe. O
reconnect nativo do `Phoenix.Socket` reusaria o mesmo `params` da construção
(o ticket velho, já expirado ou consumido), então ele é neutralizado
(`reconnectAfterMs` que praticamente nunca dispara) e a reconexão passa a ser
inteiramente manual, com busca de ticket fresco a cada tentativa.

Essa neutralização vale para TODO cliente do socket, e não só para o do web —
inclusive o socket `/runner`, cujo ticket (`POST .../runner-ticket`) é do
mesmo calibre. Ela falhou em DOIS dos quatro construtores de `Socket` do
repositório, e o custo foi medido em execução real: `apps/runner/src/
channel.ts` construía o socket sem a opção — enquanto o docblock do módulo
AFIRMAVA que o reconnect era "por isso neutralizado" — e o auto-reconnect
repetia o mesmo ticket já consumido a cada **~5,13s** (o teto do backoff
interno do phoenix.js), rendendo **61 `REFUSED CONNECTION TO
EngineWeb.RunnerSocket`** em poucas horas. Somado à política PRÓPRIA do
runner (`index.ts`, essa correta), o resultado foram **530 requisições num
minuto** contra o teto de 300 do `RATE_LIMIT_USER` — e como o limite é por
USUÁRIO, o 429 aparecia no NAVEGADOR do dono da conta. Duas consequências, e
a segunda é pior que o 429: enquanto está nesse laço o runner NÃO está
conectado, então `RunnerReadiness` (RN-507) recusa e o projeto parece "sem
agente local". `apps/web/src/lib/fs-browser-channel.ts` tinha a MESMA linha
de defeito (mesmo ticket de uso único, e sem política própria de reconexão —
o `onClose` dele manda "feche e reabra") e foi corrigido junto.

O que impede a terceira instância é MECANISMO, não comentário: no runner as
opções do `Socket` viraram um tipo com `reconnectAfterMs` OBRIGATÓRIO
(`OpcoesDoSocket` em `channel.ts`), e os dois lados ganharam teste que assere
a OPÇÃO PASSADA ao construtor — um teste que só verifique "conecta" passava
com o defeito de pé, e passou. Junto, `conectarERodar` (`index.ts`) passou a
DESCARTAR explicitamente a conexão caída (`conexao.desconectar()`): sem isso
o `Socket` da rodada anterior sobrevivia à criação do próximo, e cada queda
deixava mais um objeto vivo tentando com o ticket morto.

- **Onde:** `apps/api/src/db/schema/sessions.ts` (`sessionSocketTickets`),
  `apps/api/src/domain/sessions/socket-ticket-scope.ts`,
  `apps/api/src/application/use-cases/sessions/create-socket-ticket.use-case.ts`,
  `apps/api/src/interfaces/http/sessions/sessions.controller.ts` (rota
  `socket-ticket`), `apps/engine/lib/engine/sessions/socket_ticket.ex`,
  `apps/engine/lib/engine_web/channels/session_socket.ex`,
  `apps/engine/lib/engine_web/channels/session_channel.ex`,
  `apps/web/src/lib/session-channel.ts`,
  `apps/web/src/lib/fs-browser-channel.ts`,
  `apps/runner/src/channel.ts` (`OpcoesDoSocket`,
  `NUNCA_RECONECTAR_SOZINHO_MS`), `apps/runner/src/index.ts`
  (`conectarERodar`, o descarte da conexão caída)
- **Teste:**
  `apps/api/test/application/use-cases/sessions/create-socket-ticket.use-case.spec.ts`,
  `apps/api/test/domain/sessions/socket-ticket-scope.spec.ts`,
  `apps/api/test/infrastructure/persistence/session-socket-ticket.repository.spec.ts`,
  `apps/engine/test/engine/sessions/socket_ticket_test.exs` (reuso falha,
  session_id errado falha, corrida concorrente só um vence),
  `apps/engine/test/engine_web/channels/session_socket_test.exs` (sem ticket
  a conexão é recusada),
  `apps/engine/test/engine_web/channels/session_channel_test.exs` (ticket de
  outro projeto: join falha), `apps/web/src/lib/session-channel.test.ts`,
  `apps/runner/src/channel.spec.ts` ("neutraliza o auto-reconnect do
  Phoenix.Socket — ticket de uso único nunca é repetido"; assere a OPÇÃO
  passada ao construtor, e reprova sem ela),
  `apps/web/src/lib/fs-browser-channel.test.ts` (o mesmo, no transporte via
  runner do navegador de pastas)
- **Borda:** o ticket NÃO é o JWT reaproveitado — TTL curto, uso único, escopo
  fechado, e nasce de uma rota própria que já checa papel efetivo, não de
  decodificar o access token existente.
- **Origem:** sem ADR — extração/hardening pontual, não mudança estrutural.

### RN-109 — O nome de pasta do workspace é congelado na criação, e projeto antigo mantém o UUID {#rn-109}

A pasta física de um projeto em `PROJECT_WORKSPACES_ROOT` era o UUID puro —
ilegível ao abrir no disco. `projects.workspace_dir_name` (NOT NULL, UNIQUE)
passou a guardar o nome de verdade: `<slug>-<8 chars do id>` para projeto
NOVO (`workspaceDirNameFor` em
`apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`), gerado
em código — o id nasce de `crypto.randomUUID()` no
`CreateProjectUseCase`, não do `defaultRandom()` do Postgres, porque o nome
da pasta precisa do id ANTES do insert. Os 8 caracteres seguem a mesma
convenção do rótulo de sessão (`apps/web/src/lib/session-label.ts`).

O nome é CONGELADO no momento da criação e nunca recalculado: `UpdateProjectUseCase`
permite editar o `slug` depois, e isso NÃO toca `workspace_dir_name` — reservar a
pasta física, com working tree e worktrees de agente possivelmente abertos, é
risco real que a decisão evita por construção, não por disciplina de quem
chama.

Projeto criado ANTES desta migração (0042) manteve a pasta física que já
tinha: o backfill grava `workspace_dir_name = id` para toda linha existente —
o mesmo valor que já era verdade no disco — e NUNCA renomeia diretório
nenhum. Um trigger `BEFORE INSERT` (`projects_workspace_dir_name_default_trg`)
aplica o MESMO fallback (`id::text`) para qualquer insert que chegue sem o
campo — rede de segurança para quem esquecer de gravá-lo (nunca o caminho
principal, que sempre grava explícito), e o que mantém as dezenas de
fixtures de teste existentes, que não conhecem este conceito, funcionando
sem precisar reescrever cada uma.

A derivação de caminho a partir do nome (`projectScopeRoot`, RN-092/RN-075)
passou a receber `workspace_dir_name` em vez do `projectId` cru — mesma
validação de charset, mesma pureza. O engine lê a MESMA coluna
(`Engine.Projects.Project.workspace_dir_name/1`) para resolver
`Engine.Actions.Workspace.workspace_dir/1`, nunca recomputando o nome a
partir do id: as duas derivações (api e engine) são, na prática, a mesma
leitura contra o mesmo banco — é o que garante que RN-075 (escopo de
terminal) e RN-092 (leitura de código) continuam apontando para a MESMA
pasta que o engine realmente usa.

- **Onde:** `apps/api/src/db/schema/iam.ts` (`projects.workspaceDirName`),
  `apps/api/src/db/migrations/0042_tough_captain_midlands.sql`,
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`workspaceDirNameFor`, `projectScopeRoot`),
  `apps/api/src/application/use-cases/iam/create-project.use-case.ts`,
  `apps/engine/lib/engine/projects/project.ex`
  (`workspace_dir_name/1`, `all_workspace_dirs/0`),
  `apps/engine/lib/engine/actions/workspace.ex` (`workspace_dir/1,2`),
  `apps/engine/lib/engine/dev/worktree_cleanup.ex`
- **Teste:**
  `apps/api/test/db/workspace-dir-name-migration.spec.ts` (trigger, backfill
  equivalente, unicidade),
  `apps/api/test/application/use-cases/iam/create-project-semeia-areas.spec.ts`
  (`workspaceDirName` nasce `<slug>-<8 chars>`, dois projetos com o mesmo
  slug em workspaces diferentes não colidem de pasta),
  `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
- **Borda:** o teto de paralelismo e o gate de merge não mudam — RN-109 é só
  NOME de pasta, nunca política. Renomear o slug depois da criação não
  renomeia a pasta; a pasta só se lê pelo `workspace_dir_name` gravado.
- **Origem:** ADR 0066 (revisa o ADR 0055).

### RN-129 — O ToolLoop nunca grava `agent.response` vazio; falha de transporte vira `agent.error` durável {#rn-129}

A [RN-059](../business-rules/custo.md#rn-059) fechou o balão vazio para os quatro agentes
conversacionais, mas eles não passam pelo `Engine.Harness.ToolLoop` — cada um
chama `EngineApiClient.llm_turn_stream/6` no próprio módulo. O `ToolLoop`
(usado por dev agents, QA Automação/Performance-Segurança, Infra-Workflows,
Anamnese e Psicólogo) tinha o MESMO defeito num caminho diferente: emitia
`agent.response` a cada iteração, mesmo quando o modelo só chamou ferramenta
sem texto, ou terminou o turno sem produzir nada — e a falha de transporte
(provider fora do ar, timeout) virava `agent.response` com `content` ausente,
igualmente indistinguível de sucesso.

Achado ao vivo numa sessão de execução real (dev agents): duas bolhas com o
texto de compatibilidade da RN-059 ("resposta vazia — evento anterior...")
apareceram numa sessão criada minutos antes — não eram eventos antigos, eram
o mesmo defeito acontecendo de novo, só que na aba de execução.

Duas correções, no ponto ESTRUTURAL comum a todo consumidor do `ToolLoop`,
não módulo por módulo:

1. **Conteúdo vazio nunca vira `agent.response`.** Iteração que só chamou
   ferramenta já está narrada por `tool.call`/`tool.result`; iteração que não
   produziu nada (nem texto, nem tool call) deixa o desfecho para quem chamou
   o loop decidir — `ctx.last_error`/`{:ok, ctx}` carregam a informação, e
   quem consome (ex.: `DevAgentServer.handle_outcome/4`) já grava o evento
   durável do PRÓPRIO domínio (`dev.blocked`, com `origem`).
2. **Falha de transporte vira `agent.error` durável**, com `origem`
   (`Engine.Agents.FalhaDeTurno.origem/1` — o MESMO helper que os quatro
   agentes conversacionais usam, sem duplicar classificação) e `mensagem` em
   português — nunca mais `agent.response` sem `content`.

- **Onde:** `apps/engine/lib/engine/harness/tool_loop.ex` (`loop/1`,
  `emit_falha/2`)
- **Teste:** `apps/engine/test/engine/harness/tool_loop_test.exs`
  ("iteração só com tool call (sem texto) não grava agent.response vazio",
  "modelo termina o turno sem texto e sem tool call...", "falha de
  transporte... grava agent.error durável com origem")
- **Origem:** RN-059 (regra que esta estende) — achado ao vivo numa sessão de
  execução real com dev agents

### RN-139 — A aba Executores lê a sessão de execução VIGENTE, nunca a mais recente do projeto {#rn-139}

`ProjectExecutorsTab` buscava os eventos de dev agent/QA pela sessão que
`useLatestSession` devolvia — a de `createdAt` mais recente do projeto, sem
filtrar por `kind` nem exigir `execution.activated`. Funcionava só por
**coincidência**: a sessão de execução costuma ser a mais nova. Assim que
qualquer sessão nasce depois dela — uma ideação nova, um chat consultivo — a
aba passa a olhar essa sessão nova, vazia de eventos de execução, em
silêncio: nenhuma pista na tela dizia qual sessão estava sendo exibida.

A leitura correta já existia no backend: `findActiveExecutionSession`
(`SessionRepository`) — a sessão `active` mais recente que carrega
`execution.activated` — mas só era usada internamente por
`ActivateExecutionUseCase` para decidir se reativa ou cria. A correção expõe
o MESMO critério por HTTP, em vez de duplicá-lo no front:

- **`GET /projects/:projectId/execution/session`** (`role:viewer`) devolve a
  sessão vigente ou `null` — nunca infere pela mais recente;
- `ProjectExecutorsTab` troca `useLatestSession` por `useActiveExecutionSession`
  (novo hook sobre a rota acima) como fonte da sessão que a aba inteira lê;
- o cabeçalho da aba sempre mostra QUAL sessão está sendo exibida — o rótulo
  dela (hashtag + nome) linkando para `SessionPage`, ou "Nenhuma execução
  ativa" quando `null` — nunca mais implícito. Os três estados da
  [RN-088](../business-rules.md#rn-088) se aplicam à própria busca da sessão: carregando, erro
  (com `trace_id`) e vazio (`null`) são três renders distintos, nunca um
  `if (!sessão) return null` que os colapsa.

- **Onde:**
  `apps/api/src/application/use-cases/execution/get-active-execution-session.use-case.ts`,
  `apps/api/src/interfaces/http/execution/execution.controller.ts` (`getSession`),
  `apps/web/src/lib/hooks.ts` (`useActiveExecutionSession`),
  `apps/web/src/routes/ProjectExecutorsTab.tsx`
- **Teste:**
  `apps/web/src/routes/ProjectExecutorsTab.test.tsx` — mostra a sessão de
  execução mesmo com sessão mais recente existindo no projeto, estado
  "nenhuma execução ativa" explícito, e erro de rede tratado (não em branco)
- **Origem:** achado de investigação de código + teste ao vivo — a mesma
  classe de defeito que a RN-088 fechou para 429, agora para "qual sessão a
  tela está olhando"

### RN-141 — O conteúdo lido por `read_file` também tem teto de bytes {#rn-141}

A [RN-074](../business-rules/custo.md#rn-074) travou a saída do **terminal** contra
`{413, "request entity too large"}`, mas deixou aberta a mesma porta pelo
`read_file`: ele lia o arquivo INTEIRO, sem teto, e esse conteúdo entrava no
histórico do laço e viajava em todo turno seguinte. Um PR com arquivo grande
(lockfile, bundle, arquivo gerado) bastava pra travar dev agents E o QA de
Performance/Segurança — que só tem `ReadFile`/`SearchWorkspace` (sem
`Terminal`, de propósito) pra investigar uma PR, então não tinha rota de
escape nenhuma quando o arquivo era grande demais.

O conteúdo é cortado em `READ_FILE_MAX_BYTES` (default 32 KiB, mesmo valor da
RN-074 por coincidência de contexto, não por acoplamento — as duas variáveis
são independentes) antes de virar resultado da ferramenta, com marca dizendo
o arquivo e os dois tamanhos:

```
[arquivo package-lock.json truncado: mostrando 32768 de 1048576 bytes. Use
search_workspace para localizar um trecho específico em vez de reler o
arquivo inteiro.]
```

Mesmas três propriedades da RN-074 (teto é `>` não `>=`; corte não parte
caractere multibyte; a marca é endereçada ao modelo, dizendo o que fazer). A
truncagem mora na FERRAMENTA (`Engine.Harness.Tools.ReadFile`), não em
`Engine.Harness.WorkspaceFiles.read_file/2` — essa é a base genérica de
acesso a arquivo, compartilhada por `write_file`/`search_workspace`, e
truncar ali cortaria conteúdo de quem não precisa desse teto.

`search_workspace` não teve o mesmo tratamento: ele devolve só os PATHS que
bateram (`matched_content` é booleano), nunca o conteúdo do arquivo — o vetor
de estouro que motivou esta RN não se aplica a ele.

- **Onde:** `apps/engine/lib/engine/harness/tools/read_file.ex`
  (`truncate/2`), teto em `apps/engine/config/runtime.exs`
  (`read_file_max_bytes`)
- **Teste:** `apps/engine/test/engine/harness/tools/read_file_test.exs`
  (describe `teto de bytes do conteúdo`)
- **Origem:** achado ao vivo no event log de uma execução real — os 4 dev
  agents de um projeto e os QA de Automação/Performance-Segurança bloqueados
  com `{413, "request entity too large"}`, mesma causa raiz da RN-074, porta
  diferente

### RN-144 — A aba Criativo não lista a sessão de execução vigente {#rn-144}

A sessão que recebe `execution.activated` e os eventos de tool-call dos dev
agents precisa nascer com `kind: 'criativa'` — regra estrutural (RN-097,
`garantirQuePodeAtivarExecucao`), sem isso o evento é recusado. Como
`ProjectSessionsTab` (a aba Criativo, RN-104) lista sessões filtrando só por
`session.kind === 'criativa'`, a sessão de execução aparecia MISTURADA na
lista ao lado de ideações de verdade — abrir ela em `SessionPage.tsx` mostra
uma timeline inteira de tool-calls de dev agent, parecendo (pro usuário) "o
dev escrevendo no chat do Criativo". Confirmado ao vivo: uma sessão real com
35+ eventos de dev agent aparecia normal na lista, ao lado de sessões reais
de ideação.

A correção reusa o sinal que a [RN-139](#rn-139) já expõe —
`useActiveExecutionSession`/`GET /projects/:projectId/execution/session` — em
vez de o backend calcular um campo novo por sessão (`hasExecutionActivated`
ou equivalente). A aba Criativo busca a sessão vigente e a exclui da lista
renderizada:

- a busca só roda na aba Criativo (`enabled` desligado em `kind !==
  'criativa'`) — a aba Chat nunca fez essa chamada e continua sem fazer;
- o filtro é por `id`, depois do filtro por `kind` já existente — não muda o
  que a lista É, só o que ela EXCLUI.

**Decisão deliberada de escopo:** isto cobre só a execução VIGENTE, não
execuções ANTIGAS já encerradas (`execution.activated` gravado numa sessão
que hoje está `closed`). Calcular isso pediria o backend anotar, por sessão,
se ela tem o evento gravado — mudança no repositório e no endpoint de
listagem, para um caso residual: uma sessão de execução ANTIGA aparece com o
badge `closed`, o que já sinaliza "não é uma ideação ativa" de um jeito bem
menos ambíguo do que a vigente (que aparecia `active`, indistinguível de uma
ideação em andamento). Se isso voltar a confundir na prática, a saída é o
endpoint de listagem devolver o sinal por sessão — não um `filter` a mais no
front por sessão antiga.

- **Onde:** `apps/web/src/routes/ProjectSessionsTab.tsx`
  (`ProjectSessionsTab`)
- **Teste:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — a vigente
  some da lista Criativo com sessões normais ao lado, a aba Chat não chama a
  busca de execução vigente, e sem execução vigente (`null`) a lista aparece
  inteira
- **Origem:** achado de investigação de código + teste ao vivo — sessão real
  com execução ativa aparecendo misturada na aba Criativo

### RN-145 — O Arquiteto também tem um botão de prontidão, e a MESMA confirmação oferece Infra e Dev Lead {#rn-145}

`OfferInfraHandoffUseCase` (`POST .../agents/arquiteto/handoff-infra`) já
existia desde a Fase 4a — grava `architecture.readiness_confirmed` e chama o
engine, que oferece o handoff ao Infra e, na MESMA confirmação, ao Dev Lead
(FASE 14d/ADR 0053). O que faltava era o jeito de chegar até ele: nenhum
lugar do frontend chamava o endpoint. O botão "Confirmar arquitetura pronta"
existe pro Criativo desde sempre ("Estou pronto para produzir",
[RN-131](../business-rules.md#rn-131)/[RN-142](../business-rules.md#rn-142)) — o Arquiteto não tinha equivalente
nenhum, e sem o clique o handoff nunca nascia: a correção de prioridade do
card no fio ([RN-125](../business-rules.md#rn-125)) ficava sem efeito prático, porque não havia o
que mostrar.

`arquitetoActive` espelha `criativoActive` (existe um `agent.activated` pro
Arquiteto nesta sessão) e `arquiteturaJaDeclarada` espelha
`prontidaoJaDeclarada` (existe QUALQUER handoff saindo do Arquiteto — a prova
de que a confirmação já aconteceu, já que `OfferInfraHandoffUseCase` cria
pelo menos o de Infra na mesma chamada). O botão aparece no composer só
quando o primeiro é verdadeiro e o segundo não é — some depois do clique
pelo mesmo motivo que o do Criativo some depois da prontidão.

Ao contrário do Criativo, o Arquiteto NÃO tem guardrail de servidor
bloqueando a confirmação sem `module_map` — `ArquitetoServer.offer_infra_handoff`
não recusa nada, diferente de `CriativoServer.confirm_readiness`
([RN-142](../business-rules.md#rn-142)). O botão só desabilita durante `streaming`; não replicar
aqui o `disabled={!hasModuleMap}` da Visão Geral é decisão deliberada, pelo
mesmo raciocínio que já vale para "Ativar execução" no card do Dev Lead
([RN-137](../business-rules.md#rn-137)) — quando este card existe, o Arquiteto já decidiu a
arquitetura.

- **Onde:** `apps/api/src/interfaces/http/agents/agents.controller.ts`
  (`handoffInfra`, rota preexistente), `apps/web/src/lib/api-client.ts`
  (`confirmArchitectureReadiness`), `apps/web/src/routes/SessionPage.tsx`
  (`arquitetoActive`, `arquiteturaJaDeclarada`, `handleArchitectureReadiness`,
  botão "Confirmar arquitetura pronta")
- **Teste:**
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`, describe
  "problema 1" — botão ausente sem o Arquiteto ativo, caminho feliz chama o
  endpoint dedicado, falha mostra toast de erro, e o botão some com a
  arquitetura já declarada
- **Origem:** investigação de código — o endpoint e a lógica do engine
  existiam desde a Fase 4a/14d sem NENHUM caminho de UI até eles

### RN-146 — `agent.response` carrega o nome do modelo que gerou a resposta {#rn-146}

O nome do modelo só existia em `token_usage`, sem vínculo com o evento
`agent.response` específico que ele produziu — `SessionPage.tsx` mostrava a
string FIXA `"modelo"` ao lado do nome do agente, nunca o nome real.

A mudança atravessa as três camadas, todas com o MESMO nome de campo
(`modelName`), para que não seja preciso traduzir entre elas:

1. **api** — `StreamLlmTurnUseCase`/`RunLlmTurnUseCase` já resolviam o
   modelo (`resolveModelBinding` → `models.findById`) para chamar o
   provider; o frame `final`/`RunLlmTurnResult` ganham `modelName: string |
   null`. `null` só quando o turno falhou ANTES de resolver um modelo (sem
   binding, ou binding para modelo inexistente) — nos demais casos,
   inclusive orçamento excedido, o binding já tinha resolvido e o nome
   viaja mesmo no frame de erro.
2. **engine** — os quatro agentes conversacionais (`criativo_server.ex`,
   `po_server.ex`, `arquiteto_server.ex`, `dev_lead_server.ex`) extraem
   `Map.get(frame, "modelName")` do frame `final` e o incluem no payload de
   `emit_response`/`agent.response` (`%{content: content, modelName:
   model_name}`).
3. **web** — `SessionPage.tsx` lê `event.payload.modelName`. Evento
   GRAVADO antes desta mudança não tem a chave (`undefined`), e um turno
   cuja api não resolveu modelo nenhum grava `null` — os dois degradam para
   o rótulo genérico `"modelo"`, nunca para `undefined`/`null` na tela; o
   mesmo padrão que `text === ''` já usa para resposta anterior à RN-059.

- **Onde:** `apps/api/src/application/use-cases/llm/stream-llm-turn.use-case.ts`
  (`LlmTurnStreamEvent`), `apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts`
  (`RunLlmTurnResult`), `apps/api/src/interfaces/http/internal/dto/internal.response.dto.ts`
  (`LlmTurnResponseDto`/`LlmTurnStreamEventResponseDto`),
  `apps/engine/lib/engine/agents/{criativo,po,arquiteto,dev_lead}_server.ex`
  (`emit_response/3`), `apps/web/src/routes/SessionPage.tsx` (bloco
  `agent.response` da timeline)
- **Teste:** `apps/api/test/application/use-cases/llm/run-llm-turn.use-case.spec.ts`,
  `apps/api/test/application/use-cases/llm/stream-llm-turn.use-case.spec.ts`
  (`modelName` no caminho feliz, no erro do provider e sem binding),
  `apps/engine/test/engine/agents/{criativo,po,arquiteto,dev_lead}_server_test.exs`
  (`agent.response` carrega o nome do modelo; borda do frame sem a chave),
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`, describe
  "problema 2" — nome real, evento antigo sem a chave, `modelName: null`
- **Origem:** investigação de código — confirmado que o dado já existia em
  `token_usage`, mas nunca chegava ao payload do evento

### RN-147 — O cabeçalho do grupo colapsado mostra o ícone do agente, não só o nome {#rn-147}

O `Disclosure` de `timelineAgrupada` ([RN-138](../business-rules.md#rn-138)) recebia só a STRING
do nome em `titulo` — cada mensagem expandida já tem um avatar (`.avatar` +
ícone), e o cabeçalho colapsado perdia essa pista visual justamente onde ela
mais ajuda a escanear o fio.

`AvatarDoAgente` reusa a MESMA caixa `.avatar` das mensagens expandidas, mas
o ícone escolhido é o do ROSTER (`AGENTS[id].icon`) — a mesma fonte que já
identifica "quem está falando" no indicador de streaming (`agenteExibido.icon`,
[RN-131](../business-rules.md#rn-131)) — e não o ícone por TIPO de evento que cada entrada
expandida usa (`ModelIcon` em `agent.response`, `StackIcon` em
`backlog.*_created`, `AlertCircleIcon` em `agent.error`). Um grupo colapsado
pode misturar esses tipos de entrada de um mesmo agente; o cabeçalho
representa o AGENTE, não a última entrada dele, e só o ícone do roster é
estável para isso. Sem `id`, ou agente fora do roster, degrada para
`ModelIcon` — nunca para uma caixa vazia.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`AvatarDoAgente`,
  `timelineAgrupada`), `apps/web/src/routes/SessionPage.module.css`
  (`.agentGroupTitulo`)
- **Teste:** `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`,
  describe "problema 3" — o cabeçalho colapsado tem o PATH do ícone do PO
  (`UserIcon`), não só um SVG decorativo genérico
- **Origem:** investigação de código — `Disclosure` já aceitava `ReactNode`
  em `titulo`; faltava passar o avatar junto do nome

### RN-148 — Histórias com promoção pendente ao mesmo tempo viram carrossel, não N cards {#rn-148}

O PO cria histórias uma a uma, e cada `backlog.story_promotion_proposed`
([RN-126](../business-rules.md#rn-126)) virava um card avulso na timeline — numa leva de várias
histórias, isso empilhava N cards idênticos disputando o mesmo espaço,
misturados com o resto da narração.

Uma **leva** é o conjunto de propostas de promoção AINDA PENDENTES na
sessão, avaliado a cada render — não "criadas em sequência sem
interrupção". O critério é o MESMO que cada card avulso já usava sozinho
para decidir se virou card acionável ou divisor (nenhum
`backlog.story_transitioned`/`backlog.story_promotion_returned` posterior
com o mesmo `storyId`), só que olhado de uma vez para a sessão inteira:

- **0 ou 1 pendente:** nada muda — card avulso de sempre (a degradação é
  deliberada: um carrossel de um slide só não ganha nada virando carrossel).
- **2+ pendentes ao mesmo tempo:** viram UM `Carousel` (novo no design
  system, `apps/web/src/components/ui/Carousel.tsx`), inserido na posição
  da PRIMEIRA proposta ainda pendente; as demais somem como card
  individual — cada uma vira um SLIDE dele. Cada slide mostra a mesma
  frase do card avulso ("história … pronta, aguardando sua promoção"), um
  resumo/RF se o payload trouxer (hoje não traz — ver abaixo), e os botões
  Promover/Devolver daquela história específica, chamando os MESMOS
  `promoteStories`/`returnStory` de sempre.
- **"Aprovar todas"** no cabeçalho do carrossel chama `promoteStories` com
  os ids de TODAS as pendentes numa chamada só — o endpoint já era lote
  (`promoteStories(projectId, storyIds[])`, RN-048), então não houve mudança
  de contrato nenhuma, só de quem monta a lista.
- Uma história resolvida (promovida ou devolvida) enquanto o carrossel está
  aberto sai da leva no próximo render (a query de eventos é invalidada nas
  duas ações) — se sobrar só 1 pendente, o carrossel se desfaz sozinho e o
  card volta a ser avulso.

`resumo`/RF no slide é campo PRONTO, não usado: `CreateStoryUseCase` hoje só
grava `storyId`/`epicId`/`title` no payload de `backlog.story_promotion_proposed`
— sem descrição nem requisitos funcionais. O slide já sabe exibir
`description`/`rf` se o payload um dia carregar (degrada pro título sozinho
até lá); estender o payload ficou fora desta entrega, por não ter sido
pedido.

- **Onde:** `apps/web/src/components/ui/Carousel.tsx` (componente novo,
  navegação genérica), `apps/web/src/routes/SessionPage.tsx`
  (`promocoesPendentes`, `ehLevaDeHistorias`, `StorySlide`,
  `handlePromoteAll`), `apps/web/src/routes/SessionPage.module.css`
  (`.storySlide`)
- **Teste:** `apps/web/src/components/ui/Carousel.test.tsx` (navegação,
  ARIA, só o slide atual montado, índice clampado quando a lista encolhe),
  `apps/web/src/routes/SessionPage.carrossel-historias.test.tsx` (3+
  pendentes viram carrossel; "Aprovar todas" manda o lote inteiro; promoção
  e devolução unitárias continuam funcionando a partir de um slide
  navegado; 1 pendente degrada pro card simples; história resolvida sai da
  leva e o carrossel recalcula a contagem)
- **Origem:** pedido do usuário — histórias produzidas em lote pelo PO
  ficavam difíceis de decidir uma por uma no fio

### RN-149 — O Container level do diagrama C4 é derivado do module_map, nunca redigitado pelo modelo {#rn-149}

`create_c4_diagram` (ferramenta nova do Arquiteto) gera as duas sintaxes
Mermaid do diagrama C4 (Context + Container, modelo de Simon Brown). O tool
call carrega só `system_name`/`system_description`/`actors` — os módulos e
as dependências do nível Container NÃO fazem parte da entrada: o caso de uso
busca o `module_map` VIGENTE do projeto (`ModuleMapRepository.findCurrent`,
mesma leitura de `GetArchitectureUseCase`) e deriva o Container level dele,
com os MESMOS nomes e dependências que `create_module_map` já validou sem
ciclo.

A alternativa óbvia — deixar o modelo descrever os módulos de novo no tool
call do diagrama, como ele já faz para `create_module_map` — foi descartada
de propósito: um segundo lugar onde o modelo escreve "os módulos são X, Y,
Z" é um segundo lugar onde essa lista pode divergir da primeira, e a
divergência seria SILENCIOSA — nada recusaria um diagrama com um módulo que
não existe mais no mapa real. Derivar do repositório fecha essa divergência
por construção: o diagrama pode ficar DESATUALIZADO se o `module_map` mudar
depois (reemitir é gerar de novo, sem trava — ver ADR 0068), mas nunca
MENTE sobre o que existia no momento em que foi gerado.

Sem `module_map` vigente, `create_c4_diagram` é recusado com 400 — não há
Container level sem módulos para desenhar, e a mensagem de erro instrui o
Arquiteto a chamar `create_module_map` primeiro (RN-061: a recusa volta
pelo tool-result, com o motivo inteiro).

O artefato `artifact.c4_diagram` é versionado no event log sem tabela
própria — mesmo desenho de `artifact.project_image` (ADR 0065): o vigente é
o de maior `version`, e revisar é gerar de novo, nunca sobrescrever.

- **Onde:** `apps/api/src/domain/architecture/c4-diagram.ts`
  (`gerarDiagramaContexto`/`gerarDiagramaContainer`, puras),
  `apps/api/src/application/use-cases/architecture/create-c4-diagram.use-case.ts`,
  `apps/api/src/application/use-cases/architecture/get-c4-diagram.use-case.ts`,
  `apps/engine/lib/engine/harness/tools/create_c4_diagram.ex`,
  `apps/web/src/components/C4DiagramView.tsx` (renderização, três estados —
  RN-088), `apps/web/src/lib/mermaid-render.ts` (o `mermaid` fica isolado
  aqui, `import()` dinâmico)
- **Teste:** `apps/api/test/domain/architecture/c4-diagram.spec.ts` (sintaxe
  Mermaid válida a partir de um `module_map` de exemplo, aresta pendurada
  ignorada, ids deduplicados),
  `apps/api/test/application/use-cases/architecture/create-c4-diagram.use-case.spec.ts`
  (sem module_map recusa com 400 e não grava nada; Container reflete os
  módulos/dependências reais; versiona ao reemitir),
  `apps/engine/test/engine/harness/tools/create_c4_diagram_test.exs`,
  `apps/web/src/components/C4DiagramView.test.tsx` (sucesso vira SVG, erro
  de sintaxe vira Alert legível sem quebrar a tela, diagrama vazio não tenta
  renderizar)
- **Origem:** pedido do usuário — diagrama C4 do Arquiteto na Visão Geral do
  projeto (ADR 0068)

### RN-150 — `search_workspace` tem teto de QUANTIDADE de hits e de BYTES, cada um com sua marca {#rn-150}

Achado numa revisão de PR: `search_workspace` (dev agents e os dois agentes
de QA/gate, `qa_tools.ex` e `qa_performance_seguranca_agent.ex` — este
último só tem `read_file`/`search_workspace`, sem `Terminal`, de propósito)
devolvia TODOS os resultados da busca, sem teto nenhum — mesma classe do
achado S (`Engine.Actions.TerminalExecutor.truncate/2`) e da correção de
`read_file` (`Engine.Harness.Tools.ReadFile.truncate/2`): o resultado fica
no histórico do laço e viaja em todo turno seguinte, e uma árvore grande
basta pra estourar `{413, "request entity too large"}` do provider.

Dois tetos independentes, porque a busca estoura de duas formas diferentes:

1. **Quantidade de hits** — uma árvore com milhares de arquivos batendo o
   termo produz milhares de linhas `- caminho` mesmo que nenhum arquivo
   individual seja grande. Truncar só por BYTES no fim ainda pagaria o custo
   de escanear e ler o conteúdo de cada um desses arquivos antes de montar a
   string. Por isso o teto de quantidade (`SEARCH_WORKSPACE_MAX_HITS`,
   default 500) vive em `WorkspaceFiles.search/3`, que já PARA de consumir a
   busca assim que encontra hit suficiente — o pipeline roda sobre um
   `Stream`, e `Enum.take(stream, max_hits + 1)` só lê da fonte o que
   precisa pra produzir os `max_hits + 1` primeiros resultados. O "+1" é o
   que permite dizer que HAVIA mais sem continuar escaneando o resto pra
   contar o total exato — contar o total pagaria de novo o I/O que o teto
   existe pra evitar, então a marca diz "mostrando os N primeiros" e nunca
   inventa um total.
2. **Bytes do texto final** — mesmo com hits limitados, caminhos muito
   longos podem produzir uma string grande. Teto de bytes
   (`SEARCH_WORKSPACE_MAX_BYTES`, default 32.768), mesmo padrão de
   `terminal_output_max_bytes`/`read_file_max_bytes` — variável PRÓPRIA,
   não reaproveita as outras duas: mesma classe de estouro, divergir uma não
   deve exigir tocar as outras.

A marca de truncagem é dirigida ao MODELO, não ao humano: diz o que foi
cortado (hits e/ou bytes) e instrui a refinar o termo da busca — mesmo
espírito das marcas de `TerminalExecutor`/`ReadFile`.

- **Onde:** `apps/engine/lib/engine/harness/workspace_files.ex`
  (`search/3`, `take_capped/2`),
  `apps/engine/lib/engine/harness/tools/search_workspace.ex`
  (`truncate/3`, `marca_de_truncagem/5`),
  `apps/engine/config/runtime.exs` (`search_workspace_max_hits`,
  `search_workspace_max_bytes`)
- **Teste:** `apps/engine/test/engine/harness/workspace_files_test.exs`
  (`search/3` com `max_hits` corta a QUANTIDADE e marca truncagem só
  quando há mais que o teto),
  `apps/engine/test/engine/harness/search_workspace_test.exs` (busca com
  poucos resultados não é alterada; busca com mais hits que o teto é
  truncada com aviso claro; texto final maior que o teto de bytes também é
  cortado)
- **Origem:** achado de revisão de PR — segunda causa real do 413 em
  revisões, depois da correção de `read_file`

---

### RN-151 — O badge de projeto na sidebar é aprovações pendentes, não atividade não lida {#rn-151}

O número ao lado do nome de cada projeto em `Shell.tsx` vinha de
`useProjectsUnread` — `latestSeq` (o `seq` mais recente já gravado na sessão)
menos o cursor de "última vez visto" que o navegador guarda em
`read-state.ts`. Isso conta QUALQUER evento novo — `tool.call`,
`agent.response`, chat — não só decisão pendente. Um projeto de teste
mostrava "392" na sidebar (atividade acumulada de uma execução real) enquanto
a aba Aprovações do MESMO projeto mostrava "8" (a contagem de verdade). Um
número que não corresponde a nada acionável ao clicar é pior que nenhum.

O read model do dashboard (`ProjectsSummaryRepository.summarizeForWorkspace`,
RN-090) ganhou `pendingApprovalsCount`: `COUNT(*)` de `proposed_actions` com
`status = 'pending'`, agregado por `project_id` numa consulta a mais no
`Promise.all` já existente — mesmo formato de `storiesAwaitingPromotion`
(RN-048), sem crescer o número de idas ao banco por projeto. A soma é do
projeto INTEIRO, todas as sessões — de propósito diferente da aba Aprovações
(`ProjectApprovalsTab.tsx`), que mostra só as pendências da sessão MAIS
RECENTE: o badge é por PROJETO, não por sessão, e uma pendência numa sessão
antiga continua sendo uma pendência.

`Shell.tsx` parou de importar `useProjectsUnread` — o único consumidor dele
ali era este badge. `Dashboard.tsx`/`ProjectCard.tsx` ganharam o mesmo fio:
o prop `unreadCount` de `ProjectCard` nunca tinha chamador (`ProjectCardContainer`
não o passava), e virou `pendingApprovalsCount` com o mesmo valor da sidebar
— duas telas, um número, uma fonte.

- **Onde:** `apps/api/src/application/ports/projects-summary-repository.port.ts`
  (`ProjectCardSummary.pendingApprovalsCount`),
  `apps/api/src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
  (`summarizeForWorkspace`, consulta agregada sobre `proposed_actions`),
  `apps/web/src/routes/Shell.tsx`, `apps/web/src/routes/Dashboard.tsx`,
  `apps/web/src/components/ProjectCard.tsx`
- **Teste:**
  `apps/api/test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (`pendingApprovalsCount soma o projeto INTEIRO...`, só `pending` conta, não
  vaza entre projetos, número de consultas continua constante),
  `apps/web/src/routes/Shell.test.tsx` (badge de aprovações pendentes)
- **Origem:** achado do usuário navegando a app — badge da sidebar mostrando
  "392" contra "8" de verdade na aba Aprovações do mesmo projeto

---

### RN-152 — A branch de uma task diz de qual dev agent e módulo ela é, no dropdown da aba Code {#rn-152}

`CodeBranchPicker` já listava toda branch do repositório, inclusive as dos
dev agents (`feature/task-XXXXXXXX`, `Engine.Dev.AgentIo`), mas sem pista
nenhuma de quem a criou — só o nome cru. `ReadProjectCodeUseCase.branches`
resolve isso sem chamada a mais ao provider de git: os 8 chars depois de
`feature/task-` são exatamente o primeiro grupo hifenizado do uuid da task
(`"feature/task-" <> String.slice(to_string(row.task_id), 0, 8)`, não um
substring arbitrário), então casam contra `TaskRepository
.findByProjectAndIdPrefix` (join por PROJETO, pra prefixo de 8 chars nunca
vazar task de outro projeto). O `assignedTo` da task é o agent_id
(`dev-<modulo>`/`dev-<modulo>-2`, RN-087); o módulo é resolvido comparando
contra o `module_map` VIGENTE do projeto pelas MESMAS funções que o geraram
(`devAgentId`/`extraDevAgentId` em `activate-execution.use-case.ts`) — nunca
por regex reversa, que degeneraria em ambiguidade pra nome de módulo com
caractere especial.

`producedBy: { agentId, moduleId } | null` é degradação honesta, do mesmo
jeito que `ahead`/`behind` já são: `null` pra branch sem o padrão (manual do
usuário, ou `main`/`dev`/`qa`), e também quando o padrão bate mas a
task/módulo não são mais resolvíveis (task apagada, módulo removido do mapa
vigente) — nunca um valor inventado. No dropdown, cada branch produzida por
um dev ganha o ícone e a cor do agente (`AGENTS`/`agents.ts`, RN-087),
reaproveitando a MESMA degradação que `apps/web/src/lib/agent-status.ts` já
usa pro roster ao vivo: módulo sem chave fixa em `AGENTS` herda ícone/cor de
`dev-backend`.

- **Onde:** `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (`branches`/`producedBy`/`moduloDoAgente`),
  `apps/api/src/application/ports/backlog-repository.port.ts`
  (`TaskRepository.findByProjectAndIdPrefix`),
  `apps/api/src/infrastructure/persistence/drizzle/backlog.repository.ts`,
  `apps/api/src/interfaces/http/git/dto/code.response.dto.ts`
  (`CodeBranchProducedByResponseDto`), `apps/web/src/lib/api-types.ts`
  (`CodeBranchProducedBy`), `apps/web/src/routes/code/CodeBranchPicker.tsx`
  (`IconeDoAgenteProdutor`/`defDoAgenteProdutor`)
- **Teste:**
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (describe "producedBy da branch de task" — task resolvida com módulo e com
  o agente extra `-2`, branch fora do padrão nunca ganha `producedBy` mesmo
  com task de prefixo casável, prefixo sem task no projeto, módulo removido
  do mapa vigente e task sem dono ainda degradam pra `null`),
  `apps/web/src/routes/code/CodeBranchPicker.test.tsx` (branch de task mostra
  o selo do dev agent dono; branch sem padrão não ganha selo nenhum)
- **Origem:** pedido do usuário — nenhuma pista visual de quem criou a
  branch no dropdown rico da FASE 26b

### RN-153 — "Auto mode": o `ApprovalCard` liga autonomia pra QUALQUER ação futura de um agente {#rn-153}

Antes deste RN, `agent_autonomy` só sabia conceder autonomia por
`(projeto, agente, TIPO de ação)` — uma linha por tipo, upsert de UMA regra
por vez (`SetAgentAutonomyUseCase`,
`apps/api/src/application/use-cases/actions/set-agent-autonomy.use-case.ts`).
Confiar amplamente num agente exigia uma linha por tipo — `terminal`,
`write_file`, `pr_open`… — e tipo novo nascia sem regra, de volta a
`require_approval`.

"Auto mode" é o valor especial `actionType: "*"` na MESMA tabela e no MESMO
endpoint (`PUT /projects/:projectId/agent-autonomy`) — não é mecanismo novo,
é a coluna existente (`agent_autonomy.action_type`, `text` livre, sem enum
nem FK — `apps/api/src/db/schema/agents.ts`) aceitando um valor a mais. A curinga
significa "autonomia pra qualquer tipo de ação DESTE agente" e é resolvida
em `DrizzleAgentAutonomyRepository.findMode`
(`apps/api/src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts`):
busca a regra ESPECÍFICA e a curinga na mesma consulta, e a específica
sempre vence — gravar `terminal: deny` com `"*": auto_approve` já ligado
continua negando `terminal` desse agente, e liberando o resto. `decide()`
(`apps/api/src/domain/actions/decide.ts`) não muda: ele recebe o
`PermissionPolicy` já resolvido em `ctx.autonomyMode`, exatamente como antes
da curinga existir — é por isso que os tetos absolutos valem sem precisar
saber que "auto mode" existe (ver [RN-154](#rn-154)).

O `ApprovalCard` (`apps/web/src/components/ApprovalCard.tsx`) ganha o botão
"Modo automático" ao lado de "Sempre permitir", visível só quando: (a) a
ação está `pending`, (b) quem propôs é um AGENTE (`actor.kind === 'agent'` —
não há autonomia de agente para conceder a um usuário) e (c) quem chama
(`ProjectApprovalsTab.tsx`/`SessionPage.tsx`) já confirmou papel
`maintainer`/`owner` no workspace — mesma exigência do endpoint
(`@RequireRole('maintainer')`, inalterado). O prop `onActivateAutoMode` é
`undefined` para quem não tem o papel — o card ESCONDE o botão em vez de
mostrá-lo desabilitado, e a checagem mora em quem chama, não no card
(componente presentational, sem query própria).

**Desligar** reusa o toggle manual/auto que o card do agente já tinha (Fase
8d) — nenhuma tela nova. `AgentTeamGrid.tsx` passa a procurar a regra
curinga do agente ANTES da representativa (`autonomyActionTypeFor`): se
existir, o toggle do card reflete e edita a CURINGA, não mais o tipo
representativo — desligar é gravar a mesma curinga como
`require_approval`, e o toggle no card do agente é exatamente esse
"desligar".

- **Onde:** `apps/api/src/domain/actions/decide.ts`
  (`AGENT_AUTONOMY_ALL_ACTIONS`, `AgentAutonomyActionType`),
  `apps/api/src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts`
  (`findMode` com precedência específica > curinga),
  `apps/api/src/interfaces/http/actions/dto/set-agent-autonomy.dto.ts`
  (aceita `"*"`), `apps/web/src/components/ApprovalCard.tsx` (botão "Modo
  automático"), `apps/web/src/components/AgentTeamGrid.tsx` (toggle
  passa a priorizar a curinga), `apps/web/src/routes/ProjectApprovalsTab.tsx`
  e `apps/web/src/routes/SessionPage.tsx` (`handleActivateAutoMode`, gate de
  papel via `useCurrentWorkspaceWithRole`)
- **Teste:**
  `apps/api/test/infrastructure/persistence/drizzle/agent-autonomy.repository.spec.ts`
  (precedência específica > curinga; curinga é por agente; desligar é
  regravar a curinga como `require_approval`),
  `apps/api/test/application/use-cases/actions/propose-action.use-case.spec.ts`
  (auto mode auto-aprova ação comum SEM bater em `permissions.json`; regra
  específica em `deny` vence a curinga),
  `apps/api/test/interfaces/http/actions/agent-autonomy.controller.spec.ts`
  (`PUT`/`GET` continuam exigindo `maintainer`; DTO aceita `"*"` e recusa
  string fora da lista), `apps/web/src/components/ApprovalCard.test.tsx`
  (botão some sem `onActivateAutoMode`; clique chama o callback; nota
  explica os tetos que continuam pedindo decisão)
- **Origem:** pedido do usuário — "Sempre permitir" só grava um padrão de
  comando específico, e `agent_autonomy` só cobria um tipo de ação por vez;
  faltava confiar amplamente num agente com um clique só

### RN-154 — Os três tetos absolutos continuam bloqueando MESMO com "auto mode" ligado {#rn-154}

O desenho do "auto mode" ([RN-153](#rn-153)) é deliberadamente incapaz de
furar os três tetos que já existiam em `decide()` — eles são aplicados por
ÚLTIMO, sobre `current.policy`, sem olhar de onde veio a permissividade
(`agent_autonomy` com tipo específico, curinga, ou `permissions.json` — a
função nunca soube distinguir as origens, e continua sem saber):

1. **Merge em branch protegida** (`git_merge` com destino em
   `dev`/`qa`/`rc`/`main`, [RN-006](../business-rules.md#rn-006)) — a trava de merge
   (`isProtectedBranch`) rebaixa `auto_approve` para `require_approval`
   sempre, mesmo com `"*": auto_approve` ligado pro agente.
2. **`instruction_patch`** ([RN-007](../business-rules.md#rn-007)) — mudar a instrução de outro
   agente exige o humano ver o diff; auto mode não muda isso.
3. **`parallelize`/`raise_max_parallel`** ([RN-086](../business-rules/custo.md#rn-086)) — subir o
   teto de paralelismo, ou pedir mais agente acima dele, continua decisão
   do usuário; um agente com auto mode ligado não consegue se auto-conceder
   mais poder de gasto.

A prova é por CONSTRUÇÃO, não por caso a caso: como os três tetos verificam
só `current.policy === 'auto_approve'` — nunca a origem —, e "auto mode" só
consegue chegar em `current.policy === 'auto_approve'` pelo MESMO caminho
que uma regra específica de `agent_autonomy` já usava
(`ctx.autonomyMode`), os tetos que já continham `agent_autonomy` continuam
contendo a curinga sem precisar de código novo. O risco real não era o
teto — era alguém, ao generalizar `agent_autonomy` pra aceitar `"*"`,
inserir a checagem da curinga ANTES dos tetos e reabrir a porta; por isso
`AGENT_AUTONOMY_ALL_ACTIONS` foi resolvido inteiramente no REPOSITÓRIO
(antes de `decide()` rodar), e `decide()` em si não ganhou nenhuma linha
nova — só o suficiente pra não ter onde a curinga furar.

- **Onde:** `apps/api/src/domain/actions/decide.ts` (os três blocos de teto,
  linhas ~207–258, inalterados por esta feature)
- **Teste:**
  `apps/api/test/application/use-cases/actions/propose-action.use-case.spec.ts`
  ("auto mode NÃO auto-aprova merge em branch protegida", "... instruction_patch",
  "... parallelize/raise_max_parallel" — os três com `agent_autonomy` "*"
  gravado como `auto_approve` e o veredito continuando `require_approval`)
- **Origem:** restrição de design confirmada pelo usuário ao pedir o "auto
  mode" — os três tetos são a garantia que não pode regredir

### RN-155 — ordenação da timeline usa o vínculo `proposed_action.created`, nunca `action.seq` cru {#rn-155}

A `timeline` de `SessionPage.tsx` ordena eventos e ações propostas por um
único eixo numérico comparável. Para eventos, é `event.seq` (gapless, por
sessão). Para ações, é o `seq` do evento `proposed_action.created` correlato
(achado por `payload.actionId === action.id`, gravado por
`ProposeActionUseCase` na MESMA transação que cria a ação) — nunca
`action.seq`, que é `bigserial` único e global de toda a tabela
`proposed_actions`, compartilhado por todas as sessões e projetos do
sistema, e portanto incomparável com `event.seq` (contraste deliberado, ver
`apps/api/src/db/schema/actions.ts`). Comparar os dois direto produzia ordem
imprevisível toda vez que um `ApprovalCard` entrava na mistura com eventos
normais. Ações sem esse vínculo (só o bootstrap de Gitflow —
`git_repo_create`/`git_branch_create`, que gravam apenas outbox) degradam
para uma posição interpolada por `createdAt`, ancorada no último evento
anterior.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`ordemDaAcaoNaTimeline`)
- **Teste:** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **Origem:** achado de PR #286 — cards de aprovação apareciam fora de ordem
  na timeline, misturados com eventos normais

### RN-156 — indicador de espera de 5s tem texto fixo, sem interpolar o agente {#rn-156}

O indicador que aparece depois de 5s sem resposta (`pensandoVisivel`) mostra
a frase fixa "Reunindo informações...", sem o nome do agente interpolado —
substitui o texto anterior "{Agente} está escrevendo…". O nome do agente já
é visível no cabeçalho assim que o streaming de texto real começa; repeti-lo
no indicador de espera não ajudava a leitura.

- **Onde:** `apps/web/src/routes/SessionPage.tsx`
- **Teste:** `apps/web/src/routes/SessionPage.pista-e-status.test.tsx`,
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **Origem:** achado de PR #286 — o texto anterior nomeava um agente que já
  estava visível no cabeçalho

### RN-157 — criação de épico/história pelo PO vira aviso compacto, não bolha completa {#rn-157}

Os eventos `backlog.epic_created`/`backlog.story_created` deixam de
renderizar como bolha completa de mensagem (`.message`/`.bubble`, avatar de
32px — o mesmo peso visual de uma resposta de agente de verdade) e passam a
usar o mesmo formato de aviso compacto que `.handoffDivider`/`.handoffPill`
já usa para a passagem de bastão: linha centralizada com filete horizontal e
pílula compacta, mantendo o link "Ver no Backlog". `agentId` continua
populado no `TimelineEntry` — ao contrário do divisor de handoff, isto não
marca uma transição entre agentes, é uma ação do PO dentro do próprio turno
dele, e segue elegível ao colapso por agente ([RN-138](../business-rules.md#rn-138)).

- **Onde:** `apps/web/src/routes/SessionPage.tsx`
- **Teste:** `apps/web/src/routes/SessionPage.handoff-inline-e-links.test.tsx`,
  `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **Origem:** achado de PR #286 — a bolha completa tinha peso visual igual a
  uma resposta de agente de verdade, para uma ação de metadado do PO

### RN-158 — Markdown leve com highlight no chat {#rn-158}

`agent.response` no fio da Sessão renderiza um subconjunto de Markdown
(negrito `**texto**`, itálico `*texto*`/`_texto_`, código inline
`` `texto` ``, cabeçalho `#`/`##`/`###`, lista `-`/`1.`, link
`[texto](url)` e fence de código ```` ```linguagem ````), via parser
próprio por regex (`apps/web/src/lib/markdown.ts`), sem dependência nova.
`chat.message` (texto digitado pelo usuário) permanece literal — Markdown
só se aplica à SAÍDA de um agente/LLM, nunca à entrada humana.

Segurança: o parser nunca produz HTML — devolve uma árvore de dados que
`MarkdownMessage.tsx` converte em elementos React diretamente (nunca
`dangerouslySetInnerHTML`). Um link só vira `<a href>` clicável quando o
esquema da URL é `http`, `https` ou relativo (`/...`, `#...`); qualquer
outro esquema (`javascript:`, `data:`, etc.) degrada para o texto do link,
nunca para um `href` executável.

Código dentro de um fence ganha realce por token, reusando
`highlightLine`/`highlightFile` de `apps/web/src/routes/code/highlight.ts`
— a mesma função que já colore a aba Code. `sh`/`bash` ganharam
vocabulário próprio de palavras-chave de shell (antes só tinham o
comentário de linha `#` mapeado e caíam no fallback de JS). Fences
```` ```sh ````/```` ```bash ```` ganham a estética visual de terminal
(prompt `$` por linha de comando), consistente com o `$ comando` que
`ApprovalCard` já usa para a ação `terminal`.

- **Onde:** `apps/web/src/lib/markdown.ts`,
  `apps/web/src/components/ui/MarkdownMessage.tsx`,
  `apps/web/src/routes/code/highlight.ts`
- **Teste:** `apps/web/src/lib/markdown.test.ts`,
  `apps/web/src/components/ui/MarkdownMessage.test.tsx`,
  `apps/web/src/routes/code/highlight.test.ts`,
  `apps/web/src/routes/SessionPage.markdown-resposta.test.tsx`
- **Origem:** PR #288 — respostas de agente com listas, código e links
  chegavam como texto cru no fio, sem estrutura nenhuma

### RN-159 — Artefatos Gerados agrupados por agente {#rn-159}

O painel "Artefatos gerados" da Sessão (`ContextAside` em
`SessionPage.tsx`) lista PR de dev (`pr_open`), PR de ADR do Arquiteto
(`open_adr_pr`) e épico/história criados pelo PO
(`backlog.epic_created`/`backlog.story_created`), agrupados por
`agentId` — quem gerou cada artefato — com o mesmo padrão de
`Disclosure` colapsável da [RN-138](../business-rules.md#rn-138) (nome do agente + contagem,
expansível pro título de cada artefato).

Cada artefato navega pro lugar onde ele vive: PR (dev ou ADR) abre a URL
real (`executionResult.pullRequestUrl`, mesmo campo que
`ProjectOverviewTab.tsx` já lê para PR de ADR); épico/história navega
para `/projects/:projectId?tab=backlog` (mesmo padrão `Link` já usado nos
avisos compactos do PO no fio principal, [RN-124](../business-rules.md#rn-124)/
[RN-157](#rn-157)). PR ainda sem `pullRequestUrl` (execução pendente)
aparece no painel sem virar link clicável.

Fora de escopo, por decisão registrada em comentário no código
(`ContextAside` em `SessionPage.tsx`): module_map/C4 — são estado
VIGENTE do projeto (uma versão corrente, sobrescrita a cada geração), não
um artefato datado por SESSÃO como PR/épico/história; a aba Visão Geral
(`ProjectOverviewTab.tsx`) já é o lugar deles hoje, sem âncora própria —
endereçar isso é fora do escopo desta entrega.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`ContextAside`)
- **Teste:** `apps/web/src/routes/SessionPage.artefatos-gerados.test.tsx`
- **Origem:** PR #288 — o painel não distinguia quem gerou cada artefato
  nem cobria PR de ADR e épico/história, só PR de dev

### RN-160 — "Confirmar arquitetura pronta" exige pelo menos 1 história promovida {#rn-160}

O botão "Confirmar arquitetura pronta" (handoff Arquiteto→Dev Lead, via
`confirmArchitectureReadiness`) nasce `disabled` até existir no backlog do
projeto pelo menos 1 história com status diferente de `draft` — ou seja, já
promovida por `PromoteStoriesUseCase`/`TransitionStoryUseCase` ([RN-048](../business-rules/custo.md#rn-048)),
não bastando ter regra de negócio capturada. `in_progress`/`done` também
contam, porque só se chega lá tendo passado por `ready`. A fonte é a MESMA
que a aba Backlog já usa (`useBacklog`, `ProjectBacklogTab.tsx`, mesma
queryKey `['backlog', projectId]`) — sem round-trip novo. Enquanto não há
história promovida, o botão mostra a dica em `title` explicando o motivo.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`hasPromotedStory`,
  render do botão)
- **Teste:** `apps/web/src/routes/SessionPage.readiness-arquitetura-exige-historia.test.tsx`
- **Origem:** pedido do usuário — o botão de handoff Arquiteto→Dev Lead
  não tinha gate nenhum

Só valia no CLIENTE: uma chamada HTTP direta ignorava a regra. Fechado por
[RN-404](../business-rules.md#rn-404) (ADR 0094), que revalida no backend.

### RN-161 — Aceitar o handoff pro Dev Lead encadeia a ativação de execução quando o papel efetivo já autoriza {#rn-161}

`handleAcceptHandoff` (`SessionPage.tsx`) encadeia `activateExecution`
automaticamente quando `toAgent === 'dev-lead'` E o papel EFETIVO de quem
aceita — lido do mesmo `useCurrentWorkspaceWithRole()` que já autoriza o
"Auto mode" ([RN-153](#rn-153)) e as telas de Aprovações/Configurações — é
`owner` ou `maintainer`. Para `developer` (ou papel ainda não resolvido), o
fluxo atual continua intocado: aceitar não ativa nada, e "Ativar execução"
permanece como segundo botão. A checagem é só no cliente —
`POST .../execution/activate` continua exigindo `maintainer` no backend
([RN-137](../business-rules.md#rn-137)); a fusão só evita um clique redundante para quem já
tinha os dois papéis. Reusa a MESMA `handleActivateExecution` que o botão
"Ativar execução" já chama, que trata o próprio erro (toast +
`mensagemDaApi`) e nunca relança — evita que um erro de ativação tardio
seja reportado como "não foi possível aceitar o handoff".

- **Onde:** `apps/web/src/routes/SessionPage.tsx`
  (`podeFundirHandoffComExecucao`, `handleAcceptHandoff`)
- **Teste:** `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx`,
  describe "problema 4"
- **Decisão arquitetural:** [ADR 0069](../adr/0069-fusao-condicional-do-handoff-com-a-ativacao-de-execucao.md)
- **Origem:** pedido do usuário (desenho aprovado)

### RN-162 — Perguntas estruturadas do Criativo {#rn-162}

O Criativo pode, quando faz VÁRIAS perguntas na mesma resposta, emitir a
lista em formato ESTRUTURADO em vez de deixar o usuário responder item por
item em texto livre — ferramenta nova `ask_structured_questions`
(`apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`,
`:direct`), registrada ao lado de `emit_artifact`. Schema:
`{ questions: [{ id, label, type?, options? }] }` — `id` único e não-vazio,
`label` não-vazio, `type` ∈ `text|textarea|select` (default `text`),
`options` obrigatório e não-vazio quando `type: select`. Grava
`chat.structured_question`.

O frontend (`StructuredQuestionCard`, `SessionPage.tsx`) renderiza um
formulário com um campo por pergunta — `Input`/`Textarea`/`Select` do
design system, conforme `type`. `POST .../agents/:agent/structured-
question/:questionSetId/answer` (`AnswerStructuredQuestionUseCase`) valida
que toda pergunta tem resposta não-vazia, grava
`chat.structured_question_answered` (referenciando `questionSetId` = id do
evento da pergunta) e REUSA `SendAgentMessageUseCase` — as respostas viram
uma mensagem concatenada ("1. {label}: {resposta}\n2. ..."), como se o
usuário tivesse digitado no fio; não há canal novo de "o agente lê a
resposta estruturada". Um conjunto de perguntas só pode ser respondido
UMA vez: reenvio é recusado com 409, e o formulário nem chega a
reaparecer — o card vira somente leitura assim que existe um
`chat.structured_question_answered` posterior com o mesmo `questionSetId`.

- **Onde:** `apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`,
  `apps/engine/lib/engine/agents/criativo_server.ex`,
  `apps/api/src/application/use-cases/agents/answer-structured-question.use-case.ts`,
  `apps/api/src/interfaces/http/agents/agents.controller.ts`,
  `apps/web/src/routes/SessionPage.tsx` (`StructuredQuestionCard`)
- **Teste:** `apps/engine/test/engine/harness/tools/ask_structured_questions_test.exs`,
  `apps/engine/test/engine/agents/criativo_server_test.exs`,
  `apps/api/test/application/use-cases/agents/answer-structured-question.use-case.spec.ts`,
  `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
- **Origem:** pedido do usuário — sem precedente de input estruturado no chat

### RN-163 — O Criativo cumpre a promessa de tentar de novo {#rn-163}

Cada turno do Criativo roda um **laço bounded de tool use**, com teto de **12**
idas ao modelo — o mesmo desenho que o PO e o Arquiteto já tinham. Antes o
modelo era chamado UMA vez por turno: o resultado da ferramenta era anexado ao
histórico em memória e ninguém mais o lia, então a frase *"vou corrigir e
tentar de novo"* — literal no código — só se cumpria se o usuário mandasse
outra mensagem. Para quem usava, o Criativo simplesmente parava de responder
depois de dizer que ia corrigir.

Quatro consequências, e cada uma é uma regra:

1. **Erro de ferramenta é entrada, não fim de linha.** O motivo volta ao modelo
   como mensagem `tool` e o laço chama o modelo de novo, que reemite corrigido
   DENTRO do mesmo turno.
2. **Nada se anuncia que o código não vá executar.** A frase de retentativa é
   decidida depois de despachar as ferramentas e sabendo quantas voltas
   sobraram: com volta disponível, o agente diz que vai corrigir; sem volta, ele
   não promete.
3. **A falha de ferramenta virou `agent.error` durável, com origem**
   ([RN-059](../business-rules/custo.md#rn-059)) — era `agent.response`, indistinguível no event log de
   uma resposta normal. `origem: infra` quando a api recusou o `append_event`;
   `origem: modelo` para o payload que o modelo escreveu (chave errada,
   `origin` que não é lista, regra duplicada, tipo system-emitted). O payload
   carrega `tool` e `retentativa`.
4. **Teto esgotado não termina em silêncio.** Vira `agent.error` com
   `reason: "limite_de_iteracoes"` e `origem: modelo`, a mesma leitura do
   `toolloop.limit_reached` do `ToolLoop`. O nome do evento NÃO é reusado: este
   agente não roda dentro do `ToolLoop`, e o evento mentiria sobre quem o
   produziu.

Duas fronteiras do laço, ambas deliberadas: `ask_structured_questions`
bem-sucedida **encerra** o turno (a bola está com o usuário, e as respostas
voltam num turno futuro — [RN-162](#rn-162)); e um turno que teve falha em
alguma volta fecha com um desfecho CONSOLIDADO no fio, para a última palavra
não ser o erro de uma volta que já foi corrigida depois.

- **Onde:** `apps/engine/lib/engine/agents/criativo_server.ex`
  (`run_turn_capturing/3`, `continuar/4`, `emit_falha_de_ferramenta/4`,
  `emit_falha_limite/2`)
- **Teste:** `apps/engine/test/engine/agents/criativo_server_test.exs`
  (laço que corrige de verdade, teto esgotado narrado, origem `infra` vs
  `modelo`, pergunta estruturada que encerra o turno)
- **Origem:** uso real no projeto `exp001` — "o Criativo não respondeu depois
  de dizer que iria corrigir e tentar de novo"

### RN-169 — O projeto escolhe onde o código mora: Local ou Container {#rn-169}

**REVISADA pela [RN-421](../business-rules.md#rn-421) (ADR 0104)**: `workspace_mode`/`local`
viraram `execution_mode` de TRÊS valores (`container`/`mounted`/`runner`,
migração `0048`) — o resto desta entrada é histórico, fiel ao que valia até
a revisão.

Um projeto nasce com um **modo de workspace** (`projects.workspace_mode`,
migração `0043`), e é ele que decide de onde a raiz de escopo é derivada:

- **`container`** (DEFAULT, e o comportamento que sempre existiu): a pasta
  GERENCIADA pelo produto, `join(PROJECT_WORKSPACES_ROOT, workspace_dir_name)`
  ([RN-109](#rn-109));
- **`local`**: uma pasta DO USUÁRIO, no caminho absoluto de
  `projects.workspace_path`.

O par é amarrado por CHECK no banco
(`(workspace_mode = 'local') = (workspace_path IS NOT NULL)`), e não só pelo
caso de uso: a coluna é lida por DOIS processos (api e engine) e escrita por
scripts de seed/backfill que não passam por ele. `local` sem caminho seria
escopo de terminal apontando para lugar nenhum; `container` com caminho seria
uma segunda fonte de verdade esperando divergir da primeira.

A derivação continua **única** — `projectScopeRoot` passou a receber a
localização (`{workspaceDirName, workspaceMode, workspacePath}`) e escolhe o
ramo; nenhum dos quatro consumidores ([RN-092](../business-rules/custo.md#rn-092)) ganhou validação
própria. O engine resolve o mesmo localizador na CONSULTA (nome de pasta no
`container`, caminho absoluto no `local`) e distingue os dois pela barra
inicial, que é inequívoca porque o nome de pasta é validado contra
`^[A-Za-z0-9_-]{1,64}$`.

Duas consequências explícitas do modo `local`:

1. **O portão da imagem do Arquiteto ([RN-105](#rn-105)) NÃO vale.**
   **REVOGADO pela [RN-494](../business-rules.md#rn-494) (ADR 0135)**: a
   dispensa terminou — os três modos passam a exigir a decisão de imagem
   antes de abrir a aba Code. O resto deste item é histórico. Projeto
   Local não sobe container, então a aba Code liberava sem esperar decisão
   que nunca ia acontecer. A dispensa morava no mesmo funil do portão na
   api, e a tela concordava: `ProjectCodeTab` nem chegava a perguntar o
   estado do container ([RN-107](#rn-107)) quando o projeto era Local — se
   só a api dispensasse, a aba continuaria bloqueada na tela por uma
   decisão inexistente.
2. **O `permissions.json` mora na pasta do usuário**, junto com o código —
   porque a política tem que ser lida da MESMA raiz que o escopo de terminal
   autoriza.

`workspace_mode` não confunde com o `GitProviderName` `'local'`: um diz onde o
CÓDIGO mora em disco, o outro onde o REPOSITÓRIO git vive, e as duas escolhas
são ortogonais.

- **Onde:** `apps/api/src/db/schema/iam.ts` (`projects`),
  `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`projectScopeRoot`), `apps/api/src/domain/iam/project.entity.ts`,
  `apps/api/src/application/use-cases/git/read-project-code.use-case.ts`
  (`portaoDoContainer`), `apps/web/src/routes/ProjectCodeTab.tsx`,
  `apps/engine/lib/engine/projects/project.ex`,
  `apps/engine/lib/engine/actions/workspace.ex` (`workspace_dir/2`),
  `apps/engine/lib/engine/dev/worktree_cleanup.ex` (que era a segunda
  derivação escrita à mão, e passou a usar a única),
  `apps/web/src/routes/NewProjectWizard.tsx`
- **Teste:** `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (describe "projectScopeRoot no modo local"),
  `apps/api/test/infrastructure/filesystem/fs-permissions-file-store.spec.ts`
  (o permissions.json na pasta do usuário),
  `apps/api/test/application/use-cases/iam/create-project-modo-de-workspace.spec.ts`,
  `apps/api/test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (projeto Local não passa pelo portão),
  `apps/api/test/interfaces/http/iam/project-dto-modo-de-workspace.spec.ts`
  (o modo é congelado: PATCH não o muda),
  `apps/web/src/routes/ProjectCodeTab.test.tsx` (a tela também dispensa o gate),
  `apps/engine/test/engine/actions/workspace_test.exs`
  (describe "workspace_dir/2 com o localizador já resolvido"),
  `apps/web/src/routes/NewProjectWizard.test.tsx`
- **Decisão arquitetural:** [ADR 0072](../adr/0072-projeto-local-ou-container.md)
- **Origem:** pedido do usuário (decisão dele, com a variante de caminho livre
  escolhida explicitamente)

### RN-170 — Caminho Local é validado na CRIAÇÃO, e a recusa ensina {#rn-170}

**REVISADA pela [RN-422](../business-rules.md#rn-422) (ADR 0104)**: a validação de criação passou
a DIVERGIR por modo — `mounted` (o `local` renomeado) continua tocando disco
como descrito aqui, `runner` valida só o LÉXICO, sem I/O — o resto desta
entrada é histórico, fiel ao que valia até a revisão.

Criar um projeto no modo `local` com um caminho que a api não alcança produz um
projeto que **trava depois** — na primeira ferramenta do primeiro agente, longe
da tela onde a decisão foi tomada. Por isso a criação **recusa com 400**, e a
mensagem diz o que falta fazer.

O caminho precisa ser:

1. **absoluto**, sem `..` nem `.` em nenhum segmento (o caminho gravado é o
   caminho que se lê; `/srv/app/../../etc` é `/etc` e não parece);
2. **existente e uma pasta** dentro do container da api;
3. **gravável pelo processo** (`access(W_OK|X_OK)`) — as imagens rodam non-root
   ([ADR 0024](../adr/0024-fase5-imagens-producao-ci.md)), e pasta do host com
   outro dono chega montada como somente leitura na prática;
4. **fora da raiz e das pastas de sistema** (`/`, `/etc`, `/usr`, `/var`,
   `/data`… e tudo abaixo delas): a raiz do projeto é o escopo que AUTORIZA o
   terminal do agente ([ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md)),
   e um projeto com raiz em `/etc` transforma "o agente escreve no projeto dele"
   em "o agente reescreve o container";
5. **sem sobreposição com o checkout do Brabo, nos DOIS sentidos** — a pasta que
   CONTÉM o monorepo e a pasta DENTRO dele. O segundo caso é o problema que o
   ADR 0055 relata acontecendo de verdade.

O caminho gravado é o **normalizado**, não a string crua: validar uma string e
gravar outra é como a validação deixa de valer no dia seguinte. `workspacePath`
enviado junto com `workspace_mode: container` é RECUSADO, não ignorado — campo
descartado em silêncio vira "mas eu configurei".

A parte LÉXICA (itens 1, 4 e 5) roda **também na leitura**, a cada derivação de
`projectScopeRoot`: o único jeito de burlar a criação é escrever direto no
banco, e o que se ganha ali é escopo de terminal em `/`. A parte de DISCO
(itens 2 e 3) roda só na criação, onde o usuário ainda pode corrigir.

A recusa por pasta ausente traz a instrução de montagem — o arquivo, os dois
serviços e a linha (`- <caminho>:<caminho>`), com o ponteiro para
[o runbook](../runbook.md). Montar só na api produz um projeto que a api aceita e o
engine não enxerga: ela valida o que ela vê, e não tem como saber o que está
montado no outro container.

- **Onde:** `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
  (`validarCaminhoDeWorkspaceLocal`, `CaminhoLocalInvalidoError`),
  `apps/api/src/application/use-cases/iam/create-project.use-case.ts`
  (`caminhoValidado`), `apps/api/src/interfaces/http/iam/dto/create-project.dto.ts`,
  `apps/web/src/lib/wizard.ts` (`caminhoLocalParecePlausivel`)
- **Teste:** `apps/api/test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (describe "validarCaminhoDeWorkspaceLocal"),
  `apps/api/test/application/use-cases/iam/create-project-modo-de-workspace.spec.ts`
  (describe "a criação RECUSA o caminho que travaria depois"),
  `apps/web/src/lib/wizard.test.ts`, `apps/web/src/routes/NewProjectWizard.test.tsx`
- **Decisão arquitetural:** [ADR 0072](../adr/0072-projeto-local-ou-container.md)
- **Origem:** guarda exigida pela variante de caminho livre (ADR 0072)

---

### RN-164 — O PO LÊ o que já existe, escopado ao projeto {#rn-164}

O PO ganhou duas ferramentas de LEITURA — `listar_regras_de_negocio` e
`listar_backlog` (`:direct`, sem parâmetro nenhum) — servidas por duas rotas
internas escopadas ao **projeto**: `GET /internal/projects/:projectId/business-rules`
e `GET /internal/projects/:projectId/backlog`.

A primeira devolve todo `artifact.business_rule` das sessões do projeto com a
`description` inteira, quais histórias já citam cada regra e o
`uncoveredCount`; a segunda devolve a MESMA árvore épico → história → tarefa
da aba Backlog, pelo mesmo `ListBacklogUseCase` (três leituras por projeto,
nunca N+1). O texto que volta ao modelo põe as regras DESCOBERTAS primeiro e
os épicos ÓRFÃOS antes da árvore — é o que gera trabalho.

O que a regra corrige: até aqui o PO tinha **quatro ferramentas e todas de
escrita**. O contexto dele era montado uma vez, no kickoff, a partir dos 200
últimos eventos da **sessão** — dali em diante ele não sabia quais regras
existiam, quais já tinha coberto, nem o que já havia criado. O escopo é o
projeto e não a sessão de propósito: regra capturada numa sessão anterior é
exatamente o que a leitura por sessão escondia.

Ler **não** vira `proposed_action` (não é efeito externo), mas é CONTIDA no
sentido do ADR 0060: nenhuma das duas rotas aceita parâmetro além do id do
projeto — sem busca, sem paginação, sem filtro —, o custo por chamada é
constante, e o texto entregue ao modelo tem teto de linhas dizendo o total
real quando trunca.

- **Onde:** `apps/engine/lib/engine/harness/tools/listar_regras_de_negocio.ex`,
  `apps/engine/lib/engine/harness/tools/listar_backlog.ex`,
  `apps/engine/lib/engine/agents/po_server.ex`,
  `apps/engine/lib/engine/sessions/engine_api_client.ex`,
  `apps/api/src/application/use-cases/backlog/list-business-rules.use-case.ts`,
  `apps/api/src/interfaces/http/internal/internal-projects.controller.ts`
- **Teste:** `apps/engine/test/engine/harness/tools/listar_regras_de_negocio_test.exs`,
  `apps/engine/test/engine/harness/tools/listar_backlog_test.exs`,
  `apps/engine/test/engine/agents/po_server_test.exs`,
  `apps/api/test/application/use-cases/backlog/list-business-rules.use-case.spec.ts`
- **Origem:** uso real no projeto `exp001` — "crie ferramenta para o PO
  conseguir listar as regras de negócio"

---

### RN-165 — Épico sem história é cobrado, e o PO pergunta quando não sabe {#rn-165}

Quando o PO encerra um turno tendo criado um épico e **nenhuma história para
ele**, isso vira desfecho EXPLÍCITO: evento durável
`backlog.epic_without_story` (com `origem: "modelo"`, os ids e títulos dos
épicos e a mensagem) mais o broadcast `agent.error` — o padrão da
[RN-059](../business-rules/custo.md#rn-059): o log é o que sobrevive, o broadcast é o agente dizendo no
fio. A cobrança é por OCORRÊNCIA: reportada uma vez, a lista de pendências é
esvaziada, e não vira alarme que repete a cada turno.

O que conta é a criação que **deu certo**: um `create_story` recusado pela api
(`business_rule_id` inexistente, por exemplo) não quita o épico. Tratá-lo como
se quitasse seria trocar um silêncio por outro. Os épicos pendentes vivem no
state do `PoServer` e NÃO são reidratados: a cobrança é sobre a obrigação
assumida no turno, e reconstruí-la do event log reabriria épico antigo que o
usuário já resolveu de outro jeito.

Junto vieram as duas peças que faltavam para o PO ter uma saída além de parar:
`ask_structured_questions` — a MESMA ferramenta do Criativo
([RN-162](#rn-162)), só passada a advertisar no `po_server` — e a instrução de
kickoff dizendo, com todas as letras, que épico sem história trava a execução
e que **faltando informação se PERGUNTA**, nunca se para nem se inventa. A
instrução anterior não dizia uma palavra sobre o que fazer diante de uma
lacuna, e diante de uma lacuna sem instrução um modelo escolhe entre inventar
e parar.

- **Onde:** `apps/engine/lib/engine/agents/po_server.ex`
  (`anotar_obrigacao/4`, `encerrar_turno/1`, `obrigacoes/0`),
  `apps/engine/lib/engine/harness/tools/create_epic.ex` (`id_no_resultado/1`),
  `apps/web/src/lib/activity.ts`
- **Teste:** `apps/engine/test/engine/agents/po_server_test.exs`
  (describe "RN-165"), `apps/web/src/lib/activity.test.ts`
- **Origem:** uso real no projeto `exp001` — backlog sem história, logo sem
  tarefa, logo execução travada sem erro visível

---

### RN-166 — O teto de iterações do PO deixa rastro {#rn-166}

Esgotado o teto de iterações do laço de ferramentas do `PoServer` (12), o
turno emite `toolloop.limit_reached` com `{iteration, max_iterations}` —
o MESMO tipo e o mesmo payload que o `Engine.Harness.ToolLoop` já emitia
desde a Fase 3. Antes, a cláusula devolvia o state e pronto: de fora, um laço
esgotado era indistinguível de um turno que simplesmente acabou.

Reusar o identificador em vez de criar um `po.*` é deliberado: é o mesmo fato
(o laço bateu no teto), e quem lê o event log não deve precisar aprender um
segundo nome por causa de o agente conversacional ter laço próprio em vez de
usar o `ToolLoop`.

- **Onde:** `apps/engine/lib/engine/agents/po_server.ex` (`run_turn/2`,
  cláusula `remaining <= 0`)
- **Teste:** `apps/engine/test/engine/agents/po_server_test.exs`
  ("teto de iterações emite toolloop.limit_reached")
- **Origem:** investigação do travamento do `exp001` — o laço terminava em
  silêncio

---

### RN-172 — Handoff e aprovação são o DESFECHO do turno {#rn-172}

No fio da sessão, o **handoff oferecido** e o **card de aprovação** aparecem
DEPOIS da última fala do turno em que nasceram — nunca no meio dele.

Isto **não corrige ordenação**: a RN-155 continua valendo inteira, e a
timeline segue ordenada pelo `seq` do event log. O que o log registra é a
verdade: `po_server.ex` (`run_turn/2`) emite, na MESMA iteração, o
`agent.response` do turno, DEPOIS o `tool.call` de `offer_handoff` (que grava
`handoff.offered`) e SÓ ENTÃO recursa para o `agent.response` de fechamento.
O `seq` do handoff é honestamente menor que o da última fala. O mesmo vale
para `proposed_action.created`, que nasce no meio do turno enquanto o agente
ainda tem o que dizer. Mostrar "passou o bastão" ou "aprove isto" no meio da
conversa é leitura errada de um dado certo — então a regra é de
APRESENTAÇÃO, aplicada numa passada separada e explícita
(`afundarDesfechos`), depois do `sort` por `seq`, e não escondida num
comparador com três termos.

Turnos diferentes **nunca se misturam**. Um desfecho desce até o fim do
trecho logo abaixo dele e para na primeira entrada que falhe qualquer uma das
três condições:

1. **mesmo turno** — turno é o `seq` da última ABERTURA anterior à entrada, e
   abertura é evento de ator `user` (`chat.message`, `agent.activated`,
   promoção/devolução de história). Protege o caso em que a fronteira entre
   dois turnos não tem entrada VISÍVEL nenhuma: `agent.activated` abre turno e
   não vira item do fio.
2. **mesmo autor** — em sessão de EXECUÇÃO vários agentes escrevem sem que o
   usuário fale uma única vez, e todos ficam no mesmo turno; o desfecho de um
   não pode atravessar a fala de outro.
3. **não é desfecho** — dois desfechos seguidos preservam a ordem entre si (o
   `handoff.offered` do Infra antes do Dev Lead, na mesma confirmação).

Ator `system` NÃO abre turno: é ruído de infraestrutura no meio do fio, não
decisão de quem conversa.

- **Onde:** `apps/web/src/routes/SessionPage.tsx`
  (`aberturasDeTurno`, `turnoDoSeq`, `afundarDesfechos`, e os campos
  `autor`/`turno`/`desfecho` de `TimelineEntry`)
- **Teste:** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
  (describes "RN-172 — turno e desfecho (unidade)" e "RN-172 — a sequência
  REAL do engine, renderizada")
- **Origem:** uso real no `exp001` — "a passagem de bastão do PO para o
  arquiteto está aparecendo acima da última mensagem do PO" e "a mensagem de
  aprovação apareceu acima do chat do arquiteto até ele finalizar a resposta"

---

### RN-173 — O fio acompanha tudo que cresce, e só quem já estava no fim {#rn-173}

O chat rola para o fim quando o conteúdo cresce — **e não só quando chega
evento novo**. As duas fontes da timeline são queries SEPARADAS (`events` e
`actions`), e a altura ainda muda sem nenhuma das duas: abrir/fechar um
`Disclosure` (colapso por agente da RN-138, "Detalhes" do card de aprovação),
Markdown reflowando, diagrama renderizando depois. Por isso são dois
mecanismos: as dependências do efeito cobrem o que o React sabe
(`events.length`, `actions.length`, `streamingText`), e um `ResizeObserver`
sobre o CONTEÚDO do fio cobre o que só o layout sabe.

A guarda continua **inalterada e deliberada**: só rola quem já está a menos de
120px do fim. Quem subiu para reler o histórico não é arrastado — o fio segue
a conversa, não sequestra a leitura.

No mesmo fio, o card de aprovação da variante `chat` deixa de ocupar os 780px
inteiros da coluna: ganha teto de 560px e fica centralizado, como
`.handoffCard`/`.handoffDivider` já são. Recuar 45px como as bolhas seria
errado — o card não é fala de ninguém, é uma decisão pedida ao usuário. A
fila da aba Aprovações (`variant="queue"`) não muda: lá o card DEVE preencher
a coluna do grid.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`acompanharOFim` e os dois
  efeitos que o chamam); `apps/web/src/components/ApprovalCard.module.css`
  (`.card.chat`)
- **Teste:** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
  (describe "RN-173 — o fio acompanha o que cresce", com o caso de o usuário
  ter rolado para cima)
- **Origem:** uso real no `exp001` — "o scroll do chat deve ficar sempre no
  final seguindo o chat" e "aprovação mal diagramado deve ficar ao centro"

### RN-171 — A pergunta de lista tem saída por texto livre, por default {#rn-171}

Pergunta `type: "select"` de `ask_structured_questions` (RN-162) aceita
resposta **fora da lista**. O campo é `allowOther`, e o **default é `true`**:
quem não declara nada oferece a saída. Fechar a lista exige
`allowOther: false` explícito, e só faz sentido quando ela é genuinamente
fechada ("Sim"/"Não").

O default aberto não é preferência de estilo. Uma lista fechada por
ESQUECIMENTO do modelo trava a conversa inteira e o usuário não tem como
destravá-la de fora — foi exatamente o que o uso real encontrou: o modelo
ofereceu uma opção do tipo "Escreva você mesmo" e o formulário não tinha onde
escrever, porque o schema do tool não sabia expressar "além destas, o que
você quiser". Uma lista aberta por engano, no pior caso, oferece um campo a
mais. Os dois erros não custam a mesma coisa. Pelo mesmo motivo a descrição
do tool **proíbe** criar uma opção "Outro" dentro de `options`: o formulário
já a oferece sozinha, e duas escapatórias na mesma lista confundem.

`allowOther` só existe em `select` — em `text`/`textarea` o campo já é texto
livre, e o engine normaliza esses dois para `false` em vez de gravar estado
sem significado no event log. Na tela, escolher "Outra (escrever)" troca o
`Select` por um `Input`: o sentinela de interface (`__outra__`) **nunca**
viaja para o backend, e o que vai é o TEXTO digitado. O botão de envio
continua exigindo TODAS as perguntas preenchidas — `AnswerStructuredQuestion
UseCase` recusa com 400 listando o que falta, então habilitar com campo vazio
só produziria um erro do servidor —, e estar em "Outra" com o texto ainda em
branco NÃO conta como preenchido.

O card também deixou de ser o único item do fio alinhado a nada: ele passa a
ser centralizado com o mesmo teto de 560px do `ApprovalCard` na variante
`chat` ([RN-173](#rn-173)) e ganha o avatar e a cor do agente, que é o que o
faz ler como FALA de alguém em vez de formulário órfão. Antes ele nascia
encostado à esquerda com teto de 480px, enquanto as bolhas começam 45px
adentro.

- **Onde:** `apps/engine/lib/engine/harness/tools/ask_structured_questions.ex`
  (schema, validação e `normalizar/1`), `apps/web/src/lib/api-types.ts`
  (`StructuredQuestion.allowOther`), `apps/web/src/routes/SessionPage.tsx`
  (`StructuredQuestionCard`, `OUTRA_RESPOSTA`, `permiteOutra`),
  `apps/web/src/routes/SessionPage.module.css` (`.structuredQuestionCard`,
  `.structuredQuestionCabecalho`)
- **Teste:** `apps/engine/test/engine/harness/tools/ask_structured_questions_test.exs`
  (default aberto, `false` explícito, `allowOther` não booleano recusado),
  `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
  (describe "saída por texto livre no select")
- **Origem:** uso real no `exp001` — "sempre dê a opção de input do usuário
  quando ele seleciona Escreva"

### RN-174 — Ação que dispara turno de agente arma o indicador do fio {#rn-174}

O indicador de "o agente está trabalhando" (os três pontinhos depois de 5s,
[RN-131](../business-rules.md#rn-131)/[RN-156](#rn-156)) só aparece enquanto `streaming` ou
`statusAgent` valem, e eles eram ligados em três lugares: o composer
(`handleSend`), as confirmações de prontidão e o canal Phoenix. **Toda ação da
tela que dispara um turno síncrono no engine passa a armá-lo também.**

São duas, e nenhuma delas é o composer:

1. **Responder o formulário de perguntas estruturadas** —
   `AnswerStructuredQuestionUseCase` reusa `SendAgentMessageUseCase`
   ([RN-162](#rn-162)), e a chamada só resolve depois do turno inteiro.
2. **Devolver uma história ao PO** — `ReturnStoryUseCase` chama `reviseStory`,
   que é `handle_call({:revise, …})` no `po_server`: a resposta HTTP espera o
   PO reescrever a história.

O canal Phoenix não cobre o buraco, e é isso que torna a correção necessária
em vez de redundante: quando ele ainda não terminou de conectar (ticket +
join, [RN-108](#rn-108)) o broadcast de `agent.status` "working" não tem
ouvinte e se perde — a tela fica em silêncio absoluto por dezenas de segundos,
que é indistinguível de "não vai acontecer nada".

O par é `iniciarTurnoDoAgente(agente)` **antes** do `await` (o `agent.status`
do canal pode chegar primeiro, e sem o agente fixado o indicador nasceria sem
saber quem fala) e `finalizarTurnoDoAgente()` no `finally` — nos DOIS
caminhos, porque um erro que deixasse `streaming` ligado travaria o composer
até o próximo turno. Resolver a chamada é sinal de fim de turno tão confiável
quanto o `agent.done` do canal, e `finalizarTurnoDoAgente` é idempotente. O
prazo de 5s não muda: turno que responde rápido continua sem mostrar nada.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`iniciarTurnoDoAgente`,
  `handleReturnStory`, `StructuredQuestionCard`)
- **Teste:** `apps/web/src/routes/SessionPage.perguntas-estruturadas.test.tsx`
  e `apps/web/src/routes/SessionPage.promocao-inline-e-volta.test.tsx`
  (describes de RN-174, com o caso de falha provando que o indicador não fica
  preso)
- **Origem:** uso real no `exp001` — "caso a web, api e engine demore mais de
  5s para ter uma resposta, a web deve apresentar uma animação no chat
  mostrando que o agente está pensando"

### RN-175 — Toda resposta de agente diz com qual modelo foi gerada {#rn-175}

`agent.response` carrega `modelName` nos **três** produtores do evento, e não
só nos quatro agentes conversacionais:

| produtor | quem passa por ali | antes |
|---|---|---|
| os quatro conversacionais (`criativo`/`po`/`arquiteto`/`dev_lead`) | chat | já gravava, desde a [RN-146](#rn-146) |
| `Engine.Harness.ToolLoop` | TODO agente de execução e de gate — `dev-*`, QA, SecOps, Infra-Workflows, Psicólogo, Anamnese | **nunca gravou** |
| `SendChatMessageUseCase` (api) | chat sem agente ativo, em que quem responde é o modelo | **nunca gravou** |

Nenhuma chamada nova: `RunLlmTurnUseCase` já devolve `modelName` no corpo e
`StreamLlmTurnUseCase` já o põe no frame `final` — o valor é o nome do modelo
do **binding resolvido** (`model.name`), não o eco do provider. Ele é `null`
quando o turno falhou antes de resolver o binding, e ausente em evento gravado
antes desta regra.

Na tela, o modelo deixou de ser a palavra solta `modelo` em mono 10px
`--text-muted` ao lado do nome do agente — que se lê como se o modelo se
CHAMASSE "modelo", e que reprova o contraste de texto de leitura. Virou um
**chip** com o ícone de modelo, `--text-secondary` sobre `--surface-2`, e o
rótulo de desconhecido passou a ser "modelo não registrado". A tela **não**
adivinha o modelo pelo binding ATUAL do agente quando o dado falta: atribuir a
uma resposta antiga um modelo que talvez nem existisse quando ela foi gerada
seria inventar procedência, e procedência inventada é pior que ausente — o
mesmo argumento do preço congelado em `token_usage` ([RN-044](../business-rules/custo.md#rn-044)).

Fora do escopo, declarado: `agent.error` continua sem o modelo nos quatro
servidores, mesmo quando a api o mandou no frame de erro (budget estourado, por
exemplo). É mudança de outro evento, com outra pergunta a responder.

- **Onde:** `apps/engine/lib/engine/harness/tool_loop.ex`,
  `apps/api/src/application/use-cases/llm/send-chat-message.use-case.ts`,
  `apps/web/src/routes/SessionPage.tsx` (o chip em `agent.response`),
  `apps/web/src/routes/SessionPage.module.css` (`.messageModelo`)
- **Teste:** `apps/engine/test/engine/harness/tool_loop_test.exs`,
  `apps/api/test/application/use-cases/llm/send-chat-message.use-case.spec.ts`,
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`,
  `apps/web/src/design-contraste.test.ts` (o par do chip)
- **Origem:** uso real no `exp001` — "PO não mostrou o modelo que estava
  utilizando; todos os agentes devem apresentar o seu modelo ao lado do nome"

### RN-176 — Tabela em Markdown no fio vira tabela de verdade {#rn-176}

O Markdown leve do chat ([RN-158](#rn-158)) passa a reconhecer **tabela GFM** e
a renderizá-la com o `Table` do design system — o mesmo componente de
Configurações, Gastos e Executores, não uma `<table>` própria: "como o Brabo
desenha uma tabela" é uma decisão só. Antes, a tabela do Mapa de Módulos que o
Arquiteto escreve na resposta saía como parágrafo com pipes literais.

O que distingue tabela de prosa com `|` é a **linha separadora**, e ela é
obrigatória como no GFM: sem ela o bloco continua sendo parágrafo, então
"escolha entre a | b | c" não vira tabela por engano. O cabeçalho manda no
número de colunas — linha curta ganha célula vazia, linha longa perde o
excesso —, `\|` escapado fica dentro da célula, e o alinhamento sai dos
dois-pontos do separador. Zero dependência nova: o parser continua sendo o
próprio, por regex, e a árvore de dados continua virando elementos React
diretos (nenhum `dangerouslySetInnerHTML`).

**O artefato `artifact.module_map` continua FORA do fio**, e a escolha é
deliberada: ele é estado VIGENTE do projeto, não artefato datado por sessão —
a mesma decisão já registrada na [RN-159](#rn-159) —, e vive na Visão Geral.
O que o usuário pediu foi a tabela **dentro da mensagem**, e é ela que passou
a ser desenhada; a correção serve a QUALQUER agente que escreva uma tabela, e
não só ao Mapa de Módulos.

No balão, a tabela **rola na horizontal** em vez de espremer coluna: o fio tem
~700px e um `module_map` tem 4 colunas.

- **Onde:** `apps/web/src/lib/markdown.ts` (bloco `table`, `celulasDaLinha`),
  `apps/web/src/components/ui/MarkdownMessage.tsx` (`TabelaMarkdown`),
  `apps/web/src/components/ui/MarkdownMessage.module.css`
- **Teste:** `apps/web/src/lib/markdown.test.ts` (describe "tabela (RN-176)"),
  `apps/web/src/components/ui/MarkdownMessage.test.tsx`
- **Origem:** uso real no `exp001` — "a tabela dentro da mensagem do Mapa de
  Módulos do arquiteto tem que ficar bem estruturada em formato tabela,
  utilizar design system do próprio Brabo"

### RN-177 — O log mostra tudo, e o histórico se recolhe por ORIGEM {#rn-177}

O feed de atividade escondia seis tipos de evento (`tool.call`, `tool.result`,
`agent.response`, `agent.delta`, `agent.status`, `context.compacted`) **sem
oferecer alternativa nenhuma**: quem quisesse ver o que o agente e o harness
trocam entre si tinha de abrir o banco. O filtro continua, e continua
**desligado por padrão** — a razão dele não mudou (116 de 193 eventos reais
eram desses tipos, ver `isMachineEvent`) —, mas virou **escolha**: um botão
"Eventos de máquina" no mesmo trilho dos chips de tipo.

Mostrar tudo só resolve metade: uma sessão longa vira uma lista que ninguém
percorre. Por isso as **5 mais recentes ficam abertas** e o resto entra em
colapsos por **ORIGEM** — uma classificação NOVA, que não substitui o
`ActivityKind`: `kind` diz de que ASSUNTO o evento fala (commit, PR, permissão)
e decide ícone e cor; `origem` diz de que CAMADA ele veio, e é ela que torna o
histórico legível em punhados. As seis saem do dado que existe — `actor.kind` e
o prefixo do `type` —, nunca de suposição:

| origem | o que cai nela |
|---|---|
| `harness` | `tool.*`, `toolloop.*`, `agent.status`, `context.compacted` |
| `llm` | `agent.response`, `agent.delta`, `llm.*` |
| `usuario` | qualquer evento com `actor.kind === 'user'` |
| `sistema` | qualquer evento com `actor.kind === 'system'` |
| `agente` | `agent.*` restante, `handoff.*`, `delegation.*`, `chat.*` de agente |
| `eventos` | o event log de domínio (backlog, git, PR, artefato, bootstrap…) |

A **precedência** é o que torna a classificação previsível, e está na ordem dos
`if`: mecanismo (`harness`, `llm`) vence ator, porque um `tool.call` é do
harness qualquer que seja o ator; e ator vence prefixo de agente, porque
`chat.message` existe dos dois lados e quem os distingue é quem falou. Tipo que
ninguém previu cai em `eventos` — nunca some, nunca inventa categoria.

**A mesma regra vale no FIO da sessão**, com o eixo invertido: o fio é
crescente (o mais novo junto do composer), então as 5 últimas entradas ficam
abertas em baixo e o histórico recolhido fica no TOPO. O corte é sobre a lista
já agrupada por agente ([RN-138](../business-rules.md#rn-138)) — quem conta é o que o usuário vê, e
um colapso de doze mensagens é UMA entrada na tela.

- **Onde:** `apps/web/src/lib/activity.ts:94` (`OrigemDeEvento`), `:125`
  (`origemDoEvento`), `:152` (`agruparPorOrigem`);
  `apps/web/src/components/ActivityFeed.tsx:34` (o corte de 5), `:66` (o
  toggle); `apps/web/src/routes/SessionPage.tsx:284` (o corte do fio), `:1898`
  (`fio`)
- **Teste:** `apps/web/src/lib/activity-origem.test.ts`,
  `apps/web/src/components/ActivityFeed.test.tsx` (describe "ordem,
  agrupamento e o toggle de máquina"),
  `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx` (describe
  "RN-177")
- **Origem:** uso real no `exp001` — "em log de eventos mostrar também log do
  sistema, concentrar a mensagem em grupo, ou seja mantém as últimas 5
  mensagens mas abaixo vira o grupo de log de eventos, sistema, llm, harness,
  agente, usuário"

### RN-178 — O painel da sessão lê do último para o primeiro, e a lista de regras pagina {#rn-178}

As quatro seções do painel de contexto (regras de negócio, artefatos gerados,
arquivos tocados e log de eventos) eram **crescentes**: abriam no começo da
sessão. Numa sessão de milhares de eventos isso entrega a tela errada — quem
abre o painel quer o que acabou de acontecer. As quatro passaram a ser
**decrescentes**, inclusive dentro da árvore de backlog ([RN-179](#rn-179)).

Uma consequência que veio junto: o botão "Carregar mais antigos" do feed
([RN-099](../business-rules.md#rn-099)) **mudou de lado**. Ele ficava ACIMA da lista porque a lista
era crescente e o passado estava em cima; com a ordem invertida o passado está
no fim, e um botão no topo pediria para rolar na direção contrária à que ele
carrega — o mesmo argumento de antes, com o sinal trocado.

E **acima de 5 regras a lista pagina**, em vez de crescer sem fim: o painel tem
a largura de uma coluna e uma sessão de ideação passa de vinte regras sem
esforço. A página vigente é resolvida por *clamp* (`min(pagina, total - 1)`) e
não por efeito de sincronização: uma regra nova chegando pelo poll alonga a
lista, e um `useEffect` renderizaria uma vez com a página inválida antes de
corrigir. Com 5 ou menos, o paginador **não existe** — controle que não pagina
nada é ruído ocupando altura.

- **Onde:** `apps/web/src/routes/ContextAside.tsx:98` (`REGRAS_POR_PAGINA`) e
  a ordenação das quatro seções no mesmo arquivo;
  `apps/web/src/components/ActivityFeed.tsx:98` (o `sort` decrescente)
- **Teste:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (describe "RN-178"), `apps/web/src/components/ActivityFeed.test.tsx`
- **Origem:** uso real no `exp001` — "mostrar log de eventos, arquivos tocados
  e regras de negócio sempre em ordem do último para o primeiro de acordo com
  a data" e "caso as regras de negócio ficar acima de 5, deve-se paginar"

### RN-179 — O artefato do PO é uma ÁRVORE: épico → história → tarefa {#rn-179}

O painel "Artefatos gerados" ([RN-159](#rn-159)) listava épico e história lado
a lado, planos, e **ignorava `backlog.task_created`** — justamente o que um dev
agent pega para trabalhar. Os três passaram a formar uma árvore, com o filho
dentro de um colapso do pai, e as tarefas nascem FECHADAS: um épico com trinta
tarefas tomaria o painel inteiro sem que ninguém tivesse pedido.

O parentesco sai do **vínculo que o evento já carrega** —
`backlog.story_created` grava `epicId`, `backlog.task_created` grava `storyId`
—, nunca da vizinhança no log. Nó cujo pai não está entre os eventos carregados
**sobe para a raiz** em vez de ser pendurado no épico mais próximo: inventar
parentesco é pior que mostrar o nó solto, e uma tarefa cuja história ficou fora
da janela é caso normal, não erro.

Cada nível continua sendo um **link** para o Backlog, e o colapso dos filhos
vem ABAIXO da linha em vez de dentro do cabeçalho — cabeçalho de `Disclosure` é
`<button>`, e um `<a>` dentro de um `<button>` é HTML inválido e alvo de clique
ambíguo. O contador do cabeçalho da seção conta a árvore INTEIRA, não só as
raízes: dizer "3" com dezoito tarefas dentro seria o mesmo tipo de número que
não corresponde a nada que a [RN-151](#rn-151) tirou da sidebar.

- **Onde:** `apps/web/src/lib/session-backlog-tree.ts:68`
  (`montarArvoreDeBacklog`), `apps/web/src/routes/ContextAside.tsx:210` (as
  raízes viram item), `:225` (a contagem da árvore)
- **Teste:** `apps/web/src/routes/SessionPage.artefatos-gerados.test.tsx`
  (casos "épico/história/tarefa do PO viram árvore" e "nó sem pai carregado
  aparece na raiz")
- **Origem:** uso real no `exp001` — "mostrar também as tarefas criadas no
  artefato do PO, mas abaixo do épico e ter opção de colapsar"

### RN-180 — O painel diz o que NÃO está mostrando {#rn-180}

`useSessionEvents` busca `{ limit: 200, latest: true }`, e o painel de contexto
lia esse recorte por prop. Consequência: numa sessão de milhares de eventos as
quatro seções mostravam a cauda **como se fosse a sessão inteira** — regra de
negócio capturada no começo da ideação simplesmente não existia, sem aviso
nenhum.

O painel passou a ler o mesmo histórico paginado que a aba de Atividade da
Visão Geral já usava ([RN-099](../business-rules.md#rn-099)), com a `queryKey` da cauda
compartilhada com o fio — **zero requisição a mais** no ciclo de poll
([RN-090](../business-rules.md#rn-090)/[RN-091](../business-rules.md#rn-091)). Duas coisas mudaram com isso:

1. **O feed ganhou o pager que o componente sempre teve.** As props
   `onLoadOlder`/`hasOlder`/`loadingOlder` são opcionais desde a RN-099 e este
   call site nunca as passava — era essa a razão de a sessão perder o começo em
   silêncio.
2. **Uma nota conta quantos eventos faltam.** O número sai de SUBTRAÇÃO sobre o
   `seq` (gapless e por sessão): `menor seq baixado − 1`. Nunca de uma
   requisição a mais — o mesmo mecanismo do "+ N mais antigos" do sino
   ([RN-100](../business-rules.md#rn-100)). Alcançando o começo da sessão a nota **desaparece**, em
   vez de afirmar um zero.

As seções derivadas leem `baixados` (tudo que já veio) e não `events` (a janela
de 100 do feed): elas não paginam item a item, e cortá-las na janela as faria
mostrar MENOS do que mostravam antes desta mudança. É o mesmo botão que
alimenta as duas.

O `pausarPoll` desce por `useSessionEventHistory` até `useSessionEvents`, e não
é detalhe: o intervalo de refetch é de cada OBSERVADOR, não da query. Um
segundo observador da mesma chave com timer ligado ressuscitaria o poll que a
tela pausa durante o turno — e com ele a duplicata visual da bolha em
streaming.

- **Onde:** `apps/web/src/lib/hooks.ts:246` (o `pausarPoll` do histórico),
  `:325` (`baixados`); `apps/web/src/routes/ContextAside.tsx:143`
  (`eventosAnteriores`) e o `ActivityFeed` com o pager, no fim do mesmo
  arquivo
- **Teste:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (describe "RN-180")
- **Origem:** revisão da própria rodada — o teto de 200 existia em silêncio nas
  quatro seções

### RN-181 — Delegação de área aparece no fio {#rn-181}

Quando uma área (QA, Infra) delega a subagentes e consolida o veredito, os três
desfechos que o lead registra — `delegation.completed`, `delegation.failed` e
`delegation.dispensed` — só existiam no painel de log. Quem acompanhava a
sessão via o gate abrir e fechar **sem nenhum sinal** de que houve uma segunda
tentativa por baixo.

Os três passaram a ser narrados no fio como **aviso compacto**, no formato da
[RN-157](#rn-157) — não bolha: é notificação do que aconteceu dentro da área,
não uma fala. A FRASE sai de `classifyEvent`, a mesma do painel, porque duas
redações do mesmo evento divergem na primeira mudança de payload; e ela já
nomeia o subagente e a área, então o lead **não** é prefixado (produziria "QA
Lead QA Automação concluiu a delegação (qa)").

O contrato externo da área **não muda** (ADR 0038): o fio não passa a endereçar
subagente, só a narrar o que o lead já registrou. A origem da falha viaja junto
em `delegation.failed`, pela mesma razão da [RN-059](../business-rules/custo.md#rn-059) — é ela que diz
se o próximo passo é trocar a chave, esperar o provider ou abrir um bug.

- **Onde:** `apps/web/src/routes/SessionPage.tsx:1687`
- **Teste:** `apps/web/src/routes/SessionPage.painel-e-agrupamento.test.tsx`
  (describe "RN-181")
- **Origem:** uso real no `exp001` — "quando houver uma nova tentativa e
  consolidação de algum agente deve apresentar no chat"

### RN-182 — O tema é escolhido, persistido e aplicado antes do primeiro paint {#rn-182}

O tema claro existe em `design/tokens.css` desde o começo, sob
`[data-theme='light']`, e **nada em `apps/web` escrevia esse atributo**: o
único jeito de ver o tema claro era digitar o atributo no DevTools. Ele passa a
ser alcançável.

A preferência mora em `localStorage['brabo.theme']`, aceita **só** `'dark'` ou
`'light'`, e o default é `dark` — o tema primário do design system. Quem aplica
é `apps/web/public/theme-boot.js`, **síncrono no `<head>` e antes do bundle**:
`data-theme` decide as cores de todo o `tokens.css`, e aplicá-lo depois da
hidratação faria o usuário do tema claro ver um flash escuro a cada carga.

É **arquivo, não script inline**, e a razão é a mesma que fez as fontes serem
auto-hospedadas (ADR 0036): a imagem de produção serve sob `script-src 'self'`
(`docker/web/nginx.conf`), sem `'unsafe-inline'` e sem nonce. Inline
funcionaria em `pnpm dev:web` e seria **bloqueado na imagem publicada** — o
pior modo de falha possível, porque só aparece depois do deploy.

O caminho inteiro degrada em vez de quebrar: `localStorage` pode lançar (modo
privado, storage bloqueado em iframe) e tema é preferência, não função; valor
desconhecido cai no default em vez de virar um `data-theme` que o CSS não
conhece e que renderizaria sem tema nenhum.

- **Onde:** `apps/web/public/theme-boot.js:41`,
  `apps/web/index.html:53`
- **Teste:** `apps/web/src/lib/tema.test.ts` (describe "contrato com o script
  de boot")
- **ADR:** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-183 — A preferência de tema tem uma fonte, e o atributo do `<html>` é a verdade {#rn-183}

Ler, gravar, alternar e observar o tema é `apps/web/src/lib/tema.ts` — o botão
mora no shell e consome essa API, nunca escreve `data-theme` por conta própria.

Três decisões dentro dela:

1. **`temaAtual()` lê o ATRIBUTO primeiro**, e só depois o `localStorage` e o
   default. É o atributo que a tela está mostrando; cair na preferência gravada
   antes dele faria a UI afirmar um tema diferente do que se vê, no exato caso
   em que o boot falhou.
2. **`lerTemaSalvo()` devolve `null`, não o default**, quando não há preferência
   gravada. Quem nunca escolheu pode um dia seguir o sistema operacional
   (`prefers-color-scheme`), e apagar essa distinção aqui tiraria a informação
   de quem decidir isso depois.
3. **`observarTema()` cobre o evento `storage`**, que o navegador dispara nas
   OUTRAS abas do mesmo origin. Sem isso dois separadores abertos ficariam em
   temas diferentes até o próximo reload.

A chave e o default são repetidos em `public/theme-boot.js` porque ele roda
antes do bundle e não pode importar nada. É a única duplicação possível de
divergir em silêncio, e por isso o teste lê o arquivo de boot e reprova se os
dois deixarem de bater.

- **Onde:** `apps/web/src/lib/tema.ts:73`
- **Teste:** `apps/web/src/lib/tema.test.ts`
- **ADR:** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-184 — Contraste é medido nos DOIS temas {#rn-184}

Enquanto o tema claro era inalcançável ([RN-182](#rn-182)), medir só o escuro
era honesto: medir uma tela que ninguém pode abrir é medir uma intenção. Com o
botão de tema, deixar de medir o claro passaria a esconder metade da superfície
visível do produto — então os pares passam a ser cobrados nos dois temas, com o
mesmo piso (4,5:1 para texto, 3:1 para elemento de interface).

Para isso, **seis tokens do tema claro mudaram de valor**. O fundo mais
exigente do claro é o `--code-bg` (papel, `#efe4d2`, a um passo das
superfícies), e quem fecha contra ele fecha contra o resto: `--accent`
3,56 → 4,81, `--warning` 3,15 → 4,98, `--success` 3,89 → 5,12, `--violet`
4,16 → 4,95, `--text-muted` 2,76 → 5,17, e `--accent-hover` seguiu o accent um
degrau abaixo. O tema escuro **não mudou um valor**, e a dívida conhecida dele
segue travada pelos mesmos cinco números (3,89 / 3,10 / 3,88 / 3,88 / 4,41).

O `--text-muted` do claro não era dívida: a 2,40:1 sobre `--surface-2` ele
reprovava até o piso de **elemento de interface**, que é o mais baixo que
existe. Era defeito, e o tema claro não tem por que ser pior que o primário.

- **Onde:** `design/tokens.css:208`
- **Teste:** `apps/web/src/lib/contraste.test.ts`,
  `apps/web/src/design-contraste.test.ts`,
  `apps/web/test/design-contraste.test.ts`
- **ADR:** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-185 — Os oito papéis de sintaxe, e o valor do handoff só entra medido {#rn-185}

A paleta de realce era três tokens próprios (`--syntax-function`,
`--syntax-comment`, `--syntax-operator`) e cinco reusos de semântico
(`--accent`, `--warning`, `--violet`, `--success`, `--text-primary`). É esse
reuso que fazia a paleta ser medida só no escuro: no claro os semânticos
reprovavam contra o `--code-bg` de papel.

Passa a ter os **oito papéis** do handoff, com o prefixo `--syntax-*` que o
repositório já usa, e cada um com valor próprio por tema. Nomear os oito é o
que permite o realce divergir do semântico no dia em que precisar.

**Valor do handoff só entra quando a medição aprova.** Contra o próprio
`--code-bg` do handoff, cinco dos oito reprovam os 4,5:1 que texto de código
exige — `--syn-cm` 4,09:1 no escuro e 2,32:1 no claro, `--syn-kw` 4,34:1,
`--syn-str` 4,20:1, `--syn-fn` 4,14:1, `--syn-op` 4,00:1. Onde o handoff
reprova, vale o número medido: é a mesma régua do ADR 0036 — a intenção do
handoff vale, o mecanismo (ou o número) que quebra o produto, não.

Os cinco semânticos continuam sendo quem pinta (`SyntaxTokens.module.css` não
mudou nesta entrega) e por isso vão **medidos ao lado** dos oito: enquanto
forem o pixel de verdade, é deles que o piso é cobrado. No tema claro cada
papel tem hoje o MESMO número do semântico que o pinta, de propósito — duas
fontes com números diferentes para o mesmo pixel divergiriam na primeira
correção feita de um lado só.

- **Onde:** `design/tokens.css:111`
- **Teste:** `apps/web/src/lib/contraste.test.ts` (describe "contraste — paleta
  de sintaxe sobre --code-bg")
- **ADR:** [0074](../adr/0074-tema-alcancavel-e-o-boot-sob-csp.md)

### RN-195 — A sidebar recolhe para uma trilha de ícones, com a preferência persistida {#rn-195}

`Shell.tsx` tinha largura fixa (248px) e nenhum jeito de encolher. Passa a
alternar entre `--sidebar-w` (264px) e `--sidebar-w-collapsed` (62px) — os
dois tokens que a Onda 1/frente A já tinha criado em `design/tokens.css` —
com `transition: width .18s ease`. Recolhida, vira uma trilha vertical: um
quadrado de iniciais por projeto (borda na cor de identidade,
[RN-197](#rn-197)) mais um ícone de Atividades; clicar num projeto na
trilha reexpande a barra, abre aquele projeto e navega para ele.

A preferência é do usuário e sobrevive a reload: `brabo.sidebar.collapsed`
(`'1'`/`'0'`) em `apps/web/src/lib/sidebar-state.ts`. Ela é **só manual**
(`colapsadoManual`): havia um segundo estado, **automático**
(`autoColapsado`), somado por OR pela aba de Código, e ele foi removido pelo
[ADR 0126](../adr/0126-trilho-vertical-de-navegacao-do-projeto.md) — ver
[RN-201](#rn-201). Nenhuma tela recolhe a sidebar por conta própria; o que se
vê recolhido foi o usuário quem pediu, e está gravado.

- **Onde:** `apps/web/src/routes/Shell.tsx:340-351` (estado e toggle),
  `apps/web/src/routes/Shell.module.css` (`.sidebar`, `.colapsado .sidebar`,
  `.trilha*`), `apps/web/src/lib/sidebar-state.ts`
  (`lerColapsado`/`gravarColapsado`)
- **Teste:** `apps/web/src/lib/sidebar-state.test.ts` (describe "colapso"),
  `apps/web/src/routes/Shell.test.tsx`
- **Origem:** PROGRAMA 28, Onda 2, frente B —
  `design_handoff_brabo/README.md` seção "Navigation shell"

### RN-196 — Projetos expansíveis revelam as abas do projeto, N ao mesmo tempo {#rn-196}

Cada projeto na sidebar ganha um chevron: clicar nele expande a linha e
revela a lista de abas daquele projeto (Visão geral, Executores, Criativo,
Chat, Code, Backlog, Aprovações, Insights, Gastos, Configurações), cada uma
um link para `/projects/$projectId?tab=<chave>`. Vários projetos podem ficar
abertos ao mesmo tempo — o estado é um `Set<string>` de ids, persistido em
`brabo.sidebar.open`.

A lista de abas e os rótulos vêm de `ABAS_DO_PROJETO`
(`apps/web/src/routes/project-tabs.ts`, dono da frente C, rodando em
paralelo nesta mesma onda) — a sidebar só **lê** o array exportado, nunca
reescreve nomes de aba. **Suposição de shape**, para conferir contra o que a
frente C entregou: `AbaDoProjeto` tem `key: string`, `label: string` e
`count?: (contagens: ContagensDeAba) => number | undefined`, com
`ContagensDeAba = { promocoesPendentes, aprovacoesPendentes,
hipotesesPendentes }`. A sidebar só consegue preencher
`aprovacoesPendentes` de graça (`pendingApprovalsCount` já vem no resumo do
dashboard, [RN-151](#rn-151)); `promocoesPendentes`/`hipotesesPendentes`
entram como `0` — calculá-los exigiria uma consulta nova POR PROJETO
ABERTO na sidebar, a mesma classe de N+1 que a RN-090/091 fechou no
dashboard. Os dois selos continuam corretos dentro da régua da própria
`ProjectPage`; só o preview na sidebar é parcial, e é uma omissão
deliberada, não um bug.

O projeto da rota ATUAL sempre aparece expandido (`projetosAbertosEfetivo`),
mesmo sem estar no `Set` persistido — abrir "de graça" pela rota não grava
nada; só o clique explícito no chevron entra em `brabo.sidebar.open`.

- **Onde:** `apps/web/src/routes/Shell.tsx:353-374` (estado e o efetivo),
  `apps/web/src/routes/Shell.tsx` (`LinhaDeAba`), `apps/web/src/lib/sidebar-state.ts`
  (`lerProjetosAbertos`/`gravarProjetosAbertos`)
- **Teste:** `apps/web/src/lib/sidebar-state.test.ts` (describe "conjuntos"),
  `apps/web/src/routes/Shell.test.tsx`
- **Origem:** PROGRAMA 28, Onda 2, frente B

### RN-197 — Duas cores de projeto, dois propósitos: identidade não é status {#rn-197}

O handoff pede um "ponto de cor do projeto" na linha expandida e o mesmo
princípio de cor na trilha recolhida. O produto já tinha um dot ali —
`NavStatusDot` — mas ele é **status** (orçamento/atividade recente,
derivado sem consulta própria de `useProjectsSummary`/`useProjectsStatus`,
RN-039), não identidade: a cor dele MUDA com o tempo.

Decisão, documentada em vez de resolvida: a linha expandida continua
mostrando só `NavStatusDot` (é informação acionável; duplicar um segundo
dot ao lado seria ruído). A cor de IDENTIDADE — estável por projeto, hash
determinístico do id sobre uma paleta fixa de tokens (`corDoProjeto`,
sem tabela nova, mesma ideia de `AGENTS[key].color`) — aparece só na
trilha recolhida, como borda do quadrado de iniciais, que é onde não há
espaço para os dois dots e onde a identidade (não o status) é o que ajuda a
achar o projeto certo entre vários quadrados parecidos.

Do mesmo jeito, o handoff pede "badge com o total de últimas iterações" no
projeto; o produto usa `pendingApprovalsCount` desde a RN-151, que é
posterior ao handoff e resolve um defeito real (um número que não
correspondia a nada acionável ao clicar). Este badge **não muda** — RN-151
continua valendo, e é o handoff que diverge aqui.

- **Onde:** `apps/web/src/lib/sidebar-state.ts` (`corDoProjeto`),
  `apps/web/src/routes/Shell.tsx` (`NavStatusDot`, comentário da divergência)
- **Teste:** `apps/web/src/lib/sidebar-state.test.ts` (describe "corDoProjeto")
- **Origem:** PROGRAMA 28, Onda 2, frente B — divergência entre
  `design_handoff_brabo/CHECKLIST-CONFRONTO.md` e RN-151

### RN-198 — Atividades agrupa por agente-base/instância REAL, nunca por contador inventado {#rn-198}

A seção Atividades da sidebar é a mesma lógica de agrupamento de
`AgentTimelineTree.tsx`/`timeline-tree.ts` (já usada na Visão geral do
projeto), movida para um lugar novo — não reescrita. `montarArvore` já
agrupa por `evento.actor.id`; a novidade é `agruparPorInstancia`
(`apps/web/src/lib/timeline-tree.ts`), que decide quais ramos formam um
grupo visual de dois níveis.

A "instância" não é um contador renumerado (`-01`/`-02`) — é o `agent_id`
REAL que o produto já escreve: `devAgentId`/`extraDevAgentId`
(`apps/api/src/application/use-cases/execution/activate-execution.use-case.ts:27-38`)
produzem `dev-<modulo>` e `dev-<modulo>-2` (sufixo sempre exatamente `-2`,
porque o teto é DOIS por módulo, [RN-154](#rn-154)). Um ramo só vira
"instância extra" de outro se o agente-base (sem o sufixo) TAMBÉM tiver um
ramo na mesma lista — senão ele é o próprio agente. Agente com uma instância
abre direto nos eventos; com duas, revela um segundo nível, uma linha por
instância, cada uma com sua própria contagem — reaproveitando
`getAgentLastSeenSeq`/`setAgentLastSeenSeq` (`read-state.ts`) que já existia
para o contador de novidade da árvore.

Escopo: só o projeto da ROTA ATUAL (`pathname`), não todos os projetos do
workspace — agregar todos exigiria uma consulta de eventos POR projeto, a
mesma classe de N+1 que a RN-090/091 fechou no dashboard. Reusa o MESMO par
de hooks que `AgentTimelineTree`/`SessionPage` já usam
(`useActiveExecutionSession` + `useSessionEvents`, mesma `queryKey`) — zero
requisição nova quando as duas telas estão montadas juntas.

O que abre/fecha é persistido em `brabo.sidebar.agents`, com o formato do
handoff adaptado aos ids reais: `agenteBase` (grupo aberto, ex.:
`dev-backend`) ou `${agenteBase}/${instancia}` (uma instância específica
aberta, ex.: `dev-backend/dev-backend-2`).

- **Onde:** `apps/web/src/lib/timeline-tree.ts` (`agruparPorInstancia`,
  `GrupoDeAgente`), `apps/web/src/routes/Shell.tsx:237-311`
  (`GrupoDeAtividade`, `InstanciaDeAgente`), `apps/web/src/routes/Shell.tsx:376-399`
  (escopo e persistência)
- **Teste:** `apps/web/src/lib/timeline-tree.test.ts` (describe
  "agruparPorInstancia"), `apps/web/src/lib/sidebar-state.test.ts`
- **Origem:** PROGRAMA 28, Onda 1/frente B0 (achado, sem código) e Onda
  2/frente B (implementação)

### RN-199 — Botão de tema no rodapé, funcional recolhido {#rn-199}

O rodapé da sidebar ganha um botão sol/lua que consome a API de
`apps/web/src/lib/tema.ts` da Onda 1/frente A (`temaAtual`,
`alternarTema`, `observarTema`) sem reimplementar nada — só o BOTÃO é novo.
Funciona recolhido (62px): o rótulo textual some, mas `aria-label`/`title`
continuam descrevendo o tema atual e o clique continua alternando.

- **Onde:** `apps/web/src/routes/Shell.tsx:130-148` (`BotaoDeTema`)
- **Teste:** `apps/web/src/lib/tema.test.ts` (a API, inalterada por esta RN)
  — `Shell.test.tsx` não duplica a suite do tema, só monta o Shell
- **Origem:** PROGRAMA 28, Onda 2, frente B

### RN-200 — Só Projetos e Atividades como itens globais {#rn-200}

Os dois itens sem rota do rodapé da nav ("Chat global"/"Configurações",
`title="em breve"`) saem. O handoff é explícito: só Projetos e Atividades
são itens GLOBAIS — tudo o mais é escopado a um projeto. "Configurações"
continua existindo, como ABA de projeto ([RN-196](#rn-196)) dentro da linha
expandida — o que sai é o item solto sem destino.

- **Onde:** `apps/web/src/routes/Shell.tsx` (o bloco `.globalNav`/
  `.inertNavItem` da FASE 17a foi removido, sem substituto global)
- **Teste:** `apps/web/src/routes/Shell.test.tsx` (describe "sem itens
  globais inertes")
- **Origem:** PROGRAMA 28, Onda 2, frente B —
  `design_handoff_brabo/README.md` seção "Navigation shell"

### RN-201 — Projeto/aba ativos persistem entre páginas; o colapso da sidebar é SÓ do usuário {#rn-201}

Duas chaves finais do handoff: `brabo.project` (o projeto ativo) e
`brabo.tab` (a aba ativa) — gravadas quando o usuário clica um link de aba
NA SIDEBAR (`LinhaDeAba`/o link de nome do projeto). `?tab=` na URL só vale
como deep-link INICIAL (`project-tabs.ts`, FASE 24) — trocar de aba dentro
de `ProjectPage.tsx` é estado local e não escreve na URL depois do
primeiro load, então estas chaves são o único jeito de a preferência
sobreviver entre uma navegação e outra. **Esta metade nunca mudou.**

**O auto-colapso da aba de Código SAIU (ADR 0126).** Até aqui a aba de
Código recolhia a sidebar sozinha para dar largura ao editor, sem gravar
preferência: `AutoCollapseContext`/`useAutoCollapseSidebar` em
`sidebar-state.ts`, registrados por `ProjectCodeTab.tsx` (a única
chamadora) e somados por OR ao colapso manual dentro do `Shell`. O contexto,
o hook, o estado `autoColapsado`, o `Provider` em torno de `<Outlet />` e o
`disabled` do botão de recolher — que existia só para proteger esse caminho
— foram todos removidos.

O motivo é estrutural: com o trilho vertical do projeto
(`routes/ProjectRail.tsx`) sempre presente, manter o auto-colapso poria a
trilha de ícones do Shell encostada no trilho do projeto — DOIS trilhos
verticais adjacentes, permanentes, na aba mais pesada do produto.

O que passa a valer: **o colapso da sidebar é uma decisão do USUÁRIO, e só
dele.** Continua manual, continua persistido em `brabo.sidebar.collapsed`
([RN-195](#rn-195)), e nenhuma tela recolhe a sidebar por conta própria.

**O custo, aceito e declarado:** a aba de Código passa a abrir com a sidebar
EXPANDIDA (264px) + o trilho do projeto (180px) + o trilho do próprio
`CodeShell` (48px) — 492px de moldura antes do primeiro caractere de código,
MEDIDOS no navegador, contra ~110px antes (62px de sidebar recolhida + 48px
do trilho do Código). Recolher manualmente continua possível e
ainda produz trilho do Shell ao lado do trilho do projeto — a diferença é
que agora quem escolheu foi o usuário, não o sistema.

- **Onde:** `apps/web/src/lib/sidebar-state.ts:80-105`
  (`lerProjetoAtivo`/`gravarProjetoAtivo`, `lerAbaAtiva`/`gravarAbaAtiva`, e
  o comentário que registra a remoção), `apps/web/src/routes/Shell.tsx:366-369`
  (só `colapsadoManual` sobrou), `apps/web/src/routes/ProjectCodeTab.tsx`
  (nenhuma chamada de colapso)
- **Teste:** `apps/web/src/lib/sidebar-state.test.ts` (describe "projeto e
  aba ativos"), `apps/web/src/routes/Shell.test.tsx` (describe "Shell —
  colapso da sidebar": a preferência só nasce de clique no botão e é sempre
  gravada). O describe "useAutoCollapseSidebar" foi removido junto com o
  hook.
- **Origem:** PROGRAMA 28, Onda 2, frente B —
  `design_handoff_brabo/CHECKLIST-CONFRONTO.md` seção 1; a metade do
  auto-colapso foi revista pelo
  [ADR 0126](../adr/0126-trilho-vertical-de-navegacao-do-projeto.md)
### RN-202 — A aba `sessions` continua "Chat", nunca "Chat RAG" {#rn-202}

O handoff de design mais recente do PROGRAMA 28 chama a aba consultiva de
"Chat RAG" (`designs/Brabo Chat.dc.html`), mas o produto não tem essa
funcionalidade: não há pipeline de indexação por projeto, não há índice
vetorial, não há UI de citação de fonte. O ADR 0075 pôs `embed` no contrato de
`LLMProvider` — a operação existe e é PROVADA no Ollama —, mas nada ainda a
CONSOME. A aba `sessions` de hoje é o Chat consultivo comum da
[RN-104](../business-rules.md#rn-104): um agente respondendo com o contexto da sessão, sem
produzir backlog, sem RAG nenhum por trás.

Rotular a aba "Chat RAG" hoje anunciaria uma capacidade que não existe — o
mesmo erro que o [ADR 0042](../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
já recusa para modelo de catálogo ("não ativar modelo descoberto
automaticamente"). O rótulo muda no dia em que a funcionalidade chegar, junto
com o dado por trás dele — nunca antes.

- **Onde:** `apps/web/src/routes/project-tabs.ts:144` (entrada `key:
  'sessions'`)
- **Teste:** `apps/web/src/routes/project-tabs.test.tsx` (describe "abas do
  projeto derivam de um registro só", `'RN-202 — a aba \`sessions\` continua
  "Chat", nunca "Chat RAG"'`)
- **ADR:** [0078](../adr/0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)

### RN-203 — O handoff é referência visual, não teto de quantas abas o produto tem {#rn-203}

O handoff de design lista 7 abas de projeto (Visão geral, Criativo, Código,
Chat RAG, Gastos, Aprovações, Configurações); o registro
(`apps/web/src/routes/project-tabs.ts`) tem 10. As três a mais —
`executores` ([RN-121](../business-rules.md#rn-121)), `backlog` ([RN-048](../business-rules/custo.md#rn-048)) e
`insights` (hipóteses do Psicólogo aguardando decisão) — nasceram DEPOIS do
handoff ser desenhado, todas com dado real, contador derivado de consulta e
pelo menos uma RN própria com teste.

O handoff fixa como cada tela deve se PARECER — cores, tipografia,
espaçamento, o desenho da moldura —, e essa parte foi seguida à risca nesta
mesma mudança (header, régua, rolagem, largura do conteúdo). Ele não congela o
inventário de abas no dia em que foi escrito. Apagar as três para "bater" com
o handoff destruiria informação que o produto já sabia mostrar, pelo motivo
errado.

- **Onde:** `apps/web/src/routes/project-tabs.ts:91` (o `REGISTRO`)
- **Teste:** `apps/web/src/routes/project-tabs.test.tsx` (describe "abas do
  projeto derivam de um registro só", `'RN-203 — as 3 abas que o handoff não
  previu continuam no registro'`)
- **ADR:** [0078](../adr/0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)
### RN-210 — "Recomendado" é uso real e custo, nunca nota calculada {#rn-210}

O bloco "Melhores modelos por capacidade" (Configurações) não tem coluna de
score. O handoff mostra uma nota por capacidade (código 9.4, imagem 9.1…), mas
é dado FICTÍCIO do mock — nenhum provider publica "qualidade de código" e o
produto não mede isso em lugar nenhum. Calcular um número aqui seria o mesmo
"palpite vestido de dado" que o [ADR 0041](../adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)
proíbe para capability de MODELO, agora sobre qualidade.

Em vez disso, "recomendado"/"alternativa" saem de dois sinais reais, entre os
modelos que a curadoria DESTE workspace marcou para aquela capacidade (`uses`,
[RN-057](../business-rules/custo.md#rn-057)): primeiro os mais usados por agentes DESTE projeto — a
mesma cascata que resolve o binding vigente de cada agente —, custo (do
catálogo, ascendente) como desempate. "O que o time já escolheu" é o sinal
mais honesto disponível sem inventar nota. Capacidade sem nenhum modelo curado
mostra "sem cobertura curada" — nunca esconde a linha, mesmo padrão que a
coluna Origem de `ModelsSection` já usa para o binding pulado.

- **Onde:** `apps/web/src/routes/settings/MelhoresModelosPorCapacidadeSection.tsx`
- **Teste:** `apps/web/src/routes/ProjectSettingsTab.test.tsx`
  (describe "MelhoresModelosPorCapacidadeSection")
- **ADR:** [0077](../adr/0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md)

### RN-211 — Gasto por provider na tela é Ranking, não paleta categórica inventada {#rn-211}

O handoff pede barras diárias empilhadas por provider e uma quebra por
provider. A skill de dataviz do repositório manda validar paleta
categórica por script antes de usar, nunca por olho: `validate_palette.js`
reprova toda combinação de 3+ tokens de `design/tokens.css` contra pelo
menos um dos dois temas — `--accent`+`--violet` é o único par que passa
nos dois (vários `--syntax-*` são literalmente o mesmo hex de
`--warning`/`--violet`/`--success`, medido). Com 9 providers (ADR 0043) e
2 cores validadas, ciclar a paleta é o anti-padrão que a própria skill
nomeia ("a 9th series is never a generated hue"), e inventar hex novo
violaria a instrução desta frente. A quebra por provider vira `Ranking` —
a mesma peça de "Por modelo"/"Por projeto"/"Por agente e pessoa", sem
identidade por cor. A série DIÁRIA por provider não é entregue:
`sumGroupedBy` (ADR 0076) agrupa por uma dimensão de cada vez, e não existe
agregação cruzada dia×provider no backend desta onda.

- **Onde:** `apps/web/src/lib/spend.ts` (bloco "Gasto por PROVIDER na
  tela"), `apps/web/src/routes/ProjectSpendTab.tsx` (`GastoDoWorkspace`)
- **Teste:** `apps/web/src/routes/ProjectSpendTab.test.tsx` (describe "a
  audiência do owner" — `'mostra os cinco recortes do workspace,
  incluindo provider'`)
- **ADR:** [0076](../adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

### RN-212 — Bloco "por projeto" é o TokenMeter plugado ao orçamento real {#rn-212}

A aba de Gastos ganha um bloco por PROJETO (não por audiência):
`OrcamentoDoProjeto` lê `GET /projects/:id/budget` e planta o resultado
direto no `TokenMeter` existente, que já implementa os limiares 70/90
(`tokenThreshold`) — nenhum componente novo. Três leituras: carregando
(silencioso, evita piscar antes do papel resolver a audiência de baixo),
sem orçamento definido (nota em texto, sem CTA) e erro (silencioso — na
prática quase sempre 403 de quem tem papel de WORKSPACE mas não é
`maintainer` no PROJETO, e mostrar banner de propósito seria alarme falso
para a maioria dos membros, o mesmo padrão já usado pelo `TokenMeter`
compacto de `ProjectPage.tsx`).

- **Onde:** `apps/web/src/routes/ProjectSpendTab.tsx`
  (`OrcamentoDoProjeto`)
- **Teste:** `apps/web/src/routes/ProjectSpendTab.test.tsx` (describe "o
  orçamento do projeto")

### RN-213 — Alerta de custo é leitura de `lastThresholdNotified`, nunca recálculo {#rn-213}

`alertaDeOrcamento` não reimplementa `crossedThresholds`
(`apps/api/src/domain/llm/budget-threshold.ts`): lê o campo que o backend
já grava no momento em que uma chamada real cruza 70/90/100%, e só decide
a cor (`warning` abaixo de 90, `danger` a partir de 90) e se o texto deve
avisar bloqueio ativo (`policy === 'block' && spentMicros >=
limitMicros`). Nenhuma regra de negócio nova — puramente apresentação de
um dado que já existe.

- **Onde:** `apps/web/src/lib/spend.ts` (`alertaDeOrcamento`)
- **Teste:** `apps/web/src/lib/spend.test.ts` (describe "alertaDeOrcamento
  (RN-213)"); `apps/web/src/routes/ProjectSpendTab.test.tsx` (describe "o
  orçamento do projeto")

### RN-214 — KPI de economia com modelo local fica de fora por falta de preço contrafactual {#rn-214}

`TokenMeter` já tem `savingsBRL`/`savingsPct` prontos para receber o
número, e permanecem não alimentados de propósito. O card exigiria um
preço CONTRAFACTUAL — quanto a mesma chamada teria custado num modelo
pago — que não existe em lugar nenhum do produto: o catálogo (ADR 0042)
só congela o preço do modelo REALMENTE usado (RN-044), e não há
mapeamento declarado "modelo local X ~ modelo pago Y". Inventá-lo aqui
seria a mesma classe de "nota vestida de dado" que a RN-210 já recusou
para ranking de capacidade. Pendência registrada no backlog para quando
existir um preço contrafactual defensável e versionado.

- **Onde:** `apps/web/src/routes/ProjectSpendTab.tsx` (comentário "KPI de
  economia com modelos locais — CORTE DECLARADO", fim do arquivo)

### RN-215 — Aba Problemas nasce com estado vazio honesto {#rn-215}

Não há lint nem teste integrado sobre o código do projeto gerido; a aba
Problemas do painel inferior (handoff `design_handoff_brabo`) diz isso
explicitamente em vez de mostrar contagem inventada (o mock do handoff traz
badge "3"). Mesmo padrão já usado pelo Terminal (FASE 25b) e pelo item
"Testes" desabilitado do rail.

- **Onde:** `apps/web/src/routes/code/CodeBottomPanel.tsx`
- **Teste:** `apps/web/src/routes/code/CodeBottomPanel.test.tsx` —
  "Problemas diz honestamente que não há lint/teste integrado, sem
  contagem inventada"

### RN-216 — Aba Saída nasce com estado vazio honesto {#rn-216}

Não há stream de comando de build/deploy nesta aba — ele dependeria do
terminal interativo (FASE 25b), que não existe. A aba explica isso e lembra
que `git push`/PR/deploy não saem pelo terminal de qualquer forma (RN-106).

- **Onde:** `apps/web/src/routes/code/CodeBottomPanel.tsx`
- **Teste:** `apps/web/src/routes/code/CodeBottomPanel.test.tsx` — "Saída
  diz honestamente que não há stream de comando, sem simular execução"

### RN-217 — Status bar da aba Código só mostra dado real {#rn-217}

A status bar de 24px (`CodeShell.tsx`) mostra `↑N ↓M` de commits da branch
atual (via `getCodeBranches`, mesma `queryKey` de `CodeBranchPicker` —
dedup, zero requisição extra, RN-090/091) e a linguagem do arquivo ativo
(`linguagemPorCaminho`). Posição do cursor e contagem de erros/testes do
mock do handoff ficaram de fora: `CodeEditor` não expõe seleção/caret
rastreável e não há lint/teste integrado (mesma decisão da RN-215).

- **Onde:** `apps/web/src/routes/code/CodeShell.tsx`
- **Teste:** `apps/web/src/routes/code/CodeShell.test.tsx` — "a status bar
  mostra ↑/↓ real da branch atual" e "sem ahead/behind (branch em dia), a
  status bar não mostra o par vazio"

### RN-218 — Foco visível nas abas próprias do painel inferior {#rn-218}

As abas de `CodeBottomPanel.tsx` são implementação própria (não o `Tabs` do
design system) e não herdavam o `:focus-visible` calibrado que
`Tabs.module.css` ganhou na Onda 2/frente C. Corrigido com o mesmo padrão de
`Input.module.css` (ADR 0036), incluindo `forced-colors`.

- **Onde:** `apps/web/src/routes/code/CodeBottomPanel.module.css`

### RN-219 — Os três escopos do índice de chunks são honestos, e mutuamente exclusivos por CHECK {#rn-219}

O índice do Chat RAG cobre só três fontes de texto que o produto já sabe de
onde vieram: `docs`, `adr` e `session`. Código-fonte e Pull Requests ficam
de fora de propósito — indexá-los sem um watcher de reindexação a cada
`push` faria o índice mentir sobre cobertura, a mesma classe de erro que o
ADR 0042 já recusa para capability de modelo. `session_id`/`source_path`
são mutuamente exclusivos por CHECK, não por convenção de aplicação, mesmo
padrão de `projects.workspace_mode`/`workspace_path` (ADR 0072): `scope =
'session'` exige `session_id` e recusa `source_path`; `docs`/`adr` exigem
`source_path` e recusam `session_id`. A trava fica no banco porque quem vai
escrever esta tabela é um pipeline (Onda 4) que não necessariamente passa
pelo mesmo caso de uso toda vez.

- **Onde:** `apps/api/src/db/schema/rag.ts` (`chunkScopeEnum` e os dois CHECK
  da tabela `chunks`)
- **Teste:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  ("recusa chunk de docs sem source_path — o CHECK da migração 0045, não
  validação de aplicação")
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-220 — Vetor e busca léxica vivem na mesma linha, nunca em tabelas separadas {#rn-220}

`chunks.embedding` (pgvector) e `chunks.search_vector` (tsvector) são
colunas irmãs da MESMA tabela, não duas tabelas ligadas por `chunk_id`.
Separar exigiria um JOIN em toda busca híbrida (Onda 4) e abriria espaço
para as duas divergirem — um trecho com vetor mas sem entrada léxica, ou
vice-versa — sem nenhum mecanismo do banco impedindo. Uma linha, uma fonte
de verdade para as duas metades da busca.

- **Onde:** `apps/api/src/db/schema/rag.ts` (tabela `chunks`)
- **Teste:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  (as três specs escrevem e leem as duas colunas na mesma linha)
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-221 — `search_vector` nunca é escrita pela aplicação — é coluna GENERATED {#rn-221}

`search_vector` é `GENERATED ALWAYS AS (to_tsvector('portuguese', content))
STORED`. Nenhum caso de uso, repositório ou script escreve nela — o
Postgres a mantém coerente com `content` por construção, pronta na mesma
transação do `INSERT`, sem depender de nenhum provider de LLM responder
(diferente de `embedding`, que só chega quando um pipeline de indexação
existir).

- **Onde:** `apps/api/src/db/schema/rag.ts` (coluna `search_vector`)
- **Teste:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  ("grava um chunk de docs com vetor e devolve o search_vector gerado pela
  GENERATED ALWAYS AS")
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-222 — A dimensão do vetor é documentada, não adivinhada, e `embedding` chega depois do chunk {#rn-222}

`chunks.embedding` é `vector(768)` — a dimensão real do `nomic-embed-text`
do Ollama, o único provider que hoje declara `capabilities.embeddings:
true` (RN-191, ADR 0075). Um índice vetorial tem dimensão FIXA: trocar de
modelo de embedding no futuro é migração nova, nunca parâmetro de runtime.
A coluna é NULLABLE: esta tabela guarda o CHUNK (texto recortado), e o
VETOR pode chegar depois via um pipeline de indexação assíncrono que ainda
não existe (Onda 4) — sem isso, chunking teria que esperar embedding,
misturando duas falhas de natureza diferente (parsing de documento contra
chamada de rede a um provider) numa escrita atômica só.

- **Onde:** `apps/api/src/db/schema/rag.ts` (coluna `embedding`)
- **Teste:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  ("grava um chunk de docs com vetor..." grava com `embedding` preenchido;
  as outras duas specs gravam sem ele, confirmando a nulabilidade)
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md); [RN-191](../business-rules/custo.md#rn-191)

### RN-223 — O índice vetorial é HNSW, não IVFFlat, porque a tabela nasce vazia {#rn-223}

IVFFlat precisa de linhas já carregadas para treinar as listas (`lists`) e
fica ruim se construído sobre tabela vazia — que é exatamente o estado
desta tabela ao nascer, sem pipeline de indexação ainda (Onda 4). HNSW
constrói o grafo incrementalmente, inserção por inserção, sem etapa de
treino — bom desde a primeira linha. `vector_cosine_ops` porque é a
métrica que embeddings de texto geralmente esperam (o ranking de
similaridade não deveria mudar com a magnitude do vetor).

- **Onde:** `apps/api/src/db/migrations/0045_shallow_randall.sql`
  (`chunks_embedding_idx`)
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-224 — A migração cria a extensão pgvector sozinha, de forma idempotente {#rn-224}

A migration `0045` executa `CREATE EXTENSION IF NOT EXISTS vector` antes de
criar a tabela, em vez de assumir que `docker/postgres/init.sql` já rodou —
esse arquivo só executa na PRIMEIRA inicialização do volume Postgres, e um
ambiente com volume antigo pode não ter a extensão. `IF NOT EXISTS` é
idempotente: local (onde a extensão já estava instalada) e um ambiente
novo passam pela mesma linha sem diferença de comportamento.

- **Onde:** `apps/api/src/db/migrations/0045_shallow_randall.sql`
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-225 — Migração que pode exigir privilégio de operador nasce em `breaking/` {#rn-225}

Criar uma extensão exige que o role da aplicação tenha `CREATEDB` (ou que a
extensão esteja marcada "trusted" pelo DBA). Localmente o role é
superusuário, mas nada garante isso em produção — gerenciadores de
Postgres administrado frequentemente não dão superusuário à aplicação. Se
a migration falhar aí, é ação do OPERADOR antes do deploy (rodar `CREATE
EXTENSION vector;` uma vez, como superusuário), não bug do produto — o
critério do CLAUDE.md para nascer em `breaking/` em vez de
`feature/`/`bugfix/`.

- **Onde:** branch `breaking/tabela-de-chunks`,
  `apps/api/src/db/migrations/0045_shallow_randall.sql` (comentário que
  documenta a decisão dentro da própria migration)
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-226 — `ChunkRepository` cobre só escrita/leitura básica; `createMany` é operação de lote {#rn-226}

O port só tem `create`, `createMany`, `findById` e `listByProject` — busca
híbrida (vetor + léxico, pesos, limiar) é da Onda 4 (G2) e deliberadamente
NÃO entra aqui: o port guarda dado, o caso de uso decide o que fazer com
ele. `createMany` existe porque uma indexação recorta N trechos de um
documento/sessão de uma vez, evitando N round-trips por documento
indexado.

- **Onde:** `apps/api/src/application/ports/chunk-repository.port.ts`,
  `apps/api/src/infrastructure/persistence/drizzle/chunk.repository.ts`
- **Teste:** `apps/api/test/infrastructure/persistence/chunk.repository.spec.ts`
  ("createMany grava um lote e listByProject filtra por escopo, sem
  misturar docs e session")
- **ADR:** [0079](../adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

### RN-227 — Selo de status da sessão cobre os 5 estados reais, não os 4 do handoff {#rn-227}

O handoff pede 4 selos (ativa/aguardando/fechada/abortada) para os 5
estados reais da máquina (`created/active/closing/closed/closed_abnormally`).
`closed_abnormally`→abortada e `created`→aguardando são diretos. `closing`
NÃO é fundido com "fechada": ganha selo próprio ("encerrando", tom
`accent`, pulsante), porque em `closing` o desfecho (`closed` ou
`closed_abnormally`) ainda não é conhecido — chamá-la de "fechada"
mentiria sobre isso.

- **Onde:** `apps/web/src/routes/ProjectSessionsTab.tsx` (`SELO_DO_STATUS`)
- **Teste:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — describe
  "ProjectSessionsTab — selo de status (RN-227)"

### RN-228 — Filtro pill agrupa os 2 estados sem pill própria por TRAJETÓRIA {#rn-228}

Os filtros pill do handoff (todas/ativas/fechadas/abortadas) só cobrem 4
dos 5 estados. `created` (aguardando) entra no pill "Ativas" — ainda não
chegou a lugar nenhum, é "sessão em jogo". `closing` entra no pill
"Fechadas" — já está a caminho de fechar sem erro. O SELO de cada linha
(RN-227) nunca é reescrito pelo filtro; o pill só agrupa.

- **Onde:** `apps/web/src/routes/ProjectSessionsTab.tsx`
  (`correspondeAoFiltro`)
- **Teste:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — describe
  "filtro pill agrupa os 2 estados sem pill própria (RN-228)"

### RN-229 — KPI "custo do mês" da aba Criativo é o consumo do ATOR, não o total do projeto {#rn-229}

Reaproveita `getMySpend(projectId, 30)` — a MESMA queryKey que
`ProjectSpendTab.tsx#MeuConsumo` usa para a visão do membro (RN-101, ADR
0063), sem agregação nova. NUNCA mostra o total do projeto somando todo
mundo (`porProjeto` em `getWorkspaceSpendReport`), porque esse dado é
owner-only e a aba Criativo é vista por qualquer membro do projeto —
mostrar o total geral vazaria gasto alheio para quem a RN-060/101 não
autoriza a ver.

- **Onde:** `apps/web/src/routes/ProjectSessionsTab.tsx` (`CriativoKpis`)
- **Teste:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — describe
  "KPIs da aba Criativo", casos "caminho feliz" e "CASO DE FALHA"

### RN-230 — KPI "taxa ideação → commit" é declarado ausente, nunca calculado {#rn-230}

Não existe, em lugar nenhum do produto, vínculo entre uma sessão criativa e
o commit que ela produziu. A aba Criativo mostra "—" com a frase "não
medido: sessão não é vinculada a commit hoje" em vez de inventar um
cálculo — mesma classe de erro que o ADR 0042 já recusa para nota de
modelo.

- **Onde:** `apps/web/src/routes/ProjectSessionsTab.tsx` (`CriativoKpis`)
- **Teste:** `apps/web/src/routes/ProjectSessionsTab.test.tsx` — "'Taxa
  ideação → commit' é DECLARADA ausente — nunca um número calculado"
