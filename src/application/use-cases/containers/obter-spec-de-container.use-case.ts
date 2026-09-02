import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { ObterContainerDoProjetoUseCase } from './obter-container-do-projeto.use-case';
import type {
  DecisaoDeImagem,
  PosturaDeRede,
  RecursosDoContainer,
} from '../../../domain/containers/project-container';
import type { ProjectExecutionMode } from '../../../domain/iam/project.entity';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

export interface SpecDeContainer {
  projectId: string;
  projectSlug: string;
  workspaceId: string;
  /** `workspace_dir_name` congelado na criação (RN-109). */
  workspaceDirName: string;
  executionMode: ProjectExecutionMode;
  /** `null` enquanto o Arquiteto não decidiu (RN-105). */
  imagem: {
    image: string;
    network: PosturaDeRede;
    resources: RecursosDoContainer;
  } | null;
  /** Versão do artefato vigente; 0 quando não há decisão. */
  imagemVersao: number;
}

/**
 * O que o BROKER precisa saber sobre um projeto para compor a especificação de
 * container ele mesmo (ADR 0130).
 *
 * ## Por que este caso de uso existe, sendo que a api já tem os dois pedaços
 *
 * Porque o broker não pode receber a especificação pronta. Se ela viajasse no
 * corpo de uma requisição, a contenção do broker — que é root-equivalente no
 * host, por causa do socket — dependeria de quem chama estar correto. Ele
 * recebe `projectId` e uma operação, e vem BUSCAR aqui: identidade do projeto,
 * modo de execução e a decisão de imagem vigente. Imagem, rede, recursos e o
 * único mount são derivados disso do lado de lá.
 *
 * ## O que ele NÃO devolve, e é deliberado
 *
 * Nenhum CAMINHO. Nem `workspace_path`, nem a raiz gerenciada. O caminho que
 * vira `-v` é interpretado pelo DAEMON, que enxerga o filesystem do HOST —
 * `/data/project-workspaces/<x>` é um caminho de dentro do container da api e
 * mandá-lo faria o daemon criar uma pasta vazia no host e montá-la vazia. Quem
 * sabe o caminho de host é o broker, pela configuração DELE
 * (`PROJECT_WORKSPACES_HOST_ROOT`), e ele o compõe com o `workspaceDirName`
 * que sai daqui.
 *
 * `rationale` também fica de fora: ele existe para a decisão ser REVISÁVEL por
 * um humano, e não tem consumidor nenhum na composição de um `docker run`.
 */
@Injectable()
export class ObterSpecDeContainerUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly obterImagem: ObterContainerDoProjetoUseCase,
  ) {}

  @Traced('application')
  async execute(projectId: string): Promise<SpecDeContainer> {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');

    const estado = await this.obterImagem.execute(projectId);

    return {
      projectId: project.id,
      projectSlug: project.slug,
      workspaceId: project.workspaceId,
      workspaceDirName: project.workspaceDirName,
      executionMode: project.executionMode,
      imagem: recorteDaDecisao(estado.decisao),
      imagemVersao: estado.version,
    };
  }
}

function recorteDaDecisao(
  decisao: DecisaoDeImagem | null,
): SpecDeContainer['imagem'] {
  if (decisao === null) return null;
  return {
    image: decisao.image,
    network: decisao.network,
    resources: decisao.resources,
  };
}
