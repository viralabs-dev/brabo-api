import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import {
  ModelNotBindableError,
  ModelNotFitForAgentScopeError,
} from '../../../domain/llm/model-capabilities';
import { ScopeIdSemProjetoError } from '../../../domain/llm/binding-scope-id';

type ErroCapturado =
  | ModelNotFitForAgentScopeError
  | ModelNotBindableError
  | ScopeIdSemProjetoError;

/**
 * 422, e não 400: o pedido está bem formado e o modelo referenciado existe —
 * o que não se sustenta é a combinação modelo + escopo (Fase 9a, RN-040) ou o
 * estado do modelo (Fase 9c, RN-043).
 *
 * `ScopeIdSemProjetoError` é a exceção e sai como 400, porque ali o pedido NÃO
 * está bem formado: `scope_id` de `agent`/`area` sem o projeto (ADR 0064) é
 * identificador malformado, e devolver 422 diria "entendi o que você quis e
 * recusei" sobre algo que não dá para entender. Pelas rotas ele é inalcançável
 * — o controller monta a chave —, e o valor de mapeá-lo é o chamador interno
 * (script, `/internal/*`) receber a razão em vez de um 500.
 *
 * `LLMCredentialConnectionTestFailedError` esteve nesta lista da Fase 11a até
 * o ADR 0050, quando o cadastro parou de testar a chave: o erro continua
 * existindo, mas agora é capturado por `TestStoredCredentialUseCase` e vira
 * `{ resultado: 'recusado', motivo }` numa resposta 200. Nada o lança para o
 * HTTP, então mantê-lo aqui seria um `@Catch` que nunca dispara.
 */
@Catch(
  ModelNotFitForAgentScopeError,
  ModelNotBindableError,
  ScopeIdSemProjetoError,
)
export class LlmBindingErrorFilter implements ExceptionFilter {
  catch(exception: ErroCapturado, host: ArgumentsHost) {
    const status = exception instanceof ScopeIdSemProjetoError ? 400 : 422;
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({
        statusCode: status,
        message: exception.message,
        error: status === 400 ? 'Bad Request' : 'Unprocessable Entity',
      });
  }
}
