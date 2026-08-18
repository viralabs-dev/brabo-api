import { describe, it, expect, afterEach } from 'vitest';
import {
  resolverConfigSmtp,
  resolverModoDeTransporte,
} from '../../../src/infrastructure/mail/smtp-config';

/**
 * Validação de boot do SMTP real (backlog "SMTP real no MailSender" — ver
 * ADR 0096), no MESMO padrão dos testes de `auth-key-material.spec.ts`/
 * `service-token.spec.ts` (RN-114) — com uma diferença: aqui não existe
 * default público de desenvolvimento (não há segredo nenhum para "cair" fora
 * de produção), então a régua só é aplicada quando `NODE_ENV=production`. O
 * caso que interessa não é o feliz: é subir produção com `MAIL_TRANSPORT=smtp`
 * e esquecer de configurar.
 */

const ENV_ORIGINAIS = { ...process.env };

function limparVariaveis() {
  delete process.env.MAIL_TRANSPORT;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_SECURE;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;
  delete process.env.SMTP_FROM;
}

afterEach(() => {
  process.env = { ...ENV_ORIGINAIS };
});

describe('resolverModoDeTransporte', () => {
  afterEach(limparVariaveis);

  it('default é log, mesmo em produção', () => {
    process.env.NODE_ENV = 'production';
    limparVariaveis();
    expect(resolverModoDeTransporte()).toBe('log');
  });

  it('MAIL_TRANSPORT=smtp liga o modo smtp', () => {
    process.env.MAIL_TRANSPORT = 'smtp';
    expect(resolverModoDeTransporte()).toBe('smtp');
  });

  it('qualquer outro valor cai em log', () => {
    process.env.MAIL_TRANSPORT = 'sendgrid';
    expect(resolverModoDeTransporte()).toBe('log');
  });
});

describe('resolverConfigSmtp', () => {
  afterEach(limparVariaveis);

  it('caminho feliz: em produção, devolve a config configurada', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMTP_HOST = 'smtp.provedor-de-teste.com';
    process.env.SMTP_PORT = '2525';
    process.env.SMTP_SECURE = 'true';
    process.env.SMTP_USER = 'usuario-de-teste';
    process.env.SMTP_PASSWORD = 'senha-de-teste-nao-e-segredo';
    process.env.SMTP_FROM = 'Brabo <nao-responda@brabo.exemplo>';

    const config = resolverConfigSmtp();
    expect(config).toEqual({
      host: 'smtp.provedor-de-teste.com',
      port: 2525,
      secure: true,
      user: 'usuario-de-teste',
      password: 'senha-de-teste-nao-e-segredo',
      from: 'Brabo <nao-responda@brabo.exemplo>',
    });
  });

  it('em produção, sem SMTP_HOST, derruba o boot', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMTP_USER = 'u';
    process.env.SMTP_PASSWORD = 'p';
    process.env.SMTP_FROM = 'a@b.com';
    expect(() => resolverConfigSmtp()).toThrow(/SMTP_HOST.*obrigatória/i);
  });

  it('em produção, SMTP_HOST com o valor de exemplo do repositório derruba o boot', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMTP_HOST = 'smtp.exemplo.com';
    process.env.SMTP_USER = 'u';
    process.env.SMTP_PASSWORD = 'p';
    process.env.SMTP_FROM = 'a@b.com';
    expect(() => resolverConfigSmtp()).toThrow(/valor de exemplo/i);
  });

  it('em produção, sem SMTP_USER, derruba o boot', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMTP_HOST = 'smtp.real.com';
    process.env.SMTP_PASSWORD = 'p';
    process.env.SMTP_FROM = 'a@b.com';
    expect(() => resolverConfigSmtp()).toThrow(/SMTP_USER.*obrigatória/i);
  });

  it('em produção, sem SMTP_PASSWORD, derruba o boot', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMTP_HOST = 'smtp.real.com';
    process.env.SMTP_USER = 'u';
    process.env.SMTP_FROM = 'a@b.com';
    expect(() => resolverConfigSmtp()).toThrow(/SMTP_PASSWORD.*obrigatória/i);
  });

  it('em produção, sem SMTP_FROM, derruba o boot', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMTP_HOST = 'smtp.real.com';
    process.env.SMTP_USER = 'u';
    process.env.SMTP_PASSWORD = 'p';
    expect(() => resolverConfigSmtp()).toThrow(/SMTP_FROM.*obrigatória/i);
  });

  it('em produção, SMTP_FROM em formato inválido derruba o boot', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMTP_HOST = 'smtp.real.com';
    process.env.SMTP_USER = 'u';
    process.env.SMTP_PASSWORD = 'p';
    process.env.SMTP_FROM = 'não é um remetente válido';
    expect(() => resolverConfigSmtp()).toThrow(/SMTP_FROM inválido/i);
  });

  it('em produção, SMTP_FROM só com o e-mail (sem nome) é aceito', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMTP_HOST = 'smtp.real.com';
    process.env.SMTP_USER = 'u';
    process.env.SMTP_PASSWORD = 'p';
    process.env.SMTP_FROM = 'nao-responda@brabo.exemplo';
    expect(() => resolverConfigSmtp()).not.toThrow();
  });

  it('em produção, SMTP_PORT inválida derruba o boot', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMTP_HOST = 'smtp.real.com';
    process.env.SMTP_USER = 'u';
    process.env.SMTP_PASSWORD = 'p';
    process.env.SMTP_FROM = 'a@b.com';
    process.env.SMTP_PORT = 'não-é-numero';
    expect(() => resolverConfigSmtp()).toThrow(/SMTP_PORT inválida/i);
  });

  it('em produção, espaço em volta não conta como SMTP_HOST', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMTP_HOST = '   ';
    process.env.SMTP_USER = 'u';
    process.env.SMTP_PASSWORD = 'p';
    process.env.SMTP_FROM = 'a@b.com';
    expect(() => resolverConfigSmtp()).toThrow(/SMTP_HOST.*obrigatória/i);
  });

  it('fora de produção, sem NENHUMA variável, não derruba o boot', () => {
    process.env.NODE_ENV = 'development';
    expect(() => resolverConfigSmtp()).not.toThrow();
  });

  it('fora de produção, SMTP_PORT ausente cai no default 587', () => {
    process.env.NODE_ENV = 'development';
    const config = resolverConfigSmtp();
    expect(config.port).toBe(587);
    expect(config.secure).toBe(false);
  });
});
