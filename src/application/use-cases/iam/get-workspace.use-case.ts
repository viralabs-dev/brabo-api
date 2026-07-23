import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';

@Injectable()
export class GetWorkspaceUseCase {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  async execute(id: string) {
    const workspace = await this.workspaces.findById(id);
    if (!workspace) throw new NotFoundException('Workspace não encontrado');
    return workspace;
  }
}
