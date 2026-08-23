import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRole } from '../iam/require-role.decorator';
import { ObterContainerDoProjetoUseCase } from '../../../application/use-cases/containers/obter-container-do-projeto.use-case';
import { ObterCicloDeVidaDoContainerUseCase } from '../../../application/use-cases/containers/obter-ciclo-de-vida-do-container.use-case';
import { BEARER } from '../../../infrastructure/openapi/documento';
import {
  CicloDeVidaDoContainerResponseDto,
  EstadoDoContainerResponseDto,
} from './dto/containers.response.dto';

/**
 * O container do projeto, do lado de fora (FASE 25a, ADR 0065; ciclo de
 * vida, ADR 0081/0083).
 *
 * Duas rotas, as duas de LEITURA:
 *
 * - `estado` é a pergunta "o Arquiteto já decidiu?", que é o que a tela
 *   precisa para explicar por que a aba Code ainda não abriu — em vez de
 *   mostrar um erro mudo (RN-088: carregando, erro e vazio são três estados
 *   distintos).
 * - `cicloDeVida` é a pergunta "em que ESTADO está o container?"
 *   (provisioning/running/stopped/failed/removed), a primeira exposição
 *   HTTP de `ObterCicloDeVidaDoContainerUseCase` (RN-267) — o ADR 0081
 *   adiou esta rota de propósito ("expor uma seria adivinhar contrato") até
 *   existir um consumidor real; a aba Terminal (RN-268) é ele.
 *
 * Não há `@Post` em nenhuma das duas de propósito. Quem decide a imagem é o
 * ARQUITETO, pela ferramenta dele em
 * `/internal/sessions/:sessionId/project-image`; quem transicionaria o ciclo
 * de vida é um orquestrador que ainda não existe (ADR 0081) — uma rota
 * pública de escrita em qualquer uma das duas faria o estado nascer sem
 * passar por quem tem autoridade sobre ele.
 */
@ApiTags('projects')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role on the project.' })
@Controller('projects/:projectId/container')
export class ContainersController {
  constructor(
    private readonly obter: ObterContainerDoProjetoUseCase,
    private readonly obterCicloDeVida: ObterCicloDeVidaDoContainerUseCase,
  ) {}

  @Get()
  @RequireRole('viewer')
  @ApiOperation({
    summary: "State of the project's container (the current image decision)",
    description:
      'While the status is `sem_decisao`, the project container does not come ' +
      "up and the Code tab responds 409 — that's the RN-105 gate. Seeing the " +
      'state requires the same permission as seeing the project, so `viewer`.',
  })
  @ApiOkResponse({ type: EstadoDoContainerResponseDto })
  estado(@Param('projectId') projectId: string) {
    return this.obter.execute(projectId);
  }

  @Get('lifecycle')
  @RequireRole('viewer')
  @ApiOperation({
    summary: "Lifecycle of the project's container (recorded state)",
    description:
      '`null` when the project was never provisioned — the common case today, ' +
      'because no real orchestrator transitions this table yet ' +
      '(RN-243/RN-267). The returned state is what was RECORDED, never ' +
      'confirmed against a Docker daemon: the product has no Docker client.',
  })
  @ApiOkResponse({
    type: CicloDeVidaDoContainerResponseDto,
    description: 'The recorded lifecycle, or `null` (never provisioned).',
  })
  async cicloDeVida(@Param('projectId') projectId: string) {
    const estado = await this.obterCicloDeVida.execute(projectId);
    if (!estado) return null;
    return {
      status: estado.status,
      imageVersion: estado.imageVersion,
      resources: estado.resources,
      failureReason: estado.failureReason,
      createdAt: estado.createdAt.toISOString(),
      statusChangedAt: estado.statusChangedAt.toISOString(),
    };
  }
}
