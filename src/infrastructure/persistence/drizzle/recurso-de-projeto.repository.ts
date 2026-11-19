import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  RecursoDeProjetoRepository,
  type EstadoDeRecurso,
  type GravarRecurso,
  type OrigemDoProjeto,
  type RecursoDeProjeto,
  type TipoDeRecurso,
} from '../../../application/ports/recurso-de-projeto-repository.port';
import { projectResources } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleRecursoDeProjetoRepository implements RecursoDeProjetoRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async gravar(
    projectId: string,
    tipo: TipoDeRecurso,
    chave: string,
    patch: GravarRecurso,
  ) {
    const db = currentDb(this.rootDb);
    const agora = new Date();
    const set = {
      estado: patch.estado,
      atualizadoEm: agora,
      ...(patch.portas !== undefined && { portas: patch.portas }),
      ...(patch.containerId !== undefined && {
        containerId: patch.containerId,
      }),
      // `pedido`/`criado` limpam o motivo da falha anterior.
      motivo: patch.motivo ?? null,
      ...(patch.tentativa && {
        tentativas: sql`${projectResources.tentativas} + 1`,
      }),
    };
    await db
      .insert(projectResources)
      .values({
        projectId,
        tipo,
        chave,
        estado: patch.estado,
        portas: patch.portas ?? [],
        containerId: patch.containerId ?? null,
        motivo: patch.motivo ?? null,
        tentativas: patch.tentativa ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: [
          projectResources.projectId,
          projectResources.tipo,
          projectResources.chave,
        ],
        set,
      });
  }

  async marcarRemovendoDoProjeto(projectId: string, origem?: OrigemDoProjeto) {
    const db = currentDb(this.rootDb);
    const r = await db
      .update(projectResources)
      .set({
        estado: 'removendo',
        atualizadoEm: new Date(),
        ...(origem && {
          workspaceId: origem.workspaceId,
          projetoNome: origem.nome,
        }),
      })
      .where(
        and(
          eq(projectResources.projectId, projectId),
          ne(projectResources.estado, 'removido'),
        ),
      )
      .returning({ id: projectResources.id });
    return r.length;
  }

  async concluirRemocaoDoProjeto(projectId: string, motivo: string | null) {
    const db = currentDb(this.rootDb);
    await db
      .update(projectResources)
      .set(
        motivo === null
          ? { estado: 'removido', motivo: null, atualizadoEm: new Date() }
          : {
              motivo,
              tentativas: sql`${projectResources.tentativas} + 1`,
              atualizadoEm: new Date(),
            },
      )
      .where(
        and(
          eq(projectResources.projectId, projectId),
          eq(projectResources.estado, 'removendo'),
        ),
      );
  }

  async listar(estados: EstadoDeRecurso[]): Promise<RecursoDeProjeto[]> {
    const db = currentDb(this.rootDb);
    return db
      .select({
        id: projectResources.id,
        projectId: projectResources.projectId,
        tipo: projectResources.tipo,
        chave: projectResources.chave,
        estado: projectResources.estado,
        containerId: projectResources.containerId,
        motivo: projectResources.motivo,
        tentativas: projectResources.tentativas,
        atualizadoEm: projectResources.atualizadoEm,
      })
      .from(projectResources)
      .where(inArray(projectResources.estado, estados));
  }
}
