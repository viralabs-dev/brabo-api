import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAMADAS_DE_CONTROLE_NO_START,
  CONTEXTO_DO_BROKER_MS,
  CONTROLE_DO_DOCKER_MS,
  EXEC_PADRAO_DO_BROKER_MS,
  FOLGA_DO_EXEC_NO_ENGINE_MS,
  HttpContainerBrokerClient,
  TETO_DE_LEITURA_MS,
  TETO_DE_MUTACAO_MS,
  TETO_DO_PROPOSE_ACTION_DE_CONTAINER_NO_ENGINE_MS,
  tetoDaOperacao,
} from '../../../src/infrastructure/http-clients/container-broker.client';
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
      vi.fn((url: string, init: RequestInit) => {
        chamadas.push({ url: String(url), init });
        return Promise.resolve({
          ok: status >= 200 && status < 300,
          status,
          text: () => Promise.resolve(JSON.stringify(corpo)),
        } as Response);
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

    expect(chamadas[0]?.url).toBe('http://broker:8090/containers/proj-1/exec');
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

  it('o pull que estoura o teto do broker chega NOMEADO e com origem `infra` (AT-234)', async () => {
    // O corpo é o que `respostaDeErro` do broker monta para
    // `PullExcedeuTetoError`. Antes da AT-234 este mesmo estouro chegava como
    // 502, "código -1, sem saída de erro", e `origem: null`.
    responder(504, {
      erro:
        'o `docker pull node:24-bookworm` não terminou dentro do teto de ' +
        '30000ms e foi cancelado: parar de esperar o CLI cancela o download ' +
        'no daemon, então a imagem continua ausente. Imagem grande não sobe ' +
        'por este caminho — limitação declarada (AT-234, RN-605).',
      origem: 'infra',
    });

    const erro = await capturar(() =>
      new HttpContainerBrokerClient().start('p'),
    );

    expect(erro).toBeInstanceOf(BrokerRecusouError);
    const recusa = erro as BrokerRecusouError;
    expect(recusa.status).toBe(504);
    expect(recusa.origem).toBe('infra');
    expect(recusa.message).toContain('node:24-bookworm');
    expect(recusa.message).toContain('foi cancelado');
  });

  it('falha de transporte vira `sem-resposta`, distinta de `nao-configurado`', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    );

    const erro = await capturar(() =>
      new HttpContainerBrokerClient().inspect('p'),
    );

    expect((erro as BrokerIndisponivelError).motivo).toBe('sem-resposta');
  });

  it('cada operação leva o PRÓPRIO teto no AbortSignal (AT-233)', async () => {
    responder(200, { exitCode: 0, output: '', timedOut: false });
    const espiao = vi.spyOn(AbortSignal, 'timeout');
    const cliente = new HttpContainerBrokerClient();

    await cliente.inspect('p');
    await cliente.exec('p', 'npm test', undefined, 120_000);
    await cliente.exec('p', 'ls');
    await cliente.start('p');
    await cliente.stop('p');
    await cliente.remove('p');

    expect(espiao.mock.calls.map(([ms]) => ms)).toEqual([
      TETO_DE_LEITURA_MS,
      tetoDaOperacao('exec', 120_000),
      tetoDaOperacao('exec', undefined),
      TETO_DE_MUTACAO_MS,
      TETO_DE_MUTACAO_MS,
      TETO_DE_MUTACAO_MS,
    ]);
  });

  it('teto estourado vira `teto-excedido` NOMEANDO a operação e o número, nunca "sem resposta"', async () => {
    // É a forma com que o `AbortSignal.timeout` rejeita o `fetch` do Node.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.reject(
          new DOMException(
            'The operation was aborted due to timeout',
            'TimeoutError',
          ),
        ),
      ),
    );

    const erro = await capturar(() =>
      new HttpContainerBrokerClient().exec('p', 'npm test', undefined, 60_000),
    );

    expect(erro).toBeInstanceOf(BrokerIndisponivelError);
    expect((erro as BrokerIndisponivelError).motivo).toBe('teto-excedido');
    expect(erro?.message).toContain('`exec`');
    expect(erro?.message).toContain(`${tetoDaOperacao('exec', 60_000)}ms`);
    expect(erro?.message).toContain('pode seguir rodando');
  });

  it('teto estourado num `start` diz que o efeito pode ter acontecido do lado de lá', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new DOMException('timeout', 'TimeoutError'))),
    );

    const erro = await capturar(() =>
      new HttpContainerBrokerClient().start('p'),
    );

    expect((erro as BrokerIndisponivelError).motivo).toBe('teto-excedido');
    expect(erro?.message).toContain('`start`');
    expect(erro?.message).toContain(`${TETO_DE_MUTACAO_MS}ms`);
    expect(erro?.message).toContain('/containers');
  });

  it('o teto de cabeçalhos do undici (300s) também é dito como teto, com o número dele', async () => {
    const causa = Object.assign(new Error('Headers Timeout Error'), {
      code: 'UND_ERR_HEADERS_TIMEOUT',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.reject(new TypeError('fetch failed', { cause: causa })),
      ),
    );

    const erro = await capturar(() =>
      new HttpContainerBrokerClient().exec('p', 'make', undefined, 400_000),
    );

    expect((erro as BrokerIndisponivelError).motivo).toBe('teto-excedido');
    expect(erro?.message).toContain('300000ms');
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

/**
 * AT-233 — a REPRODUÇÃO, contra um broker falso de verdade (`node:http`), sem
 * `fetch` substituído: o que se prova aqui é o `AbortSignal` que o cliente
 * põe na chamada, e isso só aparece com um socket esperando do outro lado.
 *
 * Na base, o teto era 5s para as cinco operações: um `exec` que o broker
 * responde em 6s — dentro do `timeoutMs` de 8s que o próprio pedido carrega —
 * voltava como `BrokerIndisponivelError('sem-resposta')`, o broker dito fora
 * do ar enquanto o comando rodava normalmente.
 */
describe('HttpContainerBrokerClient contra um broker que demora (AT-233)', () => {
  let servidor: Server;
  let urlAnterior: string | undefined;
  let tokenAnterior: string | undefined;

  beforeEach(async () => {
    vi.unstubAllGlobals();
    urlAnterior = process.env.BROKER_URL;
    tokenAnterior = process.env.BRABO_SERVICE_TOKEN;
    process.env.BRABO_SERVICE_TOKEN = 'segredo-de-teste-16';
    servidor = createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ exitCode: 0, output: 'ok', timedOut: false }));
      }, 6_000);
    });
    await new Promise<void>((pronto) =>
      servidor.listen(0, '127.0.0.1', pronto),
    );
    const { port } = servidor.address() as AddressInfo;
    process.env.BROKER_URL = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    servidor.closeAllConnections();
    await new Promise<void>((fechado) => servidor.close(() => fechado()));
    if (urlAnterior === undefined) delete process.env.BROKER_URL;
    else process.env.BROKER_URL = urlAnterior;
    if (tokenAnterior === undefined) delete process.env.BRABO_SERVICE_TOKEN;
    else process.env.BRABO_SERVICE_TOKEN = tokenAnterior;
  });

  it('`exec` de 6s com `timeoutMs` de 8s chega ao fim, sem o teto da leitura cortar', async () => {
    const resultado = await new HttpContainerBrokerClient().exec(
      'proj-1',
      'npm test',
      '/work',
      8_000,
    );

    expect(resultado).toEqual({ exitCode: 0, output: 'ok', timedOut: false });
  }, 20_000);
});

describe('tetoDaOperacao', () => {
  it('`inspect` segue curto: é caminho de leitura de tela', () => {
    expect(tetoDaOperacao('inspect')).toBe(5_000);
  });

  it('`exec` cresce com o `timeoutMs` e sempre passa dele', () => {
    for (const timeoutMs of [1_000, 15_000, 60_000, 600_000]) {
      expect(tetoDaOperacao('exec', timeoutMs)).toBeGreaterThan(timeoutMs);
    }
    expect(tetoDaOperacao('exec', 600_000)).toBeGreaterThan(
      tetoDaOperacao('exec', 60_000),
    );
  });

  it('`exec` sem `timeoutMs` usa o default do BROKER, não o teto da leitura', () => {
    expect(tetoDaOperacao('exec')).toBe(
      tetoDaOperacao('exec', EXEC_PADRAO_DO_BROKER_MS),
    );
    expect(tetoDaOperacao('exec')).toBeGreaterThan(EXEC_PADRAO_DO_BROKER_MS);
  });

  it('a cadeia é broker < api < engine para qualquer `timeoutMs`', () => {
    // O broker corta o comando em `timeoutMs`; a api tem de esperar mais que
    // isso; o engine, mais que a api. Se o engine esperar menos, o desfecho
    // honesto da api (`sucesso: false` nomeado) chega a ninguém.
    for (const timeoutMs of [1, 5_000, 15_000, 30_000, 120_000, 250_000]) {
      const api = tetoDaOperacao('exec', timeoutMs);
      expect(api).toBeGreaterThan(timeoutMs);
      expect(timeoutMs + FOLGA_DO_EXEC_NO_ENGINE_MS).toBeGreaterThan(api);
    }
  });

  it('as três mutações cobrem o pior caso do próprio broker (RN-604/RN-605)', () => {
    // contexto + os DOIS `ps` de `resolver` + `image inspect` + `pull` + `run`
    // + o `docker version` de diagnóstico. A conta da AT-233 esquecia o
    // segundo `ps` (130s de pior caso contra 105s de teto).
    expect(CHAMADAS_DE_CONTROLE_NO_START).toBe(6);
    expect(TETO_DE_MUTACAO_MS).toBeGreaterThan(
      CONTEXTO_DO_BROKER_MS +
        CHAMADAS_DE_CONTROLE_NO_START * CONTROLE_DO_DOCKER_MS,
    );
    expect(TETO_DE_MUTACAO_MS).toBe(195_000);
    for (const op of ['start', 'stop', 'remove'] as const) {
      expect(tetoDaOperacao(op)).toBe(TETO_DE_MUTACAO_MS);
    }
  });

  it('a cadeia é broker < api < engine também no `container_start` auto-aprovado', () => {
    // `@teto_do_propose_action_de_container_ms` do engine
    // (`engine_api_client.ex`): o `propose_action` de `container_start`
    // auto-aprovado espera a api, que espera o broker. Espelho, como
    // `FOLGA_DO_EXEC_NO_ENGINE_MS`.
    expect(TETO_DE_MUTACAO_MS).toBeLessThan(
      TETO_DO_PROPOSE_ACTION_DE_CONTAINER_NO_ENGINE_MS,
    );
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
