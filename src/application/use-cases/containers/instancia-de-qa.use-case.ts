import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import {
  QaEnvironmentRepository,
  type InstanciaDeQa,
} from '../../ports/qa-environment-repository.port';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
  ContainerBrokerPort,
} from '../../ports/container-broker.port';
import {
  chaveDeQa,
  formaDaReferenciaDeTarefa,
} from '../../../domain/containers/instancia-de-qa';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

export interface ResultadoDeInstanciaDeQa {
  sucesso: boolean;
  status: InstanciaDeQa['status'];
  chave: string;
  motivo: string | null;
}

const ehErroDoBroker = (e: unknown) =>
  e instanceof BrokerRecusouError || e instanceof BrokerIndisponivelError;

/**
 * Ciclo de vida da instância de QA efêmera (AT-612, ADR 0229, RN-935..938).
 * Quem chama o broker é a api; o engine só pede. Falha do broker é resultado
 * (`sucesso: false`), nunca exceção — como o `container-exec`.
 */
@Injectable()
export class InstanciaDeQaUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly repo: QaEnvironmentRepository,
    private readonly broker: ContainerBrokerPort,
  ) {}

  /** Aceita o id completo OU a chave de 8; resolve DENTRO do projeto. 404 / 409 se ambígua. */
  async resolverTarefa(projectId: string, ref: string): Promise<string> {
    const forma = formaDaReferenciaDeTarefa(ref);
    if (forma === 'invalida') {
      throw new BadRequestException('Referência de tarefa inválida');
    }
    const ids = await this.repo.resolverTarefas(
      projectId,
      forma === 'id' ? { id: ref } : { chave: ref },
    );
    if (ids.length === 0) throw new NotFoundException('Tarefa não encontrada');
    if (ids.length > 1) {
      throw new ConflictException({
        code: 'tarefa_ambigua',
        message: 'A chave casa com mais de uma tarefa; use o id completo.',
      });
    }
    return ids[0];
  }

  private async projetoDoServidor(projectId: string) {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');
    if (project.executionMode === 'runner') {
      throw new ConflictException({
        code: 'qa_nao_suporta_runner',
        message:
          'A instância de QA ainda não existe para projeto "runner": fica para depois (ADR 0229).',
      });
    }
    return project;
  }

  @Traced('application')
  async start(
    projectId: string,
    taskRef: string,
  ): Promise<ResultadoDeInstanciaDeQa> {
    await this.projetoDoServidor(projectId);
    const taskId = await this.resolverTarefa(projectId, taskRef);
    const chave = chaveDeQa(taskId);

    const ativa = await this.repo.findAtivaDoProjeto(projectId);
    if (ativa && ativa.taskId !== taskId) throw ocupada();

    let linha = await this.repo.find(projectId, taskId);
    try {
      if (!linha) linha = await this.repo.criar(projectId, taskId);
      else if (linha.status === 'removed' || linha.status === 'failed') {
        linha = await this.repo.atualizarStatus(linha.id, 'provisioning');
      }
    } catch (e) {
      // 23505 do índice parcial: outra subida ganhou a corrida.
      if ((e as { code?: string })?.code === '23505') throw ocupada();
      throw e;
    }

    try {
      await this.broker.startQa(projectId, chave);
      await this.repo.atualizarStatus(linha.id, 'running');
      return { sucesso: true, status: 'running', chave, motivo: null };
    } catch (e) {
      if (!ehErroDoBroker(e)) throw e;
      await this.repo.atualizarStatus(linha.id, 'failed');
      return {
        sucesso: false,
        status: 'failed',
        chave,
        motivo: (e as Error).message,
      };
    }
  }

  @Traced('application')
  async remove(
    projectId: string,
    taskRef: string,
  ): Promise<ResultadoDeInstanciaDeQa> {
    await this.projetoDoServidor(projectId);
    const taskId = await this.resolverTarefa(projectId, taskRef);
    const linha = await this.repo.find(projectId, taskId);
    const chave = chaveDeQa(taskId);
    if (!linha) {
      return { sucesso: true, status: 'removed', chave, motivo: null };
    }
    return this.removerLinha(linha);
  }

  /**
   * Remove o que o engine NÃO tem mais em voo (boot e tick do GateRescuer).
   * Lacuna declarada: serviço compartilhado e rede `brabo-qa-<wd>` não têm
   * operação no broker; ficam até uma operação própria existir.
   */
  @Traced('application')
  async limparOrfas(emVoo: string[], projectId?: string) {
    const vivos = new Set(emVoo);
    const removidas: string[] = [];
    const falhas: Array<{ taskId: string; motivo: string }> = [];
    for (const linha of await this.repo.listarParaLimpeza(projectId)) {
      if (vivos.has(linha.taskId)) continue;
      const r = await this.removerLinha(linha);
      if (r.sucesso) removidas.push(linha.taskId);
      else falhas.push({ taskId: linha.taskId, motivo: r.motivo ?? '' });
    }
    return { removidas, falhas };
  }

  private async removerLinha(
    linha: InstanciaDeQa,
  ): Promise<ResultadoDeInstanciaDeQa> {
    const chave = chaveDeQa(linha.taskId);
    try {
      await this.broker.removeQa(linha.projectId, chave);
    } catch (e) {
      if (!ehErroDoBroker(e)) throw e;
      return {
        sucesso: false,
        status: linha.status,
        chave,
        motivo: (e as Error).message,
      };
    }
    await this.repo.atualizarStatus(linha.id, 'removed');
    return { sucesso: true, status: 'removed', chave, motivo: null };
  }

  /** Exec na instância ativa da tarefa. */
  async exec(
    projectId: string,
    taskRef: string,
    comando: string,
    cwd?: string,
    timeoutMs?: number,
  ) {
    const taskId = await this.resolverTarefa(projectId, taskRef);
    const linha = await this.repo.find(projectId, taskId);
    if (!linha || linha.status !== 'running') {
      return {
        sucesso: false as const,
        motivo: 'Não há instância de QA em execução para esta tarefa.',
      };
    }
    try {
      const r = await this.broker.execQa(
        projectId,
        chaveDeQa(taskId),
        comando,
        cwd,
        timeoutMs,
      );
      return { sucesso: true as const, ...r };
    } catch (e) {
      if (!ehErroDoBroker(e)) throw e;
      return { sucesso: false as const, motivo: (e as Error).message };
    }
  }
}

function ocupada() {
  return new ConflictException({
    code: 'instancia_de_qa_ocupada',
    message: 'O projeto já tem uma instância de QA ativa (teto de 1).',
  });
}
