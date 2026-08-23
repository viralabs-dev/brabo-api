import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class AcceptParallelizationDto {
  @ApiProperty({
    example: 'api',
    description:
      "Module name, as it appears in the `module_map`. Starts a dev agent " +
      'dedicated to it, in an isolated worktree.',
  })
  @IsString()
  module!: string;
}
