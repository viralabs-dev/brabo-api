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

/**
 * Uma hipótese do Psicólogo que a PRÓPRIA pessoa aceitou, e que por isso vira
 * fato do perfil dela (RN-680, ADR 0196). Nasce da tradução de
 * `psychologist.hypothesis_accepted` com `fatoDoPerfil: true` — nunca de uma
 * escrita direta —, então `grafo:reprojetar` a reconstrói do event log.
 */
export interface ProfileFactRecord {
  /** Chave natural: a hipótese aceita (`psychologist_hypotheses.id`). */
  hypothesisId: string;
  /** O sujeito: o autor da sessão analisada, que é também quem aceitou. */
  userId: string;
  /** O fato vale para ESTE projeto — a leitura é escopada a ele (ADR 0060). */
  projectId: string;
  agenteAlvo: string;
  hipotese: string;
  sugestao: string;
  /** ISO 8601 — instante do evento de aceite; ordena a leitura (mais recente primeiro). */
  aceitoEm: string;
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

export interface UserContextFact {
  hypothesisId: string;
  agenteAlvo: string;
  hipotese: string;
  sugestao: string;
  aceitoEm: string;
}

export interface UserContext {
  hypotheses: UserContextHypothesis[];
  profiles: UserContextProfile[];
  recentHandoffs: UserContextHandoff[];
  /** Fatos do perfil (hipóteses aceitas pela pessoa NESTE projeto), os mais recentes primeiro, até o teto. */
  facts: UserContextFact[];
  /** Quantos fatos existem ao todo — `facts.length < factsTotal` é recorte, e quem mostra diz (RN-180). */
  factsTotal: number;
}
