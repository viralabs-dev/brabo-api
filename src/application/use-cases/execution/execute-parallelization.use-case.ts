import { Injectable, Logger } from '@nestjs/common';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';
import { AcceptParallelizationUseCase } from './accept-parallelization.use-case';

/**
 * O que acontece quando você APROVA um pedido de paralelismo (RN-083).
 *
 * Sem isto a ação `parallelize` nascia, aparecia em Aprovações, era aprovada
 * — e nada subia. O pipeline registrava a decisão e o agente nunca vinha, que
 * é pior do que não ter a feature: a tela afirma que você autorizou.
 *
 * O módulo vem do `payload` da ação, e não de um parâmetro, de propósito: o
 * payload é IMUTÁVEL e foi o que você leu ao decidir. Reconsultar o estado
 * agora poderia subir um agente para outro módulo que não o autorizado.
 */
@Injectable()
export class ExecuteParallelizationUseCase {
  private readonly logger = new Logger(ExecuteParallelizationUseCase.name);

  constructor(private readonly accept: AcceptParallelizationUseCase) {}

  async execute(
    projectId: string,
    sessionId: string,
    action: ProposedAction,
  ): Promise<ProposedAction> {
    const modulo = (action.payload as { module?: unknown } | null)?.module;

    if (typeof modulo !== 'string' || modulo.length === 0) {
      // Não derruba a aprovação: a decisão do usuário JÁ está gravada e é
      // imutável. O que se perde é a execução, e ela precisa aparecer como
      // falha explícita — não como agente que silenciosamente não subiu.
      this.logger.error(
        `ação ${action.id} é parallelize sem \`module\` no payload; nada foi subido`,
      );
      return action;
    }

    // Quem consta no evento é QUEM DECIDIU, não o lead que pediu — o pipeline
    // separa as duas coisas, e é isso que faz o event log contar a história
    // certa depois (ADR 0048).
    await this.accept.execute(
      projectId,
      sessionId,
      modulo,
      action.decidedBy ?? action.actor.id,
    );

    return action;
  }
}
