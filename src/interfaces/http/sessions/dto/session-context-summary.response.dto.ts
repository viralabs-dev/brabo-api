import { ApiProperty } from '@nestjs/swagger';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import type {
  ArquivoTocado,
  ArtefatosDoAgente,
  ItemDeDecisao,
  ItemDeRegra,
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

/** RN-844 — o mínimo para o cartão de uma regra. */
export class ItemDeRegraResponseDto implements Wire<ItemDeRegra> {
  @ApiProperty({ example: 'evt_01JC4Z' })
  eventId!: string;

  @ApiProperty({ example: 42 })
  seq!: number;

  @ApiProperty({ example: 'po' })
  actorId!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Login exige e-mail' })
  titulo!: string | null;

  @ApiProperty({ type: String, nullable: true })
  descricao!: string | null;

  @ApiProperty({
    example: 2,
    description: 'How many origin references the rule cites.',
  })
  origens!: number;
}
export const _chavesRegra: MesmasChaves<ItemDeRegraResponseDto, ItemDeRegra> =
  true;

/** RN-844 — uma decisão registrada. */
export class ItemDeDecisaoResponseDto implements Wire<ItemDeDecisao> {
  @ApiProperty({ example: 'evt_01JC4Z' })
  eventId!: string;

  @ApiProperty({ example: 43 })
  seq!: number;

  @ApiProperty({ example: 'criativo' })
  actorId!: string;

  @ApiProperty({ type: String, nullable: true, example: 'SQLite em arquivo' })
  escolha!: string | null;

  @ApiProperty({ type: String, nullable: true })
  contexto!: string | null;
}
export const _chavesDecisao: MesmasChaves<
  ItemDeDecisaoResponseDto,
  ItemDeDecisao
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

  @ApiProperty({
    example: 0,
    description:
      'PRs of the read sessions whose files were NOT read: past the 20-PR cap, or the provider refused the diff (RN-844).',
  })
  prsNaoLidas!: number;
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

  @ApiProperty({
    type: [ItemDeRegraResponseDto],
    description:
      'Latest business rules of the session, capped at 50; the total is `regras` (RN-844).',
  })
  itensDeRegras!: ItemDeRegraResponseDto[];

  @ApiProperty({
    type: [ItemDeDecisaoResponseDto],
    description:
      'Latest decision records of the session, capped at 50; the total is `decisoes` (RN-844).',
  })
  itensDeDecisoes!: ItemDeDecisaoResponseDto[];

  @ApiProperty({ type: [ArtefatosDoAgenteResponseDto] })
  artefatosPorAgente!: ArtefatosDoAgenteResponseDto[];

  @ApiProperty({
    type: ArquivosTocadosResponseDto,
    description:
      'Files of the PRs opened in this session and in the linked execution session (read from the PR diff, RN-844), then files from `git_commit`/`git_push` payloads.',
  })
  arquivosTocados!: ArquivosTocadosResponseDto;
}
export const _chavesResumo: MesmasChaves<
  SessionContextSummaryResponseDto,
  ResumoDoContextoDaSessao
> = true;
