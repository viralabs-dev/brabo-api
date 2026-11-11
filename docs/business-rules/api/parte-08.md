---
id: rn-api-parte-08
title: 'Regras de negócio — API — parte 8 (desde RN-618)'
sidebar_label: 'API — parte 8 (desde RN-618)'
description: 'As RNs hospedadas na raiz api.'
keywords: [regras de negócio, api]
---

# API — parte 8 (desde RN-618)

## O idioma das respostas dos agentes (RN-618..620, RN-622..624, ADR 0177) {#o-idioma-das-respostas-dos-agentes-rn-618-620-rn-622-624-adr-0177}

O épico EP-028 nasceu de uma conversa em português respondida em espanhol. As
decisões do mantenedor de 2026-09-28 (AT-168, AT-169) fixaram onde o idioma
das RESPOSTAS mora — conta, sessão e projeto — e a precedência entre as
fontes. Nenhuma destas regras toca o idioma da INTERFACE ([RN-432](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-432)).

<a id="rn-618"></a>

### RN-618 — O idioma das respostas é da PESSOA: escolha na conta, override por sessão, e a precedência que termina sempre num idioma {#rn-618}

1. **Lista aberta, forma canônica.** O idioma das respostas é qualquer código
   BCP-47 cuja subtag de idioma o ICU da api reconheça, gravado canônico
   (`pt-br` vira `pt-BR`) — nunca o enum `pt-BR`/`en` da interface, que
   continua fechado. `und`, uso privado e texto livre são recusados com 400
   que nomeia a regra.
2. **Conta nova nasce no AUTOMÁTICO.** `users.response_language` é `NULL`
   ("automático") até a pessoa escolher; a api mostra e aceita `automatico`
   como o nome desse estado.
3. **Interface e respostas são independentes.** `PATCH /users/me/preferences`
   aceita `locale` e `responseLanguage` como OPCIONAIS; mandar um não toca o
   outro, um corpo sem nenhum é 400, e um `responseLanguage` inválido recusa o
   corpo INTEIRO antes de gravar qualquer campo.
4. **O detectado só vale confirmado.** O idioma detectado pelas mensagens da
   pessoa (a detecção é a [RN-624](#rn-624)) só entra em `users.detected_language` junto
   com `detected_language_confirmed_at` — um CHECK recusa um sem o outro. A
   detecção sozinha não troca nada.
5. **Override por sessão é só de quem o fixou.**
   `PUT projects/:projectId/sessions/:sessionId/response-language`
   (`developer`, o papel de mandar mensagem a um agente — o override só muda
   as respostas às mensagens da própria pessoa) fixa um idioma naquela sessão
   para QUEM CHAMA; `language: null` (chave obrigatória) solta e volta a
   herdar da conta. O `GET` (`viewer`) devolve o efetivo de quem chama. A
   chave é o par sessão×usuário: outro participante da mesma sessão nunca é
   afetado, e não há rota para ler ou mexer no de outra pessoa.
6. **A precedência**, resolvida por pessoa e nunca por sessão: override da
   sessão > escolha da conta > detectado confirmado > `users.locale`. Como
   `users.locale` é `NOT NULL`, a cadeia sempre termina num idioma, e a origem
   (`sessao`/`conta`/`detectado`/`interface`) viaja com ele. O pedido pontual
   dentro de uma mensagem ("traduza para o inglês") não é degrau: quem o
   atende é o modelo.

**Quem consome:** desde a [RN-622](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-622) o efetivo chega ao modelo — a
api chama `ResolverIdiomaDaRespostaUseCase` com o AUTOR de cada mensagem a um
agente e a sessão, e o engine põe a orientação no fim de cada chamada de LLM
daquele turno. A Conta deixou de dizer que o valor "ainda não chega".

- **Código:** `src/domain/iam/idioma-de-resposta.ts:56`
  (`normalizarIdiomaBcp47`), `:118` (`resolverIdiomaDaResposta`);
  `src/db/schema/iam.ts:104` (`responseLanguage`), `:111`
  (`detectedLanguage`), `:128` (`users_idioma_detectado_so_confirmado`);
  `src/db/schema/sessions.ts:124` (`sessionLanguageOverrides`);
  `src/application/use-cases/iam/resolver-idioma-da-resposta.use-case.ts:44`
  (`ResolverIdiomaDaRespostaUseCase`);
  `src/application/use-cases/iam/update-user-preferences.use-case.ts:25`
  (`idiomaDaRespostaOuRecusa`), `:47` (`UpdateUserPreferencesUseCase`);
  `src/application/use-cases/iam/idioma-da-resposta-na-sessao.use-case.ts:19`
  (`IdiomaDaRespostaNaSessaoUseCase`);
  `apps/web/src/routes/ResponseLanguageSection.tsx`
- **Teste:** `test/domain/iam/idioma-de-resposta.spec.ts:12` (a
  régua, e o que ela recusa — caso de falha), `:40` (a precedência);
  `test/application/use-cases/iam/idioma-da-resposta.use-case.spec.ts:96`
  (conta nova no automático), `:124` (grava canônico, não toca a interface),
  `:158` (inválido não grava nada — caso de falha), `:188` (o override não
  alcança o outro participante), `:209` (404 de sessão de outro projeto);
  `test/infrastructure/persistence/session-language-override.repository.spec.ts:73`
  (o CHECK no banco), `:93` (upsert pelo par);
  `apps/web/src/routes/ResponseLanguageSection.test.tsx:76` (efetivo com
  origem, sem o aviso antigo de "ainda não chega"), `:115` (código
  digitado só salva no botão)
- **Origem:** AT-162, sobre as decisões das AT-168 (respostas 1, 2, 3, 4 e 6)
  e AT-169 (resposta 2); especificação da AT-079

<a id="rn-619"></a>

### RN-619 — O projeto tem um idioma, o de tudo que não tem autor humano, e ele nasce do idioma de quem cria {#rn-619}

1. **O que ele governa** (decisões do mantenedor: AT-168 resposta 8, AT-169
   resposta 1): o idioma dos artefatos COMPARTILHADOS (product brief, regras
   de negócio, ADRs) e dos turnos SEM autor humano (abertura por `kickoff`,
   dev agents, gates, mensagem de commit, corpo de PR). O que um agente
   responde a uma PESSOA continua sendo o idioma das respostas dela
   ([RN-618](#rn-618)).
2. **Sempre um idioma concreto.** `projects.language` é `NOT NULL`, código
   BCP-47 canônico pela MESMA régua da RN-618 — mas sem "automático", que é
   resolver pelas mensagens de uma pessoa e não cabe no que não tem pessoa.
   `automatico` e código não reconhecido são 400, e o projeto não nasce (ou
   não muda).
3. **Projeto novo**: o `language` pedido na criação, canonicalizado; sem
   pedido, o idioma EFETIVO das respostas de QUEM CRIA
   (`ResolverIdiomaDaRespostaUseCase`, sem sessão: escolha da conta >
   detectado confirmado > idioma da interface). A proposta da nota era o
   `users.locale` de quem cria; a cadeia inteira foi escolhida porque quem
   já disse em que idioma quer trabalhar não deveria ver o projeto nascer
   em outro — e, sem escolha nem detecção, ela É o `users.locale`.
4. **Projetos que já existiam**: a migração `0062_idioma_do_projeto` grava o
   idioma do TITULAR do workspace (`workspaces.created_by`, de quem é a
   credencial que os agentes gastam — RN-058/RN-616), pela mesma cadeia. Na
   migração ninguém tinha escolha nem detecção ainda, então o valor é o
   `users.locale` dele. O titular, e não "um owner" de `workspace_members`,
   porque ele é UM só e a migração não pode escolher entre dois.
5. **Quem troca**: `PATCH /projects/:projectId` com `language` (`maintainer`,
   o mínimo da rota), e a seção "Idioma do projeto" em Configurações, com o
   controle inerte e o motivo em texto para quem não alcança (RN-102). O
   default `pt-BR` da coluna é só a rede de quem insere por fora do caso de
   uso (seed, script, fixture).

**Quem consome, e o que sobra:** desde a [RN-622](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-622) o engine lê a
coluna (`Engine.Projects.Project`, direto do Postgres) e a manda ao modelo em
toda chamada de LLM de turno SEM autor humano, e desde a [RN-623](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-623)
também como idioma do artefato compartilhado que um agente grava DURANTE um
turno com autor humano — a divergência que esta regra declarava fechou.

- **Código:** `src/db/schema/iam.ts:271` (`language`);
  `src/db/migrations/0062_idioma_do_projeto.sql` (o backfill);
  `src/application/use-cases/iam/idioma-do-projeto.ts:13`
  (`idiomaDoProjetoOuRecusa`);
  `src/application/use-cases/iam/create-project.use-case.ts:72`
  (`language`); `src/application/use-cases/iam/update-project.use-case.ts:18`
  (`idiomaDoProjetoOuRecusa`);
  `src/interfaces/http/iam/dto/iam.response.dto.ts:271`
  (`language`); `apps/web/src/routes/settings/ProjectLanguageSection.tsx`
- **Teste:** `test/application/use-cases/iam/idioma-do-projeto.use-case.spec.ts:63`
  (nasce com o idioma de quem cria), `:74` (a escolha da conta vence a
  interface), `:100` (inválido e `automatico` — caso de falha, o projeto não
  nasce), `:132` (PATCH inválido não muda nada), `:152` (a migração grava o
  do titular); `apps/web/src/routes/settings/idioma-do-projeto.test.tsx:84`
  (vigente e a declaração do que ainda não segue ele), `:125` (abaixo de
  `maintainer`: o valor fica, o controle fica inerte)
- **Origem:** AT-243, sobre as decisões das AT-168 (resposta 8) e AT-169
  (resposta 1)

<a id="rn-624"></a>

### RN-624 — A api detecta o idioma do autor pelas próprias mensagens e PERGUNTA; só o confirmado vira preferência {#rn-624}

A [RN-618](#rn-618) deixou o degrau "detectado confirmado" pronto e vazio.
Decisão do mantenedor (AT-168 respostas 4, 6 e 7): **detectar, PERGUNTAR se o
idioma está certo, e o confirmado vira o padrão** — por pessoa, global, com a
pergunta na tela onde o idioma já é mostrado e corrigido.

1. **A régua é UMA, e mora na api.** A heurística da AT-080, medida pela
   AT-160 (marcadores contrastivos de `pt`/`es`/`en`, a limpeza de código, log,
   citação, URL e identificador), saiu de `scripts/idioma/` para
   `src/domain/iam/heuristica-de-idioma.ts`, e o instrumento a
   REEXPORTA de lá — o que o produto roda é o que o instrumento mede. A regra
   de O QUE é evidência (só ator `user`; no formulário, só as respostas, e o
   eco com os rótulos do agente pulado) também é uma só, `evidenciasDoAutor`,
   usada pela extração do corpus real e pela detecção. Local, sem LLM, sem
   dependência nova.
2. **A amostra é do event log, a histerese é refeita.** A detecção lê as 11
   evidências mais recentes da pessoa em TODAS as sessões (a janela de 10 mais
   a que a histerese refaz) e decide quando as DUAS últimas avaliações da
   amostra apontam o mesmo idioma (`idiomaConcordante`). Não há estado de
   detecção guardado: a avaliação da mensagem anterior é refeita com a janela
   que terminava nela. A leitura é servida por um índice PARCIAL
   (`session_events_evidencia_de_idioma_idx`, ator `user` e os dois tipos de
   evidência): medido com 200 mil eventos, 0,056 ms pelo índice contra 13,5 ms
   da varredura sem ele.
3. **Os limiares são PROVISÓRIOS.** `PARAMETROS_PROVISORIOS` são os
   candidatos da AT-080 com UMA diferença, a evidência mínima de 10 palavras e
   não 20 — no corpus SINTÉTICO a 10 a cobertura dos decidíveis sobe de 42,2%
   para 58,9% com os mesmos três erros (todos em língua fora das três). Lista
   `at080`; limiar 0,8, margem 0,3, amostra 10 mensagens / 2.000 caracteres,
   histerese 2. O corpus sintético foi escrito pela mesma mão que escreveu a
   heurística: nenhum destes números está calibrado, e o dono os recalibra com
   o corpus real (`pnpm --filter @brabo/scripts idioma:medir --real`), mudando
   o objeto, que é o único lugar de onde a api os lê.
4. **Quando pergunta.** `GET .../sessions/:sessionId/response-language`
   devolve `detectionQuestion` com o idioma a perguntar, ou `null`. Não
   pergunta quando: a detecção não concorda (texto curto, "ok", código, log,
   misto); o efetivo vem de escolha EXPLÍCITA — override da sessão ou Conta —,
   porque confirmar gravaria um degrau ABAIXO delas e a resposta não mudaria;
   o detectado já é o efetivo, comparado pela SUBTAG (`pt` não diverge de
   `pt-BR` — a heurística só sabe a língua); ou a pessoa já recusou esse
   idioma.
5. **A detecção nunca troca nada sozinha.** Só
   `POST /users/me/preferences/detected-language` grava: `confirm` escreve o
   par `detected_language` + `detected_language_confirmed_at` (o CHECK da
   RN-618) e apaga a recusa antiga do mesmo idioma — e é 409
   `deteccao_mudou`, sem gravar, quando as mensagens já não apontam o idioma
   (a coluna diz "detectado" e não pode guardar o que a heurística não
   detectou); `decline` grava a recusa em `detected_language_declines` (uma
   linha por pessoa e idioma, com a data), e ESSE idioma não é perguntado de
   novo. O que se guarda é o idioma e a decisão da pessoa — nunca país,
   nacionalidade ou proficiência.
6. **Onde a pergunta aparece.** Num cartão pequeno ancorado logo abaixo do
   indicador de idioma da barra da sessão ([RN-620](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-620)): "Detectamos que
   você escreve em espanhol (es) — usar espanhol (es) nas respostas?", com
   "Usar", "Não" e "Agora não". Sem modal, sem cobrir o composer; "Agora não"
   só esconde nesta tela, sem gravar, e a pergunta volta na próxima leitura.
   Enviar mensagem (ou responder formulário) relê o indicador, porque a
   mensagem nova é a evidência que pode fazer a pergunta aparecer.
7. **Falha nunca bloqueia nada.** A detecção roda na LEITURA do idioma, e não
   dentro de `SendAgentMessageUseCase`: a evidência já está no event log, a
   pergunta sobrevive a recarregar a página e aparece em qualquer sessão, e o
   envio da mensagem não passa por ela — não ganha latência e não tem como
   falhar por ela. Na leitura, qualquer falha (banco, heurística) vira
   `warning` e `detectionQuestion: null`; o idioma continua sendo mostrado.
8. **Custo:** CPU medido no corpus sintético, nesta máquina — 11,6 µs para
   limpar e classificar uma mensagem, 110 µs por detecção (11 mensagens, duas
   avaliações), mais a leitura indexada do item 2. Zero token.

**O que esta regra NÃO fecha, declarado:** a heurística conhece três línguas,
e a lista de idiomas é aberta — galego e francês podem virar `es`/`pt` (os
erros do sintético), e sob esta regra o custo é uma pergunta errada, que a
pessoa recusa. Uma mensagem em espanhol numa janela portuguesa deixa a
amostra indeterminada enquanto estiver nela (sem pergunta, sem troca). E o
arquivo da heurística não pode ter `import`: o instrumento o executa por type
stripping, e `scripts/idioma/` tem tsconfig próprio sem `verbatimModuleSyntax`
para aceitar os `export` de um módulo CommonJS.

- **Código:** `src/domain/iam/heuristica-de-idioma.ts:175`
  (`PARAMETROS_PROVISORIOS`), `:457` (`evidenciasDoAutor`), `:500`
  (`mensagensNecessarias`), `:520` (`idiomaConcordante`);
  `src/domain/iam/deteccao-de-idioma.ts:43` (`idiomaAPerguntar`);
  `src/application/use-cases/iam/detectar-idioma-do-autor.use-case.ts:57`
  (`DetectarIdiomaDoAutorUseCase`), `:66` (`detectar`), `:88` (`pergunta`),
  `:123` (`responder`);
  `src/infrastructure/persistence/drizzle/deteccao-de-idioma.repository.ts:27`
  (`ultimasEvidencias`), `:75` (`confirmar`);
  `src/db/schema/iam.ts:144` (`detectedLanguageDeclines`);
  `src/db/schema/sessions.ts:168`
  (`session_events_evidencia_de_idioma_idx`);
  `src/interfaces/http/iam/session-response-language.controller.ts:66`
  (`comPergunta`); `src/interfaces/http/iam/user-preferences.controller.ts:94`
  (`answerDetected`); `apps/web/src/routes/SessionLanguageIndicator.tsx`;
  `scripts/idioma/heuristica.ts` (a reexportação)
- **Teste:** `test/domain/iam/deteccao-de-idioma.spec.ts:29` (os
  provisórios), `:42` (duas avaliações concordam), `:48` (uma só não basta),
  `:52` (indeterminado não aponta — caso de falha), `:77` (o eco do formulário
  pulado), `:105`..`:158` (quando pergunta);
  `test/application/use-cases/iam/detectar-idioma-do-autor.use-case.spec.ts:109`
  (pergunta sem gravar), `:116` (confirmar), `:131` (recusar não pergunta de
  novo), `:142` (indeterminado não pergunta — caso de falha), `:148` (Conta
  explícita), `:159` (erro na detecção vira "sem pergunta" — caso de falha),
  `:169` (409 `deteccao_mudou`);
  `test/infrastructure/persistence/deteccao-de-idioma.repository.spec.ts:87`
  (só o autor, todas as sessões), `:166` (o índice parcial), `:200` (o par e a
  recusa apagada); `apps/web/src/routes/SessionLanguageIndicator.test.tsx:117`
  ("Usar"), `:148` ("Não"), `:162` ("Agora não" não grava), `:172` (409 vira
  toast)
- **Origem:** AT-163, sobre as decisões da AT-168 (respostas 4, 6 e 7), a
  especificação da AT-080 e a medição da AT-160

## Decidir no chat, onde o dono está (RN-626) {#decidir-no-chat-onde-o-dono-esta-rn-626}

<a id="rn-628"></a>

### RN-628 — O merge executado fecha a tarefa da PR: `done`, uma vez só {#rn-628}

O gate de QA/SecOps termina em `awaiting_user` e nada mais mexia no `status` da
tarefa: no uso real de 29/09 o `pr-6` foi mergeado três vezes e as tarefas
seguiram em `in_review` (AT-275).

1. **Depois do merge, nunca no lugar dele.** `git_merge` continua sendo
   `require_approval` incondicional ([RN-418](parte-04.md#rn-418)); a regra roda DENTRO de
   `ExecuteGitActionUseCase`, na transação que grava o resultado do merge, e só
   quando o provider devolveu `state: 'merged'` (PR aberta, ou merge que falhou,
   não toca a tarefa).
2. **A tarefa é achada pela PR que a abriu.** Toda `pr_open` do projeto cujo
   `pullRequestId` é o da PR mergeada e que carrega `storyTaskId` no payload.
   PR sem tarefa (infra, ADR) não muda nada.
3. **Idempotente.** `TaskRepository.markDoneIfNotDone` é um `UPDATE … WHERE
   status <> 'done'`: merge repetido da mesma PR devolve `null`, não move de
   novo e NÃO grava o evento. Quando move, grava UM evento imutável
   `backlog.task_status_changed` (`cause: 'pr_merged'`, `pullRequestId`,
   `actionId`), append-only, sem UPDATE em tabela de eventos. Sem migration.
4. **Fronteira declarada (AT-249).** Esta regra NÃO recusa merge de PR já
   mergeada nem consulta `gate_status`. A recusa da PR já mergeada (e da
   proposta repetida) veio depois, na [RN-663](#rn-663), antes de o merge
   chegar aqui; o gate pendente, por decisão do dono, é só aviso na tela.
5. **O merge na branch de trabalho também avisa o engine.** Com
   `state: 'merged'` e `targetBranch = main`, `settleMerge` anexa o evento de
   outbox `project.trunk_merged` ([RN-1022](parte-11.md#rn-1022)), para PRs de tarefa, de
   infra e de ADR igualmente.

- **Onde:** `src/application/use-cases/actions/execute-git-action.use-case.ts:374`
  (`settleMerge`), `src/infrastructure/persistence/drizzle/backlog.repository.ts:507`
  (`markDoneIfNotDone`)
- **Teste:** `test/application/use-cases/actions/execute-git-action.use-case.spec.ts`
  ("git_merge marca a tarefa como done": feliz, repetido, PR aberta/merge
  falho, PR sem tarefa)
- **Origem:** AT-275

<a id="rn-630"></a>

### RN-630 — Quem está ativo na sessão se lê da sessão INTEIRA, não dos últimos 200 eventos {#rn-630}

"Quem está ativo" e "quem recebe o composer" saíam do `agent.activated` visto
na janela de 200 eventos (`latest: true`). Numa sessão longa as ativações do
Arquiteto e da Infra saíam da janela; as ofertas de handoff endereçadas a eles
voltavam a parecer aceitáveis e o "oi" ia para o último agente que ainda
aparecia. É a classe de defeito da RN-180 (teto silencioso faz a
tela afirmar sobre o que não leu), já fechada para a presença de QA/SecOps na
[RN-568](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-568).

**A regra:** o resumo do projeto ([RN-090](parte-02.md#rn-090)) devolve
`roster.activatedAgents` — os agentes com ao menos um `agent.activated` na
sessão mais recente, um por agente, o de ativação mais recente (por `seq`)
primeiro. Quatro decisões:

1. **A fonte continua sendo o event log.** Nenhuma coluna derivada, nenhum
   índice e nenhuma migration: o campo entra na MESMA varredura por sessão que
   já calcula `executionActivated`/`gatesEverOpened` (`array_agg ... filter`),
   então o número de idas ao banco do resumo não muda (o spec de contagem
   constante segue valendo). A migration 0066 reservada não foi usada.
2. **Sem HTTP novo por poll.** O campo viaja no resumo que as telas já leem
   ([RN-579](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-579)).
3. **O cliente SOMA à janela e só confia com o resumo da MESMA sessão**
   (`latestSessionId === sessionId`), como na RN-568: ativação é monótona
   (agente ativado não se desativa), então a janela só dá falso negativo. Resumo
   de outra sessão não vale; sem resumo, a janela decide sozinha.
4. **A api diz o que aconteceu, não quem recebe.** O destinatário explícito e
   visível no chat (AT-251) e o aceite por `handoffId` (AT-253) consomem este
   campo na web e NÃO fazem parte desta regra.

**Lacuna declarada:** esta rodada só entrega o CONTRATO da api. `apps/web`
(`session-readiness.ts`, `session-handoffs.ts`) segue lendo a janela até a
AT-251/AT-253 passarem a consumir `roster.activatedAgents`.

> **Fechada na [RN-631](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-631) (AT-251):** o destinatário do composer e as
> ofertas de handoff da tela de Sessão SOMAM `roster.activatedAgents` à janela,
> com a guarda da mesma sessão. `criativoActive`/`arquitetoActive`
> (`session-readiness.ts`) seguem lendo só a janela.

- **Onde vive:** `src/infrastructure/persistence/drizzle/projects-summary.repository.ts:212`
  (`activatedAgents`); `src/application/ports/projects-summary-repository.port.ts:32`
  (`activatedAgents`)
- **Testes:** `test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  ("activatedAgents cobre ativações anteriores à janela de 200 eventos" e
  "activatedAgents é da sessão MAIS RECENTE: ativação de sessão antiga não vale")
- **Origem:** AT-252

<a id="rn-635"></a>

### RN-635 — Uma oferta de handoff pendente por destino no projeto; a que deixa de valer vira `superseded` {#rn-635}

`handoffs` só gravava `offered`/`accepted`, sem expiração, supersessão nem
dedupe: duplo clique em "arquitetura pronta" dava 2× Infra e 2× Dev Lead, e
oferta a agente já ativo ficava acionável para sempre (AT-291,
[ADR 0182](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0182-ciclo-de-vida-do-handoff.md)).

1. **No máximo UMA `offered` por (projeto, destino).** `decidirOferta` decide:
   sem pendente, cria; pendente na MESMA sessão e sem artefato novo (o novo é
   `null` ou igual), devolve a existente (`desfecho: ja_oferecido`, sem linha
   nem evento); qualquer outro caso cria a nova e substitui a pendente
   (`substituiu_oferta`) — devolver a antiga perderia o artefato novo, ou
   deixaria quem pediu sem nada para aceitar na sessão em que está.
2. **Quem substitui grava.** A linha vira `superseded` e nasce um evento
   `handoff.superseded` (`handoffId`, `toAgent`, `motivo`, `substitutaId`) na
   sessão da oferta VELHA, ator `system`, mesmo com a sessão encerrada. O
   `handoff.offered` original não é tocado.
3. **Serializado por destino.** `CreateHandoffUseCase` roda numa transação com
   `pg_advisory_xact_lock` do par (projeto, destino): duas abas chegando juntas
   produzem UMA linha. Duplicatas de antes convergem na próxima oferta ou
   ativação, com evento; a migration não reescreve linha nenhuma.
4. **Agente já ativo não recebe oferta:** 409 `reason: agente_ja_ativo`, sem
   linha nem evento. Ativo = `agent.activated` numa sessão NÃO terminal do
   projeto. A `message` é o texto que o modelo lê: `offer_handoff` a repassa
   literal, e `FalhaDeTurno.origem/1` a classifica `politica`.
5. **Ativar substitui.** `ActivateAgentUseCase` (aceite e ativação direta) e
   `ActivateExecutionUseCase` (por `dev-<modulo>`) substituem, depois de
   ativar, toda oferta pendente ao agente em qualquer sessão do projeto; a
   aceita não é tocada, e ativação recusada não substitui nada.
6. **"Arquitetura pronta" é idempotente.** `OfferInfraHandoffUseCase` não
   aciona o destino (`infra`, `dev-lead`) que já tem oferta pendente ou está
   ativo; com os dois assim, não grava nem chama o engine
   (`desfecho: ja_oferecido`, `jaAtendidos` com o motivo de cada um).

- **Onde:** `src/domain/sessions/ciclo-de-vida-do-handoff.ts:71`
  (`decidirOferta`), `:104` (`mensagemDeAgenteJaAtivo`);
  `src/application/use-cases/agents/ciclo-de-vida-do-handoff.service.ts:43`
  (`sessaoOndeEstaAtivo`), `:71` (`substituir`), `:97`
  (`substituirOfertasAoAtivar`);
  `src/application/use-cases/agents/create-handoff.use-case.ts:109`
  (`travarOfertasDoDestino`);
  `src/infrastructure/persistence/drizzle/handoff.repository.ts:94`
  (`travarOfertasDoDestino`);
  `src/application/use-cases/agents/activate-agent.use-case.ts:88`
  (`substituirOfertasAoAtivar`);
  `src/application/use-cases/execution/activate-execution.use-case.ts:327`
  (`substituirOfertasAoAtivar`);
  `src/application/use-cases/agents/offer-infra-handoff.use-case.ts:96`
  (`jaAtendido`);
  `apps/engine/lib/engine/harness/tools/offer_handoff.ex:132`
  (`agente_ja_ativo`); `apps/engine/lib/engine/agents/falha_de_turno.ex:67`
  (`agente_ja_ativo`); `src/db/migrations/0064_ciclo_de_vida_do_handoff.sql`
- **Teste:** `test/application/use-cases/agents/ciclo-de-vida-do-handoff.spec.ts`
  (contra Postgres: repetida na mesma sessão, duplo clique concorrente,
  artefato novo, outra sessão encerrada, dado de antes do ADR, agente ativo e
  ativo em sessão encerrada, ativação que substitui e ativação recusada);
  `test/application/use-cases/agents/offer-infra-handoff.use-case.spec.ts`
  ("ADR 0182: segundo clique…", "ADR 0182: só aciona o destino que falta…");
  `test/application/use-cases/agents/activate-agent.use-case.spec.ts`;
  `test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  ("ciclo de vida do handoff");
  `apps/engine/test/engine/harness/tools/offer_handoff_test.exs`;
  `apps/engine/test/engine/agents/falha_de_turno_test.exs`;
  `apps/web/src/lib/session-handoffs.test.ts` (a tela: `superseded` não vira
  card acionável no fio, na faixa fora da janela nem no card da Infra)
- **Origem:** AT-291

<a id="rn-637"></a>

### RN-637 — A tela lê a CAUDA das ações da sessão, e a pendente antiga volta junto {#rn-637}

`GET /projects/:projectId/sessions/:sessionId/actions` ordenava por `seq`
crescente com teto de 200, e `usePendingActions` nunca paginava: a partir da
ação 201 de uma sessão — o que uma execução real alcança fácil, um dev agent
propõe dezenas de comandos por tarefa — a pendente NOVA ficava fora da única
página lida e sumia do fio, dos Executores e de Aprovações (AT-296), justamente
quando havia alguém esperando por ela.

**A regra:**

1. **A rota aceita `latest=true` e `status=pending`.** `latest` traz as `limit`
   ações de `seq` mais alto, devolvidas em ordem CRESCENTE e sem `nextCursor`,
   ignorando `afterSeq` — o mesmo contrato do `latest` dos eventos (ADR 0021).
   `status` só aceita `pending` (outro valor é 400, sem consultar); combinado
   com `latest`, traz as pendentes mais novas sem que as decididas ocupem a
   janela. Sem os dois parâmetros o contrato é o de antes.
2. **A tela faz duas perguntas, e a segunda só quando precisa.**
   `buscarAcoesDaSessao` lê a cauda (200); só se ela vier CHEIA pede também as
   pendentes e une por `id`, em `seq` crescente. Uma pendente antiga que a
   cauda empurrou para fora continua sendo decisão a tomar e não some por ter
   esperado demais. A sessão curta — o caso comum — continua custando UMA
   requisição, e a leitura de pendentes que falha derruba a query (a tela diz
   que falhou, nunca finge fila vazia — RN-088).

**O que esta regra NÃO fecha:** com mais de 200 PENDENTES numa sessão, as mais
antigas além delas ficam fora (o teto é o mesmo `limit`); e o que o fio mostra
de DECIDIDO continua sendo a cauda — ação decidida antiga, fora das 200 mais
novas, não aparece no fio. Pendentes do PROJETO inteiro são outra leitura
([RN-638](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-638)).

- **Código:** `src/infrastructure/persistence/drizzle/proposed-action.repository.ts:96`
  (`listPaginated`), `:113` (o ramo `latest`);
  `src/interfaces/http/actions/actions.controller.ts:105` (`list`),
  `:114` (a recusa de `status`);
  `src/application/ports/proposed-action-repository.port.ts`
  (`ListProposedActionsOptions`);
  `apps/web/src/lib/acoes-da-sessao.ts:48` (`buscarAcoesDaSessao`), `:30`
  (`juntarCaudaEPendentes`); `apps/web/src/lib/hooks.ts:432`
  (`usePendingActions`)
- **Teste:** `test/infrastructure/persistence/proposed-action-latest.repository.spec.ts`
  (sem `latest` a pendente nova fica de fora — o defeito; com `latest` ela
  está na cauda; `status=pending` devolve a antiga; e não traz outra sessão);
  `test/interfaces/http/actions/actions-list.controller.spec.ts`
  (repasse dos parâmetros e o 400 — caso de falha);
  `apps/web/src/lib/acoes-da-sessao.test.ts` (sessão curta numa requisição;
  cauda cheia com 250 ações devolve a pendente 3 e a 250; leitura de pendentes
  que falha derruba a query)
- **Origem:** AT-296 (HS-076)

<a id="rn-642"></a>

### RN-642 — "Sempre permitir" aprova e grava o padrão na MESMA transação; clique em ação já aprovada é sucesso nomeado {#rn-642}

No uso real de 29/09, 45 de 173 cliques em "Sempre permitir" devolveram 409
(AT-310): o padrão era gravado ANTES de aprovar, e uma ação que já tinha saído
de `pending` (clique duplo, a mesma pendência em dois painéis, outra aba)
lançava 409 com o padrão JÁ gravado e SEM o evento `permission.granted`.

1. **Mesma transação, depois da transição.** `ApproveActionUseCase` aceita um
   `aoAprovar` que roda DENTRO da transação da decisão, depois de
   `assertTransition` passar e antes da execução; é por ele que o padrão
   (`permissions.json/allow` ou `agent_autonomy`, [RN-509](parte-06.md#rn-509)) e o
   `permission.granted` são gravados. "Aprovar antes, gravar depois" em
   transações separadas foi recusado: trocaria o defeito por ação aprovada (e
   até executada) com o padrão falhando depois. `agent_autonomy` e o evento são
   atômicos com a decisão; o `permissions.json` é arquivo e não entra em
   transação — ele só é escrito depois de a transição ser válida, e falhar ao
   escrevê-lo desfaz a aprovação. Sobra, declarada, a janela de o COMMIT falhar
   depois do arquivo escrito.
2. **O evento acompanha a gravação, e só ela.** Padrão que já existe não é
   regravado nem narrado de novo (`padraoGravado: false`).
3. **Ação já aprovada é sucesso nomeado.** Se a transição é recusada porque a
   ação já está `approved`/`auto_approved`/`executed`/`failed`, a resposta é
   201 com `desfecho: 'ja_aprovada'` (o caminho normal devolve `'aprovada'`),
   sem executar de novo, gravando o padrão só se ele faltar — com o evento.
   Transição inválida vinda da EXECUÇÃO, depois de a decisão ter sido
   confirmada, NÃO vira `ja_aprovada`: propaga como sempre.
4. **Ação RECUSADA continua 409, nomeado** (`reason: 'acao_ja_recusada'`), sem
   gravar padrão nem evento: liberar para sempre o que alguém acabou de recusar
   não é idempotência.
5. **Tetos intactos.** `git push`/PR/deploy, `sudo`/`doas`
   (`motivoDeRecusaSempreAprovar`, [RN-418](parte-04.md#rn-418)) e `container_remove`
   continuam recusados com 400 ANTES de qualquer leitura de estado — inclusive
   com a ação já aprovada. O padrão continua o EXATO da ação (a generalização
   por verbo é a AT-257, fora daqui).
6. **Os TIPOS do teto também (AT-320).** Medido na auditoria de 30/09: a api
   só recusava o `git push` DIGITADO no terminal; o `git_push` TIPADO passava e
   gravava `GitPush()` em `allow` (ou autonomia do módulo), e o `ApprovalCard`
   oferecia o botão. `TIPOS_SEM_SEMPRE_PERMITIR` é a lista ÚNICA — `git_push`,
   `pr_open`, `git_merge` (inteiro: o padrão `GitMerge()` valeria para todo
   destino), `container_remove`, `instruction_patch`, `parallelize`,
   `raise_max_parallel` — e `motivoDeRecusaDoSempreAprovar` julga terminal pelo
   comando e o resto pelo tipo. A recusa é 400 com `reason:
   'teto_do_sempre_permitir'` e `actionType`. A web esconde o botão pela cópia
   em `apps/web/src/lib/sempre-permitir.ts`, conferida contra a da api por
   teste; comando de terminal segue com o botão (repetir o parser na tela
   seria segunda régua) e recebe a recusa da api. Quando nasceu, NÃO mudava
   `decide()` nem a semeadura; desde a [RN-689](parte-09.md#rn-689) mudam os dois —
   `git_push`/`pr_open` estão no teto de `decide()` e a ativação semeia só
   `git_commit` —, e o padrão que o clique gravaria para eles seria inerte.

- **Onde:** `src/application/use-cases/actions/approve-always-action.use-case.ts:109`
  (`execute`), `:190` (`cliqueSobreAcaoJaDecidida`), `:240`
  (`gravarPadraoSeFaltar`), `src/application/use-cases/actions/approve-action.use-case.ts:300`
  (`approve`), `src/domain/actions/sempre-permitir.ts:30`
  (`TIPOS_SEM_SEMPRE_PERMITIR`), `:65` (`motivoDeRecusaDoSempreAprovar`),
  `apps/web/src/lib/sempre-permitir.ts:15` (`TIPOS_SEM_SEMPRE_PERMITIR`)
- **Teste:** `test/application/use-cases/actions/approve-always-action.use-case.spec.ts`
  ("ordem e idempotência (RN-642)": clique duplo, cliques concorrentes, ação
  aprovada por outro caminho, recusada → 409 nomeado sem padrão, padrão que
  falha desfaz a aprovação, tetos com a ação já aprovada; "tipos do teto
  (AT-320)"), `test/domain/actions/sempre-permitir.spec.ts`,
  `apps/web/src/lib/sempre-permitir.test.ts` (a cópia do web igual à da api),
  `apps/web/src/components/ApprovalCard.test.tsx` (git tipado sem o botão)
- **Origem:** AT-310, AT-320

## A sessão encerrada pode ser reaberta (RN-649/RN-650) {#a-sessao-encerrada-pode-ser-reaberta-rn-649-rn-650}

<a id="rn-649"></a>

### RN-649 — Sessão `closed`/`closed_abnormally` reabre para `active` com o log intacto, e o fechamento anterior vira evento novo {#rn-649}

A [RN-001](parte-01.md#rn-001) dizia que os estados terminais não têm saída. Desde o
[ADR 0183](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0183-reabrir-sessao-encerrada.md) há UMA, e só uma: a
reabertura, de `closed` ou `closed_abnormally` para `active`, por caminho
próprio. A transição GENÉRICA continua recusando `closed → active` com 409, e
`closing → active` segue proibido por qualquer caminho.

1. **O que volta é a sessão inteira.** O event log não é tocado — a conversa,
   as regras de negócio, as perguntas respondidas, as ofertas e aceites de
   handoff. Um agente conversacional parado no fechamento volta pelo
   `start_agent` idempotente na primeira mensagem e reconstrói o histórico
   ([RN-580](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-580)). A conversa volta a entrar porque a recusa da
   [RN-581](parte-07.md#rn-581) lê o estado da sessão, que agora é `active`.
2. **O fechamento anterior não se apaga.** A linha de `sessions` perde
   `closed_at` e `termination_reason`; o evento NOVO `session.reopened`, no
   mesmo `seq` ([RN-002](parte-01.md#rn-002)) e com o ator humano que reabriu, carrega
   `{from, to, closedAt, terminationReason}`. Nenhum evento é editado nem
   renumerado, e o `kind` não muda ([RN-097](parte-02.md#rn-097)).
3. **Sessão com execução não reabre** — 409 `sessao_com_execucao`. Reabrir uma
   sessão com `execution.activated` a devolveria a `findActiveExecutionSession`
   ([RN-139](parte-03.md#rn-139)). Decisão do dono,
   confirmada no [ADR 0184](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0184-reabrir-sessao-decisoes-do-dono.md).
4. **Sem prazo.** Toda sessão encerrada é reabrível (decisão do dono, ADR 0184).
5. **O engine é chamado antes da transação**, como na ativação: falha dele
   deixa a sessão encerrada, sem evento. Outro estado que não terminal é 409
   `sessao_nao_encerrada`.
6. **O fechamento que a reabertura desfez não para a sessão viva.** O
   `SessionLifecycleWorker` lê o `status` da sessão e ignora, com log, o job de
   `session.closed`/`session.closed_abnormally` de uma sessão que a api já diz
   não-terminal.
7. **A segunda análise automática do Psicólogo fica bloqueada** pelo
   `alreadyAnalyzed` que já existia; o reprocessamento manual segue. A segunda
   consolidação do grafo estende a janela da mesma `Interacao`.

- **Onde:** `src/domain/sessions/session-state-machine.ts:66`
  (`canReopen`), `:70` (`assertReopen`);
  `src/domain/sessions/reabertura-de-sessao.ts:24`
  (`SessaoComExecucaoNaoReabreError`), `:44`
  (`garantirQueSessaoSemExecucaoReabre`), `:58` (`payloadDaReabertura`);
  `src/application/use-cases/sessions/reopen-session.use-case.ts:53`
  (`execute`), `:96` (`garantirQuePodeReabrir`);
  `apps/engine/lib/engine/workers/session_lifecycle_worker.ex:59`
  (`encerrar_se_ainda_encerrada`);
  `apps/engine/lib/engine/sessions/project_session.ex:48` (`status`)
- **Teste:** `test/domain/sessions/session-state-machine.spec.ts:56`
  (só terminais reabrem; `closing` nunca volta);
  `test/application/use-cases/sessions/reopen-session.use-case.spec.ts:121`
  (`closed` reabre, log preservado, `session.reopened` com o fechamento
  anterior — caminho feliz), `:151` (`closed_abnormally`), `:163` (a conversa
  volta a entrar), `:186` (`closing` é 409 sem engine nem evento — caso de
  falha), `:208` (sessão com execução é 409 `sessao_com_execucao`), `:239`
  (engine fora do ar: nada muda);
  `apps/engine/test/engine/workers/session_lifecycle_worker_test.exs:66`
  (fechamento de sessão já `active` não para o processo), `:82` (fechamento de
  sessão `closed` para, como sempre)
- **Origem:** AT-071 (HS-048), sobre o `exp001`

<a id="rn-650"></a>

### RN-650 — Reabrir é `developer`, por rota própria, e a tela só oferece o botão a quem alcança o papel {#rn-650}

`POST projects/:projectId/sessions/:sessionId/reopen` exige `developer` — o
MESMO papel da transição genérica que encerra a sessão: quem pode dá-la por
terminada pode trazê-la de volta. Responde 200 com a sessão. `viewer` é 403.
O [ADR 0183](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0183-reabrir-sessao-encerrada.md) tinha fixado `maintainer`
como padrão provisório; o dono decidiu `developer` em 2026-09-30
([ADR 0184](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0184-reabrir-sessao-decisoes-do-dono.md)), confirmando junto
as outras duas decisões — sem prazo, e sessão com `execution.activated`
recusada.

Na tela de Sessão, a faixa da sessão encerrada mostra "Reabrir sessão" com uma
frase do que volta. Abaixo de `developer` (`roleAtLeast`, papel de WORKSPACE —
a lacuna da [RN-471](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-471) já declarada na tela) o botão fica inerte e o
motivo é dito em TEXTO. A recusa da api (409 de sessão com execução, 403) vira
toast com a frase dela. O fio narra `session.reopened` como "sessão reaberta",
com a causa do fechamento anterior quando ela foi gravada.

- **Onde:** `src/interfaces/http/sessions/sessions.controller.ts:214`
  (`reopen`); `apps/web/src/lib/api-client.ts:634` (`reopenSession`);
  `apps/web/src/routes/SessionPage.tsx:147` (`podeReabrir`);
  `apps/web/src/lib/session-acoes-da-sessao.ts:77` (`handleReopen`); `apps/web/src/routes/SessionComposer.tsx:383` (o botão);
  `apps/web/src/lib/activity.ts:633` (a frase do fio)
- **Teste:** `test/interfaces/http/sessions/sessions-reopen.controller.spec.ts:22`
  (`developer`, o mesmo da transição genérica), `:36` (viewer não alcança o
  papel da rota; developer, maintainer e owner alcançam), `:49` (200);
  `apps/web/src/routes/SessionPage.reabrir-sessao.test.tsx:143` (developer
  reabre pela rota própria — caminho feliz), `:167` (maintainer e owner
  também), `:178` (viewer/sem papel: inerte com o motivo em texto — caso de
  falha), `:191` (recusa da api vira toast), `:213` (sessão ativa não oferece);
  `apps/web/src/lib/activity.test.ts` ("reabertura de sessão")
- **Origem:** AT-071; papel decidido na AT-337

## Acompanhar ao vivo sem martelar (RN-639) {#acompanhar-ao-vivo-sem-martelar-rn-639}

<a id="rn-654"></a>

### RN-654 — Os bindings resolvidos de todos os agentes e áreas vêm numa leitura só {#rn-654}

A [RN-645](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-645) mediu 49 requisições na carga da aba Configurações, e 20
delas eram o binding RESOLVIDO de cada agente (17) e de cada área (3), uma rota
por chave. Três seções liam essas chaves — modelos por agente, modelos por área
e melhores modelos por capacidade —, e o teto de 300 req/min é do USUÁRIO
([RN-579](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-579)).

**A regra:**

1. **`GET projects/:projectId/model-bindings/resolved?agents=…&areas=…`**
   devolve `{ agents: [{ key, binding }], areas: [{ key, binding }] }`, na
   ordem pedida e sem repetição. Cada `binding` é EXATAMENTE o que a rota
   individual responderia para aquela chave (`GET .../agent-bindings/:slug`,
   `GET .../area-bindings/:key`): a mesma cascata `workspace › projeto › área ›
   agente` sem sessão, as mesmas origens que a tela transforma em cadeia
   ([RN-470](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-470)), a herança do Criativo, e `null` quando nenhum nível tem
   modelo. Não há cascata nova: o caso de uso chama `ResolveModelBindingUseCase`
   chave a chave, com a entrada que a rota individual passaria.
2. **O papel mínimo é o das rotas individuais de leitura, `viewer`.** Quem não
   alcança o projeto recebe o MESMO 403.
3. **A leitura é contida**
   ([ADR 0060](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0060-superficie-de-leitura-de-codigo.md)): as chaves vêm em
   lista separada por vírgula, com o alfabeto dos slugs (minúsculas, dígitos, `-`, `_`), e são no
   máximo 64 somadas (`TETO_DE_CHAVES_NO_LOTE`). Chave malformada ou lote acima
   do teto é 400 nomeando o motivo, nunca chave descartada calada — a resposta
   afirmaria sobre menos chaves do que a tela pediu.
4. **A web lê o lote por UMA `queryKey`** (`['model-bindings-resolved',
   projectId]`), servida por uma requisição às três seções de Configurações e,
   desde a AT-339, também à Visão geral e à aba Executores
   (`useBindingsDosAgentes`): os agentes do roster que o catálogo conhece saem
   dessa MESMA chave — o cache que uma aba aqueceu serve a outra sem
   requisição —, e os que o catálogo não conhece (os `dev-<modulo>`) saem de UMA
   leitura em lote a mais, sob o mesmo prefixo e em fatias do mesmo teto. Toda
   escrita de binding de agente ou de área relê o lote inteiro por esse
   PREFIXO, que alcança as duas leituras; não sobra chave por agente para
   invalidar. A falha dessas leituras deixa o cartão do agente sem modelo —
   "não sei", nunca um modelo afirmado — e não cai de volta na rota por agente.
5. **A falha do lote não vira "sem modelo".** Com uma leitura só, a falha é de
   todas as chaves de uma vez: a seção diz o motivo UMA vez, com a frase da api
   e a ação de reler, e cada linha diz "não lido" no lugar da cadeia. Enquanto
   o lote não responde, a linha diz "lendo…". "Sem modelo em nenhum nível" fica
   reservado ao `null` que a api afirmou.

**Números:** a carga da aba caiu de 49 para 30 requisições
(`configuracoes.orcamento.test.tsx`, sobre a `dev` em 94e5dc721d); o minuto
parado segue em 64, todo da moldura. Na AT-339, a carga da aba Executores caiu
de 29 para 27 e a da Visão geral de 33 para 31 (`duas-abas.orcamento.test.tsx`,
com o roster base de três agentes — com time e módulos, a queda é de um por
cartão), e ir de Configurações para a Visão geral deixou de buscar binding
nenhum (antes, 3).

**O que esta regra NÃO fecha:** as rotas por chave continuam existindo na api
(nenhuma tela as lê mais). Um `dev-<modulo>` cuja chave passe de 64 caracteres
seria recusado pelo formato do lote, e a leitura dos extras falharia inteira —
não medido em projeto real, e declarado.

- **Código:** `src/application/use-cases/llm/resolve-model-bindings-em-lote.use-case.ts:12`
  (`TETO_DE_CHAVES_NO_LOTE`), `:37` (`lerListaDeChaves`), `:77`
  (`ResolveModelBindingsEmLoteUseCase`);
  `src/interfaces/http/llm/model-bindings.controller.ts:233`
  (`getResolvedBindings`); `apps/web/src/lib/api-client.ts:1217`
  (`getResolvedModelBindings`); `apps/web/src/lib/bindings-resolvidos.ts:43`
  (`invalidarBindingsResolvidos`), `:69` (`useBindingsResolvidos`), `:111`
  (`useBindingsDosAgentes`); `apps/web/src/routes/ProjectOverviewTab.tsx:144`
  e `apps/web/src/routes/ProjectExecutorsTab.tsx:155` (quem o chama);
  `apps/web/src/components/AgentTeamGrid.tsx:46` (`bindingDoAgente`);
  `apps/web/src/routes/settings/LeituraDosBindings.tsx:19`
  (`AvisoDeBindingsNaoLidos`), `:40` (`MarcaDeBindingNaoLido`)
- **Teste:** `test/interfaces/http/llm/model-bindings-em-lote.integration.spec.ts:182`
  (caminho feliz contra Postgres: viewer lê o lote, e cada chave é igual à
  rota individual), `:256` (recusa por papel, o mesmo 403 da rota
  individual), `:275` (chave malformada), `:287` (lote acima do teto);
  `apps/web/src/routes/settings/bindings-em-lote.test.tsx:150` (as duas seções
  renderizam de UMA chamada, sem rota por chave), `:182` (a falha do lote é
  dita e nenhuma linha vira "sem modelo"), `:217` (lendo, não "sem modelo");
  `apps/web/src/routes/configuracoes.orcamento.test.tsx:233` (a carga lê o
  lote uma vez e cabe em 30), `:279` (ir para a Visão geral não busca
  binding); `apps/web/src/routes/ProjectOverviewTab.test.tsx:472` (o modelo
  do cartão sai de UMA leitura em lote, sem rota por agente), `:493` (o lote
  recusado não inventa modelo nem cai na rota por agente);
  `apps/web/src/routes/ProjectExecutorsTab.test.tsx:524` (o `dev-<modulo>`
  fora do catálogo vem da leitura dos extras), `:547` (os extras recusados
  deixam o cartão sem modelo); `apps/web/src/routes/duas-abas.orcamento.test.tsx:334`
  (a carga das duas abas lê o lote uma vez e cabe em 27 e 31)
- **Origem:** AT-334 (decisão do dono sobre a lacuna declarada na
  [RN-645](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-645)); AT-339 (a Visão geral e a aba Executores no lote)

## A leitura dos membros do workspace (RN-655) {#a-leitura-dos-membros-do-workspace-rn-655}

<a id="rn-655"></a>

### RN-655 — `GET workspaces/:id/members` é `viewer`, e devolve só id, nome, e-mail e papel {#rn-655}

O fio da sessão ([RN-652](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-652)) nomeava só quem tinha linha em
`project_members`; quem entra no projeto só pelo papel de WORKSPACE virava
"Outro membro", porque não havia rota que lesse os membros do workspace
(decisão do dono, AT-335). A rota nasce ao lado das três de ESCRITA de membro
(`POST`/`DELETE` de membro e `PUT owner-of-record`, todas `owner`), e o mínimo
dela NÃO é o delas: o mínimo é do ENDPOINT ([RN-102](parte-03.md#rn-102)), e ler a lista
não é mantê-la. É `viewer`, o das leituras vizinhas (`GET workspaces/:id`,
`.../projects`) e o de `GET projects/:id/members`, que ela completa — quem
abre uma sessão precisa saber quem falou nela, e um `viewer` de workspace já
enxerga todo projeto do workspace.

A resposta tem a MESMA forma da leitura de projeto — `userId`, `name`,
`email`, `role` (o papel de WORKSPACE) — e nada além: sem `createdAt`, sem
estado de conta. Workspace inexistente é 404, e quem não é membro é recusado
pelo `RolesGuard` (403). Continua não havendo TELA de membros de workspace: a
leitura existe para nomear, e as rotas de escrita seguem sendo de API.

- **Código:** `src/interfaces/http/iam/workspaces.controller.ts:222`
  (`listMembers`);
  `src/application/use-cases/iam/list-workspace-members.use-case.ts:16`
  (`execute`);
  `src/infrastructure/persistence/drizzle/workspace.repository.ts:127`
  (`listMembers`)
- **Teste:**
  `test/application/use-cases/iam/list-workspace-members.use-case.spec.ts:75`
  (a forma da resposta, contra Postgres — caminho feliz), `:96` (workspace
  inexistente é 404), `:104` (o mínimo é `viewer`), `:112` (`viewer` passa pelo
  guard), `:125` (quem não é membro recebe 403)
- **Origem:** AT-335

## O motivo da política em cada cartão de Aprovações (RN-656) {#o-motivo-da-politica-em-cada-cartao-de-aprovacoes-rn-656}

<a id="rn-656"></a>

### RN-656 — A leitura de eventos da sessão filtra por `actionId`, e cada cartão da aba Aprovações lê o próprio motivo por ela {#rn-656}

A ação não guarda o motivo da política: ele mora no `proposed_action.created`
([RN-567](parte-07.md#rn-567), [RN-609](parte-07.md#rn-609)). A aba Aprovações lê a fila do
PROJETO ([RN-638](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-638)) e o log de UMA sessão, então desde a AT-333 ela
dizia numa nota única quantas ações ficavam sem motivo ([RN-614](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-614)).
Decisão do dono (AT-336): cada cartão mostra o PRÓPRIO.

**O que se mediu.** As duas saídas do card eram um filtro `actionId` na
leitura de eventos ou uma rota que lesse o evento pela ação. O filtro é o
menor: reusa a rota (`GET .../sessions/:sessionId/events`, `viewer`), o DTO e o
caso de uso, e a ação já carrega o `sessionId` da sessão que a propôs. Não
nasce índice nem migration: o predicado sobre `payload->>'actionId'` roda
DENTRO da sessão, que o índice único `(session_id, seq)` já recorta. Uma
leitura de PROJETO por `actionId` exigiria rota nova para achar a sessão que o
cartão já conhece.

**A regra na api.** `actionId` devolve só os eventos cujo `payload.actionId` é
aquela ação, na sessão pedida — nunca atravessa sessões. Combina com os outros
parâmetros e o `limit` conta só os que casam; o `seq` deixa de ser contíguo na
página, então quem filtra NÃO deriva omitidos por subtração
([RN-180](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-180)). Vazio é 400: um filtro que some com a string errada
devolveria o log inteiro a quem pediu o motivo de uma ação.

**A regra na tela.** `useDecisoesDaPolitica`: a ação cujo evento está no log
que a aba JÁ carregou usa esse, sem requisição; as outras leem pela ação, na
sessão dela, com `staleTime: Infinity` — evento é imutável, então cada ação
custa UMA leitura enquanto o cache viver e a fila polla sem repetir nenhuma.
Nada é pedido enquanto a aba ainda carrega o próprio log. A leitura que
responde SEM o evento dá a frase de "motivo não registrado" (nunca cala); só a
leitura que FALHA deixa o cartão calado, e é essa, e só essa, que a nota do
topo conta (*"de N das M ações abaixo"*). Desde a AT-340 os cartões das
pendências de OUTRAS sessões no chat ([RN-626](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-626),
`PendenciasDeOutrasSessoes`, também na aba Executores) passam pelo MESMO hook e
pelo MESMO cache: toda ação ali é de outra sessão, então nenhuma é coberta
pelo log da tela e cada uma lê pela ação — só as DESENHADAS, dentro do teto de
cards do bloco, e a que a aba Aprovações já leu não custa nada ali (e
vice-versa). A leitura que falha também cala o cartão e é dita uma vez, no topo
do bloco. O painel "precisa de você" NÃO usa este caminho: ele não lê log
nenhum e abrir não dispara consulta, então o cartão ali segue calado, como a
[RN-614](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-614) já dizia — decisão, não lacuna. Nenhum teto muda.

- **Código:** `src/interfaces/http/sessions/sessions.controller.ts:260`
  (`listEvents`);
  `src/infrastructure/persistence/drizzle/session-event.repository.ts:61`
  (o filtro);
  `apps/web/src/lib/decisao-da-politica-queries.ts:35` (`useDecisoesDaPolitica`);
  `apps/web/src/routes/ProjectApprovalsTab.tsx:307` (quem o chama), `:481` (a
  nota da falha), `:499` (o motivo em cada cartão);
  `apps/web/src/components/PendenciasDeOutrasSessoes.tsx:74` (o chat chama o
  mesmo hook), `:145` (o motivo em cada cartão), `:181` (a nota da falha)
- **Teste:**
  `test/application/use-cases/sessions/list-session-events-por-acao.use-case.spec.ts:80`
  (só os eventos da ação, com o motivo — caminho feliz, contra Postgres),
  `:109` (não atravessa sessões), `:123` (sessão de outro projeto é 404),
  `:134` (`actionId` vazio é 400);
  `apps/web/src/routes/ProjectApprovalsTab.test.tsx:267` (ação de outra sessão
  lê o motivo pela ação, e a do log carregado não vira requisição), `:294`
  (evento ausente diz "não registrado"), `:304` (a leitura que falha é dita
  uma vez, contando só ela);
  `apps/web/src/components/PendenciasDeOutrasSessoes.test.tsx:204` (o cartão
  do chat lê o motivo pela ação, na sessão dela, e remontar não relê), `:228`
  (a leitura que falha cala o cartão e é dita uma vez)
- **Origem:** AT-336; AT-340 (as pendências de outras sessões no chat)

- **Origem:** AT-329 (achado N2 de `docs/explanation/auditoria-visual-rodada-29.md`)

## Um clique fecha a prontidão, a necessidade e o aceite do PO (RN-657/RN-658) {#um-clique-fecha-a-prontidao-a-necessidade-e-o-aceite-do-po-rn-657-rn-658}

<a id="rn-657"></a>

### RN-657 — "Estou pronto — a necessidade está validada" fecha os DOIS gates num POST, com o `product_brief` produzido depois do clique {#rn-657}

Revisa a [RN-406](https://github.com/viralabs-dev/brabo-contracts/blob/dev/packages/docs/business-rules/contracts.md#rn-406) por decisão do dono (30/09, AT-311): o botão do
Criativo passou a se chamar **"Estou pronto — a necessidade está validada"**
(en: "I'm ready — the need is validated"), e é o rótulo que faz do clique o
julgamento de MÉRITO que o [ADR 0095](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0095-gate-necessidade-validada.md)
exigia separado — a pessoa declara as duas coisas, com as palavras das duas.
`POST .../sessions/:id/readiness` grava, nesta ordem:

1. `readiness.confirmed`, ator a pessoa, com a marca
   `{ necessidadeValidada: true, aceiteImplicitoDoPo: true }` (a marca é o
   que a [RN-658](#rn-658) lê; evento antigo, com payload `{}`, não aceita
   nada);
2. o comando ao engine (o turno que consolida o `product_brief`, [RN-142](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-142));
3. só se o engine ACEITOU o turno, `necessity.validated`, ator a mesma
   pessoa, com `productBriefId: null` (o brief ainda não existe — nasce do
   turno que o clique dispara), `via: 'readiness.confirmed'` e o
   `readinessEventId` do passo 1.

A recusa do engine (409 turno em curso, 422 sem regra de negócio) sobe ANTES
do passo 3: sem turno aceito não há brief a caminho, e a necessidade NÃO fica
validada. O gate segue `warn` (`config/gates.yml`) — nada a jusante o consulta.
A tela não tem mais o botão "Confirmar necessidade validada"; o título do
botão habilitado diz o que o clique fecha, e o aviso de sucesso diz que o PO
entra quando o resumo ficar pronto.

- **Código:** `src/application/use-cases/agents/confirm-readiness.use-case.ts:26` (`ConfirmReadinessUseCase`),
  `:42` (`necessity.validated`);
  `src/domain/sessions/estou-pronto.ts:27` (`MARCA_DO_ESTOU_PRONTO`);
  `apps/web/src/routes/SessionComposer.tsx:315` (o título do botão);
  `apps/web/src/lib/session-acoes-da-sessao.ts:143` (`handleReadiness`)
- **Teste:** `test/application/use-cases/agents/confirm-readiness.use-case.spec.ts:49`
  (os dois eventos, com a marca e o brief por vir — caminho feliz), `:72`
  (422 do engine: só a prontidão fica gravada — caso de falha);
  `apps/web/src/routes/SessionPage.estou-pronto.test.tsx:150` (um clique,
  aviso de necessidade validada, sem botão separado), `:169` (recusa: nada é
  dito como validado)
- **ADR:** [0185](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0185-estou-pronto-fecha-os-dois-gates.md), que revisa o
  [0095](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0095-gate-necessidade-validada.md)
- **Origem:** AT-311 (levantamento da AT-309, achado 1)

<a id="rn-658"></a>

### RN-658 — O aceite do handoff Criativo→PO é implícito no "Estou pronto": os MESMOS eventos, com a pessoa como ator e a marca `implicito` {#rn-658}

Decisão do dono (30/09, AT-312): o clique separado de aceitar o PO some. O
handoff Criativo→PO nasce DEPOIS do clique (é o turno que ele dispara que o
oferece, `CriativoServer.executar_confirm_readiness/1`), então o aceite não
cabe no POST do clique: ele acontece na rota interna que CRIA a oferta
(`POST /internal/sessions/:id/handoffs`), logo depois de
`CreateHandoffUseCase`, e passa pelo MESMO `AcceptHandoffUseCase` do card.

Medido antes de mudar, o aceite pelo card grava: a transição da linha para
`accepted`, `handoff.accepted` (ator a pessoa, `{handoffId, toAgent}`),
`agent.activated` (ator a pessoa, `{agent}`) e, pela [RN-635](#rn-635), o
`handoff.superseded` das outras ofertas ao PO no projeto. O aceite implícito
grava exatamente esses, com o MESMO ator humano — quem clicou, lido do
`readiness.confirmed` marcado —, e acrescenta a marca
`implicito: { via: 'readiness.confirmed', readinessEventId }` no payload de
`handoff.accepted` e de `agent.activated`. Nenhum evento é editado, nenhum ator
de sistema entra no lugar da pessoa, e o aceite pelo card segue sem a marca.

Aceita-se só quando TODAS valem (`decidirAceiteImplicitoDoPo`): a oferta é
`criativo` → `po`, `offered`, DESTA sessão, e leva como artefato o
`product_brief` nascido DEPOIS do `readiness.confirmed` marcado mais recente.
Fora disso a oferta fica `offered` e o card aparece como sempre: sessão
anterior ao ADR 0185 (sem marca), brief anterior ao clique, e o handoff
MANUAL, que nunca leva artefato ([RN-633](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-633) — o "Estou pronto" segue
na tela depois dele). A falha do aceite NÃO sobe para o engine (a oferta foi
criada, e o Criativo diria "não consegui oferecer" — falso): vira
`agent.error` durável, ator `system`/`aceite-implicito`, com origem (`infra`
ou `politica`) e `reason: aceite_implicito_falhou`. O 400 de "não está
`offered`" não é falha: alguém decidiu a oferta por outro caminho no intervalo,
e isso já está no log. A tela passa o destinatário do composer ao PO no clique
(o gesto de chamá-lo, [RN-631](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-631)); enquanto ele não entra, a escolha não
vale e o Criativo segue recebendo. Nenhum teto se move: aceitar o PO não
provisiona repositório (só o Arquiteto e o Dev Lead, [RN-582](parte-07.md#rn-582)), não
faz merge nem push.

- **Código:** `src/domain/sessions/estou-pronto.ts:62` (`decidirAceiteImplicitoDoPo`);
  `src/application/use-cases/agents/aceite-implicito-do-po.use-case.ts:37` (`AceiteImplicitoDoPoUseCase`),
  `:45` (`seCouber`);
  `src/interfaces/http/internal/internal-sessions.controller.ts:443` (`handoff`);
  `src/application/use-cases/agents/accept-handoff.use-case.ts:135` (`implicito` no `handoff.accepted`);
  `src/application/use-cases/agents/activate-agent.use-case.ts:80` (`implicito` no `agent.activated`)
- **Teste:** `test/application/use-cases/agents/aceite-implicito-do-po.use-case.spec.ts:105`
  (aceita em nome de quem clicou — caminho feliz), `:129` (falha do aceite
  vira `agent.error` e não sobe — caso de falha), `:120`, `:146`;
  `test/domain/sessions/estou-pronto.spec.ts:58`, `:72`, `:83`, `:94`;
  `test/application/use-cases/agents/accept-handoff.use-case.spec.ts:318`
  (mesmos eventos, ator humano e marca), `:338` (sem marca pelo card)
- **ADR:** [0185](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0185-estou-pronto-fecha-os-dois-gates.md)
- **Origem:** AT-312 (levantamento da AT-309, passo 4)

## O motivo da política em cada cartão de Aprovações (RN-656) {#o-motivo-da-politica-em-cada-cartao-de-aprovacoes-rn-656-1}

<a id="rn-659"></a>

### RN-659 — Projeto novo nasce com promoção de histórias automática; projeto existente fica no modo que tinha {#rn-659}

O default de `projects.story_promotion` passa de `manual` para `auto` (decisão
do dono em 30/09, AT-313): cada história completa do PO nasce `ready`, sem o
clique de promoção por história que o levantamento da AT-309 contou como +N
passos. A validação é a MESMA nos dois modos (RN-048); muda só quem dispara.

A mudança é do DEFAULT da coluna, pela migration `0065`
(`ALTER COLUMN … SET DEFAULT 'auto'`), e nada mais: nenhuma linha é reescrita,
então projeto que nasceu `manual` continua `manual` até alguém trocar em
Configurações. A criação NÃO manda o campo — o valor é o default da coluna,
uma fonte só —, e as duas telas DIZEM o valor: o passo Confirmar da criação
mostra "Promoção de histórias: automática — o PO promove", com onde mudar, e a
seção de Configurações diz que projeto novo nasce em Automática e que mudar ali
vale só para aquele projeto. Os dois scripts de validação que exercitam o fluxo
manual (`validacao-fase-12.ts`, `validacao-real.ts`) passam a pedir `manual`
explícito.

- **Código:** `src/db/schema/iam.ts:296` (`storyPromotion`);
  `src/db/migrations/0065_default_de_promocao_auto.sql`;
  `apps/web/src/routes/NewProjectWizard.tsx:978` (a linha do Confirmar);
  `apps/web/src/routes/settings/PromotionSection.tsx:75` (a nota do default)
- **Teste:** `test/db/story-promotion-migration.spec.ts:29` (projeto
  novo nasce `auto` — caminho feliz), `:40` (projeto existente em `manual` não
  muda — caso de falha); `apps/web/src/routes/NewProjectWizard.test.tsx:254`
  (o Confirmar diz o valor); `apps/web/src/routes/ProjectSettingsTab.test.tsx:625`
  (projeto antigo segue `manual` e a tela diz o default), `:646` (a api recusa
  a troca e a tela diz que não salvou)
- **Origem:** AT-313 (levantamento da AT-309, passo 5); revisa o default da
  [RN-048](parte-01.md#rn-048)

<a id="rn-660"></a>

### RN-660 — O handoff do PO ao Arquiteto é aceito pelo SISTEMA quando o backlog está coberto e o repositório é local e sem credencial {#rn-660}

A oferta `po → arquiteto` que o engine cria (`POST
/internal/sessions/:id/handoffs`) é aceita sem clique, na mesma requisição e
DEPOIS da transação da oferta, quando as quatro condições valem
(`decidirAceiteAutomatico`, puro):

1. a oferta está `offered`;
2. o **backlog está coberto**: o projeto tem ao menos UMA regra de negócio
   (`artifact.business_rule`) e NENHUMA sem história que a cite em
   `businessRuleIds` — a MESMA `computeCoverage` da aba Backlog e da leitura
   do PO (RN-164). Zero regras não é coberto;
3. o repositório é **local e sem credencial**: o projeto não tem repositório (o
   aceite provisiona `local`) ou tem um `local`, e não tem conexão de git
   (OAuth) em `project_git_connections`;
4. quem abriu a sessão ainda tem `developer` no projeto (papel efetivo,
   RN-471) — o mínimo da rota humana de aceite.

Quem aceita continua sendo `AcceptHandoffUseCase`: o repositório nasce ali,
antes de `activateAgent` (RN-582, ADR 0165), em nome de quem abriu a sessão. O
aceite é auditável: `handoff.accepted` e `agent.activated` saem com o ator de
SISTEMA `handoff-auto-accept`, e o `handoff.accepted` leva `automatico: true`,
`emNomeDe` e o `criterio` (`regras`, `cobertas`, `repositorio`). Condição que
falha não grava nada — a oferta fica com o botão de sempre, e a resposta ao
engine diz o motivo (`regras_sem_historia`, `repositorio_nao_local`,
`credencial_de_git_no_projeto`…). Falha DEPOIS de decidir "sim" não sobe: vira
o evento `handoff.auto_accept_failed` (origem `infra`) e o fio o mostra. Com o
aceite feito, a ferramenta `offer_handoff` diz ao PO que o Arquiteto já foi
ativado. Repositório remoto ou com credencial continua pedindo o clique, e o
handoff manual (ADR 0109) também.

- **Código:** `src/domain/sessions/aceite-automatico-do-handoff.ts:81`
  (`decidirAceiteAutomatico`), `:74` (`backlogCoberto`);
  `src/application/use-cases/agents/aceitar-handoff-automaticamente.use-case.ts:45`
  (`AceitarHandoffAutomaticamenteUseCase`);
  `src/application/use-cases/agents/accept-handoff.use-case.ts:91`
  (`AceitePeloSistema`);
  `src/interfaces/http/internal/internal-sessions.controller.ts:443`
  (`handoff`); `apps/engine/lib/engine/harness/tools/offer_handoff.ex:59`;
  `apps/web/src/routes/session-timeline-montagem.tsx:604` (o aviso no fio)
- **Teste:** `test/application/use-cases/agents/aceitar-handoff-automaticamente.use-case.spec.ts:73`
  (backlog coberto e sem repositório: aceita pelo sistema — caminho feliz),
  `:89` (regra sem história: não aceita e não grava nada — caso de falha),
  `:99` (repositório remoto), `:109` (conexão de git), `:128` (falha vira
  `handoff.auto_accept_failed`);
  `test/domain/sessions/aceite-automatico-do-handoff.spec.ts:37`,
  `:49` (cada motivo de recusa);
  `test/application/use-cases/agents/accept-handoff.use-case.spec.ts:323`
  (ator de sistema, critério e provisionamento antes de ativar);
  `apps/web/src/routes/SessionPage.handoff-aceite-automatico.test.tsx:174`,
  `:196`; `apps/engine/test/engine/harness/tools/offer_handoff_test.exs:38`
  (não rodado nesta sessão: sem Elixir no ambiente)
- **Origem:** AT-314, [ADR 0186](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0186-aceite-automatico-do-handoff-ao-arquiteto.md)

## O Infra Lead não anuncia subida que não fez (RN-668) {#o-infra-lead-nao-anuncia-subida-que-nao-fez-rn-668}

<a id="rn-663"></a>

### RN-663 — O merge de PR recusa a PR já mergeada e a proposta repetida; gate pendente é só aviso {#rn-663}

O uso real de 29/09 mediu os dois buracos: a `pr-6` teve TRÊS `git_merge`
`executed`, e a `pr-4` foi mergeada com a tarefa em `awaiting_qa`. A api não
deduplicava `git_merge` por PR (só a tela, e só na mesma lista), e o
`LocalGitProvider` devolvia a PR já mergeada sem erro — o executor gravava um
segundo `executed` para o mesmo merge.

1. **Proposta.** `git_merge` de uma PR que uma execução anterior já mergeou
   (`executed` com `state: 'merged'`) é 409 `pr_ja_mergeado`; com uma proposta
   VIVA da mesma PR (`pending`, `approved` ou `auto_approved`), 409
   `merge_ja_proposto`. Nos dois, nada é criado. Negada ou falha não contam:
   quem negou ou viu falhar pode tentar de novo. A comparação é pelo
   `pullRequestId` do payload, no projeto inteiro (qualquer sessão).
2. **Aprovação.** Aprovar um `git_merge` pendente cuja PR OUTRA proposta já
   mergeou é 409 `pr_ja_mergeado`, antes de qualquer efeito, e a ação continua
   `pending` para quem a vê negar. A irmã apenas VIVA não impede decidir esta.
3. **Provider.** O `LocalGitProvider` recusa mergear PR já mergeada com
   `GitPullRequestAlreadyMergedError`, e o target não se move — alinhado ao
   GitHub, que recusa o merge repetido.
4. **Gate pendente é AVISO, nunca recusa** (decisão do dono, 30/09). A aba PRs
   e o "Mergear" do chat dizem em TEXTO qual gate falta (`qa-verificada` com
   `awaiting_qa` ou gate ainda não aberto, `secops-segura` com
   `awaiting_secops`), e o botão e o card seguem ativos. `awaiting_user`,
   tarefa `done` e PR sem tarefa não avisam. O "gate bloqueado" (tarefa
   `blocked`) continua como era.
5. **Nenhum teto se move.** O merge em branch protegida segue
   `require_approval` incondicional e humano ([RN-418](parte-04.md#rn-418), `decide.ts`):
   esta regra só impede propor ou aprovar o que não há o que mergear.
   Declarado: duas propostas simultâneas da mesma PR não são serializadas (não
   há trava por PR), e é a regra 2 que segura a segunda.

- **Código:** `src/domain/actions/merge-de-pr.ts:56` (`recusaDeMerge`),
  `:40` (`mergeouAPr`);
  `src/application/use-cases/actions/propose-action.use-case.ts:124` (`recusaDeMerge`);
  `src/application/use-cases/actions/approve-action.use-case.ts:327` (`recusaDeMerge`);
  `src/infrastructure/git/local-git-provider.ts:339` (`GitPullRequestAlreadyMergedError`);
  `apps/web/src/lib/gate-do-merge.ts:19` (`gatePendenteNoMerge`);
  `apps/web/src/routes/ProjectPrsTab.tsx:214` (`gatePendenteNoMerge`);
  `apps/web/src/routes/session-timeline-montagem.tsx:1288` (`gatePendenteNoMerge`)
  `apps/web/src/routes/ProjectPrsTab.tsx:214` (`gatePendenteNoMerge`);
  `apps/web/src/routes/session-timeline-montagem.tsx:1288` (`gatePendenteNoMerge`)
- **Teste:** `test/application/use-cases/actions/propose-action.use-case.spec.ts:675`
  (`merge_ja_proposto`), `:698` (`pr_ja_mergeado` — caso de falha), `:696`

  `apps/web/src/routes/session-timeline-montagem.tsx:1288` (`gatePendenteNoMerge`)
- **Teste:** `test/application/use-cases/actions/propose-action.use-case.spec.ts:675`
  (`merge_ja_proposto`), `:698` (`pr_ja_mergeado` — caso de falha), `:696`
  (negada não bloqueia, outra PR não colide — caminho feliz);
  `test/application/use-cases/actions/approve-deny-action.use-case.spec.ts:473`;
  `test/infrastructure/git/local-git-provider.contract.spec.ts:150`;
  `apps/web/src/routes/ProjectPrsTab.test.tsx:266`, `:300`, `:315`;
  `apps/web/src/routes/MergearNoChat.test.tsx:135`, `:148`;
  `apps/web/src/lib/gate-do-merge.test.ts:5`, `:18`
- **Origem:** AT-249 (item A3/extra E3 da análise do uso real de 29/09)

<a id="rn-665"></a>

### RN-665 — O custo real que o provider devolve é o número do metering; o catálogo fica onde ele não vem {#rn-665}

Decisão do dono (30/09): **o custo real vira o número**. Quando a resposta de
uma chamada de LLM diz quanto o provider cobrou — no OpenRouter, `usage.cost`
no frame final do stream —, esse valor é o `token_usage.cost_micros` da linha,
o que o turno devolve ao engine (e o laço soma ao orçamento local), o que
incrementa os budgets de projeto, sessão e área, e o que os relatórios de
gasto somam. Sem ele, o preço congelado do catálogo produz o número, como no
[ADR 0042](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md).

1. **Uma regra, três caminhos.** `RunLlmTurnUseCase`, `StreamLlmTurnUseCase`
   e `SendChatMessageUseCase` passam pela mesma `custoDaChamada`; não há
   segunda régua.
2. **Preço implícito, marcado.** Com custo real, as duas colunas de preço
   gravam `custo ÷ tokens` (o mesmo valor: o provider devolve UM custo) e
   `price_implicit = true` — o que mantém `tokens × preço = custo`
   ([RN-044](parte-01.md#rn-044)) sem fingir um preço de tabela. Sem custo real,
   `price_implicit = false` e as colunas são as do catálogo.
3. **O catálogo ao lado.** `catalog_cost_micros` grava o que o preço de
   catálogo teria cobrado, só nas linhas cujo número é o real (`null` nas
   outras) — é a distância entre estimativa e fatura, por linha.
4. **`estimated` segue falando dos TOKENS** ([RN-041](parte-01.md#rn-041)). A linha
   com custo real tem `estimated = false` porque o custo só chega com o
   `usage` do provider; quem marca o CUSTO como real é `price_implicit`.
5. **O que a resposta disse sobre si é gravado.** `resolved_model_name` (o
   `model` do frame — o alias resolvido) e `generation_id` (o `id`, `gen-…` no
   OpenRouter), por todo provider do dialeto. `model_name` continua sendo o do
   catálogo, a dimensão dos relatórios.
6. **Só quem provou lê o custo.** O hook `extrairCustoReal` existe só no
   OpenRouter; provider sem ele ignora um `usage.cost` presente. Custo que não
   é número finito e não negativo é "não disse" (zero de verdade é custo real),
   e com `is_byok: true` o custo NÃO é lido: é a taxa do hub, e a inferência é
   cobrada por fora — a linha cai no catálogo.

- **Onde:** `src/domain/llm/custo-da-chamada.ts:43` (`custoDaChamada`),
  `src/application/use-cases/llm/run-llm-turn.use-case.ts:288` (`custoDaChamada`),
  `src/application/use-cases/llm/stream-llm-turn.use-case.ts:327` (`custoDaChamada`),
  `src/application/use-cases/llm/send-chat-message.use-case.ts:286` (`custoDaChamada`),
  `src/infrastructure/llm/openai-compatible-provider.ts:410` (`extrairCustoReal`),
  `src/infrastructure/llm/openrouter-provider.ts:272` (`extrairCustoRealOpenRouter`),
  `src/db/schema/llm.ts:375` (`priceImplicit`)
- **Teste:** `test/domain/llm/custo-da-chamada.spec.ts`,
  `test/infrastructure/llm/openrouter-provider.contract.spec.ts` (resposta
  gravada: custo, modelo resolvido, id; BYOK; sem `cost`; provider sem o
  hook), `test/application/use-cases/llm/run-llm-turn.use-case.spec.ts`,
  `test/application/use-cases/llm/stream-llm-turn.use-case.spec.ts`,
  `test/application/use-cases/llm/send-chat-message.use-case.spec.ts`; com
  credencial, o smoke manual `openrouter-provider.smoke.spec.ts`
- **Origem:** [ADR 0188](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0188-o-custo-real-do-provider-vira-o-numero-do-metering.md)
  (AT-270)

<a id="rn-666"></a>

### RN-666 — O metering grava quanto da entrada veio de cache e quanto da saída foi raciocínio {#rn-666}

Cada linha de `token_usage` grava duas PARTES que o provider informa no
`usage` do dialeto OpenAI: `cached_input_tokens`
(`prompt_tokens_details.cached_tokens` — quantos dos `input_tokens` foram
servidos de cache, cobrados a uma fração do preço) e `reasoning_tokens`
(`completion_tokens_details.reasoning_tokens` — quantos dos `output_tokens`
foram raciocínio).

1. **Parte, nunca soma.** `input_tokens`/`output_tokens` continuam sendo os
   totais que o provider disse, e já incluem as partes; nada é somado a eles
   e nenhum custo é recalculado por elas — o número do custo é o da
   [RN-665](#rn-665).
2. **"Não disse" não é zero.** `null` = o provider não informou; 0 = informou
   que não houve. Valor que não é inteiro não negativo é "não disse".
3. **A medição diz quanto foi cache.** `medir-execucao.ts` passa a mostrar,
   por agente, o cache lido e o raciocínio com a porcentagem do total, SÓ sobre
   as chamadas que informaram (e em quantas, quando não foram todas), e
   "não medido" quando nenhuma informou — além de em quantas chamadas o custo
   é o real.
4. **Lido para todo provider do dialeto**, porque os dois campos são da
   própria OpenAI; quem não os manda fica com `null`. O Anthropic informa cache
   no protocolo dele (`cache_read_input_tokens`) e isso NÃO é lido aqui — fica
   `null`, declarado; o Ollama não informa.

- **Onde:** `src/infrastructure/llm/openai-compatible-provider.ts:414` (`cachedInputTokens`),
  `src/infrastructure/llm/openai-compatible-provider.ts:817` (`contagem`),
  `src/application/use-cases/llm/run-llm-turn.use-case.ts:230` (`cachedInputTokens`),
  `src/application/use-cases/llm/record-llm-usage.use-case.ts:121` (`cachedInputTokens`),
  `src/db/schema/llm.ts:395` (`cachedInputTokens`),
  `scripts/medir-execucao.ts:89` (`formatarParteMedida`)
- **Teste:** `test/infrastructure/llm/openrouter-provider.contract.spec.ts`
  (resposta gravada com as duas partes; sem os detalhes; valor inválido e
  zero), `test/application/use-cases/llm/run-llm-turn.use-case.spec.ts`,
  `test/scripts/medir-execucao.spec.ts` (`formatarParteMedida`)
- **Origem:** [ADR 0188](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0188-o-custo-real-do-provider-vira-o-numero-do-metering.md)
  (AT-272)

<a id="rn-669"></a>

### RN-669 — O escopo de caminho compara com a pasta REAL de execução: `/work` e o `/tmp` do container quando ele está de pé {#rn-669}

O teto de escopo do ADR 0055 comparava todo comando com a pasta do projeto no
HOST, inclusive quando o comando roda DENTRO do container (RN-492/RN-502). No
uso real de 29/09, os 37 pedidos "escopo" eram `/work/...` e `/tmp`
comparados com `/home/<usuario>/projetos-brabo/<projeto>` (AT-258).

Com um container `running` REGISTRADO num projeto `container` ou `mounted`, a
raiz do escopo é `/work` — o ponto de montagem, onde moram a pasta e os
`.worktrees` do projeto — mais o `/tmp` do PRÓPRIO container. O `cwd` chega
como caminho de host e é traduzido para `/work` pela mesma regra do engine
(`cwd_para_container/2`): a raiz vira `/work`, o que está sob ela vira
`/work/...`, o que está fora segue como veio e fica fora. Em `mounted` a
tradução é bijetiva. Sem container, a raiz continua a pasta do projeto no host,
e o `/tmp` do host fica FORA.

Vale para quem não está no piloto (a regra específica `terminal`): o piloto não
passa pelo escopo ([RN-603](parte-07.md#rn-603), mantida
pela [RN-670](#rn-670)). `projectScopeRoot` não muda nem se une a
`permissionsFilePath` ([RN-478](parte-05.md#rn-478)); o PISO de auto-aprovação continua só
do modo `container` ([RN-493](parte-05.md#rn-493)). `runner` fica fora, de propósito: a api
não sabe se o runner vai rotear para o container ou para o host (RN-558).
Argumento de comando com caminho de HOST passa a contar como fora quando há
container — o engine traduz só o `cwd`, e dentro do container esse caminho não
existe.

- **Código:** `src/domain/actions/path-scope.ts:153` (`cwdNoContainer`),
  `:174` (`comandoNoEscopoDoContainer`), `:112` (`comandoNoEscopo`, agora com
  várias raízes), `:137` (`PONTO_DE_MONTAGEM_DO_CONTAINER`);
  `src/domain/actions/decide.ts:291` (`execucaoNoContainer`), `:660`
  (`execucaoNoContainer`, em `terminalNoEscopo`);
  `src/application/use-cases/actions/propose-action.use-case.ts:203`
  (`containerExecutionActive`, separado de `execucaoNoContainer`)
- **Teste:** `test/domain/actions/decide.spec.ts:1274` (com container
  `/work`, `.worktrees`, `/tmp` e `..` dentro — caminho feliz; `/etc`, outro
  projeto, `/workspace`, `/tmp/../etc` fora; sem container `/tmp` e `/work`
  fora — casos de falha); `test/domain/actions/path-scope.spec.ts:216`
  (e a cópia de `/work` travada contra `packages/docker-port`);
  `test/application/use-cases/actions/propose-action.use-case.spec.ts:1169`
  (o modo `mounted` com e sem container, e sem o piso)
- **Origem:** AT-258 (item A12 da análise do uso real de 29/09), decisão do
  dono de 01/10, [ADR 0189](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0189-o-piloto-automatico.md)

<a id="rn-670"></a>

### RN-670 — O modo automático é o PILOTO AUTOMÁTICO, e "Sempre permitir" não o desliga {#rn-670}

Decisão do dono de 01/10 ([ADR 0189](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0189-o-piloto-automatico.md)): a
[RN-603](parte-07.md#rn-603) NÃO é revogada. A curinga
`*: auto_approve` aprova TUDO, inclusive o composto sintetizado do
`permissions.json`, caminho fora da pasta, `git commit` e criação de branch
LOCAL. Seguem fora, nunca auto-aprováveis: push/PR/merge/deploy pelo terminal
e `sudo`/`doas` ([RN-418](parte-04.md#rn-418)), merge em branch protegida,
`container_remove`, `instruction_patch` e paralelismo. `deny` explícito vence, e
`ask` escrito no arquivo pede. A garantia de que isso não alcança o código do
Brabo é a contenção do container — uma pasta só, em `/work`, estritamente
abaixo da raiz do broker, sem socket do Docker nem privilégio —, provada em
`apps/broker/src/contencao-do-brabo.spec.ts`; o que a prova NÃO cobre está
declarado no ADR 0189.

**"Sempre permitir" não desliga o piloto (AT-255).** O clique de dev agent
grava `terminal: auto_approve` ([RN-509](parte-06.md#rn-509)), e o repositório devolvia
essa específica ANTES da curinga, com origem `especifica` — `decide()` deixava
de reconhecer o modo automático (97 + 37 pedidos no uso real de 29/09, com o
modo aceso na tela). Agora a específica `auto_approve` sob a curinga
`auto_approve` resolve como a CURINGA. Específica que diz outra coisa
(`require_approval`, `deny`) continua vencendo, e com o toggle de volta em
manual a específica gravada pelo clique volta a valer sozinha, com o escopo. O
clique continua gravando a específica; quem decide se ela já existe é o campo
`especifica` da resolução, nunca o modo resolvido.

**A tela diz o que o piloto libera e o que não libera**, com UMA lista nos três
lugares onde o modo é ligado: o cartão de lote dos Executores
([RN-661](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-661), aberta), o `ApprovalCard` e o toggle do card do agente
(recolhida). O "não libera" é o texto que a RN-661 já tinha, reusado.

- **Código:** `src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts:25`
  (`resolve`), `:67` (`modoEspecifico`, a exceção do piloto);
  `src/application/ports/agent-autonomy-repository.port.ts:5`
  (`AutonomiaResolvida`, com `especifica`);
  `src/application/use-cases/actions/approve-always-action.use-case.ts:263`
  (`especifica`); `src/domain/actions/decide.ts:311`
  (`modoAutomaticoDoAgente`); `apps/web/src/components/OQueOPilotoLibera.tsx:16`
  (`OQueOPilotoLibera`); `apps/web/src/components/ApprovalCard.tsx:434`,
  `apps/web/src/components/AgentCard.tsx:164`,
  `apps/web/src/components/ModoAutomaticoDoTime.tsx:134`
- **Teste:** `test/application/use-cases/actions/approve-always-action.use-case.spec.ts:850`
  (o cenário medido: curinga + "Sempre permitir" segue sem pedido — caminho
  feliz; toggle em manual volta ao escopo — caso de falha);
  `test/infrastructure/persistence/drizzle/agent-autonomy.repository.spec.ts:115`;
  `test/domain/actions/decide.spec.ts:1210` (commit e branch local
  livres; push, merge, PR, deploy e `doas` seguem pedindo);
  `apps/broker/src/contencao-do-brabo.spec.ts:105` (a contenção);
  `apps/web/src/components/ModoAutomaticoDoTime.test.tsx:86`,
  `apps/web/src/components/ApprovalCard.test.tsx:145`,
  `apps/web/src/components/AgentCard.test.tsx:81`
- **Origem:** AT-259 e AT-255 (itens A9 e A13 da análise do uso real de 29/09),
  decisão do dono de 01/10

<a id="rn-671"></a>

### RN-671 — A Infra sobe o container no aceite do handoff: o servidor propõe, e a autonomia semeada aprova {#rn-671}

Decisão do dono em 01/10 ([ADR 0190](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0190-a-infra-sobe-o-container-no-aceite.md)),
revisando o "nunca semeado" da [RN-491](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-491). No uso real de 29/09 a Infra
anunciou a subida "em paralelo" e não a propôs; o container só subiu pela
`/containers` (AT-260).

1. **A semente.** Aceitar o handoff endereçado a `infra` grava, além de
   `open_infra_pr: auto_approve` e `terminal: deny`, a autonomia
   `container_start: auto_approve`. Só ela entre as de container:
   `container_start_via_runner` e `container_stop` seguem nunca semeados, e
   `container_remove` segue no teto absoluto ([RN-495](parte-05.md#rn-495)).
2. **O disparo é do SERVIDOR.** No kickoff do Infra Lead, ANTES da primeira ida
   ao modelo, havendo roteamento vigente (`artifact.module_routing` `roteado`,
   com candidata) e projeto `container`/`mounted`, o servidor propõe
   `container_start` pelo MESMO caminho da tool `propose_container_start`: as
   recusas locais por modo e estado ([RN-566](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-566), [RN-610](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-610)),
   depois `propose_action`, onde a api recusa sem broker ([RN-591](parte-07.md#rn-591)),
   resolve a autonomia e, auto-aprovada, executa a subida, elegendo a imagem
   por `DecidirImagemDoProjetoUseCase` com `decidedBy: 'infra-lead'`
   ([RN-491](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-491)). `runner` não tem passo do servidor: segue pelo
   `container_start_via_runner`, proposto pelo modelo e decidido por humano.
3. **A eleição é determinística.** A candidata do maior número de módulos; no
   empate, a primeira do roteamento. Rede `none`, recursos padrão, e um
   `rationale` que diz que foi o servidor. *(Revisado pela [RN-683](parte-09.md#rn-683):
   os recursos vão omitidos e a api sobe com o mínimo derivado do
   `module_map`, não com o padrão.)*
4. **O rastro diz quem chamou.** `tool.call` (com `origem: "servidor"`) e
   `tool.result` duráveis, e nenhuma mensagem de ferramenta no histórico do
   modelo; o kickoff diz em texto o que JÁ aconteceu (status devolvido, ou o
   motivo da recusa).
5. **O fecho da [RN-668](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-668) segue verdadeiro.** A subida do servidor marca
   o turno como a da tool: proposta, o fecho não fala; recusada, ele diz que foi
   recusada. Proposta NEGADA pela política (status `denied`, como uma sessão
   aberta por quem não é `maintainer`) conta como recusa, nas duas origens.

Nenhum teto se move: o papel mínimo segue `maintainer` (o efetivo de quem abriu
a sessão), `deny` de `permissions.json` segue vencendo, e a `/containers` não
muda (ela propõe como humano, e a autonomia de agente não vale para ela).
Declarado: o toggle manual/auto do card escreve a curinga, e a regra específica
vence — pôr a Infra em "manual" não desliga esta semente.

- **Código:** `src/application/use-cases/agents/accept-handoff.use-case.ts:38`
  (`INFRA_AUTONOMY_SEEDS`);
  `apps/engine/lib/engine/infra/infra_lead_server.ex:259` (`handle_cast`),
  `:710` (`propor_container_start`), `:791` (`subir_no_aceite`), `:794`
  (`eleger_candidata`), `:1435` (`passo_da_subida`)

  `:626` (`propor_container_start`), `:707` (`subir_no_aceite`), `:759`
  (`eleger_candidata`), `:1319` (`passo_da_subida`)
- **Teste:** `test/application/use-cases/agents/accept-handoff.use-case.spec.ts:250`
  (a semente, e só ela — caminho feliz), `:267` (outro agente não semeia —
  caso de falha);
  `apps/engine/test/engine/infra/infra_lead_server_test.exs:1263` (o servidor
  elege e propõe antes do modelo — caminho feliz), `:1458` (`mounted`), `:1468`
  (`runner` não sobe pelo servidor), `:1377` (sem roteamento), `:1387` (a api
  recusa sem broker — caso de falha), `:1427` (container já `running`), `:1439`
  (negada pela política), `:1580` (`eleger_candidata/1`)
- **Origem:** AT-260 (item A14 da análise do uso real de 29/09)

<a id="rn-672"></a>

### RN-672 — O handoff ao Dev Lead sai da Infra, e só com o container do projeto `running` {#rn-672}

Decisão do dono em 01/10 ([ADR 0190](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0190-a-infra-sobe-o-container-no-aceite.md),
AT-262). Até aqui "Confirmar arquitetura pronta" oferecia DOIS handoffs — à
Infra e ao Dev Lead (FASE 14d, `handoff-duplo` em `packages/contracts/fluxo.yml`) —, e o Dev
Lead podia ser aceito antes de existir o container em que os dev agents
trabalham ([RN-502](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-502)). No uso real de 29/09 os dois nasceram da mesma
confirmação (sessão `be70`, seq 252/254).

1. **A confirmação de arquitetura oferece só à Infra.** `OfferInfraHandoffUseCase`
   tem um destino (`infra`); o `offerDevHandoff` da porta do engine, a rota
   `POST /internal/sessions/:id/agent/offer-dev-handoff` e o
   `:offer_dev_handoff`/`handoff_dev_pendente` do Arquiteto deixaram de
   existir. `ja_oferecido` passa a significar "a Infra já tinha oferta ou estava
   ativa".
2. **Quem oferece o Dev Lead é o servidor do Infra Lead**, por
   `create_handoff_if_absent/5` (`infra → dev-lead`, ADR 0182): oferta pendente
   em qualquer sessão do projeto volta como está, e Dev Lead já ativo (409
   `agente_ja_ativo`) não é falha. Não é ferramenta: o modelo não decide quando
   o Dev Lead entra.
3. **Só com o container REGISTRADO `running`** (a leitura local de
   `ProjectContainerLifecycle`). A pergunta é feita em dois momentos: no fim de
   todo turno da Infra (`concluir`) — o caso comum, porque a subida do servidor
   no aceite ([RN-671](#rn-671)) executa dentro do kickoff — e quando o
   `container.running` do outbox chega fora de um turno (aprovação posterior,
   `/containers`, `container_start_via_runner`): o `Engine.Outbox.Drain`
   passa a enfileirar também o `Engine.Workers.InfraOfereceDevLeadWorker`, que
   avisa por PubSub o Infra Lead do projeto.
4. **Falha que não é "já atendido" é `agent.error` durável** com origem
   ([RN-116](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-116)), sem derrubar o turno; o fim do
   próximo turno da Infra tenta de novo.

Fica como estava: a segunda porta do repositório no aceite ao Dev Lead
([RN-582](parte-07.md#rn-582)) — o aceite é o mesmo, só mudou quem oferece — e a
ativação de execução encadeada no aceite (RN-161). Declarado: o aviso do
outbox é at-most-once, como o `Engine.Dev.Wake`; sem Infra Lead de pé naquele
instante, a oferta espera o fim do próximo turno dele.

- **Código:** `src/application/use-cases/agents/offer-infra-handoff.use-case.ts:15`
  (`ALVOS_DA_CONFIRMACAO`);
  `apps/engine/lib/engine/infra/infra_lead_server.ex:1169` (`oferecer_ao_dev_lead`),
  `:1164` (`concluir`), `:368` (`handle_info`), `:1075`

  `:1057` (`concluir`), `:345` (`handle_info`), `:1074`
  (`topico_do_container`);
  `apps/engine/lib/engine/workers/infra_oferece_dev_lead_worker.ex:29` (`perform`);
  `apps/engine/lib/engine/outbox/drain.ex:107` (`handlers_for`)
- **Teste:** `apps/engine/test/engine/infra/infra_lead_server_test.exs:1490`
  (container `running` no fim do turno: oferece — caminho feliz), `:1504`
  (sem `running`: não oferece — caso de falha), `:1515` (o aviso fora de
  turno), `:1532` (o aviso com turno em curso), `:1544` (409 não é falha; 500
  vira `agent.error`);
  `apps/engine/test/engine/agents/arquiteto_server_test.exs:256` (o Arquiteto
  não oferece mais ao Dev Lead);
  `apps/engine/test/engine/workers/infra_oferece_dev_lead_worker_test.exs:9`;
  `apps/engine/test/engine/outbox/drain_test.exs:266`;
  `test/application/use-cases/agents/offer-infra-handoff.use-case.spec.ts:104`,
  `:147`
- **Origem:** AT-262 (item A16 da análise do uso real de 29/09)

---

<a id="rn-675"></a>

### RN-675 — "Sempre permitir" grava VERBO + SUBCOMANDO, um padrão por segmento do comando {#rn-675}

Decisão do dono de 01/10 (AT-257, que fecha a AT-170 — o ponto 6 do ADR 0055,
a unidade da generalização; [ADR 0189](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0189-o-piloto-automatico.md)). Até
aqui o clique gravava o comando INTEIRO, byte a byte (`Terminal(<comando>)`):
o próximo comando quase nunca era igual — 173 cliques no uso real de 29/09 —, e
o composto virava UM padrão cujo conteúdo só casava o PRIMEIRO segmento, então
`cd src && npm test` liberava só `cd src`.

Agora cada SEGMENTO do comando (o mesmo corte de `decide()`: `&&`, `||`, `;`,
`|`, `&`) vira um padrão, e a unidade é:

- o verbo sozinho (`ls`) → o verbo;
- verbo + palavra (`npm test`, `git status`, `mix test`, `npx vitest`) → os
  dois. "Palavra" é letra no começo, sem `/`, `.`, `=`, glob nem flag; um
  argumento que parece palavra (`cd src`) fica como subcomando — o lado
  ESTREITO da dúvida, porque distinguir os dois exigiria uma lista de verbos,
  que é o espaço que os achados Z/AD dizem não convergir;
- verbo + argumento que não é palavra (`cat src/x.ts`, `cd ../lib`) → o verbo;
- verbo + FLAG (`ls -la src`, `git -C /x status`) → o segmento EXATO: a forma
  com flag é onde verbo e invocação divergem, e generalizar ali seria escolher
  uma forma de dentro do código;
- unidade que é PREFIXO de um teto da [RN-418](parte-04.md#rn-418) (`git remote`,
  `gh pr`) → o segmento EXATO; e se até o exato é prefixo (`git` sozinho),
  nenhum padrão para aquele segmento.

O casamento continua o de sempre (prefixo de tokens), o clique sobre comando
com efeito externo ou privilegiado continua recusado inteiro antes
(`motivoDeRecusaDoSempreAprovar`, 400 `teto_do_sempre_permitir`), o teto de
`decide()` roda depois do arquivo, e o escopo de caminho segue limitando ONDE
fora do piloto ([RN-669](#rn-669)). Quem pode gravar é quem já podia (o papel
do endpoint, inalterado); a precedência com o modo automático é a da
[RN-670](#rn-670). O "Sempre permitir" de dev agent de módulo continua indo
para `agent_autonomy` ([RN-509](parte-06.md#rn-509)), sem padrão. Só os padrões que
FALTAM são gravados e narrados; o `permission.granted` leva `patterns` (a lista
gravada) e `pattern` (a mesma lista unida por vírgula, para a timeline).

- **Código:** `src/domain/actions/pattern-for-action.ts:22`
  (`patternsForAction`), `:62` (`unidadeDoSegmento`), `:43` (`SUBCOMANDO`);
  `src/domain/actions/external-effect.ts:297` (`padraoAlcancaTeto`);
  `src/application/use-cases/actions/approve-always-action.use-case.ts:277`
  (`faltam`), `:315` (`patternsForAction`)
- **Teste:** `test/domain/actions/pattern-for-action.spec.ts:18`
  (a unidade, caminho feliz), `:103` (segmento que é prefixo de teto não grava
  nada — caso de falha); `test/domain/actions/external-effect.spec.ts:11`
  (`padraoAlcancaTeto`);
  `test/application/use-cases/actions/approve-always-action.use-case.spec.ts:936`
  (o clique num composto libera o próximo com os mesmos verbos; outro
  subcomando continua pedindo; composto que empurra segue recusado);
  `apps/web/src/components/ApprovalCard.test.tsx:253` (a nota diz a unidade)
- **Origem:** AT-257 (item A11 da análise do uso real de 29/09) e AT-170
  (EP-025), decisão do dono de 01/10
