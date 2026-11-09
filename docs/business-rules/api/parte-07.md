---
id: rn-api-parte-07
title: 'Regras de negócio — API — parte 7 (desde RN-567)'
sidebar_label: 'API — parte 7 (desde RN-567)'
description: 'As RNs hospedadas na raiz api.'
keywords: [regras de negócio, api]
---

# API — parte 7 (desde RN-567)

## A chave de dispositivo ganha tela, e a tela diz o alcance de revogar (RN-561) {#a-chave-de-dispositivo-ganha-tela-e-a-tela-diz-o-alcance-de-revogar-rn-561}

### RN-567 — `proposed_action.created` diz QUAL regra decidiu: o `reason` de `decide()` passa a sobreviver quando a ação passa {#rn-567}

`decide()` sempre devolveu um par — `policy` e `reason` —, e a razão é
escrita em todos os pontos de retorno: o IAM insuficiente, o piso do
container ([RN-492](../engine.md#rn-492)), `agent_autonomy`, as linhas do
`permissions.json`, o comando composto, e cada teto absoluto. Mas
`ProposeActionUseCase` só a guardava num lugar: `rejectionReason`, que
`initialStatusFor` preenche **só** quando a política nega. Numa
auto-aprovação — o desfecho que mais precisa de auditoria — o event log
dizia *"a política decidiu"* ([RN-049](parte-01.md#rn-049)) e
nunca *qual* regra. `status` tornou a auto-aprovação distinguível de um
clique; o motivo é o degrau seguinte.

**A regra:** o payload do evento de SESSÃO `proposed_action.created` ganha
`reason`, com a string de `decide()` **como está**, nos TRÊS desfechos —
`auto_approved`, `pending` e `denied`. Não nasce segunda régua
"estruturada": a string já é a fonte, e um enum paralelo divergiria dela no
primeiro teto novo. No `denied` o valor é o MESMO que vira
`rejectionReason`.

**O outbox NÃO ganha o campo, e isso é decisão.** A linha de outbox
`proposed_action.created` é contrato api↔engine, e nenhum consumidor do
engine lê o motivo; alargar contrato sem consumidor é o corte que o
[ADR 0153](../../adr/0153-deploy-enabled-o-gatilho-que-ninguem-cria.md) nomeia. A
linha `session_event.appended` que `AppendSessionEventUseCase` grava para o
mesmo evento carrega só `eventId`/`seq`/`type`, então o motivo também não
vaza por ela.

**Ausente não é "sem motivo".** Evento gravado antes desta regra não tem o
campo, e não há reprocessamento nem coluna nova: quem lê trata `reason`
ausente como "não registrado". Todo evento novo tem o campo, porque
`Decision.reason` é `string` obrigatória no tipo.

Nada em `decide()` muda — nenhum teto, nenhum veredito, nenhuma string. A
tela também não muda nesta regra: o motivo passa a EXISTIR no log, e
mostrá-lo é outra entrega. (Desde a [RN-614](../web.md#rn-614) a tela o mostra na
linha do evento no painel de log e no `ApprovalCard`, pela mesma frase.)

**O que o motivo NÃO diz, declarado:** ele nomeia a regra, não a RAIZ do
escopo — o ponto 7 do [ADR 0055](../../adr/0055-escopo-de-caminho-na-politica-de-terminal.md)
pedia *qual raiz* autorizou, e `escopo: cd dentro da pasta do projeto` não
carrega o caminho. (A raiz passou a ir no evento em campo PRÓPRIO desde a
[RN-609](#rn-609), relativa e nunca absoluta.) No comando composto, a razão diz que todos os segmentos
bateram em `allow`, sem dizer qual padrão casou qual segmento. E as linhas
do `permissions.json` repetem os TOKENS do comando no texto (o `label` de
`matchAgainstFile`) — o mesmo comando que já mora em
`proposed_actions.payload` e no card de aprovação.

- **Código:** `src/application/use-cases/actions/propose-action.use-case.ts:277`
  (`reason` no payload do evento de sessão), `:223` (o comentário do outbox
  sem o campo), `:227` (o payload do outbox, intacto), `:356` (o
  `rejectionReason`, que continua só no `deny`);
  `src/domain/actions/decide.ts:294` (`Decision`, a fonte da string)
- **Teste:** `test/application/use-cases/actions/propose-action.use-case.spec.ts:902`
  (caminho feliz: auto-aprovação grava `agent_autonomy: auto_approve`),
  `:959` (`require_approval` pelo default e pelo teto da trava de merge),
  `:1058` (`deny` com o mesmo texto do `rejectionReason`), `:999` (o outbox
  sem `reason`)
- **ADR:** [0048](../../adr/0048-decisao-no-log-e-a-ordem-do-gate.md),
  [0055](../../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) (ponto 7,
  parcialmente)
- **Origem:** AT-066

### RN-569 — O grafo é reconstruído do event log pelo MESMO tradutor do projetor vivo, sem tocar a outbox, e nunca sai como sucesso calado {#rn-569}

O [ADR 0152](../../adr/0152-backup-de-volumes-contra-compose.md) (decisão 4) recusou
backup de `neo4j_data` apoiado numa premissa — *o grafo pode ser descartado
porque pode ser reconstruído* — cujo mecanismo não existia: `grep` por
`reprojet`/`reproject` em `apps/` e `scripts/` voltava vazio, e
`application/graph-projection/` só tinha o projetor PARA FRENTE. Enquanto não
existisse, o grafo não era descartável: era perdido.

**A regra:** `src/scripts/reprojetar-grafo.ts`
(`pnpm --filter api grafo:reprojetar`; `node scripts/reprojetar-grafo.js` na
imagem) reconstrói o grafo varrendo a fonte. Cinco decisões, cada uma com
motivo:

1. **Um tradutor só.** A tradução evento → nó/aresta SAIU do `GraphProjector`
   para `GraphEventTranslator`, e os dois caminhos a chamam — o projetor chega à
   fonte por uma linha de outbox, a reprojeção por cursor. Dois tradutores
   divergiriam, e o divergente seria o que roda uma vez por ano. A superfície de
   injeção do projetor NÃO mudou (ele monta o tradutor com as dependências que
   já recebia). Um teste reprova tipo novo em `GRAPH_PROJECTABLE_EVENT_TYPES`
   sem tradução.
2. **As fontes são duas, e são as de verdade.** `handoff.offered`,
   `psychologist.hypothesis_proposed` e `anamnese.profile_updated` saem de
   `session_events`; a `Interacao` sai de `sessions` em
   `closed`/`closed_abnormally`, porque fechar sessão é transição pura e não
   deixa evento no log. `PromptTemplate`/`PromptVersion` NÃO saem do event log e
   NÃO são reprojetados — voltam por `scripts/dev/seed-prompts.ts`.
3. **Idempotente, em lotes, e nunca apaga.** Toda escrita é `MERGE` em chave
   natural, garantido por uma restrição de unicidade nessa chave
   ([RN-1030](parte-12.md#rn-1030)), então um projetor vivo concorrente ou uma segunda
   réplica não consegue criar um segundo nó; rodar de novo é o jeito de
   retomar. `session_events` é varrida em
   ordem de `id` (ULID, a chave primária), 200 por lote, e `--after-event`
   retoma depois do cursor impresso. Com `--project`, só as sessões daquele
   projeto.
4. **Não toca a outbox.** O projetor vivo guarda o progresso em
   `outbox_events.processed_at`; a reprojeção nem lê nem escreve essa tabela, e
   por isso roda com a api de pé sem roubar, reabrir ou marcar linha.
5. **Nunca sucesso calado.** Grafo desligado é recusado ANTES de ler o log (um
   escopo vazio "passaria" com zero projetados); Neo4j que cai no meio para com
   o último evento concluído; projeto inexistente é recusado sem gravar nada; e
   item com payload incoerente é contado, nomeado, e o processo sai com 1.

**O que esta regra NÃO fecha:** `PerfilAnamnese` é snapshot por usuário +
dimensão, SEM projeto — o último a escrever vence —, então uma rodada com
`--project` pode deixá-lo no valor daquele projeto quando outro escreveu depois;
a rodada total restaura o último global. Não há medição de tempo em event log
grande (a única rodada real foi o compose de dev, 98 eventos, 2,5 s), e a prova
no cluster local que o BRB-018 pede não foi feita — ele segue aberto.

- **Código:** `src/application/graph-projection/graph-event-translator.ts:15`
  (`EVENTOS_DO_LOG_PROJETAVEIS`), `:31` (`FECHAMENTOS_DE_SESSAO`), `:56` (o
  tradutor), `:75` (`projetarEvento`), `:99` (`projetarFechamentoDeSessao`);
  `src/application/graph-projection/graph-projector.ts:77` (o projetor
  monta o MESMO tradutor), `:141` (chega à fonte pela outbox e delega);
  `src/scripts/reprojetar-grafo.ts:124` (`montarTradutor`), `:145`
  (`reprojetarGrafo`), `:154` (a recusa antes de ler), `:163` e `:169` (projeto
  inexistente), `:187` (a fase dos eventos, por cursor), `:213` (a interrupção
  nomeada), `:218` (a falha contada sem abortar o resto), `:230` (a fase das
  sessões fechadas), `:301` (`lerArgumentos`), `:370` (só a invocação direta
  reprojeta); `package.json:44` (`grafo:reprojetar`); `Makefile:61`
  (`test-reprojecao`)
- **Teste:** `test/scripts/reprojetar-grafo.spec.ts:349` (projetor para
  frente → apaga o subgrafo → reprojeta o log inteiro → mesma contagem de nós e
  arestas e mesma lista de chaves; a segunda rodada idêntica; a outbox intacta),
  `:394` (por projeto), `:417` (projeto inexistente, nada gravado — caso de
  falha), `:432` (grafo indisponível é erro nomeado — caso de falha), `:441`
  (argumento desconhecido recusado), `:452` (o tradutor cobre exatamente os tipos
  projetáveis); `test/application/graph-projection/graph-projector.spec.ts`
  (o projetor para frente, inalterado, sobre o tradutor extraído). Os quatro
  primeiros exigem Neo4j de pé e PULAM sem ele — a CI do api não sobe Neo4j.
- **Origem:** AT-032 (BRB-018) — a premissa do ADR 0152 sem mecanismo

### RN-573 — O assistente de criação só pré-seleciona o modo que a instalação executa: sem broker, `runner` é o sugerido e `container`/`mounted` ficam inertes com o motivo em texto {#rn-573}

Numa instalação real da v6.1.0 (AT-085), o assistente pré-selecionou `mounted`
— o `install.sh` sempre grava `BRABO_PROJECTS_BASE`, e com base conhecida a
[RN-513](../web.md#rn-513) pré-selecionava o modo. Mas a instalação por Release não tem
broker de container (a imagem não é publicada, decisão 7 do
[ADR 0150](../../adr/0150-instalador-de-uma-linha.md)), e `container`/`mounted` só
sobem container pelo broker ([RN-503](parte-06.md#rn-503)). Resultado: seis
`dev.blocked_by_container` e duas `container.start_failed` — ninguém trabalha
no projeto, para sempre ([RN-502](../engine.md#rn-502)).

**A regra ([ADR 0161](../../adr/0161-a-tela-so-oferece-o-modo-que-a-instalacao-executa.md)):**

1. **A api diz se há broker, na rota que o assistente já lê.**
   `GET workspaces/:workspaceId/projects-base` passa a devolver
   `brokerConfigurado` ao lado de `projectsBase` — mesma pergunta ("que modo
   esta INSTALAÇÃO executa?"), mesmo mínimo (`maintainer`), nenhuma rota nova.
   A fonte é `ContainerBrokerPort.configurado()`, a mesma da leitura do estado
   observado. Diz que `BROKER_URL` existe, nunca que o broker responde.
2. **Três estados, que não colapsam.** Broker **confirmado**: a RN-513 intacta.
   Ausência **confirmada**: `container` e `mounted` continuam na tela, **inertes**
   (o controle sai, a informação fica — [RN-102](parte-03.md#rn-102)),
   o motivo é dito UMA vez em texto abaixo dos cards, e `runner` é o
   pré-selecionado. **Não sei** (carregando, consulta que falha, campo ausente):
   não vira "tem" — `mounted` NÃO é pré-selecionado, a revisão da RN-513 — e
   também não vira "não tem": nenhum card trava e nada se afirma em texto;
   `container` segue selecionado, como antes.
3. **A escolha humana não aponta para o que não roda.** Quem clicou num modo
   antes de a resposta chegar, e a resposta confirma que ele não executa aqui,
   cai para `runner` — a mesma regra que já derrubava `mounted` quando a base
   some.

**O que esta regra NÃO fecha:** a conversão de modo
([RN-559](../web.md#rn-559)) continua oferecendo `container`/`mounted` numa instalação
sem broker; o instalador não pergunta se liga o broker, porque a imagem dele
não é obtível por uma instalação de Release (medido — ver o ADR 0161); e no
compose de desenvolvimento, que sobe o broker por padrão ([RN-512](../infra.md#rn-512)) mas
deixa `BROKER_URL` vazia até alguém a pôr no `.env`, o aviso aparece — e está
certo, porque sem a variável a api nunca chama o broker.

- **Código:** `src/interfaces/http/iam/workspaces.controller.ts:404`
  (`getProjectsBase`, `:256` o campo novo),
  `src/interfaces/http/iam/dto/iam.response.dto.ts:554`,
  `src/interfaces/http/iam/iam-http.module.ts` (o módulo do broker
  importado só pela pergunta `configurado()`);
  `apps/web/src/routes/NewProjectWizard.tsx:257` (`brokerConfirmado`), `:260`
  (`semBrokerConfirmado`), `:270` (`modoExecutavel`), `:283` (o modo vigente),
  `:716` (o card inerte), `:728` (o motivo em texto);
  `apps/web/src/locales/{pt-BR,en}/newProject.json` (`workspace.noBroker`)
- **Teste:** `test/interfaces/http/iam/workspaces-projects-base.controller.spec.ts:59`
  (com `BROKER_URL`, `true`), `:69` (sem, `false` mesmo com base — caso de
  falha), `:79` (só espaço conta como ausente), `:52` (o mínimo continua
  `maintainer`); `apps/web/src/routes/NewProjectWizard.test.tsx:504` (sem
  broker: `runner` pré-selecionado, os dois cards inertes, o motivo em texto),
  `:523` (broker desconhecido: não pré-seleciona `mounted` nem trava nada),
  `:534` (clique em `container` antes da resposta cai para `runner`), `:479`
  (consulta que falha não afirma ausência)
- **Origem:** AT-085 — instalação real da v6.1.0 em 2026-09-14, decidido pelo
  mantenedor em 2026-09-18

### RN-574 — A `/containers` recusa antes do clique a subida de `container`/`mounted` numa instalação sem broker, com motivo próprio em texto {#rn-574}

A mesma instalação do AT-085 deixou aprovar, pela página de containers
([RN-521](parte-06.md#rn-521)), duas `container_start` que só podiam terminar `failed` com
`BrokerIndisponivelError`. A página já recusava localmente o que sabia que ia
falhar — sem imagem, `runner` sem pasta confirmada, papel abaixo de
`maintainer` — e não sabia desta.

**A regra ([ADR 0161](../../adr/0161-a-tela-so-oferece-o-modo-que-a-instalacao-executa.md)):**

1. **A lista diz se há broker, em toda linha.**
   `GET workspaces/:workspaceId/containers` ganha `brokerConfigurado` por linha,
   com o MESMO valor em todas, lido UMA vez por carga — é configuração da
   instalação, e trocar a lista por um envelope quebraria o contrato.
2. **Um quarto motivo de recusa, `sem_broker_na_instalacao`,** para `container`
   e `mounted` quando `brokerConfigurado !== true` ("não sei" não vira "tem").
   Vem logo depois de "já está de pé" e ANTES de "sem imagem decidida": numa
   instalação sem quem suba o container, mandar decidir a imagem seria apontar
   a porta errada. O texto diz o quê (esta instalação não sobe container para
   esses dois modos), por quê (sem broker, `BROKER_URL` vazia) e o que não é
   afetado (`runner`).
3. **`runner` nunca cai nele.** Quem depende do broker é decidido pela MESMA
   ramificação por destino de `acaoDeSubidaDoModo` (`usaBroker`), não por uma
   segunda régua.

**O que esta regra NÃO fecha:** parar e remover não ganharam a recusa (sem
broker não há container de `container`/`mounted` registrado de pé para parar,
e o caso não foi medido), e o Infra Lead continua sem saber de broker ausente
— ele recusa por MODO ([RN-566](../engine.md#rn-566)), e propor `container_start` numa
instalação sem broker continua possível pelo agente.

- **Código:** `src/application/use-cases/containers/obter-visao-geral-de-containers.use-case.ts:71`
  (o campo), `:150` (lido uma vez por carga);
  `src/interfaces/http/containers/dto/containers.response.dto.ts:408`;
  `apps/web/src/routes/containers-subida.ts:33` (o motivo), `:94`
  (`usaBroker`), `:122` (a recusa);
  `apps/web/src/locales/{pt-BR,en}/containers.json`
  (`actions.bloqueio.sem_broker_na_instalacao`)
- **Teste:** `test/application/use-cases/containers/obter-visao-geral-de-containers.use-case.spec.ts:252`
  (sem broker, `false` em toda linha — caso de falha), `:264` (com broker,
  `true`); `apps/web/src/routes/containers-subida.test.ts:54` (`container` e
  `mounted` recusam antes da imagem), `:75` (`runner` não é afetado), `:84`
  (campo ausente recusa), `:93` (já de pé continua dizendo isso);
  `apps/web/src/routes/ContainersPage.test.tsx:562` (botão inerte e o motivo
  em texto, nunca propõe), `:726` (`runner` segue subindo)
- **Origem:** AT-085 — instalação real da v6.1.0 em 2026-09-14, decidido pelo
  mantenedor em 2026-09-18

---

## O broker de container na instalação, com consentimento (RN-575) {#o-broker-de-container-na-instalacao-com-consentimento-rn-575}

### RN-581 — A conversa em curso segura a sessão por até 8h, e a sessão encerrada recusa conversa {#rn-581}

No `exp001` o heartbeat fechou a sessão 30 segundos depois de a aba parar, com
o Criativo tendo acabado de perguntar — e o event log continuou recebendo
eventos por quatro minutos depois do `closed_at`. Dois defeitos, um de cada
lado do fechamento: nenhum dos sinais de trabalho pendente da
[RN-064](../web.md#rn-064) via uma conversa esperando o usuário
(um Criativo que terminou o turno está `idle`, sem handoff, sem ação, sem
`dev.*`), e nada — nem o funil de eventos, nem os casos de uso da conversa, nem
o engine — olhava o estado da sessão antes de gravar.

**A regra, pelo lado do heartbeat:**

1. **Conversa esperando o usuário é trabalho pendente.** É o QUINTO sinal do
   `pending-work`: o evento de fim de turno mais recente da sessão
   (`agent.response`, `chat.structured_question` ou `agent.error` do lado do
   agente; `chat.message` ou `chat.structured_question_answered` do lado do
   usuário) é do AGENTE, e o ator é um conversacional. `agent.error` conta como
   fim de turno de propósito: pela [RN-059](../engine.md#rn-059) o
   agente diz no fio o que houve, e a próxima jogada é do usuário. Fala de quem
   não conversa (Psicólogo, dev agent) não segura.
2. **É o único sinal com TETO: 8 horas**, contadas do FIM do turno do agente
   (o `created_at` daquele evento), não do último heartbeat. A api devolve o
   instante (`aguardandoUsuarioDesde`) e o engine aplica o teto
   (`SESSION_CONVERSATION_IDLE_TIMEOUT_MS`, default `28800000`). Passado ele, a
   sessão fecha `closed` com causa PRÓPRIA, `conversation_idle_timeout` — não
   `heartbeat_timeout`, porque quem lê `termination_reason` (o Psicólogo, uma
   métrica por sessão) precisa separar a aba que sumiu da conversa que ninguém
   retomou. O `TerminationClassifier` a lê como `:timeout`: a api conhece seis
   causas nas hipóteses, e abrir uma sétima seria mudar aquele contrato.
   **O teto vale com a aba ABERTA também** (AT-152): o `SessionServer` tem um
   relógio próprio (`:conversation_idle_check`, a cada 5 min — sem variável de
   ambiente, só o hook de teste `:session_conversation_idle_check_ms`),
   independente do heartbeat — o ping da aba não o reseta nem o adia. A cada volta ele lê a pendência e só FECHA por teto (mesma causa,
   `conversation_idle_timeout`); api fora do ar, sem pendência ou pendência sem
   instante apenas reagendam, porque quem encerra por api fora do ar continua
   sendo o heartbeat. Antes, o teto só era checado quando o heartbeat expirava, e
   uma aba aberta (ping a cada ~10s) o tornava inalcançável: sessão imortal.
3. **Sinal sem teto vence.** Com handoff `offered`, ação `pending`, agente em
   turno ou dev agent trabalhando, o instante volta `null` e a sessão fica sem
   teto, como sempre ficou. É por isso que o sinal é o ÚLTIMO da lista.
4. **Instante presente e ilegível é ERRO, nunca `nil`.** `nil` com
   `pending: true` é pendência sem teto; um formato quebrado viraria sessão
   imortal. Como erro, cai no caminho da api fora do ar — encerra por
   heartbeat, dizendo por quê.

**A regra, pelo lado da sessão encerrada:**

5. **Sessão `closed`/`closed_abnormally` recusa evento de CONVERSA** com 409
   NOMEADO: `{ message, reason: "sessao_encerrada", status, type }`. `closing`
   ainda aceita — a trava é de estado TERMINAL.
6. **"Conversa" tem duas cláusulas, e as duas são necessárias.** O TIPO só
   existe como conversa (`chat.message`, `chat.structured_question[_answered]`,
   `agent.status`, `agent.activated`, `handoff.offered`/`accepted`,
   `readiness.confirmed`, `necessity.validated`,
   `architecture.readiness_confirmed`), OU o ATOR é um agente conversacional (os
   seis mais `dev-lead` e `infra`). Uma lista de PERMITIDOS por tipo foi medida
   e recusada: quem escreve legitimamente numa sessão fechada são os
   CONSUMIDORES do fechamento — o Psicólogo roda um `ToolLoop` contra ela e grava
   `tool.call`, `agent.response`, `agent.error`; a Anamnese grava os próprios
   desfechos —, e eles falam o MESMO vocabulário genérico do Criativo. O tipo é
   igual; quem difere é o ator.
7. **A decisão humana sobre ação continua entrando.** `action.approved`/
   `action.denied` e os desfechos de execução não são conversa: a ação é item de
   uma fila DURÁVEL que sobrevive à sessão, e recusar a decisão deixaria uma
   pendência impossível de resolver. O caso normal nem chega aqui (ação
   `pending` segura a sessão, sinal 2 da RN-064); ele só existe quando a sessão
   morreu por outra porta.
8. **A recusa não deixa rastro.** O estado vem do MESMO `UPDATE` que reserva o
   `seq` (sem consulta a mais no caminho mais quente, sob o mesmo lock de linha
   da transição), e a recusa lança dentro da transação: o incremento volta, o
   `seq` segue sem buraco. O chat humano, que grava `chat.message` sem o funil,
   tem a mesma trava. Os casos de uso com efeito ANTES do evento recusam antes
   do efeito: `CreateHandoff` antes de criar a linha, `AcceptHandoff` antes de
   marcar `accepted` (que ativaria o agente seguinte), `ActivateAgent` antes de
   chamar o engine.
9. **O fechamento PARA os conversacionais.** `SessionLifecycleWorker`, por onde
   todo fechamento passa (heartbeat, conversa ociosa, humano, crash), para os
   conversacionais da sessão em TODOS os nós (`Engine.Agents.Conversacionais`,
   por `:erpc` — o registro é local e o job cai em qualquer réplica). O turno em
   curso é ABANDONADO no `terminate/2` dos seis servidores
   (`TurnoAssincrono.abandonar/1`): a task morre sem gravar nem transmitir nada,
   porque gravar seria pedir à api o que ela recusa. Não há resposta a dar:
   desde a [RN-578](../engine.md#rn-578) (ADR 0163) quem disparou o turno já recebeu `:ok`
   no aceite. Pelo mesmo motivo o `offer_dev_handoff` que o Arquiteto guardou
   para o fecho do turno NÃO roda quando o fecho é o da sessão — o handoff
   seria recusado (desde a [RN-672](parte-08.md#rn-672) não há mais o que guardar: o
   handoff ao Dev Lead sai da Infra). O Infra Lead, que roda o turno dentro do `handle_call`, é
   morto se não sair em 5s.
10. **A recusa nunca é calada no engine.** Quase todo chamador de
    `append_event/3` descarta o retorno; o cliente registra o 409
    `sessao_encerrada` como aviso no log, e o retorno segue o mesmo.
11. **A tela reconhece o 409 pelo CÓDIGO e diz que a sessão fechou** (AT-154).
    `ehRecusaDeSessaoEncerrada` confere `status === 409` E
    `body.reason === "sessao_encerrada"` — nunca o texto, e nunca só o 409, que
    também é "turno em andamento". Nas quatro ações de conversa (enviar
    mensagem, responder pergunta estruturada, confirmar prontidão do Criativo e
    do Arquiteto) a tela mostra uma frase própria em vez do erro genérico, refaz
    a leitura da sessão (é o `status` novo que faz o composer sumir) e NÃO perde
    o que foi digitado: a mensagem volta ao rascunho e aparece somente leitura
    no lugar do composer, e as respostas do formulário continuam nos campos. A
    frase não promete "Reabrir" — a ação não existe. E o botão "Encerrar" fica
    inerte nos DOIS estados terminais (`sessaoEhTerminal`, o espelho de
    `isTerminal`), não só em `closed` (AT-155).

**O que esta regra NÃO fecha:** o teto só é aferido quando o HEARTBEAT expira —
com a aba aberta e mandando heartbeat, a sessão continua viva sem teto, como
sempre (quem está olhando não é conversa ociosa). A resposta do chat humano
stateless a um turno que COMEÇOU com a sessão aberta entra mesmo que ela feche
no meio (o ator é o modelo, e o gasto já foi medido). `deploy/k8s/` não carrega
`SESSION_CONVERSATION_IDLE_TIMEOUT_MS`, e desde a AT-153 isso é DECISÃO escrita
no Deployment do engine, não pendência: lá nada intercepta o ambiente, a
ausência é o default do `runtime.exs`, e escrever o número faria uma segunda
cópia sem guarda contra divergir — mudar o teto ali é um item `env:` no patch do
engine do overlay. Os TRÊS composes o mapeiam com o default do código (o de
instalação só desde a AT-153, e até ali a linha no `.env` de uma instalação era
inerte), guardados por `scripts/ci/teto-ocioso-nos-composes.spec.ts`. Desde a AT-154 a tela trata o
409 com frase própria (item 11); as demais ações da tela que gravam em sessão
fechada seguem mostrando a mensagem da api.

- **Código:** `apps/web/src/lib/sessao-encerrada.ts`
  (`ehRecusaDeSessaoEncerrada`, `sessaoEhTerminal`);
  `src/domain/sessions/conversa-em-sessao-encerrada.ts:56`
  (`AGENTES_CONVERSACIONAIS`), `:67` (`TIPOS_DA_CONVERSA`), `:95`
  (`ehEventoDeConversa`), `:117` (`garantirQueSessaoAceitaEvento`);
  `src/application/use-cases/sessions/append-session-event.use-case.ts:45`
  (`conflitoDeSessaoEncerrada`), `:114` (o estado no mesmo `UPDATE` do `seq`),
  `:248` (`garantirQueAceita`);
  `src/infrastructure/persistence/drizzle/session.repository.ts:117`
  (`incrementSeq`);
  `src/application/use-cases/llm/send-chat-message.use-case.ts:78`
  (o chat humano); `src/application/use-cases/agents/create-handoff.use-case.ts:67`,
  `accept-handoff.use-case.ts:90`, `activate-agent.use-case.ts:52`;
  `src/application/use-cases/sessions/get-session-pending-work.use-case.ts:30`
  (`FALA_DO_AGENTE`), `:238` (o quinto sinal);
  `src/infrastructure/persistence/drizzle/session-event.repository.ts:124`
  (`findLatestOfTypesInSession`);
  `apps/engine/lib/engine/sessions/session_server.ex:115` (a pendência com
  instante), `:141` (`handle_info` do relógio próprio, AT-152), `:168`
  (`conversa_ociosa`), `:193` (`encerrar`), `:222`
  (`conversation_idle_timeout_ms`); `apps/engine/lib/engine/sessions/monitor.ex:185`
  (`classify`); `apps/engine/lib/engine/psychologist/termination_classifier.ex:46`;
  `apps/engine/lib/engine/sessions/engine_api_client.ex:1227`
  (`narrar_recusa_de_sessao_encerrada`), `:1592` (`pendencia_da_resposta`);

  `apps/engine/lib/engine/sessions/engine_api_client.ex:1227`
  (`narrar_recusa_de_sessao_encerrada`), `:1592` (`pendencia_da_resposta`);
  `apps/engine/lib/engine/agents/conversacionais.ex:49` (`parar_da_sessao`),
  `:69` (`parar_da_sessao_no_cluster`);
  `apps/engine/lib/engine/agents/turno_assincrono.ex:471` (`abandonar`);
  `apps/engine/lib/engine/workers/session_lifecycle_worker.ex:88`
  (`parar_conversacionais`); `apps/engine/config/runtime.exs:79`
- **Teste:** `test/application/use-cases/sessions/conversa-em-sessao-encerrada.spec.ts:144`
  (sessão encerrada recusa `chat.message` com 409 nomeado — caso de falha),
  `:167` (sem evento e sem `seq` consumido), `:183` (Psicólogo e Anamnese
  continuam entrando), `:211` (decisão sobre ação continua entrando), `:223`
  (sessão ativa aceita — caminho feliz), `:244` (`closing` aceita), `:258`
  (`SendAgentMessage` não chama o engine), `:263` (nenhum handoff órfão),
  `:276` (o aceite não ativa ninguém), `:309` (a ativação não sobe o
  agente); `test/application/use-cases/sessions/get-session-pending-work.use-case.spec.ts:478`
  (o Criativo respondeu: pendente com o instante), `:519` (o usuário falou por
  último), `:546` (quem não conversa não segura), `:563` (sinal sem teto vence);
  `apps/engine/test/engine/sessions/session_lifecycle_test.exs:87` (dentro do
  teto, reagenda), `:106` (acima do teto, `conversation_idle_timeout`,
  `closed`), `:124` (o default é 8h), `:151` (pendência sem instante segue sem
  teto), `:152` e `:194` (AT-152: com a aba aberta — pings — a conversa ociosa
  além do teto fecha, e dentro do teto não fecha); `apps/engine/test/engine/sessions/pendencia_de_conversa_test.exs:28`
  (instante inválido vira erro); `apps/engine/test/engine/agents/conversacionais_test.exs:60`
  (para só os da sessão), `:85` (AT-204: pid já morto no Registry não entra na lista de parados), `:126` (`session.closed` para o Criativo vivo);
  `apps/engine/test/engine/agents/turno_assincrono_test.exs:161` (abandonar não
  grava nem transmite, e não responde de novo), `:194` (o `terminate/2` abandona);
  `apps/engine/test/engine/psychologist/termination_classifier_test.exs:20`
- **Origem:** AT-072 — `exp001`; decisões do mantenedor em 2026-09-18 (teto de
  8h e causa própria; sessão encerrada recusa conversa, nomeado)

## O repositório nasce no aceite do handoff ao Arquiteto, e a execução não começa sem ele (RN-582) {#o-repositorio-nasce-no-aceite-do-handoff-ao-arquiteto-e-a-execucao-nao-comeca-sem-ele-rn-582}

### RN-582 — O aceite do handoff ao Arquiteto provisiona o repositório; o aceite ao Dev Lead é a segunda porta, idempotente; e `execution/activate` sem repositório é 409 nomeado {#rn-582}

Revisa o GATILHO da [RN-522](parte-06.md#rn-522), que cumpria a promessa da
[RN-541](../web.md#rn-541). O mecanismo não muda — o mesmo `ProvisionRepositoryUseCase`,
chamado pelo mesmo `AcceptHandoffUseCase`, sempre `local`, com a falha virando
`repository.provision_failed` e nunca derrubando o aceite. Decisão estrutural
no [ADR 0165](../../adr/0165-o-repositorio-nasce-no-handoff-ao-arquiteto.md).

**O que a instalação real mostrou (AT-092, v6.1.0, 2026-09-14).** O Arquiteto
propôs `open_adr_pr` três vezes antes de o repositório existir; os handoffs a
`infra` e `dev-lead` foram oferecidos juntos, só o de `infra` foi aceito, e
`POST /projects/:id/execution/activate` respondeu **201**. As tabelas
`project_repositories`, `project_git_connections` e `repo_bootstraps` ficaram
vazias — o projeto sem repositório para sempre. Dois defeitos: o gatilho vinha
DEPOIS de quem precisa do repositório (Arquiteto e Infra Lead escrevem nele
antes do Dev Lead), e o único gatilho era PULÁVEL (ativar a execução não exige
o aceite ao Dev Lead).

**1. O gatilho é o aceite do handoff ao `arquiteto`.** O Arquiteto só é ativado
por handoff `accepted` endereçado a ele (`canActivateAgent`), e esse handoff
nasce do PO (`offer_handoff(to_agent: "arquiteto")`) ou do usuário (handoff
manual) — as duas portas passam pelo mesmo aceite. O provisionamento roda
ANTES de `activateAgent`: o Arquiteto acorda num projeto que já tem onde
escrever. Consequência: o Infra Lead, ativado por handoff DO Arquiteto, nunca
mais acorda sem repositório.

**2. O aceite ao `dev-lead` continua provisionando, como SEGUNDA PORTA.** É a
saída do projeto que passou pelo Arquiteto antes desta regra (o `exp001` da
AT-092: Arquiteto aceito, Dev Lead `offered`) e a retomada natural de um
provisionamento que falhou no aceite ao Arquiteto. Com o repositório `created`
já de pé, a segunda chamada não cria nada — nem repositório, nem sessão, nem
linha de bootstrap, nem branch, nem commit —, e isso está provado pelas DUAS
portas em sequência contra o Postgres e o `LocalGitProvider` de verdade.

**3. `execution/activate` sem repositório é RECUSADO com 409**, logo depois da
checagem de `module_map` e ANTES de qualquer efeito (orçamento persistido,
`permissions.json`, sessão, engine, evento). A frase é escolhida pelo estado dos
handoffs do projeto, lidos por `HandoffRepository.findByProject` (de todas as
sessões — o handoff ao Arquiteto mora na do PO): handoff ao Arquiteto
`offered` → aceite-o; senão ao Dev Lead `offered` → aceite-o; senão algum dos
dois já `accepted` → o provisionamento não deixou repositório, veja o
`repository.provision_failed` e use a página de provisionamento
(`/projects/:id/provisioning?provider=local`); senão → nenhum handoff ao
Arquiteto foi aceito. Um handoff oferecido a OUTRO agente nunca vira instrução
de aceite (aceitar a Infra não provisiona nada). Repositório ADOTADO conta como
repositório. Recusar e não provisionar aqui é decisão: provisionar dentro da
ativação esconderia um efeito de git, e os agentes anteriores a ela seguiriam
sem repositório.

**4. A tela tira o controle e diz o motivo uma vez, em texto** (a régua da
[RN-102](parte-03.md#rn-102) e do [ADR 0064](../../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)). Na seção de Execução da Visão Geral, com o
`GET .../git/repository` respondendo `null` CONFIRMADO, "Ativar execução" fica
inerte no lugar, o texto diz onde o repositório nasce, e há um link para
provisionar. No card do handoff ao Dev Lead, dentro da sessão, o atalho
"Ativar execução" sai e o card diz que aceitar aquele handoff provisiona o
repositório. Carregando ou com erro, nada tranca — "não sei" não vira "não
tem", e o backend recusa de qualquer forma. Aceitar um handoff invalida a
consulta do repositório, porque o aceite pode tê-lo criado.

**A sessão técnica não desloca a de trabalho (AT-131).** A sessão que o
provisionamento abre (`repo_bootstraps.session_id`, nome `git-bootstrap`) nasce
no MEIO da fase do Arquiteto, e escolher "a mais recente" só por `createdAt` a
punha no lugar da sessão de trabalho até a próxima nascer (ADR 0165 deixou isso
declarado). Agora as duas leituras por `createdAt` do resumo do workspace
(`latestSessionId` e o corte das não lidas) ordenam por "é sessão de bootstrap"
ANTES de `createdAt`, e a Visão Geral (`useLatestSession`) faz o mesmo. A técnica
só é a mais recente quando é a ÚNICA — no fluxo manual de provisionamento é nela
que o projeto começa. A api lê o marcador por `repo_bootstraps`; a web só tem o
NOME da sessão, e renomeá-la faz as duas divergirem (a Visão Geral então trata o
resumo como de outra sessão e não o usa). O critério não muda o que o ADR 0165
decidiu (onde o repositório nasce), por isso não há ADR novo.

> **Revista pela [RN-592](#rn-592) (AT-183):** a web deixou de ler o NOME — a
> listagem de sessões devolve o marcador `technical`, pelo mesmo vínculo em
> `repo_bootstraps`, e renomear a sessão não faz mais as duas divergirem.

**A recusa da ativação não manda aceitar handoff de sessão encerrada
([RN-581](#rn-581), AT-131).** Aceitar handoff numa sessão terminal é 409
`sessao_encerrada`, checado ANTES de o handoff virar `accepted` — então nada é
provisionado pela metade. A frase da recusa agora consulta o estado da sessão de
cada handoff `offered`: só o que mora em sessão ABERTA vira "aceite-o"; se o
único `offered` está em sessão encerrada, a frase diz isso e aponta a página de
provisionamento. Sessão não encontrada conta como aberta ("não sei" não vira
"encerrada"). Os eventos que o provisionamento grava não caem na RN-581: o ator
é `system` e o destino é a sessão `git-bootstrap`, recém-criada. O que segue
NÃO coberto: a Visão Geral e o card do handoff na sessão lêem o estado do
repositório, não o de cada sessão, e não mudaram.

- **Onde:**
  `src/application/use-cases/agents/accept-handoff.use-case.ts:66`
  (`AGENTES_QUE_PROVISIONAM_O_REPOSITORIO`, gatilho e segunda porta) e `:141`
  (o ramo, antes de `activateAgent`);
  `src/application/use-cases/execution/activate-execution.use-case.ts:143`
  (a recusa, antes de qualquer efeito);
  `src/domain/execution/repositorio-para-executar.ts:50`
  (`motivoDeExecucaoSemRepositorio`, e os dois nomes de agente que o aceite
  também usa); `src/infrastructure/persistence/drizzle/handoff.repository.ts:55`
  (`findByProject`); `apps/web/src/routes/ProjectOverviewTab.tsx:369` e `:511`;
  `apps/web/src/routes/SessionPage.tsx:147`; `apps/web/src/routes/session-timeline-montagem.tsx:495`;
  `apps/web/src/lib/session-acoes-de-handoff.ts:122`;
  `apps/engine/lib/engine/projects/project_repository.ex:74` (o texto da recusa
  da [RN-577](../engine.md#rn-577), que nomeava o gatilho antigo e muda junto)
- **Teste:**
  `test/application/use-cases/agents/accept-handoff.use-case.spec.ts`
  ("aceitar para o Arquiteto provisiona `local` com o slug do projeto", "o
  repositório nasce ANTES de o Arquiteto acordar", "aceitar para o Dev Lead
  continua provisionando `local` (segunda porta)");
  `test/application/use-cases/agents/accept-handoff-provisiona-uma-vez.spec.ts`
  (as duas portas contra o banco: "UM createRepo, UMA linha, nenhuma falha", e
  "o exp001: Arquiteto aceito SEM repositório, e a segunda porta provisiona");
  `test/application/use-cases/execution/activate-execution.use-case.spec.ts:725`
  ("sem repositório: 409, e NENHUM efeito antes da recusa", "a frase nomeia o
  handoff ao Dev Lead pendente — a saída do exp001", "repositório ADOTADO conta
  como repositório"); `test/domain/execution/repositorio-para-executar.spec.ts`;
  `test/infrastructure/persistence/handoff-por-projeto.repository.spec.ts`;
  `apps/web/src/routes/ProjectOverviewTab.test.tsx:409`, `:427` e `:440`;
  `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx:575`;
  `apps/engine/test/engine/agents/arquiteto_server_test.exs:134` e
  `apps/engine/test/engine/infra/infra_lead_server_test.exs:520` (a recusa
  nomeia o gatilho novo)
- **Origem:** AT-092 — instalação real da v6.1.0 em 2026-09-14, decidido pelo
  mantenedor em 2026-09-18

### RN-583 — O critério de roteamento do hub é do binding, viaja com ele, e congela no metering {#rn-583}

Um binding de modelo pode guardar um **critério de roteamento** —
`routing_preference`: `price`, `throughput` ou `latency` — que diz ao HUB
como escolher o upstream que serve o modelo. Anulável: `null` é o
comportamento de sempre, nada vai ao fio e o hub decide sozinho.

1. **Viaja com o binding que venceu, nunca cascateia sozinho.** A cascata
   continua sendo de binding: o nível vencedor traz o modelo E o critério
   dele. O nível que a cascata PULA (modelo indisponível, sem tool calling)
   leva o critério junto — sobreviver só o critério produziria combinação que
   ninguém escolheu.
2. **Escrita em três formas.** No `PUT .../model-binding` dos cinco escopos,
   `routingPreference` **ausente** preserva o gravado se o provider do modelo
   novo declara a capability, e vira `null` se não declara; **`null`** limpa;
   **valor** para provider sem a capability é **422**
   (`RoutingPreferenceNotSupportedError`). Invariante: nenhum binding guarda
   critério para provider que não o declara.
3. **Congela o que FOI AO FIO.** `token_usage.routing_preference` é gravado
   por chamada, ao lado do `upstream_provider` da [RN-042](parte-01.md#rn-042): o critério
   enviado, e `null` quando o binding não tinha ou quando o provider não
   declara a capability (o que não foi enviado não é procedência de nada).
   Mesma régua do preço congelado (ADR 0042).
4. **Capability de PROVIDER, só com prova.**
   `LLMProviderCapabilities.routingPreference` é obrigatória nos nove, e é
   `true` SÓ no OpenRouter desde 2026-09-29 (AT-158): o smoke com credencial
   real (`openrouter-provider.roteamento.smoke.spec.ts`) mostrou o critério
   MUDANDO o upstream que serviu — em `meta-llama/llama-3.3-70b-instruct`,
   `price` pousou na DeepInfra e `throughput` na Groq (`latency` foi Groq numa
   medição e CoreWeave na outra), enquanto sem critério o hub alternou
   Novita/DeepInfra. A prova é a DIFERENÇA, não o
   aceite: o modelo do default antigo (`~deepseek/deepseek-v4-flash-latest`)
   devolveu o MESMO upstream para os três critérios e sem critério, e isso não
   distingue "o hub respeitou" de "não havia escolha". Os outros oito seguem
   `false`, e para eles a feature continua DORMENTE: a rota recusa com 422, a
   tela diz em texto que o provider não tem a opção provada, e nada muda no
   fio. O que a prova NÃO afirma: qual upstream cada critério escolhe — isso
   é decisão do hub e muda com o tempo.

- **Onde:** `src/domain/llm/routing-preference.ts:56` (escrita),
  `src/domain/llm/routing-preference.ts:75` (o que vai ao fio),
  `src/domain/llm/binding-resolver.ts:100` (viaja com o binding),
  `src/application/use-cases/llm/record-llm-usage.use-case.ts:118`
  (congela no metering),
  `src/infrastructure/llm/openrouter-provider.ts:353` (`openrouterConfig`,
  a capability provada)
- **Teste:** `test/domain/llm/routing-preference.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`,
  `test/application/use-cases/llm/run-llm-turn.use-case.spec.ts`,
  `test/infrastructure/llm/openrouter-provider.contract.spec.ts`; a prova
  manual da capability é `test/infrastructure/llm/openrouter-provider.roteamento.smoke.spec.ts`
- **Origem:** [ADR 0166](../../adr/0166-preferencia-de-roteamento-no-binding-de-modelo.md) (AT-090)

### RN-590 — A pasta `docs/` dos artefatos é reconstruída do event log pelo MESMO tradutor do projetor vivo, sem tocar a outbox, e nunca sai como sucesso calado {#rn-590}

O [ADR 0148](../../adr/0148-artefatos-projetados-em-arquivo.md) chamou a pasta `docs/`
de reconstruível e declarou, no custo 3, que **não existia comando de
reprojeção**: apagar a pasta não a reconstruía, porque as linhas de outbox já
estavam marcadas. É a mesma lacuna que a [RN-569](#rn-569) fechou para o grafo,
num segundo consumidor. Medido por leitura do código: um restore do Postgres, a
perda do volume `project_workspaces` e a conversão de `execution_mode` (que não
toca `docs/`) deixam a pasta ausente ou no lugar antigo, e nada a reescreve.

**A regra:** `src/scripts/reprojetar-artefatos.ts`
(`pnpm --filter api artefatos:reprojetar`; `node scripts/reprojetar-artefatos.js`
na imagem) varre `session_events` e reescreve a pasta. Como na RN-569:

1. **Um tradutor só.** A tradução evento → pasta do agente, nome do arquivo e
   Markdown SAIU do `ArtifactProjector` para `ArtifactEventTranslator`; o
   projetor chega ao evento por uma linha de outbox, a reprojeção por cursor, e
   os dois o chamam. A superfície do projetor (construtor, `drainOnce`) não
   mudou. A lista do que é projetado continua sendo
   `ARTIFACT_PROJECTABLE_EVENT_TYPES` — tipo novo entra ali e é traduzido no
   mesmo lugar, nunca num segundo tradutor.
2. **Idempotente e nunca apaga.** O nome é função do evento (versionado:
   `<tipo>.md`; append-only: com o `seq`), então rodar de novo regrava os mesmos
   arquivos; retomar é rodar de novo, ou `--after-event` a partir do cursor
   impresso. Arquivo que o usuário pôs em `docs/` fica.
3. **Não toca a outbox** (`aggregate_type = 'artifact_projection'`): roda com a
   api de pé sem roubar, reabrir ou marcar linha.
4. **Nunca sucesso calado.** Diferente do grafo, não há destino que pare tudo
   (falha de escrita é do ITEM, ADR 0148): cada falha é contada e nomeada com o
   id do evento, o resto é gravado, e o processo sai com 1. `--project`
   inexistente é recusado sem gravar.

**O que esta regra NÃO fecha:** (a) os versionados (`module_map`,
`module_routing`, `project_image`, `c4_diagram`) mostram o ÚLTIMO evento em
ordem de `id`; `--after-event` começando entre duas versões pode deixar uma
mais antiga — só a rodada completa garante o vigente; (b) escreve na localização
ATUAL do projeto, e precisa enxergar o mesmo disco que a api; (c) não recria
`qa_verdict`/`secops_verdict`/`task_blocked`/`infra_delegation_files`, que nunca
foram arquivo; (d) sem medição de tempo em event log grande; (e) NÃO entra em
backup — é derivada, o argumento do [ADR 0152](../../adr/0152-backup-de-volumes-contra-compose.md).

- **Código:** `src/application/artifact-projection/artifact-event-translator.ts:21`
  (`ArtifactEventTranslator`), `:24` (`projetarEvento`);
  `src/application/artifact-projection/artifact-projector.ts:64`
  (o projetor monta o MESMO tradutor), `:131` (delega);
  `src/scripts/reprojetar-artefatos.ts:96` (`reprojetarArtefatos`),
  `:115` (o tradutor), `:137` (varredura por cursor sobre `session_events`),
  `:163` (a falha contada sem abortar), `:185` (`lerArgumentos`), `:241` (só a
  invocação direta reprojeta); `package.json:45` (`artefatos:reprojetar`)
- **Teste:** `test/scripts/reprojetar-artefatos.spec.ts:215` (projetor
  para frente → apaga a pasta → reprojeta → mesmos caminhos e conteúdos; segunda
  rodada idêntica; outbox intacta), `:254` (nunca apaga), `:265` (por projeto),
  `:275` (projeto inexistente — caso de falha), `:289` (falha de escrita contada
  sem abortar o resto — caso de falha), `:314` (argumento desconhecido);
  `test/application/artifact-projection/artifact-projector.spec.ts`
  (o projetor para frente, inalterado, sobre o tradutor extraído)
- **Origem:** AT-128 — a lacuna que o ADR 0148 declarou (custo 3)

### RN-591 — A instalação sem broker é dita na conversão de modo, em parar/remover e na proposta do Infra Lead, pela mesma fonte da RN-574 {#rn-591}

A [RN-573](#rn-573)/[RN-574](#rn-574) (ADR 0161) ensinaram a **criação** de
projeto e a **subida** na `/containers` a saber que a instalação não tem
broker (`BROKER_URL` vazia). O fechamento declarou fora o resto: a conversão de
modo, parar/remover e o Infra Lead. Esta regra leva as três portas, com a MESMA
fonte — `ContainerBrokerPort.configurado()` — e nenhuma rota nova. Ela diz que
a variável EXISTE, nunca que o broker responde (isso segue sendo
`naoObservado`, [RN-486](parte-05.md#rn-486)).

1. **Conversão de modo (`ExecutionModeSection`).** O campo
   `brokerConfigurado` já vinha em `GET .../projects-base`, que a seção já lê.
   Converter para `container`/`mounted` com a ausência **CONFIRMADA** (`false`)
   deixa o botão inerte e diz o motivo em texto; "consultando", consulta que
   falha e campo ausente NÃO afirmam nada — "não sei" não vira "tem" nem "não
   tem" — e não bloqueiam. Converter para `runner`, ou para o modo que o projeto
   já tem, nunca é bloqueado. É regra de TELA, como a da criação: o
   `PUT projects/:projectId/execution-mode` não a aplica.
2. **Parar/remover na `/containers`.** `container_stop`/`container_remove` em
   `container`/`mounted` também passam pelo broker
   ([RN-495](parte-05.md#rn-495)), então sem ele só podem terminar em falha: a tela deixa
   "Parar"/"Remover" inertes com texto próprio (`sem_broker_para_parar`), `!==
   true` como na subida. `runner` nunca cai aqui.
3. **A api recusa ao propor.** `ProposeActionUseCase` responde 409
   `sem_broker_na_instalacao`, ANTES de criar a proposta, para
   `container_start`/`container_stop`/`container_remove` em projeto que não é
   `runner` quando `configurado()` é `false`. É a decisão de COMO o Infra Lead
   sabe sem HTTP no laço: o engine não lê `BROKER_URL` (uma segunda fonte
   divergiria da `configurado()`), e a chamada que a tool JÁ fazia devolve a
   recusa. `dispatch_container_start/2` passou a entregar ao modelo o TEXTO da
   mensagem da api (`container_start recusado: …`), como resultado de
   ferramenta ([RN-163](../engine.md#rn-163)), e não a tupla
   crua. A [RN-566](../engine.md#rn-566) segue como estava: recusa por MODO, local.

**O que NÃO fecha:** a proposta às cegas por ausência de IMAGEM continua
possível (a [RN-566](../engine.md#rn-566) já declarava); a recusa da api vale também para
quem chama sem ser o agente, o que é o desejado — a aprovação só terminaria
`failed`; e o `PUT execution-mode` continua aceitando a conversão por chamada
direta.

- **Código:** `src/application/use-cases/actions/propose-action.use-case.ts:90`
  (recusa 409), `apps/web/src/routes/containers-subida.ts:181`
  (`semBrokerParaCicloDeVida`) e `:192` (`conversaoSemBroker`),
  `apps/web/src/routes/settings/ExecutionModeSection.tsx` (botão inerte),
  `apps/engine/lib/engine/infra/infra_lead_server.ex:886`
  (`motivo_da_recusa_da_api`)
- **Teste:** `test/application/use-cases/actions/propose-action.use-case.spec.ts:207`
  (409 nas três ações, e `container_stop` segue `pending` com broker),
  `apps/web/src/routes/containers-subida.test.ts` (as duas funções, três
  estados), `apps/web/src/routes/settings/conversao-de-modo.test.tsx`,
  `apps/web/src/routes/ContainersPage.test.tsx`,
  `apps/engine/test/engine/infra/infra_lead_server_test.exs` (o texto do 409
  chega ao modelo)
- **Origem:** AT-105 — declarado fora do recorte pelo ADR 0161

### RN-592 — A listagem de sessões diz qual é a técnica, pelo vínculo em `repo_bootstraps`, e a tela lê o marcador em vez do nome {#rn-592}

A [RN-582](#rn-582) (AT-131) fez a sessão técnica do provisionamento — a de
`repo_bootstraps.session_id` — deixar de deslocar a sessão de trabalho como "a
mais recente", mas com DOIS critérios: a api a reconhecia pelo vínculo em
`repo_bootstraps`, e a web pelo NOME (`git-bootstrap`). O nome é rótulo que o
usuário renomeia ([RN-098](../web.md#rn-098)), então renomear a sessão fazia a Visão Geral
e o resumo do workspace discordarem de qual era a sessão de trabalho.

1. **A api devolve o marcador.** Cada item de `GET /projects/:projectId/sessions`
   carrega `technical: boolean` (`SessionListItemResponseDto`), `true` só para a
   sessão de `repo_bootstraps.session_id` DAQUELE projeto (uma por projeto,
   `unique(project_id)`). É o MESMO critério do resumo do workspace
   (`sessaoTecnicaDeBootstrap`), nunca o nome: renomear não muda o marcador, e
   uma sessão de trabalho chamada `git-bootstrap` não vira técnica.
2. **Só a listagem o carrega.** O marcador não é coluna de `sessions` nem campo
   da entidade `Session`: o GET de uma sessão e as respostas de
   criar/renomear/transicionar seguem com `SessionResponseDto`, sem ele. É a
   listagem que a tela ordena para achar "a mais recente".
3. **A tela lê o marcador.** `sessaoMaisRecente` (`useLatestSession`) pula a
   sessão com `technical: true` e só a devolve quando é a ÚNICA — a regra da
   RN-582 inalterada, com a fonte trocada. O tipo `SessaoListada` do web tira o
   campo do tipo GERADO do OpenAPI.

**O que NÃO fecha:** a Visão Geral e o card do handoff na sessão continuam sem
consultar o estado da sessão de cada handoff (a lacuna que a RN-582 declarou);
decidir se passam a consultá-lo é decisão à parte, fora desta regra.

- **Código:** `src/application/use-cases/sessions/list-sessions-for-project.use-case.ts:30`
  (`execute`), `src/interfaces/http/sessions/dto/sessions.response.dto.ts:110`
  (`SessionListItemResponseDto`), `apps/web/src/lib/hooks.ts:147`
  (`sessaoMaisRecente`)
- **Teste:** `test/application/use-cases/sessions/list-sessions-for-project.use-case.spec.ts:81`
  (vínculo e não nome; técnica de outro projeto não marca),
  `apps/web/src/lib/sessao-mais-recente.test.ts:28` (renomeada continua fora) e
  `:36` (trabalho chamada `git-bootstrap` não é técnica)
- **Origem:** AT-183 — achado da AT-131

### RN-595 — Toda `_PREVIOUS` que um serviço lê chega a ele pelos três composes, vazia por padrão {#rn-595}

As três rotações sem downtime (`AUTH_JWT_SECRET`, `BRABO_SERVICE_TOKEN`,
`CREDENTIALS_MASTER_KEY`) dependem de o processo ver o valor antigo numa
variável `_PREVIOUS` durante a janela. O Compose não repassa o ambiente do
host, e nenhuma das três estava no `environment:` de compose nenhum: definir a
`_PREVIOUS` no `.env` não tinha efeito, e quem seguia o runbook fazia, sem
saber, a troca seca que a rotação existe para evitar. Agora a api recebe as
três, e o engine e o broker recebem `BRABO_SERVICE_TOKEN_PREVIOUS`, nos composes
de dev, de produção e de instalação, sempre com default VAZIO — definida é
rotação em andamento, e um default preenchido deixaria a instalação
eternamente no meio de uma. Vazia é o mesmo que ausente nos três leitores.

- **Onde:** `docker/docker-compose.yml`, `docker/docker-compose.prod.yml` e
  `docker/docker-compose.install.yml` (serviços `api`, `engine` e `broker`);
  os leitores são `src/infrastructure/security/auth-key-material.ts:136`
  (`passphraseAnterior`), `src/infrastructure/security/service-token.ts:92`
  (`tokenDeServicoAnterior`), `src/infrastructure/security/envelope-encryption.service.ts:93`,
  `apps/engine/config/runtime.exs:70` e `apps/broker/src/config.ts:85`
- **Teste:** `scripts/ci/previous-nos-composes.spec.ts` — DERIVA do código dos
  três serviços a lista de `_PREVIOUS` lidas e reprova a que faltar, ou vier
  com default não vazio, em qualquer um dos três composes; o bloco "ExternalSecret
  do k8s" reprova o `ExternalSecret` sem `dataFrom.extract`, uma `_PREVIOUS` em
  `data:` e o Deployment de api/engine sem `envFrom: brabo-secrets`
- **Kubernetes (AT-220, decisão do mantenedor):** os Pods leem
  `envFrom: brabo-secrets`, e o `ExternalSecret`
  (`deploy/k8s/base/common/externalsecrets.yaml`) puxa o objeto `brabo`
  INTEIRO do store por `dataFrom.extract` — a `_PREVIOUS` entra quando existe
  e sai quando é retirada, na sincronização seguinte. Não pode ser listada em
  `data:`: o ESO não tem chave opcional, e propriedade ausente (o estado
  normal) reprova a sincronização do Secret inteiro. Custo declarado: TODA
  chave do objeto vira variável de api, engine, migrações e backup, e a chave
  OBRIGATÓRIA ausente deixou de reprovar a sincronização — quem acusa é o
  consumidor. A sincronização por um ESO real foi exercitada à mão num k3d
  descartável, não em CI
- **Origem:** AT-201 (achado da AT-196), mesma classe da RN-540; metade
  Kubernetes na AT-220

### RN-597 — Trocar o pepper é logout global {#rn-597}

O pepper que chaveia o HMAC dos tokens opacos não tem `_PREVIOUS`, e trocá-lo
tem consequência, não procedimento: todo refresh token em circulação, todo link
de verificação de e-mail e de redefinição de senha em aberto e todo token de
acesso pessoal (PAT) deixam de ser achados, porque o hash recalculado com o
pepper novo não casa com o gravado. A refresh recusada registra
`refresh_unknown` (e não `refresh_reuse_detected`), o link diz "Link inválido
ou expirado", e os baldes de lockout mudam de chave — conta travada destrava. A
SENHA sobrevive (argon2id com salt por registro, sem pepper): trocar o pepper
custa um login, nunca uma conta, e a api sobe normalmente com o valor novo.

Até a [RN-613](#rn-613), o pepper sem valor próprio caía no
`AUTH_JWT_SECRET`, e a rotação do JWT era também a do pepper, com todas as
consequências acima. Desde ela o pepper é obrigatório em produção e nunca
emprestado do JWT.

- **Onde:** `src/infrastructure/security/auth-key-material.ts:212`
  (`pepper`), `:228` (`hashDeToken`), `:247` (`baldeDeEmail`);
  `src/interfaces/http/auth/pat-auth.guard.ts:142`
- **Teste:** `test/application/use-cases/auth/rotacao-dos-segredos.spec.ts`,
  contra o Postgres de teste
- **Borda:** o ALVO de "trocar" inclui o erro de quem separa o pepper do JWT
  gerando um valor novo em vez de copiar o atual — é a mesma troca, e desloga
  do mesmo jeito (fixado no mesmo spec, "a ordem errada").
- **Origem:** [ADR 0031](../../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md),
  AT-196

### RN-598 — O token de serviço ANTERIOR passa pela mesma régua do atual {#rn-598}

Durante a rotação, `BRABO_SERVICE_TOKEN_PREVIOUS` abre `/internal/*` tanto
quanto o atual. Ele passa por UMA régua, a mesma do atual (`exigirTokenDeProducao`),
e nenhuma cópia dela. O espaço em volta é descartado, e um valor feito só de
espaço conta como ausente. Em produção, o literal público de desenvolvimento
(`dev-service-token-change-me`) e um valor com menos de 16 caracteres depois
do trim DERRUBAM o boot da api, com uma mensagem que nomeia
`BRABO_SERVICE_TOKEN_PREVIOUS`. Antes disso, a variável era comparada crua: um
anterior com o valor de exemplo abria a porta interna a qualquer um que
tivesse lido este repositório, e sem dar erro nenhum. A obrigatoriedade é a
única parte da regra do atual que NÃO é copiada, porque fora da rotação o
anterior ausente é o estado normal. Um anterior igual ao atual (depois do
trim) continua não contando como rotação.

- **Onde:** `src/infrastructure/security/service-token.ts:63`
  (`exigirTokenDeProducao`), `:92` (`tokenDeServicoAnterior`);
  `src/main.ts:50` (`tokenDeServicoAnterior`), que roda no boot ao lado do atual
- **Teste:** `test/infrastructure/security/service-token.spec.ts` (describe
  "tokenDeServicoAnterior (RN-598)")
- **Borda:** esta RN é o lado da api. O engine e o broker aplicam a mesma
  régua desde a [RN-601](../engine.md#rn-601).
- **Origem:** AT-205 (achado da AT-196)

### RN-603 — O modo automático libera o escopo de caminho, e só ele {#rn-603}

Decisão do dono do produto em 2026-09-26 (AT-226,
[ADR 0167](../../adr/0167-modo-automatico-libera-o-escopo-de-caminho.md)): com o
"Modo automático" ligado num agente — a curinga `"*"` da
[RN-153](parte-03.md#rn-153) resolvida como `auto_approve` —, o agente roda QUALQUER
comando de terminal sem pedir aprovação, INCLUSIVE fora da pasta do projeto.
O teto de escopo de caminho do ADR 0055 deixa de valer para esse agente.
Medido no `exp001` (modo `mounted`, container de pé): 51 comandos pediram
aprovação com o modo ligado, 47 só por citar `/work` ou `/tmp` — o dev agent
roda no container e o escopo compara com a raiz do HOST.

`decide()` passa a receber a ORIGEM da autonomia (`ctx.autonomyOrigin`:
`'especifica'` ou `'curinga'`), resolvida pelo MESMO repositório que já
resolvia a precedência — `findMode` virou leitura de `resolve`, não uma
segunda régua. Só a curinga em `auto_approve` é modo automático
(`modoAutomaticoDoAgente`); origem ausente vale como específica. Em modo
automático, dois pedidos deixam de existir: o teto de ESCOPO e o
`require_approval` que o comando COMPOSTO sintetiza quando um segmento não tem
regra nenhuma em `permissions.json` (o arquivo sem opinião, que nunca rebaixa
um estágio anterior) — sem o segundo, `cd /work && npm test` seguiria pedindo.

Continua tudo como estava, em modo automático também: `deny` (do arquivo, dos
padrões embutidos ou de autonomia específica) vence; um `ask` ESCRITO no
arquivo pede; o teto de efeito externo/comando privilegiado (push, PR,
deploy, `sudo`/`doas`, [RN-418](parte-04.md#rn-418)) roda antes e não
olha a origem; merge em branch protegida, `instruction_patch`,
`parallelize`/`raise_max_parallel` e `container_remove` nunca são
auto-aprováveis ([RN-154](parte-03.md#rn-154)). Regra específica do tipo vence a curinga
no repositório e chega como `'especifica'`: `terminal: require_approval` com a
curinga ligada segue pedindo. Desligar (o toggle do card do agente grava a
curinga como `require_approval`) restaura o teto. Desde a
[RN-670](parte-08.md#rn-670) (ADR 0189) a específica `auto_approve`
sob a curinga `auto_approve` — o que "Sempre permitir" de dev agent grava —
resolve como a CURINGA, e não desliga mais o modo automático; e, fora dele, o
escopo compara com a pasta REAL de execução ([RN-669](parte-08.md#rn-669)).

A tela diz, antes do clique, o que o modo libera e o que continua pedindo: a
nota do `ApprovalCard` aparece nas DUAS variantes (chat e fila de Aprovações),
e o card do agente mostra uma frase sob o toggle — só quando a CURINGA está
ligada, porque o toggle sobre o tipo representativo grava regra específica,
que não libera o escopo.

- **Onde:** `src/domain/actions/decide.ts:311` (`modoAutomaticoDoAgente`),
  `src/domain/actions/decide.ts:386` (o veredito sintetizado do
  composto ignorado), `src/domain/actions/decide.ts:504` (o teto de
  escopo pulado),
  `src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts:25`
  (`resolve`, com a origem),
  `src/application/use-cases/actions/propose-action.use-case.ts:249`
  (`autonomyOrigin`), `apps/web/src/components/AgentTeamGrid.tsx:114`
  (`autonomyHint`), `apps/web/src/components/ApprovalCard.tsx:313` (a nota
  nas duas variantes)
- **Teste:** `test/domain/actions/decide.spec.ts` ("modo automático
  libera o escopo de caminho (RN-603)": fora do escopo e composto auto-aprovam;
  push/`sudo`/`deny`/`ask` escrito seguem; regra específica e curinga
  desligada não liberam; os outros tetos não mudam),
  `test/application/use-cases/actions/propose-action.use-case.spec.ts`
  (ponta a ponta com o repositório real),
  `test/infrastructure/persistence/drizzle/agent-autonomy.repository.spec.ts`
  (`resolve` devolve a origem), `apps/web/src/components/AgentTeamGrid.test.tsx`,
  `apps/web/src/components/AgentCard.test.tsx`,
  `apps/web/src/components/ApprovalCard.test.tsx`
- **Origem:** decisão do dono do produto (AT-226) depois do teste no `exp001`

### RN-604 — A chamada ao broker tem um teto POR OPERAÇÃO, e o teto estourado diz que foi o teto {#rn-604}

O cliente HTTP do broker aplicava UM teto, 5 s, às cinco operações. O
docblock o justificava pelo caminho de LEITURA de tela ([RN-486](parte-05.md#rn-486)), e
ele valia também para `exec` — cujo pedido CARREGA o próprio `timeoutMs` — e
para `start`, que espera o `docker run` e o pull de imagem que ele faz.
Reproduzido na AT-233: um broker falso que responde um `exec` em 6 s, com
`timeoutMs` de 8 s, voltava como `BrokerIndisponivelError('sem-resposta')` —
"o broker de container não respondeu … The operation was aborted due to
timeout". Ou seja, todo comando de terminal com mais de 5 s num projeto
`container`/`mounted` com container `running` ([RN-492](../engine.md#rn-492)) falhava
dizendo que o broker estava fora do ar, enquanto o comando seguia rodando.

E o engine cortava também: a chamada `container-exec` não passava
`receive_timeout` e caía no default do Req, 15 s — o MESMO default de
`TERMINAL_ACTION_TIMEOUT_MS`. Reproduzido com uma api falsa (Bandit) que
responde em 16 s: `{:error, %Req.TransportError{reason: :timeout}}`. Subir o
teto só na api não consertaria nada.

A regra:

1. **`inspect` segue curto (5 s)** — é a leitura da `/containers` e da rota
   de ciclo de vida, e uma tela que espera o pior caso do broker é pior do que
   uma que declara "não observado".
2. **`exec` DERIVA do `timeoutMs`** (ou do default de 15 s do broker, quando
   vem sem ele): contexto do broker (10 s) + `ps` (30 s) + o maior entre o
   comando e o `docker version` de diagnóstico (30 s) + 5 s de margem. O
   broker corta o comando em `timeoutMs` e RESPONDE `timedOut: true`; a api
   tem de estar esperando quando a resposta chega.
3. **`start`/`stop`/`remove` esperam o pior caso do PRÓPRIO broker**: contexto
   \+ `ps` + a operação (o `run` com o pull; o `stop` com os 10 s de graça;
   `rm --force`) + o `docker version` que ele roda quando ela falha, mais a
   margem. Esperar isso é esperar a RESPOSTA do broker, inclusive a recusa
   nomeada dele. A conta nasceu com 105 s e esquecia o SEGUNDO `ps` do
   `resolver` (o gerenciado e o homônimo): o pior caso real era 130 s. Desde a
   [RN-605](../contracts.md#rn-605) ela conta as seis chamadas de controle do `start` e dá
   195 s.
4. **O engine espera mais que a api**: `timeoutMs` + 90 s. A cadeia é broker <
   api < engine, e os testes dos dois lados a conferem (a api espelha a folga
   do engine como `FOLGA_DO_EXEC_NO_ENGINE_MS`, e o teste do engine lê esse
   número do fonte da api).
5. **Teto estourado tem motivo próprio**: `BrokerIndisponivelError` ganha
   `teto-excedido`, distinto de `sem-resposta` (conexão recusada, DNS), e a
   mensagem nomeia a operação e o número — e, nas longas, a consequência: o
   comando pode seguir rodando no container; o `run`/pull pode ter acontecido,
   então confira `/containers` antes de repetir. Na leitura da tela
   `teto-excedido` cai no MESMO `naoObservado: 'broker-sem-resposta'` de
   sempre, com o texto no `detalhe` — nenhum valor novo no DTO.

Os números do outro lado (`TIMEOUT_DE_CONTROLE_MS`,
`TIMEOUT_DE_EXEC_PADRAO_MS`, o `TIMEOUT_MS` do cliente de contexto do broker)
são ESPELHADOS em constantes nomeadas, não importados: a api não consome o
pacote da porta de Docker. Nada muda na contenção do broker ([ADR
0130](../../adr/0130-broker-de-container.md)), na `DockerPort` nem na
[RN-502](../engine.md#rn-502).

**Declarado, não fechado:**

- **Pull de mais de 30 s continua falhando — no broker.** O pull roda sob o
  `TIMEOUT_DE_CONTROLE_MS` (30 s) da porta de Docker, e uma imagem grande não
  sobe na primeira tentativa. Desde a [RN-605](../contracts.md#rn-605) o estouro tem NOME
  (`PullExcedeuTetoError`, origem `infra`) em vez de "código -1" com
  `origem: null`; o teto em si não subiu, por decisão do mantenedor.
- **O `fetch` do Node espera cabeçalhos por no máximo 300 s.** Um `exec` com
  `timeoutMs` acima de ~255 s é cortado pelo undici antes do teto desta regra;
  o erro sai `teto-excedido` nomeando os 300 s. O salto de fora
  (`/internal/actions/execute`, api → engine) também não tem teto explícito e
  cai nos mesmos 300 s, então `TERMINAL_ACTION_TIMEOUT_MS` acima de ~210 s
  não chega inteiro.
- **Broker doente no `ps`** (o `docker ps` levando os 30 s inteiros e o
  diagnóstico outros 30) pode exceder o teto do `exec` com comando curto;
  sai `teto-excedido`, com o nome certo.

- **Código:**
  `src/infrastructure/http-clients/container-broker.client.ts:287` (`tetoDaOperacao`),
  `:252` (`TETO_DE_MUTACAO_MS`), `:264` (`FOLGA_DO_EXEC_NO_ENGINE_MS`),
  `:324` (`erroDeTransporte`);
  `src/application/ports/container-broker.port.ts:110` (`MotivoDeBrokerIndisponivel`);
  `apps/engine/lib/engine/sessions/engine_api_client.ex:2120` (`teto_do_container_exec_ms`)

  `apps/engine/lib/engine/sessions/engine_api_client.ex:2120` (`teto_do_container_exec_ms`)
- **Teste:** `test/infrastructure/http-clients/container-broker.client.spec.ts:286`
  (a reprodução, contra um broker `node:http` que demora 6 s), `:182` (o
  teto de cada operação no `AbortSignal`), `:204` e `:229` (`teto-excedido`
  nomeando operação e número), `:245` (o teto do undici), `:330` (describe
  `tetoDaOperacao`, incluindo a ordem broker < api < engine);
  `test/application/use-cases/containers/spec-e-observacao-de-container.use-case.spec.ts:298`
  (a tela continua dizendo `broker-sem-resposta`);
  `test/application/use-cases/containers/executar-comando-no-container.use-case.spec.ts:98`;
  `apps/engine/test/engine/sessions/engine_api_client_container_exec_test.exs:72`
  (a reprodução do lado do engine, HTTP real com Bandit), `:91` (a folga
  espelhada na api)
- **Origem:** AT-233

### RN-609 — `proposed_action.created` diz QUAL raiz o escopo comparou, relativa e nunca absoluta {#rn-609}

A [RN-567](#rn-567) pôs no evento a REGRA que decidiu (`reason`) e declarou o
que ficava de fora: o ponto 7 do
[ADR 0055](../../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) pede *qual
escopo* autorizou, e `escopo: cd dentro da pasta do projeto` não diz qual
pasta era o escopo naquele dia. A raiz muda — conversão de modo, base
nova —, e o evento é o único lugar que guarda o que valia no instante da
decisão.

**A regra:** o payload do evento de SESSÃO `proposed_action.created` de uma
ação `terminal` ganha `scopeRoot`, com três campos — `executionMode`,
`ancora` e `segmento`:

| modo | `ancora` | `segmento` |
|---|---|---|
| `container` | `raiz_gerenciada` | o `workspace_dir_name` — a raiz É `<PROJECT_WORKSPACES_ROOT>/<segmento>` |
| `mounted` | `base_de_projetos` | o pedaço sob `BRABO_PROJECTS_BASE`, pela MESMA `segmentoSobABaseDeProjetos` que o broker usa |
| `mounted` (sem base, fora dela, ou a própria base) | `indisponivel` | `null` |
| `runner` | `nome_da_pasta` | o `workspace_dir_name` — identifica a pasta sem ser relativo a nada que o servidor conheça |

**Nunca o caminho absoluto, e isso é a decisão (AT-147, do mantenedor).** O
event log é lido por todo membro do projeto e evento não se reescreve; em
`mounted`/`runner` a raiz é uma pasta da máquina do usuário, com o `$HOME`
dele no caminho. Por isso `indisponivel` existe: cair no caminho absoluto
"para não perder informação" seria exatamente o vazamento. No `runner` a base
local do agente nunca atravessa a rede, então não há segmento relativo que o
servidor possa calcular — a `ancora` diz que o valor é um NOME e não um
caminho.

**Só em `terminal`.** É o único tipo em que `decide()` consulta o escopo
(`terminalNoEscopo`); nos outros o campo não existe, em vez de existir
dizendo algo que a decisão não usou. A derivação é a de `projectScopeRoot` —
`raizDoEscopoNoEvento` mora ao lado dela, no mesmo arquivo, e não é segunda
régua: o que ela faz é EXPRIMIR a mesma raiz sem a parte absoluta.

**Aditivo, e ausente não é "sem raiz".** Evento gravado antes desta regra, ou
de outro tipo, não tem o campo; não há reprocessamento nem coluna nova. O
outbox não o carrega, pelo mesmo motivo da [RN-567](#rn-567) (sem
consumidor no engine). Nada em `decide()` muda, nenhum teto, e a tela não
muda — onde ele aparece é outra entrega (AT-148). (Desde a
[RN-614](../web.md#rn-614) a raiz aparece junto do motivo, na linha do evento no painel
de log e no `ApprovalCard`, sempre relativa e com texto próprio para
`indisponivel`.) A web lê o payload como
registro genérico, então evento antigo e novo passam pela mesma leitura.

**Declarado:** em `mounted`, o segmento é relativo à base configurada NO
INSTANTE da decisão — se a base mudar depois, o segmento antigo continua
dizendo o que era verdade então, que é o ponto. E a separação entre escopo e
`permissions.json` ([RN-478](parte-05.md#rn-478)) não entra no campo: ele descreve a
raiz do ESCOPO, nunca onde o arquivo de política mora.

- **Código:** `src/infrastructure/filesystem/project-workspaces-root.ts:907`
  (`raizDoEscopoNoEvento`), `:901` (`RaizDoEscopoNoEvento`), `:117`
  (`segmentoSobABaseDeProjetos`, reusada);
  `src/application/use-cases/actions/propose-action.use-case.ts:330`
  (`scopeRoot` só em `terminal`);
  `src/domain/actions/decide.ts:648` (`terminalNoEscopo`, o único
  consumidor do escopo)
- **Teste:** `test/application/use-cases/actions/propose-action.use-case.spec.ts:1154`
  (`container`), `:1134` (`mounted`), `:1134` (`runner`), `:1123` (o caminho
  absoluto sob `/home/usuario/…` NUNCA vaza, nos três casos, inclusive fora
  da base), `:1224` (`indisponivel`), `:1163` (outro tipo e o outbox sem o
  campo), `:1183` (evento anterior, sem o campo, pela mesma leitura);
  `test/infrastructure/filesystem/project-workspaces-root.spec.ts:772`
  (a função pura, nos três modos e nos três casos de `indisponivel`)
- **ADR:** [0055](../../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) (ponto 7)
- **Origem:** AT-147 (EP-025/HS-043)

### RN-611 — A chave de MÁQUINA ganha listagem e revogação por CONTA, sem `:projectId`: só as de máquina, só as do próprio usuário, e a revogação é a MESMA de sempre {#rn-611}

A lacuna que a [RN-552](parte-06.md#rn-552) e a [RN-561](../web.md#rn-561) declararam por escrito:
*"numa instalação que ainda não tem PROJETO, a listagem e a revogação — as duas
por `/projects/:projectId/runner-device-keys` — não têm projeto contra o que
responder"*. A instalação de uma linha ([RN-547](../produto.md#rn-547)) cria EXATAMENTE essa
situação: a conta e a chave de máquina nascem **antes** de qualquer projeto, e a
chave ficava viva e inalcançável. Decisão do mantenedor (AT-118): **sim, na
Conta**.

**Duas rotas novas, e só duas.** `GET /users/me/machine-device-keys` lista e
`DELETE /users/me/machine-device-keys/:deviceKeyId` revoga (204, idempotente).
Sem `@RequireRole`, como `users/me/credentials` e `users/me/preferences`: o
escopo é a PRÓPRIA pessoa, e não há projeto nem workspace contra o que resolver
um papel. O `userId` vem do JWT de sessão e vai para o `WHERE`; nenhum
parâmetro nomeia outra pessoa, e a visão de `maintainer` sobre a chave alheia
continua **fora** por decisão da [RN-519](parte-06.md#rn-519) — esta rota não a reabre por
outra porta.

**Só a espécie de MÁQUINA.** A listagem devolve SÓ `project_id IS NULL`
(`especie: "maquina"`), revogadas INCLUÍDAS (a régua da RN-519: sumir com a
linha faria a tela afirmar que a chave nunca existiu). As de PROJETO têm casa —
a seção `device-keys` do projeto delas, onde o alcance de revogá-las é dito — e
trazê-las para a Conta faria a Conta derrubar pareamento de projeto sem nomear
o projeto. Pela mesma razão, a revogação por conta recusa chave de PROJETO com
**404**, a MESMA resposta de chave que não existe ou que é de outra pessoa: a
pergunta vai à MESMA listagem da tela, filtrada por `userId`, então não há como
perguntar pela chave alheia e aprender que ela existe.

**O que revogar derruba de fato, e o alvo NÃO muda.** A revogação por conta não
é uma revogação nova: `RevokeMachineDeviceKeyUseCase` confere que a chave está
entre as de máquina do chamador e DELEGA a `RevokeRunnerDeviceKeyUseCase`, byte
a byte. Ele grava a linha e, para a chave de máquina, pede ao engine um
`disconnectRunnerOfUser` por projeto em modo `runner` que o dono alcança
([RN-520](parte-06.md#rn-520)/[RN-543](../produto.md#rn-543)). O alvo continua `{projeto, usuário}` e
**nunca** `{chave}`: outro runner do mesmo usuário nesses projetos cai junto,
mesmo com PAT ou outra chave, e reconecta se a credencial dele ainda valer.
Numa instalação **sem projeto**, a lista de projetos é vazia e a revogação só
grava a linha — e é o que basta: o agente de máquina que espera o primeiro
projeto ([RN-550](../runner.md#rn-550)) não tem conexão nenhuma a derrubar, e o próximo
ticket que ele pedir é recusado. Mudar o alvo continua sendo frente própria,
com ADR (AT-013).

**"Registrar substitui a anterior" FICA.** A [RN-552](parte-06.md#rn-552) tinha duas razões
para revogar a chave de máquina anterior a cada registro: (a) o token de serviço
não pode fabricar credenciais duradouras em série, e a máquina reinstalada não
pode deixar para trás uma chave viva que ninguém lembra de revogar; (b) a
órfã seria INALCANÇÁVEL. Esta RN derruba a (b) e deixa a (a) intacta — ela não
depende de tela. O que muda é que a substituída passa a APARECER, revogada, na
Conta; e como ninguém a revogou pela tela, a seção diz em TEXTO que reinstalar
revoga a anterior, para a linha não ser lida como incidente.

**A tela mora na Conta** (`/account`), a página que já existia para o que segue a
pessoa entre projetos. Ela lista nome, data de criação, último uso e status, e
herda o vocabulário INTEIRO da [RN-561](../web.md#rn-561)/[RN-548](../web.md#rn-548):
`lastUsedAt` é uso REGISTRADO, nunca conexão, e nulo tem texto próprio ("nunca
usada"); "ativa"/"revogada" fala da LINHA e nunca de agente de pé — e "ativa"
**não** é verde, porque a espécie de máquina nunca ganha verde e ali só há
dela. Não há coluna de espécie: com uma espécie só ela repetiria a mesma
palavra em toda linha, e o que ela carregava na seção de projeto — o ALCANCE — é
dito na legenda e na confirmação ("derruba o agente local em TODOS os seus
projetos em modo runner; sem projeto nenhum, só impede a chave de ser usada de
novo"), junto com o custo colateral da RN-520. Carregando, falhou, vazio,
revogada e nunca usada são cinco estados com cinco textos
([RN-088](../web.md#rn-088)/[RN-470](../web.md#rn-470)). Sem papel mínimo
no endpoint, a tela não inventa um: `roleAtLeast` aqui trancaria quem pode, o
defeito pior dos dois.

**Revogar por uma lista invalida TODAS.** A chave de máquina aparece na lista
da Conta (`['machine-device-keys']`) e na de TODO projeto do dono
(`['runner-device-keys', projectId]`, lida pelo `RunnerOnboardingPanel` e pela
seção `device-keys`). `invalidarChavesDeDispositivo` invalida a por projeto por
PREFIXO (todo projeto no cache) e a da Conta sempre, e as DUAS telas de
revogação a chamam — antes, revogar pela seção do projeto invalidava só a do
projeto aberto, e as outras listas seguiam anunciando a revogada.

- **Código:** `src/interfaces/http/runner/machine-device-keys.controller.ts:48`
  (`MachineDeviceKeysController`), `:69` (`listMachineDeviceKeys`), `:93`
  (`revokeMachineDeviceKey`);
  `src/application/use-cases/auth/list-machine-device-keys.use-case.ts:33`
  (`ListMachineDeviceKeysUseCase`);
  `src/application/use-cases/auth/revoke-machine-device-key.use-case.ts:33`
  (`RevokeMachineDeviceKeyUseCase`);
  `src/infrastructure/persistence/drizzle/runner-device-key.repository.ts:97`
  (`listarDeMaquinaDoUsuario`);
  `apps/web/src/routes/MachineDeviceKeysSection.tsx:73`
  (`MachineDeviceKeysSection`);
  `apps/web/src/lib/chaves-de-dispositivo-queries.ts:31`
  (`invalidarChavesDeDispositivo`);
  `apps/web/src/lib/api-client.ts:455` (`listMachineDeviceKeys`);
  `apps/web/src/locales/{en,pt-BR}/machineKeys.json`
- **Teste:** `test/application/use-cases/auth/machine-device-keys.use-case.spec.ts`
  (a lista só pelo usuário, a revogada incluída; a revogação REAL derrubando
  `{projeto, usuário}` em cada projeto; sem projeto, só grava; a chave fora das
  do chamador é 404 sem revogar nada);
  `test/interfaces/http/runner/machine-device-keys.controller.spec.ts`
  (sem `@RequireRole`, 204, `userId` do JWT, o 404 propagado);
  `test/infrastructure/persistence/drizzle/runner-device-key.repository.spec.ts`
  (contra o Postgres: só as de máquina do usuário, a substituída revogada na
  lista, a de outro usuário fora, instalação sem projeto);
  `apps/web/src/routes/MachineDeviceKeysSection.test.tsx` (lista, os cinco
  estados, a confirmação com o alcance, a invalidação da Conta E de todo
  projeto — provada também sobre uma entrada de projeto no cache —, a falha com
  a frase da api, e os dois idiomas);
  `test/interfaces/route-surface.spec.ts` (as duas rotas classificadas
  `jwt` em `docs/security-surface.md`)
- **Fica declarado e NÃO fecha:** (1) o alvo da revogação continua
  `{projeto, usuário}` (RN-520, AT-013); (2) a visão de `maintainer` continua
  fora (RN-519); (3) a rota que CRIA chave de máquina continua servindo só
  instalação de UMA pessoa (RN-552) — a Conta lista e revoga, não cria.
- **Origem:** AT-118 (EP-003/HS-007)

### RN-613 — `AUTH_TOKEN_PEPPER` é obrigatório e próprio; quem migra o define com o `AUTH_JWT_SECRET` atual {#rn-613}

O pepper do HMAC dos tokens opacos (refresh, links de conta, PATs, balde de
lockout) deixou de cair no `AUTH_JWT_SECRET`. O fallback silencioso
(`AUTH_TOKEN_PEPPER ?? passphraseAtual()`) fazia de toda rotação "sem
downtime" do JWT uma troca do pepper, e era o caminho COMUM: os composes de
produção e de instalação nem repassavam a variável. Em produção a api RECUSA
subir sem ele, e a recusa diz o conserto — *"defina com o valor ATUAL de
AUTH_JWT_SECRET para não deslogar ninguém"* —, porque a correção óbvia (gerar
um aleatório) é a que desloga todo mundo. Com o pepper igual ao JWT antigo o
hash é byte a byte o de antes, os refresh tokens e os PATs seguem válidos, e
daí em diante o JWT rotaciona sozinho. Pepper igual ao JWT NÃO é recusado: é o
estado legítimo de toda instalação migrada. Valem as réguas do JWT (RN-114):
em branco, os dois literais de exemplo do repositório e menos de 16 caracteres
derrubam o boot. Fora de produção vale um default de desenvolvimento PRÓPRIO
(`dev-auth-token-pepper-change-me`), nunca o do JWT.

O `install.sh` faz a migração: instalação NOVA gera um pepper aleatório;
havendo um `.env` anterior na pasta, ele é LIDO (nunca executado) antes de ser
sobrescrito, e o pepper dele é mantido — ou, sem pepper, nasce com o
`AUTH_JWT_SECRET` dele. O terminal diz de onde o valor veio, nunca o valor.

- **Onde:** `src/infrastructure/security/auth-key-material.ts:168`
  (`pepperAtual`), `:212` (`pepper`); `src/main.ts:46` (a checagem de
  boot); `install.sh:702` (`valor_no_env_anterior`), `:734` (`gerar_segredos`),
  `:831` (`dizer_a_origem_do_pepper`); a variável nos três composes
  (`docker/docker-compose.yml`, `docker-compose.prod.yml`,
  `docker-compose.install.yml`), no `docker/smoke.sh` e no `.env.example`
- **Teste:** `test/infrastructure/security/auth-key-material.spec.ts`
  (describe "pepperAtual (RN-613)": recusa sem pepper mesmo com JWT, a
  mensagem, os exemplos, o piso, igual ao JWT aceito, o default de dev);
  `test/application/use-cases/auth/rotacao-dos-segredos.spec.ts` (describe "a
  migração do RN-613": o refresh gravado com a fórmula ANTIGA segue válido com o
  pepper igual ao JWT antigo e sobrevive à troca do JWT; o describe do
  `AUTH_JWT_SECRET`: sem pepper fora de produção, trocar o JWT não desloga);
  `scripts/dev/install-env.spec.ts` (describe "o AUTH_TOKEN_PEPPER do
  instalador (RN-613)", contra `docker compose config`, valor inteiro)
- **Borda:** o instalador só enxerga o `.env` da pasta em que roda. Instalação
  cujo `.env` mora em outro lugar, compose próprio e Kubernetes com
  `ExternalSecret` fazem a migração à mão, pelo runbook — no Kubernetes a
  propriedade `AUTH_TOKEN_PEPPER` já existia no `ExternalSecret` e no
  `bootstrap.sh`, e um provider que não a tenha já reprovava a sincronização.
  E a migração do instalador apaga os volumes (ADR 0150): o refresh só
  sobrevive para quem restaura o dump do Postgres, que é o caso que importa.
- **Origem:** AT-210 (achado da AT-196), decisão do mantenedor: migração com o
  valor atual

### RN-615 — A remoção de membro de WORKSPACE nasce com o teto 2 herdado: remover a si mesmo é 403, e é essa cláusula que segura o último owner, sem contar {#rn-615}

A quinta porta da linha dos tetos ([RN-472](parte-05.md#rn-472), [RN-556](parte-06.md#rn-556),
[RN-557](../produto.md#rn-557)), e a rota que o
[ADR 0157](../../adr/0157-teto-de-auto-movimento-no-upsert-de-workspace.md) recusou
abrir de passagem. Até aqui `WorkspacesController` não tinha `@Delete` de
membro, e offboarding era escrita no banco. Decisão do mantenedor
(AT-115/HS-006): **a rota nasce, protegida por CLÁUSULA.**

**A rota.** `DELETE /workspaces/:workspaceId/members/:userId`, `owner` (o MESMO
mínimo do upsert), 204, idempotente.

**O teto é herdado, sem régua nova.** `remocaoEhAutoRebaixamento` recebe o papel
do ator no WORKSPACE como o efetivo de hoje e `null` como o papel de DEPOIS — no
workspace não há nível acima para segurar a queda, então remover a própria
linha é sempre queda para "nenhum acesso", o ramo que a função já enunciava
para o projeto sem linha de workspace. Remover a SI MESMO é **sempre 403**, com
frase própria: *"Você não pode remover a si mesmo deste workspace: aqui não há
papel acima para segurar a queda, e sem a linha você perde o workspace e todos
os projetos dele. Voltar exige o owner que você estaria abandonando. Peça a
outro owner."*

**O último owner, pela MESMA cláusula.** Só `owner` chama a rota; ninguém remove
a si mesmo; logo toda remoção bem-sucedida deixa ao menos o CHAMADOR como
`owner`. Tirar o último exigiria que ele se removesse — o movimento recusado. A
contagem segue recusada (ADR 0157, ponto 2). O mínimo `owner` da rota é METADE
da prova, e por isso é asserido em teste.

| movimento | desfecho |
|---|---|
| remover a SI MESMO do workspace, havendo ou não outro owner | **403** |
| remover OUTRO `owner` | passa — é como se revoga propriedade por inteiro |
| remover o TITULAR (`created_by`), por outro owner | **409** `criador_do_workspace` — [RN-616](#rn-616) |
| remover qualquer outra pessoa | passa |
| remover quem não tem linha de workspace | 204 — as linhas de projeto dele no workspace saem igual |

**A cascata, numa transação.** A linha de `workspace_members`; as linhas de
`project_members` do removido nos projetos DESTE workspace (sem elas a
sobreposição `projectRole ?? workspaceRole` da [RN-471](../web.md#rn-471) o manteria
dentro de todo projeto em que tivesse linha própria); e as credenciais dele
presas a esses projetos — chaves de dispositivo de PROJETO e PATs —, revogadas
com o motivo `workspace_member_removed`. Depois do commit, a conexão viva do
runner dele cai em CADA projeto do workspace pelo caminho da
[RN-520](parte-06.md#rn-520), em `try/catch` que só loga: engine fora do ar não derruba a
remoção.

**Declarado e NÃO feito:** a chave de MÁQUINA (é da conta e serve outros
workspaces; aqui ela deixa de alcançar porque o papel resolve para nenhum); o
socket de SESSÃO já conectado e o terminal `:web` do removido (seguem até cair;
o ticket novo é recusado); tela (não existe seção de membros de workspace no
`apps/web`). O TITULAR (`workspaces.created_by`) não sai por esta rota — é a
[RN-616](#rn-616).

- **Código:** `src/interfaces/http/iam/workspaces.controller.ts:262`
  (`removeMember`);
  `src/application/use-cases/iam/remove-workspace-member.use-case.ts:79`
  (`RemoveWorkspaceMemberUseCase`);
  `src/domain/iam/tetos-de-rebaixamento.ts:88`
  (`MENSAGEM_TETO_AUTO_REMOCAO_DO_WORKSPACE`), `:248`
  (`remocaoEhAutoRebaixamento`);
  `src/infrastructure/persistence/drizzle/workspace.repository.ts:84`
  (`removeMember`);
  `src/infrastructure/persistence/drizzle/project.repository.ts:167`
  (`removeMemberFromWorkspaceProjects`);
  `src/infrastructure/persistence/drizzle/runner-device-key.repository.ts:169`
  (`revogarChavesDeProjetoNoWorkspace`);
  `src/infrastructure/persistence/drizzle/personal-access-token.repository.ts:187`
  (`revogarDoUsuarioNoWorkspace`)
- **Teste:**
  `test/application/use-cases/iam/remove-workspace-member.use-case.spec.ts`
  (contra o Postgres: remove outro membro com a cascata inteira e nada fora do
  workspace; remove outro owner; engine fora do ar não derruba; idempotente;
  recusa a si mesmo sem escrever nada; frase própria; o owner único não sai; com
  dois owners, quem remove fica);
  `test/interfaces/http/iam/workspaces-members.controller.spec.ts`
  (`owner` nas duas rotas de membro, 204, a ordem ator/alvo, o 403 propagado);
  `test/interfaces/route-surface.spec.ts` (a rota classificada em
  `docs/security-surface.md`)
- **ADR:** [0173](../../adr/0173-remocao-de-membro-de-workspace.md)
- **Origem:** AT-115 (EP-002/HS-006)

---

### RN-616 — O TITULAR do workspace não sai pela remoção de membro: 409 `criador_do_workspace` até transferir, e a titularidade só vai para outro `owner` {#rn-616}

Decisão do mantenedor sobre a questão que a [RN-615](#rn-615) deixou aberta
(AT-115, [ADR 0173](../../adr/0173-remocao-de-membro-de-workspace.md), ponto 7).
`workspaces.created_by` não autoriza nada — quem autoriza é o papel
([RN-472](parte-05.md#rn-472)) —, mas é por ele que se resolve a credencial de LLM que os
agentes gastam e a de git das ações de agente
([RN-058](parte-02.md#rn-058)) e o dono do relatório de gasto
([RN-060](parte-02.md#rn-060)). Remover o criador deixaria os
agentes gastando a credencial de quem já não está no workspace. A coluna passa a
ser chamada, na regra, de **titular**.

**A recusa.** `DELETE /workspaces/:workspaceId/members/:userId` com alvo = titular
é **409** com `code: "criador_do_workspace"`: *"Não é possível remover o titular
do workspace: a credencial de LLM que os agentes gastam, a de git das ações de
agente e o relatório de gasto são dele (RN-058/RN-060). Transfira antes a
titularidade para outro owner (PUT /workspaces/:workspaceId/owner-of-record) e
remova depois."* O teto da RN-615 vem antes: o titular tentando se remover
recebe o 403 de auto-remoção.

**A transferência.** `PUT /workspaces/:workspaceId/owner-of-record`, `owner`,
corpo `{ userId }`, responde o workspace (200). O destino precisa JÁ ser `owner`
do workspace, senão **409** `titular_precisa_ser_owner` (*"A titularidade só vai
para quem já é owner deste workspace: o titular paga o que os agentes gastam
(RN-058). Promova a pessoa a owner antes, ou escolha outro owner."*). Grava
`created_by` numa transação com a leitura do papel; transferir para o titular
atual é idempotente. Qualquer `owner` pode transferir, inclusive para OUTRO
owner que não pediu — declarado, é a mesma autoridade que remove donos.

**O gasto, a partir do commit.** `ResolveCredentialOwnerUseCase` devolve o novo
titular: o turno de agente procura a credencial DELE para o provider do modelo,
e as ações de git a credencial de git dele. Sem credencial, o desfecho é o que
já existia — o turno termina com *"Nenhuma credencial cadastrada para
<provider>"* e a leitura do remoto git falha nomeando de quem é a credencial que
falta. A transferência NÃO confere isso antes (declarado no ADR). O gasto
registrado não se move: `token_usage` não guarda titular, e o relatório inteiro,
histórico incluído, passa a ser do novo titular. Sem evento de domínio: fica
uma linha de log com de/para/quem.

- **Código:** `src/domain/iam/titularidade-do-workspace.ts:22`
  (`CODIGO_CRIADOR_DO_WORKSPACE`), `:38` (`removeOTitular`);
  `src/application/use-cases/iam/remove-workspace-member.use-case.ts:120`
  (`removeOTitular`);
  `src/application/use-cases/iam/transfer-workspace-ownership.use-case.ts:39`
  (`TransferWorkspaceOwnershipUseCase`);
  `src/infrastructure/persistence/drizzle/workspace.repository.ts:98`
  (`transferirTitularidade`);
  `src/interfaces/http/iam/workspaces.controller.ts:324`
  (`transferOwnership`)
- **Teste:**
  `test/application/use-cases/iam/remove-workspace-member.use-case.spec.ts`
  (`describe` "o TITULAR não sai": o 409 com código e nada escrito; o titular
  removendo a si mesmo recebe o 403; depois de transferir, remover o antigo
  criador passa e o novo titular vira o protegido — e `describe`
  "TransferWorkspaceOwnershipUseCase": para owner grava `created_by`; para
  `maintainer` e para não-membro é 409 `titular_precisa_ser_owner`; para o
  titular atual é idempotente);
  `test/interfaces/http/iam/workspaces-members.controller.spec.ts`
  (`owner` e a delegação da transferência)
- **ADR:** [0173](../../adr/0173-remocao-de-membro-de-workspace.md), ponto 7
- **Origem:** AT-115 (EP-002/HS-006)

---
