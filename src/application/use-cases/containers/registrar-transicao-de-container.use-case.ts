import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { ContainerRepository } from '../../ports/container-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
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
 * ## O que este caso de uso, sozinho, NÃO faz
 *
 * Não chama Docker diretamente — só GRAVA que uma transição foi
 * pedida/observada, depois de validar que ela é permitida pela máquina de
 * estados. Desde o ADR 0130, existe SIM um serviço do produto com acesso a
 * um daemon Docker (`apps/broker`, o único com `docker.sock` montado), e
 * desde o ADR 0133 `ExecuteContainerStartUseCase` é o primeiro chamador real
 * que primeiro pede ao broker para agir e SÓ DEPOIS chama este caso de uso
 * para registrar o resultado — a ordem "orquestrador real age, depois grava
 * aqui" já vale, não é mais hipotética.
 *
 * O que ele passou a fazer ALÉM de gravar (RN-501, ADR 0142): a chegada em
 * `running` publica `container.running` no outbox, na MESMA transação. Não
 * é orquestração — é o aviso de que a pré-condição do claim de dev agent
 * passou a existir; ver `avisarQueOContainerSubiu` no fim do arquivo.
 *
 * ## A primeira transição é especial
 *
 * Não existe linha até a primeira chamada com `to: 'provisioning'`: aí o
 * caso de uso lê a decisão de imagem vigente do Arquiteto/Infra (ADR 0065,
 * RN-105/494) — sem decisão, sem provisionar, mesmo portão que já vale para a
 * aba Code — e CONGELA a versão e os recursos declarados naquele instante
 * na linha nova. Toda transição depois disso é validada contra o estado
 * atual pela máquina de `container-lifecycle.ts`.
 *
 * ## `mounted`/`runner` também passam por aqui agora (RN-494, revisa RN-169)
 *
 * Até o ADR 0135, este caso de uso recusava (400) qualquer projeto fora do
 * modo `container` — em nome de uma regra que na verdade pertencia ao
 * broker, não a este caso de uso. A tabela `project_containers` passa a
 * poder registrar linha para os três modos; o que continua IMPOSSÍVEL para
 * `mounted`/`runner` é chegar em `running` DE VERDADE, e isso é aplicado num
 * lugar só: `ContainerBrokerPort.start()` recusa (`ModoDeExecucaoNaoSuportadoError`,
 * política deliberada — `mounted`/`runner` rodam numa pasta do usuário que
 * o broker, no servidor, não enxerga) e `ExecuteContainerStartUseCase` já
 * trata essa recusa como falha normal (`BrokerRecusouError` vira
 * `container.start_failed` com o motivo nomeado, nunca crash, nunca
 * silêncio) — ANTES de qualquer transição chegar a ser chamada, então na
 * prática nenhuma linha nasce para esses dois modos pelo caminho normal.
 * Duplicar a checagem de modo aqui só faria a api e o broker discordarem
 * sobre o que "existe", exatamente o que o comentário de
 * `ModoDeExecucaoNaoSuportadoError` (`apps/broker/src/operacoes.ts`) pedia
 * para não fazer.
 */
@Injectable()
export class RegistrarTransicaoDeContainerUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly projects: ProjectRepository,
    private readonly containers: ContainerRepository,
    private readonly obterImagem: ObterContainerDoProjetoUseCase,
    private readonly outbox: OutboxRepository,
  ) {}

  @Traced('application')
  async execute(
    projectId: string,
    to: ContainerLifecycleStatus,
    input: TransicaoDeContainerInput = {},
  ): Promise<ProjectContainerLifecycle> {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');

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

      const atualizado = await this.containers.updateStatus(atual.id, to, {
        containerId: input.containerId,
        failureReason: input.failureReason,
      });

      await this.avisarQueOContainerSubiu(projectId, to);

      return atualizado;
    });
  }

  /**
   * O engine LÊ `project_containers` direto para decidir se um dev agent pode
   * reivindicar task (RN-501, ADR 0142) — mas leitura não avisa ninguém: um
   * agente já parado em `:idle` continuaria parado até um evento não
   * relacionado passar por perto. Por isso a chegada em `running` PUBLICA,
   * na mesma transação que a grava.
   *
   * `aggregateType: 'container'` — e não `'task'`, que o dreno do engine já
   * lia — porque o evento não é sobre task nenhuma; `Engine.Outbox.Drain`
   * ganhou esse terceiro agregado na mesma mudança. `aggregateId` é o
   * PROJETO e não a linha do container: quem consome acorda agentes por
   * projeto, e a linha pode ter sido recriada desde então.
   *
   * Só `running`. `provisioning`/`stopped`/`failed`/`removed` não soltam
   * ninguém — quem os observa é a tela, não o claim. E o caminho da PRIMEIRA
   * transição (`create`, logo acima) não passa por aqui de propósito: ele
   * nasce sempre em `provisioning`.
   */
  private async avisarQueOContainerSubiu(
    projectId: string,
    to: ContainerLifecycleStatus,
  ): Promise<void> {
    if (to !== 'running') return;

    await this.outbox.append({
      aggregateType: 'container',
      aggregateId: projectId,
      eventType: 'container.running',
      payload: { projectId },
    });
  }
}
