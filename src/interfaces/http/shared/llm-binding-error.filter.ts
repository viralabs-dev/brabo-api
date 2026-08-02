import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import {
  ModelNotBindableError,
  ModelNotFitForAgentScopeError,
} from '../../../domain/llm/model-capabilities';
import { LLMCredentialConnectionTestFailedError } from '../../../domain/llm/llm-credential-errors';

type ErroCapturado =
  | ModelNotFitForAgentScopeError
  | ModelNotBindableError
  | LLMCredentialConnectionTestFailedError;

/**
 * 422, e não 400: o pedido está bem formado e o modelo referenciado existe —
 * o que não se sustenta é a combinação modelo + escopo (Fase 9a, RN-040) ou o
 * estado do modelo (Fase 9c, RN-043). `LLMCredentialConnectionTestFailedError`
 * (Fase 11a) entrou aqui pelo mesmo motivo: o pedido está bem formado, a
 * chave é que nunca foi válida — mesmo vocabulário que o
 * `GitProviderErrorFilter` já usa para o teste de conexão de credencial de
 * git que falha.
 */
@Catch(
  ModelNotFitForAgentScopeError,
  ModelNotBindableError,
  LLMCredentialConnectionTestFailedError,
)
export class LlmBindingErrorFilter implements ExceptionFilter {
  catch(exception: ErroCapturado, host: ArgumentsHost) {
    host.switchToHttp().getResponse<Response>().status(422).json({
      statusCode: 422,
      message: exception.message,
      error: 'Unprocessable Entity',
    });
  }
}
