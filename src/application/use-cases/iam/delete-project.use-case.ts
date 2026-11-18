import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { ContainerBrokerPort } from '../../ports/container-broker.port';

@Injectable()
export class DeleteProjectUseCase {
  private readonly logger = new Logger(DeleteProjectUseCase.name);

  constructor(
    private readonly projects: ProjectRepository,
    private readonly brokerPort: ContainerBrokerPort,
  ) {}

  async execute(id: string) {
    // RN-1369: o broker resolve o container pelo contexto do projeto NESTA api,
    // então a remoção tem de vir ANTES de apagar a linha. Falha do broker não
    // bloqueia o apagar (ADR 0298: o projeto some na hora, a limpeza fica pendente).
    // TODO(AT-980/L7): registrar a limpeza pendente em `project_resources` e a
    // reconciliação periódica; aqui o container fica órfão se o broker falhar.
    // TODO(AT-980/L7): `removeQa` das instâncias de QA vivas.
    const projeto = await this.projects.findById(id);
    if (projeto && projeto.executionMode !== 'runner') {
      try {
        await this.brokerPort.remove(id);
      } catch (erro) {
        this.logger.warn(
          `container do projeto ${id} não removido ao apagar: ${
            erro instanceof Error ? erro.message : String(erro)
          }`,
        );
      }
    }
    const row = await this.projects.remove(id);
    if (!row) throw new NotFoundException('Projeto não encontrado');
    return row;
  }
}
