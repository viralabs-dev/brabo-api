import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { carregarRegistro } from '../../../infrastructure/gates/gate-registry.loader';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { GatesResponseDto } from './dto/gates.response.dto';

/**
 * O registro de gates, para quem CONSOME (FASE 15b).
 *
 * Existe separado de `/internal/gates` porque o público é outro: aquele é
 * service-to-service, autenticado por token de serviço, e serve o script de
 * medição. Este é do usuário logado, e serve a tela.
 *
 * **Sem `projectId` de propósito.** O registro é fato do PRODUTO, não de um
 * projeto: os mesmos treze gates valem para todos. Pendurá-lo num projeto
 * sugeriria que dá para ter gates diferentes por projeto, que é exatamente o
 * que o ADR 0054 não decidiu.
 *
 * Só devolve gate `active`. Gate `planned` descreve papel futuro (dev-lead,
 * platform) e apareceria numa tela que diz o que está acontecendo AGORA como
 * se estivesse acontecendo.
 */
@ApiTags('gates')
@ApiBearerAuth(BEARER)
@Controller('gates')
export class GatesController {
  @Get()
  @ApiOperation({
    summary: 'The registry of active gates',
    description:
      'Declarative index of the flow gates (ADR 0054). The screen derives from ' +
      'here which steps exist and who judges each one, instead of repeating the ' +
      'list in code — which is how it used to go stale unnoticed.',
  })
  @ApiOkResponse({ type: GatesResponseDto })
  listar(): GatesResponseDto {
    const registro = carregarRegistro();

    return {
      version: registro.version,
      gates: registro.gates
        .filter((g) => g.status === 'active')
        .map((g) => ({
          id: g.id,
          fluxo: g.fluxo,
          dono: g.dono,
          entrada: g.entrada,
          entregavel: g.entregavel,
          aprovacaoHumana: g.aprovacao_humana,
          severidade: g.severidade,
        })),
    };
  }
}
