import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRole } from '../iam/require-role.decorator';
import { ObterVisaoGeralDeContainersUseCase } from '../../../application/use-cases/containers/obter-visao-geral-de-containers.use-case';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { ContainerOverviewItemResponseDto } from './dto/containers.response.dto';

/**
 * A página global de containers (ADR 0136, RN-495/RN-521) — cross-projeto, do
 * WORKSPACE inteiro, ao lado (não dentro) de `ContainersController`
 * (`projects/:projectId/container`, por projeto único).
 *
 * Mesma leitura de sempre: teto de chamadas ao broker por carregamento
 * (`ObterVisaoGeralDeContainersUseCase`), registrado e observado nunca
 * fundidos (RN-468/486).
 */
@ApiTags('projects')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role in the workspace.' })
@ApiNotFoundResponse({
  description: "Workspace doesn't exist or is invisible to the caller.",
})
@Controller('workspaces/:workspaceId/containers')
export class ContainersOverviewController {
  constructor(
    private readonly obterVisaoGeral: ObterVisaoGeralDeContainersUseCase,
  ) {}

  @Get()
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Lists every project in the workspace and its container, if any',
    description:
      'One row per project of the workspace — since RN-521 a project that ' +
      'never provisioned a container is PRESENT with `registrado: null` ' +
      'instead of absent, because this page is the human path to start the ' +
      'first one. The observed state is asked of the broker only for rows ' +
      '`provisioning`/`running`, and only up to a per-load budget — see ' +
      '`naoVerificado` on rows that were skipped, and ADR 0136 for the ' +
      'reasoning.',
  })
  @ApiOkResponse({ type: [ContainerOverviewItemResponseDto] })
  async list(
    @Param('workspaceId') workspaceId: string,
  ): Promise<ContainerOverviewItemResponseDto[]> {
    const itens = await this.obterVisaoGeral.execute(workspaceId);
    // Achatado aqui, não no use case: `registrado` é um `ProjectContainerLifecycle`
    // de domínio (com `Date`), e a resposta HTTP é texto — mesma conversão que
    // `ContainersController.cicloDeVida` já faz para a rota por projeto.
    return itens.map((item) => ({
      projectId: item.projectId,
      projectName: item.projectName,
      projectSlug: item.projectSlug,
      executionMode: item.executionMode,
      registrado: item.registrado
        ? {
            status: item.registrado.status,
            imageVersion: item.registrado.imageVersion,
            imagem: item.imagem,
            resources: item.registrado.resources,
            failureReason: item.registrado.failureReason,
            createdAt: item.registrado.createdAt.toISOString(),
            statusChangedAt: item.registrado.statusChangedAt.toISOString(),
          }
        : null,
      temImagemDecidida: item.temImagemDecidida,
      workspaceVerifiedAt: item.workspaceVerifiedAt?.toISOString() ?? null,
      observado: item.observado,
      naoObservado: item.naoObservado,
      detalheDaObservacao: item.detalheDaObservacao,
      naoVerificado: item.naoVerificado,
      acaoPendente: item.acaoPendente
        ? {
            ...item.acaoPendente,
            decidedAt: item.acaoPendente.decidedAt?.toISOString() ?? null,
            createdAt: item.acaoPendente.createdAt.toISOString(),
            updatedAt: item.acaoPendente.updatedAt.toISOString(),
          }
        : null,
    }));
  }
}
