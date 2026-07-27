import type {
  Actor,
  ActorKind,
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
  /**
   * Devolve os ÚLTIMOS `limit` eventos em vez dos primeiros (ainda em ordem
   * crescente de `seq`, pra não mudar a leitura de quem consome).
   *
   * Existe porque o padrão — os PRIMEIROS N — congela toda leitura ao vivo
   * assim que a sessão passa de `limit` eventos: o painel do time, a seção de
   * execução e o feed de atividade ficavam derivando estado do COMEÇO da
   * sessão pra sempre (ver ADR 0021). É opt-in por chamador: a paginação
   * incremental via `afterSeq` continua sendo o caminho de quem varre a
   * sessão inteira, e `latest` a ignora.
   */
  latest?: boolean;
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
  // Janela de tempo do projeto inteiro (Fase 4b — Anamnese analisa
  // "janelas do event log"). `actorKind` filtra interações do usuário;
  // `limit` protege contra janelas patológicas.
  abstract listForProjectInWindow(
    projectId: string,
    opts: {
      from: Date;
      to: Date;
      actorKind?: ActorKind;
      limit?: number;
    },
  ): Promise<SessionEvent[]>;
}
