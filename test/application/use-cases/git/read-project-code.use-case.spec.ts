import { describe, expect, it, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type {
  GetFileContentInput,
  GitProviderCapabilities,
  GitProviderContract,
  GitProviderName,
  GitPullRequestDiff,
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
import type { UserCredentialRepository } from '../../../../src/application/ports/user-credential-repository.port';
import type { EncryptionService } from '../../../../src/application/ports/encryption.port';
import type { ResolveCredentialOwnerUseCase } from '../../../../src/application/use-cases/llm/resolve-credential-owner.use-case';

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

class ProviderFalso implements GitProviderContract {
  readonly name: GitProviderName = 'github';
  readonly capabilities: GitProviderCapabilities;
  /** O custo, medido: uma entrada por chamada ao provider. */
  readonly chamadas: string[] = [];

  constructor(
    private readonly arquivos: Arquivos,
    capabilities?: Partial<GitProviderCapabilities>,
  ) {
    this.capabilities = {
      protectBranch: true,
      pullRequests: true,
      listTree: true,
      pullRequestDiff: true,
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

function montar(
  provider: GitProviderContract,
  opcoes: { provider?: GitProviderName; semRepositorio?: boolean } = {},
) {
  const nome = opcoes.provider ?? 'github';
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

  const useCase = new ReadProjectCodeUseCase(
    repositorios,
    { get: () => provider } as unknown as GitProviderRegistry,
    credenciais,
    { decrypt: () => 'token-do-owner' } as unknown as EncryptionService,
    resolveOwner,
    new GitReadCache(),
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
