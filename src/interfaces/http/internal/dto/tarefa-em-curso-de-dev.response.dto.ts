import { ApiProperty } from '@nestjs/swagger';

/** RN-856: uma tarefa `in_progress` segurada por um dev agent. */
export class TarefaEmCursoDeDevResponseDto {
  @ApiProperty({ format: 'uuid' })
  projectId!: string;

  @ApiProperty({ format: 'uuid' })
  taskId!: string;

  @ApiProperty({ example: 'dev-api', description: 'The dev agent holding it.' })
  assignedTo!: string;
}
