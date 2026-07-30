import { Injectable, NotFoundException } from '@nestjs/common';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { PermissionsFileStore } from '../../ports/permissions-file-store.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { ApproveActionUseCase } from './approve-action.use-case';
import { patternForAction } from '../../../domain/actions/pattern-for-action';
import type { ActionType } from '../../../domain/actions/decide';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

/**
 * "Aprovar sempre": aprova a ação (mesmo fluxo de ApproveActionUseCase,
 * incluindo a execução se for terminal) E grava o padrão exato dela em
 * permissions.json/allow — a escrita do arquivo acontece ANTES da
 * transação de aprovação (efeito externo antes de persistir, mesmo padrão
 * de TransitionSessionUseCase.activate): se o arquivo falhar ao gravar,
 * nada é aprovado.
 */
@Injectable()
export class ApproveAlwaysActionUseCase {
  constructor(
    private readonly proposedActions: ProposedActionRepository,
    private readonly permissionsFileStore: PermissionsFileStore,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly approveAction: ApproveActionUseCase,
  ) {}

  @Traced('application')
  async execute(
    projectId: string,
    sessionId: string,
    actionId: string,
    decidedBy: string,
  ): Promise<ProposedAction> {
    const current = await this.proposedActions.findInSessionForUpdate(
      sessionId,
      actionId,
    );
    if (!current) throw new NotFoundException('Ação não encontrada');

    const pattern = patternForAction(
      current.actionType as ActionType,
      current.payload,
    );
    await this.permissionsFileStore.addPattern(projectId, 'allow', pattern);

    const approved = await this.approveAction.execute(
      projectId,
      sessionId,
      actionId,
      decidedBy,
    );

    await this.appendSessionEvent.execute(projectId, sessionId, {
      type: 'permission.granted',
      actor: { kind: 'user', id: decidedBy },
      payload: { pattern },
    });

    return approved;
  }
}
