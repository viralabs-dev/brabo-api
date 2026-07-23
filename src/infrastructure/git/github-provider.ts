import { Injectable } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import type { GitProviderName } from '@brabo/shared';
import {
  GitProvider,
  type CreateRepositoryInput,
  type CreateRepositoryResult,
} from '../../application/ports/git-provider.port';
import { GitProviderAuthError } from '../../domain/git/git-provider-errors';

@Injectable()
export class GithubProvider implements GitProvider {
  readonly name: GitProviderName = 'github';

  async createRepository(
    input: CreateRepositoryInput,
  ): Promise<CreateRepositoryResult> {
    const octokit = new Octokit({ auth: input.accessToken });

    try {
      const { data } = input.namespace
        ? await octokit.rest.repos.createInOrg({
            org: input.namespace,
            name: input.name,
            private: input.visibility === 'private',
            auto_init: false,
          })
        : await octokit.rest.repos.createForAuthenticatedUser({
            name: input.name,
            private: input.visibility === 'private',
            auto_init: false,
          });

      return {
        externalId: data.full_name,
        url: data.clone_url ?? data.html_url,
        defaultBranch: data.default_branch ?? 'main',
      };
    } catch (error) {
      if (isAuthError(error)) {
        throw new GitProviderAuthError(
          'github',
          'Token do GitHub inválido ou revogado',
        );
      }
      throw error;
    }
  }
}

function isAuthError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error.status === 401 || error.status === 403)
  );
}
