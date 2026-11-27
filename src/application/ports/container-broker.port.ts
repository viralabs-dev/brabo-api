/**
 * Como a api fala com o BROKER de container (ADR 0130).
 *
 * ## Cinco operações do lado de lá, e menos deste lado
 *
 * O broker expõe as cinco da `DockerPort`. Esta porta declara as cinco, e três
 * já têm chamador: `inspect` (a rota de ciclo de vida do container, que
 * mostra o estado OBSERVADO ao lado do REGISTRADO), `start` (`container_start`,
 * ADR 0130/0133) e, desde o ADR 0134, `exec` — `ExecutarComandoNoContainerUseCase`,
 * chamado pela rota interna `POST internal/projects/:projectId/container-exec`
 * que o ENGINE usa para rodar comando de terminal de um dev agent DENTRO do
 * container real (RN-492), quando há um. `stop`/`remove` seguem sem chamador:
 * são EFEITO EXTERNO e não acontecem sem `proposed_action` própria, que ainda
 * não existe. Declarar as cinco desde o início e ligar uma a uma é o oposto de
 * deixar um gatilho automático escondido: o método existe e nada o chama, o
 * que qualquer busca por chamador mostra em um segundo.
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
  /** ADR 0228: o que o daemon diz estar publicado (o OBSERVADO; o declarado é outra coluna). */
  portasPublicadas?: Array<{
    ip: string;
    host: number;
    container: number;
    protocolo?: string;
  }>;
}

export interface ContainerIniciadoPeloBroker {
  containerId: string;
  nome: string;
  /** `true` quando o container já estava de pé — `start` é idempotente. */
  jaEstavaDePe: boolean;
  /** `true` quando o broker descartou um container parado de spec velha e subiu outro (contracts v1.4.0-dev.1). */
  recriado?: boolean;
}

export interface ResultadoDeExecNoContainer {
  exitCode: number;
  output: string;
  timedOut: boolean;
}

/**
 * Espelho de `ResultadoDoReinicio` (`packages/docker-port`, RN-1024). Sem campo
 * de texto livre de propósito: o comando do app pode carregar segredo, então
 * nenhum trecho de log atravessa a api. `sem_app` é só da api: o broker
 * recusou com 409 (sem `run.app` na spec, ou projeto `runner`), um no-op.
 * `alvo_pendente` também (AT-985): o módulo que o comando cita ainda não tem
 * entrega, então o reinício nem foi pedido.
 */
export type ResultadoDoReinicioDoApp =
  | { reiniciou: true }
  | {
      reiniciou: false;
      motivo:
        | 'sem_container'
        | 'tempo_esgotado'
        | 'falha_no_exec'
        | 'sem_app'
        | 'alvo_pendente';
      /** RN-1514: o módulo que sobe o app, nas falhas de subida. */
      modulo?: string;
    }
  | {
      reiniciou: false;
      motivo: 'app_saiu';
      exitCode: number;
      modulo?: string;
    };

/**
 * Espelho de `ResultadoDaProvaDeCompose` (`brabo-contracts:packages/docker-port`,
 * `prova-de-compose.ts`, AT-922): a api não importa o pacote. `origem` é quem
 * falhou: `projeto` vira item do parecer, `infra` vira "sem prova de compose".
 */
export interface ResultadoDaProvaDeCompose {
  subiu: boolean;
  sondas: Array<{ caminho: string; status: number }>;
  recusas?: Array<{ campo: string; motivo: string }>;
  origem: 'projeto' | 'infra';
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
  /** O `code` nomeado que o broker devolve (ex.: `servico_de_dados_morreu`), quando há. */
  readonly codigo: string | null;

  constructor(
    status: number,
    mensagem: string,
    origem: string | null,
    codigo: string | null = null,
  ) {
    super(mensagem);
    this.name = 'BrokerRecusouError';
    this.status = status;
    this.origem = origem;
    this.codigo = codigo;
  }
}

/**
 * O broker não está configurado (`BROKER_URL` vazia), não atendeu, ou atendeu
 * e não respondeu dentro do TETO daquela operação.
 *
 * `teto-excedido` é distinto de `sem-resposta` desde a AT-233 (RN-604): um
 * `exec` que roda mais que o teto antigo de 5s não é o broker fora do ar, e
 * dizê-lo assim mandava quem lê investigar a rede em vez do teto. A mensagem
 * nomeia a operação e o número. Para quem só distingue "configurado ou não"
 * (a leitura da tela, RN-486), `teto-excedido` continua caindo no mesmo lado
 * de `sem-resposta` — não observado, por motivo de transporte.
 */
export type MotivoDeBrokerIndisponivel =
  'nao-configurado' | 'sem-resposta' | 'teto-excedido';

export class BrokerIndisponivelError extends Error {
  readonly origem = 'infra';
  readonly motivo: MotivoDeBrokerIndisponivel;

  constructor(motivo: MotivoDeBrokerIndisponivel, detalhe: string) {
    super(detalhe);
    this.name = 'BrokerIndisponivelError';
    this.motivo = motivo;
  }
}

/**
 * Espelho de `RecursosDoHost` (`brabo-contracts:packages/docker-port`, ADR 0298,
 * AT-980): o que o broker lê do host. `projectId: null` na porta = container de
 * terceiro (só o número sai).
 */
export interface RecursosDoHost {
  portas: Array<{
    host: number;
    ip: string;
    protocolo: string;
    projectId: string | null;
  }>;
  containers: Array<{
    projectId: string;
    papel: 'trabalho' | 'qa' | 'servico_qa';
    estado: string;
    nome: string;
  }>;
  redes: Array<{ projectId: string; nome: string }>;
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
    timeoutMs?: number,
  ): Promise<ResultadoDeExecNoContainer>;

  /**
   * RN-1026: reinicia SÓ o processo do app, no lugar. O comando NÃO viaja: o
   * broker o lê da `container-spec`.
   */
  abstract reiniciarApp(projectId: string): Promise<ResultadoDoReinicioDoApp>;

  /** AT-612 (ADR 0229): a instância de QA efêmera. `chave` = `chaveDeQa(taskId)`. */
  abstract startQa(
    projectId: string,
    chave: string,
  ): Promise<ContainerIniciadoPeloBroker>;
  abstract removeQa(projectId: string, chave: string): Promise<void>;
  abstract execQa(
    projectId: string,
    chave: string,
    comando: string,
    cwd?: string,
    timeoutMs?: number,
  ): Promise<ResultadoDeExecNoContainer>;

  /** AT-922 (ADR 0297): `docker compose up --build` do clone limpo, num projeto compose descartável. Dura até 10 min. */
  abstract provaDeCompose(
    projectId: string,
    chave: string,
  ): Promise<ResultadoDaProvaDeCompose>;

  /** ADR 0298: `GET /host/recursos`, só leitura. Lança `BrokerIndisponivelError` se não deu para ler. */
  abstract recursosDoHost(): Promise<RecursosDoHost>;

  /**
   * ADR 0298: `POST /containers/:id/orfao/remove`. Só vale com o projeto JÁ
   * apagado (o broker pergunta à api e recusa com 409 se ele existe).
   */
  abstract removerOrfao(projectId: string): Promise<void>;
}
