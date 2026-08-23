import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { SetModelBindingUseCase } from '../../../application/use-cases/llm/set-model-binding.use-case';
import { GetModelBindingUseCase } from '../../../application/use-cases/llm/get-model-binding.use-case';
import { ClearModelBindingUseCase } from '../../../application/use-cases/llm/clear-model-binding.use-case';
import { ResolveModelBindingUseCase } from '../../../application/use-cases/llm/resolve-model-binding.use-case';
import {
  chaveDeAgente,
  chaveDeArea,
} from '../../../domain/llm/binding-scope-id';
import { SetModelBindingDto } from './dto/set-model-binding.dto';
import { BEARER } from '../../../infrastructure/openapi/documento';
import {
  ModelBindingResponseDto,
  ResolvedBindingResponseDto,
} from './dto/llm.response.dto';

/**
 * Qual modelo cada escopo usa.
 *
 * A precedência é sessão → agente → área → projeto → workspace: o mais
 * específico vence. As rotas de LEITURA de sessão, de agente e de área
 * devolvem o binding RESOLVIDO (com a origem), não o binding cru daquele
 * escopo — perguntar "qual modelo esta sessão usa" e receber `null` porque ela
 * não tem binding próprio seria a resposta errada para a pergunta certa.
 *
 * ## O que o ADR 0064 mudou aqui
 *
 * `setAgentBinding` recebia `:projectId` e o DESCARTAVA: o binding de agente
 * era global, e escolher o modelo do Arquiteto na tela de um projeto mudava o
 * modelo dele em todos. Isso deixou de ser sustentável quando a área virou
 * padrão herdável — o padrão seria por projeto e a divergência global, então
 * divergir aqui desfaria a herança lá. O `:projectId` passou a entrar no
 * `scope_id`, e as rotas cumprem o que a URL sempre prometeu.
 */
@ApiTags('llm')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role on the scope.' })
@ApiNotFoundResponse({ description: 'Scope not found.' })
@Controller()
export class ModelBindingsController {
  constructor(
    private readonly setBinding: SetModelBindingUseCase,
    private readonly getBinding: GetModelBindingUseCase,
    private readonly clearBinding: ClearModelBindingUseCase,
    private readonly resolveBinding: ResolveModelBindingUseCase,
  ) {}

  @Get('workspaces/:workspaceId/model-binding')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Reads the workspace model binding',
    description: "This scope's RAW binding. It is the root of the cascade.",
  })
  @ApiOkResponse({ type: ModelBindingResponseDto })
  getWorkspaceBinding(@Param('workspaceId') workspaceId: string) {
    return this.getBinding.execute('workspace', workspaceId);
  }

  @Put('workspaces/:workspaceId/model-binding')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Sets the default model for the workspace',
    description: 'Applies to every project that has no binding of its own.',
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
    summary: 'Reads the project model binding',
    description:
      "This scope's RAW binding — `null` if the project only inherits from the workspace.",
  })
  @ApiOkResponse({ type: ModelBindingResponseDto })
  getProjectBinding(@Param('projectId') projectId: string) {
    return this.getBinding.execute('project', projectId);
  }

  @Put('projects/:projectId/model-binding')
  @RequireRole('maintainer')
  @ApiOperation({ summary: "Sets the project's model" })
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
    summary: 'Resolves which model the session uses, and where it came from',
    description:
      "Returns the binding RESOLVED by the cascade, not the session's raw " +
      "binding: a session with no binding of its own uses the project's, " +
      'and answering `null` here would be the wrong answer to the right ' +
      'question. The `origin` field says which scope the value came from.\n\n' +
      '`agentId` is optional and is the agent REALLY active in the session ' +
      'right now (the same one `RunLlmTurnUseCase` uses to run the turn) — ' +
      'without it, the cascade only sees session→project→workspace (plus the ' +
      'fixed fallback to Creative) and never reflects PO/Architect/Dev Lead/' +
      'area after a handoff.',
  })
  @ApiQuery({
    name: 'agentId',
    required: false,
    description:
      'Agent currently active in this session (e.g. "po", "arquiteto", "dev-lead").',
  })
  @ApiOkResponse({ type: ResolvedBindingResponseDto })
  getSessionBinding(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Query('agentId') agentId?: string,
  ) {
    return this.resolveBinding.execute({ projectId, sessionId, agentId });
  }

  @Put('projects/:projectId/sessions/:sessionId/model-binding')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Pins the model for this session',
    description:
      'Beats everything else in the cascade for as long as the session lives.',
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

  /** Binding RESOLVIDO (cascata workspace→projeto→área→agente, sem sessão). */
  @Get('projects/:projectId/agent-bindings/:agentSlug')
  @RequireRole('viewer')
  @ApiParam({ name: 'agentSlug', example: 'dev-api' })
  @ApiOperation({
    summary: 'Resolves which model an agent uses, and where it came from',
    description:
      'Agent → area → project → workspace cascade, WITHOUT a session: it is ' +
      "the agent's configuration on the project, not that of a specific " +
      'conversation. `origin: "agent"` means this agent DIVERGED from its ' +
      "area's default; any other origin means it inherits.",
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
    summary: "Pins an agent's model in THIS project",
    description:
      'Applies to every session in this project that has no binding of its ' +
      'own, and only to those — before ADR 0064 the binding was global and ' +
      'reached other projects too. This is how a cheap model is given to the ' +
      'Psychologist and an expensive one to the Architect in the same ' +
      "project, and also how an agent DIVERGES from its area's default.",
  })
  @ApiOkResponse({ type: ModelBindingResponseDto })
  setAgentBinding(
    @Param('projectId') projectId: string,
    @Param('agentSlug') agentSlug: string,
    @CurrentUser() user: User,
    @Body() dto: SetModelBindingDto,
  ) {
    return this.setBinding.execute(
      'agent',
      chaveDeAgente(projectId, agentSlug),
      dto.modelId,
      user.id,
    );
  }

  @Delete('projects/:projectId/agent-bindings/:agentSlug')
  @RequireRole('developer')
  @HttpCode(204)
  @ApiParam({ name: 'agentSlug', example: 'dev-api' })
  @ApiOperation({
    summary: "Makes the agent go back to inheriting the area's model",
    description:
      "DELETES the agent's binding — it does not copy the area's model into " +
      'it. Copying would look the same on screen and is not: it would become ' +
      "a copy, and the area's next change would silently leave this agent " +
      'behind. 404 when it already inherits.',
  })
  @ApiNoContentResponse({
    description: 'The agent went back to inheriting. No body.',
  })
  clearAgentBinding(
    @Param('projectId') projectId: string,
    @Param('agentSlug') agentSlug: string,
  ) {
    return this.clearBinding.execute(
      'agent',
      chaveDeAgente(projectId, agentSlug),
    );
  }

  /** Binding RESOLVIDO da ÁREA (cascata workspace→projeto→área). */
  @Get('projects/:projectId/area-bindings/:areaKey')
  @RequireRole('viewer')
  @ApiParam({ name: 'areaKey', example: 'qa' })
  @ApiOperation({
    summary: "Resolves what an area's default model is, and where it came from",
    description:
      'The default the lead and the area\'s subagents share. `origin: "area"` ' +
      'means someone chose it for this area; any other origin means the area ' +
      'itself inherits from the project or the workspace.',
  })
  @ApiOkResponse({ type: ResolvedBindingResponseDto })
  getAreaBinding(
    @Param('projectId') projectId: string,
    @Param('areaKey') areaKey: string,
  ) {
    return this.resolveBinding.execute({ projectId, areaKey });
  }

  // `maintainer`, e não `developer` como no agente: o modelo da área alcança o
  // lead e todos os subagentes de uma vez, e escolher modelo é decidir quanto o
  // produto gasta sem perguntar — o mesmo motivo que põe o teto de paralelismo
  // em `maintainer` (RN-083).
  @Put('projects/:projectId/area-bindings/:areaKey')
  @RequireRole('maintainer')
  @ApiParam({ name: 'areaKey', example: 'qa' })
  @ApiOperation({
    summary: "Sets an area's default model",
    description:
      'Applies to the lead and to every subagent of the area that has no ' +
      'binding of its own (RN-102). Requires `maintainer` because it reaches ' +
      'the whole area at once, and choosing a model is deciding spend — the ' +
      'same reason as the parallelism cap.',
  })
  @ApiOkResponse({ type: ModelBindingResponseDto })
  setAreaBinding(
    @Param('projectId') projectId: string,
    @Param('areaKey') areaKey: string,
    @CurrentUser() user: User,
    @Body() dto: SetModelBindingDto,
  ) {
    return this.setBinding.execute(
      'area',
      chaveDeArea(projectId, areaKey),
      dto.modelId,
      user.id,
    );
  }

  @Delete('projects/:projectId/area-bindings/:areaKey')
  @RequireRole('maintainer')
  @HttpCode(204)
  @ApiParam({ name: 'areaKey', example: 'qa' })
  @ApiOperation({
    summary: "Makes the area go back to inheriting the project's model",
    description:
      'The area stops having its own default and starts inheriting from the ' +
      'project (or the workspace). Agents that diverged keep diverging: their ' +
      'binding is a different one, and deleting this one cannot decide for them.',
  })
  @ApiNoContentResponse({
    description: 'The area went back to inheriting. No body.',
  })
  clearAreaBinding(
    @Param('projectId') projectId: string,
    @Param('areaKey') areaKey: string,
  ) {
    return this.clearBinding.execute('area', chaveDeArea(projectId, areaKey));
  }
}
