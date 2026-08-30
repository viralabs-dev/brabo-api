// Chunks indexados do Chat RAG (PROGRAMA 28, ADR 0075/0079) — `domain/rag`.
// Vetor E `tsvector` na mesma linha, para a busca híbrida não precisar de duas
// tabelas nem de join.

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  check,
  vector,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { projects } from './iam';
import { sessions } from './sessions';

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
