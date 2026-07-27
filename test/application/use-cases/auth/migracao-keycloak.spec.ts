import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { HttpException } from '@nestjs/common';
import { accountTokens, users } from '../../../../src/db/schema';
import { parametrosDoHash } from '../../../../src/infrastructure/security/argon2-password-hasher';
import {
  contaPronta,
  montarHarness,
  EMAIL,
  SENHA_BOA,
  type Harness,
} from './harness';

/**
 * O usuário importado do Keycloak (Fase 7a, item 4).
 *
 * "Pendente" é estado DERIVADO: uma linha em `users` com `keycloak_sub` e sem
 * linha em `auth_credentials`. Não há coluna `password_pending` para
 * dessincronizar, e é isso que torna a migração idempotente por construção.
 *
 * O ponto sensível destes testes é que o pendente **não pode ser
 * distinguível** do e-mail inexistente pela resposta nem pelo tempo — a
 * RN-032 vale para ele igual. O que ele ganha é o e-mail, não uma resposta
 * diferente.
 */
const SENHA_NOVA = 'a senha nova bem comprida';

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

/** Um usuário como a Fase 1 o deixou: veio do Keycloak, nunca teve senha aqui. */
async function usuarioMigrado(email = 'legado@brabo.dev') {
  const [linha] = await h.db
    .insert(users)
    .values({ email, keycloakSub: `sub-${email}`, name: 'Conta Legada' })
    .returning();
  return linha;
}

async function capturar(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (erro) {
    return erro as HttpException;
  }
}

describe('login de usuário migrado', () => {
  it('responde EXATAMENTE como um e-mail inexistente', async () => {
    // A trava principal. Um 409 `password_pending` aqui — que é o que a UX
    // pediria — confirmaria que o endereço existe E que é conta legada.
    await usuarioMigrado();

    const pendente = await capturar(() =>
      h.login.execute({ email: 'legado@brabo.dev', senha: SENHA_BOA }),
    );
    const inexistente = await capturar(() =>
      h.login.execute({ email: 'ninguem@brabo.dev', senha: SENHA_BOA }),
    );

    expect(pendente!.getStatus()).toBe(inexistente!.getStatus());
    expect(pendente!.getResponse()).toEqual(inexistente!.getResponse());
  });

  it('gasta o mesmo argon2 do ramo sem conta', async () => {
    await usuarioMigrado();

    h.hasher.limpar();
    await capturar(() =>
      h.login.execute({ email: 'legado@brabo.dev', senha: SENHA_BOA }),
    );
    const doPendente = [...h.hasher.verifies];

    h.hasher.limpar();
    await capturar(() =>
      h.login.execute({ email: 'ninguem@brabo.dev', senha: SENHA_BOA }),
    );

    expect(doPendente).toHaveLength(1);
    expect(h.hasher.verifies).toHaveLength(1);
    expect(parametrosDoHash(doPendente[0])).toEqual(
      parametrosDoHash(h.hasher.verifies[0]),
    );
  });

  it('dispara o e-mail de definir senha, em silêncio', async () => {
    const usuario = await usuarioMigrado();

    await capturar(() =>
      h.login.execute({ email: 'legado@brabo.dev', senha: SENHA_BOA }),
    );

    const email = h.mail.ultimoDoTipo('set_initial_password');
    expect(email?.para).toBe('legado@brabo.dev');
    expect(email?.token).toBeTruthy();

    const [token] = await h.db
      .select()
      .from(accountTokens)
      .where(eq(accountTokens.userId, usuario.id));
    expect(token.purpose).toBe('set_initial_password');
  });

  it('tentar logar de novo NÃO reemite o link', async () => {
    // Sem esta trava, cada tentativa invalidaria o link anterior (o `emitir`
    // faz supersede) e o e-mail já entregue morreria na mão do usuário. E o
    // login viraria mail bomb.
    await usuarioMigrado();

    await capturar(() =>
      h.login.execute({ email: 'legado@brabo.dev', senha: SENHA_BOA }),
    );
    const primeiro = h.mail.ultimoDoTipo('set_initial_password')!.token;
    h.mail.limpar();

    await capturar(() =>
      h.login.execute({ email: 'legado@brabo.dev', senha: SENHA_BOA }),
    );

    expect(h.mail.ultimoDoTipo('set_initial_password')).toBeUndefined();

    // E o link da primeira tentativa continua válido.
    await expect(
      h.resetPassword.execute({ token: primeiro!, novaSenha: SENHA_NOVA }),
    ).resolves.toBeUndefined();
  });

  it('e-mail inexistente não gera token nenhum', async () => {
    await capturar(() =>
      h.login.execute({ email: 'ninguem@brabo.dev', senha: SENHA_BOA }),
    );

    expect(await h.db.select().from(accountTokens)).toHaveLength(0);
    expect(h.mail.enviados).toHaveLength(0);
  });
});

describe('o ciclo completo da migração', () => {
  it('migrado define senha e loga', async () => {
    // É o critério de aceite, ponta a ponta.
    const usuario = await usuarioMigrado();

    await capturar(() =>
      h.login.execute({ email: 'legado@brabo.dev', senha: SENHA_BOA }),
    );
    const token = h.mail.ultimoDoTipo('set_initial_password')!.token!;

    await h.resetPassword.execute({ token, novaSenha: SENHA_NOVA });

    const sessao = await h.login.execute({
      email: 'legado@brabo.dev',
      senha: SENHA_NOVA,
    });
    expect(sessao.accessToken).toBeTruthy();

    // O id é o MESMO: é ele que aparece em workspace_members/project_members,
    // então o RBAC da conta atravessa a migração intacto.
    const [linha] = await h.db
      .select()
      .from(users)
      .where(eq(users.id, usuario.id));
    expect(linha.id).toBe(usuario.id);
    expect(await h.db.select().from(users)).toHaveLength(1);
  });

  it('depois de definir senha, deixa de ser pendente', async () => {
    await usuarioMigrado();
    await capturar(() =>
      h.login.execute({ email: 'legado@brabo.dev', senha: SENHA_BOA }),
    );
    const token = h.mail.ultimoDoTipo('set_initial_password')!.token!;
    await h.resetPassword.execute({ token, novaSenha: SENHA_NOVA });

    expect(await h.credenciais.listarPendentesDeSenha()).toHaveLength(0);
  });

  it('"esqueci minha senha" também serve ao migrado', async () => {
    // O caminho que o usuário encontra sozinho, sem depender do automatismo.
    await usuarioMigrado();

    await h.requestReset.execute({ email: 'legado@brabo.dev' });
    const token = h.mail.ultimoDoTipo('set_initial_password')!.token!;

    await expect(
      h.resetPassword.execute({ token, novaSenha: SENHA_NOVA }),
    ).resolves.toBeUndefined();
  });
});

describe('listarPendentesDeSenha', () => {
  it('lista só quem veio do Keycloak e não tem senha', async () => {
    await usuarioMigrado('um@brabo.dev');
    await usuarioMigrado('dois@brabo.dev');
    // Conta first-party: nasceu com credencial, não é migração.
    await contaPronta(h, EMAIL);
    // Conta sem keycloak_sub e sem credencial não existe na prática (o
    // registro cria as duas na mesma transação), mas se existisse não seria
    // migração — seria registro abandonado.
    await h.db.insert(users).values({ email: 'orfa@brabo.dev' });

    const pendentes = await h.credenciais.listarPendentesDeSenha();

    expect(pendentes.map((p) => p.email).sort()).toEqual([
      'dois@brabo.dev',
      'um@brabo.dev',
    ]);
  });

  it('é idempotente: quem já definiu senha some da lista', async () => {
    await usuarioMigrado('um@brabo.dev');
    await capturar(() =>
      h.login.execute({ email: 'um@brabo.dev', senha: SENHA_BOA }),
    );
    const token = h.mail.ultimoDoTipo('set_initial_password')!.token!;
    await h.resetPassword.execute({ token, novaSenha: SENHA_NOVA });

    expect(await h.credenciais.listarPendentesDeSenha()).toEqual([]);
  });
});
