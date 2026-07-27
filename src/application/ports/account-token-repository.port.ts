export type PropositoDeToken =
  | 'email_verification'
  | 'password_reset'
  | 'set_initial_password';

export interface TokenConsumido {
  id: string;
  userId: string;
  createdAt: Date;
}

export abstract class AccountTokenRepository {
  /**
   * Invalida os tokens vivos daquele propósito e emite um novo, na mesma
   * transação.
   *
   * O supersede não é higiene: sem ele, um usuário que clica em "esqueci minha
   * senha" cinco vezes deixa cinco links de takeover válidos em cinco e-mails,
   * cada um valendo uma hora.
   */
  abstract emitir(entrada: {
    userId: string;
    purpose: PropositoDeToken;
    tokenHash: string;
    expiresAt: Date;
    ip?: string | null;
  }): Promise<void>;

  /**
   * Consome o token, exatamente uma vez.
   *
   * O UPDATE condicional É a guarda — não há SELECT antes. Ler-e-depois-
   * escrever deixa dois envios simultâneos passarem os dois, e isso não é
   * hipótese: scanner de segurança de e-mail corporativo (Safe Links,
   * Proofpoint) abre TODO link de TODA mensagem, então o robô costuma
   * consumir o token antes do humano clicar. A corrida é o caso normal.
   *
   * `null` = inexistente, de outro propósito, já consumido, invalidado ou
   * expirado. O chamador não distingue para o cliente; distingue só para o log.
   */
  abstract consumir(entrada: {
    tokenHash: string;
    purpose: PropositoDeToken;
    ip?: string | null;
  }): Promise<TokenConsumido | null>;

  /** Invalida os vivos de um ou mais propósitos — usado no reset de senha. */
  abstract invalidarVivos(
    userId: string,
    purposes: PropositoDeToken[],
    motivo: string,
  ): Promise<number>;
}
