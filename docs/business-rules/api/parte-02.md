---
id: rn-api-parte-02
title: 'Regras de negócio — API — parte 2 (desde RN-055)'
sidebar_label: 'API — parte 2 (desde RN-055)'
description: 'As RNs hospedadas na raiz api.'
keywords: [regras de negócio, api]
---

# API — parte 2 (desde RN-055)

## Credenciais {#credenciais}

Chave de LLM e token de git do usuário vivem na mesma tabela
(`user_credentials`), sob o mesmo envelope encryption. Esta seção vale para as
duas.

<a id="rn-055"></a>

### RN-055 — Credencial é sempre cifrada e gravada; verificar é ação à parte, com três respostas {#rn-055}

O cadastro **não julga a credencial**: cifra e grava, mesmo que o provider
fosse recusá-la. Verificar é uma ação explícita sobre a credencial **já
gravada** — a api decifra, chama o provider e devolve só o veredito. O texto
plano nunca volta em resposta nenhuma, nem em pedaço, nem no motivo da recusa.

Era o contrário: o cadastro testava antes de persistir e recusava a gravação
([ADR 0004](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0004-git-credential-registration.md), estendido às chaves de
LLM na Fase 11a). O modo de falha real foi o oposto do previsto — como o campo
é write-only e a tela nunca reexibe o que foi digitado, uma recusa deixava o
usuário **sem credencial e sem o texto para corrigir**.

O veredito tem **três** valores, e o terceiro é obrigatório:

| | quando |
|---|---|
| `ok` | o provider aceitou |
| `recusado` | o provider rejeitou — carrega o motivo **dele** |
| `nao_suportado` | não há endpoint de teste verificado (`ollama`, `anthropic`, `openai`) |

Sem `nao_suportado`, um provider cujo tester é NO-OP voltaria `ok` e a tela
afirmaria uma verificação que nunca aconteceu. É a regra de capability do
[ADR 0041](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)
aplicada aqui: só se declara o que foi provado. Por isso o port declara
`supports()` — o silêncio de `test()` sozinho é ambíguo.

Chave ruim **não é exceção HTTP**: o caso de uso captura
`LLMCredentialConnectionTestFailedError`/`GitCredentialConnectionTestFailedError`
e devolve resultado, com 200. A única exceção é não existir credencial para
(usuário, provider) — 404, porque aí não há o que testar.

- **Onde:**
  `src/application/use-cases/credentials/test-stored-credential.use-case.ts`,
  `src/application/use-cases/llm/upsert-user-credential.use-case.ts`,
  `src/application/use-cases/git/register-git-credential.use-case.ts`,
  `src/application/ports/llm-credential-connection-tester.port.ts`
  (`supports`)
- **Teste:**
  `test/application/use-cases/credentials/test-stored-credential.use-case.spec.ts`
  (os três resultados, o despacho git×LLM, o 404 e a ausência do segredo na
  resposta); `test/application/use-cases/llm/upsert-user-credential.use-case.spec.ts`
  e `test/application/use-cases/git/register-git-credential.use-case.spec.ts`
  (a gravação incondicional, que é a inversão)
- **Origem:** [ADR 0050](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0050-credencial-sempre-cifrada-verificacao-explicita.md)

---

<a id="rn-056"></a>

### RN-056 — Faceta de capability vem do provider; silêncio preserva o que estava {#rn-056}

`supports_vision`, `supports_reasoning` e `generates_image` são **fato do
provider**, não opinião: saem do catálogo remoto no sync, com o mesmo fallback
de `supports_tool_calling` — remoto, depois local, depois `false`.

No OpenRouter (o único que publica isso hoje) as três saem de:
`architecture.input_modalities` contém `image`,
`supported_parameters` contém `reasoning`, e
`architecture.output_modalities` contém `image`. Aceitar imagem e **produzir**
imagem são eixos distintos: fundi-los mandaria o usuário para o modelo errado.

Antes, o sync lia `supportsVision` do que já estava GRAVADO e nunca consultava
o remoto — a coluna nascia `false` e não havia caminho para virar verdadeira.
Os 338 modelos do primeiro sync real ficaram todos `false`, incluindo 181 que o
provider declara como multimodais.

**Ausência de declaração não é declaração de ausência**
([ADR 0041](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)): o
parser OMITE o campo quando o provider se cala, e `undefined` preserva o valor
local. Por isso a tela usa as facetas só como filtro POSITIVO e nunca escreve
"não lê imagem" — `false` aqui quer dizer "o provider não declarou".

- **Onde:** `src/infrastructure/llm/openrouter-provider.ts`
  (`temModalidade`, `parseCatalogoOpenRouter`),
  `src/application/use-cases/llm/sync-model-catalog.use-case.ts`,
  `src/db/schema/llm.ts` (`models`)
- **Teste:**
  `test/infrastructure/llm/openrouter-provider.contract.spec.ts`
  (`modalidade não declarada OMITE o campo em vez de afirmar false`);
  `test/application/use-cases/llm/sync-model-catalog.use-case.spec.ts`
  (`catálogo que se cala sobre modalidade preserva a faceta gravada`)
- **Origem:** [ADR 0051](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0051-facetas-de-capability-e-curadoria-por-uso.md)

<a id="rn-057"></a>

### RN-057 — "Para que serve" é curadoria do workspace, e marcar uso não liga o modelo {#rn-057}

Nenhum catálogo de provider publica "bom para código". Isso é **opinião de quem
opera**, descoberta usando — então mora em `workspace_models.uses`, ao lado da
outra decisão do workspace ([RN-052](parte-01.md#rn-052)), e não em `models`.

Vocabulário FECHADO — `codigo`, `documentacao`, `analise`, `imagem`,
`conversa` —, com prova de exaustividade em tempo de compilação nos dois lados.
Texto livre daria `code`, `coding` e `código` no mesmo filtro em uma semana.

Duas regras que mantêm os eixos separados:

1. **Marcar uso não liga o modelo.** `workspace_models.is_active` tem DEFAULT
   `true`, então a linha criada por uma marcação de uso é inserida com
   `is_active = false` explícito. Sem isso, opinar sobre um modelo o autorizaria
   a gastar, contra a [RN-043](parte-01.md#rn-043).
2. **Trocar o uso não desliga o que estava ligado.** `is_active` fica fora do
   `SET` do `ON CONFLICT`.

A lista de usos **substitui** a anterior, não soma: lista vazia é como se
desmarca tudo, e é um estado legítimo — "ninguém opinou" não é "não serve".

- **Onde:** `src/domain/llm/model-uses.ts`,
  `src/db/schema/llm.ts` (`workspace_models.uses`),
  `src/infrastructure/persistence/drizzle/workspace-model.repository.ts`
  (`setUses`),
  `src/application/use-cases/llm/set-model-uses.use-case.ts`
- **Teste:** `test/application/use-cases/llm/set-model-uses.use-case.spec.ts`
  (`marcar uso NÃO liga o modelo — a linha nova nasce inativa`,
  `trocar o uso não desliga o que já estava ligado`,
  `o uso vale só neste workspace`)
- **Origem:** [ADR 0051](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0051-facetas-de-capability-e-curadoria-por-uso.md)

<a id="rn-058"></a>

### RN-058 — A chave que o AGENTE gasta é a do owner do workspace {#rn-058}

Credencial de LLM pertence a uma pessoa (`user_credentials.user_id`), e agente
não é pessoa. O turno de agente resolve a chave pelo **owner do workspace**
(`workspaces.created_by`), não por quem abriu a sessão nem por quem criou o
projeto: quem banca a conta banca os agentes, e isso não muda quando outra
pessoa da equipe começa a sessão.

`created_by` e não `workspace_members.role = 'owner'`: pode haver vários
owners, e "qualquer um deles" faria a chave usada variar sem ninguém decidir.

Antes disto o turno passava o **slug do agente** (`agentId ?? sessionId`) na
coluna de usuário. A consulta ia ao banco com `user_id = 'criativo'`, o
Postgres recusava o UUID inválido, e o erro virava **resposta vazia** no fio —
sem métrica, sem evento de falha, sem nada na tela. O efeito prático, que só
uma execução real revelou: **nenhum agente jamais usou um provider com
credencial**. Só `ollama` funcionava, porque para ele a busca é pulada — e foi
com modelo local que a Fase 4, o dogfooding da Fase 10 e todas as demos
rodaram.

O chat humano nunca teve o defeito: ele usa `actor.id`, que é o usuário de
verdade.

- **Onde:**
  `src/application/use-cases/llm/resolve-credential-owner.use-case.ts`,
  `src/application/use-cases/llm/stream-llm-turn.use-case.ts`,
  `src/application/use-cases/llm/run-llm-turn.use-case.ts`
- **Teste:** `test/application/use-cases/llm/resolve-credential-owner.use-case.spec.ts`
  (o owner vence quem criou o projeto; a chave encontrada é a dele; projeto
  inexistente é 404 e não erro de banco)
- **Origem:** execução real da FASE 13b

<a id="rn-060"></a>

### RN-060 — O gasto das chaves é do owner, e só ele vê {#rn-060}

O relatório de consumo por credencial (`GET /workspaces/:id/credential-spend`)
exige **`owner`** no workspace. Não é `maintainer`: desde a
[RN-058](#rn-058) os agentes de todos os projetos gastam a credencial do dono,
e a fatura dele não é assunto de quem só opera um projeto.

O relatório agrupa por **provider**, porque é essa a unidade da credencial —
uma chave por provider, por pessoa. Um total único não bateria com fatura
nenhuma.

E separa **agente** de **pessoa**: as duas coisas saem da mesma chave desde a
RN-058, e "meus agentes estão caros?" é uma pergunta diferente de "eu uso muito
o chat?". Por isso este é o único agregado de custo do produto **sem** o filtro
`actor_kind = 'agent'` da [RN-038](parte-01.md#rn-038) — aqui a pergunta é quanto saiu da
chave, e o chat do próprio owner sai dela.

Gasto de credencial **já removida** continua no relatório, marcado: o consumo
aconteceu, e escondê-lo daria um total que não fecha com o extrato do provider.

Nenhum segredo atravessa: a resposta tem provider, tokens e custo — nunca a
chave, nem cifrada ([ADR 0050](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0050-credencial-sempre-cifrada-verificacao-explicita.md)).

- **Onde:**
  `src/application/use-cases/llm/get-credential-spend.use-case.ts`,
  `src/interfaces/http/llm/budgets.controller.ts`,
  `apps/web/src/components/CredentialSpendSection.tsx`
- **Teste:** `test/application/use-cases/llm/get-credential-spend.use-case.spec.ts`
  (agrupa por provider; separa agente de pessoa; chave removida fica marcada);
  `apps/web/src/components/CredentialSpendSection.test.tsx`
- **Origem:** decisão do usuário junto com a RN-058

<a id="rn-065"></a>

### RN-065 — Um module_map por SESSÃO; revisar é outra sessão {#rn-065}

`create_module_map` recusa uma segunda emissão **dentro da mesma sessão**,
com uma mensagem que diz o próximo passo. Entre sessões o mapa continua
versionando (`version + 1`, `findCurrent` devolve o mais alto) — revisar a
arquitetura é comportamento desejado.

A distinção é o ponto: entre sessões, uma nova emissão é uma **revisão**;
dentro da mesma, é o modelo **redecidindo do zero**. Numa execução real o
Arquiteto emitiu quatro mapas seguidos, com nomes e recortes diferentes a
cada vez — `greeting`, `hello_core`, `greeting`, `hello-api-core` — e o laço
só terminou porque a rede caiu (`%Req.TransportError{reason: :timeout}`).

A recusa volta ao modelo pelo tool-result ([RN-061](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-061)): ele lê que já
existe um e segue para `assign_story_modules`, que é o passo 2 do kickoff
dele. É por isso que o turno **não** termina quando o mapa é emitido — o
Arquiteto ainda tem três passos pela frente (vincular histórias, propor um
ADR, registrar tensões), e terminar ali mataria os três.

- **Onde:** `src/application/use-cases/architecture/create-module-map.use-case.ts`
- **Teste:** `test/application/use-cases/architecture/create-module-map.use-case.spec.ts`
  (`refuses the SECOND map of the same session`; e o versionamento entre
  sessões continua provado ao lado)
- **Origem:** execução real da FASE 13b

<a id="rn-066"></a>

### RN-066 — Toda resposta sobre módulos traz os nomes canônicos {#rn-066}

O Arquiteto **não tem ferramenta para ler** o module_map vigente. É por isso
que as três respostas que ele recebe sobre módulos precisam dizer os nomes:

1. Um `create_module_map` bem-sucedido devolve os módulos **como a api os
   gravou** — não apenas a versão.
2. Um `assign_story_modules` recusado lista os módulos **válidos**, além dos
   inexistentes.
3. Um `create_module_map` recusado pela [RN-065](#rn-065) diz **quais** módulos
   a sessão já definiu, não quantos.

Sem mapa nenhum não há nomes a oferecer, e uma lista vazia lê-se como
"chute de novo": esse caminho nomeia o problema real — falta o passo 1 do
kickoff.

O motivo é concreto. Numa execução real o Arquiteto emitiu o mapa
(`saudacao`, `api_http`), não conseguiu relê-lo e recorreu à força bruta: 18
chutes seguidos — `api`, `core`, `http`, `greeting`, `domain`, `web`,
`hello-api`, `hello`, `greeting-api`, `saudacao`, `app`, `server`, `publico`,
`public-api`, `api-publica` — até acertar **um por sorte**. Nas palavras dele
no event log: *"vou descobrir os nomes válidos testando candidatos
plausíveis"*.

O dano não foi o desperdício, foi o resultado: as **quatro** histórias
acabaram no mesmo módulo (`saudacao`), inclusive a do endpoint, `api_http`
ficou sem história nenhuma, e o desfecho afirmou *"Todas as 4 histórias foram
vinculadas a módulos com sucesso"*. Como a execução sobe **um dev agent por
módulo**, a arquitetura desenhada não seria a construída.

O laço da [RN-065](#rn-065) era um sintoma disso: o Arquiteto reemitia o mapa
justamente para tentar fixar nomes que não conseguia ler.

- **Onde:** `src/application/use-cases/architecture/assign-story-modules.use-case.ts`,
  `src/application/use-cases/architecture/create-module-map.use-case.ts`,
  `apps/engine/lib/engine/harness/tools/create_module_map.ex`
- **Teste:** `test/application/use-cases/architecture/assign-story-modules.use-case.spec.ts`
  (`the refusal lists the VALID modules`; `with no module_map, it directs
  creating the map`) e
  `create-module-map.use-case.spec.ts` (`the refusal says WHICH modules
  there are`)
- **Origem:** execução real da FASE 13b

<a id="rn-067"></a>

### RN-067 — Toda sessão nasce emitindo `session.created` {#rn-067}

`CreateSessionUseCase` é o **único** lugar que cria uma sessão. Ele emite
`session.created` para o outbox **na mesma transação** do insert, e é esse
evento que faz o engine subir o `SessionServer` da sessão.

Quem chamou `sessions.create(...)` diretamente produziu uma sessão que o
engine nunca conheceu. O efeito é uma cascata silenciosa:

- o canal Phoenix responde `REFUSED JOIN` para sempre — a UI só reclama no
  console e continua tentando a cada 10 segundos;
- sem canal não há atualização ao vivo: o fio fica preso no indicador de
  digitação, mesmo com o agente já `idle`;
- ninguém bate o heartbeat, e como é o heartbeat que fecha a sessão
  ([RN-064](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-064)), ela fica `active` **para sempre**.

Três caminhos faziam isso: `provision-repository` (duas chamadas),
`adopt-repository` e `activate-execution` — este último cria a sessão onde
rodam os **dev agents**.

A prova por contraste, de uma execução real: a sessão do assistente não tinha
`session.created`, tinha `engine.session_states` vazio e `REFUSED JOIN`; a
sessão aberta pela rota normal tinha o evento, a linha de estado e `JOINED`.

O teste é sobre a FONTE de propósito: um teste de comportamento provaria um
caminho por vez, e o defeito aqui é o caminho em que ninguém pensou.

- **Onde:** `src/application/use-cases/sessions/create-session.use-case.ts`
  (o dono), `git/provision-repository.use-case.ts`,
  `git/adopt-repository.use-case.ts`,
  `execution/activate-execution.use-case.ts` (os chamadores)
- **Teste:** `test/application/use-cases/sessions/toda-sessao-emite-created.spec.ts`
  (`only CreateSessionUseCase calls sessions.create`)
- **Origem:** execução real da FASE 13b

<a id="rn-068"></a>

### RN-068 — O dev agent lê o worktree sem pedir permissão {#rn-068}

Ativar a execução semeia duas famílias de comandos no `allow` do projeto:
**ler o próprio worktree** (`ls`, `pwd`, `find`, `cat`, `head`, `tail`,
`grep`, `wc`, `echo`, `git status`, `git diff`, `git log`) e **build e
teste**.

A segunda já existia: `ReportDone` só deixa uma PR abrir depois de um
`terminal` com `exit 0`. A primeira foi acrescentada porque o agente **olha
antes de construir**, e sem ela não conseguia nem começar.

O motivo é concreto. Uma ferramenta `:pipeline` pendente devolve
`proposed_action <id> status pending` como RESULTADO — não a saída do
comando — e o ToolLoop segue em frente. Num repositório recém-provisionado,
cada `ls -la` do agente caía em aprovação, não lhe ensinava nada e queimava
uma iteração. Numa execução real o desfecho foi
`toolloop.limit_reached {iteration: 8, max_iterations: 8}`, tarefa bloqueada
por "limite de iterações atingido", sem uma linha escrita — e as aprovações
que o usuário deu chegaram depois de o laço esgotado.

Liberar leituras não afrouxa o pipeline, e é isso que o teste afirma: `deny`
vence `allow`, os `BUILTIN_DENY_PATTERNS` continuam ativos, o casamento é por
prefixo de TOKEN (um `ls` permitido não permite `lsof`), e um comando
composto exige que TODO segmento case — `ls && rm -rf /` não passa por causa
do `ls`.

A allowlist é mitigação, não solução: é uma lista de comandos previstos e o
modelo inventa comandos. A correção estrutural — o agente ESPERAR a decisão em
vez de queimar iterações — está no
[ADR 0052](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md).

- **Onde:** `src/domain/actions/dev-terminal-patterns.ts`,
  semeado por `application/use-cases/execution/activate-execution.use-case.ts`
- **Teste:** `test/domain/actions/dev-terminal-patterns.spec.ts`
  (`allows ls -la`; `a composite command doesn't hitch a ride on the
  allowed segment`)
- **Origem:** execução real da FASE 13b

<a id="rn-070"></a>

### RN-070 — Todo gate declarado aponta para a evidência que o prova {#rn-070}

Nenhuma entrada de `config/gates.yml` existe sem `evidencia`, e o registro não
pode afirmar mais do que verifica: um gate `block` exige `verificacao:
script`, e um gate `planned` não carrega evidência de algo que ainda não
aconteceu.

Evidência é um **localizador**, não prosa: `event_log` traz os tipos de
evento e o filtro de payload que os distingue dos vizinhos; `teste` e `ci`
trazem o caminho, e um alvo que sumiu REPROVA. É o mesmo modo de falha que o
docmap chama de glob morto — uma regra que nunca dispara e finge cobertura.

**Essa última afirmação é sobre o REPOSITÓRIO, e nunca é avaliada em
runtime.** O registro é validado em duas camadas: `validarRegistro` (o
conteúdo — `block` precisa de `script`, os quatro gates humanos continuam
humanos, `active` precisa de evidência, nenhum id duplicado, nenhuma `entrada`
órfã) vale onde quer que o arquivo seja lido e é o que o loader da api chama;
`validarLocalizadores` (o arquivo alvo está em disco) só faz sentido dentro de
um checkout, e é cobrada pelo teste do arquivo real e pela fase 2 do
`validacao-gates.ts`.

As duas costumavam ser uma função só, e isso custou um defeito de produção,
medido na v6.1.0 instalada: `GET /gates` devolvia `500` com
`RegistroDeGatesInvalido` listando os onze alvos como ausentes — doze 5xx em
cerca de 55 minutos, em toda instalação. A imagem de produção leva
`/app/config/gates.yml` e mais nada; `test/`, `scripts/ci/`
e `.github/` nunca entram nela. A regra não foi afrouxada — foi movida para
onde a pergunta existe. Não a ponha de volta no loader: `arquivoExiste` num
processo que não tem repositório responde sobre outra árvore.

A tela escondeu isso: a [RN-084](#rn-084) faz o `PrGateTimeline` cair no
pipeline completo quando a rota falha, então o 500 só aparecia nos logs da
api.

Três tipos porque nem todo gate vive no event log:
[`merge-protegida`](parte-01.md#rn-014) é um teto numa regra pura
que não emite evento próprio (o que a garante é um teste) e `backmerge` é CI
com estado em `.release/gate.json`. Rebaixá-los a `warn` por isso mentiria
sobre as travas mais duras do produto.

O filtro importa tanto quanto o tipo: `qa-verificada` e `secops-segura`
gravam o MESMO `pr.gate_changed`, e o mesmo tipo dispara na ABERTURA do gate,
sem `veredito` — sem o filtro, abrir contaria como passar. O mesmo vale para
os dois gates de PR de infra. É por isso que nenhum par (`event_types` +
`filtro`) pode se repetir.

O filtro só alcança o PAYLOAD, de propósito: aceitar uma coluna arbitrária
abriria a consulta inteira. Quem promoveu uma story (humano ou o PO) mora na
coluna `actor_kind` e fica fora do vocabulário declarativo.

- **Onde:** `src/domain/gates/gate-registry.ts`
  (`validarRegistro` e `validarLocalizadores`), registrado em
  `config/gates.yml`, medido em `scripts/validacao-gates.ts`;
  o loader que deliberadamente chama só a primeira é
  `src/infrastructure/gates/gate-registry.loader.ts`
- **Teste:** `test/domain/gates/gate-registry.spec.ts`
  (`é válido: nenhum problema acumulado`; `todo alvo de prova citado
  existe no repositório`; `validarRegistro ignora o disco: alvo ausente
  não é problema DELE`; `nenhum par (event_types + filtro) se repete
  entre gates`) e
  `test/infrastructure/gates/gate-registry.loader.spec.ts`
  (`carrega o registro real sem exigir os alvos que a imagem não leva`,
  contra uma raiz reconstruída como a árvore da imagem de produção)
- **Origem:** FASE 15a (ADR 0054); a divisão em duas camadas veio do 500 de
  `GET /gates` medido na v6.1.0 instalada (AT-086)

<a id="rn-071"></a>

### RN-071 — Os quatro gates de autoridade do usuário não podem ser declarados automáticos {#rn-071}

`acao-aprovada`, `story-promovida`, `plano-de-adocao` e `merge-protegida`
têm `aprovacao_humana: true` por construção. A lista mora no DOMÍNIO
(`GATES_HUMANOS_IMUTAVEIS`), não no teste: mexer nela tem de ser um ato
deliberado, revisado como código.

`aprovacao_humana: true` significa que a decisão é do usuário — diretamente
por um clique, ou delegada por uma política que ele mesmo escreveu no
`permissions.json`. É isso que permite a `acao-aprovada` coexistir com
`status: auto_approved`: a política decidindo sozinha é o usuário tendo
decidido de antemão. `merge-protegida` é o caso em que nem a delegação
existe — o teto rebaixa `auto_approve` para `require_approval` mesmo com a
autonomia ligada.

O contrário também reprova: um id na lista sem gate correspondente é uma
regra morta, apontando para nada.

- **Onde:** `src/domain/gates/gate-registry.ts`
  (`GATES_HUMANOS_IMUTAVEIS`); o teto em
  `src/domain/actions/decide.ts`
- **Teste:** `test/domain/gates/gate-registry.spec.ts`
  (`%s cannot have aprovacao_humana false`); o teto em
  `test/domain/actions/decide.spec.ts`
- **Origem:** FASE 15a (ADR 0054)

<a id="rn-072"></a>

### RN-072 — Sem escolha explícita, o modelo é o do agente Criativo {#rn-072}

Quando a cascata de bindings pousa no default do **workspace** — isto é,
ninguém decidiu nada para este projeto — o modelo herdado é o do agente
**Criativo**, não o default global.

O agente Criativo é sempre a porta de entrada de um projeto: é com ele que a
primeira conversa acontece, e o binding dele representa "o modelo que este
projeto usa para pensar".

A herança preenche a **lacuna**, nunca sobrescreve: bindings de sessão, de
agente ou de projeto são escolhas explícitas de alguém e continuam vencendo.
É por isso que é um passo DEPOIS da cascata e não um novo escopo dentro dela
— não disputa precedência. E o modelo herdado passa pelos mesmos filtros: sumido
do catálogo ou sem tool calling significa que não é herdado, pelo mesmo motivo
que a cascata os pula ([RN-043](parte-01.md#rn-043)).

O que isto conserta: o default do workspace é global e tende a ser um modelo
local pequeno. Uma sessão nova e um dev agent — que não têm binding próprio —
nasciam nele, e o [ADR 0020](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0020-destravar-gates-qa-secops.md) proíbe
um modelo local pequeno no passo semântico. Numa execução real foi preciso
trocar o modelo à mão em cada sessão aberta, e os três dev agents subiram em
`llama3.2:1b` sem que ninguém tivesse pedido.

- **Onde:** `src/domain/llm/binding-resolver.ts`
  (`herdarModeloDeStart`), aplicado em
  `application/use-cases/llm/resolve-model-binding.use-case.ts`
- **Teste:** `test/domain/llm/binding-resolver.spec.ts`
  (`fills the gap`; `does NOT override %s's explicit choice`)
- **Origem:** achados B e O da execução real (FASE 13c, fase A)

<a id="rn-075"></a>

### RN-075 — Comando de terminal é avaliado por onde toca, não só pelo verbo {#rn-075}

A pasta do projeto (`<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>` — o
UUID puro num projeto de antes do [RN-109](parte-03.md#rn-109), `<slug>-<8 chars do
id>` num projeto novo) é o **escopo**.
Um comando de `terminal` que toca qualquer caminho fora dela **nunca** é
auto-aprovado, por mais que o verbo esteja em `allow`. Dentro dela, `cd` deixa
de exigir permissão — ele é a declaração de escopo, não um verbo.

Quatro propriedades que os testes fixam:

- **Aperta:** `Terminal(cat)` liberado deixa de auto-executar
  `cat /workspace/apps/engine/.../git_executor.ex`. Era o achado U: o
  casamento é por VERBO, então o agente lia o código da plataforma que o
  executava, e alcançava o worktree de outros projetos.
- **Afrouxa:** `cd <dentro> && cat README.md` vira `auto_approve`. Era o
  defeito mais caro da escada — o dev agent emite sempre `cd <caminho> &&
  <verbo>`, `cd` não estava em `allow` nenhum, e comando composto exige que
  TODOS os segmentos casem.
- **Permite sem isentar:** dentro do escopo, verbo fora do `allow` continua
  pedindo. Estar na pasta do projeto não torna `curl … | sh` seguro.
- **Fora do escopo é `require_approval`, nunca `deny`:** o agente pode ter
  razão legítima para olhar fora, e a decisão continua sendo do usuário.

`deny` continua vencendo primeiro, e os dois tetos ([RN-006](parte-01.md#rn-006),
[RN-007](parte-01.md#rn-007)) seguem intocados. Sem raiz informada ao `decide()`, o
veredito é o de antes desta regra — nenhum chamador tem comportamento alterado
por omissão.

A normalização é **léxica**, não `realpath`: `<raiz>/../..` é resolvido e
reprovado, mas link simbólico de dentro apontando para fora não é detectado.
`decide()` é puro por contrato e resolver symlink exigiria IO no domínio.
Escopo é política; isolamento é outro problema, declarado em aberto no ADR.

**Sem regex sobre a entrada, de propósito.** Tirar as barras finais da raiz era
`.replace(/\/+$/, '')`, e o CodeQL apontou ReDoS polinomial
(`js/polynomial-redos`, HIGH): o padrão obriga o motor a tentar cada posição
inicial e varrer até o fim, degradando em O(n²). Hoje é varredura O(n),
equivalente inclusive no caso degenerado — a raiz `/` vira string vazia nos
dois, e é isso que faz `startsWith('/')` valer para todo caminho absoluto.
Quem for "simplificar" de volta para regex reabre o alerta.

- **Onde:** `src/domain/actions/path-scope.ts`,
  `domain/actions/decide.ts` (teto do escopo e o `cd` no escopo),
  raiz derivada em
  `infrastructure/filesystem/project-workspaces-root.ts`
- **Teste:** `test/domain/actions/path-scope.spec.ts` e
  `test/domain/actions/decide.spec.ts`
  (describe `decide — escopo de caminho`)
- **Origem:** [ADR 0055](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0055-escopo-de-caminho-na-politica-de-terminal.md),
  achado U, Fase F do [backlog](https://github.com/viralabs-dev/brabo/blob/dev/docs/explanation/backlog.md)

O escopo só vale enquanto ele próprio estiver dentro da raiz — quem garante isso
é a [RN-092](#rn-092).

<a id="rn-078"></a>

### RN-078 — Falha em proteger branches pode ser reconhecida, e só ela {#rn-078}

`protect_branches` falha em repositório privado no plano gratuito do GitHub — e
o wizard **avisa isso antes de começar**. O usuário pode reconhecer a falha e
seguir; o bootstrap fecha e o projeto passa a ser alcançável.

**O que isso destrava é maior do que parece.** O único botão oferecido depois da
falha era "Tentar novamente", que falha sempre pelo mesmo motivo. E
`provision_failed` faz o dashboard **redirecionar o clique do projeto de volta
para a página de provisionamento** — o projeto ficava inalcançável para sempre,
preso num passo que não tem como suceder.

**Só a proteção pode ser reconhecida.** Ela é o ÚLTIMO passo e a única cuja
falha deixa um repositório utilizável: o repo existe, os arquivos foram
commitados, as branches foram criadas. Falhar em criar o repositório ou em
commitar é outra coisa — ali "seguir" produziria um projeto sem onde trabalhar,
e o botão seria uma segunda mentira em cima da primeira. A recusa diz isso, em
vez de só negar.

**A garantia do produto não muda.** A trava de merge ([RN-006](parte-01.md#rn-006)) é
aplicada em `decide.ts`, não pela proteção do provider. Seguir sem ela remove a
segunda camada, a do GitHub — não a do Brabo. É o que torna esta saída honesta
em vez de um atalho.

A decisão vai para o event log com o **usuário** como ator e o erro original no
payload: seguir sem proteção é escolha dele, e quem ler depois precisa saber o
que exatamente foi dispensado.

- **Onde:** `src/application/use-cases/git/acknowledge-protection-failure.use-case.ts`,
  rota em `interfaces/http/git/git.controller.ts`, botão em
  `apps/web/src/routes/ProvisioningPage.tsx`
- **Teste:** `test/application/use-cases/git/acknowledge-protection-failure.use-case.spec.ts`
  (destrava; a decisão no log com o ator; e a recusa para falha anterior)
- **Origem:** achado D, Fase D do [backlog](https://github.com/viralabs-dev/brabo/blob/dev/docs/explanation/backlog.md)

<a id="rn-081"></a>

### RN-081 — História repetida: título igual recusa, justificativa igual avisa {#rn-081}

Duas respostas diferentes para dois problemas diferentes:

- **título idêntico** no projeto é erro, não escolha: a história é **recusada** e
  nada é criado;
- **mesma justificativa** — todas as regras de negócio que a história cita já
  estavam cobertas por outra — é suspeita, não erro. A história **é criada** e
  sai um `backlog.story_overlap_warned`. Um segundo recorte da mesma regra pode
  ser legítimo, então quem julga é o usuário; o produto só se recusa a deixar
  passar despercebido.

**Contido, não intersecção.** Duas histórias compartilharem uma regra é normal, e
avisar disso viraria ruído que ninguém lê. O sinal só existe quando a nova não
acrescenta cobertura nenhuma. História que não cita regra alguma não gera aviso:
tratar o conjunto vazio como subconjunto de tudo acusaria todas.

**O limite é o mesmo da [RN-080](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-080), e o par do achado o atravessa:**
"Endpoint público de saudação determinística" e "Endpoint público GET /hello que
responde saudação imediata" cobrem o mesmo endpoint com títulos e justificativas
diferentes — nada mecânico os liga, e eles continuam passando. Há teste
afirmando isso, para o limite ficar visível em vez de implícito.
Desde a [RN-681](parte-09.md#rn-681) o par é AVISADO por embedding — continua passando,
e o teste que afirma o limite DESTE mecanismo segue valendo.

- **Onde:** `src/domain/backlog/story-overlap.ts`,
  `src/application/use-cases/backlog/create-story.use-case.ts`
- **Teste:** `test/domain/backlog/story-overlap.spec.ts`,
  `test/application/use-cases/backlog/create-story.use-case.spec.ts`
- **Origem:** achado R, Fase E do [backlog](https://github.com/viralabs-dev/brabo/blob/dev/docs/explanation/backlog.md)

<a id="rn-082"></a>

### RN-082 — A credencial de git de uma ação é a do OWNER do workspace {#rn-082}

Quando a api executa uma ação de git contra provider remoto (`pr_open`,
`git_merge`), o token vem do **owner do workspace** — o mesmo resolvedor da
[RN-058](#rn-058), não de quem decidiu a ação.

**Resolver por quem decidiu só funcionava com clique humano.** Ação
auto-aprovada por política não tem decisor: `decided_by` fica `NULL`, o token
fica `undefined`, e o GitHub responde `Requires authentication`. Na prática,
com autonomia ligada — que é o modo que o ADR 0055 existe para viabilizar —
**nenhum dev agent conseguia abrir PR em provider remoto**.

**O contraste que expôs o defeito** aconteceu dentro de uma execução só: no
mesmo run, `git_push` passou e `pr_open` falhou. O push é executado pelo
ENGINE, que já injetava a credencial do owner
([RN-076](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-076)); a PR é aberta pela API, que estava fora de simetria.

Não apareceu antes porque toda validação anterior usou o `LocalGitProvider`,
onde o token nem é consultado.

O princípio é o mesmo da RN-058, e vale repetir porque é o que impede as duas
regras de divergirem com o tempo: **quem banca a conta banca os agentes**, e
isso não muda conforme quem clica. Por isso o resolvedor é REUSADO em vez de
reimplementado.

- **Onde:** `src/application/use-cases/actions/execute-git-action.use-case.ts`,
  reusando `application/use-cases/llm/resolve-credential-owner.use-case.ts`
- **Teste:** `test/application/use-cases/actions/execute-git-action.use-case.spec.ts`
  (`pr_open` auto-aprovado, com `decidedBy: null`, pede a credencial do owner)
- **Origem:** achado AA, [validação real da 13b](https://github.com/viralabs-dev/brabo/blob/dev/docs/explanation/validacao-real.md)

<a id="rn-083"></a>

### RN-083 — O lead decide o paralelismo; acima do teto, você autoriza {#rn-083}

Quantos agentes sobem deixa de ser um número no código: quem avalia é o **lead
da área**. Mas a decisão dele não é soberana sobre GASTO — até
`agent_areas.max_parallel` (nasce com **5** no `dev`, [RN-910](parte-10.md#rn-910)) ele sobe e segue; **acima disso vira
`proposed_action` do tipo `parallelize`**, pelo mesmo pipeline de toda ação com
efeito externo.

**O teto é da SESSÃO, não do módulo.** É a única parte da regra que não é
óbvia, e a que um refactor desatento desfaz: contar por módulo permitiria N
módulos × 2 agentes sem autorização nenhuma — o buraco anterior com outro nome.
Há teste afirmando exatamente isso.

**Teto zero ou negativo é configuração inválida, não "sem limite".** Tratá-lo
como ilimitado transformaria um erro de digitação em gasto irrestrito, que é o
oposto do que o pipeline existe para fazer.

**Quem PEDE é o lead; quem DECIDE é você.** A `proposed_action` nasce com o
lead como ator, e a decisão fica no event log com o seu nome — é essa distinção
que faz a história ser reconstituível depois ([ADR 0048](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0048-decisao-no-log-e-a-ordem-do-gate.md)).

O motivo viaja no payload IMUTÁVEL, com os três números (quantos há, quantos
pede, qual o teto): quem ler daqui a seis meses precisa entender o que foi
autorizado sem reconstruir o estado da sessão.

`AcceptParallelizationUseCase` não muda: ele continua sendo quem EXECUTA, tanto
no caminho direto quanto quando a ação é aprovada. Absorvê-lo por dentro, em vez
de reescrevê-lo, é o que mantém a suite da Fase 4 verde sem modificação — que é
a prova de que a troca não vazou para o contrato externo.

**O teto é configurável por área, e só por você.** `PATCH
/projects/:projectId/agent-areas/:key/max-parallel` exige `maintainer` — o mesmo
papel de ativar a execução, e pelo mesmo motivo: mudar o teto é decidir quanto o
produto pode gastar sem perguntar. Não existe caminho automático de subi-lo. A
Anamnese pode PROPOR, quando notar que a autorização virou rotina, e a proposta
continua passando por esta rota depois que você aceita — um produto que eleva o
próprio teto de gasto é exatamente o que o pipeline de aprovação existe para
impedir.

Mudar o teto vale para os PRÓXIMOS pedidos. O que já está aguardando decisão
continua aguardando: a ação carrega no payload o teto vigente quando foi criada,
e reinterpretá-la sob o teto novo mudaria o que você está prestes a decidir
depois de ler.

- **Onde:** `src/domain/execution/paralelismo.ts` (a regra pura),
  `application/use-cases/execution/request-parallelization.use-case.ts`,
  `application/use-cases/execution/set-area-max-parallel.use-case.ts`,
  exposto em `interfaces/http/execution/execution.controller.ts` e configurado
  em `apps/web/src/routes/settings/ParallelismSection.tsx`
- **Teste:** `test/domain/execution/paralelismo.spec.ts`,
  `test/application/use-cases/execution/request-parallelization.use-case.spec.ts`,
  `test/application/use-cases/execution/set-area-max-parallel.use-case.spec.ts`
  e `apps/web/src/routes/ProjectSettingsTab.test.tsx` (`ParallelismSection`)
- **Gate:** `config/gates.yml` (`paralelismo-autorizado`) — `status: active`
  desde a auditoria fluxo.yml × código (achado A1/B5); o mecanismo em si não
  mudou, só o registro que ficou `planned` por engano desde a FASE 14d, ver
  [gates.md](https://github.com/viralabs-dev/brabo/blob/dev/docs/explanation/gates.md#a-registry-can-age-in-the-wrong-direction--stale-not-inactive)
- **Origem:** [ADR 0053](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0053-dev-lead-e-paralelismo-autorizado.md), FASE 14d

<a id="rn-084"></a>

### RN-084 — A esteira exibida deriva do registro de gates {#rn-084}

O painel do time mostra a etapa em que uma PR está **derivando-a de
`config/gates.yml`**, não de uma lista escrita na tela. Gate que sai do registro
some da esteira; gate `planned` nunca aparece.

**A regra existe por uma forma específica de envelhecimento.** Antes da FASE
15b a tela tinha as etapas fixas no componente, e o registro (FASE 15a)
descrevia os gates em outro lugar. Nada ligava os dois: acrescentar um gate ao
YAML não mudava a tela, e remover um deixava a tela mostrando uma etapa que já
não existia — sem nenhum teste falhar, porque as duas fontes estavam certas
cada uma por si. É o mesmo apodrecimento que o `docs/.docmap.yml` existe para
impedir, e a resposta é a mesma: uma fonte só, com o consumo cobrado.

Três decisões de borda, todas para a tela **degradar** em vez de sumir:

- gate de PR que a tela ainda não sabe desenhar é **ignorado**, não quebra o
  render — o registro pode ganhar um gate antes de a tela ganhar o rótulo;
- os **rótulos são de tela**, não do registro: o YAML descreve engenharia, e a
  tela fala com quem espera uma PR;
- **sem registro** (a rota falhou), mostra a esteira completa em vez de vazia —
  uma esteira genérica informa mais que nada.

- **Onde:** `apps/web/src/components/PrGateTimeline.tsx` (`etapasDaEsteira`),
  lendo `GET /gates` (`src/interfaces/http/gates/gates.controller.ts`)
- **Teste:** `apps/web/src/components/PrGateTimeline.test.ts`
  (`gate que SAI do registro some da tela`, `gate de PR que a tela ainda não
  sabe desenhar é IGNORADO`, `sem registro, mostra a esteira completa`)
- **Origem:** [ADR 0054](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0054-gates-como-registro-declarativo.md), FASE 15b

<a id="rn-086"></a>

### RN-086 — Gastar com mais agentes nunca se auto-aprova {#rn-086}

As duas ações que mexem em **quanto o produto pode gastar sozinho** —
`parallelize` (ultrapassar o teto agora) e `raise_max_parallel` (mudar o teto)
— nunca são auto-aprováveis. Nem por `agent_autonomy`, nem por
`permissions.json`. É a mesma classe de garantia da trava de merge e do teto do
patch de instrução.

**Sem isto o teto da [RN-083](#rn-083) seria decorativo.** Um `permissions.json`
com `Parallelize()` no `allow` faria toda ultrapassagem se aprovar sozinha — a
regra que existe para EXIGIR a decisão do usuário passaria a dispensá-la. E
`raise_max_parallel` é o caso mais grave: seria o produto elevando o próprio
limite de gasto, exatamente o que o pipeline de aprovação existe para impedir.

**A Anamnese pode PROPOR, e é isso que ela faz.** Quando autorizar mais um
agente vira rotina, o teto está errado, e quem percebe primeiro é quem lê o
histórico. O sinal já chegava a ela: as decisões do usuário na janela vêm de
`proposed_actions`, com `actionType` e `status`.

O limiar é **três aprovações e nenhuma negação**, e as duas metades importam:

- **duas não são rotina — são duas.** Três é o que separa "aconteceu" de "está
  acontecendo sempre";
- **uma negação derruba o sinal inteiro**, por mais aprovações que haja. Se o
  usuário recusou alguma vez, o teto está fazendo o trabalho dele, e propor
  subi-lo seria ler o sinal ao contrário.

Propor um teto **igual ou menor** que o vigente é recusado pela api: a Anamnese
roda periodicamente e reproporia a mesma coisa a cada rodada, enchendo de ruído
uma fila que o usuário precisa ler.

Aprovar aplica o valor do **payload**, não um recalculado na hora — é o número
que você leu ao decidir.

- **Onde:** `src/domain/actions/decide.ts` (o teto),
  `application/use-cases/execution/propose-max-parallel.use-case.ts`,
  `execute-max-parallel-raise.use-case.ts`,
  `apps/engine/lib/engine/anamnese/tools/propose_max_parallel.ex` e o limiar em
  `apps/engine/lib/engine/workers/anamnese_worker.ex` (`nota_de_paralelismo/1`)
- **Teste:** `test/domain/actions/decide.spec.ts`
  (`decide — teto do paralelismo`),
  `test/application/use-cases/execution/propose-max-parallel.use-case.spec.ts`,
  `execute-max-parallel-raise.use-case.spec.ts`,
  `apps/engine/test/engine/anamnese/tools_test.exs` e
  `test/engine/workers/anamnese_worker_test.exs` (`duas aprovacoes NAO sao
  rotina`, `uma NEGACAO derruba o sinal`)
- **Origem:** [ADR 0053](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0053-dev-lead-e-paralelismo-autorizado.md), FASE 14d

## Painel de projetos {#painel-de-projetos}

<a id="rn-090"></a>

### RN-090 — O dashboard lê o workspace, não um projeto de cada vez {#rn-090}

A grade de cards e os dots da barra lateral se alimentam de **uma** requisição
por ciclo — `GET /workspaces/:workspaceId/projects-summary` —, e o número de
requisições **não cresce com a quantidade de projetos**.

O card mostra provedor de git, status de provisionamento, orçamento, chips de
agentes e última atividade; a sidebar mostra o dot de status e o contador de
não lidos. Tudo isso vinha de sete consultas em POLL por projeto, o que fazia
23 projetos custarem 3.824 requisições por minuto contra um limite de 300
(`RateLimitGuard`) — a tela derrubava a si mesma em 429 antes de terminar de
carregar. A [RN-088](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-088) fez a app parar de insistir quando isso acontece;
esta reduz o pedido.

Duas fronteiras que a regra fixa, e que não são detalhe de implementação:

- **A api responde fatos, não roster.** `roster` traz o que aconteceu no event
  log (execução ativada, módulos, gate já aberto, subagentes delegados, infra
  aceita). Quem é lead de área, que ícone cada agente tem e como os membros
  viram um chip continua sendo do web — e a regra de PRESENÇA é uma só
  (`rosterFromFacts`), compartilhada com o painel do time, para que um agente
  novo não apareça num lugar e falte no outro.
- **A gaveta do sino só busca quando aberta.** Ela era, até a
  [RN-091](#rn-091), a única leitura que continuava sendo uma requisição por
  projeto — o corte de "onde parei de ler" é `seq` guardado no navegador
  (`read-state`), que o servidor não conhece. Hoje o navegador **manda** esse
  corte, e a gaveta também é uma requisição só.

Efeito colateral aceito e desejado: `gatesEverOpened` e `delegatedSubagents`
passam a cobrir a sessão INTEIRA. O cliente derivava dos últimos 200 eventos e
perdia chips em sessão longa (ver
[ADR 0021](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0021-fechamento-4a-infra-e-painel.md)) — o texto de
`deriveAgentRoster` sempre disse "já abriu alguma vez".

- **Onde:**
  `src/application/ports/projects-summary-repository.port.ts`,
  `src/infrastructure/persistence/drizzle/projects-summary.repository.ts`,
  `src/interfaces/http/iam/workspaces.controller.ts`
  (`getProjectsSummary`), `apps/web/src/lib/hooks.ts` (`useProjectsSummary`),
  `apps/web/src/lib/agent-status.ts` (`rosterFromFacts`),
  `apps/web/src/routes/Dashboard.tsx`, `apps/web/src/routes/Shell.tsx`
- **Teste:** `apps/web/src/routes/Dashboard.fanout.test.tsx` (30 projetos
  custam o mesmo que 3; nenhum endpoint por projeto é chamado);
  `test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (o número de consultas ao banco não cresce com N);
  `apps/web/src/lib/agent-status.test.ts` (os fatos da api produzem os mesmos
  chips que o event log)
- **Origem:** dashboard de 23 projetos medido no navegador — 3.824 req/min
  antes, 12 depois

<a id="rn-091"></a>

### RN-091 — O navegador manda onde parou de ler; o sino é uma requisição {#rn-091}

Com a gaveta de notificações **aberta**, o conteúdo dela sai de **uma**
requisição por ciclo — `POST /workspaces/:workspaceId/unread-events` — e o
número de requisições **não cresce com a quantidade de projetos**.

É a metade que faltava da [RN-090](#rn-090). Aquela derrubou o dashboard de
3.824 para 12 req/min, mas o sino continuou buscando um projeto de cada vez:
23 projetos com a gaveta aberta mediam **286 req/min** contra o limite de 300
(`RateLimitGuard`). Passava, e sumia com um projeto a mais.

**O obstáculo, e por que a saída é esta.** Não existe "marcar como lido" no
servidor, de propósito: o corte é um `seq` por projeto guardado no
`localStorage` de cada navegador (`read-state`). Havia duas saídas, e a
diferença entre elas é de PRODUTO:

- parar de repolar enquanto a gaveta está aberta muda a atualidade do que o
  usuário vê — **recusada**, ninguém pediu essa troca;
- o navegador **mandar** o mapa `projeto → afterSeq` devolve exatamente os
  mesmos dados na mesma cadência. **É batelamento puro: nada muda para quem
  olha a tela**, nem a frescura nem o conteúdo.

**É `POST` sem mutar nada**, e a api responde `200` (nunca `201`) para dizer
isso. O verbo foi escolhido por ser o único com CORPO: são dezenas de pares, e
em query string isso vira URL longa — que proxy trunca — além de pôr id de
projeto do usuário em log de acesso, contra a regra de não passar dado pessoal
por query string.

Três garantias de semântica que a rota fixa, porque batelar leituras com cortes
diferentes é onde o erro fácil mora:

- **mapa vazio devolve vazio**, e sem tocar no banco. "Não perguntei nada" não
  é "me dê tudo";
- **cada projeto respeita o SEU corte** — `seq` estritamente maior que o dele;
- **o teto de 50 eventos é por projeto**, o mesmo que `GET .../events` aplica
  sem `limit`. Um limite na resposta inteira deixaria o projeto barulhento
  comer a cota dos calados.

Cursor apontando para projeto de outro workspace é **ignorado**, não recusado:
ele vem do armazenamento local de quem chama e pode ser sobra de um workspace
antigo.

- **Onde:**
  `src/application/ports/projects-summary-repository.port.ts`
  (`unreadEventsForWorkspace`),
  `src/infrastructure/persistence/drizzle/projects-summary.repository.ts`,
  `src/interfaces/http/iam/workspaces.controller.ts`
  (`getUnreadEvents`), `src/interfaces/http/iam/dto/unread-events.dto.ts`,
  `apps/web/src/lib/notifications.ts` (`useNotificationGroups`),
  `apps/web/src/lib/api-client.ts` (`getUnreadEvents`)
- **Teste:** `apps/web/src/routes/Dashboard.fanout.test.tsx` (com a gaveta
  ABERTA: uma requisição, e 30 projetos custam o mesmo que 3);
  `test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (o número de consultas ao banco não cresce com N; mapa vazio, corte por
  projeto, teto por projeto e isolamento de workspace)
- **Origem:** residual medido da [RN-090](#rn-090) — 286 req/min com a gaveta
  aberta num workspace de 23 projetos

<a id="rn-092"></a>

### RN-092 — O `projectId` é segmento de caminho, e o escopo nunca sai da raiz {#rn-092}

`projectScopeRoot()` **recusa** um `projectId` que não seja segmento de caminho
simples (`^[A-Za-z0-9_-]{1,64}$`), lançando em vez de montar o caminho.

O motivo é que o id chega de `@Param('projectId')` sem pipe de validação, e o
Express **decodifica o percent-encoding do segmento antes de entregá-lo**: um
`..%2F..%2Fetc` chega como `../../etc`, e o `join` resolveria para fora da raiz
sem reclamar. Os dois consumidores da função sofrem, e o segundo é o grave:

- o `permissions.json` seria lido **e escrito** em caminho arbitrário;
- o escopo da [RN-075](#rn-075) autoriza comando de `terminal` sob essa pasta.
  Um escopo que escapa da raiz é a política de aprovação apontando para o lugar
  errado — falha de SEGURANÇA, não de arquivo não encontrado.

A checagem é deliberadamente **mais larga que UUID** (aceita letra, dígito,
hífen e sublinhado) para não amarrar o formato do id, e estreita o bastante para
que o resultado nunca escape. E fica **onde a raiz é derivada**, não em cada
chamador, pela mesma razão que fez a função existir: as duas derivações têm que
concordar, e checagem duplicada é checagem que um dia diverge.

O caminho feliz não muda — todo id real é UUID vindo do banco.

- **Onde:** `src/infrastructure/filesystem/project-workspaces-root.ts`
  (`projectScopeRoot`)
- **Teste:** `test/infrastructure/filesystem/project-workspaces-root.spec.ts`
- **Origem:** [ADR 0058](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md),
  alertas `js/path-injection` do CodeQL

<a id="rn-093"></a>

### RN-093 — Em produção, a api não sobe com a chave de exemplo do `state` de OAuth {#rn-093}

`resolveOauthStateSecret()` **derruba o boot** quando `NODE_ENV === 'production'`
e `GIT_OAUTH_STATE_SECRET` está ausente, é igual ao literal de exemplo do
repositório, ou tem menos de 16 caracteres. Fora de produção o default de
desenvolvimento continua valendo.

Essa chave assina o `state` do OAuth de git, e o `state` é o único que impede o
callback `GET /git/oauth/:provider/callback` — rota pública, por necessidade —
de ser forjado. Com a chave conhecida, qualquer um assina um `state` para
`{projectId, userId, provider}` à escolha e faz o callback gravar, no projeto
apontado por esse payload, o token de git obtido do provider.

**Por que rejeitar o literal, e não só o vazio.** O default estava no
`.env.example` de um repositório open source — é segredo publicado, não segredo
fraco. E o `docker-compose.prod.yml` o supria como fallback, então no caminho
real de erro a variável estava **definida**: uma verificação de "não vazia"
passaria por cima do defeito inteiro.

A resolução fica em função única, e não em cada chamador, pela mesma razão da
[RN-092](#rn-092) — eram duas cópias do mesmo literal, e cópias divergem.
Divergindo aqui, o callback recusaria todo `state` legítimo.

- **Onde:** `src/infrastructure/security/oauth-state-secret.ts`
  (`resolveOauthStateSecret`), chamada no boot em `src/main.ts`
- **Teste:** `test/infrastructure/security/oauth-state-secret.spec.ts`
- **Origem:** [ADR 0059](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0059-segredo-do-state-de-oauth-sem-default.md)

<a id="rn-094"></a>

### RN-094 — A área de agentes nasce com o projeto {#rn-094}

Criar um projeto grava as três áreas (`dev`, `qa`, `infra`) em `agent_areas`,
com o lead de cada uma e os membros **enumeráveis** em `agent_area_members` —
na MESMA transação da criação. Se o seeding falha, o projeto não nasce: projeto
sem área é projeto onde a RN-083 lê tabela vazia e cai no default sem que
ninguém tenha decidido nada.

**Isto é a correção de um defeito, não uma capacidade nova.** `agent_areas`
existe desde a FASE 14d e nunca foi gravada — `AgentAreaRepository.upsert`
tinha teste e não tinha NENHUM chamador. Em produção a tabela estava vazia,
`GET /projects/:projectId/agent-areas` devolvia `[]`, e os quatro casos de uso
que a leem operavam sobre o nada. É a mesma falha da própria FASE 14d, escrita
no CLAUDE.md: **testar a peça não é testar o caminho até ela**. Por isso o
teste desta regra entra pelo caso de uso que a rota chama, com repositório
real: um fake aqui provaria exatamente o que já estava provado e quebrado.

**Semeia em DOIS lugares, e cada um responde uma pergunta diferente.** A
criação do projeto faz a área EXISTIR — a tela de Configurações lê num projeto
que nunca executou. A ativação da execução diz quem são os MEMBROS da área de
`dev`: um `dev-<modulo>` por módulo do `module_map`, que não existia quando o
projeto nasceu. Enquanto não há membros gravados, quem sustenta a regra de
endereçamento (RN-087) é o predicado `ehDevDeModulo`, que não consulta o banco.

**O seeding manda o teto de NASCENÇA, e só no INSERT.** Desde a
[RN-910](parte-10.md#rn-910) a área nasce com o valor do catálogo (dev 5, qa 4, infra 2),
mas o `upsert` o grava só quando a linha ainda não existe: a ativação é
repetível, e um teto que você subiu não volta ao valor de nascença em silêncio
— o produto desfazendo a sua decisão. A migração de backfill `0038` faz a área
existir e para aí; quem alinha os projetos existentes é a `0073` (RN-910).

Projetos criados antes disto são cobertos pela migração `0038`, com `ON
CONFLICT DO NOTHING` nas duas tabelas. Sem ela, o defeito ficaria corrigido só
para quem começasse do zero.

- **Onde:**
  `src/application/use-cases/agents/seed-agent-areas.use-case.ts`,
  chamado por `application/use-cases/iam/create-project.use-case.ts` e
  `application/use-cases/execution/activate-execution.use-case.ts`;
  lista canônica em `src/domain/agents/agent-areas.ts`;
  backfill em `src/db/migrations/0038_wandering_lila_cheney.sql`
- **Teste:**
  `test/application/use-cases/iam/create-project-semeia-areas.spec.ts` (o
  caminho, contra o banco, incluindo a falha que derruba a criação),
  `test/db/agent-areas-backfill.spec.ts` (a migração rodada de verdade, duas
  vezes) e `test/application/use-cases/execution/activate-execution.use-case.spec.ts`
  (os membros de dev, e o teto nunca enviado)
- **Origem:** FASE 18, defeito achado na investigação do programa 16–26;
  a tabela vem do [ADR 0053](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0053-dev-lead-e-paralelismo-autorizado.md)

<a id="rn-095"></a>

### RN-095 — A leitura de repositório é contida ao projeto e limitada {#rn-095}

A superfície de leitura de código (`GET /projects/:projectId/code/{tree,file,search}`
e o diff de PR) tem **duas** garantias, e as duas são do mesmo tipo: o produto
recusando fazer o que o cliente pediu.

**Contenção.** Todo caminho de arquivo vindo do cliente passa por
`caminhoDeRepositorioContido()`, que ancora o pedido na pasta do projeto e
recusa o que sair dela — `../`, absoluto, ou byte NUL. Ela é uma função só, no
mesmo arquivo do `projectScopeRoot` da [RN-092](#rn-092), reusando as primitivas
do escopo de terminal (`normalizarCaminho`/`dentroDoEscopo`). **Nenhuma rota
valida caminho por conta própria**, e é isso que a regra afirma: quatro
implementações da mesma contenção seriam quatro chances de divergir, e o
CLAUDE.md já registra que a decisão foi manter a checagem central e pagar o
preço no painel do CodeQL (barreira em outra função ele não enxerga).

Ela devolve o caminho **normalizado**, e o chamador usa o que voltou. Devolver o
original permitiria conferir `b` e mandar `a/../b` ao provider — a forma mais
comum de a contenção existir e não valer.

O vetor não é "ler o arquivo errado". Em `github`/`gitlab` o caminho vira
segmento de URL da API do provider, então um `../` **troca de endpoint** com a
credencial do owner do workspace na mão ([RN-058](#rn-058)/[RN-082](#rn-082)).
Em `local` ele vira o lado direito de `git show <ref>:<path>`. A `ref` é
conferida no mesmo lugar, pelo mesmo motivo, e `..` nela é recusado porque para
o git `dev..main` é intervalo de commits, não revisão.

**Limite.** Árvore e diff já vêm cortados pelo contrato
(`GIT_TREE_ENTRY_LIMIT`, `GIT_DIFF_FILE_LIMIT`, FASE 26a). A **busca** não: ela
não é operação do contrato — é composta sobre `listTree` e `getFileContent`, e
é a única leitura cujo custo cresce com o TAMANHO do repositório em vez do
tamanho do pedido. Três orçamentos a param (diretórios percorridos, arquivos
abertos, casamentos devolvidos), um cache de TTL curto evita repetir as mesmas
chamadas, e `truncated` diz que o corte aconteceu. Sem eles, um `viewer`
gastaria a credencial e o rate limit do owner à vontade — a mesma família de
defeito dos 3.824 req/min do dashboard ([RN-090](#rn-090)).

**A indexação de docs tem teto próprio.** O `GIT_BLOB_MAX_BYTES` (512 KiB) vale
para a aba Code e para a busca; a indexação de `docs`/`adr` lê cada `.md` até
`RAG_INDEX_FILE_MAX_BYTES` (4 MiB), pelo parâmetro `maxBytes` de
`ReadProjectCodeUseCase.file` (o default continua o da aba) — [RN-1036](parte-04.md#rn-1036).

Cortar é sempre **visível**: toda resposta que pode ter sido cortada diz isso
num campo. `filesScanned` vai junto na busca porque o custo que ninguém vê é o
que ninguém corrige.

**Ler não vira `proposed_action`.** Leitura não é efeito externo, e transformá-la
em ação de aprovação encheria a fila de ruído até ninguém mais ler as de
verdade. O congelamento da fase é o outro lado disso: a aba é só leitura, e
escrita — quando vier — nasce `proposed_action`.

- **Onde:**
  `src/infrastructure/filesystem/project-workspaces-root.ts`
  (`caminhoDeRepositorioContido`),
  `src/application/use-cases/git/read-project-code.use-case.ts`,
  `src/domain/git/git-read-limits.ts`,
  `src/domain/git/git-read-cache.ts`,
  `src/interfaces/http/git/code.controller.ts`
- **Teste:**
  `test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (a contenção isolada),
  `test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (o caminho malicioso recusado nas três rotas **antes** de o provider ser
  chamado, e cada um dos três orçamentos parando a busca),
  `test/domain/git/git-read-cache.spec.ts`
- **Origem:** FASE 26b, item 34 do programa 16–26; a contenção estende a
  [RN-092](#rn-092) ([ADR 0058](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md))

## Sessão

<a id="rn-097"></a>

### RN-097 — O tipo da sessão é intenção de criação; a execução continua sendo evento {#rn-097}

A sessão nasce `consultiva` ou `criativa`, escolhida por **quem a abre** e
gravada em `sessions.kind`. A `consultiva` é só conversa; a `criativa` é a que
produz — abre a ideação com o agente Criativo e é a **única** que entra em
execução. O tipo **nunca muda**: não há rota que o troque.

O risco desta regra não é o campo, é a **segunda fonte de verdade**. O
produto já sabia dizer se uma sessão está executando, e sabia por outro
caminho: `findActiveExecutionSession` procura a sessão `active` que carrega o
evento `execution.activated` (é o que faz a reativação cair na sessão onde os
dev agents já estão, achado #11 do primeiro dogfooding). As duas convivem sob
uma regra que as impede de brigar:

- **O `kind` classifica a INTENÇÃO de criação.** Uma sessão `criativa` que
  nunca ativou a execução **não é** a sessão de execução corrente, e a
  derivação por evento continua sem olhar o `kind` — se passasse a olhar, toda
  sessão criativa aberta viraria candidata a receber os dev agents.
- **O evento classifica o ESTADO de execução**, como sempre.
- **`execution.activated` numa sessão `consultiva` é ERRO** (409), nunca
  conversão silenciosa. Este é o ponto que decide qual das duas fontes vence:
  deixar o evento promover o tipo seria justamente fazê-las escreverem uma por
  cima da outra.

A guarda mora no **funil** — `AppendSessionEventUseCase` — e não no
`ActivateExecutionUseCase`, porque os dois caminhos que gravam evento (a rota
do usuário e o `/internal/*` do engine) passam por ele. A leitura extra da
sessão só é paga quando o evento é o de execução. A recusa acontece **antes**
do `incrementSeq`: uma tentativa recusada não pode consumir `seq`, ou a
[RN-002](parte-01.md#rn-002) quebraria.

O DEFAULT da coluna é `consultiva` — o tipo que pode **menos**: uma linha que
chega por um caminho que não passa pela rota (migration, SQL de manutenção)
não ganha o direito de executar. O **backfill** da migration faz o contrário,
e de propósito, pelo raciocínio da 0033: no momento em que roda, toda sessão
é anterior à distinção, e algumas são sessões onde há dev agents trabalhando —
acordá-las como `consultiva` faria a reativação de um projeto em andamento
falhar sem ninguém ter decidido nada.

- **Onde:** `src/domain/sessions/session-kind.ts:50`
  (`podeAtivarExecucao`), `src/db/schema/sessions.ts:68` (a coluna),
  `src/application/use-cases/sessions/append-session-event.use-case.ts:54`
  (a guarda)
- **Teste:** `test/application/use-cases/sessions/session-kind-e-nome.spec.ts`
- **Origem:** [ADR 0061](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0061-tipo-da-sessao-na-criacao.md)
