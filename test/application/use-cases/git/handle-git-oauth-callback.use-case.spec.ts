import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projectGitConnections,
  projects,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleGitConnectionRepository } from '../../../../src/infrastructure/persistence/drizzle/git-connection.repository';
import { DrizzleOutboxRepository } from '../../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { EnvelopeEncryptionService } from '../../../../src/infrastructure/security/envelope-encryption.service';
import { HandleGitOauthCallbackUseCase } from '../../../../src/application/use-cases/git/handle-git-oauth-callback.use-case';
import { signOauthState } from '../../../../src/domain/git/oauth-state';
import { InvalidOauthStateError } from '../../../../src/domain/git/git-provider-errors';
import type {
  GitOauthClient,
  GitOauthClientRegistry,
  OauthTokenResult,
} from '../../../../src/application/ports/git-oauth-client.port';

const { db, pool } = createTestDb();

const unitOfWork = new DrizzleUnitOfWork(db);
const connectionRepo = new DrizzleGitConnectionRepository(db);
const outboxRepo = new DrizzleOutboxRepository(db);
const encryption = new EnvelopeEncryptionService();

const SECRET = 'test-oauth-secret';

class FakeGithubOauthClient implements GitOauthClient {
  provider = 'github' as const;
  buildAuthorizeUrl = () => 'https://github.com/login/oauth/authorize?fake';

  async exchangeCode(code: string): Promise<OauthTokenResult> {
    await Promise.resolve();
    if (code === 'invalid-code') {
      throw new Error('código rejeitado pelo provider (simulado)');
    }
    return {
      accessToken: 'gh-access-token',
      refreshToken: null,
      expiresAt: null,
      accountLogin: 'octocat',
      accountMetadata: {},
    };
  }
}

function registryWith(client: GitOauthClient): GitOauthClientRegistry {
  return { get: () => client };
}

async function setupProject() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-oauth', email: 'oauth@brabo.dev' })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: user.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'core',
      slug: 'core',
      createdBy: user.id,
    })
    .returning();
  return { user, project };
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('HandleGitOauthCallbackUseCase', () => {
  it('caminho feliz: persiste a conexão cifrada e grava outbox', async () => {
    const { user, project } = await setupProject();
    const handleCallback = new HandleGitOauthCallbackUseCase(
      unitOfWork,
      registryWith(new FakeGithubOauthClient()),
      connectionRepo,
      encryption,
      outboxRepo,
    );

    const state = signOauthState(
      { projectId: project.id, userId: user.id, provider: 'github' },
      SECRET,
    );
    process.env.GIT_OAUTH_STATE_SECRET = SECRET;

    const result = await handleCallback.execute(
      'github',
      'valid-code',
      state,
      'http://localhost:3000/git/oauth/github/callback',
    );

    expect(result.projectId).toBe(project.id);

    const [row] = await db
      .select()
      .from(projectGitConnections)
      .where(eq(projectGitConnections.projectId, project.id));
    expect(row.accountLogin).toBe('octocat');
    expect(row.encryptedApiKey).not.toContain('gh-access-token');
  });

  it('rejeita state inválido/expirado sem persistir nada', async () => {
    const { project } = await setupProject();
    const handleCallback = new HandleGitOauthCallbackUseCase(
      unitOfWork,
      registryWith(new FakeGithubOauthClient()),
      connectionRepo,
      encryption,
      outboxRepo,
    );
    process.env.GIT_OAUTH_STATE_SECRET = SECRET;

    await expect(
      handleCallback.execute(
        'github',
        'valid-code',
        'state-invalido',
        'http://localhost:3000/git/oauth/github/callback',
      ),
    ).rejects.toThrow(InvalidOauthStateError);

    const rows = await db
      .select()
      .from(projectGitConnections)
      .where(eq(projectGitConnections.projectId, project.id));
    expect(rows).toHaveLength(0);
  });

  it('propaga erro do provider quando o code é rejeitado', async () => {
    const { user, project } = await setupProject();
    const handleCallback = new HandleGitOauthCallbackUseCase(
      unitOfWork,
      registryWith(new FakeGithubOauthClient()),
      connectionRepo,
      encryption,
      outboxRepo,
    );
    process.env.GIT_OAUTH_STATE_SECRET = SECRET;

    const state = signOauthState(
      { projectId: project.id, userId: user.id, provider: 'github' },
      SECRET,
    );

    await expect(
      handleCallback.execute(
        'github',
        'invalid-code',
        state,
        'http://localhost:3000/git/oauth/github/callback',
      ),
    ).rejects.toThrow();

    const rows = await db
      .select()
      .from(projectGitConnections)
      .where(eq(projectGitConnections.projectId, project.id));
    expect(rows).toHaveLength(0);
  });
});
