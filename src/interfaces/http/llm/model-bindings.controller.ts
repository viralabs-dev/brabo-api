import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
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
@ApiForbiddenResponse({ description: 'Papel insuficiente no escopo.' })
@ApiNotFoundResponse({ description: 'Escopo inexistente.' })
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

  /** Binding RESOLVIDO (cascata workspace→projeto→área→agente, sem sessão). */
  @Get('projects/:projectId/agent-bindings/:agentSlug')
  @RequireRole('viewer')
  @ApiParam({ name: 'agentSlug', example: 'dev-api' })
  @ApiOperation({
    summary: 'Resolve qual modelo um agente usa, e de onde ele veio',
    description:
      'Cascata agente → área → projeto → workspace, SEM sessão: é a configuração do ' +
      'agente no projeto, não a de uma conversa específica. `origin: "agent"` quer ' +
      'dizer que este agente DIVERGIU do padrão da área dele; qualquer outra origem ' +
      'quer dizer que ele herda.',
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
    summary: 'Fixa o modelo de um agente NESTE projeto',
    description:
      'Vale para todas as sessões deste projeto que não tenham binding próprio, e ' +
      'só para elas — até o ADR 0064 o binding era global e alcançava os outros ' +
      'projetos. É como se dá um modelo barato ao Psicólogo e um caro ao Arquiteto ' +
      'no mesmo projeto, e é também como um agente DIVERGE do padrão da área dele.',
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
    summary: 'Faz o agente voltar a herdar o modelo da área',
    description:
      'APAGA o binding do agente — não copia para ele o modelo da área. Copiar ' +
      'pareceria o mesmo na tela e não é: viraria uma cópia, e a próxima mudança da ' +
      'área deixaria este agente para trás em silêncio. 404 quando ele já herda.',
  })
  @ApiNoContentResponse({ description: 'O agente voltou a herdar. Sem corpo.' })
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
    summary: 'Resolve qual modelo é o padrão de uma área, e de onde ele veio',
    description:
      'O padrão que o lead e os subagentes da área compartilham. `origin: "area"` ' +
      'quer dizer que alguém o escolheu para esta área; qualquer outra origem quer ' +
      'dizer que a própria área herda do projeto ou do workspace.',
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
    summary: 'Define o modelo padrão de uma área',
    description:
      'Vale para o lead e para todo subagente da área que não tenha binding próprio ' +
      '(RN-102). Exige `maintainer` porque alcança a área inteira de uma vez, e ' +
      'escolher modelo é decidir gasto — o mesmo motivo do teto de paralelismo.',
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
    summary: 'Faz a área voltar a herdar o modelo do projeto',
    description:
      'A área deixa de ter padrão próprio e passa a herdar do projeto (ou do ' +
      'workspace). Os agentes que divergiram continuam divergindo: o binding deles ' +
      'é outro, e apagar este não pode decidir por eles.',
  })
  @ApiNoContentResponse({ description: 'A área voltou a herdar. Sem corpo.' })
  clearAreaBinding(
    @Param('projectId') projectId: string,
    @Param('areaKey') areaKey: string,
  ) {
    return this.clearBinding.execute('area', chaveDeArea(projectId, areaKey));
  }
}
