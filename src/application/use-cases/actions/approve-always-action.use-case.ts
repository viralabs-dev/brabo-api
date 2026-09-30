import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { PermissionsFileStore } from '../../ports/permissions-file-store.port';
import { AgentAutonomyRepository } from '../../ports/agent-autonomy-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { ApproveActionUseCase } from './approve-action.use-case';
import { patternForAction } from '../../../domain/actions/pattern-for-action';
import {
  motivoDeRecusaDoSempreAprovar,
  TETO_DO_SEMPRE_PERMITIR,
} from '../../../domain/actions/sempre-permitir';
import { ehDevDeModulo, DEV_LEAD } from '../../../domain/agents/agent-areas';
import type { ActionType } from '../../../domain/actions/decide';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';
import { InvalidActionTransitionError } from '../../../domain/actions/action-state-machine';
import type { Project } from '../../../domain/iam/project.entity';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

/**
 * "Aprovar sempre": aprova a ação (mesmo fluxo de ApproveActionUseCase,
 * incluindo a execução se for terminal) E grava o padrão exato dela —
 * escopado ao ATOR (RN-509, plano do dono do produto, Frente 2).
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
 * ORDEM (RN-642, AT-310): o padrão (arquivo OU tabela) e o
 * `permission.granted` são gravados DENTRO da transação da aprovação, depois
 * de `assertTransition` passar (`aoAprovar` de `ApproveActionUseCase`) e antes
 * da execução. Até ali o padrão era gravado ANTES de aprovar, e uma ação que
 * já tinha saído de `pending` (clique duplo, a mesma pendência em dois
 * painéis, outra aba) lançava 409 com o padrão JÁ gravado e SEM o evento — 45
 * de 173 cliques no uso real de 29/09. "Aprovar antes, gravar depois" em
 * transações separadas trocaria o defeito por outro (ação aprovada, e até
 * executada, com o padrão falhando depois); na mesma transação, a
 * `agent_autonomy` e o evento são atômicos com a decisão, e o
 * `permissions.json` — arquivo, que não entra em transação — só é escrito
 * depois de a transição ser válida, e uma falha dele desfaz a aprovação. O que
 * sobra é a janela de o COMMIT falhar depois do arquivo escrito: declarada,
 * não fechada.
 *
 * Ação que JÁ saiu de `pending` deixou de ser erro por padrão: aprovada (por
 * um clique anterior, outra pessoa ou a política) é SUCESSO nomeado
 * (`desfecho: 'ja_aprovada'`), gravando o padrão só se ele ainda faltar — e
 * aí com o evento. Ação RECUSADA continua 409, nomeado (`acao_ja_recusada`),
 * sem gravar nada: liberar para sempre o que alguém acabou de recusar não é
 * idempotência, é atropelar a recusa.
 *
 * Comando de terminal com efeito externo git (`git push`, `gh pr create`
 * etc.) ou privilegiado (`sudo`/`doas`) é a OUTRA metade do teto absoluto de
 * `decide.ts` (RN-106): grava ZERO padrão pra eles, e a ação nem é aprovada
 * por este caminho — o clique inteiro é recusado, com o motivo explicado, e
 * o usuário aprova só esta instância pelo fluxo normal (`ApproveActionUseCase`,
 * via `POST .../approve`). Sem isto o teto de `decide()` seria decorativo:
 * um clique aqui reabriria pra sempre a porta que ele existe pra manter
 * fechada. Essa guarda roda ANTES do branch de destino, e vale pros DOIS —
 * escopar por agente não é uma segunda porta pro mesmo teto. Desde a AT-320
 * ela cobre também os TIPOS do teto (`git_push`/`pr_open`/`git_merge` tipados,
 * `container_remove`, `instruction_patch`, paralelismo), pela lista única
 * `TIPOS_SEM_SEMPRE_PERMITIR` (`domain/actions/sempre-permitir.ts`).
 *
 * Sem migração: entradas antigas de "sempre permitir" gravadas para um
 * dev-de-módulo em `permissions.json` (de antes desta regra existir)
 * continuam lá, como estavam — só não recebem MAIS entradas desse tipo
 * dali pra frente. Decisão consciente, não lacuna.
 */
/** O que o clique fez — o nome do sucesso (RN-642). */
export type DesfechoDoSempreAprovar = 'aprovada' | 'ja_aprovada';

export type ResultadoDoSempreAprovar = ProposedAction & {
  desfecho: DesfechoDoSempreAprovar;
  /** `false` quando o padrão já existia: nada foi gravado, nenhum evento. */
  padraoGravado: boolean;
};

/** O `reason` do 409 de ação já recusada (RN-642). */
export const ACAO_JA_RECUSADA = 'acao_ja_recusada';

type DestinoDoPadrao =
  | { tipo: 'agente'; agentId: string; actionType: string }
  | { tipo: 'arquivo'; pattern: string };

@Injectable()
export class ApproveAlwaysActionUseCase {
  constructor(
    private readonly proposedActions: ProposedActionRepository,
    private readonly projects: ProjectRepository,
    private readonly permissionsFileStore: PermissionsFileStore,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly approveAction: ApproveActionUseCase,
    private readonly agentAutonomy: AgentAutonomyRepository,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  @Traced('application')
  async execute(
    projectId: string,
    sessionId: string,
    actionId: string,
    decidedBy: string,
  ): Promise<ResultadoDoSempreAprovar> {
    const current = await this.proposedActions.findInSessionForUpdate(
      sessionId,
      actionId,
    );
    if (!current) throw new NotFoundException('Ação não encontrada');

    // Os tetos, ANTES de qualquer leitura de estado (AT-320): o comando de
    // terminal pelo que ele FAZ (RN-418) e os tipos de
    // `TIPOS_SEM_SEMPRE_PERMITIR` (git tipado, `container_remove`,
    // `instruction_patch`, paralelismo) pelo TIPO. O clique inteiro é
    // recusado, e quem quiser aprova esta instância pelo fluxo normal
    // (`POST .../approve`).
    const motivo = motivoDeRecusaDoSempreAprovar(
      current.actionType,
      current.payload,
    );
    if (motivo) {
      throw new BadRequestException({
        message: motivo,
        reason: TETO_DO_SEMPRE_PERMITIR,
        actionType: current.actionType,
      });
    }

    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');

    const destino = destinoDoPadrao(current);

    // `decidiu` separa o 409 da DECISÃO (a ação já não estava `pending`) de
    // uma transição inválida vinda da EXECUÇÃO, depois de a decisão ter sido
    // confirmada — essa segue como sempre, sem virar "já aprovada".
    let decidiu = false;
    let padraoGravado = false;
    try {
      const aprovada = await this.approveAction.execute(
        projectId,
        sessionId,
        actionId,
        decidedBy,
        async () => {
          decidiu = true;
          padraoGravado = await this.gravarPadraoSeFaltar(
            project,
            projectId,
            sessionId,
            destino,
            decidedBy,
          );
        },
      );
      return { ...aprovada, desfecho: 'aprovada', padraoGravado };
    } catch (error) {
      if (decidiu || !(error instanceof InvalidActionTransitionError)) {
        throw error;
      }
      return this.cliqueSobreAcaoJaDecidida(
        project,
        projectId,
        sessionId,
        actionId,
        destino,
        decidedBy,
        error,
      );
    }
  }

  /**
   * A ação saiu de `pending` antes deste clique — clique duplo, a mesma
   * pendência em dois painéis, outra aba, outra pessoa. Relida SOB a trava da
   * linha, numa transação só com a gravação do padrão.
   */
  private cliqueSobreAcaoJaDecidida(
    project: Project,
    projectId: string,
    sessionId: string,
    actionId: string,
    destino: DestinoDoPadrao,
    decidedBy: string,
    original: InvalidActionTransitionError,
  ): Promise<ResultadoDoSempreAprovar> {
    return this.unitOfWork.runInTransaction(async () => {
      const agora = await this.proposedActions.findInSessionForUpdate(
        sessionId,
        actionId,
      );
      if (!agora) throw new NotFoundException('Ação não encontrada');

      if (agora.status === 'denied') {
        throw new ConflictException({
          message:
            'Esta ação já foi recusada — "sempre permitir" não libera o que ' +
            'foi recusado, e nenhum padrão foi gravado. Se o comando deve ' +
            'passar, aprove quando o agente propuser de novo.',
          reason: ACAO_JA_RECUSADA,
          status: agora.status,
        });
      }
      // Ainda `pending` seria transição recusada por outro motivo que não o
      // estado da ação: não se inventa sucesso sobre o que não se entende.
      if (agora.status === 'pending') throw original;

      // approved | auto_approved | executed | failed: a ação já foi LIBERADA
      // (por um clique anterior, outra pessoa ou a política). O pedido de
      // "sempre" continua valendo para as próximas.
      const padraoGravado = await this.gravarPadraoSeFaltar(
        project,
        projectId,
        sessionId,
        destino,
        decidedBy,
      );
      return { ...agora, desfecho: 'ja_aprovada' as const, padraoGravado };
    });
  }

  /**
   * Grava o padrão e o `permission.granted` JUNTOS, ou nenhum dos dois: o
   * evento acompanha toda gravação e só ela. Padrão que já existe não é
   * regravado nem narrado de novo — é o clique repetido, não uma concessão
   * nova. Roda dentro da transação de quem chama.
   */
  private async gravarPadraoSeFaltar(
    project: Project,
    projectId: string,
    sessionId: string,
    destino: DestinoDoPadrao,
    decidedBy: string,
  ): Promise<boolean> {
    // `permission.granted` carrega um formato OU outro — nunca um fingindo
    // ser o outro. `pattern` só existe pro caminho de `permissions.json`
    // (é o padrão de texto gravado no arquivo); o caminho de `agent_autonomy`
    // não tem padrão nenhum pra mostrar, só o par (agente, tipo de ação).
    let payload: { pattern: string } | { agentId: string; actionType: string };

    if (destino.tipo === 'agente') {
      const vigente = await this.agentAutonomy.resolve(
        projectId,
        destino.agentId,
        destino.actionType,
      );
      if (vigente?.origem === 'especifica' && vigente.mode === 'auto_approve') {
        return false;
      }
      await this.agentAutonomy.upsert(
        projectId,
        destino.agentId,
        destino.actionType,
        'auto_approve',
      );
      payload = { agentId: destino.agentId, actionType: destino.actionType };
    } else {
      const arquivo = await this.permissionsFileStore.read(project);
      if (arquivo.allow.includes(destino.pattern)) return false;
      await this.permissionsFileStore.addPattern(
        project,
        'allow',
        destino.pattern,
      );
      payload = { pattern: destino.pattern };
    }

    await this.appendSessionEvent.execute(projectId, sessionId, {
      type: 'permission.granted',
      actor: { kind: 'user', id: decidedBy },
      payload,
    });
    return true;
  }
}

function destinoDoPadrao(current: ProposedAction): DestinoDoPadrao {
  // `ehDevDeModulo` sozinho devolve `true` pra `dev-lead` (é
  // `startsWith('dev-')` puro — comentário do próprio agent-areas.ts).
  // Excluir o lead aqui é o que impede a autonomia de módulo nascer sob o
  // agentId do lead por acidente.
  const ehAgenteDeModulo =
    current.actor.kind === 'agent' &&
    ehDevDeModulo(current.actor.id) &&
    current.actor.id !== DEV_LEAD;

  if (ehAgenteDeModulo) {
    return {
      tipo: 'agente',
      agentId: current.actor.id,
      actionType: current.actionType,
    };
  }
  return {
    tipo: 'arquivo',
    pattern: patternForAction(
      current.actionType as ActionType,
      current.payload,
    ),
  };
}
