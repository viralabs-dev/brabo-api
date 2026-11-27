import { describe, it, expect } from 'vitest';
import {
  completarServicosDeDados,
  dadosConhecidosDaImagem,
  recusaDeServicoSemUsuario,
} from '../../../src/domain/infra/servicos-de-dados';

const D = `@sha256:${'a'.repeat(64)}`;

describe('servicos-de-dados (RN-1537)', () => {
  it('tabela: só o medido', () => {
    expect(dadosConhecidosDaImagem(`postgres:16${D}`)).toEqual({
      user: '999:999',
      tmpfs: ['/var/lib/postgresql/data'],
    });
    expect(dadosConhecidosDaImagem('postgres:16.4-bookworm')?.user).toBe(
      '999:999',
    );
    expect(dadosConhecidosDaImagem(`postgres:16-alpine${D}`)?.user).toBe(
      '70:70',
    );
    expect(
      dadosConhecidosDaImagem('docker.io/library/postgres:15'),
    ).toBeTruthy();
    for (const fora of [
      'postgres:18',
      'postgres',
      'postgres:latest',
      'mysql:8',
      'mariadb:11',
      'mongo:7',
      'redis:7',
      'meu/postgres:16',
    ]) {
      expect(dadosConhecidosDaImagem(fora)).toBeNull();
    }
  });

  it('completa só o que falta e não mexe no que a Infra declarou', () => {
    const run = {
      qa: {
        services: [
          { name: 'db', image: `postgres:16${D}` },
          { name: 'db2', image: `postgres:16${D}`, user: '5:5', tmpfs: ['/x'] },
          { name: 'cache', image: `redis:7${D}` },
        ],
      },
    };
    const r = completarServicosDeDados(run);
    expect(r.qa.services[0]).toMatchObject({
      user: '999:999',
      tmpfs: ['/var/lib/postgresql/data'],
    });
    expect(r.qa.services[1]).toBe(run.qa.services[1]);
    expect(r.qa.services[2]).toBe(run.qa.services[2]);
  });

  it('sem serviço, ou `run` malformado, devolve o mesmo objeto', () => {
    const a = { command: 'x' };
    expect(completarServicosDeDados(a)).toBe(a);
    expect(completarServicosDeDados(null)).toBeNull();
    const b = { qa: { services: 'x' } };
    expect(completarServicosDeDados(b)).toBe(b);
  });

  it('imagem fora da tabela e sem `user` é recusa; com `user` passa', () => {
    const sem = { qa: { services: [{ name: 'c', image: `redis:7${D}` }] } };
    expect(recusaDeServicoSemUsuario(sem)).toMatch(/"c".*redis:7/);
    const com = {
      qa: { services: [{ name: 'c', image: `redis:7${D}`, user: '999:999' }] },
    };
    expect(recusaDeServicoSemUsuario(com)).toBeNull();
    expect(recusaDeServicoSemUsuario({})).toBeNull();
  });
});
