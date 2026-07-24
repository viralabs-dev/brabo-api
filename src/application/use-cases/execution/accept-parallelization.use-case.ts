import { Injectable } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

/**
 * Aceite (um clique) da sugestão de paralelização: sobe um dev extra
 * (`dev-<modulo>-2`) no mesmo módulo, com worktree próprio. Ação do usuário.
 */
@Injectable()
export class AcceptParallelizationUseCase {
  constructor(
    private readonly engineClient: ApiToEngineClient,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    module: string,
    userId: string,
  ) {
    await this.appendEvent.execute(projectId, sessionId, {
      type: 'execution.parallelization_accepted',
      actor: { kind: 'user', id: userId },
      payload: { module },
    });
    await this.engineClient.acceptParallelization(projectId, sessionId, module);
    return { ok: true as const };
  }
}
