import { ApiProperty } from '@nestjs/swagger';

/**
 * O estado da última rodada do espelho de um projeto (RN-517, ADR 0147
 * ponto 7).
 *
 * As TRÊS respostas da RN-088 vêm resolvidas em `status`, e não deduzidas
 * pela tela: "nunca sincronizou", "sincronizou" (podendo ter copiado zero) e
 * "falhou" são coisas diferentes, e um traço servindo às três seria a tela
 * recusando nomear o que sabe (RN-470).
 */
export class ProjectMirrorStateResponseDto {
  @ApiProperty({
    example: '/home/you/mirrors/store',
    nullable: true,
    description:
      'The destination declared TODAY (`projects.mirror_path`, RN-515). ' +
      '`null` means the project has no mirror — the NORMAL state, and what ' +
      'makes the screen hide this line entirely instead of inventing an ' +
      'absence.',
  })
  mirrorPath!: string | null;

  @ApiProperty({
    example: 'synced',
    enum: ['never', 'synced', 'failed'],
    description:
      '`never` — no runner has reported a round yet (there is no row). ' +
      '`synced` — the last round copied; `filesCopied` may be `0`, which is ' +
      '"looked and there was nothing to copy" and has a sentence of its own. ' +
      '`failed` — the last round failed, and the error is newer than the ' +
      'last success. The API derives this from the two timestamps so the ' +
      'rule has one source; the screen still gets the raw fields to write ' +
      'the sentence.',
  })
  status!: 'never' | 'synced' | 'failed';

  @ApiProperty({
    example: '2026-09-07T12:04:00.000Z',
    nullable: true,
    description:
      'The last SUCCESSFUL sync. A later failure never erases it — it is ' +
      'the most useful thing this screen has while the mirror is broken.',
  })
  lastSyncedAt!: string | null;

  @ApiProperty({ example: 412, nullable: true })
  filesCopied!: number | null;

  @ApiProperty({ example: 3, nullable: true })
  filesSkipped!: number | null;

  @ApiProperty({ example: 0, nullable: true })
  filesRefused!: number | null;

  @ApiProperty({
    example: '/home/you/mirrors/store',
    nullable: true,
    description:
      'Where the last round actually wrote — FROZEN. It diverges from ' +
      '`mirrorPath` after someone changes the destination, because the ' +
      'grant travels in the join and only changes when the runner ' +
      'reconnects (RN-516).',
  })
  lastDestination!: string | null;

  @ApiProperty({ example: null, nullable: true })
  lastError!: string | null;

  @ApiProperty({ example: null, nullable: true })
  lastErrorAt!: string | null;
}
