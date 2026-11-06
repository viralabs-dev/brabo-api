import { describe, it, expect } from 'vitest';
import { ExecuteContainerRecreateUseCase } from '../../../../src/application/use-cases/actions/execute-container-recreate.use-case';
import { BrokerRecusouError } from '../../../../src/application/ports/container-broker.port';

interface Gravado {
  status: string;
  executionResult: { motivo: string | null };
}

function build(opts: {
  ciclo?: { status: string } | null;
  mode?: string;
  startFalha?: boolean;
  rede?: object | null;
}) {
  const declaracoes: unknown[][] = [];
  const chamadas: string[] = [];
  const gravados: Gravado[] = [];
  const broker = {
    remove: () => {
      chamadas.push('remove');
      return Promise.resolve();
    },
    start: () => {
      chamadas.push('start');
      if (opts.startFalha) {
        return Promise.reject(
          new (BrokerRecusouError as unknown as new (...a: unknown[]) => Error)(
            'imagem não decidida',
            409,
            'infra',
          ),
        );
      }
      return Promise.resolve({
        containerId: 'c2',
        nome: 'n',
        jaEstavaDePe: false,
      });
    },
  };
  const uc = new ExecuteContainerRecreateUseCase(
    { runInTransaction: (fn: () => unknown) => Promise.resolve(fn()) } as never,
    {
      updateExecutionResult: (_id: string, i: Gravado) => {
        gravados.push(i);
        return Promise.resolve(i);
      },
    } as never,
    { execute: () => Promise.resolve(undefined) } as never,
    { append: () => Promise.resolve(undefined) } as never,
    {
      execute: () =>
        Promise.resolve(
          opts.ciclo === undefined ? { status: 'running' } : opts.ciclo,
        ),
    } as never,
    {
      execute: (_p: string, to: string) => {
        chamadas.push(`->${to}`);
        return Promise.resolve({ status: to });
      },
    } as never,
    {
      execute: () => {
        chamadas.push('->running');
        return Promise.resolve();
      },
    } as never,
    broker as never,
    {
      findById: () =>
        Promise.resolve({ id: 'p', executionMode: opts.mode ?? 'container' }),
    } as never,
    { execute: () => Promise.resolve(opts.rede ?? null) } as never,
    {
      execute: (...a: unknown[]) => {
        chamadas.push('rede');
        declaracoes.push(a);
        return Promise.resolve();
      },
    } as never,
  );
  return { uc, chamadas, gravados, declaracoes };
}

const ACAO = { id: 'a1' } as never;

describe('ExecuteContainerRecreateUseCase (AT-608, RN-934)', () => {
  it('remove + start passando por stopped, removed e running', async () => {
    const { uc, chamadas, gravados } = build({});
    await uc.execute('p', 's', ACAO);
    expect(chamadas).toEqual([
      'remove',
      '->stopped',
      '->removed',
      'start',
      '->running',
    ]);
    expect(gravados[0].status).toBe('executed');
  });

  it('subida recusada vira failed nomeado depois de remover', async () => {
    const { uc, gravados } = build({ startFalha: true });
    await uc.execute('p', 's', ACAO);
    expect(gravados[0].status).toBe('failed');
    expect(gravados[0].executionResult.motivo).toMatch(
      /foi removido, mas a subida falhou/,
    );
  });

  it('runner é recusado nomeando "runner depois", sem tocar o broker', async () => {
    const { uc, chamadas, gravados } = build({ mode: 'runner' });
    await uc.execute('p', 's', ACAO);
    expect(chamadas).toEqual([]);
    expect(gravados[0].executionResult.motivo).toMatch(/runner depois/);
  });

  describe('proposta app_declared (AT-758, RN-1029)', () => {
    const PORTAS = [{ host: 13000, container: 3000, protocol: 'tcp' }];
    const DA_PROPOSTA = {
      id: 'a1',
      decidedBy: 'u-clicou',
      payload: { reason: 'app_declared', pullRequestId: 'pr-2', ports: PORTAS },
    } as never;

    it('sem rede vigente, grava a rede com o ator do clique ANTES do remove', async () => {
      const { uc, chamadas, declaracoes } = build({});
      await uc.execute('p', 's', DA_PROPOSTA);
      expect(chamadas.slice(0, 2)).toEqual(['rede', 'remove']);
      expect(declaracoes).toEqual([['p', 'u-clicou', { ports: PORTAS }]]);
    });

    it('com rede vigente, não sobrescreve', async () => {
      const { uc, chamadas } = build({ rede: { version: 1, ports: [] } });
      await uc.execute('p', 's', DA_PROPOSTA);
      expect(chamadas).not.toContain('rede');
    });

    it('recreate sem ports no payload não declara rede', async () => {
      const { uc, chamadas } = build({});
      await uc.execute('p', 's', {
        id: 'a1',
        decidedBy: 'u',
        payload: {},
      } as never);
      expect(chamadas).not.toContain('rede');
    });
  });
});
