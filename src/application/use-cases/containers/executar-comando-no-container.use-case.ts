import { Injectable } from '@nestjs/common';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
  ContainerBrokerPort,
} from '../../ports/container-broker.port';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

export interface ExecucaoNoContainerOk {
  sucesso: true;
  exitCode: number;
  output: string;
  timedOut: boolean;
}

export interface ExecucaoNoContainerFalha {
  sucesso: false;
  motivo: string;
}

export type ResultadoDeExecucaoNoContainer =
  ExecucaoNoContainerOk | ExecucaoNoContainerFalha;

/**
 * Proxy síncrono engine -> api -> broker para `ContainerBrokerPort.exec`
 * (ADR 0130/0134) — a última das cinco operações do broker a ganhar um
 * chamador real. O comentário original do ADR 0130 já avisava: "declarar as
 * cinco agora e ligar quatro depois é o oposto de deixar um gatilho
 * automático escondido".
 *
 * Quem chama isto é o ENGINE (`Engine.Actions.TerminalExecutor`), só quando
 * o projeto está em `execution_mode: container` com uma linha REGISTRADA em
 * `project_containers` como `running` (RN-492). O pipeline de decisão de
 * sempre (`decide()`/`ProposeActionUseCase`) já rodou ANTES disso — este
 * caso de uso nunca decide SE o comando pode rodar, só EXECUTA onde já foi
 * decidido que pode.
 *
 * ## As duas classes de erro do broker nunca vazam
 *
 * `BrokerRecusouError` e `BrokerIndisponivelError` viram um resultado
 * TIPADO de falha (`sucesso: false`), nunca uma exception que atravessa a
 * rota HTTP interna — mesmo raciocínio de `ExecuteContainerStartUseCase`
 * (ADR 0133). Container que morreu ou foi removido por fora (RN-486:
 * registrado e observado nunca se fundem) é uma FALHA NORMAL do comando de
 * terminal, não um bug do produto — e é assim que o `TerminalExecutor` do
 * lado engine trata: `failed_result`, nunca crash, nunca fallback silencioso
 * para o `System.cmd` fora do container (que reabriria o vetor que este PR
 * existe para fechar). Qualquer OUTRO erro (defeito real de código) segue
 * lançando — não é disfarçado de falha de comando.
 */
@Injectable()
export class ExecutarComandoNoContainerUseCase {
  constructor(private readonly brokerPort: ContainerBrokerPort) {}

  @Traced('application')
  async execute(
    projectId: string,
    comando: string,
    cwd?: string,
    timeoutMs?: number,
  ): Promise<ResultadoDeExecucaoNoContainer> {
    try {
      const resultado = await this.brokerPort.exec(
        projectId,
        comando,
        cwd,
        timeoutMs,
      );
      return {
        sucesso: true,
        exitCode: resultado.exitCode,
        output: resultado.output,
        timedOut: resultado.timedOut,
      };
    } catch (erro) {
      if (
        erro instanceof BrokerRecusouError ||
        erro instanceof BrokerIndisponivelError
      ) {
        return { sucesso: false, motivo: erro.message };
      }
      throw erro;
    }
  }
}
