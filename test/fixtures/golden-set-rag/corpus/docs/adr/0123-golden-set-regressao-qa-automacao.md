# ADR 0123 — Golden-set de casos de regressão para o julgamento semântico do agente de QA Automação

- **Status:** aceito
- **Data:** 2026-08-30
- **Referencia (sem editar):** [ADR 0020](0020-destravar-gates-qa-secops.md)
  (o achado que este fecha — o próprio critério de aceite dele documenta o
  passo semântico do gate de QA como não determinístico com modelo local, e
  nomeia a direção de correção que este ADR constrói: "apontar para um
  modelo de API em vez de torcer").

## Contexto

O ADR 0020 fechou o critério de aceite dos gates de PR, mas com uma ressalva
escrita na própria seção de título: **FECHADO, mas NÃO DETERMINÍSTICO**.
Contra o `qwen2.5-coder:7b` local, o critério — o QA casar uma regra de
negócio com um teste, duas vezes no mesmo PR — só fechou na 10ª de 11
execuções. A 11ª, rodada logo depois sem mudança de código, não fechou: o
modelo encerrou o laço sem chamar `emit_qa_verdict`. O ADR 0020 nomeia isso
explicitamente como o passo semântico sendo "o papel que pior cabe num modelo
pequeno" e declara a direção de correção sem construí-la: "apontar
`DEMO_QA_MODEL` para um modelo de API".

Essa direção nunca virou mecanismo — ficou documentada, não construída.
Uma revisão de código externa do trabalho desta sessão classificou 15
achados por prioridade; 14 de 15 fecharam ao longo da sessão. O 15º e último
foi este, proposto sem custo de construção associado: "um golden-set (5-10
casos, saída esperada frouxa, modelo fixo, falha permitida para começar)
transformaria 'a demo depende do julgamento de um 7B' num sinal de
tendência".

Três fatos, confirmados lendo o código e não supostos, moldaram o que dava
para construir hoje:

1. **O julgamento pode ser invocado isolado, sem a máquina de estados
   inteira.** `Engine.Gates.QaAutomacaoAgent.run/5` já é chamado assim em
   `qa_automacao_agent_test.exs` — sem `QaLeadServer`, sem `GateState`, sem
   PR, sem repositório git, sem backlog. A única coisa que separa esse teste
   existente de um golden-set real é trocar o cliente de LLM falso pelo real.
2. **O cliente real exige a api de fato rodando e alcançável.**
   `Engine.Sessions.EngineApiClient.Live.llm_turn/5` lê
   `Application.fetch_env!(:engine, :api_url)`, preenchido só por
   `config/runtime.exs` (via `API_URL`) — nunca por `config/test.exs`. Isto
   não é um teste unitário no sentido usual: é, na prática, "rodar contra a
   stack de dev", a mesma postura que `demo-pr-gates.ts` já tem.
3. **CI não é possível hoje — confirmado, não suposto.** Zero menção a
   `ollama` em `.github/workflows/`; o serviço do compose fica atrás de
   `profiles: ["local-llm"]`, nunca iniciado por `docker/smoke.sh`. Zero
   segredo de LLM no repositório. E a própria cultura do CI recusa falha
   permitida silenciosa: `pr-police.yml` é o único lugar do repo que usa
   `continue-on-error`, e mesmo ali o erro é relançado num passo final. Não
   há hoje checagem que possa ficar vermelha sem consequência. Ligar isto ao
   CI exige um segredo de LLM de API ou infraestrutura nova (um runner com
   GPU, um passo de pull do Ollama) — decisão de um humano, não algo a
   construir escolhendo.

## Decisão

**Onde mora.** `apps/engine/test/engine/gates/qa_automacao_agent_golden_test.exs`,
`use Engine.DataCase`, reaproveitando a mesma construção de
`dev_state`/`dev_context` de `qa_automacao_agent_test.exs`. É ExUnit, não uma
task Mix nova: não há hoje `Mix.Task` própria em lugar nenhum de
`apps/engine/lib`, e um teste isolado já é a forma natural deste código para
esta classe de coisa — ao contrário do lado da api, onde `demo-pr-gates.ts`
é um script porque lá não existe equivalente de "chamar a função direto".

**Uma tag de exclusão permanente, nunca detecção de disponibilidade.** O
padrão do `test_helper.exs` para gitleaks/hadolint/yamllint/actionlint inclui
automaticamente um teste marcado quando o binário é encontrado na máquina —
certo para uma ferramenta gratuita e determinística, e errado aqui. Esta
máquina de desenvolvimento já tem o Ollama rodando continuamente; a inclusão
automática por alcançabilidade faria o golden-set disparar dentro de
*qualquer* `mix test`, gastando tokens sem aviso e introduzindo instabilidade
real numa suíte que hoje é 100% determinística.

```elixir
ExUnit.start(exclude: [:golden_set_qa | binary_exclusions])
```

Só `mix test --only golden_set_qa` o roda, mais um alias `mix golden_set.qa`
para ser encontrável — a mesma disciplina que `demo-pr-gates.ts` já declara
no próprio comentário de cabeçalho: "NOT deterministic ... run deliberately,
not in CI." O `setup_all` pula (pelo retorno `{:skip, reason}` do ExUnit no
corpo do teste, não por uma falha lançada) quando a api não é alcançável em
`API_URL` — um pré-requisito de ambiente, não defeito de código.

**Semeadura por um script TS externo, chamado por `System.cmd`.** O engine
não tem como criar as linhas reais (projeto, sessão, binding de modelo) sem
duplicar regra de negócio que mora nos próprios casos de uso da api — e não
há, de todo modo, caminho Ecto cru que alcance o banco certo. Este é o custo
de encanamento que este ADR declara às claras em vez de esconder:
`apps/api/scripts/seed-golden-set-qa.ts` é um **`System.cmd` entre
linguagens**, novo neste repositório (zero precedente de um teste Elixir
chamando `pnpm`/`ts-node` pelo shell).

Um segundo motivo, nada óbvio, para ter de ser deste jeito: o teste golden
usa `Engine.DataCase`, cujo sandbox aponta para o banco isolado `engine_test`
(a mesma convenção que `qa_automacao_agent_test.exs` já usa). O script de
semeadura roda dentro do *próprio processo da api*, escrevendo no banco real
de dev (`DATABASE_URL`) que os servidores *rodando* da api e do engine de
fato usam. São dois bancos diferentes — nada que o `Engine.Repo` leia no
teste golden veria linhas que o script escreveu, nem o contrário. Por
consequência, `Engine.Actions.Workspace`/`Engine.Dev.WorktreeManager` (que
leem `project_repositories` via `Engine.Repo`) não conseguem materializar o
worktree dos casos deste teste: **o script de semeadura faz o próprio
checkout git** (um `git clone` simples do repo bare que ele acabou de
provisionar) e devolve o caminho do worktree pronto na saída JSON. O teste
golden só consome esse JSON — nunca consulta o Postgres para achar nada.

O script de semeadura:

- Cria um usuário + um workspace, e um projeto por caso (um repo git local
  provisionado é 1:1 com um projeto — `ProjectRepository.remoto_de_trabalho/1`
  faz a busca de uma linha só por `project_id`).
- Resolve **ou cria** a linha de `models` para `GOLDEN_SET_QA_MODEL`
  (default `qwen2.5-coder:latest`) — ao contrário das demos mais antigas, que
  lançam erro se o modelo já não estiver no catálogo fixo da semeadura
  (`MODEL_SEEDS` do `seed.ts`). O golden-set mira modelos locais arbitrários
  do Ollama por desenho, e prendê-lo a um catálogo fixo significaria editar o
  `seed.ts` toda vez que alguém quisesse medir um novo.
- Ativa o modelo para o workspace (`SetModelsActiveUseCase`) — um passo que
  os scripts de demo mais antigos pulam, e cuja falta faz hoje
  `SetModelBindingUseCase` lançar `ModelNotBindableError('inativo')`
  (ausência em `workspace_models` quer dizer "desligado", RN-043/ADR 0049).
  Isso parece deriva nas demos antigas, não algo que este ADR deva corrigir
  lá em silêncio — elas estão fora do escopo.
- Faz o binding do modelo em `chaveDeAgente(project.id, 'qa-automacao')` —
  **`'qa-automacao'`, nunca `'qa'`**: desde a Fase 8b o subagente que de
  fato roda é `qa-automacao`/`qa-performance-seguranca`; o binding em `'qa'`
  não tem efeito (a cascata cai no binding do projeto). Copiado de
  `demo-pr-gates-area-qa.ts:281`, não do `demo-pr-gates.ts` mais antigo, que
  ainda usa a chave velha.
- Chama `SeedAgentAreasUseCase.execute(project.id)` — sem isso,
  `agent_areas` fica vazia para um projeto criado por insert cru (em vez de
  por `CreateProjectUseCase`), e o **primeiro** turno de LLM que o agente de
  QA faz falha com 404 de `RecordLlmUsageUseCase`
  (`AgentAreaRepository.incrementSpent` exige que a linha exista — o metering
  é obrigatório, RN-036, nunca melhor esforço). Achado empiricamente: a
  primeira execução real deste harness devolveu `blocked(infra)` nos seis
  casos antes de esta chamada ser acrescentada.
- Provisiona o repo, commita o esqueleto do caso e então materializa o
  worktree **dentro de `projectScopeRoot(project)`** (`git clone`, *antes* de
  escrever o `permissions.json` — clonar exige diretório de destino vazio).
  Essa ordem e esse lugar sustentam a coisa, não são acidentais: o teto de
  escopo de caminho do ADR 0055 em `decide()` recusa auto-aprovar *qualquer*
  ação `terminal` cujo `cwd` caia fora da raiz de escopo do próprio projeto,
  por melhor que o comando case com um padrão `allow`. Uma primeira versão
  deste script clonava num diretório de rascunho separado sob `os.tmpdir()` —
  todo caso voltava `awaiting_approval` para sempre, porque o `npm test`
  nunca passava pela checagem de escopo. Achado empiricamente, do mesmo jeito
  que a lacuna de `agent_areas` acima.
- Acrescenta `DEV_TERMINAL_ALLOW_PATTERNS` ao `permissions.json` do projeto
  (o mesmo mecanismo que `ActivateExecutionUseCase` já usa) — sem isso, o
  default de `decide()` é `require_approval` para toda chamada `terminal`, e
  `emit_qa_verdict` nunca consegue ver no histórico um `terminal` com saída 0.
- Cria e ativa uma sessão por caso (`CreateSessionUseCase` +
  `TransitionSessionUseCase`).
- Imprime um objeto JSON no stdout — `{"model": "...", "cases": [{"id",
  "projectId", "sessionId", "worktreePath", "story", "task",
  "expectedVerdict"}, ...]}`.

Sem limpeza — a mesma postura de `demo-pr-gates.ts` (um sufixo de timestamp,
nunca apagado).

**Os seis casos**, cada um sondando uma tabela de julgamento diferente que
um LLM avaliador pode de fato errar — não seis variações do mesmo teste:

1. `rf-covered` — RF_1 de `demo-pr-gates.ts`, literal (coberta) →
   `approved`. Controle positivo, já provado de ponta a ponta.
2. `rf-uncovered` — RF_2 de `demo-pr-gates.ts`, literal (explicitamente sem
   cobertura) → `changes_requested`. Controle negativo, já provado.
3. `rf-single-clean` — RF_1 de `demo-pr-gates-area-qa.ts` (regra única,
   coberta, aprovação limpa) → `approved`.
4. `rf-mismatched-filename` — uma regra sobre `enviar()`, coberta por um
   teste que mora em `test/outro-modulo.test.js` (não `enviar.test.js`) →
   `approved`. Sonda se o QA lê o *conteúdo* do teste, não só a convenção de
   nome de arquivo.
5. `rf-partial-coverage` — uma regra que nomeia um caminho feliz e um caso
   de falha explícito (`cancelar(pedido)` marca o status, e lança erro quando
   já entregue); só o caminho feliz tem teste → `changes_requested`. Sonda se
   o QA carimba cobertura parcial como completa.
6. `rf-skipped-test` — o único teste que "cobre" a regra é `test.skip(...)`
   → `changes_requested`. Sonda se o QA conta um teste desligado como
   cobertura.

Os dois quase-acertos que o ADR 0020 já documenta (alucinação de chamada de
ferramenta, o QA tentando consertar o código sob revisão) ficam de fora de
propósito — já são regressão determinística e barata em
`apps/engine/test/engine/harness/tool_call_recovery_test.exs:79`, sem modelo
real envolvido. Acrescentá-los aqui duplicaria essa cobertura e diluiria o
que este harness de fato mede: julgamento regra-vs-teste, não mau
comportamento geral do QA.

**Um piso, não um gate binário.** A mesma filosofia de catraca do
`verificarPiso` de `scripts/ci/coverage-floor.ts` (`>=`, nunca `>`; o
arquivo só é editado por um humano; o script nunca o reescreve) — casando
exatamente com o que "saída esperada frouxa, falha permitida para começar"
já pedia. `apps/engine/test/fixtures/golden_set_qa/floor.json` é chaveado por
**modelo** (trocar de modelo muda legitimamente o piso alcançável) e guarda
uma contagem mais um total (`{"passRate": N, "of": 6}`, não uma
porcentagem) — para que um golden-set que depois cresça além de seis casos
não tenha uma entrada antiga lida errado em silêncio. Sem entrada para o
modelo em uso → o teste **falha**, informando a contagem observada de
acertos e pedindo a um humano que acrescente a entrada — nunca escrita
automaticamente, a mesma regra inegociável que `coverage-floor.ts` já
estabeleceu.

**Um teste, não seis.** Os seis casos rodam dentro de um único bloco `test`
(marcado `@moduletag :golden_set_qa`), não em seis separados. O `mix test`
não garante ordem entre testes de um módulo; dividir em seis arriscaria uma
asserção de piso ler um subconjunto incompleto se um suposto "sétimo teste,
agregador" rodasse antes de os outros terminarem de semear o contexto. Rodar
os seis e agregar no fim é também o que deixa um humano ler os seis
desfechos juntos para depurar, impressos no stdout.

**O `ownership_timeout` teve de ficar configurável em `Engine.DataCase`.**
Achado empiricamente rodando contra o `gpt-oss:20b`: um turno real de LLM
contra um modelo grande carregando pela primeira vez pode passar minutos sem
tocar o Postgres. O `ownership_timeout` default de 60s do
`Ecto.Adapters.SQL.Sandbox` recuperou no meio da chamada a conexão que o
teste golden tinha emprestado; a consulta *seguinte* pelo `Engine.Repo` — os
arquivos de instrução, dentro de `ToolLoop.Default.init/1`, por onde todo
agente de gate passa, personalize ele as instruções de agente ou não —
morreu com "owner process exited", relatando uma característica de
velocidade do modelo como falha de infraestrutura.
`Engine.DataCase.setup_sandbox/1` agora lê um `tags[:ownership_timeout]`
opcional (nil preserva o default de 60s existente para todo outro teste da
suíte); o teste golden se marca com `ownership_timeout: :infinity`.

## Consequências

**A ligação ao CI é um `TODO(humano)` declarado, não construído.** Ela exige
um segredo de LLM de API ou infraestrutura nova (um runner com GPU, um passo
de pull de modelo do Ollama) — não é uma escolha que esta sessão possa fazer;
precisa de decisão humana e, no caso da infra, de orçamento. Registrado na
seção "Pendências com dono humano" do `CLAUDE.md`, o mesmo lugar onde esta
classe de bloqueio já mora.

**Taxas de acerto reais medidas (2026-08-30, processos nativos no host — api
via `pnpm --filter api start:dev`, engine via `mix phx.server`, os dois
apontados para um Postgres local e para o Ollama da própria máquina em
`localhost:11434`, sem Docker Compose nesta execução em particular):**

| modelo | execuções (acertos/6) |
|---|---|
| `qwen2.5-coder:latest` | 1, 3, 2, 4, 5 |
| `gpt-oss:20b` | 5, 4 |

O `qwen2.5-coder:latest` é marcadamente instável — o modo de falha dominante
entre as execuções foi o modelo chamar a ferramenta `terminal` com um
**argumento `command` vazio**, que `decide()` corretamente se recusa a
auto-aprovar (nenhum padrão casa com string vazia), deixando o caso preso em
`awaiting_approval` para sempre. É exatamente a classe de instabilidade de
chamada de ferramenta que o ADR 0020 já achou nesta família de modelos —
reproduzida aqui como *tendência medida* em vez de anedota isolada.

O `gpt-oss:20b` é marcadamente mais confiável (4-5/6 em duas execuções, ~4x
mais lento por caso). O único erro recorrente dele foi `rf-partial-coverage`
— carimbar como `approved` uma regra com um caso de falha sem teste —, que é
exatamente a lacuna de julgamento que esse caso existe para expor, não
defeito de fixture.

Diante disso, **o `gpt-oss:20b` é o default recomendado daqui em diante para
qualquer fluxo que dependa de o passo semântico do gate de QA ser
confiável** — a mesma conclusão que o ADR 0020 previu sem poder medir.
`GOLDEN_SET_QA_MODEL`/o default do script de semeadura continua
`qwen2.5-coder:latest` por ora (mudar um default de demo/harness é decisão
separada de registrar o que foi medido); as duas entradas do arquivo de piso
deixam os tetos reais dos dois modelos visíveis lado a lado para quem tomar
essa decisão.

O piso registrado (`floor.json`) fica de propósito abaixo da melhor execução
observada de cada modelo — uma catraca, não uma aspiração:
`qwen2.5-coder:latest` em 1/6, `gpt-oss:20b` em 4/6.

**Mecanismo provado, mas o encanamento do script de semeadura agora é
superfície nova que sustenta a coisa.** Duas lacunas do lado da api que as
próprias execuções empíricas deste ADR acharam — `agent_areas` não semeada
para projeto criado por insert cru, e o worktree precisar morar dentro de
`projectScopeRoot` para o teto de escopo de caminho de `decide()` chegar a
auto-aprovar alguma coisa — não são defeitos dos gates nem de `decide()`; são
exatamente o tipo de lacuna "a demo esqueceu um passo de que o
`ActivateExecutionUseCase` normalmente cuida" que o próprio ADR 0020 achou
repetidas vezes. Registradas aqui em vez de escondidas, do mesmo jeito que o
ADR 0020 registrou suas nove execuções falhas antes de a décima fechar.
