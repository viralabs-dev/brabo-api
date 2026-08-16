import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { ContainerRepository } from '../../ports/container-repository.port';
import { ObterContainerDoProjetoUseCase } from './obter-container-do-projeto.use-case';
import {
  assertTransition,
  InvalidContainerTransitionError,
  type ContainerLifecycleStatus,
  type ProjectContainerLifecycle,
} from '../../../domain/containers/container-lifecycle';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

export interface TransicaoDeContainerInput {
  containerId?: string | null;
  failureReason?: string | null;
}

/**
 * Registra uma transição de estado do container de um projeto (ADR 0081).
 *
 * ## O que este caso de uso NÃO faz
 *
 * Não chama Docker. Não sobe, para nem remove nada de verdade — só GRAVA
 * que uma transição foi pedida/observada, depois de validar que ela é
 * permitida pela máquina de estados. Nenhum serviço do produto tem acesso a
 * um daemon Docker hoje (nenhum `docker.sock` montado, nenhum container
 * `privileged`), e dar esse acesso é decisão de segurança fora do escopo
 * desta fatia. Quando um orquestrador real existir, é ELE quem chama este
 * caso de uso depois de agir — nunca o contrário.
 *
 * ## A primeira transição é especial
 *
 * Não existe linha até a primeira chamada com `to: 'provisioning'`: aí o
 * caso de uso lê a decisão de imagem vigente do Arquiteto (ADR 0065,
 * RN-105) — sem decisão, sem provisionar, mesmo portão que já vale para a
 * aba Code — e CONGELA a versão e os recursos declarados naquele instante
 * na linha nova. Toda transição depois disso é validada contra o estado
 * atual pela máquina de `container-lifecycle.ts`.
 */
@Injectable()
export class RegistrarTransicaoDeContainerUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly projects: ProjectRepository,
    private readonly containers: ContainerRepository,
    private readonly obterImagem: ObterContainerDoProjetoUseCase,
  ) {}

  @Traced('application')
  async execute(
    projectId: string,
    to: ContainerLifecycleStatus,
    input: TransicaoDeContainerInput = {},
  ): Promise<ProjectContainerLifecycle> {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');

    // RN: só projeto em modo `container` tem ciclo de vida de container —
    // `local` roda no container do agente de sempre e nunca sobe o próprio
    // (ADR 0072, RN-169).
    if (project.workspaceMode !== 'container') {
      throw new BadRequestException(
        'Projeto no modo "local" não tem container próprio (ADR 0072) — ' +
          'ciclo de vida de container só existe para projetos em modo "container".',
      );
    }

    return this.unitOfWork.runInTransaction(async () => {
      const atual = await this.containers.findByProjectForUpdate(projectId);

      if (!atual) {
        if (to !== 'provisioning') {
          throw new ConflictException(
            `Projeto ainda não tem container provisionado — a primeira transição ` +
              `precisa ser "provisioning", não "${to}".`,
          );
        }

        const imagem = await this.obterImagem.execute(projectId);
        if (imagem.status !== 'decidido' || !imagem.decisao) {
          throw new ConflictException(
            'O Arquiteto ainda não decidiu a imagem deste projeto (RN-105) — ' +
              'não há o que provisionar.',
          );
        }

        return this.containers.create({
          projectId,
          imageVersion: imagem.version,
          resources: imagem.decisao.resources,
        });
      }

      try {
        assertTransition(atual.status, to);
      } catch (e) {
        if (e instanceof InvalidContainerTransitionError) {
          throw new ConflictException(e.message);
        }
        throw e;
      }

      return this.containers.updateStatus(atual.id, to, {
        containerId: input.containerId,
        failureReason: input.failureReason,
      });
    });
  }
}
