import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import {
  MailSender,
  type EmailParaEnviar,
  type TipoDeEmail,
} from '../../application/ports/mail-sender.port';
import { resolverConfigSmtp } from './smtp-config';

/**
 * Implementação SMTP real do `MailSender` (backlog "SMTP real no
 * MailSender" — ver ADR 0096).
 *
 * ## Por que `nodemailer`
 *
 * SMTP é protocolo de LINHA, com estado, MIME, STARTTLS e múltiplos
 * mecanismos de AUTH — diferente das APIs JSON sobre HTTP que o resto do
 * produto integra (providers de LLM, sobre `node:http` puro). Reimplementar
 * isso à mão seria reinventar uma roda sensível a segurança sem ganho
 * nenhum; `nodemailer` é o padrão de fato do ecossistema Node, sem árvore de
 * dependência pesada (zero dependências próprias).
 *
 * ## Texto puro, nunca HTML
 *
 * A porta não carrega estrutura para corpo rico, e um template engine aqui
 * seria superfície de injeção/XSS por um ganho que ninguém pediu. Cada
 * `tipo` tem um texto fixo em pt-BR, com o link quando fizer sentido.
 *
 * ## O que NUNCA vai para o log
 *
 * Mesma régua do `LogMailSender`: o token bruto e o corpo do e-mail nunca
 * aparecem no log, nem em caso de falha de envio. Log de sucesso/falha cita
 * só `tipo`/destinatário.
 */
@Injectable()
export class SmtpMailSender extends MailSender {
  private readonly logger = new Logger(SmtpMailSender.name);
  private readonly transporte: Transporter;
  private readonly remetente: string;

  /**
   * `transporteDeTeste` só existe para o teste montar um transporte
   * `jsonTransport` (modo embutido do próprio `nodemailer`, sem rede) — o
   * `useFactory` de `AuthUseCasesModule` nunca passa este argumento.
   */
  constructor(transporteDeTeste?: Transporter) {
    super();
    const config = resolverConfigSmtp();
    this.remetente = config.from;
    this.transporte =
      transporteDeTeste ??
      createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user
          ? { user: config.user, pass: config.password }
          : undefined,
      });
  }

  async enviar(email: EmailParaEnviar): Promise<void> {
    const { assunto, texto } = montarConteudo(email);

    try {
      await this.transporte.sendMail({
        to: email.para,
        from: this.remetente,
        subject: assunto,
        text: texto,
      });
      this.logger.log({
        msg: 'e-mail enviado via SMTP',
        tipo: email.tipo,
        para: email.para,
      });
    } catch (erro) {
      this.logger.error({
        msg: 'falha ao enviar e-mail via SMTP',
        tipo: email.tipo,
        para: email.para,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      throw erro;
    }
  }
}

/** `WEB_ORIGIN` cru, mesmo idioma de `auth.controller.ts`/`git.controller.ts`. */
function webOrigin(): string {
  return process.env.WEB_ORIGIN ?? 'http://localhost:5173';
}

function formatarExpiracao(expiraEm: Date | undefined): string {
  if (!expiraEm) return '';
  return ` O link expira em ${expiraEm.toLocaleString('pt-BR')}.`;
}

function montarConteudo(email: EmailParaEnviar): {
  assunto: string;
  texto: string;
} {
  const origem = webOrigin();

  const CORPOS: Record<TipoDeEmail, () => { assunto: string; texto: string }> =
    {
      email_verification: () => ({
        assunto: 'Confirme seu e-mail no Brabo',
        texto:
          'Confirme seu e-mail para concluir o cadastro no Brabo.\n\n' +
          `${origem}/verificar-email?token=${email.token}\n` +
          `${formatarExpiracao(email.expiraEm)}\n\n` +
          'Se você não pediu este cadastro, ignore esta mensagem.',
      }),
      password_reset: () => ({
        assunto: 'Redefinição de senha no Brabo',
        texto:
          'Pediram para redefinir a senha da sua conta no Brabo. Se foi você, ' +
          'use o link abaixo para escolher uma senha nova:\n\n' +
          `${origem}/definir-senha?token=${email.token}\n` +
          `${formatarExpiracao(email.expiraEm)}\n\n` +
          'Se não foi você, ignore esta mensagem — sua senha continua a mesma.',
      }),
      set_initial_password: () => ({
        assunto: 'Defina sua senha no Brabo',
        texto:
          'Sua conta no Brabo foi migrada e ainda não tem senha. Use o link ' +
          'abaixo para definir uma:\n\n' +
          `${origem}/definir-senha?token=${email.token}\n` +
          `${formatarExpiracao(email.expiraEm)}\n\n` +
          'Se você não reconhece esta conta, ignore esta mensagem.',
      }),
      register_duplicate: () => ({
        assunto: 'Tentativa de cadastro com seu e-mail no Brabo',
        texto:
          'Alguém tentou se cadastrar no Brabo usando este e-mail, que já tem ' +
          'uma conta. Se foi você e esqueceu a senha, use "Esqueci minha ' +
          `senha" para redefinir:\n\n${origem}/esqueci-senha\n\n` +
          'Se não foi você, nenhuma ação é necessária — sua conta está segura.',
      }),
    };

  return CORPOS[email.tipo]();
}
