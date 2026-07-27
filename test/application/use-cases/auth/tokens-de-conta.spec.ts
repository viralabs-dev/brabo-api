import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { accountTokens, refreshTokens } from '../../../../src/db/schema';
import {
  contaPronta,
  montarHarness,
  EMAIL,
  SENHA_BOA,
  type Harness,
} from './harness';

const SENHA_NOVA = 'outra frase bem comprida aqui';

let h: Harness;

beforeAll(async () => {
  h = await montarHarness();
}, 60_000);

beforeEach(async () => {
  await h.limpar();
  await h.db.execute(sql`TRUNCATE TABLE auth_lockout_hits RESTART IDENTITY`);
  h.mail.limpar();
  h.hasher.limpar();
});

afterAll(async () => {
  await h.pool.end();
});

async function pedirReset(email = EMAIL): Promise<string> {
  await h.requestReset.execute({ email });
  return h.mail.ultimoDoTipo('password_reset')!.token!;
}

/** Empurra o token para o passado, sem esperar uma hora. */
async function expirar(tokenHash: string) {
  await h.db
    .update(accountTokens)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(accountTokens.tokenHash, tokenHash));
}

describe('verificação de e-mail', () => {
  it('caminho feliz: verifica e libera o login', async () => {
    await h.register.execute({ email: EMAIL, senha: SENHA_BOA });
    const token = h.mail.ultimoDoTipo('email_verification')!.token!;

    await h.verifyEmail.execute({ token });

    await expect(
      h.login.execute({ email: EMAIL, senha: SENHA_BOA }),
    ).resolves.toBeTruthy();
  });

  it('o mesmo token não serve duas vezes', async () => {
    await h.register.execute({ email: EMAIL, senha: SENHA_BOA });
    const token = h.mail.ultimoDoTipo('email_verification')!.token!;

    await h.verifyEmail.execute({ token });
    await expect(h.verifyEmail.execute({ token })).rejects.toThrow();
  });

  it('token expirado é recusado', async () => {
    await h.register.execute({ email: EMAIL, senha: SENHA_BOA });
    const token = h.mail.ultimoDoTipo('email_verification')!.token!;
    await expirar(h.tokenFactory.hashDe(token));

    await expect(h.verifyEmail.execute({ token })).rejects.toThrow();
  });

  it('token inventado é recusado', async () => {
    await expect(
      h.verifyEmail.execute({ token: 'inventado' }),
    ).rejects.toThrow();
  });

  it('token de verificação não vale como token de reset', async () => {
    await h.register.execute({ email: EMAIL, senha: SENHA_BOA });
    const token = h.mail.ultimoDoTipo('email_verification')!.token!;

    await expect(
      h.resetPassword.execute({ token, novaSenha: SENHA_NOVA }),
    ).rejects.toThrow();
  });
});

describe('reset de senha', () => {
  it('caminho feliz: troca a senha e a antiga para de funcionar', async () => {
    await contaPronta(h);
    const token = await pedirReset();

    await h.resetPassword.execute({ token, novaSenha: SENHA_NOVA });

    await expect(
      h.login.execute({ email: EMAIL, senha: SENHA_NOVA }),
    ).resolves.toBeTruthy();
    await expect(
      h.login.execute({ email: EMAIL, senha: SENHA_BOA }),
    ).rejects.toThrow();
  });

  it('token de reset REUSADO é recusado', async () => {
    await contaPronta(h);
    const token = await pedirReset();
    await h.resetPassword.execute({ token, novaSenha: SENHA_NOVA });

    // Se passasse, quem roubou o link trocaria a senha DEPOIS da vítima — é
    // exatamente a janela que um ladrão de token quer.
    await expect(
      h.resetPassword.execute({
        token,
        novaSenha: 'terceira senha bem comprida',
      }),
    ).rejects.toThrow();
  });

  it('token de reset EXPIRADO é recusado', async () => {
    await contaPronta(h);
    const token = await pedirReset();
    await expirar(h.tokenFactory.hashDe(token));

    await expect(
      h.resetPassword.execute({ token, novaSenha: SENHA_NOVA }),
    ).rejects.toThrow();
    await expect(
      h.login.execute({ email: EMAIL, senha: SENHA_BOA }),
    ).resolves.toBeTruthy();
  });

  it('pedir de novo invalida o link anterior', async () => {
    // Sem o supersede, cinco cliques em "esqueci minha senha" deixariam cinco
    // links de takeover válidos em cinco e-mails.
    await contaPronta(h);
    const primeiro = await pedirReset();
    const segundo = await pedirReset();

    await expect(
      h.resetPassword.execute({ token: primeiro, novaSenha: SENHA_NOVA }),
    ).rejects.toThrow();
    await expect(
      h.resetPassword.execute({ token: segundo, novaSenha: SENHA_NOVA }),
    ).resolves.toBeUndefined();
  });

  it('revoga TODAS as sessões do usuário', async () => {
    // O inverso da cascata por reuso: lá a evidência aponta para uma família;
    // aqui o usuário disse "acho que entraram na minha conta", e deixar outros
    // dispositivos logados anularia a operação.
    await contaPronta(h);
    const noCelular = await h.login.execute({ email: EMAIL, senha: SENHA_BOA });
    const noLaptop = await h.login.execute({ email: EMAIL, senha: SENHA_BOA });

    const token = await pedirReset();
    await h.resetPassword.execute({ token, novaSenha: SENHA_NOVA });

    await expect(
      h.refresh.execute({ refreshToken: noCelular.refreshToken }),
    ).rejects.toThrow();
    await expect(
      h.refresh.execute({ refreshToken: noLaptop.refreshToken }),
    ).rejects.toThrow();

    const linhas = await h.db.select().from(refreshTokens);
    expect(linhas.every((l) => l.revokedReason === 'password_reset')).toBe(
      true,
    );
  });

  it('não emite sessão — quem reseta é mandado para o login', async () => {
    // Logar direto a partir de um link que chegou por e-mail faria comprometer
    // o e-mail equivaler a tomar a conta, sem segundo passo.
    await contaPronta(h);
    const token = await pedirReset();

    const resultado = await h.resetPassword.execute({
      token,
      novaSenha: SENHA_NOVA,
    });

    expect(resultado).toBeUndefined();
  });

  it('recusa senha nova fora da política', async () => {
    await contaPronta(h);
    const token = await pedirReset();

    await expect(
      h.resetPassword.execute({ token, novaSenha: 'curta' }),
    ).rejects.toThrow();
  });

  it('destrava a conta bloqueada pelas tentativas do atacante', async () => {
    // Quem acabou de provar posse do e-mail não deve esbarrar num lockout que
    // o atacante acumulou.
    await contaPronta(h);
    for (let i = 0; i < 6; i++) {
      await h.login
        .execute({ email: EMAIL, senha: 'errada mas comprida' })
        .catch(() => {});
    }

    const token = await pedirReset();
    await h.resetPassword.execute({ token, novaSenha: SENHA_NOVA });

    await expect(
      h.login.execute({ email: EMAIL, senha: SENHA_NOVA }),
    ).resolves.toBeTruthy();
  });

  it('o token do reset nunca é guardado em claro', async () => {
    await contaPronta(h);
    const token = await pedirReset();

    const linhas = await h.db.select().from(accountTokens);
    expect(linhas.some((l) => l.tokenHash === token)).toBe(false);
    expect(
      linhas.some((l) => l.tokenHash === h.tokenFactory.hashDe(token)),
    ).toBe(true);
  });
});
