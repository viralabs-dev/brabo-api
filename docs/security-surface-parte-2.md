# Superfície exposta da api (parte 2)

Continuação de [`security-surface.md`](security-surface.md): o restante das notas e a **tabela de rotas**. As classificações e as rotas públicas estão na parte 1. `test/interfaces/route-surface.spec.ts` lê as duas partes como uma fonte só.

## Notas (continuação) {#notes-2}

- **Revogar uma chave de dispositivo agora alcança a conexão VIVA, e o alvo
  é `{project, user}` — nunca `{key}`**
  ([RN-520](business-rules/api.md#rn-520), [ADR 0147](adr/0147-agente-local-com-capacidades.md)
  ponto 6). O `DELETE` só barrava o PRÓXIMO ticket: um `brabo-runner` já
  conectado mantinha vivo o canal `terminal:<projectId>`, rodando comandos
  aprovados com a chave revogada, até cair sozinho. A api agora pede ao
  engine (`POST /internal/projects/:projectId/runner/disconnect`) que o
  derrube, e o engine alcança o pid do canal — a api nunca fala com o canal, e
  o engine nunca lê a tabela de chaves.
  A precisão que NÃO existe é por credencial, e isso é propriedade do caminho
  do ticket, não preferência: `runner_socket_tickets` guarda
  `project_id`/`user_id`/`kind` e nada mais, então qual PAT ou qual `kid` abriu
  aquele socket morre no `PatAuthGuard` e nunca chega ao engine. **Custo
  declarado:** um runner do MESMO usuário conectado com um PAT, ou com outra
  chave do mesmo projeto, também cai — e reconecta sozinho, porque a rodada
  seguinte pede ticket novo e uma credencial que continua válida o obtém. Um
  runner de outro usuário no mesmo projeto fica de pé. Derrubar a conexão é
  EFEITO COLATERAL: engine fora do ar, nenhum runner conectado ou um timeout
  nunca podem fazer o `DELETE` (204, idempotente) falhar ou virar 5xx — a
  mesma régua de `rag_searches` ([RN-479](business-rules/api.md#rn-479)) e
  `mirror_sync_result` ([RN-517](business-rules/api.md#rn-517)).
  **Revisado pela [RN-685](business-rules/api.md#rn-685)
  ([ADR 0201](adr/0201-revogacao-por-chave.md)): o alvo agora é a CHAVE.**
  O ticket registra qual credencial o pediu (o `kid`, ou o id do PAT), e a
  revogação pede ao engine
  (`POST /internal/runner/disconnect-credential`) que anule os tickets
  pendentes da credencial e derrube só os runners nascidos dela — o custo
  declarado acima sumiu: um runner do mesmo usuário com PAT ou outra chave
  fica de pé. A revogação de PAT (própria, ou como `maintainer`) agora derruba
  as conexões dele também. Uma conexão aberta com ticket anterior ao deploy
  (sem credencial) continua caindo pelo par, e um engine que não conhece a
  rota faz a api voltar a `runner/disconnect`; a rota do par também fica como
  alvo da remoção de membro.
  A visão de `maintainer` que o PAT tem (RN-427, listar/revogar de QUALQUER
  usuário) fica DE FORA para chaves de dispositivo — agora por decisão, não
  omissão: aquele par nasceu de resposta a incidente com um segredo
  COMPARTILHADO circulando, e a metade privada de uma chave de dispositivo
  nunca sai da máquina que a fez. Essa frase dizia "o navegador que a fez", e
  a [RN-551](business-rules/runner.md#rn-551) alargou o fabricante sem enfraquecer a
  afirmação: o terminal é agora um segundo gerador, e a metade privada continua
  nunca viajando — o que sai é a JWK pública. O que MUDOU é onde ela repousa:
  uma chave feita no navegador pousa numa pasta de projeto que o usuário
  escolheu, uma feita pelo CLI pousa em `$XDG_CONFIG_HOME/brabo/` com modo 600.
  Nenhuma das duas é alcançável pela api, e é disso que a decisão acima
  depende.
- **As rotas `engine-service` não são "internas" por convenção de nome.**
  O que as protege é o `EngineServiceGuard` comparando
  `X-Brabo-Service-Token` com o segredo compartilhado em tempo constante, mais
  a NetworkPolicy. O prefixo `/internal` é sinalização para humanos. Elas
  ficam **fora do JWT** via `@ServiceRoute()`: o token de usuário não funciona
  aqui e o service token não funciona em nenhuma outra rota — os dois
  mecanismos nunca se sobrepõem ([RN-035](business-rules/api.md#rn-035)).
- **`POST /internal/first-account` é um segundo caminho que cria USUÁRIO, e
  funciona em produção** ([RN-546](business-rules/produto.md#rn-546),
  [ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md)). Declarado aqui
  em vez de deixado para ser descoberto. O registro normal é o primeiro
  caminho e não foi tocado; este existe porque uma instalação nova de uma
  linha não deixa ninguém entrar — o `.env` gerado não tem variável de e-mail,
  `MAIL_TRANSPORT` cai em `log`, e o registro espera um e-mail que ninguém
  envia.

  Ele é estreito por construção, por três motivos independentes. **É
  `engine-service`**, então o que o abre é o `BRABO_SERVICE_TOKEN` — que o
  próprio `install.sh` gerou e gravou com modo `600`, tornando-o prova de
  controle sobre a MÁQUINA, não sobre uma caixa de e-mail. **Recusa com `409`
  quando a instalação tem QUALQUER usuário**, condição sobre a instalação e não
  sobre o e-mail pedido, então não pode ser chamado repetidamente com endereços
  diferentes, e fica calado para sempre assim que alguém existe (inclusive
  depois de uma restauração de migração, [RN-530](business-rules/infra.md#rn-530)).
  **E nenhuma rota pública nasceu**: um "criar o primeiro owner" público é uma
  corrida entre quem instalou e quem varreu a porta, e `owner` do primeiro
  workspace não é papel que alguém recupere por HTTP.

  A conta nasce com o e-mail já verificado, e essa é a única coisa que esta
  rota relaxa — para um caso nomeado, nunca para o outro caminho. O que a
  verificação prova é *"esta pessoa controla esta caixa de e-mail"*; quem roda
  o instalador já provou a máquina, o `.env` e o daemon do Docker. A senha é
  digitada no TTY, lida sem eco, passada por hash com argon2id e descartada:
  nunca no `.env`, nunca no marcador, nunca num log, e nunca gerada por
  código nenhum.

  Uma janela é declarada em vez de fechada: a checagem "existe algum
  usuário?" roda dentro da transação, mas `READ COMMITTED` não impede que duas
  chamadas concorrentes com e-mails diferentes passem as duas. Fechá-la
  exigiria um advisory lock sobre a ausência de linhas, e não é ali que mora a
  contenção — quem alcança esta rota já detém o service token, ou seja, já
  controla a instalação.
- **`POST /internal/machine-device-keys` CUNHA UMA CREDENCIAL DURÁVEL DE
  USUÁRIO a partir de um segredo de máquina** ([RN-552](business-rules/api.md#rn-552),
  [ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md) ponto 4). Esta é
  a borda mais afiada que o service token tem, e é declarada aqui pelo mesmo
  motivo que a irmã acima: o próximo passo do instalador depois de criar a
  primeira conta é parear o agente local, e parear exige uma credencial — a
  única que existia era amarrada a um PROJETO, numa instalação que ainda não
  tem nenhum.

  **O que custa, dito com todas as letras:** um `BRABO_SERVICE_TOKEN` vazado
  agora pode FABRICAR uma chave de dispositivo que age como usuário contra
  rotas com checagem de papel (`POST .../runner-ticket`, e por ela o canal do
  runner), em vez de só falar com as rotas internas. A credencial alternativa
  — a do próprio usuário recém-criado — foi considerada e recusada porque
  contradiz o próprio [ADR 0155](adr/0155-a-primeira-conta-nasce-no-terminal.md):
  a senha é lida no TTY, *usada e descartada*, e o ponto 5 afirma que o
  instalador *"não faz login por ninguém"*, e é por isso que a resposta da
  primeira conta deliberadamente não leva token de sessão. Exigi-la aqui
  forçaria o instalador a criar, na máquina, exatamente a sessão viva que
  aquele ADR recusou criar.

  Três contenções moram na ROTA, não neste parágrafo. **Não há `userId` no
  corpo**: o dono é o ÚNICO usuário da instalação, resolvido pela api, então o
  token nunca compra a escolha de qual credencial cunhar — com zero usuários ou
  mais de um ela recusa com `409` e não grava nada, o mesmo formato de condição
  da primeira conta (sobre a instalação, nunca sobre o argumento), e fica calada
  de vez assim que a instalação tem um time. **Registrar SUBSTITUI**: as chaves
  de máquina ativas do dono são revogadas na mesma transação, então uma máquina
  reinstalada é caso legítimo e mil chaves de máquina são impossíveis — teto
  por cláusula, não por um número que envelhece. **Uma JWK privada é recusada
  pelo nome**: `d` presente responde `400` dizendo o que chegou, pela mesma
  regra de domínio que o registro do navegador usa, porque guardar uma metade
  privada é o pior desfecho que esta rota tem.

  O que a chave concede não é alargado: ela dá ao agente local exatamente os
  projetos que o dono já alcança como `developer`, resolvidos contra o projeto
  pedido ([RN-543](business-rules/produto.md#rn-543)). Duas lacunas são declaradas em
  vez de escondidas: não há `GET` nem `DELETE` aqui (listar publicaria o
  inventário de credenciais de uma pessoa a quem detém só o segredo da máquina;
  revogar já existe onde tem um dono humano), e numa instalação que ainda não
  tem projeto nenhuma tela alcança uma chave de máquina —
  que é exatamente por que registrar substitui em vez de deixar órfãs para trás.
- **`/docs` e `/docs-json` NÃO estão na tabela, e essa é uma lacuna
  conhecida.** A Swagger UI é montada por `SwaggerModule.setup()` no nível do
  Express, não como controller, e o teste enumera via `DiscoveryService` — ele
  estruturalmente não as vê. As duas só existem com
  `NODE_ENV !== 'production'` (`main.ts`), são públicas, e servem o mesmo
  documento que a
  [referência gerada](reference/api.html) publica. Registrado aqui em vez de
  deixado de fora: o que o teste não alcança precisa estar na prosa.
- **`GET`/`POST /auth/dev-login` (acesso rápido por papel, AT-722) NÃO estão
  na tabela, de propósito.** O módulo só é registrado com
  `BRABO_AMBIENTE=local` e a imagem sem marca ou marcada `local`
  (`infrastructure/security/ambiente.ts`); o `route-surface.spec.ts` sobe o
  `AppModule` sem a variável, então a rota não existe para ele e fora de `local`
  responde 404. Quando existe é pública como o `/auth/login` (sem CSRF, sem
  rate limit) e emite a sessão de uma conta `<papel>@brabo.dev` do
  `ROLE_ORDER`, nunca de e-mail livre; sem usuário na instalação responde 409.
  Registrado aqui porque o teste não a vê (ADR 0245, RN-984).
- **`GET /projects/:projectId/agent-areas` passou a devolver dados reais, e a
  classificação não mudou** — continua `role:developer`, enquanto o `PATCH`
  do teto segue `role:maintainer`. Até a FASE 18 a tabela `agent_areas` nunca
  era escrita e a rota respondia `[]` a todos, o que fazia a classificação
  parecer permissiva por acidente, não por decisão. Com a área nascendo junto
  com o projeto ([RN-094](business-rules/api.md#rn-094)), a divisão volta ao
  que a FASE 14d pretendia: **ler** o teto é trabalho de quem executa;
  **mudá-lo** é decidir quanto o produto gasta sem perguntar, e é por isso que
  exige o mesmo papel que ativa a execução.
- **As cinco rotas `/projects/:projectId/rag/*` dividem o papel pelo mesmo
  critério do teto de paralelismo da área (RN-083)** (PROGRAMA 28, Onda 4 —
  RN-231..234, ADR 0080): `search` e `coverage` são `role:viewer` (leitura pura
  sobre o que já está indexado), e `reindex` é `role:maintainer` — dispara N
  chamadas ao repositório do projeto e ao provider de embedding, o mesmo "muda
  o que o produto gasta sem perguntar" que já justifica o papel mais alto em
  outras rotas de disparo caro. `local` (RN-455, ADR 0113) é
  `role:maintainer` também, pelo mesmo raciocínio: chama o provider de
  embedding e substitui o que o projeto tem indexado para aquele escopo. O
  corpo é TEXTO lido pelo navegador, nunca um caminho do host.
  `feedback` (RN-480) é `role:viewer`, o **mesmo** papel de `search`, e o
  critério acima é o porquê: votar não gasta nada nem configura nada — é
  observação, e é o único sinal de verdade que a medição do RAG tem
  (`medir:rag`). Subi-lo para `maintainer` esvaziaria esse sinal para não
  proteger nada. O voto continua contido no servidor: um `searchId` de outro
  projeto, ou um `chunkId` que não estava entre os resultados daquela busca, é
  400 — um voto sem posição não mede nada.
- **`GET /projects/:projectId/git/open-pull-requests` (AT-843) é `role:viewer`
  e fica FORA do portão da imagem ([RN-105](business-rules/api.md#rn-105)).**
  Devolve só os metadados das PRs abertas (sem conteúdo de arquivo), com o
  mesmo papel e a mesma credencial do dono da lista `/code/pull-requests`; a
  superfície efetiva não cresce. Mora no `GitController` para o
  `CodeController` continuar inteiro atrás do portão.
- **As quatro rotas `/projects/:projectId/code/*` são `role:viewer` e
  SOMENTE LEITURA** (FASE 26b). Ver o código de um projeto é a mesma permissão
  que ver o projeto — o mesmo corte de `GET /projects/:id/git/repository`. Três
  coisas fazem dessa aparente permissividade uma decisão e não um descuido:
  - **não há verbo de escrita no controller**, e não pode haver: a aba Código
    é para ler, e escrever é efeito externo, que nasce `proposed_action` e
    pertence a uma fase posterior. Um `@Post` neste arquivo é mudança de fase,
    não de rota;
  - **o caminho é contido num lugar SÓ** ([RN-095](business-rules/api.md#rn-095)),
    pela mesma checagem central da [RN-092](business-rules/api.md#rn-092) —
    e a contenção importa aqui mais que o papel, porque nos providers remotos o
    caminho vira segmento de URL da API do provider e um `../` troca o
    **endpoint**, não o arquivo;
  - **a credencial gasta é a do owner do workspace**
    ([RN-058](business-rules/api.md#rn-058)/[RN-082](business-rules/api.md#rn-082)),
    como na escrita. Ler custa o rate limit do provider, e é por isso que a
    busca tem orçamento: sem teto, um `viewer` poderia inflar a conta do owner
    à vontade.
- **Três rotas de gasto/curadoria nasceram na AT-632
  ([RN-952](business-rules/api.md#rn-952)..[RN-954](business-rules/api.md#rn-954),
  [ADR 0233](adr/0233-membro-ve-o-gasto-do-projeto-sem-credencial.md)).**
  `GET /projects/:projectId/spend/team` (`role:viewer`) devolve o total do
  projeto e o custo por agente/área a QUALQUER membro, e nunca provider nem
  credencial: a rota não tem parâmetro de dimensão e o caso de uso só pede
  `actor`. `GET /workspaces/:workspaceId/spend/me` (`role:viewer`) é o consumo
  PRÓPRIO somado por projeto: o ator vem do token e o escopo de ator impede
  `provider` por tipo (RN-187). `PATCH /workspaces/:workspaceId/models/:modelId/billing`
  (`role:owner`, o nível de `…/pricing`) grava a marca curada. O
  `?projectId=` do `spend-report` segue `owner` e responde 404 para projeto de
  outro workspace.
- **Fontes da v9 (AT-929..932, [RN-1150](business-rules/api.md#rn-1150)..[RN-1154](business-rules/api.md#rn-1154)): sem rota nova, papéis intactos.**
  `GET /projects/:projectId/spend/team` (`viewer`) ganhou `porModelo`, `porSessao` e
  `porDiaEAgente`; modelo não é credencial e `provider` segue só do owner.
  `GET /projects/:projectId/actions` (`developer`) aceita `status=decided` e `since`,
  sempre escopado ao projeto, com teto de 100. O listar sessões (`viewer`) ganhou
  custo e contagens agregados do próprio projeto.
- **`GET /workspaces/:workspaceId/spend-report` passou a devolver o recorte
  por provider, que é um recorte por CREDENCIAL**
  ([ADR 0076](adr/0076-provider-volta-a-ser-dimensao-de-gasto.md),
  [RN-186](business-rules/api.md#rn-186)/[RN-187](business-rules/api.md#rn-187)).
  Nenhuma rota nova e nenhuma mudança de papel — continua `role:owner`, como
  já era —, mas o que ela CONCEDE mudou, e é por isso que esta nota existe. O
  ADR [0063](adr/0063-duas-audiencias-para-o-mesmo-gasto.md) tinha recusado
  esse eixo exatamente por este motivo; o 0076 o revisa por decisão do dono do
  produto. O que agora segura a fronteira são DUAS barreiras independentes:
  `GET /projects/:projectId/spend/me` (`role:viewer`) não tem parâmetro de
  dimensão nenhum, e o TIPO recusa a combinação — um escopo com `actor` só
  aceita `Exclude<SpendDimension, 'provider'>`, então pedir provider na visão
  do membro não compila. A segunda é mais fraca que a garantia anterior ("a
  dimensão não existia"), e é por isso que são duas.
- **`POST /projects/:projectId/sessions/:sessionId/socket-ticket` é
  `role:viewer` na tabela, mas isso é o PISO, não o teto**
  (RN-108). O `@RequireRole('viewer')` cobre `scope: "heartbeat"` —
  o socket de heartbeat/eventos ao vivo que já existe; `scope: "terminal"`
  exige `developer`, conferido DENTRO de `CreateSocketTicketUseCase`
  contra `request.effectiveRole` (o mesmo que o `RolesGuard` já
  resolveu), porque o papel mínimo depende do CORPO da requisição, não
  só da rota — o mesmo padrão de
  `MIN_ROLE_FOR_ACTION_TYPE.terminal` em `domain/actions/decide.ts`.
  Hoje nenhum caminho real pede `scope: "terminal"` (o socket do terminal
  interativo é a FASE 25); o valor já nasce certo para
  quando ele existir.
- **`POST /projects/:projectId/members` é `role:maintainer` na tabela,
  e esse papel é NECESSÁRIO mas não SUFICIENTE**
  ([ADR 0127](adr/0127-tetos-de-rebaixamento-em-project-members.md),
  [RN-472](business-rules/api.md#rn-472)). É o espelho da nota do
  `socket-ticket` acima: lá o papel da tabela é o piso e o
  corpo pode elevá-lo; aqui o papel da tabela é o portão inteiro que o
  `RolesGuard` aplica, e o caso de uso então recusa **dois movimentos com
  403 mesmo para quem o tem** — rebaixar alguém que é `owner` do
  WORKSPACE, e rebaixar a SI MESMO. Nenhuma rota nova e nenhuma troca de papel
  (`RequireRole('maintainer')`, como já era); o que mudou é que a
  classificação deixou de ser a resposta completa para "quem pode fazer o quê
  aqui". O motivo de isso não poder morar no `RolesGuard` é o mesmo que a nota
  do `socket-ticket` dá — a decisão depende do CORPO da requisição
  (`dto.role`) e do ALVO dela (`dto.userId`), que o guard não
  vê —, então a regra é uma função pura em
  `domain/iam/tetos-de-rebaixamento.ts` aplicada por
  `AddProjectMemberUseCase`, na FORMA dos tetos absolutos de
  `domain/actions/decide.ts` ([RN-418](business-rules/api.md#rn-418)): nenhuma
  chave de configuração, nada que possa ligá-los. O `owner` protegido
  é `workspace_members.role`, nunca `workspaces.created_by`.
  O que os tetos NÃO cobrem está escrito no ADR e na RN.
- **`DELETE /projects/:projectId/members/:userId` também é `role:maintainer`
  e também não basta** — a segunda porta do teto de auto-rebaixamento
  ([ADR 0156](adr/0156-teto-de-auto-rebaixamento-na-remocao.md),
  [RN-556](business-rules/api.md#rn-556)). O ADR 0127 deixou esta rota sem teto por
  uma premissa que se mostrou falsa — *"remoção é benigna"*. Apagar a linha de
  `project_members` não apaga um papel: ele **troca** o
  efetivo, porque `forProject` é `projectRole ?? workspaceRole`
  ([RN-471](business-rules/web.md#rn-471)). Um `maintainer` por linha de projeto que é
  `viewer` no workspace se rebaixava, de forma irreversível pela
  tela — repor a linha é `POST :projectId/members`, que exige o
  `maintainer` recém-abandonado; **sem** papel nenhum no workspace, a queda é
  para nenhum acesso. O teto agora é aplicado por `RemoveProjectMemberUseCase`,
  que teve de passar a receber o ATOR (a rota não o passava, então nenhum
  teto poderia ter sido aplicado), e a regra REUSA
  `ehAutoRebaixamento` — `remocaoEhAutoRebaixamento` delega a ela com
  o papel de workspace no lugar do pedido, nunca uma segunda régua.
  O teto 1 **não** tem par aqui, por decisão fixada em teste: `owner` é
  o topo do `ROLE_ORDER`, então remover uma linha de projeto só pode ELEVAR o
  papel efetivo desse usuário — e é justamente assim que se desfaz a restrição
  que o teto 1 proíbe criar. Preço declarado, já que o teto 2 não tem
  limiar: a auto-remoção de `owner` de projeto para `maintainer` de workspace é
  reversível e também é recusada — o único movimento benigno que muda
  desfecho, ainda alcançável por outro `maintainer`.
- **`POST /workspaces/:workspaceId/members` é `role:owner` na tabela, e
  isso também deixou de ser a resposta inteira** — a terceira rota desta família
  ([ADR 0157](adr/0157-teto-de-auto-movimento-no-upsert-de-workspace.md),
  [RN-557](business-rules/produto.md#rn-557)). O ADR 0127 nomeou esta rota como a mesma
  classe de defeito *um escopo acima*, e o ADR 0156 a deixou como decisão à parte;
  ela era um passa-adiante de doze linhas que **nunca recebia o ator**, então nenhum
  teto poderia ter sido aplicado. Aqui é pior que no projeto por dois motivos
  que lá não existem: nenhum nível acima segura a queda (no projeto,
  rebaixar a si mesmo derruba o papel efetivo para o do workspace, que muitas vezes
  segura), e **não há `@Delete` de membro nenhum** neste controller
  (medido) — desfazer é esta mesma rota, exigindo o `owner` recém-
  abandonado. Por isso `AddWorkspaceMemberUseCase` agora recebe o ator e recusa
  **mudar o SEU PRÓPRIO papel com 403, nos dois sentidos**. O teto **não
  conta owners**, de propósito: a cláusula não tem número para envelhecer (critério
  do ADR 0127), e ela já produz o invariante que uma contagem existiria para
  garantir — um workspace nunca chega a zero owners, já que remover o último
  exigiria que esse owner o fizesse. O teto 1 **não tem par neste
  escopo**, considerado e não espelhado: é uma regra sobre *inversão de
  hierarquia*, e o `@RequireRole('owner')` já torna a inversão impossível —
  quem pode chamar nunca está abaixo de quem toca. Acrescentá-lo, somado à
  rota de remoção ausente, faria de `owner` um estado absorvente do qual ninguém sai
  por HTTP, que é a classe de estado que o ADR 0127 nasceu para eliminar.
  Rebaixar **outro** owner, portanto, continua permitido — a única forma de a propriedade
  ser revogada, e reversível pela mesma rota por qualquer owner que reste.
- **`DELETE /workspaces/:workspaceId/members/:userId` é `role:owner`, e é
  a quinta porta da mesma família**
  ([ADR 0173](adr/0173-remocao-de-membro-de-workspace.md),
  [RN-615](business-rules/api.md#rn-615)). Ela não existia quando o ADR 0157 foi
  escrito — a frase acima sobre "nenhum `@Delete` de membro" descreve aquele
  momento. Ela carrega o mesmo teto sem regra nova: `remocaoEhAutoRebaixamento`
  com o papel de workspace como o efetivo de hoje e *nenhum* como o papel
  de depois, já que nenhum nível acima segura a queda — então **remover a SI MESMO é
  sempre 403**. Essa mesma cláusula é o que protege o **último owner**, sem
  contar: só um `owner` chama a rota, ninguém remove a si mesmo, então
  toda chamada bem-sucedida deixa ao menos o chamador como `owner`. Remover
  **outro** owner é permitido (é como a propriedade é revogada por inteiro), e
  o teto 1 continua sem par aqui — o `@RequireRole('owner')` segue
  impedindo a inversão de hierarquia. A remoção também **cascateia**, numa
  transação: as linhas de `project_members` do alvo neste workspace (sem
  isso a regra de projeto-sobrepõe-workspace o manteria dentro de todo projeto
  onde ele tinha linha própria), as chaves de dispositivo de PROJETO dele e os PATs dele
  aqui (todo PAT pertence a um projeto); depois do commit a conexão viva do runner
  dele em cada projeto é derrubada, em melhor esforço, pelo caminho da
  RN-520. Declarado e não feito: chaves de máquina (da conta inteira; elas deixam de alcançar
  este workspace porque o papel resolve para nenhum), sockets de
  sessão já conectados. O **titular** (`workspaces.created_by`, cujas
  credenciais de LLM e de git os agentes gastam, RN-058) não pode ser removido: 409
  `criador_do_workspace` até que `PUT /workspaces/:workspaceId/owner-of-record`
  (`role:owner`, o destino já tem de ser `owner`, senão 409
  `titular_precisa_ser_owner`) a transfira — [RN-616](business-rules/api.md#rn-616).
  Qualquer owner pode transferi-la, inclusive para outro owner que não pediu.
- **`GET /workspaces/:workspaceId/members` é `role:viewer`, não o `owner`
  das três rotas de escrita ao lado** ([RN-652](business-rules/web.md#rn-652),
  AT-335). O mínimo é o do endpoint (RN-102): ler a lista não é
  mantê-la. `viewer` é o que as leituras vizinhas usam
  (`GET /workspaces/:workspaceId`, `/projects`) e o que
  `GET /projects/:projectId/members` usa — a leitura que esta completa, já que
  quem entra num projeto só pelo papel de workspace não tem linha de
  projeto. Quem pode abrir uma sessão pode ver quem falou nela, e um
  `viewer` de workspace já vê todo projeto do workspace. O corpo tem
  a mesma forma da leitura de projeto — `userId`, `name`, `email`, `role` —
  e nada mais (sem `createdAt`, sem estado da conta).
- **A auto-PROMOÇÃO agora é recusada nas duas rotas de associação**, o que muda
  também `POST /projects/:projectId/members`. O ADR 0127 a tinha registrado como
  capacidade que ficava (*"os tetos são sobre descer"*); o ADR 0157 revisa
  isso. As duas metades são um movimento só — uma pessoa decidindo sozinha que autoridade
  tem — e a metade de subida é a única que **escala privilégio**,
  justamente o que o ADR 0127 podia afirmar que seus tetos nunca faziam. Reescrever o MESMO
  papel continua passando: um upsert idempotente não é movimento. A comparação
  ficou num lugar só: `autoMovimentoDoProprioPapel` devolve o SENTIDO em vez
  de um booleano (o chamador precisa dele para escolher a mensagem), e
  `ehAutoRebaixamento` sobrevive como leitura dele para que a porta da REMOÇÃO
  continue vendo só a metade de baixo, como o ADR 0156 decidiu.
- **`jwt` sem papel não quer dizer sem autorização.** Em
  `/users/me/*` o escopo é o próprio usuário; em `GET /workspaces`
  a listagem já é filtrada pela associação de quem chama.
- **`X-Brabo-Service-Token` passou a ser redigido no log**
  ([ADR 0035](adr/0035-observabilidade-legivel-e-trace-sem-coletor.md)).
  Ele é o portador de todo o tráfego api↔engine e **não** estava na lista
  `redact` do pino: se caísse num corpo de erro logado, iria para o
  Loki em texto puro e com retenção. `serviceToken`, `privateKey`,
  `encryptedDek` e `dek` entraram junto. A lista completa está
  em `src/infrastructure/observability/logger.config.ts`, e
  há um teste afirmando cada caminho — a lista é contrato, não
  conveniência.
- **O `allowedHeaders` do CORS é explícito**, e a lista precisa conter
  todo cabeçalho que o web envia: `Content-Type`, `Authorization`,
  `X-CSRF-Token` e `traceparent`. Faltar um não quebra teste nenhum
  (nenhum teste faz preflight) e quebra o navegador.
- **O engine tem CORS só nas rotas de saúde**
  ([ADR 0037](adr/0037-cors-do-engine-e-a-porta-como-contrato.md)).
  `/health`, `/live` e `/ready` devolvem
  `Access-Control-Allow-Origin` para as origens de `WEB_ORIGIN`;
  **`/internal/*` e `/metrics` não**, e a exclusão é o
  ponto. As 13 rotas internas são servidor-a-servidor com um segredo
  compartilhado ([RN-035](business-rules/api.md#rn-035)); CORS ali não
  habilitaria nada — o cliente HTTP da api ignora esses cabeçalhos —, mas
  **anunciaria a um navegador que ele é cliente esperado daquele
  canal**. Há um teste afirmando a ausência, e um afirmando que a
  lista de caminhos tem exatamente três entradas, para que mover a fronteira apareça
  no diff.
- **Origem desconhecida recebe resposta, não `403`.** Nos dois serviços,
  a requisição é atendida e sai sem o cabeçalho; quem bloqueia a
  leitura é o navegador, de quem é a decisão. Responder `403`
  quebraria todo cliente que não manda `Origin` — a probe do kubelet,
  `curl`, `docker/smoke.sh`.
- **`POST .../delegations` é engine-service como as outras rotas
  internas** (QA da Fase 8b, Infra da Fase 8c — ADR 0038) — o lead de cada área
  registra o desfecho de cada delegado (`completed`/`failed`/`dispensed`)
  SEPARADO da chamada que a área usa para reportar o resultado
  consolidado para fora (`gates/verdict` no QA, `open_infra_pr` na
  Infra). Escopo de sessão, não de tarefa — `taskId` é opcional no
  corpo. Delegação nunca é visível como handoff.
- **`POST /projects/:projectId/execution/activate` ganhou um
  `originSessionId` opcional no corpo, e a classificação não mudou**
  — continua `role:maintainer` (RN-135). O campo deixa quem já tem
  esse papel fechar a sessão de CHAT que originou o pedido, mas com
  duas contenções que impedem usá-lo para fechar a sessão de
  outra pessoa: `findInProject(projectId, originSessionId)` recusa em silêncio
  um id que não pertence ao PRÓPRIO projeto do caminho, e o fechamento
  só acontece se `GetSessionPendingWorkUseCase` (a mesma guarda do
  heartbeat de inatividade, [RN-073](business-rules/engine.md#rn-073)) confirmar
  que não há handoff, ação ou turno pendurado ali. Nunca fecha a
  sessão de execução que a própria chamada acabou de ativar.
- **`GET /internal/sessions/:sessionId/pending-work` ganhou
  `aguardandoUsuarioDesde`, e nenhuma rota mudou de classificação**
  ([RN-581](business-rules/api.md#rn-581)). Continua `engine-service`: o campo
  é o instante em que o turno de um agente conversacional terminou, lido do mesmo
  event log que o engine já escreve, e só decide por quanto tempo o
  engine mantém uma sessão aberta. A mesma RN fez as rotas de sessão que
  acrescentam conversa (`POST .../agents/:agent/message`, o chat,
  handoffs, `POST .../agents/:agent/start`,
  `POST /internal/sessions/:sessionId/events`) responderem **409**
  `sessao_encerrada` em sessão terminal — uma recusa por ESTADO, depois
  da checagem de papel, nunca um papel novo. `terminationReason` nas
  respostas de sessão ganhou um valor documentado, `conversation_idle_timeout`.
- **`POST /projects/:projectId/execution/activate` recusa com `409` quando
  o projeto não tem repositório, e a classificação não mudou**
  — continua `role:maintainer` ([RN-582](business-rules/api.md#rn-582),
  [ADR 0165](adr/0165-o-repositorio-nasce-no-handoff-ao-arquiteto.md)). A
  recusa vem antes de qualquer efeito. A mensagem é escolhida a partir dos
  handoffs do projeto, lidos em TODAS as sessões dele — por isso ela pode dizer "aceite
  o handoff ao Arquiteto/Dev Lead". O que ela revela é só que esse
  handoff existe e o status dele, que qualquer `viewer` do projeto já lê
  por `GET .../sessions/:sessionId/handoffs`; ela nunca nomeia sessão nem
  usuário.
- **`POST /projects/:projectId/execution/activate` recusa com `409`
  `execucao_sem_container` quando o container não está `running`, e a
  classificação não mudou** — continua `role:maintainer`
  ([RN-1101](business-rules/api/parte-12.md#rn-1101)). Recusa por ESTADO, antes
  de qualquer efeito; a mensagem só diz o próximo passo e não revela nada além
  do que `GET .../container` já mostra a um `viewer`.
- **`PUT /projects/:projectId/agent-autonomy` com a curinga `auto_approve`
  reavalia as pendentes do agente, e a classificação não mudou** — continua
  `role:maintainer` ([RN-1103](business-rules/api/parte-12.md#rn-1103)). A
  aprovação em nome de quem ligou usa a MESMA régua de `decide()`, com os
  tetos de `git_push`, `pr_open` e `git_merge` intactos e `deny` de
  `permissions.json` ainda vencendo.
- **Oferecer handoff a um agente já ativo no projeto é `409`
  `agente_ja_ativo`, e a classificação não mudou** — a rota humana
  `POST .../sessions/:sessionId/handoffs` continua `role:developer` e a
  interna continua `engine-service` ([RN-635](business-rules/api.md#rn-635),
  [ADR 0182](adr/0182-ciclo-de-vida-do-handoff.md)). Ao contrário da recusa acima,
  esta NOMEIA uma sessão: a mensagem diz em que sessão do mesmo
  projeto o destino está ativo, porque é o texto que o agente lê como
  resultado de ferramenta e o ponteiro de que uma pessoa precisa para ir falar com ele. Qualquer `viewer` do
  projeto já lista as sessões dele e lê `agent.activated` em cada uma,
  então nada atravessa fronteira de projeto. As mesmas rotas agora respondem com a
  oferta CORRENTE em vez de sempre uma linha nova (`desfecho`), e a interna
  aceita `seAusente` — uma chave que só pode fazer a chamada escrever MENOS.
- **O `POST /internal/sessions/:sessionId/handoffs` interno agora pode ACEITAR
  a oferta Criativo→PO que ele cria, e a classificação não mudou** —
  continua `engine-service` ([RN-658](business-rules/api.md#rn-658),
  [ADR 0185](adr/0185-estou-pronto-fecha-os-dois-gates.md)). O engine não ganha
  poder de ativar agente: quem decide é a api, a partir do `readiness.confirmed`
  que uma PESSOA gravou por `POST .../readiness` (`role:developer`, o mesmo
  mínimo de aceitar pelo card), e ela grava essa pessoa como o ator. O
  engine não consegue forjar a marca — ele nunca escreve `readiness.confirmed` — e
  a oferta precisa carregar o `product_brief` nascido depois daquele clique, na mesma
  sessão. `POST .../agents/criativo/validate-necessity` mantém a rota e o
  papel, sem chamador no web ([RN-657](business-rules/api.md#rn-657)).
- **`GET /projects/:projectId/execution/session` é `role:viewer`, o
  mesmo papel de `GET /sessions/:sessionId`**
  ([RN-139](business-rules/api.md#rn-139)). Devolve a sessão de execução
  CORRENTE do projeto — `active` com `execution.activated` gravado — ou
  `null`; nunca a sessão mais recente do projeto, que era o que a
  aba Executores lia e que trocava de sessão em silêncio no
  instante em que outra sessão nascia depois dela.
- **`GET /workspaces/:workspaceId/decision-inbox` (AT-928, [RN-1195](business-rules/api.md#rn-1195)..[RN-1199](business-rules/api.md#rn-1199)): `role:viewer` é só a porta do workspace.**
  O papel EFETIVO de cada projeto (`projectRole ?? workspaceRole`, RN-471) é
  aplicado em lote pelo caso de uso, e o mínimo de cada fila é o papel de
  DECIDIR (`developer`; arquitetura, que só se lê, `viewer`): projeto abaixo do
  mínimo não contribui com a fila, nem com item nem com contagem. Quem não tem
  papel de workspace recebe 403. A rota só lê, expõe o `payload` da ação como o
  `GET .../actions` já expõe, e nenhum teto muda.
- **`GET /workspaces/:workspaceId/projects-summary` ganhou
  `roster.activatedAgents`, e a classificação não mudou** — continua
  `role:viewer`. O campo é a lista de ids de agente com um `agent.activated`
  na sessão mais recente do projeto ([RN-630](business-rules/api.md#rn-630)),
  calculada na mesma varredura por sessão que já produz
  `executionActivated` e `gatesEverOpened` ([RN-568](business-rules/web.md#rn-568)).
  Não nomeia usuário, sessão nem credencial, e não acrescenta consulta.
- **`POST .../llm-turn` e `POST .../llm-turn-stream` ganharam
  `modelName` no corpo da resposta/quadro final, e a classificação
  não mudou** — continua `engine-service` como sempre
  ([RN-146](business-rules/api.md#rn-146)). O nome do modelo já
  era resolvido para chamar o provider; ele só passou a viajar de volta ao
  engine, que o inclui no payload de `agent.response`. Nenhum dado novo
  é lido, nenhuma credencial nova é exposta — é o mesmo nome que
  já aparece em `token_usage`.
- **`PUT /projects/:projectId/agent-autonomy` passou a aceitar
  `actionType: "*"` — o "modo automático" ([RN-153](business-rules/api.md#rn-153))
  — e a classificação não mudou:** continua `role:maintainer`,
  o mesmo do `GET` ao lado. A diferença é o que o corpo agora
  AUTORIZA, não quem pode chamar: a curinga concede autonomia para QUALQUER
  tipo de ação do agente de uma vez, em vez de um tipo por vez como antes.
  A resolução (regra ESPECÍFICA sempre vence a curinga) mora
  inteira no repositório
  (`DrizzleAgentAutonomyRepository.findMode`), nunca em `decide()` —
  que continua recebendo só a `PermissionPolicy` já resolvida,
  exatamente como antes de a curinga existir. É por isso que os três
  tetos absolutos — merge em branch protegida, `instruction_patch`,
  `parallelize`/`raise_max_parallel` — continuam bloqueando mesmo com a
  curinga em `auto_approve` ([RN-154](business-rules/api.md#rn-154)):
  eles reagem a `current.policy === 'auto_approve'`, nunca a de onde ela
  veio, e nenhuma exceção precisou entrar em `decide()` para isso continuar
  valendo. O `ApprovalCard.tsx` só oferece o botão que grava a
  curinga a um cliente que já sabe ter `maintainer`/`owner` —
  mas o que de fato garante o papel é este mesmo
  `@RequireRole('maintainer')`, inalterado.
- **O roteador de ferramentas Jev é uma chamada de SAÍDA nova levando contexto de agente**
  ([ADR 0179](adr/0179-o-laco-pergunta-ao-jev-qual-ferramenta.md),
  [RN-625](business-rules/engine.md#rn-625)). Antes de uma chamada de chat a um modelo do
  OpenRouter, a api faz POST em `https://openrouter.ai/api/alpha/decisions` (a
  Decisions API, alfa) com a chave do OpenRouter do owner do workspace — a MESMA
  chave que o chat já gasta, decifrada no mesmo caso de uso, nunca logada
  e nunca devolvida. O que viaja é o `state`: o id do agente, a última
  mensagem do usuário (cortada em 6.000 caracteres), o começo da mensagem de sistema (1.500)
  e até seis chamadas de ferramenta recentes com argumentos e resultados cortados em 500
  caracteres cada — mais os NOMES e as DESCRIÇÕES das ferramentas, nunca os
  `parameters` delas. É conteúdo que a chamada de chat já manda para a mesma
  conta do OpenRouter, numa fatia menor, mas que agora chega a um segundo modelo
  (`typesafe/jev-1.13`) por trás dela. A chave é por workspace
  (`PUT /workspaces/:workspaceId/tool-router`, `role:owner`, ligada por padrão) e
  só dispara com modelo de chat do OpenRouter. O roteador estreita o menu de
  ferramentas e nada mais: não consegue aprovar, negar nem alargar nada, e uma
  chamada que o modelo faça fora do menu continua virando Proposed Action sob
  a mesma política. Qualquer falha da chamada cai no catálogo inteiro.
- **O Laya (AT-626, [ADR 0290](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0290-o-usuario-escolhe-o-laya-no-lugar-do-jev-quando-a-maquina-tem-gpu.md)) é a alternativa LOCAL ao Jev:
  com `tool_router = laya` o mesmo `state` vai ao serviço da 6ª imagem
  (`TOOL_ROUTER_URL`, rede interna do compose, sem porta publicada) em vez de sair
  para o OpenRouter.** Nenhum dado de agente sai da máquina nesse caminho, não há chave
  de terceiro envolvida e a `TOOL_ROUTER_API_KEY`, se houver, nunca é logada nem devolvida.
  A escolha é `owner` (`PUT`); o estado do serviço é `GET .../tool-router`
  (`viewer`), com cache de 30 s e teto de 1 s, e traz só estado, motivo, dispositivo,
  VRAM livre e p95 — nada do conteúdo dos agentes. Falha do serviço cai no catálogo
  inteiro, nunca no Jev.
- **`POST .../actions/:actionId/approve_always` ganhou `desfecho` e
  `padraoGravado` na resposta, e a classificação não mudou** —
  continua `role:developer` ([RN-642](business-rules/api.md#rn-642)). A aprovação
  e o padrão gravado agora dividem uma transação; clicar numa ação que
  já estava APROVADA responde `201` com `desfecho: "ja_aprovada"` em vez de
  `409`, e uma ação RECUSADA continua respondendo `409` (`acao_ja_recusada`) sem
  nada gravado. Os tetos da RN-418 e `container_remove` continuam recusados
  com `400` antes de qualquer estado ser lido, então o caminho idempotente nunca grava
  um padrão que o teto proíbe.
- **Um erro de git ganhou resposta nomeada nova: `409 merge_conflict`** — nenhuma rota,
  papel ou guard mudou ([RN-704](business-rules/api.md#rn-704)).
  `GitProviderErrorFilter` mapeia `GitMergeConflictError` (o merge do
  repositório local achou conflito) para `409` com os arquivos em conflito na
  mensagem; a ref de destino fica intacta e a pull request continua aberta.
  Pelo pipeline de aprovação a ação `git_merge` termina `failed` com
  essa mensagem, o mesmo caminho de `GitPullRequestAlreadyMergedError`.
- **`GET /projects/:projectId/actions` aceita `status=failed`** — mesma rota,
  mesmo papel `developer` ([RN-705](business-rules/api.md#rn-705)). Até aqui só
  `pending` era aceito; `failed` lista as ações do projeto cuja
  execução falhou, e EXIGE `actionType` (`400` sem ele), para que a
  leitura seja de um tipo e nunca o histórico inteiro. Devolve a mesma
  forma `ProposedAction` que a leitura de pendentes devolve; a ação de git falhada agora
  carrega o próprio `kind`, a mensagem de erro e, num conflito de merge, os
  nomes dos arquivos em conflito — caminhos do repositório que o mesmo papel já lê
  no diff.

- **Duas respostas ganharam campos na Rodada 135** — nenhuma rota, papel ou
  guard mudou. `GET /workspaces/:workspaceId/models/catalog` (`role:maintainer`)
  devolve `sugestao` por modelo ([RN-965](business-rules/api.md#rn-965)): a
  faixa de cobrança e o preço publicado pelo fabricante, com link e data da
  fonte — dado curado no repositório, não dado do usuário nem segredo, e nada
  é gravado pela leitura (quem aplica é o `owner`, pelas rotas de curadoria de
  sempre). `GET /projects/:projectId/sessions/:sessionId/token-usage`
  (`role:developer`) devolve `lastCall` por agente
  ([RN-969](business-rules/api.md#rn-969)): tokens de entrada, nome do modelo
  e janela da última chamada, do mesmo escopo de sessão que a soma já expunha,
  sem provider nem credencial.
- **A resposta do catálogo de modelos ganhou `reasoningBudget`** — nenhuma rota,
  papel ou guard mudou ([RN-914](business-rules/api.md#rn-914), ADR 0223). O campo
  (inteiro ou `null`) sai no DTO de modelo das leituras do catálogo que já
  existiam, com os mesmos papéis. É curadoria do produto (o orçamento de
  raciocínio provado por smoke), não dado do usuário nem segredo; a escrita é só
  por migration, sem rota nova.

### O Psicólogo separa produto de plataforma (RN-1076, AT-898) {#psicologo-escopo}

Duas rotas `engine-service` mudaram de corpo, sem rota nova e sem mudar o guard.
`GET /internal/sessions/:sessionId/psychologist-context` devolve
`sessaoDeTeste` (`projects.sessao_de_teste`). `POST
/internal/sessions/:sessionId/hypotheses` passa a exigir `escopo` (`produto` |
`plataforma`) por item e `sessaoDeTeste` no corpo, e aceita lote vazio. O item
de plataforma vira o evento `psychologist.platform_signal` só em projeto
marcado, fora do grafo; nos demais é descartado sem evento. A marca é ligada por
`pnpm projeto:marcar-teste <projectId>` (operador, sem rota pública).

## Tabela {#table}

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
| GET | `/internal/graph/projects/:projectId/modules/:nome/impacto` | engine-service |
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
| POST | `/internal/projects/:projectId/app/restart` | engine-service |
| POST | `/internal/projects/:projectId/mirror-sync-result` | engine-service |
| POST | `/internal/projects/:projectId/tasks/:taskId/auto-merge` | engine-service |
| GET | `/internal/projects/:projectId/container-spec` | engine-service |
| POST | `/internal/projects/:projectId/qa-environments/:taskId/start` | engine-service |
| POST | `/internal/projects/:projectId/qa-environments/:taskId/remove` | engine-service |
| POST | `/internal/projects/:projectId/qa-environments/:taskId/compose` | engine-service |
| POST | `/internal/qa-environments/sweep` | engine-service |
| POST | `/internal/projects/:projectId/open-questions/:questionId/answer` | engine-service |
| POST | `/internal/projects/:projectId/business-rules/:ruleId/retire` | engine-service |
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
| POST | `/internal/sessions/:sessionId/tasks/:taskId/update` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/:taskId/archive` | engine-service |
| POST | `/internal/sessions/:sessionId/tasks/claim` | engine-service |
| GET | `/internal/sessions/:sessionId/tasks/in-progress-by-dev` | engine-service |
| POST | `/internal/sessions/:sessionId/termination` | engine-service |
| GET | `/` | jwt |
| GET | `/runner/projects` | jwt |
| POST | `/runner/llm-credentials` | jwt |
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
| PUT | `/projects/:projectId/auto-merge` | role:maintainer |
| PUT | `/projects/:projectId/container/network` | role:maintainer |
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
| GET | `/projects/:projectId/agent-catalog` | role:viewer |
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
| POST | `/projects/:projectId/source-clicks` | role:viewer |
| GET | `/projects/:projectId/rag/coverage` | role:viewer |
| GET | `/projects/:projectId/container` | role:viewer |
| GET | `/projects/:projectId/container/lifecycle` | role:viewer |
| GET | `/projects/:projectId/container/network` | role:viewer |
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
| GET | `/projects/:projectId/git/open-pull-requests` | role:viewer |
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
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agentId/wake` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/arquiteto/handoff-infra` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/agents/criativo/validate-necessity` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/attachments` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/attachments/:attachmentId` | role:viewer |
| GET | `/projects/:projectId/sessions/:sessionId/budget` | role:developer |
| PUT | `/projects/:projectId/sessions/:sessionId/budget` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/chat` | role:developer |
| GET | `/projects/:projectId/sessions/:sessionId/events` | role:viewer |
| POST | `/projects/:projectId/sessions/:sessionId/events` | role:developer |
| POST | `/projects/:projectId/sessions/:sessionId/messages` | role:developer |
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
| POST | `/projects/:projectId/sessions/:sessionId/agents/:agent/resume` | role:developer |
| POST | `/projects/:projectId/tasks/:taskId/gates/:gate/resume` | role:developer |
| GET | `/projects/:projectId/spend/me` | role:viewer |
| GET | `/projects/:projectId/spend/team` | role:viewer |
| POST | `/projects/:projectId/stories/:storyId/return` | role:developer |
| PATCH | `/projects/:projectId/stories/:storyId/title` | role:developer |
| POST | `/projects/:projectId/stories/:storyId/archive` | role:developer |
| POST | `/projects/:projectId/tasks/:taskId/archive` | role:developer |
| POST | `/projects/:projectId/stories/promote` | role:developer |
| DELETE | `/workspaces/:workspaceId` | role:owner |
| GET | `/workspaces/:workspaceId` | role:viewer |
| PATCH | `/workspaces/:workspaceId` | role:maintainer |
| GET | `/workspaces/:workspaceId/members` | role:viewer |
| POST | `/workspaces/:workspaceId/members` | role:owner |
| DELETE | `/workspaces/:workspaceId/members/:userId` | role:owner |
| PUT | `/workspaces/:workspaceId/owner-of-record` | role:owner |
| GET | `/workspaces/:workspaceId/tool-router` | role:viewer |
| PUT | `/workspaces/:workspaceId/tool-router` | role:owner |
| GET | `/workspaces/:workspaceId/model-binding` | role:viewer |
| PUT | `/workspaces/:workspaceId/model-binding` | role:maintainer |
| GET | `/workspaces/:workspaceId/budget` | role:owner |
| PUT | `/workspaces/:workspaceId/budget` | role:owner |
| GET | `/workspaces/:workspaceId/credential-spend` | role:owner |
| GET | `/workspaces/:workspaceId/spend-report` | role:owner |
| GET | `/workspaces/:workspaceId/spend/me` | role:viewer |
| GET | `/workspaces/:workspaceId/huggingface/models` | role:maintainer |
| POST | `/workspaces/:workspaceId/huggingface/pull-requests` | role:maintainer |
| POST | `/workspaces/:workspaceId/huggingface/pull-requests/:id/confirm` | role:maintainer |
| GET | `/workspaces/:workspaceId/huggingface/pull-requests/:id` | role:maintainer |
| GET | `/workspaces/:workspaceId/llm-providers/credentialed` | role:viewer |
| POST | `/workspaces/:workspaceId/models/activate` | role:owner |
| GET | `/workspaces/:workspaceId/models/catalog` | role:maintainer |
| POST | `/workspaces/:workspaceId/models/sync` | role:owner |
| POST | `/workspaces/:workspaceId/models/uses` | role:owner |
| GET | `/workspaces/:workspaceId/models/:modelId/price-changes` | role:maintainer |
| PATCH | `/workspaces/:workspaceId/models/:modelId/pricing` | role:owner |
| PATCH | `/workspaces/:workspaceId/models/:modelId/billing` | role:owner |
| GET | `/workspaces/:workspaceId/projects` | role:viewer |
| POST | `/workspaces/:workspaceId/projects` | role:maintainer |
| GET | `/workspaces/:workspaceId/projects-base` | role:maintainer |
| GET | `/workspaces/:workspaceId/project-folders` | role:maintainer |
| GET | `/workspaces/:workspaceId/projects-status` | role:viewer |
| GET | `/workspaces/:workspaceId/projects-summary` | role:viewer |
| GET | `/workspaces/:workspaceId/decision-inbox` | role:viewer |
| GET | `/workspaces/:workspaceId/summary` | role:viewer |
| POST | `/workspaces/:workspaceId/unread-events` | role:viewer |
| GET | `/workspaces/:workspaceId/containers` | role:viewer |
