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
import { BEARER } from '../../../infrastructure/openapi/documento';
import { EstadoDoContainerResponseDto } from './dto/containers.response.dto';

/**
 * O container do projeto, do lado de fora (FASE 25a, ADR 0065).
 *
 * Uma rota só, e de LEITURA: é a pergunta "o Arquiteto já decidiu?", que é o
 * que a tela precisa para explicar por que a aba Code ainda não abriu — em vez
 * de mostrar um erro mudo (RN-088: carregando, erro e vazio são três estados
 * distintos).
 *
 * Não há `@Post` aqui de propósito. Quem decide a imagem é o ARQUITETO, pela
 * ferramenta dele em `/internal/sessions/:sessionId/project-image`; uma rota
 * pública de escrita faria a decisão poder nascer sem passar pelo agente que a
 * fase inteira existe para colocar no comando dela.
 */
@ApiTags('projetos')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@Controller('projects/:projectId/container')
export class ContainersController {
  constructor(private readonly obter: ObterContainerDoProjetoUseCase) {}

  @Get()
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Estado do container do projeto (a decisão de imagem vigente)',
    description:
      'Enquanto o status for `sem_decisao`, o container do projeto não sobe e ' +
      'a aba Code responde 409 — é o portão da RN-105. Ver o estado é a mesma ' +
      'permissão que ver o projeto, então `viewer`.',
  })
  @ApiOkResponse({ type: EstadoDoContainerResponseDto })
  estado(@Param('projectId') projectId: string) {
    return this.obter.execute(projectId);
  }
}
