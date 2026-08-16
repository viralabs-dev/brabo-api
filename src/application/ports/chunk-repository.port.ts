// PROGRAMA 28, Onda 3, frente G1 — fundação do Chat RAG (ADR 0079).
//
// Este port cobre só ESCRITA e LEITURA básica. Busca híbrida (vetor +
// léxico, pesos, limiar) é da Onda 4 (G2) — deliberadamente NÃO entra aqui,
// pelo mesmo motivo que `ModuleMapRepository` não sabe validar ciclo: o
// port guarda dado, o caso de uso decide o que fazer com ele.

/**
 * Os TRÊS escopos honestos do índice (RN-219): documentação, ADR e sessão.
 * Código e PR ficam de fora — ver `chunks` em `db/schema.ts` para o porquê.
 */
export type ChunkScope = 'docs' | 'adr' | 'session';

/**
 * Metadados de origem do trecho — tudo opcional porque quem decide o que
 * preencher é o pipeline de indexação (Onda 4, ainda não existe), não este
 * port.
 */
export interface ChunkMetadata {
  title?: string;
  headingPath?: string[];
  chunkIndex?: number;
  totalChunks?: number;
  sourceRef?: string;
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
   * `scope` opcional — sem ele, lista os três escopos do projeto juntos.
   * Sem paginação de propósito: é fundação, o consumidor real (busca
   * híbrida da Onda 4) não vai listar por aqui, vai buscar por similaridade.
   */
  abstract listByProject(
    projectId: string,
    scope?: ChunkScope,
  ): Promise<Chunk[]>;
}
