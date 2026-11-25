import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { ContainerBrokerPort } from '../../ports/container-broker.port';
import { QaEnvironmentRepository } from '../../ports/qa-environment-repository.port';
import { RecursoDeProjetoRepository } from '../../ports/recurso-de-projeto-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { chaveDeQa } from '../../../domain/containers/instancia-de-qa';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

@Injectable()
export class DeleteProjectUseCase {
  private readonly logger = new Logger(DeleteProjectUseCase.name);

  constructor(
    private readonly projects: ProjectRepository,
    private readonly brokerPort: ContainerBrokerPort,
    private readonly qa: QaEnvironmentRepository,
    private readonly recursos: RecursoDeProjetoRepository,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  /**
   * ADR 0298 (RN-1385): o projeto some na hora e o apagar nunca espera o broker.
   * Na mesma transação do `DELETE` o inventário vira `removendo`; depois do
   * commit a api tenta `orfao/remove` e, se falhar, o laço de reconciliação
   * retoma (`ReconciliarRecursosUseCase`).
   */
  async execute(id: string) {
    const projeto = await this.projects.findById(id);
    const noBroker = !!projeto && projeto.executionMode !== 'runner';
    if (noBroker) {
      // RN-1369: o broker resolve o container pelo contexto do projeto NESTA api,
      // então estas remoções têm de vir ANTES de apagar a linha. Melhor esforço:
      // o que falhar aqui o `orfao/remove` e o laço pegam por rótulo.
      await this.removerQaVivas(id);
      try {
        await this.brokerPort.remove(id);
      } catch (erro) {
        this.logger.warn(
          `container do projeto ${id} não removido ao apagar: ${msg(erro)}`,
        );
      }
    }
    const row = await this.unitOfWork.runInTransaction(async () => {
      if (noBroker)
        await this.recursos.marcarRemovendoDoProjeto(id, {
          workspaceId: projeto.workspaceId,
          nome: projeto.name,
        });
      return this.projects.remove(id);
    });
    if (!row) throw new NotFoundException('Projeto não encontrado');

    if (noBroker) {
      let motivo: string | null = null;
      try {
        await this.brokerPort.removerOrfao(id);
      } catch (erro) {
        motivo = msg(erro);
        this.logger.warn(
          `remoção do projeto ${id} fica pendente no host: ${motivo}`,
        );
      }
      try {
        await this.recursos.concluirRemocaoDoProjeto(id, motivo);
      } catch (erro) {
        // O projeto já sumiu; as linhas seguem `removendo` e o laço refaz.
        this.logger.error(`inventário de ${id} não fechado: ${msg(erro)}`);
      }
    }
    return row;
  }

  private async removerQaVivas(projectId: string) {
    try {
      for (const q of await this.qa.listarParaLimpeza(projectId)) {
        try {
          await this.brokerPort.removeQa(projectId, chaveDeQa(q.taskId));
        } catch (erro) {
          this.logger.warn(
            `QA ${q.taskId} não removida ao apagar: ${msg(erro)}`,
          );
        }
      }
    } catch (erro) {
      this.logger.warn(`QA do projeto ${projectId} não listada: ${msg(erro)}`);
    }
  }
}
