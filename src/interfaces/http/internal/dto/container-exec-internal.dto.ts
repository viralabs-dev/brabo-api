import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class ContainerExecInternalDto {
  @ApiProperty({
    example: 'npm test',
    description:
      'The shell command, interpreted by `sh -c` INSIDE the container — ' +
      'same convention as the terminal action run outside one.',
  })
  @IsString()
  comando!: string;

  @ApiPropertyOptional({
    example: '/work/.worktrees/dev-api',
    description:
      'Working directory INSIDE the container. Already translated from the ' +
      "host path by the engine (RN-492) — this DTO doesn't repeat that " +
      'translation. Omitted runs at `/work`, the project root. The broker ' +
      're-validates it is inside `/work` and refuses ' +
      '(`DiretorioForaDoEscopoError`) otherwise.',
  })
  @IsOptional()
  @IsString()
  cwd?: string;

  @ApiPropertyOptional({
    example: 300000,
    description: 'Timeout in milliseconds. Omitted uses the broker default.',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  timeoutMs?: number;
}
