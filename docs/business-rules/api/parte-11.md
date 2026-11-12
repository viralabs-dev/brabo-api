---
id: rn-api-parte-11
title: 'Regras de negócio — API — parte 11 (desde RN-916)'
sidebar_label: 'API — parte 11 (desde RN-916)'
description: 'As RNs hospedadas na raiz api.'
keywords: [regras de negócio, api]
---

# API — parte 11 (desde RN-916)

## A Anamnese não paga duas vezes pela mesma janela, e o resgate de gate não reinicia ciclo que espera alguém (RN-722)
<a id="rn-916"></a>

### RN-916 — Resposta cortada pelo raciocínio é retentada UMA vez com o raciocínio desligado {#rn-916}

Revisa a [RN-782](parte-10.md#rn-782) e a [RN-783](parte-10.md#rn-783) (o desligado deixa de ser só dos dev agents) e convive com a [RN-915](parte-10.md#rn-915).

1. **Gatilho.** A resposta veio `truncated`, sem texto e sem tool call, e o raciocínio comeu o orçamento: `reasoningTokens >= (reasoningBudget do modelo ?? 4096) − 256` (folga `FOLGA_DO_ORCAMENTO_DE_RACIOCINIO`, a mesma ordem de grandeza do erro do `usage` e da contagem caracteres/4), ou o stream foi abortado pela RN-915 (sem `usage`, o aborto já é a prova do estouro).
2. **Uma vez.** A api repete a chamada com `reasoningOff`, nos três caminhos (`run-llm-turn`, `stream-llm-turn`, `send-chat-message`). Se a segunda também trunca, o desfecho é o de hoje (`truncated`); nunca há terceira. Nada foi emitido ao cliente na primeira, então a retentativa é invisível.
3. **Metering.** As DUAS chamadas gravam linha em `token_usage`; a primeira, ao preço/custo que o provider informou (ou a estimativa abortada da RN-915, com reconciliação).
4. **Não retenta** sem raciocínio pedido, com o raciocínio já desligado (dev agents, RN-783) ou com provider que não sabe desligá-lo (`aceitaRaciocinioDesligado`, OpenRouter e Anthropic; ver a [RN-1001](#rn-1001), que corrige o decorator que escondia a flag): ali o desfecho segue o de antes.

- **Código:** `src/domain/llm/raciocinio-do-agente.ts:66` (`devoRetentarSemRaciocinio`);
  `src/application/use-cases/llm/run-llm-turn.use-case.ts:367` (`devoRetentarSemRaciocinio`)
- **Teste:** `test/domain/llm/raciocinio-do-agente.spec.ts` (folga, aborto e as recusas); `test/application/use-cases/llm/run-llm-turn.use-case.spec.ts` (com a capability lida do `AnthropicProvider` real, AT-757: retenta e grava duas linhas; segunda truncada não tem terceira; truncada com texto não retenta); `test/application/use-cases/llm/stream-llm-turn.use-case.spec.ts` (idem no stream)
- **Origem:** AT-587, AT-757 (o provider Anthropic declara a capability, o que passa a ser coberto por um spec de caso de uso)

<a id="rn-917"></a>

### RN-917 — O OpenRouter recebe um teto de preço por chamada, e sem upstream no teto a chamada repete UMA vez sem ele {#rn-917}

Revisa a [RN-583](parte-07.md#rn-583) (o `sort` deixa de ser o único campo de `provider` que vai ao fio) e convive com a [RN-907](parte-10.md#rn-907) (o `session_id`) e a [RN-916](#rn-916) (a mesma volta de retentativa).

1. **Teto.** `provider.max_price = { prompt, completion }` = preço de catálogo do modelo (`inputPricePerMillionMicros`/`outputPricePerMillionMicros`) × `FATOR_DO_TETO_DE_PRECO` (1,5, decisão do dono de 27/10), em US$ por milhão. Fixo no código e ligado por padrão no provider que declara `priceCeiling` (só o OpenRouter, provado por smoke); preço 0 em qualquer ponta, ou provider sem a capability, não manda teto. Mudar o fator é ADR novo (0225).
2. **Mescla.** O objeto `provider` do teto é mesclado com o do `sort` do binding (RN-583): os dois vão juntos no mesmo corpo, nunca um apaga o outro.
3. **Sem upstream no teto.** O 404 de uma chamada que levava teto é o erro `LLMPriceCeilingError` (`code: price_ceiling`), nunca `LLMModelNotFoundError`. Os três caminhos de turno (`run-llm-turn`, `stream-llm-turn`, `send-chat-message`) repetem a chamada UMA vez sem teto, avisam no log e não falham o turno; nunca há terceira por este motivo.
4. **Metering.** `token_usage.price_ceiling_factor` congela o fator que FOI AO FIO (`null` = nada enviado, inclusive na repetição sem teto), no molde do `routing_preference`.

- **Código:** `src/domain/llm/routing-preference.ts:108` (`tetoDePreco`); `src/domain/llm/routing-preference.ts:132` (`devoRetentarSemTeto`); `src/infrastructure/llm/openrouter-provider.ts:221` (`campoDeTetoDePrecoOpenRouter`); `src/infrastructure/llm/openai-compatible-provider.ts:604` (`camposDoHub`); `src/application/use-cases/llm/stream-llm-turn.use-case.ts:372` (`devoRetentarSemTeto`); `src/db/schema/llm.ts:414` (`priceCeilingFactor`)
- **Teste:** `test/domain/llm/routing-preference.spec.ts` (fator, preço 0, só o OpenRouter declara); `test/infrastructure/llm/openrouter-provider.contract.spec.ts` (`sort` e teto mesclados no corpo, sem capability nada vai, 404 com teto é `price_ceiling` e sem teto segue `model_not_found`); `test/application/use-cases/llm/stream-llm-turn.use-case.spec.ts` (repete uma vez sem teto, fator `[1.5, null]` no metering); `test/infrastructure/llm/openrouter-provider.teto.smoke.spec.ts` (manual, API real)
- **Origem:** AT-606; ADR [0225](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0225-teto-de-preco-do-upstream-no-openrouter.md)

<a id="rn-921"></a>

### RN-921 — O botão "Retomar" do fio é gesto humano, sem teto, e só vale para o turno interrompido {#rn-921}

- **Regra:** o `agent.error` com `reason: turno_interrompido_por_reinicio` ganha no fio o cartão `RetomarTurnoInterrompido` (objetivo e passos do último plano, "Parou em", botão). O clique chama `POST /projects/:projectId/sessions/:sessionId/agents/:agent/resume` (`developer`; 200 `{ok:true}`; 404 sessão alheia; 409 `turno_nao_interrompido` quando o último desfecho do agente não é a interrupção ou há turno em curso; 409 `agente_sem_retomada`), que pede ao engine `POST /internal/sessions/:sessionId/agent/resume`: ele grava `agent.turn_resumed` com `automatica: false` e manda `:retomar_turno_interrompido` à MESMA `TurnoAssincrono`. Sem teto: cada clique é uma retomada. O cartão some quando algo segue o erro, e a retomada automática vira uma linha discreta. O "sem desfecho" do diário NÃO aparece na tela (o evento não o traz).
- **Onde:** `src/interfaces/http/sessions/agent-resume.controller.ts:23` (`AgentResumeController`), `src/application/use-cases/sessions/resume-agent-turn.use-case.ts:29` (`execute`), `apps/engine/lib/engine_web/controllers/agent_command_controller.ex:638` (`resume`), `apps/web/src/routes/RetomarTurnoInterrompido.helpers.ts:10` (`ehTurnoInterrompido`)
- **Teste:** `test/interfaces/http/sessions/agent-resume.controller.spec.ts` (feliz, duas recusas 409, 404, papel); `apps/web/src/routes/RetomarTurnoInterrompido.test.tsx`; ExUnit do `agent_command_controller`
- **Origem:** AT-582 (EP-031); [ADR 0226](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0226-diario-vivo-e-retomada-dos-agentes.md).

<a id="rn-926"></a>

### RN-926 — A rota de providers com chave devolve só os nomes, e a chave é a do TITULAR {#rn-926}

- **Regra:** `GET workspaces/:workspaceId/llm-providers/credentialed` (`viewer`, o mínimo da leitura de membros, [RN-655](parte-08.md#rn-655)) devolve `{ providers: LLMProviderName[] }` com os providers de LLM em que o TITULAR do workspace (`workspaces.created_by`, a pessoa cuja credencial os agentes gastam, [RN-058](parte-02.md#rn-058)) tem credencial cadastrada. Só nomes, na ordem da lista canônica: nunca segredo, id, data nem `key_id`. `ollama` não tem credencial e nunca aparece; token de git (`github`/`gitlab`) também não. Credencial de outro membro não conta. É a fonte de "tem chave" das telas de providers e do catálogo (AT-607); a tela vem depois.
- **Onde:** `src/application/use-cases/llm/list-credentialed-providers.use-case.ts:20` (`execute`), `src/interfaces/http/llm/models.controller.ts:80` (`credentialed`)
- **Teste:** `test/application/use-cases/llm/list-credentialed-providers.use-case.spec.ts:44` (`titular com duas chaves: só os dois nomes`; a chave de outro membro não conta)
- **Origem:** AT-607 (EP-026).

<a id="rn-927"></a>

### RN-927 — O runner grava a chave de API de LLM do usuário por `POST /runner/llm-credentials`, só com chave de máquina, sem sobrescrever sem confirmação {#rn-927}

- **Regra:** `POST /runner/llm-credentials` (`@RequirePatAuth()`, `PatAuthGuard`) recebe `{ provider, apiKey, origem, substituir? }` e delega ao mesmo `UpsertUserCredentialUseCase` (envelope com `key_id`, ADR 0158) para o usuário dono da credencial. Rota sem `:projectId`: o guard recusa com 403 credencial amarrada a projeto, e todo PAT é de projeto, então só a chave de dispositivo de MÁQUINA entra (a primeira rota em que ela escreve segredo de usuário). Provider fora de `LLM_PROVIDER_NAMES_COM_CREDENCIAL` é 400; credencial existente do provider sem `substituir: true` é 409 `credencial_existente`, sem tocar a existente. A resposta é `{ provider, substituida }`. O valor nunca vai a log (a auditoria leva provider e `origem`), URL, evento, exceção nem resposta, e a rota não testa a conexão (ADR 0050). Só chave de API é importável; token de login por assinatura não (ADR 0230).
- **Onde:** `src/application/use-cases/llm/import-runner-llm-credential.use-case.ts:22` (`execute`), `src/interfaces/http/runner/runner-llm-credentials.controller.ts:33` (`RunnerLlmCredentialsController`)
- **Teste:** `test/application/use-cases/llm/import-runner-llm-credential.use-case.spec.ts` (grava cifrado com `key_id` sem o valor em log/resposta; 409 sem substituir; substituir; provider inválido); 401/403 do guard em `test/interfaces/pat-auth.guard.spec.ts`; `route-surface.spec.ts`
- **Origem:** AT-611 (EP-026), ADR 0230.

<a id="rn-932"></a>

### RN-932 — A rede do container é artefato declarado por humano e só vale no container recriado {#rn-932}

- **Regra:** `artifact.container_network` (`{ ports[{host,container,protocol:'tcp'}], dns[], extraHosts[{name,ip}] }`) é versionado, sem tabela, e o vigente é o de maior `version`. Só um humano `maintainer` o escreve (`PUT /projects/:projectId/container/network`; `GET` é `viewer`), com a MESMA régua do docker-port (host 1024-65535 fora das portas da instalação, até 10 portas sem duplicata, até 3 DNS por IP literal, até 10 hosts com IPv4 e nome fora dos reservados); recusa é 400 `rede_invalida` nomeando o campo. Escrever NÃO é efeito externo. A `container-spec` devolve `ports`, `dns` e `extraHosts` (ou `null`; `runner` sempre `null`, runner depois) e a mudança só vale em container recriado (RN-934). A api não importa o docker-port, então a régua é espelhada e a paridade é provada por teste.
- **Onde:** `src/domain/containers/rede-do-container.ts:86` (`validarRedeDoContainer`), `src/interfaces/http/containers/containers.controller.ts:91` (`declarar`), `src/application/use-cases/containers/obter-spec-de-container.use-case.ts:135` (`execute`).
- **Teste:** `test/contract/rede-do-container-paridade.spec.ts` (paridade com o docker-port), `test/application/use-cases/containers/spec-e-observacao-de-container.use-case.spec.ts` (spec devolve a rede; `runner` tudo `null`).
- **Origem:** AT-608 (EP-030), ADR 0228.

<a id="rn-933"></a>

### RN-933 — `run.app` declara o comando do app e só o piloto automático dispensa a aprovação da PR de infra {#rn-933}

- **Regra:** `run` de `open_infra_pr` aceita `app: { command, port }` opcional (comando de até 300 code points, uma linha, sem NUL; porta 1024-65535; `null` equivale a ausente, como no engine) validado na proposta e na execução; sem `app`, tudo é byte a byte o de antes. Com `run.app`, a regra ESPECÍFICA `open_infra_pr: auto_approve` (a semente do aceite) NÃO basta e a decisão vira `require_approval`; só a CURINGA `auto_approve` do agente (piloto automático, RN-603/RN-670) auto-aprova. A `container-spec` devolve `comandoDoApp` do `run.app.command` vigente, ou `null`.
- **Onde:** `src/domain/infra/run-instructions.ts:77` (`recusaDoRun`), `src/domain/actions/decide.ts:626` (`comAppDeclarado`), `src/application/use-cases/actions/propose-action.use-case.ts:355` (`comAppDeclarado`), `src/application/use-cases/containers/obter-spec-de-container.use-case.ts:171` (`comandoDoApp`).
- **Teste:** `test/domain/infra/run-app.spec.ts`, `test/domain/actions/decide.spec.ts` (sem app + específica = auto; com app + específica = aprovação; com app + curinga = auto).
- **Origem:** AT-610 (EP-030), ADR 0228.

<a id="rn-934"></a>

### RN-934 — `container_recreate` remove e sobe de novo, no teto absoluto de `container_remove` {#rn-934}

- **Regra:** `container_recreate` (`maintainer`) é `proposed_action` nunca auto-aprovável, nem com a curinga, e "sempre permitir" é recusado na fonte (mesma lista de `container_remove`). A execução faz `remove` e `start` pelo broker passando por `running -> stopped -> removed -> provisioning -> running`; recusa ou indisponibilidade do broker vira `failed` nomeado (se a subida falha, o motivo diz que o container já foi removido). `runner` é recusado nomeando "runner depois". A frase em `aprovacoes.ts` existe e o teste do web reprova tipo sem frase.
- **Onde:** `src/domain/actions/decide.ts:609` (`container_recreate`), `src/application/use-cases/actions/execute-container-recreate.use-case.ts:48` (`execute`), `apps/web/src/lib/aprovacoes.ts:117` (`container_recreate`).
- **Teste:** `test/application/use-cases/actions/execute-container-recreate.use-case.spec.ts`, `test/domain/actions/decide.spec.ts` (teto), `apps/web/src/lib/aprovacoes.test.ts`.
- **Origem:** AT-608 (EP-030), ADR 0228.

<a id="rn-935"></a>

### RN-935 — A Infra declara os serviços da instância de QA (`run.qa`), e a api guarda uma instância por tarefa com teto de 1 por projeto {#rn-935}

- **Regra:** `open_infra_pr` aceita `run.qa = { services: [...] }` (opcional, `null` = ausente; até 6 serviços de nome único `[a-z][a-z0-9-]{0,31}`; `image` COM digest `@sha256:<64 hex>`; `env` até 20 variáveis `[A-Z_][A-Z0-9_]*` de uma linha; `tmpfs` até 3 caminhos absolutos; `shared` booleano). A mesma régua vale na proposta (400 `run_invalido`) e na execução, e quem declara é a Infra, não um catálogo do produto (decisão do dono, 29/10). A instância de uma tarefa é uma linha de `project_qa_environments` (`provisioning|running|failed|removed`, único `(projeto, tarefa)`), e um índice parcial único garante no banco UMA ativa por projeto: subir a de outra tarefa com uma ativa é 409 `instancia_de_qa_ocupada`. `runner` é recusado (409 `qa_nao_suporta_runner`, "runner depois"). A chave do container é o `chaveDeQa(taskId)` (8 primeiros `[a-z0-9]` do id, sem hífen), calculada só pela api.
- **Onde:** `src/domain/infra/run-instructions.ts:160` (`recusaDoQa`), `src/domain/containers/instancia-de-qa.ts:15` (`chaveDeQa`), `src/db/schema/containers.ts:87` (`projectQaEnvironments`), `src/application/use-cases/containers/instancia-de-qa.use-case.ts:80` (`start`).
- **Teste:** `test/domain/infra/run-qa.spec.ts`, `test/application/use-cases/containers/instancia-de-qa.use-case.spec.ts`.
- **Origem:** AT-612 (EP-030), ADR 0229.

<a id="rn-936"></a>

### RN-936 — Subir a instância de QA é a ação `qa_environment_start`, semeada `auto_approve` para o QA; remover é automático e fora do teto do `container_remove` {#rn-936}

- **Regra:** `qa_environment_start` (`developer`, payload `{ taskId }`) é `proposed_action` semeada `auto_approve` para `qa-automacao` na ativação da execução; ao ser auto-aprovada ou aprovada, a api sobe a instância pelo broker (`failed` nomeado se o teto está ocupado, se o projeto é `runner` ou se o broker recusa). A REMOÇÃO não é proposta: `POST /internal/projects/:projectId/qa-environments/:taskId/remove` é idempotente e só alcança o que o broker rotula `brabo.papel=qa`, então não entra no teto absoluto de `container_remove`/`container_recreate`. O `container-exec` aceita `alvo: { qa: true, taskId }` vindo do engine (nunca do modelo) para rodar na instância; sem instância `running` devolve `sucesso: false`. A frase do tipo existe em `aprovacoes.ts` e o teste do web reprova tipo sem frase.
- **Onde:** `src/domain/actions/decide.ts:198` (`qa_environment_start`), `src/application/use-cases/actions/execute-qa-environment-start.use-case.ts:25` (`execute`), `src/application/use-cases/containers/instancia-de-qa.use-case.ts:120` (`remove`), `apps/web/src/lib/aprovacoes.ts:473` (`qa_environment_start`).
- **Teste:** `test/application/use-cases/containers/instancia-de-qa.use-case.spec.ts`, `test/domain/actions/decide.spec.ts`, `apps/web/src/lib/aprovacoes.test.ts`.
- **Origem:** AT-612 (EP-030), ADR 0229.

<a id="rn-937"></a>

### RN-937 — A `container-spec` de QA e a limpeza de órfãs {#rn-937}

- **Regra:** `GET /internal/projects/:id/container-spec?papel=qa&task=<ref>` devolve o contexto normal com `comandoDoApp: null`, `ports: null` e `qa: { chave, services }` (os de `run.qa`, `[]` se ausentes). `task` é o id completo OU a chave de 8 (o broker da `dev` manda a chave), resolvido DENTRO do projeto: tarefa inexistente ou de outro projeto é 404, chave ambígua é 409 `tarefa_ambigua`. `POST /internal/qa-environments/sweep` recebe do engine os `taskIdsEmVoo` e remove toda instância ativa ou `failed` fora dessa lista. Lacuna declarada: o broker ainda não tem operação para remover o serviço compartilhado nem a rede `brabo-qa-<wd>`, que ficam até essa operação existir.
- **Onde:** `src/application/use-cases/containers/obter-spec-de-container.use-case.ts:135` (`execute`), `src/application/use-cases/containers/instancia-de-qa.use-case.ts:140` (`limparOrfas`), `src/interfaces/http/internal/internal-qa-environments.controller.ts:90` (`sweep`).
- **Teste:** `test/application/use-cases/containers/instancia-de-qa.use-case.spec.ts`.
- **Origem:** AT-612 (EP-030), ADR 0229.

<a id="rn-938"></a>

### RN-938 — O `terminal` só vai para a instância de QA quando o ator é o `qa-automacao` e a tarefa é do projeto {#rn-938}

- **Regra:** a api repassa `payload.alvo = { qa: true, taskId }` de uma `proposed_action` `terminal` ao `/internal/actions/execute` do engine SOMENTE se o ator da ação é `qa-automacao` e o `taskId` pertence ao projeto da ação. Em qualquer outro caso (outro agente, `alvo` malformado, tarefa de outro projeto) o `alvo` é descartado com o aviso `terminal.alvo_de_qa_descartado` no log e o comando segue pelo caminho de sempre: nenhum outro agente desvia comando para a instância de QA.
- **Onde:** `src/application/use-cases/actions/execute-terminal-action.use-case.ts:40` (`alvoDeQa`), `src/infrastructure/http-clients/api-to-engine-client.ts:166` (`executeTerminalAction`).
- **Teste:** `test/application/use-cases/actions/alvo-de-qa-no-terminal.spec.ts`.
- **Origem:** AT-612 (EP-030), ADR 0229.

<a id="rn-942"></a>

### RN-942 — O recorte do Jev nunca tira do PO a ferramenta de declarar dúvida {#rn-942}

- **Regra:** estende a [RN-758](parte-10.md#rn-758). O piso do PO ganha `declare_open_question`, porque a regra 3 das obrigações do PO manda declarar a dúvida em vez de inventar ou omitir, e o recorte do Jev ([RN-625](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-625)) a tirava de todo passo depois do primeiro: o PO punha a lacuna na borda da história e nenhuma `artifact.open_question` nascia. Continua valendo que o piso só devolve o que está no catálogo do passo.
- **Onde:** `src/domain/llm/tool-router.ts:315` (`PISO_DO_MENU`).
- **Teste:** `test/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.spec.ts` (PO recortado mantém `declare_open_question`; catálogo sem ela não a ganha).
- **Origem:** AT-615 (EP-030).

<a id="rn-948"></a>

### RN-948 — Higiene do entregável: banco SQLite fora do commit, pasta dos comandos dita, rotas do README preservadas {#rn-948}

- **Regra:** estende a [RN-761](parte-10.md#rn-761), a [RN-900](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-900) e as [RN-706](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-706)/[RN-850](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-850). Três partes, sem gate novo. (1) Segunda lista, `ARQUIVOS_DE_DADOS` (`*.db`, `*.db-*`, `*.sqlite`, `*.sqlite-*`, `*.sqlite3`, `*.sqlite3-*`), nas MESMAS três camadas da RN-761: o `.gitignore` base do bootstrap, a exclusão `:(exclude,glob)**/<padrão>` no `git add` do dev agent e um achado próprio do SecOps ("arquivo de dados em tempo de execução commitado", que nomeia o caminho). O teste que cruza as listas da api e do engine cruza as duas. (2) A mensagem de ambiente do agente com módulo diz que `npm`/`pip`/`mix` rodam na pasta do módulo na MESMA chamada, nunca `cd … 2>/dev/null;` (o `cd` falho caía na raiz e deixou um `package-lock.json` vazio), dentro do teto de 1.500 caracteres. (3) O kickoff do dev nomeia o `README.md` da RAIZ, sem repetir a seção em README de pasta, e `write_file` recusa reescrever um README que perde cabeçalho de rota (`### GET /links`) presente no antigo, no molde da RN-900. Declarado: repositório já bootstrapado não ganha o `.gitignore` novo; fixture `.db` intencional fica fora do commit (renomeie para versioná-la); a guarda não cobre escrita pelo `terminal`. Fora desta RN: `expires_at` × `expiresAt`.
- **Onde:** `src/application/use-cases/git/bootstrap-templates.ts:29` (`ARQUIVOS_DE_DADOS`), `apps/engine/lib/engine/actions/diretorios_de_dependencia.ex:37` (`argumentos_do_add`), `apps/engine/lib/engine/gates/secops_agent_server.ex:162` (`dependencias_commitadas`), `apps/engine/lib/engine/harness/ambiente_do_agente.ex:178` (`modulo`), `apps/engine/lib/engine/harness/tools/write_file.ex:62` (`recusa_de_secao_perdida`), `apps/engine/lib/engine/dev/dev_agent_server.ex:666` (`initial_message`).
- **Teste:** `apps/engine/test/engine/actions/diretorios_de_dependencia_test.exs` (lista cruzada com a api, add real que estagia só `src/a.js`, SecOps nomeia o `.db`), `test/application/use-cases/git/bootstrap-plan.spec.ts` (os seis padrões no `.gitignore`), `apps/engine/test/engine/harness/ambiente_do_agente_test.exs`, `apps/engine/test/engine/harness/tools/write_file_test.exs`, `apps/engine/test/engine/dev/report_done_instrucao_test.exs`.
- **Origem:** AT-623 (EP-031), entregável `entregavel3` (commits 956fa5c, 8e593b0).

<a id="rn-949"></a>

### RN-949 — Chamada de ferramenta escrita como texto não vira resposta no fio {#rn-949}

- **Regra:** quando a chamada ao LLM leva `tools`, vem sem `toolCalls` e o
  texto traz a chamada escrita como marcação (`<function_calls>`, `<invoke
  name="X">` com X ferramenta do passo, `<tool_call>{json}` com `name` de
  ferramenta; com ou sem prefixo `antml:`), a api repete a MESMA chamada UMA
  vez (flag própria, independente das RN-916/917; as duas chamadas entram no
  metering). Se repetir, o desfecho é falha NOMEADA: `final` com
  `content: ''`, `error` nomeando o formato e o modelo e `errorCode:
  'tool_call_as_text'` (erro do MODELO, RN-059/163), nunca resposta. No stream,
  a api para de repassar deltas a partir do primeiro marcador e retém a cauda
  que pode ser início dele: o texto cru não sai da api. Bloco cercado, código
  inline, prosa, nome que não é ferramenta e chamada sem `tools` não contam; o
  JSON solto segue com o `ToolCallRecovery` (ADR 0020). Decisão do dono: NÃO
  se parseia nem se executa o XML (RN-040: resgate não é licença). Limite
  declarado: o prefixo legítimo da 1ª tentativa fica na bolha em curso até o
  turno fechar.
- **Onde:** `src/domain/llm/chamada-em-texto.ts:10`
  (`marcacaoDeChamadaEmTexto`),
  `src/application/use-cases/llm/run-llm-turn.use-case.ts:347`
  (`semChamadaEmTexto`),
  `src/application/use-cases/llm/stream-llm-turn.use-case.ts:386`
  (`semChamadaEmTexto`)
- **Teste:** `test/domain/llm/chamada-em-texto.spec.ts`,
  `test/application/use-cases/llm/run-llm-turn.use-case.spec.ts` e
  `stream-llm-turn.use-case.spec.ts` (`chamada escrita como texto`: duas vezes
  falha nomeada com 2 linhas de uso; segunda limpa responde)
- **Origem:** AT-633 (sessão `2b5161d0`, seq 4: `<invoke name="emit_artifact">`
  apareceu como resposta no fio)

<a id="rn-950"></a>

### RN-950 — O 9Router recebe as ferramentas, o vínculo confere a capability do provider e ferramenta sem capability lança {#rn-950}

- **Regra:** revisa a [RN-909](parte-10.md#rn-909) e completa a [RN-040](parte-01.md#rn-040) com a SEGUNDA camada do ADR 0041. (1) `nineRouterConfig` declara `toolCalling: true`, provado por smoke com chave real em 31/10: 3/3 chamadas em `cc/claude-haiku-5-5` voltaram com `tool_calls` estruturado, 10/10 consistente a temperatura 0 e laço de 3 voltas íntegro. Antes, a capability `false` fazia o `buildBody` descartar `tools` em silêncio e o Criativo escrevia a chamada como XML no fio (AT-637). (2) `assertModelFitsBindingScope` confere também o PROVIDER nos escopos `agent` e `area`: vínculo cujo provider declara `toolCalling: false` é recusado com 422 (`ModelNotFitForAgentScopeError`, causa `provider`), com frase própria. `workspace`, `project` e `session` seguem livres. (3) `buildBody` com ferramentas pedidas e capability `false` LANÇA erro nomeado em vez de descartar. Providers afetados: só o `opencode-zen` tem `toolCalling: false` além do 9Router de antes; vínculos novos de agente/área a ele passam a ser 422 e o chat sem ferramenta segue igual. Vínculo antigo a ele continua gravado e o turno do agente falha nomeado.
- **Onde:** `src/infrastructure/llm/nine-router-provider.ts:171` (`nineRouterConfig`), `src/domain/llm/model-capabilities.ts:95` (`assertModelFitsBindingScope`), `src/application/use-cases/llm/set-model-binding.use-case.ts:56` (`toolCalling`), `src/infrastructure/llm/openai-compatible-provider.ts:633` (`buildBody`)
- **Teste:** `test/domain/llm/model-capabilities.spec.ts` (recusa por provider em `agent`/`area`; escopos livres), `test/infrastructure/llm/nine-router-provider.contract.spec.ts` (capability `true`), `test/contract/llm-provider.contract.ts` (provider sem capability lança nomeado); smoke manual em `nine-router-provider.smoke.spec.ts`.
- **Origem:** AT-637 (EP-026), TP-01 de 31/10 e medição da AT-631.

<a id="rn-952"></a>

### RN-952 — O relatório do owner recorta por projeto e por sessão, e o membro vê o total do projeto sem credencial {#rn-952}

Revisa a [RN-101](parte-03.md#rn-101) (o membro deixa de ver SÓ o próprio consumo) e convive com a [RN-060](parte-02.md#rn-060), a [RN-186](parte-03.md#rn-186) e a [RN-187](parte-03.md#rn-187).

1. **Recorte.** `GET workspaces/:workspaceId/spend-report?projectId=` (`owner`) limita o relatório a UM projeto e devolve também `porSessao`. Projeto de outro workspace é 404, igual a inexistente: o filtro nunca vira leitura entre workspaces.
2. **Membro.** `GET projects/:projectId/spend/team` (`viewer`) devolve o total do projeto e o custo por agente (`porAgente`) e por área do catálogo (`porArea`, `sem-area` quando não há). Nunca provider nem credencial: a rota não tem parâmetro de dimensão e o caso de uso só pede `actor` (ADR [0233](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0233-membro-ve-o-gasto-do-projeto-sem-credencial.md), que revisa o [0063](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0063-duas-audiencias-para-o-mesmo-gasto.md)).

- **Código:** `src/application/use-cases/llm/get-workspace-spend-report.use-case.ts:98` (`NotFoundException`); `src/application/use-cases/llm/get-project-spend-team.use-case.ts:36` (`GetProjectSpendTeamUseCase`); `src/interfaces/http/llm/spend.controller.ts:147` (`getProjectSpendTeam`)
- **Teste:** `test/application/use-cases/llm/spend-audiencias.use-case.spec.ts` (recorte por projeto com sessão, 404 entre workspaces, membro sem provider); `test/interfaces/spend.controller.spec.ts` (papéis das rotas)
- **Origem:** AT-632

<a id="rn-953"></a>

### RN-953 — O não-owner vê o PRÓPRIO consumo no workspace, somado por projeto {#rn-953}

Convive com a [RN-101](parte-03.md#rn-101): o ator vem do token, nunca da rota.

`GET workspaces/:workspaceId/spend/me` (`viewer`) devolve só as linhas do chamador, por projeto e por dia. Escopo de ator: a dimensão `provider` não compila (RN-187), e a rota não tem parâmetro de dimensão.

- **Código:** `src/application/use-cases/llm/get-my-workspace-spend.use-case.ts:32` (`GetMyWorkspaceSpendUseCase`); `src/interfaces/http/llm/spend.controller.ts:120` (`getMyWorkspaceSpend`)
- **Teste:** `test/application/use-cases/llm/spend-audiencias.use-case.spec.ts` (soma por projeto, nunca a linha de outro ator)
- **Origem:** AT-632

<a id="rn-954"></a>

### RN-954 — A cobrança do modelo é uma marca CURADA, e a assinatura é separada do US$ pago {#rn-954}

Convive com a [RN-665](parte-08.md#rn-665) (custo real do OpenRouter) e o preço congelado do ADR 0042.

1. **Marca.** `models.billing` é `api` (padrão), `subscription` ou `free`, gravada pela curadoria em `PATCH workspaces/:workspaceId/models/:modelId/billing` (`owner`, o nível de `…/pricing`). O sync nunca a toca e a linha de `token_usage` não muda.
2. **Relatório.** Todo bucket e o total ganham `assinaturaMicros` = soma do custo dos modelos `subscription`, contida em `costMicros`; o pago em US$ é `costMicros − assinaturaMicros`.

- **Código:** `src/db/schema/llm.ts:175` (`modelBillingEnum`); `src/infrastructure/persistence/drizzle/token-usage.repository.ts:430` (`assinaturaMicros`); `src/interfaces/http/llm/models.controller.ts:302` (`updateBilling`)
- **Teste:** `test/application/use-cases/llm/spend-audiencias.use-case.spec.ts` (assinatura separada do pago)
- **Origem:** AT-632

<a id="rn-958"></a>

### RN-958 — O usage do 9Router é corrigido no provider: −2 000 só na 0.5.112, e o cache do topo conta {#rn-958}

Completa a [RN-666](parte-08.md#rn-666) (item 4) para o 9Router. A 0.5.112 SOMA 2 000 a `prompt_tokens` no frame final, inclusive sobre o usage que ele mesmo estima; gravar como veio inflava o `input_tokens` e, pela [RN-665](parte-08.md#rn-665), o custo.

1. **Só na versão conhecida.** O provider lê `currentVersion` de `GET <origem>/api/version` (público, teto de 2 s, cache de 5 min no sucesso e 1 min na falha) antes do stream. Só a versão da tabela (`0.5.112`) tem `prompt_tokens` reduzido em 2 000, com piso em 0; subtrair numa versão que consertou o bug gravaria MENOS do que foi cobrado.
2. **Versão outra ou ilegível** (404, lento, corpo inválido): grava como veio e loga UM aviso por versão. O turno nunca falha por causa da leitura.
3. **Cache.** `cached_tokens` do TOPO do usage vira `prompt_tokens_details.cached_tokens` (e então `cachedInputTokens`) quando este não veio; ausente continua "não disse" ([RN-666](parte-08.md#rn-666) item 2).
4. **Declarado, não remendado.** Em `cc/*` o 9Router descarta `cache_read_input_tokens` ao filtrar o usage no stream, então o cache desse upstream NÃO chega ao Brabo; `cache_creation` não tem coluna; o caminho sem stream não existe na base.
5. **Hook opcional** `normalizarUsage` em `OpenAICompatibleConfig`: só o 9Router o configura; os demais providers leem o usage como sempre.

- **Código:** `src/infrastructure/llm/nine-router-provider.ts:118` (`normalizarUsage9Router`); `:99` (`versaoDo9Router`); `src/infrastructure/llm/openai-compatible-provider.ts:188` (`normalizarUsage`)
- **Teste:** `test/infrastructure/llm/nine-router-provider.contract.spec.ts` (versão 0.5.112, outra, 404, lenta, corpo inválido, piso, cache do topo, outros providers sem o hook)
- **Origem:** AT-638

<a id="rn-959"></a>

### RN-959 — O 503 do 9Router que embrulha um 4xx do upstream é classificado pelo status de dentro {#rn-959}

- **Regra:** completa a [RN-864](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-864) e a RN-909. Quando todas as contas do 9Router estão em cooldown por um 4xx do upstream, ele responde 503 com `[<status>]: <msg> (reset after Ns)`. O provider lê o status de dentro: 404 vira `model_not_found`, 401/403 `auth`, 402 `insufficient_credit` (RN-730), 429 `rate_limit`. 5xx de dentro, ausente ou corpo sem `reset after` seguem `upstream` passageiro. A forma do corpo vem da leitura do bundle do 9Router 0.5.112; o smoke com chave a confirma.
- **Onde:** `src/infrastructure/llm/nine-router-provider.ts:153` (`classificarErro9Router`), aplicado por `src/infrastructure/llm/openai-compatible-provider.ts:305` (`classificarErroHttp`).
- **Teste:** `test/infrastructure/llm/nine-router-provider.contract.spec.ts` (503 com cada status interno e os três casos que seguem `upstream`); `apps/engine/test/engine/agents/falha_de_turno_test.exs` (`model_not_found` não é passageira).
- **Origem:** AT-639 (EP-026).

<a id="rn-960"></a>

### RN-960 — O `GraphStore` reconecta depois de boot sem Neo4j, e o aviso diz a causa {#rn-960}

- **Regra:** refina o ADR 0099. Boot em que o Neo4j ainda não respondia deixava o driver `null` para a vida do processo. Agora, com config presente, a operação seguinte tenta conectar de novo, no máximo uma vez a cada 30 s; sem config nunca tenta, e `onModuleInit` segue sem lançar. O aviso do `GraphProjector` inclui a causa do erro do driver.
- **Onde:** `src/infrastructure/graph/graph-store.ts:114` (`reconectarSeNecessario`), `src/application/graph-projection/graph-projector.ts:106` (`drainOnce`).
- **Teste:** `test/infrastructure/graph/graph-store.spec.ts` ("RN-960"), `test/application/graph-projection/graph-projector.spec.ts` ("RN-960").
- **Origem:** AT-642 (EP-030).

<a id="rn-961"></a>

### RN-961 — O aviso de recorte diz que as ferramentas fora dele podem ser pedidas neste passo {#rn-961}

- **Regra:** revisa a [RN-759](parte-10.md#rn-759) (decisão do dono de 31/10, AT-643). O aviso `system` efêmero do passo recortado não diz mais que as ferramentas fora do recorte "voltam nas próximas voltas" nem que ela "volta no seguinte": o recorte é do PASSO, e a RN-759 mandava o agente esperar por um passo que, para o modelo, pode não vir. O texto novo diz a verdade do ADR 0179: as demais seguem disponíveis e podem ser pedidas neste mesmo passo, e o agente não deve concluir que não tem a ferramenta nem encerrar o turno esperando por ela; se precisar de uma delas e responder sem ferramenta, o passo é refeito com o catálogo completo (a repetição da regra 10 do ADR 0179, pelo mecanismo que a fachada já tem). Não muda o piso, a política do Jev nem a montagem do menu: só o texto do aviso.
- **Onde:** `src/domain/llm/tool-router.ts:420` (`avisoDeRecorte`).
- **Teste:** `test/domain/llm/aviso-de-recorte.spec.ts` (fixa o texto novo e reprova o antigo, "voltam nas próximas voltas" e "volta no seguinte").
- **Origem:** AT-643 (EP-030): o `write_file` e o `terminal` saíam do menu do dev no Jev, e o aviso mandava esperar por uma volta que o modelo não tinha como pedir.

<a id="rn-964"></a>

### RN-964 — O preço e a cobrança são curados na tela de Providers, e a edição manual protege o número do sync {#rn-964}

Completa a [RN-044](parte-01.md#rn-044) (o caminho manual passa a marcar `manual_pricing`), a [RN-954](#rn-954) (a marca ganha tela) e a [RN-963](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-963) (a mesma frase para a assinatura sem preço).

1. **Edição manual marca.** Mudar o preço com origem `manual` grava `manual_pricing = true` na mesma escrita do preço. Origem `sync` não mexe na marca.
2. **O sync respeita a marca.** Linha `manual_pricing` mantém o preço gravado mesmo quando o catálogo remoto traz outro; só o catálogo sem preço e a linha não-manual seguem o remoto.
3. **Preço igual ao vigente segue no-op** (RN-044): não grava marca nova nem linha de auditoria.
4. **Escopo.** `models` é GLOBAL da instalação: o preço vale para todos os workspaces. A tela diz isso em texto.

- **Código:** `src/application/use-cases/llm/update-model-pricing.use-case.ts:51` (`manualPricing`); `src/application/use-cases/llm/sync-model-catalog.use-case.ts:286` (`resolverPreco`)
- **Teste:** `test/application/use-cases/llm/update-model-pricing.use-case.spec.ts` (edição manual marca `manualPricing`; origem sync não marca)
- **Origem:** AT-634

<a id="rn-965"></a>

### RN-965 — O catálogo sugere o preço do FABRICANTE do modelo e a faixa de cobrança do 9Router, e quem aplica é o humano {#rn-965}

Completa a [RN-964](#rn-964) (curadoria de preço na tela) e a [RN-954](#rn-954) (marca `billing`), por decisão do dono de 01/11 (AT-640): o preço de um modelo é o que o fabricante dele publica, qualquer que seja o provider que o serve.

1. **Tabela curada no domínio, sem raspar página.** Cada linha de `PRECOS_DO_FABRICANTE` cobre ids exatos e guarda o preço em micros, o link da fonte (domínio do fabricante, conferido por teste) e a data em que foi conferida. A primeira entrega traz só a Anthropic; fabricante novo entra por PR, com a fonte conferida.
2. **Casamento por igualdade exata.** No `9router` sai só o primeiro segmento (o alias) antes de casar; nos demais providers o nome fica como está. Variante que não casa fica "sem sugestão", nunca adivinhada. O `openrouter` fica fora de propósito: o preço dele vem do sync e o custo real do `usage.cost` ([RN-665](parte-08.md#rn-665)).
3. **Faixa pelo alias do 9Router 0.5.112**, calculada na leitura e sem gravar: `cc`/`cx` → `subscription`; alias `ollama` ou id terminado em `:free`, `/free` ou `-free` → `free`; o resto → `api`. Sem credencial do painel.
4. **Sugestão, não escrita.** A rota de curadoria devolve `sugestao` por modelo; nada é gravado sozinho (ADR 0042). Quem aplica é o `owner`, pela tela da [RN-964](#rn-964).

- **Código:** `src/domain/llm/sugestao-do-catalogo.ts:18` (`sugestaoDoModelo`); `src/domain/llm/precos-do-fabricante.ts:96` (`precoDoFabricante`)
- **Teste:** `test/domain/llm/sugestao-do-catalogo.spec.ts` (alias, grátis, assinatura, openrouter sem sugestão, igualdade exata); `test/domain/llm/precos-do-fabricante.spec.ts` (id repetido, data futura, preço inválido, link fora do domínio)
- **Origem:** AT-640

<a id="rn-966"></a>

### RN-966 — O 9Router 0.5.112 faz três coisas por trás: `off` desliga RTK/Headroom/Caveman/Ponytail e não o Custom Prompt; o OAuth do Claude redige o raciocínio; e camufla as ferramentas {#rn-966}

- **Regra:** completa a [RN-909](parte-10.md#rn-909) com o que o build 0.5.112 do 9Router faz por trás do gateway, medido no bundle e declarado sem código novo. (1) O cabeçalho `x-9router-token-saver` com valor `off` (sem caixa) desliga, juntos, o RTK, o Headroom, o Caveman e o Ponytail; o Custom Prompt NÃO passa por ele e segue como o painel o deixou. O provider manda o cabeçalho em toda chamada, e o efeito é confirmado pela medição da AT-631 (`ok` sem ele = 1 262 tokens). (2) Para a conta OAuth do Claude (`cc/*`) o 9Router manda `redact-thinking-2026-02-12` em `Anthropic-Beta`: o pensamento volta redigido e sem `reasoning_tokens`, então a contagem de raciocínio do stream ([RN-915](parte-10.md#rn-915)) e a retentativa sem raciocínio ([RN-916](#rn-916)) ficam cegas nesse caminho, e `reasoning_tokens` grava ausente ("não disse", [RN-666](parte-08.md#rn-666)). (3) Com token `sk-ant-oat` o 9Router renomeia as ferramentas, acrescenta cerca de 20 ferramentas falsas do Claude Code e envia cabeçalhos de Claude Code; não há configuração que desligue isso. O Brabo não corrige nem desliga a camuflagem: o risco é o modelo chamar uma ferramenta falsa e os termos de uso, e por isso o TP-01 voltou ao OpenRouter.
- **Onde:** `src/infrastructure/llm/nine-router-provider.ts:38` (`NINE_ROUTER_TOKEN_SAVER_HEADER`), `src/infrastructure/llm/nine-router-provider.ts:172` (`nineRouterConfig`)
- **Teste:** `test/infrastructure/llm/nine-router-provider.contract.spec.ts:140` (cabeçalho `off` fixado no contrato). Os efeitos (2) e (3) vivem no bundle do 9Router, não no repositório: não há teste deles, e o smoke com chave é o único que os exercitaria.
- **Origem:** AT-641 (EP-026), levantamento de 31/10 sobre o 9Router 0.5.112 (`chunks/8895.js`, `chunks/8499.js`, `chunks/2380.js`, `chunks/2598.js`), derivado da AT-631.

<a id="rn-969"></a>

### RN-969 — A ocupação da janela do agente na sessão é o `input_tokens` da última chamada dele, fora o Jev {#rn-969}

Completa a [RN-101](parte-03.md#rn-101) (consumo por agente) sem rota nova: `GET projects/:projectId/sessions/:sessionId/token-usage` passa a trazer `lastCall` por agente.

1. **Última chamada.** `lastCall = { inputTokens, modelName, contextWindow }` é a linha mais recente de `token_usage` do agente na sessão; o `input_tokens` dela é o que ela pôs na janela.
2. **Jev fora.** As linhas com `model_name = MODELO_DO_JEV` são ignoradas (ele grava em nome do agente, ADR 0179); agente só com Jev tem `lastCall: null`.
3. **Janela do modelo daquela chamada** (LEFT JOIN `models`), não a do binding vigente. `context_window` nulo vira `contextWindow: null`: "não sei", nunca 0%.
4. **As somas não mudam**, e nenhuma requisição nova nasce (RN-632).
5. **Onde a tela mostra (decisão do dono, 02/11).** Na topbar da Sessão, ao lado do medidor de orçamento, do agente DESTINATÁRIO do composer: gatilho em porcentagem (`—` com janela nula, nunca 0%) e cartão "N de M tokens na última chamada · modelo". Lê a MESMA `queryKey` `['session-token-usage', …]` de `session-destinatario.ts`, sem poll próprio; sem chamada, sem destinatário ou 403, nada aparece.

- **Código:** `src/infrastructure/persistence/drizzle/token-usage.repository.ts:155` (`sumBySessionGroupedByActor`); `apps/web/src/routes/JanelaDoAgente.tsx:12` (`JanelaDoAgente`); `apps/web/src/lib/session-destinatario.ts:223` (o `actorId` é o mesmo id que alimenta as opções do destinatário)
- **Teste:** `test/infrastructure/persistence/token-usage.repository.spec.ts` (lastCall: última chamada, Jev ignorado, janela nula, ator só com Jev); `apps/web/src/routes/SessionTopbar.test.tsx` (porcentagem, janela nula, sem chamada)
- **Origem:** AT-654

<a id="rn-983"></a>

### RN-983 — O clique numa fonte consultada é gravado em tabela própria e nunca é voto {#rn-983}

- **Regra:** o clique num link do bloco "Consultado neste turno" (RN-982) vira uma linha em `source_clicks`, de escopo de PROJETO como `rag_searches` (RN-479): `projectId`, `sessionId` (anulável), `eventId` (o `agent.response`), `tipo`, `ref`/`searchId`/`chunkId` e o usuário que clicou, congelados sem FK de sessão/evento. NÃO é voto: o único sinal de verdade do RAG segue sendo o `rag_feedback` (RN-480), que esta tabela nunca alimenta, porque clique mede curiosidade. `POST /projects/:projectId/source-clicks` é `viewer` (quem lê pode clicar). Gravar a medição nunca derruba o que ela mede: a falha vira log de origem `infra` e `null` explícito, e o clique navega do mesmo jeito. No web, o clique dispara o POST sem esperar a resposta (um POST por clique, sem poll nem query nova, RN-579); fonte que é só texto não grava.
- **Onde:** `src/application/use-cases/rag/record-source-click.use-case.ts:18` (`execute`), `src/db/schema/rag.ts:299` (`sourceClicks`), `src/interfaces/http/rag/source-clicks.controller.ts:36` (`registrar`), `apps/web/src/lib/api-client.ts:1456` (`sendSourceClick`).
- **Teste:** `test/application/use-cases/rag/record-source-click.use-case.spec.ts`, `apps/web/src/components/ai-elements/sources.test.tsx` ("RN-983"), `test/interfaces/route-surface.spec.ts`.
- **Origem:** AT-716 fatia 4 (EP-031).

<a id="rn-984"></a>

### RN-984 — O acesso rápido por papel só existe com `BRABO_AMBIENTE=local` {#rn-984}

`GET`/`POST /auth/dev-login` listam os papéis e emitem a sessão de uma conta
`<papel>@brabo.dev` (`owner`, `maintainer`, `developer`, `viewer`) sem
credencial. Só existem quando `BRABO_AMBIENTE=local` E a imagem não traz marca
ou traz `local` (ADR 0245): fora disso o módulo não é registrado e a rota dá
404. A imagem das Actions sai marcada `dev` ou `prd` no build, então nem
`BRABO_AMBIENTE=local` no `.env` a liga. A rota resolve só o e-mail fixo do
papel, emite pelo mesmo `EmitirSessaoUseCase` do login, audita `dev_login` e,
na instalação, garante as contas com senha ALEATÓRIA descartada num workspace
próprio (a RN-546 fica intacta: não há senha conhecida). Sem nenhum usuário
na instalação responde 409.

- **Onde:** `src/infrastructure/security/ambiente.ts:13`
  (`acessoRapidoLigado`), `src/interfaces/http/acesso-rapido/acesso-rapido.controller.ts:34`
  (`AcessoRapidoController`), `src/application/use-cases/acesso-rapido/acesso-rapido.use-case.ts:27`
  (`AcessoRapidoUseCase`)
- **Teste:** `test/infrastructure/security/ambiente.spec.ts`,
  `test/interfaces/http/acesso-rapido/acesso-rapido.http.spec.ts`,
  `test/application/use-cases/acesso-rapido/acesso-rapido.use-case.spec.ts`,
  `scripts/ci/ambiente-nas-actions.spec.ts`, `e2e/testes/autenticacao.spec.ts`

<a id="rn-986"></a>

### RN-986 — O anexo do chat aceita texto/código e imagem, com tipo pelos bytes e tetos {#rn-986}

- **Regra:** `POST /projects/:projectId/sessions/:sessionId/attachments` (`developer`, JSON `{nome, base64}`) guarda o arquivo em `chat_attachments`. O MIME sai dos BYTES, nunca do nome nem do cabeçalho: png, jpeg, gif e webp pela assinatura; texto/código se for UTF-8 válido e sem byte NUL (`text/plain`); o resto é 415. Tetos: 5 MB por imagem e 512 KB por texto, acima disso 413 (rejeita, nunca trunca). Sessão encerrada recusa com o 409 `sessao_encerrada` da RN-581. JSON com base64 em vez de multipart porque 5 MB viram ~6,7 MB e cabem no corpo de 10 MB (`main.ts`), sem parser novo. Sem antivírus, lacuna declarada em `docs/security-surface.md` e no ADR 0246.
- **Onde:** `src/domain/sessions/anexos.ts:32` (`classificarAnexo`), `src/application/use-cases/sessions/anexos-do-chat.use-case.ts:37` (`enviar`), `src/interfaces/http/sessions/attachments.controller.ts:54` (`enviar`), `src/db/schema/sessions.ts:303` (`chatAttachments`).
- **Teste:** `test/application/use-cases/sessions/anexos-do-chat.use-case.spec.ts` ("RN-986"), `test/interfaces/route-surface.spec.ts`.
- **Origem:** AT-715 fatia 1, lane L1 (EP-031), ADR 0246.

<a id="rn-987"></a>

### RN-987 — O `chat.message` guarda só a referência do anexo, nunca os bytes {#rn-987}

- **Regra:** `POST .../agents/:agent/message` aceita `anexos?: string[]` (ids), no máximo 4, todos da MESMA sessão e do MESMO autor — senão 400. O evento grava `anexos: [{id, nome, mime, tamanho}]`; o log é append-only e não incha com bytes. A mesma lista de referências viaja ao engine em `anexos` (omitida quando vazia). Quem precisa dos bytes (L2, a api na chamada ao provider) os lê pelo `ChatAttachmentRepository`.
- **Onde:** `src/application/use-cases/sessions/anexos-do-chat.use-case.ts:91` (`referencias`), `src/application/use-cases/agents/send-agent-message.use-case.ts:67` (`execute`), `src/infrastructure/http-clients/api-to-engine-client.ts:210` (`sendAgentMessage`), `src/interfaces/http/agents/dto/send-agent-message.dto.ts:34` (`anexos`).
- **Teste:** `test/application/use-cases/sessions/anexos-do-chat.use-case.spec.ts` ("RN-987").
- **Origem:** AT-715 fatia 1, lane L1 (EP-031), ADR 0246.

<a id="rn-988"></a>

### RN-988 — Todo `viewer` do projeto lê o anexo, escopado a projeto e sessão {#rn-988}

- **Regra:** `GET .../attachments/:attachmentId` (`viewer`) devolve os bytes com o `Content-Type` gravado, `X-Content-Type-Options: nosniff` e `Content-Disposition: attachment` para o que não é imagem. A consulta casa id, projeto E sessão: anexo de outra sessão ou projeto é 404, igual ao inexistente. Quem vê o evento vê o anexo (decisão do dono, 02/11). Os anexos morrem com a sessão (cascade).
- **Onde:** `src/application/use-cases/sessions/anexos-do-chat.use-case.ts:80` (`ler`), `src/interfaces/http/sessions/attachments.controller.ts:87` (`ler`).
- **Teste:** `test/application/use-cases/sessions/anexos-do-chat.use-case.spec.ts` ("RN-988"), `test/interfaces/route-surface.spec.ts`.
- **Origem:** AT-715 fatia 1, lane L1 (EP-031), ADR 0246.

<a id="rn-989"></a>

### RN-989 — Imagem só vai a modelo com visão provada; sem ela, o agente é avisado {#rn-989}

- **Regra:** o `llm-turn` aceita no `content` de uma mensagem uma lista de partes `{type:'text',text}` e `{type:'anexo',id}` (o engine manda o id, nunca bytes). A api troca o id pelo anexo da MESMA sessão (`ChatAttachmentRepository.find`): imagem vira parte `image` (data URL no formato OpenAI) SÓ quando o provider declara `capabilities.vision` E o modelo tem `supports_vision` — as duas camadas do ADR 0041; `vision` nasce `false` em todos e só vira `true` com smoke real: hoje é `true` SÓ no OpenRouter, PROVADO em 2026-11-03 por `test/infrastructure/llm/openrouter-provider.visao.smoke.spec.ts` (AT-715) com `google/gemini-2.5-flash` e um PNG 8x8 vermelho — o modelo respondeu "red". Os outros dez seguem `false`. Sem as duas, a imagem não sai da api e entra no lugar o texto `[imagem <nome> não enviada: o modelo atual não lê imagem]`, que é o aviso ao agente. Anexo de texto vai delimitado (`[anexo: <nome>]` … `[fim do anexo: <nome>]`) com ou sem visão; id que não resolve vira `[anexo <id> indisponível]`. Texto puro continua `string`. Os tokens da imagem entram no metering pelo `usage` do provider (ADR 0188), sem código novo.
- **Onde:** `src/domain/llm/anexos-no-turno.ts:23` (`resolverAnexos`), `src/application/use-cases/llm/run-llm-turn.use-case.ts:173` (`resolverAnexos`), `src/application/use-cases/llm/stream-llm-turn.use-case.ts:186` (`resolverAnexos`).
- **Teste:** `test/domain/llm/anexos-no-turno.spec.ts`, `test/infrastructure/llm/openai-compatible-provider.visao.spec.ts`; prova da capability: `test/infrastructure/llm/openrouter-provider.visao.smoke.spec.ts` (manual, com credencial).
- **Origem:** AT-715 fatia 1, lane L2 (EP-031), ADR 0246.

<a id="rn-991"></a>

### RN-991 — Uma mensagem pode ter vários destinatários, e o log diz quais {#rn-991}

- **Regra:** `POST /projects/:projectId/sessions/:sessionId/messages` (`developer`) recebe `destinatarios` (1 a 7) e grava UM `chat.message` com `payload.destinatarios`; a rota de um agente só grava `[agent]`. Cada agente recebe a entrega com o MESMO `mensagemId`, pelo caminho de sempre (turno, fila RN-673, recusa nomeada do engine). Quem o engine recusa vem como `recusada` com `motivo`, sem derrubar os outros; sessão encerrada é 409 `sessao_encerrada` (RN-581). Com o `mensagemId` repartido, `chat.message_delivered` e `chat.message_cancelled` só fecham a cópia do agente a que se referem. Revisa a RN-584/631.
- **Onde:** `src/application/use-cases/agents/send-agent-message.use-case.ts:96` (`executeVarios`), `src/interfaces/http/agents/agents.controller.ts:115` (`messages`), `apps/engine/lib/engine/agents/fila_de_mensagens.ex:76` (`pendentes`).
- **Teste:** `test/application/use-cases/agents/send-message-to-agents.use-case.spec.ts`, `apps/engine/test/engine/agents/fila_de_mensagens_test.exs`.
- **Origem:** AT-717 (EP-031), ADR 0247.

<a id="rn-993"></a>

### RN-993 — O raciocínio do modelo é gravado inteiro fora do `content`, aparece ao vivo e só `developer` ou mais o lê; nunca volta ao modelo {#rn-993}

- **Regra:** o provider devolve o TEXTO do raciocínio como chunk `reasoning` (`delta.reasoning` do OpenRouter, `delta.reasoning_content` do dialeto DeepSeek/vLLM, `thinking_delta` da Anthropic) e nunca no `content`. O `stream-llm-turn` repassa cada pedaço como frame `raciocinio` e o frame `final` leva `raciocinio` com o texto INTEIRO do passo, sem corte; o `llm-turn` sem stream devolve o mesmo campo. A Anthropic recebe `thinking` quando o modelo raciocina e o raciocínio não foi desligado: `adaptive` com `display: "summarized"` e sem `budget_tokens` nos modelos atuais (4.6 em diante e a família 5; o `display` padrão devolveria texto vazio, e o texto que chega é um RESUMO, nunca o bruto), `enabled` com `budget_tokens` nos antigos (`pensamentoAdaptativo`, `src/infrastructure/llm/anthropic-provider.ts:559`); `reasoningOff` não manda `thinking`. Os blocos `thinking` assinados voltam em `message.thinkingBlocks` para o engine devolvê-los intactos no turno `assistant` que pediu ferramentas. O engine grava o texto em `agent.response.payload.raciocinio` (lane do engine) e ele não entra na reidratação, no RAG nem no grafo. As leituras de evento da sessão (`GET .../events`, `GET .../events/:eventId` e o evento por id da Anamnese) tiram `payload.raciocinio` de `agent.response` para papel efetivo abaixo de `developer` (`projectRole ?? workspaceRole`, RN-471), por UM filtro de saída. A capability `reasoningText` é `false` em todos os providers até haver smoke com credencial (ADR 0041).
- **Capability:** `reasoningText` é `true` só na Anthropic e no OpenRouter, PROVADA com credencial real em 2026-11-03: `anthropic-provider.raciocinio.smoke.spec.ts` (`claude-haiku-5-5` e `claude-sonnet-5-5`, saída 0 nos dois; o texto é o RESUMO do raciocínio, `display: summarized`, nunca o bruto) e `openrouter-provider.raciocinio.smoke.spec.ts` (`deepseek/deepseek-r1-0528`, o `deepseek/deepseek-r1` saiu do OpenRouter e dá 404). Os outros nove providers seguem `false`; ligar outro exige o smoke equivalente com credencial.
- **Onde:** `src/infrastructure/llm/openai-compatible-provider.ts:381` (`textoDoRaciocinio`), `src/infrastructure/llm/anthropic-provider.ts:536` (`toThinkingBlocks`), `src/domain/sessions/raciocinio-do-evento.ts:16` (`filtrarRaciocinio`), `src/interfaces/http/sessions/sessions.controller.ts:260` (`listEvents`), `:333` (`getEvent`), `src/application/use-cases/sessions/create-socket-ticket.use-case.ts:69` (`podeVerRaciocinio` no ticket do socket, coluna `session_socket_tickets.pode_ver_raciocinio`, que o engine lê ao consumi-lo, RN-108). Engine (AT-676): o `RaciocinioDoTurno` acumula o raciocínio do turno e `TextoDoTurno.payload_do_turno` o grava como `raciocinio`/`raciocinioTotal` fora do `content`; devolve os `thinkingBlocks` na mensagem `assistant` com `toolCalls` (`apps/engine/lib/engine/agents/raciocinio_do_turno.ex:47` (`anexar_blocos`)); o frame `raciocinio` do stream vira o evento efêmero `agent.reasoning_delta` (`apps/engine/lib/engine/sessions/engine_api_client.ex:1848` (`consume_sse`)); e o `intercept` do canal `session:<id>` só entrega o delta, e só deixa `raciocinio` no `agent.response`, ao socket cujo ticket tem `pode_ver_raciocinio` (`apps/engine/lib/engine_web/channels/session_channel.ex:42` (`handle_out`)). Coluna ausente ou nula conta como falso.
- **Teste:** `test/infrastructure/llm/raciocinio-texto.spec.ts` (os dois campos, `thinking_delta`, adaptive/summarized × enabled por modelo, blocos devolvidos no corpo seguinte, `reasoningText` falso), `test/domain/sessions/raciocinio-do-evento.spec.ts` (`viewer` não recebe, `developer`+ recebe), `test/application/use-cases/sessions/create-socket-ticket.use-case.spec.ts` (ticket `true` para `developer`, `false` para `viewer`), `test/application/use-cases/llm/stream-llm-turn.use-case.spec.ts` e `run-llm-turn.use-case.spec.ts` (frame `raciocinio`, `final` com o texto inteiro, `content` intacto); smoke manual `openrouter-provider.raciocinio.smoke.spec.ts`. Engine: `apps/engine/test/engine/agents/raciocinio_do_turno_test.exs` (frame acumula e `final` substitui, payload com `content` intacto, reidratação sem raciocínio, `thinkingBlocks` na 2ª chamada) e `apps/engine/test/engine_web/channels/session_channel_test.exs` (`intercept` com e sem a flag).
- **Origem:** AT-676 (EP-031), lane api; ADR 0249.

<a id="rn-995"></a>

### RN-995 — O catálogo do agente vem do engine e é só leitura: identidade e ferramentas do engine, instrução vigente do banco, sem prompt composto e sem schema, e engine fora do ar é "não sei", nunca "sem ferramentas" {#rn-995}

- **Regra:** `GET /projects/:projectId/agent-catalog` (`viewer`, RN-102) devolve, por agente, a identidade do código, a instrução VIGENTE do projeto (`agent_instructions`, só a versão atual) e as ferramentas (`nome` e `descricao`, o texto em pt-BR que o modelo lê; os outros idiomas caem nele, ADR 0216). A fonte das ferramentas e da identidade é o engine, por `GET /internal/agents/catalog` (service token) — uma fonte só, sem cópia na api. Não expõe `parameters` (o JSON schema), o prompt composto do turno, o template do grafo nem credencial ou modelo. É o catálogo COMPLETO: o recorte por passo do Jev (RN-625) pode mostrar menos ao modelo. Leitura contida (ADR 0060): uma chamada ao engine e uma consulta ao banco, sem parâmetro livre; `conteudo` corta em 8 000 caracteres com `conteudoTotal` (molde da RN-589) e `descricao` em 1 000. Engine fora do ar: `identidade` e `ferramentas` vêm `null` com `motivoSemCatalogo: 'engine_indisponivel'` e as instruções do banco continuam vindo (RN-470). Os dev agents por módulo (`dev-api`) herdam a entrada única `dev-*` do engine. No engine: `GET /internal/agents/catalog` (service token, sem parâmetro) devolve, por agente, a identidade do código e as ferramentas (`nome`, `descricao` até 1 000 caracteres). A fonte é o `tool_specs/0` de cada um dos sete conversacionais e os registros de execução e de gate; nada é copiado. Não devolve `parameters`, o prompt composto nem o template do grafo. É o catálogo COMPLETO: o Jev (RN-625) recorta o menu por passo. Psicólogo e Anamnese ficam fora.
- **Onde:** `src/application/use-cases/agents/get-agent-catalog.use-case.ts:39` (`execute`), `src/infrastructure/http-clients/api-to-engine-client.ts:280` (`getAgentCatalog`), `src/interfaces/http/agents/agent-catalog.controller.ts:32` (`get`); lado do engine: lane E1 da AT-686 (`Engine.Agents.CatalogoDeFerramentas`); engine: `apps/engine/lib/engine/agents/catalogo_de_ferramentas.ex:38` (`listar`), `apps/engine/lib/engine_web/controllers/agent_catalog_controller.ex:9` (`index`), `apps/engine/lib/engine_web/router.ex:79`, `apps/engine/lib/engine/agents/po_server.ex:845` (`tool_specs`).
- **Teste:** `test/application/use-cases/agents/get-agent-catalog.use-case.spec.ts` (junção, tetos, `dev-*`, engine fora), `test/interfaces/route-surface.spec.ts` (a rota e o papel); engine: `apps/engine/test/engine/agents/catalogo_de_ferramentas_test.exs` (bate com cada fonte, teto da descrição, 401 sem token e 200 com).
- **Origem:** AT-686 (EP-031), lanes A1 (api) e E1 (engine).

<a id="rn-997"></a>

### RN-997 — O catálogo da Anthropic nasce com preço de lista datado e `supportsReasoning` do SDK; preço manual nunca é sobrescrito {#rn-997}

- **Regra:** a `/v1/models` da Anthropic não informa preço, e o modelo sincronizado nascia com preço 0 (gasto de custo zero, sem aviso). O `listModels` devolve o preço da tabela ÚNICA do fabricante da [RN-965](#rn-965) (`precoDoFabricante`, micro-USD por milhão), casando pelo ID e, se não achar, pelo ID sem o sufixo de data (`-AAAAMMDD`); ID fora da tabela segue sem preço ([RN-042](parte-01.md#rn-042)). `supportsReasoning` vem de `capabilities.thinking.supported` do SDK; com `capabilities` nulo vale a família (todo `claude-` que não seja 3.x raciocina). O sync trata o preço como já tratava (RN-044): linha `manual_pricing` vence sempre, e modelo novo COM preço de lista nasce `manual_pricing = false`. O preço congelado no metering não muda. Linha antiga já `manual_pricing = true` (nascida sem preço) segue como está: corrigi-la é a curadoria do `owner`.
- **Onde:** `src/infrastructure/llm/anthropic-provider.ts:544` (`precoDeLista`), `src/domain/llm/precos-do-fabricante.ts` (`PRECOS_DO_FABRICANTE`, `precoDoFabricante`), `src/application/use-cases/llm/sync-model-catalog.use-case.ts` (`resolverPreco`).
- **Teste:** `test/infrastructure/llm/anthropic-provider.catalogo.spec.ts` (preço com e sem sufixo de data, ID desconhecido sem preço, `supportsReasoning`); `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts` (preço manual não é sobrescrito).
- **Origem:** pedido do dono de 03/11; ADR 0251 (referencia o [0042](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)).

<a id="rn-1000"></a>

### RN-1000 — Na Anthropic direta o raciocínio desligado é POR MODELO, o adaptativo ganha a folga e o `thinking_tokens` chega ao metering {#rn-1000}

- **Regra:** revisa a [RN-741](parte-10.md#rn-741) e a [RN-782](parte-10.md#rn-782)/[RN-783](parte-10.md#rn-783) para o provider `anthropic`. A frase da RN-741 "o `anthropic-provider` direto não envia `thinking`, então o modelo não raciocina" ficou falsa: nos modelos de pensamento ADAPTATIVO (os 5.5) omitir o `thinking` é o adaptativo no esforço padrão, e o Haiku 5.5 pensava até o `max_tokens` com o raciocínio "desligado" (TP-01 de 05/11: 10 de 10 tarefas bloqueadas com "resposta só de raciocínio"). (1) Com `reasoningOff` o corpo é POR MODELO (`raciocinioDesligado`, decisão do dono de 05/11): Haiku 5.5 → `thinking: { type: 'disabled' }` (desligado de verdade, sem folga); Sonnet 5.5 → `thinking: { type: 'between_tools' }` (pensa só entre chamadas de ferramenta, com folga); Opus 5.5 → `output_config: { effort: 'low' }` com folga, DECLARADO como REDUZIDO, não desligado — o `disabled` é 400 no Opus e no Sonnet 5.5; modelo adaptativo desconhecido → nada (o padrão do modelo) com a folga, porque reduzir exige prova; modelo antigo (3.x, 4.0..4.5) sem `thinking` não pensa, e omitir já é desligar. (2) Com o raciocínio ligado no adaptativo, o `max_tokens` é a saída visível + `reasoningBudget ?? 4096` — a mesma folga da RN-741, porque ali o teto é TOTAL (antes ficava 4096 TOTAL e a Infra era cortada). (3) O provider declara `aceitaRaciocinioDesligado: true` ([RN-916](#rn-916)). (4) `reasoningTokens` vem do `usage.output_tokens_details.thinking_tokens` do último `message_delta` (o SDK 0.113 não o copia para a mensagem final), só quando é inteiro >= 0; senão é omitido e a coluna fica NULL ([RN-666](parte-08.md#rn-666)).
- **Prova (smoke pago de 05/11, `ANTHROPIC_TEST_KEY`):** Haiku/Sonnet/Opus 5.5 com `reasoningOff` e uma ferramenta: aceitos, chamaram a ferramenta, sem truncar, `thinking_tokens` 0; `thinking: disabled` no Opus 5.5 → 400 (`"thinking.type.disabled" is not supported for this model`); Haiku 5.5 ligado: 303 de 308 tokens de saída eram raciocínio; trocar o `system` entre duas voltas reenviando o bloco de raciocínio foi ACEITO. Custo: ~US$ 0,009.
- **Onde:** `apps/api/src/infrastructure/llm/anthropic-provider.ts:573` (`corpoDeRaciocinio`), `:614` (`raciocinioDesligado`), `:635` (`tokensDeRaciocinio`), `:81` (`aceitaRaciocinioDesligado`)
- **Teste:** `apps/api/test/infrastructure/llm/raciocinio-texto.spec.ts` (corpo por modelo com `reasoningOff`, folga no adaptativo e com orçamento, `thinking_tokens` do `message_delta` e omitido quando não é inteiro >= 0, a capability), `apps/api/test/infrastructure/llm/anthropic-provider.raciocinio.smoke.spec.ts` (manual, pula sem a chave)
- **Origem:** AT-739 (EP-030), achados 2 e 8 do TP-01 de 05/11; ADR 0257 (revisa o item 4 do [ADR 0223](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0223-orcamento-de-raciocinio-por-modelo.md) para a Anthropic).

<a id="rn-1001"></a>

### RN-1001 — O decorator de tracing repassa `aceitaRaciocinioDesligado`, então a retentativa sem raciocínio roda de verdade {#rn-1001}

- **Regra:** revisa a [RN-916](#rn-916), cujo texto dizia que a capability `aceitaRaciocinioDesligado` do provider era "hoje só do OpenRouter". Agora vale para OpenRouter e Anthropic ([RN-1000](#rn-1000)). Defeito declarado: o `TracedLLMProvider` repassava só `name`, `capabilities`, `chat`, `listModels` e `embed`; como o registry envolve TODO provider, `provider.aceitaRaciocinioDesligado` era `undefined` em produção e a retentativa da RN-916 nunca rodava, para provider nenhum. O decorator agora copia a flag do provider envolvido no construtor (`undefined` continua `undefined`: provider que não a declara não a expõe). Os outros membros opcionais da porta `LLMProvider` (`listModels`, `embed`) já eram repassados.
- **Código:** `apps/api/src/infrastructure/llm/traced-llm-provider.ts:78` (`aceitaRaciocinioDesligado`)
- **Teste:** `apps/api/test/infrastructure/llm/traced-llm-provider.spec.ts` (mantém `true`, continua `undefined`, e o `LLMProviderRegistryImpl.get('anthropic')` real devolve `true`)
- **Origem:** AT-743 (EP-030)

<a id="rn-1002"></a>

### RN-1002 — O agente fecha a pergunta em aberto que o usuário respondeu no chat; a resposta humana e a do agente dividem um núcleo só {#rn-1002}

- **Regra:** estende a [RN-858](parte-10.md#rn-858)/[RN-860](parte-10.md#rn-860) (ADR 0214, decisão do dono de 05/11: o agente fecha). `POST /internal/projects/:projectId/open-questions/:questionId/answer` (token de serviço) recebe `{ sessionId, agentId, resposta?, messageEventId? }` e grava o MESMO par `artifact.decision_record` + `open_question.answered` do clique, por um núcleo compartilhado (`fechar`), e depois retoma o gate de QA estacionado de cada tarefa afetada. O fechamento roda dentro de `runComoEfeitoDeAcao` (RN-848), então o canal da sessão é notificado de `open_question.answered` mesmo com a escrita vindo por `/internal/*` (o contador da web atualiza ao vivo). `respondidaPor` é o autor da sessão de chat (`sessionId`); o agente vai em `viaAgente` (e `messageEventId` quando enviado). Sem `resposta`, a sugestão da pergunta é a resposta; sem nenhuma das duas, 400. Pergunta desconhecida, pergunta de outro projeto ou sessão fora do projeto: 404. Já fechada: `200 { status: 'already_answered' }`, nunca 409 (idempotente para o agente). O `responder` humano não muda (`so_o_autor_da_sessao`, 409).
- **Onde:** `apps/api/src/application/use-cases/backlog/perguntas-em-aberto.use-case.ts` (`responderPeloAgente`, `fechar`), `apps/api/src/interfaces/http/internal/internal-open-questions.controller.ts`.
- **Teste:** `apps/api/test/application/use-cases/backlog/perguntas-em-aberto.use-case.spec.ts` (fecha com `decision_record`, 404 para outro projeto, a segunda chamada dá `already_answered`) e `apps/api/test/interfaces/http/internal/internal-open-questions.controller.spec.ts` (o fechamento roda marcado como efeito de ação).
- **Origem:** AT-741 (EP-030), achado 4 do TP-01 de 05/11; o lado do engine é a RN-1003.

<a id="rn-1004"></a>

### RN-1004 — O plano de execução do Dev Lead é recusado quando um módulo sem tarefa é dependência de um módulo que tem tarefa {#rn-1004}

- **Regra:** estende a [RN-678](parte-09.md#rn-678). `lerPlanoDeExecucao` agora recebe o `module_map` corrente COM o `dependsOn` de cada módulo, não só os nomes. Depois das checagens por tarefa, se um módulo SEM tarefa no plano aparece no `dependsOn` de um módulo que TEM tarefa, o plano é recusado com 400 `plano_de_execucao_invalido`, nomeando o par: "deploy depende de api, que ficou sem tarefa — crie a tarefa de fundação de api". Módulo folha sem tarefa continua legítimo ([RN-709](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-709)); a checagem roda na proposta e na aprovação, como o resto da leitura.
- **Código:** `apps/api/src/domain/execution/plano-de-execucao.ts` (`lerPlanoDeExecucao`), `apps/api/src/application/use-cases/execution/execute-execution-plan.use-case.ts` (`lerPlano`)
- **Teste:** `apps/api/test/domain/execution/plano-de-execucao.spec.ts` (`fundação com dono`: o plano sem `db`/`api` é recusado nomeando `deploy` -> `api`; com tarefa em `db`, `api` e `deploy` ele passa)
- **Origem:** AT-742 (EP-030), achado 9 do TP-01 de 05/11; ADR 0259.
- **Revisão (AT-913):** o módulo ENTREGUE (todas as tarefas `done`) satisfaz a dependência: ver a [RN-1083](#rn-1083), `apps/api/src/domain/execution/plano-de-execucao.ts:39` (`lerPlanoDeExecucao`).

<a id="rn-1005"></a>

### RN-1005 — O claim não entrega a tarefa de um módulo enquanto houver tarefa aberta de um módulo do `dependsOn` direto dele {#rn-1005}

- **Regra:** estende a [RN-678](parte-09.md#rn-678). `claimNext` pula a fila `todo` do módulo M enquanto qualquer tarefa que NÃO está `done` pertencer a um módulo listado no `dependsOn` de M no `module_map` corrente do projeto (a mesma fonte da [RN-1004](#rn-1004)). Só as dependências DIRETAS contam (sem caminhada transitiva); tarefa sem `module` conta para o módulo de uma história de módulo único, como no próprio claim. Sem `module_map`, ou quando M não está nele, o claim se comporta como antes. A tarefa `in_progress` órfã do próprio agente ([RN-856](parte-10.md#rn-856)) não é afetada.
- **Código:** `apps/api/src/infrastructure/persistence/drizzle/backlog.repository.ts` (`claimNext`, `semDependenciaAberta`)
- **Teste:** `apps/api/test/infrastructure/persistence/drizzle/backlog-claim-depends-on.repository.spec.ts` (tarefa aberta em `api` -> `deploy` não recebe nada; `api` concluída -> recebe a tarefa; só a direta; sem mapa)
- **Origem:** AT-742 (EP-030); ADR 0259.
- **Revisão (AT-906, AT-912):** a tarefa arquivada não segura o dependente ([RN-1084](#rn-1084)), e `countClaimableByModule` usa o MESMO predicado: `apps/api/src/infrastructure/persistence/drizzle/backlog.repository.ts:751` (`semDependenciaAberta`), usado em `:413` (`claimNext`) e `:532` (`countClaimableByModule`).

<a id="rn-1007"></a>

### RN-1007 — O Claude Haiku 5.5 na Anthropic direta tem uma folga de raciocínio curada de 12288 tokens {#rn-1007}

- **Regra:** revisa a [RN-1000](#rn-1000), cuja folga adaptativa cai no padrão de 4096 quando `models.reasoning_budget` é NULL. No padrão, um gate que raciocina no `claude-haiku-5-5` recebia `max_tokens` 4096 + 4096 = 8192 no total e era cortado ainda pensando (TP-01 rodada 25, `qa-estrategia`: 8192 de 8192 tokens de saída gastos raciocinando), inclusive um corte COM texto que a [RN-916](#rn-916) não retenta. Dado curado pelo [ADR 0223](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0223-orcamento-de-raciocinio-por-modelo.md): a migration `0083` grava `reasoning_budget = 12288` na linha do catálogo `anthropic` / `claude-haiku-5-5`, então o `max_tokens` adaptativo = saída visível + 12288 (16384 no padrão de 4096). Sem mudança de código: `corpoDeRaciocinio` já lê `reasoningBudget`. A migration é idempotente e não toca outro modelo (nem o mesmo nome sob outro provider, nem outros modelos da Anthropic). Com NULL a folga volta a 4096 (8192 no total). Não adotado: `effort: low` nos gates (a documentação avisa que o agente pula checagens) e transformar o orçamento em `effort`.
- **Código:** `apps/api/src/db/migrations/0083_folga_do_haiku_5_5.sql`, `apps/api/src/infrastructure/llm/anthropic-provider.ts` (`corpoDeRaciocinio`)
- **Teste:** `apps/api/test/db/folga-do-haiku-migration.spec.ts` (só aquela linha, idempotente), `apps/api/test/infrastructure/llm/raciocinio-texto.spec.ts` (12288 dá 16384 e `adaptive`; NULL dá 8192), `apps/api/test/infrastructure/llm/anthropic-provider.folga.smoke.spec.ts` (manual, pago, pulado sem chave)
- **Origem:** AT-743 (EP-030), decisão do dono de 05/11 (folga 12288, teto 16384).

<a id="rn-1008"></a>

### RN-1008 — O provider Anthropic direto usa prompt caching, soma as parcelas de cache na entrada e precifica a chamada pela tabela do fabricante {#rn-1008}

- **Regra:** revisa o item 1 da [RN-892](parte-10.md#rn-892) (`promptCaching` era "só do OpenRouter") e completa a [RN-666](parte-08.md#rn-666) para o provider Anthropic direto. Medido no TP-01 (25º, 05/11): 463 chamadas, 10,12 M tokens de entrada, `cached_input_tokens` = 0, US$ 2,28 dos US$ 2,62 do total foram entrada. (1) O `system` sai como UM bloco, o PREFIXO (as mensagens `system` antes da primeira que não é `system`), levando `cache_control: {type: "ephemeral"}` (TTL de 5 min); a CAUDA (mensagens `system` tardias) não sobe mais para o topo ([RN-1015](#rn-1015)). (2) Mais um ponto vai no último bloco do último turno `user` (resultados de ferramenta são turnos `user`), espelhando a [RN-892](parte-10.md#rn-892); texto vazio não ganha ponto (a [RN-1014](#rn-1014) acrescenta um no penúltimo turno `user`). (3) `usage`: o `input_tokens` da Anthropic é só a parte NÃO cacheada, então `inputTokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens` e `cachedInputTokens = cache_read_input_tokens`; sem os campos, `cachedInputTokens` fica ausente ("não disse", [RN-666](parte-08.md#rn-666)). (4) Custo (opção A do dono, ADR 0188): quando alguma parcela de cache não é zero, o provider emite `costMicros` das quatro parcelas vezes `precoDoFabricante(model)`: entrada 1x, leitura de cache 0,1x (0,05x no Opus 5.5), escrita de cache 1,25x, saída 1x; a api o grava com `priceImplicit` e `catalogCostMicros`. Modelo fora da tabela não emite custo ([RN-042](parte-01.md#rn-042)); sem parcela de cache, o caminho do catálogo já dá o mesmo número. (5) `capabilities.promptCaching` é `true`, provado por `anthropic-provider.cache.smoke.spec.ts` antes do merge.
- **Código:** `apps/api/src/infrastructure/llm/anthropic-provider.ts` (`blocosDeSistema`, `marcarCacheDaConversa`, `usageDeEntrada`)
- **Teste:** `apps/api/test/infrastructure/llm/anthropic-provider.contract.spec.ts` ("prompt caching (RN-1008)": blocos e pontos, ponto na última user, soma do usage, custo pelas quatro parcelas, modelo fora da tabela); smoke `anthropic-provider.cache.smoke.spec.ts` (manual)
- **Origem:** AT-744 (EP-030)


<a id="rn-1009"></a>

### RN-1009 — O merge que fecha uma tarefa acorda os módulos que dependem dela {#rn-1009}

- **Regra:** estende a [RN-1005](#rn-1005) e a [RN-628](parte-08.md#rn-628), reaproveitando o evento `task.became_claimable` da RN-047 / ADR 0045. A [RN-1005](#rn-1005) tornou uma tarefa pegável quando a última tarefa aberta de um módulo do `dependsOn` direto dela vira `done`, mas nada anunciava esse momento, então dev agents ociosos nunca acordavam (TP-01 26º, 06/11). O `settleMerge` agora, na MESMA transação e só quando pelo menos uma tarefa de fato mudou para `done` (merge repetido não grava nada), anexa UMA linha de outbox: `aggregateType: 'task'`, `eventType: 'task.became_claimable'`, `aggregateId` = a primeira tarefa fechada, `payload: { projectId, sessionId, taskId, modules, cause: 'dependency_done' }`. `modules` são os nomes dos módulos do `module_map` corrente cujo `dependsOn` não é vazio. Isso é de propósito mais largo que "os dependentes do módulo desta tarefa" (não precisa ler a história de uma tarefa sem `module`): o acordar a mais custa um claim vazio num agente ocioso, e um agente ocupado o ignora. Sem `module_map`, ou sem nenhum módulo com `dependsOn`, nada é gravado (a RN-1005 também não filtra). Fora do escopo: arquivar a história da dependência (RN-727) também libera os dependentes sem acordá-los.
- **Código:** `apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts` (`settleMerge`, `acordarDependentes`)
- **Teste:** `apps/api/test/application/use-cases/actions/execute-git-action.use-case.spec.ts` ("acorda os dependentes (RN-1009)": uma linha com `cause: dependency_done`, merge repetido não grava nada, sem mapa não grava nada), `apps/api/test/infrastructure/persistence/drizzle/dependente-acorda-no-merge.spec.ts` (Postgres real: `auth` não pega nada antes do merge, a linha existe depois dele e `auth` pega a tarefa)
- **Origem:** AT-746 (EP-030); o lado do engine (outbox -> drain -> acordar -> agente ocioso faz o claim) já existe e é provado por `dev_agent_chain_test.exs`.
- **Revisão (AT-906):** o fechamento por `mark_task done` (RN-797) também acorda: [RN-1081](#rn-1081), `apps/api/src/application/use-cases/execution/mark-task.use-case.ts:26` (`execute`).


<a id="rn-1018"></a>

### RN-1018 — O agente retira uma regra de negócio obsoleta, citando a substituta ou a resposta do usuário; todo leitor a ignora {#rn-1018}

- **Regra:** uma regra de negócio é um evento `artifact.business_rule` e o log é append-only, então uma regra obsoleta ficava para sempre (TP-01 26º, 06/11: o Criativo pediu ao condutor que a "removesse à mão"). `POST /internal/projects/:projectId/business-rules/:ruleId/retire` (token de serviço) recebe `{ sessionId, agentRole, reason, replacedBy?, questionId? }` e anexa `artifact.business_rule_retired { ruleId, reason, storyIds, replacedBy?, questionId? }`, sem cartão de aprovação (decisão do dono de 06/11/2026). (1) Só `criativo` e `po` retiram: qualquer outro papel é 403 `papel_nao_retira_regra`. (2) A chamada precisa citar `replacedBy` (uma regra existente, não retirada e diferente dela mesma, senão 400 `substituta_invalida`) e/ou um `questionId` que o usuário já respondeu (o padrão da [RN-859](parte-10.md#rn-859), senão 409 `pergunta_nao_respondida`); sem nenhum dos dois é 400 `retirada_sem_citacao`. (3) Regra desconhecida é 404, regra já retirada é 409 `regra_ja_retirada`. (4) Cada história (não arquivada) que cita a regra deixa de citá-la e passa a citar `replacedBy` (inclusive história `ready`, sem nova promoção); se uma história ficaria SEM regra (só possível sem `replacedBy`), a retirada inteira é recusada com 409 `historia_ficaria_sem_regra`, e uma história com tarefa `in_progress`/`in_review` recusa com 409 `historia_com_tarefa_em_execucao`; nada é gravado numa recusa. (5) A regra retirada fica no log mas sai de todo leitor que decide: a lista de regras e a cobertura ([RN-164](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-164)), a checagem de duplicata semântica ([RN-681](parte-09.md#rn-681)), os contextos do dev e do psicólogo, a contagem de cobertura do aceite automático e a resolução de `afeta.regras` das perguntas em aberto, e o resumo de contexto por sessão da [RN-844](parte-10.md#rn-844) (contagem e `itensDeRegras`, SQL cru); `create_story`/`complete_story` recusam ligá-la (400).
- **Onde:** `apps/api/src/application/use-cases/backlog/retire-business-rule.use-case.ts` (`execute`), `apps/api/src/application/use-cases/backlog/regras-retiradas.ts` (`idsDeRegrasRetiradas`), `apps/api/src/interfaces/http/internal/internal-business-rules.controller.ts`.
- **Teste:** `apps/api/test/application/use-cases/backlog/retire-business-rule.use-case.spec.ts` (papel, citação faltando, troca, recusa por história sem regra, tarefa em execução, leitores).
- **Origem:** AT-755 (EP-030), parte B da AT-752; a ferramenta do engine e o painel da web vêm depois.

<a id="rn-1014"></a>

### RN-1014 — O provider Anthropic direto também põe um ponto de cache no penúltimo turno `user` {#rn-1014}

- **Regra:** estende o item 2 da [RN-1008](#rn-1008). Além do último turno `user`, `marcarCacheDaConversa` marca o último bloco do PENÚLTIMO turno `user` (resultados de ferramenta são turnos `user`), sob as mesmas regras (sem ponto em texto vazio, em `tool_use` ou em bloco de raciocínio). O penúltimo `user` é onde a chamada anterior do mesmo loop gravou a entrada de cache dela, então a leitura vira um ponto explícito e não depende mais do lookback de uns 20 blocos da Anthropic, que um turno com 7 a 10 chamadas paralelas mais os resultados delas ultrapassa (TP-01 26º, 06/11: PO, Arquiteto e Criativo com 19% a 35% de cache). Conversa com um único turno `user` ganha um ponto. A requisição leva no máximo 3 dos 4 pontos `cache_control` que a Anthropic permite (o prefixo do `system` mais estes dois); um ponto em todo turno `user` passaria do limite e está errado.
- **Código:** `apps/api/src/infrastructure/llm/anthropic-provider.ts` (`marcarCacheDaConversa`, `marcarTurno`)
- **Teste:** `apps/api/test/infrastructure/llm/anthropic-provider.contract.spec.ts` ("(b)" último e penúltimo `user`; "(b2)" o antepenúltimo `user` fica sem marca e a requisição tem no máximo 4 pontos)
- **Origem:** AT-749 (EP-030), parte da api; a parte do engine (blocos de raciocínio por `assistant`) é a RN-1013.

<a id="rn-1015"></a>

### RN-1015 — Na Anthropic direta, as mensagens `system` tardias vão para o fim do último turno `user`, depois do ponto de cache, nunca para o `system` do topo {#rn-1015}

- **Regra:** revisa o item 1 da [RN-1008](#rn-1008) e torna a [RN-622](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-622) / [RN-878](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-878) verdadeiras neste provider. O engine anexa a orientação efêmera (lembrete de idioma, lista de citações, decisões) como mensagens `system` DEPOIS da conversa. Este dialeto só aceita `system` no topo, e o provider as içava para lá, à frente de dezenas de blocos `tool_result` em inglês, então num loop longo o modelo seguia o idioma do contexto recente (TP-01 26º, 06/11: respostas dos `dev-*` em inglês em 38% a 60% a partir da 3ª posição). Agora as mensagens `system` depois da primeira que não é `system` (a CAUDA) viram o ÚLTIMO bloco de texto do ÚLTIMO turno `user`, DEPOIS do bloco que leva o ponto de cache da [RN-1008](#rn-1008) / [RN-1014](#rn-1014), então o prefixo cacheado não muda e a cauda é lida junto do contexto recente. O `system` do topo fica só com o PREFIXO. Se a conversa não termina num turno `user`, a cauda fica como um segundo bloco `system` sem ponto (comportamento anterior). Texto e ordem das mensagens não mudam. O OpenRouter NÃO muda (decisão do dono): isto cobre só o provider Anthropic direto.
- **Código:** `apps/api/src/infrastructure/llm/anthropic-provider.ts` (`blocosDeSistema`, `caudaDeSistema`, `comCaudaDeSistema`)
- **Teste:** `apps/api/test/infrastructure/llm/anthropic-provider.contract.spec.ts` ("(a)" `system` só com o prefixo e a cauda depois do ponto; "(a2)" cauda depois de `tool_result`, recurso sem `user` final), `apps/api/test/contract/llm-provider.contract.ts` (`fim_do_ultimo_user`, `system` tardio depois de `user` e depois de `tool`)
- **Origem:** AT-751 (EP-030). O aceite (comportamento) é o próximo TP-01: `agent.response` dos `dev-*` em inglês na posição >= 3 caindo para 5% ou menos; nenhum smoke pago antes dele.

<a id="rn-1017"></a>

### RN-1017 — `git push` de terminal para branch protegida, com force, `--all` ou `--mirror` é decisão humana, mesmo no modo automático {#rn-1017}

- **Regra:** estreita a [RN-713](parte-09.md#rn-713) só para a porta do terminal. No modo automático (o curinga `"*"` em `auto_approve`), um `git push` digitado no terminal continua auto-aprovado SÓ quando não consegue alcançar uma branch protegida nem reescrever histórico. Ele vira `require_approval` (um `proposed_action` pendente, com motivo começando por `RN-1017`) quando qualquer segmento do comando (a) empurra para uma branch protegida (`dev`, `qa`, `rc`, `main`, a lista de `isProtectedBranch`), pelo nome ou pelo destino do refspec (`HEAD:dev`, `+x:refs/heads/main`), (b) usa `--force`, `-f` (também agrupado, como em `-fu`) ou `--force-with-lease`, ou (c) usa `--all` ou `--mirror`. Sem isso, a [RN-014](parte-01.md#rn-014) era contornável: com o `git merge` local permitido, `checkout dev`, `merge` e `push origin dev` rodavam sem humano e sem gates. O push da própria branch da tarefa não muda, e nenhum modo não automático muda (já são `require_approval`, [RN-418](parte-04.md#rn-418)). Limites conhecidos: um push sem refspec (`git push origin`) empurra a branch corrente, que o `decide()` não enxerga, e a branch padrão do repositório só é coberta quando está na lista fixa de protegidas.
- **Código:** `apps/api/src/domain/actions/external-effect.ts:260` (`pushProibidoNoModoAutomatico`), `apps/api/src/domain/actions/decide.ts:443` (o bloco de terminal dos tetos)
- **Teste:** `apps/api/test/domain/actions/decide.spec.ts` ("é recusado em modo automático (RN-1017)": `dev`, `main`, `HEAD:dev`, `+HEAD:refs/heads/main`, `--force`, `-f`, `--force-with-lease`, `--all`, `--mirror`, composto; a branch da tarefa continua passando)
- **Origem:** AT-756 (EP-030), achada no levantamento da AT-754 (Rodada 204).

<a id="rn-1019"></a>

### RN-1019 — No modo automático, um `git merge` de terminal dentro do escopo da tarefa é auto-aprovado {#rn-1019}

- **Regra:** estreita a porta do terminal da [RN-014](parte-01.md#rn-014) e a linha `git_merge` da [RN-713](parte-09.md#rn-713). No modo automático (o curinga `"*"` em `auto_approve`), um comando de terminal cujos segmentos `git merge` (inclusive `git merge --abort`) rodam dentro do worktree ou da pasta da tarefa (`terminalNoEscopo` é `true`) deixa de contar como efeito externo: esses segmentos são removidos e o resto do comando é julgado como antes. O merge nunca sai da máquina; só o push sai, e um composto como `git merge origin/dev && git push origin dev` continua virando `require_approval` pela [RN-1017](#rn-1017). Não liberados: qualquer outro modo (regra específica, "sempre permitir", `permissions.json`, manual), comando fora do escopo, `gh pr merge`/`glab mr merge`, a ação tipada `git_merge` e comando que também roda `git checkout`/`git switch` para uma branch protegida. Revisa a RN-706 (doc do engine) do lado do engine (o texto do agente agora permite `git merge` e `git fetch` no worktree da tarefa). Limite conhecido: a imagem do container do projeto pode não ter `git`, então no modo container o merge é aprovado mas ainda falha com `git: not found`.
- **Código:** `apps/api/src/domain/actions/external-effect.ts:238` (`semMergeLocal`), `apps/api/src/domain/actions/decide.ts:443` (o bloco de terminal dos tetos)
- **Teste:** `apps/api/test/domain/actions/decide.spec.ts` ("git merge local (RN-1019)": merge simples permitido; merge mais push para branch protegida recusado pela RN-1017; fora do escopo e fora do modo automático como antes)
- **Origem:** AT-754 (EP-030), decisão do dono de 06/11/2026.

<a id="rn-1026"></a>

### RN-1026 — A api reinicia só o processo do app no container do projeto, com resposta tipada {#rn-1026}

- **Regra:** o engine chama `POST /internal/projects/:projectId/app/restart` (engine-service, corpo vazio) depois que a pasta do projeto avançou. A api repassa ao broker (`POST /containers/:projectId/app/restart`) por `ContainerBrokerPort.reiniciarApp`; o comando do app NUNCA é enviado, o broker lê `run.app` do container-spec. A resposta espelha `ResultadoDoReinicio` (RN-1024 na doc do contracts): `{ reiniciou: true }`, ou `{ reiniciou: false, motivo }` com `sem_container`, `tempo_esgotado`, `falha_no_exec`, ou `app_saiu` mais `exitCode` (e o `sem_app`, só da api). Não há campo de texto livre: o comando do app pode conter um segredo, então nenhum trecho de log e nenhuma mensagem do broker sai da api. Broker respondendo 404 dá `sem_container`; um 409 (sem `run.app` no container-spec, ou projeto `runner`) dá `sem_app`, um no-op nomeado; qualquer outra recusa ou broker inalcançável dá `falha_no_exec`, nunca um erro HTTP. Um reinício que falhou só é relatado: a pasta continua na `main` nova.
- **Código:** `apps/api/src/application/use-cases/containers/reiniciar-app-do-projeto.use-case.ts:25` (`execute`), `apps/api/src/interfaces/http/internal/internal-projects.controller.ts` (`reiniciarOApp`), `apps/api/src/infrastructure/http-clients/container-broker.client.ts` (`reiniciarApp`)
- **Teste:** `apps/api/test/application/use-cases/containers/reiniciar-app-do-projeto.use-case.spec.ts` (resultado repassado intacto; 409 dá `sem_app`; só o `projectId` é enviado; 404 dá `sem_container`; a mensagem do broker nunca vaza; a rota é guardada pelo `EngineServiceGuard`)
- **Origem:** AT-617 (EP-030), decisão do dono de 06/11/2026.

<a id="rn-1022"></a>

### RN-1022 — O repositório do projeto é trunk: o bootstrap cria e protege só a `main`, merges nela avisam o engine, e projetos antigos migram por script {#rn-1022}

- **Regra:** o repositório que o Brabo cria para o projeto do usuário é trunk (ADR 0263); o desenvolvimento do próprio Brabo continua `dev` → `main`.
  1. **Branch de trabalho.** `BRANCH_DE_TRABALHO` é `main`: a PR de tarefa, a PR de infra ([RN-729](parte-10.md#rn-729)) e a PR de ADR abrem a partir dela e miram nela. O engine guarda o mesmo valor (`ProjectRepository.branch_de_trabalho/0`); os dois mudam juntos.
  2. **Bootstrap.** A sequência não cria mais `dev` nem `qa`, e `protect_branches` protege só a `main`. O `branching-policy.md` commitado no repositório do usuário descreve trunk. `create_dev_branch` e `create_qa_branch` continuam no enum `bootstrap_step` (bootstraps antigos têm linhas com eles) e são listados como passos aposentados.
  3. **A proteção não muda.** `isProtectedBranch` mantém `dev`, `qa`, `rc` e `main` ([RN-1017](#rn-1017), [RN-1019](#rn-1019)): projetos antigos ainda têm as três primeiras, e desproteger uma branch que existe custa mais que proteger uma que não existe.
  4. **Gancho.** Depois de um merge com `state: 'merged'` na `main`, `settleMerge` anexa o evento de outbox `project.trunk_merged` (`aggregateType: 'project'`) com payload `{ projectId, sessionId, mergedSha }`. `mergedSha` é a ponta da `main` depois do merge, em melhor esforço (`''` quando o provider não consegue listar branches). Merge que não é `merged`, que falha ou que mira outra branch não grava nada. O engine o consome para avançar a pasta do projeto.
  5. **Migração de projetos antigos.** `pnpm migrar-projeto-para-trunk [--dry-run] [--root <dir>] [<bare>...]` (`src/scripts/migrar-projeto-para-trunk.ts`) faz fast-forward da `main` para a `dev` em cada repositório bare. Ele recusa, sem mudar nada e saindo com 1, quando a `main` não é ancestral da `dev`; `--dry-run` só relata; ele nunca apaga `dev` nem `qa`. Não redireciona PRs abertas que miram `dev`. É rodado pelo dono, porque escrever na `main` é escrever numa branch protegida ([RN-418](parte-04.md#rn-418)).
- **Código:** `apps/api/src/domain/actions/protected-branches.ts:26` (`BRANCH_DE_TRABALHO`), `apps/api/src/application/use-cases/git/bootstrap-steps.ts:161` (`BOOTSTRAP_STEP_SEQUENCE`), `apps/api/src/application/use-cases/git/bootstrap-templates.ts:66` (`branchingPolicyContent`), `apps/api/src/application/use-cases/actions/execute-git-action.use-case.ts:381` (`settleMerge`), `apps/api/src/scripts/migrar-projeto-para-trunk.ts` (`migrarParaTrunk`)
- **Teste:** `apps/api/test/application/use-cases/actions/execute-git-action.use-case.spec.ts` ("project.trunk_merged (RN-1022)"), `apps/api/test/application/use-cases/git/provision-repository.use-case.spec.ts`, `apps/api/test/application/use-cases/git/bootstrap-plan.spec.ts`, `apps/api/test/scripts/migrar-projeto-para-trunk.spec.ts`
- **Origem:** AT-617 (EP-030), decisão do dono de 06/11/2026; rodada 208, lane L2.

<a id="rn-1081"></a>

### RN-1081 — Toda tarefa que vira `done` acorda os dev agents dos módulos com `dependsOn`, e a aprovação do plano acorda os agentes dos módulos atribuídos, sempre depois de atribuir {#rn-1081}

- **Regra:** generaliza a [RN-1009](#rn-1009) (que só cobria o merge da PR). A tarefa que fecha por "já na main" (RN-797 do engine) passa por `POST /internal/sessions/:sessionId/tasks/:taskId/status`, e sem wake o dev dependente reavaliava o claim antes de a dependência virar `done` e ficava `idle` para sempre (TP-01 28ª, achados 15, 17 e 25). `MarkTaskUseCase` com `status === 'done'` grava, na MESMA transação do status, uma linha `task.became_claimable` com `cause: 'dependency_done'` e os módulos do `module_map` corrente que têm `dependsOn` (a mesma regra do `acordarDependentes`); outro status não grava. A aprovação do plano (`ExecuteExecutionPlanUseCase`) grava `task.became_claimable` com `cause: 'plan_applied'` e os módulos das tarefas atribuídas DEPOIS de atribuir os módulos e de ativar a execução; como o engine só acorda o agente BASE de cada módulo na ativação, é esse wake (`list_by_module` no `DevAgentWakeWorker`) que alcança `dev-x-2` e `dev-x-3`.
- **Código:** `apps/api/src/application/use-cases/execution/mark-task.use-case.ts:26` (`execute`), `apps/api/src/application/use-cases/execution/execute-execution-plan.use-case.ts:89` (`execute`)
- **Teste:** `apps/api/test/application/use-cases/execution/mark-task.use-case.spec.ts` (`done` grava, outro status não, sem `dependsOn` não), `apps/api/test/application/use-cases/execution/execute-execution-plan.use-case.spec.ts` (wake `plan_applied` com os módulos atribuídos)
- **Origem:** AT-906 (EP-036); o lado do engine é a lane X2.

<a id="rn-1082"></a>

### RN-1082 — O usuário manda o dev agent ocioso procurar tarefa de novo, e o 409 do engine é repassado, nunca 500 {#rn-1082}

- **Regra:** `POST /projects/:projectId/sessions/:sessionId/agents/:agentId/wake` (`developer`, 202) chama o engine primeiro (`ApiToEngineClient.acordarDevAgent`, que entrega o wake ao agente `idle`) e só então grava `dev.wake_requested` com `actor: user` (o log é imutável: pedido recusado não deixa evento). O agente que não está ocioso é 409 nomeado do engine. `postCommand` passou a converter todo 409 do engine em `ConflictException` com a frase dele, o que corrige também o `rearm` de agente ocioso, que devolvia 500 (correção D8 da [RN-047](parte-04.md#rn-047)). O erro que não é 409 segue `Error` genérico. A rota entra no `security-surface.md` e no `openapi.json`.
- **Código:** `apps/api/src/application/use-cases/execution/acordar-dev-agent.use-case.ts:18` (`execute`), `apps/api/src/interfaces/http/execution/execution.controller.ts:277` (`wake`), `apps/api/src/infrastructure/http-clients/api-to-engine-client.ts:841` (`postCommand`)
- **Teste:** `apps/api/test/application/use-cases/execution/acordar-dev-agent.use-case.spec.ts` (engine primeiro, ator usuário, 409 sem evento), `apps/api/test/infrastructure/http-clients/api-to-engine-client.spec.ts` (409 de rearm e wake vira `ConflictException`)
- **Origem:** AT-906 (EP-036).

<a id="rn-1083"></a>

### RN-1083 — Um módulo cujas tarefas estão todas `done` satisfaz a dependência no plano {#rn-1083}

- **Regra:** revisa a [RN-1004](#rn-1004). `lerPlanoDeExecucao` ganha o 4º parâmetro `modulosEntregues`, e a "órfã" passa a ser `!comTarefa.has(d) && !modulosEntregues.has(d)`: só o módulo que NUNCA teve tarefa, ou que tem tarefa aberta fora do plano, continua exigindo a tarefa de fundação. `TaskRepository.modulosEntregues(projectId)` devolve os módulos com ≥ 1 tarefa (do módulo, ou sem módulo em história de um módulo só, história não arquivada) e nenhuma não-`done`; tarefa arquivada não conta nem a favor nem contra. É o predicado de `semDependenciaAberta` ([RN-1005](#rn-1005)) invertido.
- **Código:** `apps/api/src/domain/execution/plano-de-execucao.ts:39` (`lerPlanoDeExecucao`), `apps/api/src/infrastructure/persistence/drizzle/backlog.repository.ts:575` (`modulosEntregues`), `apps/api/src/application/use-cases/execution/execute-execution-plan.use-case.ts:75` (`lerPlano`)
- **Teste:** `apps/api/test/domain/execution/plano-de-execucao.spec.ts` (`fundação com dono`: entregue passa, sem tarefa nenhuma segue recusada), `apps/api/test/infrastructure/persistence/drizzle/backlog-arquivar-tarefa.repository.spec.ts` (`modulosEntregues`)
- **Origem:** AT-913 (EP-036); a detecção de ciclo é do engine.

<a id="rn-1084"></a>

### RN-1084 — Uma tarefa `todo` pode ser arquivada com motivo, pelo dono ou pelo Dev Lead, e sai do claim, da contagem e das dependências {#rn-1084}

- **Regra:** decisão do dono de 11/11/2026: arquivar e cancelar são UM gesto, com motivo obrigatório. `tasks.archived_at` e `archived_reason` (migração `0086_arquivar_tarefa`), no molde da história ([RN-727](parte-09.md#rn-727)), nunca um valor de `task_status`. `POST /projects/:projectId/tasks/:taskId/archive` (`developer`) arquiva qualquer tarefa `todo` (bloqueada ou não); `POST /internal/sessions/:sessionId/tasks/:taskId/archive` (engine-service) é a ferramenta do Dev Lead e só aceita a tarefa que ELE criou (`backlog.task_created` com ator `dev_lead`), senão 409 `tarefa_de_outro_autor`. Tarefa com agente (`in_progress`/`in_review`) é 409 `tarefa_em_execucao` nomeando o agente; já arquivada é 409 `tarefa_arquivada`; motivo vazio é 400. `TaskRepository.archive` é atômico (`WHERE status = 'todo' AND archived_at IS NULL`), então o claim concorrente nunca perde para um arquivamento aceito. Grava `backlog.task_archived { taskId, storyId, title, reason }`. A arquivada é ignorada por `claimNext`, `countClaimableByModule`, `semDependenciaAberta`, `findPendenteDaExecucao` e `findInProjectByIds` (o plano a recusa como inexistente).
- **Código:** `apps/api/src/application/use-cases/backlog/archive-task.use-case.ts:39` (`execute`), `apps/api/src/infrastructure/persistence/drizzle/backlog.repository.ts:552` (`archive`), `apps/api/src/interfaces/http/backlog/backlog.controller.ts` (`archiveTaskRoute`), `apps/api/src/interfaces/http/internal/internal-sessions.controller.ts` (`archiveTaskRoute`)
- **Teste:** `apps/api/test/application/use-cases/backlog/archive-task.use-case.spec.ts` (dono, motivo, `in_progress`, já arquivada, autoria do Dev Lead, corrida com o claim), `apps/api/test/infrastructure/persistence/drizzle/backlog-arquivar-tarefa.repository.spec.ts` (sai do claim, da contagem e da dependência)
- **Origem:** AT-912 (EP-036).

<a id="rn-1085"></a>

### RN-1085 — A tarefa nasce com o módulo; sem módulo numa história de vários, as pendências a mostram como "sem dev" {#rn-1085}

- **Regra:** completa a [RN-678](parte-09.md#rn-678) (o módulo atribuído pelo plano segue valendo para as tarefas do PO). `CreateTaskInput.module` e `module` no DTO interno: o módulo precisa estar nos `moduleIds` da história (senão 400 nomeado) e é gravado em `tasks.module`; sem `module` e com a história de UM módulo, herda esse módulo (o efeito que o `daTarefaDoModulo` já tinha); com vários (o caso do PO), segue `NULL` e espera o plano. O wake da criação vai a `[module]` quando há módulo. Antes o `create_task` do Dev Lead exigia o módulo mas o engine o descartava, e a tarefa ficava órfã. `findPendenteDaExecucao` ganha o motivo `sem_modulo` (tarefa `todo`, sem módulo, de história `ready` com mais de um módulo): `GetSessionPendingWorkUseCase` o devolve como "sem módulo: nenhum dev vai pegar (atribua pelo plano ou arquive a tarefa)" e a sessão não fecha por inatividade enquanto houver uma.
- **Código:** `apps/api/src/application/use-cases/backlog/create-task.use-case.ts:39` (`execute`), `apps/api/src/infrastructure/persistence/drizzle/backlog.repository.ts:252` (`findPendenteDaExecucao`), `apps/api/src/application/use-cases/sessions/get-session-pending-work.use-case.ts:43` (`MOTIVO_DA_TAREFA`)
- **Teste:** `apps/api/test/application/use-cases/backlog/create-task.use-case.spec.ts` (módulo gravado e wake ao módulo, módulo fora da história, herança, vários módulos), `apps/api/test/application/use-cases/sessions/get-session-pending-work.use-case.spec.ts` (`sem módulo`)
- **Origem:** AT-912 (EP-036); o engine passa o `module` no `create_task` (lane X2).
