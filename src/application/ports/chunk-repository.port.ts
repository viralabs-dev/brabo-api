// PROGRAMA 28, Onda 3, frente G1 — fundação do Chat RAG (ADR 0079).
//
// Este port cobria só ESCRITA e LEITURA básica. A Onda 4 (G2, ADR 0080)
// acrescentou dois pares de método: DELETE (para o pipeline de indexação
// reindexar de forma idempotente — apagar e recriar, nunca UPDATE em cima do
// que já existe) e SEARCH (as duas metades da busca híbrida, vetor e léxico,
// como consultas SEPARADAS — cada uma aproveita o índice feito para ela,
// HNSW ou GIN; ver ADR 0079). Pesos, limiar e a fusão dos dois resultados
// continuam de fora, no caso de uso (`HybridSearchUseCase`) — o port guarda
// dado e resolve a consulta que só o banco sabe resolver bem, o caso de uso
// decide o que fazer com o resultado. Mesmo motivo que `ModuleMapRepository`
// não sabe validar ciclo.

/**
 * Os QUATRO escopos honestos do índice (RN-219/454): documentação, ADR,
 * sessão e `local` (ADR 0113) — uma pasta do PRÓPRIO usuário anexada como
 * referência de leitura via upload do navegador. Código do REPOSITÓRIO do
 * projeto e PR ficam de fora — ver `chunks` em `db/schema.ts` para o
 * porquê.
 */
export type ChunkScope = 'docs' | 'adr' | 'session' | 'local';

/**
 * Metadados de origem do trecho — tudo opcional porque quem decide o que
 * preencher é o pipeline de indexação, não este port.
 *
 * `uploadedBy`/`folderName` (RN-455, ADR 0113) só se aplicam a `scope:
 * 'local'` — quem anexou a pasta e o nome dela, para o painel de cobertura
 * poder mostrar "X arquivos de <folderName>" sem uma coluna nova.
 */
export interface ChunkMetadata {
  title?: string;
  headingPath?: string[];
  chunkIndex?: number;
  totalChunks?: number;
  sourceRef?: string;
  uploadedBy?: string;
  folderName?: string;
}

export interface Chunk {
  id: string;
  projectId: string;
  scope: ChunkScope;
  sessionId: string | null;
  sourcePath: string | null;
  content: string;
  /** `null` até o pipeline de indexação (Onda 4) gerar o vetor. */
  embedding: number[] | null;
  metadata: ChunkMetadata;
  createdAt: Date;
}

/**
 * `sessionId`/`sourcePath` são mutuamente exclusivos pelo CHECK da migração
 * `0045` (RN-219) — o repositório não repete a validação, o banco é quem
 * recusa a linha inconsistente.
 */
export interface NewChunk {
  projectId: string;
  scope: ChunkScope;
  sessionId?: string | null;
  sourcePath?: string | null;
  content: string;
  embedding?: number[] | null;
  metadata?: ChunkMetadata;
}

/** Um candidato de busca — o chunk mais o score do SINAL que o trouxe. */
export interface ChunkSearchCandidate {
  chunk: Chunk;
  /** 0..1 (cosseno) ou `ts_rank` normalizado — depende de qual método devolveu. */
  score: number;
}

export interface ChunkSearchOptions {
  /** Ausente busca nos quatro escopos. */
  scope?: ChunkScope[];
  limit: number;
}

export abstract class ChunkRepository {
  abstract create(input: NewChunk): Promise<Chunk>;
  /**
   * Uma indexação recorta N trechos de um documento/sessão de uma vez —
   * mesmo motivo de `PsychologistHypothesisRepository.createMany`: N
   * `create()` em sequência seria N round-trips por documento indexado.
   */
  abstract createMany(inputs: NewChunk[]): Promise<Chunk[]>;
  abstract findById(id: string): Promise<Chunk | null>;
  /**
   * `scope` opcional — sem ele, lista os quatro escopos do projeto juntos.
   * Sem paginação de propósito: é fundação, o consumidor real (busca
   * híbrida da Onda 4) não vai listar por aqui, vai buscar por similaridade.
   */
  abstract listByProject(
    projectId: string,
    scope?: ChunkScope,
  ): Promise<Chunk[]>;

  /**
   * Apaga todos os chunks de UM escopo de arquivo (`docs`/`adr`/`local`) do
   * projeto — nunca `session`, que é sempre um recorte por SESSÃO
   * (`deleteBySession`), não por projeto inteiro (RN-231). `local`
   * (RN-455) segue exatamente o mesmo desenho de `docs`/`adr`: full
   * rebuild por projeto, não por sessão.
   *
   * O pipeline de indexação (Onda 4) reindexa por FULL REBUILD: apaga o
   * escopo inteiro e recria a partir do estado atual dos arquivos, em vez de
   * tentar diffar chunk a chunk — não há coluna de hash/versão do arquivo
   * fonte (decisão do ADR 0079: essa decisão pertence a quem escrevesse o
   * pipeline, e é o que este método assume). Devolve quantas linhas apagou,
   * só para o relatório de indexação poder contar.
   */
  abstract deleteByScope(
    projectId: string,
    scope: Exclude<ChunkScope, 'session'>,
  ): Promise<number>;

  /**
   * Apaga todos os chunks de UMA sessão — o full rebuild do escopo
   * `session`, sempre por sessão porque cada sessão é reindexada
   * independentemente (RN-231).
   */
  abstract deleteBySession(sessionId: string): Promise<number>;

  /**
   * A metade VETORIAL da busca híbrida (ADR 0080): os chunks mais
   * próximos de `queryVector` por similaridade de cosseno, usando o índice
   * HNSW. Só considera chunks com `embedding` preenchido — um chunk sem
   * vetor não participa desta metade (mas pode aparecer pela léxica).
   */
  abstract searchByVector(
    projectId: string,
    queryVector: number[],
    opts: ChunkSearchOptions,
  ): Promise<ChunkSearchCandidate[]>;

  /**
   * A metade LÉXICA da busca híbrida (ADR 0080): `plainto_tsquery` contra
   * `search_vector`, usando o índice GIN, ordenado por `ts_rank`
   * normalizado (bit 32 — `rank/(rank+1)`, sempre em `[0, 1)`).
   */
  abstract searchByLexicalQuery(
    projectId: string,
    query: string,
    opts: ChunkSearchOptions,
  ): Promise<ChunkSearchCandidate[]>;
}
