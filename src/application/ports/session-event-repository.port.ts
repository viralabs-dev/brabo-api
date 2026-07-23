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
}
