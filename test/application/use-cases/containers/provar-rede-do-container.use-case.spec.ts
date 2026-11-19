import { describe, it, expect, vi } from 'vitest';
import {
  ProvarRedeDoContainerUseCase,
  registryDaStack,
} from '../../../../src/application/use-cases/containers/provar-rede-do-container.use-case';

function build(opts: {
  network?: 'none' | 'egress';
  exit?: number;
  ciclo?: { status: string } | null;
  stack?: string;
}) {
  const remove = vi.fn(() => Promise.resolve());
  const exec = vi.fn(() =>
    Promise.resolve({ exitCode: opts.exit ?? 0, output: '', timedOut: false }),
  );
  const transicao = vi.fn(() => Promise.resolve());
  const uc = new ProvarRedeDoContainerUseCase(
    { exec, remove } as never,
    {
      execute: () =>
        Promise.resolve({
          status: 'decidido',
          decisao: { network: opts.network ?? 'egress' },
        }),
    } as never,
    {
      findCurrent: () =>
        Promise.resolve({
          modules: [{ name: 'api', stack: opts.stack ?? 'Node.js' }],
        }),
    } as never,
    { execute: () => Promise.resolve(opts.ciclo ?? null) } as never,
    { execute: transicao } as never,
  );
  return { uc, exec, remove, transicao };
}

describe('ProvarRedeDoContainerUseCase (RN-1366)', () => {
  it('saída 0 segue; o comando prova o registry do ecossistema', async () => {
    const { uc, exec } = build({});
    expect(await uc.execute('p')).toEqual({ ok: true, nota: null });
    expect((exec.mock.calls[0] as unknown[])[1]).toContain(
      'registry.npmjs.org',
    );
  });

  it('saída diferente de 0 remove o container, marca failed e nomeia o DNS', async () => {
    const { uc, remove, transicao } = build({
      exit: 2,
      ciclo: { status: 'stopped' },
    });
    const r = await uc.execute('p');
    expect(r).toMatchObject({ ok: false });
    expect((r as { motivo: string }).motivo).toMatch(
      /sem rede: DNS de registry\.npmjs\.org falhou/,
    );
    expect(remove).toHaveBeenCalledWith('p');
    expect(transicao).toHaveBeenCalledWith('p', 'failed', expect.anything());
  });

  it('ciclo `running` que reprova fica de pé e o ciclo vai a failed (RN-1384)', async () => {
    const { uc, remove, transicao } = build({
      exit: 2,
      ciclo: { status: 'running' },
    });
    expect(await uc.execute('p')).toMatchObject({ ok: false });
    expect(remove).not.toHaveBeenCalled();
    expect(transicao).toHaveBeenCalledWith('p', 'failed', expect.anything());
  });

  it('saída 127 é "rede não provada" e segue', async () => {
    const { uc, remove } = build({ exit: 127 });
    const r = await uc.execute('p');
    expect(r.ok).toBe(true);
    expect((r as { nota: string }).nota).toMatch(/rede não provada/);
    expect(remove).not.toHaveBeenCalled();
  });

  it('postura none não prova nada', async () => {
    const { uc, exec } = build({ network: 'none', exit: 2 });
    expect(await uc.execute('p')).toEqual({ ok: true, nota: null });
    expect(exec).not.toHaveBeenCalled();
  });

  it('registry por termo, github.com sem ecossistema', () => {
    expect(registryDaStack('python')).toBe('pypi.org');
    expect(registryDaStack(null)).toBe('github.com');
  });
});
