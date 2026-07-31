import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ModelNotFitForAgentScopeError } from '../../../domain/llm/model-capabilities';

/**
 * 422, e não 400: o pedido está bem formado e o modelo referenciado existe —
 * o que não se sustenta é a combinação modelo + escopo (Fase 9a, RN-038).
 * Mesmo vocabulário que o `GitProviderErrorFilter` já usa para o teste de
 * conexão de credencial que falha.
 */
@Catch(ModelNotFitForAgentScopeError)
export class LlmBindingErrorFilter implements ExceptionFilter {
  catch(exception: ModelNotFitForAgentScopeError, host: ArgumentsHost) {
    host.switchToHttp().getResponse<Response>().status(422).json({
      statusCode: 422,
      message: exception.message,
      error: 'Unprocessable Entity',
    });
  }
}
