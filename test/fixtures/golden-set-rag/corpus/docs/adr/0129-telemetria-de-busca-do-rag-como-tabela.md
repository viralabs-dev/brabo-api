# 0129 — A telemetria de busca do RAG é TABELA, com os pesos congelados na linha

## Context

`apps/api/src/domain/rag/rag-search-limits.ts` declara, no próprio comentário,
que os quatro números da busca híbrida — os dois pesos (0.6/0.4), o limiar (0.2)
e o número de candidatos por sinal — não vêm de calibração nenhuma:

> NENHUM dos quatro números abaixo vem de calibração com dado real: não há,
> ainda, um corpo de perguntas reais rodado contra este índice.

O [ADR 0080](0080-busca-hibrida-pesos-limiar-e-citacao.md) escolheu esses valores com o
raciocínio registrado (as escalas de `ts_rank` e cosseno não são comparáveis, e
o peso maior do lado vetorial compensa a régua mais curta do léxico) e disse que
seriam revistos com dado. O dado nunca veio, e o motivo não era falta de uso: a
busca **não deixava rastro nenhum**. Zero linha de tabela, zero evento `rag.*`
no produto inteiro. Sem rastro, "calibrar" seria trocar um chute por outro — e
pior, seria irreversível na prática, porque não haveria com o que comparar o
antes e o depois.

Esta é a primeira das cinco etapas do programa de RAG mensurável, e ela é
deliberadamente a única que **não muda comportamento de busca**: dá os olhos, e
para.

### O obstáculo concreto

A saída óbvia seria evento de sessão — o event log já é o instrumento de medição
do resto do produto, e a regra do CLAUDE.md diz que métrica de execução se
extrai dele por script, nunca à mão. Mas `session_events.session_id` é
`NOT NULL` (`apps/api/src/db/schema/sessions.ts`), e **uma busca vinda da aba de
RAG é de PROJETO**: não tem sessão nenhuma. Registrar a telemetria só como
evento perderia exatamente as buscas em que um humano olhou os scores e julgou —
que são as que carregam o único sinal de verdade que a medição pode ter.

É a mesma classe de problema que forçou o corte do metering de embedding no
[ADR 0075](0075-embeddings-no-contrato-de-llm-provider.md): `token_usage.session_id`
também é `NOT NULL`, e indexar repositório não acontece dentro de sessão. Lá o
corte foi declarado e o gasto ficou de fora. Aqui o corte seria pior: sobrariam
metade das buscas, e as que sobram são as dos agentes — as que ninguém julga.

## Decision

**1. Duas tabelas em `apps/api/src/db/schema/rag.ts`, não eventos.**

`rag_searches` (uma linha por busca: `hits` com o rank 1-based de cada trecho,
`degraded`/`vector_available`, `latency_ms`, ator, e `session_id` **NULLABLE**)
e `rag_feedback` (o voto `util`/`irrelevante` sobre um trecho de uma busca).
O arquivo do agregado já existia (`chunks`), então não há mudança no barrel
`db/schema.ts`; o enum `rag_verdict` mora no mesmo arquivo da tabela que o
chama, pela convenção do [ADR 0121](0121-schema-dividido-por-agregado-de-dominio.md), e `actor_kind`
é reusado de `sessions.ts` em vez de redeclarado.

`session_id NULL` é **informação**, não ausência de dado: quer dizer que a busca
veio da aba.

**2. Os pesos vão CONGELADOS na linha.**

`pesosVigentes()` (`domain/rag/rag-telemetry.ts`) copia `{vector, lexical,
threshold}` do momento da busca para dentro do registro. É a mesma disciplina do
preço congelado no metering
([ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)) e
da `image_version` de `project_containers`
([ADR 0081](0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)).

Sem a cópia, a primeira calibração que mexesse em `RAG_SEARCH_WEIGHT_VECTOR`
faria toda a medição anterior passar a significar outra coisa, **em silêncio** —
e "melhorou depois da mudança?", a única pergunta que a telemetria existe para
responder, ficaria impossível de fazer com os dados que se tem. É função e não
constante exportada de propósito: uma constante compartilhada seria o mesmo
objeto em toda linha do JSONB em memória.

**3. O evento existe, e é NARRAÇÃO.**

`rag.search` e `rag.feedback` entram no event log **apenas quando há sessão** —
o caminho do agente —, para a timeline narrar o que ele fez. A assimetria é
declarada em vez de escondida: **a tabela é a fonte da medição, o evento é
narração**, e `medir:rag` nunca lê o event log.

Os dois tipos são escritos por EXTENSO nos pontos de emissão, não por constante:
o inventário de `docs/reference/events.md` é gerado por grep de `type: '<x>.<y>'`
sobre o código da api, e um tipo atrás de constante fica invisível para ele —
a doc passaria verde sobre uma lista incompleta. É a mesma forma que
`execution.activated` já usa. `'rag'` entra em `PREFIXOS_DE_EVENTO`
(`scripts/docs/generate.mjs`) no mesmo commit.

**4. Gravar telemetria nunca derruba a busca, e nunca falha calada.**

O INSERT roda em `try/catch` dentro de `HybridSearchUseCase`: quem pergunta não
deveria perder a resposta porque o instrumento de medição caiu. Mas a falha vira
log com a origem classificada (`infra`, [ADR 0020](0020-destravar-gates-qa-secops.md)) e
`searchId: null` na resposta — que **não** é o mesmo que "não achei nada": é
"não há a que anexar voto", e a UI precisa dos dois separados para não oferecer
um controle que a api recusaria.

**5. O voto exige a referência que a busca devolveu, e é `:direct`.**

`searchId` desconhecido, ou `chunkId` que não estava entre os hits daquela
busca, é 400. Não é rigor decorativo: o **rank** do trecho votado é o que separa
"o índice está pobre" de "os PESOS estão errados" — índice pobre não devolve o
trecho certo em posição nenhuma, peso errado devolve o trecho certo em rank 7 —,
e voto sem rank produz número sem significado.

A ferramenta do engine (`rag_feedback`) é `category: :direct` e **não** vira
`proposed_action`: dar nota a um trecho não tem efeito externo, e transformá-la
em ação a aprovar encheria a fila de ruído até ninguém mais ler as de verdade
(a mesma régua que mantém `rag_search`/`read_file` fora do pipeline). A recusa
volta como **tool-result de erro**, com a mensagem da api, para o modelo
corrigir (RN-061/RN-163), nunca como crash.

**6. `medir:rag` reprova por uma coisa só.**

`vector_available: false` na janela inteira: aí o que foi medido não é a busca
híbrida, é a metade léxica dela, e calibrar peso de vetor contra isso seria
calibrar contra um sistema que não é o que roda. Todo o resto — `precision@k`,
taxa de degradação, buscas sem hit acima do limiar, latência p50/p95,
distribuição de rank do que foi votado útil — é **relatório**: sai na tabela,
não reprova. Mesmo molde de `medir-execucao.ts`.

## Consequences

**A calibração fica possível, e continua não feita.** Esta etapa não muda
chunking, pesos nem limiar, de propósito: mexer nos números antes de acumular
medição destruiria a linha de base que ela existe para criar. O item continua
declarado em aberto no CLAUDE.md, agora com o instrumento ao lado.

**`degraded` e `vector_available` são duas colunas, e hoje são redundantes.**
`degraded = !vector_available` neste momento. A redundância está declarada no
schema em vez de escondida, e o motivo de não derivar uma da outra na leitura é
que elas não respondem a mesma pergunta: `vector_available` é um fato sobre o
PROVIDER de embedding no instante da busca — é ele que faz `medir:rag` reprovar
—, e `degraded` é a palavra do CONTRATO com o engine
(`POST /internal/rag/search`), cuja definição pode crescer para outras
degradações sem que o provider tenha caído. Derivar amarraria as duas para
sempre.

**O voto não sobrevive a "Reindexar agora".** `rag_feedback.chunk_id` referencia
`chunks` com CASCATA. Reindexar apaga e recria os chunks, então o histórico de
julgamento vai junto. Manter voto órfão apontando para um trecho que não existe
mais não mediria nada — mas o preço é real e está escrito no schema: quem
reindexa perde a base de comparação, e a medição recomeça.

**`precision@k` mede o que foi JULGADO, não o que foi devolvido.** O denominador
é o número de hits votados de rank ≤ k, nunca `k`. Um hit sem voto é
**desconhecido**, não irrelevante, e contá-lo como irrelevante faria a precisão
despencar sozinha toda vez que alguém votasse em menos trechos — medindo a
disposição de votar, não a qualidade da busca. A consequência aceita é que a
métrica só existe onde houver voto: sem nenhum, ela é `null` e a tabela diz
"não medido", nunca 0.

**O contrato interno com o engine cresceu nos dois sentidos.**
`POST /internal/rag/search` passou a aceitar `sessionId`/`agent` OPCIONAIS no
corpo (a api não tem como deduzir nenhum dos dois; uma sessão que ela não
recebeu é uma sessão que não existiu) e a devolver `searchId` mais um `chunkId`
por hit. O `chunkId` é a única exceção à simplificação deliberada daquele DTO —
sem o par `searchId`/`chunkId` o agente não teria a que apontar. Quando
`searchId` vem `null`, a tool **omite** os ids e o convite a votar, em vez de
oferecer ao modelo uma referência que seria recusada.

**Uma ferramenta a mais no prompt de seis agentes.** `rag_feedback` entra nos
seis registries que já tinham `rag_search` (`dev/tools.ex`, `gates/qa_tools.ex`,
`qa_estrategia_agent.ex`, `qa_performance_seguranca_agent.ex`,
`appsec_agent.ex`, `harness/tools.ex`). Custo real: mais um bloco de spec no
contexto de cada turno. A alternativa — só feedback humano — deixaria de fora o
caminho por onde a maior parte das buscas passa.

**Uma rota `viewer` que ESCREVE.** `POST /projects/:projectId/rag/feedback` é o
mesmo papel de `search`, e não `maintainer`: votar não gasta nem configura nada,
é observação, e restringi-la esvaziaria a única fonte de verdade da medição.
Está classificada em `docs/security-surface.md` com esse raciocínio; a contenção
é a validação de referência do caso de uso, não o papel.

**Nenhum agente novo, e nenhum gate.** O golden set e o gate `rag-acertivo` são
a etapa seguinte, e dependem desta ter acumulado dado antes de existirem.
