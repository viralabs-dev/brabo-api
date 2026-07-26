import type { Session } from '../../domain/sessions/session.entity';
import type { SessionStatus } from '../../domain/sessions/session-state-machine';

export abstract class SessionRepository {
  abstract create(input: {
    projectId: string;
    createdBy: string;
    /** `traceparent` W3C da span raiz da sessão — ver sessions.trace_parent. */
    traceParent?: string | null;
  }): Promise<Session>;

  abstract findInProject(
    projectId: string,
    sessionId: string,
  ): Promise<Session | null>;

  abstract listForProject(projectId: string): Promise<Session[]>;

  /** SELECT ... FOR UPDATE — só faz sentido dentro de UnitOfWork.runInTransaction. */
  abstract findInProjectForUpdate(
    projectId: string,
    sessionId: string,
  ): Promise<Session | null>;

  // `terminationReason` só é passado (e gravado) no caminho de término
  // reportado pelo engine — undefined significa "não mexe na coluna"
  // (evita apagar um motivo já gravado numa transição terminal->terminal
  // que não tem motivo novo, ex. nenhuma hoje, mas defensivo).
  abstract updateStatus(
    sessionId: string,
    status: SessionStatus,
    closedAt: Date | null,
    terminationReason?: string | null,
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
