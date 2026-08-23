import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DevAgentActivityPort } from '../../../application/ports/dev-agent-activity.port';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

/**
 * Ver `dev-agent-activity.port.ts` para o porquê. `engine.dev_agent_states`
 * não é migrada pela api — mesma consequência aceita da RN-409/ADR 0097: se
 * só a api migrou (`db:migrate` sem `engine:migrate`), esta consulta falha
 * alto, sem try/catch escondendo o erro.
 */
@Injectable()
export class DrizzleDevAgentActivityRepository implements DevAgentActivityPort {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async hasActiveAgents(projectId: string): Promise<boolean> {
    const db = currentDb(this.rootDb);
    const result = await db.execute(sql`
      select 1
      from engine.dev_agent_states
      where project_id = ${projectId}
        and status <> 'idle'
      limit 1
    `);
    return result.rows.length > 0;
  }
}
