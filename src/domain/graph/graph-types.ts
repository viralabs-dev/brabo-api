/**
 * Tipos compartilhados pelos casos de uso do grafo de conhecimento
 * (`application/use-cases/graph/*`) — fundação para (a) templates de prompt
 * versionados e (b) memória relacional (interações, hipóteses do Psicólogo
 * com evidência, perfis da Anamnese, handoffs entre agentes).
 *
 * O grafo é memória DERIVADA do event log — nunca fonte de verdade. Cada
 * gravação aqui é um MERGE idempotente: reprocessar o MESMO evento (replay de
 * outbox, retomada depois de restart) nunca duplica nó nem aresta. A chave
 * natural de cada tipo está documentada no caso de uso que a usa.
 */

export interface PromptVersion {
  name: string;
  version: string;
  body: string;
  hash: string;
  /** ISO 8601 — o driver devolve `DateTime` do Neo4j; convertido para string ao sair do `GraphStore`. */
  createdAt: string;
  active: boolean;
}

export interface InteractionRecord {
  userId: string;
  projectId: string;
  sessionId: string;
  seqInicio: number;
  seqFim: number;
}

export interface HypothesisRecord {
  hypothesisId: string;
  sessionId: string;
  /** `psychologist_hypotheses.description`/similar — texto curto da hipótese, para leitura sem ir ao Postgres. */
  descricao: string;
  status: 'ativa' | 'descartada';
  /** Os eventos (por `seq`, na mesma sessão) que sustentam a hipótese. */
  evidenceSeqs: number[];
}

export interface AnamneseProfileRecord {
  userId: string;
  dimensao: string;
  proficiencia: string;
}

export interface HandoffRecord {
  sessionId: string;
  seq: number;
  fromAgent: string;
  toAgent: string;
}

export interface UserContextHypothesis {
  id: string;
  descricao: string;
  status: string;
  evidenceSeqs: number[];
}

export interface UserContextHandoff {
  sessionId: string;
  seq: number;
  fromAgent: string;
  toAgent: string;
}

export interface UserContextProfile {
  dimensao: string;
  proficiencia: string;
}

export interface UserContext {
  hypotheses: UserContextHypothesis[];
  profiles: UserContextProfile[];
  recentHandoffs: UserContextHandoff[];
}
