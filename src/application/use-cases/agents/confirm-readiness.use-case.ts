import { Injectable } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

/**
 * Confirmação de prontidão é AÇÃO DO USUÁRIO (botão), não inferência do
 * modelo (CLAUDE.md 3b.3): o Criativo sugere, o usuário decide. Grava
 * `readiness.confirmed` e sinaliza o engine, que só então instrui o Criativo
 * a consolidar as regras num `product_brief` e oferecer o handoff ao PO.
 */
@Injectable()
export class ConfirmReadinessUseCase {
  constructor(
    private readonly engineClient: ApiToEngineClient,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(projectId: string, sessionId: string, userId: string) {
    await this.appendEvent.execute(projectId, sessionId, {
      type: 'readiness.confirmed',
      actor: { kind: 'user', id: userId },
      payload: {},
    });

    await this.engineClient.confirmReadiness(projectId, sessionId);

    return { ok: true as const };
  }
}
