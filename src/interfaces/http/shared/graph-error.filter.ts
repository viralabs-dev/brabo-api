import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { GraphUnavailableError } from '../../../domain/graph/graph-errors';

/**
 * Converte `GraphUnavailableError` em 503 controlado — nunca um 500 cru com
 * stack trace do driver Neo4j (regra de degradação da fundação do grafo).
 *
 * Mesmo padrão de `git-provider-error.filter.ts`/`llm-binding-error.filter.ts`,
 * registrado globalmente em `main.ts`. Só as rotas de TEMPLATE
 * (`internal-graph.controller.ts`) não têm fallback possível quando o grafo
 * está fora do ar — por isso 503 é aceitável ali. `internal-rag.controller.ts`
 * não depende do grafo (reusa `HybridSearchUseCase`, que já degrada sozinho
 * pra léxico-only quando o embedding falha), então nunca lança este erro.
 */
@Catch(GraphUnavailableError)
export class GraphErrorFilter implements ExceptionFilter {
  catch(exception: GraphUnavailableError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(503).json({
      statusCode: 503,
      message: exception.message,
      error: 'Service Unavailable',
    });
  }
}
