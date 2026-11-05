---
sidebar_position: 8
---

# Backlog triado {#triaged-backlog}

Saída da **FASE 13c**. Reúne os achados abertos da execução real
([achados-execucao-real.md](achados-execucao-real.md)) e os itens antigos que
viviam espalhados por ADRs e pelo CLAUDE.md.

> É **proposta**. A classificação e o agrupamento abaixo são um argumento sobre
> o que custa mais esperar; a decisão de prioridade é do usuário.

> [!warning] Histórico — NÃO leia isto como a fila viva
> Esta é a triagem da FASE 13c, e ela não acompanhou o repositório. Medido em
> **2026-09-12**: pelo menos **doze** itens que ainda aparecem aqui como
> abertos **já não reproduzem** — o isolamento do executor
> (`terminal_executor.ex` recusa container ausente), o schema por agregado
> (ADR 0121), o golden-set do gate semântico (ADR 0123), o backup de
> `git_local_repos`, o compose de instalação, "a FASE 29 é só planejamento",
> o Dependabot, duas lacunas do runbook e a severidade dos alertas, entre
> outros.
>
> O defeito é de **cadência, não de conteúdo**: fases foram fechadas sem
> ninguém voltar aqui para marcá-las. O que sobrevive — e o motivo de manter
> este arquivo — é o **raciocínio** da triagem: por que cada item custa mais
> esperar do que fazer. Trate todo estado abaixo como **não verificado até ser
> medido de novo**.

## Como está classificado {#how-its-classified}

**P1** — bloqueia o produto de fazer o que ele promete. **P2** — o produto faz,
mas mente ou confunde quem olha. **P3** — qualidade, sem quem esteja preso.

**Custo**: P (uma sessão), M (uma fase pequena), G (fase própria, com ADR).

**Risco de esperar** é a coluna que decide empate: um defeito que corrompe dado
ou apaga evidência custa mais tarde do que hoje; um cosmético custa igual.

## O quadro {#the-board}

| fase proposta | itens | prio | custo | risco de esperar |
|---|---|---|---|---|
| ~~A — Destravar a task~~ | ~~ADR 0052, O/B~~ | **FEITA** | — | RN-072 e RN-073 |
| ~~B — Engine em provider remoto~~ | ~~N~~ | **FEITA** | — | RN-076; ADR 0056 aceito |
| ~~F — Fronteira e teto do executor~~ | ~~S, U~~ | **FEITA** | — | RN-074 e RN-075; ADR 0055 aceito |
| ~~C — A UI não pode mentir sobre agentes~~ | ~~C, I, H, L, G~~ | **FEITA** | — | os cinco itens |
| ~~D — Wizard diz a verdade e tem saída~~ | ~~D, E, F~~ | **FEITA** | — | RN-078; E e F já estavam feitos |
| ~~G — O desfecho de falha diz a verdade~~ | ~~P, Q, T~~ | **FEITA** | — | RN-077 |
| ~~H — Estado de sessão não mente~~ | ~~V~~ | **FEITA** | — | RN-064 ampliada |
| ~~E — Qualidade do que os agentes produzem~~ | ~~K, R, J~~ | **FEITA** | — | RN-079, RN-080 e RN-081 |
| ~~— avulso~~ | ~~promotion-check sem spec~~ | **FEITO** | — | 10 casos, verificados por mutação |
| ~~I — O dev agent começa do zero~~ | ~~X, Y~~ | **FEITA** | — | RN-085; Y fechado na 13b, X na FASE 14d |

**Cobertura: 19 de 19** dos achados da execução real, mais **oito novos**
(W, X, Y, Z, AA, AB, AC, AD, AE) vindos da validação da FASE 13b — ver
[validacao-real.md](validacao-real.md).

Destes, **cinco fecharam**: W, Y, AA, AB e AC na própria 13b, e X pela FASE 14d
([RN-085](../business-rules/custo.md#rn-085)) — o teto de iterações virou por TIPO de
agente, que era a forma que a triagem tinha proposto e a decisão de produto que
faltava.

**Três seguem abertos**, e nenhum é bug a corrigir:

| achado | o que é | por que não é conserto |
|---|---|---|
| **Z** e **AD** | o allowlist de verbos não converge — verbo, forma e invocação são espaços distintos | o allowlist cumpre o que promete, e a recusa do `bash` prova que a fronteira segura. É decisão de PRODUTO sobre política por perfil de agente, com ADR |
| **AE** | o agente de QA tenta consertar o código que julga | nada vazou: barrado por duas barreiras independentes. O dado é a divergência entre o que o prompt pede e o que o modelo faz |

A conclusão prática da 13b já foi implementada e não espera nada: o caminho não
é afrouxar política, é o agente ESPERAR a decisão em vez de morrer
([ADR 0057](../adr/0057-o-gate-espera-a-aprovacao.md), estendendo o 0052).

As letras de fase (A–H) e as de achado (B–V) colidem por herança das duas
listas; onde houver ambiguidade o texto diz "achado".

Dois itens saíram da lista de abertos desde a primeira triagem: **A**
([RN-067](../business-rules/custo.md#rn-067)) e **M**
([RN-066](../business-rules/custo.md#rn-066)), ambos fechados e confirmados em
produção. E o **ADR 0052**, que era metade da Fase A, foi implementado e provado
por teste — a entrega do wake foi corrigida e coberta de ponta a ponta depois
disso.

O resto (itens antigos) está em [Backlog anterior](#older-backlog), sem
prioridade atribuída: são decisões de produto, não defeitos.

---

## Fase A — Destravar a task (P1) — **FEITA** {#phase-a--unblock-the-task-p1--done}

**Nenhum dev agent jamais terminou uma task.** Era o fato que ordenava tudo: o
registro de gates da FASE 15a mostra `qa-verificada`, `secops-segura` e os dois
de infra como *"nunca passou"* — não por falta de execução, mas porque nunca
existiu PR para gate nenhum julgar.

| item | o que era | como fechou |
|---|---|---|
| **ADR 0052** | aprovação pendente devolvia `status pending` como resultado da ferramenta e queimava uma iteração; o agente morria no teto sem escrever nada | o laço SUSPENDE e retoma ([RN-073](../business-rules/custo.md#rn-073)); a entrega do desfecho foi corrigida depois — o evento nascia num agregado que o dreno do engine não lia — e o caminho agora está coberto de ponta a ponta |
| **O / B** | sessão e dev agents nasciam no `llama3.2:1b` local, que o ADR 0020 proíbe no passo semântico | quando a cascata pousa no default do workspace, o modelo herdado é o do **Criativo** ([RN-072](../business-rules/custo.md#rn-072)) |

A herança ocupa o **vazio** e nunca sobrepõe: binding de sessão, de agente ou de
projeto são escolhas explícitas e continuam vencendo. E o modelo herdado passa
pelos mesmos filtros da cascata — sumido do catálogo ou sem tool calling não é
herdado.

Fechar esta fase **não** foi suficiente, e isso é o achado mais útil dela: o
agente passou a andar e morreu de outra coisa (Fase F, o `413`). *"Nenhum dev
agent jamais terminou uma task"* continuou verdadeiro — o que mudou foi o motivo.

**Risco de esperar: alto.** Enquanto isso não fecha, PR remota, gates de
QA/SecOps e a medição da 13b ficam represados atrás — e cada rodada de
dogfooding gasta dinheiro só para reconfirmar o mesmo bloqueio.

## Fase B — Engine em provider remoto (P1) — **FEITA** {#phase-b--engine-on-a-remote-provider-p1--done}

**N** — `get_local_repo_path/1` devolvia `unsupported_provider` para tudo que
não era `local`, e quatro consumidores paravam junto. A **api** fala GitHub por
HTTP; o **engine** trabalha no sistema de arquivos e só conhecia bare repo
local, então projeto remoto rodava a metade conversacional e parava na de
construção.

Fechou pelo [ADR 0056](../adr/0056-o-engine-trabalha-em-repositorio-remoto.md) e
pela [RN-076](../business-rules/custo.md#rn-076): o engine pede o remoto de trabalho à
api, que é quem tem a chave mestra, e a credencial entra **por invocação** — a
origem gravada no `.git/config` é limpa.

**A descoberta que encolheu o problema:** dois dos quatro consumidores nunca
precisaram de credencial. `Diff` e `ProjectContext` só usam o NOME da branch —
paravam por dano colateral de uma função que devolvia mais do que eles pediam.

### O que a Fase B NÃO fechou {#what-phase-b-did-not-close}

- **Isolamento**, de novo. O token saiu do disco, mas o agente segue no mesmo
  container que o monorepo do Brabo. É a mesma pendência que o ADR 0055 já
  declarava, e ela agora tem duas fases apontando para si.
- **Prova contra um GitHub de verdade.** `fetch` e `push` passam por `GitAuth`,
  e os testes cobrem o caminho local de ponta a ponta (push que chega no bare
  do outro lado) e os erros nomeados. O que nenhum teste pode dar é um
  repositório remoto real com token real — isso é a execução da 13b, que agora
  tem como acontecer.

## Fase F — Fronteira e teto do executor (P1) — **FEITA** {#phase-f--executor-boundary-and-cap-p1--done}

A execução do `hello-limpo` morreu aqui, e os dois itens tinham a mesma raiz:
o executor de terminal não tinha limite — nem de **onde** o comando alcança, nem
de **quanto** ele devolve.

| item | o que era | como fechou |
|---|---|---|
| **S** | o contexto acumulado estourava o limite de bytes do provider e a chamada voltava `413`. Cada saída de terminal ficava no histórico e viajava em todo turno seguinte | teto de bytes no executor, com marca endereçada ao modelo ([RN-074](../business-rules/custo.md#rn-074)) |
| **U** | `/workspace` dentro do executor é o monorepo do **próprio Brabo**, e `/data/project-workspaces/*/` dá acesso ao worktree de outros projetos | escopo de caminho na decisão ([RN-075](../business-rules/custo.md#rn-075), [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) aceito) |

O escopo fechou os dois lados de uma vez: **apertou** (verbo liberado apontando
para fora deixou de auto-aprovar) e **afrouxou** (o `cd` para dentro deixou de
reprovar o comando composto, que era o defeito mais caro da escada).

### O que a Fase F NÃO fechou {#what-phase-f-did-not-close}

Fica registrado em vez de ser dado como pronto:

- **Isolamento.** O ADR 0055 é política, e diz isso de si mesmo. Enquanto o
  monorepo do Brabo estiver montado no container que executa os comandos, a
  fronteira depende de a regra acertar. A normalização é léxica: `..` é
  reprovado, symlink de dentro apontando para fora não é detectado.
- **Ponto 6 do ADR — "Sempre permitir" generalizar.** Continua gravando o
  comando literal, que nunca volta a casar. Não entrou porque generalizar
  EXPANDE o que um clique autoriza (aprovar `cat foo` passaria a liberar
  `cat` em qualquer coisa), e essa é uma decisão de produto que merece
  escrutínio próprio em vez de carona.
- **Ponto 7 do ADR — o evento registrar qual escopo autorizou.** O motivo da
  decisão já diz, mas não é persistido em `proposed_action.created`.

## Fase C — A UI não pode mentir sobre agentes (P2) — **FEITA** {#phase-c--the-ui-cant-lie-about-agents-p2--done}

Cinco itens com a mesma raiz: a tela contava uma história diferente da do event
log.

| item | o que a tela faz | estado |
|---|---|---|
| **C** | a bolha ao vivo vem rotulada com o **modelo**; o agente só aparece quando o evento persistido chega — e a mensagem fica duplicada até o reload | **FEITO** — o delta passou a carregar o agente, e o refetch é adiado enquanto o turno streama |
| **G** | o convite do Criativo não aparece em projeto criado, porque o fio já tem os cards do bootstrap | **FEITO** — a condição passou a ser "a conversa começou", não "o fio está vazio" |
| **L** | o botão do rodapé continua "Estou pronto para produzir" depois do handoff saindo do Criativo | **FEITO** — some quando existe handoff saindo do Criativo |
| **H** | os eventos do bootstrap aparecem todos como "atividade em system" | **FEITO** — os cinco tipos ganharam família própria, com o passo traduzido |
| **I** | trocar o modelo da sessão reescreve retroativamente o rótulo de ações antigas | **FEITO** — o card deixou de afirmar um modelo que não tem como saber |

**C** era o mais grave dos cinco e foi apontado por você durante a execução:
quem fala é o agente, o modelo é detalhe de execução.

**I mereceu uma decisão, não só um conserto.** O card recebia o modelo ATUAL da
sessão, e não existe fonte verdadeira do modelo por ação — `proposed_actions`
não o guarda, e `token_usage` não se liga à ação. Entre inventar uma e parar de
afirmar, a segunda é a única honesta: quem propôs já está no card, em negrito, e
é o **agente**, que é o que não muda. O rótulo saiu junto com a prop, que ficou
sem nenhum outro consumidor.

**H** virou redação: os cinco tipos `bootstrap.step_*` ganharam família própria
com o passo traduzido para português, e só `step_failed` é marcado como ruim —
`degraded` e `skipped` são desfechos previstos, e pintá-los de vermelho ensinaria
a ignorar o vermelho. `create_rc_branch` continua traduzido mesmo aposentado
(ADR 0030), porque projetos bootstrapados antes têm o evento no log.

## Fase D — Wizard diz a verdade e tem saída (P2) — **FEITA** {#phase-d--the-wizard-tells-the-truth-and-has-an-exit-p2--done}

| item | o que era | como fechou |
|---|---|---|
| **D** | `Protect branches` falha em repo privado no plano gratuito, e o wizard **avisa isso antes**. A única ação oferecida depois era "Tentar novamente", que falha sempre | [RN-078](../business-rules/custo.md#rn-078) |
| **E** | o preview do repositório mentia: `repo: brabo/{slug}` hardcoded, com o owner real vindo do PAT | já estava feito (commit `4dd7a073`) — o rótulo passou a mostrar só o slug, que é o que se sabe de fato |
| **F** | o passo "Política de branches" listava `rc` entre as permanentes | já estava feito (commit `4dd7a073`) |

**E e F já estavam corrigidos** quando fui atacá-los, num commit que fechou
quatro achados de uma vez. Descobrir isso custou uma leitura; o backlog não
sabia porque foi escrito antes.

**O item D era maior do que a descrição sugeria.** Não era só "tela sem saída":
`provision_failed` faz o dashboard **redirecionar o clique do projeto de volta
para a página de provisionamento**, então o projeto ficava inalcançável para
sempre, preso num passo que não tem como suceder. A saída precisou de rota,
caso de uso e evento — não só de um botão.

**Só o passo de proteção pode ser reconhecido**, e essa é a decisão que importa:
ele é o último passo e o único cuja falha ainda deixa um repositório utilizável.
Oferecer "seguir" numa falha anterior seria uma segunda mentira em cima da
primeira.

## Fase G — O desfecho de falha diz a verdade (P2) — **FEITA** {#phase-g--the-failure-outcome-tells-the-truth-p2--done}

A mesma regra do CLAUDE.md violada três vezes: **P** (`dev.blocked` com
`origin: null`), **Q** (`agent.error` com `"undetermined"`) e **T**
(recorrência: `dev.blocked` com `"undetermined"` numa falha cujo campo
`diagnosis` nomeava a causa na MESMA linha).

Fechou pela [RN-077](../business-rules/custo.md#rn-077), e o diagnóstico da causa foi
o que mudou a forma do conserto: **o classificador já existia e já acertaria**
— `FalhaDeTurno.origem/1` mapeia status ≥ 400 para `codigo`, o que classifica o
`413` do achado T corretamente. O defeito nunca foi falta de regra; era
`block_task` ter `"undetermined"` como **default**, e os call sites não
passarem nada.

Então o conserto é estrutural, não mais uma regra: **o default saiu**. Esquecer
a origem agora é erro de compilação, e não um evento sintaticamente válido e
semanticamente vazio.

`indeterminada` deixou de existir. Ela significava *o classificador não
reconheceu esta forma* — lacuna do nosso código —, e `codigo` é a origem que
aponta a ação certa. `indeterminada` não apontava nenhuma, que era exatamente a
queixa do achado.

## Fase H — Estado de sessão não mente (P2) — **FEITA** {#phase-h--session-state-doesnt-lie-p2--done}

**V** — a sessão `1f94de49` constava `closed` desde 23:34:42 e a execução seguiu
até 00:56.

A causa não era a máquina de estados: era **o heartbeat**. A sessão nasceu
23:34:12 e fechou 23:34:42 — exatamente os 30s de `SESSION_HEARTBEAT_TIMEOUT_MS`.
A [RN-064](../business-rules/custo.md#rn-064) já mandava verificar se havia trabalho
pendente antes de encerrar, mas "trabalho pendente" era só **handoff `offered`**
— e havia uma ação `pending` desde 23:34:13, criada um segundo depois de a
sessão nascer.

Ação aguardando decisão passou a contar. É o mesmo defeito do handoff um nível
abaixo: alguém está esperando **você**, e um agente pode estar suspenso
esperando o desfecho ([RN-073](../business-rules/custo.md#rn-073)).

**A versão anterior da regra dizia, por escrito, que incluir trabalho de agente
"sem um teste que prove a interação seria adivinhar".** A execução produziu a
prova, e é isso que separa este conserto de um palpite.

### O que a Fase H NÃO fechou {#what-phase-h-did-not-close}

- **Task `in_progress` sem ação pendente nem handoff.** O sinal exigiria a api
  ler `dev_agent_states`, que é do engine — decisão de fronteira, não conserto
  de passagem.
- **`closed` continuar aceitando aprovação.** Com o heartbeat corrigido, a
  sessão deixa de fechar com ação pendurada, então o caso fica raro. Bloquear a
  decisão numa sessão já fechada é mudança de comportamento com consequência
  própria: uma ação órfã de uma sessão já encerrada ficaria sem ninguém para
  decidi-la.

## Fase E — Qualidade do que os agentes produzem (P3) {#phase-e--quality-of-what-agents-produce-p3}

| item | o que acontece |
|---|---|
| **K** | rodar o Criativo duas vezes no mesmo projeto deixou 10 regras, 5 órfãs — sem dedupe nem aviso |
| **R** | o PO gerou duas histórias cobrindo o mesmo endpoint |
| **J** | o Psicólogo roda em sessão recém-aberta com as hipóteses da anterior e o log vazio, tenta citar eventos inexistentes e desiste |

**FEITA**, com um corte declarado no meio.

**J era mecanismo, ao contrário do que esta seção supunha.** Log vazio é
condição verificável, e o defeito estava na contagem que decidia se valia a
pena rodar: ela somava os passos de máquina do bootstrap e — pior — o rastro que
o próprio Psicólogo deixa na sessão enquanto a analisa, o que fazia uma sessão
vazia parecer povoada a partir da primeira análise, e mais povoada a cada
retentativa. Fechado pela [RN-079](../business-rules/custo.md#rn-079), com a sessão do
achado reproduzida como teste.

**K e R eram o mesmo prompt, e por isso fecharam só até onde código alcança.**
Duplicata EXATA de regra é recusada na emissão
([RN-080](../business-rules/custo.md#rn-080)); história com título idêntico é recusada
e história que não acrescenta cobertura vira aviso
([RN-081](../business-rules/custo.md#rn-081)) — aviso, e não bloqueio, porque um
segundo recorte da mesma regra pode ser legítimo e quem julga é o usuário.

O que **não** foi resolvido, e está escrito nas três RNs em vez de subentendido:
duplicata semântica. O par exato do achado R — "Endpoint público de saudação
determinística" e "Endpoint público GET /hello que responde saudação imediata" —
continua passando, porque nada mecânico liga os dois. Há teste afirmando esse
limite, para que ele seja uma decisão visível e não uma lacuna esquecida.

## Avulso {#standalone}

~~**`promotion-check` sem spec própria**~~ — **FEITO**. Era o único check
required da família sem teste (`pr-police`, `approval-ladder` e `gate` têm).
Encontrado ao escrever o registro de gates (FASE 15a, PR #145).

`scripts/ci/promotion-check.spec.ts` cobre as duas funções puras, afirmando a
REGRA e não a implementação: qual carimbo cada destino cobra (`qa` cobra `dev`,
`main` cobra `qa`, `dev` não cobra nada), e o que conta como carimbo **daquele**
commit específico — tag de outro commit não vale, tag de outro estágio não vale,
e tag que não resolveu sha não vira carimbo por omissão. É esse conjunto que
impede `qa` de receber código que nunca passou por `dev`.

~~**Os quatro segredos irmãos do compose de produção**~~ — **FEITO**
([RN-114](../business-rules/custo.md#rn-114)). `AUTH_JWT_SECRET`,
`BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY` e `SECRET_KEY_BASE` tinham
default de desenvolvimento em `docker/docker-compose.prod.yml`, que roda com
`NODE_ENV=production` — o mesmo padrão que o
[ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md) já fechara para
o `GIT_OAUTH_STATE_SECRET`, pelo mesmo motivo: o valor é público, está neste
repositório.

O receio registrado abaixo — que cada um merecia decisão própria — não
apontava para quatro DECISÕES diferentes, só para três checagens em lugares
diferentes: `passphraseAtual()` (`auth-key-material.ts`),
`tokenDeServicoAtual()` (`service-token.ts`) e o construtor de
`EnvelopeEncryptionService`, cada um com a MESMA regra do
`resolveOauthStateSecret()` (ausente/exemplo/curto derruba o boot em
produção). `CREDENTIALS_MASTER_KEY` recusar o BOOT não é o problema que se
temia — não mexe em rotação nenhuma, que continua existindo via
`CREDENTIALS_MASTER_KEY_PREVIOUS` + `rewrap-deks.ts`; a checagem só impede que
a chave de exemplo chegue a produção. `SECRET_KEY_BASE` já tinha o `raise`
certo no `runtime.exs` — o defeito real era o compose mascará-lo com um
fallback público, e a correção foi só remover esse fallback, sem tocar
código Elixir nenhum.

~~**Revisão externa de 2026-08-28, item #13 — containers de dev rodavam como root**~~ —
**FEITO**. `docker/api/Dockerfile`, `docker/web/Dockerfile` e
`docker/engine/Dockerfile` não tinham diretiva `USER`, então tudo o que eles
escreviam no bind mount (`node_modules`, `apps/api/dist`, e o que um agente
gerasse dentro de um projeto em modo de execução `mounted`) caía no host com
dono root — o README e o guia de primeiros passos desta documentação
documentavam um contorno manual `sudo chown -R $USER ...` em vez de corrigir a
classe do problema. As imagens `Dockerfile.prod` já eram non-root; isto era só
de dev.

A correção mapeia o usuário do container para o UID/GID do HOST em vez de rodar
como root e limpar depois: build args `DEV_UID`/`DEV_GID` (lidos do
`.env`/do ambiente via `docker-compose.yml`, default `1000`/`1000`),
nomeados `DEV_*` de propósito porque `${UID}` é somente leitura no bash e não
é exportado para o ambiente por padrão — lê-lo direto do arquivo de compose
sempre veria vazio. Cada Dockerfile cria um grupo/usuário com esse UID/GID só
quando ele não colide com um que a imagem base já traz (`node:24-alpine` já tem
`node` em 1000:1000) e troca com `USER <uid>:<gid>` — numérico, então não
importa qual nome de usuário acaba dono desse id. Todos os passos que exigem
root (`apk add`, `pip install`, os downloads de gitleaks/hadolint/actionlint)
ficam ANTES da troca; na imagem do engine, `_build`/`deps`/`.mix`/`.hex` — sob
`/root` porque `mix local.hex`/`mix local.rebar` escrevem lá, montados como
volumes nomeados pelo `docker-compose.yml` — recebem `mkdir`+`chown` para o
UID/GID alvo antes do `USER`, então um volume nomeado novinho herda o dono
certo na primeira montagem (o Docker popula um volume novo com o que já existe
naquele caminho na imagem).

Provado rodando a stack real (`DEV_UID=$(id -u) DEV_GID=$(id -g)
docker compose -f docker/docker-compose.yml up --build postgres api web
engine`): os três containers subiram com zero erros de `EACCES`/permissão, e
`apps/api/dist` no host ficou com dono o usuário do host, não root. Um
detalhe real, não um bloqueio: volumes nomeados criados por um ambiente
anterior a esta correção (`*_node_modules`, `engine_build`, `engine_deps`,
`engine_mix`, `engine_hex`) ainda guardam conteúdo escrito pelos containers
root antigos — atualizar exige um `chown` único desses dados de volume
existentes (ou derrubar os volumes com `docker compose down -v` e deixar o
próximo `up` recriá-los), documentado no README e no guia de primeiros passos
junto com as instruções de `DEV_UID`/`DEV_GID`.

---

## Backlog anterior {#older-backlog}

Itens que já existiam antes desta rodada. Não são defeitos, são decisões de
produto adiadas — por isso sem prioridade aqui.

| item | onde foi decidido |
|---|---|
| ~~Budget por área~~ | **CORRIGIDO E FECHADO.** `agent_areas` ganhou `budget_micros`/`spent_micros` — um TERCEIRO teto independente ao lado de projeto/sessão, aditivo (não a cascata do ADR 0064), espelhando o padrão de `max_parallel` na mesma linha ([RN-443](../business-rules.md#rn-443), [ADR 0110](../adr/0110-budget-por-area-aditivo-nao-cascata.md)) |
| Dev Lead e áreas via `module_map` | **saiu do backlog**: ADR 0053, implementado pela FASE 14d |
| ~~Handoff manual a agente à escolha~~ | **FECHADO** — [ADR 0109](../adr/0109-handoff-manual-a-agente-a-escolha.md)/[RN-440](../business-rules.md#rn-440)/[RN-441](../business-rules.md#rn-441). `SessionPage.tsx` ganhou um seletor sobre `addressableAgents()` (leads ∪ agentes solo) que faz POST em `POST .../sessions/:sessionId/handoffs` — o MESMO `CreateHandoffUseCase` que o `offer_handoff` do próprio agente usa, com `actor: {kind:'user'}` registrando quem decidiu. O Staff (ADR 0088) e o `ux-designer` (ADR 0087), ambos encontrados alcançáveis só pela rota interna, entraram em `AGENTES_DE_CHAT` na mesma mudança |
| MFA, login social, OIDC, federação | [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) — o login social (GitHub/GitLab) SAIU da proibição e está implementado (ADR 0084); o resto segue fora de escopo |
| Deploy (`DEPLOY_ENABLED` + Environments) | o gate `operavel` já está declarado como `planned` |
| Volta da `rc`/`rcfix` | [ADR 0030](../adr/0030-politica-de-branches-mecanizada.md) |
| ~~Modo community do approval-ladder~~ | **CORRIGIDO E FECHADO.** A referência "vira mudança de `aprovacao_humana` no registro de gates" era imprecisa — vinha de uma frase especulativa do ADR 0054, não de algo que faltava. O modo `community` já está implementado e testado desde a FASE 6 (`scripts/ci/approval-ladder.ts`), só desligado por `APPROVAL_MODE=solo` (default); `aprovacao_humana` do gate `aprovacoes-da-escada` já é `true` nos dois modos, sem awareness de `APPROVAL_MODE` no schema. O que faltava de verdade era o `TODO(humano)` de `branching-policy.md` — o critério de quem entra em cada lista de aprovadores —, fechado por `GOVERNANCE.md` (raiz do repositório). Ativar o modo de fato continua sendo decisão operacional (recrutar gente real para os três papéis), não pendência de engenharia |
| ~~Preferência de moeda com taxa manual~~ | **NÃO SERÁ FEITO** — decisão registrada. Converter exigiria uma taxa de câmbio mantida à mão, que envelhece; um número errado é pior que um número honesto em USD (o mesmo princípio já aplicado em `formatarCustoMicros`, `ProjectSettingsTab.tsx`) |
| Reativar a Anamnese (`ANAMNESE_ENABLED=true`) | pausada por decisão do usuário em 2026-08-10 — "hoje ele não está trazendo dados de muito valor" ([RN-115](../business-rules/autenticacao.md#rn-115)). Nenhum dado apagado (hipóteses, perfis de proficiência e patches de instrução seguem intactos e visíveis); a pausa é só do CAMINHO de rodada nova, aguardando um refinamento futuro do que a Anamnese deriva antes de religar |
| Reativar o Psicólogo (`PSYCHOLOGIST_ENABLED=true`) | pausado por decisão do usuário em 2026-08-10, mesmo motivo e mesmo padrão da Anamnese acima ([RN-117](../business-rules/autenticacao.md#rn-117)). Nenhum dado apagado (análises e hipóteses já emitidas seguem intactas e visíveis); a pausa é só do CAMINHO de rodada nova (automática e sob demanda) |
| Instalação de uma linha, e assinar o que publicamos | assumido pela **FASE 29** ([fase-29-instalacao-de-uma-linha.md](fase-29-instalacao-de-uma-linha.md)), que até agora é só planejamento — nada aqui está fechado. A FASE 28 recusou por escrito o instalador de uma linha enquanto os artefatos seguirem sem assinatura (**BRB-005**), então a fase assina primeiro e instala depois. O planejamento mediu três coisas que este arquivo não registrava: `docker-compose.prod.yml` não tem referência nenhuma a `ghcr.io` e se diz o compose de validação, então é preciso um compose de instalação novo; `make test-restore` é um caminho de Kubernetes e `backup.sh` cobre só o Postgres, então migrar uma instalação por compose não tinha rota provada; e **`git_local_repos` — os bare repos dos projetos de provider `local` — não está em backup nenhum**, o que é perda de código na perda do volume, em todo ambiente. Os ids BRB agora têm casa canônica no [registro BRB](../reference/brb.md), onde três dos seis itens que esta fase herdou se revelaram já corrigidos — descobrível só medindo, que é o argumento para o registro existir |
| Painel de Problemas/lint/testes na aba Código | pendência declarada na FASE 26 (`CLAUDE.md`) junto com blame, lista de PRs e detalhe de branch — esses três fecharam na FASE 26b, este não e nunca foi retomado. Ainda não existe fonte de dados (nenhuma integração de lint/test-runner no produto); registrado aqui para não sair do acompanhamento em silêncio |

## Backlog do runner/execution_mode (ADR 0104) {#backlog-of-the-runnerexecution_mode-adr-0104}

Primeiro achado do tipo "dois ADRs divergindo entre si" registrado neste
documento — os precedentes de tabela abaixo (a auditoria `fluxo.yml`×código,
já fechada) sempre foram doc declarativo × código, nunca ADR × ADR. A forma da
tabela é reaproveitada; o tipo de achado é novo.

**A divergência, fechada pelo [ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
— reconciliação ACEITA, Onda 1 (RN-421/422/423) FEITA:**

| # | Severidade | Item | Evidência (arquivo:linha) |
|---|---|---|---|
| 1 | **FECHADO** (RN-423) | A RN-170 exigia bind-mount na criação; a RN-420 roteava para o runner sob a mesma flag `workspace_mode == 'local'`, sem bind-mount nenhum | `apps/api/src/application/use-cases/iam/confirm-project-workspace.use-case.ts` (o runner confirma e vira a fonte de verdade); `apps/engine/lib/engine/actions/terminal_executor.ex` (`decisao_de_execucao/1`, quatro desfechos — recusa explícita sem workspace verificado/runner conectado, nunca queda para o container) |
| 2 | **FECHADO** (RN-422) | O wizard só ensinava bind-mount, nunca o comando do runner, embora ele já existisse | `apps/web/src/routes/NewProjectWizard.tsx` — terceira entrada em `MODOS_DE_WORKSPACE` (`runner`), com o comando `brabo-runner --project <id> --dir <pasta>` direto no passo "Onde o código vai morar", não só no Terminal |
| 3 | **FECHADO** (RN-421) | Um enum de 2 valores (`workspace_mode`) não expressava 3 modos de execução fisicamente distintos | `apps/api/src/db/migrations/0048_quiet_iron_fist.sql` (`project_execution_mode`, três valores); `apps/api/src/domain/iam/project.entity.ts` (`PROJECT_EXECUTION_MODES`) |

**Correção registrada durante a implementação da Onda 1, FECHADA à parte**
(ela mesma não é uma das ondas numeradas do runner neste documento — ver
abaixo): o item 4 do ADR 0104 afirmava que converter entre os três modos de um
projeto EXISTENTE "passa a ser permitido sem recriar o projeto". A Onda 1
achou isso incorreto — `UpdateProjectDto` ainda excluía de propósito
`executionMode`/`workspacePath`, e só o campo de três valores na CRIAÇÃO tinha
sido entregue de fato. **O [ADR 0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md)
torna a frase VERDADEIRA de novo**, por uma rota dedicada (`PUT
.../execution-mode`, `ConvertProjectExecutionModeUseCase`, RN-447..450) —
não editando o texto aceito do ADR 0104, que fica como foi escrito, errado na
época e corrigido aqui:

| item | custo | critério de ativação | onde foi decidido |
|---|---|---|---|
| ~~Converter `execution_mode` de um projeto EXISTENTE, sem recriá-lo~~ | **FECHADO** (RN-447..450) | — | [ADR 0111](../adr/0111-conversao-de-execution-mode-de-projeto-existente.md) |

**Onda 2 — PAT, [ADR 0105](../adr/0105-personal-access-token-do-runner-escopado-por-construcao.md), FEITA (RN-424/425/426; RN-427 fechada depois, na mesma onda de decisão):**

O item "token de conta de longa duração" da tabela original tinha DOIS erros
de texto, corrigidos durante a implementação em vez de seguidos às cegas —
registrados aqui porque a tabela abaixo os repetia:

1. **"hash argon2 no banco" estava errado.** O padrão real do produto para
   segredo de ALTA entropia (256 bits de CSPRNG) é HMAC-SHA256 + pepper via
   `hashDeToken()`/`TokenFactory` — o mesmo mecanismo de refresh tokens e
   account tokens. Argon2 é para segredo de BAIXA entropia (senha), onde a
   resistência a dicionário importa; aqui ele só quebraria a busca indexada
   `WHERE token_hash = $1` sem ganho nenhum.
2. **"reaproveitar a infraestrutura de rotação da família de refresh token"
   era impreciso.** Um PAT é apresentado repetidamente SEM MUDAR — nunca
   consumido-e-reemitido como um refresh token. Só a geração
   (`TokenFactory.gerar()`) e o hash são reaproveitados; a família/rotação
   inteira seria inventar um comportamento de que o PAT não precisa.

| # | Severidade | Item | Evidência (arquivo:linha) |
|---|---|---|---|
| 1 | **FECHADO** (RN-424) | O PAT precisava autenticar `runner-ticket` sem virar credencial válida para nenhuma outra rota do usuário | `apps/api/src/interfaces/http/auth/pat-route.decorator.ts` (`@RequirePatAuth()`), `apps/api/src/interfaces/http/auth/jwt-auth.guard.ts` (terceiro early-out), `apps/api/src/interfaces/http/auth/pat-auth.guard.ts` (`PatAuthGuard`, aplicado só a `runnerTicket`) |
| 2 | **FECHADO** (RN-425) | Validação de token de alta entropia sem vazar qual dos três motivos de recusa (inexistente/revogado/expirado) se aplica; `last_used_at` sem regredir numa reconexão legítima | `apps/api/src/infrastructure/persistence/drizzle/personal-access-token.repository.ts` (`validarEUsar` — um único UPDATE condicional, sem throttle no mesmo WHERE) |
| 3 | **FECHADO** (RN-426) | Emitir/revogar/listar sem vazar o token de um usuário para outro | `apps/api/src/application/use-cases/auth/*-personal-access-token*.use-case.ts`, escopado por `userId` no WHERE da consulta |
| 4 | **FECHADO** (RN-427) | `maintainer` revogando o PAT de OUTRO usuário (resposta a incidente — um dev saindo com token vazando), declarado fora de escopo na época | `apps/api/src/application/use-cases/auth/*-personal-access-token-as-maintainer.use-case.ts`, `apps/api/src/interfaces/http/runner/personal-access-tokens.controller.ts` (`listAllPats`/`revokePatAsMaintainer`, rotas separadas, `@RequireRole('maintainer')`), escopado por `projectId` no WHERE da consulta |

`apps/runner/src/auth.ts` perdeu por completo o login interativo, os cookies e
`~/.brabo/runner-credentials.json` — ele só valida o formato e repassa
`--token`/`BRABO_ACCOUNT_TOKEN`, nunca gravado em disco pelo CLI.

**Onda 3 — distribuição por npm, [ADR 0106](../adr/0106-distribuicao-do-runner-via-tsup-e-npm-publish.md), FEITA:**

| # | Severidade | Item | Evidência (arquivo:linha) |
|---|---|---|---|
| 1 | **FECHADO** | `apps/runner` era `"private": true`, com `bin` apontando para um `.ts` cru, alcançável só clonando o monorepo | `apps/runner/tsup.config.ts` (`format: cjs`, `external: ['node-pty']`), `apps/runner/package.json` (`bin` → `dist/index.cjs`, `publishConfig.access: public`), `.github/workflows/publish-runner.yml` (publica a cada tag final, workflow próprio, paralelo ao `release.yml`) |

Achado real durante a implementação, testado empiricamente antes de entrar no
código: o conserto óbvio para a guarda de auto-execução do `index.ts`
(`import.meta.url === pathToFileURL(argv[1]).href`) estava QUEBRADO justamente
no caso que esta onda existe para habilitar — a invocação pelo `bin` instalado
(`npm install -g` cria um symlink, e `process.argv[1]` nunca é resolvido por
realpath enquanto `import.meta.url` sempre é). O conserto final aplica
`realpathSync` a `argv[1]` antes de comparar — ver ADR 0106.

**Onda 4 — binário standalone, [ADR 0112](../adr/0112-binario-standalone-do-runner-via-bun-build-compile.md), FEITA com uma lacuna honesta por plataforma:**

| # | Severidade | Item | Evidência (arquivo:linha) |
|---|---|---|---|
| 1 | **FECHADO** | O `node-pty` resolve seu addon nativo `.node` por um caminho CALCULADO em runtime — `bun build --compile` não embute o que não consegue resolver estaticamente, confirmado empiricamente (o build passa, o runtime lança `Cannot find module`) antes de desenhar o conserto | `apps/runner/src/native-pty-loader.ts` (extração real para `fs.mkdtempSync`, preservando o layout relativo original do `node-pty`, e depois `import()` por caminho absoluto — nunca `require('node-pty')` pelo nome do pacote); `apps/runner/scripts/build-bin.mjs` (gera `native-pty-embed.generated.ts`, um import estático `with { type: 'file' }` por arquivo, a única forma que o Bun aceita para embutir) |
| 2 | **FECHADO** | `bun build --compile` empacotava em silêncio o FALLBACK `await import('node-pty')` (usado só fora de um binário compilado) e lançava em runtime em vez de no build, gastando tempo real de depuração num erro enganoso antes de ser isolado | `apps/runner/scripts/build-bin.mjs` (`--external node-pty` na invocação do `bun build`) |
| 3 | **FECHADO** | O conserto da guarda de auto-execução do ADR 0106 (`realpathSync` em `argv[1]`) lança `ENOENT`, sem captura, dentro de um binário compilado — ali `process.argv[1]` é `/$bunfs/root/<name>`, um caminho virtual que `realpathSync` não resolve | `apps/runner/src/index.ts` (confere `import.meta.url.includes('/$bunfs/')` PRIMEIRO, e nesse caso roda `main()` incondicionalmente) |
| 4 | **PARCIAL — a metade do BUILD agora está provada, a do ANEXO não** | Só `linux-x64` tinha sido validado por execução REAL neste sandbox (`build:bin`+`smoke:bin` verdes, repetidamente, incluindo os dois bugs acima achados rodando o binário compilado de verdade); os outros quatro foram raciocinados lendo o código-fonte do `node-pty`, nunca executados numa máquina real daquele SO. A primeira tag real veio em **2026-09-04 (`v4.0.0`)** e resolveu a metade do build: `linux-x64`, `linux-arm64`, `darwin-arm64` e `win32-x64` construíram e passaram `smoke:bin` cada um no seu runner nativo — **Windows incluído**, com seus TRÊS arquivos nativos e o caminho de `worker_threads`, o candidato mais provável a quebrar. O que falhou foi o passo DEPOIS do build, igual nos quatro: o anexo rodou ~3m25s antes de o `release.yml` publicar a Release, então **nenhum binário foi anexado a Release nenhuma**. `darwin-x64` (`macos-13`) nem chegou a começar — na fila por 40+ min, uma questão separada e ainda não investigada sobre esse rótulo de runner. O anexo agora ESPERA a Release com um teto, então a próxima tag final é o que prova o anexo e o `darwin-x64` | `.github/workflows/build-runner-binaries.yml` (matriz de 5 alvos, cada um no seu runner nativo; o passo "Anexar à GitHub Release" carrega a corrida medida); a tabela de matriz de alvos do ADR 0112 tem o estado exato por plataforma |

Nenhum fallback por plataforma (a alternativa mais barata "binário + pasta
`node-pty-native/`", oferecida explicitamente ao dono do produto e recusada por
ele) foi implementado em lugar nenhum — nada encontrado nesta investigação
DESMENTIU a abordagem de arquivo único de verdade para nenhum dos cinco alvos.
Se um build de tag real mostrar que um deles genuinamente não funciona assim
(o Windows é o candidato mais provável), isso vira um item NOVO, de uma
plataforma só, aqui — não algo para adivinhar e contornar preventivamente
hoje. O build da `v4.0.0` respondeu isso: nenhum fallback por plataforma é
necessário nos quatro que rodaram, Windows incluído, e o único item que ele
produziu não é por plataforma — é o passo de anexo correndo contra o
`release.yml`.

**O que fica para depois — backlog priorizado pelo dono do produto, nesta
ordem:**

| item | custo | critério de ativação | onde foi decidido |
|---|---|---|---|
| Exclusividade do runner por `{project_id, machine_id}` em vez de só `project_id` (`apps/engine/lib/engine/runners/registry.ex`) | M | ADIADO — critério de ativação explícito: um segundo dev usando de fato o mesmo projeto ao mesmo tempo | ADR 0104 |
| Assinatura de código dos binários standalone (notarização no macOS, Authenticode no Windows) | M | ação do operador — exige que o dono do produto obtenha/custeie uma identidade de assinatura, mesma categoria do `NPM_TOKEN` no ADR 0106 | ADR 0112 |
| Anexar os binários a uma Release, e o `darwin-x64` rodar de todo — o BUILD está provado em quatro plataformas desde a `v4.0.0` (2026-09-04), o anexo em nenhuma | — | acontece automaticamente na próxima tag `vX.Y.Z`, agora que o passo de anexo espera a Release em vez de ler a ausência dela no primeiro instante. O `darwin-x64` depende de um runner `macos-13` ser agendado algum dia | ADR 0112 |

`apps/runner/src/guard.ts` (checagem léxica best-effort do `cwd`) **não é
item de backlog** — é uma invariante declarada desde o ADR 0103 e
REAFIRMADA pelo ADR 0104: a fronteira de segurança real do runner é
autenticação + o pipeline de aprovação de sempre + consentimento do usuário,
nunca sandbox.

## Backlog do modelo de time (ADR 0085) — AUDITORIA FECHADA {#backlog-of-the-team-model-adr-0085--audit-closed}

Saída da auditoria `fluxo.yml` × código
([auditoria-fluxo-vs-codigo.md](auditoria-fluxo-vs-codigo.md)). Eram itens
declarados no modelo (`docs/fluxo.yml`) sobre papéis já **ativos** — nenhum
esperava algum papel `proposto`/`planned` ativar primeiro. As seis ondas
do plano fecharam, e esta tabela agora está **vazia**: o último item (B4, o PO
ler `metricas-de-produto`) fechou com a RN-407, sem ADR novo — o mesmo padrão
já estabelecido pela RN-164 (leitura de agente escopada ao projeto, sem
efeito externo). O documento da auditoria tem o plano de ondas completo,
com custo e critério de verificação por item, para quem quiser o histórico.

**Fechados desde a auditoria** (não removidos da referência original, só desta
tabela de pendências): o gate `implementavel` (B3, ADR 0090); `docs/gates.yml`
desatualizado em `paralelismo-autorizado` (A1/B5, corrigido junto com A3–A5/A8
— citações de RN e rótulos errados em `fluxo.yml`); deployment frequency e lead
time reais via `analise:funil` (parte de B7, ADR 0089) — o resto de B7 (MTTR,
change failure rate) não fechou: continua declarado como lacuna PERMANENTE em
`fluxo.yml` (papel `delivery-metricas`), não pendência de engenharia; a delegação
Dev Lead → dev (B1) e a RN-160 sem revalidação no backend (A6/B6) — Onda 2 da
auditoria, ADR 0094, RN-404/405; o gate `necessidade-validada` (B2) — Onda 6
(a última) da auditoria, ADR 0095, RN-406; **métricas de produto → PO (B4)** —
o relatório (`analise:funil`, ADR 0089) já existia, faltava só o PO LER
`metricas-de-produto`; fechado com a ferramenta `listar_metricas_de_produto`
e as funções puras extraídas para
`apps/api/src/application/services/funil-metrics.ts` (RN-407) — a última
pendência da tabela, encerrando a auditoria.

## Backlog da revisão externa (2026-08-28) {#external-review-backlog-2026-08-28}

Uma revisão externa, de leitura estática (`melhorias-brabo-2026-08-28.md`,
raiz da árvore de trabalho, nenhuma suíte executada), propôs 15 itens.
Conferidos contra este arquivo, a
[tabela de dívida técnica](../architecture.md#divida-tecnica) de
`architecture.md`, [achados-execucao-real.md](achados-execucao-real.md), o ADR
0020 e o ADR 0027, além da própria árvore de trabalho. Mesma regra do resto
deste documento: **nenhum P1/P2/P3 inventado aqui** — o custo abaixo é a
estimativa do próprio revisor (P = uma sessão, M = uma fase pequena, G = fase
própria com ADR), não um ranking de prioridade, e a decisão de prioridade é do
usuário.

### Genuinamente novos (sem registro anterior em lugar nenhum) {#genuinely-new-no-prior-record-anywhere}

| item | custo | evidência | nota |
|---|---|---|---|
| ~~Checksum nos binários baixados pela CI (gitleaks, hadolint, actionlint, kustomize, kubeconform) + GitHub Actions pinadas por SHA de commit em vez de tag~~ | P | `.github/workflows/ci.yml` tinha zero verificação `sha256sum`/checksum; toda action era pinada por tag mutável | **FEITO** ([#408](https://github.com/daneiel/brabo/pull/408) + [#419](https://github.com/daneiel/brabo/pull/419)) — `sha256sum -c` depois de todo `curl` em `ci.yml` e em `docker/engine/Dockerfile` (a imagem de dev; o `Dockerfile.prod` já fazia isso). Os pins levaram dois PRs, e o motivo é o achado: o #408 moveu as 9 actions **do `ci.yml`** para SHA de commit e esta linha lia como se fossem todas — os outros 15 workflows ficaram em tags mutáveis, incluindo os quatro que carregam credencial (`release.yml` → GHCR, `publish-runner.yml` → npm, `tag-release.yml`, `docs-deploy.yml` → `gh-pages`). O #419 pinou os 49 `uses:` restantes e acrescentou o mecanismo que faltava: `scripts/ci/actions-pinadas.ts` reprova o job `lint` em qualquer action pinada por tag, ou qualquer SHA sem o comentário de versão. Documentado em [cadeia-de-suprimentos-do-ci.md](cadeia-de-suprimentos-do-ci.md), que também declara o que ainda é confiado na fé (sem Dependabot, sem proveniência de dependências, sem assinatura de artefatos) |
| ~~Pinar `ollama/ollama:latest` nos dois composes~~ | P | `docker/docker-compose.yml:81,118` e `docker/docker-compose.prod.yml:328,346` eram a única imagem sem pin em qualquer dos dois arquivos | **FEITO** ([#401](https://github.com/daneiel/brabo/pull/401) + [#419](https://github.com/daneiel/brabo/pull/419)) — pinada em `ollama/ollama:0.33.1` nos 4 lugares de compose; um **quinto**, `deploy/k8s/base/ollama/job-model-loader.yaml`, estava fora da evidência do revisor (que só nomeava os composes) e ficou em `latest` até o #419 |
| ~~Gerar `apps/web/src/lib/api-types.ts` do export de OpenAPI em vez de copiar à mão~~ | M | `apps/api/src/scripts/export-openapi.ts` existe; nenhum script `openapi:types` e nenhuma dependência `openapi-typescript` em lugar nenhum; o próprio cabeçalho de `api-types.ts` diz que é espelhado à mão | **FEITO** ([ADR 0116](../adr/0116-tipos-do-web-gerados-do-openapi.md)) — só `ActionType` migrou (o tipo com custo de produção provado e repetido), não o arquivo inteiro: `lib/api-types.generated.ts` agora é gerado pelo `openapi-typescript` a partir de `docs/reference/openapi.json`, e `lib/api-types.ts` reexporta `ActionType` dele. `lib/aprovacoes.test.ts` fica, estreitado às asserções de conteúdo que o compilador não faz (a exaustividade agora é checada pelo `tsc` via `Record<ActionType, ...>`) |
| ~~E2E em navegador real (Playwright) para o caminho crítico — auth por cookie, CSRF, o ticket do socket Phoenix, streaming~~ | M | nenhum `playwright.config.*`, nenhum `e2e/`, nenhuma dependência `@playwright/test` em lugar nenhum do repositório | **FEITO** ([#420](https://github.com/daneiel/brabo/pull/420), [ADR 0120](../adr/0120-e2e-de-navegador-contra-o-compose-de-producao.md)) — `e2e/`, só chromium, rodando contra o compose de PRODUÇÃO que o `docker/smoke.sh` já sobe (`SMOKE_KEEP_UP=1`) e dentro do mesmo job `images`, já que as quatro imagens são a maior parte do tempo de relógio desse job. Dois specs, ambos provados por mutação: o caminho de cookie/CSRF/origem cruzada (incluindo sobreviver a um reload, a única forma de provar que o access token em memória foi RECONSTRUÍDO a partir do cookie) e o ticket de socket de uso único da RN-108, asserido sobre a URL de WebSocket observada e não sobre um indicador de status. `e2e/` não é membro do workspace — lockfile próprio, mesma forma do ADR 0117, pelo mesmo motivo de auditoria. Declarado como NÃO coberto: diferenças entre navegadores, aprovação inline e streaming |
| ~~Decompor `SessionPage.tsx` / `ProjectSettingsTab.tsx`~~ | G | `SessionPage.tsx` tinha 169 KiB com 25 arquivos de teste importando-o; `ProjectSettingsTab.tsx` tinha 90 KiB | **FEITO** ([ADR 0122](../adr/0122-sessionpage-dividido-em-cinco-prs.md) + [ADR 0124](../adr/0124-hook-do-canal-de-turno-do-sessionpage.md) + [ADR 0125](../adr/0125-projectsettingstab-dividido-por-secao.md)) — a metade `SessionPage.tsx` desta linha agora está COMPLETA ao longo de sete PRs no total. A decomposição mecânica em 5 PRs do ADR 0122 mergeou um de cada vez (cada um antes de o próximo começar, já que o arquivo estava sob mudança ativa): PR 1 — helpers puros de timeline/turno → `apps/web/src/lib/session-timeline.ts`. PR 2 — `StorySlide` → `apps/web/src/routes/StorySlide.tsx`. PR 3 — `StructuredQuestionCard` (mais seu helper privado `permiteOutra`) → `apps/web/src/routes/StructuredQuestionCard.tsx`. PR 4 — helpers da árvore de backlog (`urlDaPr`/`vinculoDeBacklog`/`montarArvoreDeBacklog`/`totalDeDescendentes`) → `apps/web/src/lib/session-backlog-tree.ts`, e `ItemDeBacklog` + `ContextAside` (a barra lateral direita inteira) → `apps/web/src/routes/ContextAside.tsx`. PR 5 — as seis derivações de prontidão (`criativoActive`/`arquitetoActive`/`hasBusinessRule`/`hasPromotedStory`/`hasProductBrief`/`activeAgent`) → um hook `useSessionReadiness` em `apps/web/src/lib/session-readiness.ts`, o único PR dos cinco que não foi uma mudança mecânica de arquivo — declarando o aglomerado de estado do canal de turno (`turnoViaCanal`/`statusAgent`/`pensandoVisivel`/`atividadeDoTurno`) explicitamente fora de escopo, para um ADR futuro próprio. O ADR 0124 é esse ADR, mais dois PRs: um PR mecânico de deduplicação (ele mesmo sem ADR) que fez `handleSend`/`handleReadiness`/`handleArchitectureReadiness` chamarem os já existentes `iniciarTurnoDoAgente`/`finalizarTurnoDoAgente` em vez de duplicar o braço deles inline, e então o PR de extração que moveu o estado, o efeito de canal `connectSessionHeartbeat` e as três funções de ciclo de vida para um hook `useTurnoDoAgente` em `apps/web/src/lib/session-turno.ts`. `SessionPage.tsx` foi de 3 807 para 2 479 linhas ao longo dos sete PRs; todos os 25 (agora 24, um migrado para um teste de `lib/` no PR 1) arquivos `SessionPage.*.test.tsx` passaram sem edição o tempo todo. **O ADR 0125 fecha a linha**, em UM PR e não cinco: `ProjectSettingsTab.tsx` (2 532 linhas) se divide em um arquivo por seção sob `apps/web/src/routes/settings/` — 17 seções mais um `settings/shared.ts` de dois símbolos (`ORIGIN_TONE`, `formatarCustoMicros`; os outros dez helpers de escopo de módulo tinham exatamente um chamador cada e foram para o arquivo desse chamador) — e FICA no seu caminho como entrada e barrel, com 77 linhas. O barrel é estrutural, não cosmético: `ProjectSettingsTab.test.tsx` importa 11 nomes do caminho e `ProjectPage.test.tsx`/`project-tabs.test.tsx` fazem `vi.mock` dele PELO CAMINHO. Um PR e não cinco porque o arquivo nunca teve o formato do `SessionPage.tsx` — o pai não guardava nada (17 filhos JSX, nenhum hook, nenhuma query, nenhum `t`, nenhuma checagem de papel), nenhuma seção recebia mais que `{projectId}` (duas não recebem props) e 11 das 17 já eram exportadas. As 6 seções privadas ganharam um `export` no próprio módulo (mecânico — o barrel precisa importá-las) mas deliberadamente NÃO são reexportadas pelo barrel, então a superfície pública da aba tem forma idêntica byte a byte. Suíte inteira do web verde — 142 arquivos, 1 537 testes — com ZERO arquivos de teste editados |
| ~~Conferir na própria CI as versões pinadas de ferramentas entre `ci.yml` e `Dockerfile.prod`~~ | P | `ci.yml:45-46` já afirmava por comentário que as versões precisam bater, mas nada o garantia | **FEITO** ([#408](https://github.com/daneiel/brabo/pull/408)) — passo novo no job `lint` faz grep nos dois arquivos e reprova qualquer divergência de `GITLEAKS_VERSION`/`HADOLINT_VERSION`/`ACTIONLINT_VERSION` |
| ~~Piso de cobertura (catraca no valor atual) na CI~~ | P–M | nenhuma flag `--coverage`/`--cover` e nenhum limiar configurado em nenhum `vitest.config.*` ou `mix.exs` em api/web/engine | **FEITO** ([#410](https://github.com/daneiel/brabo/pull/410)) — piso no valor medido (api 80/69/74/81, web 82/77/72/83, engine 78%, todos vitest/`mix test --cover`); nenhum `excoveralls` adicionado, pela regra de não instalar lib sem justificar |
| ~~Dividir `business-rules.md` por domínio; estender o padrão do `readme-version.ts` para gerar as contagens de RN/ADR em prosa em vez de digitá-las à mão~~ | M | `business-rules.md` tem 650 KB com **334** cabeçalhos `RN-XXX` indo até a RN-466 — `README.md:200` ainda diz "as 158 RNs", uma deriva muito maior do que texto envelhecendo explica; a contagem de ADRs (115) em `README.md:211` está certa por comparação, então só a contagem de RNs precisa de conserto hoje | **FEITO** ([#417](https://github.com/daneiel/brabo/pull/417) + [#418](https://github.com/daneiel/brabo/pull/418)) — nessa ordem, e a ordem é o ponto: o #417 ensinou o `docs:check` a ler a CONTAGEM do artefato (ADRs dos arquivos em `docs/adr/`, RNs dos cabeçalhos `### RN-NNN`, providers dos literais de `capabilities`) e compará-la com a prosa, que é o que impede a deriva de voltar. O #418 então dividiu por **TAMANHO, não por assunto** — Custo e Autenticação sozinhos eram metade da página — em `docs/business-rules/custo.md` e `docs/business-rules/autenticacao.md`, sem uma vírgula de conteúdo alterada e nenhuma âncora `{#rn-NNN}` renomeada; 293 links foram reescritos por script e a contagem continua 334. A numeração nunca reinicia por arquivo, e a checagem soma os três por glob |
| ~~Unificar `AGENTS.md`/`CLAUDE.md` (geração ou symlink + checagem)~~ | P | não eram idênticos byte a byte como se supunha — mesmo tamanho (35043 bytes), MD5 diferente; uma linha já divergia (`AGENTS.md:444` vs `CLAUDE.md:444`, cada uma referenciando o próprio nome de arquivo) | **FEITO** ([#402](https://github.com/daneiel/brabo/pull/402)) — a linha autorreferente ficou neutra nos dois, e então `AGENTS.md` virou symlink para `CLAUDE.md`; a divergência agora é impossível no nível do sistema de arquivos, não só detectada |
| ~~Higiene do repositório: tirar o bloco `KEYCLOAK_*` que sobrou no `.env` (já ausente do `.env.example`) e aposentar `migrate-keycloak-users.ts`; mover/arquivar `spike/session-engine` e `design_handoff_brabo/` para fora da raiz do repositório; ligar as portas publicadas do Neo4j a `127.0.0.1` no `docker-compose.prod.yml`~~ | P | o Keycloak foi removido desde a Fase 7 ([ADR 0032](../adr/0032-corte-do-keycloak-e-sessao-em-cookie.md)); `docker-compose.prod.yml:80-82` publicava `7474`/`7687` sem bind | **FEITO** ([#403](https://github.com/daneiel/brabo/pull/403)) — script e sua seção do runbook removidos, `spike/`/`design_handoff_brabo/` removidos da árvore (recuperáveis no commit `f5f771ac6`), Neo4j ligado a `127.0.0.1` em produção. A limpeza do `KEYCLOAK_*` no `.env` em si é local/gitignored, não uma mudança no repositório — continua com o usuário |
| ~~Containers de dev rodam como root; mapear o uid/gid do host em vez do contorno `sudo chown -R`~~ | M | nenhuma diretiva `USER` nos Dockerfiles de dev (api/web/engine); `README.md:160` e `getting-started.md` documentavam o contorno como fato aceito | **FEITO** ([#406](https://github.com/daneiel/brabo/pull/406)) — ver a nota detalhada em [Avulso](#standalone) acima; `DEV_UID`/`DEV_GID` mapeiam o container para o usuário do host, provado rodando a stack real |
| ~~Dar ao `website/` um lockfile próprio, fora do `pnpm audit` do produto~~ | M | `website` é membro do `pnpm-workspace.yaml` compartilhando o lockfile único; dos 13 overrides de segurança, 8 vêm de dependências do Docusaurus/website, 3 do lado do produto (`js-yaml` 5.x, `lodash`, `esbuild`), 1 é misto (`undici`, também usado pelo `jsdom` do próprio `apps/web`) | **FEITO** ([#414](https://github.com/daneiel/brabo/pull/414), [ADR 0117](../adr/0117-lockfile-proprio-para-o-website.md)) — auditar os 13 com `pnpm why <pkg> -r` achou a divisão mais bagunçada que esta estimativa: só 2 (`serialize-javascript`, `yaml@1.x`) eram exclusivos do website; 10, e não 1, se revelaram mistos (`mermaid`/`dompurify`/`uuid`/`postcss`/`nanoid` também resolvem por `apps/web`, `js-yaml`/`fast-uri`/`lodash` por `apps/api`) e ficam duplicados no `pnpm-workspace.yaml` e no novo `website/pnpm-workspace.yaml`; `esbuild` era o único puramente do lado do produto |

### Dívida já declarada, ainda sem custo {#already-declared-debt-still-uncosted}

Estas três já têm linha na
[tabela de dívida técnica](../architecture.md#divida-tecnica) de
`architecture.md` — a revisão não as descobriu, estimou um custo para algo já
registrado sem nenhum. **Uma das três já fechou**, e era a que a revisão
chamou de mais cara:

| dívida | já declarada em | estimativa de custo do revisor |
|---|---|---|
| ~~Publicar imagens num registry para que o deploy de produção seja executável de ponta a ponta~~ | `architecture.md:552`, [ADR 0027](../adr/0027-fase5-backup-hardening-release.md) | **FEITO** ([ADR 0119](../adr/0119-imagens-publicadas-no-ghcr-por-digest.md)) — as quatro imagens são publicadas no GHCR (públicas) a cada tag final, com o que cada tag publicou registrado POR DIGEST em `.release/images.json`; o overlay guarda o marcador e `make imagens-do-release` o aplica, então o repositório nunca declara qual release está em produção. Sem terceira exceção de push: o arquivo é asset da Release e vai no PR do CHANGELOG. Achado ao fazer, e que NÃO estava nesta estimativa: os overlays listavam três imagens, não quatro — o CronJob de backup herdava `brabo-backup:prod`, irresolvível em qualquer registry. Ainda não feito e não reivindicado: nada faz deploy automaticamente (`DEPLOY_ENABLED` continua não existindo), e assinatura/atestação de imagem fica de fora, junto com o item de assinatura de código dos binários do runner |
| Dividir `schema.ts` por agregado (o Drizzle suporta schema em vários arquivos com reexport) | `architecture.md:546` | M |
| Golden-set (5–10 casos, saída esperada frouxa, modelo pinado, allow-failure) para o caminho semântico do gate | `architecture.md:548`, [ADR 0020](../adr/0020-destravar-gates-qa-secops.md) | não estimado pelo revisor |

## O que esta triagem NÃO faz {#what-this-triage-does-not-do}

Não corrige nada. A disciplina que vem valendo desde a Fase 10 continua: cada
achado espera a fase que o endereça, e corrigi-lo fora dela apaga a evidência de
por que ele existia.

E não inventa prioridade onde não há dado: os itens do backlog anterior não
receberam P1/P2/P3 porque a decisão deles é de produto, não de engenharia — e
palpite vestido de classificação seria pior que a lista crua.
