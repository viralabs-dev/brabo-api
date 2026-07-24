import type {
  Actor,
  SessionEvent,
} from '../../domain/sessions/session-event.entity';

export interface NewSessionEvent {
  id: string;
  sessionId: string;
  seq: number;
  type: string;
  actor: Actor;
  payload: unknown;
}

export interface ListPaginatedOptions {
  afterSeq?: number;
  limit?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: number | null;
}

export abstract class SessionEventRepository {
  abstract append(input: NewSessionEvent): Promise<SessionEvent>;
  abstract listPaginated(
    sessionId: string,
    opts: ListPaginatedOptions,
  ): Promise<Page<SessionEvent>>;
  // Busca por id global (Fase 3b) — usado pra validar que um business_rule_id
  // referencia mesmo um evento artifact.business_rule existente.
  abstract findById(id: string): Promise<SessionEvent | null>;
  // Todos os eventos de um tipo nas sessões de um projeto (join em sessions).
  // Usado pela cobertura regra→stories (artifact.business_rule do projeto).
  abstract listByTypeForProject(
    projectId: string,
    type: string,
  ): Promise<SessionEvent[]>;
}
