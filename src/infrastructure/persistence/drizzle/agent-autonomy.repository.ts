import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import {
  AgentAutonomyRepository,
  type AutonomiaResolvida,
} from '../../../application/ports/agent-autonomy-repository.port';
import type { PermissionPolicy } from '../../../domain/actions/permissions-file';
import { AGENT_AUTONOMY_ALL_ACTIONS } from '../../../domain/actions/decide';
import { agentAutonomy } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleAgentAutonomyRepository implements AgentAutonomyRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async findMode(
    projectId: string,
    agentId: string,
    actionType: string,
  ): Promise<PermissionPolicy | null> {
    return (await this.resolve(projectId, agentId, actionType))?.mode ?? null;
  }

  async resolve(
    projectId: string,
    agentId: string,
    actionType: string,
  ): Promise<AutonomiaResolvida | null> {
    const db = currentDb(this.rootDb);
    // Busca a regra ESPECÍFICA e a regra CURINGA (`*`, "auto mode" — RN-153)
    // numa query só: uma linha por `actionType` distinto (a unique constraint
    // do schema garante no máximo duas linhas aqui). A específica vence — é o
    // que deixa "auto mode ligado, mas este tipo em deny" fazer o que a frase
    // diz —, salvo quando ela diz o MESMO `auto_approve` da curinga (abaixo).
    const rows = await db
      .select({
        actionType: agentAutonomy.actionType,
        mode: agentAutonomy.mode,
      })
      .from(agentAutonomy)
      .where(
        and(
          eq(agentAutonomy.projectId, projectId),
          eq(agentAutonomy.agentId, agentId),
          inArray(agentAutonomy.actionType, [
            actionType,
            AGENT_AUTONOMY_ALL_ACTIONS,
          ]),
        ),
      );
    const especifica = rows.find((r) => r.actionType === actionType);
    const curinga = rows.find(
      (r) => r.actionType === AGENT_AUTONOMY_ALL_ACTIONS,
    );
    const modoEspecifico = especifica?.mode ?? null;

    // PILOTO AUTOMÁTICO (RN-670, ADR 0189, AT-255): específica `auto_approve`
    // sob curinga `auto_approve` resolve como a CURINGA. É o que "Sempre
    // permitir" de dev agent grava (RN-509), e até aqui essa linha sombreava a
    // curinga com origem `especifica` — `decide()` deixava de reconhecer o
    // modo automático e o composto sintetizado e o escopo voltavam a pedir
    // aprovação (uso real de 29/09: 97 + 37 pedidos com o piloto "ligado").
    // A específica não perde nada com isso: ela não dá a este tipo um modo
    // que a curinga não dê. E continua vencendo quando diz OUTRA coisa
    // (`require_approval`/`deny`), ou quando a curinga está desligada.
    if (modoEspecifico === 'auto_approve' && curinga?.mode === 'auto_approve') {
      return {
        mode: 'auto_approve',
        origem: 'curinga',
        especifica: modoEspecifico,
      };
    }
    if (especifica) {
      return {
        mode: especifica.mode,
        origem: 'especifica',
        especifica: modoEspecifico,
      };
    }
    return curinga
      ? { mode: curinga.mode, origem: 'curinga', especifica: null }
      : null;
  }

  async upsert(
    projectId: string,
    agentId: string,
    actionType: string,
    mode: PermissionPolicy,
  ): Promise<void> {
    const db = currentDb(this.rootDb);
    await db
      .insert(agentAutonomy)
      .values({ projectId, agentId, actionType, mode })
      .onConflictDoUpdate({
        target: [
          agentAutonomy.projectId,
          agentAutonomy.agentId,
          agentAutonomy.actionType,
        ],
        set: { mode, updatedAt: new Date() },
      });
  }

  async listForProject(projectId: string) {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select({
        agentId: agentAutonomy.agentId,
        actionType: agentAutonomy.actionType,
        mode: agentAutonomy.mode,
      })
      .from(agentAutonomy)
      .where(eq(agentAutonomy.projectId, projectId));
    return rows;
  }
}
