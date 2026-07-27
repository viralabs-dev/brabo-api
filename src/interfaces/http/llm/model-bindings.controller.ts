import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { SetModelBindingUseCase } from '../../../application/use-cases/llm/set-model-binding.use-case';
import { GetModelBindingUseCase } from '../../../application/use-cases/llm/get-model-binding.use-case';
import { ResolveModelBindingUseCase } from '../../../application/use-cases/llm/resolve-model-binding.use-case';
import { SetModelBindingDto } from './dto/set-model-binding.dto';
import { BEARER } from '../../../infrastructure/openapi/documento';
import {
  ModelBindingResponseDto,
  ResolvedBindingResponseDto,
} from './dto/llm.response.dto';

/**
 * Qual modelo cada escopo usa.
 *
 * A precedência é sessão → agente → projeto → workspace: o mais específico
 * vence. As rotas de LEITURA de sessão e de agente devolvem o binding
 * RESOLVIDO (com a origem), não o binding cru daquele escopo — perguntar
 * "qual modelo esta sessão usa" e receber `null` porque ela não tem binding
 * próprio seria a resposta errada para a pergunta certa.
 */
@ApiTags('llm')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Papel insuficiente no escopo.' })
@ApiNotFoundResponse({ description: 'Escopo inexistente.' })
@Controller()
export class ModelBindingsController {
  constructor(
    private readonly setBinding: SetModelBindingUseCase,
    private readonly getBinding: GetModelBindingUseCase,
    private readonly resolveBinding: ResolveModelBindingUseCase,
  ) {}

  @Get('workspaces/:workspaceId/model-binding')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Lê o binding de modelo do workspace',
    description: 'O binding CRU deste escopo. É a raiz da cascata.',
  })
  @ApiOkResponse({ type: ModelBindingResponseDto })
  getWorkspaceBinding(@Param('workspaceId') workspaceId: string) {
    return this.getBinding.execute('workspace', workspaceId);
  }

  @Put('workspaces/:workspaceId/model-binding')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Define o modelo default do workspace',
    description: 'Vale para todos os projetos que não tenham binding próprio.',
  })
  @ApiOkResponse({ type: ModelBindingResponseDto })
  setWorkspaceBinding(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: User,
    @Body() dto: SetModelBindingDto,
  ) {
    return this.setBinding.execute(
      'workspace',
      workspaceId,
      dto.modelId,
      user.id,
    );
  }

  @Get('projects/:projectId/model-binding')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Lê o binding de modelo do projeto',
    description:
      'O binding CRU deste escopo — `null` se o projeto só herda do workspace.',
  })
  @ApiOkResponse({ type: ModelBindingResponseDto })
  getProjectBinding(@Param('projectId') projectId: string) {
    return this.getBinding.execute('project', projectId);
  }

  @Put('projects/:projectId/model-binding')
  @RequireRole('maintainer')
  @ApiOperation({ summary: 'Define o modelo do projeto' })
  @ApiOkResponse({ type: ModelBindingResponseDto })
  setProjectBinding(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
    @Body() dto: SetModelBindingDto,
  ) {
    return this.setBinding.execute('project', projectId, dto.modelId, user.id);
  }

  /** Retorna o binding RESOLVIDO (cascata aplicada) + a origem — não o binding cru de sessão. */
  @Get('projects/:projectId/sessions/:sessionId/model-binding')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Resolve qual modelo a sessão usa, e de onde ele veio',
    description:
      'Devolve o binding RESOLVIDO pela cascata, não o binding cru da sessão: uma ' +
      'sessão sem binding próprio usa o do projeto, e responder `null` aqui seria ' +
      'a resposta errada para a pergunta certa. O campo `origin` diz de qual ' +
      'escopo o valor veio.',
  })
  @ApiOkResponse({ type: ResolvedBindingResponseDto })
  getSessionBinding(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.resolveBinding.execute({ projectId, sessionId });
  }

  @Put('projects/:projectId/sessions/:sessionId/model-binding')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Fixa o modelo desta sessão',
    description: 'Vence tudo o mais na cascata enquanto a sessão viver.',
  })
  @ApiOkResponse({ type: ModelBindingResponseDto })
  setSessionBinding(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: User,
    @Body() dto: SetModelBindingDto,
  ) {
    return this.setBinding.execute('session', sessionId, dto.modelId, user.id);
  }

  /** Binding RESOLVIDO (cascata workspace→projeto→agente, sem sessão). */
  @Get('projects/:projectId/agent-bindings/:agentSlug')
  @RequireRole('viewer')
  @ApiParam({ name: 'agentSlug', example: 'dev-api' })
  @ApiOperation({
    summary: 'Resolve qual modelo um agente usa, e de onde ele veio',
    description:
      'Cascata agente → projeto → workspace, SEM sessão: é a configuração do agente ' +
      'no projeto, não a de uma conversa específica.',
  })
  @ApiOkResponse({ type: ResolvedBindingResponseDto })
  getAgentBinding(
    @Param('projectId') projectId: string,
    @Param('agentSlug') agentSlug: string,
  ) {
    return this.resolveBinding.execute({ projectId, agentId: agentSlug });
  }

  @Put('projects/:projectId/agent-bindings/:agentSlug')
  @RequireRole('developer')
  @ApiParam({ name: 'agentSlug', example: 'dev-api' })
  @ApiOperation({
    summary: 'Fixa o modelo de um agente no projeto',
    description:
      'Vale para todas as sessões que não tenham binding próprio. É como se dá um ' +
      'modelo barato ao Psicólogo e um caro ao Arquiteto no mesmo projeto.',
  })
  @ApiOkResponse({ type: ModelBindingResponseDto })
  setAgentBinding(
    @Param('projectId') _projectId: string,
    @Param('agentSlug') agentSlug: string,
    @CurrentUser() user: User,
    @Body() dto: SetModelBindingDto,
  ) {
    return this.setBinding.execute('agent', agentSlug, dto.modelId, user.id);
  }
}
