import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { ObterRedeDoContainerUseCase } from '../../../application/use-cases/containers/obter-rede-do-container.use-case';
import { DeclararRedeDoContainerUseCase } from '../../../application/use-cases/containers/declarar-rede-do-container.use-case';
import {
  DeclararRedeDto,
  RedeDoContainerResponseDto,
} from './dto/rede-do-container.dto';
import { RequireRole } from '../iam/require-role.decorator';
import { ObterContainerDoProjetoUseCase } from '../../../application/use-cases/containers/obter-container-do-projeto.use-case';
import { ObterCicloDeVidaDoContainerUseCase } from '../../../application/use-cases/containers/obter-ciclo-de-vida-do-container.use-case';
import { ObterEstadoObservadoDoContainerUseCase } from '../../../application/use-cases/containers/obter-estado-observado-do-container.use-case';
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
    private readonly obterEstadoObservado: ObterEstadoObservadoDoContainerUseCase,
    private readonly obterRede: ObterRedeDoContainerUseCase,
    private readonly declararRede: DeclararRedeDoContainerUseCase,
  ) {}

  @Get('network')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Declared network of the container (artifact.container_network)',
    description:
      'The current declaration (ports on 127.0.0.1, DNS, extra hosts), or ' +
      '`null`. It is what was DECLARED; it only takes effect when the ' +
      'container is recreated (`container_recreate`).',
  })
  @ApiOkResponse({
    type: RedeDoContainerResponseDto,
    description: 'Or `null`.',
  })
  rede(@Param('projectId') projectId: string) {
    return this.obterRede.execute(projectId);
  }

  @Put('network')
  @RequireRole('maintainer')
  @ApiOperation({
    summary: 'Declares the container network (human only)',
    description:
      'Emits a new version of `artifact.container_network` (the current one ' +
      'replaces the previous). Not an external effect: nothing changes in ' +
      'Docker until a `container_recreate` is approved (AT-608, RN-932). 400 ' +
      '`rede_invalida` names the field.',
  })
  @ApiOkResponse({ type: RedeDoContainerResponseDto })
  declarar(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
    @Body() dto: DeclararRedeDto,
  ) {
    return this.declararRede.execute(projectId, user.id, dto);
  }

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
      '(RN-243/RN-267). `status`/`imageVersion`/`resources` are what was ' +
      'RECORDED; `observado` is what the Docker daemon reports right now, ' +
      'asked through the broker (ADR 0130). The two are never fused: a ' +
      'container killed from the outside reads as recorded `running` and ' +
      'observed `exited`. When there was no way to look, `observado` is ' +
      '`null` and `naoObservado` says why — it never inherits the recorded ' +
      'state (RN-468).',
  })
  @ApiOkResponse({
    type: CicloDeVidaDoContainerResponseDto,
    description: 'The recorded lifecycle, or `null` (never provisioned).',
  })
  async cicloDeVida(@Param('projectId') projectId: string) {
    const estado = await this.obterCicloDeVida.execute(projectId);
    if (!estado) return null;

    // A observação é pedida DEPOIS de existir registro, e nunca no lugar dele.
    // Consequência declarada (ADR 0130): um container órfão de um projeto que
    // nunca teve linha de ciclo de vida não aparece por aqui — quem o acha é a
    // varredura por `brabo.managed=true`, e a página global que a consome é
    // outro PR.
    const observacao = await this.obterEstadoObservado.execute(projectId);

    return {
      status: estado.status,
      imageVersion: estado.imageVersion,
      resources: estado.resources,
      failureReason: estado.failureReason,
      createdAt: estado.createdAt.toISOString(),
      statusChangedAt: estado.statusChangedAt.toISOString(),
      observado: observacao.observado,
      naoObservado: observacao.naoObservado,
      detalheDaObservacao: observacao.detalhe,
    };
  }
}
