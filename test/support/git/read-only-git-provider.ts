import type {
  GitBranch,
  GitProviderCapabilities,
  GitProviderContract,
} from '@brabo/shared';
import {
  branchingPolicyContent,
  prTemplateContent,
  BRANCHING_POLICY_PATH,
  PR_TEMPLATE_PATH,
} from '../../../src/application/use-cases/git/bootstrap-templates';

export interface RepoEstadoFalso {
  branches: { name: string; protected?: boolean }[];
  /** Caminhos cujo conteúdo já é EXATAMENTE o do template. */
  arquivosCanonicos?: string[];
  capabilities?: Partial<GitProviderCapabilities>;
}

/**
 * Provider de leitura pura para o dry-run (Fase 12a): responde
 * `listBranches`/`getFileContent` a partir de um estado declarado, e
 * **lança em qualquer método que mutaria o repositório**.
 *
 * É essa explosão que dá valor ao teste do plano: se `planBootstrap`
 * algum dia chamar `run()` em vez de só `check()`, o teste quebra
 * apontando o método exato, em vez de passar silenciosamente tendo
 * mexido num repositório de verdade.
 */
export class ReadOnlyGitProvider implements GitProviderContract {
  readonly name = 'github' as const;
  readonly capabilities: GitProviderCapabilities;
  readonly leituras: string[] = [];

  constructor(private readonly estado: RepoEstadoFalso) {
    this.capabilities = {
      protectBranch: true,
      pullRequests: true,
      ...estado.capabilities,
    };
  }

  private proibido(metodo: string): never {
    throw new Error(
      `MUTAÇÃO PROIBIDA: o dry-run chamou ${metodo}. O plano diagnostica, nunca age.`,
    );
  }

  listBranches(): Promise<GitBranch[]> {
    this.leituras.push('listBranches');
    return Promise.resolve(
      this.estado.branches.map((b) => ({
        name: b.name,
        commitSha: `sha-${b.name}`,
        protected: b.protected ?? false,
      })),
    );
  }

  getFileContent(input: { path: string }): Promise<string | null> {
    this.leituras.push(`getFileContent:${input.path}`);
    if (!this.estado.arquivosCanonicos?.includes(input.path)) {
      return Promise.resolve(null);
    }
    // Devolve o conteúdo canônico para o passo considerar-se satisfeito.
    if (input.path === PR_TEMPLATE_PATH) {
      return Promise.resolve(prTemplateContent());
    }
    if (input.path === BRANCHING_POLICY_PATH) {
      return Promise.resolve(branchingPolicyContent());
    }
    return Promise.resolve(null);
  }

  getRepo(): never {
    // Leitura, mas fora do escopo do plano — quem chama getRepo é a
    // adoção, não o dry-run.
    return this.proibido('getRepo');
  }
  createRepo(): never {
    return this.proibido('createRepo');
  }
  createBranch(): never {
    return this.proibido('createBranch');
  }
  protectBranch(): never {
    return this.proibido('protectBranch');
  }
  commitFiles(): never {
    return this.proibido('commitFiles');
  }
  openPullRequest(): never {
    return this.proibido('openPullRequest');
  }
  mergePullRequest(): never {
    return this.proibido('mergePullRequest');
  }
  commentOnPullRequest(): never {
    return this.proibido('commentOnPullRequest');
  }
}
