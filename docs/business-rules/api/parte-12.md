---
id: rn-api-parte-12
title: 'Regras de negócio — API — parte 12 (desde RN-1029)'
sidebar_label: 'API — parte 12 (desde RN-1029)'
description: 'As RNs hospedadas na raiz api.'
keywords: [regras de negócio, api]
---

# API — parte 12 (desde RN-1029)

## A Anamnese não paga duas vezes pela mesma janela, e o resgate de gate não reinicia ciclo que espera alguém (RN-722)
<a id="rn-1029"></a>

### RN-1029 — Depois do merge da PR de infra que declara `run.app`, a api propõe `container_recreate` com a porta do app, uma vez {#rn-1029}

- **Regra:** quando um `git_merge` na `main` ([RN-1022](parte-11.md#rn-1022)) recebe `state: 'merged'`, o `ApproveActionUseCase` chama o `ProporRecriacaoDoAppUseCase` FORA da transação do merge e em melhor esforço: uma falha só registra no log o nome do erro (sem mensagem, sem segredo) e o merge continua válido.
  1. **Detecção.** Existe um `open_infra_pr` do projeto, `executed`, cujo `pullRequestId` é o mergeado e cujo payload leva `run.app`, e o `prUrl` das `run_instructions` correntes ([RN-852](parte-10.md#rn-852)) é o `pullRequestUrl` dessa ação (uma PR de infra mais nova e ainda aberta levaria um comando que não está na `main`).
  2. **NÃO propõe quando** (função pura `motivoDeNaoRecriar`): o projeto é `runner`; não há container, ou ele está `removed`, `failed` ou `provisioning`; já há um `container_recreate` `pending`; ou o status do container mudou depois que as `run_instructions` correntes foram declaradas (`statusChangedAt > declaredAt`: ele já subiu com o app). Atalho: um container parado e reiniciado depois com `docker start` passa como atualizado; a recriação manual na página do container continua.
  3. **Porta do host.** SEMPRE na faixa 13000+, mesmo quando `app.port` seria permitida: o primeiro valor livre a partir de 13000, pulando toda porta de host já declarada em qualquer `artifact.container_network` de qualquer projeto (atalho: qualquer versão conta como ocupada, e a recriação pendente de outro projeto não conta). A porta do container é `run.app.port`.
  4. **Proposta.** `ProposeActionUseCase` com `container_recreate`, ator `agent/infra`, na sessão do merge, payload exatamente `{ reason: 'app_declared', pullRequestId, ports: [{ host, container, protocol: 'tcp' }] }`. O teto absoluto da [RN-934](parte-11.md#rn-934) o mantém `pending`: o clique continua humano. A web monta a URL do app a partir de `payload.ports[0].host` (`http://127.0.0.1:<host>`).
  5. **Clique.** O `ExecuteContainerRecreateUseCase` grava `artifact.container_network` ([RN-932](parte-11.md#rn-932)) com o ator `user/<quem clicou>` ANTES do `remove`, e só quando o projeto não tem rede corrente (nunca sobrescreve); uma rede recusada faz a ação falhar antes de o container antigo ser tocado. Depois, `remove` + `start` como na [RN-934](parte-11.md#rn-934).
- **Código:** `apps/api/src/application/use-cases/actions/propor-recriacao-do-app.use-case.ts` (`execute`), `apps/api/src/domain/containers/recriar-com-app.ts` (`motivoDeNaoRecriar`, `proximaPortaLivre`), `apps/api/src/application/use-cases/actions/approve-action.use-case.ts` (`proporRecriacaoDoApp`), `apps/api/src/application/use-cases/actions/execute-container-recreate.use-case.ts` (`obterRede`)
- **Teste:** `apps/api/test/domain/containers/recriar-com-app.spec.ts`, `apps/api/test/application/use-cases/actions/propor-recriacao-do-app.use-case.spec.ts`, `apps/api/test/application/use-cases/actions/approve-action-recreate-hook.spec.ts` (falha do gancho não desfaz o merge), `apps/api/test/application/use-cases/actions/execute-container-recreate.use-case.spec.ts` (rede gravada só sem uma anterior, com quem clicou como ator, antes do `remove`)
- **Origem:** AT-758 (EP-030), decisão do dono de 06/11/2026; rodada 209, lane L1.

<a id="rn-1030"></a>

### RN-1030 — Todo nó do grafo gravado por `MERGE` numa chave natural tem restrição de unicidade, e a subida funde as duplicatas preexistentes antes de criá-la {#rn-1030}

- **Regra:** refina a [RN-569](parte-07.md#rn-569). `Handoff (sessionId, seq)`, `Evento (sessionId, seq)`, `PerfilAnamnese (userId, dimensao)` e `Hipotese (id)` não tinham restrição, então dois `MERGE`s concorrentes (o projetor vivo e uma reprojeção, ou duas réplicas da api) criavam dois nós: a prova de reprojeção no k3d mediu `12|9` em vez de `9|6`. Agora eles têm restrição de unicidade, e os casos de uso continuam fazendo `MERGE` exatamente na chave restrita. Restrição de unicidade composta é aceita pelo Neo4j 5.26 Community (medido; só `NODE KEY` e restrições de existência são Enterprise), então não existe propriedade de chave sintética.
- **Subida:** antes do `CREATE CONSTRAINT`, o `GraphStore` funde as duplicatas desses quatro rótulos já presentes num grafo instalado (fica o nó mais antigo por `elementId`, toda aresta dos outros é movida para ele sem duplicar uma existente, e os outros são apagados). É idempotente (sem duplicatas não grava nada), roda numa transação por rótulo e registra no log só o número de nós fundidos, nunca o conteúdo deles. Uma falha mantém o grafo desligado, como qualquer outra falha de bootstrap ([RN-960](parte-11.md#rn-960)).
- **Onde:** `apps/api/src/infrastructure/graph/graph-store.ts:51` (`CONSTRAINTS`), `apps/api/src/infrastructure/graph/graph-store.ts:160` (`bootstrapConstraints`), `apps/api/src/infrastructure/graph/graph-dedup.ts:34` (`deduplicarNos`).
- **Teste:** `apps/api/test/infrastructure/graph/neo4j-integration.spec.ts` (contra um Neo4j real: escritas concorrentes do mesmo nó dão um nó; as duplicatas são fundidas com as arestas mantidas, as restrições são criadas depois, uma segunda subida não muda nada), `apps/api/test/infrastructure/graph/graph-store.spec.ts` (a deduplicação roda antes das restrições).
- **Origem:** AT-762 parte B (EP-033), decisão do dono de 06/11/2026; rodada 214, lane L1.

<a id="rn-1065"></a>

### RN-1065 — O provider de LLM dublê do regressivo só carrega com `LLM_DUBLE=1` e com a imagem sem a marca `prd`; o custo dele é 0 e o modelo sai como `duble-llm` {#rn-1065}

- **Regra:** o regressivo do `brabo-qa` precisa de agentes que respondem sem LLM real nem custo. O `DubleLLMProvider` ocupa o lugar do provider `ollama` no `LLMProviderRegistry` (o mesmo ponto dos outros; é o provider sem credencial) e responde por roteiro. Ele só existe quando a variável `LLM_DUBLE` vale exatamente `1` E o arquivo `/app/AMBIENTE_DA_IMAGEM` (a marca gravada pelo Dockerfile, o mesmo mecanismo da [AT-722](#rn-1065)) não diz `prd`. Na imagem `prd` ele nunca carrega, nem com a variável: a api só registra um aviso no log. Sem a marca (pnpm dev), só a variável decide. A marca vem da tag (AT-850): a imagem `sha-` da PR e a de tag `-dev.N` levam `dev` (o dublê pode carregar no E2E); só a de tag final `vX.Y.Z`, sem sufixo, leva `prd`. `LLM_DUBLE=1` sem `LLM_DUBLE_ROTEIRO` derruba a subida.
- **Custo e identificação:** cada chamada devolve `costMicros: 0` e `resolvedModel: "duble-llm"`, então `token_usage` grava custo 0 e `resolved_model_name = duble-llm`, e nunca se confunde com uso real.
- **Roteiro:** arquivo JSON apontado por `LLM_DUBLE_ROTEIRO`: `{"agentes": {"<agentId>"|"*": [passo, ...]}}`, com `passo = {texto?, tool_calls?: [{name, arguments?}], inputTokens?, outputTokens?}`. Um passo por chamada, por sessão e agente (o agente sai de `sessionKey = brabo:<sessionId>:<agentId>`); acabou a lista, repete o último passo. Agente sem entrada cai em `"*"`; sem `"*"`, o turno termina em erro. As `tool_calls` saem no mesmo formato que o parser do Ollama produz. Exemplo em `docs/reference/llm-duble-roteiro.example.json`.
- **Limite:** sem `embed` nem `listModels` (RAG e sincronização de catálogo seguem sem o dublê).
- **Onde:** `src/infrastructure/security/ambiente.ts` (`dubleDeLlm`), `src/infrastructure/llm/duble-llm-provider.ts` (`dubleSeAutorizado`, `DubleLLMProvider`), `src/infrastructure/llm/llm-provider-registry.ts` (`resolve`), `src/infrastructure/llm/llm-infrastructure.module.ts` (`LLM_DUBLE`).
- **Teste:** `test/scripts/marca-da-imagem.spec.ts` (marca por tag nos workflows) e `test/infrastructure/llm/duble-llm-provider.spec.ts` (variável sim ou não × marca prd ou não; roteiro por agente e passo; custo 0 e modelo dublê).
- **Origem:** AT-815 (EP-033), decisão do dono de 08/11/2026 (P1); [ADR 0279](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0279-provider-de-llm-duble-do-regressivo.md); rodada 251, lane L3.

<a id="rn-1068"></a>

### RN-1068 — O PO e o Dev Lead corrigem o texto de uma tarefa `todo`, com a régua da história {#rn-1068}

- **Regra:** `POST /internal/sessions/:sessionId/tasks/:taskId/update` (ferramenta `update_task` do PO e do Dev Lead) corrige título e/ou descrição de uma tarefa. Estende a [RN-727](parte-10.md#rn-727) e a [RN-859](parte-10.md#rn-859) à tarefa. Recusa em 409 nomeado: `tarefa_em_execucao` (status diferente de `todo`), `historia_arquivada` e `historia_nao_draft` (a história `ready` só aceita com `questionId` de pergunta já respondida pelo usuário). 400 sem campo ou com título vazio ou acima de 200; 404 para tarefa de outro projeto. Grava `backlog.task_updated` na sessão da história, com `taskId`, `storyId`, `previousTitle`, `title`, `descriptionChanged` e, quando houver, `questionId`; o ator é `agent` `po` (padrão) ou `dev-lead` (campo `agentId`). Nada mudou, nenhum evento.
- **Onde:** `src/application/use-cases/backlog/corrigir-historia.use-case.ts:103` (`editarTarefa`), `src/domain/backlog/correcao-de-historia.ts:82` (`recusaDeCorrecaoDeTarefa`), `src/interfaces/http/internal/internal-sessions.controller.ts:614` (`updateTaskRoute`)
- **Teste:** `test/application/use-cases/backlog/corrigir-historia.use-case.spec.ts` (`CorrigirHistoriaUseCase.editarTarefa`: feliz com evento; `in_progress`/`in_review`/`done` recusadas; história `ready` com e sem resposta; arquivada; 404 e 400).
- **Origem:** AT-805 (EP-030), achado 5 do TP-01 27ª; rodada 271, lane L2.

<a id="rn-1069"></a>

### RN-1069 — A ADR proposta declara qual ADR substitui (`supersedes`), e a api confere {#rn-1069}

- **Regra:** o payload de `open_adr_pr` aceita `supersedes` (slug da ADR substituída; `docs/adr/<slug>.md` também vale). Ao propor, a api exige uma `open_adr_pr` DESTE projeto com esse slug e já aceita (`executed`: aprovada, com a PR aberta ou mergeada); inexistente, de outro projeto, pendente, negada, com falha ou a própria ADR nova é 400 `adr_supersedes_invalido`, sem criar a proposta. A PR da ADR nova ganha a linha `Substitui: docs/adr/<slug>.md` no corpo. Sem `supersedes`, nada muda.
- **Onde:** `src/domain/actions/adr-supersedes.ts:22` (`recusaDeSupersedes`), `src/application/use-cases/actions/propose-action.use-case.ts:162` (chamada), `src/application/use-cases/actions/execute-adr-pr.use-case.ts` (corpo da PR)
- **Teste:** `test/domain/actions/adr-supersedes.spec.ts`, `test/application/use-cases/actions/propose-action.use-case.spec.ts` (`open_adr_pr com supersedes`, contra Postgres).
- **Origem:** AT-806 (EP-030), decisão do dono (b) de 08/11/2026; ADR 0283; rodada 271, lane L2.

<a id="rn-1070"></a>

### RN-1070 — O workspace escolhe quem roteia a ferramenta (`jev`, `laya` ou `desligado`), e `laya` só grava com o serviço proficiente na hora {#rn-1070}

- **Regra:** `workspaces.tool_router` (enum `jev` padrão, `laya`, `desligado`) substitui o liga/desliga da [RN-625](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-625); `tool_router_enabled` segue existindo como coluna GERADA (`tool_router <> 'desligado'`), então o DTO do workspace e quem lê o booleano não mudam, e o `false` de antes migrou para `desligado`. `PUT /workspaces/:workspaceId/tool-router` (`owner`) aceita `{roteador}` e, por compatibilidade, `{enabled}` (`true` = `jev`); sem nenhum, 400. `roteador: "laya"` consulta o `/health` do serviço SEM cache e só grava com `estado = proficiente`; senão 409 `roteador_local_indisponivel`, com o estado e o motivo no corpo, e nada é gravado. `GET /workspaces/:workspaceId/tool-router` (`viewer`) devolve `{roteador, laya: {estado, motivo, desde, dispositivo, vramLivreMiB, p95Ms}}`, com cache de 30 s e teto de 1 s; o turno do agente NUNCA passa por ele.
- **Estados do Laya (nunca colapsados):** `nao_configurado` (sem `TOOL_ROUTER_URL`), `sem_resposta` (rede, HTTP não 2xx ou corpo inválido), `sem_gpu` (dispositivo diferente de `cuda` ou VRAM livre abaixo de `TOOL_ROUTER_LAYA_VRAM_MIN_MIB`, padrão 2048), `lento` (p95 da sonda de boot acima de `TOOL_ROUTER_LAYA_P95_MAX_MS`, padrão 500, decisão do dono de 31/10/2026) e `proficiente`. `desde` só anda quando o estado muda.
- **Configuração:** `TOOL_ROUTER_URL` (base do serviço, rede interna, sem porta publicada), `TOOL_ROUTER_API_KEY` (opcional), `TOOL_ROUTER_LAYA_LIMIAR` (padrão 0,72), `TOOL_ROUTER_LAYA_P95_MAX_MS`, `TOOL_ROUTER_LAYA_VRAM_MIN_MIB`, `TOOL_ROUTER_LAYA_TIMEOUT_MS` (padrão 2000), `TOOL_ROUTER_LAYA_MODELO` e `TOOL_ROUTER_LAYA_MAX_LEN`. Os padrões são os do levantamento de 09/11/2026; VRAM e RAM do ensemble de 4 (RAM mínima do serviço de 6 GiB) saem da medição da AT-630 e entram trocando a variável.
- **Onde:** `src/db/schema/iam.ts` e `src/db/migrations/0084_laya_no_lugar_do_jev.sql` (`tool_router`), `src/application/use-cases/iam/set-workspace-tool-router.use-case.ts:27` (`execute`), `src/application/use-cases/iam/get-workspace-tool-router.use-case.ts:13` (`execute`), `src/infrastructure/llm/laya-status.ts:24` (`situacao`), `src/infrastructure/llm/laya-config.ts:8` (`configDoLaya`), `src/interfaces/http/iam/workspaces.controller.ts:296` (`getToolRouter`)
- **Teste:** `test/application/use-cases/iam/set-workspace-tool-router.use-case.spec.ts` (409 sem serviço proficiente, grava sem cache, `enabled` legado, 400) e `test/infrastructure/llm/laya-tool-router.spec.ts` (`LayaStatus`: os cinco estados, cache e `desde`).
- **Origem:** AT-626 (EP-026), decisões do dono de 31/10 e 07/11/2026; [ADR 0290](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0290-laya-no-lugar-do-jev.md); rodada 354, lane L2.

<a id="rn-1071"></a>

### RN-1071 — Com o workspace em `laya`, todo provider é roteado por UMA chamada ao serviço local, e qualquer falha deixa o catálogo inteiro {#rn-1071}

- **Regra:** estende a [RN-625](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-625) e revisa o item 1 dela por ADR: com `tool_router = laya` o passo é roteado com QUALQUER provider e SEM credencial (o Laya é local e não cobra); com `jev` continua só com `openrouter` e chave. `LayaToolRouter` faz `POST {TOOL_ROUTER_URL}/v1/systemone` com o formato do Decisions API, SEM a opção reservada `responder_sem_ferramenta` (o Laya não a viu no treino), e o serviço devolve a distribuição já em média do ensemble. Regra p3 + limiar: confiança abaixo de `TOOL_ROUTER_LAYA_LIMIAR` vira `responder_sem_ferramenta`, que deixa o catálogo inteiro. O `tool_router.decided` grava `modelo = laya-multilingual`; não há linha em `token_usage`.
- **Queda:** timeout (2 s), rede, HTTP, corpo inválido, escolha fora das opções ou URL ausente voltam como queda NOMEADA e o passo segue com o catálogo inteiro (decisão do dono de 31/10/2026): NUNCA cai para o Jev, e o turno nunca falha por causa do Laya.
- **Onde:** `src/infrastructure/llm/laya-tool-router.ts:28` (`decidir`), `src/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.ts:123` (`preparar`), `src/infrastructure/llm/llm-infrastructure.module.ts:58` (`ToolRouterLocal`)
- **Teste:** `test/infrastructure/llm/laya-tool-router.spec.ts` (uma chamada sem a reservada, Bearer opcional, limiar, seis quedas nomeadas) e `test/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.spec.ts` (`workspace em laya`: qualquer provider sem chave, queda para o catálogo inteiro sem chamar o Jev, sem `token_usage`).
- **Origem:** AT-626 (EP-026), decisões do dono de 31/10 e 07/11/2026; ADR 0290; rodada 354, lane L2.

<a id="rn-1108"></a>

### RN-1108 — O índice RAG do projeto inclui `.brabo/memoria/`, e o merge na trunk o reindexa sozinho {#rn-1108}

- **Regra:** além de `docs/` e `docs/adr/`, a indexação varre `.brabo/memoria/**/*.md` do repositório do PRÓPRIO projeto (a memória em markdown da AT-923). Os chunks entram no escopo `docs`, sem migração; o caminho (`.brabo/memoria/...`) os distingue, e a cobertura os conta junto. Cada `project.trunk_merged` na outbox dispara a mesma reindexação de `docs`/`adr` (`IndexProjectDocsUseCase`) do botão "Reindexar agora", sem as sessões. Falha na reindexação só loga: não desfaz nem atrasa o merge, que já aconteceu. Mesma ideia da [RN-455](parte-05.md#rn-455): o índice cobre fontes que o servidor consegue revisitar.
- **Como lê:** quem drena `project.trunk_merged` é o engine (`TrunkMergedWorker`), que marca a linha como processada; por isso o consumidor da api só LÊ a outbox (`listByEventTypeAfter`) e guarda a própria marca d'água, em memória, iniciada no boot. Um merge com a api fora do ar só é reindexado no próximo merge ou pelo botão.
- **Onde:** `src/application/use-cases/rag/index-project-docs.use-case.ts` (`MEMORIA_ROOT`), `src/application/rag-reindex/trunk-merged-reindexer.ts` (`TrunkMergedReindexer`), `src/infrastructure/persistence/drizzle/outbox.repository.ts` (`listByEventTypeAfter`)
- **Teste:** `test/application/use-cases/rag/index-project-docs.use-case.spec.ts` (`RN-1108`) e `test/application/rag-reindex/trunk-merged-reindexer.spec.ts` (um projeto por ciclo, sem `markProcessed`, marca d'água, falha só loga).
- **Origem:** AT-923 (EP-036), lane A3 da rodada 371; ADR 0293 (a memória do projeto é markdown versionado; o RAG e o grafo são índices).

<a id="rn-1101"></a>

### RN-1101 — A ativação da execução recusa o projeto sem container `running`, salvo o dev Noop {#rn-1101}

- **Regra:** `POST /projects/:projectId/execution/activate` responde 409 `execucao_sem_container` quando o container registrado do projeto não está `running`, depois da guarda do repositório ([RN-582](parte-05.md#rn-582)) e antes de qualquer efeito. Sem isso cada dev bloqueava em `dev.blocked_by_container` ([RN-502](parte-05.md#rn-502)) no mesmo segundo, sem aviso. A frase diz o próximo passo: aprovar a subida proposta pela Infra, ou pedi-la. O dev `noop` (`devAgentImpl: 'noop'`) é isento, como no engine.
- **Onde:** `src/application/use-cases/execution/activate-execution.use-case.ts` (`execute`, `containerRodando`)
- **Teste:** `test/application/use-cases/execution/activate-execution.use-case.spec.ts` (`RN-1101`: recusa sem container, recusa em `provisioning`, passa com `running`, Noop isento).
- **Origem:** AT-899 (EP-036), parte da api; rodada 366, lane AA1.

<a id="rn-1102"></a>

### RN-1102 — O dev extra de paralelização nasce com o modo do agente base {#rn-1102}

- **Regra:** No aceite da paralelização, se o agente base do módulo (`dev-<módulo>`) está no piloto automático (curinga `agent_autonomy (agente, "*") = auto_approve`), o extra (`dev-<módulo>-2`) recebe a mesma curinga. Base manual não semeia curinga: o extra segue só com as linhas de `DEV_AUTO_GIT_ACTIONS`.
- **Onde:** `src/application/use-cases/execution/accept-parallelization.use-case.ts` (`execute`)
- **Teste:** `test/application/use-cases/execution/accept-parallelization.use-case.spec.ts` (`RN-1102`: base automático herdado, base manual sem curinga).
- **Origem:** AT-908 (EP-036); rodada 366, lane AA1.

<a id="rn-1103"></a>

### RN-1103 — Ligar o piloto automático de um agente reavalia as ações pendentes dele pela régua da proposta {#rn-1103}

- **Regra:** `PUT /projects/:projectId/agent-autonomy` com `actionType "*"` e `mode auto_approve` lista as ações `pending` do agente no projeto e roda, para cada uma, o MESMO `decide()` da proposta (`ProposeActionUseCase.decidir`, sem segunda régua). A que agora resolve `auto_approve` é aprovada pelo `ApproveActionUseCase` em nome de quem ligou o piloto; os tetos (`git_push`, `pr_open`, `git_merge`) seguem pendentes. Falha em uma ação é registrada em log e não desfaz a regra gravada nem barra as outras. Rota, DTO e papel (`maintainer`) não mudam.
- **Onde:** `src/application/use-cases/actions/set-agent-autonomy.use-case.ts` (`reavaliarPendentes`), `src/application/use-cases/actions/propose-action.use-case.ts` (`decidir`), `src/interfaces/http/actions/agent-autonomy.controller.ts` (`set`)
- **Teste:** `test/application/use-cases/actions/set-agent-autonomy.use-case.spec.ts` (libera o `terminal` pendente, mantém o `git_push`, ignora outro agente, regra específica ou modo manual não reavalia).
- **Origem:** AT-908 (EP-036); rodada 366, lane AA1.

<a id="rn-1104"></a>

### RN-1104 — O merge que não move o alvo fica registrado como `jaContida` {#rn-1104}

- **Regra:** Quando o merge de uma PR termina `merged` mas a ponta da branch alvo é a mesma de antes (a fonte já estava contida), o `execution_result` da ação `git_merge` e o evento `action.git_merge` levam `jaContida: true`, e a tela diz "nada a mergear". As pontas vêm de `listBranches` antes e depois do merge, em melhor esforço: sem leitura, nada é afirmado. Vale para os providers local e remoto; o contrato `@brabo/shared` não muda. O claim da fundação do módulo (AT-901, primeira parte) NÃO está aqui.
- **Onde:** `src/application/use-cases/actions/execute-git-action.use-case.ts` (`executeProviderAction`, ramo `git_merge`), `src/domain/git/git-action-execution-result.ts` (`GitMergeExecutionResult.jaContida`)
- **Teste:** `test/application/use-cases/actions/execute-git-action.use-case.spec.ts` (`RN-1104`: pontas iguais gravam `jaContida`, pontas diferentes não).
- **Origem:** AT-901 (EP-036), só o merge sem efeito; rodada 366, lane AA1.

<a id="rn-1138"></a>

### RN-1138 — A tarefa criada pelo Dev Lead é a FUNDAÇÃO do módulo {#rn-1138}

- **Regra:** `create_task` com `agentRole: dev_lead` grava `tasks.fundacao = true` (migração 0087); a do PO nasce `false`. A coluna aparece em `TaskResponseDto.fundacao`.
- **Onde:** `src/application/use-cases/backlog/create-task.use-case.ts` (`execute`), `src/db/schema/backlog.ts` (`tasks.fundacao`)
- **Teste:** `test/application/use-cases/backlog/create-task.use-case.spec.ts` (`RN-1138`).
- **Origem:** AT-901 (EP-036), parte do claim; rodada 372, lane L1.

<a id="rn-1139"></a>

### RN-1139 — A fundação do módulo sai primeiro no claim e segura as outras tarefas dele {#rn-1139}

- **Regra:** `claimNext` ordena `fundacao DESC` antes de `created_at`, e a tarefa que não é fundação só é pegável sem fundação do mesmo módulo aberta (não `done`, não arquivada, de história não arquivada). Quem arquiva a fundação a libera.
- **Onde:** `src/infrastructure/persistence/drizzle/backlog.repository.ts` (`claimNext`, `semFundacaoAberta`)
- **Teste:** `test/infrastructure/persistence/drizzle/backlog-arquivar-tarefa.repository.spec.ts` (`a fundação do módulo vem primeiro`).
- **Origem:** AT-901 (EP-036); rodada 372, lane L1.

<a id="rn-1140"></a>

### RN-1140 — A contagem de tarefas pegáveis usa a mesma guarda da fundação {#rn-1140}

- **Regra:** `countClaimableByModule` aplica `semFundacaoAberta`, o mesmo predicado do claim (AT-274), para a sugestão de paralelização nunca contar o que o claim segura.
- **Onde:** `src/infrastructure/persistence/drizzle/backlog.repository.ts` (`countClaimableByModule`)
- **Teste:** o mesmo spec da RN-1139 (a contagem concorda com o claim).
- **Origem:** AT-901 (EP-036); rodada 372, lane L1.

<a id="rn-1141"></a>

### RN-1141 — Tarefa aberta da execução vigente segura a sessão, sem teto {#rn-1141}

- **Regra:** na sessão de execução vigente, toda tarefa não `done` e não arquivada, de história não arquivada, é pendência sem teto (`aguardandoUsuarioDesde: null`), com o motivo `aberta_na_execucao` quando nenhum motivo específico (RN-776, RN-856, AT-912) vale. O teto de 8 h da conversa ociosa não fecha essa sessão; ela fecha quando o backlog termina ou o usuário encerra. Amplia a [RN-776](parte-10.md#rn-776).
- **Onde:** `src/infrastructure/persistence/drizzle/backlog.repository.ts` (`findPendenteDaExecucao`), `src/application/use-cases/sessions/get-session-pending-work.use-case.ts` (`MOTIVO_DA_TAREFA`)
- **Teste:** `test/application/use-cases/sessions/get-session-pending-work.use-case.spec.ts` (`aberta na execução em curso`, `in_review`, `tudo done`).
- **Origem:** AT-919 (EP-036); rodada 372, lane L1.

<a id="rn-1148"></a>

### RN-1148 — Sem grafo configurado, nenhuma linha de projeção do grafo entra na outbox {#rn-1148}

- **Regra:** A linha `graph_projection` só é gravada quando `grafoConfigurado()` (`resolverConfigNeo4j() !== null`). Com o grafo não configurado (sem `NEO4J_URI`, permitido só fora de produção), não há consumidor possível: a fila não cresce. Configurado e fora do ar continua gravando, e a linha fica para retry (RN-960). As linhas que já estavam pendentes são marcadas processadas de uma vez pelo projetor, que loga a contagem uma única vez. O grafo ligado depois se reconstrói pelo event log (RN-569).
- **Onde:** `src/infrastructure/graph/neo4j-config.ts` (`grafoConfigurado`), `src/application/use-cases/sessions/append-session-event.use-case.ts` (`execute`), `src/application/use-cases/sessions/transition-session.use-case.ts` (`execute`), `src/application/graph-projection/graph-projector.ts` (`drainOnce`), `src/infrastructure/persistence/drizzle/outbox.repository.ts` (`markAllProcessed`)
- **Teste:** `test/infrastructure/graph/neo4j-config.spec.ts` (`grafoConfigurado`), `test/application/use-cases/sessions/append-session-event.use-case.spec.ts` (grafo não configurado não grava), `test/application/use-cases/sessions/transition-session.use-case.spec.ts` (fechamento não configurado não grava), `test/application/graph-projection/graph-projector.spec.ts` (`RN-1148`: descarte de uma vez e um log só).
- **Origem:** AT-925 (EP-036); rodada 373, lane L4.

<a id="rn-1149"></a>

### RN-1149 — A fila da outbox aparece no `/metrics`, e a queda do grafo avisa uma vez {#rn-1149}

- **Regra:** O gauge `brabo_outbox_pending{aggregate_type}` publica as linhas não processadas da `outbox_events`, por tipo de agregado, atualizado pelo `DomainGaugesCollector` com `reset()` antes de reescrever. O `/health` não muda: ele não expõe fila nem topologia. Com o grafo configurado e fora do ar, o projetor avisa uma vez (`warn`) por indisponibilidade, e o aviso só volta depois de um ciclo completo sem queda; antes, o aviso repetia a cada 2 s.
- **Onde:** `src/infrastructure/observability/brabo-metrics.ts` (`outboxPending`), `src/infrastructure/observability/domain-gauges.collector.ts` (`collectOutboxPending`), `src/application/graph-projection/graph-projector.ts` (`drainOnce`, `indisponivelAvisado`)
- **Teste:** `test/application/graph-projection/graph-projector.spec.ts` (`RN-1149`: três ciclos com o grafo fora do ar geram um aviso só).
- **Origem:** AT-925 (EP-036); rodada 373, lane L4.

A api cumpre a RN-1039 (o token do GitHub Packages nunca entra em camada nem em `ARG`/`ENV`; só como secret do BuildKit), definida no [brabo-broker](https://github.com/viralabs-dev/brabo-broker/blob/dev/docs/business-rules/broker.md). Quem prova na api é `test/dockerfile-sem-token.spec.ts:13` (todo `pnpm install` do `Dockerfile` monta o secret, nenhum `ARG`/`ENV` com token, `.npmrc` só com o registry).

<a id="rn-1155"></a>

### RN-1155 — O teto por tarefa é do projeto, editável pelo PATCH, e chega aos agentes vivos {#rn-1155}

- **Regra:** `PATCH /projects/:projectId` aceita `taskBudgetMicros` (inteiro positivo, micro-USD). Ao mudar o teto, a api chama o engine em `POST /internal/projects/:projectId/execution/task-budget` (RN-1090 do engine); vale a partir da próxima volta de cada tarefa. Se o engine falhar, a mudança do projeto NÃO é desfeita e a falha vira log (`teto_nao_propagado`).
- **Onde:** `src/application/use-cases/iam/update-project.use-case.ts` (`UpdateProjectUseCase.execute`), `src/infrastructure/http-clients/api-to-engine-client.ts` (`setTaskBudget`), `src/interfaces/http/iam/dto/create-project.dto.ts` (`taskBudgetMicros`).
- **Teste:** `test/application/use-cases/iam/update-project-teto.use-case.spec.ts`, `test/infrastructure/http-clients/api-to-engine-client.spec.ts` (`RN-1155`).
- **Origem:** AT-917 (EP-036), rodada 372, lane L2.

<a id="rn-1156"></a>

### RN-1156 — Depois de 2 bloqueios por limite de iterações na mesma tarefa, o agente sobe um degrau da escada do projeto {#rn-1156}

- **Regra:** a escada é `projects.model_escalation` (`{ ladder: [{ modelId, taskBudgetMicros }] }`, do menor ao maior; nulo usa o padrão Haiku 5.5 → Sonnet 5, tetos US$ 0,50 e US$ 2,00, FIXOS por degrau). No 2º `backlog.task_blocked` por limite de iterações (origem `modelo`) da mesma tarefa, a api troca o `agent-binding` do dono da tarefa para o degrau seguinte, aplica o teto do degrau (RN-1155), emite `agent.model_escalated { agentId, taskId, de, para, tetoMicros }` e desbloqueia a tarefa sozinha (`UnblockTaskUseCase`, ator `system`). O engine não muda: o binding é resolvido pela api a cada `llm-turn`.
- **Onde:** `src/application/use-cases/execution/escalar-modelo-da-tarefa.use-case.ts` (`aoBloquearPorLimite`), chamado por `mark-task-blocked.use-case.ts` (`MarkTaskBlockedUseCase.execute`) FORA da transação; `src/domain/execution/escada-de-modelos.ts`.
- **Teste:** `test/application/use-cases/execution/escalar-modelo-da-tarefa.use-case.spec.ts`.

<a id="rn-1157"></a>

### RN-1157 — O agente volta ao modelo base quando a tarefa fecha {#rn-1157}

- **Regra:** `task_model_escalations` guarda por tarefa o contador de bloqueios e a base (o binding próprio anterior, ou nenhum). Ao fechar a tarefa (merge da PR), `restaurar` devolve o binding base (ou o remove, voltando a herdar) e reaplica o teto do projeto; a linha some.
- **Onde:** `escalar-modelo-da-tarefa.use-case.ts` (`restaurar`), chamado por `execute-git-action.use-case.ts` ao fechar as tarefas da PR; `src/db/schema/backlog.ts` (`taskModelEscalations`).
- **Teste:** `escalar-modelo-da-tarefa.use-case.spec.ts` (tarefa fechada volta ao base).

<a id="rn-1158"></a>

### RN-1158 — Escada esgotada: a tarefa fica bloqueada para o dono {#rn-1158}

- **Regra:** no último degrau (ou com o modelo atual fora da escada) a api não escala nem desbloqueia. No último degrau grava `agent.model_escalation_exhausted` ("escada esgotada"). Falha da escalada nunca desfaz o bloqueio; falha do engine nunca desfaz a escalada.
- **Onde:** `escalar-modelo-da-tarefa.use-case.ts`.
- **Teste:** `escalar-modelo-da-tarefa.use-case.spec.ts` (último degrau, falha do engine).

<a id="rn-1159"></a>

### RN-1159 — A escada é configurável por projeto pelo PATCH {#rn-1159}

- **Regra:** `PATCH /projects/:projectId` aceita `modelEscalation` (`ladder` com ao menos 1 degrau, `modelId` e `taskBudgetMicros` positivo); a resposta do projeto o devolve (`null` = padrão). Contrato para o web: `ProjectResponseDto.modelEscalation`.
- **Onde:** `create-project.dto.ts` (`EscadaDeModelosDto`), `iam.response.dto.ts`.
- **Teste:** coberto pelo `openapi.json` versionado (`pnpm openapi:export` sem diff).
- **Nota:** o teto do degrau vale para o PROJETO inteiro (o endpoint do engine é por projeto) enquanto a tarefa escalada não fecha; RN-1146 reservada.
