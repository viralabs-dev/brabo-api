import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class DenyActionDto {
  @ApiPropertyOptional({
    example: 'The command would delete the working directory.',
    description:
      'Stays in the event log alongside the denial. Optional, but recommended.',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
