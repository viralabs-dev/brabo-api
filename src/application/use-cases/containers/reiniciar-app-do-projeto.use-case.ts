import { Injectable } from '@nestjs/common';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
  ContainerBrokerPort,
  type ResultadoDoReinicioDoApp,
} from '../../ports/container-broker.port';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

/**
 * RN-1026: o engine pede o reinício do PROCESSO do app (ADR 0264) depois de a
 * pasta do projeto avançar. A api só repassa ao broker, que lê o `run.app` da
 * `container-spec` — o comando nunca vem do chamador.
 *
 * O resultado é TIPADO e sem texto livre: nem a mensagem do broker nem o log do
 * app saem daqui, porque o comando do app pode carregar segredo. Broker que
 * recusa ou não responde vira `falha_no_exec`, nunca uma exception na rota
 * interna (mesmo raciocínio de `ExecutarComandoNoContainerUseCase`).
 */
@Injectable()
export class ReiniciarAppDoProjetoUseCase {
  constructor(private readonly brokerPort: ContainerBrokerPort) {}

  @Traced('application')
  async execute(projectId: string): Promise<ResultadoDoReinicioDoApp> {
    try {
      return await this.brokerPort.reiniciarApp(projectId);
    } catch (erro) {
      if (erro instanceof BrokerRecusouError && erro.status === 404) {
        return { reiniciou: false, motivo: 'sem_container' };
      }
      // 409: sem `comandoDoApp` na spec ou projeto `runner` — no-op nomeado.
      if (erro instanceof BrokerRecusouError && erro.status === 409) {
        return { reiniciou: false, motivo: 'sem_app' };
      }
      if (
        erro instanceof BrokerRecusouError ||
        erro instanceof BrokerIndisponivelError
      ) {
        return { reiniciou: false, motivo: 'falha_no_exec' };
      }
      throw erro;
    }
  }
}
