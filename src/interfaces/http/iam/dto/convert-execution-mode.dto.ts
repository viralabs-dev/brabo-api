import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import {
  PROJECT_EXECUTION_MODES,
  type ProjectExecutionMode,
} from '../../../../domain/iam/project.entity';

/**
 * Corpo de `PUT .../execution-mode` (RN-447..450, ADR 0111) — rota
 * DEDICADA, separada de `UpdateProjectDto`, que continua excluindo estes
 * dois campos de propósito (ver o comentário lá). Mesma validação de forma
 * de `CreateProjectDto`, porque a pergunta ("este par (modo, caminho) é
 * válido?") é a mesma nos dois casos.
 */
export class ConvertExecutionModeDto {
  @ApiProperty({
    enum: PROJECT_EXECUTION_MODES,
    example: 'runner',
    description:
      'The new execution mode. It may repeat the current project mode — ' +
      'in that case, only `workspacePath` really changes.',
  })
  @IsIn(PROJECT_EXECUTION_MODES)
  executionMode!: ProjectExecutionMode;

  @ApiPropertyOptional({
    example: '/home/you/projects/store',
    description:
      'The absolute path of the user folder — required when ' +
      '`executionMode` is `mounted` or `runner`, refused when it is ' +
      '`container`. Same validation as creation (RN-170/RN-422/RN-423): in ' +
      '`mounted`, it must exist and be writable from inside the container; ' +
      'in `runner`, only the format is validated now — the real ' +
      'confirmation comes from the runner connecting again.',
  })
  @IsOptional()
  @IsString()
  workspacePath?: string;
}
