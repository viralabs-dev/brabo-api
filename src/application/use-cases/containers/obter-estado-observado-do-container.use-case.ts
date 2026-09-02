import { Injectable } from '@nestjs/common';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
  ContainerBrokerPort,
  type ObservacaoDeContainer,
} from '../../ports/container-broker.port';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

/**
 * Por que a observação pode não existir. NUNCA colapsado com "não há
 * container": os dois significam coisas diferentes, e mostrar o segundo no
 * lugar do primeiro é exatamente o que a RN-468 proíbe — sinal de ambiente diz
 * o que SABE, e proxy não vira garantia.
 */
export type MotivoDeNaoObservacao =
  /** Não há broker nesta instalação (`BROKER_URL` vazia). */
  | 'broker-nao-configurado'
  /** Há broker configurado e ele não respondeu. */
  | 'broker-sem-resposta'
  /** O broker respondeu, e a resposta foi uma recusa (modo, projeto, política). */
  | 'broker-recusou';

export interface EstadoObservado {
  /** O que o daemon reportou, ou `null`. */
  observado: ObservacaoDeContainer | null;
  /**
   * `null` quando a observação ACONTECEU — inclusive quando ela devolveu
   * `null`, que é a afirmação positiva "olhei e não há container". Preenchido
   * quando não deu para olhar, dizendo por quê.
   */
  naoObservado: MotivoDeNaoObservacao | null;
  /** A mensagem do broker, quando houve uma. Para a tela poder dizer a causa. */
  detalhe: string | null;
}

/**
 * O estado OBSERVADO do container de um projeto — a outra metade do par que a
 * tela nunca funde (ADR 0130).
 *
 * `ObterCicloDeVidaDoContainerUseCase` devolve o REGISTRADO: o que a tabela
 * `project_containers` diz que aconteceu. Este devolve o OBSERVADO: o que o
 * daemon responde agora, pelo broker. Container morto por fora aparece como
 * registrado `running` e observado `exited`, e é assim que tem de aparecer —
 * fundir os dois numa coluna faria a tabela poder MENTIR sem que ninguém
 * notasse.
 *
 * ## Por que ler pelo broker não é efeito externo
 *
 * `inspect` não sobe, não para e não remove nada. LER não vira
 * `proposed_action` — encheria a fila de ruído até ninguém mais ler as de
 * verdade (a regra é do CLAUDE.md e vale aqui igual). O que a leitura deve é
 * ser CONTIDA, e é: sem parâmetro além do projeto, teto de tempo curto no
 * cliente, e um desfecho declarado para cada modo de não conseguir.
 *
 * ## Nenhuma falha derruba a leitura
 *
 * Toda recusa do broker vira um MOTIVO, nunca uma exceção que suba até a rota.
 * O ciclo de vida registrado é informação legítima por si só e existia antes
 * do broker: perdê-lo porque o broker está fora seria trocar um dado que
 * temos por um que não temos.
 */
@Injectable()
export class ObterEstadoObservadoDoContainerUseCase {
  constructor(private readonly broker: ContainerBrokerPort) {}

  @Traced('application')
  async execute(projectId: string): Promise<EstadoObservado> {
    if (!this.broker.configurado()) {
      return {
        observado: null,
        naoObservado: 'broker-nao-configurado',
        detalhe: null,
      };
    }

    try {
      return {
        observado: await this.broker.inspect(projectId),
        naoObservado: null,
        detalhe: null,
      };
    } catch (erro) {
      if (erro instanceof BrokerIndisponivelError) {
        return {
          observado: null,
          naoObservado:
            erro.motivo === 'nao-configurado'
              ? 'broker-nao-configurado'
              : 'broker-sem-resposta',
          detalhe: erro.message,
        };
      }
      if (erro instanceof BrokerRecusouError) {
        return {
          observado: null,
          naoObservado: 'broker-recusou',
          detalhe: erro.message,
        };
      }
      throw erro;
    }
  }
}
