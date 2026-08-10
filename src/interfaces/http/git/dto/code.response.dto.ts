import { ApiProperty } from '@nestjs/swagger';
import type {
  GitBlame,
  GitBlameLine,
  GitBranchDetail,
  GitBranchDetailList,
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
    description: 'Caminho completo a partir da raiz do repositório.',
  })
  path!: string;

  @ApiProperty({
    example: 'main.ts',
    description: 'Último segmento de `path`.',
  })
  name!: string;

  @ApiProperty({ enum: ['file', 'dir'], example: 'file' })
  type!: Wire<GitTreeEntry>['type'];

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 1284,
    description:
      'Bytes. `null` para diretório e quando o provider não informa — ' +
      'distinguir de `0` importa para a tela não afirmar "arquivo vazio".',
  })
  size!: number | null;
}
export const _chavesEntradaDeArvore: MesmasChaves<
  CodeTreeEntryResponseDto,
  GitTreeEntry
> = true;

export class CodeTreeResponseDto implements Wire<GitTree> {
  @ApiProperty({ example: 'dev', description: 'Branch, tag ou sha lido.' })
  ref!: string;

  @ApiProperty({
    example: 'apps/api',
    description: 'Diretório listado; `""` é a raiz.',
  })
  path!: string;

  @ApiProperty({ type: [CodeTreeEntryResponseDto] })
  entries!: CodeTreeEntryResponseDto[];

  @ApiProperty({
    example: false,
    description:
      'A listagem foi cortada no teto de entradas por nível. Há mais coisa ' +
      'no diretório do que veio aqui.',
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
    description: 'Conteúdo em UTF-8. Binário não é servido por esta rota.',
  })
  content!: string;

  @ApiProperty({
    example: false,
    description:
      'O arquivo passou do teto de bytes e `content` é o começo dele. ' +
      'A aba é de leitura: cortar e avisar é melhor que recusar o arquivo.',
  })
  truncated!: boolean;

  @ApiProperty({
    example: 1284,
    description: 'Bytes DEVOLVIDOS — depois do corte, não antes.',
  })
  bytes!: number;
}
export const _chavesArquivo: MesmasChaves<CodeFileResponseDto, CodeFile> = true;

export class CodeSearchMatchResponseDto implements Wire<CodeSearchMatch> {
  @ApiProperty({ example: 'apps/api/src/main.ts' })
  path!: string;

  @ApiProperty({
    example: 12,
    description: '1-based, como todo editor mostra.',
  })
  line!: number;

  @ApiProperty({
    example: '  const app = await NestFactory.create(AppModule);',
    description:
      'A linha inteira, cortada para não devolver arquivo minificado.',
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

  @ApiProperty({ example: '', description: 'Subárvore em que a busca correu.' })
  path!: string;

  @ApiProperty({ example: 'NestFactory' })
  query!: string;

  @ApiProperty({ type: [CodeSearchMatchResponseDto] })
  matches!: CodeSearchMatchResponseDto[];

  @ApiProperty({
    example: 87,
    description:
      'Arquivos efetivamente abertos. É o custo real da busca, e está na ' +
      'resposta para não ficar invisível.',
  })
  filesScanned!: number;

  @ApiProperty({
    example: true,
    description:
      'A varredura parou por orçamento (diretórios, arquivos ou casamentos) ' +
      'antes de acabar a árvore. Refine o `path` ou o termo.',
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
    description: 'Caminho DEPOIS da mudança (para `removed`, o que sumiu).',
  })
  path!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Caminho anterior; só preenchido quando `status` é `renamed`.',
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
      'Diff unificado do arquivo. `null` quando o provider não o entrega ' +
      '(binário, ou patch grande demais) — distinto de `""`, que é "veio ' +
      'vazio". Sem essa distinção a tela diria "sem mudanças" num binário ' +
      'alterado.',
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
    description: 'A lista foi cortada no teto de arquivos por diff.',
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
  @ApiProperty({ example: 12, description: '1-based, como todo editor mostra.' })
  line!: number;

  @ApiProperty({ example: '0f3e8181fbd010b10c78db17b90ecb35fb8cc89c' })
  commitSha!: string;

  @ApiProperty({ example: 'Daniel Souza' })
  author!: string;

  @ApiProperty({ example: '2026-08-04T12:00:00.000Z' })
  authorDate!: string;

  @ApiProperty({ example: 'fix(api): corrige o resolvedor de credencial' })
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
    description: 'O arquivo passou do teto de linhas anotadas por chamada.',
  })
  truncated!: boolean;
}
export const _chavesBlame: MesmasChaves<CodeBlameResponseDto, GitBlame> = true;

export class CodePullRequestSummaryResponseDto
  implements Wire<GitPullRequestSummary>
{
  @ApiProperty({ example: '2401938475' })
  id!: string;

  @ApiProperty({ example: 42 })
  number!: number;

  @ApiProperty({ example: 'fix(api): a área de agentes nasce com o projeto' })
  title!: string;

  @ApiProperty({ example: 'https://github.com/acme/repo/pull/42' })
  url!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'daneiel',
    description: 'Login/username de quem abriu. `null` quando o provider não informa.',
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
    description: '`null` quando o provider não informa.',
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
    description: 'A lista foi cortada no teto de PRs por chamada.',
  })
  truncated!: boolean;
}
export const _chavesListaDePrs: MesmasChaves<
  CodePullRequestListResponseDto,
  GitPullRequestList
> = true;

export class CodeBranchPullRequestRefResponseDto
  implements Wire<GitBranchPullRequestRef>
{
  @ApiProperty({ example: 42 })
  number!: number;

  @ApiProperty({ enum: ['open', 'merged', 'closed'], example: 'open' })
  state!: Wire<GitBranchPullRequestRef>['state'];
}
export const _chavesRefDePrDaBranch: MesmasChaves<
  CodeBranchPullRequestRefResponseDto,
  GitBranchPullRequestRef
> = true;

export class CodeBranchDetailResponseDto implements Wire<GitBranchDetail> {
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
    description: 'Commits à frente da branch default. `null` quando não computável.',
  })
  ahead!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 0,
    description: 'Commits atrás da branch default.',
  })
  behind!: number | null;

  @ApiProperty({ type: CodeBranchPullRequestRefResponseDto, nullable: true })
  pullRequest!: CodeBranchPullRequestRefResponseDto | null;
}
export const _chavesBranchDetalhada: MesmasChaves<
  CodeBranchDetailResponseDto,
  GitBranchDetail
> = true;

export class CodeBranchDetailListResponseDto
  implements Wire<GitBranchDetailList>
{
  @ApiProperty({ type: [CodeBranchDetailResponseDto] })
  items!: CodeBranchDetailResponseDto[];

  @ApiProperty({
    example: false,
    description: 'A lista foi cortada no teto de branches enriquecidas.',
  })
  truncated!: boolean;
}
export const _chavesListaDeBranches: MesmasChaves<
  CodeBranchDetailListResponseDto,
  GitBranchDetailList
> = true;
