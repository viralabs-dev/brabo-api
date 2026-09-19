import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ListProviderCapabilitiesUseCase } from '../../../application/use-cases/llm/list-provider-capabilities.use-case';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { ProviderCapabilitiesResponseDto } from './dto/llm.response.dto';

// Sem @RequireRole, como `users/me/credentials`: é fato do CÓDIGO desta
// instalação, igual para todo mundo, e não pende de workspace nem de projeto
// (ADR 0166, ponto 6). Continua exigindo autenticação (guard global).
@ApiTags('llm')
@ApiBearerAuth(BEARER)
@Controller('llm/provider-capabilities')
export class ProviderCapabilitiesController {
  constructor(
    private readonly listCapabilities: ListProviderCapabilitiesUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Lists what each LLM provider can do, independent of the model',
    description:
      'The PROVIDER layer of the capabilities (ADR 0041) for the nine ' +
      'providers, read from the same instances that serve the calls. A ' +
      'capability is only `true` when proven against the real API. The ' +
      'screen reads `routingPreference` from here before offering a routing ' +
      'preference on a binding (ADR 0166).',
  })
  @ApiOkResponse({ type: [ProviderCapabilitiesResponseDto] })
  list() {
    return this.listCapabilities.execute();
  }
}
