import { Injectable } from '@nestjs/common';
import {
  EpicRepository,
  StoryRepository,
  TaskRepository,
} from '../../ports/backlog-repository.port';
import type {
  EpicWithStories,
  StoryWithTasks,
} from '../../../domain/backlog/backlog.entity';

/**
 * Backlog do projeto como árvore épico → história → tarefa (pra a tab
 * Backlog). Monta em memória a partir de 3 leituras por projeto (evita N+1).
 */
@Injectable()
export class ListBacklogUseCase {
  constructor(
    private readonly epics: EpicRepository,
    private readonly stories: StoryRepository,
    private readonly tasks: TaskRepository,
  ) {}

  async execute(projectId: string): Promise<EpicWithStories[]> {
    const [epics, stories] = await Promise.all([
      this.epics.findByProject(projectId),
      this.stories.findByProject(projectId),
    ]);
    const tasks = await this.tasks.findByStoryIds(stories.map((s) => s.id));

    const tasksByStory = new Map<string, StoryWithTasks['tasks']>();
    for (const task of tasks) {
      const list = tasksByStory.get(task.storyId) ?? [];
      list.push(task);
      tasksByStory.set(task.storyId, list);
    }

    const storiesByEpic = new Map<string, StoryWithTasks[]>();
    for (const story of stories) {
      const withTasks: StoryWithTasks = {
        ...story,
        tasks: tasksByStory.get(story.id) ?? [],
      };
      const list = storiesByEpic.get(story.epicId) ?? [];
      list.push(withTasks);
      storiesByEpic.set(story.epicId, list);
    }

    return epics.map((epic) => ({
      ...epic,
      stories: storiesByEpic.get(epic.id) ?? [],
    }));
  }
}
