import { Injectable } from '@nestjs/common';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';

@Injectable()
export class ListWorkspacesForUserUseCase {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  execute(userId: string) {
    return this.workspaces.listForUser(userId);
  }
}
