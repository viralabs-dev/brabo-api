import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { GitProviderName } from '@brabo/shared';
import {
  GitProvider,
  type CreateRepositoryInput,
  type CreateRepositoryResult,
} from '../../application/ports/git-provider.port';

const execFileAsync = promisify(execFile);

/**
 * Repo bare vazio — sem lib de git nova, só `git init --bare` via
 * child_process. É suficiente como conceito de "repositório provisionado":
 * clonável, push funcional, equivalente a um repo vazio via API do
 * GitHub/GitLab com auto_init desabilitado. Deliberadamente sem commit
 * inicial/README, pra "provisionado" ter o mesmo significado nos 3
 * providers.
 */
@Injectable()
export class LocalGitProvider implements GitProvider {
  readonly name: GitProviderName = 'local';

  async createRepository(
    input: CreateRepositoryInput,
  ): Promise<CreateRepositoryResult> {
    const root = process.env.GIT_LOCAL_REPOS_ROOT ?? '/tmp/brabo-git-repos';
    const dirName = `${sanitizeSlug(input.name)}.git`;
    const absolutePath = join(root, dirName);

    await execFileAsync('git', ['init', '--bare', absolutePath]);

    return {
      externalId: absolutePath,
      url: `file://${absolutePath}`,
      defaultBranch: 'main',
    };
  }
}

function sanitizeSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
