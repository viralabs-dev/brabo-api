import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { AgentAutonomyRepository } from '../../ports/agent-autonomy-repository.port';
import { PermissionsFileStore } from '../../ports/permissions-file-store.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { ResolveEffectiveRoleUseCase } from '../iam/resolve-effective-role.use-case';
import { ExecuteTerminalActionUseCase } from './execute-terminal-action.use-case';
import { ExecuteGitActionUseCase } from './execute-git-action.use-case';
import { ExecuteInfraPrUseCase } from './execute-infra-pr.use-case';
import { ExecuteContainerStartUseCase } from './execute-container-start.use-case';
import { ExecuteContainerStartViaRunnerUseCase } from './execute-container-start-via-runner.use-case';
import { ExecuteContainerStopUseCase } from './execute-container-stop.use-case';
import { ContainerBrokerPort } from '../../ports/container-broker.port';
import { ExecuteExecutionPlanUseCase } from '../execution/execute-execution-plan.use-case';
import { ObterCicloDeVidaDoContainerUseCase } from '../containers/obter-ciclo-de-vida-do-container.use-case';
import {
  decide,
  ACTION_TYPES,
  type ActionType,
} from '../../../domain/actions/decide';
import { GIT_EXECUTED_ACTION_TYPES } from '../../../domain/actions/git-action-types';
import {
  pullRequestIdDoPayload,
  recusaDeMerge,
} from '../../../domain/actions/merge-de-pr';
import {
  commandFromPayload,
  cwdFromPayload,
} from '../../../domain/actions/pattern-for-action';
import {
  projectScopeRoot,
  raizDoEscopoNoEvento,
} from '../../../infrastructure/filesystem/project-workspaces-root';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import type { Actor } from '../../../domain/sessions/session-event.entity';
import type { ActionStatus } from '../../../domain/actions/action-state-machine';
import type { PermissionPolicy } from '../../../domain/actions/permissions-file';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';
import { Traced } from '../../../infrastructure/observability/traced.decorator';
import { DEFAULT_TASK_BUDGET_MICROS } from '../execution/activate-execution.use-case';

export interface ProposeActionInput {
  actionType: string;
  actor: Actor;
  payload: Record<string, unknown>;
}

@Injectable()
export class ProposeActionUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly sessions: SessionRepository,
    private readonly projects: ProjectRepository,
    private readonly proposedActions: ProposedActionRepository,
    private readonly agentAutonomy: AgentAutonomyRepository,
    private readonly permissionsFileStore: PermissionsFileStore,
    private readonly outbox: OutboxRepository,
    private readonly resolveEffectiveRole: ResolveEffectiveRoleUseCase,
    private readonly executeTerminalAction: ExecuteTerminalActionUseCase,
    private readonly executeGitAction: ExecuteGitActionUseCase,
    private readonly executeInfraPr: ExecuteInfraPrUseCase,
    private readonly executeContainerStart: ExecuteContainerStartUseCase,
    private readonly executeContainerStartViaRunner: ExecuteContainerStartViaRunnerUseCase,
    private readonly executeContainerStop: ExecuteContainerStopUseCase,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly obterCicloDeVidaDoContainer: ObterCicloDeVidaDoContainerUseCase,
    private readonly brokerPort: ContainerBrokerPort,
    private readonly executeExecutionPlan: ExecuteExecutionPlanUseCase,
  ) {}

  @Traced('application')
  async execute(
    projectId: string,
    sessionId: string,
    input: ProposeActionInput,
  ): Promise<ProposedAction> {
    const actionType = asActionType(input.actionType);

    const session = await this.sessions.findInProject(projectId, sessionId);
    if (!session) throw new NotFoundException('Sessão não encontrada');

    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');

    // Sem broker configurado, `container`/`mounted` não têm quem suba, pare ou
    // remova o container (ADR 0144): a ação aprovada só terminaria `failed`
    // com `BrokerIndisponivelError` (AT-105, RN-591). Recusa NOMEADA antes de
    // criar a proposta — é a mesma fonte (`configurado()`) da RN-574, e é o
    // que o agente lê como resultado da tool, sem HTTP extra no laço dele.
    if (
      ACOES_DO_BROKER.includes(actionType) &&
      project.executionMode !== 'runner' &&
      !this.brokerPort.configurado()
    ) {
      throw new ConflictException({
        code: 'sem_broker_na_instalacao',
        message: `Esta instalação não tem broker de container (BROKER_URL vazia): \`${actionType}\` em projeto \`${project.executionMode}\` só terminaria em falha. Use o modo \`runner\`, ou configure o broker.`,
      });
    }

    // Merge da MESMA PR (AT-249, RN-663): já mergeada ou já proposta é 409
    // nomeado, ANTES de criar a proposta. A tela deduplicava sozinha; a api
    // não, e no uso real a `pr-6` foi mergeada três vezes. Gate de QA
    // pendente NÃO recusa (decisão do dono, 30/09) — a tela avisa. O teto de
    // branch protegida (RN-418) segue em `decide()`, intocado.
    if (actionType === 'git_merge') {
      const pullRequestId = pullRequestIdDoPayload(input.payload);
      if (pullRequestId !== null) {
        const recusa = recusaDeMerge(
          pullRequestId,
          await this.proposedActions.listByProjectAndType(
            projectId,
            'git_merge',
          ),
        );
        if (recusa) throw new ConflictException(recusa);
      }
    }

    // O plano do Dev Lead é CONTRATO desde a RN-678 (AT-274, ADR 0194): toda
    // tarefa citada tem módulo, e o módulo está no `module_map` vigente. A
    // recusa é 400 NOMEADO antes de criar a proposta — o texto chega ao Dev
    // Lead como resultado da ferramenta, e ele corrige o plano em vez de o
    // humano aprovar um plano que a execução não saberia distribuir.
    if (actionType === 'propose_execution_plan') {
      const recusa = await this.executeExecutionPlan.recusaNaProposta(
        projectId,
        input.payload,
      );
      if (recusa) {
        throw new BadRequestException({
          code: 'plano_de_execucao_invalido',
          message: recusa,
        });
      }
    }

    // Contexto todo buscado ANTES de chamar decide() — a função em si é
    // pura (ver domain/actions/decide.ts), zero IO.
    //
    // O ciclo de vida do container só é consultado quando a pergunta pode
    // fazer diferença — terminal num projeto `container` ou `mounted` —,
    // poupando a query em todo o resto (git_push, container_start, `runner`).
    // Dele saem DOIS fatos distintos: ONDE o comando roda
    // (`execucaoNoContainer`, a raiz do escopo — RN-669, os dois modos que o
    // engine executa pelo broker, RN-502) e o PISO de auto-aprovação
    // (`containerExecutionActive`, ADR 0134/RN-493 — só `container`).
    const [effectiveRole, autonomia, permissionsFile, execucaoNoContainer] =
      await Promise.all([
        this.resolveEffectiveRole.forProject(session.createdBy, projectId),
        input.actor.kind === 'agent'
          ? this.agentAutonomy.resolve(projectId, input.actor.id, actionType)
          : Promise.resolve(null),
        this.permissionsFileStore.read(project),
        actionType === 'terminal' &&
        (project.executionMode === 'container' ||
          project.executionMode === 'mounted')
          ? this.obterCicloDeVidaDoContainer
              .execute(projectId)
              .then((ciclo) => ciclo?.status === 'running')
          : Promise.resolve(false),
      ]);
    const containerExecutionActive =
      execucaoNoContainer && project.executionMode === 'container';

    const command =
      actionType === 'terminal' ? commandFromPayload(input.payload) : undefined;
    const rawTargetBranch = (input.payload as { targetBranch?: unknown })
      .targetBranch;
    const targetBranch =
      actionType === 'git_merge' && typeof rawTargetBranch === 'string'
        ? rawTargetBranch
        : undefined;

    const decision = decide(
      {
        actionType,
        command,
        targetBranch,
        cwd:
          actionType === 'terminal' ? cwdFromPayload(input.payload) : undefined,
      },
      {
        effectiveRole,
        autonomyMode: autonomia?.mode ?? null,
        // A origem (específica ou curinga) é o que deixa `decide()` reconhecer
        // o modo automático (RN-603, ADR 0167) sem resolver precedência de novo.
        autonomyOrigin: autonomia?.origem,
        permissionsFile,
        // A raiz do escopo de terminal (ADR 0055) deriva do MODO do projeto
        // desde o ADR 0072: pasta gerenciada no `container`, a pasta do usuário
        // no `local` (RN-169).
        projectScopeRoot: projectScopeRoot(project),
        containerExecutionActive,
        execucaoNoContainer,
      },
    );

    // AT-381 (RN-709): o plano leva o orçamento por tarefa VIGENTE — o mesmo
    // que a ativação usará —, para o cartão mostrar a estimativa antes do
    // clique. É teto por tarefa, não preço.
    const payloadDaProposta =
      actionType === 'propose_execution_plan'
        ? {
            ...((input.payload ?? {}) as Record<string, unknown>),
            orcamentoPorTarefaMicros:
              project.taskBudgetMicros ?? DEFAULT_TASK_BUDGET_MICROS,
          }
        : input.payload;

    const { status, rejectionReason } = initialStatusFor(
      decision.policy,
      decision.reason,
    );

    const action = await this.unitOfWork.runInTransaction(async () => {
      const created = await this.proposedActions.create({
        projectId,
        sessionId,
        actionType,
        payload: payloadDaProposta,
        status,
        resolvedPolicy: decision.policy,
        actor: input.actor,
        rejectionReason,
      });

      // SEM `reason` aqui, de propósito (RN-567): o outbox é contrato
      // api↔engine, e nenhum consumidor do engine lê o motivo. Alargar
      // contrato sem consumidor é o corte que o ADR 0153 nomeia — o motivo
      // mora só no evento de SESSÃO, logo abaixo.
      await this.outbox.append({
        aggregateType: 'proposed_action',
        aggregateId: created.id,
        eventType: 'proposed_action.created',
        payload: { actionType, status, resolvedPolicy: decision.policy },
      });

      // O MESMO fato no event log (achado #17 do dogfooding). A linha de
      // outbox acima existe desde a Fase 1 e é consumida pelo engine — ela é
      // transporte, não memória: o outbox é podado, e `processed_at` conta
      // entrega, não decisão. `docs/reference/events.md` documentava
      // `proposed_action.created` como evento de domínio desde sempre; até
      // aqui isso simplesmente não era verdade.
      //
      // `status` no payload é o que torna a auto-aprovação AUDITÁVEL: sem ele
      // não há como distinguir "o usuário clicou" de "a política decidiu
      // sozinha", que é exatamente a métrica que a Fase 10 quis medir e não
      // conseguiu.
      //
      // `reason` é o degrau seguinte (RN-567): QUAL regra decidiu — a string
      // que `decide()` já devolve, como está, nos TRÊS desfechos. Antes ela
      // só sobrevivia como `rejectionReason` quando a ação era negada; numa
      // auto-aprovação o log dizia "a política decidiu" sem dizer qual.
      // Evento gravado antes desta regra não tem o campo: AUSENTE quer dizer
      // "não registrado", nunca "decidido sem motivo".
      await this.appendSessionEvent.execute(projectId, sessionId, {
        type: 'proposed_action.created',
        actor: input.actor,
        payload: {
          actionId: created.id,
          actionType,
          status,
          resolvedPolicy: decision.policy,
          reason: decision.reason,
          // `scopeRoot` (RN-609): QUAL raiz o escopo de caminho comparou —
          // só em `terminal`, o único tipo em que `decide()` consulta o
          // escopo (`terminalNoEscopo`). O modo e um identificador RELATIVO,
          // NUNCA o caminho absoluto: o log é lido por todo membro e, em
          // `mounted`/`runner`, o caminho traz o `$HOME` do usuário. AUSENTE
          // é "não registrado" (evento anterior, ou tipo sem escopo).
          ...(actionType === 'terminal'
            ? { scopeRoot: raizDoEscopoNoEvento(project) }
            : {}),
        },
      });

      return created;
    });

    if (status === 'auto_approved' && actionType === 'terminal') {
      return this.executeTerminalAction.execute(projectId, sessionId, action);
    }

    if (
      status === 'auto_approved' &&
      GIT_EXECUTED_ACTION_TYPES.includes(actionType)
    ) {
      return this.executeGitAction.execute(projectId, sessionId, action);
    }

    if (status === 'auto_approved' && actionType === 'open_infra_pr') {
      return this.executeInfraPr.execute(projectId, sessionId, action);
    }

    // `container_start` é semeado `auto_approve` para a Infra no aceite do
    // handoff desde o ADR 0190 (RN-671, `INFRA_AUTONOMY_SEEDS`,
    // accept-handoff.use-case.ts), e um `maintainer` também PODE configurar
    // `permissions.json` para auto-aprovar. Este branch é o que faz a subida
    // do servidor no aceite acontecer de verdade: sem ele a ação nasceria
    // `auto_approved` e nunca chamaria o broker — mesma lição do comentário de
    // `parallelize` em `approve-action.use-case.ts` — "sem isto a ação nascia,
    // era aprovada — e nada subia. Pior que não ter a feature".
    if (status === 'auto_approved' && actionType === 'container_start') {
      return this.executeContainerStart.execute(projectId, sessionId, action);
    }

    // `container_start_via_runner` (RN-508) — nunca semeado (o ADR 0190 só
    // semeou `container_start`), mas configurável em
    // `permissions.json`, e sem este branch a ação nasceria `auto_approved`
    // e nenhum container subiria de verdade na máquina do usuário.
    if (
      status === 'auto_approved' &&
      actionType === 'container_start_via_runner'
    ) {
      return this.executeContainerStartViaRunner.execute(
        projectId,
        sessionId,
        action,
      );
    }

    // `container_stop` nunca é semeado (o ADR 0190 só semeou `container_start`),
    // mas PODE ser configurado em `permissions.json` — sem este branch a
    // ação nasceria `auto_approved` e nunca pararia nada de verdade.
    // `container_remove` NÃO precisa do branch gêmeo: o teto absoluto de
    // `decide.ts` garante que ele nunca resolve `auto_approve`, então este
    // `status === 'auto_approved'` nunca é `true` para ele — um branch aqui
    // seria código morto que a suíte não teria como exercitar.
    if (status === 'auto_approved' && actionType === 'container_stop') {
      return this.executeContainerStop.execute(projectId, sessionId, action);
    }

    // AT-263 (RN-677): o plano auto-aprovado (o `maintainer` PODE configurar —
    // `propose_execution_plan` não está nos tetos absolutos de `decide.ts`)
    // ativa a execução aqui, pela mesma razão dos branches acima: sem isto a
    // ação nasceria `auto_approved` e nada subiria.
    if (status === 'auto_approved' && actionType === 'propose_execution_plan') {
      return this.executeExecutionPlan.execute(projectId, sessionId, action);
    }

    return action;
  }
}

/** As três ações de ciclo de vida que passam pelo broker (ADR 0144/RN-495). */
const ACOES_DO_BROKER: ActionType[] = [
  'container_start',
  'container_stop',
  'container_remove',
];

function initialStatusFor(
  policy: PermissionPolicy,
  reason: string,
): { status: ActionStatus; rejectionReason: string | null } {
  switch (policy) {
    case 'auto_approve':
      return { status: 'auto_approved', rejectionReason: null };
    case 'deny':
      return { status: 'denied', rejectionReason: reason };
    case 'require_approval':
      return { status: 'pending', rejectionReason: null };
  }
}

function asActionType(value: string): ActionType {
  if ((ACTION_TYPES as string[]).includes(value)) return value as ActionType;
  throw new BadRequestException(`Tipo de ação desconhecido: "${value}"`);
}
