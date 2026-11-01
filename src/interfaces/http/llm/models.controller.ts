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
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { ListModelsUseCase } from '../../../application/use-cases/llm/list-models.use-case';
import { ListModelCatalogUseCase } from '../../../application/use-cases/llm/list-model-catalog.use-case';
import { SetModelsActiveUseCase } from '../../../application/use-cases/llm/set-models-active.use-case';
import { SetModelUsesUseCase } from '../../../application/use-cases/llm/set-model-uses.use-case';
import { SyncModelCatalogUseCase } from '../../../application/use-cases/llm/sync-model-catalog.use-case';
import { UpdateModelPricingUseCase } from '../../../application/use-cases/llm/update-model-pricing.use-case';
import { ListModelPriceChangesUseCase } from '../../../application/use-cases/llm/list-model-price-changes.use-case';
import { ListCredentialedProvidersUseCase } from '../../../application/use-cases/llm/list-credentialed-providers.use-case';
import { CredentialedProvidersResponseDto } from './dto/llm.response.dto';
import { RequireRole } from '../iam/require-role.decorator';
import { BEARER } from '../../../infrastructure/openapi/documento';
import {
  ModelComCuradoriaResponseDto,
  ModeloDoCatalogoResponseDto,
  ModelPriceChangeResponseDto,
  ModelResponseDto,
} from './dto/llm.response.dto';
import { SetModelsActiveDto } from './dto/set-models-active.dto';
import { SetModelUsesDto } from './dto/set-model-uses.dto';
import { UpdateModelPricingDto } from './dto/update-model-pricing.dto';
import { UpdateModelBillingDto } from './dto/update-model-billing.dto';
import { UpdateModelBillingUseCase } from '../../../application/use-cases/llm/update-model-billing.use-case';
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
    private readonly setModelUses: SetModelUsesUseCase,
    private readonly syncCatalog: SyncModelCatalogUseCase,
    private readonly updateModelPricing: UpdateModelPricingUseCase,
    private readonly updateModelBilling: UpdateModelBillingUseCase,
    private readonly listPriceChanges: ListModelPriceChangesUseCase,
    private readonly listCredentialed: ListCredentialedProvidersUseCase,
  ) {}

  @Get('workspaces/:workspaceId/llm-providers/credentialed')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Lists the LLM providers the workspace owner has a key for',
    description:
      'The owner of record (`workspaces.created_by`) is whose key the agents ' +
      'spend (RN-058). Only provider NAMES — never a secret, id or date. ' +
      '`ollama` (local, no key) never appears.',
  })
  @ApiOkResponse({ type: CredentialedProvidersResponseDto })
  credentialed(@Param('workspaceId') workspaceId: string) {
    return this.listCredentialed.execute(workspaceId);
  }

  /**
   * O schema é declarado à mão, e não por `type:`, porque a forma é
   * `Record<categoria, Record<provider, Model[]>>` — os dois níveis internos
   * têm chaves DINÂMICAS (o nome do provider), e não existe classe que
   * expresse isso. `additionalProperties` é a forma correta em OpenAPI.
   */
  @Get('projects/:projectId/models')
  @RequireRole('viewer')
  @ApiOperation({
    summary: "Lists the models active IN THE PROJECT's WORKSPACE",
    description:
      "The `local` category are Ollama's, which spend no money; `cloud` are " +
      'the paid API ones. A model the workspace has not activated does not ' +
      'appear here, but stays in the historical costs — to see it use the ' +
      "catalog route. The list is the project's OWNER workspace: the same " +
      'model can be on in one workspace and off in the neighboring one (ADR 0049).',
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
    summary: 'Lists the WHOLE catalog, including inactive and unavailable',
    description:
      'The curation screen. A model discovered by the sync comes in as ' +
      '`isActive: false` and only appears here until someone activates it; a ' +
      'model that disappeared from the provider comes with ' +
      '`availability: "unavailable"` and is never deleted, because bindings ' +
      'and cost history point to it. `isActive` is FOR THIS workspace (ADR ' +
      '0049); `availability` is global, because it is what the sync observed ' +
      'at the provider.',
  })
  @ApiExtraModels(ModeloDoCatalogoResponseDto)
  @ApiForbiddenResponse({ description: 'Insufficient role on the workspace.' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        local: {
          type: 'object',
          additionalProperties: {
            type: 'array',
            items: { $ref: getSchemaPath(ModeloDoCatalogoResponseDto) },
          },
        },
        cloud: {
          type: 'object',
          additionalProperties: {
            type: 'array',
            items: { $ref: getSchemaPath(ModeloDoCatalogoResponseDto) },
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
    summary: 'Turns models on or off in the selector (batch)',
    description:
      "Owner's curation, APPLYING ONLY TO THIS WORKSPACE (ADR 0049). Only " +
      'touches `isActive` — `availability` is what the sync observed at the ' +
      'provider, is global, and does not change here. Whole batch or nothing: ' +
      'a nonexistent id fails the call without applying any row.',
  })
  @ApiOkResponse({ type: [ModelComCuradoriaResponseDto] })
  @ApiForbiddenResponse({ description: 'Requires `owner` on the workspace.' })
  @ApiNotFoundResponse({ description: "Some id in the batch doesn't exist." })
  @ApiUnprocessableEntityResponse({
    description:
      'Activating an OpenRouter free-routing alias (`~…`) — `code: ' +
      '"alias_de_roteamento_livre"`, with the `modelIds` refused. The whole ' +
      'batch is refused. Deactivating one is always allowed (AT-271, RN-679).',
  })
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

  @Post('workspaces/:workspaceId/models/uses')
  // Substitui a curadoria de linhas que já existem — 201 mentiria, como na
  // rota de ativação.
  @HttpCode(200)
  @RequireRole('owner')
  @ApiOperation({
    summary: 'Marks what the workspace uses each model for (batch)',
    description:
      'The axis no catalog publishes: "good for code" is not a capability ' +
      "declared by any provider, it is the operator's opinion — and applies " +
      'ONLY to this workspace (ADR 0049). Axis independent of activation: ' +
      'marking a use does not turn the model on in the selector, and ' +
      'changing the use does not turn off what was on. The uses list ' +
      'REPLACES the previous one.',
  })
  @ApiOkResponse({ type: [ModelComCuradoriaResponseDto] })
  @ApiForbiddenResponse({ description: 'Requires `owner` on the workspace.' })
  @ApiNotFoundResponse({ description: "Some id in the batch doesn't exist." })
  uses(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: User,
    @Body() dto: SetModelUsesDto,
  ) {
    return this.setModelUses.execute({
      workspaceId,
      modelIds: dto.modelIds,
      uses: dto.uses,
      curatedBy: user.id,
    });
  }

  @Post('workspaces/:workspaceId/models/sync')
  @HttpCode(200)
  @RequireRole('owner')
  @ApiOperation({
    summary: 'Forces the catalog sync the periodic job does, right now',
    description:
      'Same use case as the internal route the engine schedules — the ' +
      "curation screen's refresh button has no path of its own, so there " +
      'are never two reconciliations that could diverge.',
  })
  @ApiOkResponse({ type: SyncModelCatalogResponseDto })
  @ApiForbiddenResponse({ description: 'Requires `owner` on the workspace.' })
  sync() {
    return this.syncCatalog.execute();
  }

  @Patch('workspaces/:workspaceId/models/:modelId/pricing')
  @RequireRole('owner')
  @ApiOperation({
    summary: "Corrects a model's price",
    description:
      'Applies from now on and NEVER re-prices the past: each `token_usage` ' +
      'row keeps the price that produced its cost. The change stays recorded ' +
      'with the before/after pair — queryable on the history route.',
  })
  @ApiOkResponse({ type: ModelResponseDto })
  @ApiForbiddenResponse({ description: 'Requires `owner` on the workspace.' })
  @ApiNotFoundResponse({ description: 'Model not found.' })
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

  @Patch('workspaces/:workspaceId/models/:modelId/billing')
  @RequireRole('owner')
  @ApiOperation({
    summary: "Sets a model's curated billing mark (api | subscription | free)",
    description:
      'Same curation level as the pricing route. `subscription` makes the ' +
      'spend report show the cost apart from the US$ paid (RN-954). Never ' +
      're-prices the past.',
  })
  @ApiOkResponse({ type: ModelResponseDto })
  @ApiForbiddenResponse({ description: 'Requires `owner` on the workspace.' })
  @ApiNotFoundResponse({ description: 'Model not found.' })
  updateBilling(
    @Param('modelId') modelId: string,
    @Body() dto: UpdateModelBillingDto,
  ) {
    return this.updateModelBilling.execute(modelId, dto.billing);
  }

  @Get('workspaces/:workspaceId/models/:modelId/price-changes')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: "History of a model's price changes",
    description:
      'Most recent first. It is an immutable log: never gets an UPDATE, and ' +
      'the row carries the before/after pair so the audit does not depend on ' +
      'reconstructing the "before" from the previous row.',
  })
  @ApiOkResponse({ type: [ModelPriceChangeResponseDto] })
  @ApiForbiddenResponse({ description: 'Insufficient role on the workspace.' })
  priceChanges(@Param('modelId') modelId: string) {
    return this.listPriceChanges.execute(modelId);
  }
}
