import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';
import { RoteadorLocal } from '../../ports/roteador-local.port';

/** A escolha do workspace mais o estado do Laya (cache de 30 s, teto de 1 s; ADR 0290). */
@Injectable()
export class GetWorkspaceToolRouterUseCase {
  constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly local: RoteadorLocal,
  ) {}

  async execute(workspaceId: string) {
    const workspace = await this.workspaces.findById(workspaceId);
    if (!workspace) throw new NotFoundException('Workspace não encontrado');
    return {
      roteador: workspace.toolRouter,
      laya: await this.local.situacao(),
    };
  }
}
