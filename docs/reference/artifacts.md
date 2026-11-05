---
id: artifacts
title: Artefatos
sidebar_label: Artefatos
sidebar_position: 4
description: Os doze schemas de artefato validados no engine, quem pode emitir cada um e por que a maioria não é emitível pelo modelo.
keywords: [artifact, schema, emit_artifact, qa_verdict, business_rule, decision_record]
---

# Artefatos

Um artefato é a saída **estruturada e validada** de um agente. Concretamente:
um evento `artifact.<tipo>` no log, com o payload validado contra um schema
fechado antes de ser gravado.

Não existe tabela de artefatos. A validação acontece num lugar só —
`Engine.Harness.ArtifactSchemas` — e um campo obrigatório ausente **reprova a
emissão**, em vez de gravar um artefato pela metade.

## Quem pode emitir o quê

Esta é a distinção mais importante da página, e é fácil não vê-la:

| origem | significado |
|---|---|
| **ferramenta** | o modelo decide emitir, chamando `emit_artifact` |
| **servidor** | o código emite quando o desfecho acontece; o modelo não escolhe |

**Só três tipos são emitíveis por ferramenta:** `note`, `business_rule` e
`decision_record`. Todo o resto é emitido pelo servidor.

O motivo é o mesmo em todos os casos: quando o artefato é o **registro de um
desfecho**, deixar o modelo escolher se o emite é deixá-lo omiti-lo. Um
DevAgent que desiste não deveria poder decidir não registrar que desistiu.

**O tipo de sessão não filtra artefato nenhum.** A [RN-097](../business-rules/api.md#rn-097)
deu à sessão um `kind` (`consultiva` | `criativa`) e pôs uma guarda no append
de eventos, mas ela alcança **um** tipo — `execution.activated` — e nenhum
artefato é ele. Uma sessão consultiva grava `artifact.business_rule` do mesmo
jeito: o que ela não faz é entrar em execução. Quem chega à regra do tipo
tende a supor o contrário, e a suposição errada aqui apagaria o registro de uma
conversa inteira.

**O ESTADO da sessão filtra por ator.** Desde a [RN-581](../business-rules/api.md#rn-581)
uma sessão `closed`/`closed_abnormally` recusa conversa com 409, e "conversa"
inclui todo evento cujo ator é um agente conversacional — então um
`artifact.*` do Criativo, do PO, do Arquiteto, do Dev Lead, do UX Designer, do
Staff ou do Infra Lead não entra mais numa sessão fechada, enquanto os mesmos
tipos de artefato emitidos pelo Psicólogo, que roda **sobre** a sessão
fechada, entram. Quem decide nunca é o tipo; é o ator.

## Os schemas

### `note` — ferramenta

| campo | obrigatório |
|---|---|
| `title` | ✅ |
| `body` | ✅ |

### `business_rule` — ferramenta

| campo | obrigatório |
|---|---|
| `title` | ✅ |
| `description` | ✅ |
| `origin` | ✅ — **lista não vazia** |

`origin` referencia os eventos da conversa que originaram a regra. Lista vazia
reprova: ela é a rastreabilidade da regra até onde foi enunciada, e sem ela a
regra vira uma afirmação sem procedência.

:::caution O modelo precisa SABER os nomes dos campos
A descrição da ferramenta `emit_artifact` é gerada a partir destes schemas
(`ArtifactSchemas.required/1`) e nomeia cada campo obrigatório, em inglês, com
um exemplo preenchido.

Não é preciosismo: a descrição anterior dizia apenas "emite um artefato
tipado" e listava os tipos. Numa execução real o modelo — conversando em
português — chutou `titulo`/`descricao`/`comportamento`, e as **quatro regras
de negócio daquela conversa foram rejeitadas em silêncio**. `origin` como texto
livre também reprova: tem de ser lista, e a descrição diz isso com todas as
letras ([RN-061](../business-rules/engine.md#rn-061)).
:::

### `decision_record` — ferramenta

| campo | obrigatório |
|---|---|
| `context` | ✅ |
| `options` | ✅ — lista |
| `choice` | ✅ |
| `consequences` | ✅ |

O "ADR resumido" que qualquer um dos seis agentes conversacionais pode emitir —
Criativo, PO, Arquiteto, Dev Lead, UX Designer e Staff carregam `emit_artifact`
com este tipo ([RN-505](../business-rules/engine.md#rn-505)). Sem validação entre
campos de propósito: `choice` não precisa coincidir literalmente com uma das
`options` — texto livre é mais robusto, e o schema genérico só confere a
presença das chaves, a mesma régua de `note`/`business_rule`.

Ele reusa o padrão **genérico** em vez do dedicado
(`artifact.project_image`/`artifact.c4_diagram`, versionado, schema TS próprio,
rota HTTP própria): uma decisão é append-only por natureza, não um valor
"vigente" que se substitui. Ele é deliberadamente distinto de `open_adr_pr`
(só do Arquiteto, commita um arquivo real em `docs/adr/*.md` e abre uma PR real
com aprovação humana obrigatória) — os dois coexistem para escalas diferentes
de decisão: `decision_record` é sem atrito, pesquisável no log da sessão, para
qualquer decisão relevante; `open_adr_pr` é para quando a decisão é grande o
bastante para virar documento real do repositório.

### `open_question` — ferramenta própria

| campo | obrigatório |
|---|---|
| `questionId` | ✅ — uuid, gerado pela ferramenta |
| `pergunta` | ✅ — até 500 caracteres |
| `afeta` | ✅ — `{regras, historias, tarefas}`, listas de ids |
| `sugestao` | opcional — até 300 caracteres |

Uma dúvida que um agente deixa para o usuário (ADR 0214,
[RN-862](../business-rules/engine.md#rn-862)). Não é emitível por `emit_artifact`:
só o Criativo, o PO, o Arquiteto e o Dev Lead a emitem, pela ferramenta própria
`declare_open_question`, que grava também `autor` e `sessionId`. A api a fecha
com `open_question.answered`.

### `product_brief` — servidor

| campo | obrigatório |
|---|---|
| `title` | ✅ |
| `summary` | ✅ |
| `rules` | ✅ |

Validável, mas **não** emitível por ferramenta. O servidor do Criativo o emite
só depois de você confirmar a prontidão — nunca por uma chamada de ferramenta
do modelo.

Desde o [ADR 0185](../adr/0185-estou-pronto-fecha-os-dois-gates.md) o clique
que o pede — "Estou pronto — a necessidade está validada" — grava também
`necessity.validated` com `productBriefId: null`: o brief é o próximo
`product_brief` depois daquele `readiness.confirmed`, e o handoff que o leva ao
PO é aceito em nome de quem clicou
([RN-657](../business-rules/api.md#rn-657), [RN-658](../business-rules/api.md#rn-658)).

### `task_blocked` — servidor

| campo | obrigatório |
|---|---|
| `taskId` | ✅ |
| `agentId` | ✅ |
| `reason` | ✅ |
| `diagnosis` | ✅ |

Emitido quando o DevAgent desiste da tarefa: uma suíte que não fecha, teto de
iterações, orçamento estourado ou parada sem sinalização. É o registro do
desfecho.

### `qa_verdict` e `secops_verdict` — servidor

| campo | obrigatório |
|---|---|
| `veredito` | ✅ — `approved`, `changes_requested` ou `needs_user_decision` ([RN-862](../business-rules/engine.md#rn-862)), nada mais |
| `resumo` | ✅ |
| `itens` | ✅ |
| `taskId` **ou** `prActionId` | ✅ — exatamente um |
| `coverageMatrix` | opcional, só QA |

Três validações a mais moram aqui:

**O veredito é fechado** nos mesmos valores da máquina de estados de gate da
api. Um valor fora disso faria o caso de uso explodir mais adiante — recusar o
artefato na emissão é o lugar certo de falhar.

**O sujeito é exclusivo.** Um veredito é sobre **uma** tarefa de dev
(`taskId`) ou sobre **uma** PR de infra (`prActionId`) — nunca os dois, nunca
nenhum. Mesmo tipo de artefato, consumidores diferentes.

**`coverageMatrix` é opcional de propósito.** Um veredito de QA sem matriz de
cobertura continua sendo um veredito válido; perdê-lo inteiro por um campo
ausente seria pior do que gravá-lo incompleto.

O SecOps é determinístico — não tem LLM. O veredito de QA nasce da ferramenta
`emit_qa_verdict`, cobrada à parte. Em nenhum dos dois casos o modelo escolhe
emitir.

### `infra_delegation_files` — servidor

| campo | obrigatório |
|---|---|
| `files` | ✅ — lista **não vazia** |
| `summary` | ✅ |

Resultado de UM delegado da área de Infra (Fase 8c, ADR 0038) — o próprio lead
(Dockerfiles/compose) ou o subagente de Workflows (pipeline de CI). O
`InfraLeadServer` o emite depois que cada delegado termina, só para ter um
`parecer_artifact_id` a referenciar na tabela `delegations` — nunca visto de
fora da área. O que a api vê é a PR consolidada, via `open_infra_pr` (o mesmo
mecanismo de sempre, intocado pela Fase 8c).

`files` vazio reprova pelo mesmo motivo de `nada_a_validar/1` no
`InfraGateRunner` (ADR 0021): um delegado sem arquivo nenhum não terminou
nada, e "vazio" nunca deve passar por "feito".

### `prototipo_navegavel` — ferramenta (`propose_prototype`, não `emit_artifact`)

| campo | obrigatório |
|---|---|
| `personas` | ✅ — lista **não vazia** |
| `jornadas` | ✅ — lista **não vazia** |
| `prototipo` | ✅ — `telas` não vazia |
| `resumo` | ✅ |

O protótipo que o UX Designer produz (ADR 0087), a partir da
`necessidade-de-negocio` do Criativo. Não é `note`/`business_rule` — o UX
Designer emite via `propose_prototype`, uma ferramenta DEDICADA
(`Engine.Agents.UxDesignerTools`), e este módulo só valida a FORMA, o mesmo
mecanismo do `product_brief`: validável aqui sem estar na lista de tipos
emitíveis via `emit_artifact`.

`personas`/`jornadas` vazias, ou um `prototipo` sem tela nenhuma, reprovam
pela mesma regra de `business_rule.origin` (a tabela de `business_rule` acima): artefato sem conteúdo
não vale o registro. Um `propose_prototype` bem-sucedido encerra o turno (o
mesmo raciocínio de `propose_execution_plan`/`propose_infra_pr`) — sem
`proposed_action`, sem suspensão: propor um protótipo não tem efeito externo.

### `plano_de_teste` — servidor

| campo | obrigatório |
|---|---|
| `storyId` | ✅ |
| `taskId` | ✅ — desde o [ADR 0192](../adr/0192-plano-de-teste-depois-da-entrega.md) |
| `planoDeTeste` | ✅ |
| `criteriosExecutaveis` | ✅ — lista **não vazia** |
| `estrategiaDeAutomacao` | ✅ |

O entregável do QA-estratégia (ADR 0090; `packages/contracts/fluxo.yml`, papel
`qa-estrategia`, o segundo momento do `qa-lead`). Desde o
[ADR 0192](../adr/0192-plano-de-teste-depois-da-entrega.md)
([RN-674](../business-rules/engine.md#rn-674)) ele é o plano de teste da ENTREGA de
UMA tarefa, escrito DEPOIS que o dev agent entregou, sobre o worktree do dev e
os arquivos que a entrega tocou: é o primeiro passo do ciclo `qa-verificada`
(`QaLeadServer.run_area/3`), consumido como ENTRADA pela subespecialidade de
Automação, e reencontrado por `taskId` na rodada de correção. Até o ADR 0192
ele era emitido ANTES do dev e alimentava o gate `implementavel`. Ele nasce de
`emit_plano_de_teste`, mas o modelo não emite o artefato direto —
`Engine.Gates.QaEstrategiaAgent` extrai o resultado da chamada de ferramenta e
chama `ArtifactEmitter.emit/5`, o mesmo padrão de `qa_verdict`/`task_blocked`.

`criteriosExecutaveis` vazio reprova pelo mesmo motivo de
`infra_delegation_files`: um plano sem critério nenhum não é plano.

### `threat_model` — servidor

| campo | obrigatório |
|---|---|
| `storyId` | ✅ |
| `threatModel` | ✅ |
| `requisitosDeSeguranca` | ✅ |

O "segundo momento" do SecOps (RN-360, ADR 0090) — um checklist STRIDE-lite
sobre o DESENHO de uma história, antes de existir código, o mesmo padrão de
segundo momento do `qa-estrategia`. `Engine.Gates.SecOpsAgentServer.run_design/2`
emite depois que `Engine.Gates.AppSecAgent.run/3` (sem `Terminal`, sem
`Diff`/`Scanner`/`DevAgentState`) termina o laço com `emit_threat_model` — o
modelo não escolhe emitir, o servidor emite quando o laço acaba.

`riscos` fica fora dos campos obrigatórios: lista vazia é resposta válida (nem
toda história carrega risco residual) e a ferramenta já garante que a CHAVE
existe — não há "esquecido" a distinguir de "nenhum".

O artefato é sempre gravado, mas os HANDOFFS que o levam não: desde a
[RN-636](../business-rules/engine.md#rn-636) o AppSec o oferece só a um destino
(`arquiteto`, `dev-lead`, `infra`) que não tem oferta pendente e não está
ativo no projeto. O threat model de uma segunda história fica no log sem oferta
própria — a primeira oferta, ainda pendente, não é substituída
([ADR 0182](../adr/0182-ciclo-de-vida-do-handoff.md)).

## Artefatos que não passam por aqui

Alguns tipos de evento `artifact.*` existem no log sem estar neste registro,
porque são emitidos pela **api**, não pelo engine:

| evento | origem |
|---|---|
| `artifact.module_map` | o Arquiteto, via caso de uso na api — cada módulo pode carregar `resources` (cpus, memoryMb, pidsLimit), e a Infra sobe o container com a SOMA deles ([ADR 0199](../adr/0199-recurso-minimo-derivado-do-module-map.md), [RN-683](../business-rules/api.md#rn-683)) |
| `artifact.insight` | análise, via caso de uso na api |
| `artifact.project_image` | o Arquiteto, via caso de uso na api ([ADR 0065](../adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md), [RN-105](../business-rules/api.md#rn-105)) |
| `artifact.module_routing` | o Arquiteto, via caso de uso na api — uma imagem candidata por módulo do `module_map` vigente; o Arquiteto CANDIDATA, a Infra ELEGE num passo posterior ([ADR 0131](../adr/0131-roteamento-de-modulos-para-infra.md), [RN-487](../business-rules/api.md#rn-487)) |
| `artifact.module_contracts` | o Arquiteto, via caso de uso na api — por módulo do `module_map` vigente, o que ele EXPÕE; lido pelos dev agents por `listar_contratos_de_modulos` em vez do worktree de outro módulo ([ADR 0200](../adr/0200-contrato-entre-modulos-artefato-do-arquiteto.md), [RN-684](../business-rules/api.md#rn-684)) |

Eles têm validações próprias no domínio da api. A assimetria é histórica, e
está registrada como
[dívida técnica](../architecture.md#divida-tecnica): o ideal seria todo
`artifact.*` passar por um registro único.

## Quando a validação falha

| erro | causa |
|---|---|
| `{:unknown_type, tipo}` | tipo fora dos doze |
| `{:missing_keys, [...]}` | campos obrigatórios ausentes, todos nomeados |
| `:origem_invalida` | `business_rule.origin` vazio ou não é lista |
| `{:sujeito_invalido, chaves}` | veredito com os dois sujeitos, ou com nenhum |
| `{:veredito_invalido, valor}` | veredito fora de `approved` / `changes_requested` / `needs_user_decision` |
| `:invalid_payload` | o payload não é um mapa |

A falha volta ao agente como resultado da ferramenta. Um modelo que emite um
artefato malformado recebe o erro e pode corrigi-lo — dentro do teto de
iterações do ToolLoop.
