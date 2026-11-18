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
    if (await this.alvoPendente(projectId)) {
      return { reiniciou: false, motivo: 'alvo_pendente' };
    }
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

  /** O comando cita (como segmento de caminho ou argumento) um módulo sem entrega. */
  private async alvoPendente(projectId: string): Promise<boolean> {
    const comando = (await this.runInstructions.execute(projectId))?.app
      ?.command;
    const mapa = comando ? await this.moduleMaps.findCurrent(projectId) : null;
    if (!comando || !mapa) return false;
    const citados = mapa.modules
      .map((m) => m.name)
      .filter((nome) => citaModulo(comando, nome));
    if (citados.length === 0) return false;
    const entregues = new Set(
      await this.tasks.modulosComTarefaConcluida(projectId),
    );
    return citados.some((nome) => !entregues.has(nome));
  }
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function citaModulo(comando: string, nome: string): boolean {
  return new RegExp(`(^|[\\s/='"])${escapar(nome)}($|[\\s/'"])`).test(comando);
}
