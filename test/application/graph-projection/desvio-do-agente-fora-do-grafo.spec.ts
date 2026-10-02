import { describe, it, expect } from 'vitest';
import { EVENTOS_DO_LOG_PROJETAVEIS } from '../../../src/application/graph-projection/graph-event-translator';

// RN-717 (ADR 0205): o desvio do agente é sinal do PRODUTO, não memória da
// pessoa — não entra no grafo do usuário.
describe('anamnese.agent_deviation fora do grafo', () => {
  it('não é tipo projetável', () => {
    expect(EVENTOS_DO_LOG_PROJETAVEIS.has('anamnese.agent_deviation')).toBe(
      false,
    );
  });

  it('o perfil continua projetável (controle)', () => {
    expect(EVENTOS_DO_LOG_PROJETAVEIS.has('anamnese.profile_updated')).toBe(
      true,
    );
  });
});
