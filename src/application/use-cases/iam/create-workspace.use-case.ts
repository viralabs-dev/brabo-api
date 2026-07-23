import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import {
  WorkspaceRepository,
  type WorkspaceInput,
} from '../../ports/workspace-repository.port';

@Injectable()
export class CreateWorkspaceUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly workspaces: WorkspaceRepository,
  ) {}

  execute(userId: string, input: WorkspaceInput) {
    return this.unitOfWork.runInTransaction(async () => {
      const workspace = await this.workspaces.create({
        ...input,
        createdBy: userId,
      });
      await this.workspaces.addMember(workspace.id, userId, 'owner');
      return workspace;
    });
  }
}
