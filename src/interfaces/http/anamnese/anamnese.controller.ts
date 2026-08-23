import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
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
import { ListProjectInstructionVersionsUseCase } from '../../../application/use-cases/instructions/list-instruction-versions.use-case';
import { GetProjectEventUseCase } from '../../../application/use-cases/sessions/get-project-event.use-case';
import { RunAnamneseUseCase } from '../../../application/use-cases/anamnese/run-anamnese.use-case';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { OkResponseDto } from '../shared/dto/comuns.response.dto';
import { SessionEventResponseDto } from '../sessions/dto/sessions.response.dto';
import {
  AgenteComVersoesResponseDto,
  InstructionVersionResponseDto,
  PerfilApagadoResponseDto,
  PerfilOptInResponseDto,
  ProficiencyProfileResponseDto,
  RollbackResponseDto,
} from './dto/anamnese.response.dto';

/**
 * Superfície humana da Anamnese (Fase 4b): perfil de proficiência
 * (visível e apagável pelo próprio usuário) e histórico de versões dos
 * arquivos de agente com rollback.
 */
@ApiTags('anamnesis')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role on the project.' })
@ApiNotFoundResponse({ description: 'Project, event, or version does not exist.' })
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
    private readonly listProjectVersions: ListProjectInstructionVersionsUseCase,
  ) {}

  /**
   * Roda a Anamnese agora, sem esperar o tick de 15 min. `maintainer` pelo
   * mesmo motivo da reanálise do Psicólogo: roda o ToolLoop e gasta orçamento.
   */
  @Post('anamnese/run')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Runs the Anamnese now, without waiting for the tick',
    description:
      'Requires `maintainer` for the same reason as the Psychologist reanalysis: ' +
      'it runs the ToolLoop and spends real budget.',
  })
  @ApiCreatedResponse({ type: OkResponseDto })
  @ApiServiceUnavailableResponse({
    description:
      "The Anamnese is disabled globally by the user's decision (not a bug) " +
      '— body with `reason: "anamnese_disabled"`.',
  })
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
  @ApiOperation({
    summary: 'Returns the proficiency profile',
    description:
      "The user's OWN profile by default; the aggregated team view only for " +
      'whoever administers the project. A competency profile is data ABOUT the ' +
      'person, and the least surprising default is seeing your own.',
  })
  @ApiOkResponse({ type: [ProficiencyProfileResponseDto] })
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
  @ApiOperation({
    summary: "Returns a project event by id, resolving its session",
    description:
      "Different from the event-by-session route: here the session isn't known. " +
      "This is what makes the profile's evidence chip land on the right event, " +
      "since the Anamnese's window spans several sessions.",
  })
  @ApiOkResponse({ type: SessionEventResponseDto })
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
  @ApiOperation({
    summary: 'Deletes your own profile and records the opt-out',
    description:
      'Only the caller\'s OWN profile, never someone else\'s. The opt-out comes ' +
      'along because without it the next round would re-derive everything and the ' +
      'deletion would be cosmetic. It is `viewer` on purpose: profiling covers all ' +
      'members, so requiring `developer` would leave a profiled viewer unable to ' +
      'delete their own.',
  })
  @ApiOkResponse({ type: PerfilApagadoResponseDto })
  deleteMine(@Param('projectId') projectId: string, @CurrentUser() user: User) {
    return this.deleteProfile.execute(projectId, user.id);
  }

  @Post('proficiency/me/opt-in')
  @RequireRole('viewer')
  @ApiOperation({
    summary: "Re-enables the user's own profiling",
    description:
      'Undoes the opt-out. Profiles start being derived again from the next round on.',
  })
  @ApiCreatedResponse({ type: PerfilOptInResponseDto })
  optInMine(@Param('projectId') projectId: string, @CurrentUser() user: User) {
    return this.optIn.execute(projectId, user.id);
  }

  /**
   * Histórico de TODOS os agentes que têm versão neste projeto. A UI listava
   * fazendo fan-out sobre um roster estático, e por isso nunca via os dev
   * agents por módulo (`dev-api`) — os que existem de verdade.
   */
  @Get('instruction-versions')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Lists the instruction history of every agent in the project',
    description:
      'Starts from whoever HAS a version in the project, not from a static ' +
      'roster — this is what makes the per-module dev agents (`dev-api`) show up.',
  })
  @ApiOkResponse({ type: [AgenteComVersoesResponseDto] })
  allVersions(@Param('projectId') projectId: string) {
    return this.listProjectVersions.execute(projectId);
  }

  @Get('agents/:agent/instruction-versions')
  @RequireRole('viewer')
  @ApiParam({ name: 'agent', example: 'dev-api' })
  @ApiOperation({
    summary: "Lists an agent's instruction versions",
    description:
      "Most recent first, each already carrying its diff against the previous " +
      'one, computed server-side.',
  })
  @ApiOkResponse({ type: [InstructionVersionResponseDto] })
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
  @ApiParam({ name: 'agent', example: 'dev-api' })
  @ApiParam({ name: 'version', example: 2, description: 'Version to restore.' })
  @ApiOperation({
    summary: "Restores a previous version of an agent's instruction",
    description:
      'The history is immutable: restoring deletes nothing, it CREATES a new ' +
      'version with the old content. Requires `maintainer` because it changes ' +
      "the agent's behavior from that point on — same calibration as the patch.",
  })
  @ApiCreatedResponse({ type: RollbackResponseDto })
  @ApiBadRequestResponse({ description: 'Version is not a positive integer.' })
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
