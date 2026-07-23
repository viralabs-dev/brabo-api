import { Injectable } from '@nestjs/common';
import { Gitlab } from '@gitbeaker/rest';
import type { GitProviderName } from '@brabo/shared';
import {
  GitProvider,
  type CreateRepositoryInput,
  type CreateRepositoryResult,
} from '../../application/ports/git-provider.port';
import { GitProviderAuthError } from '../../domain/git/git-provider-errors';

@Injectable()
export class GitlabProvider implements GitProvider {
  readonly name: GitProviderName = 'gitlab';

  async createRepository(
    input: CreateRepositoryInput,
  ): Promise<CreateRepositoryResult> {
    if (!input.accessToken) {
      throw new GitProviderAuthError('gitlab', 'Token de acesso ausente');
    }
    const api = new Gitlab({ oauthToken: input.accessToken });

    try {
      // A API de criação de projeto do GitLab pede namespace_id numérico,
      // não o path direto — resolve o namespace antes de criar.
      let namespaceId: number | undefined;
      if (input.namespace) {
        const namespace = await api.Namespaces.show(input.namespace);
        namespaceId = namespace.id;
      }

      const project = await api.Projects.create({
        name: input.name,
        namespaceId,
        visibility: input.visibility,
        initializeWithReadme: false,
      });

      return {
        externalId: project.path_with_namespace,
        url: project.http_url_to_repo,
        defaultBranch: project.default_branch ?? 'main',
      };
    } catch (error) {
      if (isAuthError(error)) {
        throw new GitProviderAuthError(
          'gitlab',
          'Token do GitLab inválido ou revogado',
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
    'cause' in error &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'response' in error.cause &&
    typeof error.cause.response === 'object' &&
    error.cause.response !== null &&
    'status' in error.cause.response &&
    (error.cause.response.status === 401 || error.cause.response.status === 403)
  );
}
