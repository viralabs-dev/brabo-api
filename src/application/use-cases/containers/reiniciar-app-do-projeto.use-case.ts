import { Injectable } from '@nestjs/common';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
  ContainerBrokerPort,
  type ResultadoDoReinicioDoApp,
} from '../../ports/container-broker.port';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { TaskRepository } from '../../ports/backlog-repository.port';
import { GetRunInstructionsUseCase } from '../execution/get-run-instructions.use-case';
import {
  citaModulo,
  moduloDoPontoDeEntrada,
} from '../../../domain/architecture/module-graph';
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
 *
 * AT-985: se o comando cita um módulo do mapa que ainda não tem tarefa `done`,
 * o alvo não existe e o reinício nem roda (`alvo_pendente`, não é falha).
 */
@Injectable()
export class ReiniciarAppDoProjetoUseCase {
  constructor(
    private readonly brokerPort: ContainerBrokerPort,
    private readonly runInstructions: GetRunInstructionsUseCase,
    private readonly moduleMaps: ModuleMapRepository,
    private readonly tasks: TaskRepository,
  ) {}

  @Traced('application')
  async execute(projectId: string): Promise<ResultadoDoReinicioDoApp> {
    const { pendente, modulo } = await this.alvo(projectId);
    if (pendente) {
      return { reiniciou: false, motivo: 'alvo_pendente' };
    }
    try {
      const r = await this.brokerPort.reiniciarApp(projectId);
      // RN-1514: o nome do módulo que sobe o app (nunca texto de log).
      return !r.reiniciou &&
        modulo &&
        r.motivo !== 'sem_app' &&
        r.motivo !== 'sem_container'
        ? { ...r, modulo }
        : r;
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
        return {
          reiniciou: false,
          motivo: 'falha_no_exec',
          ...(modulo ? { modulo } : {}),
        };
      }
      throw erro;
    }
  }

  /**
   * O alvo está pendente quando o comando cita um módulo sem entrega ou
   * quando o módulo do ponto de entrada (RN-1514) ainda não tem tarefa `done`.
   */
  private async alvo(
    projectId: string,
  ): Promise<{ pendente: boolean; modulo: string | null }> {
    const comando = (await this.runInstructions.execute(projectId))?.app
      ?.command;
    const mapa = comando ? await this.moduleMaps.findCurrent(projectId) : null;
    if (!comando || !mapa) return { pendente: false, modulo: null };
    const modulo = moduloDoPontoDeEntrada(mapa.modules, comando);
    const alvos = new Set(
      mapa.modules.map((m) => m.name).filter((n) => citaModulo(comando, n)),
    );
    if (modulo) alvos.add(modulo);
    if (alvos.size === 0) return { pendente: false, modulo };
    const entregues = new Set(
      await this.tasks.modulosComTarefaConcluida(projectId),
    );
    return { pendente: [...alvos].some((n) => !entregues.has(n)), modulo };
  }
}
