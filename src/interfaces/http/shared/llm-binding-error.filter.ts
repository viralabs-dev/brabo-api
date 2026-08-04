import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import {
  ModelNotBindableError,
  ModelNotFitForAgentScopeError,
} from '../../../domain/llm/model-capabilities';

type ErroCapturado = ModelNotFitForAgentScopeError | ModelNotBindableError;

/**
 * 422, e não 400: o pedido está bem formado e o modelo referenciado existe —
 * o que não se sustenta é a combinação modelo + escopo (Fase 9a, RN-040) ou o
 * estado do modelo (Fase 9c, RN-043).
 *
 * `LLMCredentialConnectionTestFailedError` esteve nesta lista da Fase 11a até
 * o ADR 0050, quando o cadastro parou de testar a chave: o erro continua
 * existindo, mas agora é capturado por `TestStoredCredentialUseCase` e vira
 * `{ resultado: 'recusado', motivo }` numa resposta 200. Nada o lança para o
 * HTTP, então mantê-lo aqui seria um `@Catch` que nunca dispara.
 */
@Catch(ModelNotFitForAgentScopeError, ModelNotBindableError)
export class LlmBindingErrorFilter implements ExceptionFilter {
  catch(exception: ErroCapturado, host: ArgumentsHost) {
    host.switchToHttp().getResponse<Response>().status(422).json({
      statusCode: 422,
      message: exception.message,
      error: 'Unprocessable Entity',
    });
  }
}
