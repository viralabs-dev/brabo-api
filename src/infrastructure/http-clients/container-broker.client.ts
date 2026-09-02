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
 */
@Injectable()
export class HttpContainerBrokerClient extends ContainerBrokerPort {
  /**
   * Teto curto: o broker está do outro lado de uma rede interna, e esta chamada
   * entra num caminho de LEITURA de tela. Uma tela que espera 30s por um
   * serviço que pode nem estar de pé é pior do que uma que declara ausência.
   */
  private static readonly TIMEOUT_MS = 5_000;

  configurado(): boolean {
    return (process.env.BROKER_URL ?? '').trim().length > 0;
  }

  @Traced('infrastructure')
  async start(projectId: string): Promise<ContainerIniciadoPeloBroker> {
    return this.chamar<ContainerIniciadoPeloBroker>(
      'POST',
      `/containers/${segmento(projectId)}/start`,
    );
  }

  async stop(projectId: string): Promise<void> {
    await this.chamar('POST', `/containers/${segmento(projectId)}/stop`);
  }

  async remove(projectId: string): Promise<void> {
    await this.chamar('POST', `/containers/${segmento(projectId)}/remove`);
  }

  @Traced('infrastructure')
  async inspect(projectId: string): Promise<ObservacaoDeContainer | null> {
    const corpo = await this.chamar<{
      observado: ObservacaoDeContainer | null;
    }>('GET', `/containers/${segmento(projectId)}`);
    return corpo.observado ?? null;
  }

  async exec(
    projectId: string,
    comando: string,
    cwd?: string,
  ): Promise<ResultadoDeExecNoContainer> {
    return this.chamar<ResultadoDeExecNoContainer>(
      'POST',
      `/containers/${segmento(projectId)}/exec`,
      { comando, cwd },
    );
  }

  private async chamar<T>(
    metodo: string,
    caminho: string,
    corpo?: unknown,
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

    let resposta: Response;
    try {
      resposta = await fetch(`${base}${caminho}`, {
        method: metodo,
        headers: {
          [CABECALHO_SERVICE_TOKEN]: tokenDeServicoAtual(),
          'content-type': 'application/json',
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(HttpContainerBrokerClient.TIMEOUT_MS),
      });
    } catch (erro) {
      throw new BrokerIndisponivelError(
        'sem-resposta',
        `o broker de container não respondeu em ${base}: ${descrever(erro)}`,
      );
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
