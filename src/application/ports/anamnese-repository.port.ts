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
  /**
   * Marca consumida a entrada da hipótese — chamado quando um
   * `instruction_patch` que a referencia é PROPOSTO, não quando a rodada
   * termina.
   *
   * Antes o engine mandava a lista de ids consumidos junto dos perfis, o
   * que queimava a hipótese mesmo numa rodada que não gerou patch nenhum:
   * o loop fechado morria em silêncio e nada re-enfileirava. Consumo agora
   * é CONSEQUÊNCIA do patch existir, não uma alegação do modelo.
   *
   * `projectId` no filtro fecha a porta de uma chamada marcar consumida a
   * fila de outro projeto. No-op se não houver entrada pendente.
   */
  abstract markConsumedByHypothesis(
    projectId: string,
    hypothesisId: string,
  ): Promise<void>;
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
