import { ApiProperty } from '@nestjs/swagger';

/** Respostas da fase de execução (Fase 7b, item 6). */

export class ExecucaoAtivadaResponseDto {
  @ApiProperty({
    example: '01JC4Z8QK3M7YV2N5T9B0PXHRA',
    description: 'Execution session created.',
  })
  sessionId!: string;

  @ApiProperty({
    example: ['api', 'web'],
    description:
      'Modules of the `module_map` that got a dev agent. One agent per module, ' +
      'each in an isolated worktree.',
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
      "`executado`: the agent started, within the lead's cap. " +
      '`aguardando_autorizacao`: the request became a `proposed_action` and ' +
      'NOTHING started until you decide. `recusado`: the area has an invalid ' +
      '`max_parallel`.',
  })
  estado!: 'executado' | 'aguardando_autorizacao' | 'recusado';

  @ApiProperty({
    required: false,
    example: '01JC4Z8QK3M7YV2N5T9B0PXHRA',
    description: 'The action to decide on. Only in `aguardando_autorizacao`.',
  })
  actionId?: string;

  @ApiProperty({
    required: false,
    example: 2,
    description:
      'Dev agents already up IN THE SESSION, summed across all modules.',
  })
  ativosNaSessao?: number;

  @ApiProperty({
    required: false,
    example: 2,
    description: 'The cap the lead uses without asking.',
  })
  maxParallel?: number;

  @ApiProperty({
    required: false,
    description: 'Why the request was refused. Only in `recusado`.',
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
    description: 'Area identifier. Unique within the project.',
  })
  key!: string;

  @ApiProperty({
    example: 'dev-lead',
    description: "The area's lead — its only external contact.",
  })
  leadAgentId!: string;

  @ApiProperty({
    example: 2,
    description:
      'How many agents the lead can have in the SESSION without requesting ' +
      'authorization. Above that, a `proposed_action`. The cap is per session, ' +
      'not per module: counting per module would allow N modules × N agents ' +
      'with no authorization at all.',
  })
  maxParallel!: number;

  @ApiProperty({
    example: 20000000,
    nullable: true,
    description:
      "The area's spend cap, in micro-USD (ADR 0110, RN-443). `null` means " +
      'no cap — an independent, ADDITIVE check next to the project and ' +
      'session budgets, not a cascade: whichever of the three hits its cap ' +
      'first blocks the call.',
  })
  budgetMicros!: number | null;

  @ApiProperty({
    example: 4300000,
    description:
      "The area's accumulated spend, in micro-USD. Increments whenever an " +
      'agent that belongs to this area spends, WITH OR WITHOUT a cap set.',
  })
  spentMicros!: number;

  @ApiProperty({
    example: ['dev-api', 'dev-web'],
    description:
      'The members. In the dev area they come from the `module_map`, one per ' +
      'module — that is what keeps the area from being a fixed list in code.',
  })
  members!: string[];
}
