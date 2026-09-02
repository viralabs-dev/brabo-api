/**
 * Como a api fala com o BROKER de container (ADR 0130).
 *
 * ## Cinco operações do lado de lá, e menos deste lado
 *
 * O broker expõe as cinco da `DockerPort`. Esta porta declara as cinco, mas
 * hoje só `inspect` tem chamador — a rota de ciclo de vida do container, que
 * passou a mostrar o estado OBSERVADO ao lado do REGISTRADO. Subir, parar e
 * remover são EFEITO EXTERNO e não acontecem sem `proposed_action`; quem vai
 * propor é o Infra Lead, com autoridade final do usuário, e isso é outro PR.
 * Declarar as cinco agora e ligar quatro depois é o oposto de deixar um
 * gatilho automático escondido: o método existe e nada o chama, o que qualquer
 * busca por chamador mostra em um segundo.
 *
 * ## `null` não é erro, e as duas coisas nunca viram uma
 *
 * `inspect` devolve `null` quando não há container, e LANÇA quando não deu para
 * perguntar. A tela precisa dos dois separados: "não há container" e "não
 * consegui olhar" são estados diferentes (RN-088), e o segundo NUNCA pode ser
 * mostrado como se fosse o primeiro — é a RN-468 aplicada, proxy não vira
 * garantia.
 */

/** Os estados que o daemon reporta, sem tradução nem colapso. */
export type EstadoObservadoDeContainer =
  | 'created'
  | 'running'
  | 'paused'
  | 'restarting'
  | 'removing'
  | 'exited'
  | 'dead';

export interface ObservacaoDeContainer {
  containerId: string;
  nome: string;
  estado: EstadoObservadoDeContainer;
  imagem: string;
  /** ISO-8601, ou `null` quando o container nunca subiu. */
  iniciadoEm: string | null;
}

export interface ContainerIniciadoPeloBroker {
  containerId: string;
  nome: string;
  /** `true` quando o container já estava de pé — `start` é idempotente. */
  jaEstavaDePe: boolean;
}

export interface ResultadoDeExecNoContainer {
  exitCode: number;
  output: string;
  timedOut: boolean;
}

/**
 * O broker recusou, ou não respondeu. `origem` vem DELE — cada erro do broker
 * declara a própria (`infra | politica | codigo`), e `null` é a resposta
 * honesta de `ComandoDeDockerFalhouError`, que o ADR 0128 deixou sem origem de
 * propósito. Escolher uma aqui seria o diagnóstico por eliminação que o ADR
 * 0020 registra como o defeito a não repetir.
 */
export class BrokerRecusouError extends Error {
  readonly status: number;
  readonly origem: string | null;

  constructor(status: number, mensagem: string, origem: string | null) {
    super(mensagem);
    this.name = 'BrokerRecusouError';
    this.status = status;
    this.origem = origem;
  }
}

/** O broker não está configurado (`BROKER_URL` vazia) ou não atendeu. */
export class BrokerIndisponivelError extends Error {
  readonly origem = 'infra';
  readonly motivo: 'nao-configurado' | 'sem-resposta';

  constructor(motivo: 'nao-configurado' | 'sem-resposta', detalhe: string) {
    super(detalhe);
    this.name = 'BrokerIndisponivelError';
    this.motivo = motivo;
  }
}

export abstract class ContainerBrokerPort {
  /** `true` quando há `BROKER_URL` — quem lê decide se pergunta ou declara ausência. */
  abstract configurado(): boolean;

  abstract start(projectId: string): Promise<ContainerIniciadoPeloBroker>;
  abstract stop(projectId: string): Promise<void>;
  abstract remove(projectId: string): Promise<void>;
  abstract inspect(projectId: string): Promise<ObservacaoDeContainer | null>;
  abstract exec(
    projectId: string,
    comando: string,
    cwd?: string,
  ): Promise<ResultadoDeExecNoContainer>;
}
