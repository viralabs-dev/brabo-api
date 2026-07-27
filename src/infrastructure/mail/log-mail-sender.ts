import { Injectable, Logger } from '@nestjs/common';
import {
  MailSender,
  type EmailParaEnviar,
} from '../../application/ports/mail-sender.port';

/**
 * Implementação log-only do MailSender (Fase 7a, item 3).
 *
 * ## O que ela loga, e o que ela nunca loga
 *
 * O token BRUTO não vai para o log — nunca, nem em dev. Log de aplicação vai
 * para o Loki, é lido por gente que não é dona da conta e fica retido por
 * semanas; um token de reset ali é uma credencial de takeover em texto claro
 * num sistema que não foi feito para guardar credencial. O que sai é o tipo, o
 * destinatário e a expiração — o suficiente para saber que o fluxo funcionou.
 *
 * Em desenvolvimento isso deixa o link inacessível pelo log, o que é
 * inconveniente de propósito: `AUTH_MAIL_LOG_TOKENS=true` libera, e só faz
 * sentido na máquina de quem está desenvolvendo. O aviso no boot existe para
 * a variável não sobreviver a um `docker compose` copiado para outro lugar.
 */
@Injectable()
export class LogMailSender extends MailSender {
  private readonly logger = new Logger(LogMailSender.name);
  private readonly exporTokens = process.env.AUTH_MAIL_LOG_TOKENS === 'true';

  constructor() {
    super();
    if (this.exporTokens) {
      this.logger.warn(
        'AUTH_MAIL_LOG_TOKENS=true — tokens de verificação e reset vão aparecer ' +
          'no log em texto claro. Só use em desenvolvimento local.',
      );
    }
  }

  enviar(email: EmailParaEnviar): Promise<void> {
    this.logger.log({
      msg: 'e-mail (log-only, SMTP ainda não configurado)',
      tipo: email.tipo,
      para: email.para,
      expiraEm: email.expiraEm?.toISOString(),
      ...(this.exporTokens && email.token ? { token: email.token } : {}),
    });
    return Promise.resolve();
  }
}
