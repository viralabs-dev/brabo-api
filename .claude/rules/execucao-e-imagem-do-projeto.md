---
paths:
  - "src/domain/execution/**"
  - "src/domain/containers/**"
  - "src/domain/artifacts/**"
  - "src/infrastructure/http-clients/**"
---

> Regra de CAMINHO: carregada só quando a sessão lê arquivo que casa com `paths:`. Saiu do `CLAUDE.md` por causa do teto de 40 mil caracteres; texto INTEGRAL de `.claude/contexto/convencoes-repositorio-e-dominio.md` (`brabo-legacy`, `dev` @ `1586158973`). Edite AQUI.

- O projeto escolhe ONDE o código mora, na criação (RN-169/RN-421/RN-422,
  ADR 0072/0104) — e pode CONVERTER depois, sem recriar o projeto, por
  `PUT projects/:projectId/execution-mode` (`maintainer`, RN-447..450, ADR
  0111): `container` (DEFAULT — a pasta gerenciada em
  `PROJECT_WORKSPACES_ROOT`, o comportamento de sempre), `mounted` (o antigo
  `local`, renomeado — uma pasta do USUÁRIO montada por bind-mount, caminho
  absoluto livre em `projects.workspace_path`) ou `runner` (uma pasta do
  USUÁRIO SEM bind-mount, confirmada por um CLI — `brabo-runner` — rodando na
  máquina dela, RN-423). Desde o ADR 0141 (RN-500), o bind-mount de `mounted`
  deixa de ser uma linha de compose POR PROJETO e passa a ser UMA base da
  INSTALAÇÃO — `BRABO_PROJECTS_BASE`, montada por IDENTIDADE (`$X:$X`) em `api`
  e `engine`, com todos os projetos montados morando dentro dela. Identidade e
  não mountpoint fixo porque `workspace_path` é digitado pelo usuário e mostrado
  de volta a ele, e é isso que faz `projectScopeRoot` e
  `Engine.Actions.Workspace.workspace_dir/2` continuarem certos sem código novo.
  Variável PRÓPRIA, NUNCA `PROJECT_WORKSPACES_HOST_DIR`: a raiz gerenciada é
  nomeada por `workspace_dir_name` (UNIQUE) e a base é nomeada pelo usuário, e
  apontar as duas para o mesmo lugar faria `init_from_bare!` dar `git init` na
  pasta de outro projeto. `baseDeProjetos()` NUNCA lança e AUSENTE é estado
  normal — `GET workspaces/:workspaceId/projects-base` (`maintainer`) devolve
  `projectsBase: null`, e é assim que a criação aprende a NÃO oferecer o modo —
  o que desde a RN-513 (ADR 0146 ponto 4) é VERDADE no cliente, e não mais
  intenção sem chamador: o assistente consulta a rota ao MONTAR (não no quinto
  passo), só oferece `mounted` com a base CONHECIDA e presente — carregando ou
  consulta FALHADA não viram oferta, "não sei" nunca vira "tem" —, e com base
  ele PRÉ-SELECIONA o modo sugerindo `<base>/<slug>`, sem jamais sobrescrever
  escolha humana nem caminho digitado. Desde a RN-573 (ADR 0161) a
  pré-seleção exige TAMBÉM o broker CONFIRMADO (`brokerConfigurado`, na MESMA
  rota): base não é broker, e `container`/`mounted` só sobem container por ele
  (ADR 0144). Ausência CONFIRMADA deixa os dois cards NA TELA mas inertes, com
  o motivo UMA vez em texto, e pré-seleciona `runner`; broker DESCONHECIDO não
  pré-seleciona `mounted` e também não trava nada nem afirma ausência — são
  três estados, não dois.
  A base NÃO entra em `caminhoDeWorkspaceLocalValido` (que roda em toda LEITURA
  e faria projeto montado legado explodir ao ser lido): é regra de criação e
  conversão. E `pnpm dev` RECUSA subir com a base sobreposta ao checkout do
  Brabo, nos dois sentidos — checagem que só o preflight pode fazer, porque a
  api compara contra `process.cwd()` (`/workspace` dentro do container dela) e
  nunca enxerga o checkout real. O par (modo, caminho) é amarrado por CHECK no banco
  (`execution_mode <> 'container'`), e `projectScopeRoot` continua sendo a
  derivação ÚNICA da raiz — não duplique validação nos chamadores. Desde a
  RN-501 (ADR 0142), `mounted` e `runner` validam na criação a MESMA coisa: só
  o LÉXICO, sem I/O (absoluto, sem `..`, nunca raiz/pasta de sistema nem
  sobreposto ao checkout do Brabo — RN-422/RN-423/histórico RN-170), com
  `mounted` acrescentando estar dentro de `BRABO_PROJECTS_BASE`. Os DOIS
  nascem `workspaceVerifiedAt: null`, e a diferença entre eles é QUANDO/QUEM
  confirma o disco: no `runner` é o CLI conectando (sobrescrevendo o que foi
  digitado); no `mounted` é `materializarWorkspaceMontado` — `mkdir -p` mais
  as três perguntas de disco —, chamada por `ExecuteContainerStartUseCase`
  quando a Infra sobe o container (o requisito "após a decisão do Arquiteto"
  cumprido literalmente; falha vira `failed` NOMEADO e o ciclo de vida NÃO
  chega a `provisioning`) e, como EXCEÇÃO declarada, pela conversão de modo,
  que não tem passo de container onde pendurar o trabalho e move o
  `permissions.json` para dentro da pasta. Adiar a VERIFICAÇÃO não toca o
  invariante de PAREAMENTO: `mounted` segue gravando `workspace_path`
  não-nulo e o CHECK fica intacto, sem migration. O portão da imagem
  (RN-105) VALE para os TRÊS modos desde a RN-494/ADR 0135 — projeto
  `mounted`/`runner` sem `artifact.project_image` decidido também responde
  409 na aba Code; a dispensa antiga foi REVOGADA, não é mais o
  comportamento. Desde o ADR 0144 (RN-503), `mounted` SOBE container no
  SERVIDOR, pelo BROKER — a base única do ADR 0141 tornou a pasta alcançável
  pelo daemon, e a recusa antiga era sobre GEOMETRIA, não sobre o nome do
  modo. A ramificação de `container_start`/`_stop`/`_remove` passa a ser por
  DESTINO: `container` e `mounted` → broker, `runner` → runner (as três mudam
  JUNTAS; subir no servidor e parar na máquina do usuário deixaria de pé, sem
  forma de parar, o que está de pé). `runner` continua sem container PRÓPRIO
  no SERVIDOR — quem sobe container pra ele é o `brabo-runner`, na máquina do
  USUÁRIO, com o Docker dela (ADR 0137, RN-497). Consequência declarada no
  ADR: a contenção estrutural do `join` some para esses projetos, e o vetor
  de symlink do ADR 0055 continua aberto. No LINUX, o próprio CLI
  `brabo-runner` recusa `--dir` fora do
  `$HOME` do usuário (RN-434, ADR 0104) — checagem de startup do processo
  local, não a fronteira de segurança (essa continua sendo autenticação +
  pipeline de aprovação, ver `apps/runner/src/guard.ts`); fora do Linux a
  restrição não se aplica.
  Desde a RN-515 (ADR 0147 ponto 4), `mounted` e `runner` podem ainda declarar
  um DESTINO DE ESPELHO — `projects.mirror_path`/`mirrorPath`, por
  `PUT projects/:projectId/mirror-path` (`maintainer`) —, a pasta da máquina do
  usuário FORA da base para onde o agente local copia o trabalho. É por
  PROJETO e nunca global (destino global aterrissaria o artefato do projeto B
  na pasta do A, descoberto pelo conteúdo e não por um erro), `null` é o estado
  NORMAL, e limpar é `null` EXPLÍCITO — a chave é obrigatória, senão omitir o
  campo limparia em silêncio. `container` é RECUSADO com motivo (a origem é um
  volume do SERVIDOR e quem copiaria está na máquina do usuário), e converter o
  modo ZERA o destino. A api valida SÓ o LÉXICO e DIZ isso, reusando
  `caminhoDeWorkspaceLocalValido` — NÃO escreva uma quarta cópia da régua —
  mais os DOIS sentidos do laço origem↔destino, por SEGMENTO e nunca
  `startsWith`. A metade `realpath` da guarda é do RUNNER
  (`apps/runner/src/espelho-guard.ts`, RN-516): a api impediu o laço ESCRITO,
  nunca o construído por symlink, e o comentário no código diz isso.
  A escrita do espelho NÃO é `proposed_action` — é configuração declarada pelo
  usuário, não agente pedindo para agir.
  Desde a RN-516 (ADR 0147 pontos 2/3/4/8) o espelho EXISTE, e três coisas
  dele são regra: o destino viaja SÓ na concessão do `join` e o runner recusa
  `mirror_sync` para destino não concedido NAQUELA conexão (trocar o destino
  com runner de pé exige reconectá-lo, e destino declarado passa a EXIGIR a
  capacidade `espelho`, recusando binário velho no join); a cópia é numa
  direção e NUNCA apaga — arquivo apagado na origem PERMANECE no destino, que
  é acúmulo e não réplica —, e o que se copia é a LISTA DO GIT (rastreados +
  não-rastreados-não-ignorados), com git que falha virando erro NOMEADO e
  nunca um `cp -r` de plano B; e o gatilho é MOMENTO NOMEADO do engine (hoje
  o commit), NUNCA um watcher, que seria trabalho ilimitado disparado até
  pelas escritas do próprio espelho. O predicado do espelho é PRÓPRIO
  (`Engine.Runners.Espelho`, DUAS pré-condições) — `RunnerReadiness` fica
  byte a byte como está e NUNCA ganha flag "pula container": é por essa flag
  que a terceira pré-condição do ADR 0145 cairia por acidente para o `exec`.

- A imagem de container de um projeto é ARTEFATO — `artifact.project_image`,
  versionado, sem tabela, nunca configuração escondida —, e desde o ADR 0133
  (RN-491) tem DOIS emissores possíveis, distinguidos por `decidedBy`: o
  ARQUITETO decidindo do zero (`choose_project_image`, `'arquiteto'`) e a
  INFRA elegendo entre as candidatas do próprio roteamento do Arquiteto
  (`container_start`, `'infra-lead'`) — nunca um caminho paralelo, os dois
  passam por `DecidirImagemDoProjetoUseCase`/`validarDecisaoDeImagem`.
  Os RECURSOS que a Infra sobe vêm do `module_map` desde a RN-683 (ADR 0199):
  cada módulo declara `resources` e o mínimo é a SOMA (um container por
  projeto), com piso no padrão de hoje enquanto houver módulo sem declaração —
  nunca um número inventado, nunca o máximo entre módulos. Quem deriva é a
  api (`recursos-minimos.ts`); o engine manda `resources` vazio e não soma.
  Enquanto NENHUM dos dois decide, a aba Code responde 409 (RN-105) — nos
  TRÊS modos de execução desde a RN-494/ADR 0135, que revogou a dispensa
  que `mounted`/`runner` tinham (RN-169/RN-421). `mounted`/`runner`
  continuam sem subir container PRÓPRIO no SERVIDOR — quem sobe pra eles é
  o `brabo-runner`, na máquina do usuário (ADR 0137, RN-497). O que mudou
  aqui foi só a exigência de alguém ter decidido a imagem antes de abrir a
  leitura.
  Deploy e `sudo`/`doas` NÃO saem pelo terminal sem aprovação — a regra é
  `require_approval` INCONDICIONAL (teto absoluto, revisado de `deny` pela
  RN-418/ADR 0102: nunca auto-aprovável, mesmo dentro do escopo do projeto,
  mesmo com auto mode ligado, mesmo com "sempre permitir", que foi fechado na
  fonte). `git push` e abertura de PR seguem a mesma régua, EXCETO com o modo
  automático do agente ligado (a curinga em `auto_approve`), que os
  auto-aprova pelas duas portas — o terminal e as ações TIPADAS
  `git_push`/`pr_open` (RN-713, ADR 0204, revisando a RN-689); "sempre
  permitir" continua fechado na fonte para eles, e merge em branch protegida
  segue sempre manual. O ciclo de vida do container tem
  TABELA de estado desde a Onda 4/frente F1 do PROGRAMA 28
  (`project_containers`, ADR 0081, RN-243..248) — e quem ESCREVE nela, desde o
  ADR 0130/0133, PODE chamar Docker de verdade: `container_start`
  (`proposed_action`, `maintainer`, RN-491) é o primeiro chamador real de
  `ContainerBrokerPort.start`, e transiciona `provisioning → running` pela
  máquina de estados. Desde o ADR 0136 (RN-495), `container_stop`
  (mesmo calibre de `container_start`) e `container_remove` (o mais
  destrutivo — no MESMO teto absoluto de git push/comando privilegiado,
  nunca auto-aprovável) também são `proposed_action`, propostas pela
  página global de containers (`/containers`) — sempre um humano, nunca um
  agente. Desde a RN-521 essa página também SOBE container, e é o único
  caminho humano para isso: ela lista TODO projeto do workspace (`registrado:
  null` é o TERCEIRO estado, "nunca provisionado", e nunca gasta verificação
  do broker) e ramifica por `execution_mode` — `container`/`mounted` propõem
  `container_start`, `runner` propõe `container_start_via_runner`, cada um com
  o payload que o schema dele aceita. Ela RECUSA localmente (botão inerte, com
  o motivo em TEXTO) em `container`/`mounted` numa instalação SEM broker
  (`sem_broker_na_instalacao`, RN-574 — antes da imagem, e `!== true`: "não
  sei" não vira "tem"), sem imagem decidida, em `runner` sem pasta jamais
  confirmada, e para papel abaixo de `maintainer` — o mínimo do ENDPOINT, por
  `roleAtLeast`. Desde a RN-566 o AGENTE também ramifica por modo antes de
  propor: as duas tools do Infra Lead passam por `recusa_local_de_subida/2`
  (`infra_lead_server.ex`), que lê o projeto UMA vez e recusa com motivo
  NOMEADO — a MESMA ramificação por DESTINO, nunca uma segunda régua. Desde
  a RN-610 ele recusa também container já de pé (as duas tools) e, em
  `runner`, imagem não decidida e pasta nunca confirmada; o que ele NÃO
  checa, e a tela checa, é imagem decidida em `container`/`mounted` (eleger
  é o que a proposta faz) e broker/papel/sessão.
  A política de terminal do ADR 0055 (escopo de caminho, allowlist
  estreito) segue valendo como está — mas ela não decide mais ONDE o comando
  roda quando NÃO há container: desde o ADR 0143 (RN-502), `container` e
  `mounted` SEM um `running` registrado RECUSAM (`:recusar_container_ausente`,
  `failed_result` nomeado), em vez de cair no `System.cmd` dentro do processo
  do engine. Desde a RN-507 (ADR 0145), `runner` entrou na MESMA régua —
  workspace verificado e runner conectado deixaram de bastar; sem container
  `running` REGISTRADO (a mesma leitura de `ProjectContainerLifecycle`,
  centralizada em `Engine.Runners.RunnerReadiness`), o comando recusa em vez
  de atravessar pro canal e arriscar cair no HOST puro do usuário — o
  fallback silencioso que essa RN fecha. O catch-all `:caminho_de_sempre` do
  `TerminalExecutor` encolheu para projeto inexistente/id malformado —
  nenhum modo de execução cai nele. Com um `running` registrado, o comando
  de terminal
  passa a rodar DENTRO do container de verdade (`ContainerBrokerPort.exec`,
  ADR 0134, RN-492) e ganha um PISO de auto-aprovação por cima do escopo
  léxico — não no lugar dele (RN-493). Esse PISO é ESPECÍFICO de
  `execution_mode: container` (`ProposeActionUseCase` só o calcula quando
  `project.executionMode === 'container'`): projeto `mounted`/`runner` com
  um container REAL de pé pelo `brabo-runner` (ADR 0137, RN-497) continua
  sob a política de terminal de sempre, sem piso — a decisão host-vs-container
  ali é INTERNA ao runner, o engine não sabe dela, e `decide()` nunca viu
  motivo pra tratar os dois casos como o mesmo. O que a
  leitura ganhou primeiro (ADR 0130) foi o estado OBSERVADO ao lado do
  registrado, perguntado ao broker — os dois nunca se fundem, e "não
  consegui olhar" tem motivo próprio em vez de herdar o registrado (RN-486).
