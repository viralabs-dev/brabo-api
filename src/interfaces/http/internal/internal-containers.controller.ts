import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { EngineServiceGuard } from '../auth/engine-service.guard';
import { ServiceRoute } from '../auth/service-route.decorator';
import { ObterSpecDeContainerUseCase } from '../../../application/use-cases/containers/obter-spec-de-container.use-case';
import { SERVICE_TOKEN } from '../../../infrastructure/openapi/documento';
import { ContainerSpecInternalResponseDto } from './dto/container-spec-internal.response.dto';

/**
 * O que o BROKER de container lê da api (ADR 0130).
 *
 * ## Por que esta rota existe, e por que ela é de leitura
 *
 * O broker não aceita especificação de container. Ele recebe um `projectId` e
 * uma das cinco operações, e vem AQUI buscar o que precisa para compor a
 * especificação ele mesmo. Se a spec viajasse no corpo da chamada, a contenção
 * de um processo root-equivalente no host dependeria de quem o chama estar
 * correto — e a contenção que depende do chamador não é contenção.
 *
 * ## Por que ela é `engine-service` e não uma família nova
 *
 * O mecanismo é o mesmo (`BRABO_SERVICE_TOKEN` no cabeçalho próprio,
 * comparado em tempo constante), o segredo é o mesmo e o raio de explosão é o
 * mesmo — os três serviços rodam no mesmo cluster e leem o mesmo Secret. Um
 * segundo segredo daria a impressão de compartimentar sem compartimentar nada,
 * ao custo de dobrar o que precisa ser rotacionado em sincronia; a razão está
 * escrita por inteiro em `service-token.ts` e vale igual para o terceiro
 * serviço. O nome da classificação (`engine-service`, em
 * `docs/security-surface.md`) descreve o MECANISMO, não o remetente.
 *
 * ## Sem `@Post` aqui, e isso não é esquecimento
 *
 * Quem ESCREVE o ciclo de vida continua sendo `RegistrarTransicaoDeContainer`,
 * pela rota que já existe; e quem SOBE container é o broker, chamado pela api.
 * Uma rota interna de escrita aqui daria ao broker autoridade sobre o estado
 * que ele mesmo produz, e é a api que precisa continuar sendo o lugar onde a
 * autoridade mora.
 */
@ApiTags('internal')
@ApiSecurity(SERVICE_TOKEN)
@ApiForbiddenResponse({
  description: 'Service token missing or different from the shared one.',
})
@Controller('internal/projects')
@ServiceRoute()
@UseGuards(EngineServiceGuard)
export class InternalContainersController {
  constructor(private readonly obterSpec: ObterSpecDeContainerUseCase) {}

  @Get(':projectId/container-spec')
  @ApiOperation({
    summary: 'What the broker needs to compose the container spec itself',
    description:
      "Project identity, execution mode and the Architect's current image " +
      'decision. The broker revalidates all of it before handing anything to ' +
      'the daemon — reading from here is not the same as trusting it, and the ' +
      'refusal names the field. No ABSOLUTE path is returned: the bind source ' +
      'is resolved by the daemon against the HOST filesystem, and a path from ' +
      'inside the api container would silently mount an empty folder. What ' +
      'travels is `localizacao` (RN-503) — which of the two broker roots to ' +
      'use, plus the relative segment that root does not cover.',
  })
  @ApiOkResponse({ type: ContainerSpecInternalResponseDto })
  @ApiNotFoundResponse({ description: 'Project not found.' })
  containerSpec(@Param('projectId') projectId: string) {
    return this.obterSpec.execute(projectId);
  }
}
