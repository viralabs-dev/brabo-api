---
id: rn-api-parte-10
title: 'Regras de negócio — API — parte 10 (desde RN-727)'
sidebar_label: 'API — parte 10 (desde RN-727)'
description: 'As RNs hospedadas na raiz api.'
keywords: [regras de negócio, api]
---

# API — parte 10 (desde RN-727)

## A Anamnese não paga duas vezes pela mesma janela, e o resgate de gate não reinicia ciclo que espera alguém (RN-722) {#a-anamnese-nao-paga-duas-vezes-pela-mesma-janela-e-o-resgate-de-gate-nao-reinicia-ciclo-que-espera-alguem-rn-722}

<a id="rn-727"></a>

### RN-727 — A história draft se corrige e se arquiva, pelo PO e pelo usuário, sem apagar nada {#rn-727}

- **Regra:** uma história `draft` SEM tarefa em execução (`in_progress` ou
  `in_review`) pode ter o título corrigido e pode ser ARQUIVADA — pelo PO
  (ferramentas `update_story`, que também corrige a descrição, e
  `archive_story`) e pelo usuário na aba Backlog ("Editar título" e
  "Arquivar", com confirmação). As duas portas passam pela MESMA régua
  (`recusaDeCorrecaoDeHistoria`), e a recusa é 409 NOMEADO: `historia_arquivada`,
  `historia_nao_draft` ou `historia_com_tarefa_em_execucao`, com a frase que o
  modelo e o toast mostram. Arquivar NÃO apaga: a linha de `stories` ganha
  `archived_at`/`archived_reason` (migration `0069`,
  [ADR 0212](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0212-historia-arquivada.md)), as tarefas ficam, e o evento
  NOVO `backlog.story_archived` guarda quem, por quê e quais tarefas; a edição
  grava `backlog.story_updated` com o título anterior. A história arquivada
  sai do backlog (`listar_backlog` incluído — o PO não a vê para não
  completá-la de novo), da cobertura (`computeCoverage` lê só as não
  arquivadas), da fila de promoção, do plano do Dev Lead e do claim, e as
  tarefas dela saem junto, pela história; transição, `complete_story` e
  `create_task` recusam história arquivada. O papel mínimo do usuário é o das
  outras escritas de backlog (promover/devolver, RN-048): `developer`; abaixo
  dele os botões ficam inertes com o motivo em texto, e o mesmo vale para
  história fora de `draft` ou com tarefa em execução. Cada história mostra
  quantas tarefas tem.
- **Onde:** `src/domain/backlog/correcao-de-historia.ts:33`
  (`recusaDeCorrecaoDeHistoria`),
  `src/application/use-cases/backlog/corrigir-historia.use-case.ts:52`
  (`editar`), `:162` (`arquivar`),
  `src/infrastructure/persistence/drizzle/backlog.repository.ts:97`
  (`findByProject`), `:413` (`claimNext`),
  `src/interfaces/http/backlog/backlog.controller.ts:209`
  (`updateTitle`), `:223` (`archive`),
  `src/interfaces/http/internal/internal-sessions.controller.ts:583`
  (`updateStoryRoute`), `:647` (`archiveStoryRoute`),
  `apps/engine/lib/engine/harness/tools/update_story.ex:45` (`run`),
  `apps/engine/lib/engine/harness/tools/archive_story.ex:38` (`run`),
  `apps/web/src/lib/correcao-de-historia.ts:10` (`motivoDeCorrecaoInerte`)
- **Teste:** `test/application/use-cases/backlog/corrigir-historia.use-case.spec.ts`
  (feliz: título e arquivo com evento; falha: tarefa `in_progress`/`in_review`
  é 409 `historia_com_tarefa_em_execucao` sem escrita),
  `test/application/use-cases/execution/claim-next-task.use-case.spec.ts`
  ("não pega task de story ARQUIVADA, nem a conta, nem a lista", contra
  Postgres), `test/interfaces/http/backlog/backlog-corrigir-historia.controller.spec.ts`
  (o papel das duas rotas é o de promover; `viewer` não alcança),
  `apps/engine/test/engine/harness/tools/corrigir_historia_test.exs` (a recusa
  nomeada chega ao modelo), `apps/web/src/routes/ProjectBacklogTab.test.tsx`
  ("corrigir história (RN-727)": feliz, tarefa em execução e papel abaixo de
  `developer` deixam inerte com o motivo)
- **Origem:** AT-406 (TP-01 de 03/10: o PO criou duas histórias duplicadas,
  chamou `delete_story` e recebeu "ferramenta desconhecida"; as duplicatas
  ganharam tarefa e entraram no plano), decisão do dono de 03/10 ("PO e
  usuário")

<a id="rn-729"></a>

### RN-729 — A PR de infra mira `main` e diz onde mergear; a sidebar abre só o projeto aberto {#rn-729}

- **Regra:** quatro cláusulas medidas no TP-01 (03/10).
  (1) A PR de infra (`open_infra_pr`) segue a [RN-664](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-664): a branch
  `feature/infra-setup` nasce de `main` e a PR mira `main` (a branch de
  trabalho trunk, [RN-1022](parte-11.md#rn-1022); antes era `dev`) — o worktree do dev
  agent nasce da mesma branch. Repositório sem ela falha nomeado pelo
  provider, sem queda para a default. A PR leva o autor `<agente>[bot]` (`infra[bot]` quando o ator não é
  agente), a mesma identidade da [RN-705](parte-09.md#rn-705). Em Aprovações, cada PR de
  infra em revisão ganha "Mergear na aba PRs", que troca a moldura para a aba
  PRs (onde o merge mora). (2) Abrir um projeto RECOLHE os outros na sidebar
  e rola a lista até ele; no Dashboard nenhum fica forçado expandido; o
  chevron segue alternando à mão. (3) Os campos de texto do assistente "Novo
  projeto" (nome, caminho, repositório adotado) levam `SEM_AUTOFILL`, o mesmo
  conjunto da [RN-693](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-693). (4) Decidir um merge na aba PRs invalida a
  fila inteira de pendentes do projeto, então o contador "PRs" da sidebar não
  segue mostrando o merge já executado até o próximo poll; e o lead de QA (ou
  SecOps) deixa de dizer "trabalhando" quando, depois do último parecer, um
  subagente da área registra `delegation.failed` — passa a `falhou`. Nenhuma
  query nem poll novo.
- **Onde:** `src/application/use-cases/actions/execute-infra-pr.use-case.ts:71`
  (`ExecuteInfraPrUseCase`),
  `apps/web/src/routes/ProjectApprovalsTab.tsx:106` (`ProjectApprovalsTab`),
  `apps/web/src/routes/Shell.tsx:562` (`idDoProjetoAtual`),
  `apps/web/src/routes/NewProjectWizard.tsx:155` (`NewProjectWizard`),
  `apps/web/src/routes/ProjectPrsTab.tsx:150` (`invalidateMergeActions`),
  `apps/web/src/lib/agent-status.ts:254` (`gateStatus`)
- **Teste:** `test/application/use-cases/actions/execute-infra-pr.use-case.spec.ts`
  ("a branch nasce de dev, a PR mira dev e leva infra[bot]"; falha:
  "repositório sem dev falha nomeado, sem cair na default"),
  `apps/web/src/routes/Shell.test.tsx` ("abrir um projeto recolhe o visitado
  antes e rola até o aberto", "no Dashboard nenhum projeto fica forçado
  expandido"), `apps/web/src/routes/NewProjectWizard.test.tsx` ("o campo de
  nome não convida o autofill"), `apps/web/src/lib/agent-status.test.ts`
  ("delegação falhada depois do parecer encerra o trabalhando")
- **Origem:** AT-411, AT-412, AT-413, AT-415

<a id="rn-730"></a>

### RN-730 — O 402 do provider tem `code` próprio, e é ele que decide o crédito esgotado {#rn-730}

- **Regra:** o HTTP 402 do provider de LLM é normalizado como
  `insufficient_credit` (antes caía em `upstream`), na mesma tabela de status
  do ADR 0041 — os demais status continuam como estavam. O `code` viaja ao
  engine como `errorCode` ao lado do `error`, no corpo de `llm-turn` e no frame
  `final` de `llm-turn/stream` (`null` sem erro ou com erro que não é do
  provider, como orçamento e binding ausente). No engine,
  `FalhaDeTurno.credito_esgotado?/1` decide primeiro pelo `code`
  (`insufficient_credit` é crédito; outro `code` não é, mesmo com a frase), e
  o frame `{:final, texto, code}` dos conversacionais dá origem `infra` pelo
  código. O reconhecimento por texto da RN-726 fica só como REDE: api anterior
  ao campo, e caminho que só leva a mensagem.
- **Onde:** `src/domain/llm/llm-provider-errors.ts:38`
  (`LLMInsufficientCreditError`), `:86` (`normalizeHttpStatus`),
  `src/application/use-cases/llm/run-llm-turn.use-case.ts:270`
  (`streamErrorCode`),
  `src/application/use-cases/llm/stream-llm-turn.use-case.ts:305`
  (`streamErrorCode`),
  `apps/engine/lib/engine/agents/falha_de_turno.ex:91` (`credito_esgotado?`),
  `:71` (`origem`), `apps/engine/lib/engine/harness/tool_loop.ex:168`
  (`last_error_code`), `apps/engine/lib/engine/dev/dev_agent_server.ex:931`
  (`handle_outcome`)
- **Teste:** `test/contract/llm-provider.contract.ts` (`erro_402 vira
  chunk de erro com code "insufficient_credit"`; falha: `erro_500` segue
  `upstream`), rodado por todas as suítes de contrato de provider;
  `apps/engine/test/engine/agents/falha_de_turno_test.exs` ("insufficient_credit
  é crédito esgotado e origem infra, sem frase nenhuma"; falha: "outro code não
  é crédito, mesmo com a frase; sem code, o texto é a rede")
- **Origem:** AT-416 (a lacuna declarada da RN-726)

<a id="rn-734"></a>

### RN-734 — O caminho OpenAI-compatível manda o teto de saída SEMPRE {#rn-734}

- **Regra:** toda chamada de chat pelo dialeto `/chat/completions` (os
  providers que nascem de `OpenAICompatibleProvider`, OpenRouter incluído)
  leva o campo de teto de saída — `max_tokens` ou `max_completion_tokens`,
  conforme `maxTokensField` — mesmo quando quem chama não define
  `maxTokens`. Sem definição, o valor é `MAX_TOKENS_PADRAO` (4096), o MESMO
  `DEFAULT_MAX_TOKENS` do `anthropic-provider.ts`, para o agente ter o mesmo
  teto nos dois dialetos. O motivo é a RESERVA de crédito: sem o campo, o
  OpenRouter reserva por chamada a saída MÁXIMA do modelo e recusa com 402
  ("would exceed your available credits given your current in-flight
  requests") com saldo que cobriria a chamada real. Hoje nenhum chamador
  (engine → `llm-turn`) define `maxTokens`, então o padrão vale para todos
  os agentes. A resposta cortada pelo teto (`finish_reason: "length"`) é
  lida e narrada desde a [RN-737](#rn-737) (a RN-698 narra o teto de
  ITERAÇÕES, não o de tokens). Hipótese NÃO medida com chave real: que a
  reserva explica o 402 do TP-01.
- **Onde:** `src/infrastructure/llm/openai-compatible-provider.ts:38`
  (`MAX_TOKENS_PADRAO`), `:634` (`flags`)
- **Teste:** `test/infrastructure/llm/openai-compatible-provider.contract.spec.ts`
  (sem `maxTokens` o corpo leva `max_tokens: 4096`; com `maxTokens: 123` leva
  123; com `maxTokensField: 'max_completion_tokens'` o campo muda e
  `max_tokens` não vai)
- **Origem:** AT-419 (TP-01 de 03/10: US$ 1,79 livres e 402 na chamada do Dev
  Lead e na do dev agent)

<a id="rn-737"></a>

### RN-737 — A resposta cortada pelo teto de saída é sinalizada, não executada e dita {#rn-737}

- **Regra:** a api lê o motivo de parada nos dois dialetos — `finish_reason:
  "length"` no OpenAI-compatível (OpenRouter incluído) e `stop_reason:
  "max_tokens"` no Anthropic — e, só quando a resposta foi cortada pelo teto
  de saída (RN-734), devolve `truncated: true` na resposta de `llm-turn` e no
  frame `final` de `llm-turn-stream` (campo aditivo; ausente no caso normal).
  O engine anota o sinal no processo do turno, a cada chamada de LLM: (a) a
  chamada de ferramenta de resposta cortada NÃO é executada — volta ao laço
  como erro nomeado ("a resposta foi cortada pelo limite de tokens… Reenvie o
  argumento em partes menores"), que o modelo lê e corrige (RN-163); (b) o
  fecho de texto cortado ganha, DEPOIS do texto do modelo e sem reescrevê-lo,
  a linha no idioma do turno (RN-622, molde da RN-731): `pt*` "Resposta
  cortada pelo limite de tamanho.", qualquer outro — ou nenhum — "Response cut
  off by the length limit.". O Ollama não lê o motivo de parada (fora do
  escopo, declarado).
- **Onde:** `src/infrastructure/llm/openai-compatible-provider.ts:314`
  (`cortadaPeloTeto`),
  `src/infrastructure/llm/anthropic-provider.ts:228` (`finalMessage`),
  `src/application/use-cases/llm/run-llm-turn.use-case.ts:234`
  (`truncated`),
  `src/application/use-cases/llm/stream-llm-turn.use-case.ts:301`
  (`truncated`),
  `apps/engine/lib/engine/harness/resposta_cortada.ex:43` (`registrar`),
  `:89` (`descarregar`),
  `apps/engine/lib/engine/harness/argumentos_de_ferramenta.ex:26` (`executar`),
  `apps/engine/lib/engine/agents/texto_do_turno.ex:65` (`payload_do_turno`)
- **Teste:** `test/contract/llm-provider.contract.ts` ("resposta
  cortada pelo teto de saída emite o sinal truncated" e "resposta normal não
  traz o sinal de corte", rodados com servidor falso pelos harnesses
  OpenAI-compatível e Anthropic),
  `apps/engine/test/engine/harness/resposta_cortada_test.exs` (ferramenta de
  resposta cortada não roda e volta erro nomeado; resposta normal roda; fecho
  cortado ganha a linha em pt-BR sem reescrita; fecho normal intacto; pt/en)
- **Origem:** AT-423 (lacuna declarada na RN-734)

<a id="rn-739"></a>

### RN-739 — O diagnóstico leva o corpo de erro do provider inteiro, e a bolha segue curta {#rn-739}

- **Regra:** a mensagem do erro normalizado de provider (ADR 0041) leva o
  corpo de erro até `LIMITE_DO_DETALHE` = 4 000 caracteres (era 200, e cortava
  o JSON do OpenRouter antes do `metadata.reason`, que diz a natureza do
  erro). Essa mensagem é o texto do frame final e vira, verbatim, o `reason`
  do `agent.error` (`FalhaDeTurno.diagnostico/1`, RN-733). A frase da bolha
  NÃO cresce com ela: fora do caso de crédito (que já tem frase curta), o
  texto narrado entra na bolha cortado em 300 caracteres com "…".
- **Onde:** `src/domain/llm/llm-provider-errors.ts:164`
  (`LIMITE_DO_DETALHE`), `apps/engine/lib/engine/agents/falha_de_turno.ex:284`
  (`@teto_da_bolha`), `:289` (`curto`)
- **Teste:** `test/domain/llm/llm-provider-errors.spec.ts` (o 402
  leva `"metadata":{"reason":"insufficient_credits"` inteiro; corpo acima do
  teto corta), `apps/engine/test/engine/agents/falha_de_turno_test.exs`
  (RN-739: o `reason` contém o `metadata`; erro longo corta na bolha e não no
  diagnóstico)
- **Origem:** AT-424 (TP-01, 3ª rodada, 03/10: `reason` cortado em
  `…"code":402,"metadata":{"reason":"in…`)

<a id="rn-741"></a>

### RN-741 — O raciocínio tem orçamento próprio e não come a saída visível {#rn-741}

- **Regra:** quando o modelo do binding raciocina (`models.supports_reasoning`,
  do catálogo), os casos de uso de LLM mandam `reasoning: true` ao provider.
  Um provider com `campoDeRaciocinio` configurado (hoje só o OpenRouter) manda
  um orçamento EXPLÍCITO de raciocínio — `reasoning: { max_tokens:
  ORCAMENTO_DE_RACIOCINIO }`, 4096 — e o `max_tokens` da chamada passa a ser a
  saída visível (o teto da RN-734) MAIS esse orçamento, para o texto e a
  chamada de ferramenta continuarem com o teto deles. O raciocínio nunca é
  desligado (`exclude`/`enabled: false` não são enviados). Modelo sem
  raciocínio, e provider sem a configuração, mandam o corpo de antes, byte a
  byte. O `anthropic-provider` direto não envia `thinking`, então o modelo não
  raciocina por ali e o buraco não existe — declarado, sem mudança. A forma do
  campo foi lida da doc do OpenRouter (Reasoning Tokens: `reasoning.max_tokens`;
  o `max_tokens` da chamada tem de ser maior que ele).
  **Revisada pela [RN-782](#rn-782)/[RN-783](#rn-783) (AT-467):** a medição
  com credencial de 10/10 mostrou que o Haiku 5.5 IGNORA `reasoning.max_tokens`;
  o campo deixou de ser enviado e a folga no `max_tokens` ficou.
- **Onde:** `src/infrastructure/llm/openai-compatible-provider.ts:48`
  (`ORCAMENTO_DE_RACIOCINIO`), `:640` (`controla`)
- **Teste:** `test/infrastructure/llm/openai-compatible-provider.contract.spec.ts`
  (`raciocínio com orçamento próprio (RN-741)`: orçamento e teto somado; sem
  raciocínio o corpo não muda; provider sem campo não inventa orçamento)
- **Origem:** AT-427 (TP-01, 08/10: `anthropic/claude-haiku-5.5` com
  `output_tokens = reasoning_tokens = 4096` em duas chamadas seguidas do PO)

<a id="rn-752"></a>

### RN-752 — PR de infra mergeada sai de "PRs de infra em revisão" {#rn-752}

- **Regra:** a leitura `GET .../infra-artifacts` (seção "PRs de infra em
  revisão" da aba Aprovações) não devolve o artefato de infra cuja PR já foi
  mergeada. O gate do artefato termina em `awaiting_user` e nada o move depois
  do merge; em vez de coluna nova, a régua é DERIVADA: a PR do artefato é o
  `pullRequestId` do resultado do `open_infra_pr` que a abriu (`prActionId`),
  e ela está mergeada quando um `git_merge` do projeto com status `executed`
  devolveu `state: 'merged'` para esse id — o mesmo casamento por
  `pullRequestId` que fecha as tarefas (RN-628). Merge que falhou ou ainda
  pende não tira nada da lista. O aviso de "PR de infra pronta para merge" no
  fio ou no painel "precisa de você" NÃO foi feito aqui.
- **Onde:** `src/application/use-cases/execution/list-infra-artifacts.use-case.ts:26`
  (`execute`)
- **Teste:** `test/application/use-cases/execution/list-infra-artifacts.use-case.spec.ts`
  (merge executado tira a PR; merge falho ou pendente a mantém)
- **Origem:** AT-436 (TP-01: depois de "Merge" → "Aprovar" na aba PRs, a PR
  seguia com Dev ✓ QA ✓ SecOps ✓ e "Você" pendente)

<a id="rn-758"></a>

### RN-758 — O recorte do Jev nunca tira a ferramenta de obrigação do agente {#rn-758}

- **Regra:** quando o Jev recorta o menu do passo ([RN-625](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-625), P3), o
  menu recebe de volta o PISO do agente: para o PO, `create_story`,
  `create_task` e, desde a [RN-942](parte-11.md#rn-942), `declare_open_question`; para o Arquiteto, `create_module_map`,
  `route_modules_to_infra`, `declare_module_contracts`, `propose_adr` e
  `create_c4_diagram`. Só entra o que está no catálogo daquele passo — o piso
  nunca acrescenta ferramenta que o agente não tinha, e em toda queda o
  catálogo inteiro segue como antes. O piso é ESTÁTICO por agente, e isso é
  declarado: a api não tem sinal barato de qual obrigação está pendente
  naquele passo, então ele vale sempre que há recorte. Os dev agents ficam
  sem piso, de propósito (a obrigação deles muda a cada passo; para eles vale
  só a [RN-759](#rn-759)) — salvo `report_done`/`report_blocked`, que entram no piso deles desde a [RN-839](#rn-839).
- **Onde:** `src/domain/llm/tool-router.ts:401` (`menuComPiso`) e
  `src/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.ts:265`
  (`menuComPiso`)
- **Teste:** `test/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.spec.ts`
  (o PO com o menu `["listar_backlog","create_story"]` mantém `create_task`;
  o Arquiteto com 2 de 9 mantém as cinco de artefato)
- **Origem:** AT-445 (TP-01 de 09/10: o PO sem `create_task` respondeu "Não
  tenho uma ferramenta para criar tarefas" e fechou com 8 histórias sem
  tarefa; o Arquiteto com 2 de 9 fechou sem roteamento, contratos, ADR nem C4)

<a id="rn-759"></a>

### RN-759 — O passo recortado avisa ao modelo que o menu é um recorte {#rn-759}

- **Regra:** quando o recorte do Jev é aplicado (`aplicado: true`), a chamada
  ao provider DAQUELE passo leva, no fim, uma mensagem `system` EFÊMERA que
  diz quantas e quais ferramentas o passo recebeu, que as demais seguem
  disponíveis nas próximas voltas e que o agente não deve concluir que não tem
  uma ferramenta nem encerrar o turno esperando por ela. Ela nunca entra no
  histórico do agente nem no event log, e não existe sem recorte nem em queda.
  É montada na api, e não na fachada do engine como a [RN-622](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-622),
  porque só a api sabe o menu depois do Jev. Não aplicar o recorte na volta
  que fecha o turno foi avaliado e não feito: a api não sabe antes da
  resposta que a volta será a última.
- **Onde:** `src/domain/llm/tool-router.ts:420` (`avisoDeRecorte`) e
  `src/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.ts:281`
  (`avisoDeRecorte`)
- **Teste:** `test/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.spec.ts`
  (o aviso chega como última mensagem com recorte; sem recorte e em queda, as
  mensagens são as do pedido)
- **Origem:** AT-445 (o dev agent bloqueou uma tarefa "sem ferramenta para
  editar arquivos" tendo `write_file`)

<a id="rn-761"></a>

### RN-761 — Dependência instalada não entra no repositório: `.gitignore` base, commit que a exclui e gate que a acusa {#rn-761}

- **Regra:** três camadas, com a MESMA lista de diretórios (`node_modules`,
  `deps`, `_build`, `.venv`, `venv`, `__pycache__`, `vendor`, `target`):
  1. o bootstrap do repositório (os três providers e a adoção) ganha o passo
     `commit_gitignore`, que commita um `.gitignore` base em `main` ANTES de
     qualquer branch de trabalho nascer (o repositório é trunk,
     [RN-1022](parte-11.md#rn-1022)), então toda branch de trabalho o herda. É o ponto único
     porque é por ele que TODO repositório criado ou adotado passa, antes de
     qualquer agente escrever; a Infra pelo `module_map` chegaria depois do
     primeiro commit do dev e só nos projetos que passam por ela. O passo só
     CRIA o arquivo: um `.gitignore` já existente, mesmo diferente, é do
     usuário e não entra no plano;
  2. o commit do dev agent (`git_commit`) e o commit que preserva o worktree
     ao bloquear ([RN-743](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-743)) estagiam tudo MENOS esses diretórios, em
     qualquer profundidade (pathspec `:(exclude,glob)`), mesmo sem
     `.gitignore`;
  3. o gate SecOps acusa, como achado (`changes_requested`), diretório da lista
     que apareça no diff da PR, com a contagem de arquivos.
  As duas cópias da lista (api e engine) são conferidas por teste. Declarado:
  arquivo de dependência JÁ rastreado antes desta regra não é removido pelo
  commit (a exclusão não estagia remoção); o projeto já bootstrapado só ganha
  o `.gitignore` se o bootstrap rodar de novo; no modo `runner` o commit roda
  pelo mesmo `GitExecutor` e a mesma exclusão vale onde o engine executa git.
- **Onde:** `src/application/use-cases/git/bootstrap-templates.ts:38`
  (`gitignoreContent`), `src/application/use-cases/git/bootstrap-steps.ts:128`
  (`soSeAusente`), `apps/engine/lib/engine/actions/diretorios_de_dependencia.ex:37`
  (`argumentos_do_add`), `:47` (`commitados`),
  `apps/engine/lib/engine/gates/secops_agent_server.ex:162`
  (`dependencias_commitadas`)
- **Teste:** `test/application/use-cases/git/bootstrap-plan.spec.ts`
  (o repositório vazio planeja os 3 arquivos; `.gitignore` do usuário não entra
  no plano), `test/application/use-cases/git/provision-repository.use-case.spec.ts`
  (o local converge os 6 passos),
  `apps/engine/test/engine/actions/git_executor_test.exs` (`commit exclui
  diretórios de dependência mesmo sem .gitignore`),
  `apps/engine/test/engine/actions/diretorios_de_dependencia_test.exs` (a
  lista é a mesma da api; o SecOps acusa `node_modules`)
- **Origem:** AT-446 (TP-01 de 09/10: PR com 1.453 arquivos, 1.437 em
  `node_modules/`, aprovada por QA e SecOps)

<a id="rn-762"></a>

### RN-762 — O bloqueio por ciclo de correção esgotado grava a origem `politica` {#rn-762}

- **Regra:** quando o gate esgota o teto de correções (`maxGateCorrections`) e
  a task é bloqueada com "ciclo de correção esgotado (gate)", o
  `backlog.task_blocked` e a linha da task levam `origin: "politica"` — o teto
  é decisão de configuração, não falha real (vocabulário do ADR 0020, regra da
  RN-059). Antes saía `origin: null`. O bloqueio de artefato de infra pelo
  mesmo motivo (`infra.artifact_blocked`) não tem campo de origem e fica como
  está, declarado.
- **Onde:** `src/application/use-cases/execution/record-gate-verdict.use-case.ts:215`
  (`politica`)
- **Teste:** `test/application/use-cases/execution/record-gate-verdict.use-case.spec.ts`
  (o ciclo esgotado chama `MarkTaskBlockedUseCase` com `'politica'`; o veredito
  aprovado não bloqueia)
- **Origem:** AT-450 (TP-01 de 09/10: `backlog.task_blocked` com
  `origin: null`)

<a id="rn-770"></a>

### RN-770 — Miudezas da tela de projeto: autor da PR de ADR, modelo da Infra, título da PR do dev, selo da execução, caminho e tabela {#rn-770}

- **Regra:** (1) a PR de ADR leva a identidade do agente (`<agente>[bot]`,
  senão `arquiteto[bot]`), como a de infra ([RN-729](#rn-729)) — a aba PRs
  deixa de dizer "autor desconhecido"; (2) a `agent.response` do Infra Lead
  carrega o `modelName` do frame final, como os outros conversacionais — a
  bolha deixa de dizer "modelo não registrado"; (3) o título da PR do dev
  agent abre pela TAREFA e depois a história (`<tarefa> — <história>`), para
  três PRs da mesma história não parecerem a mesma com o fim cortado; (4) com
  execução ativa (o mesmo predicado da [RN-769](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-769)), a barra da sessão
  diz "Execução" em vez do `kind` gravado (`criativa`, que não muda —
  [RN-097](parte-02.md#rn-097)) e o composer não oferece o Criativo antes de ativado;
  (5) na confirmação da criação, cada segmento do caminho é `nowrap`: a quebra
  só acontece depois da barra, nunca no hífen; (6) a tabela Markdown no balão
  tem piso de `12rem` POR COLUNA e cresce por fração, com o contêiner em
  `min-content` — com `max-content` ela ficava da largura do texto sem quebra
  (medido no Chromium: 2 236px num balão de 708px) e a última coluna sumia.
- **Onde:** `src/application/use-cases/actions/execute-adr-pr.use-case.ts:95`
  (`openPullRequest`); `apps/engine/lib/engine/infra/infra_lead_server.ex:1599`
  (`gravar_texto_do_turno`); `apps/engine/lib/engine/dev/dev_agent_server.ex:1282`
  (`propose_pr`); `apps/web/src/lib/session-destinatario.ts:228`
  (`agentesEmConversa`) e `apps/web/src/lib/session-kind.ts:69`
  (`tipoDaSessao`); `apps/web/src/routes/NewProjectWizard.tsx:1143`
  (`quebraPorSegmento`); `apps/web/src/components/ui/MarkdownMessage.tsx:178`
  (`TabelaMarkdown`)
- **Teste:** `test/application/use-cases/actions/execute-adr-pr.use-case.spec.ts`,
  `apps/engine/test/engine/infra/infra_lead_server_test.exs` ("agent.response
  carrega o nome do modelo"), `apps/engine/test/engine/dev/dev_agent_server_test.exs`
  (fluxo feliz), `apps/web/src/lib/session-destinatario.test.ts`,
  `apps/web/src/lib/session-kind.test.ts`, `apps/web/src/routes/NewProjectWizard.test.tsx`,
  `apps/web/src/components/ui/MarkdownMessage.test.tsx`
- **Origem:** AT-455 (TP-01 de 09/10, achados 2, 3, 8, 9, 16 e 18)

<a id="rn-776"></a>

### RN-776 — Tarefa da execução esperando alguém segura a sessão de execução {#rn-776}

- **Regra:** o heartbeat não fecha a sessão de execução VIGENTE do projeto (a
  `active` mais recente com `execution.activated`) enquanto houver tarefa de
  história não arquivada BLOQUEADA, com PR em `awaiting_user`, ou devolvida
  por conflito de merge ([RN-715](parte-09.md#rn-715), `backlog.task_merge_conflict`
  nesta sessão) e ainda `in_progress`. É o sexto sinal da
  [RN-064](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-064), sem teto, como os outros sinais que esperam uma pessoa;
  vem antes do sinal da conversa ociosa ([RN-581](parte-07.md#rn-581)), que continua
  o único com teto. Sessão de execução ANTIGA do mesmo projeto não é segurada
  pela tarefa: a tarefa é do projeto, e sem esse recorte ela ficaria imortal.
- **Onde:** `src/application/use-cases/sessions/get-session-pending-work.use-case.ts:242`
  (`findPendenteDaExecucao`), `src/infrastructure/persistence/drizzle/backlog.repository.ts:252`
  (`findPendenteDaExecucao`)
- **Teste:** `test/application/use-cases/sessions/get-session-pending-work.use-case.spec.ts`
  (bloqueada, PR esperando merge e conflito seguram; sem nada, fecha; sessão
  de execução antiga não é segurada)
- **Origem:** AT-457 (TP-01 de 09/10: as duas sessões de execução fecharam
  2–8 s depois do `dev.idle`, com tarefa bloqueada e PR esperando o merge)

<a id="rn-777"></a>

### RN-777 — Desbloquear a tarefa acorda o dev do módulo DELA {#rn-777}

- **Regra:** `task.became_claimable` com causa `task_unblocked` leva como
  `modules` o módulo da TAREFA (`tasks.module`, [RN-678](parte-09.md#rn-678)) quando ele
  existe, e os da história só quando a tarefa não tem módulo — o claim é pelo
  módulo da tarefa, então é o dev dele que tem de acordar. O conflito de merge
  já acorda o dono ([RN-715](parte-09.md#rn-715)); com a sessão de execução de pé
  ([RN-776](#rn-776)), o dono continua com linha em `dev_agent_states` para
  ser acordado.
- **Onde:** `src/application/use-cases/execution/unblock-task.use-case.ts:68`
  (`modules`)
- **Teste:** `test/application/use-cases/execution/unblock-task.use-case.spec.ts`
  (tarefa com módulo acorda o dev desse módulo)
- **Origem:** AT-457

<a id="rn-782"></a>

### RN-782 — Aceitar o parâmetro de raciocínio não é pedir raciocínio {#rn-782}

- **Regra:** revisa a [RN-741](#rn-741). O modelo com `supportsReasoning` (no
  OpenRouter, `reasoning` em `supported_parameters` — 341 de 478 modelos, ou
  seja, "aceita o parâmetro", não "raciocina") continua com a FOLGA no teto:
  `max_tokens` = saída visível (RN-734) + `ORCAMENTO_DE_RACIOCINIO` (4096). O
  que sai é o campo `reasoning: { max_tokens }`: ele NÃO é mais enviado a
  modelo nenhum. Medição paga de 10/10 (AT-467): no
  `anthropic/claude-haiku-4.5`, que sem o campo não raciocina, ele LIGAVA o
  raciocínio em 74% das chamadas a 2,8× o custo; no
  `anthropic/claude-haiku-5.5` ele era IGNORADO (pedido 1024, gastou 8192 só de
  raciocínio). A decisão do que pedir mora num ponto só, `opcoesDeRaciocinio`,
  chamado pelos três casos de uso de turno. O TODO(humano) da RN-741 fecha com
  essa medição.
- **Onde:** `src/domain/llm/raciocinio-do-agente.ts:18`
  (`opcoesDeRaciocinio`), `src/infrastructure/llm/openai-compatible-provider.ts:640`
  (`controla`), `src/application/use-cases/llm/run-llm-turn.use-case.ts:200`
  (`opcoesDeRaciocinio`)
- **Teste:** `test/infrastructure/llm/openai-compatible-provider.contract.spec.ts`
  (`modelo que raciocina: folga no teto e NENHUM campo de raciocínio (RN-782)`,
  corpo byte a byte), `test/domain/llm/raciocinio-do-agente.spec.ts`
- **Origem:** AT-467 (medição paga de 10/10)

<a id="rn-783"></a>

### RN-783 — Os dev agents de execução rodam com o raciocínio desligado {#rn-783}

- **Regra:** decisão do dono de 10/10. Para agente `dev-<modulo>` (o Dev Lead,
  `dev-lead`, é conversacional e fica de fora) com modelo de
  `supportsReasoning`, o provider que sabe dizer "desligado" (hoje só o
  OpenRouter, `campoDeRaciocinioDesligado`) manda `reasoning: { enabled: false }`,
  mantendo a folga da [RN-782](#rn-782). Medido no Haiku 5.5: 0 de 8 respostas
  cortadas e −42% de custo. Conversacionais e gates não mudam (sem campo), e
  modelo sem `supportsReasoning` não manda nada. Não é silencioso: a ajuda da
  faceta "thinking" do catálogo de modelos diz que nos dev agents de execução e,
  desde a RN-838, no QA de Automação o raciocínio vai desligado (o mínimo escolhido; o seletor e a bolha não mudam).
- **Onde:** `src/domain/llm/raciocinio-do-agente.ts:23`
  (`raciocinioDesligadoParaOAgente`), `src/infrastructure/llm/openrouter-provider.ts:251`
  (`campoDeRaciocinioDesligadoOpenRouter`)
- **Teste:** `test/infrastructure/llm/openai-compatible-provider.contract.spec.ts`
  (`dev agent: raciocínio desligado explícito, com a folga (RN-783)`),
  `test/domain/llm/raciocinio-do-agente.spec.ts` (dev-* desliga;
  criativo e dev-lead só a folga; sem `supportsReasoning`, nada)
- **Origem:** AT-467 (decisão do dono de 10/10)

<a id="rn-784"></a>

### RN-784 — As leituras de estado do Arquiteto entram no piso do Jev {#rn-784}

- **Regra:** revisa a [RN-758](#rn-758) e a [RN-772](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-772) (decisão do
  dono). O piso do Arquiteto ganha `listar_adrs_propostas` e `listar_backlog`:
  o recorte do Jev nunca as tira, para o Arquiteto não afirmar status de ADR
  nem tarefas do backlog sem poder consultá-los ([RN-773](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-773)). Continua
  valendo que o piso só devolve o que está no catálogo do passo.
- **Onde:** `src/domain/llm/tool-router.ts:315` (`PISO_DO_MENU`)
- **Teste:** `test/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.spec.ts`
  (`Arquiteto recortado pelo Jev: as leituras de estado (ADRs propostas,
  backlog) continuam no menu (RN-784)`)
- **Origem:** AT-460 (TP-01 de 09/10: o Jev tirou do menu do Arquiteto as
  leituras da AT-454)

<a id="rn-785"></a>

### RN-785 — Requisito que depende de outra história ainda não feita é observação no gate de QA {#rn-785}

- **Regra:** além das tarefas irmãs ([RN-765](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-765)), o recorte que a
  QA-estratégia e a QA-automação recebem traz as tarefas NÃO concluídas das
  OUTRAS histórias do mesmo módulo, com o título da história
  (`moduleOpenTasks` em `GET .../dev-context`). O módulo é o da tarefa, senão
  o pedido, senão os da história; história arquivada fica fora. Leitura
  contida (ADR 0060): no máximo 20, com o total real em
  `moduleOpenTasksTotal` e o corte dito no recorte. Requisito da entrega que
  depende do que outra história ainda vai entregar (uma rota, uma tela) vai ao
  `resumo` como observação e não reprova. A régua é de PROMPT, como na RN-765.
- **Onde:** `src/application/use-cases/execution/get-dev-task-context.use-case.ts:235`
  (`tarefasAbertasDoModulo`), `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:20`
  (`texto`)
- **Teste:** `test/application/use-cases/execution/get-dev-task-context.use-case.spec.ts`
  (só a tarefa aberta da outra história do mesmo módulo; arquivada fora; teto
  com o total real) e `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs`
  (as tarefas abertas e o corte no texto). O golden-set do QA não ganhou caso
  (o veredito exige chamada paga) — declarado.
- **Origem:** AT-461 (TP-01 de 09/10, sessão `80e3ce09`: a tarefa "middleware
  JWT" foi reprovada porque "não há rotas de criar, listar, apagar links nem de
  painel no diff", rotas de outras histórias ainda não feitas)

<a id="rn-786"></a>

### RN-786 — O gate de QA lê o contrato do módulo, e divergência com a história é observação {#rn-786}

- **Regra:** o recorte que a QA-estratégia e a QA-automação recebem traz o
  contrato VIGENTE do módulo da tarefa (`artifact.module_contracts`,
  [RN-684](parte-09.md#rn-684)), em `moduleContract` de `GET .../dev-context`, como a
  fonte da INTERFACE. O módulo é o da tarefa, senão o pedido, senão o único da
  história; história com mais de um módulo e tarefa sem módulo é ambígua e vai
  sem contrato. Quando a história e o contrato divergem num nome de interface
  (rota, função, evento), a entrega que segue o contrato não é reprovada por
  isso: o parecer nomeia a DIVERGÊNCIA no `resumo` (história diz X, contrato
  diz Y), para o usuário e o Arquiteto. Régua de PROMPT, como a
  [RN-765](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-765). Desde a [RN-792](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-792) o Arquiteto confere o contrato
  contra as rotas citadas nas histórias ao declará-lo.
- **Onde:** `src/application/use-cases/execution/get-dev-task-context.use-case.ts:280`
  (`moduloDoContrato`), `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:66`

- **Onde:** `src/application/use-cases/execution/get-dev-task-context.use-case.ts:280`
  (`moduloDoContrato`), `apps/engine/lib/engine/gates/recorte_da_tarefa.ex:70`
  (`secao_do_contrato`)
- **Teste:** `test/application/use-cases/execution/get-dev-task-context.use-case.spec.ts`
  (o contrato do módulo da história; sem contrato ou módulo ambíguo, `null`) e
  `apps/engine/test/engine/gates/recorte_da_tarefa_test.exs` (a seção do
  contrato com a régua da divergência; sem contrato, sem seção)
- **Origem:** AT-462 (TP-01 de 09/10, sessão `80e3ce09`: a história pedia
  `GET /painel`, o contrato declarou `GET /panel`, o dev seguiu o contrato e o
  QA reprovou pela história)

<a id="rn-802"></a>

### RN-802 — A estimativa do plano do Dev Lead soma o dobro da primeira tarefa de cada módulo {#rn-802}

O cartão de aprovação do `propose_execution_plan` (RN-709) dizia "até N × teto",
ignorando que a primeira tarefa de cada módulo tem o dobro do teto (RN-774).
Agora a api leva no payload, ao lado de `orcamentoPorTarefaMicros`, o
`multiplicadorDaPrimeiraDoModulo`, e a frase soma o teto EFETIVO:
(tarefas − módulos com tarefa) × teto + módulos com tarefa × multiplicador ×
teto, dizendo "a primeira de cada módulo vale o dobro". Com 8 tarefas num
módulo e teto de US$ 0,50: até US$ 4,50. É limite superior: a primeira de um
módulo que já teve tarefa reivindicada não ganha o dobro, e a frase continua
dizendo "até". Sem o multiplicador no payload (proposta antiga), a conta antiga.

O multiplicador é APLICADO só no engine (`Engine.Dev.TetoDaTarefa`); a api tem
um espelho declarado, porque a tela não deve copiar a constante e o engine não
é consultado na proposta. Mudar um exige mudar o outro.

- **Onde:** `src/application/use-cases/execution/activate-execution.use-case.ts:83` (`MULTIPLICADOR_DA_PRIMEIRA_TAREFA_DO_MODULO`);
  `src/application/use-cases/actions/propose-action.use-case.ts:270` (`multiplicadorDaPrimeiraDoModulo`);
  `apps/web/src/lib/aprovacoes.ts:382` (`multiplicador`)
- **Teste:** `apps/web/src/lib/aprovacoes.test.ts` (it "RN-802 (AT-473)": 8 tarefas, 1 módulo → US$ 4,50; 3 tarefas, 2 módulos → US$ 2,50; sem orçamento, sem número — caso de falha);
  `test/application/use-cases/actions/propose-action.use-case.spec.ts` ("plano válido nasce pending")
- **Origem:** AT-473

<a id="rn-809"></a>

### RN-809 — As obrigações de módulo e imagem do Arquiteto entram no piso do Jev {#rn-809}

- **Regra:** estende a [RN-758](#rn-758) e a [RN-784](#rn-784). O piso do
  Arquiteto ganha `assign_story_modules` e `choose_project_image`, os passos 2 e
  3 do kickoff dele (`arquiteto_server.ex`): o recorte do Jev nunca as tira, e o
  Arquiteto não encerra dizendo que a ferramenta "não está disponível nesta
  etapa" com histórias sem módulo e imagem não decidida. Revisto pela AT-614, o
  piso também mantém `emit_insight` (passo 8, registro de tensão) e
  `declare_open_question`, que o recorte tirava. Só `emit_artifact` fica fora
  do piso: não é obrigação da etapa. Continua valendo que o piso só devolve o que está no
  catálogo do passo.
- **Onde:** `src/domain/llm/tool-router.ts:315` (`PISO_DO_MENU`)
- **Teste:** `test/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.spec.ts`
  (`Arquiteto recortado pelo Jev sem assign_story_modules/choose_project_image:
  as duas continuam no menu (RN-809)`)
- **Origem:** AT-481 (TP-01: o recorte deixou 7 de 11 ferramentas e o
  Arquiteto não distribuiu as histórias por módulo); AT-614 (o recorte também
  tirava `emit_insight` e `declare_open_question`)

<a id="rn-812"></a>

### RN-812 — A PR aberta da mesma branch é reaproveitada, nunca duplicada {#rn-812}

- **Regra:** antes de abrir a PR de um `pr_open`, o executor pergunta ao
  provider (`listPullRequests`, só as abertas) se já há PR ABERTA com a mesma
  origem e o mesmo destino. Havendo, ela é reaproveitada: a ação fecha
  `executed` com a URL e o id dela e `reaproveitada: true`, sem abrir outra —
  o push da task já a atualizou. No uso real a task reaberta depois de
  bloqueio abriu a pr-9 da mesma branch com a pr-8 aberta, e a aba PRs mostrou
  as duas. Provider sem a listagem, ou listagem que falha, não impede abrir: o
  caminho de sempre segue. Fica como estava a PR da branch que a [RN-797](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-797)
  fecha como "já na dev": essa não é fechada no provider.
- **Onde:** `src/application/use-cases/actions/execute-git-action.use-case.ts:33`
  (`prAbertaDaBranch`), `src/application/use-cases/actions/execute-git-action.use-case.ts:206`
  (`prAbertaDaBranch`)
- **Teste:** `test/application/use-cases/actions/execute-git-action.use-case.spec.ts`
  ("pr_open com PR aberta da mesma branch → reaproveita, sem abrir outra";
  "pr_open: listar PRs falha → abre a PR como sempre")
- **Origem:** AT-485 (TP-01 de 10/10)

<a id="rn-827"></a>

### RN-827 — O painel de contexto conta a sessão inteira, e a janela só dá o detalhe {#rn-827}

- **Regra:** os NÚMEROS do painel "Contexto da sessão" — regras de negócio,
  decisões registradas e artefatos por agente — vêm de um agregado da sessão
  INTEIRA contado no servidor (`GET .../sessions/:sessionId/context-summary`,
  `viewer`, leitura sem tabela nova), SOMADO à janela de eventos que a tela já
  carregou pelo molde da [RN-568](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-568): as contagens são monótonas, então
  vale o maior dos dois. O DETALHE (o cartão da regra, a decisão, a árvore do
  backlog) continua sendo o da janela, e o aviso de recorte ("Mostrando N de
  M") aparece só na seção cujo detalhe é parcial; o agente cujos artefatos
  ficaram todos antes da janela ganha o grupo com o total. Agregado AUSENTE
  (carregando ou falhou) é "não li": o painel cai no recorte declarado da
  [RN-180](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-180)/[RN-701](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-701), e "Arquivos tocados" vazio diz que não
  leu, nunca "Nada ainda". O agregado NÃO polla ([RN-579](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-579),
  [RN-632](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-632)): é relido quando a janela vê um artefato ou uma ação de
  commit/PR nova (a chave da query), no foco e na remontagem.
- **Onde:** `src/infrastructure/persistence/drizzle/session-context-summary.repository.ts:24`
  (`resumir`), `apps/web/src/lib/contexto-da-sessao.ts:15`
  (`useContextoDaSessaoInteira`), `apps/web/src/lib/contexto-da-sessao.ts:34`
  (`totalDaSessao`), `apps/web/src/routes/ContextAside.tsx:174` (`resumo`)
- **Teste:** `test/infrastructure/persistence/drizzle/session-context-summary.repository.spec.ts`
  ("conta a sessão INTEIRA, além de qualquer cauda de 200…"),
  `test/application/use-cases/sessions/get-session-context-summary.use-case.spec.ts`
  (falha: "sessão de outro projeto é 404 e não lê nada"),
  `apps/web/src/routes/ContextAside.sessao-inteira.test.tsx` ("com o agregado
  maior que a janela, mostra o total da sessão…"; falha: "sem o agregado, os
  arquivos dizem \"não li\"…")
- **Origem:** AT-498 (TP-01 de 10/10: sessão de 301 eventos mostrou 0 regras
  sobre 11 e 2 decisões sobre 6)

<a id="rn-828"></a>

### RN-828 — "Arquivos tocados" inclui a sessão de execução ligada, com teto e total real {#rn-828}

- **Regra:** a lista de arquivos tocados do agregado ([RN-827](#rn-827)) junta
  os `git_commit`/`git_push` da sessão pedida e da sessão de EXECUÇÃO ligada a
  ela — a que o plano do Dev Lead aprovado NESTA sessão ativou
  (`executionResult.sessaoDeExecucao` de `propose_execution_plan` executado),
  do mesmo projeto. Sessão sem essa ligação não entra. A lista vem do mais
  recente para o mais antigo, cortada em 100 (`TETO_DE_ARQUIVOS_TOCADOS`), e o
  `total` diz o número real; a tela declara o recorte quando ele corta.
- **Onde:** `src/infrastructure/persistence/drizzle/session-context-summary.repository.ts:33`
  (`ligadas`), `apps/web/src/routes/ContextAside.tsx:366` (`filesTouched`)
- **Teste:** `test/infrastructure/persistence/drizzle/session-context-summary.repository.spec.ts`
  ("…e soma os arquivos da execução ligada"; falha: "corta a lista de arquivos
  no teto e devolve o total real; não lê sessão sem ligação")
- **Origem:** AT-498

<a id="rn-838"></a>

### RN-838 — O QA de Automação roda com o raciocínio desligado {#rn-838}

- **Regra:** estende a [RN-783](#rn-783) (decisão do dono de 10/10). O gate
  `qa-automacao` passa a ter o mesmo tratamento dos dev agents de execução:
  com modelo de `supportsReasoning`, o provider que sabe dizer "desligado"
  manda `reasoning: { enabled: false }`, mantendo a folga da
  [RN-782](#rn-782). O QA-estratégia (`qa-estrategia`) e os demais gates não
  mudam. Medição que motivou: o raciocínio dos gates subiu de 44 mil para 211
  mil tokens por rodada, e o custo deles de US$ 0,15 para US$ 0,55.
- **Onde:** `src/domain/llm/raciocinio-do-agente.ts:39`
  (`raciocinioDesligadoParaOAgente`)
- **Teste:** `test/domain/llm/raciocinio-do-agente.spec.ts`
  (`QA de Automação desliga; QA-estratégia e outros gates não (RN-838)`;
  `falha: QA de Automação com modelo sem supportsReasoning não manda nada`)
- **Origem:** AT-504 (decisão do dono de 10/10)

<a id="rn-839"></a>

### RN-839 — `report_done` e `report_blocked` entram no piso do Jev dos dev agents {#rn-839}

- **Regra:** revisa a [RN-758](#rn-758)/[RN-759](#rn-759) (decisão do dono de
  10/10). Os dev agents de execução (`dev-<modulo>`, nunca o `dev-lead`)
  deixam de ficar sem piso SÓ para as duas ferramentas de desfecho da task:
  o recorte do Jev nunca tira `report_done` nem `report_blocked`. O resto do
  passo deles segue recortável, com o aviso de recorte da RN-759. Como todo
  piso, ele só devolve o que está no catálogo do passo.
- **Onde:** `src/domain/llm/tool-router.ts:360` (`pisoDoMenu`)
- **Teste:** `test/domain/llm/piso-dos-dev-agents.spec.ts`
  (`recorte que deixa só \`terminal\` para dev-api: report_done e
  report_blocked continuam`; `falha: dev-lead e outro agente não ganham as
  ferramentas de desfecho`)
- **Origem:** AT-499 (sequência, decisão do dono de 10/10)

<a id="rn-840"></a>

### RN-840 — a ferramenta de parecer de cada agente de gate entra no piso do Jev {#rn-840}

- **Regra:** estende a [RN-758](#rn-758) e a [RN-839](#rn-839) aos agentes de
  GATE. O recorte do Jev nunca tira de cada um a ferramenta de PARECER dele, e
  só a dele: `qa-automacao` → `emit_qa_verdict`, `qa-performance-seguranca` →
  `emit_perf_seguranca_verdict`, `qa-estrategia` → `emit_plano_de_teste`,
  `appsec` → `emit_threat_model`. Sem ela o gate rodava a suíte e parava sem
  veredito, com a delegação falhando por origem `modelo` e a tarefa pronta
  bloqueada. Agente fora dos gates não ganha ferramenta de parecer, e o piso
  só devolve o que está no catálogo do passo.
- **Onde:** `src/domain/llm/tool-router.ts:315` (`PISO_DO_MENU`)
- **Teste:** `test/domain/llm/tool-router-piso-dos-gates.spec.ts`
  (ids e ferramentas conferidos contra os `.ex` do engine; recorte que deixa
  só `terminal`/`read_file` termina com o parecer; falha: `criativo`,
  `dev-api` e `dev-lead` não ganham ferramenta de parecer; o piso não
  acrescenta ferramenta fora do catálogo)
- **Origem:** AT-509 (TP-01, 12ª execução)

<a id="rn-844"></a>

### RN-844 — O painel de contexto lista as regras, as decisões e os arquivos das PRs da sessão inteira {#rn-844}

- **Regra:** extensão da [RN-827](#rn-827) e da [RN-828](#rn-828). O agregado
  `GET .../sessions/:sessionId/context-summary` devolve, além dos números, os
  ITENS: as regras de negócio (`itensDeRegras`: título, descrição e quantas
  origens cita) e as decisões registradas (`itensDeDecisoes`: escolha e
  contexto) da sessão, as mais recentes primeiro, até 50 de cada
  (`TETO_DE_ITENS_DO_CONTEXTO`); o total segue em `regras`/`decisoes`. Com o
  agregado, o painel lista esses itens em vez da janela de 200 eventos — a
  regra que ficou antes da janela continua aparecendo — e o recorte diz
  "Mostrando as N mais recentes de M". "Arquivos tocados" passa a incluir os
  arquivos das PRs (`pr_open`/`open_adr_pr`/`open_infra_pr` executadas, com
  `pullRequestId`) da sessão e da sessão de execução ligada, lidos do MESMO
  diff da aba PRs (`ReadProjectCodeUseCase.pullRequestDiff`), antes dos
  arquivos de payload de commit, no teto de 100 com o total real. Leitura
  contida ([ADR 0060](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0060-superficie-de-leitura-de-codigo.md)): sem parâmetro
  livre, no máximo 20 diffs por chamada (`TETO_DE_PRS_LIDAS`); PR além do teto
  ou cujo diff falhou entra em `prsNaoLidas`, e a tela diz quantas ficaram de
  fora. Com o agregado e nada a listar, o vazio diz o que não houve (nenhum
  arquivo em PR nem commit desta sessão ou da execução ligada), nunca "Nada
  ainda". O caso de uso mora no módulo de git porque é ele que lê o
  repositório; sessão de outro projeto continua 404 sem ler PR nenhuma.
- **Onde:** `src/infrastructure/persistence/drizzle/session-context-summary.repository.ts:151`
  (`itensDeRegras`), `src/infrastructure/persistence/drizzle/session-context-summary.repository.ts:195`
  (`prsDasSessoes`), `src/application/use-cases/git/resumir-contexto-da-sessao.use-case.ts:37`
  (`prs`), `apps/web/src/routes/ContextAside.tsx:197` (`businessRules`),
  `apps/web/src/routes/ContextAside.tsx:222` (`decisoes`)
- **Teste:** `test/infrastructure/persistence/drizzle/session-context-summary.repository.spec.ts`
  ("RN-844: devolve os ITENS de regra e decisão fora de qualquer cauda, com
  teto de 50"; "RN-844: lista as PRs executadas da sessão e da execução
  ligada…"), `test/application/use-cases/git/resumir-contexto-da-sessao.use-case.spec.ts`
  ("lê os arquivos das PRs das sessões lidas…"; falhas: "corta no teto de
  arquivos, conta PR fora do teto e diff que falhou em prsNaoLidas" e "sessão
  de outro projeto é 404 e não lê PR nenhuma"),
  `apps/web/src/routes/ContextAside.sessao-inteira.test.tsx` ("…lista os itens
  do servidor (RN-844)"; "agregado sem arquivo diz O QUE não houve…")
- **Origem:** AT-513 (TP-01 de 11/10: 9 regras sem lista, "mostrando 1 de 4"
  decisões e "Arquivos tocados: Nada ainda" com 12 PRs mergeadas)

<a id="rn-847"></a>

### RN-847 — A PR mergeada continua dizendo os arquivos que mudou {#rn-847}

- **Regra:** extensão da [RN-844](#rn-844). No provider git LOCAL, o diff de
  uma PR era `target...source` também depois do merge — e aí a merge base é a
  própria ponta da origem, então a PR mergeada devolvia ZERO arquivos (medido
  em teste: `[]` para fast-forward e para commit de merge), e o painel
  "Contexto da sessão" dizia "Nenhum arquivo nas PRs" com 14 PRs mergeadas,
  sem nada em `prsNaoLidas` (o diff não falhava, vinha vazio). Agora o merge
  grava no store da PR a merge base e a ponta da origem do instante do merge
  (`mergedBaseSha`/`mergedHeadSha`), e o diff da PR mergeada é
  `mergedBaseSha...mergedHeadSha`. PR mergeada antes desses campos cai no
  commit de merge do alvo (primeiro pai) cujo segundo pai é a ponta da origem;
  a mergeada por fast-forward sem os campos não tem como ser reconstruída e
  segue vazia (lacuna declarada). GitHub e GitLab já devolvem o diff da PR
  mergeada pela própria plataforma. Na tela, o resumo do contexto é relido
  nos MESMOS gatilhos que releem a lista de PRs ([RN-841](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-841)): o alvo
  `prs` do canal (com a janela de 2 s dele, sem busca a mais) e a mudança da
  assinatura do backlog, por prefixo `['session-context-summary', projectId]`.
- **Onde:** `src/infrastructure/git/local-git-provider.ts:374`
  (`mergedBaseSha`), `src/infrastructure/git/local-git-provider.ts:862`
  (`rangeDoDiff`), `apps/web/src/lib/canal-vivo.ts:221` (`prs`),
  `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:105` (`invalidateQueries`)
- **Teste:** `test/infrastructure/git/local-git-provider.contract.spec.ts`
  ("PR mergeada por fast-forward devolve os arquivos que mudou"; "PR mergeada
  por commit de merge devolve só os arquivos dela"; "PR mergeada antes de os
  SHAs serem gravados acha o commit de merge"),
  `apps/web/src/lib/contexto-da-sessao.test.tsx` ("o merge que chega pelo canal
  relê o resumo"; "CASO DE FALHA: evento que não mexe em PR não relê o
  resumo"), `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx`
  ("RN-841: a tarefa que entra em awaiting_user relê as PRs…"). A falha de
  leitura somando em `prsNaoLidas` segue coberta por
  `test/application/use-cases/git/resumir-contexto-da-sessao.use-case.spec.ts`
  ("corta no teto de arquivos, conta PR fora do teto e diff que falhou em
  prsNaoLidas").
- **Origem:** AT-518 (TP-01, 13ª: "Nenhum arquivo nas PRs nem nos commits"
  com 14 PRs mergeadas, e a aba sem reler o resumo)

<a id="rn-848"></a>

### RN-848 — O efeito de ação executada dentro de um pedido interno avisa o canal da sessão {#rn-848}

- **Regra:** extensão da [RN-579](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-579) (AT-157). A api não avisa o canal
  da escrita que veio do engine (`/internal/*`), porque a fachada dele avisa o
  evento que ELE pediu para gravar. O que a api grava por conta própria como
  EFEITO de uma ação auto-aprovada executada dentro desse pedido
  (`infra.pr_opened`, `adr.pr_opened`, `action.*`) nenhuma fachada avisa, e
  passa a ser avisado: `ProposeActionUseCase` executa a ação sob a marca
  `runComoEfeitoDeAcao`, e o notifier só fica calado com origem engine SEM essa
  marca. O evento que o engine pediu (inclusive o `proposed_action.created`)
  continua sem aviso da api, para não sair em dobro.
- **Onde:** `src/application/efeito-de-acao.ts:18` (`ehEfeitoDeAcao`),
  `src/application/use-cases/actions/propose-action.use-case.ts:347`
  (`runComoEfeitoDeAcao`),
  `src/infrastructure/http-clients/session-channel-notifier.ts:73`
  (`ehEfeitoDeAcao`)
- **Teste:** `test/application/use-cases/sessions/aviso-ao-canal-da-sessao.spec.ts`
  ("AT-516: efeito de ação executada dentro de /internal avisa o canal, uma
  vez"; falha/regressão: "escrita vinda do engine (/internal) não é avisada de
  novo pela api")
- **Origem:** AT-516 (a PR de infra auto-aprovada só entrou em "PRs prontas"
  do chat ~5 min depois, pelo poll de fallback)

<a id="rn-852"></a>

### RN-852 — A PR de infra declara como rodar o entregável, e isso vira artefato {#rn-852}

- **Regra:** `open_infra_pr` EXIGE `run` = `{command, urls, envExample}`
  (ADR 0213): `command` texto não vazio até 300 caracteres; `urls` de 1 a 5
  itens `{label (até 60), url, kind}`, com `url` começando com
  `http://localhost:` ou `http://127.0.0.1:` e `kind` ∈ `api_docs` | `web`;
  `envExample` booleano. A api recusa na PROPOSTA com 400 `run_invalido`
  (texto que volta ao Infra Lead) e revalida na EXECUÇÃO, que falha nomeada
  sem commitar. Com a PR aberta (ou corrigida), a api emite
  `artifact.run_instructions` `{command, urls, envExample, prUrl, version}` —
  versionado, sem tabela, o de maior `version` é o vigente (o desenho de
  `artifact.project_image`), e projetado em `docs/` como os outros
  versionados. `GET /projects/:projectId/run-instructions` (`viewer`) devolve
  o vigente (`+ version, eventId, declaredAt`) ou `null`. É DECLARADO pela
  Infra, nunca verificado na máquina de quem lê (RN-468). E o contexto da
  Infra (`/internal/.../infra-context`) passa a levar `projectImage`, a
  decisão vigente de imagem, rede e recursos, `null` sem decisão.
- **Onde:** `src/domain/infra/run-instructions.ts:77` (`recusaDoRun`),
  `src/application/use-cases/actions/propose-action.use-case.ts:183`
  (`recusaDoRun`),
  `src/application/use-cases/actions/execute-infra-pr.use-case.ts:111`
  (`recusaDoRun`), `:328` (`EVENTO_INSTRUCOES_DE_EXECUCAO`),
  `src/application/use-cases/execution/get-run-instructions.use-case.ts:26`
  (`execute`),
  `src/application/use-cases/execution/get-infra-context.use-case.ts:89`
  (`projectImage`)
- **Teste:** `test/application/use-cases/actions/propose-action.use-case.spec.ts`
  ("sem `run`: 400 `run_invalido`, sem proposta"; "URL fora de localhost: 400
  nomeando o campo"; "`run` válido: a proposta nasce"),
  `test/application/use-cases/actions/execute-infra-pr.use-case.spec.ts`
  ("PR aberta emite artifact.run_instructions com prUrl e versão seguinte";
  falha: "`run` inválido na execução falha sem commitar nem emitir"),
  `test/application/use-cases/execution/get-run-instructions.use-case.spec.ts`
  ("devolve o vigente — o de maior version"; "null sem artefato, e o de outro
  projeto não vaza"),
  `test/application/use-cases/execution/get-infra-context.use-case.spec.ts`
  ("RN-852: projectImage é a decisão vigente…"; "…null sem decisão de imagem")
- **Origem:** AT-517 (o entregável do TP-01 não dizia como rodar na máquina
  do usuário)

<a id="rn-856"></a>

### RN-856 — Desbloquear não encerra a execução, e a tarefa em curso órfã tem volta {#rn-856}

- **Regra:** três metades de um defeito só (o TP-01 mediu 1 s entre o
  "Desbloquear" e o claim do dev, e o heartbeat encerrou a sessão nele). (1) O
  sexto sinal da [RN-064](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-064) ([RN-776](#rn-776))
  conta também, na sessão de execução vigente, a tarefa `todo` de história
  `ready` cujo módulo é de um dev agent DESTA execução (ator de evento `dev.*`
  na sessão) e a tarefa `in_progress` atribuída a um deles — sem teto, como os
  outros. (2) O claim retoma, ANTES da fila `todo`, a tarefa `in_progress` que
  já é do agente (mesmo `assigned_to`, fora de gate, não bloqueada); a branch
  dela, se existir e não estiver mergeada, é o ponto de partida do worktree
  (a retomada do `WorktreeManager`). (3) Encerrar a sessão de execução
  ([RN-763](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-763)) bloqueia também a tarefa `in_progress` de dono `dev-*`
  que nenhuma linha de `dev_agent_states` segura, com o mesmo motivo e origem
  `politica`; a lista só vem para sessão de EXECUÇÃO, então encerrar uma
  consultiva do mesmo projeto não bloqueia nada.
- **Onde:** `src/infrastructure/persistence/drizzle/backlog.repository.ts:252`
  (`findPendenteDaExecucao`), `:413` (`claimNext`), `:221` (`listEmCursoDeDev`),
  `src/application/use-cases/sessions/get-session-pending-work.use-case.ts:49`
  (`em_curso_de_dev`),
  `apps/engine/lib/engine/dev/encerramento_da_sessao.ex:133` (`bloquear_orfas`)
- **Teste:** `test/application/use-cases/sessions/get-session-pending-work.use-case.spec.ts`
  ("tarefa recém-desbloqueada (todo) do módulo de um dev da execução segura a
  sessão"; "tarefa todo de módulo SEM dev na execução não segura"; "tarefa
  in_progress atribuída a dev da execução segura a sessão"; "listEmCursoDeDev
  lista a in_progress de dev só para sessão de EXECUÇÃO"),
  `test/application/use-cases/execution/claim-next-task.use-case.spec.ts`
  ("retoma a in_progress que já é DELE antes da fila todo"; "não retoma a
  in_progress dele que está em gate"),
  `apps/engine/test/engine/dev/encerramento_da_sessao_test.exs` ("bloqueia a
  task em curso ÓRFÃ…"; "sem nenhuma linha, a órfã também é bloqueada…")
- **Origem:** AT-522 (TP-01, 14ª: sessão `538a0ba5` encerrada 1 s depois do
  desbloqueio, tarefa `in_progress` presa em `dev-api` sem processo)

<a id="rn-857"></a>

### RN-857 — O passo de correção do dev agent tem escrita e terminal no recorte do Jev {#rn-857}

- **Regra:** quando o recorte do Jev (RN-625) decide o menu de um dev agent
  de execução (`dev-<modulo>`, nunca o `dev-lead`) e a ÚLTIMA mensagem
  `user` do passo é o parecer de correção que o engine monta — gate pedindo
  correção ("pediu correção nesta PR") ou merge recusado por conflito (RN-715)
  —, o menu ganha `write_file` e `terminal` além do piso de desfecho
  (RN-839). O critério é o texto que a api já recebe, sem campo novo; o piso
  fixo de todo passo não alarga (RN-759), outro agente não ganha, e o piso só
  acrescenta o que está no catálogo do passo (P3).
- **Onde:** `src/domain/llm/tool-router.ts:377` (`PISO_DA_CORRECAO_DO_DEV`),
  `:388` (`ehPassoDeCorrecao`), `:401` (`menuComPiso`),
  `src/application/use-cases/llm/decidir-ferramenta-do-passo.use-case.ts:265` (`menuComPiso`)
- **Teste:** `test/domain/llm/tool-router-correcao-do-dev.spec.ts`
  ("dev agent em correção recebe write_file e terminal"; "passo comum de
  leitura do dev não alarga"; "outro agente com a mesma mensagem não ganha";
  "as marcas existem no texto que o engine monta")
- **Origem:** AT-523

<a id="rn-858"></a>

### RN-858 — A pergunta em aberto de agente é registro durável, e só o autor da sessão a responde {#rn-858}

- **Regra:** a dúvida que um agente deixa para o usuário vira o evento
  `artifact.open_question` (append-only, no log da sessão onde nasce) com
  `{questionId (uuid), pergunta (até 500), sugestao (até 300, opcional),
  afeta: {regras, historias, tarefas}, autor, sessionId}` — o funil de
  eventos recusa com 400 o payload fora desse formato, venha do engine ou da
  api. Ela fecha com `open_question.answered` `{questionId, resposta,
  aceitouSugestao, decisionEventId, respondidaPor}`; o STATUS sai do log
  (aberta = sem `answered`), nunca de tabela. `GET
  /projects/:projectId/open-questions?status=open|answered|all` (`viewer`,
  padrão `open`) lista as mais recentes primeiro, com teto de 50 e o `total`
  (RN-180), e diz em `autorDaSessao` quem pode responder. `POST
  .../open-questions/:questionId/answer` com `{resposta}` ou
  `{aceitarSugestao: true}` só é aceito do AUTOR da sessão de origem (403
  `so_o_autor_da_sessao`); já respondida é 409 `pergunta_ja_respondida`,
  pergunta de outro projeto é 404 e resposta vazia (ou sugestão que não
  existe) é 400. Responder grava, numa transação, um `artifact.decision_record`
  com o usuário como ator (`context` = a pergunta, `choice` = a resposta,
  `consequences` = o que afeta, mais `questionId` e `afeta`) e o
  `open_question.answered`, avisa o canal da sessão (pelo funil, RN-579) e pede
  ao engine para retomar o gate de QA ESTACIONADO de cada tarefa afetada
  (caminho da RN-724) — melhor esforço: gate que não estava estacionado ou
  engine fora do ar não desfaz a resposta. ADR 0214.
- **Onde:** `src/domain/open-questions/pergunta-em-aberto.ts:44`
  (`validarPerguntaEmAberto`), `:112` (`respostaEscolhida`),
  `src/application/use-cases/sessions/append-session-event.use-case.ts:102`
  (`EVENTO_PERGUNTA_EM_ABERTO`),
  `src/application/use-cases/backlog/perguntas-em-aberto.use-case.ts:72`
  (`listar`), `:118` (`responder`), `:285` (`resumeParkedGate`),
  `src/interfaces/http/backlog/open-questions.controller.ts:51`
  (`list`), `:81` (`answer`)
- **Teste:** `test/application/use-cases/backlog/perguntas-em-aberto.use-case.spec.ts`
  ("o autor responde: decision_record (ator usuário, com questionId) e
  answered, e o gate é religado"; "aceitar a sugestão grava a sugestão como
  escolha"; falhas: "quem não é o autor da sessão recebe 403
  so_o_autor_da_sessao, sem escrever"; "já respondida é 409
  pergunta_ja_respondida"; "pergunta de outro projeto é 404"; "o funil de
  eventos recusa com 400 antes de qualquer escrita")
- **Origem:** AT-521 (TP-01: quatro perguntas do Criativo sumiram do campo de
  visão e o fluxo seguiu sem respostas)

<a id="rn-859"></a>

### RN-859 — A decisão do usuário chega a quem trabalha, e destrava a correção da história `ready` {#rn-859}

- **Regra:** `GET /internal/sessions/:sessionId/dev-context` devolve
  `decisoes`: os `artifact.decision_record` do projeto cujo `afeta` toca a
  tarefa, a história dela ou uma regra que a história cita — mais recentes
  primeiro, no máximo 10, com a pergunta e a decisão cortadas em 1 500
  caracteres cada (`{id, questionId, pergunta, decisao, decididaEm}`).
  Decisão sem `afeta` não entra. Elas vencem RF/DoR quando conflitam (o
  kickoff do dev e o recorte do QA as mostram — engine). E a régua de
  correção de história (RN-727, `recusaDeCorrecaoDeHistoria`) é revista
  (ADR 0214, sobre o ADR 0212): história `ready` também é corrigível quando o
  pedido cita um `questionId` que o usuário JÁ respondeu — pergunta aberta ou
  inexistente não destrava nada, e a trava de tarefa `in_progress`/`in_review`
  continua valendo. As duas portas do PO aceitam o `questionId`: `update_story`
  (título/descrição, o evento o leva) e `complete_story` (RF/DoD/DoR; a
  história segue `ready`, sem nova promoção, e `backlog.story_completed` leva
  o `questionId`). Quando `complete_story` encontra uma história que não é
  `draft` sem um `questionId` válido, o 409 é a recusa nomeada comum
  (`historia_nao_draft`, cuja mensagem nomeia `questionId`) mais os
  `questionId`s das perguntas JÁ RESPONDIDAS cujo `afeta.historias` cita a
  história; a API nunca infere o `questionId` no lugar do agente (AT-752). O
  engine lista cada decisão com o `questionId` e as histórias afetadas
  (`apps/engine/lib/engine/harness/decisoes_do_projeto.ex`), para o PO achar o
  id.
- **Onde:** `src/application/use-cases/execution/get-dev-task-context.use-case.ts:123`
  (`decisoesDaTarefa`), `:402` (`decisoesDoContexto`),
  `src/domain/backlog/correcao-de-historia.ts:33`
  (`recusaDeCorrecaoDeHistoria`),
  `src/application/use-cases/backlog/corrigir-historia.use-case.ts:130`
  (`respostaDoUsuario`),
  `src/application/use-cases/backlog/complete-story.use-case.ts:101`
  (`corrigindoReady`), `src/application/use-cases/backlog/perguntas-em-aberto.use-case.ts:107`
  (`respondidasQueAfetam`)
- **Teste:** `test/application/use-cases/execution/get-dev-task-context.use-case.spec.ts`
  ("devolve só as que afetam a tarefa, a história ou uma regra dela, mais
  recentes primeiro"; "decisão sem afeta não entra; teto de 10 e texto cortado
  em 1 500"),
  `test/application/use-cases/backlog/corrigir-historia.use-case.spec.ts`
  ("história ready citando pergunta RESPONDIDA é corrigida, e o evento a
  cita"; falhas: "história ready citando pergunta AINDA ABERTA segue
  recusada"; "história ready com tarefa em revisão segue recusada mesmo com a
  resposta"),
  `test/application/use-cases/backlog/complete-story.use-case.spec.ts`
  ("história ready com pergunta respondida tem RF/DoR corrigidos e segue
  ready"; "história ready com pergunta ainda aberta é recusada")
- **Origem:** AT-521 (o QA reprovou três vezes lendo a DoR de uma história
  `ready` que ninguém podia corrigir, depois de o usuário já ter decidido)

<a id="rn-860"></a>

### RN-860 — O gate de QA espera o usuário sem gastar o ciclo de correção {#rn-860}

- **Regra:** o parecer de gate (`POST /internal/sessions/:sessionId/gates/verdict`)
  aceita o veredito `needs_user_decision`, só do gate `qa`, com `pergunta`
  (até 500) e `sugestao` (até 300) ou um `openQuestionId` que já existe — sem
  nenhum dos dois é 400. A máquina de estados mantém o MESMO gate e NÃO
  incrementa o contador de correção, nem no teto, então o ciclo não chega ao
  bloqueio `politica` da RN-762. Sem `openQuestionId`, a api grava o
  `artifact.open_question` (ator e autor `qa-agent`, na sessão de execução,
  afetando a tarefa e a história dela), o `pr.gate_changed` sai com
  `esperandoUsuario: true` e o `openQuestionId` (é por ele que a tela mostra
  a tarefa como "esperando você"), e a resposta devolve `nextAction:
  "await_user"` com o `openQuestionId` — o engine estaciona o ciclo (ADR 0207)
  e a resposta à pergunta o religa (RN-858). Nenhuma linha de outbox nasce
  nesse desfecho. ADR 0214.
- **Onde:** `src/domain/execution/pr-gate-state-machine.ts:63`
  (`nextGateStatus`),
  `src/application/use-cases/execution/record-gate-verdict.use-case.ts:135`
  (`esperaUsuario`), `:171` (`nextAction`)
- **Teste:** `test/domain/execution/pr-gate-state-machine.spec.ts`
  ("needs_user_decision mantém o gate e NÃO incrementa o contador, nem no
  teto"),
  `test/application/use-cases/execution/record-gate-verdict.use-case.spec.ts`
  ("needs_user_decision no teto: grava a pergunta, não conta correção, não
  bloqueia"; falha: "needs_user_decision sem pergunta nem openQuestionId é
  recusado")
- **Origem:** AT-521 (o QA de Automação reprovou quatro vezes "não confirmado
  pelo usuário" até o ciclo esgotar)

<a id="rn-870"></a>

### RN-870 — O veredito só espera pergunta que existe e está aberta {#rn-870}

- **Regra:** `POST /internal/sessions/:sessionId/gates/verdict` com
  `needs_user_decision` e `openQuestionId` confere, ANTES de qualquer escrita
  (comentário na PR, estado do gate, evento), que a pergunta existe no projeto
  e está aberta. Inexistente ou de outro projeto: 404
  `reason: "pergunta_nao_encontrada"`. Já respondida: 409
  `reason: "pergunta_ja_respondida"` com a decisão do usuário em `decisao` —
  sem escrita e sem `pr.gate_changed`. O estado sai do log (RN-858).
- **Onde:** `src/application/use-cases/execution/record-gate-verdict.use-case.ts:85`
  (`exigirPerguntaAberta`), `src/domain/open-questions/pergunta-em-aberto.ts:154`
  (`estadoDaPergunta`)
- **Teste:** `test/application/use-cases/execution/record-gate-verdict.use-case.spec.ts`
  ("pergunta aberta: estaciona sem gravar outra"; falha: "inexistente ou de
  outro projeto: 404 nomeado, sem escrita", "já respondida: 409 com a decisão,
  sem escrita nem pr.gate_changed")
- **Origem:** AT-526, ADR 0215

<a id="rn-871"></a>

### RN-871 — `afeta.regras` aceita o título exato da regra e guarda o id {#rn-871}

- **Regra:** no funil de eventos, o `artifact.open_question` cujo
  `afeta.regras` traz o TÍTULO exato de um `artifact.business_rule` do projeto
  é gravado com o id da regra (a mais recente, se o título se repete); o que
  não é id nem título exato é recusado com 400 nomeando os valores. No contexto
  do dev, `decisoes` casa também pelo título das regras da história, para as
  decisões gravadas antes desta regra.
- **Onde:** `src/domain/open-questions/pergunta-em-aberto.ts:179`
  (`resolverRegrasDoAfeta`), `src/application/use-cases/sessions/append-session-event.use-case.ts:122`
  (`resolverRegrasDoAfeta`), `src/application/use-cases/execution/get-dev-task-context.use-case.ts:135`
  (`decisoesDoContexto`)
- **Teste:** `test/application/use-cases/backlog/perguntas-em-aberto.use-case.spec.ts`
  ("título exato é convertido para o id da regra"; falha: "texto que não é id
  nem título de regra: 400 sem escrita"),
  `test/application/use-cases/execution/get-dev-task-context.use-case.spec.ts`
  ("decisão legada com TÍTULO de regra em afeta.regras casa pelo título")
- **Origem:** AT-526, ADR 0215

<a id="rn-872"></a>

### RN-872 — As outras decisões do projeto chegam ao dev e ao QA, em seção própria {#rn-872}

- **Regra:** `GET /internal/sessions/:sessionId/dev-context` devolve, além de
  `decisoes` (as que tocam a tarefa, RN-859), `decisoesDoProjeto`: as demais
  `artifact.decision_record` do projeto, mais recentes primeiro, no mesmo
  formato. O teto de 10 é COMPARTILHADO — as da tarefa vêm primeiro e consomem
  o teto antes. Revisa a frase "decisão sem `afeta` não entra" do ADR 0214 para
  esta lista. O campo é aditivo (o engine que não o conhece o ignora).
  AT-812: a decisão também conta como da tarefa quando `afeta.modulos` tem o
  módulo dela ou o texto (`context`/`choice`) cita `modules/<módulo>` ou
  `dev-<módulo>` (com borda: `catalogo` não casa `catalogo-admin`). Exemplo: a
  orientação do Dev Lead "documentar em `modules/catalogo/README.md`" chega ao
  `dev-catalogo` em `decisoes`, mesmo entre mais de 10 decisões.
- **Onde:** `src/application/use-cases/execution/get-dev-task-context.use-case.ts:135`
  (`decisoesDoContexto`), `src/interfaces/http/internal/dto/internal.response.dto.ts:237`
  (`decisoesDoProjeto`)
- **Teste:** `test/application/use-cases/execution/get-dev-task-context.use-case.spec.ts`
  ("as que não tocam a tarefa vêm em decisoesDoProjeto; teto de 10 somado, as
  da tarefa primeiro"; `decisão que cita o módulo (RN-872)`)
- **Origem:** AT-526, ADR 0215; AT-812

<a id="rn-886"></a>

### RN-886 — O 403 de orçamento do OpenRouter é crédito esgotado, com limite, gasto e reset {#rn-886}

- **Regra:** o 403 do OpenRouter com `Budget limit exceeded` /
  `limit_source: openrouter_guardrail_budget` (guardrail mensal da chave) NÃO
  é credencial rejeitada: a api o normaliza no MESMO `insufficient_credit` do
  402 (RN-730) — sem código novo no contrato — e o resto do caminho do crédito
  vale igual: origem `infra` (RN-726), pausa sem retomada automática (nunca
  passageira, RN-864). A frase curta, no idioma do turno (RN-733), diz o
  limite, o gasto e o reset lidos do corpo (`limit_usd`, `spend_usd`,
  `resets_at`, o que vier) e pede ao admin do OpenRouter para subir o
  orçamento; o dev bloqueia a tarefa com essa frase no motivo, em vez de
  "parou sem concluir nem reportar bloqueio" com origem `codigo`. 403 sem o
  marcador segue `auth`.
- **Onde:** `src/domain/llm/llm-provider-errors.ts:86` (`normalizeHttpStatus`),
  `:140` (`pareceOrcamento`); `apps/engine/lib/engine/agents/falha_de_turno.ex:212`
  (`orcamento_esgotado`), `:226` (`frase_de_orcamento`), `:163`
  (`credito_esgotado?`); `apps/engine/lib/engine/dev/dev_agent_server.ex:1044`
  (`motivo_de_credito`)
- **Teste:** `test/domain/llm/llm-provider-errors.spec.ts` ("o 403 de
  orçamento vira insufficient_credit com o corpo inteiro"; falha: "403 sem
  marcador de orçamento continua credencial rejeitada");
  `apps/engine/test/engine/agents/falha_de_turno_test.exs` ("RN-886: o 403 de
  orçamento do OpenRouter")
- **Origem:** AT-534

<a id="rn-891"></a>

### RN-891 — A interface tem quatro idiomas, com pt-BR como padrão e fallback {#rn-891}

- **Regra:** o idioma da interface (`users.locale`) aceita `pt-BR`, `en`, `ru`
  e `zh-Hans`, e recusa qualquer outro; o padrão da conta continua `pt-BR`.
  No web, `pt-BR` é o padrão e o `fallbackLng` (revisa a RN-432, que fazia do
  `en` o padrão do web). A escolha gravada na conta vence sempre; sem ela, o
  navegador sugere: `pt*` → `pt-BR`; `zh`, `zh-CN`, `zh-SG`, `zh-Hans*` →
  `zh-Hans`; `ru*` → `ru`; `en*` → `en`; o resto (alemão, chinês
  tradicional…) → `pt-BR`. Locale sem catálogo em `locales/` não quebra o boot:
  a tela cai no pt-BR e o seletor da Conta, com os rótulos nativos, diz
  "tradução em andamento". `<html lang>` acompanha o idioma ativo. A paridade
  de chaves compara cada locale existente com a fonte pt-BR.
- **Onde:** `src/domain/iam/user.entity.ts:8` (`USER_LOCALES`),
  `apps/web/src/lib/idioma.ts:65` (`resolverIdiomaDoNavegador`),
  `apps/web/src/lib/i18n.ts:72` (`fallbackLng`)
- **Teste:** `test/interfaces/http/iam/user-preferences-locale.dto.spec.ts`
  ("aceita pt-BR, en, ru e zh-Hans"; "recusa idioma fora da lista");
  `apps/web/src/lib/idioma.test.ts` ("idioma sem catálogo cai no pt-BR, nunca
  no inglês"); `apps/web/src/lib/i18n-paridade.test.ts`
- **Origem:** AT-548, ADR 0216 (itens 1–4)

<a id="rn-892"></a>

### RN-892 — O prefixo estável da chamada vai marcado para o cache de prompt, e a capability é ligada só no OpenRouter, provada {#rn-892}

Medido no TP-01 (15/10): o `anthropic/claude-haiku-5.5` pelo OpenRouter
recebeu 8,40 M tokens de entrada com **0** em cache, e a entrada foi US$ 0,84
dos US$ 1,02. Modelos Anthropic só leem do cache o prefixo marcado com
`cache_control: { type: "ephemeral" }` num bloco de conteúdo de texto (até
quatro pontos, TTL de 5 min — https://openrouter.ai/docs/features/prompt-caching).

1. **Capability de provider, obrigatória.** `LLMProviderCapabilities.promptCaching`
   é `true` no OpenRouter e (RN-1008) na Anthropic direta, e `false` nos outros sete. Declará-la sem o hook `marcarCacheDePrompt`
   falha na construção. Desligada, o corpo é byte a byte o de antes.
2. **Camada de modelo na config.** No OpenRouter só `anthropic/*` recebe ponto;
   os demais cacheiam sozinhos e voltam intactos.
3. **Dois pontos, sobre o que não muda.** A última `system` do prefixo
   (instruções, e as ferramentas antes delas) e a última `user`/`tool` antes
   da cauda de `system` do fim. A cauda — idioma (RN-622), ambiente (RN-706),
   fluxo (RN-711), perfil (RN-680) — fica DEPOIS do último ponto, e a ordem
   das mensagens nunca muda.
4. **Prova (ADRs 0041/0042).** Em 2026-10-15 o smoke rodou com credencial
   real (`OPENROUTER_TEST_KEY=… pnpm --filter api exec vitest run
   test/infrastructure/llm/openrouter-provider.cache.smoke.spec.ts`) e a
   segunda chamada a `anthropic/claude-haiku-5.5` voltou com
   `cached_input_tokens=8011`; só então a capability do OpenRouter passou a
   `true`. Ligar outro provider exige o smoke equivalente. O ganho aparece no
   metering pela [RN-666](parte-08.md#rn-666).

- **Código:** `src/infrastructure/llm/openrouter-provider.ts:302` (`marcarCacheDePromptOpenRouter`);
  `src/infrastructure/llm/openai-compatible-provider.ts:661` (`mensagens`)
- **Teste:** `test/infrastructure/llm/openrouter-provider.contract.spec.ts` ("pontos de cache de prompt (RN-892)": ligada marca os dois pontos; desligada é byte a byte; capability sem hook falha — caso de falha)
- **Origem:** AT-543

<a id="rn-894"></a>

### RN-894 — Épico com o mesmo título de outro do projeto é recusado {#rn-894}

- **Regra:** `create_epic` recusa (400) o épico cujo título, normalizado,
  é igual ao de outro épico do MESMO projeto, e a recusa devolve ao modelo o
  id do existente: "Já existe o épico «título» (id …) neste projeto — use
  este id em epic_id". A régua é a MESMA da história (achado R,
  `tituloDuplicado`), sem segunda cópia. A duplicata SEMÂNTICA
  ([RN-681](parte-09.md#rn-681)) não vale para épico: só título
  igual. Nada é criado nem gravado no event log quando recusa.
- **Onde:** `src/application/use-cases/backlog/create-epic.use-case.ts:25` (`tituloDuplicado`)
- **Teste:** `test/application/use-cases/backlog/create-epic.use-case.spec.ts:41`
  (cria sem título igual) e `:49` (recusa o título igual com o id do existente)
- **Origem:** AT-581

<a id="rn-902"></a>

### RN-902 — Recriar o container congela a decisão de imagem vigente, e a imagem desatualizada é avisada {#rn-902}

- **Regra:** a transição `removed → provisioning` e `failed → provisioning`
  RELÊ a decisão de imagem vigente e regrava `imageVersion` e `resources` da
  linha de `project_containers` (antes só a criação da linha os congelava, e a
  coluna Imagem seguia na versão antiga depois de Remover → Subir). Sem decisão
  vigente é 409 ([RN-105](parte-03.md#rn-105)). `stopped → running` NÃO muda a versão: o
  container reaproveitado é o antigo. A página `/containers` ganha
  `decisaoVigente` e `imagemDesatualizada` por linha — a divergência compara
  CONTEÚDO (imagem, rede, recursos), nunca o número da versão, porque a eleição
  da Infra grava v+1 com o mesmo conteúdo a cada subida — e, com
  `running`/`stopped`/`provisioning` divergente, a linha diz em texto "Parar →
  Remover → Subir de novo" e passa a dizer por que "Subir de novo" não aplica a
  imagem nova. O resultado de `choose_project_image` traz `containerDePe` e o
  texto avisa que a decisão só vale ao recriar o container. "Recriar" numa só
  ação NÃO existe; nenhum teto de aprovação muda ([RN-495](parte-05.md#rn-495)).
- **Onde:** `src/application/use-cases/containers/registrar-transicao-de-container.use-case.ts:131`
  (`recongelar`), `src/domain/containers/project-container.ts:387`
  (`containerDivergeDaDecisao`),
  `apps/engine/lib/engine/harness/tools/choose_project_image.ex:99`
  (`mensagem_de_fixada`)
- **Teste:** `test/application/use-cases/containers/ciclo-de-vida-do-container.use-case.spec.ts`
  ("recongela versão e recursos", "sem decisão vigente é 409", "mantém a versão
  congelada"); `test/domain/containers/project-container.spec.ts`
  (`containerDivergeDaDecisao`);
  `test/infrastructure/persistence/drizzle/containers-overview.repository.spec.ts`
  ("imagemDesatualizada compara CONTEÚDO");
  `apps/web/src/routes/ContainersPage.test.tsx` (aviso e motivo);
  `apps/engine/test/engine/harness/tools/choose_project_image_test.exs`
- **Origem:** AT-595 (TP-01 20ª: a decisão v3 `egress` não alcançou o container
  v2 `none` e a coluna Imagem seguiu em v2)

<a id="rn-906"></a>

### RN-906 — A api recusa a rede `none` quando a stack de um módulo baixa dependências {#rn-906}

- **Regra:** ao decidir a imagem do projeto, se a rede é `none` e algum módulo
  do `module_map` vigente tem `stack` que casa, por PALAVRA inteira, com a lista
  fechada de ecossistemas que baixam dependências (node, npm, pnpm, yarn, python,
  pip, elixir, mix, go, rust, cargo, ruby, java, maven, gradle, php, dotnet...),
  a api responde 400 nomeando o módulo, a stack e o termo, e pede `egress`. Nada
  é gravado e a rede nunca é trocada sozinha: `egress` é autorização do usuário.
  Vale para o Arquiteto (`choose_project_image`) e para a eleição da Infra, que
  passam pelo mesmo caso de uso (na Infra, o `container_start` termina `failed`
  com o motivo, sem chamar o broker). Sem `module_map` ou com stack que não casa,
  segue só o aviso da RN-735. Sem exceção configurável. Revisa a RN-735 (aviso →
  recusa nesse caso).
  **Exceção (AT-784):** o módulo cuja `stack` declara não ter dependências
  ("sem dependências", "nenhuma dependência", "no dependencies",
  "zero-dependency", "dependency-free") é ignorado, e `none` passa (ex.: "Node.js
  puro (node:test), sem dependências", o caso do golden-set do QA). O `module_map`
  só tem texto, sem acesso ao `package.json`: a declaração é o único sinal. Quem
  baixa dependência (Node com Express, Python com `requirements`) segue recusado,
  e outro módulo que baixa recusa mesmo com um módulo sem dependências.
- **Onde:** `src/domain/containers/project-container.ts` (`stackQueBaixaDependencias`,
  `DECLARA_SEM_DEPENDENCIAS`); chamada em
  `src/application/use-cases/containers/decidir-imagem-do-projeto.use-case.ts`
- **Teste:** `test/application/use-cases/containers/container-do-projeto.use-case.spec.ts`
  (recusa nos dois chamadores; `egress`, stack que não casa e sem mapa passam);
  `test/domain/containers/project-container.spec.ts` (casamento por palavra);
  `test/application/use-cases/actions/execute-container-start.use-case.spec.ts`
- **Origem:** AT-593 (EP-031).

<a id="rn-907"></a>

### RN-907 — O OpenRouter recebe uma chave de sessão por agente, e a conversa fica presa ao upstream que a atendeu {#rn-907}

Sem chave, o hub trata cada tarefa do dev agent (outra primeira mensagem) como
conversa nova e sorteia outro upstream — 17 no TP-01 da 18ª rodada, com o
acerto de cache caindo. O Brabo agora manda a chave.

1. **Formato.** `session_id` = `brabo:<sessionId>:<agentId>`, e `brabo:<sessionId>`
   sem agente — por agente + sessão, nunca por projeto. É montada pelos dois
   casos de uso de turno e viaja em `ChatOptions.sessionKey`.
2. **Capability de provider, obrigatória.** `LLMProviderCapabilities.stickySession`
   é `true` só no OpenRouter e `false` nos outros oito; declará-la sem o hook
   `campoDeSessao` falha na construção. Desligada, ou sem chave, o corpo é byte a
   byte o de antes.
3. **Prova (ADRs 0041/0042).** Em 2026-10-21 o smoke rodou com credencial real em
   `deepseek/deepseek-v4.1-flash`: com a chave, 6 de 6 chamadas no mesmo upstream
   (Together); sem ela, 4 upstreams em 6. Ligar outro provider exige o smoke
   equivalente.
4. **Sem tabela.** A chave é derivável de `token_usage` (`session_id` + `actor_id`),
   e o efeito se mede em `upstream_provider`, `cached_input_tokens` e `cost_micros`
   (RN-665/666). `provider.order`/`allow_fallbacks` ficam fora (ADR 0221).

- **Código:** `src/infrastructure/llm/openrouter-provider.ts:236` (`campoDeSessaoOpenRouter`);
  `src/domain/llm/routing-preference.ts:88` (`chaveDeSessao`);
  `src/application/use-cases/llm/run-llm-turn.use-case.ts:243` (`chaveDeSessao`)
- **Teste:** `test/infrastructure/llm/openrouter-provider.contract.spec.ts` ("chave de sessão (ADR 0221, RN-907)": com capability e chave leva `session_id`; sem chave ou desligada não leva; capability sem hook falha — caso de falha); `test/application/use-cases/llm/stream-llm-turn.use-case.spec.ts`; `run-llm-turn.use-case.spec.ts`; smoke `openrouter-provider.sessao.smoke.spec.ts`
- **Origem:** AT-580; ADR [0221](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0221-upstream-preso-por-sessao.md)

<a id="rn-909"></a>

### RN-909 — O 9Router é o 10º provider: URL por instalação, credencial obrigatória, preço público de curadoria {#rn-909}

- **Regra:** o provider `9router` fala com um gateway na máquina do dono. A URL base é `NINE_ROUTER_BASE_URL` (padrão `http://host.docker.internal:20128/v1`), lida a cada uso pelo provider e pelo teste de conexão (`GET /models` com a chave). A credencial é obrigatória. As capabilities de provider são `false` (só `listModels`, `streaming` e, desde a [RN-950](parte-11.md#rn-950), `toolCalling`, provado por smoke com chave) até um smoke com chave provar o resto (ADR 0041). O preço dos modelos não é descoberto: entra por curadoria manual e, por decisão do dono, modelo de assinatura registra o preço público da API equivalente, não zero. O provider manda `x-9router-token-saver: off` em toda chamada, para o 9Router não comprimir o `tool_result`.
- **Onde:** `src/infrastructure/llm/nine-router-provider.ts:171` (`nineRouterConfig`)
- **Teste:** `test/infrastructure/llm/nine-router-provider.contract.spec.ts:109` (capabilities, URL do ambiente, cabeçalho, teste de conexão, parse da fixture sintética); smoke manual em `nine-router-provider.smoke.spec.ts`.
- **Origem:** AT-576a (EP-026), ADR 0222, decisão do dono de 22/10.

<a id="rn-910"></a>

### RN-910 — O teto padrão por área é 5 no dev, 4 no qa e 2 na infra {#rn-910}

Cada área de agentes nasce com um teto de paralelismo que vem do catálogo:
`dev` 5, `qa` 4, `infra` 2 (AT-599, pedido do dono de 22/10). A migração `0073`
aplicou os mesmos valores a **todos** os projetos existentes, sobrescrevendo o
que já estava decidido — decisão do dono, tomada sabendo que um teto posto de
propósito se perde.

- **Hoje só o teto de `dev` é aplicado na execução.** `RequestParallelizationUseCase`
  lê a área `dev` ao decidir o paralelismo. `qa` e `infra` têm o valor gravado,
  exibido e editável, mas nenhum código o consulta: subir o teto deles não muda
  execução nenhuma.
- **O teto de `dev` só morde com 3 módulos ou mais.** O máximo de dev agents é um
  por módulo mais um extra (`dev-<modulo>-2`), ou seja, 2 × módulos (RN-083). Com
  2 módulos o máximo é 4, abaixo de 5.
- **Só o INSERT usa o valor de catálogo.** Semear de novo não toca a linha
  (RN-094). A coluna continua `default(2)`: esse valor só aparece num INSERT cru,
  fora do caso de uso.
- **Onde:** `src/domain/agents/agent-areas.ts:73` (`maxParallelPadrao`);
  `src/application/use-cases/agents/seed-agent-areas.use-case.ts:53`
  (`maxParallelAoNascer`); `src/infrastructure/persistence/drizzle/agent-area.repository.ts:62`
  (`nascer`); `src/application/use-cases/execution/request-parallelization.use-case.ts:13`
  (`MAX_PARALLEL_PADRAO`); migração `src/db/migrations/0073_paralelismo_padrao_por_area.sql`.
- **Teste:** `test/application/use-cases/iam/create-project-semeia-areas.spec.ts`
  (projeto novo nasce com 5/4/2), `test/infrastructure/persistence/drizzle/agent-area.repository.spec.ts`
  (semear de novo não desfaz o teto alterado), `test/db/paralelismo-padrao-migration.spec.ts`
  (linhas com 2, 3 e 7 terminam em 5/4/2) e `test/application/use-cases/execution/request-parallelization.use-case.spec.ts`
  (o padrão de 5 decide o paralelismo do dev).

<a id="rn-914"></a>

### RN-914 — O orçamento de raciocínio é por modelo, só para quem o respeita {#rn-914}

- **Regra:** revisa a [RN-782](#rn-782) ([ADR 0223](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0223-orcamento-de-raciocinio-por-modelo.md)). Modelo com `models.reasoning_budget` preenchido (curado à mão, nunca pelo sync) e `supportsReasoning` manda `reasoning: { max_tokens: N }` e `max_tokens` = saída visível + N ([RN-741](#rn-741)); só no provider que sabe controlar o raciocínio (hoje o OpenRouter) e nunca no agente com raciocínio desligado ([RN-783](#rn-783)). Hoje só `qwen/qwen3.7-flash` (N = 2048), provado em 22/10: 1024 pedidos, 1024 gastos. Modelo sem orçamento segue a RN-782, corpo byte a byte. `deepseek/deepseek-v4.1-flash` fica sem orçamento: `reasoning.max_tokens`, `effort` e `reasoning_effort` foram ignorados (8192 de raciocínio). `effort` nunca é enviado. O limite contém o raciocínio mas não garante a tool call.
- **Onde:** `src/domain/llm/raciocinio-do-agente.ts:18` (`opcoesDeRaciocinio`), `src/infrastructure/llm/openai-compatible-provider.ts:640` (`controla`), `src/db/schema/llm.ts:159` (`reasoningBudget`), `src/db/migrations/0074_orcamento_de_raciocinio.sql`
- **Teste:** `test/infrastructure/llm/openai-compatible-provider.contract.spec.ts` (`modelo com orçamento de raciocínio (RN-914)`), `test/domain/llm/raciocinio-do-agente.spec.ts`
- **Origem:** AT-569 (medição paga de 22/10, `~/brabo-gravacoes/raciocinio-smoke-2026-10-22/resultados.jsonl`)

<a id="rn-915"></a>

### RN-915 — O raciocínio é contado no stream e abortado no limite; o custo abortado é estimado e depois reconciliado {#rn-915}

Complementa a [RN-914](#rn-914) ([ADR 0224](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0224-raciocinio-abortado-no-stream.md)).

1. **Aborto.** Com `reasoning_budget` e raciocínio ligado, o provider soma os
   caracteres de `delta.reasoning`; passando de `caracteres/4 > N` ele destrói a conexão
   e emite `truncated` com `motivo: "raciocinio"` (o corte por `max_tokens` não tem
   motivo). Sem orçamento (ou com raciocínio desligado), nada é contado.
2. **Estimativa na hora.** A resposta abortada não traz `usage`: saída = caracteres/4,
   entrada pelo estimador, ao preço do catálogo, `estimated`, `price_implicit` e
   `custo_a_reconciliar` (só se há id de geração).
3. **Reconciliação.** Periódica (`CUSTO_RECONCILIACAO_INTERVAL_MS`), idempotente: troca
   pelo `total_cost` de `GET /generation?id=` só com 200, só linha marcada e das últimas
   24 h; 404 ou erro deixam a linha como está. A estimativa vai para `catalog_cost_micros`.
   O `spentMicros` de budget/área não é corrigido.

- **Código:** `src/infrastructure/llm/openai-compatible-provider.ts:391` (`limiteDeRaciocinio`);
  `src/application/use-cases/llm/reconciliar-custo-estimado.use-case.ts:57` (`execute`)
- **Teste:** `test/infrastructure/llm/raciocinio-abortado.spec.ts` (aborta e estima; sem orçamento não conta);
  `test/application/use-cases/llm/reconciliar-custo-estimado.use-case.spec.ts` (200 troca, 404 mantém);
  `test/infrastructure/persistence/token-usage.repository.spec.ts` (troca uma única vez)
- **Origem:** AT-589; ADR [0224](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0224-raciocinio-abortado-no-stream.md)
