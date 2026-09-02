// Chunks indexados do Chat RAG (PROGRAMA 28, ADR 0075/0079) — `domain/rag`.
// Vetor E `tsvector` na mesma linha, para a busca híbrida não precisar de duas
// tabelas nem de join.

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  unique,
  check,
  vector,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  RAG_VERDICTS,
  type RagSearchHitTelemetry,
  type RagSearchWeights,
} from '../../domain/rag/rag-telemetry';
import { projects } from './iam';
import { actorKindEnum, sessions } from './sessions';

// `tsvector` não tem tipo nativo em drizzle-orm/pg-core (diferente de
// `vector`, que a extensão pgvector traz pronto) — customType mínimo, só
// para dar nome ao tipo físico na migração. O valor NUNCA é escrito por
// quem chama: a coluna é GENERATED ALWAYS AS, populada pelo Postgres a
// partir de `content` (ver `chunks.searchVector` abaixo).
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

// Os QUATRO escopos honestos do índice (RN-219, ampliado pela RN-455):
// documentação, ADR, sessão e — desde o ADR 0113 — `local`, uma pasta do
// PRÓPRIO usuário anexada como referência de leitura via upload do
// navegador (nunca um caminho de host, nunca o mesmo mecanismo do runner —
// ver ADR 0113). Código do REPOSITÓRIO do projeto e PR continuam de fora de
// propósito — indexá-los sem watcher de reindexação a cada push faria o
// índice MENTIR sobre cobertura (achado do plano do PROGRAMA 28, "onde eu
// cortaria"). `local` não sofre desse problema: o upload em si já É o
// evento de atualização, não há reindexação automática para prometer.
export const chunkScopeEnum = pgEnum('chunk_scope', [
  'docs',
  'adr',
  'session',
  'local',
]);

/**
 * Um trecho indexado para o Chat RAG (ondas futuras) — vetor E `tsvector` na
 * MESMA linha (ADR 0079), para que a busca híbrida (Onda 4) não precise de
 * duas tabelas nem de um join para juntar semântica e léxico do mesmo
 * trecho.
 *
 * `embedding` é NULLABLE: esta tabela guarda o CHUNK (o texto recortado) e o
 * VETOR pode chegar depois, num pipeline de indexação assíncrono que ainda
 * não existe (Onda 4, G2) — sem isso, chunking teria que esperar embedding
 * para existir, e as duas coisas falham por razões diferentes (parsing vs.
 * chamada de LLM). `searchVector` não tem esse problema: é `GENERATED
 * ALWAYS AS` sobre `content`, então nasce pronta na mesma transação do
 * INSERT, sem depender de nenhum provider.
 *
 * O vínculo com o escopo indexado é MUTUAMENTE EXCLUSIVO por CHECK — mesmo
 * padrão de `projects.execution_mode`/`workspace_path` (ADR 0072/0104): `session`
 * exige `session_id` e recusa `source_path`; `docs`/`adr` exigem
 * `source_path` (caminho relativo do arquivo) e recusam `session_id`. A
 * trava fica no banco porque a tabela vai ser escrita por um pipeline
 * (Onda 4) que não necessariamente passa pelo mesmo caso de uso toda vez.
 */
export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    scope: chunkScopeEnum('scope').notNull(),
    // Só para scope = 'session'. O CHECK abaixo amarra os dois.
    sessionId: uuid('session_id').references(() => sessions.id, {
      onDelete: 'cascade',
    }),
    // Só para scope = 'docs'/'adr' — caminho relativo do arquivo fonte
    // (ex.: "docs/adr/0079-tabela-de-chunks.md"). O CHECK abaixo amarra os
    // dois.
    sourcePath: text('source_path'),
    // O texto do trecho — a unidade que a busca devolve como citação.
    content: text('content').notNull(),
    // 768 = a dimensão real do `nomic-embed-text` do Ollama, o único
    // provider que hoje declara `capabilities.embeddings: true` (RN-191).
    // Documentado, não adivinhado: um índice vetorial tem dimensão FIXA, e
    // trocar de modelo de embedding no futuro é migração nova, não
    // parâmetro de runtime.
    embedding: vector('embedding', { dimensions: 768 }),
    // GENERATED ALWAYS AS STORED — nunca escrita pelo aplicativo. Linguagem
    // 'portuguese' porque docs/ADRs/sessões do produto são pt-BR por
    // convenção (ver CLAUDE.md, seção Documentação).
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      () => sql`to_tsvector('portuguese', content)`,
    ),
    // Metadados de origem — nunca um campo novo por metadado: título,
    // trilha de headings, posição do chunk no documento/sessão fonte. Tudo
    // opcional porque a Onda 4 (pipeline de indexação) é quem decide o que
    // preencher; a tabela não impõe forma além de "é um objeto".
    metadata: jsonb('metadata')
      .$type<{
        title?: string;
        headingPath?: string[];
        chunkIndex?: number;
        totalChunks?: number;
        sourceRef?: string;
      }>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('chunks_project_scope_idx').on(table.projectId, table.scope),
    index('chunks_session_idx').on(table.sessionId),
    // GIN sobre o tsvector — a metade LÉXICA da busca híbrida da Onda 4.
    index('chunks_search_vector_idx').using('gin', table.searchVector),
    // HNSW, não IVFFlat: IVFFlat precisa de linhas já carregadas para
    // treinar as listas (`lists`) e fica ruim se construído sobre tabela
    // vazia — que é exatamente o estado desta tabela ao nascer, sem
    // pipeline de indexação ainda. HNSW constrói o grafo incrementalmente,
    // inserção por inserção, sem etapa de treino. `vector_cosine_ops`
    // porque é a métrica que embeddings de texto (Ollama incluso) esperam
    // — magnitude do vetor não deveria mudar o ranking de similaridade.
    index('chunks_embedding_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
    // RN-219 — mutuamente exclusivo com sourcePath, mesmo padrão do CHECK de
    // `projects.execution_mode`/`workspace_path` (ADR 0072/0104).
    check(
      'chunks_session_id_casa_com_escopo',
      sql`(${table.scope} = 'session') = (${table.sessionId} IS NOT NULL)`,
    ),
    check(
      'chunks_source_path_casa_com_escopo',
      sql`(${table.scope} = 'session') = (${table.sourcePath} IS NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Telemetria de busca (RN-479/480/481) — as DUAS tabelas que dão olhos ao RAG.
//
// `rag-search-limits.ts` declara, no próprio comentário, que os quatro números
// da busca híbrida são PONTO DE PARTIDA, nunca calibrados contra um corpo real
// de perguntas. Não havia como calibrar: a busca não deixava rastro nenhum.
// Estas duas tabelas são o rastro.
//
// ## Por que TABELA, e não só evento de sessão
//
// `session_events.session_id` é `NOT NULL` (ver `sessions.ts`), e uma busca
// vinda da ABA de RAG é de PROJETO — não tem sessão nenhuma. Registrar a
// telemetria só como evento perderia exatamente as buscas que um humano faz
// olhando os scores, que são as que carregam julgamento. É a mesma classe de
// problema que forçou o corte do metering de embedding no ADR 0075
// (`token_usage.session_id NOT NULL`), e aqui a saída é a mesma: tabela
// própria, com `session_id` NULLABLE.
//
// A TABELA é a fonte da MEDIÇÃO. O evento de sessão (`rag.search`/
// `rag.feedback`, emitido só quando HÁ sessão) é NARRAÇÃO da timeline — nunca
// se mede a partir dele, porque metade das buscas nunca vai estar lá.
// ---------------------------------------------------------------------------

/**
 * O veredito sobre um trecho recuperado. O enum mora no MESMO arquivo da
 * tabela que o chama, pela convenção do ADR 0121: FK entre arquivos é segura
 * num ciclo (`.references()` é callback preguiçoso), enum entre arquivos NÃO é
 * (roda na avaliação do módulo).
 *
 * `actor_kind` NÃO é redeclarado aqui — é o mesmo de `sessions.ts`, reusado
 * como `actions.ts` e `llm.ts` já fazem.
 */
export const ragVerdictEnum = pgEnum('rag_verdict', RAG_VERDICTS);

/**
 * UMA busca híbrida executada, com o que ela devolveu e sob quais pesos.
 *
 * ## `pesos` congelado na linha é o ponto da tabela
 *
 * Mesma disciplina do preço congelado no metering (ADR 0042) e da
 * `image_version` de `project_containers`: sem a cópia, a primeira calibração
 * que mexer em `RAG_SEARCH_WEIGHT_VECTOR` faria toda a medição anterior passar
 * a significar outra coisa — e "melhorou depois da mudança?", a única pergunta
 * que esta tabela existe para responder, ficaria impossível de fazer com os
 * dados que se tem.
 *
 * ## `degraded` e `vector_available` são DUAS colunas de propósito
 *
 * Hoje `degraded = !vector_available`, e a redundância é admitida em vez de
 * escondida. Elas não respondem a mesma pergunta: `vector_available` é um fato
 * sobre o PROVIDER de embedding no instante da busca — é ele que faz
 * `medir:rag` REPROVAR, porque sem índice denso a medição não vale —, enquanto
 * `degraded` é a palavra do CONTRATO com o engine
 * (`POST /internal/rag/search`), cuja definição pode crescer para outras
 * degradações sem que o provider tenha caído. Derivar uma da outra na leitura
 * amarraria as duas para sempre.
 *
 * `session_id` NULL é INFORMAÇÃO, não ausência de dado: quer dizer que a busca
 * veio da ABA (de projeto, sem sessão), não de um agente.
 */
export const ragSearches = pgTable(
  'rag_searches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    // NULL = veio da aba de RAG (busca de PROJETO), não de um agente.
    sessionId: uuid('session_id').references(() => sessions.id, {
      onDelete: 'cascade',
    }),
    actorKind: actorKindEnum('actor_kind').notNull(),
    actorId: text('actor_id').notNull(),
    query: text('query').notNull(),
    topK: integer('top_k').notNull(),
    // O que a busca DEVOLVEU, na ordem em que devolveu. `rank` é 1-based e é o
    // que, cruzado com o voto, separa "o índice está pobre" de "os PESOS estão
    // errados": índice pobre não devolve o trecho certo em posição nenhuma;
    // peso errado devolve o trecho certo em rank 7.
    hits: jsonb('hits').$type<RagSearchHitTelemetry[]>().notNull().default([]),
    degraded: boolean('degraded').notNull(),
    vectorAvailable: boolean('vector_available').notNull(),
    pesos: jsonb('pesos').$type<RagSearchWeights>().notNull(),
    latencyMs: integer('latency_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // A janela de `medir:rag` é sempre (projeto, intervalo de tempo).
    index('rag_searches_project_created_idx').on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

/**
 * O voto sobre UM trecho de UMA busca — o único sinal de VERDADE que a medição
 * tem. Sem ele, `precision@k` não existe e sobram latência e taxa de
 * degradação, que dizem se a busca RODOU, nunca se ela ACERTOU.
 *
 * `unique (search_id, chunk_id, actor_id)`: um voto por ator por trecho por
 * busca. Sem essa trava, quem clicasse duas vezes pesaria o dobro na
 * `precision@k` e a métrica passaria a medir entusiasmo.
 *
 * `chunk_id` referencia `chunks` com CASCATA, e o preço está declarado: uma
 * reindexação apaga e recria os chunks, então o voto vai junto. Manter o voto
 * apontando para um trecho que não existe mais não mediria nada — mas o
 * histórico de julgamento NÃO sobrevive a "Reindexar agora".
 */
export const ragFeedback = pgTable(
  'rag_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    searchId: uuid('search_id')
      .notNull()
      .references(() => ragSearches.id, { onDelete: 'cascade' }),
    chunkId: uuid('chunk_id')
      .notNull()
      .references(() => chunks.id, { onDelete: 'cascade' }),
    verdict: ragVerdictEnum('verdict').notNull(),
    actorKind: actorKindEnum('actor_kind').notNull(),
    actorId: text('actor_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('rag_feedback_search_idx').on(table.searchId),
    unique('rag_feedback_um_voto_por_ator').on(
      table.searchId,
      table.chunkId,
      table.actorId,
    ),
  ],
);
