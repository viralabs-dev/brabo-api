import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpContainerBrokerClient } from '../../../src/infrastructure/http-clients/container-broker.client';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
} from '../../../src/application/ports/container-broker.port';
import { CABECALHO_SERVICE_TOKEN } from '../../../src/interfaces/http/auth/engine-service.guard';

/**
 * O cliente do broker, com `fetch` substituído. O que se prova aqui é o que a
 * api MANDA — e a asserção que importa é sobre o que ela NÃO manda.
 */
describe('HttpContainerBrokerClient', () => {
  // Restaura CHAVE A CHAVE, e não `process.env = {...}`: trocar o objeto
  // inteiro descarta qualquer variável que tenha sido definida depois da
  // captura — inclusive as que o `globalSetup` usa para achar o banco de
  // teste. É a diferença entre limpar o que este arquivo sujou e reescrever o
  // ambiente do worker.
  const antes: Record<string, string | undefined> = {};
  let chamadas: Array<{ url: string; init: RequestInit }>;

  beforeEach(() => {
    chamadas = [];
    for (const chave of ['BROKER_URL', 'BRABO_SERVICE_TOKEN']) {
      antes[chave] = process.env[chave];
    }
    process.env.BROKER_URL = 'http://broker:8090';
    process.env.BRABO_SERVICE_TOKEN = 'segredo-de-teste-16';
  });

  afterEach(() => {
    for (const [chave, valor] of Object.entries(antes)) {
      if (valor === undefined) delete process.env[chave];
      else process.env[chave] = valor;
    }
    vi.restoreAllMocks();
  });

  function responder(status: number, corpo: unknown): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        chamadas.push({ url: String(url), init });
        return {
          ok: status >= 200 && status < 300,
          status,
          text: async () => JSON.stringify(corpo),
        } as Response;
      }),
    );
  }

  it('lê o estado observado pela rota do projeto, com o token de serviço', async () => {
    responder(200, { observado: { containerId: 'c0ffee', estado: 'running' } });

    const observado = await new HttpContainerBrokerClient().inspect('proj-1');

    expect(chamadas[0]?.url).toBe('http://broker:8090/containers/proj-1');
    expect(
      (chamadas[0]?.init.headers as Record<string, string>)[
        CABECALHO_SERVICE_TOKEN
      ],
    ).toBe('segredo-de-teste-16');
    expect(observado).toMatchObject({ estado: 'running' });
  });

  it('`start` manda corpo VAZIO — a especificação não viaja daqui', async () => {
    // É a decisão central do broker vista deste lado: não há campo em que a
    // api escreva imagem, rede, recursos ou mount, porque o broker os computa.
    responder(200, {
      containerId: 'c0ffee',
      nome: 'brabo-x',
      jaEstavaDePe: false,
    });

    await new HttpContainerBrokerClient().start('proj-1');

    expect(chamadas[0]?.init.body).toBeUndefined();
    expect(chamadas[0]?.url).toBe('http://broker:8090/containers/proj-1/start');
  });

  it('`exec` manda comando/cwd/timeoutMs no corpo', async () => {
    responder(200, { exitCode: 0, output: 'ok', timedOut: false });

    await new HttpContainerBrokerClient().exec(
      'proj-1',
      'npm test',
      '/work',
      60_000,
    );

    expect(chamadas[0]?.url).toBe(
      'http://broker:8090/containers/proj-1/exec',
    );
    expect(JSON.parse(chamadas[0]?.init.body as string)).toEqual({
      comando: 'npm test',
      cwd: '/work',
      timeoutMs: 60_000,
    });
  });

  it('sem BROKER_URL, lança `nao-configurado` sem tocar a rede', async () => {
    delete process.env.BROKER_URL;
    responder(200, {});

    const erro = await capturar(() =>
      new HttpContainerBrokerClient().inspect('p'),
    );

    expect(erro).toBeInstanceOf(BrokerIndisponivelError);
    expect((erro as BrokerIndisponivelError).motivo).toBe('nao-configurado');
    expect(chamadas).toHaveLength(0);
  });

  it('repassa a ORIGEM que o broker declarou, e o `null` dele também', async () => {
    // `ComandoDeDockerFalhouError` não declara origem de propósito (ADR 0128):
    // imagem inexistente, disco cheio e nome em uso chegam pelo mesmo canal.
    // Escolher uma aqui seria o diagnóstico por eliminação do ADR 0020.
    responder(502, {
      erro: '`docker run` terminou com código 125',
      origem: null,
    });

    const erro = await capturar(() =>
      new HttpContainerBrokerClient().start('p'),
    );

    expect(erro).toBeInstanceOf(BrokerRecusouError);
    expect((erro as BrokerRecusouError).origem).toBeNull();
    expect((erro as BrokerRecusouError).status).toBe(502);
  });

  it('falha de transporte vira `sem-resposta`, distinta de `nao-configurado`', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    const erro = await capturar(() =>
      new HttpContainerBrokerClient().inspect('p'),
    );

    expect((erro as BrokerIndisponivelError).motivo).toBe('sem-resposta');
  });

  it('recusa projectId que não é segmento de URL antes de montar a chamada', async () => {
    responder(200, {});

    const erro = await capturar(() =>
      new HttpContainerBrokerClient().inspect('../internal/gates'),
    );

    expect(erro).toBeInstanceOf(BrokerRecusouError);
    expect(chamadas).toHaveLength(0);
  });
});

async function capturar(f: () => Promise<unknown>): Promise<Error | undefined> {
  try {
    await f();
    return undefined;
  } catch (erro) {
    return erro as Error;
  }
}
