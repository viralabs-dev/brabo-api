import { ApiProperty } from '@nestjs/swagger';
import type {
  GitBlame,
  GitBlameLine,
  GitBranchPullRequestRef,
  GitPullRequestDiff,
  GitPullRequestDiffFile,
  GitPullRequestList,
  GitPullRequestSummary,
  GitTree,
  GitTreeEntry,
} from '@brabo/shared';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import type {
  CodeBranch,
  CodeBranchList,
  CodeBranchProducedBy,
  CodeFile,
  CodeSearchMatch,
  CodeSearchResult,
} from '../../../../application/use-cases/git/read-project-code.use-case';

/**
 * Respostas da superfície de LEITURA de código (FASE 26b).
 *
 * Os tipos de árvore e de diff vêm do `GitProviderContract` sem tradução: eles
 * já são normalizados por provider (é o ponto do contrato), e reescrevê-los
 * aqui criaria um segundo vocabulário para a mesma coisa. Os de arquivo e de
 * busca são da superfície, porque `truncated`/`filesScanned` descrevem o TETO
 * desta camada e não o do provider.
 *
 * Toda resposta que pode ter sido cortada diz isso num campo — nunca em
 * silêncio. É a mesma regra que o `truncated` do contrato já segue: quem corta
 * avisa, senão a tela mostra meia verdade como se fosse a verdade.
 */

export class CodeTreeEntryResponseDto implements Wire<GitTreeEntry> {
  @ApiProperty({
    example: 'apps/api/src/main.ts',
    description: "Full path from the repository's root.",
  })
  path!: string;

  @ApiProperty({
    example: 'main.ts',
    description: 'Last segment of `path`.',
  })
  name!: string;

  @ApiProperty({ enum: ['file', 'dir'], example: 'file' })
  type!: Wire<GitTreeEntry>['type'];

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 1284,
    description:
      "Bytes. `null` for a directory and when the provider doesn't report " +
      'it — distinguishing it from `0` matters so the screen never claims ' +
      '"empty file".',
  })
  size!: number | null;
}
export const _chavesEntradaDeArvore: MesmasChaves<
  CodeTreeEntryResponseDto,
  GitTreeEntry
> = true;

export class CodeTreeResponseDto implements Wire<GitTree> {
  @ApiProperty({ example: 'dev', description: 'Branch, tag, or sha read.' })
  ref!: string;

  @ApiProperty({
    example: 'apps/api',
    description: 'Listed directory; `""` is the root.',
  })
  path!: string;

  @ApiProperty({ type: [CodeTreeEntryResponseDto] })
  entries!: CodeTreeEntryResponseDto[];

  @ApiProperty({
    example: false,
    description:
      'The listing was cut at the per-level entry cap. There is more in ' +
      'the directory than what came back here.',
  })
  truncated!: boolean;
}
export const _chavesArvore: MesmasChaves<CodeTreeResponseDto, GitTree> = true;

export class CodeFileResponseDto implements Wire<CodeFile> {
  @ApiProperty({ example: 'dev' })
  ref!: string;

  @ApiProperty({ example: 'apps/api/src/main.ts' })
  path!: string;

  @ApiProperty({
    example: "import { NestFactory } from '@nestjs/core';\n",
    description: 'UTF-8 content. Binary is not served by this route.',
  })
  content!: string;

  @ApiProperty({
    example: false,
    description:
      'The file went past the byte cap and `content` is the beginning of ' +
      'it. The tab is read-only: truncating and warning is better than ' +
      'refusing the file.',
  })
  truncated!: boolean;

  @ApiProperty({
    example: 1284,
    description: 'Bytes RETURNED — after the cut, not before.',
  })
  bytes!: number;
}
export const _chavesArquivo: MesmasChaves<CodeFileResponseDto, CodeFile> = true;

export class CodeSearchMatchResponseDto implements Wire<CodeSearchMatch> {
  @ApiProperty({ example: 'apps/api/src/main.ts' })
  path!: string;

  @ApiProperty({
    example: 12,
    description: '1-based, like every editor shows.',
  })
  line!: number;

  @ApiProperty({
    example: '  const app = await NestFactory.create(AppModule);',
    description:
      'The whole line, trimmed so a minified file is never returned in full.',
  })
  text!: string;
}
export const _chavesCasamento: MesmasChaves<
  CodeSearchMatchResponseDto,
  CodeSearchMatch
> = true;

export class CodeSearchResponseDto implements Wire<CodeSearchResult> {
  @ApiProperty({ example: 'dev' })
  ref!: string;

  @ApiProperty({ example: '', description: 'Subtree the search ran over.' })
  path!: string;

  @ApiProperty({ example: 'NestFactory' })
  query!: string;

  @ApiProperty({ type: [CodeSearchMatchResponseDto] })
  matches!: CodeSearchMatchResponseDto[];

  @ApiProperty({
    example: 87,
    description:
      "Files actually opened. This is the search's real cost, and it is in " +
      "the response so it doesn't stay invisible.",
  })
  filesScanned!: number;

  @ApiProperty({
    example: true,
    description:
      'The scan stopped by budget (directories, files, or matches) before ' +
      'finishing the tree. Narrow the `path` or the term.',
  })
  truncated!: boolean;
}
export const _chavesBusca: MesmasChaves<
  CodeSearchResponseDto,
  CodeSearchResult
> = true;

export class CodeDiffFileResponseDto implements Wire<GitPullRequestDiffFile> {
  @ApiProperty({
    example: 'apps/api/src/main.ts',
    description: 'Path AFTER the change (for `removed`, what disappeared).',
  })
  path!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Previous path; only filled in when `status` is `renamed`.',
  })
  previousPath!: string | null;

  @ApiProperty({
    enum: ['added', 'modified', 'removed', 'renamed'],
    example: 'modified',
  })
  status!: Wire<GitPullRequestDiffFile>['status'];

  @ApiProperty({ example: 12 })
  additions!: number;

  @ApiProperty({ example: 3 })
  deletions!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '@@ -1,3 +1,4 @@\n+import x\n',
    description:
      "The file's unified diff. `null` when the provider doesn't deliver it " +
      '(binary, or the patch is too large) — distinct from `""`, which is ' +
      '"came back empty". Without this distinction the screen would say ' +
      '"no changes" on a changed binary.',
  })
  patch!: string | null;
}
export const _chavesArquivoDeDiff: MesmasChaves<
  CodeDiffFileResponseDto,
  GitPullRequestDiffFile
> = true;

export class CodeDiffResponseDto implements Wire<GitPullRequestDiff> {
  @ApiProperty({ example: 'pr-1' })
  pullRequestId!: string;

  @ApiProperty({ type: [CodeDiffFileResponseDto] })
  files!: CodeDiffFileResponseDto[];

  @ApiProperty({
    example: false,
    description: 'The list was cut at the per-diff file cap.',
  })
  truncated!: boolean;
}
export const _chavesDiff: MesmasChaves<
  CodeDiffResponseDto,
  GitPullRequestDiff
> = true;

/**
 * Respostas de blame, lista de PRs e branch rica (FASE 26b) — fundação das
 * três pendências declaradas da aba Code. Os três tipos vêm do
 * `GitProviderContract` sem tradução, pela mesma razão de árvore e diff: já
 * são normalizados por provider, e reescrevê-los aqui criaria um segundo
 * vocabulário pra mesma coisa.
 */

export class CodeBlameLineResponseDto implements Wire<GitBlameLine> {
  @ApiProperty({
    example: 12,
    description: '1-based, like every editor shows.',
  })
  line!: number;

  @ApiProperty({ example: '0f3e8181fbd010b10c78db17b90ecb35fb8cc89c' })
  commitSha!: string;

  @ApiProperty({ example: 'Daniel Souza' })
  author!: string;

  @ApiProperty({ example: '2026-08-04T12:00:00.000Z' })
  authorDate!: string;

  @ApiProperty({ example: 'fix(api): fix the credential resolver' })
  summary!: string;
}
export const _chavesLinhaDeBlame: MesmasChaves<
  CodeBlameLineResponseDto,
  GitBlameLine
> = true;

export class CodeBlameResponseDto implements Wire<GitBlame> {
  @ApiProperty({ example: 'dev' })
  ref!: string;

  @ApiProperty({ example: 'apps/api/src/main.ts' })
  path!: string;

  @ApiProperty({ type: [CodeBlameLineResponseDto] })
  lines!: CodeBlameLineResponseDto[];

  @ApiProperty({
    example: false,
    description: 'The file went past the per-call annotated-lines cap.',
  })
  truncated!: boolean;
}
export const _chavesBlame: MesmasChaves<CodeBlameResponseDto, GitBlame> = true;

export class CodePullRequestSummaryResponseDto implements Wire<GitPullRequestSummary> {
  @ApiProperty({ example: '2401938475' })
  id!: string;

  @ApiProperty({ example: 42 })
  number!: number;

  @ApiProperty({
    example: 'fix(api): the agents area is born with the project',
  })
  title!: string;

  @ApiProperty({ example: 'https://github.com/acme/repo/pull/42' })
  url!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'daneiel',
    description:
      "Login/username of who opened it. `null` when the provider doesn't report it.",
  })
  author!: string | null;

  @ApiProperty({ enum: ['open', 'merged', 'closed'], example: 'open' })
  state!: Wire<GitPullRequestSummary>['state'];

  @ApiProperty({ example: 'feature/x' })
  sourceBranch!: string;

  @ApiProperty({ example: 'dev' })
  targetBranch!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-08-04T12:00:00.000Z',
    description: "`null` when the provider doesn't report it.",
  })
  updatedAt!: string | null;
}
export const _chavesResumoDePr: MesmasChaves<
  CodePullRequestSummaryResponseDto,
  GitPullRequestSummary
> = true;

export class CodePullRequestListResponseDto implements Wire<GitPullRequestList> {
  @ApiProperty({ type: [CodePullRequestSummaryResponseDto] })
  items!: CodePullRequestSummaryResponseDto[];

  @ApiProperty({
    example: false,
    description: 'The list was cut at the per-call PR cap.',
  })
  truncated!: boolean;
}
export const _chavesListaDePrs: MesmasChaves<
  CodePullRequestListResponseDto,
  GitPullRequestList
> = true;

export class CodeBranchPullRequestRefResponseDto implements Wire<GitBranchPullRequestRef> {
  @ApiProperty({ example: 42 })
  number!: number;

  @ApiProperty({ enum: ['open', 'merged', 'closed'], example: 'open' })
  state!: Wire<GitBranchPullRequestRef>['state'];
}
export const _chavesRefDePrDaBranch: MesmasChaves<
  CodeBranchPullRequestRefResponseDto,
  GitBranchPullRequestRef
> = true;

export class CodeBranchProducedByResponseDto implements Wire<CodeBranchProducedBy> {
  @ApiProperty({
    example: 'dev-pieces',
    description:
      'agent_id of the dev who created the branch (`dev-<module>`/`dev-<module>-2`, RN-087).',
  })
  agentId!: string;

  @ApiProperty({
    example: 'pieces',
    description: "Module name, from the project's current `module_map`.",
  })
  moduleId!: string;
}
export const _chavesProduzidaPor: MesmasChaves<
  CodeBranchProducedByResponseDto,
  CodeBranchProducedBy
> = true;

export class CodeBranchDetailResponseDto implements Wire<CodeBranch> {
  @ApiProperty({ example: 'feature/x' })
  name!: string;

  @ApiProperty({ example: '0f3e8181fbd010b10c78db17b90ecb35fb8cc89c' })
  commitSha!: string;

  @ApiProperty({ example: false })
  protected!: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 3,
    description:
      'Commits ahead of the default branch. `null` when not computable.',
  })
  ahead!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 0,
    description: 'Commits behind the default branch.',
  })
  behind!: number | null;

  @ApiProperty({ type: CodeBranchPullRequestRefResponseDto, nullable: true })
  pullRequest!: CodeBranchPullRequestRefResponseDto | null;

  @ApiProperty({
    type: CodeBranchProducedByResponseDto,
    nullable: true,
    description:
      'Dev agent/module owning the branch (RN-152), when the name matches ' +
      '`feature/task-XXXXXXXX` and the task/module are still resolvable. ' +
      "`null` for a user's manual branch or for `main`/`dev`/`qa`.",
  })
  producedBy!: CodeBranchProducedByResponseDto | null;
}
export const _chavesBranchDetalhada: MesmasChaves<
  CodeBranchDetailResponseDto,
  CodeBranch
> = true;

export class CodeBranchDetailListResponseDto implements Wire<CodeBranchList> {
  @ApiProperty({ type: [CodeBranchDetailResponseDto] })
  items!: CodeBranchDetailResponseDto[];

  @ApiProperty({
    example: false,
    description: 'The list was cut at the enriched-branches cap.',
  })
  truncated!: boolean;
}
export const _chavesListaDeBranches: MesmasChaves<
  CodeBranchDetailListResponseDto,
  CodeBranchList
> = true;
