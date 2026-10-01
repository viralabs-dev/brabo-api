// Resultado da execução de um `propose_execution_plan` aprovado (AT-263/274,
// RN-677/678, ADR 0194): a ATIVAÇÃO da execução que a aprovação dispara, e
// quantas tarefas ganharam módulo. Guardado em
// proposed_actions.execution_result; é ele que o Dev Lead lê ao retomar o
// turno (`texto_do_desfecho/1`, pela chave `sessaoDeExecucao`).
export interface ExecutionPlanExecutionResult {
  // A sessão de execução onde os dev agents rodam — `null` quando falhou.
  sessaoDeExecucao: string | null;
  modulos: string[];
  tarefasAtribuidas: number;
  // Só no `failed`: o motivo nomeado (a mesma frase da recusa da ativação).
  motivo?: string;
}
