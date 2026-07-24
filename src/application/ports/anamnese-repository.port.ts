export interface AnamneseQueueEntry {
  id: string;
  projectId: string;
  origin: string;
  hypothesisId: string;
  status: 'pending' | 'consumed';
  createdAt: Date;
  consumedAt: Date | null;
}

export abstract class AnamneseQueueRepository {
  // Idempotente por hypothesisId (unique) — aceitar a mesma hipótese
  // duas vezes não enfileira duas.
  abstract enqueueHypothesis(
    projectId: string,
    hypothesisId: string,
  ): Promise<void>;
  abstract listPending(projectId: string): Promise<AnamneseQueueEntry[]>;
  abstract markConsumed(ids: string[]): Promise<void>;
}

export interface AnamneseRun {
  id: string;
  projectId: string;
  sessionId: string;
  windowFrom: Date;
  windowTo: Date;
  eventCount: number;
  profileCount: number;
  createdAt: Date;
}

export interface NewAnamneseRun {
  projectId: string;
  sessionId: string;
  windowFrom: Date;
  windowTo: Date;
  eventCount: number;
  profileCount: number;
}

export abstract class AnamneseRunRepository {
  // Só gravado quando a rodada CONCLUI (run falho não deixa linha —
  // mesma disciplina de psychologist_analyses, permite retry legítimo).
  abstract create(input: NewAnamneseRun): Promise<AnamneseRun>;
  // A janela da próxima rodada começa no windowTo desta.
  abstract findLatest(projectId: string): Promise<AnamneseRun | null>;
}
