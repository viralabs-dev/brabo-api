import { describe, expect, it } from 'vitest';
import { textoDaProficienciaDoAutor } from '../../../src/domain/anamnese/proficiencia-do-autor';

// RN-696 (AT-356): o texto que leva o nível por competência ao agente.
describe('textoDaProficienciaDoAutor', () => {
  it('lista competência: nível', () => {
    const texto = textoDaProficienciaDoAutor([
      { competency: 'arquitetura', level: 'avancado' },
      { competency: 'testes', level: 'iniciante' },
    ]);
    expect(texto).toContain('- arquitetura: avancado');
    expect(texto).toContain('- testes: iniciante');
  });

  it('sem perfil, ou só com nível fora da escala, devolve null', () => {
    expect(textoDaProficienciaDoAutor([])).toBeNull();
    expect(
      textoDaProficienciaDoAutor([{ competency: 'x', level: 'genial' }]),
    ).toBeNull();
  });
});
