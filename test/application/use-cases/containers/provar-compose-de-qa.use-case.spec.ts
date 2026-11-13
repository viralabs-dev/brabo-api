import { describe, expect, it } from 'vitest';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
  type ContainerBrokerPort,
  type ResultadoDaProvaDeCompose,
} from '../../../../src/application/ports/container-broker.port';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import type { InstanciaDeQaUseCase } from '../../../../src/application/use-cases/containers/instancia-de-qa.use-case';
import { ProvarComposeDeQaUseCase } from '../../../../src/application/use-cases/containers/provar-compose-de-qa.use-case';

const T1 = 'a1b2c3d4-0000-4000-8000-000000000001';

function montar(
  broker: () => Promise<ResultadoDaProvaDeCompose>,
  modo = 'container',
) {
  const chamadas: string[] = [];
  const uc = new ProvarComposeDeQaUseCase(
    {
      findById: () => Promise.resolve({ executionMode: modo }),
    } as unknown as ProjectRepository,
    {
      resolverTarefa: () => Promise.resolve(T1),
    } as unknown as InstanciaDeQaUseCase,
    {
      provaDeCompose: (_p: string, chave: string) => {
        chamadas.push(chave);
        return broker();
      },
    } as unknown as ContainerBrokerPort,
  );
  return { uc, chamadas };
}

const AVISO = { veredito: 'aprova_com_aviso', aviso: 'sem prova de compose' };

describe('ProvarComposeDeQaUseCase (AT-922, RN-1328)', () => {
  it('caminho feliz: subiu e sondou', async () => {
    const resultado: ResultadoDaProvaDeCompose = {
      subiu: true,
      sondas: [{ caminho: '/docs', status: 200 }],
      origem: 'projeto',
    };
    const { uc, chamadas } = montar(() => Promise.resolve(resultado));
    expect(await uc.execute('p1', T1)).toEqual({
      veredito: 'provou',
      aviso: null,
      motivo: null,
      chave: 'a1b2c3d4',
      resultado,
    });
    expect(chamadas).toEqual(['a1b2c3d4']);
  });

  it('compose recusado pela allowlist é falha do PROJETO, sem aviso', async () => {
    const { uc } = montar(() =>
      Promise.resolve({
        subiu: false,
        sondas: [],
        recusas: [{ campo: 'privileged', motivo: 'proibido' }],
        origem: 'projeto',
      }),
    );
    const r = await uc.execute('p1', T1);
    expect(r).toMatchObject({ veredito: 'falhou', aviso: null });
    expect(r.resultado?.recusas?.[0].campo).toBe('privileged');
  });

  it('origem infra no resultado vira aviso', async () => {
    const { uc } = montar(() =>
      Promise.resolve({ subiu: false, sondas: [], origem: 'infra' }),
    );
    expect(await uc.execute('p1', T1)).toMatchObject(AVISO);
  });

  it('503 do broker (origem infra) vira aviso', async () => {
    const { uc } = montar(() =>
      Promise.reject(new BrokerRecusouError(503, 'daemon caiu', 'infra')),
    );
    expect(await uc.execute('p1', T1)).toMatchObject(AVISO);
  });

  it('broker ausente e teto excedido viram aviso', async () => {
    for (const motivo of ['nao-configurado', 'teto-excedido'] as const) {
      const { uc } = montar(() =>
        Promise.reject(new BrokerIndisponivelError(motivo, 'sem broker')),
      );
      expect(await uc.execute('p1', T1)).toMatchObject(AVISO);
    }
  });

  it('projeto runner vira aviso sem chamar o broker', async () => {
    const { uc, chamadas } = montar(
      () => Promise.reject(new Error('não devia chamar')),
      'runner',
    );
    expect(await uc.execute('p1', T1)).toMatchObject(AVISO);
    expect(chamadas).toEqual([]);
  });

  it('recusa que não é de infra segue como erro', async () => {
    const { uc } = montar(() =>
      Promise.reject(
        new BrokerRecusouError(404, 'projeto desconhecido', 'codigo'),
      ),
    );
    await expect(uc.execute('p1', T1)).rejects.toBeInstanceOf(
      BrokerRecusouError,
    );
  });
});
