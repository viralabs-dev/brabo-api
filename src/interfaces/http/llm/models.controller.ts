import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ListModelsUseCase } from '../../../application/use-cases/llm/list-models.use-case';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { ModelResponseDto } from './dto/llm.response.dto';

@ApiTags('llm')
@ApiBearerAuth(BEARER)
@Controller('models')
export class ModelsController {
  constructor(private readonly listModels: ListModelsUseCase) {}

  /**
   * O schema é declarado à mão, e não por `type:`, porque a forma é
   * `Record<categoria, Record<provider, Model[]>>` — os dois níveis internos
   * têm chaves DINÂMICAS (o nome do provider), e não existe classe que
   * expresse isso. `additionalProperties` é a forma correta em OpenAPI.
   */
  @Get()
  @ApiOperation({
    summary: 'Lista os modelos disponíveis, agrupados por categoria e provider',
    description:
      'Categoria `local` são os do Ollama, que não gastam dinheiro; `cloud` são os ' +
      'de API paga. Modelo inativo não aparece aqui, mas continua nos custos ' +
      'históricos.',
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
}
