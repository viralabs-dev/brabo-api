import { describe, it, expect } from 'vitest';
import {
  motivoDeNaoRecriar,
  proximaPortaLivre,
  type ContextoDeRecriacao,
} from '../../../src/domain/containers/recriar-com-app';

const DECLARADO = new Date('2026-11-06T01:22:10Z');
const base = (p: Partial<ContextoDeRecriacao> = {}): ContextoDeRecriacao => ({
  executionMode: 'container',
  container: {
    status: 'running',
    statusChangedAt: new Date('2026-11-06T01:20:38Z'),
  },
  recreatePendente: false,
  declaradoEm: DECLARADO,
  ...p,
});

describe('motivoDeNaoRecriar (AT-758, RN-1029)', () => {
  it('propõe quando o container subiu antes das instruções vigentes', () => {
    expect(motivoDeNaoRecriar(base())).toBeNull();
  });

  it('não propõe em projeto runner', () => {
    expect(motivoDeNaoRecriar(base({ executionMode: 'runner' }))).toBe(
      'projeto_runner',
    );
  });

  it.each(['removed', 'failed', 'provisioning'] as const)(
    'não propõe com container %s',
    (status) => {
      expect(
        motivoDeNaoRecriar(
          base({ container: { status, statusChangedAt: new Date(0) } }),
        ),
      ).toBe('sem_container_de_pe');
    },
  );

  it('não propõe sem container', () => {
    expect(motivoDeNaoRecriar(base({ container: null }))).toBe(
      'sem_container_de_pe',
    );
  });

  it('não propõe com recreate pendente', () => {
    expect(motivoDeNaoRecriar(base({ recreatePendente: true }))).toBe(
      'recreate_pendente',
    );
  });

  it('não propõe se o container subiu depois das instruções', () => {
    const depois = new Date(DECLARADO.getTime() + 1);
    expect(
      motivoDeNaoRecriar(
        base({ container: { status: 'running', statusChangedAt: depois } }),
      ),
    ).toBe('container_ja_com_o_app');
  });

  it('o instante exato do vigente ainda propõe (só o posterior bloqueia)', () => {
    expect(
      motivoDeNaoRecriar(
        base({
          container: { status: 'running', statusChangedAt: DECLARADO },
        }),
      ),
    ).toBeNull();
  });
});

describe('proximaPortaLivre', () => {
  it('começa em 13000 mesmo que a app.port fosse permitida', () => {
    expect(proximaPortaLivre([])).toBe(13000);
    expect(proximaPortaLivre([8080, 3001])).toBe(13000);
  });

  it('pula as portas ocupadas por outros projetos', () => {
    expect(proximaPortaLivre([13000, 13001, 13003])).toBe(13002);
  });
});
