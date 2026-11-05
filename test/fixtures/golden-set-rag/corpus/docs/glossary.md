---
id: glossary
title: Glossário
sidebar_label: Glossário
sidebar_position: 9
description: A linguagem ubíqua do Brabo — os termos que aparecem no código, nas telas e nos ADRs, com o sentido que têm aqui.
keywords: [glossário, linguagem ubíqua, harness, gate, handoff, DEK, outbox]
---

# Glossário

Os termos abaixo são **linguagem ubíqua**: o nome que aparece na tela é o
mesmo do código, do evento e do ADR. Vários deles existem em outros lugares
com sentido mais amplo — esta página diz o que significam **neste sistema**.

Ordenados por assunto, porque procurar "harness" sem saber que é conceito de
agente é raro; o caminho comum é chegar pelo tema.

---

## Sessão e evento

**Sessão** — uma conversa com efeito, do início ao fechamento. É a unidade de
trabalho, de custo e de rastreio: uma sessão é um trace raiz na
observabilidade e um escopo de orçamento. Passa por cinco estados
([RN-001](business-rules.md#rn-001)).

**Event log** — a tabela `session_events`. Append-only: nunca há `UPDATE`.
Toda linha tem um `seq` contínuo dentro da sessão. É a fonte de verdade do que
aconteceu, e o que torna rastreável a evidência do Psicólogo
([RN-002](business-rules.md#rn-002)).

**`seq`** — o número de ordem do evento dentro da sessão. Denso: começa em 1
e não tem buracos. Buraco no `seq` é corrupção, e a restauração falha por
causa dele.

**`closing`** — um estado **transitório**, não de repouso. Sessão parada em
`closing` quer dizer que o drain começou e não terminou; há alerta para isso.

**Órfã** — uma sessão `active` na api sem processo dono vivo no engine. É o
modo de falha que o graceful shutdown existe para eliminar; a definição
operacional está no [runbook](runbook.md#quando-a-sessao-escapa).

**Outbox** — o padrão *transactional outbox*. A api grava o evento e a
intenção de publicá-lo **na mesma transação**; o engine o consome depois, via
Oban. É o que impede "o evento foi gravado" e "o engine ficou sabendo" de
divergirem. Não há Redis — a fila mora no Postgres.

---

## Agentes

**Agente** — um processo de longa duração com papel e identidade. Onze papéis
canônicos hoje, definidos em `apps/engine/lib/engine/harness/agents.ex`:

| slug | papel |
|---|---|
| `criativo` | conduz a ideação com o usuário e emite regras de negócio |
| `po` | transforma o brief em backlog (épicos, histórias, tarefas) com DoD e DoR |
| `arquiteto` | decisões técnicas (ADRs), o mapa de módulos e o contrato entre módulos ([RN-684](business-rules.md#rn-684)) |
| `dev-backend` · `dev-frontend` | implementam; rodam num worktree isolado |
| `infra` | provisionamento, deploy e ambientes — **proativo**, não executor |
| `qa` | gate semântico: testes e critérios de aceite |
| `secops` | gate determinístico: segredos, segurança, conformidade |
| `psicologo` · `psicologo-leve` | analisam sessões e propõem hipóteses com evidência |
| `anamnese` | traça o perfil de proficiência do usuário e propõe instruction patches |

Os nomes são **papéis do produto**, com inicial maiúscula quando usados como
substantivo ("o Arquiteto propôs um ADR"). Os devs são **dinâmicos**: um agente
por módulo do `module_map`, não uma lista fixa.

**Contrato entre módulos** ([ADR 0200](adr/0200-contrato-entre-modulos-artefato-do-arquiteto.md)) —
o `artifact.module_contracts` versionado do Arquiteto: por módulo, o que ele
EXPÕE (função, rota, evento ou forma de dado, com a assinatura). O que ele
consome é o `dependsOn` do `module_map`. O dev agent o lê com
`listar_contratos_de_modulos` em vez do worktree de outro dev.

**Área** (Fase 8b/8c, [ADR 0038](adr/0038-hierarquia-de-agentes.md)) — `qa` e
`infra` da tabela acima viraram LEADs de área: continuam sendo o único contato
externo (mesmo slug, mesmo comportamento visto de fora), mas agora **delegam**
a subagentes — `qa-automacao`/`qa-performance-seguranca` (QA),
`infra-workflows` (Infra). Delegação é mecanismo INTERNO da área, nunca
handoff; o que a área devolve para fora continua sendo um artefato só
(`qa_verdict`, `open_infra_pr`) — quem consome nunca sabe que há mais de um
agente por trás.

**Harness** — o invólucro obrigatório de todo agente. Nenhuma chamada de LLM ou
de ferramenta acontece fora dele. Cinco peças:

| peça | faz |
|---|---|
| **PromptAssembler** | monta o prompt em **camadas ordenadas**, com orçamento de tokens por camada e truncamento **determinístico** — mesmo contexto, mesmo prompt |
| **ContextManager** | compacta quando o contexto cresce |
| **ToolLoop** | o laço pedido de ferramenta → execução → resultado, com teto de iterações |
| **InstructionFiles** | resolve os arquivos `AGENTS.md` em ordem crescente de precedência (raiz → diretório → banco) |
| **Hooks** | pontos de interceptação em volta do laço |

**Camada** (do prompt) — um bloco com `id`, conteúdo e política de
truncamento (`truncate_tail`, `keep_or_drop`, `drop_whole_units`). O orçamento
é por camada, e é isso que torna o truncamento previsível em vez de "o que
couber, coube".

**ToolLoop** — o laço do agente. Um turno é: monta o prompt → chama o modelo →
o modelo pede uma ferramenta → a ferramenta vira `proposed_action` → a
política decide → executa → o resultado volta ao contexto. Tem teto de
iterações; esgotado, o agente termina com um artefato de bloqueio.

**Turno (agente conversacional)** — uma rodada de trabalho de um dos agentes
conversacionais escopados à sessão (Criativo, PO, Arquiteto, Dev Lead, UX
Designer, Staff — desde o ADR 0088, dormente para disparo automático, mas
acionável por handoff manual — e, desde a
[RN-617](business-rules.md#rn-617), o Infra Lead): uma chamada em streaming ao
LLM mais o laço de ferramentas que ela dispara. Desde a
[RN-122](business-rules.md#rn-122) ele roda numa `Task` supervisionada
(`Engine.Agents.TurnoAssincrono`), não mais dentro do `handle_call` que recebeu
a mensagem — é isso que deixa o botão **"Parar"** do composer cancelar o turno
de verdade (mata a task, corta a conexão com a api) em vez de só parar a
renderização no cliente. Desde a [RN-578](business-rules.md#rn-578) o comando
que inicia um turno é respondido no ACEITE: o clique volta assim que a Task
sobe, e o fim do turno chega pelo canal da sessão e pelo event log, nunca por
essa resposta HTTP. Cada um tem teto PRÓPRIO de voltas do laço (Criativo e PO
12, Arquiteto, Dev Lead, UX Designer, Staff e Infra Lead 14) — é uma constante
no servidor do próprio agente, não o teto do `ToolLoop`
(`Engine.Harness.Iteracoes`), que vale para agentes de execução e de gate. O
Staff é o único sem `kickoff/1`: fica ocioso até a primeira `user_message`,
porque não há artefato de sessão de onde sintetizar uma abertura. Dos quatro
que existiam na época, o Criativo foi o último a ganhar o laço, pela
[RN-163](business-rules/autenticacao.md#rn-163): até ali ele chamava o modelo
uma vez por turno e prometia uma correção que nunca acontecia. Esse teto
próprio também deixou de ser calado: esgotado, emite o MESMO
`toolloop.limit_reached` ([RN-166](business-rules/autenticacao.md#rn-166)),
porque é o mesmo fato e quem lê o event log não deveria precisar de um segundo
nome para ele.

**Reidratação (agente conversacional)** — como o processo de um agente
conversacional reconstrói o histórico a partir do event log quando sobe sobre
uma sessão que já tem conversa (reinício, ou o PO assumindo depois do
Criativo). Um caminho só para os sete, `Engine.Agents.Reidratacao`
([RN-580](business-rules.md#rn-580)): lê a **cauda** (os últimos 200 eventos,
não os primeiros), traz de volta as perguntas estruturadas e as chamadas de
ferramenta do próprio agente, e, quando a conversa não cabe, abre com uma
mensagem de sistema que diz quantos eventos anteriores ficaram de fora.

**Handoff** — a passagem explícita de trabalho de um agente a outro. Explícita
porque o destino e o motivo ficam gravados no event log, em vez de um agente
"assumir" implicitamente o contexto de outro.

**Artefato** — a saída estruturada e validada de um agente. Doze schemas
fechados (`note`, `business_rule`, `product_brief`, `decision_record`,
`plano_de_teste`, `prototipo_navegavel`, `threat_model`, `task_blocked`,
`qa_verdict`, `secops_verdict`, `infra_delegation_files`): campo faltando
reprova a emissão. É como o veredito de um gate vira dado, não texto.
`business_rule` reprova por um segundo motivo: título já registrado no projeto
([RN-080](business-rules/custo.md#rn-080)) — como artefato é evento imutável,
a emissão é o único momento em que dá para recusar uma duplicata.

**Worktree** — `git worktree`: uma cópia de trabalho isolada por dev agent,
sobre o mesmo repositório. Dois devs mexem em branches diferentes sem pisar um
no outro. É por **agente**, não por tarefa: quem pega a próxima tarefa troca o
diretório, e é isso que obriga o agente a segurá-lo enquanto um gate ainda
precisa lê-lo.

**Modo do workspace** — onde o código de um projeto mora no disco, escolhido
na criação e **congelado** depois
([ADR 0072](adr/0072-projeto-local-ou-container.md),
[RN-169](business-rules/autenticacao.md#rn-169)). `container` é a pasta
gerenciada sob `PROJECT_WORKSPACES_ROOT` — o padrão e o comportamento de
sempre; `local` é um caminho absoluto do próprio usuário, que só funciona se
estiver montado no container. Não confunda com o **workspace** do IAM (o
agrupamento de projetos e membros): mesma palavra para coisas diferentes, e o
modo é sobre disco.

**Estados do dev agent** — `working` (implementando), `awaiting_approval`
(propôs commit/push/PR e há aprovação pendente — **nenhum gate abre sem PR**,
[RN-050](business-rules/custo.md#rn-050)), `awaiting_gate` (PR aberta,
esperando o veredito), `idle` (sem tarefa pegável, processo vivo) e
`idle_tripped` (circuit breaker disparado, só sai por rearme explícito —
[RN-047](business-rules/custo.md#rn-047)). Os três primeiros seguram o
worktree.

`idle` cobre **três** motivos diferentes, de propósito: a fila estava vazia, o
claim falhou e — desde a [RN-502](business-rules.md#rn-502) — o projeto não
tem container REGISTRADO `running`, o que para o claim antes de acontecer. Não
há um quarto status para esse último: `idle` é o único estado que um wake
ainda resgata, e toda guarda de `handle_info/2` é chaveada nele. O que
distingue os três é o EVENTO (`dev.idle`, `dev.error`,
`dev.blocked_by_container`), que é durável, nunca o status.

---

## Aprovação

**`proposed_action`** — toda ação com efeito externo (comando de terminal,
commit, push, PR, merge, gasto) **nasce** aqui, nunca executa direto.
São 23 tipos e 6 estados ([RN-003](business-rules.md#rn-003)).

**`permissions.json`** — o arquivo de política do projeto. Casa um padrão de
comando (estruturado, não substring) e devolve `allow`, `deny` ou
`require_approval`.

**`deny` vence `allow`** — a regra que atravessa o sistema inteiro. A decisão
avalia IAM → `agent_autonomy` → `permissions.json`, e `deny` em qualquer etapa
devolve na hora ([RN-004](business-rules.md#rn-004)).

**Teto** — um rebaixamento aplicado **depois** da política inteira, que
nenhuma configuração consegue promover. São dois: merge em branch protegida
([RN-006](business-rules.md#rn-006)) e instruction patch
([RN-007](business-rules.md#rn-007)). Teto é a diferença entre "não por
padrão" e "não".

**`agent_autonomy`** — o modo de operação de um agente no projeto: `manual`
(toda ação pede aprovação) ou automático. É a primeira chave a virar num
incidente de custo.

**Branch protegida** — `dev`, `qa`, `rc`, `main`. Merge em qualquer uma delas
é **sempre** decisão humana. A proteção equivalente na plataforma
(GitHub/GitLab) diverge entre providers e **não** é o portão — o portão é o
domínio
([ADR 0028](adr/0028-protecao-de-branch-divergencia-entre-providers.md)).

---

## Gates e execução

**Gate** — uma passagem obrigatória entre a PR do dev e o merge. Dois: **QA**
(semântico, roda LLM) e **SecOps** (determinístico, roda scanner). A ordem é
imutável: `awaiting_qa → awaiting_secops → awaiting_user`
([RN-014](business-rules.md#rn-014)).

**`awaiting_user`** — o estado terminal da máquina de gates. Terminal de
propósito: o sistema nunca mergeia.

**`changes_requested`** — o gate devolvendo trabalho ao dev, **na mesma
branch**. Não abre PR nova.

**Ciclo K** — o teto de correções por tarefa. Cada devolução consome uma
rodada; esgotado, a tarefa é bloqueada com motivo em vez de girar para sempre.
O subagente herda o teto do agente base ([RN-015](business-rules.md#rn-015)).

**`task_blocked`** — o artefato emitido quando uma tarefa trava: leva `reason`
e `diagnosis`. É registro legível de falha, não silêncio.

**Ciclo de gate estacionado** — um ciclo de QA/SecOps deixado `in_progress`
sem atividade por mais de 2 horas. O `GateRescuer` não o retoma mais sozinho
(no boot ou no tick): grava `gate.rescue_parked` e preenche `parked_at`, e só
um gesto humano o retoma — hoje `GateRescuer.retomar_estacionado/3` pelo
`bin/engine rpc` do operador
([ADR 0207](adr/0207-ciclo-de-gate-velho-estaciona.md),
[RN-722](business-rules.md#rn-722)). Ciclo cuja sessão tem aprovação pendente
de um ator do gate também não é reiniciado: ele está esperando você. Ciclo
`in_progress` RECENTE que o próprio reinício do engine matou não é estacionado
nem fica esperando o limiar de 15 minutos: no boot, quando nenhum nó do
cluster o tem em voo, o resgatador grava `gate.interrupted` e o reinicia na
hora ([RN-823](business-rules.md#rn-823)).

**Gate `implementavel`** — uma passagem PRÉ-DEV, antes de existir dev agent ou
worktree: o Dev Lead avalia se uma história é implementável a partir da
própria história e do `module_map` vigente (até o
[ADR 0192](adr/0192-plano-de-teste-depois-da-entrega.md) a entrada era o plano
de teste do QA-estratégia). `dono: dev-lead`, `aprovacao_humana: true`,
`severidade: warn`
([ADR 0090](adr/0090-qa-estrategia-e-appsec-segundo-momento.md)).

**QA-estratégia** — o `qa-lead` num segundo MOMENTO (mesmo processo, entrega
separada do veredito da PR): produz o **plano de teste** (síntese, critérios
executáveis, estratégia de automação) para a ENTREGA de UMA tarefa, DEPOIS de o
dev agent entregar — o primeiro passo da revisão `qa-verificada`, como entrada
dela, nunca um veredito próprio ([RN-674](business-rules.md#rn-674),
[ADR 0192](adr/0192-plano-de-teste-depois-da-entrega.md)). Nunca suspende —
nenhuma das ferramentas dele passa pelo pipeline de ações.

**AppSec** — o `secops` num segundo MOMENTO, na mesma forma que o QA-estratégia
tem sobre o `qa-lead`: o MESMO processo (`SecOpsAgentServer.run_design/2`)
produz um **threat model** STRIDE-lite sobre o DESENHO de uma história — sem
worktree, sem `task_id`, antes de existir código ou PR. Nunca aprova nem
reprova nada; termina emitindo `artifact.threat_model` e o passando ao
arquiteto, ao Dev Lead e à Infra. Disparado pelo `assess_implementability` do
Dev Lead, em paralelo, uma vez por história
([RN-360](business-rules.md#rn-360), [RN-539](business-rules.md#rn-539),
[ADR 0090](adr/0090-qa-estrategia-e-appsec-segundo-momento.md)).

---

## Backlog e arquitetura

**Regra de negócio (RN)** — uma unidade emitida pelo Criativo e ligada a
histórias. Regra sem história é **lacuna de cobertura**, não erro
([RN-011](business-rules.md#rn-011)).

**História** — quatro estados; sair de `draft` exige DoD, DoR, pelo menos um
requisito funcional e pelo menos uma regra ligada
([RN-010](business-rules.md#rn-010)).

**DoD / DoR** — Definition of Done e Definition of Ready. Aqui não são
cerimônia: sem as duas, a história não muda de estado.

**`module_map`** — o mapa de módulos do sistema, do Arquiteto. Define quantos
dev agents existem (um por módulo) e a que módulo cada história pertence. Não
pode ter ciclo ([RN-013](business-rules.md#rn-013)); módulo removido rebaixa
as histórias que dependiam dele ([RN-012](business-rules.md#rn-012)).

**Imagem do projeto (`artifact.project_image`)** — a decisão do Arquiteto sobre
qual container roda o código do projeto: uma imagem OCI (tag explícita
obrigatória, `latest` recusada), uma postura de rede (`none` por padrão,
`egress` autorizada) e um teto de recursos. Versionada no event log, como o
`module_map`. Enquanto ela não existe, o estado `sem_decisao` mantém a aba
Código fechada ([RN-105](business-rules/autenticacao.md#rn-105)).

---

## Custo

**Metering** — o registro do consumo por chamada em `token_usage`: tokens,
custo em micros, latência, modelo, agente. É **registro, não reembolso**.

**Orçamento** — um teto de gasto com escopo exclusivo: projeto **ou** sessão,
nunca os dois ([RN-017](business-rules/custo.md#rn-017)). Avisa em 70/90/100%
sem repetir.

**`policy`** — o comportamento do orçamento no teto: `block` recusa a chamada,
`allow` só registra. Projeto em `allow` **não para sozinho** — é a causa mais
comum de "o orçamento não segurou" ([RN-019](business-rules/custo.md#rn-019)).

**Binding** — o vínculo entre um escopo e um modelo de LLM. Resolve em
cascata: **sessão > agente > área > projeto > workspace**, o primeiro que
existir ([RN-020](business-rules/custo.md#rn-020)). É por isso que dá para pôr
um modelo caro só no QA. `area` é o PADRÃO que um lead e seus subagentes
compartilham, e o agente pode divergir dele
([RN-102](business-rules/custo.md#rn-102)).

**Faceta de capability** — o que o **provider declara** sobre um modelo: lê
imagem, gera imagem, faz thinking, aceita `tools`. Vem do catálogo remoto na
hora do sync; `false` quer dizer "não declarou", nunca "não faz"
([RN-056](business-rules/custo.md#rn-056)).

**Uso do modelo** — para que **este workspace** usa aquele modelo (`codigo`,
`documentacao`, `analise`, `imagem`, `conversa`). É opinião do operador, não
capability: nenhum catálogo publica "bom para código". Marcar um uso **não
habilita** o modelo no seletor ([RN-057](business-rules/custo.md#rn-057)).

---

## Psicólogo e Anamnese

**Hipótese** — a saída do Psicólogo: uma afirmação sobre o time com
`evidenceEventIds` apontando para eventos reais da sessão analisada. Sem
evidência válida ela não é gravada ([RN-021](business-rules.md#rn-021)).

**Causa de término** — classificação determinística de por que algo falhou:
`infra`, `modelo`, `código` ou `política`. Vem do motivo gravado, nunca do
julgamento do LLM e nunca por eliminação ([RN-023](business-rules.md#rn-023)).

**`proficiency_profile`** — o perfil de proficiência do usuário mantido pela
Anamnese, por competência. Seis competências de processo, **fechadas** (`git`,
`agile`, `arquitetura`, `testes`, `seguranca`, `infra`), mais as stacks
técnicas derivadas do `module_map`. Nada fora do catálogo tem caminho de
escrita ([RN-024](business-rules.md#rn-024)) — a Anamnese traça competência
técnica, não a pessoa.

**Sujeito elegível** — quem uma rodada da Anamnese pode perfilar: membro
EFETIVO do projeto (a linha do projeto, senão a do workspace), fora do
opt-out, com interação PRÓPRIA na janela. Sem ninguém, a rodada não faz
chamada de LLM ([RN-680](business-rules.md#rn-680)).

**Fato do perfil** (`FatoDoPerfil`) — uma hipótese do Psicólogo que a pessoa
dona da sessão ACEITOU, projetada no grafo a partir de
`psychologist.hypothesis_accepted` e entregue aos agentes que conversam com
ela como mensagem de sistema efêmera ([RN-680](business-rules.md#rn-680)).

**`instruction_patch`** — uma proposta versionada de mudar a instrução de um
agente. Nunca auto-aprovável ([RN-007](business-rules.md#rn-007)); a negada
não é reproposta ([RN-026](business-rules.md#rn-026)); o rollback cria versão
nova em vez de apagar ([RN-027](business-rules.md#rn-027)).

---

## Git e segredos

**GitProvider** — o contrato normalizado de doze operações que Local, GitHub e
GitLab implementam. Uma suíte de contrato só roda contra os três.

**Capability** — declaração do que aquele provider suporta. Operação não
suportada é recusada com erro explícito, nunca com falha silenciosa
([RN-028](business-rules.md#rn-028)).

**Bootstrap de Gitflow** — os seis passos que preparam o repositório (branches
permanentes, proteções, arquivos base). Idempotente e retomável: `skip` é
sucesso ([RN-029](business-rules.md#rn-029)).

**Envelope encryption** — todo segredo de usuário é cifrado com sua própria
**DEK** (data encryption key), e a DEK é "embrulhada" pela
`CREDENTIALS_MASTER_KEY`. Rotacionar a chave mestra reembrulha as DEKs sem
tocar no texto cifrado — é por isso que a rotação é interrompível
([runbook](runbook.md#rotacao-da-chave-mestra)).

**`wrapped_dek`** — a DEK embrulhada, como fica guardada no banco. **Não
identifica qual chave a embrulhou** — é essa propriedade que faz da rotação um
procedimento de três passos em vez de uma troca de variável.

---

## Infra

**Oban** — a biblioteca de filas do Elixir que usa o **Postgres** como
backend. A profundidade da fila (`oban_queue_depth`) é a métrica que move o
HPA do engine.

**Drain** — a fase `preStop` do engine: `/ready` vira 503, sessões novas são
recusadas e toda sessão do nó é oferecida a um par vivo. O que não for adotado
fecha como `closed_abnormally / node_shutdown` — término correto, não órfã.

**Adoção** — outro nó assumindo o processo de uma sessão. Acontece no drain
(repasse ativo) e no `SessionAdoptionWorker`, que varre a cada 30s para cobrir
`kill -9` e OOMKill, onde o `preStop` não roda.

**`:global`** — o registro distribuído do Erlang. Garante **um dono por sessão
no cluster inteiro**; sem cluster Erlang formado, cada réplica vira uma ilha
([ADR 0026](adr/0026-fase5-observabilidade-e-graceful-shutdown.md)).

**Trace raiz** — uma sessão = um trace, atravessando api ↔ engine. O
`traceparent` fica persistido em `sessions.trace_parent`, e é ele que se usa
para navegar no Tempo. O `trace_id` nasce no **web** (o navegador gera o
`traceparent`) e existe mesmo sem coletor: exportar é decisão separada de
instrumentar
([ADR 0035](adr/0035-observabilidade-legivel-e-trace-sem-coletor.md)).

**Caminho entre camadas** — a sequência de fronteiras que uma requisição
atravessa na api (`interfaces` → `application` → `infrastructure`), com a
duração de cada passo, emitida como **uma** linha de log por requisição. Vem
de um `AsyncLocalStorage` alimentado pelo decorator `@Traced`, não de um span
— é isso que a faz funcionar sem coletor. Ver
[observabilidade](explanation/observability.md).

**Camada** — no caminho acima, o rótulo da fronteira: `interfaces`,
`application`, `domain` ou `infrastructure`. Corresponde aos diretórios sob
`apps/api/src/` e à regra de dependência entre eles.
