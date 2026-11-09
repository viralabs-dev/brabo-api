---
id: rn-api-parte-03
title: 'Regras de negócio — API — parte 3 (desde RN-100)'
sidebar_label: 'API — parte 3 (desde RN-100)'
description: 'As RNs hospedadas na raiz api.'
keywords: [regras de negócio, api]
---

# API — parte 3 (desde RN-100)

## Painel de projetos {#painel-de-projetos-1}

<a id="rn-100"></a>

### RN-100 — A ordem do sino é do SQL, não do front {#rn-100}

A gaveta de notificações mostra os eventos **do mais recente para o mais
antigo**, e quando um projeto tem mais não lidos que o teto de 50 os que
aparecem são os **mais NOVOS**.

**A ordenação é do banco por necessidade, não por gosto.** A consulta corta em
50 **por projeto** com uma função de janela
(`row_number() OVER (PARTITION BY session_id ORDER BY seq DESC)`), e é ela que
decide **quais** 50 eventos sobrevivem — não só em que ordem eles saem. Com
`ASC` sobreviviam os 50 mais **antigos**, e um `.sort()` no cliente ordenaria
por recência justamente a janela que a consulta já tinha escolhido errado:
num projeto com 300 não lidos, o 251º evento apareceria como "o mais recente".
É por isso que não há ordenação nenhuma no caminho do front, e o comentário no
componente diz que não pode haver.

**A consequência, e por que o corte de leitura não mudou.** O corte é um `seq`
por projeto no `localStorage`, e **não existe endpoint de marcar lido**, por
decisão registrada na [RN-091](parte-02.md#rn-091). Um corte por `seq` marca um
**prefixo**; a gaveta agora mostra um **sufixo**. Marcar como lidas "as 50
exibidas" é inexprimível sem um conjunto de lidos **por evento** — tabela nova,
fora de escopo. Os dois únicos cortes expressáveis continuam sendo "nada" e
"tudo até agora".

A saída não foi mudar a semântica (ela continua avançando para o último `seq`,
exatamente como antes), foi **parar de esconder o que esse avanço engole**:

- cada projeto mostra o **total** de não lidos, não o tamanho da janela, e
  declara quantos ficaram de fora (`+ N mais antigos`);
- o botão passa a dizer o que faz — `marcar as N como lidas` — quando há algo
  fora da janela;
- o número que falta sai de **subtração**, não de requisição: `latestSeq`
  menos o corte já vem no resumo do workspace ([RN-090](parte-02.md#rn-090)).

Como a semântica do corte não mudou, **não há ADR** nesta regra: o que mudou
foi qual janela a consulta escolhe e o que a gaveta declara sobre ela.

- **Onde:**
  `src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
  (`unreadEventsForWorkspace`),
  `src/application/ports/projects-summary-repository.port.ts`,
  `src/interfaces/http/iam/dto/iam.response.dto.ts`
  (`ProjectUnreadEventsResponseDto`),
  `apps/web/src/lib/notifications.ts` (`useNotificationGroups`),
  `apps/web/src/components/NotificationBell.tsx`
- **Teste:**
  `test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  ("com mais não lidos que o teto, voltam os MAIS RECENTES, do novo para o
  velho" — afirma o CONJUNTO antes da ordem);
  `apps/web/src/components/NotificationBell.test.tsx` (renderiza na ordem
  recebida, sem reordenar; o contador é o total; o botão diz quantas marca);
  `apps/web/src/lib/notifications.test.tsx` (o que ficou fora da janela sai
  por subtração, sem segunda requisição);
  `apps/web/src/routes/Dashboard.fanout.test.tsx` (a gaveta continua sendo
  UMA requisição)
- **Origem:** pedido do usuário na primeira navegação real — "Sino e
  notificações devem sempre ordenar para última data modificada em descendente
  para a mais antiga"

---

<a id="rn-101"></a>

### RN-101 — O mesmo gasto, duas audiências: a fatura é do owner, o consumo é de quem gastou {#rn-101}

O produto responde **duas perguntas diferentes** sobre `token_usage`, e nenhuma
é recorte da outra.

**A do owner é por CREDENCIAL.** `GET /workspaces/:id/credential-spend` continua
como a [RN-060](parte-02.md#rn-060) o deixou — por provider, exigindo `owner`, respondendo
"quanto saiu da minha chave". Junto dele, `GET /workspaces/:id/spend-report`
(também `owner`) quebra o workspace por **modelo, provider, projeto, ator e
dia** — o eixo de provider entrou pela [RN-186](#rn-186). O owner vê os dois
porque é a única pessoa que pode ver os dois.

**A do membro é por ATOR.** `GET /projects/:id/spend/me` (papel `viewer`)
devolve, em tokens e custo **estimado**, o que **quem chamou** consumiu naquele
projeto, por sessão e por dia. Ela **não quebra por provider nem por
credencial** — a chave que rodou é a do owner ([RN-058](parte-02.md#rn-058)), e uma fatia
da fatura dele não é o que o membro está perguntando.

O ator **não é parâmetro**: sai do usuário autenticado, e não existe onde
escrever o id de outra pessoa. "Membro não vê linha de outro ator" é propriedade
da assinatura do caso de uso, não uma checagem que alguém pode esquecer de
chamar.

**Agente não entra na conta do membro.** `token_usage` registra quem GASTOU, não
quem mandou gastar; atribuir o agente a quem o iniciou seria inventar um dado
que a tabela não tem. Gasto de agente aparece no relatório do owner, de quem é a
chave.

**O eixo de `provider` existe, e o membro não o alcança.** Até o
[ADR 0076](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0076-provider-volta-a-ser-dimensao-de-gasto.md) ele simplesmente
não existia na agregação, e era a ausência que continha a visão do membro. Hoje
`sumGroupedBy` tem seis dimensões (`model`, `provider`, `project`, `actor`,
`session`, `day`) e a contenção mudou de forma, não de força: quem contém é o
TIPO — ver [RN-186](#rn-186) e [RN-187](#rn-187). O que não mudou é que dois
providers servindo o mesmo nome de modelo continuam caindo numa linha só na
dimensão `model`.

- **Onde:**
  `src/application/use-cases/llm/get-my-spend.use-case.ts`,
  `src/application/use-cases/llm/get-workspace-spend-report.use-case.ts`,
  `src/application/ports/token-usage-repository.port.ts`,
  `src/interfaces/http/llm/spend.controller.ts`,
  `apps/web/src/routes/ProjectSpendTab.tsx`
- **Teste:** `test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  (o membro não enxerga linha de outro ator, nem de agente, nem do owner; o
  filtro é pelo par `(kind, id)`; a resposta não carrega provider);
  `apps/web/src/routes/ProjectSpendTab.test.tsx`
- **Origem:** [ADR 0063](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0063-duas-audiencias-para-o-mesmo-gasto.md) (FASE 22),
  revisto pelo [ADR 0076](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

<a id="rn-102"></a>

### RN-102 — O modelo da área é padrão herdável; divergir é decisão do agente, e voltar a herdar apaga a decisão {#rn-102}

A cascata de binding ganhou um nível: `sessão > agente > **área** > projeto >
workspace`. `area` fica ENTRE agente e projeto — é o PADRÃO que o lead e os
subagentes de uma área compartilham (`qa`/`qa-automacao`/
`qa-performance-seguranca`, `infra`/`infra-workflows`, `dev`/`dev-<módulo>`), e
o binding do próprio agente é a DIVERGÊNCIA que o sobrepõe. Se a área viesse
ACIMA do agente ela venceria sempre, e "padrão herdável" seria, na prática,
"padrão imposto" — nenhum agente conseguiria escolher outro modelo.

O nível novo entra na MESMA revalidação de capability da
[RN-041](parte-01.md#rn-041)/[RN-043](parte-01.md#rn-043): modelo da área que sumiu do provider ou
que não faz tool calling é PULADO e registrado em `skipped`, exatamente como
`agent` já era. `assertModelFitsBindingScope` (RN-040) passou a exigir
`supports_tool_calling` também no escopo `area` — ela nunca é lida por chat
humano, só por agente, então deixá-la passar adiaria a mesma falha silenciosa
em um nível.

**"Voltar a herdar" apaga o binding, nunca copia o modelo do nível de baixo
para o de cima.** Gravar no agente o modelo que a área decidiu pareceria igual
na tela e não é: viraria uma CÓPIA, e a próxima mudança da área deixaria esse
agente para trás sem ninguém notar. Herdar é a AUSÊNCIA de decisão própria, e
desfazer uma divergência é remover a linha — `DELETE
/projects/:id/agent-bindings/:slug` e `DELETE
/projects/:id/area-bindings/:key`, ambos 204, ambos 404 quando o escopo já
herda (idempotência que MENTIRIA se fosse 204 silencioso: apagar o que não
existia e apagar de verdade são respostas diferentes para a mesma tela).

Mudar o modelo da ÁREA exige `maintainer`, e não `developer` como o do agente
individual — pelo mesmo motivo do teto de paralelismo
([RN-083](parte-02.md#rn-083)): o binding da área alcança o lead e TODOS os subagentes de
uma vez, e escolher modelo é decidir quanto o produto gasta sem perguntar.

**A TELA passou a honrar os DOIS mínimos, e são dois.** Até aqui
`ModelsSection` — a tabela de modelo por agente — não checava papel nenhum: o
`ModelPicker` da coluna MODELO VIGENTE e o "voltar a herdar" da coluna ORIGEM
apareciam clicáveis para todo mundo, `viewer` incluído, e a api recusava com
403. A saída NÃO foi copiar o gate da seção irmã (`owner || maintainer`): isso
trocaria o defeito pelo INVERSO, trancando um `developer` fora de uma ação que
`PUT`/`DELETE .../agent-bindings/:slug` aceita — e o inverso é pior, porque
oferecer o que será recusado ao menos termina num toast, enquanto perder
capacidade é invisível para quem a perdeu. O mínimo é do ENDPOINT, não da
seção, e as duas seções são vizinhas na MESMA tela com mínimos diferentes. A
comparação saiu das telas e virou `roleAtLeast` (`apps/web/src/lib/roles.ts`),
sobre o `ROLE_ORDER` que já existia — mesmo nome da função do backend, porque é
a mesma regra dos dois lados do fio; escrever a hierarquia à mão
(`role === 'owner' || role === 'maintainer'`) acerta por acidente enquanto o
mínimo é alto e erra calada quando é baixo. Papel AUSENTE (consulta em voo, ou
que falhou) não alcança nada: errar para o lado de desabilitar se conserta
recarregando.

**Some o CONTROLE, nunca a INFORMAÇÃO** (ADR 0064). Quem não pode editar
continua vendo o modelo vigente no gatilho e a cadeia de origem inteira
([RN-470](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-470)), e o "voltar a herdar" continua na linha, inerte — ele é o
que DIZ que aquele agente divergiu, e escondê-lo apagaria um estado que dá para
ler sem poder mudar. O motivo de estarem apagados é dito UMA vez, em texto, na
legenda da seção, e não por `title` em cada linha: tooltip em elemento
`disabled` não abre no Chromium (o navegador não despacha evento de mouse em
controle desabilitado), e uma explicação que não aparece é a mesma ausência com
mais código.

**Nada disso é fronteira de segurança, e o limite é declarado.** Quem recusa
continua sendo o `RolesGuard`. O papel que a tela lê é o do WORKSPACE
(`useCurrentWorkspaceWithRole`) e quem autoriza do outro lado é o papel EFETIVO
do PROJETO (`ResolveEffectiveRoleUseCase.forProject`), que uma linha de
`project_members` SOBREPÕE nos dois sentidos — então quem tem papel próprio no
projeto pode ver aqui um controle desabilitado que a api aceitaria. Fechar isso
exigiria uma consulta de papel POR PROJETO que o web ainda não tem, e é a mesma
lacuna que a caixa da área (RN-912) também carrega; inventar uma segunda fonte de papel
só numa seção seria pior que a lacuna.

> **Nota aditiva ([RN-471](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-471)):** a lacuna do parágrafo
> acima é UMA, não uma por seção, e onde a tela JÁ faz a consulta de papel por
> projeto ela se fecha em vez de se declarar. A seção de **Membros** busca
> `listProjectMembers`, que é `findMemberRole` para todo mundo de uma vez, e
> compõe `projectRole ?? workspaceRole` — exatamente o que `forProject` faz.
> Isso não é a segunda fonte de papel que este parágrafo recusa: é a MESMA
> composição, a partir de dados que aquela seção já tem em mãos. As duas seções
> de modelo continuam com a aproximação por não terem esses dados. Cuidado ao
> ler "SOBREPÕE nos dois sentidos" acima: é literal, e três descrições de OpenAPI
> afirmam o contrário — ver a RN-471.

- **Onde:** `src/domain/llm/binding-resolver.ts` (precedência),
  `src/domain/llm/model-capabilities.ts` (capability de `area`),
  `src/application/use-cases/llm/resolve-model-binding.use-case.ts`
  (a área do agente sai do catálogo `agent-areas.ts`, sem round-trip ao
  banco), `src/application/use-cases/llm/clear-model-binding.use-case.ts`,
  `src/interfaces/http/llm/model-bindings.controller.ts`
  (`area-bindings`, `DELETE` em `agent-bindings` e `area-bindings`),
  `apps/web/src/routes/settings/ModelsSection.tsx` (coluna Origem com
  "voltar a herdar"; desde a RN-912 o apagar da área é desmarcar a caixa do
  lead, e o gate de `maintainer` segue sobre `roleAtLeast` sem mudar de
  mínimo),
  `src/interfaces/http/llm/model-bindings.controller.ts:273` e `:301`
  (`developer` nos dois endpoints de agente — estas linhas NÃO mudaram),
  `apps/web/src/lib/roles.ts:49` (`roleAtLeast` — a comparação que faltava),
  `apps/web/src/routes/settings/ModelsSection.tsx:93` (`podeEditar`, e por que
  `developer` e não `maintainer`), `:379` (o picker desabilitado), `:446` (o
  botão desabilitado, e por que o motivo não vai em `title`), `:546` (a legenda
  que diz o motivo)
- **Teste:** `test/domain/llm/binding-resolver.spec.ts`,
  `test/domain/llm/model-capabilities.spec.ts`,
  `test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`,
  `test/application/use-cases/llm/clear-model-binding.use-case.spec.ts`,
  `apps/web/src/routes/ProjectSettingsTab.test.tsx`,
  `apps/web/src/routes/settings/papel-na-tabela-de-agentes.test.tsx`
  (`viewer` não edita e o clique não chega na api; `developer` edita e o
  PUT/DELETE chega; papel ausente é inerte; a informação da linha sobrevive ao
  controle apagado; e o caso que impede "uniformizar" as duas seções — o mesmo
  `developer` vê a tabela de agentes habilitada e a de áreas desabilitada, ao
  mesmo tempo)
- **Origem:** [ADR 0064](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) (FASE 23)

<a id="rn-103"></a>

### RN-103 — O binding de agente é POR PROJETO, não mais global {#rn-103}

Até a FASE 23, `scope = 'agent'` guardava um SLUG global
(`scope_id = 'qa'`), e `PUT /projects/:id/agent-bindings/:slug` recebia
`:projectId` na rota e o DESCARTAVA de propósito — escolher o modelo do
Arquiteto na tela de um projeto mudava o modelo dele em TODOS os projetos.
Isso deixou de se sustentar quando a área virou padrão herdável (RN-102): a
área é por projeto, e um binding de agente global ACIMA de um padrão por
projeto faria o mesmo agente resolver modelos diferentes só onde existisse
área — e faria "voltar a herdar" apagar uma decisão que alcançava projetos
que ninguém está olhando.

A saída foi tornar `agent` por projeto também, e não rebaixar a área para
abaixo do agente: `scope_id` de `agent` e de `area` virou COMPOSTO —
`<projectId>:<slug do agente|chave da área>` — em vez de inventar uma tabela
nova só para guardar um projeto por binding. UUID de projeto e slug de agente
nunca contêm `:`, o que torna o primeiro `:` um separador não ambíguo; a
leitura corta nele, e não em todos, para um slug com `:` (nenhum existe hoje,
mas nada impede) não virar três pedaços.

`scope_id` sem o projeto (o formato antigo) é RECUSADO na escrita, não aceito
e ignorado: gravá-lo criaria um binding que a cascata nunca mais encontraria
— invisível, e não um erro. A migração 0040 espalha cada binding de agente
global existente para uma linha por projeto (preservando o que cada projeto
resolvia antes da mudança) e apaga o formato antigo; é ESPALHAR e não
apagar porque a linha global nunca guardou informação de a quem "pertencia" —
inventar um projeto dono seria inventar dado que não existia.

- **Onde:** `src/domain/llm/binding-scope-id.ts` (formato e
  validação), `src/application/use-cases/llm/set-model-binding.use-case.ts`
  (`workspaceDoEscopo` passou a derivar o workspace de `agent`/`area` também —
  a curadoria da RN-043 não era verificável neles antes), `src/db/migrations/0040_tearful_night_nurse.sql`
- **Teste:** `test/domain/llm/binding-scope-id.spec.ts`,
  `test/application/use-cases/llm/set-model-binding.use-case.spec.ts`,
  `test/application/use-cases/llm/resolve-model-binding.use-case.spec.ts`
  ("o binding de agente é POR PROJETO: o vizinho não o enxerga")
- **Origem:** [ADR 0064](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) (FASE 23)

<a id="rn-105"></a>

### RN-105 — Sem imagem decidida pelo Arquiteto, o container não sobe e o Code não abre {#rn-105}

A aba Code (`GET /projects/:id/code/*`, [ADR 0060](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0060-superficie-de-leitura-de-codigo.md))
responde **409** enquanto o projeto estiver em `sem_decisao` — o estado inicial
de todo projeto. `sem_decisao` vira `decidido` só quando o Arquiteto emite
`artifact.project_image` pela ferramenta `choose_project_image`, com imagem OCI
de tag explícita (`latest` recusado), `rationale` e postura de rede.

A checagem mora no MESMO funil que a contenção de caminho da
[RN-095](parte-02.md#rn-095) (`ReadProjectCodeUseCase.alvo`), e não em cada uma das sete
rotas (árvore, arquivo, busca, diff de PR, [blame](https://github.com/viralabs-dev/brabo-contracts/blob/dev/packages/docs/business-rules/contracts.md#rn-110), [lista de
PRs](https://github.com/viralabs-dev/brabo-contracts/blob/dev/packages/docs/business-rules/contracts.md#rn-111) e [branches detalhadas](https://github.com/viralabs-dev/brabo-contracts/blob/dev/packages/docs/business-rules/contracts.md#rn-112), FASE 26b) — checagem
duplicada em sete chamadores é checagem que um dia diverge em um deles
([ADR 0058](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md)).
Contagem corrigida aqui: este registro dizia "quatro rotas" desde a FASE 26,
e ficou desatualizado quando a FASE 26b acrescentou as três últimas ao mesmo
funil sem que ninguém revisasse este número.

A fila de PRs prontas do chat e o aviso de PR pronta NÃO passam por este portão (AT-843, decisão do dono de 08/11/2026): eles leem `GET /projects/:projectId/git/open-pull-requests`, que lista só as PRs abertas, sem conteúdo de arquivo, pelo mesmo funil `alvo` com o portão desligado. As sete rotas `/code/*`, inclusive a lista da aba PRs, seguem respondendo 409 em `sem_decisao`.

O artefato não tem tabela: é o próprio evento no event log, versionado
(`version` cresce a cada emissão, o vigente é o de maior `version`), do mesmo
jeito que `artifact.module_map`. Revisar a imagem é emitir uma versão nova,
nunca sobrescrever a anterior.

- **Onde:** `src/domain/containers/project-container.ts`,
  `src/application/use-cases/containers/decidir-imagem-do-projeto.use-case.ts`,
  `src/application/use-cases/containers/obter-container-do-projeto.use-case.ts`,
  `src/application/use-cases/git/read-project-code.use-case.ts` (método
  `portaoDoContainer`), `apps/engine/lib/engine/harness/tools/choose_project_image.ex`
- **Teste:**
  `test/domain/containers/project-container.spec.ts`,
  `test/application/use-cases/containers/container-do-projeto.use-case.spec.ts`,
  `test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (bloco "o portão do container")
- **Borda:** 409 e não 403 — nada está errado com quem pediu nem com a
  permissão dele; o recurso ainda não existe NESTE ESTADO. E não é 404: a aba
  existe, só não está liberada. A mensagem diz o que falta, para a tela mostrar
  o motivo em vez de um erro mudo (RN-088).
- **Origem:** [ADR 0065](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

<a id="rn-106"></a>

### RN-106 — `git push`, PR e deploy não saem pelo terminal — mesmo dentro do escopo do projeto {#rn-106}

**REVISADA pela [RN-418](parte-04.md#rn-418) (ADR 0102, decisão GLOBAL do dono do
produto)**: o `deny` que este registro descreve virou TETO ABSOLUTO
(`require_approval` incondicional) — o resto desta entrada é histórico,
fiel ao que valia até a revisão.

Dentro do container do projeto o agente é livre (ADR 0065): o allowlist de
verbos do [ADR 0055](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0055-escopo-de-caminho-na-politica-de-terminal.md) não
converge (achados Z e AD — verbo, forma e invocação são espaços distintos), e a
saída é a parede, não uma lista mais longa. Mas três efeitos atravessam a
parede e chegam no mundo, e a decisão do usuário foi textual: *"agente livre
para o que quiser desde que não seja comandos de git ligado ao deploy e ao PR —
estas ações ainda devem ser humanas"*.

`decide()` reconhece `git push`, `git remote add/set-url`, `git merge`, os CLIs
de provider (`gh pr create`, `gh pr merge`, `glab mr create/merge`, releases e
workflow dispatch) e os comandos de deploy comuns (`kubectl apply`, `helm
upgrade`, `terraform apply`, `docker push`, `npm publish`, ...) por PREFIXO de
tokens, ignorando flags globais no meio (`git -C /tmp push` casa). Qualquer
segmento do comando composto que case é **`deny`** — não `require_approval`:
"sempre permitir" grava o padrão em `allow`, e um clique bastaria para a
segunda porta ficar aberta para sempre. `deny` vence `allow` em qualquer
estágio, e é aplicado ANTES de qualquer estágio permissivo em `decide()`.

Negar não tira poder do agente: a mensagem redireciona para a ação TIPADA
(`git_push`, `git_merge`, `pr_open`) — que nasce `proposed_action`, tem papel
mínimo próprio e registra no event log o que foi empurrado e para onde. É o
caminho que o dev agent já usa (`agent_io.ex` propõe `git_push`); o que muda é
que agora está garantido por `deny`, não só combinado por convenção.

- **Onde:** `src/domain/actions/external-effect.ts`,
  `src/domain/actions/decide.ts` (bloco "FRONTEIRA DO CONTAINER")
- **Teste:** `test/domain/actions/external-effect.spec.ts`,
  `test/domain/actions/decide.spec.ts` (describe "a fronteira do
  container")
- **Borda:** a fronteira NÃO se sobrepõe à trava de merge em branch protegida
  (RN-014, sempre manual) nem ao escopo de caminho (RN-095/ADR 0055) — as três
  regras coexistem, cada uma vetando por um motivo diferente.
- **Origem:** [ADR 0065](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)

<a id="rn-109"></a>

### RN-109 — O nome de pasta do workspace é congelado na criação, e projeto antigo mantém o UUID {#rn-109}

A pasta física de um projeto em `PROJECT_WORKSPACES_ROOT` era o UUID puro —
ilegível ao abrir no disco. `projects.workspace_dir_name` (NOT NULL, UNIQUE)
passou a guardar o nome de verdade: `<slug>-<8 chars do id>` para projeto
NOVO (`workspaceDirNameFor` em
`src/infrastructure/filesystem/project-workspaces-root.ts`), gerado
em código — o id nasce de `crypto.randomUUID()` no
`CreateProjectUseCase`, não do `defaultRandom()` do Postgres, porque o nome
da pasta precisa do id ANTES do insert. Os 8 caracteres seguem a mesma
convenção do rótulo de sessão (`apps/web/src/lib/session-label.ts`).

O nome é CONGELADO no momento da criação e nunca recalculado: `UpdateProjectUseCase`
permite editar o `slug` depois, e isso NÃO toca `workspace_dir_name` — reservar a
pasta física, com working tree e worktrees de agente possivelmente abertos, é
risco real que a decisão evita por construção, não por disciplina de quem
chama.

Projeto criado ANTES desta migração (0042) manteve a pasta física que já
tinha: o backfill grava `workspace_dir_name = id` para toda linha existente —
o mesmo valor que já era verdade no disco — e NUNCA renomeia diretório
nenhum. Um trigger `BEFORE INSERT` (`projects_workspace_dir_name_default_trg`)
aplica o MESMO fallback (`id::text`) para qualquer insert que chegue sem o
campo — rede de segurança para quem esquecer de gravá-lo (nunca o caminho
principal, que sempre grava explícito), e o que mantém as dezenas de
fixtures de teste existentes, que não conhecem este conceito, funcionando
sem precisar reescrever cada uma.

A derivação de caminho a partir do nome (`projectScopeRoot`, RN-092/RN-075)
passou a receber `workspace_dir_name` em vez do `projectId` cru — mesma
validação de charset, mesma pureza. O engine lê a MESMA coluna
(`Engine.Projects.Project.workspace_dir_name/1`) para resolver
`Engine.Actions.Workspace.workspace_dir/1`, nunca recomputando o nome a
partir do id: as duas derivações (api e engine) são, na prática, a mesma
leitura contra o mesmo banco — é o que garante que RN-075 (escopo de
terminal) e RN-092 (leitura de código) continuam apontando para a MESMA
pasta que o engine realmente usa.

- **Onde:** `src/db/schema/iam.ts` (`projects.workspaceDirName`),
  `src/db/migrations/0042_tough_captain_midlands.sql`,
  `src/infrastructure/filesystem/project-workspaces-root.ts`
  (`workspaceDirNameFor`, `projectScopeRoot`),
  `src/application/use-cases/iam/create-project.use-case.ts`,
  `apps/engine/lib/engine/projects/project.ex`
  (`workspace_dir_name/1`, `all_workspace_dirs/0`),
  `apps/engine/lib/engine/actions/workspace.ex` (`workspace_dir/1,2`),
  `apps/engine/lib/engine/dev/worktree_cleanup.ex`
- **Teste:**
  `test/db/workspace-dir-name-migration.spec.ts` (trigger, backfill
  equivalente, unicidade),
  `test/application/use-cases/iam/create-project-semeia-areas.spec.ts`
  (`workspaceDirName` nasce `<slug>-<8 chars>`, dois projetos com o mesmo
  slug em workspaces diferentes não colidem de pasta),
  `test/infrastructure/filesystem/project-workspaces-root.spec.ts`
- **Borda:** o teto de paralelismo e o gate de merge não mudam — RN-109 é só
  NOME de pasta, nunca política. Renomear o slug depois da criação não
  renomeia a pasta; a pasta só se lê pelo `workspace_dir_name` gravado.
- **Origem:** ADR 0066 (revisa o ADR 0055).

<a id="rn-114"></a>

### RN-114 — Os quatro segredos irmãos do `GIT_OAUTH_STATE_SECRET` também não sobem em produção com o valor de exemplo {#rn-114}

O [ADR 0059](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0059-segredo-do-state-de-oauth-sem-default.md) fechou o
padrão para `GIT_OAUTH_STATE_SECRET` e deixou declaradamente aberto que o
mesmo modo de falha valia para quatro segredos irmãos, todos com default de
desenvolvimento no `docker-compose.prod.yml`: `AUTH_JWT_SECRET`,
`BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY` e `SECRET_KEY_BASE`. Esta RN
fecha os quatro, replicando exatamente a mesma regra — não é decisão nova,
é a mesma decisão aplicada aos irmãos.

Em produção (`NODE_ENV === 'production'`), cada resolutor **derruba o boot**
quando a variável está ausente/só com espaços, é igual ao literal de exemplo
do repositório (que é público — está no `.env.example`), ou tem menos de 16
caracteres. Fora de produção o default de desenvolvimento continua valendo,
porque `docker compose up` sem `.env` tem que funcionar.

- `AUTH_JWT_SECRET` — deriva o par Ed25519 que assina o access token. Com o
  default público, qualquer um forja um access token válido.
- `BRABO_SERVICE_TOKEN` — autentica o tráfego interno api ↔ engine. Com o
  default público, qualquer um chama as rotas `/internal/*` sem passar pelo
  `EngineServiceGuard`.
- `CREDENTIALS_MASTER_KEY` — embrulha os DEKs que cifram as credenciais do
  usuário (chaves de LLM, tokens de git). Com o default público, qualquer um
  decripta o acervo. **Fora de escopo aqui**: qualquer mecanismo de rotação —
  esse já existe (`CREDENTIALS_MASTER_KEY_PREVIOUS` +
  `src/scripts/rewrap-deks.ts`) e não muda; esta é só a checagem de BOOT.
- `SECRET_KEY_BASE` (engine) — já derrubava o boot sem a variável
  (`runtime.exs`, bloco `:prod`, boilerplate padrão do Phoenix). O defeito
  real não era falta de checagem no Elixir: era o `docker-compose.prod.yml`
  suprir o literal público como fallback, o que fazia a variável chegar
  sempre DEFINIDA e mascarava o `raise` que já existia. A correção aqui foi
  só remover o fallback do compose — nenhuma linha de Elixir mudou.

Vale a mesma razão do ADR 0059 para rejeitar o literal, e não só o vazio: o
`docker-compose.prod.yml` supria os quatro literais como fallback, então no
caminho real de erro as variáveis estavam **definidas** — uma verificação de
"não vazia" passaria por cima do defeito inteiro.

- **Onde:** `src/infrastructure/security/auth-key-material.ts`
  (`passphraseAtual`), `src/infrastructure/security/service-token.ts`
  (`tokenDeServicoAtual`) e
  `src/infrastructure/security/envelope-encryption.service.ts`
  (`EnvelopeEncryptionService`, checagem no construtor) — os dois primeiros
  chamados no boot em `src/main.ts`, o terceiro exercitado quando o
  `NestFactory.create` monta o grafo de providers. `SECRET_KEY_BASE` em
  `apps/engine/config/runtime.exs` (inalterado) com o fallback removido de
  `docker/docker-compose.prod.yml`
- **Teste:** `test/infrastructure/security/auth-key-material.spec.ts`,
  `test/infrastructure/security/service-token.spec.ts` e o describe
  `validação de produção` em
  `test/infrastructure/security/envelope-encryption.service.spec.ts`
- **Origem:** [ADR 0059](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0059-segredo-do-state-de-oauth-sem-default.md)

<a id="rn-127"></a>

### RN-127 — `ref`/`path` da aba Code recusam chegar como ARRAY, não só como caminho fora do escopo {#rn-127}

`@Query('ref') ref?: string` e `@Query('path') path?: string`
(`code.controller.ts`) extraem o valor cru sem DTO/`class-validator` no
meio, e o `ValidationPipe` global (`main.ts`) não ajuda: ele pula tipo
primitivo nativo (`String`) por desenho do Nest, então nada intercepta
`ref`/`path` antes de chegarem como argumento de método. O Express entrega
`?ref=a&ref=b` como **array**, não string — a anotação `string` do
TypeScript só existe em compile-time.

Um array escapava das DUAS checagens que a [RN-095](parte-02.md#rn-095) já fazia
tratando o valor como string: `ref.includes('..')` tem semântica de
ELEMENTO EXATO (não substring) em array, e `REF_VALIDO.test(ref)` chama
`.toString()` no array antes de casar — um valor como `['x/../y']`
continha `..` e ainda assim passaria pelas duas.

`garantirQueryEscalar(valor, criarErro)` recusa o array ANTES de qualquer
outra checagem, num lugar só, reusado pelos DOIS pontos que tratavam query
como string: `caminhoDeRepositorioContido` (mesmo arquivo da RN-092/095) e
`ReadProjectCodeUseCase.alvo` (`ref`). O erro concreto (`CaminhoForaDoEscopoError`
ou `BadRequestException`) é decidido por quem chama, passado como fábrica —
a função central não decide o tipo de erro, só a forma da checagem.

O caminho feliz não muda: todo `ref`/`path` legítimo já era string.

- **Onde:** `src/infrastructure/filesystem/project-workspaces-root.ts`
  (`garantirQueryEscalar`, usada em `caminhoDeRepositorioContido`),
  `src/application/use-cases/git/read-project-code.use-case.ts`
  (`alvo`, `ref`)
- **Teste:**
  `test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (`garantirQueryEscalar` isolada e `caminhoDeRepositorioContido` recusando
  array), `test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (`ref`/`path` como array são 400 em `tree`, que todas as outras rotas
  reusam via `alvo`)
- **Origem:** alerta CRÍTICO do CodeQL (confusão de tipo em query param HTTP)
  bloqueando a promoção qa→main, achado durante a PR #256; estende a
  [RN-095](parte-02.md#rn-095)

<a id="rn-128"></a>

### RN-128 — `sessionId`/`projectId`/`agent`/`agentId` são validados ANTES de virar segmento de URL da requisição interna ao engine {#rn-128}

`HttpApiToEngineClient` interpola estes valores em template string pra
montar a URL de `/internal/*` — sem DTO/`class-validator` no meio, igual
à [RN-127](#rn-127): eles chegam de `@Param`/lookup de sessão sem pipe de
validação em algum ponto da cadeia, e nada garante a forma deles antes da
interpolação. Um valor malicioso poderia injetar segmento de path extra
ou caracteres que quebram a URL montada — o `EngineServiceGuard` autentica
o CHAMADOR (RN-035), não CONFERE o que o chamador manda na URL.

`garantirSegmentoDeUrlInterna` reusa a mesma largura de
`NOME_DE_PASTA_VALIDO` (RN-092/109) — hex, hífen e sublinhado, 1 a 64
chars — e é chamada em DOIS lugares, cobrindo TODOS os métodos que
interpolam id em URL, não só os que o CodeQL reportou:

- dentro de `postCommand`, que a maioria dos métodos já usa
  (`startAgent`, `sendAgentMessage`, `confirmReadiness`, `cancelAgentTurn`,
  `offerInfraHandoff`, `invalidateInstructions`,
  `startExecution`, `acceptParallelization`, `rearmDevAgent`,
  `reviseStory`) — o chamador lista as tuplas `(nome, valor)` que já
  interpolou no `path`, e `postCommand` valida TODAS antes de montar a
  requisição;
- direto em `reanalyzeSession`/`runAnamnese`, que não passam por
  `postCommand` (precisam distinguir 503 de falha de transporte) e por
  isso eram os dois únicos pontos que o CodeQL alcançou.

O caminho feliz não muda: `sessionId`/`projectId` são sempre UUID vindo do
banco, e `agent`/`agentId` são sempre slug curto.

- **Onde:** `src/infrastructure/http-clients/api-to-engine-client.ts`
  (`garantirSegmentoDeUrlInterna`, `postCommand`)
- **Teste:** `test/infrastructure/http-clients/api-to-engine-client.spec.ts`
  (id malformado é recusado ANTES de tocar a rede — provado apontando
  `ENGINE_URL` pra uma porta que nada escuta — e o caminho feliz chega a
  fazer a requisição)
- **Origem:** alerta CRÍTICO do CodeQL (URL de requisição interna montada
  com valor não validado) bloqueando a promoção qa→main, achado durante a
  PR #256; mesmo padrão do [RN-092](parte-02.md#rn-092)

<a id="rn-135"></a>

### RN-135 — Ativar a execução fecha a sessão de CHAT que originou o pedido {#rn-135}

`ActivateExecutionUseCase` sempre resolvia a sessão de EXECUÇÃO
(`findActiveExecutionSession`, ou criava uma `criativa` nova), mas nunca
transicionava a sessão de CHAT de onde veio o clique em "ativar execução" — a
conversa com o Dev Lead/PO, numa sessão separada. Ela ficava `active` para
sempre, mesmo com a execução já rodando sozinha em outra sessão, e continuava
aparecendo como conversa aberta na lista.

`execute()` ganhou `originSessionId`, opcional e por último — um chamador
antigo (hoje só a ativação pela Visão Geral, sem contexto de sessão) continua
funcionando de forma IDÊNTICA, sem fechar nada. Quando passado, no FIM do
método (depois de tudo o mais ter acontecido: module_map, áreas, autonomia,
`startExecution`, `execution.activated`):

- **nunca fecha a própria sessão de execução** — se `originSessionId` for
  igual à sessão que acabou de receber `execution.activated`, o fechamento é
  pulado, porque fechá-la destruiria o processo que os dev agents acabaram de
  ganhar;
- **só fecha o que está `active`** — a mesma cautela de
  `decide-bootstrap-plan.use-case.ts#fecharSessao`, nada a fazer se a sessão
  não existe mais ou já não está aberta;
- **reaproveita o `GetSessionPendingWorkUseCase`** ([RN-073](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-073)) — a
  MESMA guarda que segura o fechamento por heartbeat de inatividade: um
  handoff oferecido, uma `proposed_action` pendente ou um agente `working` sem
  `idle` posterior impedem o fechamento;
- passa por `closing` antes de `closed` — a máquina de estados
  (`active -> closing -> closed`) não permite o salto direto.

Uma falha ou estado pendente aqui NUNCA se propaga a quem chamou `execute()`: a
ativação da execução já aconteceu e é o efeito principal; fechar o chat de
origem é um efeito colateral *best-effort*.

- **Onde:** `src/application/use-cases/execution/activate-execution.use-case.ts`
  (`closeOriginSession`), `src/interfaces/http/execution/dto/activate-execution.dto.ts`
  (`originSessionId`), `src/interfaces/http/execution/execution.controller.ts`
- **Teste:** `test/application/use-cases/execution/activate-execution.use-case.spec.ts`,
  describe `fecha a sessão de origem (RN-135)` — fecha sem pendência,
  NÃO fecha com pendência, NÃO fecha sessão já não-`active`, chamador
  antigo sem o parâmetro não fecha nada, e nunca fecha a própria sessão de
  execução mesmo se `originSessionId` coincidir com ela
- **Origem:** achado de investigação de código — sessão criativa com
  execução ativada continuava `active` na lista mesmo com 35 eventos de
  dev agents dentro dela

<a id="rn-139"></a>

### RN-139 — A aba Executores lê a sessão de execução VIGENTE, nunca a mais recente do projeto {#rn-139}

`ProjectExecutorsTab` buscava os eventos de dev agent/QA pela sessão que
`useLatestSession` devolvia — a de `createdAt` mais recente do projeto, sem
filtrar por `kind` nem exigir `execution.activated`. Funcionava só por
**coincidência**: a sessão de execução costuma ser a mais nova. Assim que
qualquer sessão nasce depois dela — uma ideação nova, um chat consultivo — a
aba passa a olhar essa sessão nova, vazia de eventos de execução, em
silêncio: nenhuma pista na tela dizia qual sessão estava sendo exibida.

A leitura correta já existia no backend: `findActiveExecutionSession`
(`SessionRepository`) — a sessão `active` mais recente que carrega
`execution.activated` — mas só era usada internamente por
`ActivateExecutionUseCase` para decidir se reativa ou cria. A correção expõe
o MESMO critério por HTTP, em vez de duplicá-lo no front:

- **`GET /projects/:projectId/execution/session`** (`role:viewer`) devolve a
  sessão vigente ou `null` — nunca infere pela mais recente;
- `ProjectExecutorsTab` troca `useLatestSession` por `useActiveExecutionSession`
  (novo hook sobre a rota acima) como fonte da sessão que a aba inteira lê;
- o cabeçalho da aba sempre mostra QUAL sessão está sendo exibida — o rótulo
  dela (hashtag + nome) linkando para `SessionPage`, ou "Nenhuma execução
  ativa" quando `null` — nunca mais implícito. Os três estados da
  [RN-088](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-088) se aplicam à própria busca da sessão: carregando, erro
  (com `trace_id`) e vazio (`null`) são três renders distintos, nunca um
  `if (!sessão) return null` que os colapsa.

- **Onde:**
  `src/application/use-cases/execution/get-active-execution-session.use-case.ts`,
  `src/interfaces/http/execution/execution.controller.ts` (`getSession`),
  `apps/web/src/lib/hooks.ts` (`useActiveExecutionSession`),
  `apps/web/src/routes/ProjectExecutorsTab.tsx`
- **Teste:**
  `apps/web/src/routes/ProjectExecutorsTab.test.tsx` — mostra a sessão de
  execução mesmo com sessão mais recente existindo no projeto, estado
  "nenhuma execução ativa" explícito, e erro de rede tratado (não em branco)
- **Origem:** achado de investigação de código + teste ao vivo — a mesma
  classe de defeito que a RN-088 fechou para 429, agora para "qual sessão a
  tela está olhando"

<a id="rn-143"></a>

### RN-143 — Um subcomando de git somente leitura só é permitido ancorado pela flag que torna a leitura inequívoca, nunca pelo verbo solto {#rn-143}

Consultando o banco de uma execução real, os dev agents queimaram dezenas de
aprovações manuais em subcomandos de exploração — `git branch -a`, `git
remote -v`, `git worktree list`, `git show origin/dev --stat`, `git log
--all --oneline --graph`, `git for-each-ref`, `git ls-tree -r origin/dev
--name-only`, `git config user.name` — nenhum coberto pela [RN-068](parte-02.md#rn-068),
que só permitia `git status`/`diff`/`log` (sem flags extras). Como o casamento
por prefixo de token exige que TODO segmento de um comando composto esteja em
`allow`, uma longa cadeia de exploração caía inteira em `require_approval` no
instante em que UM desses subcomandos aparecia no meio.

`DEV_TERMINAL_ALLOW_PATTERNS` ganhou
`git branch -a/-r/-v/--list/--show-current`, `git remote -v`/`git remote
show`, `git worktree list`, `git show`, `git for-each-ref`, `git
ls-tree`, `git rev-parse` e `git config --get`. O `git log` não precisou de
padrão novo: o casamento já é por PREFIXO de token (tokens finais extras são
permitidos), então `Terminal(git log)` já cobria `git log
--all --graph --oneline --decorate`.

**A cautela aqui é a mesma que a RN-068 já mostra para `ls`/`lsof`, aplicada
a verbos com um irmão MUTANTE que aceita a mesma forma truncada do padrão.**
`Terminal(git branch)` casaria `git branch -D nome` (apaga) tanto quanto `git
branch nome-nova` (cria) ou `git branch` sozinho — o padrão não vê o que vem
DEPOIS do prefixo que conferiu. É por isso que nenhum dos quatro verbos com
forma mutante (`branch`, `remote`, `worktree`, `config`) foi admitido pelo
verbo solto; cada um foi ANCORADO pela flag que torna a leitura inequívoca
independentemente do que vem depois:

- `git branch` — ancorado em `-a`/`-r`/`-v`/`--list`/`--show-current`, nunca
  no verbo sozinho; `-D`/`-d`/`-m`/`-M` (apagar/renomear) e um nome de branch
  solto (criar) ficam de fora.
- `git remote` — ancorado em `-v` e `show` (que só aceita um nome de remoto
  depois, sempre uma leitura); `add`/`remove`/`set-url` ficam de fora.
- `git worktree` — ancorado em `list`; `add`/`remove`/`prune` ficam de fora.
- `git config` — só `--get` foi admitido, porque é a única flag que o próprio
  git garante ser leitura independentemente do que vem depois (uma chave, ou
  uma chave + padrão de valor). `git config user.name`/`git config
  user.email` SEM `--get` foram deixados de fora deliberadamente: um segundo
  token depois da chave (`git config user.name "novo valor"`) é uma ESCRITA, e
  o casamento por prefixo não distingue "nenhum token a mais" de "um token a
  mais" sem inventar um novo parser de contagem de argumentos — a mesma
  limitação que já bloqueia um `git branch` solto. `--global`/`--system`
  nunca foram ancorados.

- **Onde:** `src/domain/actions/dev-terminal-patterns.ts`
- **Teste:** `test/domain/actions/dev-terminal-patterns.spec.ts` (describe
  `read-only git subcommands (found live)` — cobre a cadeia composta
  observada ao vivo sendo auto-aprovada, e cada variante mutante com a MESMA
  palavra de comando — `git branch -D`, `git remote add`, `git worktree add`,
  `git config --global user.name` — permanecendo em `require_approval`)
- **Origem:** consulta ao banco de uma sessão real, achada durante o uso

<a id="rn-145"></a>

### RN-145 — O Arquiteto também tem um botão de prontidão, e a MESMA confirmação oferece Infra e Dev Lead {#rn-145}

`OfferInfraHandoffUseCase` (`POST .../agents/arquiteto/handoff-infra`) já
existia desde a Fase 4a — grava `architecture.readiness_confirmed` e chama o
engine, que oferece o handoff ao Infra e, na MESMA confirmação, ao Dev Lead
(FASE 14d/ADR 0053). O que faltava era o jeito de chegar até ele: nenhum
lugar do frontend chamava o endpoint. O botão "Confirmar arquitetura pronta"
existe pro Criativo desde sempre ("Estou pronto para produzir",
[RN-131](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-131)/[RN-142](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-142)) — o Arquiteto não tinha equivalente
nenhum, e sem o clique o handoff nunca nascia: a correção de prioridade do
card no fio ([RN-125](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-125)) ficava sem efeito prático, porque não havia o
que mostrar.

`arquitetoActive` espelha `criativoActive` (existe um `agent.activated` pro
Arquiteto nesta sessão) e `arquiteturaJaDeclarada` espelha
`prontidaoJaDeclarada` (existe QUALQUER handoff saindo do Arquiteto — a prova
de que a confirmação já aconteceu, já que `OfferInfraHandoffUseCase` cria
pelo menos o de Infra na mesma chamada). O botão aparece no composer só
quando o primeiro é verdadeiro e o segundo não é — some depois do clique
pelo mesmo motivo que o do Criativo some depois da prontidão.

Ao contrário do Criativo, o Arquiteto NÃO tem guardrail de servidor
bloqueando a confirmação sem `module_map` — `ArquitetoServer.offer_infra_handoff`
não recusa nada, diferente de `CriativoServer.confirm_readiness`
([RN-142](https://github.com/viralabs-dev/brabo-engine/blob/dev/docs/business-rules/engine.md#rn-142)). O botão só desabilita durante `streaming`; não replicar
aqui o `disabled={!hasModuleMap}` da Visão Geral é decisão deliberada, pelo
mesmo raciocínio que já vale para "Ativar execução" no card do Dev Lead
([RN-137](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-137)) — quando este card existe, o Arquiteto já decidiu a
arquitetura.

- **Onde:** `src/interfaces/http/agents/agents.controller.ts`
  (`handoffInfra`, rota preexistente), `apps/web/src/lib/api-client.ts`
  (`confirmArchitectureReadiness`), `apps/web/src/routes/SessionPage.tsx`
  (`arquitetoActive`, `arquiteturaJaDeclarada`, `handleArchitectureReadiness`,
  botão "Confirmar arquitetura pronta")
- **Teste:**
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`, describe
  "problema 1" — botão ausente sem o Arquiteto ativo, caminho feliz chama o
  endpoint dedicado, falha mostra toast de erro, e o botão some com a
  arquitetura já declarada
- **Origem:** investigação de código — o endpoint e a lógica do engine
  existiam desde a Fase 4a/14d sem NENHUM caminho de UI até eles

<a id="rn-146"></a>

### RN-146 — `agent.response` carrega o nome do modelo que gerou a resposta {#rn-146}

O nome do modelo só existia em `token_usage`, sem vínculo com o evento
`agent.response` específico que ele produziu — `SessionPage.tsx` mostrava a
string FIXA `"modelo"` ao lado do nome do agente, nunca o nome real.

A mudança atravessa as três camadas, todas com o MESMO nome de campo
(`modelName`), para que não seja preciso traduzir entre elas:

1. **api** — `StreamLlmTurnUseCase`/`RunLlmTurnUseCase` já resolviam o
   modelo (`resolveModelBinding` → `models.findById`) para chamar o
   provider; o frame `final`/`RunLlmTurnResult` ganham `modelName: string |
   null`. `null` só quando o turno falhou ANTES de resolver um modelo (sem
   binding, ou binding para modelo inexistente) — nos demais casos,
   inclusive orçamento excedido, o binding já tinha resolvido e o nome
   viaja mesmo no frame de erro.
2. **engine** — os quatro agentes conversacionais (`criativo_server.ex`,
   `po_server.ex`, `arquiteto_server.ex`, `dev_lead_server.ex`) extraem
   `Map.get(frame, "modelName")` do frame `final` e o incluem no payload de
   `emit_response`/`agent.response` (`%{content: content, modelName:
   model_name}`).
3. **web** — `SessionPage.tsx` lê `event.payload.modelName`. Evento
   GRAVADO antes desta mudança não tem a chave (`undefined`), e um turno
   cuja api não resolveu modelo nenhum grava `null` — os dois degradam para
   o rótulo genérico `"modelo"`, nunca para `undefined`/`null` na tela; o
   mesmo padrão que `text === ''` já usa para resposta anterior à RN-059.

- **Onde:** `src/application/use-cases/llm/stream-llm-turn.use-case.ts`
  (`LlmTurnStreamEvent`), `src/application/use-cases/llm/run-llm-turn.use-case.ts`
  (`RunLlmTurnResult`), `src/interfaces/http/internal/dto/internal.response.dto.ts`
  (`LlmTurnResponseDto`/`LlmTurnStreamEventResponseDto`),
  `apps/engine/lib/engine/agents/{criativo,po,arquiteto,dev_lead}_server.ex`
  (`emit_response/3`), `apps/web/src/routes/SessionPage.tsx` (bloco
  `agent.response` da timeline)
- **Teste:** `test/application/use-cases/llm/run-llm-turn.use-case.spec.ts`,
  `test/application/use-cases/llm/stream-llm-turn.use-case.spec.ts`
  (`modelName` no caminho feliz, no erro do provider e sem binding),
  `apps/engine/test/engine/agents/{criativo,po,arquiteto,dev_lead}_server_test.exs`
  (`agent.response` carrega o nome do modelo; borda do frame sem a chave),
  `apps/web/src/routes/SessionPage.arquiteto-modelo-icone.test.tsx`, describe
  "problema 2" — nome real, evento antigo sem a chave, `modelName: null`
- **Origem:** investigação de código — confirmado que o dado já existia em
  `token_usage`, mas nunca chegava ao payload do evento

<a id="rn-149"></a>

### RN-149 — O Container level do diagrama C4 é derivado do module_map, nunca redigitado pelo modelo {#rn-149}

`create_c4_diagram` (ferramenta nova do Arquiteto) gera as duas sintaxes
Mermaid do diagrama C4 (Context + Container, modelo de Simon Brown). O tool
call carrega só `system_name`/`system_description`/`actors` — os módulos e
as dependências do nível Container NÃO fazem parte da entrada: o caso de uso
busca o `module_map` VIGENTE do projeto (`ModuleMapRepository.findCurrent`,
mesma leitura de `GetArchitectureUseCase`) e deriva o Container level dele,
com os MESMOS nomes e dependências que `create_module_map` já validou sem
ciclo.

A alternativa óbvia — deixar o modelo descrever os módulos de novo no tool
call do diagrama, como ele já faz para `create_module_map` — foi descartada
de propósito: um segundo lugar onde o modelo escreve "os módulos são X, Y,
Z" é um segundo lugar onde essa lista pode divergir da primeira, e a
divergência seria SILENCIOSA — nada recusaria um diagrama com um módulo que
não existe mais no mapa real. Derivar do repositório fecha essa divergência
por construção: o diagrama pode ficar DESATUALIZADO se o `module_map` mudar
depois (reemitir é gerar de novo, sem trava — ver ADR 0068), mas nunca
MENTE sobre o que existia no momento em que foi gerado.

Sem `module_map` vigente, `create_c4_diagram` é recusado com 400 — não há
Container level sem módulos para desenhar, e a mensagem de erro instrui o
Arquiteto a chamar `create_module_map` primeiro (RN-061: a recusa volta
pelo tool-result, com o motivo inteiro).

O artefato `artifact.c4_diagram` é versionado no event log sem tabela
própria — mesmo desenho de `artifact.project_image` (ADR 0065): o vigente é
o de maior `version`, e revisar é gerar de novo, nunca sobrescrever.

- **Onde:** `src/domain/architecture/c4-diagram.ts`
  (`gerarDiagramaContexto`/`gerarDiagramaContainer`, puras),
  `src/application/use-cases/architecture/create-c4-diagram.use-case.ts`,
  `src/application/use-cases/architecture/get-c4-diagram.use-case.ts`,
  `apps/engine/lib/engine/harness/tools/create_c4_diagram.ex`,
  `apps/web/src/components/C4DiagramView.tsx` (renderização, três estados —
  RN-088), `apps/web/src/lib/mermaid-render.ts` (o `mermaid` fica isolado
  aqui, `import()` dinâmico)
- **Teste:** `test/domain/architecture/c4-diagram.spec.ts` (sintaxe
  Mermaid válida a partir de um `module_map` de exemplo, aresta pendurada
  ignorada, ids deduplicados),
  `test/application/use-cases/architecture/create-c4-diagram.use-case.spec.ts`
  (sem module_map recusa com 400 e não grava nada; Container reflete os
  módulos/dependências reais; versiona ao reemitir),
  `apps/engine/test/engine/harness/tools/create_c4_diagram_test.exs`,
  `apps/web/src/components/C4DiagramView.test.tsx` (sucesso vira SVG, erro
  de sintaxe vira Alert legível sem quebrar a tela, diagrama vazio não tenta
  renderizar)
- **Origem:** pedido do usuário — diagrama C4 do Arquiteto na Visão Geral do
  projeto (ADR 0068)

<a id="rn-151"></a>

### RN-151 — O badge de projeto na sidebar é aprovações pendentes, não atividade não lida {#rn-151}

O número ao lado do nome de cada projeto em `Shell.tsx` vinha de
`useProjectsUnread` — `latestSeq` (o `seq` mais recente já gravado na sessão)
menos o cursor de "última vez visto" que o navegador guarda em
`read-state.ts`. Isso conta QUALQUER evento novo — `tool.call`,
`agent.response`, chat — não só decisão pendente. Um projeto de teste
mostrava "392" na sidebar (atividade acumulada de uma execução real) enquanto
a aba Aprovações do MESMO projeto mostrava "8" (a contagem de verdade). Um
número que não corresponde a nada acionável ao clicar é pior que nenhum.

O read model do dashboard (`ProjectsSummaryRepository.summarizeForWorkspace`,
RN-090) ganhou `pendingApprovalsCount`: `COUNT(*)` de `proposed_actions` com
`status = 'pending'`, agregado por `project_id` numa consulta a mais no
`Promise.all` já existente — mesmo formato de `storiesAwaitingPromotion`
(RN-048), sem crescer o número de idas ao banco por projeto. A soma é do
projeto INTEIRO, todas as sessões — de propósito diferente da aba Aprovações
(`ProjectApprovalsTab.tsx`), que mostra só as pendências da sessão MAIS
RECENTE: o badge é por PROJETO, não por sessão, e uma pendência numa sessão
antiga continua sendo uma pendência.

`Shell.tsx` parou de importar `useProjectsUnread` — o único consumidor dele
ali era este badge. `Dashboard.tsx`/`ProjectCard.tsx` ganharam o mesmo fio:
o prop `unreadCount` de `ProjectCard` nunca tinha chamador (`ProjectCardContainer`
não o passava), e virou `pendingApprovalsCount` com o mesmo valor da sidebar
— duas telas, um número, uma fonte.

- **Onde:** `src/application/ports/projects-summary-repository.port.ts`
  (`ProjectCardSummary.pendingApprovalsCount`),
  `src/infrastructure/persistence/drizzle/projects-summary.repository.ts`
  (`summarizeForWorkspace`, consulta agregada sobre `proposed_actions`),
  `apps/web/src/routes/Shell.tsx`, `apps/web/src/routes/Dashboard.tsx`,
  `apps/web/src/components/ProjectCard.tsx`
- **Teste:**
  `test/infrastructure/persistence/drizzle/projects-summary.repository.spec.ts`
  (`pendingApprovalsCount soma o projeto INTEIRO...`, só `pending` conta, não
  vaza entre projetos, número de consultas continua constante),
  `apps/web/src/routes/Shell.test.tsx` (badge de aprovações pendentes)
- **Origem:** achado do usuário navegando a app — badge da sidebar mostrando
  "392" contra "8" de verdade na aba Aprovações do mesmo projeto

---

<a id="rn-153"></a>

### RN-153 — "Auto mode": o `ApprovalCard` liga autonomia pra QUALQUER ação futura de um agente {#rn-153}

> **Revista pela [RN-603](parte-07.md#rn-603)** (ADR 0167): `decide()` passou a receber
> também a ORIGEM da autonomia, e o modo automático (a curinga em
> `auto_approve`) não passa mais pelo teto de escopo de caminho. O que segue
> abaixo sobre `decide()` "não mudar" descreve o desenho original.

Antes deste RN, `agent_autonomy` só sabia conceder autonomia por
`(projeto, agente, TIPO de ação)` — uma linha por tipo, upsert de UMA regra
por vez (`SetAgentAutonomyUseCase`,
`src/application/use-cases/actions/set-agent-autonomy.use-case.ts`).
Confiar amplamente num agente exigia uma linha por tipo — `terminal`,
`write_file`, `pr_open`… — e tipo novo nascia sem regra, de volta a
`require_approval`.

"Auto mode" é o valor especial `actionType: "*"` na MESMA tabela e no MESMO
endpoint (`PUT /projects/:projectId/agent-autonomy`) — não é mecanismo novo,
é a coluna existente (`agent_autonomy.action_type`, `text` livre, sem enum
nem FK — `src/db/schema/agents.ts`) aceitando um valor a mais. A curinga
significa "autonomia pra qualquer tipo de ação DESTE agente" e é resolvida
em `DrizzleAgentAutonomyRepository.findMode`
(`src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts`):
busca a regra ESPECÍFICA e a curinga na mesma consulta, e a específica
sempre vence — gravar `terminal: deny` com `"*": auto_approve` já ligado
continua negando `terminal` desse agente, e liberando o resto. `decide()`
(`src/domain/actions/decide.ts`) não muda: ele recebe o
`PermissionPolicy` já resolvido em `ctx.autonomyMode`, exatamente como antes
da curinga existir — é por isso que os tetos absolutos valem sem precisar
saber que "auto mode" existe (ver [RN-154](#rn-154)).

O `ApprovalCard` (`apps/web/src/components/ApprovalCard.tsx`) ganha o botão
"Modo automático" ao lado de "Sempre permitir", visível só quando: (a) a
ação está `pending`, (b) quem propôs é um AGENTE (`actor.kind === 'agent'` —
não há autonomia de agente para conceder a um usuário) e (c) quem chama
(`ProjectApprovalsTab.tsx`/`SessionPage.tsx`) já confirmou papel
`maintainer`/`owner` no workspace — mesma exigência do endpoint
(`@RequireRole('maintainer')`, inalterado). O prop `onActivateAutoMode` é
`undefined` para quem não tem o papel — o card ESCONDE o botão em vez de
mostrá-lo desabilitado, e a checagem mora em quem chama, não no card
(componente presentational, sem query própria).

**Desligar** reusa o toggle manual/auto que o card do agente já tinha (Fase
8d) — nenhuma tela nova. `AgentTeamGrid.tsx` passa a procurar a regra
curinga do agente ANTES da representativa (`autonomyActionTypeFor`): se
existir, o toggle do card reflete e edita a CURINGA, não mais o tipo
representativo — desligar é gravar a mesma curinga como
`require_approval`, e o toggle no card do agente é exatamente esse
"desligar".

- **Onde:** `src/domain/actions/decide.ts`
  (`AGENT_AUTONOMY_ALL_ACTIONS`, `AgentAutonomyActionType`),
  `src/infrastructure/persistence/drizzle/agent-autonomy.repository.ts`
  (`findMode` com precedência específica > curinga),
  `src/interfaces/http/actions/dto/set-agent-autonomy.dto.ts`
  (aceita `"*"`), `apps/web/src/components/ApprovalCard.tsx` (botão "Modo
  automático"), `apps/web/src/components/AgentTeamGrid.tsx` (toggle
  passa a priorizar a curinga), `apps/web/src/routes/ProjectApprovalsTab.tsx`
  e `apps/web/src/routes/SessionPage.tsx` (`handleActivateAutoMode`, gate de
  papel via `useCurrentWorkspaceWithRole`)
- **Teste:**
  `test/infrastructure/persistence/drizzle/agent-autonomy.repository.spec.ts`
  (precedência específica > curinga; curinga é por agente; desligar é
  regravar a curinga como `require_approval`),
  `test/application/use-cases/actions/propose-action.use-case.spec.ts`
  (auto mode auto-aprova ação comum SEM bater em `permissions.json`; regra
  específica em `deny` vence a curinga),
  `test/interfaces/http/actions/agent-autonomy.controller.spec.ts`
  (`PUT`/`GET` continuam exigindo `maintainer`; DTO aceita `"*"` e recusa
  string fora da lista), `apps/web/src/components/ApprovalCard.test.tsx`
  (botão some sem `onActivateAutoMode`; clique chama o callback; nota
  explica os tetos que continuam pedindo decisão)
- **Origem:** pedido do usuário — "Sempre permitir" só grava um padrão de
  comando específico, e `agent_autonomy` só cobria um tipo de ação por vez;
  faltava confiar amplamente num agente com um clique só

<a id="rn-154"></a>

### RN-154 — Os três tetos absolutos continuam bloqueando MESMO com "auto mode" ligado {#rn-154}

> **Revista pela [RN-603](parte-07.md#rn-603)** (ADR 0167): os tetos listados aqui
> seguem valendo em modo automático; o que deixou de valer para ele foi o
> teto de ESCOPO DE CAMINHO (ADR 0055), que nunca esteve nesta lista.

O desenho do "auto mode" ([RN-153](#rn-153)) é deliberadamente incapaz de
furar os três tetos que já existiam em `decide()` — eles são aplicados por
ÚLTIMO, sobre `current.policy`, sem olhar de onde veio a permissividade
(`agent_autonomy` com tipo específico, curinga, ou `permissions.json` — a
função nunca soube distinguir as origens, e continua sem saber):

1. **Merge em branch protegida** (`git_merge` com destino em
   `dev`/`qa`/`rc`/`main`, [RN-006](parte-01.md#rn-006)) — a trava de merge
   (`isProtectedBranch`) rebaixa `auto_approve` para `require_approval`
   sempre, mesmo com `"*": auto_approve` ligado pro agente.
2. **`instruction_patch`** ([RN-007](parte-01.md#rn-007)) — mudar a instrução de outro
   agente exige o humano ver o diff; auto mode não muda isso.
3. **`parallelize`/`raise_max_parallel`** ([RN-086](parte-02.md#rn-086)) — subir o
   teto de paralelismo, ou pedir mais agente acima dele, continua decisão
   do usuário; um agente com auto mode ligado não consegue se auto-conceder
   mais poder de gasto.

A prova é por CONSTRUÇÃO, não por caso a caso: como os três tetos verificam
só `current.policy === 'auto_approve'` — nunca a origem —, e "auto mode" só
consegue chegar em `current.policy === 'auto_approve'` pelo MESMO caminho
que uma regra específica de `agent_autonomy` já usava
(`ctx.autonomyMode`), os tetos que já continham `agent_autonomy` continuam
contendo a curinga sem precisar de código novo. O risco real não era o
teto — era alguém, ao generalizar `agent_autonomy` pra aceitar `"*"`,
inserir a checagem da curinga ANTES dos tetos e reabrir a porta; por isso
`AGENT_AUTONOMY_ALL_ACTIONS` foi resolvido inteiramente no REPOSITÓRIO
(antes de `decide()` rodar), e `decide()` em si não ganhou nenhuma linha
nova — só o suficiente pra não ter onde a curinga furar.

- **Onde:** `src/domain/actions/decide.ts` (os três blocos de teto,
  linhas ~207–258, inalterados por esta feature)
- **Teste:**
  `test/application/use-cases/actions/propose-action.use-case.spec.ts`
  ("auto mode NÃO auto-aprova merge em branch protegida", "... instruction_patch",
  "... parallelize/raise_max_parallel" — os três com `agent_autonomy` "*"
  gravado como `auto_approve` e o veredito continuando `require_approval`)
- **Origem:** restrição de design confirmada pelo usuário ao pedir o "auto
  mode" — os três tetos são a garantia que não pode regredir

<a id="rn-155"></a>

### RN-155 — ordenação da timeline usa o vínculo `proposed_action.created`, nunca `action.seq` cru {#rn-155}

A `timeline` de `SessionPage.tsx` ordena eventos e ações propostas por um
único eixo numérico comparável. Para eventos, é `event.seq` (gapless, por
sessão). Para ações, é o `seq` do evento `proposed_action.created` correlato
(achado por `payload.actionId === action.id`, gravado por
`ProposeActionUseCase` na MESMA transação que cria a ação) — nunca
`action.seq`, que é `bigserial` único e global de toda a tabela
`proposed_actions`, compartilhado por todas as sessões e projetos do
sistema, e portanto incomparável com `event.seq` (contraste deliberado, ver
`src/db/schema/actions.ts`). Comparar os dois direto produzia ordem
imprevisível toda vez que um `ApprovalCard` entrava na mistura com eventos
normais. Ações sem esse vínculo (só o bootstrap de Gitflow —
`git_repo_create`/`git_branch_create`, que gravam apenas outbox) degradam
para uma posição interpolada por `createdAt`, ancorada no último evento
anterior.

- **Onde:** `apps/web/src/routes/SessionPage.tsx` (`ordemDaAcaoNaTimeline`)
- **Teste:** `apps/web/src/routes/SessionPage.ordenacao-e-avisos.test.tsx`
- **Origem:** achado de PR #286 — cards de aprovação apareciam fora de ordem
  na timeline, misturados com eventos normais

<a id="rn-169"></a>

### RN-169 — O projeto escolhe onde o código mora: Local ou Container {#rn-169}

**REVISADA pela [RN-421](parte-04.md#rn-421) (ADR 0104)**: `workspace_mode`/`local`
viraram `execution_mode` de TRÊS valores (`container`/`mounted`/`runner`,
migração `0048`) — o resto desta entrada é histórico, fiel ao que valia até
a revisão.

Um projeto nasce com um **modo de workspace** (`projects.workspace_mode`,
migração `0043`), e é ele que decide de onde a raiz de escopo é derivada:

- **`container`** (DEFAULT, e o comportamento que sempre existiu): a pasta
  GERENCIADA pelo produto, `join(PROJECT_WORKSPACES_ROOT, workspace_dir_name)`
  ([RN-109](#rn-109));
- **`local`**: uma pasta DO USUÁRIO, no caminho absoluto de
  `projects.workspace_path`.

O par é amarrado por CHECK no banco
(`(workspace_mode = 'local') = (workspace_path IS NOT NULL)`), e não só pelo
caso de uso: a coluna é lida por DOIS processos (api e engine) e escrita por
scripts de seed/backfill que não passam por ele. `local` sem caminho seria
escopo de terminal apontando para lugar nenhum; `container` com caminho seria
uma segunda fonte de verdade esperando divergir da primeira.

A derivação continua **única** — `projectScopeRoot` passou a receber a
localização (`{workspaceDirName, workspaceMode, workspacePath}`) e escolhe o
ramo; nenhum dos quatro consumidores ([RN-092](parte-02.md#rn-092)) ganhou validação
própria. O engine resolve o mesmo localizador na CONSULTA (nome de pasta no
`container`, caminho absoluto no `local`) e distingue os dois pela barra
inicial, que é inequívoca porque o nome de pasta é validado contra
`^[A-Za-z0-9_-]{1,64}$`.

Duas consequências explícitas do modo `local`:

1. **O portão da imagem do Arquiteto ([RN-105](#rn-105)) NÃO vale.**
   **REVOGADO pela [RN-494](https://github.com/viralabs-dev/brabo-broker/blob/dev/docs/business-rules/broker.md#rn-494) (ADR 0135)**: a
   dispensa terminou — os três modos passam a exigir a decisão de imagem
   antes de abrir a aba Code. O resto deste item é histórico. Projeto
   Local não sobe container, então a aba Code liberava sem esperar decisão
   que nunca ia acontecer. A dispensa morava no mesmo funil do portão na
   api, e a tela concordava: `ProjectCodeTab` nem chegava a perguntar o
   estado do container ([RN-107](https://github.com/viralabs-dev/brabo-web/blob/dev/docs/business-rules/web.md#rn-107)) quando o projeto era Local — se
   só a api dispensasse, a aba continuaria bloqueada na tela por uma
   decisão inexistente.
2. **O `permissions.json` mora na pasta do usuário**, junto com o código —
   porque a política tem que ser lida da MESMA raiz que o escopo de terminal
   autoriza.

`workspace_mode` não confunde com o `GitProviderName` `'local'`: um diz onde o
CÓDIGO mora em disco, o outro onde o REPOSITÓRIO git vive, e as duas escolhas
são ortogonais.

- **Onde:** `src/db/schema/iam.ts` (`projects`),
  `src/infrastructure/filesystem/project-workspaces-root.ts`
  (`projectScopeRoot`), `src/domain/iam/project.entity.ts`,
  `src/application/use-cases/git/read-project-code.use-case.ts`
  (`portaoDoContainer`), `apps/web/src/routes/ProjectCodeTab.tsx`,
  `apps/engine/lib/engine/projects/project.ex`,
  `apps/engine/lib/engine/actions/workspace.ex` (`workspace_dir/2`),
  `apps/engine/lib/engine/dev/worktree_cleanup.ex` (que era a segunda
  derivação escrita à mão, e passou a usar a única),
  `apps/web/src/routes/NewProjectWizard.tsx`
- **Teste:** `test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (describe "projectScopeRoot no modo local"),
  `test/infrastructure/filesystem/fs-permissions-file-store.spec.ts`
  (o permissions.json na pasta do usuário),
  `test/application/use-cases/iam/create-project-modo-de-workspace.spec.ts`,
  `test/application/use-cases/git/read-project-code.use-case.spec.ts`
  (projeto Local não passa pelo portão),
  `test/interfaces/http/iam/project-dto-modo-de-workspace.spec.ts`
  (o modo é congelado: PATCH não o muda),
  `apps/web/src/routes/ProjectCodeTab.test.tsx` (a tela também dispensa o gate),
  `apps/engine/test/engine/actions/workspace_test.exs`
  (describe "workspace_dir/2 com o localizador já resolvido"),
  `apps/web/src/routes/NewProjectWizard.test.tsx`
- **Decisão arquitetural:** [ADR 0072](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0072-projeto-local-ou-container.md)
- **Origem:** pedido do usuário (decisão dele, com a variante de caminho livre
  escolhida explicitamente)

<a id="rn-170"></a>

### RN-170 — Caminho Local é validado na CRIAÇÃO, e a recusa ensina {#rn-170}

**REVISADA pela [RN-422](parte-04.md#rn-422) (ADR 0104)**: a validação de criação passou
a DIVERGIR por modo — `mounted` (o `local` renomeado) continua tocando disco
como descrito aqui, `runner` valida só o LÉXICO, sem I/O — o resto desta
entrada é histórico, fiel ao que valia até a revisão.

Criar um projeto no modo `local` com um caminho que a api não alcança produz um
projeto que **trava depois** — na primeira ferramenta do primeiro agente, longe
da tela onde a decisão foi tomada. Por isso a criação **recusa com 400**, e a
mensagem diz o que falta fazer.

O caminho precisa ser:

1. **absoluto**, sem `..` nem `.` em nenhum segmento (o caminho gravado é o
   caminho que se lê; `/srv/app/../../etc` é `/etc` e não parece);
2. **existente e uma pasta** dentro do container da api;
3. **gravável pelo processo** (`access(W_OK|X_OK)`) — as imagens rodam non-root
   ([ADR 0024](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0024-fase5-imagens-producao-ci.md)), e pasta do host com
   outro dono chega montada como somente leitura na prática;
4. **fora da raiz e das pastas de sistema** (`/`, `/etc`, `/usr`, `/var`,
   `/data`… e tudo abaixo delas): a raiz do projeto é o escopo que AUTORIZA o
   terminal do agente ([ADR 0055](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0055-escopo-de-caminho-na-politica-de-terminal.md)),
   e um projeto com raiz em `/etc` transforma "o agente escreve no projeto dele"
   em "o agente reescreve o container";
5. **sem sobreposição com o checkout do Brabo, nos DOIS sentidos** — a pasta que
   CONTÉM o monorepo e a pasta DENTRO dele. O segundo caso é o problema que o
   ADR 0055 relata acontecendo de verdade.

O caminho gravado é o **normalizado**, não a string crua: validar uma string e
gravar outra é como a validação deixa de valer no dia seguinte. `workspacePath`
enviado junto com `workspace_mode: container` é RECUSADO, não ignorado — campo
descartado em silêncio vira "mas eu configurei".

A parte LÉXICA (itens 1, 4 e 5) roda **também na leitura**, a cada derivação de
`projectScopeRoot`: o único jeito de burlar a criação é escrever direto no
banco, e o que se ganha ali é escopo de terminal em `/`. A parte de DISCO
(itens 2 e 3) roda só na criação, onde o usuário ainda pode corrigir.

A recusa por pasta ausente traz a instrução de montagem — o arquivo, os dois
serviços e a linha (`- <caminho>:<caminho>`), com o ponteiro para
[o runbook](https://github.com/viralabs-dev/brabo-infra/blob/dev/deploy/docs/runbook.md). Montar só na api produz um projeto que a api aceita e o
engine não enxerga: ela valida o que ela vê, e não tem como saber o que está
montado no outro container.

- **Onde:** `src/infrastructure/filesystem/project-workspaces-root.ts`
  (`validarCaminhoDeWorkspaceLocal`, `CaminhoLocalInvalidoError`),
  `src/application/use-cases/iam/create-project.use-case.ts`
  (`caminhoValidado`), `src/interfaces/http/iam/dto/create-project.dto.ts`,
  `apps/web/src/lib/wizard.ts` (`caminhoLocalParecePlausivel`)
- **Teste:** `test/infrastructure/filesystem/project-workspaces-root.spec.ts`
  (describe "validarCaminhoDeWorkspaceLocal"),
  `test/application/use-cases/iam/create-project-modo-de-workspace.spec.ts`
  (describe "a criação RECUSA o caminho que travaria depois"),
  `apps/web/src/lib/wizard.test.ts`, `apps/web/src/routes/NewProjectWizard.test.tsx`
- **Decisão arquitetural:** [ADR 0072](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0072-projeto-local-ou-container.md)
- **Origem:** guarda exigida pela variante de caminho livre (ADR 0072)

---

<a id="rn-186"></a>

### RN-186 — `provider` é dimensão do relatório do owner, e só dele {#rn-186}

`sumGroupedBy` aceita `provider` como dimensão, e
`GET /workspaces/:id/spend-report` devolve a lista `porProvider` ao lado de
modelo, projeto, ator e dia. O [ADR 0063](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0063-duas-audiencias-para-o-mesmo-gasto.md)
tinha deixado o eixo de fora; o [ADR 0076](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)
o devolveu **sem revogar o argumento**: quebrar gasto por provider continua
sendo quebrar por CREDENCIAL, e por isso o eixo mora numa rota que já exige
`owner` ([RN-060](parte-02.md#rn-060)) — a mesma régua de `credential-spend`, que segue
respondendo a pergunta da FATURA (por mês, com o vínculo à chave que existe
hoje).

`GET /projects/:id/spend/me` **não ganhou nada**. A assimetria é o desenho: as
duas respostas continuam não sendo recorte uma da outra ([RN-101](#rn-101)).

A dimensão `model` **não mudou**: dois providers servindo o mesmo nome de modelo
continuam numa linha só. Quem quer a quebra por credencial tem a lista própria,
e cruzar as duas dimensões multiplicaria as linhas do ranking sem responder
pergunta que as duas listas separadas já não respondam.

- **Onde:** `src/application/ports/token-usage-repository.port.ts:150`
  (`SpendDimension`),
  `src/infrastructure/persistence/drizzle/token-usage.repository.ts:255`
  (o `GROUP BY`), `src/application/use-cases/llm/get-workspace-spend-report.use-case.ts:112`,
  `src/interfaces/http/llm/spend.controller.ts:56`
- **Teste:** `test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  ("quebra por PROVIDER, e o mesmo nome de modelo em dois providers segue UMA
  linha")
- **Origem:** [ADR 0076](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

<a id="rn-187"></a>

### RN-187 — A visão do membro não alcança `provider`, e quem garante é o TIPO {#rn-187}

Enquanto o eixo não existia, o que continha a visão do membro era a **ausência**
de argumento a passar. Com o eixo de volta, a contenção passou a ser da
assinatura: `sumGroupedBy` tem **duas sobrecargas**, e a que aceita um escopo com
`actor` — o da audiência do membro, e o único que ele tem — só recebe
`SpendDimensionDoAtor`, que é `Exclude<SpendDimension, 'provider'>`.
`sumGroupedBy('provider', escopoComAtor)` **não compila**.

Nem o repositório nem o caso de uso têm `if` sobre essa combinação, de
propósito: uma checagem em tempo de execução daria a impressão de que a garantia
é dinâmica, quando quem a sustenta é o compilador — e um `if` é o tipo de coisa
que a próxima refatoração remove sem que nenhum teste fique vermelho.

A barreira é dupla e as duas metades são independentes: a rota do membro
**também não tem parâmetro de dimensão** (só `projectId` e `dias`), então uma
query inventada como `?dimensao=provider` é descartada pelo Nest antes de
chegar ao handler.

`Exclude` em vez de uma segunda lista escrita à mão é deliberado: dimensão nova
nasce alcançável pelas duas audiências, e tirá-la do alcance do membro vira ato
explícito **neste ponto** — nunca um esquecimento em outro arquivo.

- **Onde:** `src/application/ports/token-usage-repository.port.ts:121`
  (as duas sobrecargas), `:147` (`SpendDimensionDoAtor`), `:163`/`:173` (os dois
  escopos), `src/application/use-cases/llm/get-my-spend.use-case.ts:73`,
  `src/interfaces/http/llm/spend.controller.ts:98`
- **Teste:** `test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  ("não compila pedir `provider` com escopo de ator" — um `@ts-expect-error` que
  o `tsc` reprova como diretiva NÃO USADA se a barreira cair; e "só pede as
  dimensões `session` e `day`"),
  `test/interfaces/spend.controller.spec.ts` (a rota do membro aceita
  `dias` e mais nada)
- **Origem:** [ADR 0076](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

<a id="rn-188"></a>

### RN-188 — Pessoa e agente são partição da lista por ator, sem consulta a mais {#rn-188}

O relatório do owner traz `porOwner` (linhas de `actor_kind = 'user'`) e
`porAgente` (`actor_kind = 'agent'`) além de `porAtor`, que continua inteira.
Os dois blocos são **derivados** de `porAtor` no caso de uso — `actorKind` já
vem na linha desde a FASE 22 —, e não duas consultas com `where actor_kind`.
O motivo é medido: o [ADR 0063](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0063-duas-audiencias-para-o-mesmo-gasto.md)
mostrou que o custo destas consultas cresce com o tamanho de `token_usage` e
não com o do pedido, então varrer a janela duas vezes a mais para separar o que
já está separado em memória seria caro pelo motivo errado.

`actor_kind` que não seja pessoa nem agente (hoje, `system`) **não entra em
nenhum dos dois blocos** e continua visível em `porAtor` e no total. Abrir um
terceiro bloco para ele diria que o produto tem uma audiência que ele não tem.

O rótulo "Por owner" é do handoff de design e vale pela [RN-058](parte-02.md#rn-058) — é a
chave do owner que todas essas linhas gastam. Quem é o dono do workspace
continua sendo o campo `ownerId`, não o `actorKind` de cada linha.

- **Onde:** `src/application/use-cases/llm/get-workspace-spend-report.use-case.ts:120`
- **Teste:** `test/application/use-cases/llm/spend-audiencias.use-case.spec.ts`
  ("separa PESSOA de AGENTE em dois blocos, sem perder a lista por ator")
- **Origem:** [ADR 0076](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0076-provider-volta-a-ser-dimensao-de-gasto.md)

<a id="rn-189"></a>

### RN-189 — O embedding devolve um vetor por entrada, ou um erro {#rn-189}

`embed` é uma operação em LOTE: recebe N textos e devolve N vetores, **na
mesma ordem**. A ordem é o único vínculo entre entrada e vetor, e é por isso
que uma resposta mais curta não serve — o i-ésimo vetor acabaria pertencendo
a outra frase, e o índice erraria em silêncio, com o sintoma aparecendo na
BUSCA, semanas depois e longe da causa.

Assim, o contrato recusa, em vez de degradar, três coisas: um lote
incompleto, um vetor vazio e dimensões diferentes na mesma resposta. Uma
lista de entradas vazia também é recusada antes de sair pela rede —
responder `[]` a ela faria o chamador gravar um índice vazio achando que
indexou algo.

O resultado traz quatro campos, e cada um responde a uma pergunta que já
custou caro em outro lugar do produto: `dimensions` é conferido contra o que
VOLTOU (nunca copiado do catálogo); `model` é o que o provider **disse** ter
usado, porque um alias resolve para uma versão datada e é esse nome que vai
para o metering, pela mesma razão do preço congelado ([RN-044](parte-01.md#rn-044)); e
`inputTokens` vem com `estimated`, preservando a distinção "o provider disse
zero" × "o provider não disse nada" da [RN-041](parte-01.md#rn-041).

O erro é **lançado**, normalizado por `code`, em vez de virar um chunk como
no `chat`. A razão do chunk é preservar o gasto de um turno em andamento;
aqui não há nada a preservar — ou o provider devolveu os vetores e cobrou,
ou não devolveu e não cobrou. É a mesma escolha do `listModels`, e a
taxonomia é a mesma: nenhum `LLMErrorCode` novo.

- **Onde:** `src/application/ports/llm-provider.port.ts:61`,
  `src/infrastructure/llm/embedding-result.ts:26`
- **Teste:** `test/contract/llm-provider.contract.ts` (cinco casos, rodados
  contra todo provider que declara a capability)
- **Origem:** [ADR 0075](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0075-embeddings-no-contrato-de-llm-provider.md)

<a id="rn-190"></a>

### RN-190 — O embedding tem uma capability em duas camadas, e a do modelo é exclusão {#rn-190}

Como no tool calling ([RN-040](parte-01.md#rn-040)), a capability tem duas camadas: o
PROVIDER (`capabilities.embeddings`, o teto) e o MODELO (`supportsEmbeddings`
na linha do catálogo). A diferença entre os dois casos é exatamente o que a
regra existe para afirmar:

- **tool calling é um gradiente** — um modelo que não pede ferramentas ainda
  conversa, e por isso só o binding de agente é recusado;
- **embedding é exclusão** — o `nomic-embed-text` não responde a uma pergunta
  e o `llama3.2` não devolve um vetor. São conjuntos disjuntos, e o daemon do
  Ollama prova isso respondendo **`501`** ("This server does not support
  embeddings") a um pedido de embedding com um modelo de chat.

`assertCanEmbed` confere os dois na ordem que falha melhor: primeiro o
provider, porque trocar de modelo não conserta um provider que não faz
embedding. Um modelo **sem declaração** também é recusado, com mensagem
diferente — ausência significa "o provider não disse"
([ADR 0041](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)),
nunca permissão, e a ação certa para quem lê é sincronizar o catálogo em vez
de trocar de modelo. Deduzir a capability pelo NOME do modelo é proibido:
seria um palpite vestido de dado.

- **Onde:** `src/domain/llm/embedding-capability.ts:64`,
  `src/infrastructure/llm/ollama-provider.ts:319`
- **Teste:** `test/domain/llm/embedding-capability.spec.ts`,
  `test/infrastructure/llm/ollama-provider.spec.ts`
- **Origem:** [ADR 0075](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0075-embeddings-no-contrato-de-llm-provider.md)

<a id="rn-191"></a>

### RN-191 — `embeddings: true` exige execução, não documentação {#rn-191}

A regra da casa ([ADR 0041](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0041-base-openai-compativel-e-contrato-de-llm-providers.md)/[ADR 0043](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0043-seis-providers-de-llm-e-o-fechamento-da-fase-9b.md))
aplicada à nova capability: **só o `ollama` declara `true`**, e a prova é o
`POST /api/embed` rodado contra o daemon real 0.32.1 com `nomic-embed-text` —
duas entradas, dois vetores de 768 dimensões, `prompt_eval_count: 10`.

Os outros oito declaram `false`, por dois motivos distintos:

- **falta de prova** (sete): não há chave para eles no ambiente, e o único
  smoke test pago que já rodou ([aceite](../../explanation/aceite-providers.md))
  foi de CHAT — num hub, o embedding roteia para providers diferentes dos do
  chat, e a prova de um endpoint não é prova do outro;
- **operação ausente** (Anthropic): não há endpoint dedicado de embedding, e
  a documentação dele aponta para um terceiro, que é outro provider, com
  outra chave e outro dialeto.

O DIALETO da base OpenAI-compatível é provado à parte, com a suíte de
contrato rodando uma segunda vez sobre ela com a capability ligada. É isso
que torna barato virar um provider para `true` no dia em que a chave dele
existir: muda uma linha do literal, e o parsing já está exercitado. Um
provider que declara `false` e ainda expõe o método **recusa a chamada**
antes de tocar a rede.

- **Onde:** `src/infrastructure/llm/ollama-provider.ts:73`,
  `src/infrastructure/llm/openai-compatible-provider.ts:325`
- **Teste:** `test/contract/llm-provider.contract.ts`,
  `test/infrastructure/llm/openai-compatible-provider.contract.spec.ts`,
  `test/infrastructure/llm/ollama-provider.embeddings.smoke.spec.ts`
  (manual, contra o daemon real)
- **Origem:** [ADR 0075](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0075-embeddings-no-contrato-de-llm-provider.md)

<a id="rn-198"></a>

### RN-198 — Atividades agrupa por agente-base/instância REAL, nunca por contador inventado {#rn-198}

A seção Atividades da sidebar é a mesma lógica de agrupamento de
`AgentTimelineTree.tsx`/`timeline-tree.ts` (já usada na Visão geral do
projeto), movida para um lugar novo — não reescrita. `montarArvore` já
agrupa por `evento.actor.id`; a novidade é `agruparPorInstancia`
(`apps/web/src/lib/timeline-tree.ts`), que decide quais ramos formam um
grupo visual de dois níveis.

A "instância" não é um contador renumerado (`-01`/`-02`) — é o `agent_id`
REAL que o produto já escreve: `devAgentId`/`extraDevAgentId`
(`src/application/use-cases/execution/activate-execution.use-case.ts:27-38`)
produzem `dev-<modulo>` e `dev-<modulo>-2` (sufixo sempre exatamente `-2`,
porque o teto é DOIS por módulo, [RN-154](#rn-154)). Um ramo só vira
"instância extra" de outro se o agente-base (sem o sufixo) TAMBÉM tiver um
ramo na mesma lista — senão ele é o próprio agente. Agente com uma instância
abre direto nos eventos; com duas, revela um segundo nível, uma linha por
instância, cada uma com sua própria contagem — reaproveitando
`getAgentLastSeenSeq`/`setAgentLastSeenSeq` (`read-state.ts`) que já existia
para o contador de novidade da árvore.

Escopo: só o projeto da ROTA ATUAL (`pathname`), não todos os projetos do
workspace — agregar todos exigiria uma consulta de eventos POR projeto, a
mesma classe de N+1 que a RN-090/091 fechou no dashboard. Reusa o MESMO par
de hooks que `AgentTimelineTree`/`SessionPage` já usam
(`useActiveExecutionSession` + `useSessionEvents`, mesma `queryKey`) — zero
requisição nova quando as duas telas estão montadas juntas.

O que abre/fecha é persistido em `brabo.sidebar.agents`, com o formato do
handoff adaptado aos ids reais: `agenteBase` (grupo aberto, ex.:
`dev-backend`) ou `${agenteBase}/${instancia}` (uma instância específica
aberta, ex.: `dev-backend/dev-backend-2`).

- **Onde:** `apps/web/src/lib/timeline-tree.ts` (`agruparPorInstancia`,
  `GrupoDeAgente`), `apps/web/src/routes/Shell.tsx:237-311`
  (`GrupoDeAtividade`, `InstanciaDeAgente`), `apps/web/src/routes/Shell.tsx:376-399`
  (escopo e persistência)
- **Teste:** `apps/web/src/lib/timeline-tree.test.ts` (describe
  "agruparPorInstancia"), `apps/web/src/lib/sidebar-state.test.ts`
- **Origem:** PROGRAMA 28, Onda 1/frente B0 (achado, sem código) e Onda
  2/frente B (implementação)

<a id="rn-213"></a>

### RN-213 — Alerta de custo é leitura de `lastThresholdNotified`, nunca recálculo {#rn-213}

`alertaDeOrcamento` não reimplementa `crossedThresholds`
(`src/domain/llm/budget-threshold.ts`): lê o campo que o backend
já grava no momento em que uma chamada real cruza 70/90/100%, e só decide
a cor (`warning` abaixo de 90, `danger` a partir de 90) e se o texto deve
avisar bloqueio ativo (`policy === 'block' && spentMicros >=
limitMicros`). Nenhuma regra de negócio nova — puramente apresentação de
um dado que já existe.

- **Onde:** `apps/web/src/lib/spend.ts` (`alertaDeOrcamento`)
- **Teste:** `apps/web/src/lib/spend.test.ts` (describe "alertaDeOrcamento
  (RN-213)"); `apps/web/src/routes/ProjectSpendTab.test.tsx` (describe "o
  orçamento do projeto")

<a id="rn-219"></a>

### RN-219 — Os três escopos do índice de chunks são honestos, e mutuamente exclusivos por CHECK {#rn-219}

O índice do Chat RAG cobre só três fontes de texto que o produto já sabe de
onde vieram: `docs`, `adr` e `session`. Código-fonte e Pull Requests ficam
de fora de propósito — indexá-los sem um watcher de reindexação a cada
`push` faria o índice mentir sobre cobertura, a mesma classe de erro que o
ADR 0042 já recusa para capability de modelo. `session_id`/`source_path`
são mutuamente exclusivos por CHECK, não por convenção de aplicação, mesmo
padrão de `projects.workspace_mode`/`workspace_path` (ADR 0072): `scope =
'session'` exige `session_id` e recusa `source_path`; `docs`/`adr` exigem
`source_path` e recusam `session_id`. A trava fica no banco porque quem vai
escrever esta tabela é um pipeline (Onda 4) que não necessariamente passa
pelo mesmo caso de uso toda vez.

- **Onde:** `src/db/schema/rag.ts` (`chunkScopeEnum` e os dois CHECK
  da tabela `chunks`)
- **Teste:** `test/infrastructure/persistence/chunk.repository.spec.ts`
  ("recusa chunk de docs sem source_path — o CHECK da migração 0045, não
  validação de aplicação")
- **ADR:** [0079](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

<a id="rn-220"></a>

### RN-220 — Vetor e busca léxica vivem na mesma linha, nunca em tabelas separadas {#rn-220}

`chunks.embedding` (pgvector) e `chunks.search_vector` (tsvector) são
colunas irmãs da MESMA tabela, não duas tabelas ligadas por `chunk_id`.
Separar exigiria um JOIN em toda busca híbrida (Onda 4) e abriria espaço
para as duas divergirem — um trecho com vetor mas sem entrada léxica, ou
vice-versa — sem nenhum mecanismo do banco impedindo. Uma linha, uma fonte
de verdade para as duas metades da busca.

- **Onde:** `src/db/schema/rag.ts` (tabela `chunks`)
- **Teste:** `test/infrastructure/persistence/chunk.repository.spec.ts`
  (as três specs escrevem e leem as duas colunas na mesma linha)
- **ADR:** [0079](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

<a id="rn-221"></a>

### RN-221 — `search_vector` nunca é escrita pela aplicação — é coluna GENERATED {#rn-221}

`search_vector` é `GENERATED ALWAYS AS (to_tsvector('portuguese', content))
STORED`. Nenhum caso de uso, repositório ou script escreve nela — o
Postgres a mantém coerente com `content` por construção, pronta na mesma
transação do `INSERT`, sem depender de nenhum provider de LLM responder
(diferente de `embedding`, que só chega quando um pipeline de indexação
existir).

- **Onde:** `src/db/schema/rag.ts` (coluna `search_vector`)
- **Teste:** `test/infrastructure/persistence/chunk.repository.spec.ts`
  ("grava um chunk de docs com vetor e devolve o search_vector gerado pela
  GENERATED ALWAYS AS")
- **ADR:** [0079](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

<a id="rn-222"></a>

### RN-222 — A dimensão do vetor é documentada, não adivinhada, e `embedding` chega depois do chunk {#rn-222}

`chunks.embedding` é `vector(768)` — a dimensão real do `nomic-embed-text`
do Ollama, o único provider que hoje declara `capabilities.embeddings:
true` (RN-191, ADR 0075). Um índice vetorial tem dimensão FIXA: trocar de
modelo de embedding no futuro é migração nova, nunca parâmetro de runtime.
A coluna é NULLABLE: esta tabela guarda o CHUNK (texto recortado), e o
VETOR pode chegar depois via um pipeline de indexação assíncrono que ainda
não existe (Onda 4) — sem isso, chunking teria que esperar embedding,
misturando duas falhas de natureza diferente (parsing de documento contra
chamada de rede a um provider) numa escrita atômica só.

- **Onde:** `src/db/schema/rag.ts` (coluna `embedding`)
- **Teste:** `test/infrastructure/persistence/chunk.repository.spec.ts`
  ("grava um chunk de docs com vetor..." grava com `embedding` preenchido;
  as outras duas specs gravam sem ele, confirmando a nulabilidade)
- **ADR:** [0079](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md); [RN-191](#rn-191)

<a id="rn-223"></a>

### RN-223 — O índice vetorial é HNSW, não IVFFlat, porque a tabela nasce vazia {#rn-223}

IVFFlat precisa de linhas já carregadas para treinar as listas (`lists`) e
fica ruim se construído sobre tabela vazia — que é exatamente o estado
desta tabela ao nascer, sem pipeline de indexação ainda (Onda 4). HNSW
constrói o grafo incrementalmente, inserção por inserção, sem etapa de
treino — bom desde a primeira linha. `vector_cosine_ops` porque é a
métrica que embeddings de texto geralmente esperam (o ranking de
similaridade não deveria mudar com a magnitude do vetor).

- **Onde:** `src/db/migrations/0045_shallow_randall.sql`
  (`chunks_embedding_idx`)
- **ADR:** [0079](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

<a id="rn-225"></a>

### RN-225 — Migração que pode exigir privilégio de operador nasce em `breaking/` {#rn-225}

Criar uma extensão exige que o role da aplicação tenha `CREATEDB` (ou que a
extensão esteja marcada "trusted" pelo DBA). Localmente o role é
superusuário, mas nada garante isso em produção — gerenciadores de
Postgres administrado frequentemente não dão superusuário à aplicação. Se
a migration falhar aí, é ação do OPERADOR antes do deploy (rodar `CREATE
EXTENSION vector;` uma vez, como superusuário), não bug do produto — o
critério do CLAUDE.md para nascer em `breaking/` em vez de
`feature/`/`bugfix/`.

- **Onde:** branch `breaking/tabela-de-chunks`,
  `src/db/migrations/0045_shallow_randall.sql` (comentário que
  documenta a decisão dentro da própria migration)
- **ADR:** [0079](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)

<a id="rn-226"></a>

### RN-226 — `ChunkRepository` cobre só escrita/leitura básica; `createMany` é operação de lote {#rn-226}

O port só tem `create`, `createMany`, `findById` e `listByProject` — busca
híbrida (vetor + léxico, pesos, limiar) é da Onda 4 (G2) e deliberadamente
NÃO entra aqui: o port guarda dado, o caso de uso decide o que fazer com
ele. `createMany` existe porque uma indexação recorta N trechos de um
documento/sessão de uma vez, evitando N round-trips por documento
indexado.

- **Onde:** `src/application/ports/chunk-repository.port.ts`,
  `src/infrastructure/persistence/drizzle/chunk.repository.ts`
- **Teste:** `test/infrastructure/persistence/chunk.repository.spec.ts`
  ("createMany grava um lote e listByProject filtra por escopo, sem
  misturar docs e session")
- **ADR:** [0079](https://github.com/viralabs-dev/brabo/blob/dev/docs/adr/0079-tabela-de-chunks-vetor-e-tsvector-juntos.md)
