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
 * SMTP real é configuração futura e não bloqueia esta fase. O que a porta
 * garante é que o dia de ligar SMTP seja trocar a implementação, e não achar
 * as chamadas espalhadas.
 */
export abstract class MailSender {
  abstract enviar(email: EmailParaEnviar): Promise<void>;
}
