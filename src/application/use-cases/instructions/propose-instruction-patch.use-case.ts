import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentInstructionRepository } from '../../ports/agent-instruction-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { ProposeActionUseCase } from '../actions/propose-action.use-case';
import { diffLines } from '../../../domain/instructions/text-diff';
import { isDuplicateOfRejected } from '../../../domain/instructions/patch-dedup';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';

export interface ProposeInstructionPatchInput {
  agent: string;
  proposedContent: string;
  rationale: string;
  // Hipótese do Psicólogo que originou este patch (loop fechado) — vira
  // o badge de origem na UI e o `sourceHypothesisId` da versão gravada.
  hypothesisId?: string | null;
}

/**
 * Propõe um `instruction_patch` (Fase 4b — Anamnese). Três coisas
 * acontecem aqui, todas do lado da api (testáveis em TS):
 *
 * 1. o diff é CALCULADO contra o conteúdo vigente e vai no payload já no
 *    formato que o ApprovalCard renderiza (`files[].lines`);
 * 2. um patch idêntico a um já NEGADO é rejeitado — "negação registra
 *    para não repropor igual" (CLAUDE.md 4b.9);
 * 3. a proposed_action nasce pelo pipeline normal (decide/permissions),
 *    com o teto de "nunca auto-aprovável" garantido em decide.ts.
 */
@Injectable()
export class ProposeInstructionPatchUseCase {
  constructor(
    private readonly instructions: AgentInstructionRepository,
    private readonly proposedActions: ProposedActionRepository,
    private readonly proposeAction: ProposeActionUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    input: ProposeInstructionPatchInput,
  ): Promise<ProposedAction> {
    const current = await this.instructions.findByProjectAndAgent(
      projectId,
      input.agent,
    );
    const currentContent = current?.content ?? '';

    if (input.proposedContent.trim() === '') {
      throw new BadRequestException(
        'conteúdo proposto vazio — um patch precisa do texto completo da instrução',
      );
    }

    if (input.proposedContent === currentContent) {
      throw new BadRequestException(
        `conteúdo proposto é idêntico ao vigente de "${input.agent}" — nada a patchear`,
      );
    }

    const rejected = await this.rejectedContentsFor(projectId, input.agent);
    if (isDuplicateOfRejected(input.proposedContent, rejected)) {
      throw new BadRequestException(
        `este patch para "${input.agent}" já foi negado antes — proponha algo diferente em vez de repetir`,
      );
    }

    const diff = diffLines(currentContent, input.proposedContent);

    return this.proposeAction.execute(projectId, sessionId, {
      actionType: 'instruction_patch',
      actor: { kind: 'agent', id: 'anamnese' },
      payload: {
        agent: input.agent,
        fromVersion: current?.version ?? 0,
        proposedContent: input.proposedContent,
        rationale: input.rationale,
        hypothesisId: input.hypothesisId ?? null,
        // Formato consumido direto pelo renderer de diff que já existe
        // em ApprovalCard.tsx — a UI não precisa de differ próprio.
        files: [
          {
            path: `${input.agent}.md`,
            additions: diff.additions,
            deletions: diff.deletions,
            lines: diff.lines,
          },
        ],
      },
    });
  }

  // Sem tabela nova: os patches negados são derivados das próprias
  // proposed_actions do projeto.
  private async rejectedContentsFor(
    projectId: string,
    agent: string,
  ): Promise<string[]> {
    const actions = await this.proposedActions.listByProjectAndType(
      projectId,
      'instruction_patch',
    );
    return actions
      .filter((a) => a.status === 'denied')
      .map((a) => a.payload as { agent?: string; proposedContent?: string })
      .filter((p) => p.agent === agent && typeof p.proposedContent === 'string')
      .map((p) => p.proposedContent as string);
  }
}
