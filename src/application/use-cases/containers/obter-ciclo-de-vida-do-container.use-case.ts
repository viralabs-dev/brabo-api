import { Injectable } from '@nestjs/common';
import { ContainerRepository } from '../../ports/container-repository.port';
import type { ProjectContainerLifecycle } from '../../../domain/containers/container-lifecycle';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

/**
 * Consulta o ESTADO atual do container de um projeto (ADR 0081). `null`
 * quando o projeto nunca foi provisionado — distinto de `SEM_DECISAO` em
 * `obter-container-do-projeto.use-case.ts`, que é sobre a DECISÃO de
 * imagem do Arquiteto (ADR 0065): um projeto pode ter imagem decidida e
 * ainda não ter nenhuma linha de ciclo de vida, porque nada hoje provisiona
 * de verdade.
 */
@Injectable()
export class ObterCicloDeVidaDoContainerUseCase {
  constructor(private readonly containers: ContainerRepository) {}

  @Traced('application')
  execute(projectId: string): Promise<ProjectContainerLifecycle | null> {
    return this.containers.findByProject(projectId);
  }
}
