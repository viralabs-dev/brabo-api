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
      'O novo modo de execução. Pode repetir o modo atual do projeto — ' +
      'nesse caso, só `workspacePath` muda de verdade.',
  })
  @IsIn(PROJECT_EXECUTION_MODES)
  executionMode!: ProjectExecutionMode;

  @ApiPropertyOptional({
    example: '/home/you/projects/store',
    description:
      'O caminho absoluto da pasta do usuário — obrigatório quando ' +
      '`executionMode` é `mounted` ou `runner`, recusado quando é ' +
      '`container`. Mesma validação da criação (RN-170/RN-422/RN-423): em ' +
      '`mounted`, precisa existir e ser gravável de dentro do container; ' +
      'em `runner`, só o formato é validado agora — a confirmação de ' +
      'verdade vem do runner conectando de novo.',
  })
  @IsOptional()
  @IsString()
  workspacePath?: string;
}
