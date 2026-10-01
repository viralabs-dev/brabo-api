import { describe, expect, it } from 'vitest';
import { membrosEfetivos } from '../../../src/domain/iam/membros-efetivos';

const dono = {
  userId: 'u-dono',
  role: 'owner' as const,
  name: 'Dona',
  email: 'dona@x',
};

describe('membrosEfetivos (RN-680, pela régua da RN-471)', () => {
  it('caminho feliz: o dono do workspace SEM linha de projeto é membro do projeto', () => {
    // O caso do uso real de 29/09: criar projeto não grava `project_members`,
    // e a Anamnese, lendo só ela, não achava ninguém.
    expect(membrosEfetivos([], [dono])).toEqual([dono]);
  });

  it('a linha de PROJETO sobrepõe a de workspace, nos dois sentidos, sem repetir a pessoa', () => {
    const restrita = { ...dono, role: 'viewer' as const };
    const outro = {
      userId: 'u-2',
      role: 'developer' as const,
      name: null,
      email: 'b@x',
    };
    expect(membrosEfetivos([restrita], [dono, outro])).toEqual([
      restrita,
      outro,
    ]);
  });

  it('falha: ninguém nas duas listas é lista vazia, não erro', () => {
    expect(membrosEfetivos([], [])).toEqual([]);
  });
});
