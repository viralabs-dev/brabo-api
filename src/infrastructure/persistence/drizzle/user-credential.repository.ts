import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { LLMProviderName } from '@brabo/shared';
import { UserCredentialRepository } from '../../../application/ports/user-credential-repository.port';
import type { EncryptedSecret } from '../../../application/ports/encryption.port';
import type { UserCredentialMetadata } from '../../../domain/llm/user-credential.entity';
import { userCredentials } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleUserCredentialRepository implements UserCredentialRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async upsert(
    userId: string,
    provider: LLMProviderName,
    secret: EncryptedSecret,
  ): Promise<UserCredentialMetadata> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(userCredentials)
      .values({ userId, provider, ...secret })
      .onConflictDoUpdate({
        target: [userCredentials.userId, userCredentials.provider],
        set: { ...secret, updatedAt: new Date() },
      })
      .returning();
    return toMetadata(row);
  }

  async findSecretByUserAndProvider(
    userId: string,
    provider: LLMProviderName,
  ): Promise<EncryptedSecret | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(userCredentials)
      .where(
        and(
          eq(userCredentials.userId, userId),
          eq(userCredentials.provider, provider),
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

  async listMetadataForUser(userId: string): Promise<UserCredentialMetadata[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.userId, userId));
    return rows.map(toMetadata);
  }

  async delete(userId: string, provider: LLMProviderName): Promise<boolean> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .delete(userCredentials)
      .where(
        and(
          eq(userCredentials.userId, userId),
          eq(userCredentials.provider, provider),
        ),
      )
      .returning({ id: userCredentials.id });
    return rows.length > 0;
  }
}

function toMetadata(
  row: typeof userCredentials.$inferSelect,
): UserCredentialMetadata {
  return {
    id: row.id,
    provider: row.provider,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
