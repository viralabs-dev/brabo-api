import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
  ContainerBrokerPort,
  type ResultadoDaProvaDeCompose,
} from '../../ports/container-broker.port';
import { chaveDeQa } from '../../../domain/containers/instancia-de-qa';
import { InstanciaDeQaUseCase } from './instancia-de-qa.use-case';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

export const AVISO_SEM_PROVA_DE_COMPOSE = 'sem prova de compose';

export interface ResultadoDaProvaDeComposeDeQa {
  /** `provou`: subiu e sondou. `falhou`: culpa do projeto (item do parecer). `aprova_com_aviso`: não deu para provar. */
  veredito: 'provou' | 'falhou' | 'aprova_com_aviso';
  /** `sem prova de compose` quando `aprova_com_aviso`; senão `null`. */
  aviso: string | null;
  /** Por que não houve prova (infra, runner, broker ausente); `null` caso contrário. */
  motivo: string | null;
  chave: string;
  resultado: ResultadoDaProvaDeCompose | null;
}

/**
 * A prova de compose do QA (AT-922, ADR 0297, RN-1328). Sem prova possível —
 * broker ausente, fora do ar ou estourando o teto, `runner`, origem `infra` — o
 * desfecho é o AVISO, nunca erro e nunca reprovação por infraestrutura (Q6).
 */
@Injectable()
export class ProvarComposeDeQaUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly instancia: InstanciaDeQaUseCase,
    private readonly broker: ContainerBrokerPort,
  ) {}

  @Traced('application')
  async execute(
    projectId: string,
    taskRef: string,
  ): Promise<ResultadoDaProvaDeComposeDeQa> {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');
    const taskId = await this.instancia.resolverTarefa(projectId, taskRef);
    const chave = chaveDeQa(taskId);
    const aviso = (motivo: string): ResultadoDaProvaDeComposeDeQa => ({
      veredito: 'aprova_com_aviso',
      aviso: AVISO_SEM_PROVA_DE_COMPOSE,
      motivo,
      chave,
      resultado: null,
    });

    if (project.executionMode === 'runner') {
      return aviso('projeto `runner`: a pasta mora noutra máquina');
    }
    try {
      const resultado = await this.broker.provaDeCompose(projectId, chave);
      if (resultado.subiu) {
        return {
          veredito: 'provou',
          aviso: null,
          motivo: null,
          chave,
          resultado,
        };
      }
      if (resultado.origem === 'infra') {
        return { ...aviso('falha de infraestrutura na prova'), resultado };
      }
      return {
        veredito: 'falhou',
        aviso: null,
        motivo: null,
        chave,
        resultado,
      };
    } catch (e) {
      // 503/origem infra, 409 (prova viva ou `runner`), broker ausente ou sem resposta.
      if (e instanceof BrokerIndisponivelError) return aviso(e.message);
      if (
        e instanceof BrokerRecusouError &&
        (e.status === 503 || e.status === 409 || e.origem === 'infra')
      ) {
        return aviso(e.message);
      }
      throw e;
    }
  }
}
