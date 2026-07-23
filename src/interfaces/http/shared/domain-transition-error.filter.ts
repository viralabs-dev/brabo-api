import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { InvalidSessionTransitionError } from '../../../domain/sessions/session-state-machine';
import { InvalidActionTransitionError } from '../../../domain/actions/action-state-machine';

/**
 * Erros de transição de máquina de estados são erros de domínio (Error
 * puro, sem framework), não HttpException — sem este filtro eles vazam
 * como 500 genérico. Mapeados pra 409 Conflict: o estado atual do recurso
 * é incompatível com a transição pedida, não um erro interno.
 */
@Catch(InvalidSessionTransitionError, InvalidActionTransitionError)
export class DomainTransitionErrorFilter implements ExceptionFilter {
  catch(
    exception: InvalidSessionTransitionError | InvalidActionTransitionError,
    host: ArgumentsHost,
  ) {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(409).json({
      statusCode: 409,
      message: exception.message,
      error: 'Conflict',
    });
  }
}
