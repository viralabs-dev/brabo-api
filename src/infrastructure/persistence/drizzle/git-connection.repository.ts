import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  GitConnectionRepository,
  type UpsertGitConnectionInput,
} from '../../../application/ports/git-connection-repository.port';
import type { EncryptedSecret } from '../../../application/ports/encryption.port';
import type { GitConnectionMetadata } from '../../../domain/git/git-connection.entity';
import type { GitOauthProviderName } from '../../../domain/git/oauth-state';
import { projectGitConnections } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleGitConnectionRepository implements GitConnectionRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async upsert(
    projectId: string,
    provider: GitOauthProviderName,
    input: UpsertGitConnectionInput,
  ): Promise<GitConnectionMetadata> {
    const db = currentDb(this.rootDb);
    const values = {
      projectId,
      provider,
      ...input.secret,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      accountLogin: input.accountLogin,
      accountMetadata: input.accountMetadata,
      connectedBy: input.connectedBy,
    };
    const [row] = await db
      .insert(projectGitConnections)
      .values(values)
      .onConflictDoUpdate({
        target: [
          projectGitConnections.projectId,
          projectGitConnections.provider,
        ],
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    return toMetadata(row);
  }

  async findSecretByProjectAndProvider(
    projectId: string,
    provider: GitOauthProviderName,
  ): Promise<EncryptedSecret | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(projectGitConnections)
      .where(
        and(
          eq(projectGitConnections.projectId, projectId),
          eq(projectGitConnections.provider, provider),
        ),
      );
    if (!row) return null;
    return {
      wrappedDek: row.wrappedDek,
      dekIv: row.dekIv,
      dekAuthTag: row.dekAuthTag,
      encryptedApiKey: row.encryptedApiKey,
      apiKeyIv: row.apiKeyIv,
      apiKeyAuthTag: row.apiKeyAuthTag,
    };
  }

  async findMetadataByProjectAndProvider(
    projectId: string,
    provider: GitOauthProviderName,
  ): Promise<GitConnectionMetadata | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(projectGitConnections)
      .where(
        and(
          eq(projectGitConnections.projectId, projectId),
          eq(projectGitConnections.provider, provider),
        ),
      );
    return row ? toMetadata(row) : null;
  }
}

function toMetadata(
  row: typeof projectGitConnections.$inferSelect,
): GitConnectionMetadata {
  return {
    id: row.id,
    projectId: row.projectId,
    provider: row.provider as GitOauthProviderName,
    accountLogin: row.accountLogin,
    accountMetadata: row.accountMetadata,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
