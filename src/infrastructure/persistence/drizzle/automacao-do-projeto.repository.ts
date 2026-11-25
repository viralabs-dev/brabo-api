import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  AutomacaoDoProjetoRepository,
  type AutomacaoDoProjeto,
} from '../../../application/ports/automacao-do-projeto-repository.port';
import { automacoesDoProjeto } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleAutomacaoDoProjetoRepository implements AutomacaoDoProjetoRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async listar(projectId: string): Promise<AutomacaoDoProjeto[]> {
    const rows = await currentDb(this.rootDb)
      .select()
      .from(automacoesDoProjeto)
      .where(eq(automacoesDoProjeto.projectId, projectId));
    return rows.map((r) => ({
      categoria: r.categoria,
      chave: r.chave,
      ligada: r.ligada,
      origem: r.origem as AutomacaoDoProjeto['origem'],
      userId: r.userId,
      createdAt: r.createdAt,
    }));
  }

  async definir(input: {
    projectId: string;
    categoria: string;
    chave: string;
    ligada: boolean;
    origem: 'oferta' | 'manual';
    userId: string;
  }): Promise<void> {
    await currentDb(this.rootDb)
      .insert(automacoesDoProjeto)
      .values(input)
      .onConflictDoUpdate({
        target: [
          automacoesDoProjeto.projectId,
          automacoesDoProjeto.categoria,
          automacoesDoProjeto.chave,
        ],
        set: {
          ligada: input.ligada,
          origem: input.origem,
          userId: input.userId,
          createdAt: new Date(),
        },
      });
  }
}
