import { describe, expect, it, vi } from 'vitest';
import { ReconciliarRecursosUseCase } from '../../../../src/application/use-cases/containers/reconciliar-recursos.use-case';
import type {
  EstadoDeRecurso,
  RecursoDeProjeto,
} from '../../../../src/application/ports/recurso-de-projeto-repository.port';

const VIVO = '11111111-1111-4111-8111-111111111111';
const APAGADO = '22222222-2222-4222-8222-222222222222';
const ORFAO_DO_HOST = '33333333-3333-4333-8333-333333333333';

function linha(over: Partial<RecursoDeProjeto>): RecursoDeProjeto {
  return {
    id: 'r',
    projectId: APAGADO,
    tipo: 'container',
    chave: '',
    estado: 'removendo',
    containerId: null,
    motivo: null,
    tentativas: 0,
    atualizadoEm: new Date(),
    ...over,
  };
}

function montar(
  opts: {
    linhas?: RecursoDeProjeto[];
    host?: string[];
    brokerFora?: boolean;
    cicloVivo?: string;
    qaAtiva?: boolean;
  } = {},
) {
  const linhas = opts.linhas ?? [];
  const gravados: Array<[string, string, string, { estado: string }]> = [];
  const recursos = {
    listar: (e: EstadoDeRecurso[]) =>
      Promise.resolve(linhas.filter((l) => e.includes(l.estado))),
    gravar: vi.fn((...a: [string, string, string, { estado: string }]) => {
      gravados.push(a);
      linhas.push(
        linha({ projectId: a[0], estado: a[3].estado as EstadoDeRecurso }),
      );
      return Promise.resolve();
    }),
    concluirRemocaoDoProjeto: vi.fn(() => Promise.resolve()),
  };
  const broker = {
    configurado: () => true,
    recursosDoHost: () =>
      Promise.resolve({
        portas: [],
        containers: (opts.host ?? []).map((projectId) => ({
          projectId,
          papel: 'trabalho',
          estado: 'running',
          nome: 'n',
        })),
        redes: [],
      }),
    removerOrfao: vi.fn(() =>
      opts.brokerFora
        ? Promise.reject(new Error('broker fora'))
        : Promise.resolve(),
    ),
    remove: vi.fn(() => Promise.resolve()),
    removeQa: vi.fn(() => Promise.resolve()),
  };
  const registro = { removido: vi.fn(() => Promise.resolve()) };
  const uc = new ReconciliarRecursosUseCase(
    broker as never,
    recursos as never,
    {
      findById: (id: string) => Promise.resolve(id === VIVO ? { id } : null),
    } as never,
    {
      findByProject: () =>
        Promise.resolve(opts.cicloVivo ? { status: opts.cicloVivo } : null),
    } as never,
    {
      findAtivaDoProjeto: () =>
        Promise.resolve(opts.qaAtiva ? { id: 'q' } : null),
    } as never,
    registro as never,
  );
  return { uc, broker, recursos, registro, gravados };
}

describe('ReconciliarRecursosUseCase (AT-980, RN-1386)', () => {
  it('com o broker de volta, retoma a remoção do projeto apagado e marca removido', async () => {
    const { uc, broker, recursos } = montar({ linhas: [linha({})] });
    const r = await uc.execute();
    expect(broker.removerOrfao).toHaveBeenCalledWith(APAGADO);
    expect(recursos.concluirRemocaoDoProjeto).toHaveBeenCalledWith(
      APAGADO,
      null,
    );
    expect(r.retomados).toBe(1);
  });

  it('broker recusando: registra o motivo e tenta no tique seguinte', async () => {
    const { uc, recursos } = montar({ linhas: [linha({})], brokerFora: true });
    const r = await uc.execute();
    expect(recursos.concluirRemocaoDoProjeto).toHaveBeenCalledWith(
      APAGADO,
      'broker fora',
    );
    expect(r.retomados).toBe(0);
  });

  it('brabo.project.id do host sem projeto vira `removendo` e é removido', async () => {
    const { uc, broker, gravados } = montar({
      host: [ORFAO_DO_HOST, VIVO, 'nao-e-uuid'],
    });
    const r = await uc.execute();
    expect(gravados).toHaveLength(1);
    expect(gravados[0][0]).toBe(ORFAO_DO_HOST);
    expect(r.orfaosNovos).toBe(1);
    expect(broker.removerOrfao).toHaveBeenCalledWith(ORFAO_DO_HOST);
  });

  it('resto de subida `falhou` em projeto sem ciclo running é removido', async () => {
    const { uc, broker, registro } = montar({
      linhas: [
        linha({ projectId: VIVO, estado: 'falhou' }),
        linha({
          projectId: VIVO,
          estado: 'falhou',
          tipo: 'container_qa',
          chave: 'a1b2c3d4',
        }),
      ],
    });
    const r = await uc.execute();
    expect(broker.remove).toHaveBeenCalledWith(VIVO);
    expect(broker.removeQa).toHaveBeenCalledWith(VIVO, 'a1b2c3d4');
    expect(registro.removido).toHaveBeenCalledTimes(2);
    expect(r.restosRemovidos).toBe(2);
  });

  it('não toca o container de projeto com ciclo running nem a QA ativa', async () => {
    const { uc, broker } = montar({
      cicloVivo: 'running',
      qaAtiva: true,
      linhas: [
        linha({ projectId: VIVO, estado: 'falhou' }),
        linha({
          projectId: VIVO,
          estado: 'falhou',
          tipo: 'container_qa',
          chave: 'a1b2c3d4',
        }),
      ],
    });
    await uc.execute();
    expect(broker.remove).not.toHaveBeenCalled();
    expect(broker.removeQa).not.toHaveBeenCalled();
  });

  it('sem BROKER_URL não faz nada', async () => {
    const { uc, broker } = montar({ linhas: [linha({})] });
    (broker as { configurado: () => boolean }).configurado = () => false;
    expect(await uc.execute()).toEqual({
      retomados: 0,
      restosRemovidos: 0,
      orfaosNovos: 0,
    });
    expect(broker.removerOrfao).not.toHaveBeenCalled();
  });
});
