import { ApiProperty } from '@nestjs/swagger';

/** Respostas da fase de execução (Fase 7b, item 6). */

export class ExecucaoAtivadaResponseDto {
  @ApiProperty({
    example: '01JC4Z8QK3M7YV2N5T9B0PXHRA',
    description: 'Sessão de execução criada.',
  })
  sessionId!: string;

  @ApiProperty({
    example: ['api', 'web'],
    description:
      'Módulos do `module_map` que ganharam dev agent. Um agente por módulo, cada ' +
      'um em worktree isolado.',
  })
  modules!: string[];
}
