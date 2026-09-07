import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * O desfecho de UMA rodada do espelho, como o agente local o contou
 * (RN-517, ADR 0147 ponto 7).
 *
 * `ok` é o único campo obrigatório, e é ele — nunca a presença de uma
 * contagem ou de uma mensagem — que diz se a rodada deu certo: uma rodada que
 * copiou 0 arquivos é normal e não pode ser indistinguível de uma que nem
 * chegou a rodar.
 */
export class MirrorSyncResultInternalDto {
  @ApiProperty({
    example: true,
    description:
      'The REAL outcome of the copy, reported by the local agent after it ' +
      'finished — never an optimistic "ok" before the round ends.',
  })
  @IsBoolean()
  ok!: boolean;

  @ApiPropertyOptional({
    example: '/home/you/mirrors/store',
    description:
      'The destination the round actually resolved (success) or tried to ' +
      'use (failure), on the USER machine. FROZEN in the row: showing the ' +
      "project's current destination next to yesterday's copy would be the " +
      'screen asserting about a folder that round never touched. Omitted ' +
      'when the failure is about the destination itself.',
  })
  @IsOptional()
  @IsString()
  destination?: string;

  @ApiPropertyOptional({
    example: 412,
    description:
      'Regular files copied in this round. `0` is a number, not an absence ' +
      '— "synced and copied nothing" is a state of its own (RN-088).',
  })
  @ValidateIf((o: MirrorSyncResultInternalDto) => o.filesCopied !== undefined)
  @IsInt()
  @Min(0)
  filesCopied?: number;

  @ApiPropertyOptional({
    example: 3,
    description:
      'Entries git listed that are not regular files — a nested repository ' +
      "(a dev agent's worktree is one), a symlink, or a file that vanished " +
      'between the listing and the copy.',
  })
  @ValidateIf((o: MirrorSyncResultInternalDto) => o.filesSkipped !== undefined)
  @IsInt()
  @Min(0)
  filesSkipped?: number;

  @ApiPropertyOptional({
    example: 0,
    description:
      'Targets the per-file guard refused (a symlink escaping the ' +
      'destination). Counted, never swallowed.',
  })
  @ValidateIf((o: MirrorSyncResultInternalDto) => o.filesRefused !== undefined)
  @IsInt()
  @Min(0)
  filesRefused?: number;

  @ApiPropertyOptional({
    example:
      'o espelho não conseguiu listar o trabalho com o git: not a git repository',
    description:
      'The NAMED failure message. Stored truncated when very long, saying ' +
      'it was truncated. It never erases the last successful sync — which ' +
      'row is CURRENT is decided by comparing the two timestamps.',
  })
  @IsOptional()
  @IsString()
  error?: string;
}
