import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { ObterContainerDoProjetoUseCase } from './obter-container-do-projeto.use-case';
import type {
  DecisaoDeImagem,
  PosturaDeRede,
  RecursosDoContainer,
} from '../../../domain/containers/project-container';
import type { ProjectExecutionMode } from '../../../domain/iam/project.entity';
import { segmentoSobABaseDeProjetos } from '../../../infrastructure/filesystem/project-workspaces-root';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

/**
 * ONDE a pasta do projeto está, dita de um jeito que o broker consiga
 * resolver — e sem que nenhum caminho absoluto atravesse a rede (RN-501).
 *
 * São TRÊS estados e não dois, porque o terceiro existe de verdade e
 * colapsá-lo num `null` faria a mesma ausência significar coisas com
 * consertos opostos:
 *
 * - `gerenciada` — a pasta do PRODUTO, nomeada por `workspace_dir_name`
 *   (RN-109). O broker a resolve contra `PROJECT_WORKSPACES_HOST_ROOT`.
 * - `montada` — a pasta do USUÁRIO, expressa como caminho RELATIVO sob a
 *   base única do ADR 0141. O broker a resolve contra
 *   `BRABO_PROJECTS_HOST_BASE`.
 * - `indisponivel` — nenhuma das duas raízes do servidor alcança esta pasta,
 *   e o `motivo` diz por quê. É o caso NORMAL de um projeto `runner` (a
 *   pasta mora numa máquina que este host não enxerga) e o caso de um
 *   projeto `mounted` legado, criado fora da base.
 */
export type LocalizacaoDoProjeto =
  | { tipo: 'gerenciada'; segmento: string }
  | { tipo: 'montada'; segmento: string }
  | { tipo: 'indisponivel'; motivo: string };

export interface SpecDeContainer {
  projectId: string;
  projectSlug: string;
  workspaceId: string;
  /** `workspace_dir_name` congelado na criação (RN-109). */
  workspaceDirName: string;
  executionMode: ProjectExecutionMode;
  /**
   * O localizador DISCRIMINADO da pasta (RN-501). Substitui o
   * `workspaceDirName` solto no papel de "o que o broker concatena com a
   * raiz dele" — `workspaceDirName` continua aqui porque ele é a fonte
   * ÚNICA do NOME do container (`brabo-<workspaceDirName>`), nos três modos,
   * e isso não é a mesma pergunta que "onde fica a pasta".
   */
  localizacao: LocalizacaoDoProjeto;
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
 * Nenhum CAMINHO ABSOLUTO. Nem `workspace_path`, nem a raiz gerenciada. O
 * caminho que vira `-v` é interpretado pelo DAEMON, que enxerga o filesystem do
 * HOST — `/data/project-workspaces/<x>` é um caminho de dentro do container da
 * api e mandá-lo faria o daemon criar uma pasta vazia no host e montá-la vazia.
 * Quem sabe os caminhos de host é o broker, pela configuração DELE, e ele
 * compõe raiz + segmento.
 *
 * Desde a RN-501 o que sai daqui é um localizador DISCRIMINADO
 * (`LocalizacaoDoProjeto`) e não um nome solto, porque passaram a existir DUAS
 * raízes do lado de lá: `PROJECT_WORKSPACES_HOST_ROOT` (a pasta gerenciada
 * pelo produto) e `BRABO_PROJECTS_HOST_BASE` (a base dos projetos montados,
 * ADR 0141). O invariante não mudou nem um pouco — o que atravessa a rede
 * continua sendo só a parte que a raiz do broker não cobre; o que mudou é que
 * agora a spec DIZ contra qual raiz aquele pedaço deve ser resolvido, em vez
 * de o broker ter uma só e adivinhar.
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
      localizacao: localizacaoDoProjeto(
        project.executionMode,
        project.workspaceDirName,
        project.workspacePath,
      ),
      imagem: recorteDaDecisao(estado.decisao),
      imagemVersao: estado.version,
    };
  }
}

/**
 * A derivação do localizador. `runner` NUNCA é `montada`, mesmo tendo
 * `workspace_path`: aquela pasta mora na máquina do usuário, e o broker (que
 * é quem lê isto) não a alcança por raiz nenhuma. Quem sobe container para
 * `runner` é o `brabo-runner`, do lado de lá (ADR 0137).
 */
export function localizacaoDoProjeto(
  executionMode: ProjectExecutionMode,
  workspaceDirName: string,
  workspacePath: string | null,
): LocalizacaoDoProjeto {
  if (executionMode === 'container') {
    return { tipo: 'gerenciada', segmento: workspaceDirName };
  }

  if (executionMode === 'runner') {
    return {
      tipo: 'indisponivel',
      motivo:
        'o projeto está no modo "runner": a pasta dele mora na máquina do ' +
        'usuário, sem bind-mount, e nenhuma raiz deste servidor a alcança. ' +
        'Quem sobe container aqui é o brabo-runner, do lado de lá (ADR 0137)',
    };
  }

  if (workspacePath === null || workspacePath.trim().length === 0) {
    // O CHECK do banco amarra o par (modo, caminho), então chegar aqui sem
    // caminho é linha incoerente — e o motivo diz isso em vez de compor um
    // segmento vazio, que viraria um `-v` da própria base.
    return {
      tipo: 'indisponivel',
      motivo:
        'o projeto está no modo "mounted" e não tem workspacePath gravado — ' +
        'linha incoerente com o CHECK do banco, gravada por fora',
    };
  }

  const sob = segmentoSobABaseDeProjetos(workspacePath);
  if (!sob.ok) return { tipo: 'indisponivel', motivo: sob.motivo };
  return { tipo: 'montada', segmento: sob.segmento };
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
