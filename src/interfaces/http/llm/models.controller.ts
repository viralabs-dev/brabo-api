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
 * nenhum, e um `@RequireRole` numa rota sem escopo reprovaria SEMPRE. O
 * catálogo em si é global (a tabela `models` nunca foi por workspace); o
 * workspace no caminho é a âncora de RBAC, não um recorte de dados. Catálogo
 * por workspace está no backlog do ADR 0041.
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
  @Get('models')
  @ApiOperation({
    summary: 'Lista os modelos disponíveis, agrupados por categoria e provider',
    description:
      'Categoria `local` são os do Ollama, que não gastam dinheiro; `cloud` são os ' +
      'de API paga. Modelo inativo não aparece aqui, mas continua nos custos ' +
      'históricos — para vê-lo use a rota de catálogo.',
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
  list() {
    return this.listModels.execute();
  }

  @Get('workspaces/:workspaceId/models/catalog')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Lista o catálogo INTEIRO, inclusive inativo e indisponível',
    description:
      'A tela de curadoria. Modelo descoberto pelo sync entra `isActive: false` ' +
      'e só aparece aqui até alguém ativá-lo; modelo que sumiu do provider vem ' +
      'com `availability: "unavailable"` e nunca é deletado, porque bindings e ' +
      'histórico de custo apontam para ele.',
  })
  @ApiExtraModels(ModelResponseDto)
  @ApiForbiddenResponse({ description: 'Papel insuficiente no workspace.' })
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
  catalog() {
    return this.listCatalog.execute();
  }

  @Post('workspaces/:workspaceId/models/activate')
  // Não cria nada — muda a curadoria de linhas que já existem. 201 mentiria.
  @HttpCode(200)
  @RequireRole('owner')
  @ApiOperation({
    summary: 'Liga ou desliga modelos no seletor (lote)',
    description:
      'Curadoria do owner. Só mexe em `isActive` — `availability` é o que o ' +
      'sync observou no provider e não se altera por aqui. Lote inteiro ou ' +
      'nada: um id inexistente reprova a chamada sem aplicar nenhuma linha.',
  })
  @ApiOkResponse({ type: [ModelResponseDto] })
  @ApiForbiddenResponse({ description: 'Exige `owner` no workspace.' })
  @ApiNotFoundResponse({ description: 'Algum id do lote não existe.' })
  activate(@Body() dto: SetModelsActiveDto) {
    return this.setModelsActive.execute(dto);
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
