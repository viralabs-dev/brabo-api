import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { EngineServiceGuard } from '../auth/engine-service.guard';
import { ServiceRoute } from '../auth/service-route.decorator';
import { UpsertPromptTemplateUseCase } from '../../../application/use-cases/graph/upsert-prompt-template.use-case';
import { GetPromptTemplateUseCase } from '../../../application/use-cases/graph/get-prompt-template.use-case';
import { SERVICE_TOKEN } from '../../../infrastructure/openapi/documento';
import { UpsertPromptTemplateInternalDto } from './dto/upsert-prompt-template-internal.dto';
import {
  PromptTemplateReadResponseDto,
  PromptTemplateResponseDto,
} from './dto/graph.response.dto';

/**
 * Grafo de conhecimento (Neo4j) — fundação para templates de prompt
 * versionados e memória relacional (interações, hipóteses, perfis,
 * handoffs). Chamada pelo engine, com o mesmo service token de
 * `internal-sessions.controller.ts`.
 *
 * ## Só templates têm rota nesta fundação
 *
 * Os casos de uso de memória relacional (`RecordInteractionUseCase` e
 * companhia, em `application/use-cases/graph/`) estão completos e testados,
 * mas SEM rota aqui — nenhum consumidor real os chama ainda (a Onda 2, que
 * vai processar o outbox e alimentar o grafo, ainda não começou). Expor HTTP
 * para eles agora seria adivinhar o contrato antes de ter quem o exercite —
 * mesma régua já aplicada a outras fundações do produto (ex.: FASE 25,
 * ciclo de vida do container antes do consumidor real).
 *
 * ## Degradação
 *
 * Quando o Neo4j não está configurado ou não conectou, `GraphStore` lança
 * `GraphUnavailableError` — o `GraphErrorFilter` global converte isso em 503,
 * nunca um 500 cru.
 */
@ApiTags('internal')
@ApiSecurity(SERVICE_TOKEN)
@ApiForbiddenResponse({
  description: 'Service token ausente ou diferente do compartilhado.',
})
@ApiServiceUnavailableResponse({
  description:
    'Neo4j não configurado ou fora do ar — sem fallback possível para ' +
    'leitura/escrita de template.',
})
@Controller('internal/graph')
@ServiceRoute()
@UseGuards(EngineServiceGuard)
export class InternalGraphController {
  constructor(
    private readonly upsertTemplate: UpsertPromptTemplateUseCase,
    private readonly getTemplate: GetPromptTemplateUseCase,
  ) {}

  @Get('prompt-templates/:name')
  @ApiOperation({
    summary: 'Busca um template de prompt pelo nome',
    description:
      '`version` específica busca por igualdade; omitida, busca a versão ' +
      '`active` mais recente. 404 se o template (ou a versão pedida) não ' +
      'existir.',
  })
  @ApiQuery({ name: 'version', required: false, example: '3' })
  @ApiOkResponse({ type: PromptTemplateReadResponseDto })
  @ApiNotFoundResponse({
    description: 'Template inexistente, ou sem a versão pedida.',
  })
  async getByName(
    @Param('name') name: string,
    @Query('version') version?: string,
  ): Promise<PromptTemplateReadResponseDto> {
    const template = await this.getTemplate.execute({ name, version });
    return {
      name: template.name,
      version: template.version,
      body: template.body,
      hash: template.hash,
    };
  }

  @Post('prompt-templates')
  @ApiOperation({
    summary: 'Publica uma versão de template de prompt, idempotente por hash',
    description:
      'Se já existe uma versão com o MESMO hash para o mesmo `name`, nenhuma ' +
      'versão nova é criada — a existente é devolvida (o hit de idempotência ' +
      'não muda o status HTTP: sempre 201, por simplicidade — o corpo é ' +
      'idêntico ao que teria sido criado).',
  })
  @ApiCreatedResponse({ type: PromptTemplateResponseDto })
  async upsert(
    @Body() dto: UpsertPromptTemplateInternalDto,
  ): Promise<PromptTemplateResponseDto> {
    const { template } = await this.upsertTemplate.execute(dto);
    return {
      name: template.name,
      version: template.version,
      body: template.body,
      hash: template.hash,
      active: template.active,
    };
  }
}
