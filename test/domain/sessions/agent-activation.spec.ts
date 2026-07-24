import { describe, it, expect } from 'vitest';
import {
  canActivateAgent,
  assertCanActivate,
  AgentActivationBlockedError,
  isUserStartedAgent,
  type HandoffView,
} from '../../../src/domain/sessions/agent-activation';

describe('agent-activation', () => {
  it('Criativo sempre pode ativar (comando do usuário), mesmo sem handoff', () => {
    expect(canActivateAgent('criativo', [])).toBe(true);
    expect(isUserStartedAgent('criativo')).toBe(true);
    expect(() => assertCanActivate('criativo', [])).not.toThrow();
  });

  it('agente comum sem handoff aceito é rejeitado', () => {
    expect(canActivateAgent('po', [])).toBe(false);
    expect(() => assertCanActivate('po', [])).toThrow(
      AgentActivationBlockedError,
    );
  });

  it('agente comum com handoff apenas OFFERED (não aceito) é rejeitado', () => {
    const handoffs: HandoffView[] = [{ toAgent: 'po', status: 'offered' }];
    expect(canActivateAgent('po', handoffs)).toBe(false);
    expect(() => assertCanActivate('po', handoffs)).toThrow(
      AgentActivationBlockedError,
    );
  });

  it('agente comum com handoff ACCEPTED endereçado a ele é permitido', () => {
    const handoffs: HandoffView[] = [{ toAgent: 'po', status: 'accepted' }];
    expect(canActivateAgent('po', handoffs)).toBe(true);
    expect(() => assertCanActivate('po', handoffs)).not.toThrow();
  });

  it('handoff aceito endereçado a OUTRO agente não libera este', () => {
    const handoffs: HandoffView[] = [
      { toAgent: 'arquiteto', status: 'accepted' },
    ];
    expect(canActivateAgent('po', handoffs)).toBe(false);
  });

  it('o erro carrega o slug do agente bloqueado', () => {
    try {
      assertCanActivate('po', []);
      expect.unreachable('deveria ter lançado');
    } catch (e) {
      expect(e).toBeInstanceOf(AgentActivationBlockedError);
      expect((e as AgentActivationBlockedError).agent).toBe('po');
    }
  });
});
