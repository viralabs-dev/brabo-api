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
  description: 'Service token missing or different from the shared one.',
})
@Controller('internal/models')
@ServiceRoute()
@UseGuards(EngineServiceGuard)
export class InternalModelsController {
  constructor(private readonly syncCatalog: SyncModelCatalogUseCase) {}

  @Post('sync')
  // Reconciles existing rows; does not create an addressable resource.
  @HttpCode(200)
  @ApiOperation({
    summary: 'Syncs the model catalog across all providers',
    description:
      'Never fails because of one provider: each one answers for itself in ' +
      'the report, with the reason it was skipped and the origin of the ' +
      'failure when there was one. A provider that did not respond is ' +
      'SKIPPED, not marked unavailable.',
  })
  @ApiOkResponse({ type: SyncModelCatalogResponseDto })
  sync() {
    return this.syncCatalog.execute();
  }
}
