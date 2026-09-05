import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { PermissionsFileStore } from '../../ports/permissions-file-store.port';
import { AgentAutonomyRepository } from '../../ports/agent-autonomy-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { ApproveActionUseCase } from './approve-action.use-case';
import {
  patternForAction,
  commandFromPayload,
} from '../../../domain/actions/pattern-for-action';
import { parseCommand } from '../../../domain/actions/command-matcher';
import { motivoDeRecusaSempreAprovar } from '../../../domain/actions/external-effect';
import { ehDevDeModulo, DEV_LEAD } from '../../../domain/agents/agent-areas';
import type { ActionType } from '../../../domain/actions/decide';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

/**
 * "Aprovar sempre": aprova a ação (mesmo fluxo de ApproveActionUseCase,
 * incluindo a execução se for terminal) E grava o padrão exato dela —
 * escopado ao ATOR (RN-505, plano do dono do produto, Frente 2).
 *
 * Dois destinos de gravação, nunca um caminho novo por cima do outro:
 * - Ator `user`, `system`, ou `agent` que NÃO é dev-de-módulo (inclusive o
 *   próprio `dev-lead`, que lidera a área mas não é membro dela — RN-094/
 *   ADR 0038): vai pro `permissions.json/allow` de sempre, escopo de
 *   PROJETO INTEIRO, compartilhado por qualquer ator.
 * - Ator `dev-<modulo>` (ADR 0053/FASE 14d): vai pra `agent_autonomy`,
 *   escopado a ESTE agente — o mesmo mecanismo que já semeia as três ações
 *   git por módulo em `activate-execution.use-case.ts`. Um `dev-checkout`
 *   liberado não libera `dev-auth`: a chave é `(projectId, agentId,
 *   actionType)`, nunca só `(projectId, actionType)`.
 *
 * A escrita (arquivo OU tabela) acontece ANTES da transação de aprovação
 * (efeito externo antes de persistir, mesmo padrão de
 * TransitionSessionUseCase.activate): se a gravação falhar, nada é
 * aprovado.
 *
 * Comando de terminal com efeito externo git (`git push`, `gh pr create`
 * etc.) ou privilegiado (`sudo`/`doas`) é a OUTRA metade do teto absoluto de
 * `decide.ts` (RN-106): grava ZERO padrão pra eles, e a ação nem é aprovada
 * por este caminho — o clique inteiro é recusado, com o motivo explicado, e
 * o usuário aprova só esta instância pelo fluxo normal (`ApproveActionUseCase`,
 * via `POST .../approve`). Sem isto o teto de `decide()` seria decorativo:
 * um clique aqui reabriria pra sempre a porta que ele existe pra manter
 * fechada. Essa guarda roda ANTES do branch de destino, e vale pros DOIS —
 * escopar por agente não é uma segunda porta pro mesmo teto.
 *
 * Sem migração: entradas antigas de "sempre permitir" gravadas para um
 * dev-de-módulo em `permissions.json` (de antes desta regra existir)
 * continuam lá, como estavam — só não recebem MAIS entradas desse tipo
 * dali pra frente. Decisão consciente, não lacuna.
 */
@Injectable()
export class ApproveAlwaysActionUseCase {
  constructor(
    private readonly proposedActions: ProposedActionRepository,
    private readonly projects: ProjectRepository,
    private readonly permissionsFileStore: PermissionsFileStore,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly approveAction: ApproveActionUseCase,
    private readonly agentAutonomy: AgentAutonomyRepository,
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

    if (current.actionType === 'terminal') {
      const command = commandFromPayload(current.payload);
      if (command) {
        const motivo = motivoDeRecusaSempreAprovar(parseCommand(command));
        if (motivo) throw new BadRequestException(motivo);
      }
    }

    // `container_remove` é a OUTRA metade do teto absoluto de `decide.ts`
    // (ADR 0136, RN-495, mesmo molde de RN-418/ADR 0102): descarta o
    // container e exige reprovisionar do zero, então nunca grava padrão —
    // o clique inteiro é recusado, e quem quiser remover aprova esta
    // instância pelo fluxo normal (`POST .../approve`).
    if (current.actionType === 'container_remove') {
      throw new BadRequestException(
        'Remover o container nunca é auto-aprovável — decisão do usuário a ' +
          'cada vez. Aprove esta instância pelo fluxo normal.',
      );
    }

    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');

    // `ehDevDeModulo` sozinho devolve `true` pra `dev-lead` (é
    // `startsWith('dev-')` puro — comentário do próprio agent-areas.ts).
    // Excluir o lead aqui é o que impede a autonomia de módulo nascer sob o
    // agentId do lead por acidente.
    const ehAgenteDeModulo =
      current.actor.kind === 'agent' &&
      ehDevDeModulo(current.actor.id) &&
      current.actor.id !== DEV_LEAD;

    // `permission.granted` carrega um formato OU outro — nunca um fingindo
    // ser o outro. `pattern` só existe pro caminho de `permissions.json`
    // (é o padrão de texto gravado no arquivo); o caminho de `agent_autonomy`
    // não tem padrão nenhum pra mostrar, só o par (agente, tipo de ação).
    let payload: { pattern: string } | { agentId: string; actionType: string };

    if (ehAgenteDeModulo) {
      await this.agentAutonomy.upsert(
        projectId,
        current.actor.id,
        current.actionType,
        'auto_approve',
      );
      payload = { agentId: current.actor.id, actionType: current.actionType };
    } else {
      const pattern = patternForAction(
        current.actionType as ActionType,
        current.payload,
      );
      await this.permissionsFileStore.addPattern(project, 'allow', pattern);
      payload = { pattern };
    }

    const approved = await this.approveAction.execute(
      projectId,
      sessionId,
      actionId,
      decidedBy,
    );

    await this.appendSessionEvent.execute(projectId, sessionId, {
      type: 'permission.granted',
      actor: { kind: 'user', id: decidedBy },
      payload,
    });

    return approved;
  }
}
