import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { PassThrough } from 'node:stream';
import type { Response } from 'express';
import { RunnerReleasesController } from '../../src/interfaces/http/runner/runner-releases.controller';

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

/**
 * `RunnerReleasesController` proxeia o binário standalone do runner
 * publicado em GitHub Releases — cobrindo caminho feliz (stream dos bytes
 * certos), plataforma fora da allowlist (400, sem nem chamar o GitHub) e
 * asset ausente na release atual (502).
 */
describe('RunnerReleasesController', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('caminho feliz: resolve o asset da plataforma e streama os bytes de volta', async () => {
    const controller = new RunnerReleasesController();
    const bytes = new TextEncoder().encode('binario-fake');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        respostaDaRelease([
          {
            name: 'brabo-runner-linux-x64',
            browser_download_url: 'https://example.com/asset',
          },
        ]),
      )
      .mockResolvedValueOnce(respostaDoAsset(bytes));
    vi.stubGlobal('fetch', fetchMock);

    const { res, headers, stream } = fakeResponse();
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    const fimDoStream = new Promise<void>((resolve) =>
      stream.on('end', resolve),
    );

    await controller.binary('linux-x64', res);
    await fimDoStream;

    expect(headers['Content-Type']).toBe('application/octet-stream');
    expect(headers['Content-Disposition']).toBe(
      'attachment; filename="brabo-runner"',
    );
    expect(Buffer.concat(chunks).toString()).toBe('binario-fake');
    expect(fetchMock.mock.calls[0][0]).toContain('releases/latest');
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/asset');
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

  it('asset ausente na release atual (só linux-x64 publicado): 502', async () => {
    const controller = new RunnerReleasesController();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      respostaDaRelease([
        {
          name: 'brabo-runner-linux-x64',
          browser_download_url: 'https://example.com/asset',
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { res } = fakeResponse();

    await expect(controller.binary('darwin-arm64', res)).rejects.toBeInstanceOf(
      BadGatewayException,
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

  it('cacheia a resolução da release: segunda chamada não repete a consulta ao GitHub', async () => {
    const controller = new RunnerReleasesController();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        respostaDaRelease([
          {
            name: 'brabo-runner-linux-x64',
            browser_download_url: 'https://example.com/asset',
          },
        ]),
      )
      .mockImplementation(() =>
        Promise.resolve(respostaDoAsset(new TextEncoder().encode('bytes'))),
      );
    vi.stubGlobal('fetch', fetchMock);

    const primeira = fakeResponse();
    await controller.binary('linux-x64', primeira.res);
    const segunda = fakeResponse();
    await controller.binary('linux-x64', segunda.res);

    // Duas chamadas de asset (uma por download) + UMA só de releases/latest.
    const chamadasReleases = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('releases/latest'),
    );
    expect(chamadasReleases).toHaveLength(1);
  });
});
