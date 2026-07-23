import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { GitOauthClientRegistry } from '../../ports/git-oauth-client.port';
import { GitConnectionRepository } from '../../ports/git-connection-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { verifyOauthState } from '../../../domain/git/oauth-state';
import type { GitOauthProviderName } from '../../../domain/git/oauth-state';

@Injectable()
export class HandleGitOauthCallbackUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly gitOauthClients: GitOauthClientRegistry,
    private readonly connections: GitConnectionRepository,
    private readonly encryption: EncryptionService,
    private readonly outbox: OutboxRepository,
  ) {}

  async execute(
    provider: GitOauthProviderName,
    code: string,
    state: string,
    redirectUri: string,
  ) {
    const statePayload = verifyOauthState(
      state,
      process.env.GIT_OAUTH_STATE_SECRET ?? 'dev-oauth-state-secret-change-me',
      provider,
    );

    return this.unitOfWork.runInTransaction(async () => {
      const tokenResult = await this.gitOauthClients
        .get(provider)
        .exchangeCode(code, redirectUri);

      const secret = this.encryption.encrypt(
        JSON.stringify({
          accessToken: tokenResult.accessToken,
          refreshToken: tokenResult.refreshToken,
        }),
      );

      await this.connections.upsert(statePayload.projectId, provider, {
        secret,
        accessTokenExpiresAt: tokenResult.expiresAt,
        accountLogin: tokenResult.accountLogin,
        accountMetadata: tokenResult.accountMetadata,
        connectedBy: statePayload.userId,
      });

      await this.outbox.append({
        aggregateType: 'project',
        aggregateId: statePayload.projectId,
        eventType: 'project.git_connected',
        payload: { provider, accountLogin: tokenResult.accountLogin },
      });

      return { projectId: statePayload.projectId };
    });
  }
}
