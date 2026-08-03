import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ListModelsUseCase } from '../../../application/use-cases/llm/list-models.use-case';
import { ListModelCatalogUseCase } from '../../../application/use-cases/llm/list-model-catalog.use-case';
import { SetModelsActiveUseCase } from '../../../application/use-cases/llm/set-models-active.use-case';
import { SyncModelCatalogUseCase } from '../../../application/use-cases/llm/sync-model-catalog.use-case';
import { UpdateModelPricingUseCase } from '../../../application/use-cases/llm/update-model-pricing.use-case';
import { ListModelPriceChangesUseCase } from '../../../application/use-cases/llm/list-model-price-changes.use-case';
import { RequireRole } from '../iam/require-role.decorator';
import { BEARER } from '../../../infrastructure/openapi/documento';
import {
  ModelComCuradoriaResponseDto,
  ModelPriceChangeResponseDto,
  ModelResponseDto,
} from './dto/llm.response.dto';
import { SetModelsActiveDto } from './dto/set-models-active.dto';
import { UpdateModelPricingDto } from './dto/update-model-pricing.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { SyncModelCatalogResponseDto } from '../internal/dto/model-sync.response.dto';

/**
 * ## Por que a curadoria pende de um `:workspaceId`
 *
 * O `RolesGuard` resolve o papel efetivo a partir de `:projectId` ou
 * `:workspaceId` na rota — sem um dos dois ele não tem de onde tirar papel
 * nenhum, e um `@RequireRole` numa rota sem escopo reprovaria SEMPRE.
 *
 * Desde o ADR 0049 o workspace no caminho deixou de ser só âncora de RBAC: ele
 * é o RECORTE dos dados. A tabela `models` continua global (nome, preço e
 * capabilities são fato do provider, iguais para todo mundo), mas a curadoria
 * — quais desses modelos aparecem no seletor — vive em `workspace_models`, uma
 * linha por (workspace, modelo).
 *
 * A rota do seletor pende de `:projectId`, e não de `:workspaceId`, porque é
 * assim que a pergunta nasce nas telas que a consomem; o workspace sai do
 * projeto dentro do caso de uso.
 */
@ApiTags('llm')
@ApiBearerAuth(BEARER)
@Controller()
export class ModelsController {
  constructor(
    private readonly listModels: ListModelsUseCase,
    private readonly listCatalog: ListModelCatalogUseCase,
    private readonly setModelsActive: SetModelsActiveUseCase,
    private readonly syncCatalog: SyncModelCatalogUseCase,
    private readonly updateModelPricing: UpdateModelPricingUseCase,
    private readonly listPriceChanges: ListModelPriceChangesUseCase,
  ) {}

  /**
   * O schema é declarado à mão, e não por `type:`, porque a forma é
   * `Record<categoria, Record<provider, Model[]>>` — os dois níveis internos
   * têm chaves DINÂMICAS (o nome do provider), e não existe classe que
   * expresse isso. `additionalProperties` é a forma correta em OpenAPI.
   */
  @Get('projects/:projectId/models')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Lista os modelos ativos NO WORKSPACE do projeto',
    description:
      'Categoria `local` são os do Ollama, que não gastam dinheiro; `cloud` são os ' +
      'de API paga. Modelo que o workspace não ativou não aparece aqui, mas ' +
      'continua nos custos históricos — para vê-lo use a rota de catálogo. ' +
      'A lista é do workspace DONO do projeto: o mesmo modelo pode estar ' +
      'ligado num workspace e desligado no vizinho (ADR 0049).',
  })
  @ApiExtraModels(ModelResponseDto)
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        local: {
          type: 'object',
          additionalProperties: {
            type: 'array',
            items: { $ref: getSchemaPath(ModelResponseDto) },
          },
        },
        cloud: {
          type: 'object',
          additionalProperties: {
            type: 'array',
            items: { $ref: getSchemaPath(ModelResponseDto) },
          },
        },
      },
      example: {
        local: { ollama: [] },
        cloud: { anthropic: [], openai: [] },
      },
    },
  })
  list(@Param('projectId') projectId: string) {
    return this.listModels.execute(projectId);
  }

  @Get('workspaces/:workspaceId/models/catalog')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Lista o catálogo INTEIRO, inclusive inativo e indisponível',
    description:
      'A tela de curadoria. Modelo descoberto pelo sync entra `isActive: false` ' +
      'e só aparece aqui até alguém ativá-lo; modelo que sumiu do provider vem ' +
      'com `availability: "unavailable"` e nunca é deletado, porque bindings e ' +
      'histórico de custo apontam para ele. O `isActive` é DESTE workspace ' +
      '(ADR 0049); `availability` é global, porque é o que o sync observou no ' +
      'provider.',
  })
  @ApiExtraModels(ModelComCuradoriaResponseDto)
  @ApiForbiddenResponse({ description: 'Papel insuficiente no workspace.' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        local: {
          type: 'object',
          additionalProperties: {
            type: 'array',
            items: { $ref: getSchemaPath(ModelComCuradoriaResponseDto) },
          },
        },
        cloud: {
          type: 'object',
          additionalProperties: {
            type: 'array',
            items: { $ref: getSchemaPath(ModelComCuradoriaResponseDto) },
          },
        },
      },
      example: {
        local: { ollama: [] },
        cloud: { anthropic: [], openai: [] },
      },
    },
  })
  catalog(@Param('workspaceId') workspaceId: string) {
    return this.listCatalog.execute(workspaceId);
  }

  @Post('workspaces/:workspaceId/models/activate')
  // Não cria nada — muda a curadoria de linhas que já existem. 201 mentiria.
  @HttpCode(200)
  @RequireRole('owner')
  @ApiOperation({
    summary: 'Liga ou desliga modelos no seletor (lote)',
    description:
      'Curadoria do owner, VALENDO SÓ NESTE WORKSPACE (ADR 0049). Só mexe em ' +
      '`isActive` — `availability` é o que o sync observou no provider, é ' +
      'global e não se altera por aqui. Lote inteiro ou nada: um id ' +
      'inexistente reprova a chamada sem aplicar nenhuma linha.',
  })
  @ApiOkResponse({ type: [ModelComCuradoriaResponseDto] })
  @ApiForbiddenResponse({ description: 'Exige `owner` no workspace.' })
  @ApiNotFoundResponse({ description: 'Algum id do lote não existe.' })
  activate(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: User,
    @Body() dto: SetModelsActiveDto,
  ) {
    return this.setModelsActive.execute({
      workspaceId,
      modelIds: dto.modelIds,
      isActive: dto.isActive,
      curatedBy: user.id,
    });
  }

  @Post('workspaces/:workspaceId/models/sync')
  @HttpCode(200)
  @RequireRole('owner')
  @ApiOperation({
    summary: 'Força agora o sync de catálogo que o job periódico faz',
    description:
      'Mesmo caso de uso da rota interna que o engine agenda — o botão de ' +
      'atualizar da tela de curadoria não tem um caminho próprio, para não ' +
      'existirem duas reconciliações que possam divergir.',
  })
  @ApiOkResponse({ type: SyncModelCatalogResponseDto })
  @ApiForbiddenResponse({ description: 'Exige `owner` no workspace.' })
  sync() {
    return this.syncCatalog.execute();
  }

  @Patch('workspaces/:workspaceId/models/:modelId/pricing')
  @RequireRole('owner')
  @ApiOperation({
    summary: 'Corrige o preço de um modelo',
    description:
      'Vale daqui em diante e NUNCA reprecifica o passado: cada linha de ' +
      '`token_usage` guarda o preço que produziu o custo dela. A mudança fica ' +
      'registrada com o par antes/depois — consultável na rota de histórico.',
  })
  @ApiOkResponse({ type: ModelResponseDto })
  @ApiForbiddenResponse({ description: 'Exige `owner` no workspace.' })
  @ApiNotFoundResponse({ description: 'Modelo inexistente.' })
  updatePricing(
    @CurrentUser() user: User,
    @Param('modelId') modelId: string,
    @Body() dto: UpdateModelPricingDto,
  ) {
    return this.updateModelPricing.execute({
      modelId,
      ...dto,
      source: 'manual',
      changedBy: user.id,
    });
  }

  @Get('workspaces/:workspaceId/models/:modelId/price-changes')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Histórico de mudanças de preço de um modelo',
    description:
      'Mais recente primeiro. É log imutável: nunca sofre UPDATE, e a linha ' +
      'traz o par antes/depois para a auditoria não depender de reconstruir o ' +
      '"antes" a partir da linha anterior.',
  })
  @ApiOkResponse({ type: [ModelPriceChangeResponseDto] })
  @ApiForbiddenResponse({ description: 'Papel insuficiente no workspace.' })
  priceChanges(@Param('modelId') modelId: string) {
    return this.listPriceChanges.execute(modelId);
  }
}
