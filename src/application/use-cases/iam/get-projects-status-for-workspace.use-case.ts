import { Injectable } from '@nestjs/common';
import { TaskRepository } from '../../ports/backlog-repository.port';

/** Contagem de tasks bloqueadas por projeto — alimenta o dot de status da sidebar. */
export interface ProjectBlockedStatus {
  projectId: string;
  blockedTaskCount: number;
}

@Injectable()
export class GetProjectsStatusForWorkspaceUseCase {
  constructor(private readonly tasks: TaskRepository) {}

  async execute(workspaceId: string): Promise<ProjectBlockedStatus[]> {
    const rows = await this.tasks.countBlockedByWorkspace(workspaceId);
    return rows.map((row) => ({
      projectId: row.projectId,
      blockedTaskCount: row.total,
    }));
  }
}
