import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from '@nestjs/common';
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
import { GetProjectEventUseCase } from '../../../application/use-cases/sessions/get-project-event.use-case';
import { RunAnamneseUseCase } from '../../../application/use-cases/anamnese/run-anamnese.use-case';

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
    private readonly getProjectEvent: GetProjectEventUseCase,
    private readonly runAnamnese: RunAnamneseUseCase,
  ) {}

  /**
   * Roda a Anamnese agora, sem esperar o tick de 15 min. `maintainer` pelo
   * mesmo motivo da reanálise do Psicólogo: roda o ToolLoop e gasta orçamento.
   */
  @Post('anamnese/run')
  @RequireRole('maintainer')
  run(@Param('projectId') projectId: string) {
    return this.runAnamnese.execute(projectId);
  }

  /**
   * O próprio perfil por default; a visão agregada do time só para quem
   * administra o projeto (owner/maintainer). Perfil de competência é dado
   * SOBRE a pessoa — o default menos surpreendente é ela ver o dela.
   */
  @Get('proficiency')
  @RequireRole('viewer')
  proficiency(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
  ) {
    return this.listProfiles.execute(projectId, user.id);
  }

  /**
   * Um evento do log pelo id, resolvendo a sessão dele — é o que faz o chip
   * de evidência do perfil chegar no evento certo, já que a janela da
   * Anamnese atravessa várias sessões.
   */
  @Get('events/:eventId')
  @RequireRole('viewer')
  event(
    @Param('projectId') projectId: string,
    @Param('eventId') eventId: string,
  ) {
    return this.getProjectEvent.execute(projectId, eventId);
  }

  /**
   * Apaga o PRÓPRIO perfil (não o de outro) e registra o opt-out — sem
   * o opt-out a rodada seguinte re-derivaria tudo e o apagar seria
   * cosmético.
   */
  // `viewer`, não `developer`: a perfilagem cobre TODOS os membros do
  // projeto, então exigir `developer` aqui deixava um viewer perfilado sem
  // poder apagar o próprio perfil — 403 num direito que o enunciado dá.
  @Delete('proficiency/me')
  @RequireRole('viewer')
  deleteMine(@Param('projectId') projectId: string, @CurrentUser() user: User) {
    return this.deleteProfile.execute(projectId, user.id);
  }

  @Post('proficiency/me/opt-in')
  @RequireRole('viewer')
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
    const parsed = Number(version);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException(`versão inválida: "${version}"`);
    }
    return this.rollback.execute(projectId, agent, parsed, user.id);
  }
}
