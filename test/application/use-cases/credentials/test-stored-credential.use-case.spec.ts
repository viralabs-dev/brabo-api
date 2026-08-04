import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { users } from '../../../../src/db/schema';
import { DrizzleUserCredentialRepository } from '../../../../src/infrastructure/persistence/drizzle/user-credential.repository';
import { EnvelopeEncryptionService } from '../../../../src/infrastructure/security/envelope-encryption.service';
import { LLMCredentialConnectionTester } from '../../../../src/application/ports/llm-credential-connection-tester.port';
import { GitCredentialConnectionTester } from '../../../../src/application/ports/git-credential-connection-tester.port';
import { LLMCredentialConnectionTestFailedError } from '../../../../src/domain/llm/llm-credential-errors';
import { GitCredentialConnectionTestFailedError } from '../../../../src/domain/git/git-errors';
import { UpsertUserCredentialUseCase } from '../../../../src/application/use-cases/llm/upsert-user-credential.use-case';
import { RegisterGitCredentialUseCase } from '../../../../src/application/use-cases/git/register-git-credential.use-case';
import { TestStoredCredentialUseCase } from '../../../../src/application/use-cases/credentials/test-stored-credential.use-case';

const { db, pool } = createTestDb();
const credentialRepo = new DrizzleUserCredentialRepository(db);
const encryption = new EnvelopeEncryptionService();
const upsert = new UpsertUserCredentialUseCase(credentialRepo, encryption);
const registrarGit = new RegisterGitCredentialUseCase(
  credentialRepo,
  encryption,
);

const CHAVE = 'sk-uma-chave-que-so-existe-neste-teste';

/**
 * Guarda o texto plano que recebeu — é assim que o teste prova que o caso de
 * uso decifra o que está NO BANCO em vez de confiar em algo que o chamador
 * passou.
 */
class LlmTesterFalso implements LLMCredentialConnectionTester {
  recebeu: string | null = null;

  constructor(
    private readonly suportado: boolean,
    private readonly recusa = false,
  ) {}

  supports(): boolean {
    return this.suportado;
  }

  test(_provider: never, apiKey: string): Promise<void> {
    this.recebeu = apiKey;
    return this.recusa
      ? Promise.reject(
          new LLMCredentialConnectionTestFailedError(
            'openrouter',
            'openrouter respondeu 401',
          ),
        )
      : Promise.resolve();
  }
}

class GitTesterFalso implements GitCredentialConnectionTester {
  constructor(private readonly recusa = false) {}

  test(): Promise<void> {
    return this.recusa
      ? Promise.reject(
          new GitCredentialConnectionTestFailedError(
            'github',
            'Bad credentials',
          ),
        )
      : Promise.resolve();
  }
}

function casoDeUso(
  llm: LLMCredentialConnectionTester,
  git: GitCredentialConnectionTester = new GitTesterFalso(),
) {
  return new TestStoredCredentialUseCase(credentialRepo, encryption, llm, git);
}

async function setupUser() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-test-cred', email: 'test-cred@brabo.dev' })
    .returning();
  return user;
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('TestStoredCredentialUseCase (ADR 0050)', () => {
  it('provider aceita: devolve ok, e o que foi testado é a chave DECIFRADA do banco', async () => {
    const user = await setupUser();
    await upsert.execute(user.id, 'openrouter', CHAVE);

    const tester = new LlmTesterFalso(true);
    expect(await casoDeUso(tester).execute(user.id, 'openrouter')).toEqual({
      resultado: 'ok',
    });
    expect(tester.recebeu).toBe(CHAVE);
  });

  it('provider recusa: é RESULTADO, não exceção — e carrega o motivo dele', async () => {
    const user = await setupUser();
    await upsert.execute(user.id, 'openrouter', CHAVE);

    const resultado = await casoDeUso(new LlmTesterFalso(true, true)).execute(
      user.id,
      'openrouter',
    );

    expect(resultado.resultado).toBe('recusado');
    expect(
      resultado.resultado === 'recusado' ? resultado.motivo : '',
    ).toContain('401');
  });

  /**
   * O caso que obrigou o terceiro estado a existir. `anthropic` não tem
   * endpoint de teste verificado, então o tester é NO-OP — e num resultado
   * binário isso voltaria como `ok`, afirmando que uma chave foi verificada
   * quando ninguém a verificou.
   */
  it('provider sem teste declarado: nao_suportado, nunca um "ok" de mentira', async () => {
    const user = await setupUser();
    await upsert.execute(user.id, 'anthropic', CHAVE);

    const tester = new LlmTesterFalso(false);
    expect(await casoDeUso(tester).execute(user.id, 'anthropic')).toEqual({
      resultado: 'nao_suportado',
    });
    // Não suportado quer dizer que nem chegou a chamar o provider.
    expect(tester.recebeu).toBeNull();
  });

  it('token de git usa o tester de git, não o de LLM', async () => {
    const user = await setupUser();
    await registrarGit.execute(user.id, 'github', 'ghp_token');

    const llm = new LlmTesterFalso(true);
    const resultado = await casoDeUso(llm, new GitTesterFalso(true)).execute(
      user.id,
      'github',
    );

    expect(resultado.resultado).toBe('recusado');
    expect(llm.recebeu).toBeNull();
  });

  it('sem credencial cadastrada: 404 — não há o que testar', async () => {
    const user = await setupUser();

    await expect(
      casoDeUso(new LlmTesterFalso(true)).execute(user.id, 'openrouter'),
    ).rejects.toThrow(NotFoundException);
  });

  it('o segredo NUNCA aparece no resultado, nem no motivo da recusa', async () => {
    const user = await setupUser();
    await upsert.execute(user.id, 'openrouter', CHAVE);

    const resultado = await casoDeUso(new LlmTesterFalso(true, true)).execute(
      user.id,
      'openrouter',
    );

    expect(JSON.stringify(resultado)).not.toContain(CHAVE);
  });
});
