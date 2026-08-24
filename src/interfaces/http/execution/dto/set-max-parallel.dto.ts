import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class SetMaxParallelDto {
  @ApiProperty({
    example: 4,
    minimum: 1,
    description:
      "How many agents the area's lead can have in the session WITHOUT " +
      'requesting your authorization. Minimum 1 — zero does not mean ' +
      '"unlimited", it means invalid configuration, and treating it as ' +
      'unlimited would turn a typo into unrestricted spending.',
  })
  @IsInt()
  @Min(1)
  maxParallel!: number;
}
