import { describe, expect, it } from 'vitest';
import { PortaDoAppUseCase } from '../../../../src/application/use-cases/containers/porta-do-app.use-case';
import { BrokerIndisponivelError } from '../../../../src/application/ports/container-broker.port';

const P = 'p1';
function montar(
  portas: Array<{ host: number; projectId: string | null }> | null,
) {
  return new PortaDoAppUseCase(
    {
      configurado: () => true,
      recursosDoHost: () =>
        portas === null
          ? Promise.reject(new BrokerIndisponivelError('sem-resposta', 'fora'))
          : Promise.resolve({
              portas: portas.map((p) => ({
                ...p,
                ip: '0.0.0.0',
                protocolo: 'tcp',
              })),
              containers: [],
              redes: [],
            }),
    } as never,
    {
      listByType: () =>
        Promise.resolve([{ payload: { ports: [{ host: 13001 }] } }]),
      listByTypeForProject: () => Promise.resolve([]),
    } as never,
  );
}

describe('PortaDoAppUseCase (RN-1383)', () => {
  it('pula terceiro no host e a declarada por outro projeto; a do próprio container é livre', async () => {
    const r = await montar([
      { host: 13000, projectId: null },
      { host: 13002, projectId: P },
    ]).escolher(P);
    expect(r).toEqual({ porta: 13002, naoConferida: false });
  });

  it('broker fora: só as declaradas, e diz que não conferiu', async () => {
    expect(await montar(null).escolher(P)).toEqual({
      porta: 13000,
      naoConferida: true,
    });
  });

  it('quemSegura separa terceiro, outro projeto, próprio e livre', async () => {
    const uc = montar([
      { host: 13000, projectId: null },
      { host: 13001, projectId: 'outro' },
      { host: 13002, projectId: P },
    ]);
    expect(await uc.quemSegura(P, 13000)).toBe('fora do Brabo');
    expect(await uc.quemSegura(P, 13001)).toBe('outro projeto');
    expect(await uc.quemSegura(P, 13002)).toBeNull();
    expect(await uc.quemSegura(P, 13003)).toBeNull();
  });
});
