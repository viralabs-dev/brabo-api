---
id: rn-api-parte-05
title: 'Regras de negócio — API — parte 5 (desde RN-439)'
sidebar_label: 'API — parte 5 (desde RN-439)'
description: 'As RNs hospedadas na raiz api.'
keywords: [regras de negócio, api]
---

# API — parte 5 (desde RN-439)

## O explorador de pasta do Runner vira três colunas, e a criação de um projeto `runner` deixa de esperar o passo final (RN-436/436) {#o-explorador-de-pasta-do-runner-vira-tres-colunas-e-a-criacao-de-um-projeto-runner-deixa-de-esperar-o-passo-final-rn-436-436}

### RN-439 — `POST .../runner-ticket` autentica E autoriza no MESMO guard; `RolesGuard` (global) se abstém em rota `@RequirePatAuth()` {#rn-439}

`POST /projects/:projectId/runner-ticket` respondia `403 "Não autenticado"`
para TODO PAT, mesmo válido, recém-emitido, escopado ao projeto certo —
achado numa verificação AO VIVO do `brabo-runner` conectando a um projeto
real, nunca por teste automatizado. Causa raiz: `JwtAuthGuard` e
`RolesGuard` são os dois `APP_GUARD` — GLOBAIS — e um guard global SEMPRE
roda ANTES de um guard LOCAL de rota (`@UseGuards`), não importa a ordem dos
decorators no controller. `JwtAuthGuard` já sabia se abster nesta rota (o
desvio de `IS_PAT_ROUTE_KEY` já existia, sem popular `request.user`,
contando com `PatAuthGuard` pra autenticar depois); `RolesGuard` não sabia,
e recusava toda chamada com `request.user` ainda vazio — `PatAuthGuard`
nunca chegava a rodar. O comentário do controller descrevia a ordem ao
contrário ("`RolesGuard` roda DEPOIS do `PatAuthGuard`"), e nunca foi assim.

A correção seguiu o MESMO padrão que `JwtAuthGuard` já usava para este
problema: `RolesGuard` ganhou o desvio gêmeo (`IS_PAT_ROUTE_KEY` →
retorna `true` sem checar `request.user`), delegando a autorização inteira
para quem passa a ser o ÚNICO guard rodando depois de `request.user`
populado nesta rota — o próprio `PatAuthGuard`, que agora também lê
`@RequireRole` (via `Reflector`) e resolve o papel efetivo
(`ResolveEffectiveRoleUseCase.forProject`), recusando com a MESMA mensagem
que `RolesGuard` usaria ("Papel insuficiente para esta ação"). A lógica é
duplicada entre os dois guards de PROPÓSITO — `RolesGuard` mora em `iam`,
`PatAuthGuard` mora em `auth`, e uma dependência cruzada só para reusar
~10 linhas não valeria a pena.

Um SEGUNDO defeito ficou escondido atrás do primeiro, e só apareceu quando
o teste de integração passou a exercitar os dois guards JUNTOS: `PatAuthGuard`
comparava o token BRUTO direto contra `personal_access_tokens.token_hash`
em `validarEUsar` — que sempre espera o HASH (`hashDeToken`, HMAC-SHA256+
pepper, o mesmo que `TokenFactory`/`IssuePersonalAccessTokenUseCase` usam
para gravar). Corrigido para `this.tokens.validarEUsar(hashDeToken(token))`.
Enquanto `RolesGuard` recusava tudo antes, este segundo bug nunca chegava a
se manifestar — corrigir só o primeiro teria trocado um 403 sempre por um
401 sempre, e o runner continuaria nunca conectando de verdade.

- **Onde:** `src/interfaces/http/iam/roles.guard.ts` (desvio
  `IS_PAT_ROUTE_KEY`); `src/interfaces/http/auth/pat-auth.guard.ts`
  (autorização por papel + hash do token); `src/interfaces/http/runner/runner-http.module.ts`
  (`IamUseCasesModule` importado, pelo `ResolveEffectiveRoleUseCase` que
  `PatAuthGuard` passou a precisar); comentário corrigido em
  `src/interfaces/http/runner/runner-tickets.controller.ts`
- **Teste:** `test/interfaces/pat-auth.guard.spec.ts` (autorização
  por papel isolada + hash do token); `test/interfaces/roles.guard.spec.ts`
  (desvio `IS_PAT_ROUTE_KEY`); `test/interfaces/http/runner/runner-tickets.guards.integration.spec.ts`
  (NOVO — sobe `JwtAuthGuard`+`RolesGuard`+`PatAuthGuard` num Nest real, com
  `supertest`, na MESMA ordem relativa do `AppModule`: é o teste que
  faltava, porque cada guard só era exercitado isolado antes disto).
  Verificado também AO VIVO: `brabo-runner` conectou de verdade a um
  projeto `runner` real com um PAT emitido depois da correção
- **ADR:** [0105](../../adr/0105-personal-access-token-do-runner-escopado-por-construcao.md)
  — correção de bug na implementação da decisão já tomada lá (PAT
  autentica esta rota), não uma decisão nova
- **Origem:** achado rodando o `brabo-runner` de verdade contra um projeto
  real e isolando com `curl` direto — nunca por teste automatizado, porque
  nenhuma suíte exercitava `RolesGuard` e `PatAuthGuard` na mesma
  requisição

### RN-440 — `addressableAgents()` é o catálogo FECHADO do handoff manual, mais estrito que `assertHandoffTargetAllowed` {#rn-440}

Handoff manual a agente à escolha (backlog, ADR 0109): `assertHandoffTargetAllowed`
(ADR 0038) só recusa um SUBAGENTE de área — um agente citando "abc" como
alvo passaria por ela sem erro, porque uma AGENTE só cita alvos que ele já
conhece pela própria instrução. Isso deixa de ser verdade quando quem
escolhe é um HUMANO, num `<select>` alimentado por um cliente que pode
divergir do backend. `addressableAgents()` (`src/domain/agents/agent-areas.ts`)
é o catálogo FECHADO — leads de área (`AGENT_AREAS.map(a => a.lead)`) ∪
`SOLO_CONVERSATIONAL_AGENTS` (`criativo`, `po`, `arquiteto`, `ux-designer`,
`staff`) — e `RequestManualHandoffUseCase` recusa com 400 qualquer
`toAgent` fora dele, ANTES de chamar `CreateHandoffUseCase`.

`SOLO_CONVERSATIONAL_AGENTS` é uma lista PRÓPRIA, não derivada do roster
`apps/web/src/lib/agents.ts` (que também lista agentes de gate e o
Psicólogo/Anamnese, nenhum endereçável por handoff). A direção da derivação
é a da api para o web: desde a AT-046 a cópia do web deixou de ser mirror
MANUAL e sai do MESMO gerador das áreas (`pnpm --filter api gerar:areas`,
Fase 18), em `apps/web/src/lib/agent-areas.generated.ts`, que `agents.ts`
só reexporta. `agent-areas.spec.ts` reprova quando o disco diverge do que o
gerador produz, e a lista gerada sai `as const satisfies readonly AgentKey[]`
— um nome que o roster do web não conhece quebra o build do web. O engine
NÃO recebe a lista (não há consumidor lá). Mesmo com as duas cópias
travadas, quem decide o que é aceito continua sendo o
`RequestManualHandoffUseCase`.

- **Onde:** `src/domain/agents/agent-areas.ts` (`addressableAgents`,
  `SOLO_CONVERSATIONAL_AGENTS`); `src/application/use-cases/agents/request-manual-handoff.use-case.ts`;
  `scripts/gerar-areas.ts` (`renderWeb`, que escreve a lista no
  web); `apps/web/src/lib/agent-areas.generated.ts` (cópia GERADA,
  reexportada por `apps/web/src/lib/agents.ts`)
- **Teste:** `test/domain/agents/agent-areas.spec.ts`
  (`describe('addressableAgents (ADR 0109)')` e
  `describe('a lista solo sai do gerador para o web (AT-046)')`, mais o
  aferidor de frescor do arquivo do web); `test/application/use-cases/agents/request-manual-handoff.use-case.spec.ts`
  (recusa subagente E recusa agente desconhecido); `apps/web/src/lib/agents.test.ts`
- **ADR:** [0109](../../adr/0109-handoff-manual-a-agente-a-escolha.md)
- **Origem:** backlog do modelo de time — item aberto desde a FASE 13c,
  fechado pelo caso real do Staff (ADR 0088) e do UX Designer (ADR 0087),
  os dois com plumbing de engine pronto e nenhum caminho humano até eles

---

### RN-441 — `POST .../sessions/:sessionId/handoffs` exige `developer`; handoff manual nasce `offered`, sem estado novo {#rn-441}

O único caminho para gravar `toAgent` continua sendo `CreateHandoffUseCase`
(ADR 0038) — não um segundo mecanismo. `RequestManualHandoffUseCase`
resolve `fromAgent` sozinho (o `agent.activated` mais RECENTE da sessão,
via `SessionEventRepository.listByTypeInSession` — mesmo critério de
`activeAgent` em `SessionPage.tsx`, achado 9-fix; sessão sem nenhum agente
ativado ainda cai no sentinela `"usuario"`, nunca um nome adivinhado) e
chama `CreateHandoffUseCase.execute` passando `actor: {kind: 'user', id:
userId}` — `CreateHandoffInput` ganhou o campo opcional `actor?: Actor`
para isso, com default `{kind:'agent', id: fromAgent}` preservando o
comportamento de sempre para o chamador interno (o engine). O handoff
nasce `offered`, do MESMO jeito que um automático, e o card de aceite
já existente (`offeredHandoff`/`handleAcceptHandoff` em `SessionPage.tsx`)
o pega sozinho no próximo poll de `useHandoffs` — sem NENHUMA mudança no
caminho de aceite. *(Não pegava, e ninguém viu até a AT-253: o card casava a
oferta pelo ATOR, e o ator do manual é a pessoa. Corrigido na
[RN-631](../web.md#rn-631), que casa pelo `handoffId`.)*

A rota (`POST projects/:projectId/sessions/:sessionId/handoffs`) exige
papel `developer`, o mesmo de `handoffs/:handoffId/accept` (RN-136: quem
CONVERSA nesta tela). `ux-designer` e `staff` entraram em `AGENTES_DE_CHAT`
(`SessionPage.tsx`) na mesma mudança — as duas cláusulas de `message/2` já
existiam em `agent_command_controller.ex` (ADR 0087/0088), verificado por
leitura ANTES de escrever qualquer linha de web, e nenhuma delas tinha
caminho humano até si.

- **Onde:** `src/interfaces/http/agents/agents.controller.ts`
  (`requestManual`); `src/interfaces/http/agents/dto/request-manual-handoff.dto.ts`;
  `src/application/use-cases/agents/create-handoff.use-case.ts`
  (`actor?: Actor`); `apps/web/src/routes/SessionPage.tsx`
  (`AGENTES_DE_CHAT`, `.manualHandoffRow`, `handleRequestManualHandoff`);
  `apps/web/src/lib/api-client.ts` (`requestManualHandoff`)
- **Teste:** `test/interfaces/http/agents/agents.controller.spec.ts`
  (papel exigido); `test/application/use-cases/agents/request-manual-handoff.use-case.spec.ts`
  (`fromAgent` derivado, sentinela `"usuario"`, `actor: user`);
  `docs/security-surface.md` + `test/interfaces/route-surface.spec.ts`
  (classificação `role:developer` em runtime)
- **ADR:** [0109](../../adr/0109-handoff-manual-a-agente-a-escolha.md)
- **Origem:** backlog do modelo de time (ver RN-440)

---

### RN-443 — Budget de área é ADITIVO ao de projeto/sessão, nunca cascata; só `maintainer` muda o teto {#rn-443}

Fecha o item "budget por área" do corte do ADR 0038, em aberto desde a
FASE 8. `agent_areas` ganha `budget_micros` (nullable — `null` é SEM
TETO, o default) e `spent_micros` (`NOT NULL DEFAULT 0`), espelhando
exatamente `max_parallel`: mesma linha, mesmo dono da decisão, mesmo
`AgentAreaRepository`. **Não é** a cascata de binding de modelo do ADR
0064 (`sessão > agente > área > projeto > workspace`, "o mais específico
vence") — os dois mecanismos usam a palavra "área" e não têm mais nada em
comum. Budget de área é um TERCEIRO teto independente ao lado dos de
projeto e sessão que já existiam: `CheckBudgetGateUseCase.execute` agora
resolve a área do `agentId` (via `areaDo`, função pura, sem tocar banco a
menos que ache correspondência) e checa os três em paralelo — qualquer um
bloqueado já recusa a chamada, sem hierarquia entre eles.

`RecordLlmUsageUseCase` incrementa `spent_micros` da área do ator SEMPRE
que ele pertence a uma (lead ou membro — `areaDo` devolve área pros dois),
com ou sem `budget_micros` configurado: o gasto real da área fica visível
antes mesmo de alguém configurar um teto. Ator sem área (usuário no chat,
agente fora de qualquer área) não grava nada — não é omissão silenciosa,
é o comportamento correto quando não há o que incrementar.

`SetAreaBudgetUseCase` exige `maintainer` (mesma régua de
`SetAreaMaxParallelUseCase` — mudar quanto o produto pode gastar sem
perguntar), converte dólar→micro-USD no controller (mesma convenção de
`BudgetsController`) e não emite evento de domínio (config de projeto, sem
sessão pra gravar — mesmo raciocínio já registrado em
`SetAreaMaxParallelUseCase`). `null` LIMPA o teto — campo obrigatório que
aceita `null` como valor válido (`ValidateIf`, não `IsOptional`), mesmo
padrão de `RenameSessionDto`.

- **Onde:** `src/db/schema/agents.ts` (`agentAreas`, colunas
  `budgetMicros`/`spentMicros` e os dois CHECK); `src/domain/llm/area-budget.ts`
  (`isAreaBudgetExceeded`); `src/application/use-cases/llm/check-budget-gate.use-case.ts`;
  `src/application/use-cases/llm/record-llm-usage.use-case.ts`;
  `src/application/use-cases/execution/set-area-budget.use-case.ts`;
  `src/infrastructure/persistence/drizzle/agent-area.repository.ts`
  (`setBudget`/`incrementSpent`); `src/interfaces/http/execution/execution.controller.ts`
  (`PUT agent-areas/:key/budget`); `apps/web/src/routes/settings/BudgetSection.tsx`
- **Teste:** `test/application/use-cases/llm/check-budget-gate.use-case.spec.ts`
  (describe `budget de área — aditivo, não cascata`: área excedida bloqueia
  com projeto/sessão OK e vice-versa, sem teto nunca bloqueia, agente sem
  área não é afetado); `test/application/use-cases/llm/record-llm-usage.use-case.spec.ts`
  (describe `gasto por área`: incrementa pro membro e pro lead, não faz
  nada nocivo sem área, soma sem teto configurado);
  `test/application/use-cases/execution/set-area-budget.use-case.spec.ts`
  (grava, limpa com `null`, recusa negativo/NaN/Infinity, zero é válido);
  `test/infrastructure/persistence/drizzle/agent-area.repository.spec.ts`
  (`setBudget`/`incrementSpent`, atomicidade sob concorrência)
- **ADR:** [0110](../../adr/0110-budget-por-area-aditivo-nao-cascata.md)
- **Origem:** item de backlog aprovado pelo dono do produto numa sessão de
  planejamento explícita — `docs/explanation/backlog.md`, tabela "Older
  backlog"

---

### RN-447 — Converter `execution_mode` de projeto EXISTENTE recusa (409) enquanto qualquer dev agent do projeto não está `idle` {#rn-447}

`ConvertProjectExecutionModeUseCase` (`PUT .../execution-mode`, papel
`maintainer`) lê `engine.dev_agent_states` DIRETO (cross-schema, mesmo
banco físico — mesmo caminho da RN-409) por `project_id`, em TODAS as
sessões do projeto, não só a mais recente. Qualquer status diferente de
`idle` (`working`/`blocked`/`idle_tripped`/`awaiting_gate`/
`awaiting_approval`) recusa a conversão: `Engine.Dev.DevAgentServer` NÃO
re-resolve o worktree sozinho — `workspace_root` é capturado UMA vez, na
criação do worktree, e trocar a coluna por baixo dele deixaria o agente
escrevendo num escopo que o `permissions.json` e a política de terminal
(ADR 0055) já abandonaram. A decisão é RECUSAR e explicar (mesmo padrão
"recusa e ensina" da RN-088/RN-422) — nunca drenar ou forçar a migração de
um agente vivo.

`idle_tripped` conta como ATIVO aqui, diferente da RN-409 (que o exclui de
`onlineAgentCount`): as duas perguntas são diferentes — "alguém está
olhando este agente trabalhar agora" (RN-409) contra "existe um ponteiro
de escopo que ficaria obsoleto" (aqui). Um agente com o circuit breaker
disparado ainda tem `workspace_root` capturado, esperando desbloqueio
humano — não é "ocioso" para efeito de conversão, mesmo não sendo
"online" para efeito de contagem.

Mesmo (modo, caminho) de hoje é NO-OP: a checagem de dev agent nem roda —
reenviar o formulário sem mudar nada não deveria custar uma varredura de
agentes ativos.

- **Onde:** `src/application/use-cases/iam/convert-project-execution-mode.use-case.ts`;
  `src/application/ports/dev-agent-activity.port.ts`;
  `src/infrastructure/persistence/drizzle/dev-agent-activity.repository.ts`
- **Teste:** `test/application/use-cases/iam/convert-project-execution-mode.use-case.spec.ts`
  (recusa com dev agent ativo, sem gravar nada; no-op não checa);
  `test/infrastructure/persistence/drizzle/dev-agent-activity.repository.spec.ts`
  (`idle` não conta, todo o resto conta, isolamento entre projetos)
- **ADR:** [0111](../../adr/0111-conversao-de-execution-mode-de-projeto-existente.md)
- **Origem:** correção registrada em `docs/explanation/backlog.md` durante
  a implementação da Onda 1 do runner (ADR 0104), fechada nesta Onda 2

---

### RN-448 — `permissions.json` é RELOCALIZADO na conversão — o conteúdo nunca muda, só o caminho {#rn-448}

`PermissionsFileStore.move(from, to)` lê o arquivo na localização ANTIGA
(`projectScopeRoot(localAntiga)`), grava o MESMO conteúdo na localização
NOVA e apaga o antigo (best-effort — se já não existir, não há o que
apagar). O conteúdo (padrões `allow`/`deny`/`ask`) não carrega caminho nem
modo dentro de si, então não há nada para REESCREVER, só para mover.
`from === to` (nenhuma raiz efetiva mudou) é no-op.

Confirmado por leitura de `projectScopeRoot` (`project-workspaces-root.ts`):
para `mounted`/`runner` a raiz É o `workspacePath`, tratado como caminho
DENTRO DO CONTAINER DA API — em `runner`, isso já era verdade ANTES desta
entrega (sem bind-mount, o arquivo mora numa pasta que só coincide em
STRING com a pasta real do usuário, desconectada dela). A conversão não
muda essa propriedade existente, só a relocaliza de forma consistente —
sem caso especial para `runner` além de usar `move()` como qualquer outro
par.

- **Onde:** `src/application/ports/permissions-file-store.port.ts`
  (`move`); `src/infrastructure/filesystem/fs-permissions-file-store.ts`
- **Teste:** `test/infrastructure/filesystem/fs-permissions-file-store.spec.ts`
  (conteúdo sobrevive e é apagado da origem; origem sem arquivo grava vazio
  sem lançar; `from === to` é no-op)
- **ADR:** [0111](../../adr/0111-conversao-de-execution-mode-de-projeto-existente.md)

---

### RN-449 — Saindo de `container`, o ciclo de vida do container é encerrado (`removed`) ANTES da coluna mudar {#rn-449}

`ConvertProjectExecutionModeUseCase` chama
`RegistrarTransicaoDeContainerUseCase` (ADR 0081) para levar a linha de
`project_containers` a `removed` — via `stopped` primeiro quando está
`running` (`container-lifecycle.ts` não tem aresta direta
`running -> removed`) — ANTES de gravar o novo `execution_mode`. A ordem é
obrigatória: `RegistrarTransicaoDeContainerUseCase` recusa (400) qualquer
transição num projeto que não esteja em `execution_mode = 'container'`
NO MOMENTO da chamada, então chamá-lo depois de trocar a coluna sempre
falharia. Sem linha de container (projeto que nunca provisionou), nenhuma
transição é disparada.

Entrar em `container` a partir de `mounted`/`runner` NÃO auto-provisiona
nada — o portão da imagem do Arquiteto (RN-105) e o ciclo de vida normal
valem a partir daí, como para qualquer projeto `container` — nunca um
atalho que pula o portão porque o projeto "já tinha código em algum
lugar".

- **Onde:** `src/application/use-cases/iam/convert-project-execution-mode.use-case.ts`
  (`removerContainerSeExistir`)
- **Teste:** `test/application/use-cases/iam/convert-project-execution-mode.use-case.spec.ts`
  (`running` passa por `stopped`; `provisioning` vai direto; sem linha,
  nenhuma transição; entrar em `container` nunca dispara transição)
- **ADR:** [0111](../../adr/0111-conversao-de-execution-mode-de-projeto-existente.md)

---

### RN-450 — `workspaceVerifiedAt` zera em TODA conversão real, mesmo voltando para `runner` com o "mesmo" caminho {#rn-450}

Só faz sentido em `execution_mode: 'runner'` (RN-423): um timestamp
provando que um runner CONECTADO confirmou o caminho no host real.
Qualquer conversão que muda de fato o par (modo, caminho) — incluindo uma
que pousa de novo em `runner` com um caminho de aparência igual — zera o
campo, forçando confirmação NOVA: o timestamp antigo atesta uma
verificação que aconteceu sob um par DIFERENTE, e carregá-lo adiante
afirmaria uma confirmação que nunca aconteceu para o estado novo. O
no-op (RN-447) é a única exceção — nada muda, então nada zera.

- **Onde:** `src/application/use-cases/iam/convert-project-execution-mode.use-case.ts`
- **Teste:** `test/application/use-cases/iam/convert-project-execution-mode.use-case.spec.ts`
  (`runner -> container` zera; no-op preserva)
- **ADR:** [0111](../../adr/0111-conversao-de-execution-mode-de-projeto-existente.md)

---

## Pasta local anexada vira o quarto escopo do índice RAG, lido pelo NAVEGADOR (RN-455..457, ADR 0113) {#pasta-local-anexada-vira-o-quarto-escopo-do-indice-rag-lido-pelo-navegador-rn-455-457-adr-0113}

Pedido do dono do produto: anexar uma pasta da PRÓPRIA máquina do usuário a
um projeto como referência de leitura para os agentes — sem exigir o CLI
`brabo-runner` (ADR 0103), diferente de `execution_mode: runner`
(ADR 0104), que precisa de um caminho de HOST real porque roteia comando
para lá. O navegador lê o CONTEÚDO dos arquivos (`File.text()`) e o caminho
RELATIVO dentro da pasta escolhida (`File.webkitRelativePath`) — nunca um
caminho absoluto de máquina, porque a API de `File` do navegador não expõe
um, para nenhum site. O que atravessa a rede é texto que o navegador já
tinha o direito de ler, o mesmo modelo de confiança de qualquer upload de
arquivo comum.

### RN-455 — `chunks.scope` ganha `'local'`, reusando o pipeline de RAG inteiro {#rn-455}

`ChunkScope` passa de `'docs' | 'adr' | 'session'` para incluir `'local'`
(migração `0052`, `ALTER TYPE ... ADD VALUE`) — aditivo, sem migração de
dado, sem CHECK novo: os dois CHECK de `chunks` (migração `0045`) já são
escritos como "é `session` ou não é", então `local` cai do mesmo lado de
`docs`/`adr` (tem `source_path`, não tem `session_id`) sem mudança
nenhuma além do valor do enum. `origemDoChunk` (`domain/rag/rag-citation.ts`)
não precisou de nenhum ramo novo: um chunk `local` carrega `sourcePath`
exatamente como `docs`/`adr`, então cai no `kind: 'file'` que a citação já
sabia renderizar.

- **Onde:** `src/db/schema/rag.ts` (`chunkScopeEnum`),
  `src/db/migrations/0052_chunks_local_scope.sql`,
  `src/application/ports/chunk-repository.port.ts` (`ChunkScope`),
  `src/application/use-cases/rag/index-local-folder.use-case.ts`
- **Teste:** `test/application/use-cases/rag/index-local-folder.use-case.spec.ts`
  (caminho feliz e full rebuild), `test/interfaces/http/rag/rag.controller.spec.ts`
- **ADR:** [0113](../../adr/0113-pasta-local-anexada-via-navegador-vira-chunks-scope-local.md)
- **Origem:** pedido do dono do produto

### RN-457 — `maintainer`, e reanexar é o MECANISMO de resincronizar — nunca o "Reindexar agora" genérico {#rn-457}

`POST .../rag/local` exige `maintainer`, mesma régua de `POST .../rag/reindex`
(RN-238): as duas chamam o provider de embedding e substituem o que o
projeto já tinha indexado. `ReindexProjectUseCase` NÃO foi estendido para
cobrir `local` — ele reindexa lendo de uma fonte que o SERVIDOR consegue
revisitar (o repositório do projeto, o event log), e `local` não tem
fonte nenhuma para revisitar: o texto só existe no navegador de quem
anexou, e o servidor nunca guardou caminho de host nenhum (não há um).
Chamar `deleteByScope(projectId, 'local')` no botão genérico apagaria a
referência anexada sem ter como recriá-la — reanexar a pasta (novo
upload) É o mecanismo de resincronizar, e é um botão deliberadamente
separado. Os dois casos de uso carregam comentário cruzado explicando o
porquê, para uma "correção" futura não religar os dois e apagar
silenciosamente o material do usuário.

- **Onde:** `src/interfaces/http/rag/rag.controller.ts`
  (`anexarPastaLocal`, `@RequireRole('maintainer')`),
  `src/application/use-cases/rag/reindex-project.use-case.ts`
  (comentário "Por que `local` NÃO entra aqui")
- **Teste:** `test/interfaces/http/rag/rag.controller.spec.ts`
- **ADR:** [0113](../../adr/0113-pasta-local-anexada-via-navegador-vira-chunks-scope-local.md)
- **Origem:** pedido do dono do produto

### RN-458 — Cobertura de `local` é forma PRÓPRIA, e `lastAttachedAt` é a ÚNICA exceção real ao "nunca Xmin" (RN-237) {#rn-458}

`RagCoverage.local` não reusa `RagFileCoverage` (RN-237, ADR 0080): não há
"total no repositório" pra comparar — uma pasta anexada não tem um total
que o servidor possa recontar. `RagLocalCoverage` mostra o que está
indexado AGORA (`filesIndexed`, `folderName`) e `lastAttachedAt`, um
`MAX(chunks.created_at)` REAL sobre o escopo — a única exceção declarada
à regra de nunca mostrar um "reindexado há Xmin" chutado, porque aqui o
valor real EXISTE e é barato de calcular (mesmo `todosOsChunks` que
`GetRagCoverageUseCase` já busca).

- **Onde:** `src/application/use-cases/rag/get-rag-coverage.use-case.ts`
  (`RagLocalCoverage`), `apps/web/src/components/rag/RagCoveragePanel.tsx`
- **Teste:** `test/application/use-cases/rag/get-rag-coverage.use-case.spec.ts`,
  `apps/web/src/components/rag/RagCoveragePanel.test.tsx`
- **ADR:** [0113](../../adr/0113-pasta-local-anexada-via-navegador-vira-chunks-scope-local.md)
- **Origem:** pedido do dono do produto

## Ollama nativo no bootstrap dev e pull de modelo Hugging Face (RN-461..463, ADR 0114/0115) {#ollama-nativo-no-bootstrap-dev-e-pull-de-modelo-hugging-face-rn-461-463-adr-0114-0115}

### RN-462 — Pull de modelo Hugging Face exige confirmação explícita em duas etapas; nunca roda sozinho {#rn-462}

`POST .../huggingface/pull-requests` só CRIA o pedido, em
`pending_confirmation` — nenhum download começa. Somente uma chamada
SEPARADA, `POST .../pull-requests/:id/confirm`, move o pedido para
`confirmed` → `pulling` e de fato chama `OllamaProvider.pullModel`.
`ConfirmModelPullUseCase` RECUSA (409) confirmar um pedido que já não
esteja em `pending_confirmation` — a transição de estado É a segunda
confirmação, não uma flag à parte, e por isso não é reexecutável. Falha
do Ollama durante o pull marca o pedido `failed` com `failedReason`
prefixado pela origem (`infra`/`modelo`/`código`, vocabulário do ADR
0020) — nunca falha silenciosa, e nada é ativado no catálogo quando falha.

- **Onde:** `src/application/use-cases/llm/huggingface/request-model-pull.use-case.ts:23`
  (`RequestModelPullUseCase`),
  `src/application/use-cases/llm/huggingface/confirm-model-pull.use-case.ts:45`
  (`ConfirmModelPullUseCase`),
  `src/interfaces/http/llm/huggingface-models.controller.ts:109-165`
  (as duas rotas, `role:maintainer`)
- **Teste:** `test/application/use-cases/llm/huggingface/request-model-pull.use-case.spec.ts`
  (cria em `pending_confirmation`, nada além disso),
  `test/application/use-cases/llm/huggingface/confirm-model-pull.use-case.spec.ts`
  (caminho feliz ativa no catálogo; falha do Ollama marca `failed` com a
  origem certa — `modelo`/`infra`; recusa reconfirmar um pedido que já
  saiu de `pending_confirmation`; 404 para pedido inexistente no
  workspace)
- **ADR:** [0115](../../adr/0115-pedido-de-pull-de-modelo-huggingface-tabela-propria.md)
- **Origem:** pedido do dono do produto

### RN-463 — Allowlist de publishers oficiais; comunidade exige opt-in explícito com aviso de segurança {#rn-463}

Busca no Hugging Face Hub filtra para publishers OFICIAIS por padrão —
`HUGGINGFACE_OFFICIAL_PUBLISHERS`, vocabulário FECHADO e curado à mão
(`meta-llama`, `google`, `mistralai`, `microsoft`, `Qwen`, `deepseek-ai`,
`openai`, `nvidia`), comparado por igualdade EXATA de caixa — um reupload
minúsculo (`qwen/...`) não herda o selo da org oficial (`Qwen/...`).
`includeCommunity=true` traz todo o resto, cada resultado marcado
`official: true|false`, nunca ocultando a distinção. Na tela, o toggle de
comunidade nasce DESLIGADO e, enquanto ligado, mostra um aviso de
segurança (`Alert tone="danger"`) — o opt-in e o aviso são o mesmo gesto,
nunca uma preferência que o usuário liga uma vez e esquece que está
ligada.

- **Onde:** `src/domain/llm/huggingface-official-publishers.ts:17-41`
  (`HUGGINGFACE_OFFICIAL_PUBLISHERS`/`isOfficialPublisher`),
  `src/application/use-cases/llm/huggingface/search-huggingface-models.use-case.ts:28-39`
  (filtro por padrão), `apps/web/src/components/HuggingFaceModelBrowser.tsx:190-203`
  (toggle + `Alert` de aviso)
- **Teste:** `test/domain/huggingface/huggingface-official-publishers.spec.ts`
  (reconhece publisher do allowlist; recusa reupload de terceiro;
  sensível a caixa; `repoId` sem `/` nunca casa),
  `test/application/use-cases/llm/huggingface/search-huggingface-models.use-case.spec.ts`
  (só oficiais por padrão; `includeCommunity` traz todos marcados),
  `apps/web/src/components/HuggingFaceModelBrowser.test.tsx`
  (toggle nasce desligado e só mostra o aviso quando ligado; busca respeita
  `includeCommunity`)
- **ADR:** [0115](../../adr/0115-pedido-de-pull-de-modelo-huggingface-tabela-propria.md)
- **Origem:** pedido do dono do produto

## Configuração do runner pelo navegador (RN-464..466, ADR 0118) {#configuracao-do-runner-pelo-navegador-rn-464-466-adr-0118}

### RN-464 — Chave de dispositivo do runner: registro/revogação self-service; SEM visão de maintainer nesta rodada (corte declarado) {#rn-464}

> **Revisada pela [RN-687](../web.md#rn-687) ([ADR 0203](../../adr/0203-aposenta-o-fluxo-do-runner-pelo-navegador.md), 01/10):**
> o fluxo do navegador foi APOSENTADO, e o `POST .../runner-device-keys` saiu
> com ele — junto com `RegisterRunnerDeviceKeyUseCase` e o teste dele, citados
> abaixo como eram. Ficam `GET`/`DELETE` e a revogação self-service; a chave
> nova nasce no terminal (RN-551) e quem a registra é o instalador (RN-552). As
> chaves de projeto já registradas continuam valendo e revogáveis.

`runner_device_keys` guarda só a chave PÚBLICA Ed25519 de um dispositivo do
runner — gerada no navegador, nunca a privada. `POST/DELETE
.../runner-device-keys` exigem papel mínimo `developer` e são autenticadas
pelo JWT DE SESSÃO normal (diferente de `runner-ticket`: quem chama aqui é o
navegador já logado registrando o próprio dispositivo, não o runner rodando
sem sessão). `RegisterRunnerDeviceKeyUseCase` valida só a FORMA mínima da
JWK (`kty:"OKP"`, `crv:"Ed25519"`, `x` presente) — a validação profunda (é
mesmo um ponto Ed25519 válido) fica pro `jose.importJWK` no momento de usar,
na RN-465. `RevokeRunnerDeviceKeyUseCase` é IDEMPOTENTE e escopado ao
`userId` chamador — mesmo desenho de `revogar()` da RN-426 — e devolve 404
tanto para chave inexistente quanto para chave de outro usuário, mesma
disciplina de não vazar existência.

**Assimetria declarada com o PAT**: ao contrário da RN-427 (`maintainer`
revoga o PAT de QUALQUER usuário do projeto, resposta a incidente), a chave
de dispositivo NÃO tem hoje uma rota equivalente de `maintainer` — só
autorevogação. O docblock de `RunnerDeviceKeysController` declara isto
explicitamente como corte desta rodada, não esquecimento: estender o mesmo
padrão da RN-427 para chaves de dispositivo é trabalho futuro direto, se
vier a ser pedido.

- **Onde:** `src/db/schema/auth.ts:338` (`runnerDeviceKeys`),
  `src/application/use-cases/auth/register-runner-device-key.use-case.ts`,
  `src/application/use-cases/auth/revoke-runner-device-key.use-case.ts`,
  `src/interfaces/http/runner/runner-device-keys.controller.ts`
- **Teste:** `test/application/use-cases/auth/register-runner-device-key.use-case.spec.ts`,
  `test/application/use-cases/auth/revoke-runner-device-key.use-case.spec.ts`
- **ADR:** [0118](../../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
- **Origem:** pedido do dono do produto

### RN-465 — `POST .../runner-ticket` aceita PAT OU chave de dispositivo (Ed25519, TTL ≤60s) — segunda forma de credencial de DISPOSITIVO, nunca dual-auth com JWT de sessão (distinção da RN-439) {#rn-465}

> **Revisada pela [RN-687](../web.md#rn-687) ([ADR 0203](../../adr/0203-aposenta-o-fluxo-do-runner-pelo-navegador.md), 01/10):**
> nada desta RN mudou no guard — o `PatAuthGuard` continua aceitando o JWT de
> uma chave de PROJETO, e é por isso que um runner configurado pelo navegador
> antes do ADR 0203 não quebra. O que deixou de existir é criar uma chave de
> projeto NOVA: o navegador não gera mais o par.

`PatAuthGuard` ganhou um segundo caminho, ao lado do PAT (`brb_...`)
inalterado: um bearer no formato de JWT compacto (três segmentos) é tratado
como chave de dispositivo. O guard lê o `kid` do header (sem verificar
assinatura ainda), busca a chave pública ATIVA correspondente em
`runner_device_keys`, e só então verifica a assinatura EdDSA com
`jose.importJWK`/`jwtVerify`. TTL curto e OBRIGATÓRIO: `exp - iat` não pode
passar de 60s — checado contra a vida ASSINADA do token, não contra "agora",
fechando a janela de replay de um JWT vazado a partir do momento em que foi
assinado. `userId`/`projectId` usados para autorizar vêm sempre do REGISTRO
salvo no banco, nunca de claim do JWT — o token só precisa provar posse da
privada, nunca afirmar quem é o dono. `projectId` é conferido DUAS vezes
(claim do JWT contra a rota, e projeto registrado da chave contra a rota) —
mesma disciplina 401 vs 403 que o caminho PAT já usa: token/chave válida
para o projeto ERRADO é categoria diferente de token/chave inválida. O
runner assina esse JWT em `assinarTicketComChaveDeDispositivo`
(`apps/runner/src/auth.ts`), com a JWK privada já CARREGADA em memória —
nunca lendo arquivo ali, preservando a garantia "sem I/O de arquivo" de
`auth.ts` (quem lê o arquivo é o módulo separado da RN-466).

**Isto NÃO reabre a RN-439**: a RN-439 fechou a garantia de que
`runner-ticket` nunca aceita o JWT de LOGIN como credencial — ela continua
de pé. A chave de dispositivo é um JWT DIFERENTE, autoassinado pelo próprio
runner com uma chave que a api nunca viu a privada, sem `sub` de usuário
nenhum — só uma segunda forma de provar "sou o dispositivo de tal usuário
neste projeto", tão escopada quanto o PAT que ela complementa. Aceitar o JWT
de sessão aqui faria `RolesGuard`/`@RequireRole` autorizar esse usuário pra
tudo que o papel dele permite no resto da api, estourando o escopo
`runner:project:<id>` — exatamente o que a RN-439 impediu.

- **Onde:** `src/interfaces/http/auth/pat-auth.guard.ts:104-216`
  (`autenticarChaveDeDispositivo`), `apps/runner/src/auth.ts:143-188`
  (`assinarTicketComChaveDeDispositivo`, `obterTicketDoRunnerComCredencial`)
- **Teste:** `test/interfaces/pat-auth.guard.spec.ts` (describe
  "chave de dispositivo (JWT EdDSA autoassinado, ao lado do PAT)" — caminho
  feliz, assinatura inválida, chave revogada, `projectId` do claim não bate
  com a rota, chave registrada em outro projeto, TTL longo demais, `kid` sem
  chave correspondente), `apps/runner/src/auth.spec.ts` (describe
  "assinarTicketComChaveDeDispositivo"/"obterTicketDoRunnerComCredencial")
- **ADR:** [0118](../../adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
- **Origem:** pedido do dono do produto

## Os dois tetos de rebaixamento em `project_members` (RN-472) {#os-dois-tetos-de-rebaixamento-em-project-members-rn-472}

### RN-472 — Ninguém rebaixa o `owner` do workspace, e ninguém rebaixa a si mesmo {#rn-472}

A [RN-471](../web.md#rn-471) registrou que `ResolveEffectiveRoleUseCase.forProject` é
`projectRole ?? workspaceRole` — a linha de projeto SOBREPÕE a de workspace, nos
dois sentidos. O que ela não guardou é a consequência:
`AddProjectMemberUseCase` era um passthrough de uma linha para o upsert, e
nenhum dos dois caminhos de escrita olhava para QUEM é o alvo. Qualquer
`maintainer` podia (a) rebaixar o **`owner` do workspace** a `viewer` num
projeto, tirando o dono do próprio projeto, e (b) **se rebaixar sem poder
desfazer**, porque desfazer é a mesma rota, que pede `maintainer`.

**A sobreposição FICA nos dois sentidos.** `forProject` não muda. Restringir
alguém num projeto sensível (workspace `developer` → `viewer` no projeto X) é
capacidade deliberada, e "o maior dos dois" a eliminaria — o
`resolve-effective-role.use-case.spec.ts` fixa a metade de subir desde a Fase 1.
O que entra são DOIS tetos, e só eles:

| teto | o que recusa | status |
|---|---|---|
| 1 | papel abaixo de `owner` para quem é `owner` do WORKSPACE | 403 |
| 2 | papel abaixo do que o CHAMADOR tem hoje, quando o alvo é ele mesmo | 403 |

**O `owner` é `workspace_members.role`, nunca `workspaces.created_by`.** Os dois
existem em `db/schema/iam.ts` e não são a mesma coisa: `created_by` é fato
histórico, e é o `role` que a autorização usa em todo o resto do sistema
(`forWorkspace` é `workspaces.findMemberRole`; `created_by` não aparece em
caminho de autorização nenhum). Ler `created_by` blindaria o criador que já
transferiu a propriedade e deixaria descoberto o `owner` corrente que não criou
nada — o buraco que o teto existe para fechar.

**O teto 2 é "a si mesmo", sem limiar** — não "abaixo de `maintainer`". A versão
com limiar copiaria um número do `@RequireRole` do controller para dentro do
domínio e envelheceria calada se a rota mudasse de mínimo. O preço, declarado: o
`owner` que quisesse se pôr como `maintainer` no próprio projeto (movimento
reversível) também é recusado, e passa a precisar de outro `maintainer`. **Subir**
o próprio papel não é rebaixamento e continua passando.

**Os tetos moram no CASO DE USO, com a regra no domínio — não no `RolesGuard`.**
O guard autoriza o CHAMADOR contra o `@RequireRole` da rota e não vê corpo
(`dto.role`) nem alvo (`dto.userId`); os dois tetos são sobre o ALVO e sobre a
relação ator↔alvo. A FORMA é a de `domain/actions/decide.ts` (RN-154/RN-418):
função pura, mensagem ao lado da condição, sem chave de configuração. O que não
se transporta é o desfecho — lá o teto vira `require_approval` sobre uma
`proposed_action` de agente, aqui a chamada já é humana e síncrona e não há fila
para onde mandá-la.

**403, não 409 nem 400:** é recusa de autorização — o chamador tem o papel da
rota e não tem autoridade para este movimento. Esperar não muda nada (não é
conflito de estado) e o corpo é válido (o mesmo corpo com outro alvo passaria).

**O que os tetos NÃO cobrem, e segue possível:** rebaixar outro `maintainer` que
não é `owner` de workspace; **auto-rebaixamento pela REMOÇÃO** —
`RemoveProjectMemberUseCase` não ganhou teto, e remover a própria linha derruba
o efetivo para o papel de workspace, que é benigno quando o workspace segura e
irreversível quando não segura (`maintainer` só pela linha de projeto, `viewer`
no workspace); auto-PROMOÇÃO, que já era possível antes; e rebaixar o `owner`
NO WORKSPACE (`POST workspaces/:workspaceId/members` segue sem teto). Os dois
casos da remoção estão FIXADOS em teste, inclusive o aberto.

**A tela fica para depois, e a recusa aparece.** `MembersSection` calcula o teto
2 sozinha, mas não o teto 1: `listProjectMembers` devolve o papel da LINHA DE
PROJETO, e o papel de workspace do alvo não está ao alcance do cliente. Meio
gate seria um `Select` honesto sobre uma recusa e calado sobre a outra — a
segunda fonte de papel contra a qual a RN-471 escreve. Enquanto isso,
`handleRoleChange` já mostra `mensagemDaApi(erro, …)` num toast (RN-471), e é a
frase da api que diz qual teto bateu.

- **Onde:** `src/domain/iam/tetos-de-rebaixamento.ts`
  (`rebaixaOwnerDoWorkspace`, `ehAutoRebaixamento` e as duas mensagens),
  `src/application/use-cases/iam/add-project-member.use-case.ts`
  (onde os dois são aplicados, antes do upsert),
  `src/interfaces/http/iam/projects.controller.ts` (o `@CurrentUser()`
  que dá o ator, e as duas descrições corrigidas),
  `src/interfaces/http/iam/dto/add-member.dto.ts` (a terceira),
  `src/application/use-cases/iam/resolve-effective-role.use-case.ts`
  (INTOCADO — `projectRole ?? workspaceRole` segue como está),
  `src/db/schema/iam.ts` (`workspaces.created_by` × `workspace_members.role`)
- **Teste:** `test/application/use-cases/iam/tetos-de-rebaixamento.use-case.spec.ts`
  (os dois tetos recusando; `owner` de workspace recebendo `owner` de projeto
  passa; auto-rebaixamento também quando o papel do ator vem da linha de
  projeto; auto-promoção passa; as DUAS capacidades legítimas preservadas —
  rebaixar outra pessoa, e `viewer` de workspace virando `maintainer` no
  projeto; auto-remoção permitida; e a remoção que ainda rebaixa quem a chamou,
  fixada como lacuna declarada)
- **Origem:** [ADR 0127](../../adr/0127-tetos-de-rebaixamento-em-project-members.md),
  sobre o achado da revisão da #444 registrado na RN-471

---

## O `kid` é o vínculo, e a recusa tem nome (RN-475) {#o-kid-e-o-vinculo-e-a-recusa-tem-nome-rn-475}

### RN-477 — Provisionamento que falha DIZ que falhou, e a espera por ele tem teto {#rn-477}

O provisionamento de repositório roda **inteiro dentro do POST** — não há
worker nem fila atrás dele (a descrição de OpenAPI que prometia "continues in
the background" estava errada e foi corrigida). Uma falha, portanto, já
aconteceu quando a resposta chega. Esta RN é sobre a tela nunca afirmar
"provisionando" sobre um trabalho que já terminou mal.

**Toda falha vira estado DURÁVEL, e há dois caminhos que não viravam.** O
primeiro é `step.check()`, que ficava fora de todo `try/catch` no
`BootstrapRunner` e faz IO de rede: um 401 de token expirado, um 403 ou um
timeout subiam sem tocar a linha, que continuava `pending` com
`lastError: NULL`. O segundo é a recusa em `createRepo`, que acontece **antes
de a linha existir** — `repo_bootstraps` só nasce depois de o provider
confirmar o repositório, então o projeto ficava com ZERO linha. Agora o
primeiro grava `status: 'failed'` + `lastError` num lugar só (o `catch` da
etapa) e emite `bootstrap.step_failed`; e o segundo é lido pelo endpoint de
status a partir da `proposed_action` de `git_repo_create` que falhou.

**A falha de criação NÃO inventa um passo.** `failedStep` fica `null`: o
repositório não chegou a existir, então nenhum dos seis passos do Gitflow foi
tentado, e nomear um para preencher a frase seria trocar um silêncio por uma
informação errada. A tela tem um título próprio para esse caso, sem `{{step}}`.

**A tela mostra o motivo e oferece saída.** O `.catch(() => {})` de corpo vazio
da `ProvisioningPage` — cujo comentário afirmava que "a falha aparece via
bootstrapQuery", o que era falso nos dois caminhos acima — passa a guardar a
mensagem da api e exibi-la. O botão "Tentar novamente" deixa de depender de
`status === 'provision_failed'`: ele aparece também quando o POST recusou,
que é justamente quando não há status de falha para depender.

**A espera tem TETO e três estados que não colapsam**, exatamente como a
[RN-474](../web.md#rn-474) e pelo mesmo motivo: o poll de 1s era infinito. Passados 3
minutos sem convergir, a tela diz que parou de acompanhar, **declara que isso
não prova fracasso** (o provisionamento roda dentro da requisição, e um
provider lento pode ainda estar trabalhando) e oferece "procurar de novo" —
que rearma a espera **sem** disparar um segundo POST, porque um segundo POST
criaria mais uma sessão de bootstrap.

**O card do dashboard sabe.** O read model consulta as ações `git_repo_create`
falhadas junto com as linhas de bootstrap, então um projeto que falhou antes de
existir cursor deixa de aparecer sem badge nenhum — e o clique volta a levar
para a tela de provisionamento, que só desviava em `provision_failed`.

- **Onde:** `src/application/use-cases/git/bootstrap-runner.ts:181`
  (o `catch` da etapa, único lugar que declara o fracasso),
  `src/domain/git/repo-bootstrap-status.ts:29` (o segundo argumento),
  `src/application/use-cases/git/get-repo-bootstrap-status.use-case.ts:59`
  (a falha de criação lida da `proposed_action`),
  `src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
  (o badge do card), `apps/web/src/routes/ProvisioningPage.tsx` (motivo, retry
  e teto)
- **Teste:**
  `test/application/use-cases/git/provision-repository.use-case.spec.ts`
  (falha no CHECK vira `failed` com motivo e evento; falha ao CRIAR não deixa
  linha mas o status reporta, com `failedStep` nulo),
  `test/domain/git/repo-bootstrap-status.spec.ts` (sem linha com falha
  de criação; com linha a falha antiga é ignorada; `pending` puro),
  `apps/web/src/routes/ProvisioningPage.test.tsx` (o motivo aparece; o retry
  existe sem `provision_failed`; a espera para e diz o que não sabe; título sem
  passo não inventa um)
- **Origem:** uso real do dono do produto — o provisionamento ficou "Pendente"
  para sempre, e a causa (`permissão negada: /data/git-repos/exp001.git`, um
  volume Docker de desenvolvimento que nascia `root`) estava gravada só em
  `proposed_actions.execution_result`, que nenhuma tela lê

## A busca do RAG deixa rastro, e o rastro congela os pesos (RN-479..481) {#a-busca-do-rag-deixa-rastro-e-o-rastro-congela-os-pesos-rn-479-481}

### RN-478 — O `permissions.json` mora onde a api ALCANÇA, o escopo do terminal aponta para o HOST {#rn-478}

A raiz do projeto tinha **uma** derivação (`projectScopeRoot`) e **dois**
consumidores com necessidades opostas. Isso estava certo enquanto os dois modos
com pasta de usuário eram bind-mount; deixou de estar quando o modo `runner`
nasceu ([RN-423](../runner.md#rn-423), [ADR 0104](../../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)),
porque ele é deliberadamente **sem** bind-mount.

| consumidor | precisa de | por quê |
|---|---|---|
| escopo de terminal ([ADR 0055](../../adr/0055-escopo-de-caminho-na-politica-de-terminal.md)) | o caminho **do host** | é lá que o comando roda — na máquina do usuário, pelo runner |
| `permissions.json` (a api lê **e escreve**) | um caminho **que a api alcance** | ela o escreve de dentro do container dela |

**São duas derivações, e as duas moram no mesmo arquivo** — a fonte continua
única, o que se separou foi a pergunta. `projectScopeRoot` fica **inalterada**;
`permissionsFilePath` é nova e diverge dela em um único ponto: no modo
`runner` o arquivo vai para
`<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>/permissions.json`, a raiz
gerenciada, chaveada pelo nome que a [RN-109](parte-03.md#rn-109) congela na criação.
`container` e `mounted` não mudam — em `mounted` a pasta **é** bind-mount, e
mover o arquivo quebraria projetos que já o têm em disco sem ganhar nada.

**Por que a raiz gerenciada e não o disco do usuário**, já que o código está
lá: `permissions.json` é **política**, não código do projeto. Quem a lê é a
api; o runner nunca a lê (recebe comando já aprovado) e o engine não a toca em
ponto nenhum — todas as menções a ela em `apps/engine/lib` são comentário.
Guardá-la na máquina do usuário a tornaria editável por quem ela restringe, e
ilegível justamente quando o runner está desconectado, que é quando a decisão
precisa continuar valendo.

**O que isso corrigiu.** A ativação da execução é a primeira **escrita** do
arquivo, e ela fazia `mkdir -p` de um caminho do host dentro do container da
api: `EACCES: permission denied, mkdir '/home/<usuario>'` → **500**. A
**leitura** degradava calada (ENOENT → `EMPTY_PERMISSIONS_FILE`), e é por isso
que o efeito maior atravessou sem ser visto: **em projeto `runner` o
`permissions.json` nunca existiu**, e `decide()` sempre caiu em
`require_approval` por um arquivo que não estava lá.

**Custo declarado:** para projeto `runner`, o arquivo de política deixa de
morar ao lado do código — quem o procurar na pasta do projeto não vai achar.

**Recusa tipada, e 400 em vez de 500.** Os dois `throw new Error(...)` da
derivação viram `LocalizacaoDeProjetoInvalidaError`, no molde de
`CaminhoLocalInvalidoError`: `motivo` legível em pt-BR, e
`ActivateExecutionUseCase` o mapeia para **400**. Uma linha de projeto
incoerente (o par (modo, caminho) só se torna inválido sendo gravado por fora
da criação) passa a dizer o que corrigir em vez de virar 500 sem corpo. A tela
da Visão geral passa a mostrar essa mensagem — ela imprimia a constante
"Não foi possível ativar a execução" enquanto o botão gêmeo do chat da sessão
já usava `mensagemDaApi`: mesmo botão, dois diagnósticos.

**A lacuna que FICA, declarada:** o engine tem o **mesmo** defeito e ele não
foi corrigido aqui. `Engine.Actions.Workspace.ensure!/4` faz
`File.mkdir_p!(workspace_dir(project_id))`, que em projeto `runner` é o
caminho do host — o working tree do dev agent não tem onde nascer. Não vira
500 (o `rescue` de `ensure_remoto/2` devolve `{:error, …}`), vira dev agent que
não trabalha. Corrigi-lo isolado seria materializar worktree no host por um
caminho que a execução em container substitui; o que muda agora é só a
**mensagem**, que nomeia a causa em vez de repassar "permissão negada" cru.

- **Onde:**
  `src/infrastructure/filesystem/project-workspaces-root.ts:231`
  (`projectScopeRoot`, inalterada) e `:319` (`permissionsFilePath`, a segunda
  derivação), com `LocalizacaoDeProjetoInvalidaError` em `:219`,
  `src/infrastructure/filesystem/fs-permissions-file-store.ts:77`
  (o único chamador do caminho do arquivo),
  `src/application/use-cases/execution/activate-execution.use-case.ts:176`
  (o 400), `src/interfaces/http/execution/execution.controller.ts:74`
  (a anotação de OpenAPI, que prometia 409 para dois casos que nunca foram
  409), `apps/web/src/routes/ProjectOverviewTab.tsx:485`
  (`mensagemDaApi`), `apps/engine/lib/engine/actions/workspace.ex:61`
  (a mensagem da lacuna que fica)
- **Teste:**
  `test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (`permissionsFilePath` nos três modos; e a **não-regressão** de
  `projectScopeRoot` continuar devolvendo o caminho do host em
  `runner`/`mounted` — unificar as duas de volta quebraria o ADR 0055),
  `test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  (com o `FsPermissionsFileStore` DE VERDADE: o arquivo cai na raiz gerenciada
  e a pasta do host fica intocada; linha incoerente vira 400 que ensina),
  `apps/web/src/routes/ProjectOverviewTab.test.tsx` (a mensagem da api na
  tela), `apps/engine/test/engine/actions/workspace_runner_test.exs` (a falha
  nomeia a causa em projeto `runner`, e passa intacta nos outros modos)
- **Origem:** uso real do dono do produto — "Ativar execução" respondendo 500
  no projeto `exp002`

---

### RN-479 — Toda busca híbrida grava uma linha em `rag_searches`, com os pesos CONGELADOS; e a telemetria nunca derruba a busca {#rn-479}

`src/domain/rag/rag-search-limits.ts` declara, no próprio comentário,
que **nenhum** dos quatro números da busca híbrida (os dois pesos, o limiar e o
número de candidatos) vem de calibração com dado real. Não vinha porque não
havia como: a busca não deixava rastro nenhum — nem linha de tabela, nem evento.
Calibrar sem medir seria trocar um chute por outro.

`HybridSearchUseCase` passa a gravar, a cada busca, o que ela devolveu
(`hits`, com o **rank** 1-based de cada trecho), sob que condições
(`degraded`/`vector_available`), quanto demorou (`latency_ms`), quem buscou
(`actor_kind`/`actor_id`) e em que sessão — ou em NENHUMA.

**Por que TABELA e não só evento de sessão.** `session_events.session_id` é
`NOT NULL`, e uma busca vinda da aba de RAG é de PROJETO: não tem sessão.
Registrar só como evento perderia exatamente as buscas em que um humano olhou
os scores e julgou, que são as que carregam o sinal de verdade. É a mesma
classe de problema que forçou o corte do metering de embedding
([ADR 0075](../../adr/0075-embeddings-no-contrato-de-llm-provider.md),
`token_usage.session_id NOT NULL`), e a saída é a mesma: tabela própria, com
`session_id` NULLABLE.

**`pesos` congelado na linha é o ponto.** `pesosVigentes()` copia os valores do
momento para dentro do registro — mesma disciplina do preço congelado no
metering ([ADR 0042](../../adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md))
e da `image_version` em `project_containers`. Sem a cópia, a primeira
calibração que mexer em `RAG_SEARCH_WEIGHT_VECTOR` faria toda a medição
anterior passar a significar outra coisa, calada — e "melhorou depois da
mudança?", a única pergunta que a telemetria existe para responder, ficaria
impossível de fazer.

**Gravar telemetria NUNCA derruba a busca, e também não falha CALADA.** Quem
pergunta não deveria perder a resposta porque o instrumento de medição caiu; e
o repositório é explícito sobre falha que vira silêncio ([RN-059](../engine.md#rn-059)).
Então o INSERT que falha vira log com a origem classificada (`infra`,
[RN-023](../engine.md#rn-023)) e `searchId: null` na resposta — que não é o mesmo que "não
houve resultado": é "não há a que anexar voto", e a tela precisa dos dois
separados para não oferecer um controle que a api recusaria
([RN-088](../web.md#rn-088)).

`degraded` e `vector_available` são duas colunas de propósito, e a redundância
de hoje (`degraded = !vector_available`) está declarada no schema em vez de
escondida: `vector_available` é um fato sobre o PROVIDER — é ele que faz
`medir:rag` reprovar —, e `degraded` é a palavra do CONTRATO com o engine, cuja
definição pode crescer.

- **Onde:** `src/domain/rag/rag-telemetry.ts` (`pesosVigentes`,
  `RagSearchHitTelemetry`), `src/db/schema/rag.ts` (`ragSearches`),
  `src/application/use-cases/rag/hybrid-search.use-case.ts`
  (`registrarBusca`),
  `src/infrastructure/persistence/drizzle/rag-telemetry.repository.ts`
- **Teste:**
  `test/application/use-cases/rag/hybrid-search.use-case.spec.ts`
  (a linha gravada com rank e pesos; os pesos serem CÓPIA e não o mesmo objeto;
  a busca da aba sem sessão; e o CASO DE FALHA — insert que falha não derruba a
  busca e devolve `searchId: null`)
- **ADR:** [0129](../../adr/0129-telemetria-de-busca-do-rag-como-tabela.md) — por que
  é TABELA e não evento, e por que os pesos vão congelados;
  [0080](../../adr/0080-busca-hibrida-pesos-limiar-e-citacao.md), cujos números esta
  RN **não** revisa: ela dá o instrumento para revisá-los depois
- **Origem:** plano do dono do produto, Parte 2 / Etapa 1

### RN-480 — O voto sobre um trecho é o único sinal de VERDADE da medição, e ele exige a referência que a busca devolveu {#rn-480}

Latência e taxa de degradação dizem se a busca RODOU; só o voto diz se ela
ACERTOU. `rag_feedback` guarda esse voto — dois valores (`util`/`irrelevante`)
e não uma escala de 1 a 5, porque escala fina convida a diferenças de régua
entre quem vota que nenhuma agregação recupera depois.

**A referência é obrigatória, e as duas recusas são 400 que ENSINAM.**
`searchId` que não existe naquele projeto, e `chunkId` que não estava entre os
hits daquela busca, são recusados antes de qualquer escrita. Não é rigor
decorativo: o **rank** do trecho votado é o que separa dois diagnósticos que a
`precision@1` confunde — índice pobre não devolve o trecho certo em posição
nenhuma, peso errado devolve o trecho certo em rank 7. Voto sem rank produz
número sem significado, que é pior que número nenhum.

A recusa vale nos dois caminhos: pela aba vira 400 na tela; pelo agente vira
**tool-result de erro** que o modelo pode corrigir na iteração seguinte
([RN-061](../engine.md#rn-061)/[RN-163](../engine.md#rn-163)), nunca crash.

**Um voto por ator por trecho por busca** (`unique (search_id, chunk_id,
actor_id)`, com `onConflictDoUpdate`): mudar de ideia sobrescreve o próprio
voto. Sem a trava, quem clicasse duas vezes pesaria o dobro na `precision@k` e
a métrica passaria a medir entusiasmo.

O papel é `viewer`, o MESMO de `search` — quem pode ler o resultado é quem pode
julgá-lo ([RN-102](parte-03.md#rn-102): o mínimo é do endpoint, e votar não gasta nem
configura nada). A ferramenta do agente é `:direct`, nunca `proposed_action`:
dar nota a um trecho não é efeito externo, e transformá-la em ação a aprovar
encheria a fila de ruído.

- **Onde:** `src/db/schema/rag.ts` (`ragFeedback`, `ragVerdictEnum`),
  `src/application/use-cases/rag/record-rag-feedback.use-case.ts`,
  `apps/engine/lib/engine/harness/tools/rag_feedback.ex`,
  `apps/web/src/components/rag/RagCitationCard.tsx` (os dois controles, onde o
  score já está)
- **Teste:**
  `test/application/use-cases/rag/record-rag-feedback.use-case.spec.ts`
  (o rank devolvido; e os três CASOS DE FALHA — `searchId` desconhecido,
  `chunkId` fora dos hits, busca de outro projeto),
  `apps/engine/test/engine/harness/tools/rag_feedback_test.exs` (a recusa
  voltando como tool-result com a mensagem da api, nunca crash; `:direct`; e o
  registro nos seis agentes que já tinham `rag_search`),
  `apps/web/src/components/rag/RagCitationCard.test.tsx` (os três estados do
  controle, e a ausência dele sem `searchId`),
  `test/scripts/medir-rag.spec.ts` (`precision@k` sobre o julgado)
- **ADR:** [0129](../../adr/0129-telemetria-de-busca-do-rag-como-tabela.md)
- **Origem:** plano do dono do produto, Parte 2 / Etapa 1

### RN-486 — Estado REGISTRADO e estado OBSERVADO nunca se fundem, e "não olhei" tem motivo próprio {#rn-486}

`project_containers` guarda o que foi REGISTRADO. O daemon responde o que é
OBSERVADO. Antes do broker a tabela não tinha como mentir (`container_id` era
sempre `NULL`); agora tem, e a leitura diz isso em vez de escondê-lo.

**A rota de ciclo de vida devolve os dois, separados.** Container morto por fora
aparece como registrado `running` e observado `exited`, e é assim que tem de
aparecer. A reconciliação é NA LEITURA, não um daemon de fundo.

**`observado: null` sozinho não é resposta.** Ele significa duas coisas
diferentes, e `naoObservado` é o que as separa: `null` ali quer dizer que a
observação ACONTECEU e voltou vazia — a afirmação positiva "olhei e não há
container" —, enquanto `broker-nao-configurado`, `broker-sem-resposta` e
`broker-recusou` querem dizer que não deu para olhar, cada um com um conserto
diferente. Herdar o estado registrado nesses três casos é exatamente o que a
[RN-468](../web.md#rn-468) proíbe: sinal de ambiente diz o que SABE, e proxy não vira
garantia.

**Nenhuma recusa do broker derruba a leitura.** O ciclo de vida registrado é
informação legítima por si só e existia antes do broker; perdê-lo porque o
broker está fora trocaria um dado que temos por um que não temos.

**Lacuna declarada:** container órfão de projeto que nunca teve linha de ciclo
de vida não aparece nessa rota — ela lê o registrado primeiro. Quem acha órfão é
a varredura por `brabo.managed=true`, e a página que a consome ainda não existe.

- **Onde:**
  `src/application/use-cases/containers/obter-estado-observado-do-container.use-case.ts`
  (os três motivos e o `null` que não é motivo),
  `src/interfaces/http/containers/containers.controller.ts` (a rota que
  devolve os dois),
  `src/application/ports/container-broker.port.ts` (o `null` de
  `inspect` é ausência; a falha LANÇA)
- **Teste:**
  `test/application/use-cases/containers/spec-e-observacao-de-container.use-case.spec.ts`
  ("olhei e não há" e "não consegui olhar" não colapsam; sem `BROKER_URL` o
  broker nem é chamado; recusa vira motivo com detalhe, nunca exceção)
- **ADR:** [0130](../../adr/0130-broker-de-container.md)

### RN-487 — O Arquiteto roteia módulo por módulo, mas só CANDIDATA — quem elege é a Infra {#rn-487}

`route_modules_to_infra` produz UMA lista — um item `{modulo, imagemCandidata,
porque}` por módulo do `module_map` vigente — e ela vira o evento
`artifact.module_routing`, sem tabela: mesmo desenho de `artifact.module_map`/
`artifact.project_image`/`artifact.c4_diagram`, o evento É o artefato.

**A imagem candidata passa pela MESMA regra de `choose_project_image`,
aplicada por item.** `validarDecisaoDeImagem` já recusa imagem sem tag/digest
explícito, `latest`, e `rationale` com menos de 10 caracteres — reimplementar
essa regra por módulo criaria uma segunda versão dela para divergir da
primeira cedo ou tarde. `validarRoteamento`
(`domain/architecture/module-routing.ts`) delega, e só acrescenta o que é
PRÓPRIO da lista: vazia é recusada (não é uma decisão), e módulo repetido
também (duas imagens para o mesmo módulo são ambíguas — qual vale?).

**Módulo fora do `module_map` vigente é recusado nomeando os módulos
VÁLIDOS**, mesma régua de `AssignStoryModulesUseCase` (`missingModules`):
listar só o que está errado obrigaria o modelo a adivinhar contra um mapa que
ele não pode reler; listar os nomes certos encerra a busca na primeira
recusa.

**Sem `module_map` vigente, não há módulo — recusado com 400, nunca
inventado.** É a mesma recusa de `create_c4_diagram` quando falta module_map,
e pelo mesmo motivo: não há módulo, não há infra para rotear. O
`build_kickoff/1` do `ArquitetoServer` — o ÚNICO lugar de onde o modelo
aprende a ORDEM das ferramentas — lista `route_modules_to_infra` como o passo
que segue `create_module_map`.

**`:direct`, nunca `proposed_action`.** Rotear não tem efeito externo — não
sobe container, não muda nada fora do event log — e é decisão INTERNA de
arquitetura, do mesmo calibre de `choose_project_image`/`create_c4_diagram`.
Colocar isto na fila de aprovação misturaria um rascunho que a Infra ainda
vai revisar com decisões que já têm efeito real.

**Arquiteto candidata, Infra elege — e esta entrega é só a metade que
candidata.** A metade que ELEGE entre as candidaturas (ou recusa todas) é do
Infra Lead, com `proposed_action` própria, num PR à parte. O que existe aqui
é a lista auditável no event log, antes de a Infra ter ferramenta para agir
sobre ela — mesmo sequenciamento que já valeu para o `module_map` existir
antes de `create_c4_diagram` precisar dele.

- **Onde:** `src/domain/architecture/module-routing.ts`
  (`validarRoteamento`, `EVENTO_MODULE_ROUTING`),
  `src/application/use-cases/architecture/route-modules-to-infra.use-case.ts`,
  `src/application/use-cases/architecture/get-module-routing.use-case.ts`,
  `src/interfaces/http/internal/internal-sessions.controller.ts`
  (`POST .../module-routing`),
  `apps/engine/lib/engine/harness/tools/route_modules_to_infra.ex`,
  `apps/engine/lib/engine/agents/arquiteto_server.ex` (`build_kickoff/1`, passo 4)
- **Teste:**
  `test/domain/architecture/module-routing.spec.ts` (lista vazia,
  módulo repetido, e a delegação a `validarDecisaoDeImagem` — `latest` e
  `rationale` curto),
  `test/application/use-cases/architecture/route-modules-to-infra.use-case.spec.ts`
  (caminho feliz com dois módulos; sem module_map vigente; módulo fora do
  mapa; versionamento ao rotear de novo),
  `apps/engine/test/engine/harness/tools/route_modules_to_infra_test.exs`
  (`:direct`; normalização das chaves do tool call; recusa da api virando
  tool-result de erro, nunca crash — RN-061)
- **ADR:** [0131](../../adr/0131-roteamento-de-modulos-para-infra.md)
- **Origem:** plano do dono do produto, Parte 1 / PR 1.4

### RN-490 — O golden-set de acerto do RAG mede por CAMINHO DE ARQUIVO, no TOP-5, nunca por chunk exato ou rank 1 {#rn-490}

O gate `rag-acertivo` (`config/gates.yml`) mede se a busca híbrida devolve o
arquivo certo para 17 perguntas compostas a partir de RNs/ADRs reais deste
repositório (golden-set, molde do ADR 0123 aplicado ao RAG). O critério de
"acertou" tem duas decisões deliberadas, e as duas evitam medir a pergunta
errada:

- **Caminho de arquivo, nunca chunk exato.** O chunking (1200/150) é
  justamente um dos parâmetros que este programa existe para poder revisar
  (ADR 0080) — travar o golden-set no chunk faria QUALQUER ajuste de
  chunking quebrar os 17 casos, mesmo quando o arquivo certo continuasse
  sendo recuperado.
- **TOP-5, nunca só a primeira posição.** É assim que o produto usa o
  resultado: o Chat RAG cita VÁRIOS trechos por resposta
  (`RagCitationCard`, plural), não só o primeiro. Medir contra rank 1
  mediria uma pergunta que a UI não faz. `5`, e não o `RAG_SEARCH_RESULT_LIMIT`
  (10) da rota real, para não testar um k mais folgado que a maioria das
  buscas reais usa.

O critério é função PURA (`acertouCaminhoEsperado`/`rankDoCaminhoEsperado`),
consumida pelo seed (`seed-golden-set-rag.ts`) e testada isolada — a mesma
disciplina de `gate-registry.ts`: a decisão de "isto bateu" não depende de
como o resultado chegou.

O golden-set roda **manual** (`mix golden_set.rag`), nunca em `mix test`
comum — mesma decisão já registrada para o golden-set do QA (ADR 0123):
sem segredo de LLM de API ou infra nova, não havia como rodar Ollama de
verdade em CI. Excluído por tag PERMANENTE (`:golden_set_rag`) em
`test_helper.exs`, nunca por detecção de "Ollama alcançável" — mesmo motivo
do lado QA: esta máquina já tem Ollama de pé o tempo todo. O piso é RATCHET
(`>=`, nunca `>`), contagem e não porcentagem, chaveado pelo modelo de
EMBEDDING (`nomic-embed-text`, hoje o único que o produto suporta) e
escrito só por humano.

**Revisada pela RN-498:** "não há como rodar Ollama de verdade em CI" era
verdade na Etapa 2 e deixou de ser na Etapa 3 (ADR 0138) — um workflow
dedicado, agendado, agora roda `mix golden_set.rag` de verdade contra um
Ollama real em CI. A exclusão permanente em `test_helper.exs` acima
CONTINUA valendo como está: ela protege o `mix test` comum (e a máquina de
qualquer desenvolvedor com Ollama de pé), nunca o novo workflow, que invoca
a tag explicitamente, do mesmo jeito que sempre foi preciso.

- **Onde:** `src/domain/rag/golden-set-criterio.ts`,
  `scripts/seed-golden-set-rag.ts`,
  `apps/engine/test/engine/rag/rag_golden_test.exs`,
  `apps/engine/test/fixtures/golden_set_rag/floor.json`
- **Teste:** `test/domain/rag/golden-set-criterio.spec.ts`
- **ADR:** [0132](../../adr/0132-golden-set-de-acerto-do-rag.md)
- **Origem:** plano do dono do produto, Parte 2 / Etapa 2

### RN-493 — Terminal dentro do container real ganha PISO de auto-aprovação, sem tocar nos tetos absolutos {#rn-493}

Quando `containerExecutionActive` é verdadeiro (o mesmo `running` REGISTRADO
da RN-492, consultado por `ProposeActionUseCase` só para `actionType ===
'terminal'` em projeto `execution_mode: container`), o valor INICIAL de
`current` dentro de `decide()` deixa de ser `require_approval` e passa a ser
`auto_approve` — um PISO, não um teto novo: os estágios que seguem
(`agent_autonomy`, `permissions.json`) continuam podendo REBAIXAR esse piso
exatamente como já rebaixavam o `require_approval` default (um `deny`
explícito ou um `ask` casando o comando vencem do mesmo jeito), e os CINCO
tetos absolutos de `decide.ts` (escopo, git push/comando privilegiado, merge
protegido, `instruction_patch`, paralelismo) continuam rodando por CIMA,
byte a byte como estavam — inclusive quando o `auto_approve` veio do piso, e
não de uma regra explícita.

**A justificativa é uma SEGUNDA fronteira, não a ausência da primeira.** O
escopo léxico de terminal (`terminalNoEscopo`, ADR 0055) continua rodando
sobre os MESMOS caminhos de HOST de sempre — o `cwd`/`command` que chegam em
`decide()` NUNCA são traduzidos pra `/work` (essa tradução acontece só
depois, no engine — RN-492). Dentro do container real, some uma
fronteira MAIS forte por cima da léxica: o mount namespace do Docker, que o
processo fisicamente não atravessa, somado à validação de `/work` que o
broker já faz (`DiretorioForaDoEscopoError`). É defesa em profundidade — o
escopo léxico não é substituído, é redundante.

- **Onde:** `src/domain/actions/decide.ts`
  (`DecideContext.containerExecutionActive`, o `current` inicial
  condicional), `src/application/use-cases/actions/propose-action.use-case.ts`
- **Teste:** `test/domain/actions/decide.spec.ts` (describe "decide
  — piso do container ativo do projeto": auto-aprova sem regra nenhuma;
  inalterado sem `containerExecutionActive`; não afeta ação não-terminal;
  `agent_autonomy`/`permissions.json` explícitos rebaixam o piso; IAM
  insuficiente nega antes do piso; escopo continua vencendo por cima;
  git push/sudo continuam `require_approval`),
  `test/application/use-cases/actions/propose-action.use-case.spec.ts`
  (describe "piso do container ativo": terminal auto-aprova e EXECUTA com
  container running; não afeta `container_start`; sem linha `running`,
  inalterado; deny embutido/git push/sudo continuam vencendo)
- **ADR:** [0134](../../adr/0134-dev-agents-executam-dentro-do-container.md)
- **Origem:** plano do dono do produto, Parte 1 / PR 1.6

### RN-495 — `container_stop`/`container_remove` nascem como `proposed_action`, e só `container_remove` entra no teto absoluto {#rn-495}

Fecha a lacuna que o comentário de `ContainerBrokerPort` (ADR 0130) e o
CLAUDE.md declaravam desde o PR 1.5: `stop`/`remove` tinham CLIENTE HTTP
pronto (`HttpContainerBrokerClient.stop`/`.remove`) e ZERO chamador — a
página global de containers (`/containers`, RN-496) é o primeiro. Os dois
NUNCA são ação de agente: só um humano clicando "Parar"/"Remover" numa linha
da tela propõe.

**`container_stop` segue o calibre EXATO de `container_start`** (RN-491):
`maintainer`, `require_approval` por padrão, PODE ser configurado
`auto_approve` (nunca semeado) — `ExecuteContainerStopUseCase` pede ao broker
para parar e, só quando o registrado ainda dizia `running`, registra a
transição `running -> stopped` (`container-lifecycle.ts`). Registrado já
`stopped`/`provisioning`/`failed`: o broker é chamado mesmo assim (é
idempotente — parar o que já não está rodando é no-op do lado do Docker),
mas NENHUMA transição é gravada — inventar uma que a máquina de estados não
descreveu de verdade seria o mesmo defeito que a RN-486 já nomeou para o
observado.

**`container_remove` é o MAIS destrutivo dos três — descarta o container e
exige reprovisionar do zero (`container-lifecycle.ts`: `removed` só sai
provisionando de novo, nunca "voltando à vida") — e por isso entra no MESMO
teto absoluto de `decide.ts` que git push/comando privilegiado (RN-418):
nunca auto-aprovável, nem por `agent_autonomy` nem por `permissions.json`,
mesmo com "modo automático" ligado.** A fresta de "sempre permitir" é
fechada NA FONTE, pelo mesmo mecanismo de RN-418: `ApproveAlwaysActionUseCase`
recusa (400) gravar o padrão para `container_remove` — o clique inteiro é
recusado, e quem quer remover aprova a instância pelo fluxo normal
(`POST .../approve`). No web, `ApprovalCard.podeSemprePermitir` esconde o
botão "sempre permitir" para `container_remove`, mesma régua que já vale
para `instruction_patch`.

**`ContainerBrokerPort.remove` é `docker rm --force`** — remove mesmo um
container `running`, numa chamada só. A máquina de estados NÃO tem
`running -> removed` direto (só `running -> stopped/failed`, e só DAÍ para
`removed`): `ExecuteContainerRemoveUseCase` registra os DOIS hops quando o
registrado ainda dizia `running` (`stopped`, depois `removed`), refletindo o
que aconteceu de verdade do lado do Docker sem alargar a máquina de estados
por um atalho que só existiria aqui.

**Nenhum dos dois decide imagem** — ao contrário de `container_start`, que
reusa `DecidirImagemDoProjetoUseCase` para emitir uma nova versão de
`artifact.project_image`. `stop`/`remove` só pedem ao broker para agir sobre
o container que já existe.

- **Onde:** `src/domain/actions/decide.ts` (`ACTION_TYPES`,
  `MIN_ROLE_FOR_ACTION_TYPE`, teto absoluto de `container_remove`),
  `src/domain/actions/command-matcher.ts` (`ACTION_TYPE_LABELS`),
  `src/domain/containers/container-stop-remove-execution-result.ts`,
  `src/application/use-cases/actions/execute-container-stop.use-case.ts`,
  `src/application/use-cases/actions/execute-container-remove.use-case.ts`,
  `src/application/use-cases/actions/approve-action.use-case.ts`,
  `src/application/use-cases/actions/propose-action.use-case.ts`,
  `src/application/use-cases/actions/approve-always-action.use-case.ts`,
  `apps/web/src/lib/aprovacoes.ts`, `apps/web/src/components/ApprovalCard.tsx`
  (`podeSemprePermitir`)
- **Teste:**
  `test/domain/actions/decide.spec.ts` ("container_stop, a página
  global de containers" — CONSEGUE auto_approve; "teto de container_remove" —
  NUNCA consegue),
  `test/application/use-cases/actions/execute-container-stop.use-case.spec.ts`,
  `test/application/use-cases/actions/execute-container-remove.use-case.spec.ts`
  (os dois hops a partir de `running`; um hop só a partir de `stopped`/
  `failed`; idempotência; `BrokerRecusouError`/`BrokerIndisponivelError`
  nunca propagam),
  `test/application/use-cases/actions/approve-always-action.use-case.spec.ts`,
  `apps/web/src/lib/aprovacoes.test.ts`,
  `apps/web/src/routes/ContainersPage.test.tsx`
- **Decisão arquitetural:** [ADR 0136](../../adr/0136-pagina-global-de-containers.md)
- **Origem:** plano do dono do produto, Parte 1 / PR 1.8

### RN-496 — A página global de containers pergunta ao broker com TETO, e nunca funde registrado com observado {#rn-496}

Mesma família da RN-486/RN-468, aplicada a uma tela NOVA: `GET
workspaces/:workspaceId/containers` (`/containers`, cross-projeto) devolve
uma linha por projeto do workspace que já tem `project_containers`
(`ContainersOverviewRepository`, TRÊS consultas em lote, nunca uma por
projeto — mesmo espírito de `ProjectsSummaryRepository`), mas perguntar ao
broker o estado OBSERVADO é uma chamada de REDE por projeto, e não cabe
numa consulta SQL.

**O teto (ADR 0060) é por DUAS réguas, não uma.** Primeiro, só linhas
`provisioning`/`running` são ELEGÍVEIS — um container `stopped`/`failed`/
`removed` não precisa de confirmação do daemon para a tela fazer sentido
(ninguém espera que ele esteja de pé). Segundo, entre as elegíveis, no
máximo `TETO_DE_VERIFICACOES_POR_CARGA` (20, revisável) são perguntadas ao
broker POR CARREGAMENTO — em paralelo, nunca em série. O que sobra de fora
de qualquer uma das duas réguas carrega `naoVerificado`
(`fora_do_escopo_da_verificacao` | `teto_de_verificacoes_atingido`), um
campo PRÓPRIO da tela — nunca confundido com `naoObservado`
(`broker-nao-configurado`/`broker-sem-resposta`/`broker-recusou`), que é
sobre o broker TER SIDO perguntado e não ter respondido. Uma linha fora do
teto tem `observado`/`naoObservado`/`detalheDaObservacao` todos `null`: a
tela nunca inventa uma resposta que o broker não deu.

**A leitura da imagem é a CONGELADA, não a vigente.** `imageVersion` em
`project_containers` aponta para a versão de `artifact.project_image` que
estava vigente quando a linha nasceu — o Arquiteto pode ter revisado a
decisão DEPOIS. A tela resolve a imagem-texto buscando o evento
`artifact.project_image` cuja versão bate com `imageVersion`
(`decisaoNaVersao`, `domain/containers/project-container.ts`), nunca a
decisão mais recente — mostrar a mais recente mentiria sobre qual imagem o
container que subiu de verdade usa. `null` quando o evento daquela versão
não é encontrado (nunca inventada).

**A `proposed_action` pendente de container (se houver) viaja na MESMA
leitura em lote**, batida por `projectId IN (...)` como as outras duas — é
o que permite a tela trocar os três botões de ação pelo `ApprovalCard`
inline sem uma quarta consulta por projeto.

- **Onde:** `src/application/ports/containers-overview-repository.port.ts`,
  `src/infrastructure/persistence/drizzle/containers-overview.repository.ts`,
  `src/application/use-cases/containers/obter-visao-geral-de-containers.use-case.ts`,
  `src/domain/containers/project-container.ts` (`decisaoNaVersao`,
  `versaoDoPayload`), `src/interfaces/http/containers/containers-overview.controller.ts`,
  `apps/web/src/routes/ContainersPage.tsx`, `apps/web/src/lib/hooks.ts`
  (`useContainersOverview`)
- **Teste:**
  `test/infrastructure/persistence/drizzle/containers-overview.repository.spec.ts`
  (só entra projeto com `project_containers`; imagem CONGELADA, não a
  vigente; `acaoPendente` cross-sessão; número de consultas não cresce com a
  quantidade de projetos),
  `test/application/use-cases/containers/obter-visao-geral-de-containers.use-case.spec.ts`
  (elegibilidade por status; teto por carga; `naoObservado` nunca confundido
  com `naoVerificado`),
  `test/interfaces/http/containers/containers-overview.controller.spec.ts`,
  `apps/web/src/routes/ContainersPage.test.tsx`
- **Decisão arquitetural:** [ADR 0136](../../adr/0136-pagina-global-de-containers.md)
- **Origem:** plano do dono do produto, Parte 1 / PR 1.8

## A base única dos projetos montados (RN-500) {#a-base-unica-dos-projetos-montados-rn-500}

### RN-500 — Existe UMA base para os projetos montados, ela é montada por identidade, e ausente quer dizer "não ofereça o modo" {#rn-500}

`BRABO_PROJECTS_BASE` é a **única** pasta do computador do operador que os
containers do Brabo enxergam. Ela é montada por **identidade** (`$X:$X`) nos
serviços `api` e `engine`, o que significa que o caminho é o MESMO no host e
dentro dos dois containers.

A identidade não é preferência de estilo. A string de `projects.workspace_path`
é digitada pelo usuário e mostrada de volta a ele; com host ≠ container o
produto teria que escolher qual das duas guardar, e qualquer escolha faz a tela
mentir para alguém. E é ela que faz `projectScopeRoot` (api) e
`Engine.Actions.Workspace.workspace_dir/2` (engine) continuarem corretos **sem
uma linha de código nova** — o discriminador da barra inicial segue valendo, e o
escopo de terminal do ADR 0055 continua autorizando exatamente a pasta que o
usuário vê.

**Ausente é estado NORMAL, não erro.** `baseDeProjetos()` devolve `null` quando
a variável não está definida ou está vazia, e NUNCA lança. `null` viaja até o
cliente por `GET /workspaces/:workspaceId/projects-base` (`maintainer`, o mesmo
mínimo de `POST .../projects`, porque é para decidir o que aquela rota oferece
que o valor existe) e é assim que a criação de projeto aprende a **não oferecer**
o modo Pasta montada. Oferecer um modo que a instalação não honra produz um
projeto que trava depois, na primeira ferramenta do primeiro agente, longe da
tela onde a decisão foi tomada — é a mesma lição da RN-170.

`dentroDaBaseDeProjetos` reusa `dentroDoEscopo`, a mesma função do escopo de
terminal, e não uma comparação de prefixo escrita de novo: a armadilha é
exatamente a que ela já resolve — `/home/voce/brabo2` **não** está dentro de
`/home/voce/brabo`, embora a string comece igual. A própria base conta como
dentro; com base `null`, nada está dentro.

**A base é variável PRÓPRIA**, nunca `PROJECT_WORKSPACES_HOST_DIR`. Os três
motivos estão no ADR, e o primeiro tem consequência de dados: workspace
gerenciado é nomeado por `workspace_dir_name` (UNIQUE) e projeto montado é
nomeado pelo usuário, então `<base>/loja` e um projeto `container` com
`workspace_dir_name = loja` cairiam na MESMA pasta física, com
`init_from_bare!` dando `git init` dentro do projeto do outro.

**A guarda do checkout mora no preflight, e é o único lugar onde ela é
possível.** `pnpm dev` **recusa subir** quando a base se sobrepõe ao checkout do
Brabo, nos dois sentidos. A api não consegue fazer essa checagem: ela compara
contra `process.cwd()`, que dentro do container dela é `/workspace`, e nunca vê
o caminho real no disco. Sem essa guarda, quem clona o Brabo em `$HOME/brabo` e
aponta a base para lá passa por toda validação existente e faz os dev agents
executarem dentro da árvore do próprio produto — a falha do ADR 0055 entrando
por uma porta que ele não vigia.

**O que esta RN NÃO faz:** ela não exige que um projeto `mounted` esteja dentro
da base. `caminhoDeWorkspaceLocalValido` e `projectScopeRoot` ficam intactos —
aquele predicado roda em toda LEITURA, e projeto montado legado fora da base
passaria a explodir ao ser lido. A base é regra de CRIAÇÃO e CONVERSÃO, e entra
na RN seguinte.

- **Onde:** `src/infrastructure/filesystem/project-workspaces-root.ts:67`
  (`baseDeProjetos`) e `:92` (`dentroDaBaseDeProjetos`);
  `src/interfaces/http/iam/workspaces.controller.ts:197`
  (`GET :workspaceId/projects-base`); `scripts/dev/base-de-projetos.mjs` e a
  chamada em `scripts/dev/preflight.mjs`; `docker/docker-compose.yml` e
  `docker/docker-compose.prod.yml` (serviços `api`, `engine`, `broker`)
- **Teste:**
  `test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (`describe('baseDeProjetos / dentroDaBaseDeProjetos')`) e
  `scripts/dev/base-de-projetos.spec.ts`
- **ADR:** [0141](../../adr/0141-base-unica-dos-projetos-montados.md)
- **Origem:** plano do dono do produto, PR 1

---

## A pasta montada nasce quando o container sobe (RN-501) {#a-pasta-montada-nasce-quando-o-container-sobe-rn-501}

### RN-501 — `mounted` valida só o LÉXICO e a base na criação; a pasta é MATERIALIZADA depois, por quem tem autoridade sobre o disco {#rn-501}

A criação de um projeto `mounted` **deixou de tocar disco**. Ela exige duas
coisas, e as duas são léxicas:

1. o mesmo predicado que `runner` já usava (`caminhoDeWorkspaceLocalValido`) —
   absoluto, sem `..`, fora da raiz e das pastas de sistema, sem se sobrepor ao
   checkout do Brabo (RN-422/RN-423);
2. estar **dentro de `BRABO_PROJECTS_BASE`** ([RN-500](#rn-500)), que é a única
   pasta do computador que os containers da api e do engine enxergam.

O projeto nasce com `workspaceVerifiedAt: null`, exatamente como um `runner`.

**Por que adiar.** O requisito é do dono do produto e é literal: *"se for Pasta
montada, o bind-mount deve ser criado APÓS a decisão do arquiteto"*. A validação
de disco rodava na CRIAÇÃO, que é a primeira tela do fluxo, e a decisão do
Arquiteto acontece muitas sessões depois — exigir a pasta pronta na criação é
exigi-la antes de existir decisão nenhuma. E é o que impedia `mounted` de ser
escolha de primeira classe: um caminho SUGERIDO pelo assistente
(`<base>/<slug>`) é, por construção, um caminho que ainda não existe.

A diferença entre `mounted` e `runner` nunca foi *o que conta como caminho
válido* — é **quando e quem** confirma o disco. No `runner` é o CLI conectando;
no `mounted` é a materialização.

**Sem base configurada, o MODO não está disponível.** A recusa diz isso, com o
nome da variável e o que o operador precisa fazer — nunca finge que o caminho é
que estava errado. Fora da base, a recusa **nomeia a base** e **sugere**
`<base>/<nome que a pessoa pediu>`, nunca a base pelada, que ensinaria a colocar
o projeto na raiz de todos eles. As duas mensagens saem de UMA fonte
(`motivoDeForaDaBaseDeProjetos`), porque as duas portas que aplicam a regra —
criação/conversão e materialização — recusam pelo mesmo motivo.

**A materialização** (`materializarWorkspaceMontado`) é `mkdir -p` mais as três
perguntas de disco de sempre (existe? é pasta? dá para escrever?), com a recusa
por estar fora da base **antes** do `mkdir` — senão um caminho gravado por fora
do produto faria a api criar pasta em qualquer lugar que ela alcança. Dois
chamadores:

- **`ExecuteContainerStartUseCase`** — o normal. Quando a Infra sobe o
  container, a pasta é criada, provada gravável, e `workspace_verified_at` é
  carimbado pelo MESMO caminho que `ConfirmProjectWorkspaceUseCase` usa. Falhar
  é `failed` **NOMEADO**, nunca throw nem 500 — mesma disciplina de
  `BrokerIndisponivelError`/`RunnerNaoConectadoError` —, e o ciclo de vida
  **não** chega a ser marcado `provisioning`: marcá-lo e só então descobrir que
  não dá para escrever deixaria `project_containers` afirmando um estado que
  nunca existiu. A mensagem nomeia a variável, o caminho, a causa provável (dono
  da pasta no host; as imagens rodam non-root, ADR 0024) e o próximo passo
  ("aprove `container_start` de novo").
- **`ConvertProjectExecutionModeUseCase`** — a exceção, declarada. A conversão
  não tem passo de container onde pendurar o trabalho, e logo em seguida ela MOVE
  o `permissions.json` para `permissionsFilePath(localNova)`, que em `mounted` é a
  pasta do usuário. Mover arquivo para dentro de pasta inexistente falha, então
  aqui mkdir-na-decisão é o certo — antes da transação, para que a recusa não
  deixe transação aberta, e virando 400.

**O que esta RN NÃO faz, e é a regressão mais fácil de causar.** A regra da base
**não** entra em `caminhoDeWorkspaceLocalValido`. Esse predicado roda em TODA
LEITURA, por `projectScopeRoot` (escopo de terminal, `permissions.json`, aba
Code), e um projeto `mounted` LEGADO — criado quando o bind-mount era uma linha
de compose por projeto, portanto fora da base — passaria a explodir com
`LocalizacaoDeProjetoInvalidaError` ao ser simplesmente lido. A base é regra de
**criação e conversão**; o léxico é **para sempre**.

**Sem migration, e o CHECK do banco fica intacto.** `mounted` continua gravando
`workspace_path` NÃO-nulo, então
`(execution_mode <> 'container') = (workspace_path IS NOT NULL)` segue
satisfeito. Adiar a **verificação** nunca toca o invariante de **pareamento**.

**Consequência declarada:** entre criar o projeto e subir o container,
`workspace_path` aponta para uma pasta que pode não existir. Nada quebra
(`projectScopeRoot` é léxico; `permissions.json` degrada para
`EMPTY_PERMISSIONS_FILE`, que é `require_approval` em tudo), mas a tela precisa
DIZER — uma tela que mostra um caminho sem dizer que ele ainda não existe é uma
tela afirmando o que não sabe.

- **Onde:** `src/application/services/workspace-location.ts:93`
  (léxico) e `:108` (base);
  `src/infrastructure/filesystem/project-workspaces-root.ts:575`
  (`motivoDeForaDaBaseDeProjetos`), `:624`
  (`validarWorkspaceMontadoEmDisco`, o antigo `validarCaminhoDeWorkspaceLocal`)
  e `:705` (`materializarWorkspaceMontado`);
  `src/application/use-cases/iam/convert-project-execution-mode.use-case.ts:139`;
  `src/application/use-cases/actions/execute-container-start.use-case.ts:133`
  e `:334`
- **Teste:**
  `test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (`describe('materializarWorkspaceMontado')` e a não-regressão "projeto
  mounted LEGADO, FORA da base, continua resolvendo sem lançar");
  `test/application/use-cases/iam/create-project-modo-de-workspace.spec.ts`
  (`describe('mounted valida só o léxico + a base na criação')`);
  `test/application/use-cases/iam/convert-project-execution-mode.use-case.spec.ts`;
  `test/application/use-cases/actions/execute-container-start.use-case.spec.ts`
  (`describe` "ExecuteContainerStartUseCase — materialização do mounted")
- **ADR:** [0142](../../adr/0142-validacao-de-workspace-montado-adiada.md), que
  referencia [0141](../../adr/0141-base-unica-dos-projetos-montados.md)
- **Origem:** plano do dono do produto, PR 2

---
