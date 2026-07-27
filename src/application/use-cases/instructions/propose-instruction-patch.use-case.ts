import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { AgentInstructionRepository } from '../../ports/agent-instruction-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { PsychologistHypothesisRepository } from '../../ports/psychologist-hypothesis-repository.port';
import { AnamneseQueueRepository } from '../../ports/anamnese-repository.port';
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
 *
 * E, quando o patch vem de uma hipótese aceita, a entrada dela na fila da
 * Anamnese é consumida AQUI, na mesma transação — consumo é consequência do
 * patch existir. Uma hipótese lida numa rodada que não gerou patch continua
 * pendente pra próxima, que é o que mantém o loop fechado vivo.
 */
@Injectable()
export class ProposeInstructionPatchUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly instructions: AgentInstructionRepository,
    private readonly proposedActions: ProposedActionRepository,
    private readonly hypotheses: PsychologistHypothesisRepository,
    private readonly queue: AnamneseQueueRepository,
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

    // Rastreabilidade hipótese->patch->versão só vale se o id for real: um id
    // alucinado seguia até `agent_instruction_versions.source_hypothesis_id` e
    // apontava pra nada.
    if (input.hypothesisId) {
      const hypothesis = await this.hypotheses.findById(input.hypothesisId);
      if (!hypothesis || hypothesis.projectId !== projectId) {
        throw new NotFoundException(
          `hipótese "${input.hypothesisId}" não existe neste projeto — não use um id que você não recebeu no contexto`,
        );
      }
    }

    const diff = diffLines(currentContent, input.proposedContent);

    return this.unitOfWork.runInTransaction(async () => {
      const action = await this.proposeAction.execute(projectId, sessionId, {
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

      if (input.hypothesisId) {
        await this.queue.markConsumedByHypothesis(
          projectId,
          input.hypothesisId,
        );
      }

      return action;
    });
  }

  // Sem tabela nova: os patches negados são derivados das próprias
  // proposed_actions do projeto.
  //
  // `decidedBy !== null` é o que distingue "o USUÁRIO negou" de "a política
  // barrou". `ProposeActionUseCase` grava `status: 'denied'` sem decisor
  // quando o `decide` recusa por papel abaixo de maintainer ou por
  // permissions.json — e tratar isso como negação humana condenava aquele
  // conteúdo para sempre, sem o humano nunca ter visto o diff. O enunciado
  // fala da negação do usuário: só ela impede repropor igual.
  private async rejectedContentsFor(
    projectId: string,
    agent: string,
  ): Promise<string[]> {
    const actions = await this.proposedActions.listByProjectAndType(
      projectId,
      'instruction_patch',
    );
    return actions
      .filter((a) => a.status === 'denied' && a.decidedBy !== null)
      .map((a) => a.payload as { agent?: string; proposedContent?: string })
      .filter((p) => p.agent === agent && typeof p.proposedContent === 'string')
      .map((p) => p.proposedContent as string);
  }
}
