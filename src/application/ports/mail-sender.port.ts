export type TipoDeEmail =
  | 'email_verification'
  | 'password_reset'
  | 'set_initial_password'
  /** Alguém tentou se registrar com um endereço que já existe — ver RegisterUseCase. */
  | 'register_duplicate';

export interface EmailParaEnviar {
  para: string;
  tipo: TipoDeEmail;
  /**
   * O token BRUTO, quando o e-mail carrega um link.
   *
   * É o único lugar do sistema onde ele existe em claro depois de gerado — o
   * banco guarda só o HMAC. Nenhuma implementação pode logar este campo.
   */
  token?: string;
  expiraEm?: Date;
}

/**
 * Porta de envio de e-mail (Fase 7a, item 3).
 *
 * SMTP real chegou pelo backlog "SMTP real no MailSender" (ADR 0096):
 * `LogMailSender` (default) e `SmtpMailSender` implementam a MESMA porta, e
 * `MAIL_TRANSPORT` escolhe entre as duas no `useFactory` de
 * `AuthUseCasesModule` — nenhuma chamada a `MailSender.enviar()` mudou.
 */
export abstract class MailSender {
  abstract enviar(email: EmailParaEnviar): Promise<void>;
}
