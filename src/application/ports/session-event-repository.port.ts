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
  /**
   * Só eventos destes tipos (RN-580). Vazio ou ausente = todos. Existe para o
   * engine ler "o product brief e as regras" sem baixar a sessão inteira e
   * filtrar em memória — o que, com o teto de 200, deixava de fora justamente
   * o artefato que nasce DEPOIS do evento 200. O teto continua valendo: é o
   * mesmo `limit`, contando só os tipos pedidos.
   */
  types?: string[];
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
  // Todos os eventos de um tipo numa sessão, em ordem crescente de seq. Usado
  // pelo terceiro sinal de trabalho pendente (RN-064): o último `agent.status`
  // por ator diz se ele está `working` no meio de um turno.
  abstract listByTypeInSession(
    sessionId: string,
    type: string,
  ): Promise<SessionEvent[]>;
  // O evento MAIS RECENTE (maior `seq`) entre os tipos pedidos, ou `null`.
  // Usado pelo quinto sinal de trabalho pendente (RN-581): quem falou por
  // último na conversa. Existe em vez de `listByTypeInSession` porque esta
  // pergunta é feita a cada heartbeat expirado durante até 8h, e trazer TODAS
  // as respostas da sessão (texto inteiro) para ler uma só seria o custo
  // crescendo com a conversa, a cada 30 segundos.
  abstract findLatestOfTypesInSession(
    sessionId: string,
    types: readonly string[],
  ): Promise<SessionEvent | null>;
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
