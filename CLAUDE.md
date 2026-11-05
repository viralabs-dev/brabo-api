# brabo-api

API do Brabo: NestJS 11 + Drizzle + PostgreSQL 16/pgvector. Dona do schema, do RBAC, do roteador de LLM, do metering, dos gates (`docs/gates.yml`) e do `openapi.json`.

> Partido do `CLAUDE.md` do monorepo `daneiel/brabo` (hoje `brabo-legacy`, `dev` @ `1586158973`) na AT-708 (EP-033, ADR 0252). Copiado, não resumido: o que era de outro repo foi cortado e os caminhos do monorepo viraram a raiz deste repo (ou `brabo-<x>:caminho`). Caminhos sem prefixo que não existem aqui (`docker/`, `deploy/`, `install.sh`, `e2e/`, `scripts/dev/`, `scripts/ci/` fora do `brabo-ci`) moram no `brabo-infra`, no `brabo-qa` ou no `brabo-ci`. O resto das regras mora no `CLAUDE.md` da pasta-mãe (`brabo-workspace`, clonado em `~/dev/brabo/CLAUDE.md`) e no de cada repo irmão.

## Stack (decidida — não proponha alternativas)
- este repo: NestJS 11 + Drizzle ORM + PostgreSQL 16 + pgvector;
  `nodemailer` para SMTP real do `MailSender` (ADR 0096), atrás de
  `MAIL_TRANSPORT` — `log` continua o default, inclusive em produção;
  `neo4j-driver` para o grafo de conhecimento (ADR 0099) — memória
  DERIVADA do event log, nunca fonte de verdade, e por isso SEM backup (ADR
  0152): o caminho de volta é `pnpm --filter api grafo:reprojetar` (RN-569),
  que chama o MESMO `GraphEventTranslator` do projetor vivo — tipo novo
  projetado ganha tradução ALI, nunca num segundo tradutor — e não toca a
  outbox dele; `PromptTemplate` não vem do event log e volta por
  `scripts/dev/seed-prompts.ts`; pgvector CONTINUA sendo
  o índice vetorial dos chunks, o grafo não guarda embedding; a pasta `docs/`
  dos artefatos (ADR 0148) é a SEGUNDA projeção derivada e tem o mesmo
  caminho de volta — `pnpm --filter api artefatos:reprojetar` (RN-590), pelo
  MESMO `ArtifactEventTranslator` do `ArtifactProjector`, sem backup, sem tocar
  a outbox e sem apagar nada
- Auth: first-party no domínio da api (argon2id + access JWT curto +
  refresh opaco com rotação); autorização RBAC no domínio da api
  (inalterada desde a Fase 1)
- LLM: roteador na api com suite de contrato; base OpenAI-compatível
  sobre node:http (timeout de inatividade, erro por `code`,
  capabilities em duas camadas — ADR 0041); catálogo com curadoria e
  preço congelado no metering (ADR 0042) — que desde o ADR 0188 só é o
  número quando a resposta NÃO traz o custo real: o `usage.cost` do
  OpenRouter vence, com `price_implicit` marcando a linha (a MESMA coluna
  do Jev) e o do catálogo ao lado em `catalog_cost_micros`, RN-665; 11 providers (ADR 0043); o 10º é o 9Router (ADR 0222) e o 11º o OpenCode Zen (ADR 0227); o Jev
  (`typesafe/jev-1.13`, Decisions API do OpenRouter) escolhe o menu de
  ferramentas de cada passo por uma porta PRÓPRIA, `ToolRouter`, fora do
  `LLMProviderRegistry` e do catálogo `models` (ADR 0179, RN-625): só com
  provider OpenRouter, só RESTRINGE (P3), ligado por padrão por workspace, e
  qualquer falha dele deixa o catálogo inteiro — o turno nunca falha por causa
  dele, e ele não aprova, não nega nem escolhe modelo
- Contratos: `@brabo/shared` (só tipos) vem do `brabo-contracts` por TAG (`git+https://github.com/viralabs-dev/brabo-contracts.git#v1.0.0&path:/packages/shared`). A api NÃO consome `@brabo/docker-port`. `contracts/areas.json` é gerado aqui por `pnpm gerar:areas` e publicado no `brabo-contracts`.

## Repositório, branches e PR (vale para todo repo `brabo-*`)
- Branches permanentes: dev, main — um branch, um ambiente; a esteira é
  `dev → main`. A `qa` foi APOSENTADA por hora (ADR 0235, só no repositório do
  Brabo; arquivada em `refs/archive/qa`, segue em `PROTECTED_BRANCHES` do
  produto e em `NUNCA_ARQUIVAR`). `rc` saiu
  da política (ADR 0030) e o bootstrap parou de criá-la, mas continua em
  `PROTECTED_BRANCHES` DE PROPÓSITO: a lista decide o que a trava de merge
  RECUSA, e repositórios bootstrapados por versões anteriores ainda têm a
  branch. Proteger uma branch que não existe não custa nada; desproteger
  uma que existe custa caro. Não "limpe" essa lista.
  Trabalho nasce de dev com a taxonomia da política (breaking/,
  feature/, bugfix/, perf/, refactor/, chore/, docs/, test/);
  hotfix/ nasce de main. Os AGENTES seguem a mesma régua desde a RN-664: o
  worktree do dev agent nasce de `dev`, a PR dele e a de ADR miram `dev`, e o
  gate julga o diff contra `dev` — os três juntos, nunca um só (o gate
  julgaria um diff que não é o da PR); repositório sem `dev` falha nomeado,
  sem queda para a default. A PR de INFRA (`open_infra_pr`) segue a
  mesma régua desde a RN-729: `feature/infra-setup` nasce de `dev`, mira `dev`
  e leva o autor `infra[bot]`. Formato funcao/descritivo,
  regex ^.{0,30}/\S{0,32}$. EXCEÇÃO nomeada: `dependabot/…` é branch
  PERMITIDA sem critério de caracteres (sem limite de tamanho, qualquer número
  de barras), mas só quando o AUTOR é o próprio Dependabot
  (`ehBranchDoDependabot` em `scripts/ci/pr-police.ts`) — humano com esse
  prefixo reprova em `FUNCAO-DESCONHECIDA`, senão o prefixo vira a porta para
  escapar do formato. Commits em conventional commits, pt-BR.
  A FUNÇÃO da branch decide a VERSÃO (scripts/ci/version.ts): breaking/
  sobe MAJOR, feature/ sobe MINOR, todo o resto é PATCH. Mudança que
  exige ação do operador antes do deploy nasce em breaking/ mesmo quando
  o conteúdo é correção — o v2.5.1 saiu patch porque a chave obrigatória
  do OAuth nasceu em bugfix/, e um patch diz "atualize sem pensar".
  Versão não se corrige à mão depois: o valor de ela ser calculada vem de
  não ser negociada caso a caso.
- Toda mudança entra por PR — push direto em permanente é bloqueado;
  únicas exceções de push: tags (bot de release) e .release/gate.json
  (bot do gate).
- Toda branch cujo PR é mergeado é ARQUIVADA automaticamente, SEM carência, por checagem
  SEMANAL (segunda 09:00 de Brasília, AT-661) (`.github/workflows/archive-merged-branch.yml`,
  AT-557): sem PR aberta e sem commit depois do merge; branch sem PR mergeada
  não é tocada — move de
  `refs/heads/<nome>` para `refs/archive/<nome>`, nunca apaga: histórico
  intacto, recuperável com um `git push` de volta. Exceções: dev/qa/main
  (aparecem como `head` de todo PR de promoção), `gh-pages` (deploy do
  site, não é branch de feature) e branch de fork. A política mora em
  `scripts/ci/archive-branch.ts` (testado), ver
  scripts/ci/docs/explanation/branching-policy.md, seção "Merged branches get
  archived".
- PR do Dependabot entra pela `dev`, nunca direto na `main`; na `dev` ele não espera aprovação humana (ADR 0236) e a `main` segue com a escada inteira. Dependência de linguagem só por segurança (`open-pull-requests-limit: 0`), `github-actions` e `docker` semanais, `target-branch: dev`. O `dependabot-para-dev.yml` do `brabo-ci` fecha ou redireciona o PR de segurança que o GitHub abre contra a `main`.
- Merge em branch protegida (`dev`/`main`) é SEMPRE manual do usuário, sem opção de automatizar. A política de PR, escada, promoção e carimbo de tag vem dos workflows reutilizáveis do `brabo-ci`, fixados por SHA com `# vX` no `uses:`. Imagem de terceiro por digest com a tag inline. Segredo nunca é impresso; teste nunca roda contra o Postgres da instalação.

## Convenções (dados e domínio)
- `src/db/seed.ts` é IDEMPOTENTE, e rodá-lo de novo é o caso normal
  (o `bootstrap.sh` do k8s o chama com `BRABO_FORCE_SEED=1` contra um cluster
  que pode já estar semeado, e quem vê o reset falhar tenta rodar só o seed).
  Registro de demonstração novo entra REAPROVEITANDO o que já existe, nunca
  com `create` puro — antes, workspace, projeto e sessão eram os três que não
  reaproveitavam, e a segunda rodada escrevia metade e morria em
  `duplicate key ... "workspaces_slug_unique"`. Sessão reencontrada NÃO é
  reativada nem ganha os 5 eventos de novo: eles são append-only, e uma
  timeline que existe para demonstrar cinco não pode crescer a cada reseed.
- Criar usuário tem UM núcleo (`ProvisionarUsuarioUseCase`) e DUAS portas com
  regras diferentes, e a diferença é o que cada uma protege (RN-546, ADR 0155).
  `provisionarUsuario` (seed/smoke) MANTÉM a recusa de `NODE_ENV=production` e
  ela fica no SCRIPT, não no núcleo: o que ela protege é senha CONHECIDA criada
  SEM interação humana, e não o trio de escritas — **não use `BRABO_FORCE_SEED`
  para atravessá-la**. `POST /internal/first-account` roda em produção de
  propósito (é onde o instalador roda), e é outra categoria: senha DIGITADA no
  TTY por quem está na máquina. E a régua de senha é UMA só, a
  `exigirSenhaValida` do domínio — por isso o DTO dessa rota NÃO repete um
  `@MinLength`, que cobriria só uma das cinco recusas e divergiria da do
  registro no primeiro dia em que uma das duas mudasse.
- O acesso rápido por papel (`POST /auth/dev-login`, contas `<papel>@brabo.dev`)
  só existe com `BRABO_AMBIENTE=local` e nunca sai por Actions: `dev`/`prd`
  vão no build, o `ambiente-nas-actions.spec.ts` reprova `local` em workflow
  (ADR 0245, RN-984). Não ligue por `BRABO_FORCE_SEED` nem pelo `install.sh`.
- Comunicação api ↔ engine: eventos via Postgres (transactional outbox
  na api, Oban no engine) + HTTP interno com service token para
  comandos síncronos.
- O schema do Postgres mora em `src/db/schema/`, UM arquivo por
  AGREGADO de domínio, espelhando `src/domain/*` (ADR 0121);
  `db/schema.ts` é só o BARREL de `export *` que todo mundo importa, e é para
  onde `drizzle.config.ts` aponta. Tabela nova entra no arquivo do agregado
  dela — arquivo novo só quando o agregado é novo, e aí entra também no
  barrel, na posição do ASSUNTO e não no fim. Enum mora com a tabela que o
  CHAMA, não com o assunto: FK entre arquivos é segura num ciclo
  (`.references()` é callback preguiçoso), enum entre arquivos NÃO é (roda na
  avaliação do módulo) — o grafo de imports é um DAG e continuar assim é
  invariante que ninguém testa, só quebra no boot.
- Todo evento de domínio é imutável: nunca UPDATE em tabelas de eventos.
- História ARQUIVADA é a coluna `stories.archived_at`, nunca um valor de
  `story_status` (o status é o que decide o claim) — ADR 0212, RN-727. Toda
  leitura que DECIDE (backlog, cobertura, fila de promoção, plano do Dev Lead,
  claim e a contagem dele) filtra `archived_at IS NULL`, e as tarefas saem
  junto pela história. Editar e arquivar têm UMA régua
  (`recusaDeCorrecaoDeHistoria`): só `draft` e sem tarefa
  `in_progress`/`in_review`; quem pode é o PO (`update_story`/`archive_story`)
  e o usuário (`developer`, aba Histórias). Corrigir a história é o caminho —
  o PO não a recria.
- Estados de sessão são máquina de estados explícita:
  created → active → closing → closed | closed_abnormally
  Estado TERMINAL recusa CONVERSA com 409 nomeado (`sessao_encerrada`,
  RN-581), e "conversa" é TIPO de conversa OU ATOR conversacional — nunca uma
  lista de permitidos por tipo: o Psicólogo e a Anamnese escrevem numa sessão
  fechada com o MESMO vocabulário do Criativo, e a decisão humana sobre ação
  pendente continua entrando. O heartbeat não fecha sessão com conversacional
  esperando o usuário, mas essa é a ÚNICA pendência com teto (8h do fim do
  turno, causa `conversation_idle_timeout`); os outros sinais da RN-064
  continuam sem teto e vencem. Fechar a sessão PARA os conversacionais dela
  em todos os nós (`SessionLifecycleWorker`), sem gravar o turno em curso —
  e, desde a RN-763, os dev agents dela e os gates do projeto, com a task em
  curso bloqueada e o worktree preservado (`Engine.Dev.EncerramentoDaSessao`);
  "Parar execução" na aba Executores é esse MESMO fechamento, sem estado novo.
  Os terminais têm UMA saída desde o ADR 0183 (RN-649/650): a REABERTURA,
  para `active`, por rota e checagem PRÓPRIAS (`reopen`, `canReopen`) — a
  transição genérica continua recusando `closed → active`, e `closing →
  active` segue proibido por qualquer caminho. Não ponha `active` em
  `ALLOWED_TRANSITIONS` dos terminais. O fechamento anterior vira o evento NOVO
  `session.reopened` (a coluna é limpa, o evento guarda quando e por quê), o
  `kind` não muda, e sessão com `execution.activated` NÃO reabre (409
  `sessao_com_execucao`); papel `developer` (o mesmo de encerrar), sem prazo e
  essa recusa são decisão do dono desde o ADR 0184 (AT-337), não mais padrão
  provisório. O `SessionLifecycleWorker` ignora o
  fechamento que a reabertura já desfez (lê o `status` da sessão).
- A sessão tem DUAS classificações, e elas não se sobrescrevem: `kind`
  (`consultiva|criativa`) é a INTENÇÃO de criação, gravada e imutável; o
  evento `execution.activated` é o ESTADO de execução, e continua sendo
  ele que `findActiveExecutionSession` procura. `execution.activated` em
  sessão consultiva é 409, nunca conversão silenciosa (ADR 0061, RN-097).
  Não faça a derivação por evento olhar `kind`
- O repositório de projeto CRIADO nasce no aceite do handoff ao ARQUITETO
  (RN-582, ADR 0165), dentro de `AcceptHandoffUseCase`, ANTES de
  `activateAgent` — criar projeto não provisiona (RN-541). O aceite ao Dev Lead
  repete a chamada como SEGUNDA PORTA idempotente (a saída do projeto que
  passou pelo Arquiteto sem repositório); não a remova. E
  `execution/activate` sem repositório é 409 antes de qualquer efeito —
  RECUSA, nunca provisiona: provisionar ali esconderia um efeito de git na
  ativação e deixaria Arquiteto e Infra, que trabalham antes dela, sem onde
  escrever. Desde o ADR 0186 (RN-660) esse aceite tem um SEGUNDO autor: a
  oferta `po → arquiteto` é aceita pelo SISTEMA quando o backlog está coberto
  (≥ 1 regra, nenhuma sem história, a mesma `computeCoverage` da aba Backlog),
  o repositório é `local` e o projeto não tem conexão de git — sempre por
  `AcceptHandoffUseCase` e com o ator `handoff-auto-accept` no log. Não
  estenda a outro par de agentes nem a repositório remoto sem ADR
- O `permissions.json` mora onde a API ALCANÇA, e o ESCOPO do terminal aponta
  para o HOST — são DUAS derivações desde a RN-478, não uma. Elas nasceram
  como uma só (`projectScopeRoot`), e isso estava certo enquanto os dois modos
  com pasta de usuário eram bind-mount; deixou de estar quando o `runner`
  nasceu, deliberadamente SEM bind-mount. O escopo do ADR 0055 quer o caminho
  do HOST (é lá que o comando roda, pelo runner); o arquivo de política quer um
  caminho que a api ALCANCE, porque ela o lê e o ESCREVE de dentro do container
  dela — daí o 500 da ativação (`mkdir '/home/<usuario>'`) e, pior, o arquivo
  que NUNCA existiu em projeto `runner`, com `decide()` caindo sempre em
  `require_approval`. `permissionsFilePath` mora ao lado de `projectScopeRoot`,
  no MESMO arquivo, porque a fonte continua única: o que se separou foi a
  pergunta, não a autoridade. No modo `runner` o arquivo vai para a raiz
  GERENCIADA, chaveado pelo `workspace_dir_name` da RN-109 — política é da api,
  não do disco do usuário: guardá-la lá a tornaria editável por quem ela
  restringe e ilegível com o runner desconectado. `container` e `mounted` não
  mudam (em `mounted` a pasta É bind-mount). NÃO "unifique" as duas de volta:
  há teste de não-regressão, e escopo apontando para a raiz gerenciada
  autorizaria comando numa pasta que não é a do projeto. O ENGINE não lê nem
  escreve esse arquivo em ponto nenhum — todas as menções nele são comentário
- Toda ação com efeito externo (git, terminal, gasto) nasce como
  proposed_action e respeita permissions.json; deny sempre vence allow.
  LER não é efeito externo e NÃO vira proposed_action — encheria a fila de
  ruído até ninguém mais ler as de verdade. O que a leitura deve é ser
  CONTIDA e ter TETO: caminho vindo do cliente passa pela checagem central
  (RN-092/RN-095), e leitura composta que chama o provider N vezes tem
  orçamento e cache, senão vira amplificador de tráfego (ADR 0060).
- `agent_autonomy` aceita `actionType: "*"` — "auto mode" (RN-153):
  autonomia pra QUALQUER tipo de ação do agente, ligada pelo `ApprovalCard`
  ("Modo automático") e desligada pelo mesmo toggle manual/auto do card do
  agente na Visão Geral/Executores. Regra específica sempre vence a
  curinga; a resolução mora no repositório (`resolve`, com `findMode` como
  leitura dele), nunca em `decide()`, que recebe o modo E a ORIGEM
  (`autonomyOrigin`). O teto de ESCOPO DE CAMINHO (ADR 0055) NÃO vale em auto
  mode (RN-603, ADR 0167, decisão do dono): ligar o modo automático é o
  usuário decidindo de uma vez que aquele agente roda qualquer comando,
  inclusive fora da pasta — medido no `exp001`, 47 de 51 pedidos vinham só do
  escopo, porque o dev agent roda no container (`/work`) e o escopo compara
  com a raiz do HOST. Só a curinga em `auto_approve` tem esse poder; regra
  ESPECÍFICA (`terminal: auto_approve`) segue com o escopo, e o toggle
  "manual" o restaura. Desde a RN-670 (ADR 0189, decisão do dono de 01/10, que
  MANTEVE a RN-603) isso é o PILOTO AUTOMÁTICO: `git commit` e branch LOCAL
  passam, e a específica `auto_approve` SOB a curinga `auto_approve` — o que
  "Sempre permitir" de dev agent grava — resolve COMO a curinga no repositório,
  então o clique não desliga mais o piloto; não "conserte" isso deixando de
  gravar a específica (ela é o que vale quando o toggle volta a manual). E fora
  do piloto o escopo compara com a pasta REAL de execução (RN-669): com
  container `running` em `container`/`mounted`, `/work` + o `/tmp` do
  container, com o `cwd` de host traduzido como o engine traduz; sem ele, a
  pasta do host, com o `/tmp` do host fora. `runner` fica na raiz do host, de
  propósito (a api não sabe se o runner roteia para o container). Os DEMAIS tetos continuam absolutos MESMO com auto
  mode ligado, e não têm exceção configurável em lugar nenhum — merge em
  branch protegida,
  `instruction_patch`, `parallelize`/`raise_max_parallel` (RN-154), e o
  teto de efeito externo/comando privilegiado — deploy e sudo/doas (git
  push e PR saíram dele PARA O MODO AUTOMÁTICO desde a RN-713/ADR 0204) —
  que revisou a RN-106 (RN-418, ADR 0102): antes era `deny`
  incondicional, agora é `require_approval` incondicional, com a mesma
  garantia de nunca ser auto-aprovável; "sempre permitir" foi fechado na
  fonte pra esse teto não virar decorativo (`ApproveAlwaysActionUseCase`
  recusa gravar padrão pra esses comandos). O teto vale pelas DUAS portas
  desde a RN-689: o COMANDO de terminal e as ações TIPADAS `git_push` e
  `pr_open`. Desde a RN-713 (ADR 0204, decisão do dono de 02/10) a curinga
  em `auto_approve` — e SÓ ela, o modo automático — promove `git_push`/
  `pr_open`, tipados ou pelo terminal; regra específica, "sempre permitir" e
  `permissions.json` não, e a ativação segue semeando só `git_commit` para
  os dev agents (fora do modo automático, push e PR do dev passam pela sua
  aprovação, RN-050). `git_merge` tem o
  teto próprio; `open_adr_pr`/`open_infra_pr` ficam fora por decisão. Desde a RN-661 a aba Executores
  OFERECE a curinga em lote para o time — mesmo endpoint, um PUT por agente,
  só com o clique, e dizendo o que o modo automático não libera; nunca a grave
  sem clique. E desde a RN-675 (ADR 0189, fecha a AT-170) o padrão que "sempre
  permitir" grava em `permissions.json` é VERBO + SUBCOMANDO, um por SEGMENTO
  (`patternsForAction`), nunca o comando inteiro: verbo + flag fica exato e
  unidade que é prefixo de um teto da RN-418 (`git remote`, `gh pr`) também —
  não troque isso por uma lista de verbos (é o espaço dos achados Z/AD).
- O papel de PROJETO sobrepõe o de workspace nos DOIS sentidos —
  `ResolveEffectiveRoleUseCase.forProject` é `projectRole ?? workspaceRole`, e
  NÃO é "o maior dos dois" (RN-471). Restringir alguém num projeto sensível é
  capacidade deliberada; não "corrija" isso. O que a sobreposição não pode
  fazer são DOIS movimentos, e eles são teto (ADR 0127, RN-472): ninguém
  rebaixa quem é `owner` do WORKSPACE, e ninguém rebaixa a SI MESMO — 403 nos
  dois, sem chave de configuração. `owner` aqui é `workspace_members.role`,
  NUNCA `workspaces.created_by`: criador não é dono corrente, e o papel é o que
  a autorização usa em todo o resto do sistema. Os tetos moram no CASO DE USO
  com a regra pura em `domain/iam/tetos-de-rebaixamento.ts`, não no
  `RolesGuard` — o guard autoriza o CHAMADOR contra o `@RequireRole` da rota e
  não vê corpo nem alvo, e estes tetos são sobre o ALVO e sobre a relação
  ator↔alvo. O teto 2 vale por DUAS portas desde o ADR 0156 (RN-556): a
  REMOÇÃO da própria linha também é 403 quando o efeito líquido é rebaixamento
  — remover não apaga um papel, TROCA o efetivo pelo do workspace, que pode ser
  menor (ou não existir). `remocaoEhAutoRebaixamento` DELEGA a
  `ehAutoRebaixamento` passando o papel de workspace como o papel pedido — não
  escreva uma segunda régua. O teto 1 NÃO tem par na remoção, de propósito:
  `owner` é o topo do `ROLE_ORDER`, então tirar a linha de um `owner` de
  workspace só pode ELEVAR o efetivo dele, e é a única forma de desfazer a
  restrição que o teto 1 impede de criar. Desde o ADR 0157 (RN-557) o teto 2
  vale por QUATRO portas e nos DOIS SENTIDOS: `POST workspaces/:id/members`
  deixou de ser upsert sem teto (era passa-adiante sem ator, num escopo onde
  não há nível acima para segurar a queda — e, até o ADR 0173, nem rota que
  removesse membro), e a
  auto-PROMOÇÃO — que o ADR 0127 declarou como capacidade que ficava — é
  BRECHA e fecha, nas duas rotas de associação: é a única metade do movimento
  que ESCALA privilégio. A comparação virou UM classificador
  (`autoMovimentoDoProprioPapel`, devolve o SENTIDO porque a mensagem depende
  dele); `ehAutoRebaixamento` sobreviveu como LEITURA dele, de propósito — é
  por ela que `remocaoEhAutoRebaixamento` segue vendo só a metade de baixo, e
  alargá-la faria a REMOÇÃO recusar o movimento benigno que o ADR 0156
  protegeu. O teto 1 também NÃO tem par no workspace, e foi considerado, não
  espelhado: ele é regra sobre INVERSÃO DE HIERARQUIA, e o
  `@RequireRole('owner')` da rota já a impede — pô-lo faria de `owner` um
  estado absorvente, do qual ninguém sai por HTTP. E o teto NÃO conta owners:
  a cláusula já garante que um workspace nunca chega a zero, porque tirar o
  último exigiria que ele mesmo o fizesse. Desde o ADR 0173 (RN-615) há a
  QUINTA porta, `DELETE workspaces/:id/members/:userId` (`owner`, 204), e ela
  também não tem régua nova: é `remocaoEhAutoRebaixamento` com o papel de
  WORKSPACE como o efetivo de hoje e `null` como o de depois — no workspace
  não há nível acima, então remover a SI MESMO é sempre 403 (frase própria,
  `MENSAGEM_TETO_AUTO_REMOCAO_DO_WORKSPACE`). O ÚLTIMO owner fica protegido
  por essa MESMA cláusula, sem contagem: só `owner` chama a rota e ninguém se
  remove, então toda remoção deixa ao menos o chamador — o mínimo `owner` da
  rota é METADE da prova, e está asserido em teste; não o baixe. Remover OUTRO
  `owner` passa (é como se revoga propriedade), e o teto 1 segue sem par. A
  remoção CASCATEIA numa transação — as linhas de `project_members` do
  removido nos projetos do workspace (sem isso a sobreposição o manteria
  dentro), as chaves de dispositivo de PROJETO e os PATs dele ali — e depois
  derruba o runner vivo dele em cada projeto pelo caminho da RN-520, sem
  derrubar a remoção se o engine falhar. Fica de fora, declarado: chave de
  MÁQUINA, socket de sessão já conectado, terminal `:web`. O TITULAR
  (`workspaces.created_by`, de quem é a credencial que os agentes gastam,
  RN-058, e o relatório de gasto, RN-060) NÃO sai: 409 `criador_do_workspace`
  até `PUT workspaces/:id/owner-of-record` (`owner`, destino JÁ `owner`, senão
  409 `titular_precisa_ser_owner`) passar a titularidade (RN-616). Titular não
  é autorização — quem autoriza continua sendo o papel —, e a transferência
  não confere se o novo titular tem credencial: sem ela, o turno termina com o
  desfecho de sempre ("Nenhuma credencial cadastrada"). Não há tela de membros
  de workspace; as rotas são de API. A LEITURA (`GET workspaces/:id/members`,
  RN-655) é `viewer`, e não o `owner` das escritas: ler não é manter, e é por
  ela que o fio da sessão nomeia quem entra só pelo papel de workspace. Segue possível e declarado:
  rebaixar outro `maintainer`; um `owner` rebaixando OUTRO `owner` no
  workspace (única forma de revogar propriedade, reversível pela mesma rota);
  reescrever o próprio papel com o MESMO valor (upsert idempotente não é
  movimento); a auto-promoção pela REMOÇÃO da linha de projeto; e a
  auto-remoção quando o workspace segura o MESMO papel — essa é benigna e
  continua passando.
- O diagrama C4 (Context + Container) também é ARTEFATO do ARQUITETO
  (`artifact.c4_diagram`, versionado, sem tabela — RN-149, ADR 0068),
  mesmo desenho do `artifact.project_image`. O Container level é DERIVADO
  do `module_map` vigente pelo caso de uso, nunca redigitado pelo modelo
  na ferramenta `create_c4_diagram` — só o Context (nome do sistema e
  atores externos) vem do tool call.
- O CONTRATO entre módulos também é artefato do ARQUITETO
  (`artifact.module_contracts`, versionado, sem tabela, o vigente substitui —
  RN-684, ADR 0200), e é SEPARADO do `module_map` de propósito: não o
  transforme em campo do mapa. Por módulo ele diz só o que o módulo EXPÕE; o
  que ele consome é o `dependsOn` do mapa, derivado na leitura. O dev agent o
  lê por `listar_contratos_de_modulos` (sem parâmetro, `ctx.module`), e o
  kickoff dele diz que a interface de outro módulo NÃO se lê no worktree alheio.
- `decision_record` é o outro polo do mesmo espectro: reusa o padrão
  GENÉRICO de `emit_artifact`/`ArtifactSchemas` (o de `note`/
  `business_rule`) em vez do dedicado de `project_image`/`c4_diagram` —
  uma decisão é log append-only, nunca um "vigente" que se substitui
  (RN-505). Seis dos SETE conversacionais (Criativo, PO, Arquiteto, Dev
  Lead, UX Designer, Staff — o Infra Lead não tem `emit_artifact`) podem
  emitir; distinto de `open_adr_pr` (só o
  Arquiteto, commit real em `docs/adr/*.md` + PR + aprovação humana) —
  os dois COEXISTEM, para escalas diferentes de decisão, nunca um
  substituindo o outro.

## Convenções (agentes, LLM e segredos)
- O contrato externo dos gates é estável: quem consome vê um veredito
  por gate, independente da estrutura interna da área.
- Validação que fala do REPOSITÓRIO não roda em RUNTIME (RN-070). O registro
  de gates é validado em DUAS camadas, e a divisão não é cosmética:
  `validarRegistro` afirma sobre o CONTEÚDO (vale onde quer que o registro
  seja lido, e é a única que `gate-registry.loader.ts` chama) e
  `validarLocalizadores` afirma que o arquivo de prova existe no disco — só
  faz sentido dentro de um checkout, e quem a cobra é o teste do arquivo real
  e a fase 2 do `validacao-gates.ts`. Juntas numa função só custaram `GET
  /gates` respondendo 500 em TODA instalação: a imagem de produção leva
  `/app/docs/gates.yml` e nada de `test/`, `scripts/ci/` ou
  `.github/`, então os onze alvos "não existiam". NÃO devolva a checagem ao
  loader — há teste que reconstrói a árvore da imagem em disco e fica
  vermelho —, e não a troque por `try/catch` devolvendo registro vazio:
  registro inválido por conteúdo continua LANÇANDO. A lição é geral: suíte
  que roda de um checkout não prova nada sobre o que a IMAGEM carrega, e
  quem faz essa pergunta é `docker/smoke.sh`.
- A lista de áreas tem UMA fonte —
  `src/domain/agents/agent-areas.ts`. As cópias do web e do
  engine são GERADAS por `pnpm --filter api gerar:areas` e reprovam em
  teste se estiverem velhas; nunca as edite à mão (FASE 18). O mesmo
  gerador escreve `SOLO_CONVERSATIONAL_AGENTS` (RN-440) SÓ no web, porque
  o engine não a lê — não o estenda para lá sem consumidor. Área nova
  continua sendo decisão de produto, com ADR. A lista é o CATÁLOGO; a
  tabela `agent_areas` é o ESTADO por projeto, e nasce com ele (RN-094).
- Merge em branch protegida (dev/qa/main) é SEMPRE manual do
  usuário — sem opção de automatizar, garantido por teste.
- O produto NUNCA sobrescreve configuração de repositório do usuário
  (proteções, branches) sem plano aprovado explicitamente (regra da
  FASE 12, origem no ADR 0028).
- Todo desfecho de falha de agente registra a ORIGEM da falha
  (infra | modelo | código | política) — nunca diagnóstico por
  eliminação (lição do ADR 0020). Falha NUNCA vira resposta vazia no
  event log, e o motivo NUNCA fica só em broadcast: `agent.error` é
  durável e o agente diz o que houve no fio (RN-059). Falha de UMA
  ferramenta no meio do laço segue a mesma régua (RN-163).
  Toda ferramenta de agente roda por `Engine.Harness.ArgumentosDeFerramenta.executar/4`
  (RN-719): lista/objeto que chega como string JSON é normalizado contra a
  spec (inválido é recusa nomeada), e exceção dentro da ferramenta vira
  `tool.result` `ok: false` com origem `codigo` e ENTRA no laço — servidor novo
  despacha por ele, nunca chamando `run/2` direto.
- A chave de LLM que um agente gasta é a do OWNER do workspace
  (RN-058); o relatório desse gasto é do owner e só dele (RN-060). O
  membro vê o PRÓPRIO consumo por ATOR, em tokens e custo estimado, e
  NUNCA quebrado por provider ou credencial — as duas leituras respondem
  perguntas diferentes e nenhuma é recorte da outra (RN-101/ADR 0063).
- Métrica de execução de agentes é extraída do event log/token_usage
  por script, nunca anotada manualmente (lição da Fase 10/13). A busca do RAG
  segue a mesma régua e acrescenta uma (RN-479..481): quando o instrumento de
  medição não cabe no event log, ele vira TABELA, e a tabela — nunca o evento —
  é a fonte. `session_events.session_id` é `NOT NULL`, e a busca vinda da aba é
  de PROJETO: medir pelo evento perderia justamente as buscas com julgamento
  humano. O evento (`rag.search`/`rag.feedback`, só quando há sessão) é
  NARRAÇÃO da timeline. E o que o instrumento mede vai CONGELADO na linha — os
  pesos da busca, como o preço no metering (ADR 0042) e a `image_version` em
  `project_containers` —, senão a primeira calibração reescreve calada o
  significado de toda medição anterior. Gravar medição NUNCA derruba o que ela
  mede, e também não falha calada: origem `infra` no log e um `null` explícito
  na resposta, que a tela distingue de "não achei nada".
- Testes: vitest (api/web/scripts de CI), ExUnit (engine). Nenhuma
  feature sem teste do caminho feliz + 1 caso de falha. Providers de
  git e de LLM validados por suas suites de contrato únicas. A quarta
  camada é o E2E de navegador em `e2e/` (ADR 0120) e ela responde uma
  pergunta que as outras três NÃO respondem — "um navegador de verdade,
  em outra origem, entra e fica dentro?". Ela não substitui nenhuma:
  comportamento continua sendo coberto embaixo, e teste que caberia na
  suite do web não sobe para cá.
- Capability só é declarada quando provada pela suite; sem prova,
  declara-se false e degrada (regra dos ADRs 0041/0042, vale para git
  e LLM).
- Segredos de usuário (API keys de LLM e tokens de git) criptografados
  com envelope encryption; nunca em plaintext no banco ou em logs. Desde a
  RN-563 (ADR 0158) o envelope carrega `key_id` — a IMPRESSÃO DIGITAL
  (`HMAC-SHA256(chave derivada, rótulo)`, 8 bytes) da chave mestra que o
  embrulhou, nas DUAS tabelas que guardam envelope (`user_credentials` e
  `project_git_connections`, que mudam sempre JUNTAS). Ele existe para
  responder em SQL *"quantas credenciais ainda estão na chave anterior?"* — o
  passo 2 do runbook — e para dar diagnóstico DIFERENTE a "veio de outro
  ambiente", "rótulo incoerente" e "linha sem rótulo". **Ele nunca decide se
  o envelope abre**: `decrypt` continua tentando a atual e caindo para a
  anterior, e `rewrap` continua decidindo "já está na chave atual" pela
  TENTATIVA — quem autentica é o GCM. Não "otimize" isso pulando a tentativa
  quando o rótulo bate: uma linha rotulada "atual" cujo envelope está na chave
  velha seria pulada em silêncio, ficaria fora da contagem, e o passo 3 (que
  descarta a chave velha) a tornaria ilegível para sempre — há teste fixando
  a linha mentirosa sendo re-embrulhada assim mesmo. `key_id` NULO é a linha
  gravada antes da coluna existir, e a consulta usa `IS DISTINCT FROM` e nunca
  `<>` justamente para contá-la como PENDENTE. Não há migração do acervo: o
  rótulo nasce na próxima escrita. E a impressão da chave corrente sai no log
  do boot da api, porque coluna que não se compara contra nada é inútil.
  A rotação inteira tem verificação NOMEADA desde a RN-562
  (`test/scripts/rewrap-deks.spec.ts`, contra Postgres de verdade e
  contra as duas tabelas) — e é por ela que `rewrap-deks.ts` tem o núcleo
  exportado (`reenvelopar`) com o `main()` sob `require.main === module`:
  importar o script não pode rodar a rotação. A rotação NUNCA rodou em
  ambiente real (mantenedor, 2026-09-27); desde a AT-146 ela tem um ENSAIO no
  cluster, semanal e último alvo do `propriedades.yml`
  (`make test-rotacao-chave-mestra-k8s`): os três passos do runbook pela fonte
  do `ExternalSecret`, com restart da api e o `rewrap-deks.js` da imagem —
  ensaio, não rotação de ambiente real.
- Decisões arquiteturais relevantes registradas em docs/adr/.

## Documentação é parte da definição de pronto (permanente)
- A doc deste repo mora em `docs/` (só em inglês; só o `brabo` é multilíngue). Ao alterar código, atualize a doc da área NA MESMA mudança e mostre o diff dela junto com o do código. Não pergunte se deve: faça. NUNCA crie `website/docs/`: o site é agregado pelo `brabo`, que lê a `docs/` de cada repositório.
- `docs/.docmap.yml` liga cada doc ao código: consulte-o ao alterar código e atualize os docs mapeados. Arquivos `generated: true` são gerados, nunca editados à mão.
- Mudança de comportamento observável → entrada em `CHANGELOG.md` (Unreleased). Versão própria a partir da 1.0.0, e toda tag nasce de workflow (nunca versionar à mão).
- Regra de negócio nova → RN-XXX com `caminho:N` (`símbolo`) e o teste que a cobre, na `docs/business-rules*` deste repo; a numeração é UMA só no produto (nunca reinicie), a âncora `{#rn-NNN}` é o contrato e não muda quando a RN muda de arquivo. Aloque o número varrendo as branches locais e o remoto (colide com frente paralela).
- Mudança estrutural (fronteira de camada, banco, modelo de consistência, dependência pesada) → ADR novo com o próximo número; ADR aceito NUNCA é editado (o novo o referencia). Os ADRs moram no repo `brabo` (a porta de entrada do produto).
- Nunca inventar conteúdo de doc: sem informação suficiente, use `> **TODO(humano):** <pergunta específica>.`. Diagramas em Mermaid no próprio Markdown, nunca imagem.
- Este arquivo também é doc: toda mudança verifica se ele precisa mudar (Stack, convenções, "O que NÃO fazer"). Ele é lido em toda sessão e não passa de 40 mil caracteres (`wc -m`, nunca `wc -c`); o que só vale para uma área sai daqui para `.claude/rules/` com `paths:`.

## Estado, decisões abertas e lacunas que são DESTE repo
- Z/AD: allowlist de verbos não converge (verbo/forma/invocação são espaços
  distintos) — `docs/explanation/achados-execucao-real.md`
- AE: agente de QA tenta consertar o código que julga; contido por duas
  barreiras independentes
- **O piloto automático confia na contenção do container, e ela tem bordas
  que a prova NÃO cobre (ADR 0189).** Provado em
  `brabo-broker:src/contencao-do-brabo.spec.ts`: uma pasta só, em `/work`,
  estritamente abaixo da raiz do broker, sem socket nem privilégio. Declarado e
  NÃO remendado (a decisão foi descrever): no compose de PRODUÇÃO nada no host
  confere que `BRABO_PROJECTS_BASE` não contém o checkout/a pasta do `.env`
  (o preflight só roda no `pnpm dev`, e a api compara com o próprio `cwd`); o
  `install.sh` confere a base só no consentimento, sem teste; no modo `runner`
  nada compara a pasta com um checkout do Brabo na máquina do usuário;
  `segmentoDeProjetoValidado` aceita `.` (a api nunca o produz); e a rede
  `egress` alcança as portas publicadas da máquina. Fechar qualquer uma é
  decisão do dono, não correção de passagem
- O limiar da duplicata semântica (0,80, RN-681) é PONTO DE PARTIDA NÃO
  calibrado: os vetores reais dos pares de calibração não puderam ser gravados
  (registry do Ollama e Hugging Face bloqueados no ambiente). Gravar é
  `scripts/gravar-vetores-de-duplicata.ts` com o Ollama de pé; a prova
  (`limiar-de-duplicata.calibracao.spec.ts`) PULA até lá. Não mexa no número
  sem gravar, e se a gravação não separar os pares, reveja os pares ou o texto
  comparado — nunca afrouxe o teste
- Pull de modelo Hugging Face roda o download inteiro de forma SÍNCRONA
  dentro do request HTTP — a api não tem fila própria; corte declarado,
  candidato a ADR quando o volume de pulls justificar (ADR 0115)
- A chamada ao broker tem teto POR OPERAÇÃO desde a RN-604 (`tetoDaOperacao`,
  `container-broker.client.ts`), e a cadeia do `exec` é broker < api <
  engine — mexer no teto de um salto sem o de cima reabre o defeito, e os
  testes dos dois lados conferem a ordem. Desde a RN-757 (AT-440) a cadeia
  tem um QUARTO salto, o de fora: a ação `terminal` auto-aprovada é executada
  dentro do `propose_action`, e o engine a espera por
  `TERMINAL_ACTION_TIMEOUT_MS` (agora 120s, era 15s) + 120s — broker (T) <
  api (T + 45s) < `container-exec` (T + 90s) < `propose_action` (T + 120s),
  abaixo dos 300s do `fetch`; o estouro chega ao modelo nomeando o teto, e
  esse teto passar de ~180s reabre o corte. O estouro do `exec` é decidido pelo RELÓGIO, não
  pelo `killed` — o cliente `docker exec` sai 0 ao receber o SIGTERM —, e o
  grupo do comando é morto DENTRO do container pelo PID que o embrulho grava
  (RN-807); não volte a confiar só em `killed`. Segue aberto, por DECISÃO do
  mantenedor (AT-234, opção D, RN-605): imagem grande não sobe na primeira
  tentativa. O pull é passo explícito do `start` (`image inspect` → `pull`)
  sob o MESMO `TIMEOUT_DE_CONTROLE_MS` de 30s, e o estouro é
  `PullExcedeuTetoError` (504, origem `infra`) — antes saía "código -1" com
  `origem: null`. Matar o CLI CANCELA o pull (medido): a imagem NÃO segue
  baixando por trás. Não suba o teto de passagem: as outras três saídas
  (teto próprio, `start` assíncrono, pull antecipado) foram medidas e
  recusadas. Os tetos de quem espera o `start` contam as SEIS chamadas de
  controle (`CHAMADAS_DE_CONTROLE_NO_START`): 195s na api, 185s no
  `RunnerRouter`, 225s no `propose_action` do engine para as ações de
  container que a api executa auto-aprovadas. E `timeoutMs` acima de ~255s
  esbarra nos 300s de cabeçalhos do `fetch` do Node

## O que NÃO fazer
- Não usar Redis (filas ficam no Postgres via Oban, no engine).
- Login social foi IMPLEMENTADO (ADR 0084); continuam fora MFA, OIDC provider e federação genérica (backlog do ADR 0031).
- Não instalar libs sem justificar no plano. Não refatorar código de fase concluída sem pedido explícito.
- Não ativar modelo descoberto automaticamente: curadoria manual sempre (ADR 0042).
- Não corrigir de passagem os achados ABERTOS em `docs/explanation/achados-execucao-real.md` (Z/AD e AE são decisão de produto, não bug).
- Gate novo é decisão de produto, com ADR. Área nova de agente também.

## Onde está o que não coube aqui
O teto de 40 mil caracteres tirou deste arquivo blocos que viraram regras de CAMINHO em `.claude/rules/` (texto integral da fonte `brabo-legacy`, `dev` @ `1586158973`), carregadas quando a sessão lê os arquivos do `paths:`:
- `execucao-e-imagem-do-projeto.md` — onde o código do projeto mora (`container`/`mounted`/`runner`) e a imagem de container como artefato.
- `llm-cascata-e-rag.md` — LLMProvider/embed, cascata de modelo, capabilities de LLM e calibração do RAG.
- `anamnese-e-psicologo.md` — Anamnese religada e Psicólogo pausado.
