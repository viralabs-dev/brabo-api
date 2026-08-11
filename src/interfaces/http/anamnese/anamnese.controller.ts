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
@ApiTags('anamnese')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@ApiNotFoundResponse({ description: 'Projeto, evento ou versão inexistente.' })
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
    summary: 'Roda a Anamnese agora, sem esperar o tick',
    description:
      'Exige `maintainer` pelo mesmo motivo da reanálise do Psicólogo: roda o ' +
      'ToolLoop e gasta orçamento de verdade.',
  })
  @ApiCreatedResponse({ type: OkResponseDto })
  @ApiServiceUnavailableResponse({
    description:
      'A Anamnese está desativada globalmente por decisão do usuário (não é ' +
      'bug) — corpo com `reason: "anamnese_disabled"`.',
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
    summary: 'Devolve o perfil de proficiência',
    description:
      'O PRÓPRIO perfil por default; a visão agregada do time só para quem ' +
      'administra o projeto. Perfil de competência é dado sobre a pessoa, e o ' +
      'default menos surpreendente é ela ver o dela.',
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
    summary: 'Devolve um evento do projeto pelo id, resolvendo a sessão',
    description:
      'Diferente da rota de evento por sessão: aqui a sessão não é conhecida. É o ' +
      'que faz o chip de evidência do perfil chegar no evento certo, já que a janela ' +
      'da Anamnese atravessa várias sessões.',
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
    summary: 'Apaga o próprio perfil e registra o opt-out',
    description:
      'Só o PRÓPRIO perfil, nunca o de outro. O opt-out vem junto porque sem ele a ' +
      'rodada seguinte re-derivaria tudo e o apagar seria cosmético. É `viewer` de ' +
      'propósito: a perfilagem cobre todos os membros, então exigir `developer` ' +
      'deixaria um viewer perfilado sem poder apagar o que é dele.',
  })
  @ApiOkResponse({ type: PerfilApagadoResponseDto })
  deleteMine(@Param('projectId') projectId: string, @CurrentUser() user: User) {
    return this.deleteProfile.execute(projectId, user.id);
  }

  @Post('proficiency/me/opt-in')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Volta a permitir o perfilamento do próprio usuário',
    description:
      'Desfaz o opt-out. Os perfis voltam a ser derivados na próxima rodada.',
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
    summary: 'Lista o histórico de instruções de todos os agentes do projeto',
    description:
      'Parte de quem TEM versão no projeto, não de um roster estático — é o que faz ' +
      'os dev agents por módulo (`dev-api`) aparecerem.',
  })
  @ApiOkResponse({ type: [AgenteComVersoesResponseDto] })
  allVersions(@Param('projectId') projectId: string) {
    return this.listProjectVersions.execute(projectId);
  }

  @Get('agents/:agent/instruction-versions')
  @RequireRole('viewer')
  @ApiParam({ name: 'agent', example: 'dev-api' })
  @ApiOperation({
    summary: 'Lista as versões de instrução de um agente',
    description:
      'Mais recente primeiro, cada uma já com o diff contra a anterior calculado no ' +
      'servidor.',
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
  @ApiParam({ name: 'version', example: 2, description: 'Versão a restaurar.' })
  @ApiOperation({
    summary: 'Restaura uma versão anterior da instrução de um agente',
    description:
      'O histórico é imutável: restaurar não apaga nada, CRIA uma versão nova com o ' +
      'conteúdo antigo. Exige `maintainer` porque muda o comportamento do agente ' +
      'daí em diante — mesmo calibre do patch.',
  })
  @ApiCreatedResponse({ type: RollbackResponseDto })
  @ApiBadRequestResponse({ description: 'Versão não é inteiro positivo.' })
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
