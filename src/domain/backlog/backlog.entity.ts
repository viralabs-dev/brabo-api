import type { StoryStatus } from './story-state-machine';

export type { StoryStatus };

export interface Epic {
  id: string;
  projectId: string;
  sessionId: string;
  title: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Story {
  id: string;
  epicId: string;
  projectId: string;
  sessionId: string;
  title: string;
  description: string;
  rf: string[];
  rnf: string[];
  businessRuleIds: string[];
  dod: string[];
  dor: string[];
  moduleIds: string[];
  status: StoryStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface Task {
  id: string;
  storyId: string;
  title: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

// Árvore aninhada pro endpoint de backlog / UI.
export interface StoryWithTasks extends Story {
  tasks: Task[];
}

export interface EpicWithStories extends Epic {
  stories: StoryWithTasks[];
}
