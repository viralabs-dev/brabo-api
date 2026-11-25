import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ContainerBrokerPort } from '../../ports/container-broker.port';
import { ContainerRepository } from '../../ports/container-repository.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { QaEnvironmentRepository } from '../../ports/qa-environment-repository.port';
import { RecursoDeProjetoRepository } from '../../ports/recurso-de-projeto-repository.port';
import { RegistroDeRecursos } from './registro-de-recursos';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface ResumoDaReconciliacao {
  /** Projetos apagados cuja remoção pendente foi concluída. */
  retomados: number;
  /** Restos de subida que falhou, removidos. */
  restosRemovidos: number;
}

/**
 * AT-980 (ADR 0298, RN-1386): o laço que fecha o que o apagar e a subida falha
 * deixaram no host. No boot e a cada `RECURSOS_RECONCILIACAO_INTERVAL_MS`
 * (padrão 5 min; 0 desliga): (1) as linhas `removendo` de projeto apagado chamam
 * `orfao/remove`; (2) o resto de subida `falhou` em projeto sem ciclo `running`
 * é removido. Só age sobre o que está em `project_resources`: o host NUNCA é varrido
 * por `brabo.project.id` desconhecido (o `brabo` e o `brabo-dev` dividem o Docker). Broker fora do ar: registra o motivo e tenta no tique seguinte.
 */
@Injectable()
export class ReconciliarRecursosUseCase
  implements OnModuleInit, OnModuleDestroy
{
  private readonly log = new Logger(ReconciliarRecursosUseCase.name);
  private timer?: NodeJS.Timeout;
  private rodando = false;

  constructor(
    private readonly broker: ContainerBrokerPort,
    private readonly recursos: RecursoDeProjetoRepository,
    private readonly projects: ProjectRepository,
    private readonly ciclos: ContainerRepository,
    private readonly qa: QaEnvironmentRepository,
    private readonly registro: RegistroDeRecursos,
  ) {}

  onModuleInit(): void {
    const ms = Number(
      process.env.RECURSOS_RECONCILIACAO_INTERVAL_MS ?? 300_000,
    );
    if (!(ms > 0)) return;
    void this.execute();
    this.timer = setInterval(() => void this.execute(), ms);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async execute(): Promise<ResumoDaReconciliacao> {
    const resumo = { retomados: 0, restosRemovidos: 0 };
    if (this.rodando || !this.broker.configurado()) return resumo;
    this.rodando = true;
    try {
      resumo.retomados = await this.retomarRemocoes();
      resumo.restosRemovidos = await this.removerRestosDeSubida();
    } catch (e) {
      this.log.warn(`reconciliação de recursos adiada: ${msg(e)}`);
    } finally {
      this.rodando = false;
    }
    return resumo;
  }

  private async retomarRemocoes(): Promise<number> {
    const ids = new Set(
      (await this.recursos.listar(['removendo'])).map((r) => r.projectId),
    );
    let feitos = 0;
    for (const id of ids) {
      // Linha `removendo` de projeto vivo não é desta rota: `orfao/remove` daria 409.
      if (await this.projects.findById(id)) continue;
      try {
        await this.broker.removerOrfao(id);
        await this.recursos.concluirRemocaoDoProjeto(id, null);
        feitos++;
      } catch (e) {
        await this.recursos.concluirRemocaoDoProjeto(id, msg(e));
        this.log.warn(`remoção do projeto ${id} segue pendente: ${msg(e)}`);
      }
    }
    return feitos;
  }

  private async removerRestosDeSubida(): Promise<number> {
    let feitos = 0;
    for (const r of await this.recursos.listar(['falhou'])) {
      if (!(await this.projects.findById(r.projectId))) continue;
      try {
        if (r.tipo === 'container') {
          const ciclo = await this.ciclos.findByProject(r.projectId);
          if (ciclo?.status === 'running') continue;
          await this.broker.remove(r.projectId);
        } else {
          if (await this.qa.findAtivaDoProjeto(r.projectId)) continue;
          await this.broker.removeQa(r.projectId, r.chave);
        }
        await this.registro.removido(r.projectId, r.tipo, r.chave);
        feitos++;
      } catch (e) {
        this.log.warn(
          `resto de subida de ${r.projectId} não removido: ${msg(e)}`,
        );
      }
    }
    return feitos;
  }
}
