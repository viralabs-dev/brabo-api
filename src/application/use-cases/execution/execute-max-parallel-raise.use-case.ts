import { Injectable, Logger } from '@nestjs/common';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';
import { SetAreaMaxParallelUseCase } from './set-area-max-parallel.use-case';

/**
 * O que acontece quando você APROVA a proposta da Anamnese (FASE 14d, item 4).
 *
 * Reusa `SetAreaMaxParallelUseCase` — o mesmo caminho da tela de Configurações.
 * Não há atalho para o repositório aqui: a validação de "inteiro >= 1" vale
 * igual, venha o número de você ou de um agente.
 */
@Injectable()
export class ExecuteMaxParallelRaiseUseCase {
  private readonly logger = new Logger(ExecuteMaxParallelRaiseUseCase.name);

  constructor(private readonly setMaxParallel: SetAreaMaxParallelUseCase) {}

  async execute(
    projectId: string,
    _sessionId: string,
    action: ProposedAction,
  ): Promise<ProposedAction> {
    const payload = action.payload as {
      area?: unknown;
      proposto?: unknown;
    } | null;

    if (
      typeof payload?.area !== 'string' ||
      typeof payload?.proposto !== 'number'
    ) {
      // A decisão já está gravada e é imutável; o que se perde é a execução, e
      // ela precisa aparecer como falha explícita.
      this.logger.error(
        `ação ${action.id} é raise_max_parallel sem \`area\`/\`proposto\` no payload; o teto não mudou`,
      );
      return action;
    }

    // O valor vem do PAYLOAD, que é o que você leu ao decidir. Recalcular
    // agora poderia aplicar um teto diferente do autorizado.
    await this.setMaxParallel.execute(
      projectId,
      payload.area,
      payload.proposto,
    );

    return action;
  }
}
