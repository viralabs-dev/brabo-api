import { Injectable, Logger } from '@nestjs/common';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
  ContainerBrokerPort,
  type RecursosDoHost,
} from '../../ports/container-broker.port';
import { EVENTO_REDE_DO_CONTAINER } from '../../../domain/containers/rede-do-container';
import { portaLivreDoApp } from '../../../domain/containers/recriar-com-app';

export interface PortaEscolhida {
  porta: number;
  /** `true` quando o broker não respondeu: só as declaradas foram consideradas. */
  naoConferida: boolean;
}

const hostsDe = (eventos: Array<{ payload: unknown }>): number[] =>
  eventos
    .flatMap((e) => {
      const ports = (e.payload as { ports?: unknown } | null)?.ports;
      return Array.isArray(ports)
        ? ports.map((p) => (p as { host?: unknown })?.host)
        : [];
    })
    .filter((h): h is number => typeof h === 'number');

/**
 * ADR 0298 (RN-1383): a porta do app sai da leitura do HOST (`GET /host/recursos`),
 * não só dos eventos de rede da api. Broker fora do ar: usa só as declaradas e
 * devolve `naoConferida`.
 */
@Injectable()
export class PortaDoAppUseCase {
  private readonly log = new Logger(PortaDoAppUseCase.name);

  constructor(
    private readonly broker: ContainerBrokerPort,
    private readonly eventos: SessionEventRepository,
  ) {}

  private async lerHost(): Promise<RecursosDoHost | null> {
    if (!this.broker.configurado()) return null;
    try {
      return await this.broker.recursosDoHost();
    } catch (e) {
      if (
        e instanceof BrokerIndisponivelError ||
        e instanceof BrokerRecusouError
      ) {
        this.log.warn(`porta não conferida no host: ${e.message}`);
        return null;
      }
      throw e;
    }
  }

  async escolher(projectId: string): Promise<PortaEscolhida> {
    const [todas, proprias, host] = await Promise.all([
      this.eventos.listByType(EVENTO_REDE_DO_CONTAINER),
      this.eventos.listByTypeForProject(projectId, EVENTO_REDE_DO_CONTAINER),
      this.lerHost(),
    ]);
    const minhas = new Set(hostsDe(proprias));
    const portas = host?.portas ?? [];
    return {
      // shortcut: o payload de rede não traz o projeto; as portas de qualquer versão
      // de outro projeto contam como ocupadas. Sobe para a rede vigente por projeto se
      // a folga de portas apertar.
      porta: portaLivreDoApp({
        ocupadasNoHost: portas.map((p) => p.host),
        declaradasPorOutros: hostsDe(todas).filter((p) => !minhas.has(p)),
        doProprioProjeto: portas
          .filter((p) => p.projectId === projectId)
          .map((p) => p.host),
      }),
      naoConferida: host === null,
    };
  }

  /**
   * Quem segura `porta` no host sem ser este projeto: `outro projeto`,
   * `fora do Brabo`, ou `null` (livre, ou broker fora do ar).
   */
  async quemSegura(
    projectId: string,
    porta: number,
  ): Promise<'outro projeto' | 'fora do Brabo' | null> {
    const host = await this.lerHost();
    const p = host?.portas.find(
      (x) => x.host === porta && x.projectId !== projectId,
    );
    if (!p) return null;
    return p.projectId === null ? 'fora do Brabo' : 'outro projeto';
  }
}
