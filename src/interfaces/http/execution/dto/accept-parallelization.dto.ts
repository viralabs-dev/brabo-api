import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class AcceptParallelizationDto {
  @ApiProperty({
    example: 'api',
    description:
      'Nome do módulo, como ele aparece no `module_map`. Sobe um dev agent ' +
      'dedicado a ele, em worktree isolado.',
  })
  @IsString()
  module!: string;
}
