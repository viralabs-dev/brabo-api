import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import type { Response } from 'express';
import { RunnerReleasesController } from '../../src/interfaces/http/runner/runner-releases.controller';
import {
  parsearChecksums,
  type MotivoDaRecusa,
} from '../../src/interfaces/http/runner/checksums';

function fakeResponse() {
  const stream = new PassThrough();
  const headers: Record<string, string> = {};
  const res = Object.assign(stream, {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
  });
  return { res: res as unknown as Response, headers, stream };
}

function respostaDaRelease(
  assets: Array<{ name: string; browser_download_url: string }>,
) {
  return {
    ok: true,
    json: () => Promise.resolve({ assets }),
  } as unknown as globalThis.Response;
}

function respostaDoAsset(bytes: Uint8Array) {
  return {
    ok: true,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  } as unknown as globalThis.Response;
}

function respostaDoManifesto(texto: string) {
  return {
    ok: true,
    text: () => Promise.resolve(texto),
  } as unknown as globalThis.Response;
}

const URL_DO_BINARIO = 'https://example.com/asset';
const URL_DO_MANIFESTO = 'https://example.com/checksums';

/** A release "normal" desta suíte: um binário linux-x64 e o manifesto. */
const ASSETS_COM_MANIFESTO = [
  {
    name: 'brabo-runner-linux-x64',
    browser_download_url: URL_DO_BINARIO,
  },
  { name: 'checksums.txt', browser_download_url: URL_DO_MANIFESTO },
];

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** O `motivo` que a api pôs no corpo da recusa — o que o cliente lê. */
async function motivoDe(chamada: Promise<unknown>): Promise<MotivoDaRecusa> {
  try {
    await chamada;
  } catch (erro) {
    expect(erro).toBeInstanceOf(BadGatewayException);
    const corpo = (erro as BadGatewayException).getResponse() as {
      motivo: MotivoDaRecusa;
    };
    return corpo.motivo;
  }
  throw new Error('esperava uma recusa, e a chamada passou');
}

/**
 * `RunnerReleasesController` proxeia o binário standalone do runner
 * publicado em GitHub Releases — e, desde a RN-525 (ADR 0149), confere o
 * sha256 dos bytes contra o `checksums.txt` da MESMA release antes de
 * responder qualquer coisa.
 *
 * O que esta suíte fixa, além do caminho feliz: que nenhum byte sai sem
 * conferência (release sem manifesto RECUSA, em vez de servir avisando), e
 * que os seis desfechos de 502 são distinguíveis pelo `motivo` no corpo —
 * porque o cliente age diferente em cada um.
 */
describe('RunnerReleasesController', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('caminho feliz: confere o hash contra o manifesto e streama os bytes de volta', async () => {
    const controller = new RunnerReleasesController();
    const bytes = new TextEncoder().encode('binario-fake');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaDaRelease(ASSETS_COM_MANIFESTO))
      .mockResolvedValueOnce(
        respostaDoManifesto(`${sha256(bytes)}  brabo-runner-linux-x64\n`),
      )
      .mockResolvedValueOnce(respostaDoAsset(bytes));
    vi.stubGlobal('fetch', fetchMock);

    const { res, headers, stream } = fakeResponse();
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));

    await controller.binary('linux-x64', res);

    expect(headers['Content-Type']).toBe('application/octet-stream');
    expect(headers['Content-Disposition']).toBe(
      'attachment; filename="brabo-runner"',
    );
    // RFC 9530 — o header repete o hash conferido, em base64.
    expect(headers['Content-Digest']).toBe(
      `sha-256=:${Buffer.from(sha256(bytes), 'hex').toString('base64')}:`,
    );
    expect(Buffer.concat(chunks).toString()).toBe('binario-fake');
    expect(fetchMock.mock.calls[0][0]).toContain('releases/latest');
    expect(fetchMock.mock.calls[1][0]).toBe(URL_DO_MANIFESTO);
    expect(fetchMock.mock.calls[2][0]).toBe(URL_DO_BINARIO);
  });

  it('hash divergente: 502 nomeado e NENHUM byte no corpo', async () => {
    const controller = new RunnerReleasesController();
    const bytes = new TextEncoder().encode('binario-adulterado');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaDaRelease(ASSETS_COM_MANIFESTO))
      .mockResolvedValueOnce(
        respostaDoManifesto(`${'0'.repeat(64)}  brabo-runner-linux-x64\n`),
      )
      .mockResolvedValueOnce(respostaDoAsset(bytes));
    vi.stubGlobal('fetch', fetchMock);

    const { res, headers, stream } = fakeResponse();
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));

    expect(await motivoDe(controller.binary('linux-x64', res))).toBe(
      'hash_divergente',
    );
    // Nem header nem byte: a resposta só COMEÇA depois de o hash bater.
    expect(headers['Content-Type']).toBeUndefined();
    expect(chunks).toHaveLength(0);
  });

  it('release sem checksums.txt: RECUSA, nunca serve avisando', async () => {
    const controller = new RunnerReleasesController();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      respostaDaRelease([
        {
          name: 'brabo-runner-linux-x64',
          browser_download_url: URL_DO_BINARIO,
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { res, headers } = fakeResponse();

    expect(await motivoDe(controller.binary('linux-x64', res))).toBe(
      'release_sem_manifesto',
    );
    expect(headers['Content-Type']).toBeUndefined();
    // Sem manifesto listado, o binário nem chega a ser baixado.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('manifesto que não cobre a plataforma: motivo próprio, distinto de "sem manifesto"', async () => {
    const controller = new RunnerReleasesController();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaDaRelease(ASSETS_COM_MANIFESTO))
      .mockResolvedValueOnce(
        respostaDoManifesto(`${'a'.repeat(64)}  brabo-runner-darwin-arm64\n`),
      );
    vi.stubGlobal('fetch', fetchMock);
    const { res } = fakeResponse();

    expect(await motivoDe(controller.binary('linux-x64', res))).toBe(
      'manifesto_nao_cobre_a_plataforma',
    );
  });

  it('manifesto listado mas ilegível: motivo próprio, distinto de "release sem manifesto"', async () => {
    const controller = new RunnerReleasesController();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaDaRelease(ASSETS_COM_MANIFESTO))
      .mockResolvedValueOnce({ ok: false });
    vi.stubGlobal('fetch', fetchMock);
    const { res } = fakeResponse();

    expect(await motivoDe(controller.binary('linux-x64', res))).toBe(
      'manifesto_ilegivel',
    );
  });

  it('download do binário falha: motivo próprio, e nada é servido', async () => {
    const controller = new RunnerReleasesController();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaDaRelease(ASSETS_COM_MANIFESTO))
      .mockResolvedValueOnce(
        respostaDoManifesto(`${'a'.repeat(64)}  brabo-runner-linux-x64\n`),
      )
      .mockResolvedValueOnce({ ok: false });
    vi.stubGlobal('fetch', fetchMock);
    const { res, headers } = fakeResponse();

    expect(await motivoDe(controller.binary('linux-x64', res))).toBe(
      'download_falhou',
    );
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('plataforma fora da allowlist: 400, nunca chega a chamar o GitHub', async () => {
    const controller = new RunnerReleasesController();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { res } = fakeResponse();

    await expect(controller.binary('plan9-x64', res)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('platform ausente: 400', async () => {
    const controller = new RunnerReleasesController();
    vi.stubGlobal('fetch', vi.fn());
    const { res } = fakeResponse();

    await expect(controller.binary(undefined, res)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('asset ausente na release atual (só linux-x64 publicado): 502 nomeado', async () => {
    const controller = new RunnerReleasesController();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaDaRelease(ASSETS_COM_MANIFESTO));
    vi.stubGlobal('fetch', fetchMock);
    const { res } = fakeResponse();

    expect(await motivoDe(controller.binary('darwin-arm64', res))).toBe(
      'plataforma_nao_publicada',
    );
  });

  it('GitHub responde erro na consulta da release: 502', async () => {
    const controller = new RunnerReleasesController();
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false });
    vi.stubGlobal('fetch', fetchMock);
    const { res } = fakeResponse();

    await expect(controller.binary('linux-x64', res)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('cacheia a release E o manifesto: a segunda chamada só rebaixa o binário', async () => {
    const controller = new RunnerReleasesController();
    const bytes = new TextEncoder().encode('bytes');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaDaRelease(ASSETS_COM_MANIFESTO))
      .mockResolvedValueOnce(
        respostaDoManifesto(`${sha256(bytes)}  brabo-runner-linux-x64\n`),
      )
      .mockImplementation(() => Promise.resolve(respostaDoAsset(bytes)));
    vi.stubGlobal('fetch', fetchMock);

    await controller.binary('linux-x64', fakeResponse().res);
    await controller.binary('linux-x64', fakeResponse().res);

    const porUrl = (url: string) =>
      fetchMock.mock.calls.filter((c) => String(c[0]).includes(url));
    // UMA consulta de release e UM download de manifesto para DOIS downloads:
    // os dois vivem na mesma entrada de cache, e nunca em janelas diferentes —
    // senão o hash da release nova conferiria contra o binário da velha.
    expect(porUrl('releases/latest')).toHaveLength(1);
    expect(porUrl(URL_DO_MANIFESTO)).toHaveLength(1);
    expect(porUrl(URL_DO_BINARIO)).toHaveLength(2);
  });
});

/**
 * A única metade da verificação que não faz I/O — e a única, por isso, que se
 * prova inteira aqui dentro.
 */
describe('parsearChecksums', () => {
  it('lê o formato do sha256sum, nos dois modos (texto e binário)', () => {
    const manifesto = parsearChecksums(
      [
        `${'a'.repeat(64)}  brabo-runner-linux-x64`,
        `${'b'.repeat(64)} *brabo-runner-win32-x64.exe`,
        '',
      ].join('\n'),
    );
    expect(manifesto.get('brabo-runner-linux-x64')).toBe('a'.repeat(64));
    expect(manifesto.get('brabo-runner-win32-x64.exe')).toBe('b'.repeat(64));
    expect(manifesto.size).toBe(2);
  });

  it('ignora linha malformada em vez de derrubar a leitura', () => {
    const manifesto = parsearChecksums(
      [
        '# um cabeçalho qualquer',
        'lixo',
        `${'c'.repeat(64)}  brabo-runner-linux-arm64`,
      ].join('\n'),
    );
    expect([...manifesto.keys()]).toEqual(['brabo-runner-linux-arm64']);
  });

  it('nome repetido: a PRIMEIRA linha vence, e a segunda não redefine o hash', () => {
    const manifesto = parsearChecksums(
      [
        `${'d'.repeat(64)}  brabo-runner-linux-x64`,
        `${'e'.repeat(64)}  brabo-runner-linux-x64`,
      ].join('\n'),
    );
    expect(manifesto.get('brabo-runner-linux-x64')).toBe('d'.repeat(64));
  });
});
