import { describe, it, expect } from 'vitest';
import { GetRunInstructionsUseCase } from '../../../../src/application/use-cases/execution/get-run-instructions.use-case';
import { recusaDoRun } from '../../../../src/domain/infra/run-instructions';

const run = {
  command: 'docker compose up --build',
  urls: [{ label: 'App', url: 'http://127.0.0.1:8080/', kind: 'web' }],
  envExample: false,
};

function evento(id: string, seq: number, payload: unknown) {
  return { id, seq, payload, createdAt: new Date('2026-10-11T12:00:00Z') };
}

function build(porProjeto: Record<string, unknown[]>) {
  return new GetRunInstructionsUseCase({
    listByTypeForProject: (projectId: string) =>
      Promise.resolve(porProjeto[projectId] ?? []),
  } as never);
}

describe('GetRunInstructionsUseCase (RN-852)', () => {
  it('devolve o vigente — o de maior version', async () => {
    const uc = build({
      p1: [
        evento('e2', 5, { ...run, prUrl: 'pr/2', version: 2 }),
        evento('e1', 9, { ...run, prUrl: 'pr/1', version: 1 }),
      ],
    });
    expect(await uc.execute('p1')).toMatchObject({
      prUrl: 'pr/2',
      version: 2,
      eventId: 'e2',
      declaredAt: '2026-10-11T12:00:00.000Z',
    });
  });

  it('null sem artefato, e o de outro projeto não vaza', async () => {
    const uc = build({ p1: [evento('e1', 1, { ...run, version: 1 })] });
    expect(await uc.execute('p2')).toBeNull();
  });

  it('proximaVersao soma um ao maior', async () => {
    const uc = build({ p1: [evento('e1', 1, { ...run, version: 7 })] });
    expect(await uc.proximaVersao('p1')).toBe(8);
    expect(await uc.proximaVersao('p2')).toBe(1);
  });
});

describe('recusaDoRun (RN-852)', () => {
  it.each([
    [undefined, /obrigatório/],
    [{ ...run, command: '' }, /command/],
    [{ ...run, command: 'x'.repeat(301) }, /300/],
    [{ ...run, urls: [] }, /1 a 5/],
    [{ ...run, envExample: 'sim' }, /envExample/],
    [{ ...run, urls: [{ ...run.urls[0], kind: 'ssh' }] }, /kind/],
    [
      { ...run, urls: [{ ...run.urls[0], url: 'https://localhost:1/' }] },
      /url/,
    ],
    [
      {
        ...run,
        urls: [
          {
            label: 'API',
            url: 'http://localhost:8080/links',
            kind: 'api_docs',
          },
        ],
      },
      /\/docs/,
    ],
  ])('recusa %j', (r, motivo) => {
    expect(recusaDoRun(r)).toMatch(motivo);
  });

  it('aceita o formato do contrato', () => {
    expect(recusaDoRun(run)).toBeNull();
    expect(
      recusaDoRun({
        ...run,
        urls: [
          {
            label: 'Swagger',
            url: 'http://localhost:8080/docs',
            kind: 'api_docs',
          },
        ],
      }),
    ).toBeNull();
  });
});
