import type { StatusDeInstanciaDeQa } from '../../domain/containers/instancia-de-qa';

export interface InstanciaDeQa {
  id: string;
  projectId: string;
  taskId: string;
  status: StatusDeInstanciaDeQa;
}

/** AT-612 (RN-935): a tabela `project_qa_environments`. */
export abstract class QaEnvironmentRepository {
  /** Ids de tarefa DO PROJETO que casam com a referência (id completo ou chave de 8). */
  abstract resolverTarefas(
    projectId: string,
    ref: { id: string } | { chave: string },
  ): Promise<string[]>;
  abstract find(
    projectId: string,
    taskId: string,
  ): Promise<InstanciaDeQa | null>;
  abstract findAtivaDoProjeto(projectId: string): Promise<InstanciaDeQa | null>;
  /** Ativas e `failed` (podem ter deixado container para trás), de todos os projetos ou de um. */
  abstract listarParaLimpeza(projectId?: string): Promise<InstanciaDeQa[]>;
  /** Cria em `provisioning`. O índice parcial único lança se o projeto já tem uma ativa. */
  abstract criar(projectId: string, taskId: string): Promise<InstanciaDeQa>;
  abstract atualizarStatus(
    id: string,
    status: StatusDeInstanciaDeQa,
  ): Promise<InstanciaDeQa>;
}
