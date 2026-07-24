import type {
  Epic,
  Story,
  Task,
  StoryStatus,
  TaskStatus,
} from '../../domain/backlog/backlog.entity';

export interface NewEpic {
  projectId: string;
  sessionId: string;
  title: string;
  description?: string;
}

export interface NewStory {
  epicId: string;
  projectId: string;
  sessionId: string;
  title: string;
  description?: string;
  rf?: string[];
  rnf?: string[];
  businessRuleIds?: string[];
  dod?: string[];
  dor?: string[];
}

export interface NewTask {
  storyId: string;
  title: string;
  description?: string;
}

export abstract class EpicRepository {
  abstract create(input: NewEpic): Promise<Epic>;
  abstract findById(id: string): Promise<Epic | null>;
  abstract findByProject(projectId: string): Promise<Epic[]>;
}

export abstract class StoryRepository {
  abstract create(input: NewStory): Promise<Story>;
  abstract findById(id: string): Promise<Story | null>;
  abstract findByProject(projectId: string): Promise<Story[]>;
  abstract updateStatus(id: string, status: StoryStatus): Promise<Story>;
  abstract updateModules(id: string, moduleIds: string[]): Promise<Story>;
}

export abstract class TaskRepository {
  abstract create(input: NewTask): Promise<Task>;
  abstract findById(id: string): Promise<Task | null>;
  abstract findByStoryIds(storyIds: string[]): Promise<Task[]>;
  // Pega ATOMICAMENTE a próxima task `todo` cuja story é `ready` e cujos
  // moduleIds contêm `module` (FOR UPDATE SKIP LOCKED) — 2 devs nunca pegam a
  // mesma. Marca in_progress + assignedTo. Retorna null se não há task pegável.
  abstract claimNext(
    projectId: string,
    module: string,
    agentId: string,
  ): Promise<Task | null>;
  abstract updateStatus(id: string, status: TaskStatus): Promise<Task>;
  // Quantas tasks `todo` de story `ready` estão disponíveis pro módulo — usado
  // pra sugerir paralelização (≥2 = ramos independentes disponíveis).
  abstract countClaimableByModule(
    projectId: string,
    module: string,
  ): Promise<number>;
  // DevAgent não conseguiu concluir (Fase 4a): volta pra `todo` com o
  // diagnóstico, sem dono — EXCLUÍDA do próximo claim automático (ver
  // `claimNext`) até um humano liberar via `unblock`.
  abstract markBlocked(
    id: string,
    reason: string,
    diagnosis: string,
  ): Promise<Task>;
  abstract unblock(id: string): Promise<Task>;
}
