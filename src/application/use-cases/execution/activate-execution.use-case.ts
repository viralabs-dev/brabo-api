import { BadRequestException, Injectable } from '@nestjs/common';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { TaskRepository } from '../../ports/backlog-repository.port';
import { AgentAutonomyRepository } from '../../ports/agent-autonomy-repository.port';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { PermissionsFileStore } from '../../ports/permissions-file-store.port';
import { DEV_TERMINAL_ALLOW_PATTERNS } from '../../../domain/actions/dev-terminal-patterns';
import { TransitionSessionUseCase } from '../sessions/transition-session.use-case';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { UpsertAgentInstructionUseCase } from '../agents/upsert-agent-instruction.use-case';
import { DEFAULT_MAX_GATE_CORRECTIONS } from './record-gate-verdict.use-case';
import {
  DEFAULT_DEV_AGENT_IMPL,
  type DevAgentImpl,
} from '../../../domain/execution/dev-agent-impl';

// agent_id/branch slug a partir do nome do módulo.
export function devAgentId(moduleName: string): string {
  return `dev-${moduleName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')}`;
}

// agent_id do subagente extra do mesmo módulo (paralelização). PRECISA bater
// com `Engine.Dev.Naming.extra_agent_id/1` no engine — o agent_id liga a
// autonomia seedada aqui ao processo que sobe lá.
export function extraDevAgentId(moduleName: string): string {
  return `${devAgentId(moduleName)}-2`;
}

// Instrução seedada pro dev de um módulo. Compartilhada com o aceite da
// paralelização, que precisa seedar o subagente extra do mesmo jeito.
export function devAgentInstruction(
  agentId: string,
  m: { name: string; stack: string; responsibility: string },
): string {
  return (
    `Você é o ${agentId}: implementa as tasks do módulo "${m.name}" (${m.stack}). ` +
    `Responsabilidade: ${m.responsibility}. Trabalha no seu worktree, commita com sua ` +
    `identidade e abre PR referenciando a story.`
  );
}

// Ações git que o dev auto-aprova (o demo abre PRs sem clique). `git_merge`
// NUNCA entra aqui — a trava de merge o mantém manual.
export const DEV_AUTO_GIT_ACTIONS = ['git_commit', 'git_push', 'pr_open'];

// Orçamento de tokens por task (Fase 4a) quando não configurado na ativação
// — US$0,50 em micro-USD. "Configurável por projeto" é satisfeito no
// próprio ato de ativar (ver `execute`); sem tabela nova.
const DEFAULT_TASK_BUDGET_MICROS = 500_000;

/**
 * Ativa a fase de execução de um projeto (Fase 4a): exige module_map vigente;
 * cria uma sessão de execução dedicada e a ativa (sobe o SessionServer); seeda
 * as instruções + a autonomia (auto_approve nos git ops) de um dev por módulo;
 * e manda o engine subir os DevAgentServers.
 */
@Injectable()
export class ActivateExecutionUseCase {
  constructor(
    private readonly moduleMaps: ModuleMapRepository,
    private readonly sessions: SessionRepository,
    private readonly taskRepo: TaskRepository,
    private readonly agentAutonomy: AgentAutonomyRepository,
    private readonly engineClient: ApiToEngineClient,
    private readonly transitionSession: TransitionSessionUseCase,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly upsertInstruction: UpsertAgentInstructionUseCase,
    private readonly projects: ProjectRepository,
    private readonly permissionsFile: PermissionsFileStore,
  ) {}

  async execute(
    projectId: string,
    userId: string,
    taskBudgetMicros?: number,
    maxGateCorrections?: number,
    devAgentImpl?: DevAgentImpl,
    terminalAllowPatterns?: readonly string[],
  ) {
    const maxCorrections = maxGateCorrections ?? DEFAULT_MAX_GATE_CORRECTIONS;
    const impl = devAgentImpl ?? DEFAULT_DEV_AGENT_IMPL;
    const moduleMap = await this.moduleMaps.findCurrent(projectId);
    if (!moduleMap || moduleMap.modules.length === 0) {
      throw new BadRequestException(
        'Projeto sem module_map vigente — o Arquiteto precisa definir os módulos antes de executar',
      );
    }

    // Orçamento por task: parâmetro → setting do projeto → default. Quando vem
    // no parâmetro, PERSISTE — senão o valor escolhido se perderia na próxima
    // ativação (o engine é quem o guardava, por linha de dev agent).
    const project = await this.projects.findById(projectId);
    const budget =
      taskBudgetMicros ??
      project?.taskBudgetMicros ??
      DEFAULT_TASK_BUDGET_MICROS;
    if (taskBudgetMicros !== undefined && taskBudgetMicros !== project?.taskBudgetMicros) {
      await this.projects.update(projectId, { taskBudgetMicros });
    }

    // Sem regra no permissions.json, `decide()` cai em require_approval e TODO
    // `terminal` do dev nasce pendente — e como o ReportDone exige um terminal
    // com exit 0, a suite verde ficaria inalcançável e a task sempre acabaria
    // bloqueada por limite de iterações. Padrões ESTREITOS (comandos de
    // teste/build), no arquivo e não em agent_autonomy, pra que `deny`
    // continue vencendo.
    for (const pattern of terminalAllowPatterns ?? DEV_TERMINAL_ALLOW_PATTERNS) {
      await this.permissionsFile.addPattern(projectId, 'allow', pattern);
    }

    const session = await this.sessions.create({
      projectId,
      createdBy: userId,
    });
    await this.transitionSession.execute(projectId, session.id, 'active');

    const modules = moduleMap.modules.map((m) => m.name);
    for (const m of moduleMap.modules) {
      const agentId = devAgentId(m.name);
      await this.upsertInstruction.execute(
        projectId,
        agentId,
        devAgentInstruction(agentId, m),
      );
      for (const type of DEV_AUTO_GIT_ACTIONS) {
        await this.agentAutonomy.upsert(
          projectId,
          agentId,
          type,
          'auto_approve',
        );
      }
    }

    await this.engineClient.startExecution(
      projectId,
      session.id,
      modules,
      budget,
      maxCorrections,
      impl,
    );

    await this.appendEvent.execute(projectId, session.id, {
      type: 'execution.activated',
      actor: { kind: 'user', id: userId },
      payload: { modules, devAgentImpl: impl, taskBudgetMicros: budget },
    });

    // Sugestão de paralelização: módulos com ≥2 tasks pegáveis têm ramos
    // independentes disponíveis — sugere um subagente extra (aceite 1-clique).
    for (const m of moduleMap.modules) {
      const claimable = await this.taskRepo.countClaimableByModule(
        projectId,
        m.name,
      );
      if (claimable >= 2) {
        await this.appendEvent.execute(projectId, session.id, {
          type: 'execution.parallelization_suggested',
          actor: { kind: 'system', id: 'parallelization' },
          payload: { module: m.name, availableTasks: claimable },
        });
      }
    }

    return { sessionId: session.id, modules };
  }
}
