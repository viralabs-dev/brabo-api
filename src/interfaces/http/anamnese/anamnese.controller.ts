import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import {
  DeleteProficiencyProfileUseCase,
  ListProficiencyProfilesUseCase,
  SetAnamneseOptInUseCase,
} from '../../../application/use-cases/anamnese/manage-proficiency.use-case';
import { ListInstructionVersionsUseCase } from '../../../application/use-cases/instructions/list-instruction-versions.use-case';
import { RollbackInstructionUseCase } from '../../../application/use-cases/instructions/rollback-instruction.use-case';

/**
 * Superfície humana da Anamnese (Fase 4b): perfil de proficiência
 * (visível e apagável pelo próprio usuário) e histórico de versões dos
 * arquivos de agente com rollback.
 */
@Controller('projects/:projectId')
export class AnamneseController {
  constructor(
    private readonly listProfiles: ListProficiencyProfilesUseCase,
    private readonly deleteProfile: DeleteProficiencyProfileUseCase,
    private readonly optIn: SetAnamneseOptInUseCase,
    private readonly listVersions: ListInstructionVersionsUseCase,
    private readonly rollback: RollbackInstructionUseCase,
  ) {}

  @Get('proficiency')
  @RequireRole('viewer')
  proficiency(@Param('projectId') projectId: string) {
    return this.listProfiles.execute(projectId);
  }

  /**
   * Apaga o PRÓPRIO perfil (não o de outro) e registra o opt-out — sem
   * o opt-out a rodada seguinte re-derivaria tudo e o apagar seria
   * cosmético.
   */
  @Delete('proficiency/me')
  @RequireRole('developer')
  deleteMine(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
  ) {
    return this.deleteProfile.execute(projectId, user.id);
  }

  @Post('proficiency/me/opt-in')
  @RequireRole('developer')
  optInMine(@Param('projectId') projectId: string, @CurrentUser() user: User) {
    return this.optIn.execute(projectId, user.id);
  }

  @Get('agents/:agent/instruction-versions')
  @RequireRole('viewer')
  versions(
    @Param('projectId') projectId: string,
    @Param('agent') agent: string,
  ) {
    return this.listVersions.execute(projectId, agent);
  }

  /**
   * Rollback de um clique — calibrado em `maintainer` porque muda o
   * COMPORTAMENTO de um agente daí em diante (mesmo calibre do patch).
   */
  @Post('agents/:agent/instruction-versions/:version/rollback')
  @RequireRole('maintainer')
  rollbackVersion(
    @Param('projectId') projectId: string,
    @Param('agent') agent: string,
    @Param('version') version: string,
    @CurrentUser() user: User,
  ) {
    return this.rollback.execute(projectId, agent, Number(version), user.id);
  }
}
