import { Injectable } from '@nestjs/common';
import { CABECALHO_SERVICE_TOKEN } from '../../interfaces/http/auth/engine-service.guard';
import { tokenDeServicoAtual } from '../security/service-token';
import { Traced } from '../observability/traced.decorator';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
  ContainerBrokerPort,
  type ContainerIniciadoPeloBroker,
  type ObservacaoDeContainer,
  type ResultadoDeExecNoContainer,
} from '../../application/ports/container-broker.port';

/**
 * O cliente HTTP do broker de container (ADR 0130).
 *
 * Mesmo desenho de `HttpApiToEngineClient`, e pelas mesmas razões: `fetch`
 * nativo, o segredo compartilhado (`BRABO_SERVICE_TOKEN`) em cabeçalho próprio,
 * sem cache de token (ler uma env por chamada custa menos que a invalidação que
 * um cache exigiria).
 *
 * ## O que este cliente NÃO manda
 *
 * Especificação. Nem imagem, nem rede, nem recursos, nem caminho — o corpo de
 * `start`/`stop`/`remove` é VAZIO, e o de `exec` tem comando e `cwd`. Isso não
 * é economia de bytes: é a decisão central do broker, e ela só vale enquanto o
 * chamador não tiver como mandar mais. Se um dia alguém precisar acrescentar um
 * campo aqui, a pergunta certa é por que o broker deveria aceitá-lo.
 *
 * ## `BROKER_URL` vazia é estado normal
 *
 * O broker sobe sob `profile` no Compose (é o único serviço com o socket do
 * Docker montado, e não faz sentido tê-lo de pé em toda máquina de
 * desenvolvimento). Sem a variável, `configurado()` é `false` e quem lê DIZ que
 * não observou, em vez de herdar o estado registrado.
 *
 * ## Um teto por operação (AT-233, RN-604)
 *
 * Até a AT-233 havia UM teto, 5s, para as cinco — justificado pelo caminho de
 * LEITURA de tela e aplicado também a `exec`, cujo pedido CARREGA o próprio
 * `timeoutMs`, e a `start`, que espera o `docker run` (e o pull de imagem que
 * ele faz). Todo comando de terminal com mais de 5s num projeto
 * `container`/`mounted` voltava como "o broker não respondeu". Ver
 * `tetoDaOperacao`.
 */
@Injectable()
export class HttpContainerBrokerClient extends ContainerBrokerPort {
  configurado(): boolean {
    return (process.env.BROKER_URL ?? '').trim().length > 0;
  }

  @Traced('infrastructure')
  async start(projectId: string): Promise<ContainerIniciadoPeloBroker> {
    return this.chamar<ContainerIniciadoPeloBroker>(
      'start',
      'POST',
      `/containers/${segmento(projectId)}/start`,
    );
  }

  async stop(projectId: string): Promise<void> {
    await this.chamar(
      'stop',
      'POST',
      `/containers/${segmento(projectId)}/stop`,
    );
  }

  async remove(projectId: string): Promise<void> {
    await this.chamar(
      'remove',
      'POST',
      `/containers/${segmento(projectId)}/remove`,
    );
  }

  @Traced('infrastructure')
  async inspect(projectId: string): Promise<ObservacaoDeContainer | null> {
    const corpo = await this.chamar<{
      observado: ObservacaoDeContainer | null;
    }>('inspect', 'GET', `/containers/${segmento(projectId)}`);
    return corpo.observado ?? null;
  }

  async exec(
    projectId: string,
    comando: string,
    cwd?: string,
    timeoutMs?: number,
  ): Promise<ResultadoDeExecNoContainer> {
    return this.chamar<ResultadoDeExecNoContainer>(
      'exec',
      'POST',
      `/containers/${segmento(projectId)}/exec`,
      { comando, cwd, timeoutMs },
      timeoutMs,
    );
  }

  private async chamar<T>(
    operacao: OperacaoDoBroker,
    metodo: string,
    caminho: string,
    corpo?: unknown,
    timeoutDoExecMs?: number,
  ): Promise<T> {
    const base = (process.env.BROKER_URL ?? '').trim().replace(/\/+$/, '');
    if (base.length === 0) {
      throw new BrokerIndisponivelError(
        'nao-configurado',
        'BROKER_URL não está definida — o broker de container não faz parte ' +
          'desta instalação. Suba-o com o profile `container-broker` do ' +
          'Compose e aponte BROKER_URL para ele.',
      );
    }

    const tetoMs = tetoDaOperacao(operacao, timeoutDoExecMs);
    let resposta: Response;
    try {
      resposta = await fetch(`${base}${caminho}`, {
        method: metodo,
        headers: {
          [CABECALHO_SERVICE_TOKEN]: tokenDeServicoAtual(),
          'content-type': 'application/json',
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(tetoMs),
      });
    } catch (erro) {
      throw erroDeTransporte(erro, operacao, tetoMs, base);
    }

    const texto = await resposta.text();
    const json = interpretar(texto);

    if (!resposta.ok) {
      const detalhe = json as { erro?: unknown; origem?: unknown };
      throw new BrokerRecusouError(
        resposta.status,
        typeof detalhe.erro === 'string'
          ? detalhe.erro
          : `o broker respondeu ${resposta.status}`,
        // A origem vem do BROKER, e `null` é resposta legítima dele — não
        // inventamos uma para preencher o campo.
        typeof detalhe.origem === 'string' ? detalhe.origem : null,
      );
    }

    return json as T;
  }
}

export type OperacaoDoBroker = 'inspect' | 'exec' | 'start' | 'stop' | 'remove';

/*
 * Os números do OUTRO lado de que os tetos daqui derivam. São ESPELHOS, e não
 * imports: a api não consome o pacote da porta de Docker (ele não tem passo de
 * build, e `api-nao-consome-docker-port.spec.ts` reprova o import). Mudou lá,
 * muda aqui.
 */

/** `TIMEOUT_DE_EXEC_PADRAO_MS` (`packages/docker-port/src/docker-cli.ts`): o teto que o broker aplica a um `exec` que chega SEM `timeoutMs`. */
export const EXEC_PADRAO_DO_BROKER_MS = 15_000;

/** `TIMEOUT_DE_CONTROLE_MS` (`packages/docker-port/src/docker-cli.ts`): cada chamada de controle do broker ao daemon — `ps`, `run`, `start`, `stop`, `rm`, e o `docker version` que ele roda quando uma delas falha, para nomear a causa. */
export const CONTROLE_DO_DOCKER_MS = 30_000;

/** `TIMEOUT_MS` (`apps/broker/src/api-client.ts`): o broker lê o contexto do projeto NESTA api antes de toda operação. */
export const CONTEXTO_DO_BROKER_MS = 10_000;

/** Rede interna, serialização, fila do event loop dos dois lados. */
export const MARGEM_DE_TRANSPORTE_MS = 5_000;

/**
 * `inspect` — o caminho de LEITURA de tela (RN-486, `/containers`). Segue
 * curto de propósito e NÃO deriva do pior caso do broker: uma tela que espera
 * 70s por um serviço que pode nem estar de pé é pior do que uma que declara
 * "não observado".
 */
export const TETO_DE_LEITURA_MS = 5_000;

/**
 * `start`/`stop`/`remove` — o pior caso que o PRÓPRIO broker se permite:
 * contexto + `ps` (resolver o container pelo nome) + a operação (`run`, onde
 * acontece o pull de imagem que ainda não está no daemon; `stop`, que inclui
 * os 10s de graça entre SIGTERM e SIGKILL; `rm --force`) + o `docker version`
 * que ele roda quando a operação falha, para dizer se o daemon caiu. Esperar
 * isso é esperar a RESPOSTA do broker, inclusive a recusa nomeada dele quando
 * o `run` estoura o teto de 30s dele — por isso o número não é "o tempo de um
 * pull": o pull mais longo que o broker aceita já está dentro. Pull que passa
 * de 30s é cortado pelo broker, não por aqui (lacuna declarada na RN-604).
 */
export const TETO_DE_MUTACAO_MS =
  CONTEXTO_DO_BROKER_MS + 3 * CONTROLE_DO_DOCKER_MS + MARGEM_DE_TRANSPORTE_MS;

/**
 * O engine espera, na chamada `container-exec` a esta api, o `timeoutMs` do
 * comando MAIS esta folga (`@folga_do_exec_no_container_ms`,
 * `apps/engine/lib/engine/sessions/engine_api_client.ex`). Espelho, para o
 * teste afirmar a ordem broker < api < engine: um teto que só sobe de um lado
 * não conserta nada.
 */
export const FOLGA_DO_EXEC_NO_ENGINE_MS = 90_000;

/**
 * O teto da chamada HTTP à rota do broker, por operação.
 *
 * `exec` DERIVA do `timeoutMs` que carrega (ou do default do broker, quando
 * vem sem ele): contexto + `ps` + o maior entre o comando e o `docker version`
 * que um `ps` que falha dispara, mais a margem. O broker corta o comando no
 * `timeoutMs` e RESPONDE `timedOut: true` — a api tem de estar esperando
 * quando essa resposta chega, senão o desfecho honesto do broker vira "sem
 * resposta" aqui.
 */
export function tetoDaOperacao(
  operacao: OperacaoDoBroker,
  timeoutDoExecMs?: number,
): number {
  switch (operacao) {
    case 'inspect':
      return TETO_DE_LEITURA_MS;
    case 'exec': {
      const comando = timeoutDoExecMs ?? EXEC_PADRAO_DO_BROKER_MS;
      return (
        CONTEXTO_DO_BROKER_MS +
        CONTROLE_DO_DOCKER_MS +
        Math.max(comando, CONTROLE_DO_DOCKER_MS) +
        MARGEM_DE_TRANSPORTE_MS
      );
    }
    case 'start':
    case 'stop':
    case 'remove':
      return TETO_DE_MUTACAO_MS;
  }
}

/**
 * Falha do `fetch`, separada em DUAS: o teto DESTA operação estourou (o broker
 * atendeu e não respondeu a tempo, ou o transporte do Node cortou antes), ou
 * não houve conversa nenhuma (conexão recusada, DNS). A primeira nomeia a
 * operação e o número; dizê-la como "o broker não respondeu" mandava
 * investigar a rede em vez do teto (AT-233).
 */
function erroDeTransporte(
  erro: unknown,
  operacao: OperacaoDoBroker,
  tetoMs: number,
  base: string,
): BrokerIndisponivelError {
  if (nomeDoErro(erro) === 'TimeoutError') {
    return new BrokerIndisponivelError(
      'teto-excedido',
      `o broker de container não respondeu \`${operacao}\` dentro do teto ` +
        `desta operação (${tetoMs}ms, em ${base})` +
        consequenciaDoTeto(operacao),
    );
  }
  // O `fetch` do Node (undici) espera os CABEÇALHOS por no máximo 300s, e
  // isso vale mesmo com um `AbortSignal` mais longo: um `exec` com `timeoutMs`
  // acima de ~255s é cortado AQUI. Declarado na RN-604, e dito com o nome.
  if (codigoDaCausa(erro) === 'UND_ERR_HEADERS_TIMEOUT') {
    return new BrokerIndisponivelError(
      'teto-excedido',
      `o broker de container não respondeu \`${operacao}\` dentro do teto de ` +
        `cabeçalhos do cliente HTTP do Node (300000ms, em ${base}), menor que ` +
        `o teto desta operação (${tetoMs}ms)` +
        consequenciaDoTeto(operacao),
    );
  }
  return new BrokerIndisponivelError(
    'sem-resposta',
    `o broker de container não respondeu em ${base}: ${descrever(erro)}`,
  );
}

function consequenciaDoTeto(operacao: OperacaoDoBroker): string {
  switch (operacao) {
    case 'inspect':
      return '.';
    case 'exec':
      return (
        '. O comando pode seguir rodando dentro do container: parar de ' +
        'esperar não o mata.'
      );
    case 'start':
    case 'stop':
    case 'remove':
      return (
        '. O efeito pode ter acontecido do lado de lá (o daemon não desfaz ' +
        'um `run` ou um pull porque esta chamada desistiu) — confira o estado ' +
        'observado em /containers antes de repetir.'
      );
  }
}

function nomeDoErro(erro: unknown): string | undefined {
  if (typeof erro !== 'object' || erro === null || !('name' in erro)) {
    return undefined;
  }
  const nome = erro.name;
  return typeof nome === 'string' ? nome : undefined;
}

function codigoDaCausa(erro: unknown): string | undefined {
  if (typeof erro !== 'object' || erro === null || !('cause' in erro)) {
    return undefined;
  }
  const causa = erro.cause;
  if (typeof causa !== 'object' || causa === null || !('code' in causa)) {
    return undefined;
  }
  const codigo = causa.code;
  return typeof codigo === 'string' ? codigo : undefined;
}

function interpretar(texto: string): unknown {
  if (texto.trim().length === 0) return {};
  try {
    return JSON.parse(texto);
  } catch {
    return {};
  }
}

/**
 * `projectId` vira SEGMENTO DE URL sem DTO no meio, exatamente como em
 * `api-to-engine-client.ts` — e com a mesma largura de aceitação (RN-128).
 * Repetir a checagem aqui é de propósito: ela pertence a quem MONTA a URL.
 */
const SEGMENTO_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;

function segmento(valor: string): string {
  if (!SEGMENTO_VALIDO.test(valor)) {
    throw new BrokerRecusouError(
      400,
      `projectId inválido para requisição ao broker: ${JSON.stringify(valor)}`,
      'codigo',
    );
  }
  return valor;
}

function descrever(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
