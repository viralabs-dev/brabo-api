import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpContainerBrokerClient } from '../../src/infrastructure/http-clients/container-broker.client';

describe('HttpContainerBrokerClient.reiniciarApp (RN-1026)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BROKER_URL;
  });

  it('POST na rota do broker, corpo vazio `{}` (o comando não viaja)', async () => {
    process.env.BROKER_URL = 'http://broker:8090/';
    const fetchFake = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ reiniciou: true }))),
    );
    vi.stubGlobal('fetch', fetchFake);

    const r = await new HttpContainerBrokerClient().reiniciarApp('proj-1');

    expect(r).toEqual({ reiniciou: true });
    const [url, init] = fetchFake.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('http://broker:8090/containers/proj-1/app/restart');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
  });
});
