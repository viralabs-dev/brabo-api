import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';
import { RoteadorLocal } from '../../ports/roteador-local.port';
import type { Workspace } from '../../../domain/iam/workspace.entity';

export const CODIGO_ROTEADOR_LOCAL_INDISPONIVEL = 'roteador_local_indisponivel';

/**
 * Escolhe quem roteia a ferramenta do passo no workspace (ADR 0179, ADR 0290).
 * `desligado` é o desligador de emergência se o endpoint alpha do Decisions API
 * mudar. `laya` só grava com o serviço PROFICIENTE confirmado na hora (sem
 * cache): senão 409 `roteador_local_indisponivel`, com o estado nomeado. O
 * booleano `enabled` de antes (AT-236) segue aceito: `true` = `jev`.
 */
@Injectable()
export class SetWorkspaceToolRouterUseCase {
  constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly local: RoteadorLocal,
  ) {}

  async execute(
    workspaceId: string,
    escolha: { roteador?: Workspace['toolRouter']; enabled?: boolean },
  ) {
    const roteador =
      escolha.roteador ??
      (escolha.enabled === undefined
        ? undefined
        : escolha.enabled
          ? 'jev'
          : 'desligado');
    if (!roteador) {
      throw new BadRequestException('Informe `roteador` (ou `enabled`).');
    }
    if (roteador === 'laya') {
      const s = await this.local.situacao(true);
      if (s.estado !== 'proficiente') {
        throw new ConflictException({
          code: CODIGO_ROTEADOR_LOCAL_INDISPONIVEL,
          message: `O Laya não está proficiente (${s.estado}${s.motivo ? `: ${s.motivo}` : ''}).`,
          estado: s.estado,
          motivo: s.motivo,
        });
      }
    }
    const workspace = await this.workspaces.setToolRouter(
      workspaceId,
      roteador,
    );
    if (!workspace) throw new NotFoundException('Workspace não encontrado');
    return workspace;
  }
}
