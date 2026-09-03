import { describe, expect, it, beforeEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type {
  BlameInput,
  GetFileContentInput,
  GitBlame,
  GitBranchDetailList,
  GitProviderCapabilities,
  GitProviderContract,
  GitProviderName,
  GitPullRequestDiff,
  GitPullRequestList,
  GitTree,
  ListTreeInput,
} from '@brabo/shared';
import { ReadProjectCodeUseCase } from '../../../../src/application/use-cases/git/read-project-code.use-case';
import { GitReadCache } from '../../../../src/domain/git/git-read-cache';
import {
  GIT_SEARCH_DIR_LIMIT,
  GIT_SEARCH_FILE_LIMIT,
  GIT_SEARCH_MATCH_LIMIT,
} from '../../../../src/domain/git/git-read-limits';
import { GitNotSupportedError } from '../../../../src/domain/git/git-errors';
import type { GitProviderRegistry } from '../../../../src/application/ports/git-provider.port';
import type { ProvisionedRepositoryRepository } from '../../../../src/application/ports/provisioned-repository-repository.port';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import type { UserCredentialRepository } from '../../../../src/application/ports/user-credential-repository.port';
import type { TaskRepository } from '../../../../src/application/ports/backlog-repository.port';
import type { ModuleMapRepository } from '../../../../src/application/ports/module-map-repository.port';
import type { Task } from '../../../../src/domain/backlog/backlog.entity';
import type { ModuleMap } from '../../../../src/domain/architecture/module-map.entity';
import type { EncryptionService } from '../../../../src/application/ports/encryption.port';
import type { ResolveCredentialOwnerUseCase } from '../../../../src/application/use-cases/llm/resolve-credential-owner.use-case';
import type { ObterContainerDoProjetoUseCase } from '../../../../src/application/use-cases/containers/obter-container-do-projeto.use-case';
import {
  RECURSOS_PADRAO,
  SEM_DECISAO,
  type EstadoDoContainer,
} from '../../../../src/domain/containers/project-container';

/**
 * A superfície de leitura da aba Code (FASE 26b).
 *
 * O provider é falso e CONTA as chamadas, porque é isso que a fase pede provar:
 * o item 34 não fala de corretude da árvore (a suite de contrato da 26a já
 * prova isso nos três providers reais) — fala de QUANTO a superfície gasta.
 * Um teste que só conferisse o resultado passaria com uma busca que varre o
 * repositório inteiro.
 */

const PROJETO = '3f2b1c8e-0a5d-4f6b-9c1e-2d7a8b3c4d5e';

/** Repositório falso: caminho → conteúdo. Diretórios são derivados. */
type Arquivos = Record<string, string>;

const BRANCHES_PADRAO: GitBranchDetailList['items'] = [
  {
    name: 'dev',
    commitSha: 'sha-dev',
    protected: true,
    ahead: 0,
    behind: 0,
    pullRequest: null,
  },
  {
    name: 'feature',
    commitSha: 'sha-feature',
    protected: false,
    ahead: 2,
    behind: 1,
    pullRequest: { number: 1, state: 'open' },
  },
];

class ProviderFalso implements GitProviderContract {
  readonly name: GitProviderName = 'github';
  readonly capabilities: GitProviderCapabilities;
  /** O custo, medido: uma entrada por chamada ao provider. */
  readonly chamadas: string[] = [];

  constructor(
    private readonly arquivos: Arquivos,
    capabilities?: Partial<GitProviderCapabilities>,
    private readonly branchesFalsas: GitBranchDetailList['items'] = BRANCHES_PADRAO,
  ) {
    this.capabilities = {
      protectBranch: true,
      pullRequests: true,
      listTree: true,
      pullRequestDiff: true,
      blame: true,
      pullRequestsList: true,
      branchesDetailed: true,
      ...capabilities,
    };
  }

  listTree(input: ListTreeInput): Promise<GitTree | null> {
    if (!this.capabilities.listTree) {
      return Promise.reject(new GitNotSupportedError(this.name, 'listTree'));
    }
    this.chamadas.push(`listTree:${input.path ?? ''}`);

    const prefixo = input.path ? `${input.path}/` : '';
    const nomes = new Set<string>();
    for (const caminho of Object.keys(this.arquivos)) {
      if (!caminho.startsWith(prefixo)) continue;
      nomes.add(caminho.slice(prefixo.length).split('/')[0]);
    }
    if (nomes.size === 0) return Promise.resolve(null);

    return Promise.resolve({
      ref: input.ref,
      path: input.path ?? '',
      entries: [...nomes].sort().map((nome) => {
        const caminho = `${prefixo}${nome}`;
        const arquivo = this.arquivos[caminho];
        return {
          path: caminho,
          name: nome,
          type: arquivo === undefined ? ('dir' as const) : ('file' as const),
          size: arquivo === undefined ? null : Buffer.byteLength(arquivo),
        };
      }),
      truncated: false,
    });
  }

  getFileContent(input: GetFileContentInput): Promise<string | null> {
    this.chamadas.push(`getFileContent:${input.path}`);
    return Promise.resolve(this.arquivos[input.path] ?? null);
  }

  getPullRequestDiff(): Promise<GitPullRequestDiff | null> {
    if (!this.capabilities.pullRequestDiff) {
      return Promise.reject(
        new GitNotSupportedError(this.name, 'getPullRequestDiff'),
      );
    }
    this.chamadas.push('getPullRequestDiff');
    return Promise.resolve({
      pullRequestId: 'pr-1',
      files: [
        {
          path: 'src/a.ts',
          previousPath: null,
          status: 'modified' as const,
          additions: 2,
          deletions: 1,
          patch: '@@ -1 +1,2 @@\n+novo\n',
        },
      ],
      truncated: false,
    });
  }

  blame(input: BlameInput): Promise<GitBlame | null> {
    if (!this.capabilities.blame) {
      return Promise.reject(new GitNotSupportedError(this.name, 'blame'));
    }
    this.chamadas.push(`blame:${input.path}`);
    const conteudo = this.arquivos[input.path];
    if (conteudo === undefined) return Promise.resolve(null);

    const brutas = conteudo.split('\n');
    const linhasDoArquivo =
      brutas[brutas.length - 1] === '' ? brutas.slice(0, -1) : brutas;

    return Promise.resolve({
      ref: input.ref,
      path: input.path,
      lines: linhasDoArquivo.map((_, i) => ({
        line: i + 1,
        commitSha: 'sha-falso',
        author: 'autor falso',
        authorDate: '2026-08-09T00:00:00.000Z',
        summary: 'commit falso',
      })),
      truncated: false,
    });
  }

  listPullRequests(): Promise<GitPullRequestList> {
    if (!this.capabilities.pullRequestsList) {
      return Promise.reject(
        new GitNotSupportedError(this.name, 'listPullRequests'),
      );
    }
    this.chamadas.push('listPullRequests');
    return Promise.resolve({
      items: [
        {
          id: 'pr-1',
          number: 1,
          title: 'PR de teste',
          url: 'https://example.com/pr/1',
          author: 'autor-falso',
          state: 'open',
          sourceBranch: 'feature',
          targetBranch: 'dev',
          updatedAt: '2026-08-09T00:00:00.000Z',
        },
      ],
      truncated: false,
    });
  }

  listBranchesDetailed(): Promise<GitBranchDetailList> {
    if (!this.capabilities.branchesDetailed) {
      return Promise.reject(
        new GitNotSupportedError(this.name, 'listBranchesDetailed'),
      );
    }
    this.chamadas.push('listBranchesDetailed');
    return Promise.resolve({ items: this.branchesFalsas, truncated: false });
  }

  // O resto do contrato não pertence à leitura, e explodir é melhor que
  // devolver algo: a aba Code é SÓ LEITURA, e um teste que passasse depois de
  // uma escrita seria o pior desfecho possível deste arquivo.
  createRepo = naoDeveria('createRepo');
  getRepo = naoDeveria('getRepo');
  createBranch = naoDeveria('createBranch');
  protectBranch = naoDeveria('protectBranch');
  commitFiles = naoDeveria('commitFiles');
  listBranches = naoDeveria('listBranches');
  openPullRequest = naoDeveria('openPullRequest');
  mergePullRequest = naoDeveria('mergePullRequest');
  commentOnPullRequest = naoDeveria('commentOnPullRequest');
}

function naoDeveria(metodo: string): never & (() => never) {
  return (() => {
    throw new Error(`A aba Code é só leitura, e chamou ${metodo}`);
  }) as never & (() => never);
}

/**
 * O portão da FASE 25 (RN-105): a aba Code só abre depois que o Arquiteto
 * decide a imagem. O default do helper é DECIDIDO — os testes desta suite são
 * sobre a leitura, e teriam de repetir a decisão em cada um. O portão fechado
 * tem bloco próprio, no fim do arquivo.
 */
const CONTAINER_DECIDIDO: EstadoDoContainer = {
  status: 'decidido',
  decisao: {
    image: 'node:22-bookworm-slim',
    rationale: 'stack TypeScript sobre Node',
    network: 'none',
    resources: RECURSOS_PADRAO,
  },
  version: 1,
  eventId: '01JC4Z0000EVENTO000000001',
  decidedAt: new Date('2026-08-09T00:00:00Z').toISOString(),
};

function montar(
  provider: GitProviderContract,
  opcoes: {
    provider?: GitProviderName;
    semRepositorio?: boolean;
    container?: EstadoDoContainer;
    /** Onde o código mora (RN-169/RN-421). Default `container`, como todo projeto. */
    executionMode?: 'container' | 'mounted' | 'runner';
    /** Tasks por prefixo do id (8 chars, minúsculo) — RN-152. */
    tasksPorPrefixo?: Record<string, Task>;
    moduleMap?: ModuleMap | null;
  } = {},
) {
  const nome = opcoes.provider ?? 'github';
  const gitProviders: GitProviderRegistry = { get: () => provider };
  const projetos = {
    findById: () =>
      Promise.resolve({
        id: PROJETO,
        workspaceId: 'ws-1',
        name: 'checkout',
        slug: 'checkout',
        workspaceDirName: PROJETO,
        executionMode: opcoes.executionMode ?? ('container' as const),
        workspacePath:
          opcoes.executionMode && opcoes.executionMode !== 'container'
            ? '/home/voce/projetos/loja'
            : null,
        workspaceVerifiedAt: null,
        createdBy: 'user-1',
        taskBudgetMicros: null,
        maxConsecutiveBlocked: null,
        storyPromotion: 'manual' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
  } as unknown as ProjectRepository;
  const repositorios = {
    findByProjectId: () =>
      Promise.resolve(
        opcoes.semRepositorio
          ? null
          : {
              id: 'repo-1',
              projectId: PROJETO,
              provider: nome,
              externalId: 'acme/checkout',
              url: 'https://github.com/acme/checkout',
              defaultBranch: 'dev',
              visibility: 'private' as const,
            },
      ),
  } as unknown as ProvisionedRepositoryRepository;

  const credenciais = {
    findSecretByUserAndProvider: () =>
      Promise.resolve({ ciphertext: 'x' } as never),
  } as unknown as UserCredentialRepository;

  const donosPedidos: string[] = [];
  const resolveOwner = {
    execute: (projectId: string) => {
      donosPedidos.push(projectId);
      return Promise.resolve('owner-do-workspace');
    },
  } as unknown as ResolveCredentialOwnerUseCase;

  const container = {
    execute: () => Promise.resolve(opcoes.container ?? CONTAINER_DECIDIDO),
  } as unknown as ObterContainerDoProjetoUseCase;

  const tasksPorPrefixo = opcoes.tasksPorPrefixo ?? {};
  const tasks = {
    findByProjectAndIdPrefix: (_projectId: string, prefixo: string) =>
      Promise.resolve(tasksPorPrefixo[prefixo] ?? null),
  } as unknown as TaskRepository;

  const moduleMaps = {
    findCurrent: () => Promise.resolve(opcoes.moduleMap ?? null),
  } as unknown as ModuleMapRepository;

  const useCase = new ReadProjectCodeUseCase(
    repositorios,
    projetos,
    gitProviders,
    credenciais,
    { decrypt: () => 'token-do-owner' } as unknown as EncryptionService,
    resolveOwner,
    new GitReadCache(),
    container,
    tasks,
    moduleMaps,
  );

  return { useCase, donosPedidos };
}

const REPO: Arquivos = {
  'README.md': '# projeto\nlinha com agulha aqui\n',
  'src/a.ts': "export const a = 'agulha';\n",
  'src/b.ts': 'export const b = 1;\n',
  'src/deep/c.ts': 'nada aqui\n',
};

describe('ReadProjectCodeUseCase — árvore', () => {
  it('caminho feliz: lista UM nível, e o teto é do contrato', async () => {
    const provider = new ProviderFalso(REPO);
    const { useCase } = montar(provider);

    const arvore = await useCase.tree(PROJETO, 'dev', 'src');

    expect(arvore.entries.map((e) => e.name)).toEqual(['a.ts', 'b.ts', 'deep']);
    expect(arvore.entries.find((e) => e.name === 'deep')?.type).toBe('dir');
    // UMA chamada: `listTree` não é recursivo, e a rota não o torna recursivo.
    expect(provider.chamadas).toEqual(['listTree:src']);
  });

  it('sem `ref`, usa a branch padrão do repositório', async () => {
    const provider = new ProviderFalso(REPO);
    const { useCase } = montar(provider);
    expect((await useCase.tree(PROJETO)).ref).toBe('dev');
  });

  it('caso de falha: diretório inexistente é 404, não árvore vazia', async () => {
    const { useCase } = montar(new ProviderFalso(REPO));
    await expect(useCase.tree(PROJETO, 'dev', 'nao-existe')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('caso de falha: projeto sem repositório provisionado é 404', async () => {
    const { useCase } = montar(new ProviderFalso(REPO), {
      semRepositorio: true,
    });
    await expect(useCase.tree(PROJETO, 'dev')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('caso de falha: provider sem a capability propaga GitNotSupportedError (501)', async () => {
    // Capability só é declarada quando provada (ADRs 0041/0042). A rota não
    // finge que a operação existe — o filtro HTTP traduz para 501.
    const { useCase } = montar(new ProviderFalso(REPO, { listTree: false }));
    await expect(useCase.tree(PROJETO, 'dev')).rejects.toThrow(
      GitNotSupportedError,
    );
  });

  it('caso de falha: `ref` como array (confusão de tipo, RN-127) é 400', async () => {
    // `?ref=a&ref=b` chega como array no Express — sem a checagem, `ref`
    // passaria incólume por `.includes('..')`/`REF_VALIDO.test`.
    const { useCase } = montar(new ProviderFalso(REPO));
    const refArray = ['dev', 'main'] as unknown as string;
    await expect(useCase.tree(PROJETO, refArray)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('caso de falha: `path` como array (confusão de tipo, RN-127) é 400', async () => {
    const { useCase } = montar(new ProviderFalso(REPO));
    const pathArray = ['src', '../../etc'] as unknown as string;
    await expect(useCase.tree(PROJETO, 'dev', pathArray)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('ReadProjectCodeUseCase — arquivo', () => {
  it('caminho feliz: devolve o conteúdo e os bytes devolvidos', async () => {
    const { useCase } = montar(new ProviderFalso(REPO));
    const arquivo = await useCase.file(PROJETO, 'src/a.ts', 'dev');

    expect(arquivo.content).toBe(REPO['src/a.ts']);
    expect(arquivo.truncated).toBe(false);
    expect(arquivo.bytes).toBe(Buffer.byteLength(REPO['src/a.ts']));
  });

  it('caso de falha: arquivo inexistente é 404 e não string vazia', async () => {
    // O achado Y da FASE 13b foi exatamente isto em outro lugar: a busca não
    // distinguia vazio de não-encontrado.
    const { useCase } = montar(new ProviderFalso(REPO));
    await expect(useCase.file(PROJETO, 'src/z.ts', 'dev')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('caso de falha: sem caminho não há arquivo — 400', async () => {
    const { useCase } = montar(new ProviderFalso(REPO));
    await expect(useCase.file(PROJETO, '', 'dev')).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('ReadProjectCodeUseCase — busca', () => {
  it('caminho feliz: casa a linha, com caminho e número 1-based', async () => {
    const { useCase } = montar(new ProviderFalso(REPO));
    const r = await useCase.search(PROJETO, { ref: 'dev', query: 'agulha' });

    expect(r.matches).toEqual([
      { path: 'README.md', line: 2, text: 'linha com agulha aqui' },
      { path: 'src/a.ts', line: 1, text: "export const a = 'agulha';" },
    ]);
    expect(r.truncated).toBe(false);
    expect(r.filesScanned).toBe(4);
  });

  it('`path` restringe a subárvore — e é o que reduz o custo', async () => {
    const provider = new ProviderFalso(REPO);
    const { useCase } = montar(provider);

    const r = await useCase.search(PROJETO, {
      ref: 'dev',
      query: 'agulha',
      path: 'src',
    });

    expect(r.matches.map((m) => m.path)).toEqual(['src/a.ts']);
    expect(provider.chamadas).not.toContain('getFileContent:README.md');
  });

  it('caso de falha: termo curto demais é 400, não varredura do repo', async () => {
    const provider = new ProviderFalso(REPO);
    const { useCase } = montar(provider);

    await expect(
      useCase.search(PROJETO, { ref: 'dev', query: 'a' }),
    ).rejects.toThrow(BadRequestException);
    // O ponto do teste não é o 400: é que a recusa veio ANTES de gastar
    // chamada nenhuma no provider.
    expect(provider.chamadas).toEqual([]);
  });

  it('o teto de ARQUIVOS para a busca e marca `truncated`', async () => {
    const muitos: Arquivos = {};
    // NENHUM casa, de propósito: com casamento o teto de matches pararia a
    // busca antes e o teste mediria o teto errado.
    for (let i = 0; i < GIT_SEARCH_FILE_LIMIT + 50; i++) {
      muitos[`f${i}.txt`] = 'palheiro\n';
    }
    const provider = new ProviderFalso(muitos);
    const { useCase } = montar(provider);

    const r = await useCase.search(PROJETO, { ref: 'dev', query: 'agulha' });

    expect(r.truncated).toBe(true);
    expect(r.filesScanned).toBe(GIT_SEARCH_FILE_LIMIT);
    expect(
      provider.chamadas.filter((c) => c.startsWith('getFileContent:')).length,
    ).toBe(GIT_SEARCH_FILE_LIMIT);
  });

  it('o teto de CASAMENTOS para a busca antes de o de arquivos acabar', async () => {
    const muitos: Arquivos = {};
    // Um arquivo só, com mais linhas casadas que o teto: prova que o corte é
    // por casamento e não por arquivo.
    muitos['grande.txt'] = Array.from(
      { length: GIT_SEARCH_MATCH_LIMIT + 20 },
      () => 'agulha',
    ).join('\n');
    const { useCase } = montar(new ProviderFalso(muitos));

    const r = await useCase.search(PROJETO, { ref: 'dev', query: 'agulha' });

    expect(r.matches.length).toBe(GIT_SEARCH_MATCH_LIMIT);
    expect(r.truncated).toBe(true);
  });

  it('o teto de DIRETÓRIOS para a varredura de árvore profunda', async () => {
    const fundo: Arquivos = {};
    for (let i = 0; i < GIT_SEARCH_DIR_LIMIT + 20; i++) {
      fundo[`d${i}/arquivo.txt`] = 'sem casamento\n';
    }
    const provider = new ProviderFalso(fundo);
    const { useCase } = montar(provider);

    const r = await useCase.search(PROJETO, { ref: 'dev', query: 'agulha' });

    expect(r.truncated).toBe(true);
    expect(
      provider.chamadas.filter((c) => c.startsWith('listTree:')).length,
    ).toBe(GIT_SEARCH_DIR_LIMIT);
  });

  it('o cache impede a segunda busca de repetir as chamadas da primeira', async () => {
    const provider = new ProviderFalso(REPO);
    const { useCase } = montar(provider);

    await useCase.search(PROJETO, { ref: 'dev', query: 'agulha' });
    const primeira = provider.chamadas.length;
    await useCase.search(PROJETO, { ref: 'dev', query: 'outra-coisa' });

    expect(provider.chamadas.length).toBe(primeira);
  });
});

describe('ReadProjectCodeUseCase — diff de PR', () => {
  it('caminho feliz: devolve o diff normalizado do contrato', async () => {
    const { useCase } = montar(new ProviderFalso(REPO));
    const diff = await useCase.pullRequestDiff(PROJETO, 'pr-1');
    expect(diff.files[0].path).toBe('src/a.ts');
    expect(diff.truncated).toBe(false);
  });

  it('caso de falha: provider sem a capability propaga 501', async () => {
    const { useCase } = montar(
      new ProviderFalso(REPO, { pullRequestDiff: false }),
    );
    await expect(useCase.pullRequestDiff(PROJETO, 'pr-1')).rejects.toThrow(
      GitNotSupportedError,
    );
  });
});

describe('ReadProjectCodeUseCase — blame (FASE 26b)', () => {
  it('caminho feliz: uma linha anotada por linha do arquivo', async () => {
    const { useCase } = montar(new ProviderFalso(REPO));
    const blame = await useCase.blame(PROJETO, 'src/a.ts', 'dev');
    expect(blame.lines).toHaveLength(1);
    expect(blame.lines[0]).toMatchObject({ line: 1, commitSha: 'sha-falso' });
  });

  it('caso de falha: arquivo inexistente é 404', async () => {
    const { useCase } = montar(new ProviderFalso(REPO));
    await expect(
      useCase.blame(PROJETO, 'nao-existe.ts', 'dev'),
    ).rejects.toThrow(NotFoundException);
  });

  it('caso de falha: `path` vazio é 400 — não faz sentido anotar a raiz', async () => {
    const { useCase } = montar(new ProviderFalso(REPO));
    await expect(useCase.blame(PROJETO, '', 'dev')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('caso de falha: provider sem a capability propaga 501', async () => {
    const { useCase } = montar(new ProviderFalso(REPO, { blame: false }));
    await expect(useCase.blame(PROJETO, 'src/a.ts', 'dev')).rejects.toThrow(
      GitNotSupportedError,
    );
  });
});

describe('ReadProjectCodeUseCase — lista de PRs (FASE 26b)', () => {
  it('caminho feliz: devolve o resumo de cada PR do contrato', async () => {
    const { useCase } = montar(new ProviderFalso(REPO));
    const lista = await useCase.pullRequests(PROJETO);
    expect(lista.items).toHaveLength(1);
    expect(lista.items[0]).toMatchObject({
      id: 'pr-1',
      sourceBranch: 'feature',
    });
  });

  it('caso de falha: provider sem a capability propaga 501', async () => {
    const { useCase } = montar(
      new ProviderFalso(REPO, { pullRequestsList: false }),
    );
    await expect(useCase.pullRequests(PROJETO)).rejects.toThrow(
      GitNotSupportedError,
    );
  });
});

describe('ReadProjectCodeUseCase — branches detalhadas (FASE 26b)', () => {
  it('caminho feliz: cada branch vem com ahead/behind e a PR associada', async () => {
    const { useCase } = montar(new ProviderFalso(REPO));
    const lista = await useCase.branches(PROJETO);
    const feature = lista.items.find((b) => b.name === 'feature');
    expect(feature?.ahead).toBe(2);
    expect(feature?.behind).toBe(1);
    expect(feature?.pullRequest).toEqual({ number: 1, state: 'open' });
  });

  it('caso de falha: provider sem a capability propaga 501', async () => {
    const { useCase } = montar(
      new ProviderFalso(REPO, { branchesDetailed: false }),
    );
    await expect(useCase.branches(PROJETO)).rejects.toThrow(
      GitNotSupportedError,
    );
  });
});

/** Task mínima válida, com os overrides do caso de teste. */
function tarefaFalsa(overrides: Partial<Task>): Task {
  return {
    id: '3f2b1c8e-0000-4000-8000-000000000001',
    storyId: 'story-1',
    title: 'Task de teste',
    description: '',
    status: 'in_progress',
    assignedTo: 'dev-pieces',
    blocked: false,
    blockedReason: null,
    blockedOrigin: null,
    gateStatus: null,
    gateCorrectionCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const MODULE_MAP_PIECES: ModuleMap = {
  id: 'mm-1',
  projectId: PROJETO,
  sessionId: 'session-1',
  version: 1,
  createdAt: new Date(),
  modules: [
    { name: 'pieces', stack: 'ts', responsibility: 'peças', dependsOn: [] },
    { name: 'board', stack: 'ts', responsibility: 'tabuleiro', dependsOn: [] },
  ],
};

describe('ReadProjectCodeUseCase — producedBy da branch de task (RN-152)', () => {
  const BRANCH_DE_TASK = 'feature/task-3f2b1c8e';
  const PREFIXO = '3f2b1c8e';

  it('caminho feliz: branch de task resolve o dev agent e o módulo dono', async () => {
    const provider = new ProviderFalso(REPO, undefined, [
      {
        name: BRANCH_DE_TASK,
        commitSha: 'sha-1',
        protected: false,
        ahead: 1,
        behind: 0,
        pullRequest: null,
      },
    ]);
    const { useCase } = montar(provider, {
      tasksPorPrefixo: { [PREFIXO]: tarefaFalsa({ assignedTo: 'dev-pieces' }) },
      moduleMap: MODULE_MAP_PIECES,
    });

    const lista = await useCase.branches(PROJETO);

    expect(lista.items[0].producedBy).toEqual({
      agentId: 'dev-pieces',
      moduleId: 'pieces',
    });
  });

  it('caminho feliz: resolve também o agente extra da paralelização (dev-<modulo>-2)', async () => {
    const provider = new ProviderFalso(REPO, undefined, [
      {
        name: BRANCH_DE_TASK,
        commitSha: 'sha-1',
        protected: false,
        ahead: 1,
        behind: 0,
        pullRequest: null,
      },
    ]);
    const { useCase } = montar(provider, {
      tasksPorPrefixo: {
        [PREFIXO]: tarefaFalsa({ assignedTo: 'dev-pieces-2' }),
      },
      moduleMap: MODULE_MAP_PIECES,
    });

    const lista = await useCase.branches(PROJETO);

    expect(lista.items[0].producedBy).toEqual({
      agentId: 'dev-pieces-2',
      moduleId: 'pieces',
    });
  });

  it('caso de falha: branch fora do padrão de task nunca ganha producedBy', async () => {
    // Mesmo com uma task de prefixo casável no repositório falso — o nome da
    // branch é que decide, não a existência da task.
    const provider = new ProviderFalso(REPO, undefined, [
      {
        name: 'feature/refatoracao-manual',
        commitSha: 'sha-2',
        protected: false,
        ahead: 0,
        behind: 0,
        pullRequest: null,
      },
    ]);
    const { useCase } = montar(provider, {
      tasksPorPrefixo: { [PREFIXO]: tarefaFalsa() },
      moduleMap: MODULE_MAP_PIECES,
    });

    const lista = await useCase.branches(PROJETO);

    expect(lista.items[0].producedBy).toBeNull();
  });

  it('caso de falha: padrão bate mas não há task com esse prefixo neste projeto', async () => {
    const provider = new ProviderFalso(REPO, undefined, [
      {
        name: BRANCH_DE_TASK,
        commitSha: 'sha-1',
        protected: false,
        ahead: 0,
        behind: 0,
        pullRequest: null,
      },
    ]);
    const { useCase } = montar(provider, {
      tasksPorPrefixo: {},
      moduleMap: MODULE_MAP_PIECES,
    });

    const lista = await useCase.branches(PROJETO);

    expect(lista.items[0].producedBy).toBeNull();
  });

  it('caso de falha: task sem módulo resolvível no module_map vigente degrada para null', async () => {
    const provider = new ProviderFalso(REPO, undefined, [
      {
        name: BRANCH_DE_TASK,
        commitSha: 'sha-1',
        protected: false,
        ahead: 0,
        behind: 0,
        pullRequest: null,
      },
    ]);
    const { useCase } = montar(provider, {
      // Módulo do agente não existe (mais) no module_map vigente.
      tasksPorPrefixo: {
        [PREFIXO]: tarefaFalsa({ assignedTo: 'dev-removido' }),
      },
      moduleMap: MODULE_MAP_PIECES,
    });

    const lista = await useCase.branches(PROJETO);

    expect(lista.items[0].producedBy).toBeNull();
  });

  it('caso de falha: task existe mas não tem dono ainda (assignedTo null) é null', async () => {
    const provider = new ProviderFalso(REPO, undefined, [
      {
        name: BRANCH_DE_TASK,
        commitSha: 'sha-1',
        protected: false,
        ahead: 0,
        behind: 0,
        pullRequest: null,
      },
    ]);
    const { useCase } = montar(provider, {
      tasksPorPrefixo: { [PREFIXO]: tarefaFalsa({ assignedTo: null }) },
      moduleMap: MODULE_MAP_PIECES,
    });

    const lista = await useCase.branches(PROJETO);

    expect(lista.items[0].producedBy).toBeNull();
  });
});

/**
 * A trava que dá nome à RN-095. Está separada e nomeada porque é a razão de a
 * checagem ser CENTRAL: um teste por rota provaria quatro implementações, e o
 * que se quer provar é que existe UMA.
 */
describe('ReadProjectCodeUseCase — caminho malicioso é RECUSADO', () => {
  const maliciosos = [
    '../outro-projeto/permissions.json',
    '../../etc/passwd',
    '/etc/passwd',
    'src/../../../root/.ssh/id_rsa',
  ];

  let provider: ProviderFalso;
  let useCase: ReadProjectCodeUseCase;

  beforeEach(() => {
    provider = new ProviderFalso(REPO);
    useCase = montar(provider).useCase;
  });

  /**
   * O MOTIVO é afirmado junto do status, e não é preciosismo.
   *
   * Sem a contenção, um caminho que escapa pode ainda assim reprovar por
   * acidente — `../../etc/passwd` degenera para caminho vazio, e a rota de
   * arquivo devolve 400 por "path obrigatório". O teste passaria com a
   * garantia removida, que é o pior desfecho possível de um teste de
   * segurança. Exigir a mensagem amarra o 400 à causa certa.
   */
  const recusadoPorEscopo = async (promessa: Promise<unknown>) => {
    await expect(promessa).rejects.toThrow(BadRequestException);
    await expect(promessa).rejects.toThrow(/fora do escopo do projeto/);
  };

  it.each(maliciosos)('a árvore recusa %j com 400', async (caminho) => {
    await recusadoPorEscopo(useCase.tree(PROJETO, 'dev', caminho));
    // A recusa acontece ANTES do provider. Um 400 depois de a chamada sair
    // não conteria nada: o pedido já teria ido com a credencial do owner.
    expect(provider.chamadas).toEqual([]);
  });

  it.each(maliciosos)('o arquivo recusa %j com 400', async (caminho) => {
    await recusadoPorEscopo(useCase.file(PROJETO, caminho, 'dev'));
    expect(provider.chamadas).toEqual([]);
  });

  it.each(maliciosos)('a busca recusa %j com 400', async (caminho) => {
    await recusadoPorEscopo(
      useCase.search(PROJETO, { ref: 'dev', query: 'agulha', path: caminho }),
    );
    expect(provider.chamadas).toEqual([]);
  });

  it.each(maliciosos)('o blame recusa %j com 400', async (caminho) => {
    await recusadoPorEscopo(useCase.blame(PROJETO, caminho, 'dev'));
    expect(provider.chamadas).toEqual([]);
  });

  it('a recusa é 400 e não 404 — dizer "não existe" convida a procurar', async () => {
    await expect(
      useCase.file(PROJETO, '../../etc/passwd', 'dev'),
    ).rejects.toThrow(/fora do escopo do projeto/);
  });

  it.each([
    ['../../outra', 'ref que sobe'],
    ['dev..main', 'intervalo de commits onde se espera uma revisão'],
    ['dev;rm -rf /', 'caractere fora da forma de uma ref'],
  ])('a ref %j é recusada com 400 — %s', async (ref) => {
    await expect(useCase.tree(PROJETO, ref)).rejects.toThrow(
      BadRequestException,
    );
    expect(provider.chamadas).toEqual([]);
  });
});

describe('ReadProjectCodeUseCase — credencial', () => {
  it('a chave é a do OWNER do workspace, não a de quem lê (RN-058/RN-082)', async () => {
    const { useCase, donosPedidos } = montar(new ProviderFalso(REPO));
    await useCase.tree(PROJETO, 'dev');
    expect(donosPedidos).toEqual([PROJETO]);
  });

  it('provider `local` não pede credencial nenhuma', async () => {
    const { useCase, donosPedidos } = montar(new ProviderFalso(REPO), {
      provider: 'local',
    });
    await useCase.tree(PROJETO, 'dev');
    expect(donosPedidos).toEqual([]);
  });
});

describe('ReadProjectCodeUseCase — o portão do container (FASE 25, RN-105)', () => {
  // A pergunta que estes testes respondem não é "a leitura funciona", e sim
  // "ela chega a acontecer". O provider CONTA chamadas: se o portão vazasse,
  // o repositório teria sido tocado antes de o erro subir, e é isso que
  // `chamadas` prova.
  it.each([
    ['tree', (u: ReadProjectCodeUseCase) => u.tree(PROJETO, 'dev')],
    ['file', (u: ReadProjectCodeUseCase) => u.file(PROJETO, 'README.md')],
    [
      'search',
      (u: ReadProjectCodeUseCase) => u.search(PROJETO, { query: 'agulha' }),
    ],
    ['diff', (u: ReadProjectCodeUseCase) => u.pullRequestDiff(PROJETO, 'pr-1')],
    [
      'blame',
      (u: ReadProjectCodeUseCase) => u.blame(PROJETO, 'src/a.ts', 'dev'),
    ],
    ['pullRequests', (u: ReadProjectCodeUseCase) => u.pullRequests(PROJETO)],
    ['branches', (u: ReadProjectCodeUseCase) => u.branches(PROJETO)],
  ])(
    '%s responde 409 enquanto o Arquiteto não decide a imagem',
    async (_nome, chamar) => {
      const provider = new ProviderFalso(REPO);
      const { useCase } = montar(provider, { container: SEM_DECISAO });

      await expect(chamar(useCase)).rejects.toThrow(ConflictException);
      // Nem uma chamada ao provider: o portão vem ANTES de resolver o
      // repositório, a credencial e o caminho.
      expect(provider.chamadas).toEqual([]);
    },
  );

  it('a mensagem diz o que falta, para a tela não mostrar erro mudo', async () => {
    const { useCase } = montar(new ProviderFalso(REPO), {
      container: SEM_DECISAO,
    });
    await expect(useCase.tree(PROJETO, 'dev')).rejects.toThrow(
      /Arquiteto não decidiu qual imagem de container/,
    );
  });

  it('decidida a imagem, a leitura passa a acontecer', async () => {
    const provider = new ProviderFalso(REPO);
    const { useCase } = montar(provider, { container: CONTAINER_DECIDIDO });

    const arvore = await useCase.tree(PROJETO, 'dev', 'src');

    expect(arvore.entries.map((e) => e.name)).toEqual(['a.ts', 'b.ts', 'deep']);
  });

  /**
   * `mounted`/`runner` passam pelo MESMO portão agora (RN-494, revisa
   * RN-169/RN-421, ADR 0135).
   *
   * A dispensa original respondia 409 para sempre num projeto onde a decisão
   * do Arquiteto nunca ia acontecer — a regra uniforme fecha essa lacuna
   * exigindo a decisão nos três modos, em vez de fechar a aba por efeito
   * colateral.
   */
  it.each(['mounted', 'runner'] as const)(
    'projeto %s também responde 409 sem decisão de imagem',
    async (executionMode) => {
      const provider = new ProviderFalso(REPO);
      const { useCase } = montar(provider, {
        container: SEM_DECISAO,
        executionMode,
      });

      await expect(useCase.tree(PROJETO, 'dev')).rejects.toThrow(
        ConflictException,
      );
      expect(provider.chamadas).toEqual([]);
    },
  );

  it.each(['mounted', 'runner'] as const)(
    'projeto %s lê normalmente uma vez decidida a imagem',
    async (executionMode) => {
      const provider = new ProviderFalso(REPO);
      const { useCase } = montar(provider, {
        container: CONTAINER_DECIDIDO,
        executionMode,
      });

      const arvore = await useCase.tree(PROJETO, 'dev', 'src');

      expect(arvore.entries.map((e) => e.name)).toEqual([
        'a.ts',
        'b.ts',
        'deep',
      ]);
    },
  );
});
