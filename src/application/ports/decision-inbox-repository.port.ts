import type { Role } from '../../domain/iam/role';
import type { ProposedAction } from '../../domain/actions/proposed-action.entity';
import type { HistoriaParaPendencia } from '../../domain/architecture/pendencias-de-arquitetura';

/** Uma fila lida: itens até o teto (já na ordem), total REAL e total por projeto. */
export interface FilaLida<T> {
  total: number;
  itens: T[];
  porProjeto: Record<string, number>;
}

export interface PromocaoLida {
  projectId: string;
  storyId: string;
  titulo: string;
  desde: Date;
  decididaEm: Date | null;
}

export interface HipoteseLida {
  projectId: string;
  hipoteseId: string;
  hipotese: string;
  agenteAlvo: string;
  desde: Date;
  situacao: string;
  decididaEm: Date | null;
}

export interface HistoriaDeArquitetura extends HistoriaParaPendencia {
  projectId: string;
  updatedAt: Date;
}

/** Os projetos que cada fila pode ler (papel mínimo por fila já aplicado). */
export interface ProjetosPorFila {
  aprovacoes: string[];
  prs: string[];
  promocoes: string[];
  arquitetura: string[];
  hipoteses: string[];
}

export interface LeituraDaCaixa {
  aprovacoes: FilaLida<ProposedAction>;
  prs: FilaLida<ProposedAction>;
  promocoes: FilaLida<PromocaoLida>;
  hipoteses: FilaLida<HipoteseLida>;
  /** Histórias não arquivadas dos projetos de arquitetura (derivação em memória). */
  historias: HistoriaDeArquitetura[];
  modulosPorProjeto: Record<string, string[]>;
  /** `actor_id` de agentes com ação PENDENTE (aprovações + PRs), por projeto. */
  agentesAguardando: Record<string, string[]>;
}

/**
 * Leitura em lote das filas de decisão de todos os projetos do workspace
 * (AT-928, ADR 0295). Número de consultas CONSTANTE em N projetos (ADR 0060).
 */
export abstract class DecisionInboxRepository {
  abstract projetosDoWorkspace(
    workspaceId: string,
  ): Promise<{ id: string; name: string }[]>;
  /** UMA leitura das linhas de `project_members` do usuário no workspace. */
  abstract papeisDeProjeto(
    workspaceId: string,
    userId: string,
  ): Promise<{ projectId: string; role: Role }[]>;
  abstract ler(input: {
    status: 'pending' | 'decided';
    desde: Date;
    teto: number;
    projetos: ProjetosPorFila;
  }): Promise<LeituraDaCaixa>;
}
