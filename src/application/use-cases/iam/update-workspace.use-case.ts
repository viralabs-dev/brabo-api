import { Injectable, NotFoundException } from '@nestjs/common';
import {
  WorkspaceRepository,
  type WorkspaceInput,
} from '../../ports/workspace-repository.port';

@Injectable()
export class UpdateWorkspaceUseCase {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  async execute(id: string, input: Partial<WorkspaceInput>) {
    const row = await this.workspaces.update(id, input);
    if (!row) throw new NotFoundException('Workspace não encontrado');
    return row;
  }
}
