---
id: rn-api-parte-06
title: 'Regras de negócio — API — parte 6 (desde RN-503)'
sidebar_label: 'API — parte 6 (desde RN-503)'
description: 'As RNs hospedadas na raiz api.'
keywords: [regras de negócio, api]
---

# API — parte 6 (desde RN-503)

## Projeto montado sobe container pelo BROKER (RN-503) {#projeto-montado-sobe-container-pelo-broker-rn-503}

### RN-503 — Projeto `mounted` sobe container pelo BROKER, e o que atravessa a rede é um localizador discriminado — nunca um caminho absoluto {#rn-503}

Um projeto no modo Pasta montada **não conseguia container nenhum** até aqui, e
por dois bloqueios independentes: `ExecuteContainerStartUseCase` mandava todo
modo diferente de `container` para o RUNNER (que exige um `brabo-runner`
conectado), e o broker recusava na fonte qualquer modo que não fosse
`container`, com `ModoDeExecucaoNaoSuportadoError`.

Os dois existiam pela mesma razão de GEOMETRIA, não pelo nome do modo: a pasta
de um projeto montado ficava num lugar arbitrário do disco do operador, que o
daemon Docker do servidor não tinha por que enxergar. O ADR 0141 (RN-500)
mudou essa geometria — todo projeto montado passa a morar sob **uma** base
montada por identidade —, e é isso, e só isso, que esta regra colhe.

**A ramificação passa a ser por DESTINO, não por modo.** `container` **e**
`mounted` vão ao BROKER; só `runner` vai ao runner, porque a pasta dele
continua numa máquina que este servidor não alcança (ADR 0137). Vale igual para
as três ações de ciclo de vida — `container_start`, `container_stop` e
`container_remove`: elas TÊM de mudar juntas, senão o container de um projeto
montado sobe no servidor e o pedido de parar vai procurá-lo na máquina do
usuário, deixando de pé, sem forma de parar, o que está de pé.

**O invariante do ADR 0130 não se mexe: nenhum caminho absoluto atravessa a
rede.** O broker é root-equivalente no host e COMPÕE o `-v` a partir das raízes
DELE; se a api mandasse `/home/voce/brabo/loja`, a contenção do bind-mount
passaria a depender de a api estar correta, que é exatamente a dependência que
o broker existe para não ter. O que muda é que agora existem DUAS raízes do
lado de lá, então a spec precisa DIZER contra qual delas o pedaço relativo
vale — e diz, num localizador discriminado:

| `localizacao.tipo` | segmento | raiz do broker |
|---|---|---|
| `gerenciada` | `workspace_dir_name` (RN-109) | `PROJECT_WORKSPACES_HOST_ROOT` |
| `montada` | o caminho RELATIVO sob a base | `BRABO_PROJECTS_HOST_BASE` |
| `indisponivel` | — (há `motivo`) | nenhuma |

**Três estados e não dois**, porque o terceiro existe de verdade e tem dois
consertos diferentes: projeto `runner` (a pasta está noutra máquina — o
conserto é o runner, do lado de lá) e projeto `mounted` LEGADO criado fora da
base (o conserto é mover a pasta). Colapsá-los num `null` faria a mesma
ausência mandar quem opera para o lugar errado. A pasta que É a própria base
também cai aqui, e não vira segmento vazio: `<raiz>/` montaria a base inteira
— a pasta de TODOS os projetos montados — dentro do container de um só.

**A falta de uma raiz nunca é suprida pela outra.** Sem
`BRABO_PROJECTS_HOST_BASE`, um `start` de projeto montado recusa **nomeando a
variável** (`BaseDeProjetosNaoConfiguradaError`, origem `infra`, 503) e não
toca container nenhum — mesmo molde de `RaizDeWorkspacesNaoConfiguradaError`.
Cair na outra raiz por omissão seria o pior desfecho possível: a raiz
gerenciada é nomeada por `workspace_dir_name` e a base é nomeada pelo usuário,
então o mesmo nome aponta para pastas diferentes e o container subiria com a
pasta de OUTRO projeto, sem nada indicando por quê. Pelo mesmo motivo, a lista
de modos que o broker atende é de PERMITIDOS: um modo novo no enum nasce
recusado, com mensagem, em vez de aceito por omissão.

**A composição continua passando por três barreiras, não uma.** A api recusa o
que não está sob a base (`segmentoSobABaseDeProjetos`); o broker recusa o
segmento que não é relativo (`segmentoDeProjetoValidado` — `..`, absoluto,
vazio, barra dupla, NUL); e o resultado da concatenação ainda passa por
`raizDeProjetoValidada` antes de virar `-v`. Validar o segmento e não validar a
concatenação seria confiar na aritmética de strings.

**`mounted` ELEGE a imagem, como `container` — não lê a vigente como o runner.**
Não é simetria estética: é o único desenho que funciona. O broker compõe a
partir de `artifact.project_image`, indo BUSCÁ-LO na api. Uma eleição da Infra
que não fosse gravada nesse artefato seria inerte — o container subiria com a
imagem que o Arquiteto decidiu, o payload que o humano aprovou diria outra, e
nada no registro denunciaria a diferença. O caminho do runner pode ler a
vigente justamente porque ali a api MANDA os campos da spec pelo canal; lá o
artefato não é a fonte que o outro lado consulta.

**O que esta regra NÃO faz:** não materializa pasta nenhuma — quem cria a pasta
do projeto montado é a [RN-501](parte-05.md#rn-501), no MESMO caso de uso e **antes** desta
ramificação, justamente porque o daemon do servidor precisa da pasta existindo
para montá-la. Também não toca o portão da imagem (RN-105 já vale para os três
modos desde a RN-494) e não muda quem PROPÕE `container_start` — o Infra Lead
segue podendo propor para um projeto sem runner conectado e sem imagem
decidida, a lacuna declarada desde a RN-494.

- **Onde:**
  `src/application/use-cases/containers/obter-spec-de-container.use-case.ts`
  (`LocalizacaoDoProjeto`, `localizacaoDoProjeto`);
  `src/infrastructure/filesystem/project-workspaces-root.ts`
  (`segmentoSobABaseDeProjetos`);
  `src/interfaces/http/internal/dto/container-spec-internal.response.dto.ts`;
  `src/application/use-cases/actions/execute-container-start.use-case.ts`,
  `…/execute-container-stop.use-case.ts`, `…/execute-container-remove.use-case.ts`
  (a ramificação `!== 'runner'`);
  `packages/docker-port/src/docker-port.ts` (`segmentoDeProjetoValidado`);
  `apps/broker/src/config.ts` (`baseDeProjetosNoHost`) e
  `apps/broker/src/operacoes.ts` (`raizDoProjetoNoHost`,
  `garantirModoSuportado`, `BaseDeProjetosNaoConfiguradaError`,
  `LocalizacaoIndisponivelError`)
- **Teste:**
  `test/application/use-cases/containers/spec-e-observacao-de-container.use-case.spec.ts`
  (`describe('… o localizador discriminado (RN-503)')`);
  `test/application/use-cases/actions/execute-container-{start,stop,remove}.use-case.spec.ts`;
  `packages/docker-port/src/docker-port.spec.ts`
  (`describe('segmentoDeProjetoValidado')`); `apps/broker/src/operacoes.spec.ts`
  e `apps/broker/src/config.spec.ts`
- **ADR:** [0130](../../adr/0130-broker-de-container.md),
  [0141](../../adr/0141-base-unica-dos-projetos-montados.md)
- **Origem:** plano do dono do produto, PR 3

---

## O artefato de decisão dos conversacionais (RN-505) {#o-artefato-de-decisao-dos-conversacionais-rn-505}

### RN-508 — `container_start_via_runner`: segundo tipo de ação para subir o container, exclusivo de `runner`, e o Infra Lead recusa às cegas ANTES de propor {#rn-508}

`container_start` (ADR 0130/0133) exige `imagem`/`network`/`resources`/
`rationale` — a Infra ELEGE uma candidata do roteamento do Arquiteto. Até
esta entrega, o mesmo tipo de ação também atendia `execution_mode: runner`
(`ExecuteContainerStartUseCase.executeViaRunner`), mas o caminho do runner
NUNCA lia nenhum desses quatro campos: a imagem que sobe é a que já estiver
DECIDIDA (não há roteamento contra o qual eleger, porque o broker nunca
alcança a pasta de um projeto `runner`). Pedir 4 campos que o dispatch sempre
descartava é o defeito que motiva nascer uma AÇÃO separada em vez de uma
`container_start` "inteligente" ramificando por modo.

**`container_start_via_runner` só tem `rationale` (opcional).** Mesmo calibre
de `container_start` (`maintainer`, `require_approval` por padrão, nunca
semeado em auto-aprovação, configurável em `permissions.json` como as
demais três ações de container — não entra no teto absoluto de
`container_remove`). `ExecuteContainerStartUseCase` perde o ramo `runner`
inteiro (`executeViaRunner`, `ApiToEngineClient`/`ObterSpecDeContainerUseCase`
saem do construtor) — fica exclusivo de `container`/`mounted`, os dois pelo
BROKER (RN-503). O código extraído vira
`ExecuteContainerStartViaRunnerUseCase`, mesmo arquivo-irmão. A dança de
ciclo de vida (`provisioning -> running`) que os dois caminhos compartilhavam
por cópia vira `SubirCicloDeVidaDoContainerUseCase`
(`.../containers/`) — extraída para não duplicar o racional da
máquina de estados nos dois arquivos.

**O Infra Lead consulta LOCALMENTE, sem HTTP, antes de propor.** A tool nova
(`Engine.Infra.Tools.ProposeContainerStartViaRunner`) é interceptada por
`Engine.Infra.InfraLeadServer.dispatch_calls/2`, que lê `Project.get/1`
(execution_mode) e `Engine.Runners.Registry.connected?/1` (runner conectado)
— as DUAS leituras já são locais, no mesmo processo BEAM — ANTES de chamar
`propose_action`. Recusa com motivo NOMEADO (nunca propõe às cegas) quando o
projeto está em `container` (usa `propose_container_start`), em `mounted`
(idem, desde a RN-503) ou em `runner` sem runner conectado agora. Esta
lacuna — "propor sem saber se dá certo" — é a MESMA que `propose_container_start`
tem desde a RN-494, declarada e aceita para aquela tool (tocar o prompt/
instrução do Infra Lead ficaria fora do escopo de API/domínio); a tool NOVA
nasce sem ela, porque nasce sabendo negar.

**A especificação que a api compõe é a que o runner VALIDA, e isso passou a
ser provado.** `EspecificacaoDeContainerParaRunner` são os campos de
`EntradaDeEspecificacao` (`packages/docker-port`) menos `raizDoProjeto`, que
só o runner conhece — DEZ, não nove. Ela nasceu com nove, sem `projectId`, e
a consequência foi que este caminho NUNCA subiu container nenhum desde que
existe: o engine repassa o mapa opacamente, o runner o entrega a
`especificacaoValidada`, que exige `projectId` como texto não vazio, e a ação
terminava `failed` com *"especificação de container recusada em `projectId`:
esperava texto não vazio, recebi undefined"* — e daí o bloqueio CORRETO da
[RN-507](../runner.md#rn-507)/[RN-502](../engine.md#rn-502) fazia o resto, sem nenhum dev agent
reivindicando tarefa. O dado sempre existiu (`SpecDeContainer.projectId`, o
mesmo que o BROKER recebe por `GET .../container-spec`, e é por isso que só o
modo `runner` quebrou); só não era copiado. Três suítes verdes não pegaram
porque cada uma montava o próprio fixture: o teste do caso de uso afirmava o
que ele mesmo esperava, o do runner montava um fixture COM `projectId`, e o
engine não olha o mapa. O que passa a ser garantido é a CORRENTE — o payload
que `ExecuteContainerStartViaRunnerUseCase` compõe, atravessando o
`especificacaoValidada` de verdade —, e o teste também trava o conjunto de
campos: `raizDoProjeto` é o único que a api não manda, então campo novo de um
lado sem o outro reprova.

- **Onde:** `src/domain/actions/decide.ts` (`container_start_via_runner`);
  `src/application/use-cases/actions/
  execute-container-start-via-runner.use-case.ts` (novo);
  `src/application/use-cases/containers/
  subir-ciclo-de-vida-do-container.use-case.ts` (novo);
  `src/application/use-cases/actions/propose-action.use-case.ts`;
  `src/application/use-cases/actions/approve-action.use-case.ts`;
  `src/application/ports/api-to-engine-client.port.ts`
  (`EspecificacaoDeContainerParaRunner`, os dez campos);
  `apps/web/src/lib/aprovacoes.ts`;
  `apps/engine/lib/engine/infra/tools/propose_container_start_via_runner.ex`
  (novo); `apps/engine/lib/engine/infra/infra_lead_server.ex`
- **Teste:**
  `test/application/use-cases/actions/execute-container-start.use-case.spec.ts`,
  `test/application/use-cases/actions/
  execute-container-start-via-runner.use-case.spec.ts` (novo),
  `test/contract/
  especificacao-de-container-para-runner.contract.spec.ts` (a CORRENTE —
  o payload composto pela api contra o `especificacaoValidada` de verdade),
  `apps/web/src/lib/aprovacoes.test.ts`,
  `apps/engine/test/engine/infra/tools/
  propose_container_start_via_runner_test.exs` (novo),
  `apps/engine/test/engine/infra/infra_lead_server_test.exs`
- **ADR:** [0145](../../adr/0145-docker-pre-requisito-do-runner.md)
- **Origem:** decisão do dono do produto — Docker vira pré-requisito real do
  modo `runner`, sem fallback pro host

---

## O navegador de pastas servido pela api (RN-504) {#o-navegador-de-pastas-servido-pela-api-rn-504}

### RN-509 — "Sempre permitir" de um Dev Agent de módulo escopa a `agent_autonomy`, POR AGENTE — não mais o `permissions.json` de projeto inteiro {#rn-509}

`ApproveAlwaysActionUseCase` sempre gravou em `permissions.json/allow` —
escopo de **PROJETO INTEIRO**, compartilhado por qualquer ator. Isso
significava que "sempre permitir" um comando pro `dev-checkout` liberava o
MESMO comando pro `dev-auth`, pro `dev-lead`, e pra qualquer agente futuro
do projeto: a intenção de quem clicou ("confio NESTE agente com ISTO") não
tinha como ser expressa — só existia "confio em qualquer um com isto".

**A gravação passa a se ramificar pelo ATOR**, dentro do MESMO use case (não
um novo — duplicar as duas guardas de teto absoluto de terminal fora de
escopo/`git_push`/`sudo` e de `container_remove` em dois lugares seria o
mesmo defeito que RN-418/RN-495 já existem para evitar):

- Ator `agent` cujo id é `dev-<modulo>` (ADR 0053/FASE 14d — a área
  DINÂMICA de `dev`, um agente por módulo do `module_map`): grava em
  `agent_autonomy(projectId, agentId, actionType) = auto_approve`, pelo
  MESMO `AgentAutonomyRepository.upsert` que
  `activate-execution.use-case.ts` já chama pra semear as três ações git
  por módulo. `permissions.json` fica intocado.
- Qualquer outro ator — `user`, `system`, agente `agent` que não é
  dev-de-módulo, e o `dev-lead` — continua indo pro `permissions.json/allow`
  de sempre, escopo de projeto inteiro, exatamente como antes.

**`dev-lead` é a exceção que precisa de nome próprio.** `ehDevDeModulo`
(`agent-areas.ts`) é `agentId.startsWith('dev-')` PURO, de propósito — e
isso classifica `dev-lead` como `true`. Quem exclui o lead da própria área
é `ehMembroDe`, não `ehDevDeModulo` sozinho ("o lead não é membro da própria
área" vale pra qualquer área — duplicar a exclusão dentro do predicado
deixava as duas cópias inalcançáveis por teste, achado registrado no
comentário do próprio `agent-areas.ts`). Por isso o branch usa
`ehDevDeModulo(actor.id) && actor.id !== DEV_LEAD`: sem o segundo termo,
"sempre permitir" clicado numa ação do `dev-lead` gravaria autonomia de
módulo sob o agentId do LEAD por acidente — um agente que não é membro de
`dev`, que não tem módulo, e que a área nunca olha via `agent_area_members`.

**Os dois tetos absolutos de `decide.ts` continuam rodando ANTES do branch,
sem mudar de ordem.** Terminal com efeito externo git (`git push`, `gh pr
create`) ou privilegiado (`sudo`/`doas`) — RN-106/RN-418 — e
`container_remove` — RN-495 — seguem recusando o clique INTEIRO (400, ação
nem aprovada), pra QUALQUER ator, antes mesmo do projeto ser buscado.
Escopar a gravação por agente não é uma segunda porta pro mesmo teto: os
dois `if` de recusa ficam onde estavam, e o branch novo entra depois.

**O evento `permission.granted` carrega um payload OU outro, nunca um
fingindo ser o outro.** `{ pattern }` continua sendo o formato do caminho de
`permissions.json` (o padrão de texto gravado no arquivo); o caminho novo
emite `{ agentId, actionType }` — não há "padrão" nenhum pra mostrar quando
a gravação é uma linha de tabela chaveada por agente.

**Sem migração de dados.** Entradas antigas de "sempre permitir" gravadas
para um dev-de-módulo em `permissions.json`, de antes desta regra existir,
continuam lá exatamente como estavam — só não recebem MAIS entradas desse
tipo dali pra frente. Decisão consciente do dono do produto, não lacuna
esquecida.

- **Onde:**
  `src/application/use-cases/actions/approve-always-action.use-case.ts`
  (o branch `ehAgenteDeModulo`), `src/domain/agents/agent-areas.ts`
  (`ehDevDeModulo`, `DEV_LEAD` — consumidos, não alterados),
  `src/application/ports/agent-autonomy-repository.port.ts`
  (`upsert`, já existente, sem método novo)
- **Teste:**
  `test/application/use-cases/actions/approve-always-action.use-case.spec.ts`
  (descreve `escopo por Dev Agent de módulo (RN-509)`: caminho feliz
  `dev-checkout` grava `agent_autonomy` e não vaza pra `dev-auth`; os DOIS
  tetos absolutos recusando o clique inteiro pra um ator dev-de-módulo;
  `dev-lead` e ator `user` — inclusive com id começando em `dev-` —
  continuam no caminho antigo)
- **Origem:** plano do dono do produto, Frente 2

---

## O destino do espelho é por projeto (RN-515) {#o-destino-do-espelho-e-por-projeto-rn-515}

### RN-515 — O destino do espelho é declarado POR PROJETO e nunca é global; `null` é o estado normal; e a api valida SÓ o léxico, dizendo que é só o léxico {#rn-515}

A capacidade `espelho` ([RN-514](../engine.md#rn-514), [ADR 0147](../../adr/0147-agente-local-com-capacidades.md))
copia o trabalho dos agentes para uma pasta do usuário **fora** da base
montada — que é a razão de ela existir, porque bind mount não atravessa rede
nem alcança caminho fora do que foi montado. Esta regra decide **onde esse
destino mora e como o usuário o declara**; ela **não** copia arquivo nenhum.

**Por PROJETO, nunca global.** O destino é a coluna `projects.mirror_path` e o
campo `mirrorPath` do projeto, escrito por
`PUT /projects/:projectId/mirror-path` (`maintainer`, o mesmo mínimo de
`execution-mode` e de `projects-base`: a rota fala de um caminho do computador
do operador). Nunca configuração global no runner, nunca variável de ambiente:
um destino global faria o artefato do projeto B aterrissar na pasta do projeto
A, e o usuário descobriria isso **pelo conteúdo, não por um erro** (ADR 0147,
ponto 4).

**`null` é o estado NORMAL, não uma pendência.** A coluna é nullable e nasce
nula; projeto sem espelho é a maioria, e o produto nunca escolhe um destino
sozinho. Limpar é `{"mirrorPath": null}` — a chave é **obrigatória**, e
omiti-la é **400**: um corpo que omite o campo seria indistinguível de "limpe",
e limpar em silêncio é justamente o defeito. Limpar funciona **sempre**,
inclusive num projeto `container`, senão uma linha convertida ficaria presa no
estado que a regra proíbe.

**Só o LÉXICO, e a api DIZ que é só o léxico.** A api **não enxerga** a máquina
onde o destino vai existir — é a situação do modo `runner`
([RN-423](../runner.md#rn-423)), não a do `mounted`, onde a pasta acaba dentro da base que
a api alcança de verdade. Ela reusa `caminhoDeWorkspaceLocalValido`, o **mesmo**
predicado da criação e da conversão (absoluto, sem `..`/`.`, nunca a raiz nem
pasta de sistema, nunca sobreposto ao checkout do Brabo), em vez de uma quarta
cópia da mesma régua — e **não** exige `BRABO_PROJECTS_BASE`, porque o destino
do espelho é por definição a pasta que a base não cobre. A mensagem de recusa
declara que o disco não foi verificado e quem o verifica.

**Os dois sentidos do mesmo laço.** Destino **dentro** do `workspacePath` e
destino que **contém** o `workspacePath` são a mesma recusa vista de dois lados
(ADR 0147, ponto 2): escrever o espelho dentro da origem faz o espelho copiar o
próprio espelho, e uma origem dentro do destino aninha a cópia a cada rodada.
Recusar um e permitir o outro seria fechar a porta e deixar a janela. A
comparação é por **SEGMENTO** (`dentroDoEscopo`), nunca `startsWith` cru:
`/base-outra` **não** está dentro de `/base`, e recusá-lo taxaria uma pasta
irmã perfeitamente legítima.

**Esta é a metade LÉXICA da guarda, e só ela.** A outra é `realpath`, e é do
RUNNER (`espelho-guard.ts`, ADR 0147 ponto 2), na máquina onde os dois caminhos
existem de verdade. Um symlink em qualquer segmento do destino apontando de
volta para a origem passa por aqui sem ser visto — a api não tem disco onde
resolvê-lo. **A api não garantiu o laço**; ela impediu o laço ESCRITO.

**`container` é recusado, e a recusa é NOMEADA.** A origem de um projeto
`container` é um volume gerenciado **no servidor**, e quem copiaria é um
processo na máquina do **usuário**, que não a enxerga. Aceitar e nunca copiar
seria pior que recusar, porque pareceria configurado. `mounted` e `runner`
podem. Pelo mesmo motivo, **converter o modo ZERA o destino**
([RN-447](parte-05.md#rn-447)..450): em `container` ele não poderia existir, e mesmo entre
`mounted` e `runner` a conversão MOVE a origem contra a qual os dois sentidos
do laço foram validados.

**O valor volta em toda leitura de projeto** (`ProjectResponseDto.mirrorPath`),
para a implementação do espelho e a tela de estado não precisarem de rota nova.
Não há endpoint de leitura dedicado.

**E ele NÃO é `proposed_action`.** A escrita do espelho é configuração que o
usuário declarou, não um agente pedindo para agir — o ADR 0147 é explícito
disso, e sincronizar por comando de terminal cairia no escopo do
[ADR 0055](../../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) e viraria
fila de aprovações rotineiras.

- **Onde:** `src/db/schema/iam.ts` (coluna `mirror_path`, nullable,
  sem CHECK — a recusa de `container` mora no caso de uso porque o modo é
  CONVERSÍVEL); `src/db/migrations/0056_lovely_firelord.sql`;
  `src/domain/iam/project.entity.ts` (`mirrorPath`);
  `src/application/services/workspace-location.ts`
  (`validarDestinoDeEspelho` — o léxico reusado, a recusa de `container` e os
  dois sentidos do laço);
  `src/application/use-cases/iam/set-project-mirror-path.use-case.ts`;
  `src/application/use-cases/iam/convert-project-execution-mode.use-case.ts`
  (a conversão zerando o destino);
  `src/interfaces/http/iam/dto/set-mirror-path.dto.ts` (`@IsDefined`
  + `@ValidateIf`, nunca `@IsOptional`, que colapsaria `null` e `undefined`);
  `src/interfaces/http/iam/projects.controller.ts`
  (`PUT :projectId/mirror-path`, `maintainer`);
  `src/interfaces/http/iam/dto/iam.response.dto.ts`
- **Teste:**
  `test/application/use-cases/iam/set-project-mirror-path.use-case.spec.ts`
  (grava, normaliza, limpa, limpa mesmo em `container`, recusa
  não-absoluto/`..`/raiz/pasta de sistema/checkout do Brabo, os dois sentidos
  do laço, `/base-outra` vs `/base` NÃO sendo dentro, `container` recusado,
  404); `test/interfaces/http/iam/projects-execution-mode.controller.spec.ts`
  (`describe "destino do espelho (RN-515)"` — `maintainer` e o repasse de
  `null`);
  `test/application/use-cases/iam/convert-project-execution-mode.use-case.spec.ts`
  (a conversão zerando o destino);
  `test/interfaces/route-surface.spec.ts` (a rota classificada em
  `docs/security-surface.md`)
- **ADR:** [0147](../../adr/0147-agente-local-com-capacidades.md), ponto 4
- **Origem:** FASE 28, sessão 6 (metade A — onde o destino mora; a cópia, o
  `mirror_sync` e a segunda passada de `realpath` são a metade B, no engine e
  no runner)

---

## O estado do espelho é visível, e os três estados não colapsam (RN-517) {#o-estado-do-espelho-e-visivel-e-os-tres-estados-nao-colapsam-rn-517}

### RN-517 — O desfecho de cada rodada do espelho volta pelo canal e vira TELEMETRIA numa tabela própria; "nunca sincronizou", "sincronizou e não copiou nada" e "falhou" são TRÊS respostas, e sucesso e erro convivem {#rn-517}

A sessão 8 da FASE 28 e o **ponto 7** do
[ADR 0147](../../adr/0147-agente-local-com-capacidades.md). A
[RN-516](../runner.md#rn-516) fez o espelho copiar de verdade e deixou o `mirror_sync`
**fire-and-forget** — sem `mirror_sync_result` no protocolo, de propósito,
porque o formato da telemetria era decisão desta entrega. É ela que fecha o
laço.

**O caminho é o de `workspace_confirm`, e nenhum outro.** O runner empurra
`mirror_sync_result` no canal `terminal:<projectId>` **depois** de a rodada
terminar; o engine trata em `handle_in/3` e REPASSA à api pelo HTTP interno
(`POST /internal/projects/:projectId/mirror-sync-result`), que grava pelo caso
de uso. O engine **não escreve a tabela** — um segundo caminho de escrita
seria a segunda fonte da mesma verdade, e a primeira coisa a divergir. É o
único precedente de o runner contar algo sobre si mesmo, e foi por isso que o
ADR o nomeou.

**Nunca um "ok" otimista.** O desfecho reportado é o REAL: as três contagens
que `sincronizarEspelho` devolveu (copiados, pulados, recusados — nunca
recontadas) ou o erro nomeado. As TRÊS saídas de `tratarMirrorSync` reportam,
e com mensagens diferentes: a recusa por destino não concedido, a falha da
cópia e o sucesso. `ok` NUNCA é deduzido de haver contagem ou mensagem — nem
no runner, nem na tradução do engine, nem no caso de uso da api: deduzir
tornaria uma rodada que copiou **0** arquivos (perfeitamente normal)
indistinguível de uma que nem chegou a rodar.

**TABELA, e não event log.** `project_mirror_states`, uma linha por projeto
(`project_id` único, mesmo desenho de `project_containers`). O motivo é o
mesmo que fez `rag_searches` virar tabela ([RN-479](parte-05.md#rn-479)):
`session_events.session_id` é `NOT NULL` e uma rodada de espelho **não tem
sessão** — o event log perderia a coisa inteira, não uma parte dela. E não é
`proposed_action` em hipótese nenhuma: a escrita do espelho é configuração que
o usuário declarou, não um agente pedindo para agir.

**Os TRÊS estados da [RN-088](../web.md#rn-088), e eles não colapsam.** "Nunca
sincronizou" é a linha **ausente**. "Sincronizou e não copiou nada" é linha
presente com `files_copied = 0` — um desfecho, não um vazio. "Falhou" é
`last_error_at` mais recente que `last_synced_at`. São três respostas
diferentes, a pessoa age diferente em cada uma, e um traço servindo às três
seria a tela recusando nomear o que sabe ([RN-470](../web.md#rn-470)).

**Sucesso e erro CONVIVEM na mesma linha.** As duas escritas mencionam colunas
**disjuntas**: a de sucesso não toca `last_error`/`last_error_at`, a de falha
não toca nenhuma coluna de sucesso, e nenhuma das duas apaga a outra. Quem
decide qual está VIGENTE é a comparação dos dois carimbos
(`deriveMirrorSyncStatus`, função pura do domínio), e é isso que permite a tela
dizer *"a última rodada falhou — última cópia boa em ontem, com 412 arquivos"*.
Uma escrita destrutiva de um lado sobre o outro jogaria fora justamente a
informação mais útil que a tela tem enquanto o espelho está quebrado. Duas
escolhas menores na mesma direção: falha SEM destino não apaga o destino da
última cópia que funcionou, e empate exato de carimbo resolve para `failed` —
entre afirmar que está tudo bem e afirmar que algo falhou, a afirmação segura
é a que faz a pessoa olhar.

**`destination` é CONGELADO**, como `image_version` em `project_containers` e
os pesos em `rag_searches` ([RN-479](parte-05.md#rn-479)): é o destino REAL daquela
rodada, resolvido por `realpath` na máquina do usuário depois do `mkdir -p`.
Ler `projects.mirror_path` na hora de mostrar diria o destino de AGORA sobre
uma cópia de ontem — e os dois divergem de verdade, porque a concessão viaja no
join e só muda quando o runner reconecta ([RN-516](../runner.md#rn-516)). Quando divergem,
a tela DIZ isso.

**Gravar telemetria jamais derruba o que ela mede.** A cópia já terminou
quando o reporte sai; o `handle_in` do engine só LOGA a recusa da api e devolve
`{:noreply, socket}` nos dois ramos, e o canal do runner segue vivo. Sem canal
(a conexão caiu entre o pedido e o fim da cópia) o runner não reporta e não
lança — a rodada que aconteceu não é desfeita por isso. E um projeto cujo
destino foi LIMPO no meio ainda registra: a rodada aconteceu, e o erro dela é
o que costuma explicar o que houve.

**Na tela**, a linha entra em `AmbienteDoProjeto` (a coluna lateral da Visão
geral, ao lado das de modo de execução e runner) e **só existe em projeto que
tem `mirrorPath`** — num projeto sem espelho, "nunca sincronizou" seria uma
ausência inventada, o mesmo argumento que já valia para a linha do runner. Data
ABSOLUTA com ressalva e nunca bolinha verde de "está de pé", pelo mesmo
precedente de `workspaceVerifiedAt`: o carimbo diz que uma rodada aconteceu,
não que a pasta esteja em dia com o que mudou depois (o gatilho é um momento
nomeado, o commit — nunca um watcher). O `status` chega RESOLVIDO da api: a
regra que decide qual carimbo vale tem uma fonte só, e é ela que decide qual
das três frases a pessoa lê.

**Papel `viewer` para LER, `maintainer` para escrever o destino** — a régua da
[RN-102](parte-03.md#rn-102) aplicada: o mínimo é do ENDPOINT, e este só lê. O destino já
viaja em toda leitura de projeto (`GET /projects/:projectId`, `viewer`), então
exigir `maintainer` aqui trancaria informação para quem já a vê no mesmo
projeto, que é o pior dos dois defeitos porque é invisível para quem perdeu a
capacidade.

- **Onde:** `src/db/schema/iam.ts` (`project_mirror_states`, no
  agregado `iam` porque é lá que o destino mora — não há `domain/runners`);
  `src/db/migrations/0057_brave_silver_centurion.sql`;
  `src/domain/iam/mirror-state.ts` (`deriveMirrorSyncStatus`, a regra
  dos três estados, pura); `src/application/ports/mirror-state-repository.port.ts`
  (DOIS métodos de escrita, não um upsert com tudo opcional — é o que torna a
  disjunção um invariante do tipo, não uma convenção do chamador);
  `src/infrastructure/persistence/drizzle/mirror-state.repository.ts`;
  `src/application/use-cases/iam/record-mirror-sync.use-case.ts` e
  `.../get-project-mirror-state.use-case.ts`;
  `src/interfaces/http/internal/internal-projects.controller.ts`
  (`POST .../mirror-sync-result`);
  `src/interfaces/http/iam/projects.controller.ts`
  (`GET .../mirror-state`, `viewer`);
  `apps/engine/lib/engine/sessions/engine_api_client.ex`
  (`report_mirror_sync/2`);
  `apps/engine/lib/engine_web/channels/terminal_channel.ex`
  (`handle_in("mirror_sync_result", …)` e a tradução do vocabulário);
  `apps/runner/src/channel.ts` (`MirrorSyncResultMessage`,
  `enviarMirrorSyncResult`); `apps/runner/src/index.ts` (`tratarMirrorSync`
  reporta as três saídas); `apps/web/src/components/AmbienteDoProjeto.tsx`
- **Teste:**
  `test/application/use-cases/iam/mirror-sync-telemetry.use-case.spec.ts`
  (os três estados na função pura e na leitura; erro que não apaga o sucesso;
  destino trocado; contagem 0; mensagem sem texto e mensagem longa; projeto
  sem destino que ainda registra);
  `test/infrastructure/persistence/drizzle/mirror-state.repository.spec.ts`
  (o invariante das colunas disjuntas contra o banco de verdade — um fake
  provaria o fake);
  `apps/engine/test/engine_web/channels/terminal_channel_test.exs`
  (`describe "mirror_sync_result"` — o repasse com tradução, o `filesCopied: 0`
  que não some, campo ausente que NÃO vira `nil`, `sucesso` faltando que vira
  `ok: false`, `:web` ignorado, e a api que recusa sem derrubar o canal);
  `apps/runner/src/index-handlers.spec.ts`
  (`describe "o desfecho é reportado em mirror_sync_result"` — contagem real,
  repositório vazio como sucesso, falha nomeada, recusa sem destino, e a
  conexão caída que não reporta nem lança);
  `apps/web/src/components/AmbienteDoProjeto.test.tsx`
  (`describe "linha do espelho"` — sem `mirrorPath` a linha some e nem consulta;
  os três estados com três frases; nenhum vocabulário de liveness; destino
  trocado dito)
- **ADR:** [0147](../../adr/0147-agente-local-com-capacidades.md), ponto 7
- **Origem:** FASE 28, sessão 8. Fica declarado e NÃO feito: nenhum alarme,
  nenhuma notificação e nenhuma retentativa automática de rodada que falhou —
  a próxima rodada acontece no próximo momento nomeado, como sempre, e a tela
  é o único lugar onde a falha aparece hoje

---

## A revogação de chave de dispositivo deixa de ser cega, e alcança a conexão viva (RN-519..520) {#a-revogacao-de-chave-de-dispositivo-deixa-de-ser-cega-e-alcanca-a-conexao-viva-rn-519-520}

### RN-519 — Ninguém revoga o que não consegue ver: a chave de dispositivo ganha listagem do PRÓPRIO dono, e a visão de `maintainer` fica fora por DECISÃO {#rn-519}

A sessão 7 da FASE 28 e o **ponto 6** do
[ADR 0147](../../adr/0147-agente-local-com-capacidades.md). A revogação existia desde
o [ADR 0118](../../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
(`DELETE /projects/:projectId/runner-device-keys/:deviceKeyId`, `developer`,
204, idempotente) — **e não havia como enxergar o que se revoga.**

**O corte real era maior do que o docblock dizia.** Ele declarava a ausência
como *"sem a visão de `maintainer` (listar/revogar de qualquer usuário) que o
PAT tem"*. Mas o `PersonalAccessTokensController` tem **cinco** rotas — `@Post()`,
`@Get()` e `@Delete(':tokenId')` para o próprio usuário, mais `@Get('all')` e
`@Delete(':tokenId/admin')` para `maintainer` ([RN-427](parte-04.md#rn-427)) — e o de chave
de dispositivo tinha **duas**. Não faltava só a visão de `maintainer`: faltava a
listagem do PRÓPRIO dono. Uma chave órfã (aba fechada no meio do fluxo da
[RN-473](../web.md#rn-473)) era inerte, invisível e permanente, sem tela nenhuma onde
revogá-la — a lacuna que o `CLAUDE.md` já declarava.

**Entra `@Get()`, `developer`, no mesmo formato que o PAT já tem** e escopado ao
próprio usuário no WHERE do repositório, nunca num filtro do caso de uso.

**A revogada CONTINUA na lista.** Mesma escolha de `listarDoUsuarioNoProjeto`
do PAT: quem revogou precisa ver que revogou, e sumir com a linha faria a tela
afirmar que a chave nunca existiu. `revokedAt` é o que separa as duas, e
`lastUsedAt` nulo é o sinal da ÓRFÃ — registrada e nunca usada por runner
nenhum.

**Nunca a JWK pública.** Ela não é segredo, mas não serve a nada aqui: a lista
existe para revogar, e para isso bastam `id`, nome e as três datas. A metade
privada a api nunca viu.

**A visão de `maintainer` continua FORA — agora por decisão, não por omissão.**
As duas rotas de admin do PAT nasceram de resposta a incidente ([RN-427](parte-04.md#rn-427)):
dev desligado com um segredo COMPARTILHADO circulando. Chave de dispositivo não
é esse bicho — a privada nunca sai do navegador que a gerou, então não há
segredo na mão de outro a conter. O que a `DELETE` daqui ganhou em troca foi
ALCANCE ([RN-520](#rn-520)), não amplitude.

- **Onde:** `src/interfaces/http/runner/runner-device-keys.controller.ts:99`
  (`@Get()`, `listDeviceKeys`, `developer`);
  `src/application/use-cases/auth/list-runner-device-keys.use-case.ts:24`;
  `src/application/ports/runner-device-key-repository.port.ts:90`
  (`listarDoUsuarioNoProjeto`);
  `src/infrastructure/persistence/drizzle/runner-device-key.repository.ts:69`;
  `src/interfaces/http/runner/dto/runner-device-key-list.response.dto.ts:19`
  (as DUAS travas de tipo, `Wire`/`MesmasChaves`, ao contrário do DTO do
  registro)
- **Teste:**
  `test/application/use-cases/auth/list-runner-device-keys.use-case.spec.ts`
  (delegação com `userId`/`projectId` na ordem certa; a revogada que fica na
  lista; a órfã com `lastUsedAt` nulo; repositório que rejeita e propaga);
  `test/interfaces/http/runner/runner-device-keys.controller.spec.ts`
  (as TRÊS rotas em `developer`; a delegação; a rota que não devolve lista
  vazia por engano)
- **ADR:** [0147](../../adr/0147-agente-local-com-capacidades.md), ponto 6
- **Origem:** FASE 28, sessão 7. Fica declarado e NÃO feito: **tela nenhuma**.
  Esta entrega é a metade server-side; a lacuna do `CLAUDE.md` fecha pela
  metade — a api passa a poder listar e revogar, e `apps/web` ainda não tem
  onde fazê-lo
- **A outra metade FECHOU na [RN-561](../web.md#rn-561):** a aba Configurações ganhou a
  seção que lista e revoga, marcando a ESPÉCIE de cada chave. O que segue
  aberto daqui é a visão de `maintainer` (acima, por decisão) e o alvo
  `{projeto, usuário}` da desconexão ([RN-520](#rn-520))

---

### RN-520 — Revogar deixa de só impedir ticket NOVO e passa a derrubar a conexão VIVA; o alvo é `{projeto, usuário}` e nunca `{chave}`, e derrubar nunca derruba a revogação {#rn-520}

> **Revisada pela [RN-685](parte-09.md#rn-685) ([ADR 0201](../../adr/0201-revogacao-por-chave.md)):**
> o ticket do socket passou a guardar QUAL credencial o pediu, e a revogação de
> chave (e a de PAT) derruba só as conexões abertas COM ELA — outro runner do
> mesmo usuário, com outra chave ou com PAT, fica de pé. O "custo declarado"
> abaixo deixou de valer. O par `{projeto, usuário}` sobrevive como o alvo da
> remoção de membro ([RN-615](parte-07.md#rn-615)), como o da conexão LEGADA (ticket sem
> credencial) durante o rollout, e como o plano B quando o engine não conhece a
> rota por credencial.

A outra metade do **ponto 6** do
[ADR 0147](../../adr/0147-agente-local-com-capacidades.md). Revogar uma chave de
dispositivo impedia o ticket SEGUINTE e nada mais: um `brabo-runner` já
conectado mantinha o canal `terminal:<projectId>` de pé — executando comando
aprovado, atendendo PTY, subindo container — com a chave revogada, até cair
sozinho.

**Quem manda o comando é a api; quem alcança o pid é o engine.** A api chama
`POST /internal/projects/:projectId/runner/disconnect` (o mesmo HTTP interno com
service token de sempre, nunca um segundo mecanismo), e o engine acha o canal
por `Engine.Runners.Registry.whereis/1` — o pid que ele já entregava. O engine
**não consulta a tabela de chaves** e a api **não fala com o canal**; nenhum dos
dois faz o trabalho do outro, a mesma divisão de `EngineWeb.ContainerCommandController`
([RN-497](../produto.md#rn-497)).

**A precisão que existe é `{projeto, usuário}`, e a que não existe é
`{chave}` — por construção, não por gosto.** `Engine.Runners.SocketTicket`
guarda `project_id`, `user_id` e `kind`, e só; a api pede o ticket com
`{userId, kind}`. A identidade da CREDENCIAL que originou o ticket (o PAT, ou o
`kid` da chave de dispositivo — [RN-475](../web.md#rn-475)) morre no `PatAuthGuard` e
nunca chega ao socket. Levá-la até lá exigiria coluna nova em
`runner_socket_tickets`, campo novo no pedido interno e um assign novo no
`connect/3`: mudança de contrato de auth, fora desta entrega.

**Custo DECLARADO, e nomeado no código, não só aqui:** um runner do MESMO
usuário conectado com PAT, ou com outra chave do mesmo projeto, também cai. Ele
reconecta sozinho — a rodada seguinte pede um ticket novo, e a credencial que
ainda vale ganha um. Quem foi revogado não ganha, e é aí que a revogação morde.
Runner de OUTRO usuário no mesmo projeto **não cai**: a comparação é
`socket.assigns.user_id`, dentro do processo do canal, que é o único que pode
lê-lo — e o desfecho `de_outro_dono` volta ao pedinte em vez de um `:ok` que não
descreve o que aconteceu.

**Derruba o TRANSPORTE, não só o processo do canal.** Parar apenas o canal
deixaria o socket vivo e o cliente Phoenix reentrando no tópico para sempre com
um ticket já consumido — degradação silenciosa, exatamente o defeito que o ADR
0147 existe para não repetir. `EngineWeb.RunnerSocket.id/1` deixa de ser `nil` e
passa a nomear a conexão (`runner_socket:<kind>:<projectId>:<userId>`), e o
canal usa o mecanismo documentado do Phoenix, `Endpoint.broadcast(id,
"disconnect", %{})`. É por ele que o runner PERCEBE a queda: `onDisconnected`
resolve a rodada, o laço pede ticket novo e a api recusa.

**Efeito colateral NUNCA derruba o efeito principal.** O `DELETE` continua 204 e
idempotente: engine fora do ar, nenhum runner conectado ou timeout não podem
fazer a revogação falhar nem virar 5xx. A chamada ao engine mora num
`try/catch` que só LOGA, dentro do caso de uso — a MESMA régua de
`rag_searches` ([RN-479](parte-05.md#rn-479)) e do `mirror_sync_result`
([RN-517](#rn-517)). E os quatro desfechos são informação, não erro: `sem_runner`
é o caso normal de quem revoga uma chave órfã ([RN-519](#rn-519)), e desfecho
DESCONHECIDO vindo do engine vira `timeout` e nunca `derrubado` — entre afirmar
que a conexão caiu e afirmar que talvez não, a afirmação segura é a que não
promete o que não se sabe.

**Revoga PRIMEIRO, derruba depois**, e o projeto sai da LINHA revogada, nunca da
URL: o `projectId` da rota já era ignorado no `DELETE`, e lê-lo aqui faria um
`projectId` divergente derrubar o runner de um projeto que não tem nada com esta
chave.

- **Onde:** `src/application/use-cases/auth/revoke-runner-device-key.use-case.ts:63`
  (a ordem, o projeto da linha e o `try/catch` que só loga);
  `src/application/ports/api-to-engine-client.port.ts:433`
  (`disconnectRunnerOfUser`, `DesfechoDeDesconexaoDeRunner`);
  `src/infrastructure/http-clients/api-to-engine-client.ts:477`;
  `apps/engine/lib/engine/runners/revogacao.ex:92` (`derrubar/3`);
  `apps/engine/lib/engine_web/channels/terminal_channel.ex:697`
  (`handle_info({:derrubar_por_revogacao, …})`);
  `apps/engine/lib/engine_web/channels/runner_socket.ex:79` (`id/1`, que deixou
  de ser `nil`);
  `apps/engine/lib/engine_web/controllers/runner_connection_command_controller.ex:27`;
  `apps/engine/lib/engine_web/router.ex:86`
- **Teste:**
  `test/application/use-cases/auth/revoke-runner-device-key.use-case.spec.ts`
  (`describe "a revogação alcança a conexão viva"` — o projeto da linha; a
  ordem revoga→derruba; engine fora do ar que não derruba a revogação; 404 que
  não derruba ninguém);
  `test/infrastructure/http-clients/api-to-engine-client.spec.ts`
  (a rota e o corpo; desfecho desconhecido virando `timeout`; 500 que LANÇA,
  para o caso de uso tratar);
  `apps/engine/test/engine/runners/revogacao_test.exs` (sem runner; o dono; o
  outro dono; o teto; argumento fora de forma que não levanta);
  `apps/engine/test/engine_web/channels/terminal_channel_test.exs`
  (`describe "revogação alcança a conexão viva"` — o canal REAL que para e
  libera a presença no `Registry`, o de outro dono que fica de pé, o `:web` que
  nunca é alvo);
  `apps/engine/test/engine_web/controllers/runner_connection_command_controller_test.exs`
  (os 200 com desfecho, e o 400 de pedido malformado)
- **ADR:** [0147](../../adr/0147-agente-local-com-capacidades.md), ponto 6
- **Origem:** FASE 28, sessão 7. Fica declarado e NÃO feito: a revogação não
  alcança um runner conectado em OUTRO projeto com a mesma chave — não existe
  esse caso, porque `runner_device_keys.project_id` amarra a chave a um projeto
  só; e nenhuma tela dispara isto ainda (a metade web da [RN-519](#rn-519))

### RN-521 — A página `/containers` lista TODO projeto do workspace e vira o caminho HUMANO de subir o container, ramificado por `execution_mode` {#rn-521}

> **Estendida pela [RN-574](parte-07.md#rn-574) (ADR 0161):** um quarto motivo de recusa
> local, `sem_broker_na_instalacao`, para `container`/`mounted` numa
> instalação sem broker de container — depois de "já está de pé" e antes de
> "sem imagem decidida".
>
> **Estendida pela [RN-590](parte-07.md#rn-590) (AT-105):** a mesma leitura vale na
> conversão de modo, em parar/remover e na proposta do Infra Lead (recusa 409
> da api ao propor).

Subir o container de um projeto tinha **um** caminho: o Infra Lead, dentro de
uma sessão, chamando a ferramenta dele. Numa execução real do `exp004` (modo
`runner`) a `container_start_via_runner` falhou pelo defeito que a
[RN-508](#rn-508) fechou — e não havia como TENTAR DE NOVO. Cinco dev agents
ficaram horas emitindo `dev.blocked_by_container`
([RN-502](../engine.md#rn-502)), e a única saída era abrir sessão nova e conversar com um
agente para reexecutar uma operação de máquina.

A página global de containers ([ADR 0136](../../adr/0136-pagina-global-de-containers.md),
[RN-495](parte-05.md#rn-495)) já era o lugar onde um HUMANO decide ciclo de vida de
container — mas ela nem mostrava o projeto: a régua era "uma linha por projeto
que já tem `project_containers`", e uma subida que falha ANTES de registrar não
deixa linha nenhuma. A tela escondia exatamente o projeto para o qual ela
precisava existir.

**O TERCEIRO estado tem nome próprio, e não é `stopped`.** O read model passa a
LEFT JOIN (era INNER) e `registrado` vira `null` para quem nunca provisionou —
não é um valor novo de `ContainerLifecycleStatus` (`stopped` é um container que
EXISTIU e parou), e não é "não observado" (que é sobre o daemon ter sido
perguntado). A tela imprime **"nunca provisionado"** e a coluna Observado diz
`sem_container_registrado`, o terceiro motivo de `naoVerificado` — os três não
colapsam ([RN-088](../web.md#rn-088)/[RN-486](parte-05.md#rn-486)).

**A lista alargou; o ORÇAMENTO não.** Perguntar o observado ao broker é chamada
de rede por projeto, com teto de 20 por carregamento
(`TETO_DE_VERIFICACOES_POR_CARGA`). Projeto sem `project_containers` não tem o
que observar, então nunca é elegível e **nunca ocupa uma vaga**: num workspace
com centenas de projetos vazios, quem tem container de verdade continua
verificado exatamente como antes. E continuam sendo TRÊS consultas em lote,
quantos projetos forem — nenhuma dentro de laço.

**A ação ramifica por `execution_mode`, com a mesma régua do backend
([RN-497](../produto.md#rn-497)/[RN-503](#rn-503)):** `container` e `mounted` propõem
`container_start` (broker, no servidor) e `runner` propõe
`container_start_via_runner` (agente local, na máquina do usuário). Os DOIS
payloads são diferentes de propósito e não se copiam: `container_start` carrega
a ELEIÇÃO de imagem (imagem, rede, recursos), lida da decisão vigente do projeto
no clique; `container_start_via_runner` tem schema **só com `rationale`**
([RN-508](#rn-508)), porque ela sobe a imagem JÁ decidida e não elege nada.

**A tela NÃO propõe o que já se sabe que vai falhar — e diz o motivo no lugar
do botão.** Três recusas, cada uma com texto próprio, na ordem "estado do MUNDO
antes da capacidade de quem olha" (assim um `viewer` ainda lê "falta decidir a
imagem", e não só "você não pode"):

1. **sem imagem decidida** — o portão da [RN-105](parte-03.md#rn-105), que vale nos TRÊS
   modos desde a [RN-494](../broker.md#rn-494); sem `artifact.project_image` não há o que
   subir;
2. **`runner` que nunca teve pasta confirmada** (`workspaceVerifiedAt` nulo,
   [RN-423](../runner.md#rn-423)) — nenhum agente local jamais conectou, então a ação
   falharia com certeza. Mesma honestidade que a ferramenta do Infra Lead já
   pratica ao recusar LOCALMENTE antes de propor ([RN-508](#rn-508));
3. **papel abaixo de `maintainer`** — o mínimo é o do ENDPOINT
   ([RN-102](parte-03.md#rn-102)): os dois tipos pedem `maintainer` em `decide.ts`, e a
   comparação sai de `roleAtLeast`, nunca de uma lista de papéis à mão. O que se
   tira é o CONTROLE, nunca a INFORMAÇÃO ([ADR 0064](../../adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md)):
   quem não pode continua vendo estado, imagem e recursos, e o motivo é dito UMA
   vez em TEXTO — `title` em elemento `disabled` não abre no Chromium.

**E o que a tela NÃO sabe, ela declara em vez de prometer.**
`workspaceVerifiedAt` é registro de UMA confirmação e nunca batimento
([RN-468](../web.md#rn-468)): não-nulo não prova agente local conectado AGORA, e a api
não tem sinal de presença (quem sabe do agora é o canal Phoenix, no engine).
Então a linha do `runner` oferece o botão **com ressalva escrita** — "se ele não
estiver rodando agora, a ação falha ao ser aprovada" — em vez de uma bolinha
verde que mentiria.

**Nada de teto se mexeu.** Toda proposta desta tela é `proposed_action`,
sempre com um HUMANO clicando, nunca um agente; `container_remove` continua no
teto absoluto ([RN-418](parte-04.md#rn-418)) e `decide.ts` fica byte a byte. O papel lido
é o do WORKSPACE, e a lacuna é declarada: o efetivo é
`projectRole ?? workspaceRole` ([RN-471](../web.md#rn-471)), e buscar `project_members`
por linha seria o N+1 de rede pelo qual esta página existe para não pagar —
quem foi REBAIXADO num projeto ainda vê o botão e recebe 403, que é o defeito
reparável (termina em toast), não o invisível.

- **Onde:**
  `src/infrastructure/persistence/drizzle/containers-overview.repository.ts:96`
  (o LEFT JOIN, o `ORDER BY` e `temImagemDecidida`);
  `src/application/ports/containers-overview-repository.port.ts:20`
  (`executionMode`/`lifecycle` nulo/`temImagemDecidida`/`workspaceVerifiedAt`);
  `src/application/use-cases/containers/obter-visao-geral-de-containers.use-case.ts:33`
  (`sem_container_registrado`) e `:101` (`elegivelParaVerificacao`, que é o que
  mantém o orçamento intacto);
  `src/interfaces/http/containers/containers-overview.controller.ts:60`;
  `apps/web/src/routes/containers-subida.ts:114` (`decidirSubida`, a regra
  inteira, pura);
  `apps/web/src/routes/ContainersPage.tsx:119` (os dois payloads)
- **Teste:**
  `test/application/use-cases/containers/obter-visao-geral-de-containers.use-case.spec.ts`
  (o terceiro estado com motivo próprio; 25 projetos vazios que NÃO empurram
  para fora da verificação os 20 com container real);
  `test/infrastructure/persistence/drizzle/containers-overview.repository.spec.ts`
  (projeto sem `project_containers` na lista; `temImagemDecidida`;
  `container_start_via_runner` pendente; as TRÊS consultas que não crescem);
  `test/interfaces/http/containers/containers-overview.controller.spec.ts`
  (o `registrado` aninhado e o `null` que sobrevive à conversão);
  `apps/web/src/routes/containers-subida.test.ts` (a ramificação por modo, as
  três recusas, a ressalva, a hierarquia de papel);
  `apps/web/src/routes/ContainersPage.test.tsx` (o cenário REAL do `exp004`:
  projeto `runner`, sem linha, imagem decidida, pasta confirmada → a ação
  proposta é `container_start_via_runner` com payload só de `rationale`, e
  `GET .../container` nem é chamado)
- **ADR:** [0136](../../adr/0136-pagina-global-de-containers.md) (a página),
  [0145](../../adr/0145-docker-pre-requisito-do-runner.md) (o tipo de ação),
  [0133](../../adr/0133-infra-elege-imagem-do-roteamento.md) (o outro)
- **Origem:** execução real do `exp004`, decisão do dono do produto. Fica
  declarado e NÃO feito: a tela não sabe se há agente local conectado AGORA (não
  existe sinal de presença na api), e o papel lido é o do workspace, não o
  efetivo do projeto

## O repositório nasce no handoff para o Dev Lead (RN-522) {#o-repositorio-nasce-no-handoff-para-o-dev-lead-rn-522}

### RN-522 — O repositório é provisionado ao ACEITAR o handoff Arquiteto → Dev Lead, sempre `local`, e a falha nunca derruba o aceite {#rn-522}

> **Revisada pela [RN-582](parte-07.md#rn-582) ([ADR 0165](../../adr/0165-o-repositorio-nasce-no-handoff-ao-arquiteto.md)):**
> o GATILHO passou a ser o aceite do handoff ao **Arquiteto**. O aceite ao Dev
> Lead descrito abaixo continua provisionando, como segunda porta idempotente,
> e o resto desta regra (sempre `local`, falha como evento, adotado não é
> falha) segue valendo. O texto abaixo é o da decisão original.

A [RN-541](../web.md#rn-541) tirou o provisionamento da criação e declarou que o gatilho
viria em seguida. Este é o gatilho — e sem ele um projeto criado ficaria sem
repositório **para sempre**, porque `ProvisioningPage` era o único chamador de
`provisionRepository` no web e a criação deixou de navegar para lá.

O momento é o **aceite do handoff do Arquiteto para o Dev Lead**, e não a
ativação da execução. São instantes DISTINTOS, nesta ordem: aceitar o handoff
ativa o Dev Lead; ativar a execução é quando os dev agents começam a reivindicar
task. É no primeiro que "o desenvolvimento começou" passa a ser verdade, e é o
que o dono do produto pediu — *"quando o arquiteto passar o handoff para o
desenvolvedor iniciar o desenvolvimento"*.

O ramo mora em `AcceptHandoffUseCase`, ao lado do ramo `'infra'` que já existia
e pela mesma razão de ordem: o efeito acontece **antes** de `activateAgent`, de
modo que o agente acorde num projeto que já tem onde trabalhar.

**Sempre `local`.** É o único provider que não pede credencial nenhuma — o
`if (providerName !== 'local')` de `ProvisionRepositoryUseCase` nunca chega a
resolver segredo, e o `LocalGitProvider.createRepo` sequer lê o `accessToken`
que a assinatura aceita. É isso que torna um provisionamento **automático**
possível: ninguém escolheu hospedagem no meio do aceite, então não há credencial
a buscar nem pergunta a fazer. Publicar num provider remoto continua sendo
caminho separado (adoção, ou conversão em Configurações) — declarado, não
esquecido. Efeito colateral aceito: `protectBranch: false` no provider local faz
o último passo do bootstrap **degradar** (`step_degraded`), nunca falhar.

**A falha vira EVENTO, nunca exceção.** Este caso de uso não tem transação:
quando o provisionamento roda, `updateStatus('accepted')` e o evento
`handoff.accepted` já estão COMMITADOS. Um throw devolveria 500 ao usuário sobre
um handoff que, no banco, foi aceito — e ainda impediria o `activateAgent` logo
abaixo, deixando o Dev Lead sem acordar por causa de uma falha de git. Então o
desfecho vai para o event log como `repository.provision_failed`, com `origem` e
a mensagem real, e o aceite segue. É a régua de sempre: falha registra a origem
e nunca vira resposta vazia.

**O que NÃO é falha:** projeto que ADOTOU um repositório. `ProvisionRepository`
recusa esse caso com `ConflictException` de propósito — bootstrap de repositório
de terceiro só roda por aprovação de plano (RN-045) —, mas o projeto TEM
repositório, então não há o que provisionar e registrar isso como falha mentiria
sobre o estado dele. O ramo consulta `findByProjectId` e sai antes. Repositório
`created` que já existe **não** é pulado: cai no caso de uso normal, que é
idempotente por desenho ("rodar de novo não falha"), e é assim que um bootstrap
interrompido se completa.

- **Onde:**
  `src/application/use-cases/agents/accept-handoff.use-case.ts` — o
  ramo `dev-lead` no `execute` e o método privado `provisionarRepositorio`, com
  o `try/catch` e a saída antecipada do repositório adotado;
  `src/application/use-cases/agents/agents-use-cases.module.ts` (o
  import de `GitUseCasesModule` — a seta é `agents → git`, e `git` não importa
  `agents`, então não há ciclo)
- **Teste:**
  `test/application/use-cases/agents/accept-handoff.use-case.spec.ts`
  — caminho feliz ("aceitar para o Dev Lead provisiona `local` com o slug do
  projeto"), os dois casos de falha ("provisionamento que falha NÃO derruba o
  aceite nem a ativação" e "a falha vira evento nomeado, com origem e a mensagem
  real"), e os limites ("aceitar para OUTRO agente não provisiona nada",
  "projeto que ADOTOU repositório não provisiona, e isso não é falha",
  "repositório já CRIADO cai no caso de uso, que é idempotente por desenho")
- **Origem:** pedido do dono do produto — *"o gatilho deve vir quando o arquiteto
  passar o handoff para o desenvolvedor iniciar o desenvolvimento"*

## A chave de MÁQUINA que o instalador registra (RN-552) {#a-chave-de-maquina-que-o-instalador-registra-rn-552}

### RN-552 — Rota interna registra a chave de dispositivo de MÁQUINA, para o usuário ÚNICO da instalação, e registrar SUBSTITUI {#rn-552}

Sessão 7 da [FASE 30](../../explanation/fase-30-runner-por-maquina.md), fechando o
ponto 4 do [ADR 0155](../../adr/0155-a-primeira-conta-nasce-no-terminal.md) sobre a
espécie de chave que o [ADR 0154](../../adr/0154-chave-de-dispositivo-de-maquina.md)
criou. É a lacuna que a [RN-543](../produto.md#rn-543) declarou por escrito e deixou aberta
de propósito, pela régua do `DEPLOY_ENABLED`: *"nenhuma rota da api cria chave
de máquina ainda; isso é o `install.sh`, e nasce com o primeiro chamador"*. O
chamador chegou — é o instalador da sessão 6 —, então a rota nasce.

**A rota.** `POST /internal/machine-device-keys`, `engine-service`. Corpo
`{ name, publicKeyJwk }`, resposta `201` com
`{ id, userId, name, createdAt, replacedKeyIds }`. Sem `GET` e sem `DELETE`.

**A credencial é o SERVICE TOKEN, e a alternativa foi recusada por motivo
escrito.** É o mesmo instalador, no mesmo minuto, no passo seguinte ao da
[RN-546](../produto.md#rn-546): o `BRABO_SERVICE_TOKEN` foi gerado pelo próprio `install.sh`
e escrito no `.env` com modo `600`, então apresentá-lo prova controle da
**máquina** — que é exatamente o que este passo quer provar. A candidata real
do outro lado era a credencial do usuário recém-criado, e ela contraria o
próprio ADR 0155: a senha é lida no TTY, *"usada e descartada"*, e o ponto 5
declara que *"o instalador não faz login por ninguém"*, razão pela qual a
resposta da primeira conta não devolve token de sessão. Exigi-la aqui obrigaria
o instalador a criar, na máquina, a sessão viva que aquele ADR recusou criar.

**O que essa escolha custa, declarado e não escondido.** Um
`BRABO_SERVICE_TOKEN` vazado passa a poder **fabricar** uma credencial de
acesso duradoura de um usuário — não só falar com as rotas internas. Está dito
aqui, no [`security-surface.md`](../../security-surface.md) e no docblock do
controller, ao lado da declaração irmã da primeira conta. O que a chave concede
não aumentou: ela dá ao agente local exatamente os projetos que o dono dela já
alcança em `developer`, resolvidos contra o projeto pedido ([RN-543](../produto.md#rn-543)).

**A rota não sabe escolher de quem é a chave.** **Não há `userId` no corpo.** O
dono é o usuário ÚNICO da instalação, resolvido por
`UserRepository.usuarioUnicoDaInstalacao()` (`LIMIT 2`, nunca `LIMIT 1`: com
uma linha seria impossível distinguir "há exatamente um" de "há muitos"); com
zero ou mais de um, `409` e **nada é escrito**. É o análogo exato da condição
da [RN-546](../produto.md#rn-546) — sobre a INSTALAÇÃO, nunca sobre o argumento pedido —, e
é o que impede que quem tenha o token escolha a vítima. Consequência declarada:
numa instalação com duas pessoas a rota não funciona mais, para ninguém. Ela se
cala como a da primeira conta se cala, e pelo mesmo motivo — pertence ao
MOMENTO da instalação, não à vida do produto.

**Registrar SUBSTITUI, nunca acumula.** Toda chave de MÁQUINA ativa do dono é
revogada na MESMA transação, e os ids voltam em `replacedKeyIds`. Uma máquina
reinstalada é caso legítimo e continua passando; mil chaves de máquina viram
impossíveis — e não por um número que envelhece, mas porque o conjunto de
chaves de máquina vivas de um usuário nunca passa de uma. A revogação vem
ANTES do registro: revogar depois deixaria uma janela com as duas vivas, e
falhar no meio deixaria a instalação com duas credenciais de máquina e nenhuma
forma de saber qual é a nova. Só as de MÁQUINA caem (`project_id IS NULL`): as
de PROJETO vieram do navegador ([ADR 0118](../../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)),
num fluxo que esta rota não conhece, e derrubá-las apagaria o pareamento de
quem já usa o produto — o erro que a [RN-545](../runner.md#rn-545) nomeou ao recusar
converter instalação alheia em silêncio.

**A resposta devolve o `id` porque ele vira o `kid`.** É a lição da
[RN-475](../web.md#rn-475), a mais cara desta área: o id do registro vai gravado DENTRO
da JWK privada, no `kid`, e a cadeia inteira só o REPASSA — o agente local lê
`jwk.kid`, o JWT de ticket o leva no header, o `PatAuthGuard` acha a pública
por ele. Ninguém deriva esse id de outra coisa, e foi por ele faltar que o modo
automático do navegador nunca autenticou. O `userId` também volta, RESOLVIDO
pela api: quem chama não o manda, e devolvê-lo deixa o instalador **conferir**
contra a conta que acabou de criar em vez de supor.

**A privada nunca viaja, e uma que chegue é RECUSADA.** O par é gerado na
máquina e só a metade pública sobe — mesmo desenho do navegador, pelo mesmo
motivo, mantendo verdadeira a frase que a [RN-519](#rn-519) usa. A validação de
forma virou régua ÚNICA no domínio (`exigirJwkPublicaEd25519`), chamada pelos
DOIS registradores: duas cópias divergiriam no primeiro dia em que uma delas
mudasse, como a política de senha da [RN-546](../produto.md#rn-546) já resolve. E ela ganhou
um caso que nenhuma das duas tinha: JWK com **`d`** responde `400` dizendo o
que chegou. `d` é a metade privada de uma JWK OKP (RFC 8037 §2) e só chega por
engano de quem serializou o par inteiro — antes, ela passava na checagem (tem
`kty`, `crv` e `x` como qualquer pública) e era **gravada**. Recusar é a
resposta; a mensagem nomeia o que veio, porque um "JWK inválida" genérico faria
a pessoa tentar de novo com o mesmo arquivo.

**Kind próprio na trilha de auth.** `machine_device_key_registered`: esta é a
única credencial duradoura de um usuário que nasce sem esse usuário autenticar
nada — quem prova é o controle da máquina. Numa suspeita de vazamento do
service token, é essa linha que diz quando e para quem ela foi criada, e o
`metadata` carrega os ids que ela substituiu, nunca a JWK nem o nome.

**Sem `GET` e sem `DELETE`, e o que isso custa.** Listar por aqui publicaria,
para quem só tem o token da máquina, o inventário de credenciais de uma pessoa;
revogar já existe onde tem dono humano
(`DELETE /projects/:projectId/runner-device-keys/:deviceKeyId`, que casa por
`{id, usuário}` e nunca por projeto). A assimetria tem preço, e ele está
declarado: numa instalação que ainda não tem projeto, **tela nenhuma alcança
uma chave de máquina** — e é justamente por isso que registrar SUBSTITUI em vez
de deixar órfãs para trás, que seriam vivas e inalcançáveis.

**O que NÃO entrou:** rota pública (mesma corrida da [RN-546](../produto.md#rn-546));
`userId` no corpo; chave de máquina para instalação com time (declarado acima
como lacuna, não como acaso); tabela nova (uma chave de máquina continua sendo
uma linha de `runner_device_keys` com `project_id NULL`, [ADR 0154](../../adr/0154-chave-de-dispositivo-de-maquina.md)
ponto 1) — e **nenhuma migration**, porque a coluna já é nullable desde a
[RN-543](../produto.md#rn-543).

- **Código:** `src/interfaces/http/internal/internal-machine-device-keys.controller.ts:87`
  (o `@Post()` da rota, e o docblock com a escolha de credencial),
  `src/application/use-cases/auth/registrar-chave-de-maquina.use-case.ts:122`
  (o dono resolvido), `:124` (o `409`), `:136` (a substituição antes do
  registro) e `:146` (`projectId: null`, o que faz dela uma chave de máquina),
  `src/domain/auth/jwk-de-dispositivo.ts:33` (a régua única) e `:59`
  (a recusa da privada),
  `src/infrastructure/persistence/drizzle/user.repository.ts:31`
  (`usuarioUnicoDaInstalacao`, `LIMIT 2`),
  `src/infrastructure/persistence/drizzle/runner-device-key.repository.ts:148`
  (`revogarChavesDeMaquina`, os dois `IS NULL`),
  `src/domain/auth/auth-event.ts` (`machine_device_key_registered`),
  `src/interfaces/http/internal/dto/machine-device-key-internal.dto.ts`
  e `…/machine-device-key-internal.response.dto.ts`
- **Teste:** `test/application/use-cases/auth/registrar-chave-de-maquina.use-case.spec.ts`
  (caminho feliz com `projectId` nulo e dono resolvido; o `409` sem usuário
  único, sem escrever nada; a substituição ANTES do registro; a privada
  recusada antes de abrir transação; a trilha sem a JWK);
  `test/domain/auth/jwk-de-dispositivo.spec.ts` (a régua única, com o
  `d` e a precedência da curva);
  `test/interfaces/http/internal/internal-machine-device-keys.controller.spec.ts`
  (o contrato da resposta, o corpo SEM dono, e as três do guard);
  `test/infrastructure/persistence/drizzle/user.repository.spec.ts`
  (um usuário devolve; dois devolvem `null`, nunca "o primeiro");
  `test/infrastructure/persistence/drizzle/runner-device-key.repository.spec.ts`
  (a substituição contra o Postgres de verdade, e o que ela NÃO derruba);
  `test/interfaces/route-surface.spec.ts` (a rota classificada)
- **ADR:** [0155](../../adr/0155-a-primeira-conta-nasce-no-terminal.md) ponto 4, sobre
  a espécie criada pelo [0154](../../adr/0154-chave-de-dispositivo-de-maquina.md)

## O teto de auto-rebaixamento também na REMOÇÃO (RN-556) {#o-teto-de-auto-rebaixamento-tambem-na-remocao-rn-556}

### RN-556 — Remover a própria linha de `project_members` é recusado com 403 quando o efeito líquido é rebaixamento {#rn-556}

> **Sobre o número.** O salto de [RN-542](../produto.md#rn-542) para 556 é deliberado: a
> faixa 543–555 está reservada para a FASE 30, que já a alocou em branches em
> voo. Alocar aqui produziria a colisão que este repositório já observou três
> vezes no mesmo instante (ADR 0148 ×2, RN-522 ×2, RN-523 ×2), resolvida depois
> pela DATA. Nada foi pulado por engano.

O [ADR 0127](../../adr/0127-tetos-de-rebaixamento-em-project-members.md) pôs os dois
tetos da [RN-472](parte-05.md#rn-472) só no caminho de ESCRITA e declarou o terceiro
movimento aberto, por escrito e com o custo estimado: *"`RemoveProjectMemberUseCase`
NÃO ganhou teto… A premissa de que 'a remoção é sempre benigna' é falsa, e fica
escrita aqui para não ser redescoberta"*. Esta RN fecha essa porta — é o
`BRB-001`, P1 de segurança.

**Remover não apaga um papel, TROCA o papel efetivo.** `ResolveEffectiveRoleUseCase.forProject`
é `projectRole ?? workspaceRole` ([RN-471](../web.md#rn-471)), e a sobreposição vale nos
DOIS sentidos. Some a linha de projeto, o efetivo passa a resolver pelo segundo
termo — que pode ser MENOR. Um `maintainer` cuja autoridade vinha da linha de
projeto, `viewer` no workspace, removia a própria linha e caía para `viewer`
sem volta pela tela: repor é `POST :projectId/members`, que pede o `maintainer`
recém-abandonado. Sem papel de workspace nenhum, a queda é para acesso NENHUM.

**É o teto 2, não um teto novo.** `ehAutoRebaixamento` compara o papel efetivo
de HOJE com o de DEPOIS, e nunca precisou saber por qual rota o segundo chegou:
no `add` o papel-depois vem do corpo, na remoção vem do workspace.
`remocaoEhAutoRebaixamento` é essa aplicação, e DELEGA — não reimplementa
comparação nenhuma. Ela existe como função própria por UM caso que a assinatura
da outra não sabe enunciar: ator sem papel de workspace, onde o papel-depois é
"nenhum", que não é um `Role`. Esse caso é o rebaixamento máximo e recusa.

| movimento | desfecho |
|---|---|
| remover a própria linha, workspace com o MESMO papel | passa — é como alguém sai da lista |
| remover a própria linha, workspace com papel MENOR | **403** |
| remover a própria linha, SEM papel de workspace | **403** — a queda é para acesso nenhum |
| remover a linha de OUTRA pessoa, mesmo que ela caia | passa — capacidade legítima de sempre |
| remover a linha que restringia o `owner` do WORKSPACE | passa — só pode ELEVAR |

**O teto 1 não ganha par, e a ausência é decisão.** `owner` é o topo do
`ROLE_ORDER`: remover a linha de projeto de quem é `owner` no workspace só pode
elevar o efetivo dele, ou mantê-lo. Mais que inofensivo, é a ÚNICA forma de
desfazer uma restrição que o teto 1 impede de criar. Um teto ali recusaria só
movimentos benignos e tornaria permanente o estado que o ADR 0127 nasceu para
eliminar. Está escrito ao lado da função e fixado em teste.

**Sem limiar, como o teto 2 — e o preço vem junto.** A recusa é "a si mesmo",
não "abaixo de `maintainer`", pelo mesmo motivo da RN-472: um limiar copiaria um
número do `@RequireRole` do controller para dentro do domínio e envelheceria
calado se a rota mudasse de mínimo. O preço declarado é a auto-remoção de quem
tem `owner` no projeto e `maintainer` no workspace: reversível, e recusada
também. Era o único movimento benigno que passava antes e passa a recusar; segue
alcançável por outro `maintainer`.

**A mensagem é PRÓPRIA.** Quem clicou "remover" não pediu para mudar papel
nenhum, então `MENSAGEM_TETO_AUTO_REBAIXAMENTO_POR_REMOCAO` diz o MECANISMO —
sem a linha de projeto o papel cai para o do workspace, e voltar exige o papel
abandonado — em vez de reusar a frase do `add`, que falaria de um movimento que
a pessoa não fez.

**A tela não muda, e a recusa aparece.** `MembersSection.handleRemove` já
mostra `mensagemDaApi(erro, …)` num toast ([RN-471](../web.md#rn-471)), então a frase da
api chega sem uma linha de web. Diferente do teto 1, este gate É calculável no
cliente — mas calcular só ele produziria o meio-gate que o ADR 0127 recusou.

- **Código:** `src/domain/iam/tetos-de-rebaixamento.ts`
  (`remocaoEhAutoRebaixamento` e `MENSAGEM_TETO_AUTO_REBAIXAMENTO_POR_REMOCAO`,
  mais o comentário que diz por que o teto 1 não tem par),
  `src/application/use-cases/iam/remove-project-member.use-case.ts`
  (a assinatura com `atorId` e as duas leituras de papel),
  `src/interfaces/http/iam/projects.controller.ts`
  (`@CurrentUser()` no `@Delete(':projectId/members/:userId')`, a descrição
  corrigida e o `@ApiForbiddenResponse`),
  `src/application/use-cases/iam/resolve-effective-role.use-case.ts`
  (INTOCADO — `projectRole ?? workspaceRole` segue como está)
- **Teste:** `test/application/use-cases/iam/tetos-de-rebaixamento.use-case.spec.ts`,
  bloco *"Teto 2 pela outra porta — a remoção da própria linha"* (as três
  recusas; a auto-remoção benigna; remover outra pessoa; e a remoção que
  devolve o projeto ao `owner` do workspace). O primeiro deles é o teste de
  lacuna do ADR 0127 INVERTIDO, com o nome guardando a origem
- **ADR:** [0156](../../adr/0156-teto-de-auto-rebaixamento-na-remocao.md), que
  referencia o [0127](../../adr/0127-tetos-de-rebaixamento-em-project-members.md) e
  fecha a lacuna que ele declarou
- **Origem:** `BRB-001`, P1 de Segurança do registro do mantenedor — a lacuna
  que o ADR 0127 escreveu com a frase *"quem for fechá-lo vê o teste falhar"*

---

## A rotação da chave mestra deixa de ser tentativa e erro (RN-562, RN-563) {#a-rotacao-da-chave-mestra-deixa-de-ser-tentativa-e-erro-rn-562-rn-563}

### RN-562 — A rotação da chave mestra é provada ponta a ponta, nas duas tabelas {#rn-562}

O procedimento com o pior desfecho do [Runbook](../../runbook.md#rotacao-da-chave-mestra)
passa a ter verificação NOMEADA: um teste percorre a rotação inteira —
**cifra com K1, publica K2, reenvelopa, descarta K1 e ainda decifra** — contra
`user_credentials` **e** `project_git_connections`, com Postgres de verdade.

**Por que de integração, e não mais um caso unitário.** O que já existia
(`envelope-encryption.service.spec.ts`, o describe `rotação da chave mestra`)
exercita `encrypt`/`decrypt`/`rewrap` em memória, e isso não prova a única coisa
que o passo 3 do runbook depende: que o script percorre **as duas** tabelas.
Convertendo metade do acervo e reportando sucesso, descartar a chave velha
tornaria a outra metade ilegível para sempre. A prova disso é a asserção sobre
as duas linhas — e ela reprova quando a lista de tabelas do script encolhe.

**A idempotência entra no mesmo teste**, porque é a propriedade que o runbook
promete a quem interrompe o script: a segunda rodada reporta
`re-embrulhados=0` e `já na chave atual=1` nas duas tabelas.

**Uma linha ilegível não aborta as outras.** Registro embrulhado por uma
TERCEIRA chave — o caso que o runbook chama de "veio de outro ambiente" — é
contado, identificado por tabela e id, e deixa as demais seguirem; o envelope
dele fica intocado.

**O que o teste exigiu do código:** `rewrap-deks.ts` era um `main()` disparado
na CARGA do módulo, então importá-lo de um spec rodaria a rotação. O núcleo
virou `reenvelopar(db, cofre, reportarFalha)`, exportado, e `main()` — que lê
ambiente, abre o pool, imprime e escolhe o código de saída — passou a rodar só
sob `require.main === module`. O nome do script e a invocação do runbook
(`node scripts/rewrap-deks.js`) NÃO mudaram.

**Nenhuma chave e nenhum segredo é literal no teste**: os dois nascem de
`randomBytes` a cada rodada. Passphrase constante em fixture é string com cara
de segredo indo para o histórico, e o gitleaks varre branches.

- **Código:** `src/scripts/rewrap-deks.ts:93` (`reenvelopar`, a função
  exportada), `:100` (a lista das duas tabelas, que é o que o teste fixa),
  `:209` (o `require.main === module` que impede a importação de rotacionar)
- **Teste:** `test/scripts/rewrap-deks.spec.ts` — o caminho feliz
  (a sequência K1 → K1+K2 → reenvelopa → só K2), a idempotência, e o caso de
  falha da linha de outro ambiente, que também assere que o relato NÃO carrega
  segredo nenhum
- **Origem:** AT-033 (EP-015/HS-022), finding `BRB-010`

### RN-563 — O envelope diz qual chave o embrulhou, e esse rótulo nunca decide se ele abre {#rn-563}

`user_credentials` e `project_git_connections` ganham `key_id text` **anulável**
— a impressão digital da chave mestra que embrulhou aquele DEK. Com ela, a
pergunta que decide o passo 3 da rotação (*"ainda há credencial na chave
velha?"*) vira uma consulta:

```sql
select count(*) from user_credentials      where key_id is distinct from '<atual>'
union all
select count(*) from project_git_connections where key_id is distinct from '<atual>';
```

`IS DISTINCT FROM`, e nunca `<>`: com `<>`, a linha de `key_id` NULO — o acervo
anterior a esta coluna — sumiria da contagem, e *"não sei qual chave"* viraria
*"já está na atual"*, que é a leitura que faz alguém descartar a chave velha
cedo demais.

**O valor é `HMAC-SHA256(chave derivada, 'brabo-master-key-id')` truncado a 8
bytes**, e não um contador no `.env` nem um hash da passphrase. Não há oráculo
novo, e isso foi MEDIDO, não suposto: quem lê o banco já tem um oráculo de
verificação perfeito — o próprio envelope é AES-256-GCM, que autentica, então
testar uma passphrase candidata já custava um `scrypt` e um decipher. Testá-la
contra a impressão custa o MESMO `scrypt`. E não há variável nova para o
operador errar: o valor é função pura da chave que ele já publicou.

**O rótulo é OBSERVABILIDADE, nunca AUTORIDADE.** `decrypt` fica byte a byte
como estava — tenta a atual, cai para a anterior, o GCM decide — e `rewrap`
continua decidindo "já está na chave atual" pela TENTATIVA. Confiar no rótulo
faria uma linha que MENTE (rótulo "atual", envelope na chave velha) ser pulada
em silêncio, ficar fora da contagem de re-embrulhados, e o passo 3 a tornaria
ilegível para sempre. Metadado incoerente vira perda de segredo; é por isso que
o teste que fixa esta regra é o de uma linha mentirosa sendo re-embrulhada
assim mesmo.

**O que o rótulo compra na falha:** quando NENHUMA das duas chaves abre, a
mensagem deixa de ser genérica e nomeia o caso — "veio de outro ambiente"
(rótulo desconhecido), "rótulo incoerente ou registro adulterado" (rótulo diz
atual e não abre) e "não tem key_id" (linha anterior a esta coluna) são
diagnósticos diferentes com ações diferentes. Nenhuma dessas mensagens carrega
passphrase, chave derivada ou conteúdo do segredo — só impressões digitais.

**Sem migração do acervo.** O `key_id` nasce na próxima escrita (`encrypt` e
`rewrap` o gravam). As linhas de hoje ficam `NULL`, e numa instalação existente
a consulta só passa a valer depois da primeira rotação. Forçar re-embrulho de
tudo só para preencher a coluna transformaria observabilidade em operação de
risco sobre todas as credenciais.

**O operador precisa da impressão corrente**, senão a coluna não se compara
contra nada: a api a registra no boot em uma linha, e a advertência de rotação
que já existia passa a nomear as DUAS.

- **Código:** `src/infrastructure/security/envelope-encryption.service.ts:130`
  (`impressaoDigital`), `:107` (a linha de boot), `:113` (a advertência com as
  duas), `:226` (o diagnóstico de `rewrap`), `:251` (`diagnosticoDaChave`);
  `src/db/schema/llm.ts:259` e `src/db/schema/git.ts:76`
  (a coluna nas duas tabelas); migration
  `src/db/migrations/0059_key_id_no_envelope.sql`
- **Teste:** o describe `key_id da chave mestra` em
  `test/infrastructure/security/envelope-encryption.service.spec.ts`
  — o caminho feliz (impressão estável e determinística, gravada por `encrypt`
  e por `rewrap`), **a prova de que o rótulo não decide** (linha mentirosa é
  re-embrulhada), a linha legada sem rótulo, e os dois casos de falha
  (mensagem que nomeia a chave sem vazar segredo; "sem rótulo" dito como tal).
  A consulta em SQL de verdade está em
  `test/scripts/rewrap-deks.spec.ts`, incluindo o caso da linha `NULL`
  contando como pendente
- **ADR:** [0158](../../adr/0158-o-id-da-chave-mestra-gravado-no-envelope.md)
- **Origem:** AT-034 (EP-015/HS-022), finding `BRB-016`

---
