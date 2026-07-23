import { ConflictException, Injectable } from '@nestjs/common';
import type { GitProviderName } from '@brabo/shared';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { GitConnectionRepository } from '../../ports/git-connection-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import { GitProviderRegistry } from '../../ports/git-provider.port';
import { ProvisionedRepositoryRepository } from '../../ports/provisioned-repository-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';

export interface ProvisionRepositoryInput {
  provider: GitProviderName;
  name: string;
  visibility: 'public' | 'private';
  namespace?: string;
}

interface DecryptedTokens {
  accessToken: string;
  refreshToken: string | null;
}

@Injectable()
export class ProvisionRepositoryUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly connections: GitConnectionRepository,
    private readonly encryption: EncryptionService,
    private readonly gitProviders: GitProviderRegistry,
    private readonly repositories: ProvisionedRepositoryRepository,
    private readonly outbox: OutboxRepository,
  ) {}

  async execute(
    projectId: string,
    userId: string,
    input: ProvisionRepositoryInput,
  ) {
    const existing = await this.repositories.findByProjectId(projectId);
    if (existing) {
      throw new ConflictException(
        'Projeto já tem um repositório provisionado',
      );
    }

    let accessToken: string | undefined;

    if (input.provider !== 'local') {
      const secret = await this.connections.findSecretByProjectAndProvider(
        projectId,
        input.provider,
      );
      if (!secret) {
        throw new ConflictException(
          `Projeto sem conexão ${input.provider} ativa — conecte antes de provisionar`,
        );
      }
      const tokens = JSON.parse(
        this.encryption.decrypt(secret),
      ) as DecryptedTokens;
      accessToken = tokens.accessToken;
    }

    const result = await this.gitProviders
      .get(input.provider)
      .createRepository({
        name: input.name,
        visibility: input.visibility,
        namespace: input.namespace,
        accessToken,
      });

    return this.unitOfWork.runInTransaction(async () => {
      const repository = await this.repositories.create({
        projectId,
        provider: input.provider,
        externalId: result.externalId,
        url: result.url,
        defaultBranch: result.defaultBranch,
        visibility: input.visibility,
        provisionedBy: userId,
      });

      await this.outbox.append({
        aggregateType: 'project',
        aggregateId: projectId,
        eventType: 'project.repository_provisioned',
        payload: { provider: input.provider, externalId: result.externalId },
      });

      return repository;
    });
  }
}
