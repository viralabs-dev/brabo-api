# ADR 0095 — O gate `necessidade-validada` se fecha com confirmação humana separada, não com o Criativo se autovalidando

- **Status:** Aceito
- **Data:** 2026-08-17
- **Contexto:** auditoria fluxo.yml × código (Onda 6/última, item B2,
  `docs/explanation/auditoria-fluxo-vs-codigo.md`, seção D)
- **Estende:** [ADR 0054](0054-gates-como-registro-declarativo.md) (dono do
  desenho de `docs/gates.yml`)
- **Referências:** `docs/explanation/modelo-de-time.md` — o anti-padrão que
  motiva esta decisão já estava registrado ali como pendência

## Contexto

`docs/fluxo.yml` (papel `criativo`) declara `gate_saida: { id:
necessidade-validada, status: proposto }` desde o ADR 0085 (v3 do fluxo).
O gate nunca existiu de verdade: não há entrada em `docs/gates.yml`, nem
mecanismo nenhum em código. `docs/explanation/modelo-de-time.md` já
registrava o motivo de ele ter ficado parado, na lista "Propostas
pendentes de decisão":

> Anti-padrão do Criativo como validação real do gate
> `necessidade-validada`.

O anti-padrão é este: o Criativo é o agente que PRODUZ a necessidade de
negócio (via `emit_artifact`/`confirm_readiness`, consolidada num
`artifact.product_brief`). Se o próprio modelo decidisse quando essa
necessidade está "validada" — por exemplo, inferindo prontidão da
conversa —, o gate seria o autor se autoavaliando, não um portão de
verdade. Um gate sem verificação independente não mede nada; só finge que
mede.

### O que já existe e não é isto

- **`confirm_readiness`/RN-142** — o piso estrutural: recusa quando ZERO
  regras de negócio foram capturadas na sessão (`CriativoServer`,
  `handle_call(:confirm_readiness, ...)`). É checagem de FORMA (existe
  conteúdo?), não de MÉRITO (o conteúdo está certo?). Continua valendo
  exatamente como está — este ADR não mexe nele.
- **`AcceptHandoffUseCase`** — o aceite do handoff pelo PO é estrutural:
  transiciona o handoff para `accepted` e ativa o agente destino. Não
  julga o CONTEÚDO do que está aceitando; é o mesmo mecanismo genérico que
  todo handoff usa (QA aceitando de dev, Dev Lead aceitando do Arquiteto
  etc.). Tratar esse aceite como "validação da necessidade" reaproveitaria
  silenciosamente um evento que significa outra coisa.

Nenhum dos dois é gate de mérito. O que falta é um terceiro mecanismo,
deliberado.

## Decisão

**O gate se fecha com um clique explícito e SEPARADO do usuário** — mesmo
padrão interacional de "Confirmar arquitetura pronta"
([RN-160](../business-rules/autenticacao.md#rn-160)): um botão dedicado em
`SessionPage.tsx`, uma rota HTTP dedicada
(`POST .../agents/criativo/validate-necessity`), um caso de uso dedicado
(`ValidateNecessityUseCase`) que grava o evento de domínio
`necessity.validated` ([RN-406](../business-rules.md#rn-406)).

### Encadeamento: depois de `confirm_readiness`, não em paralelo com ele

Duas ordens eram razoáveis: (a) o botão de validação só habilita DEPOIS
que `confirm_readiness` já rodou (o `product_brief` existe); ou (b) os
dois botões coexistem, cada um com sua própria pré-condição, sem relação
de ordem entre si.

Escolhida (a). O argumento decisivo: **não faz sentido "validar" um
`product_brief` que ainda não foi consolidado** — `necessidade-validada`
é gate de SAÍDA do Criativo no `docs/fluxo.yml`, o momento em que o
trabalho dele já produziu um artefato concreto para o usuário julgar. A
opção (b) permitiria validar a necessidade ANTES de existir o resumo
executivo que a representa, o que inverteria a ordem do próprio fluxo (a
necessidade É o `product_brief` consolidado — não a conversa livre que o
precede). `hasProductBrief` (`events.some(e => e.type ===
'artifact.product_brief')`) é a pré-condição do botão novo, no mesmo
padrão de `hasBusinessRule`/`hasPromotedStory` que já guardam os dois
botões vizinhos.

### Por que NÃO sinaliza o engine

Diferente de `OfferInfraHandoffUseCase` (RN-160/[ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md)),
que dispara `engineClient.offerInfraHandoff`/`offerDevHandoff` porque a
CONFIRMAÇÃO é o que ativa o próximo passo, aqui o handoff Criativo→PO **já
aconteceu** dentro do próprio `confirm_readiness`
(`CriativoServer.executar_confirm_readiness/1` chama
`EngineApiClient.create_handoff` antes mesmo deste gate existir). Não há
nenhum agente esperando por `necessity.validated` para agir — o evento é
só o registro de que um humano confirmou o mérito do que já foi
entregue. `ValidateNecessityUseCase` não tem porta para o engine no
construtor, de propósito: nada além de `SessionEventRepository` (ler o
`product_brief` mais recente) e `AppendSessionEventUseCase` (gravar).

### `docs/gates.yml`: `warn`, não `block`

`aprovacao_humana: true` (é literalmente um clique humano) e `verificacao:
script` (o script de validação já pode extrair `necessity.validated` do
event log). Mas `severidade: warn`: nenhum mecanismo do produto hoje
CONSULTA se este gate passou antes de deixar o PO seguir — diferente de
`story-promovida`/`plano-de-adocao` (`block`, porque uma trava real de
código os impede de serem pulados), este gate é medição, não portão.
Mesmo espírito do comentário já usado em `implementavel`: "nasce `warn`
mesmo quando ativar". Se um mecanismo bloqueante nascer depois (ex.: o PO
recusando trabalhar sem a validação), a promoção para `block` é decisão
de produto nova, com seu próprio ADR — não implícita nesta entrega.

## Consequências

**A favor**

- Fecha a ÚLTIMA das seis ondas do plano da auditoria fluxo.yml × código
  (`docs/explanation/auditoria-fluxo-vs-codigo.md`, seção D) — as seis
  fecharam (a 3, 4 e 5 tinham sido antecipadas fora de ordem pelos ADRs
  0089/0090; a 1 e a 2 fecharam nos PRs anteriores; esta é a 6ª e
  última).
- `docs/gates.yml` deixa de ter um gate de papel `active` sem registro —
  a última lacuna desse tipo que a auditoria apontou.
- O mecanismo é reconhecível: quem já leu "Confirmar arquitetura pronta"
  (RN-160) lê este de graça — mesmo padrão de botão dedicado + pré-condição
  + evento próprio.

**Contra**

- Mais um clique no fluxo do Criativo, quando `confirm_readiness` já
  produz o `product_brief` e o handoff sozinho. Aceito: é exatamente esse
  clique a mais que separa "o modelo decidiu" de "o humano validou" — sem
  ele, não haveria gate nenhum, só o mesmo mecanismo de sempre com um nome
  novo.
- O gate `warn` não impede NADA de seguir sem ele — um projeto pode viver
  para sempre com `necessidade-validada` nunca acionado, e o PO segue
  trabalhando normalmente. Aceito de propósito: inventar um bloqueio sem
  ninguém do produto tendo pedido um portão duro seria a mesma classe de
  erro que os ADRs 0041/0042/0077 já recusam para capability/nota
  inventada — declarar o gate como medição honesta é melhor que fingir
  que ele trava algo que não trava.

## Alternativas consideradas

**Reaproveitar `confirm_readiness` — um único botão que já conta como as
duas coisas.** Recusada explicitamente pelo pedido que originou este ADR:
`confirm_readiness`/RN-142 é piso estrutural ("existe pelo menos 1 regra
capturada"), não julgamento de mérito sobre o CONTEÚDO da necessidade.
Fundir os dois manteria o piso raso disfarçado de gate novo.

**O Criativo (o modelo) decide sozinho, via ferramenta nova
(`confirm_necessity_validated` como tool call).** Recusada: é o
anti-padrão que este ADR existe para evitar — o mesmo agente que produziu
o `product_brief` não pode ser quem certifica que ele está certo.

**Tratar `AcceptHandoffUseCase` (o PO aceitando o handoff) como a
validação.** Recusada: o aceite é estrutural e genérico a TODO handoff do
produto — mudar o que ele significa só para esta origem quebraria a
leitura "aceitar = comecei a trabalhar" que QA, Infra e Dev Lead também
dependem dela ter.

**`severidade: block` desde já, travando o PO até a necessidade ser
validada.** Recusada: exigiria inventar um mecanismo de bloqueio (ex.:
`ActivateAgentUseCase` recusando ativar o PO sem `necessity.validated`)
que ninguém pediu e que não existe hoje para nenhum gate equivalente
(`arquitetura-pronta`/RN-160 também não bloqueia nada no backend fora da
revalidação de história promovida). Fica registrado como possibilidade
futura, não como parte desta entrega.

## Referências

- `apps/api/src/application/use-cases/agents/validate-necessity.use-case.ts`
- `apps/api/src/interfaces/http/agents/agents.controller.ts`
  (`validateNecessityHandoff`)
- `apps/web/src/routes/SessionPage.tsx` (`hasProductBrief`,
  `necessidadeJaValidada`, `handleValidateNecessity`)
- `docs/gates.yml` — gate `necessidade-validada`
- `docs/fluxo.yml` — papel `criativo`, `gate_saida`
- [RN-406](../business-rules.md#rn-406)
- [RN-160](../business-rules/autenticacao.md#rn-160) — o padrão interacional copiado
- `docs/explanation/modelo-de-time.md` — o anti-padrão que motivou a
  decisão (removido da lista de pendências por este ADR)
- `docs/explanation/auditoria-fluxo-vs-codigo.md` — achado B2, seção D
  (Onda 6, última do plano)
