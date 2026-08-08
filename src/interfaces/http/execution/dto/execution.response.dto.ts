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

/**
 * A resposta do pedido de paralelismo (FASE 14d, RN-083).
 *
 * Três desfechos, e o front precisa distingui-los: o agente subiu, o pedido
 * virou decisão sua, ou a configuração da área está inválida. O `estado` é o
 * discriminador — nunca infira pela presença do `actionId`.
 */
export class PedidoDeParalelismoResponseDto {
  @ApiProperty({
    enum: ['executado', 'aguardando_autorizacao', 'recusado'],
    example: 'aguardando_autorizacao',
    description:
      '`executado`: o agente subiu, dentro do teto do lead. ' +
      '`aguardando_autorizacao`: o pedido virou `proposed_action` e NADA subiu ' +
      'até você decidir. `recusado`: a área tem `max_parallel` inválido.',
  })
  estado!: 'executado' | 'aguardando_autorizacao' | 'recusado';

  @ApiProperty({
    required: false,
    example: '01JC4Z8QK3M7YV2N5T9B0PXHRA',
    description: 'A ação a decidir. Só em `aguardando_autorizacao`.',
  })
  actionId?: string;

  @ApiProperty({
    required: false,
    example: 2,
    description: 'Dev agents já de pé NA SESSÃO, somando todos os módulos.',
  })
  ativosNaSessao?: number;

  @ApiProperty({
    required: false,
    example: 2,
    description: 'O teto que o lead usa sem perguntar.',
  })
  maxParallel?: number;

  @ApiProperty({
    required: false,
    description: 'Por que o pedido foi recusado. Só em `recusado`.',
  })
  motivo?: string;
}

/** Uma área de agente e seu teto (FASE 14d, ADR 0053). */
export class AreaDeAgentesResponseDto {
  @ApiProperty({ example: '01JC4Z8QK3M7YV2N5T9B0PXHRA' })
  id!: string;

  @ApiProperty({ example: '01JC4Z8QK3M7YV2N5T9B0PXHRA' })
  projectId!: string;

  @ApiProperty({
    example: 'dev',
    description: 'Identificador da área. Único dentro do projeto.',
  })
  key!: string;

  @ApiProperty({
    example: 'dev-lead',
    description: 'O lead da área — o único contato externo dela.',
  })
  leadAgentId!: string;

  @ApiProperty({
    example: 2,
    description:
      'Quantos agentes o lead pode ter na SESSÃO sem pedir autorização. Acima ' +
      'disso, `proposed_action`. O teto é da sessão e não do módulo: contar ' +
      'por módulo permitiria N módulos × N agentes sem autorização nenhuma.',
  })
  maxParallel!: number;

  @ApiProperty({
    example: ['dev-api', 'dev-web'],
    description:
      'Os membros. Na área de dev vêm do `module_map`, um por módulo — é o ' +
      'que impede a área de ser uma lista fixa em código.',
  })
  members!: string[];
}
