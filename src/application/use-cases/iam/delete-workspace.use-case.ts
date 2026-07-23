import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';

@Injectable()
export class DeleteWorkspaceUseCase {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  async execute(id: string) {
    const row = await this.workspaces.remove(id);
    if (!row) throw new NotFoundException('Workspace não encontrado');
    return row;
  }
}
