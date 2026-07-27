import { describe, it, expect } from 'vitest';
import {
  contextFromTraceparent,
  currentSpanId,
  currentTraceId,
  currentTraceparent,
  injectTraceHeaders,
} from '../../../src/infrastructure/observability/trace-context';

/**
 * As ferramentas de contexto de trace (Fase 5, item 3).
 *
 * Sem SDK de OpenTelemetry ativo — que é o caso da suite, de propósito — a API
 * vira no-op. Então o que se testa aqui não é "o span foi criado", e sim a
 * propriedade que de fato importa: **instrumentar não pode quebrar nem alterar
 * o que já funcionava**. Um `injectTraceHeaders` que perdesse o `Authorization`
 * derrubaria toda chamada api -> engine; um `contextFromTraceparent` que
 * levantasse com `null` quebraria a ativação de qualquer sessão criada antes
 * desta fase.
 */
describe('trace-context', () => {
  describe('injectTraceHeaders', () => {
    it('preserva os headers existentes', () => {
      const headers = injectTraceHeaders({
        'Content-Type': 'application/json',
        Authorization: 'Bearer abc',
      });

      // É o que `buildHeaders` do cliente do engine devolve: perder um destes
      // dois transforma toda chamada interna em 401 ou 415.
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers.Authorization).toBe('Bearer abc');
    });

    it('devolve o MESMO objeto, para poder ser usado inline', () => {
      const original = { a: 'b' };
      expect(injectTraceHeaders(original)).toBe(original);
    });
  });

  describe('contextFromTraceparent', () => {
    it('aceita null sem levantar', () => {
      // Sessão criada antes da Fase 5: `sessions.trace_parent` é null, e o
      // caminho de ativação passa por aqui.
      expect(() => contextFromTraceparent(null)).not.toThrow();
    });

    it('aceita undefined e string vazia', () => {
      expect(() => contextFromTraceparent(undefined)).not.toThrow();
      expect(() => contextFromTraceparent('')).not.toThrow();
    });

    it('aceita um traceparent W3C válido', () => {
      expect(() =>
        contextFromTraceparent(
          '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        ),
      ).not.toThrow();
    });

    it('não levanta com traceparent malformado', () => {
      // Vem de header HTTP, ou seja: de fora. Um valor inválido tem que ser
      // ignorado, nunca virar 500 numa rota de domínio.
      expect(() => contextFromTraceparent('lixo')).not.toThrow();
    });
  });

  describe('sem span ativa', () => {
    it('currentTraceparent devolve undefined em vez de levantar', () => {
      expect(currentTraceparent()).toBeUndefined();
    });

    it('currentTraceId e currentSpanId devolvem undefined', () => {
      // É o que o `mixin` do logger consulta a cada linha. Levantar aqui
      // derrubaria o logger, não só a trace.
      expect(currentTraceId()).toBeUndefined();
      expect(currentSpanId()).toBeUndefined();
    });
  });
});
