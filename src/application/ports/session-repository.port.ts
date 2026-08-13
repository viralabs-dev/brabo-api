import type { Session } from '../../domain/sessions/session.entity';
import type { SessionKind } from '../../domain/sessions/session-kind';
import type { SessionStatus } from '../../domain/sessions/session-state-machine';

export abstract class SessionRepository {
  abstract create(input: {
    projectId: string;
    createdBy: string;
    /**
     * A INTENÇÃO da sessão (RN-097). OBRIGATÓRIO de propósito: o tipo é
     * decisão de quem abre, e um parâmetro opcional convidaria cada caminho a
     * herdar calado o default da coluna — que é o que este campo existe para
     * impedir.
     */
    kind: SessionKind;
    /** Nome amigável opcional (RN-098). Não substitui a hashtag do id. */
    name?: string | null;
    /** `traceparent` W3C da span raiz da sessão — ver sessions.trace_parent. */
    traceParent?: string | null;
  }): Promise<Session>;

  abstract findInProject(
    projectId: string,
    sessionId: string,
  ): Promise<Session | null>;

  abstract listForProject(projectId: string): Promise<Session[]>;

  /**
   * Sessão de execução VIGENTE do projeto: a `active` mais recente que já
   * carrega um `execution.activated`. `null` quando não há nenhuma.
   *
   * Não existe coluna que diga "esta sessão é de execução" — o que distingue
   * uma é o evento que ela guarda, e é por ele que se pergunta. Serve à
   * reativação, que precisa cair na sessão onde os dev agents já estão
   * escrevendo, em vez de abrir uma nova a cada chamada (achado #11 do
   * primeiro dogfooding).
   */
  abstract findActiveExecutionSession(
    projectId: string,
  ): Promise<Session | null>;

  /**
   * Troca o nome amigável da sessão (RN-098). `null` volta a exibir só a
   * hashtag. Devolve `null` quando a sessão não existe NAQUELE projeto — o
   * escopo é do repositório, não do chamador.
   *
   * `kind` não tem equivalente aqui, e é deliberado: intenção de criação que
   * pudesse ser trocada depois viraria estado, e o produto voltaria a ter duas
   * fontes disputando o que é uma sessão de execução.
   */
  abstract rename(
    projectId: string,
    sessionId: string,
    name: string | null,
  ): Promise<Session | null>;

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
