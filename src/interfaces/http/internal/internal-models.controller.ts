import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { EngineServiceGuard } from '../auth/engine-service.guard';
import { ServiceRoute } from '../auth/service-route.decorator';
import { SyncModelCatalogUseCase } from '../../../application/use-cases/llm/sync-model-catalog.use-case';
import { SERVICE_TOKEN } from '../../../infrastructure/openapi/documento';
import { SyncModelCatalogResponseDto } from './dto/model-sync.response.dto';

/**
 * O sync periódico de catálogo (Fase 9c).
 *
 * A divisão de trabalho é a mesma do resto do sistema: quem AGENDA é o engine
 * (Oban, com o idioma de worker que se reagenda), quem tem as credenciais e o
 * registry de providers é a api. Por isso a rota existe aqui e o worker só a
 * chama — duplicar o registry no Elixir seria manter dois catálogos.
 */
@ApiTags('internal')
@ApiSecurity(SERVICE_TOKEN)
@ApiForbiddenResponse({
  description: 'Service token ausente ou diferente do compartilhado.',
})
@Controller('internal/models')
@ServiceRoute()
@UseGuards(EngineServiceGuard)
export class InternalModelsController {
  constructor(private readonly syncCatalog: SyncModelCatalogUseCase) {}

  @Post('sync')
  // Reconcilia linhas existentes; não cria recurso endereçável.
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sincroniza o catálogo de modelos de todos os providers',
    description:
      'Nunca falha por causa de um provider: cada um responde por si no ' +
      'relatório, com o motivo do pulo e a origem da falha quando houve. Um ' +
      'provider que não respondeu é PULADO, não indisponibilizado.',
  })
  @ApiOkResponse({ type: SyncModelCatalogResponseDto })
  sync() {
    return this.syncCatalog.execute();
  }
}
