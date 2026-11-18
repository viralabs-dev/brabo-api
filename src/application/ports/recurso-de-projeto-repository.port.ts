export type TipoDeRecurso = 'container' | 'container_qa';
export type EstadoDeRecurso =
  'pedido' | 'criado' | 'falhou' | 'removendo' | 'removido';

/** AT-980 (ADR 0298, RN-1382): uma linha de `project_resources`. */
export interface RecursoDeProjeto {
  id: string;
  projectId: string;
  tipo: TipoDeRecurso;
  /** Chave da instância de QA; `''` no container de trabalho. */
  chave: string;
  estado: EstadoDeRecurso;
  containerId: string | null;
  motivo: string | null;
  tentativas: number;
  atualizadoEm: Date;
}

export interface GravarRecurso {
  estado: EstadoDeRecurso;
  portas?: unknown[];
  containerId?: string | null;
  motivo?: string | null;
  /** Conta uma tentativa de limpeza. */
  tentativa?: boolean;
}

/** O inventário do que a api pediu ao broker; sem FK com `projects` (sobrevive a ele). */
export abstract class RecursoDeProjetoRepository {
  /** Upsert por (projeto, tipo, chave). */
  abstract gravar(
    projectId: string,
    tipo: TipoDeRecurso,
    chave: string,
    patch: GravarRecurso,
  ): Promise<void>;
  /** Marca `removendo` tudo que o projeto tem e não está `removido`; devolve quantas. */
  abstract marcarRemovendoDoProjeto(projectId: string): Promise<number>;
  /** Fecha a remoção do projeto: `removido` (motivo nulo) ou fica `removendo` com o motivo e +1 tentativa. */
  abstract concluirRemocaoDoProjeto(
    projectId: string,
    motivo: string | null,
  ): Promise<void>;
  abstract listar(estados: EstadoDeRecurso[]): Promise<RecursoDeProjeto[]>;
}
