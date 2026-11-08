import { describe, it, expect } from 'vitest';
import { recusaDeSupersedes } from '../../../src/domain/actions/adr-supersedes';
import type { ProposedAction } from '../../../src/domain/actions/proposed-action.entity';

const adr = (slug: string, status: ProposedAction['status']) =>
  ({ actionType: 'open_adr_pr', status, payload: { slug } }) as ProposedAction;

describe('recusaDeSupersedes (RN-1069)', () => {
  const adrs = [adr('sqlite', 'executed'), adr('rascunho', 'pending')];

  it('sem supersedes não há o que validar', () => {
    expect(recusaDeSupersedes(undefined, 'nova', adrs)).toBeNull();
  });
  it('ADR aceita do projeto vale, com slug ou caminho', () => {
    expect(recusaDeSupersedes('sqlite', 'nova', adrs)).toBeNull();
    expect(recusaDeSupersedes('docs/adr/sqlite.md', 'nova', adrs)).toBeNull();
  });
  it('inexistente, pendente, a si mesma e vazio são recusados', () => {
    expect(recusaDeSupersedes('nada', 'nova', adrs)).toMatch(/não existe/);
    expect(recusaDeSupersedes('rascunho', 'nova', adrs)).toMatch(/pending/);
    expect(recusaDeSupersedes('nova', 'nova', adrs)).toMatch(/a si mesma/);
    expect(recusaDeSupersedes('  ', 'nova', adrs)).toMatch(/slug/);
  });
});
