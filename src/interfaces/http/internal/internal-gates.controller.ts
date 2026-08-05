import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { EngineServiceGuard } from '../auth/engine-service.guard';
import { ServiceRoute } from '../auth/service-route.decorator';
import { SERVICE_TOKEN } from '../../../infrastructure/openapi/documento';
import { carregarRegistro } from '../../../infrastructure/gates/gate-registry.loader';
import { GateRegistryResponseDto } from './dto/gates.response.dto';

/**
 * O registro de gates, para leitura (FASE 15a, ADR 0054).
 *
 * Read-only e sem escrita nenhuma: o registro é um arquivo VERSIONADO, e muda
 * por PR revisado — não em runtime. Uma rota de escrita aqui transformaria uma
 * decisão de engenharia em configuração de produção, que é exatamente o que o
 * ADR recusou ao escolher YAML em vez de tabela.
 *
 * Service token e não `role:owner` porque hoje quem consome é operação e o
 * script de validação, não a UI. Se um dia a tela do time ler daqui (15b), a
 * classificação muda junto e a superfície declarada acompanha.
 */
@ApiTags('internal')
@ApiSecurity(SERVICE_TOKEN)
@ApiForbiddenResponse({
  description: 'Service token ausente ou diferente do compartilhado.',
})
@Controller('internal/gates')
@ServiceRoute()
@UseGuards(EngineServiceGuard)
export class InternalGatesController {
  @Get()
  @ApiOperation({
    summary: 'Lê o registro declarativo de gates',
    description:
      'O registro DESCREVE, não executa: nenhum gate passa a ser aplicado por ' +
      'causa dele, e mudar um campo aqui não muda comportamento nenhum. Cada ' +
      'gate diz onde mora a prova de que passou (`evidencia`), porque nem ' +
      'toda prova está no event log.',
  })
  @ApiOkResponse({ type: GateRegistryResponseDto })
  ler(): GateRegistryResponseDto {
    // Carga preguiçosa e memoizada no loader: um arquivo ilegível responde
    // erro AQUI, em vez de impedir a api inteira de subir.
    return carregarRegistro();
  }
}
