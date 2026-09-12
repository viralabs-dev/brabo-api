import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
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

  async existeAlgumUsuario(): Promise<boolean> {
    const db = currentDb(this.rootDb);
    // Uma coluna constante e `limit(1)`: o planejador para na primeira linha,
    // e nada do registro do usuário atravessa a fronteira do repositório para
    // responder uma pergunta que é sim ou não.
    const linhas = await db
      .select({ existe: sql<number>`1` })
      .from(users)
      .limit(1);
    return linhas.length > 0;
  }

  async usuarioUnicoDaInstalacao(): Promise<User | null> {
    const db = currentDb(this.rootDb);
    // DUAS linhas, não uma: com `limit(1)` seria impossível distinguir "há
    // exatamente um" de "há muitos", e é justamente essa distinção que a
    // rota da chave de máquina usa para não poder ser apontada para alguém.
    const linhas = await db.select().from(users).limit(2);
    return linhas.length === 1 ? linhas[0] : null;
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
