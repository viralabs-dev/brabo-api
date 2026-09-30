import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';

/**
 * Liga ou desliga o roteamento de ferramenta pelo Jev no workspace (ADR 0179,
 * AT-236 resposta 3). É o desligador de emergência se o endpoint alpha do
 * Decisions API mudar: desligado, nenhuma chamada ao Jev sai e nenhum evento
 * `tool_router.decided` é gravado — o passo é o de antes.
 */
@Injectable()
export class SetWorkspaceToolRouterUseCase {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  async execute(workspaceId: string, enabled: boolean) {
    const workspace = await this.workspaces.setToolRouterEnabled(
      workspaceId,
      enabled,
    );
    if (!workspace) throw new NotFoundException('Workspace não encontrado');
    return workspace;
  }
}
