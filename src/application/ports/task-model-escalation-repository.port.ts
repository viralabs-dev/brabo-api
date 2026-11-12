export interface TaskModelEscalation {
  taskId: string;
  projectId: string;
  agentId: string;
  limitBlocks: number;
  escalated: boolean;
  baseModelId: string | null;
  baseRoutingPreference: string | null;
}

/** RN-1144 (AT-916): o estado da escalada de modelo por tarefa. */
export abstract class TaskModelEscalationRepository {
  /** Soma 1 bloqueio por limite (cria a linha se for o primeiro). */
  abstract registrarBloqueio(
    taskId: string,
    projectId: string,
    agentId: string,
  ): Promise<TaskModelEscalation>;

  /** Marca a escalada: guarda a base (só na 1ª) e zera o contador. */
  abstract marcarEscalada(
    taskId: string,
    base: { modelId: string | null; routingPreference: string | null },
  ): Promise<void>;

  abstract find(taskId: string): Promise<TaskModelEscalation | null>;

  abstract remove(taskId: string): Promise<void>;
}
