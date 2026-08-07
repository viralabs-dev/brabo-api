import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentAreaRepository } from '../../ports/agent-area-repository.port';
import { ProposeActionUseCase } from '../actions/propose-action.use-case';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';

export interface ProposeMaxParallelInput {
  /** A área cujo teto subiria (`dev`, `qa`, …). */
  area: string;
  /** O teto proposto. */
  proposto: number;
  /** Por que, ancorado no que a Anamnese observou. */
  rationale: string;
}

/**
 * A Anamnese propondo subir o teto de paralelismo (FASE 14d, item 4).
 *
 * Nasce de um sinal que ela já recebe: as DECISÕES do usuário na janela. Quando
 * autorizar mais um agente virou rotina — você aprovando o mesmo pedido de novo
 * e de novo —, o teto está errado, e quem percebe isso primeiro é quem lê o
 * histórico.
 *
 * **A proposta nunca se aprova sozinha** (teto em `decide.ts`). É o ponto
 * inteiro: automatizar o ajuste sem você seria o produto elevando o próprio
 * limite de gasto, que é exatamente o que o pipeline de aprovação existe para
 * impedir. A Anamnese aponta; a decisão continua sua.
 */
@Injectable()
export class ProposeMaxParallelUseCase {
  constructor(
    private readonly areas: AgentAreaRepository,
    private readonly proposeAction: ProposeActionUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    input: ProposeMaxParallelInput,
  ): Promise<ProposedAction> {
    if (!Number.isInteger(input.proposto) || input.proposto < 1) {
      throw new BadRequestException(
        `teto proposto precisa ser inteiro >= 1 (recebido: ${input.proposto})`,
      );
    }

    const area = await this.areas.findByKey(projectId, input.area);
    if (!area) {
      throw new BadRequestException(
        `área "${input.area}" não existe neste projeto`,
      );
    }

    // Propor o teto que já vigora, ou um MENOR, não é proposta — é ruído numa
    // fila que você precisa ler. A Anamnese roda periodicamente e reproporia a
    // mesma coisa a cada rodada.
    if (input.proposto <= area.maxParallel) {
      throw new BadRequestException(
        `o teto da área "${input.area}" já é ${area.maxParallel}; propor ${input.proposto} não sobe nada`,
      );
    }

    return this.proposeAction.execute(projectId, sessionId, {
      actionType: 'raise_max_parallel',
      actor: { kind: 'agent', id: 'anamnese' },
      payload: {
        area: input.area,
        atual: area.maxParallel,
        proposto: input.proposto,
        rationale: input.rationale,
      },
    });
  }
}
