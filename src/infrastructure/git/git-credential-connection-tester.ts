import { Injectable } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { Gitlab } from '@gitbeaker/rest';
import type { GitCredentialProviderName } from '@brabo/shared';
import { GitCredentialConnectionTester } from '../../application/ports/git-credential-connection-tester.port';
import { GitCredentialConnectionTestFailedError } from '../../domain/git/git-errors';

@Injectable()
export class GitCredentialConnectionTesterImpl implements GitCredentialConnectionTester {
  async test(
    provider: GitCredentialProviderName,
    token: string,
  ): Promise<void> {
    try {
      if (provider === 'github') {
        await new Octokit({ auth: token }).rest.users.getAuthenticated();
      } else {
        // Token de usuário (PAT) — sempre `token:`, nunca `oauthToken:`.
        // O GitLab valida os dois de formas diferentes (header
        // PRIVATE-TOKEN vs. Authorization: Bearer); não são
        // intercambiáveis. `oauthToken` continua reservado pro fluxo de
        // OAuth de projeto (project_git_connections), intocado aqui.
        await new Gitlab({ token }).Users.showCurrentUser();
      }
    } catch (error) {
      throw new GitCredentialConnectionTestFailedError(
        provider,
        extractMessage(error),
      );
    }
  }
}

function extractMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  return undefined;
}
