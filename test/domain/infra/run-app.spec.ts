import { describe, expect, it } from 'vitest';
import {
  normalizarRun,
  recusaDoRun,
} from '../../../src/domain/infra/run-instructions';

const base = {
  command: 'docker compose up',
  envExample: true,
  urls: [{ label: 'Web', url: 'http://localhost:3000', kind: 'web' }],
};

describe('run.app (AT-610, RN-933)', () => {
  it('sem app ou com app null: válido e sem a chave na saída', () => {
    expect(recusaDoRun(base)).toBeNull();
    expect(recusaDoRun({ ...base, app: null })).toBeNull();
    expect('app' in normalizarRun({ ...base, app: null })).toBe(false);
  });

  it('app válido passa e é normalizado', () => {
    const run = { ...base, app: { command: 'npm start', port: 3000, x: 1 } };
    expect(recusaDoRun(run)).toBeNull();
    expect(normalizarRun(run).app).toEqual({
      command: 'npm start',
      port: 3000,
    });
  });

  it.each([
    [{ command: '', port: 3000 }, 'run.app.command'],
    [{ command: 'a\nb', port: 3000 }, 'uma linha'],
    [{ command: 'a\0b', port: 3000 }, 'uma linha'],
    [{ command: 'x'.repeat(301), port: 3000 }, '300'],
    [{ command: 'npm start', port: 80 }, 'run.app.port'],
    [{ command: 'npm start', port: 70000 }, 'run.app.port'],
    [{ command: 'npm start', port: '3000' }, 'run.app.port'],
  ])('recusa %j nomeando o campo', (app, trecho) => {
    expect(recusaDoRun({ ...base, app })).toContain(trecho);
  });

  it('conta code points: 300 emojis passam, 301 não', () => {
    expect(
      recusaDoRun({ ...base, app: { command: '😀'.repeat(300), port: 3000 } }),
    ).toBeNull();
    expect(
      recusaDoRun({ ...base, app: { command: '😀'.repeat(301), port: 3000 } }),
    ).not.toBeNull();
  });
});
