import { describe, expect, it } from 'vitest';
import {
  BOOTSTRAP_STEPS,
  RETIRED_BOOTSTRAP_STEPS,
} from '../../../src/domain/git/repo-bootstrap.entity';
import { BOOTSTRAP_STEP_SEQUENCE } from '../../../src/application/use-cases/git/bootstrap-steps';

/**
 * Duas listas descrevem os passos do bootstrap, e elas NÃO são a mesma coisa:
 *
 * - `BOOTSTRAP_STEPS` é o vocabulário da coluna `repo_bootstraps.step` (e do
 *   enum do banco) — tudo que ela pode conter, inclusive o que já foi
 *   aposentado. Um projeto bootstrapado antes tem cursor apontando para lá.
 * - `BOOTSTRAP_STEP_SEQUENCE` é o que o bootstrap EXECUTA hoje.
 *
 * A diferença entre as duas precisa ser exatamente `RETIRED_BOOTSTRAP_STEPS` —
 * nem mais, nem menos. Sem esta amarração, aposentar um passo em silêncio
 * (ou acrescentar um à sequência sem vocabulário) passaria despercebido, e a
 * UI listaria como `pendente` um passo que nunca vai rodar.
 */
describe('vocabulário × sequência de execução do bootstrap', () => {
  const executados = BOOTSTRAP_STEP_SEQUENCE.map((s) => s.step);

  it('todo passo executado existe no vocabulário', () => {
    for (const passo of executados) {
      expect(BOOTSTRAP_STEPS as readonly string[]).toContain(passo);
    }
  });

  it('o que sobra do vocabulário é exatamente o aposentado', () => {
    const naoExecutados = BOOTSTRAP_STEPS.filter(
      (s) => !executados.includes(s),
    );

    expect(naoExecutados).toEqual([...RETIRED_BOOTSTRAP_STEPS]);
  });

  it('a ordem de execução segue a do vocabulário', () => {
    // `deriveProvisioningStatus` confia no ÚLTIMO item de BOOTSTRAP_STEPS
    // como "convergiu". Se as ordens divergissem, o cursor de um bootstrap
    // completo poderia não ser o último da lista.
    const posicoes = executados.map((p) =>
      (BOOTSTRAP_STEPS as readonly string[]).indexOf(p),
    );

    expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b));
    expect(executados.at(-1)).toBe(BOOTSTRAP_STEPS.at(-1));
  });
});
