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
  // AT-381 (RN-709): o resumo CALCULADO do plano — tarefas por módulo — e os
  // módulos do `module_map` que ficaram sem tarefa e por isso sem agente. É o
  // que o Dev Lead cita ao narrar, em vez de recontar de memória.
  tarefasPorModulo?: Record<string, number>;
  modulosSemTarefa?: string[];
  // Só no `failed`: o motivo nomeado (a mesma frase da recusa da ativação).
  motivo?: string;
}
