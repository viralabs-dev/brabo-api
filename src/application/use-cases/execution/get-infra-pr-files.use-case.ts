import { Injectable, NotFoundException } from '@nestjs/common';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';

export interface InfraPrFile {
  path: string;
  content: string;
}

export interface InfraPrFiles {
  title: string;
  files: InfraPrFile[];
}

/**
 * Lê de volta o payload (title + files) da proposed_action `open_infra_pr`
 * já proposta — usado pelo `Engine.Infra.InfraGateRunner` (Fase 4a) pra
 * rodar hadolint/gitleaks/semgrep sobre os arquivos SEM worktree (o
 * InfraAgent nunca escreve num worktree, os arquivos vivem só no payload).
 */
@Injectable()
export class GetInfraPrFilesUseCase {
  constructor(private readonly proposedActions: ProposedActionRepository) {}

  async execute(projectId: string, prActionId: string): Promise<InfraPrFiles> {
    const actions = await this.proposedActions.listByProjectAndType(
      projectId,
      'open_infra_pr',
    );
    const action = actions.find((a) => a.id === prActionId);
    if (!action) {
      throw new NotFoundException(
        `Ação de PR de infra "${prActionId}" não encontrada`,
      );
    }

    const payload = action.payload as InfraPrFiles;
    return { title: payload.title, files: payload.files };
  }
}
