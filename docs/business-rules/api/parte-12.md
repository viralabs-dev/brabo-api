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
- **Onde:** `apps/api/src/infrastructure/graph/graph-store.ts:51` (`CONSTRAINTS`), `apps/api/src/infrastructure/graph/graph-store.ts:165` (`bootstrapConstraints`), `apps/api/src/infrastructure/graph/graph-dedup.ts:34` (`deduplicarNos`).
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
- **Onde:** `src/application/use-cases/backlog/corrigir-historia.use-case.ts:103` (`editarTarefa`), `src/domain/backlog/correcao-de-historia.ts:82` (`recusaDeCorrecaoDeTarefa`), `src/interfaces/http/internal/internal-sessions.controller.ts:623` (`updateTaskRoute`)
- **Teste:** `test/application/use-cases/backlog/corrigir-historia.use-case.spec.ts` (`CorrigirHistoriaUseCase.editarTarefa`: feliz com evento; `in_progress`/`in_review`/`done` recusadas; história `ready` com e sem resposta; arquivada; 404 e 400).
- **Origem:** AT-805 (EP-030), achado 5 do TP-01 27ª; rodada 271, lane L2.

<a id="rn-1069"></a>

### RN-1069 — A ADR proposta declara qual ADR substitui (`supersedes`), e a api confere {#rn-1069}

- **Regra:** o payload de `open_adr_pr` aceita `supersedes` (slug da ADR substituída; `docs/adr/<slug>.md` também vale). Ao propor, a api exige uma `open_adr_pr` DESTE projeto com esse slug e já aceita (`executed`: aprovada, com a PR aberta ou mergeada); inexistente, de outro projeto, pendente, negada, com falha ou a própria ADR nova é 400 `adr_supersedes_invalido`, sem criar a proposta. A PR da ADR nova ganha a linha `Substitui: docs/adr/<slug>.md` no corpo. Sem `supersedes`, nada muda.
- **Onde:** `src/domain/actions/adr-supersedes.ts:22` (`recusaDeSupersedes`), `src/application/use-cases/actions/propose-action.use-case.ts:162` (chamada), `src/application/use-cases/actions/execute-adr-pr.use-case.ts` (corpo da PR)
- **Teste:** `test/domain/actions/adr-supersedes.spec.ts`, `test/application/use-cases/actions/propose-action.use-case.spec.ts` (`open_adr_pr com supersedes`, contra Postgres).
- **Origem:** AT-806 (EP-030), decisão do dono (b) de 08/11/2026; ADR 0283; rodada 271, lane L2.

<a id="rn-1301"></a>

### RN-1301 — O workspace escolhe quem roteia a ferramenta (`jev`, `laya` ou `desligado`), e `laya` só grava com o serviço proficiente na hora {#rn-1301}

- **Regra:** `workspaces.tool_router` (enum `jev` padrão, `laya`, `desligado`) substitui o liga/desliga da [RN-625](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-625); `tool_router_enabled` segue existindo como coluna GERADA (`tool_router <> 'desligado'`), então o DTO do workspace e quem lê o booleano não mudam, e o `false` de antes migrou para `desligado`. `PUT /workspaces/:workspaceId/tool-router` (`owner`) aceita `{roteador}` e, por compatibilidade, `{enabled}` (`true` = `jev`); sem nenhum, 400. `roteador: "laya"` consulta o `/health` do serviço SEM cache e só grava com `estado = proficiente`; senão 409 `roteador_local_indisponivel`, com o estado e o motivo no corpo, e nada é gravado. `GET /workspaces/:workspaceId/tool-router` (`viewer`) devolve `{roteador, laya: {estado, motivo, desde, dispositivo, vramLivreMiB, p95Ms}}`, com cache de 30 s e teto de 1 s; o turno do agente NUNCA passa por ele.
- **Estados do Laya (nunca colapsados):** `nao_configurado` (sem `TOOL_ROUTER_URL`), `sem_resposta` (rede, HTTP não 2xx ou corpo inválido), `sem_gpu` (dispositivo diferente de `cuda` ou VRAM livre abaixo de `TOOL_ROUTER_LAYA_VRAM_MIN_MIB`, padrão 2048), `lento` (p95 da sonda de boot acima de `TOOL_ROUTER_LAYA_P95_MAX_MS`, padrão 500, decisão do dono de 31/10/2026) e `proficiente`. `desde` só anda quando o estado muda.
- **Configuração:** `TOOL_ROUTER_URL` (base do serviço, rede interna, sem porta publicada), `TOOL_ROUTER_API_KEY` (opcional), `TOOL_ROUTER_LAYA_LIMIAR` (padrão 0,72), `TOOL_ROUTER_LAYA_P95_MAX_MS`, `TOOL_ROUTER_LAYA_VRAM_MIN_MIB`, `TOOL_ROUTER_LAYA_TIMEOUT_MS` (padrão 2000), `TOOL_ROUTER_LAYA_MODELO` e `TOOL_ROUTER_LAYA_MAX_LEN`. Os padrões são os do levantamento de 09/11/2026; VRAM e RAM do ensemble de 4 (RAM mínima do serviço de 6 GiB) saem da medição da AT-630 e entram trocando a variável.
- **Onde:** `src/db/schema/iam.ts` e `src/db/migrations/0084_laya_no_lugar_do_jev.sql` (`tool_router`), `src/application/use-cases/iam/set-workspace-tool-router.use-case.ts:27` (`execute`), `src/application/use-cases/iam/get-workspace-tool-router.use-case.ts:13` (`execute`), `src/infrastructure/llm/laya-status.ts:24` (`situacao`), `src/infrastructure/llm/laya-config.ts:8` (`configDoLaya`), `src/interfaces/http/iam/workspaces.controller.ts:296` (`getToolRouter`)
- **Teste:** `test/application/use-cases/iam/set-workspace-tool-router.use-case.spec.ts` (409 sem serviço proficiente, grava sem cache, `enabled` legado, 400) e `test/infrastructure/llm/laya-tool-router.spec.ts` (`LayaStatus`: os cinco estados, cache e `desde`).
- **Origem:** AT-626 (EP-026), decisões do dono de 31/10 e 07/11/2026; [ADR 0290](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0290-o-usuario-escolhe-o-laya-no-lugar-do-jev-quando-a-maquina-tem-gpu.md); rodada 354, lane L2.

<a id="rn-1302"></a>

### RN-1302 — Com o workspace em `laya`, todo provider é roteado por UMA chamada ao serviço local, e qualquer falha deixa o catálogo inteiro {#rn-1302}

- **Regra:** estende a [RN-625](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-625) e revisa o item 1 dela por ADR: com `tool_router = laya` o passo é roteado com QUALQUER provider e SEM credencial (o Laya é local e não cobra); com `jev` continua só com `openrouter` e chave. `LayaToolRouter` faz `POST {TOOL_ROUTER_URL}/v1/systemone` com o formato do Decisions API, SEM a opção reservada `responder_sem_ferramenta` (o Laya não a viu no treino), e o serviço devolve a distribuição já em média do ensemble. Regra p3 + limiar: confiança abaixo de `TOOL_ROUTER_LAYA_LIMIAR` vira `responder_sem_ferramenta`, que deixa o catálogo inteiro. O `tool_router.decided` grava `modelo = laya-multilingual`; não há linha em `token_usage`.
- **Queda:** timeout (2 s), rede, HTTP, corpo inválido, escolha fora das opções ou URL ausente voltam como queda NOMEADA e o passo segue com o catálogo inteiro (decisão do dono de 31/10/2026): NUNCA cai para o Jev, e o turno nunca falha por causa do Laya.
- **Onde:** `src/infrastructure/llm/laya-tool-router.ts:28` (`decidir`), `src/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.ts:123` (`preparar`), `src/infrastructure/llm/llm-infrastructure.module.ts:58` (`ToolRouterLocal`)
- **Teste:** `test/infrastructure/llm/laya-tool-router.spec.ts` (uma chamada sem a reservada, Bearer opcional, limiar, seis quedas nomeadas) e `test/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.spec.ts` (`workspace em laya`: qualquer provider sem chave, queda para o catálogo inteiro sem chamar o Jev, sem `token_usage`).
- **Origem:** AT-626 (EP-026), decisões do dono de 31/10 e 07/11/2026; ADR 0290; rodada 354, lane L2.

<a id="rn-1105"></a>

### RN-1105 — Cadastrar ou testar com sucesso uma credencial de LLM sincroniza o catálogo daquele provider {#rn-1105}

- **Regra:** Depois do `upsert` (ou de um teste `ok`), a api roda a sincronização só daquele provider. A falha da sincronização não desfaz o cadastro (ADR 0050) e fica no log com a origem. Modelo novo continua entrando inativo (RN-043).

- **Onde:** `src/application/use-cases/llm/sync-model-catalog.use-case.ts` (`executarProvider`), `upsert-user-credential.use-case.ts` (`execute`), `credentials/test-stored-credential.use-case.ts` (`execute`).
- **Teste:** `test/application/use-cases/llm/upsert-user-credential.use-case.spec.ts` e `test/application/use-cases/credentials/test-stored-credential.use-case.spec.ts`.
- **Origem:** AT-900 (EP-036), rodada 366, lane AA2.

<a id="rn-1106"></a>

### RN-1106 — O `claude-sonnet-5` tem o raciocínio reduzido no pedido de `reasoningOff` {#rn-1106}

- **Regra:** O mapa de `raciocinioDesligado` ganha `claude-sonnet-5` com `output_config.effort: low` e `pensaAinda: true`. A forma ainda NÃO foi provada por smoke pago (pendente, com aviso ao dono antes de usar a chave de teste).

- **Onde:** `src/infrastructure/llm/anthropic-provider.ts` (`raciocinioDesligado`).
- **Teste:** `test/domain/llm/raciocinio-do-agente.spec.ts`.
- **Origem:** AT-920 (EP-036), rodada 366, lane AA2.

<a id="rn-1107"></a>

### RN-1107 — A retentativa sem raciocínio vale também quando o raciocínio só foi reduzido {#rn-1107}

- **Regra:** `devoRetentarSemRaciocinio` não sai mais cedo por `reasoningOff`: se a resposta veio cortada, vazia e o raciocínio comeu o orçamento, retenta uma vez sem raciocínio.

- **Onde:** `src/domain/llm/raciocinio-do-agente.ts` (`devoRetentarSemRaciocinio`).
- **Teste:** `test/domain/llm/raciocinio-do-agente.spec.ts`.
- **Origem:** AT-920 (EP-036), rodada 366, lane AA2.

<a id="rn-1108"></a>

### RN-1108 — O índice RAG do projeto inclui `.brabo/memoria/`, e o merge na trunk o reindexa sozinho {#rn-1108}

- **Regra:** além de `docs/` e `docs/adr/`, a indexação varre `.brabo/memoria/**/*.md` do repositório do PRÓPRIO projeto (a memória em markdown da AT-923). Os chunks entram no escopo `docs`, sem migração; o caminho (`.brabo/memoria/...`) os distingue, e a cobertura os conta junto. Cada `project.trunk_merged` na outbox dispara a mesma reindexação de `docs`/`adr` (`IndexProjectDocsUseCase`) do botão "Reindexar agora", sem as sessões. Falha na reindexação só loga: não desfaz nem atrasa o merge, que já aconteceu. Mesma ideia da [RN-455](parte-05.md#rn-455): o índice cobre fontes que o servidor consegue revisitar.
- **Como lê:** quem drena `project.trunk_merged` é o engine (`TrunkMergedWorker`), que marca a linha como processada; por isso o consumidor da api só LÊ a outbox (`listByEventTypeAfter`) e guarda a própria marca d'água, em memória, iniciada no boot. Um merge com a api fora do ar só é reindexado no próximo merge ou pelo botão.
- **Onde:** `src/application/use-cases/rag/index-project-docs.use-case.ts` (`MEMORIA_ROOT`), `src/application/rag-reindex/trunk-merged-reindexer.ts` (`TrunkMergedReindexer`), `src/infrastructure/persistence/drizzle/outbox.repository.ts` (`listByEventTypeAfter`)
- **Teste:** `test/application/use-cases/rag/index-project-docs.use-case.spec.ts` (`RN-1108`) e `test/application/rag-reindex/trunk-merged-reindexer.spec.ts` (um projeto por ciclo, sem `markProcessed`, marca d'água, falha só loga).
- **Origem:** AT-923 (EP-036), lane A3 da rodada 371; ADR 0293 (a memória do projeto é markdown versionado; o RAG e o grafo são índices).

<a id="rn-1101"></a>

### RN-1101 — A ativação da execução recusa o projeto sem container `running`, salvo o dev Noop {#rn-1101}

- **Regra:** `POST /projects/:projectId/execution/activate` responde 409 `execucao_sem_container` quando o container registrado do projeto não está `running`, depois da guarda do repositório ([RN-582](parte-07.md#rn-582)) e antes de qualquer efeito. Sem isso cada dev bloqueava em `dev.blocked_by_container` ([RN-502](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-502)) no mesmo segundo, sem aviso. A frase diz o próximo passo: aprovar a subida proposta pela Infra, ou pedi-la. O dev `noop` (`devAgentImpl: 'noop'`) é isento, como no engine.
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

<a id="rn-1124"></a>

### RN-1124 — O Desbloquear aceita uma orientação opcional que vai ao dev {#rn-1124}

- **Regra:** `POST /projects/:projectId/sessions/:sessionId/tasks/:taskId/unblock` aceita o corpo opcional `{ orientacao }` (texto, até 2000 caracteres, 400 acima). A orientação aparada é gravada em `backlog.task_unblocked` e o dev-context da tarefa devolve `desbloqueio: { orientacao, em }` (o último com orientação), que o dev segue acima do último parecer. Sem corpo, nada muda.
- **Onde:** `src/application/use-cases/execution/unblock-task.use-case.ts:24` (`execute`), `src/interfaces/http/execution/dto/unblock-task.dto.ts` (`UnblockTaskDto`)
- **Teste:** `test/application/use-cases/execution/unblock-task.use-case.spec.ts` (RN-1124); `test/interfaces/http/execution/orientacao-e-melhorias.dto.spec.ts`
- **Origem:** AT-909 (EP-036); rodada 368, lane api.

<a id="rn-1125"></a>

### RN-1125 — O bloqueio por ciclo esgotado grava os itens do parecer no diagnóstico {#rn-1125}

- **Regra:** O diagnóstico de `backlog.task_blocked` por teto de correção passa a ser o `resumo` seguido dos `itens` (um por linha), e não só o resumo.
- **Onde:** `src/application/use-cases/execution/record-gate-verdict.use-case.ts:208` (`execute`, ramo `blocked`)
- **Teste:** `test/application/use-cases/execution/record-gate-verdict.use-case.spec.ts` (estourando o teto)
- **Origem:** AT-909 (EP-036); rodada 368, lane api.

<a id="rn-1126"></a>

### RN-1126 — `melhorias` do parecer não reprovam, não contam correção e vão à PR e ao evento {#rn-1126}

- **Regra:** `POST /internal/sessions/:sessionId/gates/verdict` aceita `melhorias: [string]` opcional (o `forbidNonWhitelisted` não a recusa). Elas não entram em `nextGateStatus` (só o `veredito` conta), aparecem no comentário da PR na seção "Melhorias (não bloqueiam)" e em `pr.gate_changed`.
- **Onde:** `src/application/use-cases/execution/record-gate-verdict.use-case.ts:45` (`melhorias`), `src/interfaces/http/internal/dto/record-gate-verdict-internal.dto.ts` (`melhorias`)
- **Teste:** `test/application/use-cases/execution/record-gate-verdict.use-case.spec.ts` (RN-1126); `test/interfaces/http/execution/orientacao-e-melhorias.dto.spec.ts` (verdict com `melhorias` aceito)
- **Origem:** AT-905 (EP-036); formato do evento `artifact.qa_verdict` da engine#87.

<a id="rn-1127"></a>

### RN-1127 — O Dev Lead e o dev leem o último parecer de gate da tarefa {#rn-1127}

- **Regra:** O dev-context da tarefa devolve `ultimoParecer: { gate, veredito, resumo, itens, melhorias }`, do `artifact.qa_verdict` ou `artifact.secops_verdict` mais recente da tarefa no PROJETO (o desbloqueio e o parecer moram em sessões diferentes); `null` sem parecer.
- **Onde:** `src/application/use-cases/execution/get-dev-task-context.use-case.ts:378` (`execute`)
- **Teste:** `test/application/use-cases/execution/get-dev-task-context.use-case.spec.ts` (RN-1124/1125/1127)
- **Origem:** AT-909 (EP-036).

<a id="rn-1128"></a>

### RN-1128 — O `update_task` interno aceita o Arquiteto como autor {#rn-1128}

- **Regra:** `update_task` interno aceita `agentId: "arquiteto"` e grava esse ator no evento, em vez de cair em `po`.
- **Onde:** `src/interfaces/http/internal/dto/create-story-internal.dto.ts` (`UpdateTaskInternalDto`), `src/application/use-cases/backlog/corrigir-historia.use-case.ts:20` (`AtorDaCorrecao`)
- **Teste:** `test/interfaces/http/execution/orientacao-e-melhorias.dto.spec.ts` (RN-1128)
- **Origem:** AT-918 (EP-036); engine#83.

<a id="rn-1129"></a>

### RN-1129 — `search_workspace` está no piso do menu do Arquiteto {#rn-1129}

- **Regra:** O recorte do Jev nunca tira `search_workspace` do Arquiteto (RN-758): ele lê o código mergeado antes de declarar contrato.
- **Onde:** `src/domain/llm/tool-router.ts:317` (`PISO_DO_MENU`)
- **Teste:** `test/interfaces/http/execution/orientacao-e-melhorias.dto.spec.ts` (RN-1129)
- **Origem:** AT-918 (EP-036).

<a id="rn-1138"></a>

### RN-1138 — A tarefa criada pelo Dev Lead é a FUNDAÇÃO do módulo {#rn-1138}

- **Regra:** `create_task` com `agentRole: dev_lead` grava `tasks.fundacao = true` (migração 0087); a do PO nasce `false`. **AT-985:** só é fundação quando é a primeira tarefa não arquivada do módulo (módulo sem tarefa); a correção do Dev Lead num módulo que já tem tarefa nasce `false`, salvo `fundacao: true` explícito no `CreateTaskInput`. A coluna aparece em `TaskResponseDto.fundacao`.
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

<a id="rn-1163"></a>

### RN-1163 — Todo merge na branch de trabalho projeta no grafo a memória do projeto daquele commit {#rn-1163}

- **Regra:** O merge na branch de trabalho (`project.trunk_merged`) grava uma SEGUNDA linha de outbox `graph_projection`, na mesma transação e só com o grafo configurado (RN-1148), com o mesmo payload (`projectId`, `sessionId`, `mergedSha`). O projetor lê `.brabo/memoria/modulos/*.md` e `.brabo/memoria/decisoes.md` na `mergedSha` (pela leitura de código do projeto, com a credencial do owner) e grava, por `MERGE` em chave natural: `(:Projeto)-[:TEM_MODULO]->(:Modulo {projectId, nome, stack, commit})`, `(:Modulo)-[:DEPENDE_DE]->(:Modulo)`, `(:Modulo)-[:EXPOE]->(:Interface {projectId, modulo, assinatura, tipo})`, `(:Modulo)-[:TEM_CONTRATO]->(:Contrato {projectId, modulo, versao})` (versão lida do BANCO, nunca do texto do cartão) e `(:Decisao {projectId, id, titulo})-[:CITA]->(:Modulo)`. A projeção converge para a `main`: dependência, interface, contrato, decisão e módulo que saíram do cartão saem do grafo, e repetir o mesmo merge não muda nada. Constraints compostas (`IF NOT EXISTS`): `modulo_projeto_nome_unico`, `interface_unica`, `contrato_unico`, `decisao_unica`.
- **Formato lido (engine, `MemoriaExtrator`):** front-matter `modulo`, `stack`, `depende_de: [a, b]`, `commit`, e a seção `## Expõe` (`- \`nome\` (tipo)`). `decisoes.md` não tem formato fixado em código: a projeção lê uma linha por ADR (`- ADR 0123 — título`) e considera que ela cita o módulo cujo nome aparece na linha.
- **Onde:** `src/application/use-cases/actions/execute-git-action.use-case.ts` (`settleMerge`), `src/domain/graph/graph-projection-events.ts` (`MERGES_PROJETAVEIS`), `src/application/graph-projection/graph-projector.ts` (`project`), `src/application/graph-projection/memoria-do-projeto-translator.ts` (`MemoriaDoProjetoTranslator.projetar`, `interpretarCartao`, `interpretarDecisoes`), `src/infrastructure/graph/graph-store.ts` (`CONSTRAINTS`)
- **Teste:** `test/application/graph-projection/memoria-do-projeto-translator.spec.ts`, `test/application/graph-projection/graph-projector.spec.ts` (`merge na branch de trabalho`), `test/application/use-cases/actions/execute-git-action.use-case.spec.ts` (linha `graph_projection` só com o grafo configurado).
- **Origem:** AT-924 (EP-036); rodada 373, lane G1.

<a id="rn-1164"></a>

### RN-1164 — A memória ausente não é falha, o cartão malformado é pulado e o grafo fora do ar mantém a linha {#rn-1164}

- **Regra:** Projeto sem `.brabo/memoria/` faz merge sem erro e sem nó (não há pasta nem `decisoes.md`: nada é gravado nem apagado). Cartão sem front-matter ou sem `modulo` é logado e pulado, sem travar os outros. Falha de leitura do git que não seja "não encontrado" (credencial, limite de taxa) e `GraphUnavailableError` mantêm a linha da outbox para retry (RN-1149).
- **Onde:** `src/application/graph-projection/memoria-do-projeto-translator.ts` (`projetar`, `listarCartoes`, `lerOuNulo`), `src/application/graph-projection/graph-projector.ts` (`drainOnce`)
- **Teste:** `test/application/graph-projection/memoria-do-projeto-translator.spec.ts` (pasta ausente, cartão malformado, erro de leitura propaga), `test/application/graph-projection/graph-projector.spec.ts` (grafo indisponível mantém a linha).
- **Origem:** AT-924 (EP-036); rodada 373, lane G1.

<a id="rn-1165"></a>

### RN-1165 — A reconstrução do grafo também reprojeta a memória de cada projeto {#rn-1165}

- **Regra:** `grafo:reprojetar` (RN-569) ganha a fase 3: para cada projeto com repositório (ou só o de `--project`), enfileira uma linha `graph_projection` `project.trunk_merged` sem `mergedSha`, que o projetor vivo drena lendo a ponta da `main`. A leitura do git precisa do contexto da api (credencial, cache), por isso o script não lê o repositório sozinho: com a api de pé, os módulos voltam em alguns ciclos do projetor. É a única escrita do script na outbox.
- **Onde:** `src/scripts/reprojetar-grafo.ts` (`reprojetarGrafo`, fase 3)
- **Teste:** `test/scripts/reprojetar-grafo.spec.ts` (o resultado carrega `memoriasEnfileiradas`).
- **Origem:** AT-924 (EP-036); rodada 373, lane G1.

<a id="rn-1166"></a>

### RN-1166 — A consulta de impacto de um módulo responde pelo grafo, e 503 com o grafo desligado {#rn-1166}

- **Regra:** `GET /internal/graph/projects/:projectId/modules/:nome/impacto` (service token do engine) devolve `{ projectId, modulo, stack, commit, contratoVersao, dependentes, dependeDe, expoe: [{assinatura, tipo}], decisoes: [{id, titulo}] }`: quem depende do módulo, de quem ele depende, o que expõe, que decisões o citam e a versão do contrato gravada na projeção (do banco; `null` sem contrato declarado). Leitura contida: escopo no projeto, chave natural, sem parâmetro livre. Módulo sem nó é 404; grafo desligado ou fora do ar é 503 (`GraphUnavailableError`), nunca uma lista vazia que pareça verdade.
- **Onde:** `src/interfaces/http/internal/internal-graph.controller.ts` (`impactoDoModulo`), `src/application/use-cases/graph/consultar-impacto-do-modulo.use-case.ts` (`ConsultarImpactoDoModuloUseCase.execute`), `src/interfaces/http/internal/dto/graph.response.dto.ts` (`ImpactoDoModuloResponseDto`)
- **Teste:** `test/interfaces/http/internal/internal-graph.controller.spec.ts` (delega com projeto e módulo). A consulta contra Neo4j real fica fora do CI da api (sem Neo4j no job).
- **Origem:** AT-924 (EP-036); rodada 373, lane G1.

A api cumpre a RN-1039 (o token do GitHub Packages nunca entra em camada nem em `ARG`/`ENV`; só como secret do BuildKit), definida no [brabo-broker](https://github.com/viralabs-dev/brabo-broker/blob/dev/docs/business-rules/broker.md). Quem prova na api é `test/dockerfile-sem-token.spec.ts:13` (todo `pnpm install` do `Dockerfile` monta o secret, nenhum `ARG`/`ENV` com token, `.npmrc` só com o registry).

<a id="rn-1150"></a>

### RN-1150 — O `usage` do turno de LLM devolve `reasoningTokens` quando o provider os contou {#rn-1150}

- **Regra:** `LlmUsageResponseDto.reasoningTokens` é opcional e vem do mesmo valor que o `token_usage.reasoning_tokens` grava ([RN-666](parte-08.md#rn-666)). Provider que não contou: o campo some, nunca vira `0` (a tela mostra traço).
- **Código:** `apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts:124` (`execute`), `apps/api/src/application/use-cases/llm/stream-llm-turn.use-case.ts:133` (`execute`), `src/interfaces/http/internal/dto/internal.response.dto.ts:723` (`LlmUsageResponseDto`)
- **Teste:** `apps/api/test/application/use-cases/llm/run-llm-turn.use-case.spec.ts` (presente com 120, ausente sem contagem)
- **Origem:** AT-929 (EP-035).

<a id="rn-1151"></a>

### RN-1151 — A lista de sessões do projeto traz custo, chamadas, agentes e passos {#rn-1151}

- **Regra:** `GET /projects/:projectId/sessions` ganha, por item, `costMicros`, `chamadas`, `agentes[]` (ids com gasto de `actor_kind = 'agent'`) e `passos` (eventos `tool.call`); sessão sem uso devolve zeros e lista vazia. Duas queries agregadas por projeto, sem N+1. O uso por agente da sessão (`GET .../token-usage`) ganha `chamadas`.
- **Código:** `apps/api/src/infrastructure/persistence/drizzle/session.repository.ts:49` (`usoPorSessaoDoProjeto`), `apps/api/src/application/use-cases/sessions/list-sessions-for-project.use-case.ts:37` (`execute`)
- **Teste:** `apps/api/test/application/use-cases/sessions/list-sessions-for-project.use-case.spec.ts` (soma, agentes, passos e sessão sem uso)
- **Origem:** AT-930 (EP-035).

<a id="rn-1152"></a>

### RN-1152 — O gasto do projeto para o membro vem quebrado por modelo e por sessão, nunca por provider {#rn-1152}

- **Regra:** `GET /projects/:projectId/spend/team` ganha `porModelo` e `porSessao` (mesmas linhas de `porAgente`). Modelo não é credencial; o eixo `provider` segue só do owner ([RN-186](parte-03.md#rn-186)/[RN-187](parte-03.md#rn-187)).
- **Código:** `apps/api/src/application/use-cases/llm/get-project-spend-team.use-case.ts:39` (`execute`)
- **Teste:** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts` (o membro vê total e custo por agente/área; sem `provider` no JSON)
- **Origem:** AT-931 (EP-035).

<a id="rn-1153"></a>

### RN-1153 — O gasto do projeto traz a série por dia e por agente, esparsa {#rn-1153}

- **Regra:** `porDiaEAgente` em `spend/team` e em `GET /workspaces/:wid/spend-report` (owner, também com `?projectId=`): `{ dia (UTC), agente, costMicros, chamadas }`, só `actor_kind = 'agent'` e só dias com chamada, em ordem de dia; o cliente densifica.
- **Código:** `apps/api/src/infrastructure/persistence/drizzle/token-usage.repository.ts:243` (`sumByDayAndAgent`)
- **Teste:** `apps/api/test/application/use-cases/llm/spend-audiencias.use-case.spec.ts` (só o agente, só o projeto; o owner também, com e sem `projectId`)
- **Origem:** AT-931, AT-896 (EP-035).

<a id="rn-1154"></a>

### RN-1154 — As ações do projeto listam as decididas recentes, com o motivo {#rn-1154}

- **Regra:** `GET /projects/:projectId/actions?status=decided&since=<ISO>` devolve o que deixou de ser `pending` (aprovadas, negadas com `rejectionReason`, `auto_approved`, executadas, falhas) mudado desde `since` (padrão 24 h), mais recentes primeiro, teto 100, `actionType` opcional; `since` inválido é 400. A recência é `updated_at` (`decided_at` é nulo nas automáticas).
- **Código:** `apps/api/src/infrastructure/persistence/drizzle/proposed-action.repository.ts:187` (`listDecidedByProject`), `apps/api/src/application/use-cases/actions/list-project-pending-actions.use-case.ts:22` (`execute`), `apps/api/src/interfaces/http/actions/project-actions.controller.ts:60` (`list`)
- **Teste:** `apps/api/test/application/use-cases/actions/list-project-pending-actions.use-case.spec.ts` (negada com motivo e automática entram; pendente e velha não)
- **Origem:** AT-932 (EP-035).

<a id="rn-1142"></a>

### RN-1142 — O teto por tarefa é do projeto, editável pelo PATCH, e chega aos agentes vivos {#rn-1142}

- **Regra:** `PATCH /projects/:projectId` aceita `taskBudgetMicros` (inteiro positivo, micro-USD). Ao mudar o teto, a api chama o engine em `POST /internal/projects/:projectId/execution/task-budget` (RN-1090 do engine); vale a partir da próxima volta de cada tarefa. Se o engine falhar, a mudança do projeto NÃO é desfeita e a falha vira log (`teto_nao_propagado`).
- **Onde:** `src/application/use-cases/iam/update-project.use-case.ts` (`UpdateProjectUseCase.execute`), `src/infrastructure/http-clients/api-to-engine-client.ts` (`setTaskBudget`), `src/interfaces/http/iam/dto/create-project.dto.ts` (`taskBudgetMicros`).
- **Teste:** `test/application/use-cases/iam/update-project-teto.use-case.spec.ts`, `test/infrastructure/http-clients/api-to-engine-client.spec.ts` (`RN-1142`).
- **Origem:** AT-917 (EP-036), rodada 372, lane L2.

<a id="rn-1143"></a>

### RN-1143 — Depois de 2 bloqueios por limite de iterações na mesma tarefa, o agente sobe um degrau da escada do projeto {#rn-1143}

- **Regra:** a escada é `projects.model_escalation` (`{ ladder: [{ modelId, taskBudgetMicros }] }`, do menor ao maior; nulo usa o padrão Haiku 5.5 → Sonnet 5, tetos US$ 0,50 e US$ 2,00, FIXOS por degrau). No 2º `backlog.task_blocked` por limite de iterações (origem `modelo`) da mesma tarefa, a api troca o `agent-binding` do dono da tarefa para o degrau seguinte, aplica o teto do degrau (RN-1142), emite `agent.model_escalated { agentId, taskId, de, para, tetoMicros }` e desbloqueia a tarefa sozinha (`UnblockTaskUseCase`, ator `system`). O engine não muda: o binding é resolvido pela api a cada `llm-turn`.
- **Onde:** `src/application/use-cases/execution/escalar-modelo-da-tarefa.use-case.ts` (`aoBloquearPorLimite`), chamado por `mark-task-blocked.use-case.ts` (`MarkTaskBlockedUseCase.execute`) FORA da transação; `src/domain/execution/escada-de-modelos.ts`.
- **Teste:** `test/application/use-cases/execution/escalar-modelo-da-tarefa.use-case.spec.ts`.

<a id="rn-1144"></a>

### RN-1144 — O agente volta ao modelo base quando a tarefa fecha {#rn-1144}

- **Regra:** `task_model_escalations` guarda por tarefa o contador de bloqueios e a base (o binding próprio anterior, ou nenhum). Ao fechar a tarefa (merge da PR), `restaurar` devolve o binding base (ou o remove, voltando a herdar) e reaplica o teto do projeto; a linha some.
- **Onde:** `escalar-modelo-da-tarefa.use-case.ts` (`restaurar`), chamado por `execute-git-action.use-case.ts` ao fechar as tarefas da PR; `src/db/schema/backlog.ts` (`taskModelEscalations`).
- **Teste:** `escalar-modelo-da-tarefa.use-case.spec.ts` (tarefa fechada volta ao base).

<a id="rn-1145"></a>

### RN-1145 — Escada esgotada: a tarefa fica bloqueada para o dono {#rn-1145}

- **Regra:** no último degrau (ou com o modelo atual fora da escada) a api não escala nem desbloqueia. No último degrau grava `agent.model_escalation_exhausted` ("escada esgotada"). Falha da escalada nunca desfaz o bloqueio; falha do engine nunca desfaz a escalada.
- **Onde:** `escalar-modelo-da-tarefa.use-case.ts`.
- **Teste:** `escalar-modelo-da-tarefa.use-case.spec.ts` (último degrau, falha do engine).

<a id="rn-1146"></a>

### RN-1146 — A escada é configurável por projeto pelo PATCH {#rn-1146}

- **Regra:** `PATCH /projects/:projectId` aceita `modelEscalation` (`ladder` com ao menos 1 degrau, `modelId` e `taskBudgetMicros` positivo); a resposta do projeto o devolve (`null` = padrão). Contrato para o web: `ProjectResponseDto.modelEscalation`.
- **Onde:** `create-project.dto.ts` (`EscadaDeModelosDto`), `iam.response.dto.ts`.
- **Teste:** coberto pelo `openapi.json` versionado (`pnpm openapi:export` sem diff).
- **Nota:** o teto do degrau vale para o PROJETO inteiro (o endpoint do engine é por projeto) enquanto a tarefa escalada não fecha; RN-1146 reservada.

<a id="rn-1168"></a>

### RN-1168 — O teto de gasto do projeto é mensal, em UTC, e zera sem tarefa agendada {#rn-1168}

- **Regra:** o teto de projeto (e o de workspace, RN-1170, e o de área, RN-1169) conta o gasto do MÊS CIVIL EM UTC (ADR 0296). `budgets.periodo_inicio` guarda o 1º dia do mês a que `spent_micros` se refere; a virada é preguiçosa: a leitura de um período vencido devolve gasto 0 e limiar 0, e o `incrementSpent` do mês novo recomeça de `spent = delta`, `last_threshold_notified = 0`, numa só instrução. A chamada conta no mês em que é REGISTRADA. Os avisos 70/90/100 se rearmam a cada mês (revisa a RN-018) e `budget.threshold_crossed` ganha `periodo` (`YYYY-MM`). A tarefa já bloqueada pelo teto do mês NÃO retoma sozinha na virada: quem a retoma é o Desbloquear. A recusa diz "Budget do projeto atingiu o teto do mês" (o engine a classifica como `politica` pelo texto, sem mudança).
- **Onde:** `src/infrastructure/persistence/drizzle/budget.repository.ts:144` (`incrementSpent`), `:14` (`vigente`); `src/domain/llm/periodo-do-teto.ts:8` (`inicioDoMes`), `:15` (`gastoVigente`); `src/application/use-cases/llm/check-budget-gate.use-case.ts:28` (`execute`).
- **Teste:** `test/infrastructure/persistence/drizzle/teto-mensal.repository.spec.ts` (período vencido; mês corrente bloqueia).

<a id="rn-1169"></a>

### RN-1169 — Sessão continua acumulada, a área vira mensal, e a previsão de fim de mês é derivada {#rn-1169}

- **Regra:** só os tetos de projeto, de área e de workspace têm mês; o de SESSÃO continua acumulado (`periodo_inicio` nulo, imposto por `budgets_periodo_check`). O teto de área usa o mesmo mecanismo (`agent_areas.periodo_inicio`; revisa a RN-443). `GET projects/:id/budget` e as rotas do workspace devolvem `periodo { inicio, fim, diasRestantes, previsaoMicros }`; a previsão é linear (`gasto × duração do mês ÷ decorrido`, mínimo 1 dia), derivada na leitura e nunca gravada.
- **Onde:** `src/domain/llm/periodo-do-teto.ts:31` (`periodoDoTeto`); `src/infrastructure/persistence/drizzle/agent-area.repository.ts:151` (`incrementSpent`); `src/interfaces/http/llm/budgets.controller.ts:31` (`comPeriodo`).
- **Teste:** `teto-mensal.repository.spec.ts` (sessão nunca zera; área vencida; previsão pura).

<a id="rn-1170"></a>

### RN-1170 — O workspace tem teto de gasto mensal, só do owner, independente dos demais {#rn-1170}

- **Regra:** `budgets` aceita um terceiro escopo, `workspace_id` (unique), e `budgets_scope_check` exige exatamente um escopo (revisa a RN-017). O teto soma toda chamada de LLM de todos os projetos do workspace, de qualquer ator. Os tetos de workspace, projeto, sessão e área são independentes: basta UM no limite, com `policy: block`, para recusar ("Budget do workspace atingiu o teto do mês"); nenhum herda nem limita o valor do outro, e `allow` só avisa. `GET`/`PUT workspaces/:workspaceId/budget` são `owner` (mesma régua da RN-060).
- **Onde:** `src/infrastructure/persistence/drizzle/budget.repository.ts:46` (`findForWorkspaceOfProject`), `:90` (`upsertForWorkspace`); `check-budget-gate.use-case.ts:28` (`execute`); `record-llm-usage.use-case.ts:136` (`applyToBudget`); `src/interfaces/http/llm/budgets.controller.ts:99` (`getWorkspaceBudget`), `:113` (`setWorkspaceBudget`).
- **Teste:** `teto-mensal.repository.spec.ts` (soma de projetos bloqueia; `allow`; dois escopos recusados); a superfície `owner` em `test/interfaces/route-surface.spec.ts`.

<a id="rn-1171"></a>

### RN-1171 — A migração 0089 recalcula o gasto do mês e o fuso do mês é UTC explícito {#rn-1171}

- **Regra:** a migração 0089 põe `periodo_inicio` do mês corrente nos tetos de projeto e de área e recalcula `spent_micros` como a soma de `token_usage` do mês (todos os atores no projeto; só `agent` na área, com o mapa ator → área congelado no SQL), e `last_threshold_notified` como o maior limiar já cruzado (sem reavisar). Sessão apagada leva o `token_usage` junto, então o recálculo pode ficar abaixo do real. O "gasto do workspace no mês" (RN-038) passa a usar `date_trunc` em UTC explícito, sem depender do `TimeZone` do servidor.
- **Onde:** `src/db/migrations/0089_teto_mensal_e_do_workspace.sql`; `src/infrastructure/persistence/drizzle/token-usage.repository.ts:233`.
- **Teste:** `teto-mensal.repository.spec.ts` (migração 0089: recálculo do mês).

<a id="rn-1195"></a>

### RN-1195 — A Caixa de decisões lê as cinco filas de todos os projetos numa leitura do workspace {#rn-1195}

- **Regra:** `GET /workspaces/:workspaceId/decision-inbox` (`viewer`, só leitura) devolve as cinco filas separadas, `aprovacoes` (pendentes EXCETO `git_merge`), `prs` (só `git_merge`, a mesma partição do painel do projeto), `promocoes`, `arquitetura` e `hipoteses` (do Psicólogo, análise não `superseded`; as perguntas abertas do ADR 0214 e o `platform_signal` ficam fora), mais `projetos[]` com os cinco números de cada projeto e os `agentesAguardando`. Arquivadas ficam fora (RN-727). A decisão em si segue nos endpoints de hoje e nenhum teto muda (ADR 0295).
- **Onde:** `src/interfaces/http/actions/decision-inbox.controller.ts:53` (`get`); `src/application/use-cases/actions/get-decision-inbox.use-case.ts:102` (`execute`).
- **Teste:** `test/application/use-cases/actions/get-decision-inbox.use-case.spec.ts` (separa as cinco filas, respeita arquivadas e `superseded`).

<a id="rn-1196"></a>

### RN-1196 — As filas da Caixa nunca se somam: nenhum total na raiz {#rn-1196}

- **Regra:** A resposta não tem `total` na raiz nem campo que some filas; cada fila traz o próprio `total` e `projetos[]` traz cinco números separados por projeto (RN-467).
- **Onde:** `src/application/use-cases/actions/get-decision-inbox.use-case.ts:96` (`GetDecisionInboxUseCase`); `src/interfaces/http/actions/dto/decision-inbox.response.dto.ts:118` (`DecisionInboxResponseDto`).
- **Teste:** `get-decision-inbox.use-case.spec.ts` (a raiz não tem `total`).

<a id="rn-1197"></a>

### RN-1197 — A Caixa tem teto por fila e diz o total real quando trunca {#rn-1197}

- **Regra:** Cada fila devolve até `TETO_DE_ITENS_POR_FILA` (50, ponto de partida a medir) itens, o `total` REAL e `truncada` (ADR 0060). Pendentes saem das mais antigas para as mais novas; decididas, das mais novas para as mais antigas. As contagens de `projetos[]` e `agentesAguardando` vêm do `GROUP BY`, nunca dos itens truncados.
- **Onde:** `src/application/use-cases/actions/get-decision-inbox.use-case.ts:10` (`TETO_DE_ITENS_POR_FILA`); `src/infrastructure/persistence/drizzle/decision-inbox.repository.ts:85` (`ler`).
- **Teste:** `get-decision-inbox.use-case.spec.ts` (60 pendências: 50 itens, total 60, `truncada`, mais antigas primeiro).

<a id="rn-1198"></a>

### RN-1198 — A Caixa lê com orçamento de consultas constante em N projetos {#rn-1198}

- **Regra:** O número de idas ao banco é o mesmo com 1 ou com 100 projetos: `inArray(project_id, ids)` + `GROUP BY`, sem laço sobre projetos (ADR 0060, molde da RN-090). O papel de projeto vem de UMA leitura de `project_members` do usuário no workspace. A arquitetura é derivada em memória das histórias não arquivadas, pela mesma função pura da aba do projeto (`derivarPendenciasDeArquitetura`), e a data dela é emprestada da história (`dataEmprestada`).
- **Onde:** `src/infrastructure/persistence/drizzle/decision-inbox.repository.ts:68` (`papeisDeProjeto`); `src/domain/architecture/pendencias-de-arquitetura.ts:23` (`derivarPendenciasDeArquitetura`).
- **Teste:** `get-decision-inbox.use-case.spec.ts` (o mesmo número de consultas com 1 e com 25 projetos).

<a id="rn-1199"></a>

### RN-1199 — A Caixa aplica o papel efetivo de cada projeto, com o papel de decidir como mínimo da fila, e lista também as decididas {#rn-1199}

- **Regra:** O papel por projeto é `papelEfetivo(projectRole, workspaceRole)` (RN-471, a mesma função pura de `ResolveEffectiveRoleUseCase.forProject`). O mínimo é o do endpoint de decidir (RN-102): `developer` em aprovações, PRs, promoções e hipóteses; `viewer` em arquitetura, que só se lê. Projeto abaixo do mínimo não contribui com a fila (nem item nem contagem); sem papel de workspace, 403. `?status=decided&since=` (padrão 24 h, o molde da RN-1154) lista o decidido: ações não pendentes, promoções recusadas, hipóteses decididas; a arquitetura não tem lado decidido e vem vazia. Promoção aceita não grava data própria e fica fora.
- **Onde:** `src/domain/iam/papel-efetivo.ts:9` (`papelEfetivo`); `src/application/use-cases/actions/get-decision-inbox.use-case.ts:18` (`PAPEL_MINIMO_POR_FILA`).
- **Teste:** `get-decision-inbox.use-case.spec.ts` (RN-471 nos dois sentidos; 403; modo `decided`).

<a id="rn-1304"></a>

### RN-1304 — A volta retentada por corte de saída pede o dobro do teto {#rn-1304}

- **Regra:** `llm-turn` e `llm-turn-stream` internos aceitam `saidaAmpliada` (booleano, opcional; outro tipo é 400). Com a flag, o provider recebe `maxTokens` = 8192, o dobro do padrão de 4096; sem ela nada muda. O engine liga a flag na volta retentada de uma resposta só de raciocínio cortada pelo teto (ajuste da RN-780).
- **Código:** `apps/api/src/application/use-cases/llm/run-llm-turn.use-case.ts:127` (`execute`), `apps/api/src/application/use-cases/llm/stream-llm-turn.use-case.ts:136` (`execute`), `apps/api/src/domain/llm/raciocinio-do-agente.ts:21` (`TETO_DE_SAIDA_AMPLIADO`)
- **Teste:** `apps/api/test/application/use-cases/llm/run-llm-turn.use-case.spec.ts` (a flag dobra o teto; sem ela, nada), `apps/api/test/interfaces/saida-ampliada-dto.spec.ts` (booleano aceito, outro tipo recusado)
- **Origem:** AT-920 (EP-036).

<a id="rn-1316"></a>

### RN-1316 — O merge automático: a chave do projeto, a exceção da trava e o gatilho {#rn-1316}

- **Regra:** `projects.merge_automatico` (padrão `true` no projeto NOVO desde a AT-987; o projeto anterior à migração 0091 mantém o valor que tinha) liga o merge automático da PR na **branch de trabalho** do projeto do usuário (a `main` dele, em trunk, [ADR 0263](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0263-o-projeto-do-usuario-trabalha-em-trunk.md); [ADR 0292](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0292-o-merge-automatico-e-opcao-do-projeto-desligada-por-padrao.md)). `PUT /projects/:projectId/auto-merge` (`{ habilitado }`): **ligar exige `owner`** do workspace (403 para `maintainer`), **desligar basta `maintainer`**; repetir o valor não muda nada e só mudança grava uma linha em `merge_automatico_eventos` (quem, quando, valor; só INSERT). O `PATCH` não aceita a chave. `decide()` ganha a ÚNICA exceção do teto da [RN-006](parte-01.md#rn-006)/[RN-670](parte-08.md#rn-670): `git_merge` auto-aprovado quando a chave está ligada **e** `origem === 'merge_automatico'` **e** `targetBranch` é a branch de trabalho. Chave ausente ou desligada devolve o veredito de sempre; `qa`/`rc`/`dev` e o merge de pessoa, agente, "sempre permitir" ou `permissions.json` seguem `require_approval`; `deny` vence; a chave de um projeto não vale para outro. `git_merge` continua fora de "sempre permitir" ([RN-675](parte-08.md#rn-675)). O gatilho é `POST /internal/projects/:projectId/tasks/:taskId/auto-merge` (service token, só o engine): confere, nesta ordem, chave ligada, todos os gates aprovados, PR aberta pela tarefa e a recusa de merge duplicado da [RN-663](parte-08.md#rn-663) (409 com `code` nomeado: `chave_desligada`, `gate_pendente`, `sem_pr`, `pr_ja_mergeado`, `merge_ja_proposto`), e propõe o `git_merge` como ator `system`. Desligar vale na proposta seguinte; proposta já executada não volta. Merge que falha no provider (conflito, proteção) termina `failed` e vira manual. A [RN-418](parte-04.md#rn-418) e o merge na `main` dos repositórios do próprio Brabo (do dono) não mudam.
- **Código:** `src/domain/actions/decide.ts` (`decide`, exceção `merge_automatico`); `src/application/use-cases/iam/set-project-auto-merge.use-case.ts:34` (`execute`); `src/application/use-cases/actions/acionar-merge-automatico.use-case.ts:38` (`execute`); `src/application/use-cases/actions/propose-action.use-case.ts` (`decidir`)
- **Teste:** `test/domain/actions/decide.spec.ts` (exceção e recusas); `test/application/use-cases/iam/set-project-auto-merge.use-case.spec.ts`; `test/application/use-cases/iam/create-project-semeia-areas.spec.ts` (nasce ligado, com a linha de nascença em `merge_automatico_eventos`); `test/application/use-cases/actions/acionar-merge-automatico.use-case.spec.ts`; `test/interfaces/http/iam/update-project-dto-merge-automatico.spec.ts`
- **Origem:** AT-902 (EP-036), decisão do dono de 12/11/2026; AT-987, decisão de 14/11/2026 (o merge automático nasce ligado no projeto novo; `CreateProjectUseCase` grava `habilitado: true` com o criador como ator; ligar continua `owner`, desligar `maintainer`).

<a id="rn-1328"></a>

### RN-1328 — A prova de compose do QA: sem prova, aprova com aviso {#rn-1328}

- **Regra:** `POST /internal/projects/:projectId/qa-environments/:taskId/compose` (service token, só o engine; `:taskId` aceita o id ou a chave de 8) pede ao broker `POST /containers/:id/qa/:chave/compose` ([ADR 0297](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0297-o-broker-prova-o-compose-do-projeto-num-ambiente-descartavel.md)): `docker compose up --build` do clone limpo, num projeto compose descartável, com teto de 10 min e 4 GB do lado do broker. A resposta é `{ veredito, aviso, motivo, chave, resultado }`: `provou` (subiu), `falhou` (o projeto: build quebrado, sonda fora de 2xx/3xx com o `subiu: true` do broker (AT-982; o motivo traz a sonda e o status), serviço que não sobe, `/docs` fora, compose recusado pela allowlist; vira item do parecer) ou `aprova_com_aviso` com `aviso: "sem prova de compose"` quando não deu para provar: `BROKER_URL` vazia, broker sem resposta ou acima do teto, 503/origem `infra`, 409 (prova viva ou `runner`), projeto `runner` ou resultado com origem `infra`. A falta de prova nunca é erro nem reprovação por infraestrutura (Q6, 12/11/2026). O teto da chamada é o do broker mais contexto, controle e margem (645 s), maior que o do broker; o `fetch` do Node corta os cabeçalhos em 300 s, então prova acima de 5 min cai no aviso (limite declarado, como na [RN-604](parte-07.md#rn-604)). A ação tipada de QA que o engine propõe (auto-aprovada, fora do teto da [RN-418](parte-04.md#rn-418)) fica para a lane do engine; aqui mora o ponto que ela chama.
- **Código:** `src/application/use-cases/containers/provar-compose-de-qa.use-case.ts:40` (`execute`); `src/infrastructure/http-clients/container-broker.client.ts` (`provaDeCompose`, `tetoDaOperacao`); `src/interfaces/http/internal/internal-qa-environments.controller.ts` (`provarCompose`)
- **Teste:** `test/application/use-cases/containers/provar-compose-de-qa.use-case.spec.ts` (provou, recusa do compose, 503, broker ausente, `runner`); `test/infrastructure/http-clients/container-broker.client.spec.ts` (rota, corpo vazio e teto)
- **Origem:** AT-922 (EP-036), decisões do dono de 12/11/2026.

<a id="rn-1351"></a>

### RN-1351 — Uma tabela do contrato tem um único módulo dono, e a identidade liga dois módulos {#rn-1351}

- **Regra:** estende a [RN-684](parte-09.md#rn-684). O `tipo` do item do contrato ganha `tabela` e `identidade`. `tabela`: a `assinatura` começa pelo nome da tabela (`agendamento(id, clienteId:int, …)`); o módulo que a declara é o DONO, e a api recusa com 400 a mesma tabela (nome sem diferenciar caixa) em dois módulos, nomeando os dois ("a tabela `agendamento` tem dois donos: `agenda` e `cancelamento` — declare-a só no dono e use a função dele no outro"). `identidade`: a `assinatura` exige `->` (`profissional.usuarioId -> usuario.id`, `criarAcesso() -> {senhaTemporaria}`), senão 400 com o exemplo. O leitor tolerante segue a constante, então o artefato antigo só com os quatro tipos lê igual. O engine só pode mandar os tipos novos depois desta PR (campos aditivos).
- **Código:** `src/domain/architecture/module-contracts.ts` (`validarContratos`, `validarItem`, `nomeDaTabela`)
- **Teste:** `test/application/use-cases/architecture/module-contracts.use-case.spec.ts` (`tabela e identidade`)
- **Origem:** AT-981 (EP-036), decisão do dono de 17/11/2026 (P2 = B).

<a id="rn-1352"></a>

### RN-1352 — O `GET /projects/:projectId/backlog/architecture` traz os contratos vigentes {#rn-1352}

- **Regra:** estende a [RN-684](parte-09.md#rn-684). A resposta ganha `contratos` (`ContratoDeModuloResponseDto[]`, `[]` sem contrato declarado), lido por `GetModuleContractsUseCase` (o mesmo artefato vigente). Campo aditivo, sem rota nova: route-surface e security-surface não mudam. É o que a aba Arquitetura do web mostra.
- **Código:** `src/application/use-cases/architecture/get-architecture.use-case.ts` (`execute`); `src/interfaces/http/backlog/dto/backlog.response.dto.ts` (`ArchitectureResponseDto`)
- **Teste:** `test/application/use-cases/architecture/get-architecture.use-case.spec.ts`
- **Origem:** AT-981 (EP-036), decisão do dono de 17/11/2026.

<a id="rn-1366"></a>

### RN-1366 — Com postura `egress`, a api só registra `running` depois de provar o DNS dentro do container {#rn-1366}

- **Regra:** estende a [RN-934](parte-11.md#rn-934) e protege a RN-502 do engine. `container_start` e `container_recreate` rodam `ProvarRedeDoContainerUseCase` entre o `broker.start` e o ciclo `running`: com a rede `egress` da decisão de imagem vigente, `brokerPort.exec` roda `getent hosts <registry>` (ou `nslookup`, se não houver `getent`) dentro do container. O registry vem do ecossistema da stack (lista da [RN-906](parte-10.md#rn-906): `registry.npmjs.org`, `pypi.org`, `hex.pm`, `proxy.golang.org`, `crates.io`, `rubygems.org`, `repo.maven.apache.org`, `packagist.org`, `api.nuget.org`; sem ecossistema, `github.com`). Saída 0 segue. Outra saída: `broker.remove`, ciclo `failed` (se havia linha viva) e a ação termina `failed` com "o container subiu sem rede: DNS de <registry> falhou", sem nunca chegar a `running`, então o dev não reivindica a tarefa. Saída 127 (nem `getent` nem `nslookup`) registra "rede não provada: a imagem não tem getent/nslookup" no log e segue. Postura `none` e ciclo já `running` não provam nada.
- **Código:** `src/application/use-cases/containers/provar-rede-do-container.use-case.ts` (`execute`, `registryDaStack`); `src/application/use-cases/actions/execute-container-start.use-case.ts`; `src/application/use-cases/actions/execute-container-recreate.use-case.ts`
- **Teste:** `test/application/use-cases/containers/provar-rede-do-container.use-case.spec.ts`; `execute-container-start.use-case.spec.ts` (`rede provada`); `execute-container-recreate.use-case.spec.ts` (`sem rede provada`)
- **Origem:** AT-980 (EP-036), achado 10 do TP-01 29ª; lane L2 da Rodada 384.

<a id="rn-1367"></a>

### RN-1367 — O teto de mutação do broker conta nove chamadas de controle: 285 s {#rn-1367}

- **Regra:** o `start` do docker-port (contracts `v1.4.0-dev.1`) passou a ter `CHAMADAS_DE_CONTROLE_NO_START = 9` (acrescenta o `rm` do `created` órfão, o `rm` da spec velha e o `inspect` do hash). O espelho da api (`CHAMADAS_DE_CONTROLE_NO_START`, `TETO_DE_MUTACAO_MS`) vai de 195 s para 10 + 9 × 30 + 5 = 285 s; o teto do `propose_action` no engine (espelho `TETO_DO_PROPOSE_ACTION_DE_CONTAINER_NO_ENGINE_MS`) sobe de 225 s para 315 s, igual ao engine#112. Continua broker < api < engine e abaixo dos 300 s de cabeçalhos do `fetch`. `@brabo/shared` sobe para `1.4.0-dev.1`.
- **Código:** `src/infrastructure/http-clients/container-broker.client.ts` (`CHAMADAS_DE_CONTROLE_NO_START`, `TETO_DE_MUTACAO_MS`)
- **Teste:** `test/infrastructure/http-clients/container-broker.client.spec.ts` (`as três mutações cobrem o pior caso`)
- **Origem:** AT-980 (EP-036), TAG `v1.4.0-dev.1` do contracts.

<a id="rn-1368"></a>

### RN-1368 — Container recriado pelo broker recongela a imagem e os recursos {#rn-1368}

- **Regra:** `ContainerIniciadoPeloBroker.recriado` (o broker descartou o container parado de spec velha e subiu outro) chega a `SubirCicloDeVidaDoContainerUseCase`. Com `recriado` e ciclo `stopped`, a subida passa por `removed -> provisioning -> running` em vez de `stopped -> running`, e a linha congela de novo `imageVersion` e `resources` ([RN-508](parte-06.md#rn-508)). O `container_recreate` sempre passa `recriado`.
- **Código:** `src/application/use-cases/containers/subir-ciclo-de-vida-do-container.use-case.ts` (`execute`); `src/application/ports/container-broker.port.ts` (`ContainerIniciadoPeloBroker.recriado`)
- **Teste:** `test/application/use-cases/containers/subir-ciclo-recriado.use-case.spec.ts`
- **Origem:** AT-980 (EP-036), achado 11.

<a id="rn-1369"></a>

### RN-1369 — Apagar o projeto tenta remover o container antes de apagar a linha, sem ser bloqueado por isso {#rn-1369}

- **Regra:** `DeleteProjectUseCase` chama `brokerPort.remove` ANTES de `projects.remove` (o broker resolve o container pelo contexto do projeto nesta api, que some com a linha), exceto no modo `runner`. Falha do broker (fora do ar, recusa, não configurado) vira aviso no log e o apagar segue: o projeto some na hora (ADR 0298). A limpeza pendente (registro `project_resources`, reconciliação e `removeQa` das instâncias de QA) é da AT-980/L7 e fica como TODO no código.
- **Código:** `src/application/use-cases/iam/delete-project.use-case.ts` (`execute`)
- **Teste:** `test/application/use-cases/iam/delete-project.use-case.spec.ts`
- **Origem:** AT-980 (EP-036), achado 7b.

<a id="rn-1370"></a>

### RN-1370 — A tarefa guarda o levantamento e as tarefas de que depende {#rn-1370}

- **Regra:** estende a [RN-678](parte-09.md#rn-678). `tasks.levantamento` (jsonb, nulo até gravar: `{ arquivos, expoe, consome, dependenciasNpm, aceite }`) e `tasks.depende_de` (`uuid[]`, `{}` por padrão; migração 0092). `PUT /internal/sessions/:sessionId/tasks/:taskId/levantamento` (só o engine) regrava o levantamento da tarefa não arquivada; corpo malformado é 400, tarefa de outro projeto ou arquivada é 404. Ambos os campos saem em `TaskResponseDto` (aditivos).
- **Código:** `src/db/schema/backlog.ts` (`tasks`); `src/application/use-cases/backlog/set-levantamento.use-case.ts` (`execute`); `src/domain/execution/plano-de-execucao.ts` (`lerLevantamento`); `src/interfaces/http/internal/internal-sessions.controller.ts` (`levantamentoRoute`)
- **Teste:** `test/infrastructure/persistence/drizzle/backlog-claim-depende-de.repository.spec.ts` (`assignModules grava depende_de`); `test/domain/execution/plano-de-execucao.spec.ts` (`lerLevantamento`)
- **Origem:** AT-990 (EP-035), decisões do dono de 14/11/2026 (AT-951/952, decisões 2 e 3).

<a id="rn-1371"></a>

### RN-1371 — O plano com `dependeDe` recusa ciclo, tarefa sem levantamento e `consome` sem quem exponha {#rn-1371}

- **Regra:** revisa a [RN-1004](parte-11.md#rn-1004). `AtribuicaoDeTarefa` ganha `dependeDe?` (aceita também `depende_de` no payload) e `lerPlanoDeExecucao` o 6º parâmetro `levantamentos` (`undefined` não confere). Recusas nomeadas: `dependeDe` para tarefa fora do projeto; ciclo; tarefa sem levantamento quando o plano traz `dependeDe`; `consome` que nenhuma tarefa do plano `expoe`. A recusa do contrato (RN-1351/1352) e a do módulo órfão seguem como estavam. `ExecuteExecutionPlanUseCase` grava `depende_de` junto do `module` (plano sem `dependeDe` grava `{}`).
- **Código:** `src/domain/execution/plano-de-execucao.ts` (`lerPlanoDeExecucao`, `acharCiclo`, `idsDasTarefasDoPlano`); `src/application/use-cases/execution/execute-execution-plan.use-case.ts` (`lerPlano`, `execute`)
- **Teste:** `test/domain/execution/plano-de-execucao.spec.ts` (`plano com dependeDe e levantamento`)
- **Origem:** AT-990 (EP-035), decisões do dono de 14/11/2026 (AT-951/952, decisões 2 e 3).

<a id="rn-1372"></a>

### RN-1372 — O claim libera pela tarefa quando ela declara `depende_de` {#rn-1372}

- **Regra:** revisa a [RN-1005](parte-11.md#rn-1005). Tarefa com `depende_de` não vazio só sai quando TODAS as tarefas listadas (não arquivadas) estão `done`, mesmo com outra tarefa aberta no módulo de que ela depende; sem `depende_de`, vale a régua do módulo inteiro como antes (fallback). O MESMO predicado serve ao `claimNext` e ao `countClaimableByModule` ([RN-678](parte-09.md#rn-678), AT-274). A fundação do módulo (RN-1138) segue antes. Nada de barreira por rodada.
- **Código:** `src/infrastructure/persistence/drizzle/backlog.repository.ts` (`semDependenciaAberta`)
- **Teste:** `test/infrastructure/persistence/drizzle/backlog-claim-depende-de.repository.spec.ts` (`claim por tarefa`)
- **Origem:** AT-990 (EP-035), decisões do dono de 14/11/2026 (AT-951/952, decisões 2 e 3).

<a id="rn-1373"></a>

### RN-1373 — O merge acorda o módulo das tarefas que dependem da mergeada, e o plano tem níveis {#rn-1373}

- **Regra:** estende a [RN-1009](parte-11.md#rn-1009). `task.became_claimable` (`cause: dependency_done`) leva, além dos módulos com `dependsOn`, o módulo de toda tarefa aberta cujo `depende_de` contém a tarefa fechada (`modulosDosDependentes`). `niveisDoPlano(tarefas, mapa)` (função pura) dá o nível topológico de cada tarefa (0 sem dependência), com o nível do módulo pelo `dependsOn` como fallback; é visão, não barreira.
- **Código:** `src/application/use-cases/actions/execute-git-action.use-case.ts` (`acordarDependentes`); `src/infrastructure/persistence/drizzle/backlog.repository.ts` (`modulosDosDependentes`); `src/domain/execution/plano-de-execucao.ts` (`niveisDoPlano`)
- **Teste:** `test/application/use-cases/actions/execute-git-action.use-case.spec.ts` (`acorda o módulo da tarefa cujo depende_de`); `test/domain/execution/plano-de-execucao.spec.ts` (`niveisDoPlano`)
- **Origem:** AT-990 (EP-035), decisões do dono de 14/11/2026 (AT-951/952, decisões 2 e 3).

<a id="rn-1382"></a>

### RN-1382 — A api guarda o inventário do que pediu ao broker, e ele sobrevive ao projeto {#rn-1382}

- **Regra:** a tabela `project_resources` (migração 0093, SEM FK com `cascade` para `projects`) tem uma linha por (projeto, tipo `container`/`container_qa`, chave da QA) com o estado `pedido`, `criado`, `falhou` (com motivo), `removendo` ou `removido`, as portas pedidas, o `container_id` e `tentativas`. `RegistroDeRecursos` grava `pedido` ANTES de `start`/`startQa`, `criado` ou `falhou` DEPOIS, e `removido` depois de `remove`/`removeQa`. Falha de gravar vira log e a ação segue (a reconciliação cobre). `project_containers` e `project_qa_environments` seguem como ciclo de vida. Volumes ficam fora: o broker só cria bind (ADR 0298).
- **Código:** `src/db/schema/containers.ts` (`projectResources`); `src/application/use-cases/containers/registro-de-recursos.ts` (`RegistroDeRecursos`); `src/infrastructure/persistence/drizzle/recurso-de-projeto.repository.ts` (`gravar`)
- **Teste:** `test/infrastructure/persistence/recurso-de-projeto.repository.spec.ts`; `test/application/use-cases/actions/execute-container-start.use-case.spec.ts` (`start ok fica pedido -> criado`); `test/application/use-cases/containers/instancia-de-qa.use-case.spec.ts` (`registra pedido`)
- **Origem:** AT-980 (EP-036), ADR 0298, decisão do dono de 17/11/2026 (P2).

<a id="rn-1383"></a>

### RN-1383 — A porta do app sai da leitura do host, na proposta, no clique e no `start` {#rn-1383}

- **Regra:** substitui o atalho da [RN-1029](parte-12.md#rn-1029). `portaLivreDoApp` começa em 13000 e pula a porta publicada no host por container que não é do próprio projeto (de terceiro ou de outro projeto, vinda de `GET /host/recursos`) e a declarada na rede de outro projeto; a do próprio container é livre. A proposta nomeia "porta não conferida no host" quando o broker não responde. No clique do `container_recreate`, ANTES do `remove`, a porta é conferida de novo: tomada depois da proposta, a api grava nova versão de `artifact.container_network` (ator = quem clicou, dns e hosts extras preservados) e o evento `container.recreated` leva `portaPulada`. O `container_start` com a porta da rede vigente com outro container falha nomeado, sem chamar o broker.
- **Código:** `src/domain/containers/recriar-com-app.ts` (`portaLivreDoApp`); `src/application/use-cases/containers/porta-do-app.use-case.ts` (`escolher`, `quemSegura`); `src/application/use-cases/actions/execute-container-recreate.use-case.ts` (`execute`); `src/infrastructure/http-clients/container-broker.client.ts` (`recursosDoHost`)
- **Teste:** `test/domain/containers/recriar-com-app.spec.ts`; `test/application/use-cases/containers/porta-do-app.use-case.spec.ts`; `test/application/use-cases/actions/execute-container-recreate.use-case.spec.ts` (`porta tomada depois da proposta`)
- **Origem:** AT-980 (EP-036), ADR 0298, decisão do dono de 17/11/2026 (P1).

<a id="rn-1384"></a>

### RN-1384 — Ciclo `running` cuja prova de rede reprova passa a `failed` {#rn-1384}

- **Regra:** estende a [RN-1366](#rn-1366). `ProvarRedeDoContainerUseCase` não pula mais o ciclo `running` (o `start` idempotente sobre container de pé também prova o DNS); reprovando, o container é removido e o ciclo `running` vira `failed`, como já faziam `provisioning` e `stopped`.
- **Código:** `src/application/use-cases/containers/provar-rede-do-container.use-case.ts` (`execute`)
- **Teste:** `test/application/use-cases/containers/provar-rede-do-container.use-case.spec.ts` (`ciclo running que reprova`)
- **Origem:** AT-980 (EP-036), pendência apontada pela api#132.

<a id="rn-1385"></a>

### RN-1385 — Apagar o projeto nunca espera o broker: o inventário vira `removendo` {#rn-1385}

- **Regra:** estende a [RN-1369](#rn-1369). Fora do modo `runner`, `DeleteProjectUseCase` remove as instâncias de QA vivas (`removeQa`) e o container em melhor esforço, e na MESMA transação do `DELETE` marca `removendo` as linhas de `project_resources` do projeto. Depois do commit chama `orfao/remove`; sucesso fecha as linhas como `removido`, falha deixa `removendo` com o motivo e `tentativas + 1`. O projeto some na hora e o apagar nunca é recusado por causa do broker (confirmado pelo dono em 18/11/2026).
- **Código:** `src/application/use-cases/iam/delete-project.use-case.ts` (`execute`); `src/infrastructure/persistence/drizzle/recurso-de-projeto.repository.ts` (`marcarRemovendoDoProjeto`, `concluirRemocaoDoProjeto`)
- **Teste:** `test/application/use-cases/iam/delete-project.use-case.spec.ts` (`broker fora na hora de apagar`)
- **Origem:** AT-980 (EP-036), ADR 0298, decisão do dono de 18/11/2026.

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
- **Código:** `src/application/use-cases/automacao/oferecer-automacao.use-case.ts:220` (`registrarAplicada`), `src/application/use-cases/execution/mark-task-blocked.use-case.ts:131` (`aplicarRegraDeDesbloqueio`)
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

- **Regra:** estende a [RN-1351](#rn-1351) e a [RN-1004](parte-11.md#rn-1004). (1) `validarContratos` recusa com 400 a tabela citada à direita de `->` num item `tabela` ou `identidade` que nenhum módulo declara como dona: "A tabela `usuario` é citada por `cadastro` (…), mas nenhum módulo a declara como dona". (2) `lerPlanoDeExecucao` ganha o 7º parâmetro `contratos` (`undefined` não confere) e recusa o plano quando (a) o dono de uma tabela tem tarefa no plano e nenhuma tarefa dele cita o nome da tabela (palavra inteira, sem diferenciar caixa, ex.: `tabela usuario`) no `expoe` do levantamento ([RN-1371](#rn-1371)); só confere quando os levantamentos vêm; (b) um módulo com tarefa referencia uma tabela cujo dono não tem tarefa no plano e não está entregue. As mensagens falam a um leigo ("Ninguém ficou responsável por criar a tabela `usuario`…"), sem id de tarefa nem uuid. Roda na proposta e na aprovação (`lerPlano`).
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
