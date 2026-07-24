import type { ModuleNode } from './module-graph';

export type { ModuleNode };

// module_map vigente de um projeto (Fase 3b). Histórico imutável; o vigente é
// o de maior `version`.
export interface ModuleMap {
  id: string;
  projectId: string;
  sessionId: string;
  modules: ModuleNode[];
  version: number;
  createdAt: Date;
}
