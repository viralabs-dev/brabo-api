---
id: rn-api-parte-09
title: 'Regras de negócio — API — parte 9 (desde RN-677)'
sidebar_label: 'API — parte 9 (desde RN-677)'
description: 'As RNs hospedadas na raiz api.'
keywords: [regras de negócio, api]
---

# API — parte 9 (desde RN-677)

## O git credenciado roda no host do runner (RN-676) {#o-git-credenciado-roda-no-host-do-runner-rn-676}

### RN-677 — Aceitar o Dev Lead só o traz para planejar; APROVAR o plano dele é o que ativa a execução {#rn-677}

> **Revisa a [RN-161](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-161)** (decisão do
> dono, 01/10): aceitar o handoff ao Dev Lead deixou de encadear
> `POST .../execution/activate`, para TODO papel. O atalho explícito "Ativar
> execução" do card ([RN-137](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-137)) e o da Visão Geral continuam — são um
> clique próprio, não o aceite.

O uso real de 29/09 mediu a inversão: a execução foi ativada no aceite do
handoff às 06:45:01 — o web encadeava a ativação para `maintainer`/`owner`
(`session-acoes-de-handoff.ts`, RN-161) —, e o plano do Dev Lead, proposto às
06:47:47, ficou `pending` e nunca foi usado. O plano não tinha consumidor:
`propose_execution_plan` não tinha pipeline de execução e, aprovado, ficava
`approved` para sempre. Medido em `dev` antes de mudar: o backend do aceite
(`AcceptHandoffUseCase`) NUNCA emitiu `execution.activated`; quem o emite é só
`ActivateExecutionUseCase`, chamado só pela rota `execution/activate`.

**A regra:**

1. **O aceite do Dev Lead só o ativa para planejar.** `handleAcceptHandoff`
   aceita e mais nada; o `AcceptHandoffUseCase` não muda — segue provisionando
   o repositório como segunda porta idempotente ([RN-582](parte-07.md#rn-582)).
2. **Aprovar o `propose_execution_plan` ATIVA a execução.** A ação ganhou
   executor na api, `ExecuteExecutionPlanUseCase`, chamado pela aprovação
   manual (`ApproveActionUseCase`) e pela auto-aprovação
   (`ProposeActionUseCase` — o tipo não está nos tetos absolutos de
   `decide.ts`, então PODE ser configurado auto-aprovável). Ele grava o módulo
   das tarefas ([RN-678](#rn-678)) e chama o MESMO `ActivateExecutionUseCase`
   do botão — nenhuma segunda régua: o 409 sem repositório (RN-582), o 409 de
   `execution.activated` em sessão consultiva ([RN-097](parte-02.md#rn-097)) e a
   reativação idempotente por `findActiveExecutionSession` continuam lá,
   intocados.
3. **Quem ativa é quem APROVOU** (`decidedBy`); na auto-aprovação, quem abriu
   a sessão — contra quem `decide()` resolveu o papel. Os dois exigem
   `maintainer`, o mesmo mínimo de `execution/activate`, então a resolução do
   papel efetivo dos `git_*` dos dev agents (o `createdBy` da sessão de
   execução) não muda de dono.
4. **A sessão do Dev Lead NÃO fecha** (não é passada como `originSessionId`,
   [RN-135](parte-03.md#rn-135)): é nela que ele retoma o turno suspenso e narra o
   desfecho.
5. **O desfecho é nomeado e durável.** A ação termina `executed` com
   `{ sessaoDeExecucao, modulos, tarefasAtribuidas }` ou `failed` com o
   `motivo` (a frase da api, ex.: o 409 sem repositório), mais o evento
   `execution.plan_applied`/`execution.plan_failed` na timeline. O Dev Lead
   lê o desfecho real ao retomar ("execução ATIVADA na sessão …" ou "a
   ativação falhou: …"), nunca "plano registrado". Falhar não desfaz a
   aprovação: a decisão do humano já está gravada.

- **Onde:** `src/application/use-cases/execution/execute-execution-plan.use-case.ts:89`
  (`execute`); `src/application/use-cases/actions/approve-action.use-case.ts:221`
  (`executeExecutionPlan`); `src/application/use-cases/actions/propose-action.use-case.ts:427`
  (`executeExecutionPlan`); `apps/web/src/lib/session-acoes-de-handoff.ts:91`
  (`handleAcceptHandoff`); `apps/engine/lib/engine/agents/dev_lead_tools.ex:274`
  (`classificar`); `apps/engine/lib/engine/agents/dev_lead_server.ex:811`
  (`texto_do_desfecho`); `apps/web/src/lib/aprovacoes.ts:359`
  (`propose_execution_plan`)
- **Teste:** `test/application/use-cases/execution/execute-execution-plan.use-case.spec.ts:106`
  (aprovado ativa como quem aprovou — caminho feliz), `:129` (auto-aprovado:
  quem abriu a sessão), `:151` (ativação recusada por falta de repositório
  vira `failed` com a frase — caso de falha);
  `test/application/use-cases/actions/approve-deny-action.use-case.spec.ts:399`
  (aprovar chama o executor e avisa o Dev Lead);
  `apps/web/src/routes/SessionPage.handoff-devlead-e-colapso.test.tsx:396`
  (aceitar não ativa, nos três papéis), `:416` (o atalho explícito continua);
  `apps/web/src/lib/aprovacoes.test.ts:118` (a frase diz que aprovar ativa);
  `apps/engine/test/engine/agents/dev_lead_tools_test.exs:134`, `:141`;
  `apps/engine/test/engine/agents/dev_lead_server_test.exs:426`, `:457`
- **Decisão arquitetural:** [ADR 0194](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0194-aprovar-o-plano-ativa-a-execucao.md)
- **Origem:** AT-263 (item A17 da análise do uso real de 29/09)

### RN-678 — A tarefa pertence a um módulo, atribuído pelo Dev Lead no plano, e só o dev daquele módulo a pega {#rn-678}

No uso real de 29/09 `dev-input-keyboard` pegou "Implementar loop de queda
automática da peça" e `dev-board-engine` pegou "Mapear teclas…": a tarefa não
tinha módulo, a história tinha vários, e `claimNext` deixava qualquer dev de
qualquer módulo da história pegar qualquer tarefa dela (`s.module_ids ? $1`).

**A regra:**

1. **A tarefa tem módulo** — `tasks.module`, `text` nulo (migração
   `0068_modulo_da_tarefa`). Quem o atribui é o **Dev Lead**, no plano de
   execução: `propose_execution_plan` ganhou `tarefas: [{ taskId, modulo }]`,
   e o kickoff dele lista as tarefas pendentes do backlog do PROJETO com o
   `task_id` e os módulos da história.
2. **O conjunto válido é o `module_map` vigente.** A api lê o plano
   (`lerPlanoDeExecucao`, função pura) na PROPOSTA e recusa com 400
   `plano_de_execucao_invalido`, sem criar a ação, quando: o plano não tem
   `tarefas`; uma tarefa não tem `taskId` ou está **sem módulo**; o módulo
   (da tarefa ou do plano) está **fora do `module_map`**; a tarefa aparece duas
   vezes; ou não existe neste projeto. A frase nomeia a tarefa, o módulo e os
   módulos válidos, e volta ao Dev Lead como erro da ferramenta (entrada do
   laço, [RN-163](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-163)), para ele corrigir.
3. **A aprovação relê** o plano contra o `module_map` daquele momento (ele pode
   ter mudado): recusa vira `failed` sem gravar nada e sem ativar. Passando,
   os módulos são gravados ANTES da ativação, para nenhum dev agent recém-subido
   procurar tarefa sem dono.
4. **Só o dev daquele módulo pega.** `claimNext` e `countClaimableByModule`
   usam o MESMO predicado (`daTarefaDoModulo`): tarefa com módulo é de quem
   tem aquele módulo, e de mais ninguém — os `module_ids` da história deixam de
   decidir. Tarefa **sem** módulo só é pegável quando a história tem UM módulo
   só, e ele é o do dev: é o único caso em que "o dev daquele módulo" não é
   ambíguo, e é o caminho de quem ativou pela Visão Geral sem plano. Tarefa sem
   módulo de história com vários espera o próximo plano.

Fica de fora, declarado: tarefa criada DEPOIS do plano nasce sem módulo (o PO
não atribui); o aviso `task.became_claimable` segue roteado pelos módulos da
HISTÓRIA (acordar um dev a mais não pega nada, só gasta uma consulta); e o
`agentes` por módulo do plano segue informativo — a ativação sobe um dev por
módulo do `module_map`, como antes, e o paralelismo extra continua pelo
`parallelize` ([RN-083](parte-02.md#rn-083)).

- **Onde:** `src/domain/execution/plano-de-execucao.ts:39`
  (`lerPlanoDeExecucao`); `src/infrastructure/persistence/drizzle/backlog.repository.ts:720`
  (`daTarefaDoModulo`), `:403` (`claimNext`), `:391` (`assignModules`);
  `src/application/use-cases/actions/propose-action.use-case.ts:141`
  (`recusaNaProposta`); `src/application/use-cases/execution/execute-execution-plan.use-case.ts:67`
  (`recusaNaProposta`); `src/db/schema/backlog.ts:187` (`module`);
  `apps/engine/lib/engine/agents/dev_lead_tools.ex:460`
  (`tarefas_do_backlog`); `apps/engine/lib/engine/agents/dev_lead_tools.ex:259`
  (`erro_da_proposta`)
- **Teste:** `test/domain/execution/plano-de-execucao.spec.ts:22`
  (caminho feliz), `:41` (tarefa sem módulo — caso de falha), `:49` (módulo
  fora do `module_map`), `:80` (repetida e de outro projeto);
  `test/application/use-cases/execution/claim-next-task.use-case.spec.ts:127`
  (história com dois módulos: só o dev do módulo da tarefa), `:152` (sem
  módulo e vários módulos: ninguém), `:169` (o módulo da tarefa vence);
  `test/application/use-cases/actions/propose-action.use-case.spec.ts:289`
  (400 nomeado, sem proposta);
  `test/application/use-cases/execution/execute-execution-plan.use-case.spec.ts:135`
  (módulo fora do mapa na aprovação: nada gravado, nada ativado);
  `apps/engine/test/engine/agents/dev_lead_tools_test.exs:110`, `:118`;
  `apps/engine/test/engine/agents/dev_lead_server_test.exs:131`
- **Decisão arquitetural:** [ADR 0194](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0194-aprovar-o-plano-ativa-a-execucao.md)
- **Origem:** AT-274 (item A28 / extra E5 da análise do uso real de 29/09)

### RN-679 — A curadoria recusa o alias de roteamento livre do OpenRouter {#rn-679}

Decisão do dono (01/10): **o alias `~` não entra na curadoria** — só modelo
com upstream fixo. O alias de roteamento livre do OpenRouter (o id que começa
com `~`, como `~deepseek/deepseek-flash-latest`) "sempre redireciona para o
último da família": o catálogo publica um preço de VITRINE (no uso real de
29/09, o do endpoint mais barato da família), a lista de endpoints vem vazia,
e quem cobra é o upstream que atendeu. Não há upstream contra o qual o preço
congelado do [ADR 0042](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
signifique alguma coisa. A alternativa — preçar por upstream — foi recusada.

1. **A régua é do provider.** `ehAliasDeRoteamentoLivre` é `provider =
   'openrouter'` E nome começando com `~`; o mesmo prefixo noutro provider não
   é alias e não recusa.
2. **Ativar recusa, com código.** `POST .../models/activate` com
   `isActive: true` e algum alias no lote é **422** com
   `code: "alias_de_roteamento_livre"`, os `modelIds` recusados e uma frase que
   os nomeia. O lote INTEIRO é recusado, como o 404 do id inexistente
   ([RN-043](parte-01.md#rn-043)): nem o modelo de upstream fixo do mesmo lote é ligado.
   A tela de catálogo mostra a frase da api num toast de título próprio, e
   casa pelo `code`, nunca pelo texto.
3. **O sync NÃO filtra o alias.** Ele continua no catálogo — sumir dali faria
   o sync marcar `unavailable` o que já estava curado, e a cascata pularia os
   bindings dele em silêncio. A leitura da curadoria o MARCA:
   `freeRoutingAlias`, derivado de provider e nome na leitura, nunca gravado.
   A linha mostra o selo e o motivo em TEXTO antes de alguém tentar ativar.
4. **O que já estava curado segue funcionando.** É mensurável (o nome com `~`
   na linha do OpenRouter), e a saída escolhida é a menos surpreendente: o
   alias ativo antes da regra **continua ativo** — os bindings dele seguem
   resolvendo, o seletor segue mostrando —, sai marcado no catálogo, e pode
   ser DESLIGADO. Desligado, não volta. Nada é apagado e nenhum binding é
   reescrito. Binding NOVO para um alias ainda ativo não é recusado aqui: a
   regra é da curadoria, e o binding segue a [RN-043](parte-01.md#rn-043).

- **Onde:** `src/domain/llm/alias-de-roteamento-livre.ts:23` (`ehAliasDeRoteamentoLivre`),
  `:41` (`AliasDeRoteamentoLivreError`),
  `src/application/use-cases/llm/set-models-active.use-case.ts:59` (`AliasDeRoteamentoLivreError`),
  `src/infrastructure/persistence/drizzle/workspace-model.repository.ts:67` (`freeRoutingAlias`),
  `src/interfaces/http/shared/llm-binding-error.filter.ts:60` (`code`),
  `apps/web/src/components/ModelCatalogSection.tsx:606` (`recusaDeAliasLivre`)
- **Teste:** `test/application/use-cases/llm/set-models-active.use-case.spec.ts`
  (lote recusado inteiro com código e ids; upstream fixo ativa; `~` fora do
  OpenRouter ativa; alias curado antes da regra segue ativo, marcado, desliga
  e não volta), `test/interfaces/http/shared/llm-binding-error.filter.spec.ts`,
  `apps/web/src/components/ModelCatalogSection.test.tsx` (selo e motivo;
  toast da recusa; toast genérico para outro erro)
- **Origem:** AT-271 (item A25 da análise do uso real de 29/09); complementa a
  [RN-665](parte-08.md#rn-665)

### RN-681 — História e regra parecidas com uma existente geram AVISO por embedding, nunca recusa; o gasto da checagem é linha própria do metering {#rn-681}

Depois de gravar uma história (`create_story`) ou uma regra de negócio
(`emit_artifact` de `business_rule`), a api compara o TÍTULO dela com os das
existentes do mesmo tipo no PROJETO, por cosseno entre vetores do modelo de
embedding do RAG, e AVISA quando a mais próxima está a partir do limiar.

1. **Aviso, nunca recusa.** O item já existe quando a checagem roda. O aviso
   volta ao agente no resultado da ferramenta — a frase nomeia o parecido, o
   id e o número — e fica no log como `backlog.semantic_duplicate_warned`. A
   duplicata EXATA continua recusada antes, pela [RN-080](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-080) e pela
   [RN-081](parte-02.md#rn-081), e por isso título normalizado igual sai da comparação.
2. **O limiar é 0,80 e é PONTO DE PARTIDA, não calibrado** (ADR 0198, como os
   pesos do [ADR 0080](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0080-busca-hibrida-pesos-limiar-e-citacao.md)):
   os vetores reais do par do achado R e dos pares que não são duplicata não
   puderam ser gravados no ambiente em que a regra nasceu. A prova roda sozinha
   quando `vetores.json` for gravado; até lá ela é PULADA com aviso.
3. **Sem provider de embedding a checagem é PULADA e DITA** — capability
   ausente, daemon fora, timeout: `backlog.semantic_duplicate_check_skipped`
   com o motivo no log e na frase ao agente. Nunca falha a emissão.
4. **O gasto entra no metering como linha própria**: ator
   `system`/`duplicata-semantica`, provider e modelo do RAG, saída zero, preço
   do catálogo quando o modelo está nele. É a ÚNICA exceção ao corte do
   [ADR 0075](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0075-embeddings-no-contrato-de-llm-provider.md) — a
   indexação e a busca do RAG seguem fora —, e cabe porque a emissão acontece
   dentro de sessão.
5. **Tetos:** as 100 existentes mais recentes (o resultado diz quantas de
   quantas quando corta) e 10 s de relógio para a checagem inteira.

- **Onde:** `src/domain/backlog/duplicata-semantica.ts:35` (`LIMIAR_DE_DUPLICATA_SEMANTICA`),
  `:44` (`TETO_DE_COMPARACOES_DE_DUPLICATA`), `:53` (`TETO_DE_TEMPO_DA_CHECAGEM_MS`),
  `:107` (`ehDuplicataSemantica`),
  `src/application/use-cases/backlog/verificar-duplicata-semantica.use-case.ts:112` (`VerificarDuplicataSemanticaUseCase`),
  `:247` (`medir`), `:291` (`narrar`), `:355` (`fraseParaOAgente`),
  `src/application/use-cases/backlog/create-story.use-case.ts:199` (`semanticDuplicate`),
  `src/interfaces/http/internal/internal-sessions.controller.ts:678` (`semanticDuplicateCheck`),
  `src/application/use-cases/rag/rag-embedding.service.ts:106` (`uso`),
  `apps/engine/lib/engine/harness/tools/emit_artifact.ex` (`aviso_semantico`),
  `apps/engine/lib/engine/harness/tools/create_story.ex` (`aviso_semantico`)
- **Teste:** `test/application/use-cases/backlog/verificar-duplicata-semantica.use-case.spec.ts`
  (avisa acima do limiar; o gasto vira linha própria; abaixo não narra; sem
  provider pula dizendo; teto de tempo; teto de comparações; regra pelos
  eventos; metering e log que falham não derrubam),
  `test/application/use-cases/backlog/create-story.use-case.spec.ts`
  (`duplicata semântica (RN-681)`), `test/domain/backlog/duplicata-semantica.spec.ts`,
  `test/domain/backlog/limiar-de-duplicata.calibracao.spec.ts` (o NÚMERO —
  pulada até os vetores serem gravados),
  `apps/engine/test/engine/harness/duplicata_semantica_test.exs`,
  `apps/web/src/lib/activity.test.ts` (`duplicata semântica (RN-681)`)
- **Origem:** [ADR 0198](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0198-duplicata-semantica-por-embedding-com-limiar-que-so-avisa.md)
  (AT-171, achado R)

## A Anamnese religada: sujeito elegível e fato do perfil (RN-680) {#a-anamnese-religada-sujeito-elegivel-e-fato-do-perfil-rn-680}

### RN-682 — A consultiva sem agente pede um agente: o composer não envia sem destinatário, e a rota de chat recusa com nome {#rn-682}

Até aqui, a mensagem de uma sessão **consultiva** sem agente ia ao SSE de
`POST .../chat` (`SendChatMessageUseCase`), que manda ao modelo vinculado só o
texto atual — sem histórico, sem prompt de sistema, sem ferramenta — e grava a
resposta com o NOME DO MODELO como ator. Medido no uso real de 29/09: a sessão
5d66 respondeu "não tenho acesso a conversas anteriores". A decisão do dono
(01/10) é que, sem agente ativo, a consultiva **pede para escolher um agente**
— a mesma régua da [RN-584](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-584) (nenhum destinatário padrão) chegando ao
último caso que ainda tinha um: o modelo cru.

**A medição, antes do conserto:** a rota de chat tinha UM cliente, a tela
(`handleSend`, só quando não havia destinatário — o que, desde a
[RN-631](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-631), só acontecia na consultiva sem agente: a criativa sempre tem
o Criativo como opção). O `curl` que o seed imprime é dica de desenvolvimento,
numa sessão criativa. O caso de uso tem um SEGUNDO consumidor legítimo: os
smokes de provider (`*-provider.smoke.spec.ts`) o usam direto como instrumento
de ponta a ponta (credencial → chamada → metering) numa sessão sem agente. Por
isso a recusa da api mora na ROTA, e o caso de uso não muda.

**A regra:**

1. **A tela não envia sem destinatário.** O "Enviar" e o Enter ficam travados
   com zero opções, como já ficavam com duas sem escolha; o ramo do SSE saiu de
   `handleSend`.
2. **A linha do destinatário MOSTRA quem pode ser chamado.** Sem opção, o
   seletor do handoff manual ([RN-440](parte-05.md#rn-440)) muda de lugar para dentro
   dela — "Para", a lista, e "Chamar" —, e o seletor de cima some para não
   haver a mesma escolha em dois lugares. A lista são os agentes que conversam
   (`AGENTES_DE_CHAT`, os que o engine casa com cláusula própria) e que o
   handoff manual alcança, menos quem já entrou e **menos o Criativo**: a
   consultiva promete no convite que ele não entra, porque abrir a ideação é o
   que a criativa faz ([RN-097](parte-02.md#rn-097)). Chamar oferece o handoff; aceitá-lo
   no fio faz do agente o destinatário (RN-631).
3. **A api recusa o mesmo caso para qualquer cliente.** `POST .../chat` numa
   sessão consultiva em que nenhum `agent.activated` foi gravado é **422**
   `{reason: "destinatario_ausente"}`, com a frase que aponta
   `.../agents/:agent/message`, ANTES de qualquer efeito: nada é gravado e
   nenhum modelo é chamado. A recusa sai como resposta HTTP e não como quadro
   `error` dentro de um stream 200 — o handler devolve `Promise<Observable>`,
   e a rejeição antes do cabeçalho do SSE vira a resposta normal.

**O que esta regra NÃO fecha, declarado:**

- **A rota segue respondendo pelo modelo cru fora desse caso**: numa criativa
  sem agente (o `curl` do seed) e numa consultiva COM agente, para quem a
  chamar à mão. A tela não a chama em nenhum dos dois; a decisão do dono foi
  sobre a consultiva sem agente, e fechar a rota inteira é decisão à parte.
- O chat livre com histórico, a outra opção da AT-254, não foi feito.

- **Código:** `src/domain/sessions/chat-sem-destinatario.ts:24`
  (`chatSemDestinatarioRecusado`), `:17` (`MOTIVO_CHAT_SEM_DESTINATARIO`);
  `src/application/use-cases/llm/garantir-destinatario-do-chat.use-case.ts:27`
  (`GarantirDestinatarioDoChatUseCase`);
  `src/interfaces/http/llm/chat.controller.ts:82` (`chat`);
  `apps/web/src/lib/session-destinatario.ts:347` (`agentesParaChamar`);
  `apps/web/src/routes/SessionPage.tsx:690` (`handleSend`);
  `apps/web/src/routes/SessionComposer.tsx:276`
- **Teste:** `test/application/use-cases/llm/garantir-destinatario-do-chat.use-case.spec.ts:82`
  (consultiva sem agente — caso de falha), `:96`, `:113`, `:120`;
  `test/interfaces/http/llm/chat.controller.spec.ts:56` (422 como
  resposta HTTP), `:79` (caminho feliz);
  `apps/web/src/routes/SessionPage.destinatario-do-chat.test.tsx:458` (não
  envia — caso de falha), `:471` (lista e Chamar — caminho feliz);
  `apps/web/src/lib/session-destinatario.test.ts:93`;
  `apps/web/src/routes/SessionPage.ideacao-automatica.test.tsx:177`
- **Origem:** AT-254 (item A8 da análise do uso real de 2026-09-29), decisão do
  dono de 01/10

## O plano de teste nasce depois da entrega do dev (RN-674, ADR 0192) {#o-plano-de-teste-nasce-depois-da-entrega-do-dev-rn-674-adr-0192}

### RN-683 — A Infra sobe o container com o MENOR recurso elegível, derivado do que o Arquiteto declara por módulo no `module_map` {#rn-683}

Decisão do dono em 01/10 ([ADR 0199](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0199-recurso-minimo-derivado-do-module-map.md),
AT-261). Até aqui `resources` omitido virava `RECURSOS_PADRAO` (2 cpus,
4096 MiB, 512 pids) e a subida do servidor no aceite ([RN-671](parte-08.md#rn-671)) o
omitia sempre: todo container nascia no padrão, sem noção de mínimo.

1. **Cada módulo declara o seu.** O `module_map` ganha `resources`
   (`cpus`, `memoryMb`, `pidsLimit`) por módulo — o que AQUELE módulo precisa
   sozinho no container. A ferramenta `create_module_map` o pede; a api o
   aceita ausente e recusa com 400, na criação do mapa: declaração pela METADE
   (os três ou nenhum), valor não positivo ou acima do teto, e SOMA entre
   módulos acima do teto. O campo mora no JSON do artefato, sem migration.
2. **O mínimo é a SOMA, campo a campo.** Um projeto tem UM container
   (`project_id UNIQUE` em `project_containers`) e os módulos rodam nele ao
   mesmo tempo; o máximo entre módulos subdimensionaria o container sempre que
   dois estivessem de pé.
3. **Módulo sem declaração: piso no padrão de hoje.** Não se inventa número.
   Havendo módulo sem declaração, o mínimo é o maior entre a soma dos
   declarados e `RECURSOS_PADRAO`, campo a campo, e o `rationale` NOMEIA quem
   não declarou. Sem declaração nenhuma (todo mapa anterior a esta regra), e
   sem `module_map` vigente, o mínimo é exatamente o padrão de hoje.
4. **A execução de `container_start` resolve campo a campo.** Omitido vira o
   mínimo (a subida do servidor manda tudo omitido); abaixo do mínimo é
   `failed` nomeado, sem gravar decisão de imagem nem subir; acima vale até o
   teto, que não muda. O `rationale` do `artifact.project_image` gravado ganha
   "Recursos mínimos (RN-683): …" com os módulos somados e a versão do mapa.
5. **Uma régua só.** Quem deriva é a api; o engine não soma nada e a subida do
   servidor diz no rationale que os recursos são o mínimo derivado.

Fora, declarado: `choose_project_image` (o Arquiteto decide a imagem e os
recursos dele) e `container_start_via_runner` (sobe a imagem já decidida) não
mudam; a recusa abaixo do mínimo acontece na execução, não ao propor.

- **Código:** `src/domain/containers/recursos-minimos.ts:70`
  (`validarRecursosDoModulo`), `:108` (`derivarRecursosMinimos`), `:150`
  (`validarSomaNoTeto`), `:171` (`resolverRecursosDaSubida`), `:206`
  (`explicarRecursosMinimos`);
  `src/application/use-cases/architecture/create-module-map.use-case.ts:134`
  (`normalizarModulo`);
  `src/application/use-cases/actions/execute-container-start.use-case.ts:175`
  (`resolverRecursosDaSubida`);
  `apps/engine/lib/engine/harness/tools/create_module_map.ex:103` (`normalize`);
  `apps/engine/lib/engine/infra/infra_lead_server.ex:805`
  (`rationale_do_servidor`)
- **Teste:** `test/domain/containers/recursos-minimos.spec.ts:18`
  (soma — caminho feliz), `:35` (mapa antigo = padrão), `:41` (piso e nomeado),
  `:54` (soma acima do teto — caso de falha), `:94` (abaixo do mínimo);
  `test/application/use-cases/architecture/create-module-map.use-case.spec.ts:190`
  (grava), `:208` (pela metade — caso de falha), `:217` (soma no teto);
  `test/application/use-cases/actions/execute-container-start.use-case.spec.ts:530`
  (subida do servidor com a soma), `:556` (sem declaração), `:575` (acima),
  `:588` (abaixo — caso de falha), `:608` (sem mapa);
  `apps/engine/test/engine/harness/tools/create_module_map_test.exs:94`, `:109`;
  `apps/engine/test/engine/infra/infra_lead_server_test.exs:1307`
- **Origem:** AT-261 (item A15 da análise do uso real de 29/09)

## A Anamnese religada: sujeito elegível e fato do perfil (RN-680) {#a-anamnese-religada-sujeito-elegivel-e-fato-do-perfil-rn-680-1}

### RN-684 — O contrato entre módulos é artefato versionado do Arquiteto, e o dev agent o lê pela ferramenta, nunca no worktree de outro dev {#rn-684}

Decisão do dono (01/10), registrada no
[ADR 0200](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0200-contrato-entre-modulos-artefato-do-arquiteto.md). No uso
real de 29/09, `dev-board-engine` gastou 5 dos seus 24 passos com ferramenta
lendo o worktree de outros módulos para descobrir a interface deles: o
`module_map` diz quem depende de quem, nunca o que um módulo expõe. Aplica a
[RN-164](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-164) aos dev agents.

1. **O artefato é `artifact.module_contracts`**, sem tabela, como o
   `module_routing` e o `c4_diagram`: o vigente é o de maior `version`, com
   desempate por `seq`. Cada declaração leva a lista INTEIRA e SUBSTITUI a
   anterior; mudar contrato é versão nova do Arquiteto.
2. **Por módulo, só o que ele EXPÕE**: `{modulo, expoe: [{tipo, assinatura,
   descricao}]}`, `tipo` em `funcao | rota | evento | dado`, `assinatura`
   obrigatória (até 300 caracteres), de 1 a 40 itens. O que ele CONSOME é o
   `dependsOn` do `module_map` vigente, derivado na leitura — nunca redigitado.
3. **A api recusa com 400 e o motivo inteiro** (que volta ao modelo, RN-061):
   lista vazia, módulo repetido, módulo fora do `module_map` vigente (listando
   os válidos) ou sem `module_map`, `expoe` vazio ou acima de 40, `tipo`
   desconhecido, `assinatura` vazia ou acima de 300. Nada é gravado.
4. **Artefato SEPARADO do `module_map`**, nunca um campo dele: revisar um não
   reemite o outro.
5. **O dev lê por `listar_contratos_de_modulos`**, `:direct`, no registro de
   `Engine.Dev.Tools`: escopo do projeto pela rota, NENHUM parâmetro, o módulo
   do dev vindo de `ctx.module`. Mostra por inteiro o dele e os que ele
   consome; quem o consome e os demais, só pelo nome; teto de 120 itens com o
   corte dito. Contrato de módulo que saiu do mapa é DITO, nunca atribuído.
6. **O kickoff do dev diz onde ler a interface de outro módulo**, e que não é
   no worktree de outro dev agent. Sem contrato para um módulo mostrado, a
   ferramenta manda implementar pelo que a story e a task dizem e, se faltar
   interface, `report_blocked` nomeando o módulo — nunca reler o worktree.

- **Código:** `src/domain/architecture/module-contracts.ts:110`
  (`validarContratos`);
  `src/application/use-cases/architecture/declare-module-contracts.use-case.ts:55`
  (`execute`), `:80` (`missingModules`);
  `src/application/use-cases/architecture/get-module-contracts.use-case.ts:23`
  (`execute`);
  `src/application/use-cases/architecture/list-module-contracts.use-case.ts:42`
  (`execute`);
  `src/interfaces/http/internal/internal-sessions.controller.ts:818`
  (`moduleContracts`);
  `src/interfaces/http/internal/internal-projects.controller.ts:181`
  (`moduleContracts`);
  `apps/engine/lib/engine/harness/tools/declare_module_contracts.ex:91` (`run`);
  `apps/engine/lib/engine/harness/tools/listar_contratos_de_modulos.ex:43`
  (`run`), `:66` (`renderizar`);
  `apps/engine/lib/engine/dev/tools.ex:36` (`ListarContratosDeModulos`);
  `apps/engine/lib/engine/dev/dev_agent_server.ex:516` (`module`), `:501`;
  `apps/engine/lib/engine/agents/arquiteto_server.ex:112`, `:335`, `:399`
- **Teste:** `test/application/use-cases/architecture/module-contracts.use-case.spec.ts:173`
  (grava a versão 1 — caminho feliz), `:185` (a vigente substitui), `:210`
  (módulo fora do mapa — caso de falha), `:222` (sem `module_map`), `:123`
  (as recusas de domínio), `:239` e `:257` (a leitura do dev);
  `apps/engine/test/engine/harness/tools/declare_module_contracts_test.exs:26`,
  `:65` (recusa da api); `apps/engine/test/engine/harness/tools/listar_contratos_de_modulos_test.exs:71`,
  `:76`, `:97`, `:109`, `:128`; `scripts/jev/kickoff.spec.ts:19`. Os testes
  ExUnit não rodaram pelo `mix` neste ambiente (`repo.hex.pm` 403; rodaram
  num harness avulso com os módulos compilados à mão); o CI os prova.
- **Origem:** AT-276 (item A30 da análise do uso real de 2026-09-29), decisão
  do dono de 01/10

### RN-685 — Revogar uma credencial derruba só as conexões abertas COM ELA: o ticket do socket guarda a credencial, e o alvo deixa de ser `{projeto, usuário}` {#rn-685}

Revisa a [RN-520](parte-06.md#rn-520). Até aqui, revogar uma chave de dispositivo derrubava
a conexão viva do runner pelo par `{projeto, usuário}`, porque a identidade da
credencial morria no `PatAuthGuard`: um runner do MESMO usuário conectado com
PAT ou com outra chave caía junto, e a chave de MÁQUINA
([RN-543](https://github.com/viralabs-dev/brabo/blob/dev/docs/business-rules/produto.md#rn-543)) multiplicava isso por projeto. Revogar um PAT não derrubava
nada.

**O ticket guarda QUAL credencial o pediu.** `runner_socket_tickets` (tabela do
engine) ganha `credential_kind` (`device_key` | `pat`) e `credential_id` (o
`kid`, que é o id do registro — [RN-475](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-475) —, ou o id do PAT), as duas
NULÁVEIS: o ticket de `terminal` é da aba da web e não tem credencial de
dispositivo, e o de `runner` emitido por uma api anterior chega sem ela. O
`PatAuthGuard` anota a credencial DEPOIS de autorizar
(`request.credencialDeDispositivo`), o ticket de `runner` a leva ao engine e o
de `terminal` nunca leva; par incompleto ou espécie desconhecida vira AUSENTE,
nunca uma credencial inventada.

**O socket guarda a credencial, e o id dele também.** `connect/3` põe
`assigns.credencial`, e o id passa a ser
`runner_socket:<kind>:<projectId>:<userId>:<espécie>:<id>` quando ela existe —
o `disconnect` que o canal difunde para o próprio id alcança só aquela
credencial.

**A revogação de UMA credencial:**

1. **anula os tickets PENDENTES dela** — o pedido feito segundos antes da
   revogação não entra depois dela (`consumed_at`, o mesmo estado de "já
   usado", nenhum estado novo);
2. **pergunta a TODO runner do cluster** se ele nasceu desta credencial — só o
   canal sabe —, e só quem nasceu dela cai. A chave de máquina é UM pedido, e
   cai em todo projeto em que abriu conexão, inclusive num que a api não
   listaria;
3. responde um BALANÇO (`derrubados`, `legados`, `intocados`, `semResposta`,
   `ticketsAnulados`) — zero derrubados é o caso normal da chave órfã
   ([RN-519](parte-06.md#rn-519)).

Vale para as três revogações: a de chave (por projeto e pela Conta,
[RN-611](parte-07.md#rn-611)) e as duas de PAT (a do dono, [RN-426](parte-04.md#rn-426),
e a do `maintainer`, [RN-427](parte-04.md#rn-427)).
Revoga PRIMEIRO, derruba depois, e derrubar continua sendo efeito colateral que
só LOGA — o `DELETE` segue 204 e idempotente.

**O que já caía continua caindo** (a proibição da AT-013). A conexão LEGADA —
ticket sem credencial — do mesmo dono, num dos projetos que a revogação de
CHAVE manda como alcance (o da linha, ou os candidatos da máquina), cai pelo
par como antes; o PAT não ganha alcance legado, porque não derrubava nada. E se
o engine não conhece a rota por credencial (404 de um engine anterior), a
revogação de chave volta ao par, `disconnectRunnerOfUser`, projeto a projeto.

**O par `{projeto, usuário}` continua, com outro dono:** é o alvo da remoção de
membro ([RN-615](parte-07.md#rn-615)), que tira a PESSOA, com a credencial que for.

**A tela diz a precisão** ([RN-561](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-561)): a confirmação de revogar — chaves
de dispositivo em Configurações e chaves de máquina na Conta — troca *"outro
runner seu também cai"* por *"só cai o que se conectou com ESTA chave"*. Muda o
rótulo, não o comportamento.

- **Onde:** `src/interfaces/http/auth/pat-auth.guard.ts:151`
  (`credencialDeDispositivo`, o PAT), `:236` (`credencialDeDispositivo`, a
  chave);
  `src/interfaces/http/runner/runner-tickets.controller.ts:67`
  (`runnerTicket`);
  `src/application/use-cases/runner/request-runner-ticket.use-case.ts:55`
  (`execute`);
  `src/application/use-cases/auth/revoke-runner-device-key.use-case.ts:71`
  (`execute`), `:109` (`derrubarConexoesDaChave`);
  `src/application/use-cases/auth/derrubar-conexoes-do-pat.ts:21`
  (`derrubarConexoesDoPat`);
  `src/infrastructure/http-clients/api-to-engine-client.ts:693`
  (`disconnectRunnerCredential`);
  `apps/engine/lib/engine/runners/socket_ticket.ex:107` (`emitir`), `:207`
  (`anular_pendentes_da_credencial`);
  `apps/engine/lib/engine/runners/revogacao.ex:131` (`derrubar_credencial`);
  `apps/engine/lib/engine/runners/registry.ex:64` (`todos`);
  `apps/engine/lib/engine_web/channels/runner_socket.ex:81` (`socket_id`);
  `apps/engine/lib/engine_web/channels/terminal_channel.ex:772`
  (`handle_info`), `:879` (`desfecho_da_revogacao_por_credencial`);
  `apps/engine/lib/engine_web/controllers/runner_connection_command_controller.ex:58`
  (`disconnect_credential`);
  `apps/engine/priv/repo/migrations/20261001120000_add_credential_to_runner_socket_tickets.exs`;
  `apps/web/src/routes/settings/RunnerDeviceKeysSection.tsx:346`,
  `apps/web/src/routes/MachineDeviceKeysSection.tsx:202`
- **Teste:**
  `test/application/use-cases/auth/revoke-runner-device-key.use-case.spec.ts`
  (`describe "o alvo da queda é a CHAVE"` — caminho feliz; `describe "CASO DE
  FALHA: o engine não atende o pedido por chave"` — o plano B pelo par; a
  máquina num pedido só);
  `test/application/use-cases/auth/machine-device-keys.use-case.spec.ts`;
  `test/application/use-cases/auth/revoke-personal-access-token.use-case.spec.ts`
  e `revoke-personal-access-token-as-maintainer.use-case.spec.ts`;
  `test/interfaces/pat-auth.guard.spec.ts` (a credencial anotada nos
  dois caminhos, e não anotada na recusa);
  `test/interfaces/http/runner/runner-tickets.guards.integration.spec.ts`
  (o PAT real até o pedido ao engine);
  `test/application/use-cases/runner/request-runner-ticket.use-case.spec.ts`
  (o `terminal` nunca leva credencial);
  `test/infrastructure/http-clients/api-to-engine-client.spec.ts`
  (`describe "o alvo é a CREDENCIAL"`, inclusive o 404 que LANÇA);
  `apps/engine/test/engine_web/channels/terminal_channel_test.exs`
  (`describe "revogação por CREDENCIAL"` — o canal real que cai, o PAT do mesmo
  usuário que fica de pé, a máquina em dois projetos sem lista, o legado pelo
  par, o ticket pendente anulado);
  `apps/engine/test/engine/runners/socket_ticket_test.exs`,
  `apps/engine/test/engine_web/channels/runner_socket_test.exs`,
  `apps/engine/test/engine_web/controllers/runner_connection_command_controller_test.exs`
  (200 com balanço, 400 de credencial fora de forma);
  `apps/web/src/routes/settings/chaves-de-dispositivo.test.tsx`,
  `apps/web/src/routes/MachineDeviceKeysSection.test.tsx` (a frase da precisão,
  e a do alvo antigo que não volta)
- **ADR:** [0201](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0201-revogacao-por-chave.md)
- **Origem:** AT-013 (HS-008, EP-003), decisão do dono em 01/10. Fica
  declarado e NÃO feito: o ticket SEM credencial (de api anterior) não é
  anulado na revogação — não há o que comparar, e a janela é de 30 s, só no
  rollout; e os testes ExUnit só rodam no CI (`repo.hex.pm` dá 403 no ambiente
  em que foram escritos)

## O teto da RN-418 vale também pela porta tipada (RN-689) {#o-teto-da-rn-418-vale-tambem-pela-porta-tipada-rn-689}

### RN-689 — `git_push` e `pr_open` tipados nunca são auto-aprováveis: o teto da RN-418 vale para o comando E para a ação {#rn-689}

**Revisada pela [RN-713](#rn-713)** (AT-385, 02/10): o modo automático (a
curinga em `auto_approve`) passa a liberar `git_push` e `pr_open`.

Revisa a [RN-418](parte-04.md#rn-418), por decisão do dono (01/10). Até aqui o teto de
efeito externo de `decide()` só olhava `actionType === 'terminal'`: o
`git push` DIGITADO virava `require_approval`, e a mensagem mandava usar a ação
tipada `git_push` — que, com o papel mínimo (`maintainer`) cumprido, nascia
`auto_approved` por QUALQUER um dos três estágios: o curinga `"*"` do modo
automático ([RN-153](parte-03.md#rn-153), o piloto da
[RN-670](parte-08.md#rn-670)), uma regra específica de `agent_autonomy` (a ativação da
execução semeava `git_push`/`pr_open` em `auto_approve` para cada
`dev-<modulo>`) ou um `allow` em `permissions.json`. Medido em
`decide.spec.ts` antes da correção: os seis casos (dois tipos × três estágios)
saíam `auto_approve`.

**A regra:** `git_push` e `pr_open` entram no bloco de tetos absolutos — se o
veredito até ali é `auto_approve`, vira `require_approval` incondicional, com o
motivo nomeado ("teto de efeito externo (RN-418): … nunca é auto-aprovável"),
que vai no `proposed_action.created`. `deny` já retornou antes e continua
vencendo; a ORIGEM da autonomia não importa. O "sempre permitir" dos dois já
era recusado na fonte ([RN-642](parte-08.md#rn-642), `TIPOS_SEM_SEMPRE_PERMITIR`), e é essa
metade que impede o teto de ser decorativo.

**A semeadura acompanha:** `DEV_AUTO_GIT_ACTIONS` passa a ser só `git_commit`
— na ativação e no aceite de paralelização. Semear push e PR seria gravar uma
autonomia que `decide()` nunca honra, a tela prometendo o que não acontece (o
argumento da RN-642). Linhas já gravadas ficam no banco, inertes. O dev agent
segue o caminho da [RN-050](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-050): commit executado,
push e PR `pending`, agente em `awaiting_approval` retendo o worktree até o
`task.pr_settled`; só então o gate abre.

Ficam FORA, de propósito: `git_merge` (teto próprio de branch protegida);
`git_commit` (fica na máquina, RN-670); `open_adr_pr` e `open_infra_pr` (abrem
PR real no provider, mas a decisão do dono não os cobre — `open_infra_pr` é
semeado `auto_approve` no aceite da Infra, [RN-671](parte-08.md#rn-671)); as ações de
bootstrap (`git_repo_create`/`git_branch_create`/`git_branch_protect`, que não
passam por `decide()`); e `deploy`, que não é tipo de `proposed_action` — só
existe como destino da mensagem do comando de terminal.

- **Onde:** `src/domain/actions/decide.ts:429` (`ehAcaoTipadaComEfeitoExterno`);
  `src/domain/actions/external-effect.ts:318`
  (`ACOES_TIPADAS_COM_EFEITO_EXTERNO`), `:326` (`ehAcaoTipadaComEfeitoExterno`),
  `:340` (`mensagemDoTetoDaAcaoTipada`);
  `src/application/use-cases/execution/activate-execution.use-case.ts:71`
  (`DEV_AUTO_GIT_ACTIONS`)
- **Teste:** `test/domain/actions/decide.spec.ts:1375` (os dois tipos
  com curinga, regra específica e `allow` saem `require_approval`; `deny`
  continua vencendo — caso de falha; `git_commit` e `git_merge` para branch
  não protegida ficam fora); `test/application/use-cases/actions/propose-action.use-case.spec.ts:953`
  (com Postgres: nascem `pending` com o motivo no evento);
  `test/application/use-cases/execution/activate-execution.use-case.spec.ts:473`
  e `accept-parallelization.use-case.spec.ts:141` (semeiam só `git_commit`);
  `test/application/use-cases/actions/approve-always-action.use-case.spec.ts:795`
  ("sempre permitir" recusado, 400 `teto_do_sempre_permitir`)
- **Origem:** AT-347, decisão do dono em 01/10

### RN-696 — O nível de proficiência por competência chega aos agentes que conversam com a pessoa {#rn-696}

Medido no código: até aqui o `proficiency_profiles` que a Anamnese grava não
chegava a agente nenhum — só os FATOS do Psicólogo aceitos pela pessoa
([RN-680](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-680)) iam no turno. O perfil era só tela.

**A regra:** a api lê o nível por competência do AUTOR da mensagem neste
projeto (`listByUser`) e o acrescenta ao MESMO texto `perfilDoAutor` que o
engine põe como mensagem `system` efêmera no turno (`Engine.Harness.PerfilDoAutor`)
— nenhum servidor de agente muda. Vai só `competência: nível`, com a
orientação de calibrar quantas perguntas fazer; o `rationale` e as evidências
NÃO vão, e nível fora da escala é descartado. Teto de 12 competências, e o
texto inteiro segue sob o `TETO_DO_TEXTO` de 2 000 caracteres. Falha na leitura
é log, e o turno segue sem ela, independente da leitura do grafo.
`fatosDoPerfil` no `chat.message` continua contando só os fatos do Psicólogo.

Fica FORA, e é decisão de produto pendente: o que a Anamnese observa sobre o
comportamento do AGENTE (o laço, o usuário cancelando o turno) virar sinal de
melhoria do produto, separado do perfil da pessoa.

> **TODO(humano):** o sinal de melhoria do produto vindo da Anamnese é evento
> (`anamnese.agent_signal`, sem sujeito pessoa) ou tabela própria, quem o lê
> (Staff? uma tela de melhorias?) e por quanto tempo vive? É fronteira nova de
> dado e pede ADR (0205 reservado).

- **Onde:** `src/domain/anamnese/proficiencia-do-autor.ts:22`
  (`textoDaProficienciaDoAutor`);
  `src/application/use-cases/agents/send-agent-message.use-case.ts:152`
  (`resolverPerfil`), `:203` (`resolverProficiencia`)
- **Teste:** `test/application/use-cases/agents/send-agent-message.use-case.spec.ts:254`
  (o nível vai, o rationale não), `:274` (leitura falha, a mensagem segue —
  caso de falha); `test/domain/anamnese/proficiencia-do-autor.spec.ts`
- **Origem:** AT-356 (metade 1)

### RN-703 — Subagente sem modelo herda o modelo resolvido do lead da área {#rn-703}

"Aplicar a todos os agentes" (RN-476) grava um binding por agente do catálogo
de Configurações — 17 linhas —, e subagente que o engine roda fora dessa lista
ficava sem modelo em nível nenhum: o `appsec` terminava com `agent.error`
origem `infra` ("Nenhum modelo vinculado para esta sessão"), e o mesmo valia
para todo `dev-<modulo>` além de `dev-backend`/`dev-frontend` e para a
`qa-estrategia`. Quando a cascata de um SUBAGENTE não acha valor (ou só acha o
default global do workspace, que ninguém escolheu para o projeto), ele usa o
binding RESOLVIDO do lead da área dele: o lead da área do catálogo
(`agent-areas.ts`), ou — para `appsec` → `secops` e `qa-estrategia` → `qa`, que
o engine roda por dentro de um lead mas não recebem handoff — uma tabela ao
lado, que só serve a esta herança. A resposta leva `herdadoDoLead` com o lead,
e `origin` continua sendo a do binding dele (RN-470: a tela não afirma
configuração própria). O filtro de tool calling (RN-040) vale na resolução do
lead como na do subagente. Se ainda assim não há modelo, a mensagem de falha
diz onde configurar.

- **Onde:** `src/application/use-cases/llm/resolve-model-binding.use-case.ts:76`
  (`leadDoSubagente`); `src/domain/agents/agent-areas.ts:139` (`leadDoSubagente`);
  `src/domain/llm/binding-resolver.ts:66` (`MENSAGEM_SEM_MODELO`)
- **Teste:** `test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`
  (`appsec` herda do `secops` e `dev-api` do `dev-lead`; lead também sem modelo
  segue `null` — caso de falha)
- **Origem:** AT-367

---

## O instalador oferece os modelos locais, e não confunde o dev com uma instalação (RN-691, RN-692) {#o-instalador-oferece-os-modelos-locais-e-nao-confunde-o-dev-com-uma-instalacao-rn-691-rn-692}

### RN-704 — O merge do repositório local é merge de verdade, e conflito é recusa nomeada {#rn-704}

- **Regra:** `mergePullRequest` do provider `local` faz fast-forward só quando
  o alvo é ancestral da fonte; com os dois divergidos, monta um commit de merge
  com os dois pais (`git merge-tree --write-tree` + `commit-tree`, sem
  worktree, mensagem `Merge pull request #N from <branch>`, identidade `Brabo
  Bot`). A ref do alvo é movida por `update-ref` com o valor antigo esperado,
  então um merge concorrente falha em vez de sobrescrever. Conflito lança
  `GitMergeConflictError` com os arquivos em conflito: a ref fica intacta, a PR
  continua `open`, a ação `git_merge` termina `failed` com o motivo no
  `action.failed`, e pela HTTP o erro é 409 `merge_conflict`.
- **Medição (AT-377):** duas PRs do mesmo commit base (#3 e #4) mergeadas em
  sequência: a `dev` ficou só com a #4, e os commits da #3 deixaram de ser
  ancestrais dela. O `update-ref` antigo era um reset forçado.
- **Onde:** `src/infrastructure/git/local-git-provider.ts:783` (`mergeShas`),
  `src/domain/git/git-errors.ts:89` (`GitMergeConflictError`),
  `src/interfaces/http/shared/git-provider-error.filter.ts`
- **Teste:** `test/infrastructure/git/local-git-provider.contract.spec.ts`
  ("duas PRs divergentes sem conflito: os dois commits ficam no alvo, por
  commit de merge"; caso de falha: "conflito: recusa nomeada com os arquivos,
  alvo intacto e PR aberta")
- **Lacuna declarada:** GitHub e GitLab recusam o merge com conflito pela
  própria API (405/406), sem tradução para `GitMergeConflictError`.
- **Origem:** AT-377

### RN-705 — A recusa de merge aparece na aba PRs, e a falha grava o tipo da ação {#rn-705}

- **Regra:** a ação git que falha grava `execution_result` com o `kind` da
  PRÓPRIA ação (`git_merge`, `pr_open`, `git_commit`, `git_push`), `failed:
  true`, o `error` e, no `git_merge`, o `pullRequestId`; antes toda falha
  gravava `{kind: 'git_push', branch: ''}`. O conflito de merge
  (`GitMergeConflictError`, RN-704) grava também `conflictingFiles` e um evento
  `backlog.task_merge_conflict` em cada tarefa da PR. `GET
  projects/:projectId/actions` aceita `status=failed` (só com `actionType`), e
  a aba PRs lê dali a última recusa de merge de cada PR aberta: o motivo, os
  arquivos e a frase de que é preciso resolver o conflito antes. É AVISO em
  texto, como o do gate pendente (RN-663): o botão "Merge" segue ativo e a
  decisão continua humana. Aprovar o merge invalida a lista de PRs, e o aviso
  `action.git_merge`/`action.failed` do canal também; a lista "PRs em revisão"
  de Aprovações deixa de mostrar tarefa `done`. O card do merge nomeia o ator
  humano pela leitura de membros (RN-655) e mostra o NÚMERO da PR (`#3`, não
  `#pr-3`), e o provider local grava o autor da PR (`<agente>[bot]`).
- **Medição (AT-383/AT-382, 02/10, loja-teste):** a #6 terminou `failed` com
  o conflito em `package.json` e a aba PRs seguiu mostrando "ABERTA" com o botão
  "Merge", sem texto nenhum; a ação gravou `kind: git_push`. Depois de um merge
  executado, a PR seguia em "Abertas" até recarregar, o card mostrava o UUID do
  usuário e `#pr-3`, e toda PR local era "autor desconhecido".
- **Onde:** `src/application/use-cases/actions/execute-git-action.use-case.ts:73` (`resultadoDaFalha`),
  `src/application/use-cases/actions/list-project-pending-actions.use-case.ts:22` (`execute`),
  `apps/web/src/routes/ProjectPrsTab.helpers.ts:9` (`ultimaRecusaDeMerge`),
  `apps/web/src/lib/canal-vivo.ts:134` (`alvosDoEvento`)
- **Teste:** `test/application/use-cases/actions/execute-git-action.use-case.spec.ts`
  ("conflito de merge → kind git_merge, arquivos no resultado e evento na
  tarefa"; caso de falha: "falha que não é conflito não grava arquivos nem
  evento de conflito"), `apps/web/src/routes/ProjectPrsTab.test.tsx` ("conflito
  de merge: mostra motivo e arquivos..."; "recusa de OUTRA PR não aparece
  nesta"), `test/infrastructure/git/local-git-provider.contract.spec.ts`
  ("grava o autor ao abrir...")
- **Lacuna declarada (fechada na [RN-715](#rn-715)):** o conflito NÃO acorda o dev agent da tarefa para
  rebasear e reenviar. O caminho que o QA usa (`DevAgentServer.correct/3`) só
  age com o agente em `:awaiting_gate` NA MESMA tarefa, e no merge o gate já
  terminou (`task.gate_resolved` com `done` leva o agente a `finish_task`, que
  zera tarefa, worktree e branch e reivindica outra). Reaproveitá-lo exige
  decidir como o agente readota uma tarefa `in_review` na branch existente e
  se o gate roda de novo depois do rebase — decisão de desenho, não tomada
  aqui. A tarefa segue `in_review`, com o `backlog.task_merge_conflict`
  durável.
- **Origem:** AT-383, AT-382

## O modo automático libera push e PR (RN-713) {#o-modo-automatico-libera-push-e-pr-rn-713}

### RN-713 — Com o modo automático do agente, `git_push` e `pr_open` são auto-aprovados; só a curinga libera {#rn-713}

Revisa a [RN-418](parte-04.md#rn-418) e a [RN-689](#rn-689), só na metade de push e PR,
por decisão do dono (02/10, AT-385). Com a curinga `agent_autonomy`
`actionType: "*"` em `auto_approve` (o modo automático,
[RN-153](parte-03.md#rn-153), o piloto da [RN-670](parte-08.md#rn-670)),
`git_push` e `pr_open` tipados e o mesmo efeito pelo comando de terminal
(`git push`, `git remote add/set-url`, `gh pr create`, `glab mr create`) saem
`auto_approve`, com o motivo "modo automático (RN-713)" no
`proposed_action.created` ([RN-567](parte-07.md#rn-567)).

Só a curinga libera: regra específica `auto_approve` sem ela, "Sempre
permitir" (recusado na fonte, [RN-642](parte-08.md#rn-642)) e `allow` no `permissions.json`
seguem no teto da RN-418, e a ativação continua semeando só `git_commit`.
Seguem teto absoluto mesmo em modo automático: merge (tipado em branch
protegida, e `git merge`/`gh pr merge` pelo terminal), deploy, `sudo`/`doas`,
`container_remove`, `instruction_patch` e paralelismo. O toggle em manual
restaura a aprovação.

- **Onde:** `src/domain/actions/decide.ts:311` (`modoAutomaticoDoAgente`),
  `:326` (`decide`); `src/domain/actions/external-effect.ts:354`
  (`mensagemDoModoAutomaticoNoEfeitoExterno`);
  `apps/web/src/components/OQueOPilotoLibera.tsx`
- **Teste:** `test/domain/actions/decide.spec.ts` (o piloto libera
  `git push`/`gh pr create` e os tipados; `git merge`, `gh pr merge` e `sudo`
  seguem `require_approval`; específica e `allow` sem curinga seguem no teto;
  curinga em `require_approval` pede aprovação — casos de falha);
  `test/application/use-cases/actions/propose-action.use-case.spec.ts`
  (com Postgres: auto-aprovados e executados, motivo no evento; específica
  sozinha nasce `pending`); `apps/web/src/components/ModoAutomaticoDoTime.test.tsx`,
  `AgentCard.test.tsx`, `ApprovalCard.test.tsx` (a tela diz que push e PR são
  liberados)
- **Decisão arquitetural:** [ADR 0204](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0204-modo-automatico-libera-push-e-pr.md)
- **Origem:** AT-385, decisão do dono em 02/10

## O instalador oferece os modelos locais, e não confunde o dev com uma instalação (RN-691, RN-692) {#o-instalador-oferece-os-modelos-locais-e-nao-confunde-o-dev-com-uma-instalacao-rn-691-rn-692-1}

### RN-715 — O conflito de merge devolve a tarefa ao dev agent dono, e os gates julgam de novo {#rn-715}

- **Regra:** quando o merge aprovado de uma PR é recusado por conflito com a
  `dev` (`GitMergeConflictError`, [RN-704](#rn-704)), cada tarefa da PR que
  está `in_review` volta a `in_progress` com `gate_status` zerado (os vereditos
  antigos de QA/SecOps não valem para a branch que vai mudar), grava
  `backlog.task_status_changed` com `cause: merge_conflict` e põe
  `task.merge_conflict` na outbox, com o agente que propôs o `pr_open` (o
  DONO), a PR e os arquivos em conflito. O engine entrega ao dono pelo
  `Engine.Dev.Wake`; livre, ele READOTA a branch da PR (`WorktreeManager.adopt/3`,
  a mesma `garantir_base`, sem perder os commits) e roda o laço de CORREÇÃO com
  o motivo no texto: trazer `origin/dev` por `git fetch`/`git merge`, resolver
  os arquivos, rodar a suite. No `report_done` propõe commit e push pelo
  caminho de sempre (a política de aprovação vigente decide) e o gate RECOMEÇA
  do QA (`open_gate` + QA), sem `pr_open` novo — a PR é a mesma branch.
  Nenhum estado novo de tarefa: `in_progress` com a causa no evento.
- **Desfechos nomeados:** dono sem linha em `dev_agent_states` — a tarefa é
  BLOQUEADA (`conflito de merge sem dev agent para resolvê-lo`, origem `infra`);
  dono com o disjuntor aberto (`idle_tripped`) — bloqueada, origem `politica`;
  a branch não volta (`adopt` falha) — bloqueada, origem `infra`. Dono ocupado
  (`working`/`awaiting_gate`/`awaiting_approval`) recebe o conflito de novo em
  30 s. A recusa do merge ([RN-705](#rn-705)) não depende de nada disso: a
  ação já está `failed`, com o motivo, antes de o engine agir. Tarefa que já
  não está `in_review` (merge repetido) não é reaberta nem acorda ninguém, e
  PR aberta por humano não tem dono a acordar.
- **Medição (AT-383, 02/10, loja-teste):** a #6 terminou `failed` por conflito
  em `package.json`, e a tarefa ficou `in_review` sem ninguém para resolvê-lo.
- **Onde:** `src/application/use-cases/actions/execute-git-action.use-case.ts:460` (`devolverAoDono`),
  `src/infrastructure/persistence/drizzle/backlog.repository.ts:504` (`reabrirPorConflitoDeMerge`),
  `apps/engine/lib/engine/workers/dev_agent_wake_worker.ex:151` (`task.merge_conflict`),
  `apps/engine/lib/engine/dev/dev_agent_server.ex:350` (`handle_info`),
  `apps/engine/lib/engine/dev/dev_agent_server.ex:851` (`trigger_gate_recheck`),
  `apps/engine/lib/engine/dev/worktree_manager.ex:47` (`adopt`)
- **Teste:** `test/application/use-cases/actions/execute-git-action.use-case.spec.ts` ("conflito de merge → kind git_merge, arquivos no
  resultado e evento na tarefa"; falha: "RN-715: tarefa que já não está em
  revisão não é reaberta nem acorda ninguém"),
  `apps/engine/test/engine/dev/dev_agent_server_test.exs` (describe "conflito
  de merge (RN-715)": readota, motivo no turno, commit+push sem PR nova, gate
  reabre do QA; falhas: branch que não volta e disjuntor aberto),
  `apps/engine/test/engine/workers/dev_agent_wake_worker_test.exs` ("dono que
  não existe: bloqueia a task com motivo nomeado, nada calado"),
  `apps/engine/test/engine/dev/worktree_manager_test.exs` ("readotar a branch
  da PR preserva os commits dela")
- **Lacuna declarada:** a reentrega ao dono ocupado mora em memória — restart
  do engine nessa janela a perde, e a tarefa fica `in_progress` até
  intervenção (mesma família da lacuna do `Engine.Dev.Wake`, ADR 0045). O
  agente integra a `dev` por MERGE, não rebase: o push forçado que o rebase
  exigiria não existe no executor de git. O `NoopDevAgentServer` não trata o
  conflito.
- **Origem:** AT-383

### RN-716 — A Anamnese não grava nível sobre o que não observou, e aprovar não é dominar {#rn-716}

- **Regra:** um perfil de proficiência só é gravado quando a evidência inclui
  ao menos um evento escrito pela PRÓPRIA pessoa perfilada que não seja clique
  de aprovação (`proposed_action.approved`, `handoff.accepted`,
  `readiness.confirmed`). Evidência só de outros atores é "não observado" —
  ausência de oportunidade, nunca pouco conhecimento —, e "não observado" é
  estado próprio: o lote é recusado com motivo nomeado, nada é gravado e
  nenhum `anamnese.profile_updated` nasce. Aprovação ao lado de uma interação
  da pessoa continua aceita. A mensagem da pessoa que repara falha de agente é
  desvio do AGENTE e não traço dela: o prompt diz isso, e o registro mora na
  [RN-717](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-717).
- **Medição (AT-376):** na loja-teste de 02/10, "Git → iniciante" e "Infra →
  iniciante" sem a pessoa ter interagido com nenhum dos dois, e "aprova 2 ADRs
  sem hesitar" como arquitetura avançada.
- **Onde:** `src/domain/anamnese/proficiency-validation.ts:53`
  (`ehEvidenciaObservadaDaPessoa`), `src/domain/anamnese/proficiency-validation.ts:74`
  (`validateProficiencyBatch`), `src/application/use-cases/anamnese/record-proficiency.use-case.ts:189`
  (`resolveKnownEventIds`), regras no kickoff (`prompts/anamnese-kickoff.md`
  v3 e o fallback inline de `anamnese_worker.ex`)
- **Teste:** `test/domain/anamnese/proficiency-validation.spec.ts`
  ("RN-716: aprovação ao lado de interação da pessoa passa"; falhas: "só
  evidência de outro ator é \"não observado\"", "aprovação sem leitura não é
  evidência"), `test/application/use-cases/anamnese/record-proficiency.use-case.spec.ts`
  ("evidência só de aprovação não grava perfil nem profile_updated")
- **Lacuna declarada:** reconhecer a mensagem de REPARO no lote de perfil é do
  modelo (prompt); o código não classifica texto de mensagem.
- **Origem:** AT-376

## Uma chave de cache, uma pergunta (RN-718) {#uma-chave-de-cache-uma-pergunta-rn-718}

### RN-720 — O PO completa a história que já existe, e não oferece o handoff ao Arquiteto com regra descoberta {#rn-720}

**Contexto:** no uso real da loja-teste-2 (02/10) o PO criou doze histórias
sem regra ligada, leu em `listar_regras_de_negocio` que sete das oito regras
estavam SEM cobertura, escreveu que não tinha ferramenta para editar história
e chamou `offer_handoff` ao Arquiteto assim mesmo — afirmando no fio que a
cobertura estava completa e que o sistema aceitaria sozinho. O aceite
automático da [RN-660](parte-08.md#rn-660) não aconteceu (o critério não fechava), e a
história que ele recriou disparou o aviso de duplicata semântica
([RN-681](#rn-681)).

**A regra:**

1. O PO tem `complete_story`: completa uma história `draft` EXISTENTE do
   projeto — os `business_rule_ids` informados são SOMADOS aos já ligados
   (completar nunca desliga regra; id que não é `artifact.business_rule` é
   400), listas informadas e não vazias substituem as atuais e as omitidas
   ficam. História que não é `draft` é 409; de outro projeto, 404. Depois de
   gravar, a promoção segue o MESMO critério de `create_story`
   (`isPromotable`; `auto` vai a `ready`, `manual` liga `proposedReady`), e a
   escrita grava `backlog.story_completed`.
2. `offer_handoff` do PO ao Arquiteto é RECUSADO, sem criar oferta, enquanto
   houver regra sem história ou história `draft` incompleta (sem
   `proposedReady`) — e o resultado lista as duas, com id e título, e manda
   completar com `complete_story`. A cobertura é a da api
   (`computeCoverage`, a mesma do aceite automático), nunca uma segunda conta
   no engine; falha de leitura não vira recusa. Os outros agentes e destinos
   não passam pela checagem.
3. Quando o `emit_artifact` de `business_rule` do PO volta com o aviso de
   semelhança (`status: warned`), o resultado acrescenta que a regra parece
   ALTERAR uma existente e que ele deve perguntar ao usuário
   (`ask_structured_questions`) qual vale antes de seguir (AT-389: o usuário
   disse "taxa fixa de R$ 10", o Criativo registrou "R$ 10 por pedido" e o PO
   emitiu "R$ 10 por torrefador"). A regra já gravada não é desfeita; o aviso
   continua aviso.

O kickoff do PO diz as três coisas.

- **Onde:** `src/application/use-cases/backlog/complete-story.use-case.ts:53`
  (`CompleteStoryUseCase`);
  `src/interfaces/http/internal/internal-sessions.controller.ts:541`
  (`completeStoryRoute`); `apps/engine/lib/engine/harness/tools/complete_story.ex:47`
  (`run`); `apps/engine/lib/engine/harness/tools/offer_handoff.ex:52`
  (`recusa_por_cobertura`); `apps/engine/lib/engine/harness/tools/emit_artifact.ex:188`
  (`pergunte_antes`)
- **Teste:** `test/application/use-cases/backlog/complete-story.use-case.spec.ts`
  (liga a regra e propõe a promoção; `auto` vai a `ready`; regra inexistente,
  outro projeto e história `ready` recusados);
  `apps/engine/test/engine/harness/tools/offer_handoff_test.exs` (describe
  "cobertura (RN-720)": recusa com a lista, cobertura completa oferta e o
  aceite automático segue); `apps/engine/test/engine/harness/tools/complete_story_test.exs`;
  `apps/engine/test/engine/harness/duplicata_semantica_test.exs` (o aviso no
  PO manda perguntar; fora do PO ou sem aviso, não)
- **Lacuna declarada:** o servidor do PO continua oferecendo sozinho no fim
  do turno pela RN-700, que já exigia cobertura; a recusa aqui é da
  FERRAMENTA. Se a duplicata semântica avisou no caso real da loja-teste-2 não
  foi medido nesta mudança (o banco daquela execução não foi lido).
- **Origem:** AT-388, AT-389
