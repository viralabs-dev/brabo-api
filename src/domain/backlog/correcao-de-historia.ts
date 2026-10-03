// Corrigir uma história: editar o título e ARQUIVAR (RN-727, ADR 0212).
//
// Puro e sem framework, como `story-state-machine.ts`: quem traduz a recusa
// para 409 é a camada de aplicação. As travas são as da decisão do dono
// (03/10): só história `draft`, e sem tarefa em execução — uma tarefa
// `in_progress`/`in_review` tem um dev agent trabalhando nela, e tirar a
// história de baixo dele deixaria uma PR sem dono.

import type { Story, Task } from './backlog.entity';

/** Tarefa com dev agent trabalhando nela (pega pelo claim, ou em revisão). */
export const STATUS_DE_TAREFA_EM_EXECUCAO: readonly Task['status'][] = [
  'in_progress',
  'in_review',
];

export type MotivoDaRecusaDeCorrecao =
  | 'historia_arquivada'
  | 'historia_nao_draft'
  | 'historia_com_tarefa_em_execucao';

export interface RecusaDeCorrecao {
  /** O `reason` do corpo do 409 — o nome que a web e o engine reconhecem. */
  reason: MotivoDaRecusaDeCorrecao;
  message: string;
}

/**
 * `null` quando a história pode ser corrigida (título editado ou arquivada);
 * senão o motivo NOMEADO. A ordem importa: arquivada primeiro (é o estado
 * mais definitivo), depois o status, depois as tarefas.
 */
export function recusaDeCorrecaoDeHistoria(
  story: Pick<Story, 'title' | 'status' | 'archivedAt'>,
  tarefas: ReadonlyArray<Pick<Task, 'status'>>,
): RecusaDeCorrecao | null {
  if (story.archivedAt) {
    return {
      reason: 'historia_arquivada',
      message: `A história "${story.title}" já está arquivada.`,
    };
  }
  if (story.status !== 'draft') {
    return {
      reason: 'historia_nao_draft',
      message:
        `A história "${story.title}" está "${story.status}" — só história ` +
        'draft é editada ou arquivada.',
    };
  }
  const emExecucao = tarefas.filter((t) =>
    STATUS_DE_TAREFA_EM_EXECUCAO.includes(t.status),
  ).length;
  if (emExecucao > 0) {
    return {
      reason: 'historia_com_tarefa_em_execucao',
      message:
        `A história "${story.title}" tem ${emExecucao} tarefa(s) em execução ` +
        '— um dev agent está trabalhando nela. Espere a tarefa terminar.',
    };
  }
  return null;
}
