import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRole } from '../iam/require-role.decorator';
import { ReadProjectCodeUseCase } from '../../../application/use-cases/git/read-project-code.use-case';
import { BEARER } from '../../../infrastructure/openapi/documento';
import {
  CodeBlameResponseDto,
  CodeBranchDetailListResponseDto,
  CodeDiffResponseDto,
  CodeFileResponseDto,
  CodePullRequestListResponseDto,
  CodeSearchResponseDto,
  CodeTreeResponseDto,
} from './dto/code.response.dto';

/**
 * A aba Code — **só leitura** (FASE 26b).
 *
 * ## Por que um controller próprio, e não mais rotas no `GitController`
 *
 * O `GitController` é sobre PROVISIONAR: criar, adotar, planejar, decidir. Tudo
 * lá é `maintainer` e tudo lá muda estado. Estas quatro rotas são o oposto —
 * `viewer` e sem efeito nenhum — e misturá-las faria a única leitura possível
 * do arquivo ("este controller escreve no repositório do usuário") deixar de
 * ser verdade.
 *
 * ## O congelamento, escrito onde ele é violado
 *
 * Não há `@Post`, `@Put`, `@Patch` nem `@Delete` aqui, e não é acidente: a aba
 * é de leitura, e escrita é efeito externo — nasce `proposed_action`, e é fase
 * seguinte. Quem for acrescentar um verbo de escrita a este arquivo está
 * mudando a fase, não o controller.
 *
 * ## Papel
 *
 * `viewer` nas sete, igual a `GET /projects/:id/git/repository`: ver o código
 * do projeto é a mesma permissão que ver o projeto. A contenção que importa não
 * é de papel — é de CAMINHO (RN-095), e mora no caso de uso.
 *
 * ## FASE 26b — fundação de blame, PRs navegáveis e branch rica
 *
 * `blame`, `pull-requests` (lista) e `branches` são NOVAS nesta sessão — a
 * API existe, mas nenhuma tela ainda consome: a UI é onda seguinte, em três
 * agentes separados, sem risco de colisão com esta PR.
 */
@ApiTags('git')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@ApiNotFoundResponse({
  description:
    'Projeto sem repositório provisionado, ou ref/caminho/PR inexistente.',
})
@ApiBadRequestResponse({
  description:
    'Caminho fora do escopo do projeto (RN-095), ref malformada, ou busca ' +
    'com termo curto/longo demais.',
})
@ApiResponse({
  status: 501,
  description:
    'O provider do projeto não declara a capability da operação — ' +
    '`listTree`, `pullRequestDiff`, `blame`, `pullRequestsList` ou ' +
    '`branchesDetailed`. Capability só é declarada quando provada pela ' +
    'suite de contrato, então isto é resposta legítima e não defeito.',
})
@Controller('projects/:projectId/code')
export class CodeController {
  constructor(private readonly read: ReadProjectCodeUseCase) {}

  @Get('tree')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Lista UM nível da árvore do repositório',
    description:
      'Não é recursivo, por desenho do contrato: a aba navega sob demanda, e ' +
      'pedir a árvore inteira de um repositório grande é o amplificador de ' +
      'tráfego que a fase proíbe. `truncated` avisa quando o nível passou do ' +
      'teto de entradas.',
  })
  @ApiQuery({
    name: 'ref',
    required: false,
    description:
      'Branch, tag ou sha. Ausente usa a branch padrão do repositório.',
  })
  @ApiQuery({
    name: 'path',
    required: false,
    description: 'Diretório a listar. Ausente ou vazio é a raiz.',
  })
  @ApiOkResponse({ type: CodeTreeResponseDto })
  tree(
    @Param('projectId') projectId: string,
    @Query('ref') ref?: string,
    @Query('path') path?: string,
  ) {
    return this.read.tree(projectId, ref, path);
  }

  @Get('file')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Devolve o conteúdo de um arquivo',
    description:
      'UTF-8, cortado no teto de bytes com `truncated: true` quando passa. ' +
      'Um caminho que sai da pasta do projeto é recusado com 400 pela ' +
      'checagem central da RN-095 — nunca com 404, que convidaria a procurar.',
  })
  @ApiQuery({
    name: 'ref',
    required: false,
    description: 'Branch, tag ou sha.',
  })
  @ApiQuery({
    name: 'path',
    required: true,
    description: 'Caminho do arquivo.',
  })
  @ApiOkResponse({ type: CodeFileResponseDto })
  file(
    @Param('projectId') projectId: string,
    @Query('path') path: string,
    @Query('ref') ref?: string,
  ) {
    return this.read.file(projectId, path, ref);
  }

  @Get('search')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Busca texto no repositório, com orçamento',
    description:
      'A busca NÃO é operação do contrato de git: ela é composta sobre a ' +
      'árvore e o conteúdo, e por isso é a única leitura cujo custo cresce ' +
      'com o tamanho do repositório. Três orçamentos a param — diretórios ' +
      'percorridos, arquivos abertos e casamentos devolvidos — e `truncated` ' +
      'diz que ela parou. `filesScanned` mostra o custo que ela teve.',
  })
  @ApiQuery({
    name: 'q',
    required: true,
    description: 'Termo, 2 a 200 caracteres.',
  })
  @ApiQuery({
    name: 'ref',
    required: false,
    description: 'Branch, tag ou sha.',
  })
  @ApiQuery({
    name: 'path',
    required: false,
    description: 'Subárvore em que buscar. Refinar aqui é o que evita o corte.',
  })
  @ApiOkResponse({ type: CodeSearchResponseDto })
  search(
    @Param('projectId') projectId: string,
    @Query('q') q: string,
    @Query('ref') ref?: string,
    @Query('path') path?: string,
  ) {
    return this.read.search(projectId, { ref, query: q ?? '', path });
  }

  @Get('pull-requests/:pullRequestId/diff')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Devolve o diff de uma PR, normalizado por provider',
    // Sem aspas duplas nem `""` literal nesta string: ela vira o
    // `description:` do front matter YAML do MDX gerado, e o gerador troca
    // aspas duplas por simples — um `""` sai como `'"` e derruba o
    // `pnpm docs:build` com "bad indentation of a mapping entry".
    description:
      'Um `patch` nulo distingue o caso em que o provider não entregou o ' +
      'texto (binário, ou patch grande demais) do caso em que o texto veio ' +
      'vazio. Colapsar os dois faria a tela dizer que um binário alterado ' +
      'não mudou. O campo `truncated` avisa quando a lista de arquivos ' +
      'passou do teto.',
  })
  @ApiOkResponse({ type: CodeDiffResponseDto })
  diff(
    @Param('projectId') projectId: string,
    @Param('pullRequestId') pullRequestId: string,
  ) {
    return this.read.pullRequestDiff(projectId, pullRequestId);
  }

  @Get('blame')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Anota cada linha de um arquivo com o commit que a tocou',
    description:
      'Fundação da pendência declarada de blame (FASE 26b) — a UI que ' +
      'anota o editor linha a linha ainda não existe. `truncated` avisa ' +
      'quando o arquivo passou do teto de linhas anotadas.',
  })
  @ApiQuery({
    name: 'ref',
    required: false,
    description:
      'Branch, tag ou sha. Ausente usa a branch padrão do repositório.',
  })
  @ApiQuery({
    name: 'path',
    required: true,
    description: 'Caminho do arquivo a anotar.',
  })
  @ApiOkResponse({ type: CodeBlameResponseDto })
  blame(
    @Param('projectId') projectId: string,
    @Query('path') path: string,
    @Query('ref') ref?: string,
  ) {
    return this.read.blame(projectId, path, ref);
  }

  @Get('pull-requests')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Lista as PRs/MRs do repositório',
    description:
      'Fundação da lista navegável (FASE 26b) — hoje o diff só é ' +
      'alcançável por id conhecido (ex.: vindo de Aprovações); esta rota ' +
      'resolve como chegar ao id sem precisar saber de cor. `truncated` ' +
      'avisa quando a lista passou do teto por chamada.',
  })
  @ApiQuery({
    name: 'state',
    required: false,
    enum: ['open', 'merged', 'closed'],
    description: 'Ausente lista todos os estados.',
  })
  @ApiOkResponse({ type: CodePullRequestListResponseDto })
  pullRequests(
    @Param('projectId') projectId: string,
    @Query('state') state?: 'open' | 'merged' | 'closed',
  ) {
    return this.read.pullRequests(projectId, state);
  }

  @Get('branches')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Lista as branches com ahead/behind e a PR aberta associada',
    description:
      'Fundação do dropdown rico (FASE 26b) — hoje o seletor de ref é ' +
      'campo de texto simples. `ahead`/`behind` são relativos à branch ' +
      'DEFAULT do repositório; `null` quando o provider não consegue ' +
      'computar (degradação honesta, não erro). NÃO é `listBranches` (que ' +
      'o bootstrap de Gitflow usa) — é operação própria, porque enriquecer ' +
      'custa uma chamada extra ao provider POR BRANCH.',
  })
  @ApiOkResponse({ type: CodeBranchDetailListResponseDto })
  branches(@Param('projectId') projectId: string) {
    return this.read.branches(projectId);
  }
}
