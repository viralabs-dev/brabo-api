import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { UserRepository } from '../../../application/ports/user-repository.port';
import type { User, UserLocale } from '../../../domain/iam/user.entity';
import { users } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleUserRepository implements UserRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async findById(id: string): Promise<User | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db.select().from(users).where(eq(users.id, id));
    return row ?? null;
  }

  async updateLocale(id: string, locale: UserLocale): Promise<User> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(users)
      .set({ locale, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    if (!row) throw new NotFoundException('Usuário não encontrado');
    return row;
  }
}
