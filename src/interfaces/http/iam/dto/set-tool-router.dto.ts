import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** Corpo de `PUT workspaces/:workspaceId/tool-router` (ADR 0179, RN-625). */
export class SetToolRouterDto {
  @ApiProperty({
    example: false,
    description:
      'Whether the Jev chooses the tool of each agent step. On by default; ' +
      'it only acts when the turn model is from OpenRouter.',
  })
  @IsBoolean()
  enabled!: boolean;
}
