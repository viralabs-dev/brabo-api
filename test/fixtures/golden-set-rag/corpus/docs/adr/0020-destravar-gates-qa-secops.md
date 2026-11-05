# ADR 0020 — Destravar os gates de QA e SecOps: gitleaks na árvore, pareceres validados e tool call em texto

- Status: aceito — critério de aceite FECHADO, mas não determinístico com
  modelo local (ver a seção própria)
- Data: 2026-07-25
- Fase: 4a (fechamento dos desvios dos gates de PR)

## Contexto

Os gates de PR (ADR 0013) estavam completos no papel — máquina de estados com
ordem imutável e teto de correções, QAAgent com `emit_qa_verdict` enforçado,
SecOpsAgent determinístico, `DevAgentServer.correct/3` na mesma branch, UI com
a linha do tempo — mas **nunca tinham rodado o critério de aceite**. Não existia
demo dos gates: o `demo-dev-agent-real` para na PR aberta.

Mesmo movimento do ADR 0019 para o DevAgent: escrever o demo do aceite, rodar
com LLM e scanners reais, e corrigir o que quebrar. A auditoria por leitura achou
quatro defeitos antes da primeira execução, um deles fatal; as dez execuções
seguintes acharam mais seis, além de cinco problemas de ambiente de inferência.

Critério de aceite: numa task com (a) uma regra sem teste e (b) um segredo
hardcoded, o QA devolve a primeira, o dev corrige, o SecOps barra o segundo, o
dev corrige, e a PR chega a `awaiting_user` com os 4 pareceres na linha do tempo.
**Fechou** — a sequência real está adiante.

O que mais chama atenção nesta sessão: das dez execuções, NENHUMA falhou por
defeito na máquina de estados, no enforcement dos gates ou no fluxo de
devolução. Falharam por scanner varrendo a coisa errada, por artefato não
validado, por diagnóstico que chutava a causa, por contexto truncado em silêncio,
por GPU ociosa e por instrução de plantio que não expirava.

## Decisões

### 1. gitleaks varria o HISTÓRICO, não a árvore de trabalho (o achado fatal)

`Engine.Actions.GitleaksDetector.Live` rodava `gitleaks detect --source
<worktree>`. Em gitleaks 8.x, `detect` varre o **log de commits**.

Consequência no fluxo do gate, comprovada no container antes de qualquer
correção: o dev commita o segredo → SecOps reprova → o dev remove o segredo num
commit NOVO → o segredo continua no commit anterior da branch → SecOps reprova
de novo, a cada volta, até estourar o teto e a task virar `blocked`. **Nenhuma
correção de segredo era possível: o critério de aceite era inalcançável.**

```
árvore de trabalho já limpa, segredo só no commit anterior:
  gitleaks detect --source  -> 2 commits scanned, leaks found: 1   (reprova pra sempre)
  gitleaks dir              -> no leaks found                      (aprova, correto)
```

Corrigido para `gitleaks dir <worktree>`. Duas consequências registradas:

- O pin `GITLEAKS_VERSION` no `docker/engine/Dockerfile` passa a ser
  **load-bearing**: `dir` só existe a partir do 8.19. Binário mais antigo
  devolve exit fora de `[0, 1]`, o que já cai no `{:error, :scan_failed}` e o
  gate registra "pulado" — degrada, não quebra.
- Passa a varrer a árvore INTEIRA do worktree (superset do diff). Um segredo
  pré-existente na branch base reprova toda PR. É o comportamento correto pra um
  gate, mas é mais amplo do que o "sobre o diff" que o ADR 0013 prometia — a
  correlação linha-a-linha diff↔achado continua fora de escopo.
- `gitleaks dir` reporta caminho ABSOLUTO (o `detect` reportava relativo); o
  detector agora relativiza, porque o caminho vai pro parecer que o usuário lê e
  pro prompt de correção do dev.

### 2. Pareceres não eram artefatos validados

O enunciado pede "registra parecer como **artefato**", mas os dois gates
gravavam `session_event` `artifact.qa_verdict`/`artifact.secops_verdict` CRU,
sem passar por `Engine.Harness.ArtifactSchemas` — mesmo desvio que o ADR 0019
corrigiu para `task_blocked`.

- Os dois tipos entram no `@schemas`, **fora** do `@tool_emittable`: são
  server-emitted (o SecOps nem tem LLM; o parecer do QA nasce da tool
  `emit_qa_verdict`, enforçada à parte).
- O **sujeito** do parecer não é chave obrigatória fixa: o gate de dev usa
  `taskId` e o `InfraGateRunner` usa `prActionId`, no MESMO tipo de artefato.
  `check_extra/2` exige exatamente um dos dois — nunca os dois, nunca nenhum.
  A UI já tratava os dois estruturalmente (`GateSubject`).
- `veredito` é validado contra os valores da máquina de estados da api: um
  veredito fora de `approved`/`changes_requested` faria o
  `RecordGateVerdictUseCase` estourar, então é melhor recusar o artefato.
- `Engine.Harness.ArtifactEmitter` (novo) concentra "valida e só então grava +
  transmite". `AgentIo.emit_artifact/3` passa a delegar; os três emissores
  server-side (dev, gates de dev, gate de infra) usam o mesmo caminho.

### 3. Scanner podia pendurar o gate

`run_scanner/3` — duplicado byte a byte entre `SecOpsAgentServer` e
`InfraGateRunner` — chamava `System.cmd` **síncrono dentro do `handle_cast`**,
sem timeout. Um `semgrep --config auto` travado na rede congelaria o gate do
projeto inteiro, sem diagnóstico.

`Engine.Gates.Scanner` (novo) unifica os dois e aplica o idioma do
`Engine.Actions.TerminalExecutor.execute/3`: `Task.async` + `Task.yield` +
`Task.shutdown(:brutal_kill)`, teto em `SECOPS_SCAN_TIMEOUT_MS` (default 180s,
bem mais folgado que o terminal porque o semgrep varre a árvore e busca regras
na rede). Timeout reusa o caminho de "pulado" que já existia.

**O teste do timeout achou uma regressão que a própria correção introduziu:**
`Task.async` LINKA a task ao chamador, então um detector que levantasse exceção
derrubaria o GenServer do gate — pior do que a chamada síncrona original. A
chamada ao detector é contida em `try/rescue/catch` DENTRO da task, virando
valor de retorno.

O semgrep também ganhou `--metrics=off` e excludes de `node_modules`/`.git`.
`--config auto` continua dependendo de rede; sem ela o gate registra "pulado" —
o aceite depende só do gitleaks.

### 4. QA sem teto de tokens, e queimando volta do teto de correções

- `QaAgentServer` não passava `token_budget_micros` pro ToolLoop (o DevAgent
  passa). O gate roda de novo a CADA correção, então o custo se multiplica sem
  teto nenhum. Agora usa o mesmo `task_budget_micros` do dev, que já estava
  sendo lido do banco pelo mesmo caminho do `max_gate_corrections`.
- Um QA que não chegava a um parecer (limite de iterações, orçamento, modelo
  parado) virava `changes_requested`. Isso **devolvia pro dev — que não tinha o
  que corrigir — e queimava uma das K correções**; com azar repetido, um QA
  quebrado bloqueava uma task perfeita e o parecer registrado culpava o dev.
  Agora bloqueia a task direto, com o motivo verdadeiro e sem gastar correção,
  distinguindo os três desfechos (e usando `ctx.last_error` pra separar "o
  modelo parou" de "o provider falhou", como o ADR 0019 fez pro dev).

### 5. Modelo local emite tool call como TEXTO (o achado da execução)

Na primeira execução do aceite, o `qwen2.5-coder:7b` produziu **exatamente o
trabalho certo** — os dois `write_file` e o `terminal` corretos, com o segredo
plantado e o teste faltando — mas emitiu tudo como um bloco ```json no
`content`, em vez de usar o protocolo nativo de tool calling. O `ToolLoop` via
`toolCalls` vazio, encerrava com `{:ok, ctx}`, e a task morria em "parou sem
concluir nem reportar bloqueio". O gate nunca chegava a abrir.

`Engine.Harness.ToolCallRecovery` (novo) é consultado **só quando `toolCalls`
veio vazio** — modelo que faz tool call de verdade nunca passa por ali. Extrai
objetos JSON de nível superior do texto (varredura contando chaves, ciente de
strings e escapes: o modelo emite vários objetos concatenados no MESMO bloco, o
que não é um documento JSON válido).

O filtro do que conta como tool call foi **apertado durante a própria execução**:
a primeira versão aceitava qualquer objeto com `name` + `arguments`, e um QA
real emitiu `{"name": "enviar(payload)", "parameters": {...}}` — alucinando uma
chamada à função de NEGÓCIO que estava revisando. Agora o `name` precisa estar
no registro de ferramentas do loop (`ctx.tool_specs`). Com o nome ancorado,
`parameters` pôde ser aceito como sinônimo de `arguments` sem abrir a porta pra
JSON arbitrário. Não é um parser de linguagem natural: se o modelo só conversou,
o resultado é `[]` e o loop encerra como antes.

### 6. Erro de provider NO CORPO da resposta virava "o modelo parou"

O ADR 0019 fez o `ToolLoop` guardar `ctx.last_error` quando `llm_turn` devolve
`{:error, _}`. Mas a api responde **200 com `error` no corpo** quando o provider
falha — só transporte quebrado vira `{:error, _}`. Nesse caminho `last_error`
ficava `nil` e quem consumia o `{:ok, ctx}` diagnosticava "o modelo parou sem
sinalizar" pra uma falha de infraestrutura.

Achado da pior forma possível: o gate de QA morreu com `fetch failed` no Ollama e
o diagnóstico registrado no event log disse "o modelo parou sem chamar
`emit_qa_verdict`" — o sistema culpou o modelo por uma queda de provider. `loop/1`
agora registra o `error` do corpo também.

### 7. Prompt do QA como protocolo explícito

O `initial_message` do QA era um parágrafo solto, enquanto o DevAgent tem o
AGENTS.md do repositório guiando cada passo. Virou um roteiro numerado: as
regras da story listadas uma a uma, qual ferramenta usar em cada passo, uma
linha de `coverageMatrix` por regra, o critério de `approved` explicitado, e
a instrução de nunca chamar as funções do código sob revisão.

### 8. `fetch` sem timeout configurável no provider Ollama

`ollama-provider.ts` usava `fetch`, cujo `headersTimeout` no undici é 300s
FIXO — só configurável passando um `dispatcher` próprio, o que exigiria a
dependência `undici`. Na prática o `LLM_TURN_TIMEOUT_MS` do engine não valia
nada: a api desistia antes, com um opaco `fetch failed`, e o agente registrava
"o modelo parou" pra uma requisição que nunca foi respondida.

Trocado por `node:http` (sem dependência nova), com `OLLAMA_REQUEST_TIMEOUT_MS`
(default 300000, sem mudança de comportamento). A semântica melhorou junto: é
teto de INATIVIDADE de socket, não de duração total — um turno legítimo pode
levar minutos processando prompt, mas nunca fica quieto por muito tempo. O
provider não tinha teste nenhum; ganhou um com um Ollama falso de verdade
(`node:http`), cobrindo stream NDJSON com linha partida entre chunks, servidor
mudo, status 500 e conexão recusada.

Precisa ser `>=` o `LLM_TURN_TIMEOUT_MS` do engine, senão quem desiste primeiro
é a api e o teto do engine continua decorativo.

### 9. Parecer de gate prevalece sobre o enunciado da task

A task original segue no contexto durante a correção (é ela que define o que
implementar), e o `correction_message` dava ao parecer o mesmo peso. Quando o
gate contradiz o enunciado — o caso clássico é o SecOps mandando tirar um
segredo que a task pediu — o agente obedecia à task e repunha o problema.
O prompt agora diz explicitamente que o parecer PREVALECE.

Honestamente: **não foi o que fechou o aceite** (ver a seção do critério). É a
coisa certa a dizer e continua valendo, mas quem resolveu foi tirar a instrução
contraditória de lá.

### 10. `--metrics=off` quebrou o semgrep por inteiro

Regressão introduzida pela decisão 3: `--config auto` EXIGE telemetria ligada
("Cannot create auto config when metrics are off"), então todo scan passou a
sair com erro e o gate registrava "semgrep falhou, pulado" — degradando
graciosamente, como projetado, e por isso mesmo passando despercebido em quatro
execuções seguidas do aceite.

Trocado por ruleset NOMEADO (`p/security-audit`), que roda com métricas
desligadas. Mandar o perfil do código do usuário pro semgrep.dev pra poder
rodar um gate de segurança não é uma troca aceitável. As regras ainda vêm do
registry pela rede na primeira execução; sem rede o gate segue registrando
"pulado".

## Estado do critério de aceite: FECHADO, mas NÃO DETERMINÍSTICO

Fechou na 10ª execução, com `qwen2.5-coder:7b` local, exatamente na sequência
do enunciado (`pnpm --filter api demo:pr-gates`, exit 0):

```
dev    → PR aberta
qa     → changes_requested: regras da story sem teste
dev    → corrige (MESMA branch, sem PR nova)
qa     → approved                        → awaiting_secops
secops → changes_requested: [gitleaks] src/credenciais.js:2 — GitHub PAT
dev    → corrige (MESMA branch)
secops → approved                        → awaiting_user
```

**A 11ª execução, imediatamente depois, NÃO fechou** — o QA acusou a regra sem
teste corretamente, o dev corrigiu, e na segunda passada o QA encerrou o loop
sem chamar `emit_qa_verdict`. Nada a ver com as correções: é variância do
modelo. Com `qwen2.5-coder:7b` local o passo SEMÂNTICO do aceite (cruzar regra
de negócio com teste, duas vezes seguidas na mesma PR) não é confiável.

O que isso significa e o que não significa:

- **A máquina de gates está verificada.** A sequência completa foi produzida
  por agentes reais contra scanners reais: ordem imutável, devolução na mesma
  branch, teto de correções, pareceres como artefato, `awaiting_user` terminal.
  Isso não regride entre execuções — o que varia é o julgamento do modelo.
- **O demo não serve como teste de regressão automatizado** enquanto depender
  de um 7B local. Serve como critério de aceite executável, a ser rodado
  deliberadamente. Para torná-lo confiável, aponte `DEMO_QA_MODEL` pra um
  modelo de API: o gate semântico é o papel que menos cabe num modelo pequeno,
  e o binding por agente (escopo `agent`, vence `project`) existe exatamente
  pra isso.

As nove execuções anteriores à que fechou não falharam por defeito de gate uma
única vez — falharam por ambiente de inferência e por um erro de desenho do
próprio demo. Vale registrar porque nenhum deles estava em código de domínio:

### Ambiente de inferência (tudo exposto agora no `docker-compose.yml`)

| variável | o que estava errado |
|---|---|
| GPU | o serviço `ollama` não tinha device reservado: a RTX 4060 ficava OCIOSA enquanto um modelo de 5,9GB rodava 100% em CPU. O prompt de ~7.000 tokens do QA levava ~50s só de ingestão. Virou o override opt-in `docker-compose.gpu.yml` (`pnpm dev:gpu`), fora do compose principal porque sem o `nvidia-container-toolkit` no host a reserva FAZ o serviço falhar ao subir. Na GPU: `100% GPU`, 5,5GB em VRAM |
| `OLLAMA_CONTEXT_LENGTH` | default de 4096 truncando EM SILÊNCIO um prompt montado pra 128k — o agente perdia as próprias instruções e passava a imitar o schema das ferramentas, que é o que sobrava no fim do contexto |
| `OLLAMA_MAX_LOADED_MODELS` | com `OLLAMA_KEEP_ALIVE` alto os modelos ACUMULAM: 15,2GB de pesos residentes numa máquina de 15GB, e o agente respondendo vazio por falta de memória |
| `OLLAMA_REQUEST_TIMEOUT_MS` | ver decisão 8 |
| `START_OUTBOX_DRAIN` / `START_ANAMNESE` | Psicólogo e Anamnese consomem turnos de LLM em paralelo com os agentes de execução e derrubavam a conexão do dev no meio do ciclo. **Atenção: os guards só impedem NOVOS enfileiramentos** — chegou a haver 20 `AnamneseWorker` em `executing` acumulados de execuções anteriores, que rodam no boot seguinte independentemente do guard. Fila precisa ser purgada, não só o guard desligado |

### Erro de desenho do demo: instrução de plantio que não expira

O segredo era plantado mandando o dev escrever `const TOKEN = "ghp_..."` na
DESCRIÇÃO DA TASK. Mas a descrição fica fixada no contexto a CADA volta de
correção: depois do SecOps reprovar, o dev regenerava o arquivo copiando o
literal do próprio enunciado — quatro vezes seguidas, até esgotar o teto. Os
`write_file` no event log mostram o token reaparecendo intacto a cada volta.

Nenhum texto de prompt vence um trecho de código literal na task (a decisão 9
tentou, e não bastou). O plantio foi movido pro ESQUELETO do repositório
(`src/credenciais.js`, commitado na branch base): o dev nunca recebe ordem de
escrever o segredo, e corrigir pra `process.env` não contradiz nada. Isso só
funciona porque o SecOps varre a árvore de trabalho e não só o diff — a
consequência aceita da decisão 1, que aqui virou requisito.

## Consequências

- Testes: `gitleaks_detector_test` roda o BINÁRIO real (tag `:gitleaks`,
  excluída automaticamente quando ele não existe) e fixa a regressão do item 1;
  `scanner_test` cobre limpo/achado/ausente/pendurado/explodindo;
  `artifact_schemas_test` cobre os dois sujeitos e o veredito inválido;
  `tool_call_recovery_test` usa o texto REAL que travou o demo, e o nome que
  NÃO é ferramenta; `tool_loop_test` cobre o erro no corpo da resposta;
  `qa_agent_server_test` cobre o bloqueio sem queimar correção. Engine 227.
- `apps/api/scripts/demo-pr-gates.ts` (`pnpm --filter api demo:pr-gates`) é o
  critério de aceite executável: sai com código != 0 quando não fecha, e imprime
  a linha do tempo dos pareceres pra diagnóstico.

## Escopo & assunções

Os defeitos plantados vêm da **descrição da task**, não da sorte do modelo: ela
manda implementar as duas regras da story mas testar só a primeira, e declarar o
token literal no código. É artificial de propósito — o que está sob teste é o
gate, não a diligência do dev. O segredo é um PAT do GitHub sintético porque as
regras default do gitleaks pegam `ghp_` por formato + entropia, sem a allowlist
de valores-exemplo que atrapalha chaves da AWS (`AKIA...EXAMPLE`).

O passo semântico do aceite (o QA cruzar RF com teste) depende do julgamento do
modelo; `DEMO_MODEL` e `DEMO_QA_MODEL` permitem trocá-lo por agente.
`awaiting_user` continua terminal: o merge é sempre manual do usuário.

Duas lições que valem além destes gates:

- **O ambiente de inferência é parte do sistema, não pano de fundo.** Três dos
  problemas desta sessão não estavam em nenhuma linha de Elixir ou TypeScript:
  estavam no tamanho de contexto, na residência de modelo e na concorrência
  entre agentes. Todos se manifestavam como o agente "parando sozinho" — o
  sintoma que o código atribuía ao modelo.
- **Diagnóstico que chuta é pior que diagnóstico ausente.** Duas vezes nesta
  sessão o sistema culpou o modelo por falha de infraestrutura (item 6), e a
  correção do gate de QA (item 4) existe porque o gate culpava o DEV por falha
  do próprio QA. Todo desfecho de agente deveria carregar de ONDE veio a falha,
  não só que houve uma.
