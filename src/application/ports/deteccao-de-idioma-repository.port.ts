/**
 * Um evento do AUTOR que pode ser evidência do idioma dele (AT-080, itens 5 e
 * 6): `chat.message` ou `chat.structured_question_answered`, ator `user`.
 */
export interface EventoDeEvidencia {
  sessionId: string;
  tipo: string;
  payload: { text?: unknown; answers?: unknown };
}

/**
 * O que a detecção de idioma do autor lê e grava (AT-163, RN-624).
 *
 * Porta própria, e não métodos novos em `SessionEventRepository`/
 * `UserRepository`: as perguntas são DESTA regra (as últimas mensagens de UMA
 * pessoa em todas as sessões; o conjunto de recusas; a confirmação), e nenhum
 * outro caso de uso as faz.
 */
export abstract class DeteccaoDeIdiomaRepository {
  /**
   * Os `limite` eventos de evidência MAIS RECENTES desta pessoa, em TODAS as
   * sessões (o detectado é por usuário, global — AT-168 resposta 6), em ordem
   * CRESCENTE (o mais recente por último). Servido pelo índice parcial
   * `session_events_evidencia_de_idioma_idx`.
   */
  abstract ultimasEvidencias(
    userId: string,
    limite: number,
  ): Promise<EventoDeEvidencia[]>;

  /** Os idiomas que a pessoa já recusou na pergunta de confirmação. */
  abstract recusados(userId: string): Promise<string[]>;

  /** Grava a recusa — idempotente (recusar de novo mantém a primeira data). */
  abstract recusar(userId: string, idioma: string): Promise<void>;

  /**
   * Grava o detectado CONFIRMADO — `users.detected_language` e
   * `detected_language_confirmed_at` juntos (o CHECK da RN-618 exige o par) —
   * e apaga a recusa antiga do mesmo idioma, numa transação.
   */
  abstract confirmar(userId: string, idioma: string, em: Date): Promise<void>;
}
