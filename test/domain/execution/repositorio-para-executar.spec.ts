import { describe, it, expect } from 'vitest';
import { motivoDeExecucaoSemRepositorio } from '../../../src/domain/execution/repositorio-para-executar';
import type { HandoffView } from '../../../src/domain/sessions/agent-activation';

/**
 * A frase da recusa de `execution/activate` sem repositório (RN-582).
 *
 * O que estes casos protegem é que a recusa ENSINA: o repositório nasce por um
 * gesto em outra tela, e a frase tem de dizer qual — nunca mandar aceitar um
 * handoff que não existe, nem calar quando não há gesto pendente.
 */
const P = 'proj-1';

function h(toAgent: string, status: HandoffView['status']): HandoffView {
  return { toAgent, status };
}

describe('motivoDeExecucaoSemRepositorio (RN-582)', () => {
  it('handoff ao Arquiteto oferecido: manda aceitá-lo, que é o gatilho', () => {
    const m = motivoDeExecucaoSemRepositorio(P, [h('arquiteto', 'offered')]);
    expect(m).toMatch(/Projeto sem repositório/);
    expect(m).toMatch(/Aceite o handoff ao Arquiteto/);
  });

  it('o Arquiteto vence o Dev Lead quando os dois estão oferecidos', () => {
    const m = motivoDeExecucaoSemRepositorio(P, [
      h('dev-lead', 'offered'),
      h('arquiteto', 'offered'),
    ]);
    expect(m).toMatch(/Aceite o handoff ao Arquiteto/);
    expect(m).not.toMatch(/Dev Lead/);
  });

  it('Arquiteto já aceito e Dev Lead oferecido: manda aceitar o Dev Lead (segunda porta)', () => {
    const m = motivoDeExecucaoSemRepositorio(P, [
      h('arquiteto', 'accepted'),
      h('dev-lead', 'offered'),
    ]);
    expect(m).toMatch(/Aceite o handoff ao Dev Lead/);
  });

  it('handoff que provisiona já aceito e nada pendente: aponta o evento de falha e a página', () => {
    const m = motivoDeExecucaoSemRepositorio(P, [h('arquiteto', 'accepted')]);
    expect(m).toMatch(/repository\.provision_failed/);
    expect(m).toContain('/projects/proj-1/provisioning?provider=local');
    expect(m).not.toMatch(/Aceite o handoff/);
  });

  it('handoff a OUTRO agente oferecido não vira instrução de aceite', () => {
    // Aceitar a Infra não provisiona nada — mandar aceitá-la seria mentir.
    const m = motivoDeExecucaoSemRepositorio(P, [h('infra', 'offered')]);
    expect(m).not.toMatch(/Aceite o handoff/);
    expect(m).toMatch(/Nenhum handoff ao Arquiteto foi aceito/);
  });

  it('sem handoff nenhum: diz onde o repositório nasce e onde provisionar à mão', () => {
    const m = motivoDeExecucaoSemRepositorio(P, []);
    expect(m).toMatch(/Nenhum handoff ao Arquiteto foi aceito/);
    expect(m).toContain('/projects/proj-1/provisioning?provider=local');
  });
});
