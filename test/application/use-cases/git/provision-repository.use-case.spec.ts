import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  outboxEvents,
  projects,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleGitConnectionRepository } from '../../../../src/infrastructure/persistence/drizzle/git-connection.repository';
import { DrizzleProvisionedRepositoryRepository } from '../../../../src/infrastructure/persistence/drizzle/provisioned-repository.repository';
import { DrizzleOutboxRepository } from '../../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { EnvelopeEncryptionService } from '../../../../src/infrastructure/security/envelope-encryption.service';
import { ProvisionRepositoryUseCase } from '../../../../src/application/use-cases/git/provision-repository.use-case';
import { GitProviderAuthError } from '../../../../src/domain/git/git-provider-errors';
import type {
  CreateRepositoryInput,
  CreateRepositoryResult,
  GitProvider,
  GitProviderRegistry,
} from '../../../../src/application/ports/git-provider.port';
import type { GitProviderName } from '@brabo/shared';

const { db, pool } = createTestDb();

const unitOfWork = new DrizzleUnitOfWork(db);
const connectionRepo = new DrizzleGitConnectionRepository(db);
const repositoryRepo = new DrizzleProvisionedRepositoryRepository(db);
const outboxRepo = new DrizzleOutboxRepository(db);
const encryption = new EnvelopeEncryptionService();

class FakeGitProvider implements GitProvider {
  name: GitProviderName = 'local';
  callCount = 0;

  async createRepository(
    input: CreateRepositoryInput,
  ): Promise<CreateRepositoryResult> {
    await Promise.resolve();
    this.callCount += 1;
    return {
      externalId: `fake/${input.name}`,
      url: `https://fake.example/${input.name}`,
      defaultBranch: 'main',
    };
  }
}

class ThrowingGitProvider implements GitProvider {
  name: GitProviderName = 'github';

  async createRepository(): Promise<CreateRepositoryResult> {
    await Promise.resolve();
    throw new GitProviderAuthError(
      'github',
      'Token do GitHub inválido ou revogado',
    );
  }
}

function registryWith(provider: GitProvider): GitProviderRegistry {
  return { get: () => provider };
}

async function setupProject() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-provision', email: 'provision@brabo.dev' })
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

describe('ProvisionRepositoryUseCase', () => {
  it('local: provisiona sem exigir conexão OAuth', async () => {
    const { user, project } = await setupProject();
    const fakeProvider = new FakeGitProvider();
    const provisionRepository = new ProvisionRepositoryUseCase(
      unitOfWork,
      connectionRepo,
      encryption,
      registryWith(fakeProvider),
      repositoryRepo,
      outboxRepo,
    );

    const repository = await provisionRepository.execute(project.id, user.id, {
      provider: 'local',
      name: 'meu-repo',
      visibility: 'private',
    });

    expect(repository.externalId).toBe('fake/meu-repo');
    expect(fakeProvider.callCount).toBe(1);

    const [outboxRow] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, project.id));
    expect(outboxRow.eventType).toBe('project.repository_provisioned');
  });

  it('rejeita reprovisionar um projeto que já tem repositório (409)', async () => {
    const { user, project } = await setupProject();
    const fakeProvider = new FakeGitProvider();
    const provisionRepository = new ProvisionRepositoryUseCase(
      unitOfWork,
      connectionRepo,
      encryption,
      registryWith(fakeProvider),
      repositoryRepo,
      outboxRepo,
    );

    await provisionRepository.execute(project.id, user.id, {
      provider: 'local',
      name: 'meu-repo',
      visibility: 'private',
    });

    await expect(
      provisionRepository.execute(project.id, user.id, {
        provider: 'local',
        name: 'outro-repo',
        visibility: 'public',
      }),
    ).rejects.toThrow(ConflictException);
    expect(fakeProvider.callCount).toBe(1); // segunda tentativa nem chama o provider
  });

  it('github sem conexão prévia: 409', async () => {
    const { user, project } = await setupProject();
    const provisionRepository = new ProvisionRepositoryUseCase(
      unitOfWork,
      connectionRepo,
      encryption,
      registryWith(new FakeGitProvider()),
      repositoryRepo,
      outboxRepo,
    );

    await expect(
      provisionRepository.execute(project.id, user.id, {
        provider: 'github',
        name: 'meu-repo',
        visibility: 'private',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('provider lança erro de auth: propaga e não grava outbox', async () => {
    const { user, project } = await setupProject();
    await connectionRepo.upsert(project.id, 'github', {
      secret: encryption.encrypt(
        JSON.stringify({ accessToken: 'expired-token', refreshToken: null }),
      ),
      accessTokenExpiresAt: null,
      accountLogin: 'octocat',
      accountMetadata: {},
      connectedBy: user.id,
    });

    const provisionRepository = new ProvisionRepositoryUseCase(
      unitOfWork,
      connectionRepo,
      encryption,
      registryWith(new ThrowingGitProvider()),
      repositoryRepo,
      outboxRepo,
    );

    await expect(
      provisionRepository.execute(project.id, user.id, {
        provider: 'github',
        name: 'meu-repo',
        visibility: 'private',
      }),
    ).rejects.toThrow(GitProviderAuthError);

    const outboxRows = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, project.id));
    expect(outboxRows).toHaveLength(0);
  });

  it('caminho feliz com conexão github: persiste + outbox', async () => {
    const { user, project } = await setupProject();
    await connectionRepo.upsert(project.id, 'github', {
      secret: encryption.encrypt(
        JSON.stringify({ accessToken: 'valid-token', refreshToken: null }),
      ),
      accessTokenExpiresAt: null,
      accountLogin: 'octocat',
      accountMetadata: {},
      connectedBy: user.id,
    });

    const fakeProvider = new FakeGitProvider();
    fakeProvider.name = 'github';
    const provisionRepository = new ProvisionRepositoryUseCase(
      unitOfWork,
      connectionRepo,
      encryption,
      registryWith(fakeProvider),
      repositoryRepo,
      outboxRepo,
    );

    const repository = await provisionRepository.execute(project.id, user.id, {
      provider: 'github',
      name: 'meu-repo',
      visibility: 'private',
    });

    expect(repository.provider).toBe('github');

    const [outboxRow] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, project.id));
    expect(outboxRow.eventType).toBe('project.repository_provisioned');
  });
});
