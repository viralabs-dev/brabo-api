import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AgentInstructionVersionRepository } from '../../ports/agent-instruction-version-repository.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { ApplyInstructionVersionService } from './apply-instruction-version.service';

/**
 * Rollback de um clique pra qualquer versão anterior (Fase 4b).
 *
 * É uma operação PRA FRENTE: copia o conteúdo da versão alvo numa versão
 * NOVA. O histórico continua append-only (nada é apagado nem reescrito),
 * então dá pra "desfazer o desfazer" e a trilha de auditoria mostra
 * exatamente quando cada reversão aconteceu.
 */
@Injectable()
export class RollbackInstructionUseCase {
  constructor(
    private readonly versions: AgentInstructionVersionRepository,
    private readonly sessions: SessionRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly applyInstruction: ApplyInstructionVersionService,
  ) {}

  async execute(
    projectId: string,
    agent: string,
    version: number,
    userId: string,
  ) {
    const target = await this.versions.findVersion(projectId, agent, version);
    if (!target) {
      throw new NotFoundException(
        `Versão ${version} do agente "${agent}" não encontrada`,
      );
    }

    const applied = await this.applyInstruction.apply({
      projectId,
      agent,
      content: target.content,
      createdBy: userId,
      // Preserva a origem da versão restaurada — a rastreabilidade
      // hipótese→patch→versão sobrevive ao rollback.
      sourceHypothesisId: target.sourceHypothesisId,
      note: `rollback para a versão ${version}`,
    });

    if (!applied.changed) {
      throw new BadRequestException(
        `A versão ${version} já é o conteúdo vigente de "${agent}"`,
      );
    }

    await this.narrate(projectId, agent, version, applied, userId);

    return {
      agent,
      restoredFrom: version,
      toVersion: applied.toVersion,
      cacheInvalidated: applied.cacheInvalidated,
    };
  }

  // O evento é imutável e precisa de uma sessão; usa a mais recente do
  // projeto. Sem nenhuma sessão ainda, o rollback acontece do mesmo
  // jeito — só não há onde narrar.
  private async narrate(
    projectId: string,
    agent: string,
    restoredFrom: number,
    applied: { toVersion: number; cacheInvalidated: boolean },
    userId: string,
  ): Promise<void> {
    const sessions = await this.sessions.listForProject(projectId);
    const latest = [...sessions].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];
    if (!latest) return;

    await this.appendSessionEvent.execute(projectId, latest.id, {
      type: 'instruction.rolled_back',
      actor: { kind: 'user', id: userId },
      payload: {
        agent,
        restoredFrom,
        toVersion: applied.toVersion,
        cacheInvalidated: applied.cacheInvalidated,
      },
    });
  }
}
