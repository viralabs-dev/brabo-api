import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { WorkspaceModelRepository } from '../../../application/ports/workspace-model-repository.port';
import type {
  Model,
  ModelComCuradoria,
} from '../../../domain/llm/model.entity';
import {
  isUsoDeModelo,
  type UsoDeModelo,
} from '../../../domain/llm/model-uses';
import { models, workspaceModels } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleWorkspaceModelRepository implements WorkspaceModelRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async listActive(workspaceId: string): Promise<Model[]> {
    const db = currentDb(this.rootDb);
    const linhas = await db
      .select({ model: models })
      .from(workspaceModels)
      .innerJoin(models, eq(models.id, workspaceModels.modelId))
      .where(
        and(
          eq(workspaceModels.workspaceId, workspaceId),
          eq(workspaceModels.isActive, true),
        ),
      );
    return linhas.map((l) => l.model);
  }

  /**
   * LEFT JOIN, não INNER: o catálogo inteiro tem que sair, com ou sem linha de
   * curadoria. Um INNER devolveria só o que já foi decidido — e a tela existe
   * justamente para mostrar o que o sync trouxe e ninguém ligou ainda.
   */
  async listAllComCuradoria(workspaceId: string): Promise<ModelComCuradoria[]> {
    const db = currentDb(this.rootDb);
    const linhas = await db
      .select({
        model: models,
        isActive: workspaceModels.isActive,
        uses: workspaceModels.uses,
      })
      .from(models)
      .leftJoin(
        workspaceModels,
        and(
          eq(workspaceModels.modelId, models.id),
          // O filtro do workspace vai no ON, não num WHERE: num WHERE ele
          // descartaria as linhas cujo LEFT JOIN não casou — virando o INNER
          // que este método existe para não ser.
          eq(workspaceModels.workspaceId, workspaceId),
        ),
      );
    return linhas.map((l) => ({
      ...l.model,
      isActive: l.isActive ?? false,
      // A coluna é TEXT[]: um uso que saiu do vocabulário continua gravado no
      // banco e é filtrado na leitura, em vez de vazar como valor inválido
      // para um tipo que promete o contrário.
      uses: (l.uses ?? []).filter(isUsoDeModelo),
    }));
  }

  async isActive(workspaceId: string, modelId: string): Promise<boolean> {
    const db = currentDb(this.rootDb);
    const [linha] = await db
      .select({ isActive: workspaceModels.isActive })
      .from(workspaceModels)
      .where(
        and(
          eq(workspaceModels.workspaceId, workspaceId),
          eq(workspaceModels.modelId, modelId),
        ),
      );
    return linha?.isActive ?? false;
  }

  async setActive(input: {
    workspaceId: string;
    modelIds: string[];
    isActive: boolean;
    curatedBy: string;
  }): Promise<number> {
    if (input.modelIds.length === 0) return 0;
    const db = currentDb(this.rootDb);
    const agora = new Date();

    // Desligar é UPDATE, não DELETE: apagar a linha também apagaria quem
    // decidiu e quando, e "ninguém nunca decidiu" não é a mesma coisa que
    // "alguém desligou". A leitura trata os dois como inativo — o registro é
    // para quem for auditar.
    const linhas = await db
      .insert(workspaceModels)
      .values(
        input.modelIds.map((modelId) => ({
          workspaceId: input.workspaceId,
          modelId,
          isActive: input.isActive,
          curatedBy: input.curatedBy,
        })),
      )
      .onConflictDoUpdate({
        target: [workspaceModels.workspaceId, workspaceModels.modelId],
        set: {
          isActive: input.isActive,
          curatedBy: input.curatedBy,
          updatedAt: agora,
        },
      })
      .returning({ modelId: workspaceModels.modelId });

    return linhas.length;
  }

  async setUses(input: {
    workspaceId: string;
    modelIds: string[];
    uses: UsoDeModelo[];
    curatedBy: string;
  }): Promise<number> {
    if (input.modelIds.length === 0) return 0;
    const db = currentDb(this.rootDb);
    const agora = new Date();

    const linhas = await db
      .insert(workspaceModels)
      .values(
        input.modelIds.map((modelId) => ({
          workspaceId: input.workspaceId,
          modelId,
          // Explícito contra o default `true` da coluna: opinar sobre um
          // modelo nunca o liga no seletor. Sem isto, marcar "serve para
          // código" ativaria um modelo que ninguém autorizou a gastar.
          isActive: false,
          uses: input.uses,
          curatedBy: input.curatedBy,
        })),
      )
      .onConflictDoUpdate({
        target: [workspaceModels.workspaceId, workspaceModels.modelId],
        // `isActive` fora do SET: o UPDATE mexe só no eixo desta operação, e a
        // curadoria de quem ligou o modelo sobrevive à mudança de uso.
        set: {
          uses: input.uses,
          curatedBy: input.curatedBy,
          updatedAt: agora,
        },
      })
      .returning({ modelId: workspaceModels.modelId });

    return linhas.length;
  }
}
