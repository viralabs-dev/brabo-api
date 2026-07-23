import type { Session } from '../../domain/sessions/session.entity';
import type { SessionStatus } from '../../domain/sessions/session-state-machine';

export abstract class SessionRepository {
  abstract create(input: {
    projectId: string;
    createdBy: string;
  }): Promise<Session>;

  abstract findInProject(
    projectId: string,
    sessionId: string,
  ): Promise<Session | null>;

  /** SELECT ... FOR UPDATE — só faz sentido dentro de UnitOfWork.runInTransaction. */
  abstract findInProjectForUpdate(
    projectId: string,
    sessionId: string,
  ): Promise<Session | null>;

  abstract updateStatus(
    sessionId: string,
    status: SessionStatus,
    closedAt: Date | null,
  ): Promise<Session>;

  /**
   * Incrementa next_seq atomicamente (lock de linha via UPDATE) e
   * retorna o seq atribuído a este evento (null se a sessão não
   * existir no projeto informado). É isso que garante seq sem gaps
   * sob escrita concorrente.
   */
  abstract incrementSeq(
    projectId: string,
    sessionId: string,
  ): Promise<number | null>;
}
