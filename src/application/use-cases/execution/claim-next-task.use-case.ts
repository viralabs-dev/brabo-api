import { Injectable } from '@nestjs/common';
import { TaskRepository } from '../../ports/backlog-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import type { SessionEvent } from '../../../domain/sessions/session-event.entity';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

export type RetomadaDaTarefa = {
  retomada: 'merge_conflict' | null;
  conflictingFiles: string[];
};

const doTask = (taskId: string) => (e: SessionEvent) =>
  (e.payload as { taskId?: unknown } | null)?.taskId === taskId;
const maisRecente = (eventos: SessionEvent[]) =>
  eventos.reduce<SessionEvent | undefined>(
    (a, e) => (!a || e.createdAt.getTime() >= a.createdAt.getTime() ? e : a),
    undefined,
  );

/**
 * RN-1441: a tarefa foi reaberta por conflito de merge e ainda não foi
 * reentregue nem bloqueada? O evento mais recente da tarefa entre
 * `task_status_changed` e `task_blocked` diz: é `task_status_changed` com
 * `cause: merge_conflict`. Função pura, testável sem banco.
 */
export function retomadaDaTarefa(
  taskId: string,
  statusEBloqueios: SessionEvent[],
  conflitos: SessionEvent[],
): RetomadaDaTarefa {
  const ultimo = maisRecente(statusEBloqueios.filter(doTask(taskId)));
  const reaberta =
    ultimo?.type === 'backlog.task_status_changed' &&
    (ultimo.payload as { cause?: unknown }).cause === 'merge_conflict';
  if (!reaberta) return { retomada: null, conflictingFiles: [] };
  const arquivos = (
    maisRecente(conflitos.filter(doTask(taskId)))?.payload as
      { conflictingFiles?: unknown } | undefined
  )?.conflictingFiles;
  return {
    retomada: 'merge_conflict',
    conflictingFiles: Array.isArray(arquivos)
      ? arquivos.filter((f): f is string => typeof f === 'string')
      : [],
  };
}

/**
 * Um dev "pega" a próxima task pegável do seu módulo (task `todo` de story
 * `ready`), atômico (FOR UPDATE SKIP LOCKED — dois devs nunca pegam a mesma).
 * Chamado pelo DevAgentServer via endpoint interno. Emite `backlog.task_claimed`
 * quando pega algo. A resposta diz se a tarefa volta de um conflito de merge
 * (RN-1441), para o engine não tratá-la como trabalho novo.
 */
@Injectable()
export class ClaimNextTaskUseCase {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly sessionEvents: SessionEventRepository,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    module: string,
    agentId: string,
  ) {
    const task = await this.tasks.claimNext(projectId, module, agentId);
    if (!task) return task;
    // Lido ANTES de gravar o `task_claimed`.
    const [mudancas, bloqueios, conflitos] = await Promise.all([
      this.sessionEvents.listByTypeForProject(
        projectId,
        'backlog.task_status_changed',
      ),
      this.sessionEvents.listByTypeForProject(
        projectId,
        'backlog.task_blocked',
      ),
      this.sessionEvents.listByTypeForProject(
        projectId,
        'backlog.task_merge_conflict',
      ),
    ]);
    const retomada = retomadaDaTarefa(
      task.id,
      [...mudancas, ...bloqueios],
      conflitos,
    );
    await this.appendEvent.execute(projectId, sessionId, {
      type: 'backlog.task_claimed',
      actor: { kind: 'agent', id: agentId },
      payload: { taskId: task.id, title: task.title, module },
    });
    return { ...task, ...retomada };
  }
}
