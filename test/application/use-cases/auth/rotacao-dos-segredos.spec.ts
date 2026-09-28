import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from 'vitest';
import { createHmac, scryptSync } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { authEvents } from '../../../../src/db/schema';
import { IssuePersonalAccessTokenUseCase } from '../../../../src/application/use-cases/auth/issue-personal-access-token.use-case';
import type { PersonalAccessTokenRepository } from '../../../../src/application/ports/personal-access-token-repository.port';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import { Argon2PasswordHasher } from '../../../../src/infrastructure/security/argon2-password-hasher';
import {
  baldeDeEmail,
  hashDeToken,
} from '../../../../src/infrastructure/security/auth-key-material';
import {
  contaPronta,
  montarHarness,
  EMAIL,
  SENHA_BOA,
  type Harness,
} from './harness';

/**
 * O que o runbook promete sobre trocar os segredos do auth que tocam o BANCO
 * (`docs/runbook.md`, "Auth key rotation", RN-597), contra os repositórios
 * reais. O pepper não tem `_PREVIOUS`: a promessa é de CONSEQUÊNCIA, e é ela
 * que se testa — o que para de valer, o que continua valendo, e que a api
 * não morre por isso.
 *
 * O pepper é lido a cada hash (`pepper()` em `auth-key-material.ts` não
 * memoiza), então trocar a variável no meio do teste é o mesmo que reiniciar
 * a api com o valor novo. Os valores são sem entropia de propósito (Gitleaks).
 */
const PEPPER_A = 'pepper-a-de-teste-nao-e-segredo';
const PEPPER_B = 'pepper-b-de-teste-nao-e-segredo';
const JWT_A = 'jwt-a-de-teste-nao-e-segredo';
const JWT_B = 'jwt-b-de-teste-nao-e-segredo';

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

afterEach(() => {
  delete process.env.AUTH_TOKEN_PEPPER;
  delete process.env.AUTH_JWT_SECRET;
});

afterAll(async () => {
  await h.pool.end();
});

async function eventosDo(kind: string) {
  return h.db.select().from(authEvents).where(eq(authEvents.kind, kind));
}

describe('trocar o AUTH_TOKEN_PEPPER — logout global, sem meio-termo', () => {
  it('todo refresh token em circulação deixa de valer', async () => {
    process.env.AUTH_TOKEN_PEPPER = PEPPER_A;
    await contaPronta(h);
    const sessao = await h.login.execute({ email: EMAIL, senha: SENHA_BOA });

    process.env.AUTH_TOKEN_PEPPER = PEPPER_B;

    await expect(
      h.refresh.execute({ refreshToken: sessao.refreshToken }),
    ).rejects.toThrow(/Refresh inválido ou expirado/);
    // O sintoma no banco é `refresh_unknown` — o token existe, mas o hash
    // calculado com o pepper novo não acha a linha. É o rastro que diferencia
    // "o pepper mudou" de "a família foi revogada por reuso".
    expect(await eventosDo('refresh_unknown')).toHaveLength(1);
    expect(await eventosDo('refresh_reuse_detected')).toHaveLength(0);
  });

  it('o link de redefinição de senha em aberto passa a dizer "expirado"', async () => {
    process.env.AUTH_TOKEN_PEPPER = PEPPER_A;
    await contaPronta(h);
    await h.requestReset.execute({ email: EMAIL });
    const token = h.mail.ultimoDoTipo('password_reset')!.token!;

    process.env.AUTH_TOKEN_PEPPER = PEPPER_B;

    await expect(
      h.resetPassword.execute({
        token,
        novaSenha: 'outra frase bem comprida aqui',
      }),
    ).rejects.toThrow(/Link inválido ou expirado/);
  });

  it('o link de verificação de e-mail em aberto passa a dizer "expirado"', async () => {
    process.env.AUTH_TOKEN_PEPPER = PEPPER_A;
    await h.register.execute({ email: EMAIL, senha: SENHA_BOA });
    const token = h.mail.ultimoDoTipo('email_verification')!.token!;

    process.env.AUTH_TOKEN_PEPPER = PEPPER_B;

    await expect(h.verifyEmail.execute({ token })).rejects.toThrow(
      /Link inválido ou expirado/,
    );
  });

  it('todo token de acesso pessoal (PAT) deixa de autenticar — o runner com `--token` cai junto', async () => {
    // O `PatAuthGuard` procura `hashDeToken(token)` em `personal_access_tokens`
    // (`pat-auth.guard.ts`, `validarEUsar`), então o hash gravado na emissão é
    // o que a troca do pepper deixa inalcançável. Chave de dispositivo NÃO é
    // afetada (Ed25519, não HMAC).
    process.env.AUTH_TOKEN_PEPPER = PEPPER_A;
    const emitir = vi.fn((novo: { tokenHash: string }) =>
      Promise.resolve({
        id: 'pat-1',
        name: 'laptop',
        projectId: 'proj-1',
        createdAt: new Date(),
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        ...novo,
      }),
    );
    const useCase = new IssuePersonalAccessTokenUseCase(
      { emitir } as unknown as PersonalAccessTokenRepository,
      h.tokenFactory,
      {
        findById: () => Promise.resolve({ id: 'proj-1' }),
      } as unknown as ProjectRepository,
    );
    const { token } = await useCase.execute({
      userId: 'user-1',
      projectId: 'proj-1',
      name: 'laptop',
    });
    const gravado = emitir.mock.calls[0][0].tokenHash;
    expect(hashDeToken(token)).toBe(gravado);

    process.env.AUTH_TOKEN_PEPPER = PEPPER_B;

    expect(hashDeToken(token)).not.toBe(gravado);
  });

  it('o contador de lockout recomeça do zero — a conta travada destrava', async () => {
    // Consequência que o runbook não pedia, mas que decorre do mesmo HMAC:
    // o balde é `baldeDeEmail`, com o pepper.
    process.env.AUTH_TOKEN_PEPPER = PEPPER_A;
    await contaPronta(h);
    for (let i = 0; i < 6; i++) {
      await h.login.execute({ email: EMAIL, senha: 'errada' }).catch(() => {});
    }
    await expect(
      h.login.execute({ email: EMAIL, senha: SENHA_BOA }),
    ).rejects.toThrow();

    const baldeAntigo = baldeDeEmail(EMAIL);

    process.env.AUTH_TOKEN_PEPPER = PEPPER_B;

    expect(baldeDeEmail(EMAIL)).not.toBe(baldeAntigo);
    await expect(
      h.login.execute({ email: EMAIL, senha: SENHA_BOA }),
    ).resolves.toBeTruthy();
  });

  it('caminho feliz: a senha NÃO depende do pepper — quem foi deslogado entra de novo', async () => {
    // argon2id com salt por registro, sem pepper: trocar o pepper custa um
    // login, nunca uma conta.
    process.env.AUTH_TOKEN_PEPPER = PEPPER_A;
    await contaPronta(h);

    process.env.AUTH_TOKEN_PEPPER = PEPPER_B;

    const sessao = await h.login.execute({ email: EMAIL, senha: SENHA_BOA });
    await expect(
      h.refresh.execute({ refreshToken: sessao.refreshToken }),
    ).resolves.toBeTruthy();
  });

  it('a api NÃO falha ao subir com o pepper novo', async () => {
    // "The api does not fail to boot with a new pepper" — o único passo de
    // boot que deriva material do auth é o dummy do argon2 (que usa a
    // passphrase do JWT, não o pepper). Subir com pepper novo em produção
    // é, por construção, silencioso.
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.AUTH_JWT_SECRET = JWT_A;
    process.env.AUTH_TOKEN_PEPPER = PEPPER_B;
    try {
      await expect(new Argon2PasswordHasher().onModuleInit()).resolves.toBe(
        undefined,
      );
      expect(() => hashDeToken('qualquer')).not.toThrow();
    } finally {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
    }
  }, 30_000);
});

describe('trocar o AUTH_JWT_SECRET — "nobody gets logged out"', () => {
  it('caminho feliz: com AUTH_TOKEN_PEPPER DEFINIDO, o refresh token sobrevive à troca', async () => {
    process.env.AUTH_TOKEN_PEPPER = PEPPER_A;
    process.env.AUTH_JWT_SECRET = JWT_A;
    await contaPronta(h);
    const sessao = await h.login.execute({ email: EMAIL, senha: SENHA_BOA });

    process.env.AUTH_JWT_SECRET = JWT_B;

    await expect(
      h.refresh.execute({ refreshToken: sessao.refreshToken }),
    ).resolves.toBeTruthy();
  });

  it('SEM AUTH_TOKEN_PEPPER fora de produção, o pepper NÃO é mais o AUTH_JWT_SECRET: trocar a chave não desloga (RN-613)', async () => {
    // Até a RN-613 este teste fixava o defeito: sem pepper, ele caía no
    // `AUTH_JWT_SECRET` e trocar a chave rejeitava o refresh. Agora o default
    // é do PEPPER, e o JWT rotaciona sozinho.
    delete process.env.AUTH_TOKEN_PEPPER;
    process.env.AUTH_JWT_SECRET = JWT_A;
    await contaPronta(h);
    const sessao = await h.login.execute({ email: EMAIL, senha: SENHA_BOA });

    process.env.AUTH_JWT_SECRET = JWT_B;

    await expect(
      h.refresh.execute({ refreshToken: sessao.refreshToken }),
    ).resolves.toBeTruthy();
  });
});

describe('a migração do RN-613: pepper = valor ATUAL do AUTH_JWT_SECRET', () => {
  /**
   * O hash que o código ANTIGO gravava numa instalação sem pepper —
   * `scrypt(AUTH_JWT_SECRET, 'brabo-auth-token-pepper')` como chave do HMAC —,
   * escrito aqui por extenso e não chamando `hashDeToken`: é a fórmula que o
   * fallback removido usava, fixada, para que a prova não dependa do código
   * que ela prova.
   */
  function hashDoCodigoAntigo(token: string, jwtSecret: string): string {
    const chave = scryptSync(jwtSecret, 'brabo-auth-token-pepper', 32);
    return createHmac('sha256', chave).update(token).digest('hex');
  }

  it('caminho feliz: um refresh emitido ANTES (pepper caindo no JWT) segue válido com o pepper igual ao JWT antigo — e o JWT rotaciona sozinho', async () => {
    process.env.AUTH_TOKEN_PEPPER = JWT_A;
    process.env.AUTH_JWT_SECRET = JWT_A;
    await contaPronta(h);
    const sessao = await h.login.execute({ email: EMAIL, senha: SENHA_BOA });

    // A linha no banco é BYTE A BYTE a que o código antigo teria gravado com
    // AUTH_JWT_SECRET=JWT_A e sem pepper — ou seja, este refresh É um refresh
    // de antes da migração.
    const linhas = await h.db.execute<{ token_hash: string }>(
      sql`SELECT token_hash FROM refresh_tokens`,
    );
    expect(linhas.rows.map((l) => l.token_hash)).toContain(
      hashDoCodigoAntigo(sessao.refreshToken, JWT_A),
    );

    // Passo 2 do runbook: com o pepper separado, o JWT troca e ninguém sai.
    process.env.AUTH_JWT_SECRET = JWT_B;
    await expect(
      h.refresh.execute({ refreshToken: sessao.refreshToken }),
    ).resolves.toBeTruthy();
  });

  it('a ordem errada: gerar um pepper NOVO em vez de copiar o JWT desloga quem tinha sessão', async () => {
    // O que o runbook manda NÃO fazer, fixado: o refresh de antes (hash com
    // o JWT_A) não é achado com um pepper qualquer.
    process.env.AUTH_TOKEN_PEPPER = JWT_A;
    process.env.AUTH_JWT_SECRET = JWT_A;
    await contaPronta(h);
    const sessao = await h.login.execute({ email: EMAIL, senha: SENHA_BOA });

    process.env.AUTH_TOKEN_PEPPER = PEPPER_B;

    await expect(
      h.refresh.execute({ refreshToken: sessao.refreshToken }),
    ).rejects.toThrow(/Refresh inválido ou expirado/);
  });
});
