import { describe, it, expect, afterEach } from 'vitest';
import { createTransport, type Transporter } from 'nodemailer';
import { SmtpMailSender } from '../../../src/infrastructure/mail/smtp-mail-sender';
import type { EmailParaEnviar } from '../../../src/application/ports/mail-sender.port';

/**
 * `SmtpMailSender` (backlog "SMTP real no MailSender" — ver ADR 0096).
 *
 * O transporte é `jsonTransport: true` — modo de teste EMBUTIDO do próprio
 * `nodemailer`, sem rede nenhuma. `info.message` é o JSON do envelope que
 * teria sido mandado; é isso que os testes leem para conferir
 * to/from/subject/text, envolvendo `sendMail` num espião ANTES de injetar o
 * transporte no `SmtpMailSender` (que não expõe o resultado — a porta
 * `MailSender.enviar` devolve `void`).
 */

const ENV_ORIGINAIS = { ...process.env };

afterEach(() => {
  process.env = { ...ENV_ORIGINAIS };
});

interface Capturado {
  to: Array<{ address: string; name: string }>;
  from: { address: string; name: string };
  subject: string;
  text: string;
}

function criarSenderComCaptura(): {
  sender: SmtpMailSender;
  ultimoEnvio: () => Capturado;
} {
  process.env.NODE_ENV = 'development';
  process.env.SMTP_FROM = 'Brabo <nao-responda@brabo.exemplo>';
  process.env.WEB_ORIGIN = 'https://app.brabo.exemplo';

  const transporte: Transporter = createTransport({ jsonTransport: true });
  let capturado: Capturado | undefined;

  const sendMailOriginal = transporte.sendMail.bind(transporte);
  transporte.sendMail = (async (mail: Parameters<typeof sendMailOriginal>[0]) => {
    const info = await sendMailOriginal(mail);
    capturado = JSON.parse(
      String((info as { message: unknown }).message),
    ) as Capturado;
    return info;
  }) as typeof transporte.sendMail;

  const sender = new SmtpMailSender(transporte);

  return {
    sender,
    ultimoEnvio: () => {
      if (!capturado) throw new Error('nenhum e-mail foi enviado ainda');
      return capturado;
    },
  };
}

async function enviar(
  sender: SmtpMailSender,
  email: EmailParaEnviar,
): Promise<void> {
  await sender.enviar(email);
}

describe('SmtpMailSender', () => {
  it('email_verification: assunto, destinatário, remetente e link com o token', async () => {
    const { sender, ultimoEnvio } = criarSenderComCaptura();

    await enviar(sender, {
      para: 'usuario@exemplo.com',
      tipo: 'email_verification',
      token: 'token-bruto-123',
      expiraEm: new Date('2026-01-01T12:00:00Z'),
    });

    const capturado = ultimoEnvio();
    expect(capturado.to).toEqual([
      { address: 'usuario@exemplo.com', name: '' },
    ]);
    expect(capturado.from).toEqual({
      address: 'nao-responda@brabo.exemplo',
      name: 'Brabo',
    });
    expect(capturado.subject).toMatch(/confirme seu e-mail/i);
    expect(capturado.text).toContain(
      'https://app.brabo.exemplo/verificar-email?token=token-bruto-123',
    );
  });

  it('password_reset: link para /definir-senha', async () => {
    const { sender, ultimoEnvio } = criarSenderComCaptura();

    await enviar(sender, {
      para: 'usuario@exemplo.com',
      tipo: 'password_reset',
      token: 'tok-reset',
      expiraEm: new Date('2026-01-01T12:00:00Z'),
    });

    const capturado = ultimoEnvio();
    expect(capturado.subject).toMatch(/redefinição de senha/i);
    expect(capturado.text).toContain(
      'https://app.brabo.exemplo/definir-senha?token=tok-reset',
    );
  });

  it('set_initial_password: mesma rota de /definir-senha, assunto próprio', async () => {
    const { sender, ultimoEnvio } = criarSenderComCaptura();

    await enviar(sender, {
      para: 'migrado@exemplo.com',
      tipo: 'set_initial_password',
      token: 'tok-inicial',
      expiraEm: new Date('2026-01-01T12:00:00Z'),
    });

    const capturado = ultimoEnvio();
    expect(capturado.subject).toMatch(/defina sua senha/i);
    expect(capturado.text).toContain(
      'https://app.brabo.exemplo/definir-senha?token=tok-inicial',
    );
  });

  it('register_duplicate: sem token, aponta para /esqueci-senha e não menciona token', async () => {
    const { sender, ultimoEnvio } = criarSenderComCaptura();

    await enviar(sender, {
      para: 'ja-tem-conta@exemplo.com',
      tipo: 'register_duplicate',
    });

    const capturado = ultimoEnvio();
    expect(capturado.subject).toMatch(/tentativa de cadastro/i);
    expect(capturado.text).toContain('https://app.brabo.exemplo/esqueci-senha');
    expect(capturado.text).not.toMatch(/token/i);
  });
});
