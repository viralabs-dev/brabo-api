import { ApiProperty } from '@nestjs/swagger';

/**
 * Resultado de confirmar o workspace de um projeto `execution_mode: runner`
 * (RN-423, ADR 0104).
 */
export class ConfirmProjectWorkspaceResponseDto {
  @ApiProperty({
    example: true,
    description:
      'Always `true` when the call did not throw — confirmation is ' +
      'idempotent. `changed` says whether ANYTHING changed on this call.',
  })
  verified!: boolean;

  @ApiProperty({
    example: '/home/you/projects/store',
    description:
      'The WRITTEN (normalized) path — can differ from what creation had, ' +
      'because the runner is the source of truth and overwrites it.',
  })
  workspacePath!: string;

  @ApiProperty({
    example: true,
    description:
      '`true` on the first confirmation, or when the reported path is ' +
      'DIFFERENT from what was already written. `false` on a reconnection ' +
      'that reports the same path as always — nothing was rewritten.',
  })
  changed!: boolean;
}
