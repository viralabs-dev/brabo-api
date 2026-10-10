import { Injectable, NotFoundException } from '@nestjs/common';
import {
  StoryRepository,
  TaskRepository,
} from '../../ports/backlog-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import type { Story, Task } from '../../../domain/backlog/backlog.entity';
import type { ContratoDeModulo } from '../../../domain/architecture/module-contracts';
import { GetModuleContractsUseCase } from '../architecture/get-module-contracts.use-case';

export interface DevContextBusinessRule {
  title: string;
  description: string;
}

export interface DevContextAdr {
  title: string;
  content: string;
  // Fase 4a — SecOps: ADR marcado como relevante de segurança pelo
  // Arquiteto (payload opcional de `open_adr_pr`, default `false`) — vira
  // checklist informativo no parecer do SecOpsAgent, sem correlação
  // profunda linha-a-linha.
  securityRelevant: boolean;
}

/**
 * ADR entra no contexto do dev se for transversal (sem `modules` declarados —
 * inclui o acervo anterior ao campo) ou se citar o módulo dele. Sem módulo
 * informado, não há filtro. Pura.
 */
export function appliesToModule(
  adrModules: string[],
  module?: string,
): boolean {
  if (!module) return true;
  if (adrModules.length === 0) return true;
  return adrModules.includes(module);
}

/**
 * AT-448 (RN-765): as OUTRAS tarefas da mesma história, com o status — o
 * recorte que o gate de QA precisa para julgar a entrega pelo que é DESTA
 * tarefa, e não reprovar por um RF que é de uma irmã ainda pendente.
 */
export interface DevContextSiblingTask {
  id: string;
  title: string;
  status: string;
}

/**
 * AT-461 (RN-785): tarefa NÃO concluída de OUTRA história do mesmo módulo —
 * o que o gate de QA precisa para não reprovar a entrega por uma rota ou
 * tela que outra história ainda vai entregar.
 */
export interface DevContextModuleOpenTask {
  id: string;
  title: string;
  status: string;
  storyTitle: string;
}

/** Teto da leitura (ADR 0060): o total real vai em `moduleOpenTasksTotal`. */
export const TETO_DE_TAREFAS_ABERTAS_DO_MODULO = 20;

export interface DevTaskContext {
  task: Task;
  story: Story;
  businessRules: DevContextBusinessRule[];
  adrs: DevContextAdr[];
  siblingTasks: DevContextSiblingTask[];
  moduleOpenTasks: DevContextModuleOpenTask[];
  moduleOpenTasksTotal: number;
  // AT-462 (RN-786): o contrato vigente do módulo — a fonte da INTERFACE
  // para o gate de QA. `null` sem módulo resolvível ou sem contrato.
  moduleContract: ContratoDeModulo | null;
  // AT-433 (RN-774): esta é a PRIMEIRA tarefa do módulo — o engine dá a ela
  // o teto de 2× (`Engine.Dev.TetoDaTarefa`). `false` sem `module`.
  primeiraDoModulo: boolean;
}

/**
 * AT-433 (RN-774): a tarefa é a PRIMEIRA do módulo quando o `backlog.task_claimed`
 * mais antigo do projeto para esse módulo é dela. Pelo log, e não pelo estado
 * da tarefa, porque bloquear zera `assigned_to` e o reinício do engine perde a
 * memória do processo: o log é a única fonte que não muda. Sem nenhum claim do
 * módulo, `false` — o teto normal é o conservador. Pura.
 */
export function ehPrimeiraTarefaDoModulo(
  claims: ReadonlyArray<{ payload: unknown }>,
  taskId: string,
  module?: string,
): boolean {
  if (!module) return false;
  const primeiro = claims.find(
    (c) => (c.payload as { module?: unknown })?.module === module,
  );
  return (primeiro?.payload as { taskId?: unknown })?.taskId === taskId;
}

/** As irmãs da tarefa, sem ela mesma, na ordem do repositório. Pura. */
export function tarefasIrmas(
  task: Pick<Task, 'id'>,
  daHistoria: Pick<Task, 'id' | 'title' | 'status'>[],
): DevContextSiblingTask[] {
  return daHistoria
    .filter((t) => t.id !== task.id)
    .map((t) => ({ id: t.id, title: t.title, status: t.status }));
}

/**
 * AT-461 (RN-785): as tarefas não concluídas das OUTRAS histórias do mesmo
 * módulo, com o título da história. O módulo é o da tarefa (`tasks.module`),
 * senão o pedido, senão os da história; história arquivada fica fora. Teto de
 * `TETO_DE_TAREFAS_ABERTAS_DO_MODULO`, com o total real ao lado. Pura.
 */
export function tarefasAbertasDoModulo(
  task: Pick<Task, 'storyId' | 'module'>,
  story: Pick<Story, 'moduleIds'>,
  module: string | undefined,
  historias: Pick<Story, 'id' | 'title' | 'moduleIds' | 'archivedAt'>[],
  tarefas: Pick<Task, 'id' | 'title' | 'status' | 'storyId' | 'module'>[],
): { itens: DevContextModuleOpenTask[]; total: number } {
  const modulos = new Set(
    task.module ? [task.module] : module ? [module] : story.moduleIds,
  );
  if (modulos.size === 0) return { itens: [], total: 0 };
  const porId = new Map(
    historias
      .filter(
        (h) =>
          h.id !== task.storyId &&
          h.archivedAt === null &&
          h.moduleIds.some((m) => modulos.has(m)),
      )
      .map((h) => [h.id, h]),
  );
  const abertas = tarefas
    .filter(
      (t) =>
        porId.has(t.storyId) &&
        t.status !== 'done' &&
        (t.module === null || modulos.has(t.module)),
    )
    .map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      storyTitle: porId.get(t.storyId)!.title,
    }));
  return {
    itens: abertas.slice(0, TETO_DE_TAREFAS_ABERTAS_DO_MODULO),
    total: abertas.length,
  };
}

/**
 * AT-462 (RN-786): o módulo cuja interface vale para a tarefa — o dela, senão
 * o pedido, senão o único da história. Mais de um na história e nenhum na
 * tarefa é ambíguo: `null`. Pura.
 */
export function moduloDoContrato(
  task: Pick<Task, 'module'>,
  story: Pick<Story, 'moduleIds'>,
  module?: string,
): string | null {
  return (
    task.module ??
    module ??
    (story.moduleIds.length === 1 ? story.moduleIds[0] : null)
  );
}

/**
 * Monta o contexto rico que o DevAgent usa pra implementar a task (camadas
 * `regras_negocio`/`estado_tarefa` do harness): a story completa (RF/RNF/DoD/
 * DoR), as regras de negócio referenciadas (resolvidas via session_events
 * `artifact.business_rule`, mesmo padrão de `CreateStoryUseCase`), e os ADRs
 * **do módulo** do dev.
 *
 * O vínculo ADR↔módulo é o campo opcional `modules` no payload de
 * `open_adr_pr` (preenchido pelo Arquiteto). ADR sem `modules` — inclusive
 * todo o acervo anterior a este campo — conta como TRANSVERSAL e entra pra
 * qualquer módulo: é o default seguro, e evita migração de dados. Sem `module`
 * o filtro não se aplica (todos entram), preservando os chamadores antigos.
 */
@Injectable()
export class GetDevTaskContextUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly stories: StoryRepository,
    private readonly sessionEvents: SessionEventRepository,
    private readonly proposedActions: ProposedActionRepository,
  ) {}

  async execute(
    projectId: string,
    taskId: string,
    module?: string,
  ): Promise<DevTaskContext> {
    const task = await this.tasks.findById(taskId);
    if (!task) {
      throw new NotFoundException(`Task "${taskId}" não encontrada`);
    }

    const story = await this.stories.findById(task.storyId);
    if (!story || story.projectId !== projectId) {
      throw new NotFoundException(
        `Story da task "${taskId}" não encontrada neste projeto`,
      );
    }

    const [businessRules, adrActions, daHistoria, claims] = await Promise.all([
      this.resolveBusinessRules(story.businessRuleIds),
      this.proposedActions.listByProjectAndType(projectId, 'open_adr_pr'),
      this.tasks.findByStoryIds([story.id]),
      module
        ? this.sessionEvents.listByTypeForProject(
            projectId,
            'backlog.task_claimed',
          )
        : Promise.resolve([]),
    ]);

    const modulo = moduloDoContrato(task, story, module);
    const contratos = modulo
      ? await new GetModuleContractsUseCase(this.sessionEvents).execute(
          projectId,
        )
      : null;
    const moduleContract =
      contratos?.status === 'declarados'
        ? (contratos.contratos.find((c) => c.modulo === modulo) ?? null)
        : null;

    const historias = await this.stories.findByProject(projectId);
    const outras = historias.filter((h) => h.id !== story.id);
    const doModulo = tarefasAbertasDoModulo(
      task,
      story,
      module,
      outras,
      outras.length > 0
        ? await this.tasks.findByStoryIds(outras.map((h) => h.id))
        : [],
    );

    const adrs: DevContextAdr[] = adrActions
      .map((a) => {
        const payload = a.payload as {
          title?: string;
          content?: string;
          securityRelevant?: boolean;
          modules?: string[];
        };
        return {
          title: payload.title ?? '(ADR sem título)',
          content: payload.content ?? '',
          securityRelevant: payload.securityRelevant ?? false,
          modules: payload.modules ?? [],
        };
      })
      .filter((adr) => appliesToModule(adr.modules, module))
      .map(({ modules: _modules, ...adr }) => adr);

    return {
      task,
      story,
      businessRules,
      adrs,
      siblingTasks: tarefasIrmas(task, daHistoria),
      moduleOpenTasks: doModulo.itens,
      moduleOpenTasksTotal: doModulo.total,
      moduleContract,
      primeiraDoModulo: ehPrimeiraTarefaDoModulo(claims, task.id, module),
    };
  }

  private async resolveBusinessRules(
    ids: string[],
  ): Promise<DevContextBusinessRule[]> {
    const rules = await Promise.all(
      ids.map(async (id) => {
        const event = await this.sessionEvents.findById(id);
        if (!event || event.type !== 'artifact.business_rule') return null;
        const payload = event.payload as {
          title?: string;
          description?: string;
        };
        return {
          title: payload.title ?? '(regra sem título)',
          description: payload.description ?? '',
        };
      }),
    );
    return rules.filter((r): r is DevContextBusinessRule => r !== null);
  }
}
