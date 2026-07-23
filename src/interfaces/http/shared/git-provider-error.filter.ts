import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import {
  GitProviderAuthError,
  InvalidOauthStateError,
} from '../../../domain/git/git-provider-errors';

@Catch(GitProviderAuthError, InvalidOauthStateError)
export class GitProviderErrorFilter implements ExceptionFilter {
  catch(
    exception: GitProviderAuthError | InvalidOauthStateError,
    host: ArgumentsHost,
  ) {
    const response = host.switchToHttp().getResponse<Response>();
    // GitProviderAuthError: token revogado/expirado — mesmo vocabulário 409
    // já usado no DomainTransitionErrorFilter pra "estado atual conflita
    // com o pedido". InvalidOauthStateError: state malformado/expirado no
    // callback — não é sobre credenciais, é 400.
    const status = exception instanceof GitProviderAuthError ? 409 : 400;
    response.status(status).json({
      statusCode: status,
      message: exception.message,
      error: status === 409 ? 'Conflict' : 'Bad Request',
    });
  }
}
