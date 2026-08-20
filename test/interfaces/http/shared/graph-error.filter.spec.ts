import { describe, expect, it, vi } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { GraphErrorFilter } from '../../../../src/interfaces/http/shared/graph-error.filter';
import { GraphUnavailableError } from '../../../../src/domain/graph/graph-errors';

function fakeHost() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const response = { status };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

/**
 * Prova de degradação controlada (nunca 500 cru): `GraphUnavailableError` —
 * lançado por qualquer caso de uso do grafo quando o `GraphStore` não
 * consegue conectar — vira 503 com corpo explicando, nunca um stack trace.
 */
describe('GraphErrorFilter', () => {
  it('converte GraphUnavailableError em 503 com corpo explicando', () => {
    const filter = new GraphErrorFilter();
    const { host, status, json } = fakeHost();
    const erro = new GraphUnavailableError('Neo4j fora do ar.');

    filter.catch(erro, host);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      statusCode: 503,
      message: 'Neo4j fora do ar.',
      error: 'Service Unavailable',
    });
  });
});
