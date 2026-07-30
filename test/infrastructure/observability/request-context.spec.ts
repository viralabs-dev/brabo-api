import { describe, it, expect } from 'vitest';
import {
  currentRequestContext,
  formatPath,
  pushStep,
  runWithRequestContext,
  type TraceStep,
} from '../../../src/infrastructure/observability/request-context';

/**
 * O contexto de requisição que carrega o caminho entre camadas (ADR 0035).
 *
 * Duas propriedades aqui são as que evitam incidente, e nenhuma das duas é óbvia
 * olhando o código:
 *
 * 1. **O teto de passos.** Um caso de uso que chama repositório em laço (aprovar
 *    em lote, reprocessar event log) encheria o array pela vida da requisição e
 *    depois serializaria tudo numa linha de log. É o modo mais provável de esta
 *    feature virar problema em produção.
 * 2. **Isolamento entre requisições concorrentes.** É a propriedade que todo o
 *    `AsyncLocalStorage` existe para dar, e que o `drizzle-context.ts` ao lado —
 *    que carrega a TRANSAÇÃO ativa — depende sem ter teste próprio. Se vazasse
 *    aqui, vazaria lá.
 */
function passo(over: Partial<TraceStep> = {}): TraceStep {
  return {
    layer: 'application',
    class: 'CasoDeUso',
    fn: 'execute',
    ms: 1.5,
    depth: 0,
    ...over,
  };
}

describe('request-context', () => {
  describe('fora de uma requisição', () => {
    it('não há contexto', () => {
      expect(currentRequestContext()).toBeUndefined();
    });

    it('pushStep é no-op silencioso e devolve undefined', () => {
      // O DomainGaugesCollector roda em timer e chama infraestrutura decorada.
      // Levantar aqui derrubaria a coleta de métricas por causa de log.
      expect(() => pushStep(passo())).not.toThrow();
      expect(pushStep(passo())).toBeUndefined();
    });
  });

  describe('dentro de uma requisição', () => {
    it('começa vazio, com profundidade zero', () => {
      runWithRequestContext(() => {
        const ctx = currentRequestContext();
        expect(ctx?.path).toEqual([]);
        expect(ctx?.depth).toBe(0);
        expect(ctx?.truncated).toBe(false);
        expect(ctx?.startedAt).toBeGreaterThan(0);
      });
    });

    it('devolve o objeto guardado, para o chamador preencher a duração', () => {
      runWithRequestContext(() => {
        const guardado = pushStep(passo({ ms: 0 }));
        expect(guardado).toBeDefined();
        guardado!.ms = 42;
        expect(currentRequestContext()?.path[0].ms).toBe(42);
      });
    });
  });

  describe('o teto de passos', () => {
    it('para em 64 e marca truncated', () => {
      runWithRequestContext(() => {
        for (let i = 0; i < 100; i++) pushStep(passo({ fn: `m${i}` }));

        const ctx = currentRequestContext();
        expect(ctx?.path).toHaveLength(64);
        expect(ctx?.truncated).toBe(true);
      });
    });

    it('formatPath sinaliza o truncamento', () => {
      runWithRequestContext(() => {
        for (let i = 0; i < 100; i++) pushStep(passo({ fn: `m${i}` }));
        expect(formatPath(currentRequestContext()!)).toContain('truncado');
      });
    });

    it('depois do teto, pushStep devolve undefined em vez de levantar', () => {
      runWithRequestContext(() => {
        for (let i = 0; i < 64; i++) pushStep(passo());
        expect(pushStep(passo())).toBeUndefined();
      });
    });
  });

  describe('isolamento entre requisições concorrentes', () => {
    it('duas requisições não veem os passos uma da outra', async () => {
      const requisicao = async (nome: string, espera: number) =>
        runWithRequestContext(async () => {
          pushStep(passo({ fn: nome }));
          await new Promise((r) => setTimeout(r, espera));
          // Depois de um await: se o ALS não isolasse, aqui apareceriam os
          // passos da outra requisição.
          pushStep(passo({ fn: `${nome}-depois` }));
          return currentRequestContext()!.path.map((p) => p.fn);
        });

      const [a, b] = await Promise.all([
        requisicao('a', 20),
        requisicao('b', 5),
      ]);

      expect(a).toEqual(['a', 'a-depois']);
      expect(b).toEqual(['b', 'b-depois']);
    });
  });

  describe('formatPath', () => {
    it('rende o caminho em ordem de chamada, com as durações', () => {
      runWithRequestContext(() => {
        pushStep({
          layer: 'interfaces',
          class: 'SessionsController',
          fn: 'create',
          ms: 34.1,
          depth: 0,
        });
        pushStep({
          layer: 'application',
          class: 'CreateSessionUseCase',
          fn: 'execute',
          ms: 31.2,
          depth: 1,
        });

        expect(formatPath(currentRequestContext()!)).toBe(
          'interfaces/SessionsController.create 34.1ms → ' +
            'application/CreateSessionUseCase.execute 31.2ms',
        );
      });
    });

    it('marca o passo que falhou com a classe do erro', () => {
      runWithRequestContext(() => {
        pushStep(passo({ error: 'SessionTransitionError', ms: 2 }));
        expect(formatPath(currentRequestContext()!)).toBe(
          'application/CasoDeUso.execute!SessionTransitionError 2ms',
        );
      });
    });

    it('caminho vazio virá string vazia, sem levantar', () => {
      runWithRequestContext(() => {
        expect(formatPath(currentRequestContext()!)).toBe('');
      });
    });
  });
});
