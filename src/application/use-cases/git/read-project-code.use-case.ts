import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  GitBlame,
  GitBranchDetailList,
  GitPullRequestDiff,
  GitPullRequestList,
  GitTree,
  GitTreeEntry,
} from '@brabo/shared';
import { GitProviderRegistry } from '../../ports/git-provider.port';
import { ProvisionedRepositoryRepository } from '../../ports/provisioned-repository-repository.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import { ResolveCredentialOwnerUseCase } from '../llm/resolve-credential-owner.use-case';
import { GitReadCache } from '../../../domain/git/git-read-cache';
import {
  GIT_BLOB_MAX_BYTES,
  GIT_SEARCH_DIR_LIMIT,
  GIT_SEARCH_FILE_LIMIT,
  GIT_SEARCH_MATCH_LIMIT,
} from '../../../domain/git/git-read-limits';
import {
  CaminhoForaDoEscopoError,
  caminhoDeRepositorioContido,
  garantirQueryEscalar,
} from '../../../infrastructure/filesystem/project-workspaces-root';
import { ObterContainerDoProjetoUseCase } from '../containers/obter-container-do-projeto.use-case';

/**
 * A superfície de LEITURA de código de um projeto (FASE 26b).
 *
 * ## O que ela é, e o que ela não é
 *
 * Sete leituras: árvore, arquivo, busca, diff de PR, blame, lista de PRs e
 * branches detalhadas (as três últimas da FASE 26b — fundação das pendências
 * declaradas da aba Code; a UI que as consome é onda seguinte, em três
 * agentes separados). **Nada aqui escreve.** Isso não é omissão — é o
 * congelamento declarado da fase: a aba Code é só leitura, e escrita é efeito
 * externo, que nasce `proposed_action` e é fase seguinte. Por isso este caso
 * de uso não conhece a outbox, nem o event log, nem `proposed_actions`: ler
 * não é ação com efeito externo, e transformá-la em uma encheria a fila de
 * aprovação de ruído até ninguém mais ler as de verdade.
 *
 * ## Um caso de uso só, e não sete
 *
 * As sete leituras compartilham exatamente as três coisas que dão errado:
 * de quem é a credencial, como o caminho é contido, e quanto se pode gastar
 * antes de parar. Separá-las em sete classes multiplicaria essas três por
 * sete — e a lição da FASE 14d é que a peça testada não é o caminho até ela.
 *
 * ## Contenção de caminho (RN-095)
 *
 * Um único ponto: `caminhoDeRepositorioContido`, que é a checagem central da
 * RN-092 estendida para caminho de arquivo. Nenhuma rota valida caminho por
 * conta própria.
 *
 * ## Credencial (RN-058/RN-082)
 *
 * A do OWNER do workspace, pelo mesmo resolvedor que a escrita usa. Ler custa
 * rate limit do provider como escrever custa, e duas regras de "de quem é a
 * credencial" divergiriam com o tempo.
 *
 * ## Teto (item 34 da FASE 26)
 *
 * A busca não é operação do contrato: ela é composta sobre `listTree` e
 * `getFileContent`, e é a única leitura cujo custo cresce com o TAMANHO do
 * repositório em vez do tamanho do pedido. Os três orçamentos (diretórios
 * percorridos, arquivos abertos, casamentos devolvidos) param a varredura, e
 * `truncated` diz que ela parou. Sem eles a aba seria um amplificador de
 * tráfego — a família de defeito dos 3.824 req/min da PÓS-FASE 15.
 */

export interface CodeFile {
  ref: string;
  path: string;
  content: string;
  /** `true` quando o arquivo passou de `GIT_BLOB_MAX_BYTES` e foi cortado. */
  truncated: boolean;
  /** Bytes DEVOLVIDOS, não os do arquivo — o corte já aconteceu. */
  bytes: number;
}

export interface CodeSearchMatch {
  path: string;
  /** 1-based, como todo editor mostra. */
  line: number;
  /** A linha inteira, cortada em `MAX_TRECHO` para não devolver minificado. */
  text: string;
}

export interface CodeSearchResult {
  ref: string;
  path: string;
  query: string;
  matches: CodeSearchMatch[];
  /** Arquivos efetivamente abertos — o custo real da busca, visível. */
  filesScanned: number;
  /** `true` quando algum dos três orçamentos acabou antes da árvore. */
  truncated: boolean;
}

export interface CodeSearchInput {
  /** Ausente resolve para a branch padrão do repositório. */
  ref?: string;
  query: string;
  path?: string;
}

/**
 * Um `ref` é branch, tag ou sha, e vira segmento de URL nos providers remotos e
 * o lado esquerdo de `git show <ref>:<path>` no local. A forma é conferida em
 * UM lugar, pelo mesmo motivo do caminho.
 *
 * `..` é recusado explicitamente porque no git ele não é caminho: `a..b` é
 * intervalo de commits, e um intervalo onde se espera uma revisão faz o local
 * responder outra coisa que não o pedido.
 */
const REF_VALIDO = /^[A-Za-z0-9._\-/]{1,255}$/;

/** Curto demais casa com o repositório inteiro e gasta o orçamento à toa. */
const BUSCA_MIN = 2;
const BUSCA_MAX = 200;

/** Uma linha de arquivo minificado tem megabytes; a tela não os quer. */
const MAX_TRECHO = 300;

@Injectable()
export class ReadProjectCodeUseCase {
  constructor(
    private readonly repositories: ProvisionedRepositoryRepository,
    private readonly projects: ProjectRepository,
    private readonly gitProviders: GitProviderRegistry,
    private readonly userCredentials: UserCredentialRepository,
    private readonly encryption: EncryptionService,
    private readonly resolveOwner: ResolveCredentialOwnerUseCase,
    private readonly cache: GitReadCache,
    private readonly container: ObterContainerDoProjetoUseCase,
  ) {}

  async tree(projectId: string, ref?: string, path?: string): Promise<GitTree> {
    const alvo = await this.alvo(projectId, ref, path);
    const arvore = await this.listTree(alvo, alvo.path);
    if (!arvore) {
      throw new NotFoundException(
        `Não há árvore em "${alvo.path || '/'}" na ref "${alvo.ref}"`,
      );
    }
    return arvore;
  }

  async file(projectId: string, path: string, ref?: string): Promise<CodeFile> {
    const alvo = await this.alvo(projectId, ref, path);
    if (alvo.path === '') {
      throw new BadRequestException('`path` é obrigatório para ler um arquivo');
    }

    const conteudo = await this.fileContent(alvo, alvo.path);
    if (conteudo === null) {
      throw new NotFoundException(
        `Arquivo inexistente em "${alvo.path}" na ref "${alvo.ref}"`,
      );
    }

    // Cortar em bytes e não em caracteres: o teto existe para limitar o que
    // trafega, e um arquivo de emoji tem 4 bytes por caractere.
    const bruto = Buffer.from(conteudo, 'utf8');
    const truncated = bruto.byteLength > GIT_BLOB_MAX_BYTES;
    const devolvido = truncated
      ? bruto.subarray(0, GIT_BLOB_MAX_BYTES).toString('utf8')
      : conteudo;

    return {
      ref: alvo.ref,
      path: alvo.path,
      content: devolvido,
      truncated,
      bytes: Buffer.byteLength(devolvido, 'utf8'),
    };
  }

  async pullRequestDiff(
    projectId: string,
    pullRequestId: string,
  ): Promise<GitPullRequestDiff> {
    if (!pullRequestId.trim()) {
      throw new BadRequestException('`pullRequestId` é obrigatório');
    }
    const alvo = await this.alvo(projectId, undefined, undefined);
    const diff = await alvo.provider.getPullRequestDiff({
      externalId: alvo.externalId,
      pullRequestId,
      accessToken: alvo.accessToken,
    });
    if (!diff) {
      throw new NotFoundException(`PR inexistente: ${pullRequestId}`);
    }
    return diff;
  }

  /**
   * Anota cada linha de um arquivo com o commit que a tocou (FASE 26b, item
   * 1 — fundação do blame). Mesma resolução de credencial e contenção de
   * caminho que `file()`; sem cache, porque é chamada uma vez por arquivo
   * aberto, não em laço como `search`.
   */
  async blame(
    projectId: string,
    path: string,
    ref?: string,
  ): Promise<GitBlame> {
    const alvo = await this.alvo(projectId, ref, path);
    if (alvo.path === '') {
      throw new BadRequestException(
        '`path` é obrigatório para anotar um arquivo',
      );
    }

    const blame = await alvo.provider.blame({
      externalId: alvo.externalId,
      ref: alvo.ref,
      path: alvo.path,
      accessToken: alvo.accessToken,
    });
    if (!blame) {
      throw new NotFoundException(
        `Arquivo inexistente em "${alvo.path}" na ref "${alvo.ref}"`,
      );
    }
    return blame;
  }

  /**
   * Lista de PRs/MRs do repositório (FASE 26b, item 3 — fundação da lista
   * navegável). O diff de cada uma continua vindo de `pullRequestDiff`, por
   * id — esta rota não substitui aquela, só resolve como chegar ao id sem
   * precisar saber de cor.
   */
  async pullRequests(
    projectId: string,
    state?: 'open' | 'merged' | 'closed',
  ): Promise<GitPullRequestList> {
    const alvo = await this.alvo(projectId, undefined, undefined);
    return alvo.provider.listPullRequests({
      externalId: alvo.externalId,
      state,
      accessToken: alvo.accessToken,
    });
  }

  /**
   * Branches com `ahead`/`behind` contra a default e a PR aberta associada
   * (FASE 26b, item 2 — fundação do dropdown rico). Deliberadamente NESTE
   * caso de uso, e não perto do bootstrap: é uma LEITURA da aba Code, com a
   * mesma resolução de credencial e o mesmo portão de container das outras
   * seis — tratá-la como operação de bootstrap duplicaria os dois.
   */
  async branches(projectId: string): Promise<GitBranchDetailList> {
    const alvo = await this.alvo(projectId, undefined, undefined);
    return alvo.provider.listBranchesDetailed({
      externalId: alvo.externalId,
      defaultBranch: alvo.ref,
      accessToken: alvo.accessToken,
    });
  }

  /**
   * Busca textual, percorrendo a árvore em LARGURA.
   *
   * Largura e não profundidade porque o orçamento é finito: cortada no meio,
   * uma varredura em largura entrega os arquivos mais rasos — que é onde quem
   * busca costuma olhar — enquanto a em profundidade entregaria um ramo
   * arbitrário inteiro e nada do resto.
   */
  async search(
    projectId: string,
    input: CodeSearchInput,
  ): Promise<CodeSearchResult> {
    const termo = input.query?.trim() ?? '';
    if (termo.length < BUSCA_MIN || termo.length > BUSCA_MAX) {
      throw new BadRequestException(
        `\`q\` precisa ter entre ${BUSCA_MIN} e ${BUSCA_MAX} caracteres`,
      );
    }

    const alvo = await this.alvo(projectId, input.ref, input.path);
    const agulha = termo.toLowerCase();

    const fila: string[] = [alvo.path];
    const matches: CodeSearchMatch[] = [];
    let diretorios = 0;
    let arquivosAbertos = 0;
    let truncated = false;

    while (fila.length > 0) {
      if (diretorios >= GIT_SEARCH_DIR_LIMIT) {
        truncated = true;
        break;
      }
      const diretorio = fila.shift()!;
      diretorios++;

      const arvore = await this.listTree(alvo, diretorio);
      if (!arvore) continue;
      if (arvore.truncated) truncated = true;

      const arquivos: GitTreeEntry[] = [];
      for (const entrada of arvore.entries) {
        if (entrada.type === 'dir') fila.push(entrada.path);
        else arquivos.push(entrada);
      }

      for (const arquivo of arquivos) {
        if (arquivosAbertos >= GIT_SEARCH_FILE_LIMIT) {
          truncated = true;
          break;
        }
        // Arquivo grande é PULADO, não cortado: casar na metade lida daria um
        // resultado que muda conforme o teto, e um resultado que depende do
        // teto é pior que resultado nenhum.
        if (arquivo.size !== null && arquivo.size > GIT_BLOB_MAX_BYTES) {
          truncated = true;
          continue;
        }

        arquivosAbertos++;
        const conteudo = await this.fileContent(alvo, arquivo.path);
        if (conteudo === null || conteudo.includes('\0')) continue;

        for (const [i, linha] of conteudo.split('\n').entries()) {
          if (!linha.toLowerCase().includes(agulha)) continue;
          if (matches.length >= GIT_SEARCH_MATCH_LIMIT) {
            truncated = true;
            break;
          }
          matches.push({
            path: arquivo.path,
            line: i + 1,
            text: linha.slice(0, MAX_TRECHO),
          });
        }
        if (matches.length >= GIT_SEARCH_MATCH_LIMIT) break;
      }

      if (
        matches.length >= GIT_SEARCH_MATCH_LIMIT ||
        arquivosAbertos >= GIT_SEARCH_FILE_LIMIT
      ) {
        truncated = true;
        break;
      }
    }

    return {
      ref: alvo.ref,
      path: alvo.path,
      query: termo,
      matches,
      filesScanned: arquivosAbertos,
      truncated,
    };
  }

  // ------------------------------------------------------------------ interno

  /**
   * Repositório + provider + credencial + caminho CONTIDO, numa passada.
   *
   * O ponto de existir: `ref` e `path` são validados aqui e em lugar nenhum
   * mais. Um método que esquecesse de chamar isto não teria repositório para
   * ler, então esquecer não compila em silêncio — vira `undefined` na cara.
   */
  private async alvo(
    projectId: string,
    ref: string | undefined,
    path: string | undefined,
  ): Promise<Alvo> {
    await this.portaoDoContainer(projectId);

    const project = await this.projects.findById(projectId);
    if (!project) {
      throw new NotFoundException(`Projeto não encontrado: ${projectId}`);
    }

    const repo = await this.repositories.findByProjectId(projectId);
    if (!repo) {
      throw new NotFoundException(
        `Projeto sem repositório provisionado: ${projectId}`,
      );
    }

    // Array antes de tudo (RN-127): `ref.includes('..')` e `REF_VALIDO.test(ref)`
    // abaixo têm semântica diferente para array do que para string, e um
    // valor como `['x/../y']` escaparia da checagem de `..` por causa disso.
    ref = garantirQueryEscalar(
      ref,
      () => new BadRequestException(`ref inválida: ${JSON.stringify(ref)}`),
    );

    if (ref !== undefined && !REF_VALIDO.test(ref)) {
      throw new BadRequestException(`ref inválida: ${JSON.stringify(ref)}`);
    }
    // `..` em qualquer posição, e não só como segmento: `dev..main` é
    // intervalo de commits para o git, e o próprio git proíbe `..` em nome de
    // ref (`git check-ref-format`). Recusar aqui é concordar com ele.
    if (ref !== undefined && ref.includes('..')) {
      throw new BadRequestException(`ref inválida: ${JSON.stringify(ref)}`);
    }

    let contido = '';
    try {
      contido = caminhoDeRepositorioContido(project.workspaceDirName, path);
    } catch (erro) {
      if (erro instanceof CaminhoForaDoEscopoError) {
        // 400 e não 404: dizer "não encontrado" a um caminho que escapa
        // convidaria a procurar o que existe. O motivo vai na mensagem porque
        // ele não vaza nada — o cliente escreveu o caminho.
        throw new BadRequestException(erro.message);
      }
      // `projectScopeRoot` recusa workspaceDirName que não seja segmento de
      // caminho (RN-092). Também é pedido do cliente, e também é 400.
      throw new BadRequestException(
        erro instanceof Error ? erro.message : 'caminho inválido',
      );
    }

    let accessToken: string | undefined;
    if (repo.provider !== 'local') {
      // A do OWNER do workspace (RN-058/RN-082), pelo mesmo resolvedor que a
      // escrita usa: quem banca a conta banca também a leitura, e isso não
      // muda conforme quem abriu a aba.
      const dono = await this.resolveOwner.execute(projectId);
      const secret = await this.userCredentials.findSecretByUserAndProvider(
        dono,
        repo.provider,
      );
      if (secret) accessToken = this.encryption.decrypt(secret);
    }

    return {
      provider: this.gitProviders.get(repo.provider),
      providerName: repo.provider,
      externalId: repo.externalId,
      ref: ref ?? repo.defaultBranch,
      path: contido,
      accessToken,
    };
  }

  /**
   * O portão da FASE 25 (RN-105).
   *
   * A aba Code só libera depois que o Arquiteto decide QUAL IMAGEM sobe para o
   * projeto. A ordem é do usuário, e a razão dela é de produto: o container é o
   * que dá sentido a ler o código ali — ler para depois rodar, buildar,
   * corrigir. Liberar a leitura antes de existir onde executar seria entregar
   * meia aba e ensinar que o portão é decorativo.
   *
   * Mora no MESMO funil que a contenção de caminho (`alvo`), e não em cada uma
   * das quatro rotas, pelo mesmo motivo da RN-092: checagem duplicada em quatro
   * chamadores é checagem que um dia diverge em um deles.
   *
   * 409 e não 403: nada está errado com quem pediu nem com a permissão dele —
   * o recurso ainda não existe neste estado. E a mensagem diz o que falta, para
   * a tela poder mostrar o motivo em vez de um erro mudo.
   */
  private async portaoDoContainer(projectId: string): Promise<void> {
    const estado = await this.container.execute(projectId);
    if (estado.status === 'sem_decisao') {
      throw new ConflictException(
        'A aba Code ainda não está liberada: o Arquiteto não decidiu qual ' +
          'imagem de container sobe para este projeto. Sem essa decisão o ' +
          'container do projeto não sobe, e é ele que isola a execução.',
      );
    }
  }

  private chave(alvo: Alvo, tipo: string, path: string): string {
    return [alvo.providerName, alvo.externalId, alvo.ref, tipo, path].join(' ');
  }

  private async listTree(alvo: Alvo, path: string): Promise<GitTree | null> {
    const chave = this.chave(alvo, 'tree', path);
    const emCache = this.cache.get<GitTree | null>(chave);
    if (emCache !== undefined) return emCache;

    const arvore = await alvo.provider.listTree({
      externalId: alvo.externalId,
      ref: alvo.ref,
      path,
      accessToken: alvo.accessToken,
    });
    this.cache.set(chave, arvore);
    return arvore;
  }

  private async fileContent(alvo: Alvo, path: string): Promise<string | null> {
    const chave = this.chave(alvo, 'blob', path);
    const emCache = this.cache.get<string | null>(chave);
    if (emCache !== undefined) return emCache;

    const conteudo = await alvo.provider.getFileContent({
      externalId: alvo.externalId,
      branch: alvo.ref,
      path,
      accessToken: alvo.accessToken,
    });
    this.cache.set(chave, conteudo);
    return conteudo;
  }
}

interface Alvo {
  provider: ReturnType<GitProviderRegistry['get']>;
  providerName: string;
  externalId: string;
  ref: string;
  path: string;
  accessToken?: string;
}
