import { describe, expect, it } from 'vitest';
import {
  normalizarRun,
  recusaDoRun,
} from '../../../src/domain/infra/run-instructions';
import {
  chaveDeQa,
  formaDaReferenciaDeTarefa,
} from '../../../src/domain/containers/instancia-de-qa';

const DIGEST = `postgres:16@sha256:${'a'.repeat(64)}`;
const base = {
  command: 'docker compose up',
  envExample: true,
  urls: [{ label: 'Web', url: 'http://localhost:3000', kind: 'web' }],
};
const servico = { name: 'db', image: DIGEST };

describe('run.qa (AT-612, RN-935)', () => {
  it('sem qa ou null: válido e sem a chave na saída', () => {
    expect(recusaDoRun(base)).toBeNull();
    expect(recusaDoRun({ ...base, qa: null })).toBeNull();
    expect('qa' in normalizarRun({ ...base, qa: null })).toBe(false);
  });

  it('serviço válido passa e é normalizado', () => {
    const qa = {
      services: [
        {
          ...servico,
          env: { POSTGRES_DB: 'app' },
          tmpfs: ['/var/lib/x'],
          shared: true,
        },
      ],
    };
    expect(recusaDoRun({ ...base, qa })).toBeNull();
    expect(normalizarRun({ ...base, qa }).qa).toEqual(qa);
  });

  it.each([
    ['imagem sem digest', { services: [{ name: 'db', image: 'postgres:16' }] }],
    ['nome inválido', { services: [{ ...servico, name: 'DB' }] }],
    ['nome repetido', { services: [servico, servico] }],
    [
      'mais de 6',
      {
        services: Array.from({ length: 7 }, (_, i) => ({
          ...servico,
          name: `s${i}`,
        })),
      },
    ],
    [
      'env com quebra de linha',
      { services: [{ ...servico, env: { A: 'x\ny' } }] },
    ],
    ['env com nome minúsculo', { services: [{ ...servico, env: { a: 'x' } }] }],
    ['tmpfs relativo', { services: [{ ...servico, tmpfs: ['x'] }] }],
    [
      'tmpfs demais',
      { services: [{ ...servico, tmpfs: ['/a', '/b', '/c', '/d'] }] },
    ],
  ])('recusa %s', (_n, qa) => {
    expect(recusaDoRun({ ...base, qa })).not.toBeNull();
  });
});

describe('chave da instância de QA', () => {
  it('8 primeiros [a-z0-9] do taskId sem hífen', () => {
    expect(chaveDeQa('A1B2C3D4-0000-4000-8000-000000000000')).toBe('a1b2c3d4');
  });

  it('aceita id completo e chave de 8, recusa o resto', () => {
    expect(
      formaDaReferenciaDeTarefa('a1b2c3d4-0000-4000-8000-000000000000'),
    ).toBe('id');
    expect(formaDaReferenciaDeTarefa('a1b2c3d4')).toBe('chave');
    expect(formaDaReferenciaDeTarefa('x')).toBe('invalida');
  });
});
