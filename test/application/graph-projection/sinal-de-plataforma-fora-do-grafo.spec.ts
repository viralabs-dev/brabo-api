import { describe, it, expect } from 'vitest';
import { EVENTOS_DO_LOG_PROJETAVEIS } from '../../../src/application/graph-projection/graph-event-translator';

// RN-1076 (ADR 0291): o sinal de plataforma do Psicólogo é sinal interno do
// TP-01, não memória da pessoa — não entra no grafo do usuário.
describe('psychologist.platform_signal fora do grafo', () => {
  it('não é tipo projetável', () => {
    expect(EVENTOS_DO_LOG_PROJETAVEIS.has('psychologist.platform_signal')).toBe(
      false,
    );
  });

  it('a hipótese de produto continua projetável (controle)', () => {
    expect(
      EVENTOS_DO_LOG_PROJETAVEIS.has('psychologist.hypothesis_proposed'),
    ).toBe(true);
  });
});
