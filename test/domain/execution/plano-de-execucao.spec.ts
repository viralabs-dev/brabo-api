import { describe, it, expect } from 'vitest';
import {
  idsDasTarefasDoPlano,
  lerPlanoDeExecucao,
} from '../../../src/domain/execution/plano-de-execucao';

// AT-274 (RN-678): o plano do Dev Lead atribui o módulo de cada tarefa, e o
// conjunto válido é o `module_map` vigente.
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const MAPA = ['board-engine', 'input-keyboard'];
const DO_PROJETO = new Set([T1, T2]);

function plano(
  tarefas: unknown,
  modulos: unknown = [{ modulo: 'board-engine', agentes: 1, porque: 'x' }],
) {
  return { resumo: 'r', modulos, tarefas };
}

describe('lerPlanoDeExecucao (RN-678)', () => {
  it('caminho feliz: cada tarefa com módulo do module_map vira atribuição', () => {
    const r = lerPlanoDeExecucao(
      plano([
        { taskId: T1, modulo: 'board-engine' },
        { taskId: T2, modulo: 'input-keyboard' },
      ]),
      MAPA,
      DO_PROJETO,
    );
    expect(r).toEqual({
      ok: true,
      modulos: ['board-engine'],
      tarefas: [
        { taskId: T1, modulo: 'board-engine' },
        { taskId: T2, modulo: 'input-keyboard' },
      ],
    });
  });

  it('tarefa SEM módulo é recusada, nomeando a tarefa e os módulos válidos', () => {
    const r = lerPlanoDeExecucao(plano([{ taskId: T1 }]), MAPA, DO_PROJETO);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain(`A tarefa ${T1} está sem módulo`);
    expect(r.motivo).toContain('board-engine, input-keyboard');
  });

  it('módulo FORA do module_map é recusado, nomeando o módulo', () => {
    const r = lerPlanoDeExecucao(
      plano([{ taskId: T1, modulo: 'audio' }]),
      MAPA,
      DO_PROJETO,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain('"audio"');
    expect(r.motivo).toContain('não está no module_map vigente');
  });

  it('módulo do PLANO fora do module_map também é recusado', () => {
    const r = lerPlanoDeExecucao(
      plano(
        [{ taskId: T1, modulo: 'board-engine' }],
        [{ modulo: 'audio', agentes: 1 }],
      ),
      MAPA,
      DO_PROJETO,
    );
    expect(r.ok).toBe(false);
  });

  it('plano sem `tarefas` é recusado', () => {
    expect(lerPlanoDeExecucao(plano(undefined), MAPA, DO_PROJETO).ok).toBe(
      false,
    );
    expect(lerPlanoDeExecucao(plano([]), MAPA, DO_PROJETO).ok).toBe(false);
  });

  it('tarefa repetida e tarefa de outro projeto são recusadas', () => {
    const repetida = lerPlanoDeExecucao(
      plano([
        { taskId: T1, modulo: 'board-engine' },
        { taskId: T1, modulo: 'input-keyboard' },
      ]),
      MAPA,
      DO_PROJETO,
    );
    expect(repetida.ok).toBe(false);
    const alheia = lerPlanoDeExecucao(
      plano([{ taskId: T1, modulo: 'board-engine' }]),
      MAPA,
      new Set([T2]),
    );
    expect(alheia.ok).toBe(false);
    if (alheia.ok) return;
    expect(alheia.motivo).toContain('não existe neste projeto');
  });

  it('sem module_map vigente nada passa', () => {
    const r = lerPlanoDeExecucao(
      plano([{ taskId: T1, modulo: 'board-engine' }]),
      [],
      DO_PROJETO,
    );
    expect(r.ok).toBe(false);
  });

  it('idsDasTarefasDoPlano só devolve uuids (o resto cai em "não existe")', () => {
    expect(
      idsDasTarefasDoPlano({
        tarefas: [{ taskId: T1 }, { taskId: 'não-é-uuid' }, {}],
      }),
    ).toEqual([T1]);
  });
});
