import { Injectable, NotFoundException } from '@nestjs/common';
import { SessionRepository } from '../../ports/session-repository.port';
import { SessionContextSummaryRepository } from '../../ports/session-context-summary-repository.port';

/**
 * RN-827 — o agregado da sessão INTEIRA que o painel "Contexto da sessão"
 * soma à janela de eventos (AT-498). Sessão de outro projeto é 404.
 */
@Injectable()
export class GetSessionContextSummaryUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly resumo: SessionContextSummaryRepository,
  ) {}

  async execute(projectId: string, sessionId: string) {
    const session = await this.sessions.findInProject(projectId, sessionId);
    if (!session) throw new NotFoundException('Sessão não encontrada');
    return this.resumo.resumir(projectId, sessionId);
  }
}
