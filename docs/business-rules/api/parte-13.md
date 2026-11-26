---
id: rn-api-parte-13
title: 'Regras de negócio — API — parte 13 (desde RN-1386)'
sidebar_label: 'API — parte 13 (desde RN-1386)'
description: 'As RNs hospedadas na raiz api.'
keywords: [regras de negócio, api]
---

# API — parte 13 (desde RN-1386)

## A Anamnese não paga duas vezes pela mesma janela, e o resgate de gate não reinicia ciclo que espera alguém (RN-722)
<a id="rn-1386"></a>

### RN-1386 — O laço de reconciliação retoma a remoção pendente, limpa o resto de subida falha e remove o órfão do host {#rn-1386}

- **Regra:** `ReconciliarRecursosUseCase` roda no boot e a cada `RECURSOS_RECONCILIACAO_INTERVAL_MS` (padrão 300000; 0 desliga), só com `BROKER_URL`. Em cada passada: (1) projeto apagado com linha `removendo` chama `orfao/remove` e fecha como `removido` (falha: motivo e tentativa registrados, tenta no tique seguinte); (2) linha `falhou` de projeto vivo sem ciclo `running` (container) ou sem QA ativa (QA) tem o resto removido e vira `removido`. O laço só age sobre o que está em `project_resources`: `brabo.project.id` do host fora do registro NUNCA é apagado nem vira pendência (o `brabo` e o `brabo-dev` dividem o Docker); os órfãos de antes do registro ficam para limpeza manual. Muda o ADR 0298 (item 6), que adotava os órfãos do host: o ADR precisa de uma nota.
- **Código:** `src/application/use-cases/containers/reconciliar-recursos.use-case.ts` (`execute`)
- **Teste:** `test/application/use-cases/containers/reconciliar-recursos.use-case.spec.ts`
- **Origem:** AT-980 (EP-036), ADR 0298 (item 6).

<a id="rn-1398"></a>

### RN-1398 — O plano aprovado com `agentes: 2` sobe o `dev-<modulo>-2` {#rn-1398}

- **Regra:** revisa a [RN-083](parte-02.md#rn-083). O segundo dev do módulo é permitido SEM nova aprovação quando o plano aprovado declara lote disjunto: o engine só deixa propor `agentes: 2` com tarefas sem `depende_de` entre si e `arquivos` disjuntos ([RN-678](parte-09.md#rn-678), AT-991). Ao aprovar, o `ExecuteExecutionPlanUseCase` ativa a execução e, para cada módulo com `agentes >= 2`, sobe o `dev-<modulo>-2` pelo MESMO aceite da paralelização (`AcceptParallelizationUseCase`: instrução, autonomia, engine, delegação). O teto de agentes da área e o custo do plano seguem sendo conferidos na proposta; o `parallelize` avulso (fora do plano) continua pedindo decisão acima do teto. O [ADR 0053](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0053-dev-lead-e-paralelismo-autorizado.md) vale para esse caso.
- **Código:** `src/application/use-cases/execution/execute-execution-plan.use-case.ts`; `src/domain/execution/plano-de-execucao.ts` (`modulosComSegundoDev`)
- **Teste:** `test/application/use-cases/execution/execute-execution-plan.use-case.spec.ts` (`AT-991`)
- **Origem:** AT-991 (EP-035), decisão 4 do dono de 14/11/2026 (AT-952).

<a id="rn-1399"></a>

### RN-1399 — O segundo dev só sobe com duas tarefas no módulo, e é no máximo um {#rn-1399}

- **Regra:** `agentes >= 2` só vale quando o plano tem ao menos 2 tarefas no módulo (`modulosComSegundoDev`); um segundo dev sem tarefa para pegar ficaria ocioso e contaria como execução ([RN-709](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-709)). O extra é sempre UM (`dev-<modulo>-2`), como no aceite da paralelização.
- **Código:** `src/domain/execution/plano-de-execucao.ts` (`modulosComSegundoDev`)
- **Teste:** `test/application/use-cases/execution/execute-execution-plan.use-case.spec.ts` (`não sobe o extra`)
- **Origem:** AT-991 (EP-035).

<a id="rn-1400"></a>

### RN-1400 — Recusa do engine no segundo dev não desfaz o plano {#rn-1400}

- **Regra:** a execução já está ativa quando o extra sobe; se o engine recusa (ex.: sem agente base), o plano fica `executed` e o resultado traz `segundoDev` (os que subiram) e `segundoDevRecusado` (módulo → motivo), que o Dev Lead lê ao narrar. Nunca lança.
- **Código:** `src/application/use-cases/execution/execute-execution-plan.use-case.ts`; `src/domain/execution/execution-plan-execution-result.ts`
- **Teste:** `test/application/use-cases/execution/execute-execution-plan.use-case.spec.ts` (`recusa do engine no extra`)
- **Origem:** AT-991 (EP-035).

<a id="rn-1404"></a>

### RN-1404 — A QA-estratégia também roda com o raciocínio desligado {#rn-1404}

> **Revisa a [RN-838](parte-10.md#rn-838)** (que deixava a QA-estratégia de fora).

- **Regra:** o plano de teste não espera raciocínio estendido. `raciocinioDesligadoParaOAgente('qa-estrategia')` é verdadeiro, então com modelo de `supportsReasoning` o provider que sabe dizer "desligado" manda `reasoning: { enabled: false }`, com a folga da [RN-782](parte-10.md#rn-782). Os outros gates (`qa-performance-seguranca`) não mudam. Medido na 29ª rodada do TP-01: 14,1 s por chamada com raciocínio contra cerca de 3 s nos papéis sem.
- **Código:** `src/domain/llm/raciocinio-do-agente.ts` (`raciocinioDesligadoParaOAgente`, `QA_ESTRATEGIA`)
- **Teste:** `test/domain/llm/raciocinio-do-agente.spec.ts` (`QA de Automação e QA-estratégia desligam`)
- **Origem:** AT-989 (EP-035), itens 4 e 9 da AT-951, Rodada 386.

<a id="rn-1421"></a>

### RN-1421 — As passagens Arquiteto→Infra e Infra→Dev Lead têm chave por projeto, que nasce LIGADA {#rn-1421}

> **Estende a [RN-660](parte-08.md#rn-660)** (só cobria PO→Arquiteto).

- **Regra:** a tabela `automacoes_do_projeto` (`projeto, categoria, chave, ligada, origem, user_id, created_at`, única por `(projeto, categoria, chave)`; migração 0094) guarda as chaves que a pessoa liga e desliga; a AT-998 a reaproveita. Hoje só `handoff` + `arquiteto->infra` e `handoff` + `infra->dev-lead`. SEM linha a chave vale LIGADA (`origem: padrao`); `PUT /projects/:projectId/automacoes/:categoria/:chave` (`maintainer`) sobrescreve, e `user_id`/`created_at` dizem quem mudou por último e quando. Chave desconhecida é 400. Chave desligada: o motivo é `passagem_desligada` e a oferta fica `offered`, pedindo o clique.
- **Código:** `src/db/schema/iam.ts` (`automacoesDoProjeto`); `src/application/use-cases/iam/automacoes-do-projeto.use-case.ts`; `src/interfaces/http/iam/projects.controller.ts`
- **Teste:** `test/application/use-cases/iam/automacoes-do-projeto.use-case.spec.ts`
- **Origem:** AT-994 (EP-035), decisão 1 da AT-953.

<a id="rn-1422"></a>

### RN-1422 — Arquiteto→Infra é aceita sem clique quando a arquitetura está fechada {#rn-1422}

- **Regra:** com a chave ligada, o handoff do Arquiteto à Infra é aceito pelo sistema quando há `module_map` vigente, ao menos uma ADR proposta (`adr.pr_opened`) e NENHUMA pergunta em aberto do Arquiteto (`artifact.open_question` com `autor: arquiteto` sem `open_question.answered`). Os critérios de repositório local, sem credencial de git e de autor com papel `developer` da RN-660 valem igual. Motivos de recusa: `sem_module_map`, `sem_adr_proposta`, `pergunta_em_aberto`.
- **Código:** `src/domain/sessions/aceite-automatico-do-handoff.ts` (`decidirAceiteAutomatico`); `src/application/use-cases/agents/aceitar-handoff-automaticamente.use-case.ts` (`fatosDaPassagem`)
- **Teste:** `test/domain/sessions/aceite-automatico-do-handoff.spec.ts`; `test/application/use-cases/agents/aceitar-handoff-automaticamente.use-case.spec.ts`
- **Origem:** AT-994 (EP-035).

<a id="rn-1423"></a>

### RN-1423 — Infra→Dev Lead é aceita sem clique com a PR de infra mergeada e o container de pé {#rn-1423}

- **Regra:** com a chave ligada, o handoff da Infra ao Dev Lead é aceito pelo sistema quando existe artefato de infra e TODAS as PRs de infra estão mergeadas (a régua da [RN-752](parte-10.md#rn-752): nenhum artefato sobra em revisão) e o ciclo do container é `running`. `running` só é gravado depois da prova de rede ([RN-1366](parte-12.md#rn-1366)), então "container rodando" já carrega "rede provada"; rede não provada por falta de `getent`/`nslookup` segue como nota e não bloqueia. Motivos: `pr_de_infra_nao_mergeada`, `container_nao_rodando`.
- **Código:** `src/domain/sessions/aceite-automatico-do-handoff.ts`; `src/application/use-cases/agents/aceitar-handoff-automaticamente.use-case.ts`
- **Teste:** os mesmos da RN-1422
- **Origem:** AT-994 (EP-035), depende da AT-980.

<a id="rn-1424"></a>

### RN-1424 — O motivo `nao_e_po_para_arquiteto` virou `passagem_sem_aceite_automatico`, e o critério diz a passagem {#rn-1424}

- **Regra:** qualquer par fora de PO→Arquiteto, Arquiteto→Infra e Infra→Dev Lead devolve `passagem_sem_aceite_automatico` (antes `nao_e_po_para_arquiteto`). O `criterio` da resposta e do evento de aceite ganha `passagem` nas duas passagens novas (`regras`/`cobertas` passam a opcionais, só do PO→Arquiteto); o evento continua com ator de sistema `handoff-auto-accept`. Campos aditivos no `openapi.json`, mas o valor do enum `motivo` mudou: o web que casava o texto antigo precisa do `openapi:types`.
- **Código:** `src/interfaces/http/agents/dto/agents.response.dto.ts`
- **Teste:** `test/application/use-cases/agents/aceitar-handoff-automaticamente.use-case.spec.ts`
- **Origem:** AT-994 (EP-035).

<a id="rn-1429"></a>

### RN-1429 — `container.running` diz se a rede foi provada (`redeProvada`) {#rn-1429}

- **Regra:** o payload de `container.running` passa a ser `{ projectId, redeProvada }`. `redeProvada` é `true` só quando a prova de DNS da [RN-1366](parte-12.md#rn-1366) rodou e passou (saída 0); é `false` com postura `none` (nada provado), com imagem sem `getent`/`nslookup` (nota "rede não provada") e no caminho do runner. Campo aditivo: o consumidor que só lê `projectId` segue igual. O engine só retoma sozinho a tarefa bloqueada por falta de rede quando `redeProvada` é `true`.
- **Código:** `src/application/use-cases/containers/registrar-transicao-de-container.use-case.ts` (`avisarQueOContainerSubiu`); `src/application/use-cases/containers/provar-rede-do-container.use-case.ts` (`provada`); `src/application/use-cases/containers/subir-ciclo-de-vida-do-container.use-case.ts`
- **Teste:** `test/application/use-cases/containers/ciclo-de-vida-do-container.use-case.spec.ts`; `test/application/use-cases/containers/provar-rede-do-container.use-case.spec.ts`
- **Origem:** AT-995 (EP-035).

<a id="rn-1430"></a>

### RN-1430 — O unblock interno do ator `system` aceita e grava a `orientacao` {#rn-1430}

- **Regra:** `POST /internal/projects/.../sessions/:sessionId/tasks/:taskId/unblock` aceita `orientacao` opcional (até 2000 caracteres) e o evento `backlog.task_unblocked` do ator `system` a grava, aparada, junto de `retomadaAutomatica: true`, no mesmo formato do ramo humano ([RN-1124](parte-12.md#rn-1124)). Sem `orientacao`, o payload não muda.
- **Código:** `src/interfaces/http/internal/dto/unblock-task-internal.dto.ts`; `src/application/use-cases/execution/unblock-task.use-case.ts`
- **Teste:** `test/application/use-cases/execution/unblock-task.use-case.spec.ts`
- **Origem:** AT-995 (EP-035).

<a id="rn-1441"></a>

### RN-1441 — O claim diz se a tarefa volta de um conflito de merge (`retomada`) {#rn-1441}

- **Regra:** a resposta de `POST /internal/projects/.../sessions/:sessionId/tasks/claim` (a tarefa pegável, ou vazia) ganha `retomada` e `conflictingFiles`. `retomada` é `'merge_conflict'` quando o evento mais recente da tarefa entre `backlog.task_status_changed` e `backlog.task_blocked` é um `task_status_changed` com `cause: 'merge_conflict'` (a reabertura da [RN-715](parte-09.md#rn-715)): a reentrega (`mark in_review`, sem causa) e o bloqueio são mais recentes e a zeram. `conflictingFiles` vem do `backlog.task_merge_conflict` mais recente da tarefa. Em qualquer outro caso, `retomada: null` e `conflictingFiles: []`. A leitura acontece ANTES de gravar o `backlog.task_claimed`; o SQL do `claimNext` ([RN-856](parte-10.md#rn-856)) e o estado da tarefa não mudam, e a rota passa a responder `ClaimedTaskResponseDto` (o `TaskResponseDto` fica como está). Campos aditivos: engine antigo os ignora; engine novo contra api antiga vê `retomada` ausente e trata como trabalho novo. Limite: se o engine cair no meio da reentrega, o claim devolve `retomada` de novo e a reentrega recomeça (pode sobrar um push `pending` duplicado).
- **Código:** `src/application/use-cases/execution/claim-next-task.use-case.ts` (`retomadaDaTarefa`); `src/interfaces/http/backlog/dto/backlog.response.dto.ts` (`ClaimedTaskResponseDto`); `src/interfaces/http/internal/internal-sessions.controller.ts` (`claimTask`)
- **Teste:** `test/application/use-cases/execution/claim-next-task.use-case.spec.ts`
- **Origem:** AT-1003 (EP-036), L1; a L2 é o engine.

<a id="rn-1435"></a>

### RN-1435 — O Brabo percebe a decisão repetida: 3 iguais seguidas, sem recusa, em 24 h, no mesmo projeto {#rn-1435}

- **Regra:** depois do commit de cada decisão HUMANA, `OferecerAutomacaoUseCase` lê do event log as decisões da janela de 24 h e pergunta ao domínio puro `avaliarRepeticao`. Três categorias, cada uma com a sua assinatura: `aprovacao` (`proposed_action.approved`, assinatura = tipo da ação + agente que a propôs; o payload de `approved` e de `denied` ganha `agente`), `handoff` (`handoff.accepted` pela pessoa, assinatura `de->para`; o payload ganha `fromAgent`) e `desbloqueio` (`backlog.task_unblocked` pela pessoa, assinatura = motivo do bloqueio normalizado, sem números; o payload ganha `motivo`). Com **N = 3** decisões `ok` seguidas da mesma assinatura (qualquer recusa, `denied`, ou desbloqueio que volta a bloquear zera a contagem), grava no event log da sessão `automacao.oferecida` `{ categoria, chave, escopo, n, escopoDaRegra: 'projeto', comoDesfazer }`. Uma oferta por assinatura, para sempre: já oferecida, recusada ou virada regra (inclusive a desfeita) não volta. Aceite automático, retomada automática e decisão tomada por uma regra não contam como decisão. A oferta é chamada em `ApproveActionUseCase.execute` (portanto também no "sempre permitir"), `AcceptHandoffUseCase.execute` e `UnblockTaskUseCase.execute`, fora de transação e em melhor esforço: falhar em oferecer nunca desfaz a decisão.
- **Código:** `src/domain/automacao/repeticao.ts:178` (`avaliarRepeticao`), `src/domain/automacao/repeticao.ts:123` (`decisoesDosEventos`), `src/application/use-cases/automacao/oferecer-automacao.use-case.ts:84` (`aposDecisao`)
- **Teste:** `test/domain/automacao/repeticao.spec.ts`; `test/application/use-cases/automacao/oferecer-automacao.use-case.spec.ts`
- **Origem:** AT-998 (EP-035), decisão 2 da AT-953.

<a id="rn-1436"></a>

### RN-1436 — O que nunca se oferece, e o anti-laço do desbloqueio {#rn-1436}

> **Estende a [RN-509](parte-06.md#rn-509), a [RN-642](parte-08.md#rn-642) e a [RN-418](parte-04.md#rn-418)** (os tetos de `TIPOS_SEM_SEMPRE_PERMITIR` valem também para a oferta.

- **Regra:** nunca é oferecido (checado no domínio e de novo no aceite): `terminal` (o comando decide, e a oferta não o enxerga), `propose_execution_plan` e os tipos de `TIPOS_SEM_SEMPRE_PERMITIR` (`git_push`, `pr_open`, `open_adr_pr`, `git_merge`, `container_remove`, `container_recreate`, `instruction_patch`, `parallelize`, `raise_max_parallel`). UMA exceção, decisão 3 da AT-953: `open_infra_pr` entra na oferta, só em projeto com repositório `local` e sem credencial de git (com repositório de outro provider a PR publica, RN-418; uma credencial ligada depois da oferta a derruba, no aceite e a cada proposta). Pergunta do Arquiteto fica só no lote (AT-997). **Anti-laço:** a mesma assinatura de desbloqueio com 3 resultados ruins (a tarefa voltou a bloquear) nunca vira regra: grava `automacao.outro_caminho` `{ categoria, chave, opcoes: ['trocar_modelo', 'pedir_ao_dev_lead', 'arquivar'] }`.
- **Código:** `src/domain/automacao/repeticao.ts:99` (`tipoAutomatizavel`), `src/domain/automacao/repeticao.ts:178` (`avaliarRepeticao`)
- **Teste:** `test/domain/automacao/repeticao.spec.ts`
- **Origem:** AT-998 (EP-035), decisões 2, 3 e 4 da AT-953.

<a id="rn-1437"></a>

### RN-1437 — Aceitar a oferta grava a regra; desfazer volta a pedir {#rn-1437}

- **Regra:** `POST /projects/:projectId/automacoes` (`maintainer`) `{ categoria, chave, escopo?, decisao: 'aceitar' | 'recusar' }` responde a `automacao.oferecida` com os mesmos `categoria/chave/escopo`: oferta inexistente é 404, já respondida é 409, tipo que hoje tem teto é 400 (`reason` nomeado). `aceitar` grava a linha em `automacoes_do_projeto` (a tabela da AT-994, sem migração) com `origem: 'oferta'`, a chave `<tipo>@<agente>` na aprovação (escopo: o projeto, só aquele agente), e o evento `automacao.aceita`; `recusar` grava `automacao.recusada`. `DELETE /projects/:projectId/automacoes/:categoria/:chave` (`maintainer`) desliga a regra (a linha fica com `origem: 'manual'`, quem e quando) e `GET` a lista junto das passagens. A regra de aprovação vale na próxima proposta do mesmo tipo do mesmo agente: `decide()` sobe `require_approval` para `auto_approve` (`regraDeAutomacaoDaAprovacao`), nunca por cima de `deny`, de tipo com teto (a exceção `open_infra_pr` sem `run.app`, RN-933) nem de `terminal`; a regra é lida a cada proposta, então desfazer vale na hora. A regra de handoff faz `AceitarHandoffAutomaticamenteUseCase` aceitar a passagem sem clique, com as mesmas travas da RN-660 (repositório local, sem credencial, papel do autor). A de desbloqueio libera a tarefa bloqueada pelo mesmo motivo, uma vez por tarefa. **Desvio da AT-998:** a aprovação NÃO reusa o caminho de gravação do "sempre permitir" (`permissions.json`/`agent_autonomy`); a regra mora só em `automacoes_do_projeto`, para o desfazer ser uma linha e não a remoção de um padrão de arquivo.
- **Código:** `src/application/use-cases/automacao/oferecer-automacao.use-case.ts:239` (`responder`), `src/application/use-cases/automacao/oferecer-automacao.use-case.ts:170` (`regraDaAprovacao`), `src/domain/actions/decide.ts:348` (`decide`), `src/interfaces/http/iam/projects.controller.ts:179` (`answerOfferRoute`), `src/interfaces/http/iam/projects.controller.ts:201` (`undoAutomacaoRoute`)
- **Teste:** `test/application/use-cases/automacao/oferecer-automacao.use-case.spec.ts`; `test/domain/actions/decide-regra-da-oferta.spec.ts`; `test/domain/sessions/aceite-automatico-do-handoff.spec.ts`
- **Origem:** AT-998 (EP-035), decisão 3 da AT-953.

<a id="rn-1438"></a>

### RN-1438 — Toda ação feita por regra deixa o rastro `automacao.aplicada` {#rn-1438}

- **Regra:** quando a regra agiu, a sessão ganha `automacao.aplicada` com a regra de origem e a data dela (`regraDesde`): na aprovação `{ actionId, actionType, agente, regraDesde }` (junto de `proposed_action.created` com `status: auto_approved`), no handoff `{ categoria: 'handoff', chave, handoffId, regraDesde }` e no desbloqueio `{ categoria: 'desbloqueio', taskId, regra, regraDesde }`, com ator de sistema `automacao-oferta`. É o insumo da linha "feito sozinho · desfazer" da AT-999. O desbloqueio automático é `backlog.task_unblocked` com `automacao: true` (não conta como decisão da pessoa) e acontece UMA vez por tarefa: se ela volta a bloquear, o laço não se automatiza e a decisão volta para a pessoa.
- **Código:** `src/application/use-cases/automacao/oferecer-automacao.use-case.ts:220` (`registrarAplicada`), `src/application/use-cases/execution/mark-task-blocked.use-case.ts:144` (`aplicarRegraDeDesbloqueio`)
- **Teste:** `test/application/use-cases/automacao/oferecer-automacao.use-case.spec.ts`
- **Origem:** AT-998 (EP-035).

<a id="rn-1439"></a>

### RN-1439 — Apagar o projeto grava quem ele era na linha `removendo` {#rn-1439}

- **Regra:** `project_resources` não tem FK com `projects`, e o projeto apagado já não existe para dizer o nome nem o workspace. Por isso, na mesma transação do `DELETE`, `marcarRemovendoDoProjeto` grava `workspace_id` e `projeto_nome` (migração 0096, colunas anuláveis) nas linhas que vira `removendo`. Linha anterior à migração fica sem os dois e não aparece em nenhum workspace.
- **Código:** `src/application/use-cases/iam/delete-project.use-case.ts`; `src/infrastructure/persistence/drizzle/recurso-de-projeto.repository.ts` (`marcarRemovendoDoProjeto`)
- **Teste:** `test/application/use-cases/iam/delete-project.use-case.spec.ts`; `test/infrastructure/persistence/recurso-de-projeto.repository.spec.ts`
- **Origem:** AT-980 (lane L8).

<a id="rn-1440"></a>

### RN-1440 — `GET /workspaces/:workspaceId/containers/remocoes-pendentes` lista o que ficou no host {#rn-1440}

- **Regra:** papel `viewer`, o mesmo de `GET /workspaces/:workspaceId/containers`. Devolve uma linha por projeto apagado do workspace que ainda tem recurso `removendo`: `{ projectId, projetoNome (null em linha antiga), recursos, motivo, tentativas, atualizadoEm (ISO) }`. É rota própria porque a lista de containers é por projeto existente e este já não existe. Só `removendo`: `falhou` é de projeto vivo e já aparece em `registrado.failureReason`.
- **Código:** `src/interfaces/http/containers/containers-overview.controller.ts` (`remocoesPendentes`); `src/infrastructure/persistence/drizzle/containers-overview.repository.ts` (`listarRemocoesPendentes`)
- **Teste:** `test/interfaces/http/containers/containers-overview.controller.spec.ts`; `test/infrastructure/persistence/recurso-de-projeto.repository.spec.ts`
- **Origem:** AT-980 (lane L8).

<a id="rn-1453"></a>

### RN-1453 — O convite de membro do projeto aceita `email` e responde 404 claro para quem é de fora do workspace {#rn-1453}

- **Regra:** `POST /projects/:projectId/members` (`maintainer`) aceita `email` no lugar de `userId` (um dos dois é obrigatório; `email` vence se vierem os dois). O e-mail é resolvido, sem diferenciar caixa, entre os membros do workspace do projeto; fora dele a resposta é 404 `Nenhum usuário do workspace tem este e-mail`, em vez da FK estourada em 500. Depois da resolução valem os mesmos tetos da [RN-472](parte-05.md#rn-472). `userId` continua aceito. A rota de workspace segue só com `userId`.
- **Código:** `src/application/use-cases/iam/add-project-member.use-case.ts` (`executeByEmail`); `src/interfaces/http/iam/dto/add-project-member.dto.ts`; `src/interfaces/http/iam/projects.controller.ts` (`addMember`)
- **Teste:** `test/application/use-cases/iam/tetos-de-rebaixamento.use-case.spec.ts` (Convite por e-mail)
- **Origem:** AT-974 (EP-035), W974.

<a id="rn-1493"></a>

### RN-1493 — Container que falhou mostra a primeira linha do motivo na lista {#rn-1493}

- **Regra:** cada item de `GET /workspaces/:workspaceId/containers` ganha `motivoDaFalha: string | null`, a primeira linha não vazia do `failureReason` gravado no registro do container (`registrado`). Sem registro ou sem motivo, `null`. O motivo vem só do registro gravado, nunca inventado a partir do broker (RN-468).
- **Código:** `src/application/use-cases/containers/obter-visao-geral-de-containers.use-case.ts` (`primeiraLinha`, `item`); `src/interfaces/http/containers/containers-overview.controller.ts` (`list`); `src/interfaces/http/containers/dto/containers.response.dto.ts`
- **Teste:** `test/application/use-cases/containers/obter-visao-geral-de-containers.use-case.spec.ts` ("motivoDaFalha é a primeira linha…"); `test/interfaces/http/containers/containers-overview.controller.spec.ts`
- **Origem:** AT-1006 (EP-035), parte D.

<a id="rn-1509"></a>

### RN-1509 — Toda tabela do contrato tem dono declarado e tarefa que a crie antes de o plano ser aprovado {#rn-1509}

- **Regra:** estende a [RN-1351](parte-12.md#rn-1351) e a [RN-1004](parte-11.md#rn-1004). (1) `validarContratos` recusa com 400 a tabela citada à direita de `->` num item `tabela` ou `identidade` que nenhum módulo declara como dona: "A tabela `usuario` é citada por `cadastro` (…), mas nenhum módulo a declara como dona". (2) `lerPlanoDeExecucao` ganha o 7º parâmetro `contratos` (`undefined` não confere) e recusa o plano quando (a) o dono de uma tabela tem tarefa no plano e nenhuma tarefa dele cita o nome da tabela (palavra inteira, sem diferenciar caixa, ex.: `tabela usuario`) no `expoe` do levantamento ([RN-1371](parte-12.md#rn-1371)); só confere quando os levantamentos vêm; (b) um módulo com tarefa referencia uma tabela cujo dono não tem tarefa no plano e não está entregue. As mensagens falam a um leigo ("Ninguém ficou responsável por criar a tabela `usuario`…"), sem id de tarefa nem uuid. Roda na proposta e na aprovação (`lerPlano`).
- **Código:** `src/domain/architecture/module-contracts.ts` (`validarContratos`, `donosDeTabela`, `referenciasDeTabela`); `src/domain/execution/plano-de-execucao.ts` (`lerPlanoDeExecucao`); `src/application/use-cases/execution/execute-execution-plan.use-case.ts` (`lerPlano`)
- **Teste:** `test/domain/execution/plano-de-execucao.spec.ts` (`tabela com dono no plano`); `test/application/use-cases/architecture/module-contracts.use-case.spec.ts` (`tabela e identidade`)
- **Origem:** AT-1014 (EP-036), TP-01 30ª (módulo `acesso` dono de `usuario` sem migração).

<a id="rn-1522"></a>

### RN-1522 — A api fixa o digest das imagens de serviço na proposta da PR de infra, sem perguntar ao dono {#rn-1522}

- **Par no engine:** [RN-1507](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine/parte-07.md#rn-1507).
- **Regra:** na proposta de `open_infra_pr`, cada `run.qa.services[].image` sem `@sha256:` (com tag explícita, nunca `latest`) é resolvida no registro OCI v2 público (token anônimo do `WWW-Authenticate`, `HEAD` no manifesto, cabeçalho `Docker-Content-Digest`, 10 s de limite) e o payload é regravado como `nome:tag@sha256:<64 hex>`. Só o nome público da imagem sai da api. Falha (registro fora do ar, tag inexistente, sem versão fixa) é 400 `digest_nao_resolvido` com texto para leigo, que volta à Infra; o dono nunca recebe a pergunta. Da api para dentro nada muda: a [RN-935](parte-11.md#rn-935) e o docker-port seguem exigindo digest (ADR 0229 mantido).
- **Código:** `src/infrastructure/registry/fixar-digest-de-imagens.ts` (`fixarDigestDasImagens`); `src/application/use-cases/actions/propose-action.use-case.ts` (`execute`)
- **Teste:** `test/infrastructure/registry/fixar-digest-de-imagens.spec.ts`; `test/application/use-cases/actions/propose-action.use-case.spec.ts` (`run da PR de infra`)
- **Origem:** AT-1015 (EP-036), TP-01 30ª, achado 30.

<a id="rn-1523"></a>

### RN-1523 — PR de infra sem arquivo é recusada na proposta, não na execução {#rn-1523}

- **Par no engine:** [RN-1508](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine/parte-07.md#rn-1508).
- **Regra:** `open_infra_pr` com `files` ausente ou vazio é 400 `infra_pr_sem_arquivos` ("inclua o arquivo que muda, por exemplo o compose com o serviço do banco"), antes de qualquer proposta; o engine recusa o mesmo antes do HALT. A execução revalida: ação gravada sem arquivo falha nomeada sem chamar o provider (que recusava com "commitFiles requer ao menos um arquivo"). Não há exceção "PR só de `run`".
- **Código:** `src/application/use-cases/actions/propose-action.use-case.ts` (`execute`); `src/application/use-cases/actions/execute-infra-pr.use-case.ts` (`execute`)
- **Teste:** `test/application/use-cases/actions/propose-action.use-case.spec.ts` (`run da PR de infra`); `test/application/use-cases/actions/execute-infra-pr.use-case.spec.ts` (`PR de infra sem arquivo`)
- **Origem:** AT-1015 (EP-036), TP-01 30ª, achado 34.

<a id="rn-1514"></a>

### RN-1514 — O módulo que sobe o app tem a fundação do esqueleto, e o reinício do app espera por ele {#rn-1514}

- **Regra:** estende a [RN-1004](parte-11.md#rn-1004) e a [RN-1026](parte-11.md#rn-1026). O "módulo do ponto de entrada" é o que o `run.app.command` cita (um só) ou, sem citação, o ÚNICO módulo que depende de outro e de que ninguém depende (`moduloDoPontoDeEntrada`); sem `run.app` ou sem resposta única, é `null` e tudo segue como antes. Com ele: (1) o reinício do app é pulado (`alvo_pendente`, sem falha e sem acordar o Dev Lead) enquanto o módulo não tem tarefa `done`, mesmo quando o comando na raiz não cita módulo algum; (2) o plano de execução é recusado (400 `plano_de_execucao_invalido`) quando o módulo tem tarefa no plano e nenhuma é fundação cujo `dependeDe` seja não vazio e só de fundações, com o texto que pede ao Dev Lead a fundação do esqueleto (scripts `build`, `migrate` e `start` na raiz, servidor vazio com `/docs` e `/openapi.json`, Dockerfile que constrói); (3) a resposta de falha de subida (`app_saiu`, `tempo_esgotado`, `falha_no_exec`) leva `modulo` (só o nome, nunca log, ADR 0264); (4) o contexto do dev ganha `moduloDoPontoDeEntrada` e `esqueletoDoApp` (a tarefa é fundação desse módulo). Limite conhecido: projeto com dois apps (api + web) tem dois módulos-sumidouro, a régua devolve `null` e vale o comportamento anterior; se aparecer, vira o campo `run.app.modulo`, declarado pela Infra.
- **Código:** `src/domain/architecture/module-graph.ts` (`moduloDoPontoDeEntrada`); `src/domain/execution/plano-de-execucao.ts` (`lerPlanoDeExecucao`); `src/application/use-cases/containers/reiniciar-app-do-projeto.use-case.ts` (`alvo`); `src/application/use-cases/execution/get-dev-task-context.use-case.ts` (`execute`)
- **Teste:** `test/domain/architecture/module-graph.spec.ts` (`moduloDoPontoDeEntrada`); `test/domain/execution/plano-de-execucao.spec.ts` (`esqueleto do app`); `test/application/use-cases/containers/reiniciar-app-do-projeto.use-case.spec.ts` (`o módulo que sobe o app`); `test/application/use-cases/execution/get-dev-task-context.use-case.spec.ts` (`o módulo que sobe o app`)
- **Origem:** AT-1016 (EP-036), TP-01 30ª, achados 13, 14, 22, 25, 31 e 38. O lado do engine é a RN-1515.

<a id="rn-1524"></a>

### RN-1524 — A resposta do dono a uma pergunta acorda quem perguntou, na mesma transação {#rn-1524}

- **Par no engine:** [RN-1516](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine/parte-07.md#rn-1516).
- **Regra:** estende a [RN-1002](parte-11.md#rn-1002) e a [RN-860](parte-10.md#rn-860). `PerguntasEmAbertoUseCase.fechar`, o núcleo comum de "Aceitar sugestão" e da resposta do dono, grava na MESMA transação do par `artifact.decision_record` + `open_question.answered` uma linha de outbox `open_question.answered` (`aggregateType: 'session'`, payload `{ projectId, sessionId, questionId, autor, pergunta, resposta, afeta }`). Se a transação cai, nenhuma das três existe. Quando o fechamento vem do próprio agente (`viaAgente`, `answer_open_question`), a linha NÃO é gravada: ele já está em turno. O engine entrega a linha ao Dev Lead quando `autor` é o `dev-lead` (RN-1524 do engine, que usa o mesmo número); Desbloquear e Rearmar continuam gesto humano (RN-1335 do engine).
- **Código:** `src/application/use-cases/backlog/perguntas-em-aberto.use-case.ts` (`PerguntasEmAbertoUseCase`)
- **Teste:** `test/application/use-cases/backlog/perguntas-em-aberto.use-case.spec.ts` (`RN-1524`)
- **Origem:** AT-1019 (EP-036), TP-01 30ª, achado 43.

<a id="rn-1525"></a>

### RN-1525 — O contexto da Infra traz o estado registrado do container de trabalho e da instância de QA {#rn-1525}

- **Par no engine:** [RN-1517](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine/parte-07.md#rn-1517).
- **Regra:** estende a [RN-852](parte-10.md#rn-852) e a [RN-935](parte-11.md#rn-935). `GET` do contexto interno da Infra devolve `containerDoProjeto` (`status`, `statusChangedAt`, `failureReason`, lidos de `ContainerRepository.findByProject`) e `instanciaDeQa` (`taskId`, `status`, lida de `QaEnvironmentRepository.findAtivaDoProjeto`), ambos `null` sem registro. É o estado REGISTRADO: nenhuma chamada ao broker. A instância de QA é da api e do QA de Automação, nunca da Infra: o engine diz isso ao modelo (RN-1525 do engine, mesmo número).
- **Código:** `src/application/use-cases/execution/get-infra-context.use-case.ts` (`GetInfraContextUseCase`); `src/interfaces/http/internal/dto/internal.response.dto.ts` (`InfraContextResponseDto`)
- **Teste:** `test/application/use-cases/execution/get-infra-context.use-case.spec.ts` (`RN-1525`)
- **Origem:** AT-1019 (EP-036), TP-01 30ª, achados 19 e 21.

<a id="rn-1520"></a>

### RN-1520 — Os serviços de dados e o `run.env` chegam também ao container de trabalho {#rn-1520}

- **Regra:** estende a [RN-935](parte-11.md#rn-935) e a [RN-1522](#rn-1522) (ADR 0229). `run.env` é opcional: até 20 variáveis `[A-Z_][A-Z0-9_]*` com valor de texto de uma linha (mesma régua do `env` de serviço); é valor de DESENVOLVIMENTO, nunca segredo real, porque o `run` é gravado em evento e vai ao repositório. A spec de container que o broker consulta (`obter-spec-de-container`) passa a devolver, sem `qaTask` (container de TRABALHO), `services` com os serviços NÃO compartilhados de `run.qa.services` (sobem no `localhost` do trabalho) e `env`; com `qaTask`, devolve `env` além de `qa.services`. Os dois campos são opcionais: sem `run.env` e sem serviços a resposta é a de antes. Serviço `shared` segue só do QA. A guarda "compose com banco exige o serviço em `run.qa.services`" fica no engine (`recusa_de_infra_pr`), não na api.
- **Código:** `src/domain/infra/run-instructions.ts` (`recusaDoRun`, `normalizarRun`); `src/application/use-cases/containers/obter-spec-de-container.use-case.ts` (`execute`); `src/application/use-cases/execution/get-run-instructions.use-case.ts` (`execute`)
- **Teste:** `test/domain/infra/run-qa.spec.ts` (`run.env`); `test/application/use-cases/containers/spec-e-observacao-de-container.use-case.spec.ts` (`serviços e env do trabalho`)
- **Origem:** AT-1015 (EP-036), TP-01 30ª, achados 24 e 34. O contrato é a RN-1518 do brabo-contracts.

<a id="rn-1526"></a>

### RN-1526 — A regra de linguagem para leigo é uma só e é pura {#rn-1526}

- **Regra:** `recusaDeFraseParaLeigo` decide se um texto serve para quem não programa: até o teto do campo, uma frase só (sem `. ` no meio), sem UUID nem hash hexadecimal de 12 ou mais caracteres, sem crase, sem nome de arquivo nem caminho, sem identificador `snake_case`, `camelCase`, `:atom`, com pontos ou `CONSTANTE_`, sem `host:porta` nem código HTTP solto. Vale para a `causa` (até 160 caracteres), os `rotulo` de ação (até 40) e os `rotulo` de opção de pergunta (até 40); nunca para a `orientacao`, o diagnóstico e o `detalhe`, que são técnicos de propósito. O engine aplica a mesma regra, com a mesma tabela de casos, para o modelo reescrever; aqui ela é a fronteira de confiança.
- **Código:** `src/domain/linguagem/frase-para-leigo.ts` (`recusaDeFraseParaLeigo`)
- **Teste:** `test/domain/linguagem/frase-para-leigo.spec.ts` (`RN-1526`)
- **Origem:** AT-1021 (EP-036), TP-01 30ª, achado 33.

<a id="rn-1527"></a>

### RN-1527 — O bloqueio pode levar uma explicação para leigo, e explicação fora da regra é descartada {#rn-1527}

- **Regra:** estende a [RN-1124](parte-12.md#rn-1124). `POST /internal/.../tasks/:taskId/block` aceita `explicacao` opcional: `{ codigo?, causa, acoes: [{ id?, rotulo, orientacao }] }` (1 a 2 ações; `orientacao` até 2000 caracteres e pode ser vazia, que é o "Tentar de novo"). Passando pela [RN-1526](#rn-1526), ela é gravada em `tasks.blocked_explicacao` (jsonb, nulável), vai no payload de `backlog.task_blocked` (`explicacao`, `null` sem ela) e sai em `TaskResponseDto.blockedExplicacao`. Explicação inválida é DESCARTADA com `logger.warn` e o bloqueio acontece mesmo assim, porque o bloqueio é o desfecho seguro (mesma régua da [RN-1143](parte-12.md#rn-1143)); por isso o DTO só confere que é um objeto. O `blockedReason` cru continua igual, e o `unblock` zera a coluna. Não há rota nova de retomada: a ação chama o `unblock` com `orientacao` (RN-1124).
- **Código:** `src/application/use-cases/execution/mark-task-blocked.use-case.ts` (`MarkTaskBlockedUseCase`); `src/domain/backlog/explicacao-do-bloqueio.ts` (`validarExplicacaoDoBloqueio`); `src/infrastructure/persistence/drizzle/backlog.repository.ts` (`markBlocked`, `unblock`)
- **Teste:** `test/application/use-cases/execution/mark-task-blocked.use-case.spec.ts` (`RN-1527`); `test/domain/linguagem/frase-para-leigo.spec.ts` (`validarExplicacaoDoBloqueio`)
- **Origem:** AT-1021 (EP-036), TP-01 30ª, achado 33.

<a id="rn-1528"></a>

### RN-1528 — A pergunta em aberto pode trazer até 2 opções prontas e um detalhe técnico {#rn-1528}

- **Regra:** estende a [RN-858](parte-10.md#rn-858). O payload de `artifact.open_question` aceita `opcoes` (até 2 `{ rotulo, resposta }`; `rotulo` até 40 caracteres e na [RN-1526](#rn-1526), `resposta` de 1 a 2000) e `detalhe` (texto até 2000, técnico, que a tela mantém recolhido). Fora disso é 400 nomeado, que chega ao modelo. A leitura (`OpenQuestionResponseDto`) devolve `opcoes` (vazia sem elas) e `detalhe` (`null` sem ele). Responder não muda: o clique numa opção responde com `{ resposta: opcao.resposta }` pela rota que já existe. A própria pergunta segue com a validação de antes (até 500 caracteres): a regra de linguagem não a alcança aqui.
- **Código:** `src/domain/open-questions/pergunta-em-aberto.ts` (`validarPerguntaEmAberto`); `src/application/use-cases/backlog/perguntas-em-aberto.use-case.ts` (`PerguntasEmAbertoUseCase`)
- **Teste:** `test/domain/open-questions/opcoes-da-pergunta.spec.ts` (`RN-1528`)
- **Origem:** AT-1021 (EP-036), TP-01 30ª, achados L1, L6, L9.

<a id="rn-1534"></a>

### RN-1534 — O aviso de duplicata semântica ao modelo manda citar só os títulos {#rn-1534}

- **Regra:** estende a [RN-681](parte-09.md#rn-681). A frase do `warned` que a api entrega ao modelo continua com o id da existente, a similaridade e o limiar, porque é o modelo que decide se refina ou segue. Ela ganha um fecho: "Se perguntar ao usuário, cite só os títulos das duas; não cite id, similaridade nem limiar." Assim o número de máquina não é repetido na pergunta de conflito. `skipped` e `clean` não mudam.
- **Código:** `src/application/use-cases/backlog/verificar-duplicata-semantica.use-case.ts` (`fraseParaOAgente`)
- **Teste:** `test/application/use-cases/backlog/verificar-duplicata-semantica.use-case.spec.ts` (`RN-1534`)
- **Origem:** AT-1026 (EP-036), TP-01 30ª, achado 7.
