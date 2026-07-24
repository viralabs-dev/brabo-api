import type {
  Epic,
  Story,
  Task,
  StoryStatus,
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
}

export abstract class TaskRepository {
  abstract create(input: NewTask): Promise<Task>;
  abstract findByStoryIds(storyIds: string[]): Promise<Task[]>;
}
