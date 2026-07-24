import type {
  ModuleMap,
  ModuleNode,
} from '../../domain/architecture/module-map.entity';

export interface NewModuleMap {
  projectId: string;
  sessionId: string;
  modules: ModuleNode[];
  version: number;
}

export abstract class ModuleMapRepository {
  abstract create(input: NewModuleMap): Promise<ModuleMap>;
  // O module_map vigente do projeto (maior version), ou null se nenhum.
  abstract findCurrent(projectId: string): Promise<ModuleMap | null>;
}
