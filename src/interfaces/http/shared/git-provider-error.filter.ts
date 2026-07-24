import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import {
  GitProviderAuthError,
  InvalidOauthStateError,
} from '../../../domain/git/git-provider-errors';
import { GitCredentialConnectionTestFailedError } from '../../../domain/git/git-errors';

@Catch(
  GitProviderAuthError,
  InvalidOauthStateError,
  GitCredentialConnectionTestFailedError,
)
export class GitProviderErrorFilter implements ExceptionFilter {
  catch(
    exception:
      | GitProviderAuthError
      | InvalidOauthStateError
      | GitCredentialConnectionTestFailedError,
    host: ArgumentsHost,
  ) {
    const response = host.switchToHttp().getResponse<Response>();
    // GitProviderAuthError: token revogado/expirado — mesmo vocabulário 409
    // já usado no DomainTransitionErrorFilter pra "estado atual conflita
    // com o pedido". InvalidOauthStateError: state malformado/expirado no
    // callback — não é sobre credenciais, é 400.
    // GitCredentialConnectionTestFailedError: o token nunca foi válido
    // (não é um estado que "conflita" com nada existente) — 422.
    const status =
      exception instanceof GitProviderAuthError
        ? 409
        : exception instanceof GitCredentialConnectionTestFailedError
          ? 422
          : 400;
    const errorLabel =
      status === 409
        ? 'Conflict'
        : status === 422
          ? 'Unprocessable Entity'
          : 'Bad Request';
    response.status(status).json({
      statusCode: status,
      message: exception.message,
      error: errorLabel,
    });
  }
}
