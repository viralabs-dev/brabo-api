# ADR 0121 — O schema dividido por agregado de domínio, atrás de um barrel

- **Status:** aceito
- **Data:** 2026-08-29
- **Referencia (sem editar):** [ADR 0038](0038-hierarquia-de-agentes.md)
  e [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) (as fronteiras de
  agregado que esta divisão espelha), [ADR 0117](0117-lockfile-proprio-para-o-website.md)
  (o mesmo formato de raciocínio: uma fronteira vale a pena quando a coisa
  compartilhada cobra um preço que ninguém escolheu pagar).

## Contexto

`apps/api/src/db/schema.ts` tinha 2 452 linhas com **51 declarações
`pgTable` e 34 declarações `pgEnum`** — tudo, de `users` a
`huggingface_model_pull_requests`, do event log aos chunks do RAG.

Isso já era dívida técnica declarada. A tabela de dívidas de
`docs/architecture.md` tinha uma linha para ele desde que a tabela existe: "o
arquivo mais alterado do repo … concentra as tabelas num arquivo só", com a
consequência escrita na própria linha — **um segundo colaborador mexendo no
schema ao mesmo tempo bate em conflito, garantido**, porque toda mudança de
schema cai no mesmo arquivo, seja de que parte do produto for. O número dessa
linha (35 tabelas) já estava 16 tabelas defasado, o que é evidência por si:
o arquivo cresceu mais rápido que o parágrafo que o descrevia.

Três custos concretos, nenhum hipotético:

1. **Todo merge de duas mudanças de schema é conflito textual**, mesmo quando
   as duas estão em agregados sem relação — uma coluna de auth e uma
   constraint do backlog nada têm a ver uma com a outra e ainda assim se
   encontram no mesmo hunk.
2. **`git log --follow` no schema é inútil.** O histórico do arquivo é a
   união do histórico de toda área do produto, então "quando `chunks` mudou e
   por quê" exige ler commits sobre `refresh_tokens`.
3. **Lê-lo exige saber onde rolar.** O arquivo já era organizado por dentro
   com comentários `// --- section ---` que nomeavam áreas do produto — a
   divisão não inventa uma taxonomia, promove uma que o arquivo já mantinha à
   mão.

## Decisão

### 1. Um arquivo por agregado de domínio, em `apps/api/src/db/schema/`

Os grupos **espelham `apps/api/src/domain/*`**, as fronteiras de agregado com
que o código já se compromete. Nenhuma taxonomia nova: se a camada de domínio
tem uma pasta para isso, o schema tem um arquivo com esse nome.

| arquivo | tabelas | enums |
|---|---|---|
| `iam.ts` | 5 | 4 |
| `sessions.ts` | 5 | 5 |
| `llm.ts` | 7 | 6 |
| `actions.ts` | 1 | 2 |
| `agents.ts` | 4 | 1 |
| `instructions.ts` | 2 | 0 |
| `backlog.ts` | 3 | 3 |
| `architecture.ts` | 2 | 0 |
| `git.ts` | 3 | 5 |
| `psychologist.ts` | 2 | 0 |
| `anamnese.ts` | 4 | 0 |
| `auth.ts` | 9 | 3 |
| `rag.ts` | 1 | 1 |
| `containers.ts` | 1 | 1 |
| `huggingface.ts` | 1 | 1 |
| `backup.ts` | 1 | 2 |
| **total** | **51** | **34** |

Três posições precisaram de decisão em vez de consulta, e cada uma está
registrada num comentário no topo do arquivo que a recebeu:

- **`handoffs` vai para `sessions.ts`, não `agents.ts`.** A entidade é
  `domain/sessions/handoff.entity.ts`: um handoff só existe dentro de uma
  sessão, e a camada de domínio já dizia isso.
- **`user_credentials` vai para `llm.ts`, não `iam.ts` nem `git.ts`**, embora
  `credential_provider` cubra chaves de LLM *e* tokens de git. A entidade é
  `domain/llm/user-credential.entity.ts` e `domain/git` não tem
  correspondente — a divisão segue a camada de domínio, inclusive onde a
  escolha da própria camada de domínio é um meio-termo.
- **`backup.ts` é o único arquivo sem pasta `domain/` correspondente.**
  Backup é infraestrutura operacional sem regra de negócio própria. Forçá-lo
  em `architecture.ts` ou `containers.ts` faria o mapeamento mentir sobre o
  que é um agregado, para evitar um arquivo de 60 linhas. Um arquivo pequeno e
  honesto custa menos que uma fronteira errada.

### 2. Enums moram com a tabela que os chama, porque o grafo de módulos precisa continuar acíclico

Uma chave estrangeira entre arquivos é segura num ciclo:
`.references(() => otherTable.column)` recebe um **callback preguiçoso**
justamente para que referências adiante se resolvam. Um **enum** entre
arquivos não é: `storyPromotionModeEnum('story_promotion')` roda na avaliação
do módulo, e um ciclo cuja aresta aponta para o lado errado lança
`ReferenceError: Cannot access '…' before initialization` no import, não na
consulta.

Por isso três enums ficam onde está o único chamador deles, e não onde um
agrupamento por assunto os poria:

- `project_execution_mode` e `story_promotion` moram em **`iam.ts`**, não em
  `git.ts`/`backlog.ts`. `projects` é o único consumidor dos dois. Pô-los no
  arquivo do "assunto" faria `iam.ts` depender de `git.ts` e `backlog.ts` na
  avaliação, enquanto os dois já dependem de `iam.ts` de forma preguiçosa —
  dois ciclos, e `iam` é o primeiro módulo que o barrel avalia, que é o
  sentido que falha.
- `failure_origin` mora em **`backlog.ts`**, compartilhado por
  `tasks.blocked_origin` e `delegations.failure_origin`. `agents.ts` já
  importa `tasks` de `backlog.ts` (para `delegations.task_id`), então
  `agents → backlog` é o sentido que já existe; o inverso fecharia o laço.

O grafo de imports resultante é um DAG: `iam.ts` e `backup.ts` não importam
nada dos irmãos, e todo o resto flui a partir deles. É essa propriedade que
se preserva quando uma tabela é acrescentada — não a ordem alfabética.

### 3. `schema.ts` vira um barrel; nenhum consumidor muda

`apps/api/src/db/schema.ts` agora tem 25 linhas de
`export * from './schema/<file>'`, na ordem de leitura do arquivo original
(identidade, sessão, LLM, ações, agentes, e daí para as bordas) e não em
ordem alfabética — a ordem é o índice do schema.

Cada um dos **144 módulos que importam de `…/db/schema`** — 46 em `src/`, 98
em `test/` e `scripts/` — continua funcionando com zero edições, porque eles
ainda importam do mesmo especificador e o barrel reexporta tudo. Isso inclui
`infrastructure/persistence/drizzle/drizzle-client.ts`, cujo
`import * as schema` → `drizzle(pool, { schema })` vê o mesmo conjunto de
exports que via antes.

### 4. `drizzle.config.ts` continua apontando para o barrel

`schema: './src/db/schema.ts'` não muda. O `drizzle-kit` resolve o módulo com
esbuild e segue a cadeia de `export *`, então descobre as 51 tabelas pelo
barrel — verificado, não suposto: `pnpm --filter api db:generate` imprime o
inventário completo de tabelas e depois **"No schema changes, nothing to
migrate"**. Um glob (`'./src/db/schema/*.ts'`) era o plano B se isso tivesse
falhado; não falhou, e o barrel é o ponteiro melhor porque é também o ponto
de entrada que o código da aplicação usa — um lugar que decide o que "o
schema" significa, não dois que podem divergir.

### 5. O critério de aceite é uma migration de diff zero, não uma suíte de testes passando

A mudança é puramente mecânica: nenhuma tabela, coluna, valor de enum, nome
de índice ou expressão de constraint mudou. A prova é o `db:generate` não
produzir **nenhum arquivo de migration novo e nenhum diff** contra o snapshot
em `src/db/migrations/meta/` — uma checagem mais estrita que a suíte de
testes, porque o Drizzle compara o *SQL inferido*, então um `notNull`
invertido, um default trocado ou um índice renomeado apareceria ali mesmo
com todos os testes passando.

## Consequências

- **Duas pessoas podem mudar o schema ao mesmo tempo sem conflito**, desde
  que trabalhem em agregados diferentes — que é o caso normal, e exatamente o
  que a linha de dívida dizia ser impossível.
- **`git log` num arquivo de schema agora é legível.** `git log --follow
  apps/api/src/db/schema/auth.ts` responde "o que aconteceu com as tabelas de
  auth", uma pergunta que antes não tinha resposta. O custo: o histórico
  *anterior* a este commit continua em `schema.ts`, e o `--follow` não
  atravessa a divisão (ele segue renomeações, não divisões de um para muitos).
  Arqueologia mais antiga que este ADR passa pelo caminho antigo.
- **A regra `schema-e-migrations` de `docs/.docmap.yml` precisou ganhar um
  glob.** Ela observava o literal `apps/api/src/db/schema.ts`; depois da
  divisão, uma CHECK constraint nova dentro de `schema/llm.ts` nem tocaria o
  barrel, e a regra teria ficado **cega, em silêncio, justamente para o que
  ela existe para observar** — constraints, que a própria nota dela aponta
  como regras de negócio, em geral. `apps/api/src/db/schema/**` agora é
  observado ao lado do barrel, que continua sendo um arquivo real que muda
  sempre que uma tabela nasce ou morre.
- **Uma tabela nova agora custa duas edições, não uma**: a tabela no arquivo
  do agregado dela e — só se o arquivo for novo — uma linha no barrel.
  Acrescentar uma tabela a um arquivo existente custa o mesmo de antes.
- **O grafo de imports acíclico agora é uma invariante que ninguém garante.**
  Não há teste que o afirme; um enum futuro posto no arquivo errado vai falhar
  de forma ruidosa no import (um `ReferenceError` no boot, não um defeito
  sutil), mas vai falhar no terminal de quem for, não na revisão. Declarado,
  não resolvido.
- **As migrations não foram tocadas.** `src/db/migrations/` e o snapshot dela
  são idênticos byte a byte; este ADR fecha a metade "arquivo único" da linha
  de dívida e nada mais. A dívida do contrato de schema api↔engine é outra
  linha, ainda aberta, e continua aberta.

## Alternativas descartadas

- **Dividir por camada em vez de por agregado** (todos os enums num arquivo,
  todas as tabelas em outro, todos os índices em outro): produz arquivos que
  ninguém tem motivo para abrir, e põe `budgets_scope_check` a dois arquivos
  de `budgets`. Também não resolveria o problema de conflito, já que toda
  mudança ainda tocaria o arquivo de enums.
- **Um `columns.ts` compartilhado reexportando os construtores de coluna do
  drizzle**, para que cada arquivo importe uma coisa só. Recusado: acrescenta
  um módulo que só existe para poupar digitação, esconde quais primitivas um
  arquivo de fato usa e faz a lista de imports deixar de ser um resumo do que
  o arquivo faz.
- **Deixar `schema.ts` como o arquivo real e acrescentar a divisão ao lado**
  (depreciando aos poucos): duas fontes de verdade para as mesmas tabelas, e
  o `drizzle-kit` veria as duplicatas. Recusado de saída.
- **Mudar os 144 consumidores para importar do arquivo do agregado
  específico.** Tentador — deixaria explícita a dependência de cada módulo
  sobre o schema —, mas transforma uma mudança mecânica de diff zero numa
  mudança de 144 arquivos que precisa ser revisada linha a linha, e pode ser
  feita depois, arquivo por arquivo, sempre que alguém tocar um deles. O
  barrel não impede isso; só não o exige hoje.
