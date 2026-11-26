import { describe, it, expect, vi } from 'vitest';
import {
  DigestNaoResolvidoError,
  fixarDigestDasImagens,
} from '../../../src/infrastructure/registry/fixar-digest-de-imagens';

const D = `sha256:${'c'.repeat(64)}`;
const run = (image: string) => ({ qa: { services: [{ name: 'db', image }] } });

describe('fixarDigestDasImagens (RN-1507)', () => {
  it('Docker Hub: token anônimo e HEAD no manifesto', async () => {
    const busca = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 401,
          headers: {
            'www-authenticate':
              'Bearer realm="https://auth.docker.io/token",service="registry.docker.io"',
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({ token: 't' }))
      .mockResolvedValueOnce(
        new Response(null, { headers: { 'docker-content-digest': D } }),
      );
    const r = (await fixarDigestDasImagens(
      run('postgres:16'),
      busca as never,
    )) as ReturnType<typeof run>;
    expect(r.qa.services[0].image).toBe(`postgres:16@${D}`);
    expect(busca.mock.calls[0][0]).toBe(
      'https://registry-1.docker.io/v2/library/postgres/manifests/16',
    );
  });

  it('imagem que já tem digest não consulta o registro', async () => {
    const busca = vi.fn();
    const entrada = run(`postgres:16@${D}`);
    expect(await fixarDigestDasImagens(entrada, busca as never)).toEqual(
      entrada,
    );
    expect(busca).not.toHaveBeenCalled();
  });

  it('404 e rede fora viram recusa nomeada', async () => {
    const f404 = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    await expect(
      fixarDigestDasImagens(run('postgres:16'), f404 as never),
    ).rejects.toBeInstanceOf(DigestNaoResolvidoError);
    const fora = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    await expect(
      fixarDigestDasImagens(run('postgres:16'), fora as never),
    ).rejects.toThrow(/problema passageiro de rede/);
  });

  it('sem tag ou latest: pede versão fixa', async () => {
    await expect(
      fixarDigestDasImagens(run('postgres'), vi.fn() as never),
    ).rejects.toThrow(/versão fixa/);
  });
});
