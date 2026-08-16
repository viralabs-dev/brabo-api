import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  SocialIdentityRepository,
  type SocialIdentity,
} from '../../../application/ports/social-identity-repository.port';
import type { SocialOauthProviderName } from '../../../domain/auth/social-oauth-state';
import { socialIdentities } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleSocialIdentityRepository extends SocialIdentityRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {
    super();
  }

  async findByProviderAccount(
    provider: SocialOauthProviderName,
    providerUserId: string,
  ): Promise<SocialIdentity | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(socialIdentities)
      .where(
        and(
          eq(socialIdentities.provider, provider),
          eq(socialIdentities.providerUserId, providerUserId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async create(entrada: {
    userId: string;
    provider: SocialOauthProviderName;
    providerUserId: string;
    providerEmail: string | null;
    providerLogin: string | null;
  }): Promise<SocialIdentity> {
    const db = currentDb(this.rootDb);
    const [row] = await db.insert(socialIdentities).values(entrada).returning();
    return row;
  }
}
