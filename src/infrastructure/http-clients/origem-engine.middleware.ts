import {
  Injectable,
  RequestMethod,
  type MiddlewareConsumer,
  type NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { runComoEngine } from '../persistence/drizzle/drizzle-context';

/**
 * Marca como "veio do engine" toda requisição de `/internal/*` (AT-157). É o
 * que impede a api de avisar o canal de uma escrita que o engine já avisa pela
 * fachada dele. Middleware e não guard: o contexto assíncrono só atravessa o
 * handler se `next()` rodar DENTRO do `run`.
 */
@Injectable()
export class OrigemEngineMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    if (req.path.startsWith('/internal/')) {
      runComoEngine(() => next());
      return;
    }
    next();
  }
}

/**
 * A ligação do middleware, num lugar só: o `AppModule` a usa e o teste a
 * exercita de verdade, com o roteamento do Nest (a forma do caminho é a de
 * `path-to-regexp` da versão instalada, e errar não dá erro de compilação).
 */
export function aplicarOrigemEngine(consumer: MiddlewareConsumer): void {
  consumer
    .apply(OrigemEngineMiddleware)
    .forRoutes({ path: '*path', method: RequestMethod.ALL });
}
