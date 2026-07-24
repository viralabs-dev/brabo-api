import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import {
  GitProviderAuthError,
  InvalidOauthStateError,
} from '../../../domain/git/git-provider-errors';
import {
  GitBranchAlreadyExistsError,
  GitBranchNotFoundError,
  GitCredentialConnectionTestFailedError,
  GitNotSupportedError,
  GitPermissionDeniedError,
  GitRepoAlreadyExistsError,
  GitRepoNotFoundError,
} from '../../../domain/git/git-errors';

type CaughtError =
  | GitProviderAuthError
  | InvalidOauthStateError
  | GitCredentialConnectionTestFailedError
  | GitRepoNotFoundError
  | GitBranchNotFoundError
  | GitRepoAlreadyExistsError
  | GitBranchAlreadyExistsError
  | GitPermissionDeniedError
  | GitNotSupportedError;

// O bootstrap de Gitflow (Fase 2, sessão 3 — ProvisionRepositoryUseCase)
// agora expõe as mutações do GitProviderContract de verdade via HTTP, então
// os erros de domain/git/git-errors.ts (antes só circulando dentro do
// processo, em chamadas diretas ao provider/testes) passam por aqui
// também — comentário antigo dizendo "nenhum endpoint expõe essas
// operações ainda" ficou desatualizado.
@Catch(
  GitProviderAuthError,
  InvalidOauthStateError,
  GitCredentialConnectionTestFailedError,
  GitRepoNotFoundError,
  GitBranchNotFoundError,
  GitRepoAlreadyExistsError,
  GitBranchAlreadyExistsError,
  GitPermissionDeniedError,
  GitNotSupportedError,
)
export class GitProviderErrorFilter implements ExceptionFilter {
  catch(exception: CaughtError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, error } = statusFor(exception);
    response.status(status).json({
      statusCode: status,
      message: exception.message,
      error,
    });
  }
}

function statusFor(exception: CaughtError): { status: number; error: string } {
  // GitProviderAuthError: token revogado/expirado — mesmo vocabulário 409
  // já usado no DomainTransitionErrorFilter pra "estado atual conflita
  // com o pedido". InvalidOauthStateError: state malformado/expirado no
  // callback — não é sobre credenciais, é 400.
  // GitCredentialConnectionTestFailedError: o token nunca foi válido
  // (não é um estado que "conflita" com nada existente) — 422.
  // GitRepoNotFoundError/GitBranchNotFoundError: 404 de verdade — o
  // recurso referenciado não existe no provider.
  // GitRepoAlreadyExistsError/GitBranchAlreadyExistsError: 409 — conflita
  // com o que já existe (mesmo vocabulário do GitProviderAuthError).
  // GitPermissionDeniedError: 403 — credencial válida mas sem escopo.
  // GitNotSupportedError: 501 — operação corretamente implementada, só
  // não suportada por ESSE provider (distinto de um erro do cliente).
  if (exception instanceof GitProviderAuthError) {
    return { status: 409, error: 'Conflict' };
  }
  if (exception instanceof GitCredentialConnectionTestFailedError) {
    return { status: 422, error: 'Unprocessable Entity' };
  }
  if (
    exception instanceof GitRepoNotFoundError ||
    exception instanceof GitBranchNotFoundError
  ) {
    return { status: 404, error: 'Not Found' };
  }
  if (
    exception instanceof GitRepoAlreadyExistsError ||
    exception instanceof GitBranchAlreadyExistsError
  ) {
    return { status: 409, error: 'Conflict' };
  }
  if (exception instanceof GitPermissionDeniedError) {
    return { status: 403, error: 'Forbidden' };
  }
  if (exception instanceof GitNotSupportedError) {
    return { status: 501, error: 'Not Implemented' };
  }
  return { status: 400, error: 'Bad Request' };
}
