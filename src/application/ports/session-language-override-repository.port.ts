/**
 * O idioma das respostas FIXADO por uma pessoa numa sessão (RN-618, ADR 0177).
 *
 * A chave é SEMPRE o par `{sessão, usuário}`: o override vale só para quem o
 * fixou, e dois participantes da mesma sessão não se tocam. Não há leitura
 * "da sessão inteira" de propósito — não existe pergunta de produto que ela
 * responda, e existir convidaria a tratar o idioma como da sessão.
 */
export abstract class SessionLanguageOverrideRepository {
  /** O código fixado, ou `null` quando a pessoa não fixou nada ali. */
  abstract find(sessionId: string, userId: string): Promise<string | null>;

  /** Fixa (ou troca) o idioma — upsert pelo par. */
  abstract set(
    sessionId: string,
    userId: string,
    language: string,
  ): Promise<void>;

  /** Volta a herdar da conta — apaga a linha; idempotente. */
  abstract clear(sessionId: string, userId: string): Promise<void>;
}
