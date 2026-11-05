---
sidebar_position: 7
---

# Os gates, e como eles são medidos

Um **gate** é um ponto do fluxo em que o trabalho para até que alguém —
pessoa, agente ou script — diga que ele pode seguir. O produto tem
treze, e até a FASE 15a nenhum deles existia como lista: estavam
espalhados por regras puras, casos de uso, testes e workflows de CI.
Responder "quais gates existem" exigia ler seis arquivos.

`apps/api/config/gates.yml` é essa lista. Este documento explica o que ela é e —
mais importante — o que ela **não** é.

## O registro descreve; ele não executa {#the-registry-describes-it-doesnt-execute}

Nenhum gate passa a ser cobrado por causa do arquivo. Mudar
`severidade` nele não muda comportamento nenhum: quem bloqueia um merge
continua sendo o `decide.ts`, quem julga uma PR continua sendo o agente
de QA, quem reprova um backmerge continua sendo o workflow de CI.

É a suposição mais fácil de errar, então vale repetir: **o registro é
um índice, não política.** A política de branches continua morando em
[branching-policy.md](branching-policy.md); os campos `entrada` e
`entregavel` são uma frase em português, e `onde` aponta para o código
que governa de verdade.

O que o registro compra é outra coisa: tornar os gates
**enumeráveis**. A lição das Fases 10 e 13 — métrica extraída por
script, nunca anotada à mão — não se aplica ao que não se consegue
listar.

## Os dois campos que envelhecem se ficarem indefinidos {#the-two-fields-that-age-if-left-undefined}

**`verificacao`** responde *como se prova que este gate passou*, não
quem o julga. `script` quer dizer que há um artefato mecânico — um
evento, um teste, um job — que serve de prova. É por isso que
`qa-verificada` é `script` mesmo com um LLM emitindo o veredito: o
artefato é o `pr.gate_changed` com `veredito`. Quem julga mora em
`dono`.

**`aprovacao_humana: true`** quer dizer que a decisão é do usuário —
diretamente, por um clique, **ou** delegada por uma política que o
próprio usuário escreveu. É isso que deixa `acao-aprovada` conviver com
`status: auto_approved`: a política decidindo sozinha é o usuário tendo
decidido antes. `merge-protegida` é o caso em que nem a delegação
existe, porque o teto rebaixa `auto_approve` para `require_approval`
mesmo com a autonomia ligada.

Nos quatro gates que a constituição declara manuais, esse campo é
invariante e travado por teste
([RN-071](../business-rules/custo.md#rn-071)).

## Três formas de evidência, porque nem toda prova mora no log {#three-forms-of-evidence-because-not-every-proof-lives-in-the-log}

| tipo | quando | o que o localizador traz |
|---|---|---|
| `event_log` | o desfecho vira evento de domínio | tipos de evento + filtro de payload |
| `teste` | a garantia é uma asserção | caminho do spec |
| `ci` | o gate mora no repositório | workflow + spec |

Os dois casos que obrigaram o campo a existir:

- **`merge-protegida`** não emite evento próprio. É um teto aplicado
  por último sobre o veredito já calculado, que rebaixa `auto_approve`
  para `require_approval`; o desfecho aparece como um
  `proposed_action.created` pendente, indistinguível de qualquer outra
  pendência. O que garante o bloqueio é o teste.
- **`backmerge`** mora fora da aplicação: é um check obrigatório, com
  estado versionado em `.release/gate.json` na `main`.

Sem `evidencia`, a regra "gate `block` sem prova reprova" deixaria as
duas travas mais duras do produto vermelhas para sempre.

## Duas validações, e só uma delas roda em produção {#two-validations-and-only-one-of-them-runs-in-production}

O registro é validado em duas camadas, e a divisão não é cosmética:

| camada | o que afirma | quem a roda |
|---|---|---|
| `validarRegistro` | afirmações sobre o **conteúdo** — `block` exige `script`, os quatro gates humanos continuam humanos, `active` exige evidência, nenhum id duplicado, nenhuma `entrada` órfã | quem lê o registro, inclusive a api em runtime |
| `validarLocalizadores` | o **arquivo-alvo** de `teste`/`ci` **existe** | o teste contra o arquivo real e a fase 2 do `validacao-gates.ts` — nunca a api |

A primeira vale onde quer que o registro seja lido. A segunda é uma
afirmação sobre o **repositório**, e só faz sentido dentro de um
checkout.

As duas já foram uma função só, e o loader da api a chamava. A
consequência foi medida na v6.1.0 instalada: `GET /gates` respondia
`500` com `RegistroDeGatesInvalido` listando os onze alvos como "não
existe" — doze respostas 5xx em cerca de 55 minutos. Não havia nada de
errado com o registro. A imagem de produção leva `/app/apps/api/config/gates.yml`
e nada mais de `docs/`; `apps/api/test/`, `scripts/ci/` e `.github/`
nunca entram nela, então uma afirmação sobre o repositório avaliada
contra essa árvore reprova todo gate, em toda instalação.

Nada foi afrouxado. A regra continua existindo, continua cobrindo os
mesmos alvos, e um alvo que some continua reprovando — ela só roda onde
a pergunta tem sentido. Duas guardas mantêm isso: o teste que sobe até
a raiz do repositório e confere todo localizador, e um teste do loader
que reconstrói em disco a árvore da imagem (uma raiz com
`apps/api/config/gates.yml` e nada mais) e afirma que o registro carrega. Devolver
a checagem ao loader deixa o segundo vermelho com a mensagem exata que
a instalação produziu.

E a api servindo o registro agora é exercitada contra a imagem de
produção: `docker/smoke.sh` chama `GET /gates` e `GET /internal/gates`
(service token) e exige o registro de volta nas duas. A checagem do
corpo é uma função de shell, `checar_registro_de_gates`, que
`scripts/ci/smoke-gates.spec.ts` roda contra os três corpos sem subir a
stack. Nenhuma suíte de unidade poderia ter pego a falha original —
vitest e ExUnit rodam de um checkout, onde os alvos existem.

## A armadilha do tipo compartilhado {#the-shared-type-trap}

`qa-verificada` e `secops-segura` **não são dois tipos de evento**: os
dois gravam `pr.gate_changed`, discriminados por `payload.gate`. Pior —
o mesmo tipo é gravado quando o gate **abre**, sem `veredito`.

Um registro que guardasse só o nome do tipo contaria abertura como
passagem e mediria o dobro do que de fato aconteceu. Daí o filtro, e
daí a sentinela `veredito: presente`. O mesmo vale para os dois gates
de PR de infra, que compartilham `infra.gate_changed`.

O teste afirma que **nenhum par** (`event_types` + `filtro`) se repete
no registro. É essa unicidade que faz a medição significar alguma
coisa.

O filtro só alcança o **payload**, de propósito: aceitar uma coluna
arbitrária no YAML abriria a consulta inteira. Quem promoveu uma
história — uma pessoa ou o PO — mora na coluna `actor_kind` e fica fora
do vocabulário declarativo.

## Medindo {#measuring}

```bash
pnpm --filter api validacao:gates                    # full report
pnpm --filter api validacao:gates -- --sem-banco     # registry and locators only
pnpm --filter api validacao:gates -- --projeto <uuid>
```

Três fases, nesta ordem: **registro** (carrega e valida),
**localizadores** (o alvo de `teste`/`ci` existe?) e **event log**
(última passagem, com o id do evento). As duas primeiras nunca tocam o
banco — é isso que torna o script útil em CI sem Postgres.

A fase 2 relata **todo** localizador do registro, não só os dos gates
`active`+`block`. Ela já teve um laço próprio, mais estreito, enquanto
o loader da api tinha um mais largo, e `rag-acertivo` — `active`,
`warn`, citando um workflow e um teste — nunca aparecia na tabela.
Agora é uma regra só, `validarLocalizadores`, compartilhada com o
teste.

| código de saída | quando |
|---|---|
| `0` | registro válido e localizadores no lugar |
| `1` | invariante violado, alvo ausente, ou gate sem passagem **quando `--projeto` foi passado** |
| `2` | uso inválido |

A assimetria é deliberada. Registro e localizadores são afirmações
sobre o **repositório**: valem sempre. A evidência do event log é uma
afirmação sobre uma **execução**, e só existe se uma aconteceu — sem
`--projeto`, a fase 3 é só um relatório. Exigir passagem num banco
recém-criado faria o script sair `1` sempre, e script que sempre
reprova vira ruído que ninguém lê.

## O que enumerar já pagou {#what-enumerating-already-paid-off}

Antes de medir qualquer coisa, escrever a lista achou duas coisas que
ninguém estava vendo:

- o julgamento de QA e SecOps sobre PRs de **infra**, que tem caminho
  próprio (`infra.gate_changed`, sem tarefa de backlog por trás) e não
  estava na spec;
- `promotion-check` era um check obrigatório **sem spec próprio**, ao
  contrário de `pr-police` e `approval-ladder`. A evidência apontava
  para o script, com a lacuna escrita ali mesmo, e o item foi para a
  triagem — a fase declara e mede, não corrige. **A triagem o fechou:**
  `scripts/ci/promotion-check.spec.ts` existe, e a evidência do gate
  agora aponta para ele. É o ciclo funcionando como foi desenhado —
  enumerar achou, a triagem priorizou, outra fase corrigiu.

O terceiro achado veio da primeira execução do medidor: o filtro de
`story-promovida` apontava para `actor_kind`, que é **coluna** e não
payload, e o gate aparecia como "nunca passou" num banco onde tinha
passado horas antes. Registro que ninguém roda é registro que mente.

## Ativar um gate `planned` é o mesmo trabalho que qualquer outro {#activating-a-planned-gate-is-the-same-work-as-any-other}

`implementavel` (dono `dev-lead`) nasceu `planned` na FASE 14d, junto
com o resto do organograma-alvo que `apps/api/config/gates.yml`/`packages/contracts/fluxo.yml`
já descreviam sem código por trás. O
[ADR 0090](../adr/0090-qa-estrategia-e-appsec-segundo-momento.md) o
ativou — e o exercício vale como exemplo porque **nada na forma do
registro mudou**: `status: planned → active` mais o bloco `evidencia`
(apontando para `proposed_action.created` filtrado por `actionType:
assess_implementability`) são as ÚNICAS duas linhas que um gate `warn`
precisa ganhar para deixar de ser aspiração. `severidade` continua
`warn` — o comentário no arquivo já dizia "nasce warn mesmo quando
ativado", e ativar não é a mesma decisão que promover a `block` (isso
exigiria medir passagens reais antes, a mesma disciplina da FASE 15a).

O trabalho de verdade fica fora do arquivo: o Dev Lead precisou de uma
ferramenta nova (`assess_implementability`) que propõe a avaliação como
`proposed_action`, e QA-estratégia — até então um papel `proposto` em
`packages/contracts/fluxo.yml`, com o critério de separação já escrito ali ("pode ser
o próprio qa-lead num segundo momento") — precisou existir para
alimentar a avaliação com um plano de teste real. O registro só passou
a descrever o que o código agora faz.

Essa entrada não sobreviveu ao uso real.
O [ADR 0192](../adr/0192-plano-de-teste-depois-da-entrega.md)
([RN-674](../business-rules.md#rn-674)) moveu o plano de teste para
DEPOIS da entrega do dev — escrito ANTES do dev, ele não tinha código
para ler e esgotava as iterações — e a `entrada` do gate mudou de
`plano-de-teste` para `module_map`: o Dev Lead julga a história e o
mapa de módulos que ele já tem. O plano agora alimenta `qa-verificada`,
como entrada do único veredito que aquele gate já dá. A mesma lição no
outro sentido: a linha do registro mudou porque mudou QUEM ENTREGA O
QUÊ A QUEM, não para fazer um gate passar.

## Um registro pode envelhecer na direção errada — desatualizado, não inativo {#a-registry-can-age-in-the-wrong-direction--stale-not-inactive}

`implementavel` é o exemplo de gate que precisou de código novo para
sair de `planned`. `paralelismo-autorizado` é o oposto: o mecanismo
(`RequestParallelizationUseCase`,
[RN-083](../business-rules/custo.md#rn-083)) está em produção desde a
FASE 14d — foi o registro que ficou para trás, declarando `planned`
sobre algo que já era `active` no irmão `packages/contracts/fluxo.yml` e no código. A
auditoria fluxo.yml × código (achado A1/B5,
[auditoria-fluxo-vs-codigo.md](auditoria-fluxo-vs-codigo.md)) achou a
divergência; a correção foram só as mesmas duas linhas que
`implementavel` também ganhou — `status: active` mais `evidencia`
apontando para `proposed_action.created` filtrado por `actionType:
parallelize`.

Vale notar por que isso não mudou nada na trilha de PR do painel do
time: `paralelismo-autorizado` é `fluxo: execucao`, e a tela só deriva
etapas de gates `fluxo: pr` (ver "Consumo" abaixo) — um gate pode virar
`active` no registro sem aparecer em lugar nenhum da interface, se o
fluxo dele for outro.

## Um gate pode nascer `active` direto — quando o mecanismo e o registro chegam juntos {#a-gate-can-be-born-active-directly--when-the-mechanism-and-the-registry-arrive-together}

`implementavel` e `paralelismo-autorizado` são os dois exemplos de gate
que já existia (declarado `planned` ou desatualizado) e ganhou a
entrada no registro DEPOIS. `necessidade-validada`
([RN-406](../business-rules.md#rn-406),
[ADR 0095](../adr/0095-gate-necessidade-validada.md)) é o terceiro
padrão: mecanismo e registro nasceram na MESMA mudança, porque o
próprio gate não existia em lugar nenhum — nem `planned` no arquivo,
nem código por trás.

A escolha de `severidade: warn` segue o mesmo raciocínio de
`implementavel`, mas por outro motivo. `implementavel` é `warn` porque
promover a `block` exigiria medir passagens reais antes (FASE 15a).
`necessidade-validada` é `warn` porque NADA no produto hoje confere a
passagem dele antes de deixar o PO continuar — o handoff Criativo→PO já
acontece dentro de `confirm_readiness`, antes mesmo de este gate
existir. `block` prometeria uma trava que não existe; `warn` descreve
exatamente o que o gate é: uma medição de que um humano validou o
mérito da necessidade, não um gate que bloqueia o passo seguinte.

`workspace-verificado` ([RN-423](../business-rules.md#rn-423),
[ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md))
é o quarto exemplo, e o mais claro dos quatro sobre por que `warn` não
é uma "trava fraca": o que trava de verdade AQUI não é o gate, é a
recusa explícita em
`Engine.Actions.TerminalExecutor.decisao_de_execucao/1` — sem workspace
verificado ou runner conectado, o comando é recusado
incondicionalmente, no fundo do código, sem passar pelo registro. O
gate existe só para dar EVIDÊNCIA de quando a confirmação aconteceu
(`project.workspace_verified` no event log); promovê-lo a `block`
descreveria uma trava que já existe em outro lugar, do mesmo jeito que
`necessidade-validada` teria mentido sobre uma que não existe em lugar
nenhum.

`rag-acertivo` ([RN-490](../business-rules.md#rn-490)/[RN-498](../business-rules.md#rn-498),
[ADR 0132](../adr/0132-golden-set-de-acerto-do-rag.md)/[ADR 0138](../adr/0138-golden-set-do-rag-em-ci-agendado.md))
é o quinto exemplo, e o motivo de ele continuar `warn` mudou de forma
uma vez, o que vale contar inteiro. Ele nasceu `warn` pelo motivo mais
simples dos cinco: não havia CI que rodasse um LLM real — o golden-set
que ele mede (17 perguntas compostas a partir de RNs/ADRs reais,
conferidas contra um corpus real curado pelo `HybridSearchUseCase` de
verdade) só rodava à mão (`mix golden_set.rag`), a mesma postura que o
golden-set de QA Automation
([ADR 0123](../adr/0123-golden-set-regressao-qa-automacao.md)) ainda
tem hoje. Isso deixou de ser verdade: `.github/workflows/golden-set-rag.yml`
agora roda `mix golden_set.rag` de verdade, contra um serviço Ollama
real — ele só chama o modelo de **embedding**, em CPU, determinístico,
nunca um modelo de chat fazendo julgamento. (A afirmação de que o
golden-set de QA *não* era tratável do mesmo jeito foi medida depois, e
o relógio não se mostrou o obstáculo — ver a próxima seção.) O que
impediu `severidade: warn` de ficar desatualizada não foi o gate
continuar manual — foi o workflow ser **agendado** (cron noturno mais
`workflow_dispatch`), nunca disparado por `pull_request`. `block`
ainda prometeria uma checagem que segura um merge, e uma execução
agendada não segura nada: uma regressão fica visível em até um dia,
nunca na hora da PR. O motivo passou de "nenhum CI consegue rodar isso"
para "este CI não está no caminho do merge" — `warn` continua
descrevendo exatamente o que é verdade, só que não a mesma verdade de
antes.

## O golden-set de QA em CI: o relógio cabe, o instrumento mede, e roda toda semana {#the-qa-golden-set-in-ci-the-clock-fits-the-instrument-measures-and-it-runs-weekly}

O golden-set do julgamento semântico do agente de QA Automation
([ADR 0123](../adr/0123-golden-set-regressao-qa-automacao.md)) é o que
daria à etapa semântica de `qa-verificada` um sinal de tendência. O ADR
0123 e o [ADR 0138](../adr/0138-golden-set-do-rag-em-ci-agendado.md)
afirmavam, sem medir, que rodá-lo em CI exigia um segredo de LLM de API
ou infraestrutura nova (um runner com GPU). Em 2026-09-13 (AT-067) isso
foi medido, no molde exato do `golden-set-rag.yml`: `ubuntu-latest`,
sem GPU, as mesmas imagens de serviço `pgvector` e `ollama` pinadas,
`qwen2.5-coder:latest` baixado no Ollama do próprio job (com o
`OLLAMA_KEEP_ALIVE=1h`/`OLLAMA_CONTEXT_LENGTH=16384` do compose de dev),
a api **e o engine** de pé como servidores — o engine é a mais em
relação ao job do RAG, porque é o engine, chamado pela api via
`POST /internal/actions/execute`, que roda o `npm test` que o QA pede.

| execução | pull do modelo | preparação até a task do mix | `mix golden_set.qa` | job inteiro | placar |
|---|---|---|---|---|---|
| [34769447405](https://github.com/daneiel/brabo/actions/runs/34769447405) | 15 s | ~3 min | 19 min 15 s | 22 min 09 s | 0/6 |
| [34770869429](https://github.com/daneiel/brabo/actions/runs/34770869429) | 13 s | ~3 min | 22 min 53 s | 25 min 45 s | 0/6 |

Um turno de chat do modelo 7B na CPU desse runner levou mediana de
~20 s (10–34 s nos 23 turnos que o log da api guardou). **O relógio
cabe**: um job noturno ou semanal de menos de meia hora, sem segredo,
sem GPU. A metade "infraestrutura nova" da frase antiga é refutada pela
medição.

**O que não cabe é o instrumento.** As duas execuções fizeram 0/6,
abaixo do piso gravado de 1/6 — e não por causa do julgamento do
modelo. O event log da segunda execução mostra o porquê: todo
`npm test` que o QA propôs foi auto-aprovado (`permissions.json allow:
npm test`) e depois **recusado pelo engine**, porque desde a
[RN-502](../business-rules.md#rn-502)
([ADR 0143](../adr/0143-agentes-de-dev-so-depois-do-container.md),
2026-09-04) um projeto `container` sem container `running` não roda
comando de terminal em lugar nenhum. O script de seed é de 2026-08-30 e
nunca registra container. Então nenhum caso consegue ver `exit 0`, e
`emit_qa_verdict` recusa `approved` sem ele — três dos seis vereditos
esperados ficaram impossíveis. A mensagem de recusa diz "suba o
container do projeto (a Infra propõe `container_start`)", e o modelo
fez o que leu: em três casos pediu ao terminal `container_start` ou
`docker-compose up` (ficou `pending`, logo `awaiting_approval`), e em
um repetiu `npm test` sessenta vezes até `toolloop.limit_reached`
(`blocked(modelo)`). Os dois restantes travaram na primeira chamada com
`command` vazio — a falta de confiabilidade que o ADR 0123 já registrava
para esse modelo, independente da RN-502. Nada aqui é específico de CI:
a mesma recusa vale para uma execução local.

É por isso que nenhum `golden-set-qa.yml` foi commitado. Um workflow
agendado que fica vermelho em toda execução por um motivo alheio ao que
ele mede é pior que nenhum — vermelho de fundo ensina as pessoas a
ignorar o vermelho. O desenho que foi medido fica no histórico do
repositório (o workflow como estava no commit `e7d7d1b16`, incluindo um
passo de diagnóstico temporário). Fazê-lo medir de novo significava
decidir como o golden-set roda a suíte sob a RN-502, e essa era uma
decisão para um humano. Afrouxar a recusa para o harness passar nunca
foi uma das opções: enfraqueceria o isolamento para o qual a RN-502
existe, para fazer um teste passar.

### A decisão, e a segunda medição (AT-076) {#the-decision-and-the-second-measurement-at-076}

Em 2026-09-27 o mantenedor escolheu o primeiro caminho: **o seed sobe
um container real pelo broker e o registra `running`, pelo caminho de
produção.** A RN-502 fica intacta; o que mudou é que o seed agora
satisfaz a pré-condição dela. Para cada caso, depois de clonar o
esqueleto na pasta gerenciada do projeto,
`apps/api/scripts/golden-set-qa-container.ts` percorre os mesmos casos
de uso que um projeto real percorre, numa sessão `consultiva` própria:
`CreateModuleMapUseCase` (um módulo), `RouteModulesToInfraUseCase` (uma
imagem candidata), `ProposeActionUseCase` para `container_start` com
ator `agent/infra`, e `ApproveActionUseCase` como dono do projeto. A
aprovação roda `ExecuteContainerStartUseCase`, que grava a eleição como
um `artifact.project_image` novo por `DecidirImagemDoProjetoUseCase`
(então `validarDecisaoDeImagem` julga a imagem), chama
`ContainerBrokerPort.start` e registra `provisioning → running` pela
máquina de estados. O seed propõe e aprova em vez de chamar o caso de
uso de execução direto porque duas regras moram do lado da proposta — o
409 nomeado `sem_broker_na_instalacao`
([RN-591](../business-rules.md#rn-591)) e a política do `decide()` para
`container_start` — e um harness que as pulasse deixaria de seguir a
produção no dia em que qualquer uma mudasse.

A imagem é `node:24.11.1-bookworm-slim`, pinada pelo digest do índice
multiplataforma no seed (a regra do ADR 0159, embora esse arquivo fique
fora das árvores que o `imagens-pinadas.ts` varre). Debian e não Alpine
porque o broker mantém o container vivo com `sleep infinity`. A
geometria que faz os três lados verem o mesmo código: o worktree **é**
a pasta gerenciada do projeto (`projectScopeRoot`), o broker monta
`<PROJECT_WORKSPACES_HOST_ROOT>/<workspace_dir_name>` em `/work`, e o
engine traduz o `cwd` do QA para `/work` antes do `exec`. No job de CI
a api, o engine e o broker rodam todos nativos no runner, então
`PROJECT_WORKSPACES_ROOT` (api, engine) e `PROJECT_WORKSPACES_HOST_ROOT`
(broker) são o mesmo caminho; o broker é o único processo que fala com
o Docker.

Um caso cujo container não sobe agora reprova o seed com
`ContainerDoGoldenSetNaoSubiuError`, nomeando o passo e o motivo que o
produto deu, e o módulo ExUnit **reprova** quando a api está de pé mas
o seed falha. Antes, ele devolvia `{:skip, _}` do corpo do teste — o
que o ExUnit não trata como skip: o teste passava, verde, sem ter
medido nada.

Medido com um workflow temporário disparado por `push` na branch
(removido antes da PR, como a AT-067 fez):

| execução | pull do modelo | pull da imagem | container de pé (proposta → executada) | `mix golden_set.qa` | job inteiro | placar |
|---|---|---|---|---|---|---|
| [36291440108](https://github.com/daneiel/brabo/actions/runs/36291440108) | 15 s | 6 s | 0,20–0,28 s por caso | 48 min 29 s | 52 min 38 s | 3/6 |
| [36294037297](https://github.com/daneiel/brabo/actions/runs/36294037297) | 15 s | 6 s | 0,22–0,30 s por caso | 83 min 16 s | 86 min 16 s | 3/6 |

Contra os três critérios, nas duas execuções: o event log tem **zero**
recusas da RN-502 (nenhuma ação de terminal e nenhum evento de sessão a
menciona); `npm test` rodou dentro do container com `exit 0` em cinco
dos seis casos na primeira execução e em todos os seis na segunda (as
lacunas são `command`s vazios que o broker recusou nomeando — a falta
de confiabilidade do modelo que o ADR 0123 já registrava); e o placar é
relatado como veio, 3/6 duas vezes, contra o piso de 1/6.

| caso | esperado | 36291440108 | 36294037297 |
|---|---|---|---|
| `rf-covered` | approved | ✓ approved | ✓ approved |
| `rf-uncovered` | changes_requested | ✓ changes_requested | ✓ changes_requested |
| `rf-single-clean` | approved | ✗ changes_requested | ✗ `blocked(modelo)` |
| `rf-mismatched-filename` | approved | ✗ changes_requested | ✓ approved |
| `rf-partial-coverage` | changes_requested | ✗ `blocked(modelo)` | ✗ `blocked(modelo)` |
| `rf-skipped-test` | changes_requested | ✓ changes_requested | ✗ approved |

Mesmo total, casos diferentes: os erros agora são o julgamento do
modelo e a variância dele, que é o que o golden-set existe para medir —
`rf-skipped-test` aprovou uma vez, contando um `test.skip` como
cobertura, e `rf-single-clean` rodou `npm test` 30 vezes na segunda
execução antes de terminar `blocked(modelo)`.

As execuções ficaram mais longas (48 e 83 min contra 19–23 min) porque
os casos agora fazem o trabalho: leem arquivos e raciocinam sobre
cobertura em vez de parar na recusa, e um caso que se repete agora
repete execuções reais. Um job agendado precisa de `timeout-minutes`
acima dos 86 min vistos aqui. Duas coisas foram vistas e não mudadas
aqui: a chamada api→broker tem teto de 5 s para toda operação, `start`
incluído, então um `container_start` cuja imagem ainda não está no
daemon estouraria o tempo enquanto o pull continua (o job baixa a
imagem antes; sem isso não foi medido); e o heartbeat do engine fechou
as sessões ociosas (`heartbeat_timeout`) cerca de 30 s depois do seed,
enquanto o QA seguia propondo e rodando comandos nelas (o QA roda no
processo do `mix`, fora de qualquer processo de sessão), sem efeito
visível na rodada.

### Agendado, semanal (AT-149) {#scheduled-weekly-at-149}

Em 2026-09-27 o mantenedor escolheu a cadência: **semanal**
([ADR 0168](../adr/0168-golden-set-do-qa-em-ci-semanal.md)).
`.github/workflows/golden-set-qa.yml` é o desenho da AT-076 tornado
permanente — api, engine e broker nativos no runner, só o broker
falando com o Docker, a mesma pasta gerenciada nos três lados — em
`schedule` mais `workflow_dispatch`, nunca `pull_request`, a mesma
postura do `golden-set-rag.yml`.

Semanal e não noturno como o job do RAG, por dois motivos medidos. A
execução do RAG custa ~20 minutos e é determinística, então a queda de
ontem é uma queda real. Esta custa de 52 a 86 minutos e **varia**: as
duas execuções da AT-076 chegaram aos mesmos 3/6 por casos diferentes.
Uma execução noturna gastaria horas de runner por semana para ler a
mesma tendência com mais ruído; uma execução por semana é o que o piso
catraca precisa para mostrar uma queda, e `workflow_dispatch` responde
na hora depois de uma mudança no prompt do QA ou no seed. Ela roda no
sábado à 01:17 UTC: longe das 06:00 diárias do RAG, das 04:00 de
domingo das provas de propriedade e das 06:00 de segunda da checagem de
links externos; no sábado para que uma execução vermelha espere a
semana começar; no minuto 17 porque o Actions atrasa, e pode descartar,
agendamentos na hora cheia. `timeout-minutes` é 150: os 86 min medidos
mais folga para uma execução em que mais de um caso bate no teto de
iterações. Isso é a variância do modelo, e o job não mede o relógio.

O veredito é o do próprio teste: abaixo do `passRate` que o
`floor.json` grava para o modelo, o ExUnit reprova. O workflow só
acrescenta duas guardas de instrumento — a linha do placar precisa
existir (o teste pula quando a api está fora, e um skip numa execução
sem supervisão é um verde que não mediu nada) e o event log não pode
ter recusa da RN-502 (a assinatura da AT-067) — e, na falha, imprime os
logs, como o job do RAG faz. A imagem a pré-baixar é lida da própria
constante do seed (`IMAGEM_DO_GOLDEN_SET_QA`), não de um segundo
literal: o `docker run` do broker roda sob o teto de controle de 30 s
da porta do Docker ([RN-604](../business-rules.md#rn-604)), e um job
que baixasse uma imagem enquanto o seed pedisse outra poria o pull
dentro desse teto.

A execução de prova, com um gatilho `push` temporário na branch,
removido antes da PR:

| execução | pull do modelo | pull da imagem | `mix golden_set.qa` | job inteiro | placar |
|---|---|---|---|---|---|
| [36327281774](https://github.com/daneiel/brabo/actions/runs/36327281774) | 15 s | 5 s | 10 min 13 s | 13 min 41 s | 3/6 |

Zero recusas da RN-502 no event log, os seis containers `running` antes
do primeiro caso. Os mesmos 3/6 mais uma vez, por mais um conjunto
diferente de casos — `rf-covered`, `rf-uncovered` e `rf-skipped-test`
acertaram; `rf-single-clean` e `rf-mismatched-filename` receberam
`changes_requested` onde se esperava `approved`, e `rf-partial-coverage`
foi aprovado com cobertura parcial. A execução levou um sexto das da
AT-076 (10 contra 48–83 minutos de `mix golden_set.qa`): nenhum caso
desta vez se repetiu até o teto de iterações. O timeout continua
dimensionado pela execução mais lenta medida, não pela mais rápida.

## Um gate pode faltar no registro enquanto o `fluxo.yml` já o atribui {#a-gate-can-be-missing-from-the-registry-while-fluxoyml-already-assigns-it}

`deployavel` é o quarto padrão, e o menos lisonjeiro: ele estava
declarado como `gate_saida` da `area-infra` em `packages/contracts/fluxo.yml` e
estava **ausente de `apps/api/config/gates.yml` por completo** — nem `planned`,
nem desatualizado, simplesmente não estava lá. O modelo de time tem
três peças (catálogo, fluxo, registro) e nada ainda as cruza, então um
gate pode ser entregável numa e não existir em outra. Este é o
**segundo** achado dessa forma; o primeiro foi `paralelismo-autorizado`
envelhecendo na direção oposta.

Ele entra como `planned`/`warn`, sem bloco `evidencia` e sem script de
verificação, porque a [RN-070](../business-rules/custo.md#rn-070)/
[RN-071](../business-rules/custo.md#rn-071) proíbem `block` sem um — e
porque o que o bloqueia não é código. A infraestrutura existe
(overlays, imagens no GHCR por digest, scripts de
smoke/rollout/restore); o que falta é um ambiente de produção com
tráfego real e alguém que o mantenha. Ver o
[ADR 0153](../adr/0153-deploy-enabled-o-gatilho-que-ninguem-cria.md),
que também faz dez documentos pararem de citar `DEPLOY_ENABLED` como se
fosse uma variável que existe no código.

## Consumo: a tela deriva, não repete {#consumption-the-screen-derives-it-doesnt-repeat}

A trilha de PR no painel — Dev → QA → SecOps → Você — era uma lista
escrita dentro do componente. Desde a FASE 15b ela vem do registro, via
`GET /gates`.

O que muda na prática é uma propriedade, não a aparência: **um gate que
sai do registro sai da tela sozinho.** Antes, desativar o SecOps
deixava uma etapa morta na trilha até alguém lembrar de editar o código
— exatamente o tipo de envelhecimento que motivou o registro a existir.

Três decisões que valem explicar:

**A rota é separada da interna.** `/internal/gates` é de serviço para
serviço, com service token, e serve o script de medição; `/gates` é do
usuário logado e serve a tela. Mesmo registro, públicos diferentes.

**Sem `projectId`.** O registro é um fato sobre o PRODUTO: os mesmos
gates valem para todo projeto. Atrelá-lo a um projeto sugeriria que é
possível ter gates diferentes por projeto, que é exatamente o que o ADR
0054 deixou em aberto de propósito.

**Só gates `active`.** Um gate `planned` descreve um papel futuro
(dev-lead, platform). Numa tela que diz o que está acontecendo agora,
ele apareceria como se estivesse acontecendo.

### O que a tela ainda decide sozinha {#what-the-screen-still-decides-on-its-own}

O **rótulo** de cada etapa (`QA`, `Você`) e **qual etapa cada gate
representa** ficam no componente. Não é incoerência: o registro
descreve política, e como chamar as coisas para o usuário é decisão de
tela. O que saiu dela foi a LISTA — quais etapas existem.

Um gate de PR que o registro traz e que a tela ainda não sabe desenhar
é **ignorado**, com um teste afirmando isso: uma etapa `undefined` no
meio da trilha seria pior que a ausência dela.

## Referências {#references}

- [ADR 0054](../adr/0054-gates-como-registro-declarativo.md) — a
  decisão
- [ADR 0048](../adr/0048-decisao-no-log-e-a-ordem-do-gate.md) — a
  decisão no event log, sem a qual não haveria o que medir
- [RN-070](../business-rules/custo.md#rn-070), [RN-071](../business-rules/custo.md#rn-071)
