import { ApiProperty } from '@nestjs/swagger';
import type {
  Evidencia,
  Gate,
  GateRegistry,
} from '../../../../domain/gates/gate-registry';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';

/**
 * O registro de gates no fio (FASE 15a, ADR 0054).
 *
 * A evidência é declarada como objeto livre de propósito: ela é uma UNIÃO
 * discriminada por `tipo`, e o OpenAPI 3.0 do Nest não expressa isso sem
 * `oneOf` escrito à mão. O que importa aqui é que a forma completa está
 * documentada em `docs/explanation/gates.md` e travada por
 * `MesmasChaves` lá embaixo — não numa anotação que o gerador achataria.
 */
export class GateResponseDto implements Wire<Gate> {
  @ApiProperty({ example: 'qa-verificada' })
  id!: string;

  @ApiProperty({ example: 'pr' })
  fluxo!: string;

  @ApiProperty({ example: 'area-qa' })
  dono!: string;

  @ApiProperty({ type: [String], example: ['pr-aberta'] })
  entrada!: string[];

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'veredito-qa',
  })
  entregavel!: string | string[];

  @ApiProperty({ enum: ['script', 'humana'] })
  verificacao!: 'script' | 'humana';

  @ApiProperty({ enum: ['block', 'warn'] })
  severidade!: 'block' | 'warn';

  @ApiProperty({
    description:
      'A decisão é do usuário — direta no clique, ou delegada por política que ' +
      'ele escreveu. Invariante nos quatro gates constitucionalmente manuais ' +
      '(RN-071).',
  })
  aprovacao_humana!: boolean;

  @ApiProperty({ enum: ['active', 'planned'] })
  status!: 'active' | 'planned';

  @ApiProperty({
    required: false,
    type: Object,
    additionalProperties: true,
    description:
      'Onde mora a prova de que o gate passou: `event_log` (tipos + filtro de ' +
      'payload), `teste` ou `ci` (caminho do alvo). Ausente em gate `planned`.',
  })
  evidencia?: Evidencia;

  @ApiProperty({ required: false, example: 'ADR 0053' })
  backlog?: string;
}

export class GateRegistryResponseDto implements Wire<GateRegistry> {
  @ApiProperty({ example: 1 })
  version!: number;

  @ApiProperty({ type: [GateResponseDto] })
  gates!: GateResponseDto[];
}

// As duas travas: `implements` pega campo que falta e tipo errado; `MesmasChaves`
// pega campo SOBRANDO, que o `implements` é cego para ver. Quem as executa é o
// `tsc`, não o vitest.
export const _chavesGate: MesmasChaves<GateResponseDto, Wire<Gate>> = true;
export const _chavesRegistro: MesmasChaves<
  GateRegistryResponseDto,
  Wire<GateRegistry>
> = true;
