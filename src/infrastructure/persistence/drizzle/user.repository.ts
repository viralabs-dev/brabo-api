import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  UserRepository,
  type UpsertUserInput,
} from '../../../application/ports/user-repository.port';
import type { User } from '../../../domain/iam/user.entity';
import { users } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleUserRepository implements UserRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async upsertFromKeycloak(input: UpsertUserInput): Promise<User> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(users)
      .values(input)
      .onConflictDoUpdate({
        target: users.keycloakSub,
        set: { email: input.email, name: input.name, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async findById(id: string): Promise<User | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db.select().from(users).where(eq(users.id, id));
    return row ?? null;
  }
}
