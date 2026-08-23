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
@ApiForbiddenResponse({ description: 'Insufficient role on the project.' })
@ApiNotFoundResponse({
  description:
    'Project without a provisioned repository, or a nonexistent ref/path/PR.',
})
@ApiBadRequestResponse({
  description:
    'Path outside the project scope (RN-095), malformed ref, or a search ' +
    'term that is too short or too long.',
})
@ApiResponse({
  status: 501,
  description:
    "The project's provider does not declare the operation's capability — " +
    '`listTree`, `pullRequestDiff`, `blame`, `pullRequestsList`, or ' +
    '`branchesDetailed`. A capability is only declared once proven by the ' +
    'contract suite, so this is a legitimate response, not a defect.',
})
@Controller('projects/:projectId/code')
export class CodeController {
  constructor(private readonly read: ReadProjectCodeUseCase) {}

  @Get('tree')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Lists ONE level of the repository tree',
    description:
      'Not recursive, by contract design: the tab navigates on demand, and ' +
      'requesting the whole tree of a large repository is exactly the ' +
      'traffic amplifier this phase forbids. `truncated` warns when the ' +
      'level went past the entry cap.',
  })
  @ApiQuery({
    name: 'ref',
    required: false,
    description:
      "Branch, tag, or sha. Absent uses the repository's default branch.",
  })
  @ApiQuery({
    name: 'path',
    required: false,
    description: 'Directory to list. Absent or empty is the root.',
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
    summary: "Returns a file's content",
    description:
      "UTF-8, cut at the byte cap with `truncated: true` when it's " +
      'exceeded. A path that escapes the project folder is refused with ' +
      '400 by the central check in RN-095 — never with 404, which would ' +
      'invite probing.',
  })
  @ApiQuery({
    name: 'ref',
    required: false,
    description: 'Branch, tag, or sha.',
  })
  @ApiQuery({
    name: 'path',
    required: true,
    description: 'File path.',
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
    summary: 'Searches text in the repository, with a budget',
    description:
      'Search is NOT a git contract operation: it is composed over the ' +
      'tree and the content, and so is the only read whose cost grows with ' +
      'the size of the repository. Three budgets cap it — directories ' +
      'walked, files opened, and matches returned — and `truncated` says it ' +
      'stopped. `filesScanned` shows the cost it incurred.',
  })
  @ApiQuery({
    name: 'q',
    required: true,
    description: 'Term, 2 to 200 characters.',
  })
  @ApiQuery({
    name: 'ref',
    required: false,
    description: 'Branch, tag, or sha.',
  })
  @ApiQuery({
    name: 'path',
    required: false,
    description:
      'Subtree to search in. Narrowing this is what avoids truncation.',
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
    summary: 'Returns the diff of a PR, normalized across providers',
    // No double quotes nor a literal `""` in this string: it becomes the
    // `description:` of the generated MDX's YAML front matter, and the
    // generator swaps double quotes for single ones — a `""` comes out as
    // `'"` and breaks `pnpm docs:build` with "bad indentation of a mapping entry".
    description:
      "A null `patch` distinguishes the case where the provider didn't " +
      'deliver the text (binary, or a patch too large) from the case where ' +
      'the text came back empty. Collapsing the two would make the screen ' +
      "say a changed binary didn't change. The `truncated` field warns " +
      'when the file list went past the cap.',
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
    summary: 'Annotates every line of a file with the commit that touched it',
    description:
      'Foundation for the declared blame pending item (PHASE 26b) — the UI ' +
      "that annotates the editor line by line doesn't exist yet. " +
      '`truncated` warns when the file went past the annotated-lines cap.',
  })
  @ApiQuery({
    name: 'ref',
    required: false,
    description:
      "Branch, tag, or sha. Absent uses the repository's default branch.",
  })
  @ApiQuery({
    name: 'path',
    required: true,
    description: 'Path of the file to annotate.',
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
    summary: "Lists the repository's PRs/MRs",
    description:
      'Foundation for the navigable list (PHASE 26b) — today the diff is ' +
      'only reachable by a known id (e.g. coming from Approvals); this ' +
      'route resolves how to reach the id without having to know it by ' +
      'heart. `truncated` warns when the list went past the per-call cap.',
  })
  @ApiQuery({
    name: 'state',
    required: false,
    enum: ['open', 'merged', 'closed'],
    description: 'Absent lists all states.',
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
    summary: 'Lists branches with ahead/behind and the associated open PR',
    description:
      'Foundation for the rich dropdown (PHASE 26b) — today the ref ' +
      'selector is a plain text field. `ahead`/`behind` are relative to ' +
      "the repository's DEFAULT branch; `null` when the provider can't " +
      'compute it (an honest degradation, not an error). It is NOT ' +
      '`listBranches` (which the Gitflow bootstrap uses) — it is its own ' +
      'operation, because enriching costs an extra call to the provider ' +
      'PER BRANCH.',
  })
  @ApiOkResponse({ type: CodeBranchDetailListResponseDto })
  branches(@Param('projectId') projectId: string) {
    return this.read.branches(projectId);
  }
}
