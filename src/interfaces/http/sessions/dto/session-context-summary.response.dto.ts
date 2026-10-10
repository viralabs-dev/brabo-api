import { ApiProperty } from '@nestjs/swagger';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import type {
  ArquivoTocado,
  ArtefatosDoAgente,
  ResumoDoContextoDaSessao,
} from '../../../../application/ports/session-context-summary-repository.port';

/** RN-827/828 — o agregado da sessão inteira do painel de contexto. */
export class ArtefatosDoAgenteResponseDto implements Wire<ArtefatosDoAgente> {
  @ApiProperty({ example: 'po' })
  actorId!: string;

  @ApiProperty({
    example: 7,
    description:
      'PRs (`pr_open`/`open_adr_pr`) plus epics, stories and tasks this agent created in the session.',
  })
  quantos!: number;
}
export const _chavesArtefatos: MesmasChaves<
  ArtefatosDoAgenteResponseDto,
  ArtefatosDoAgente
> = true;

export class ArquivoTocadoResponseDto implements Wire<ArquivoTocado> {
  @ApiProperty({ example: '01JC4Z0000ACAO00000000000001' })
  actionId!: string;

  @ApiProperty({ example: 'src/app.ts' })
  path!: string;

  @ApiProperty({ example: 12 })
  additions!: number;

  @ApiProperty({ example: 3 })
  deletions!: number;
}
export const _chavesArquivo: MesmasChaves<
  ArquivoTocadoResponseDto,
  ArquivoTocado
> = true;

export class ArquivosTocadosResponseDto {
  @ApiProperty({
    type: [ArquivoTocadoResponseDto],
    description: 'Most recent first, capped at 100.',
  })
  itens!: ArquivoTocadoResponseDto[];

  @ApiProperty({
    example: 140,
    description: 'Real total, even when `itens` was cut.',
  })
  total!: number;
}

export class SessionContextSummaryResponseDto implements Wire<ResumoDoContextoDaSessao> {
  @ApiProperty({
    type: [String],
    description:
      'The requested session plus the execution session(s) its approved Dev Lead plan activated (RN-828).',
  })
  sessoesLidas!: string[];

  @ApiProperty({
    example: 11,
    description: '`artifact.business_rule` in the whole session.',
  })
  regras!: number;

  @ApiProperty({
    example: 6,
    description: '`artifact.decision_record` in the whole session.',
  })
  decisoes!: number;

  @ApiProperty({ type: [ArtefatosDoAgenteResponseDto] })
  artefatosPorAgente!: ArtefatosDoAgenteResponseDto[];

  @ApiProperty({
    type: ArquivosTocadosResponseDto,
    description:
      'Files from `git_commit`/`git_push` actions of this session and of the linked execution session.',
  })
  arquivosTocados!: ArquivosTocadosResponseDto;
}
export const _chavesResumo: MesmasChaves<
  SessionContextSummaryResponseDto,
  ResumoDoContextoDaSessao
> = true;
