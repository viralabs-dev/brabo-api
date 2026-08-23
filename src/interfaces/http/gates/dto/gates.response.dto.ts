import { ApiProperty } from '@nestjs/swagger';

/**
 * Um gate do registro, na forma que o PAINEL precisa.
 *
 * Não é o `Gate` inteiro de propósito. O registro carrega campos que só
 * interessam a quem MEDE (`evidencia`, `verificacao`, `backlog`), e expô-los
 * aqui convidaria a tela a depender deles — que é como um índice vira
 * acoplamento. O que a tela precisa é: quem é o gate, de quem é, se a decisão
 * é humana, e se ele está ativo.
 */
export class GateResumoResponseDto {
  @ApiProperty({ example: 'qa-verificada' })
  id!: string;

  @ApiProperty({ example: 'pr', description: 'Flow the gate belongs to.' })
  fluxo!: string;

  @ApiProperty({ example: 'area-qa', description: 'Who judges.' })
  dono!: string;

  @ApiProperty({
    example: ['pr-aberta'],
    description: 'What needs to exist for the gate to open.',
    type: [String],
  })
  entrada!: string[];

  @ApiProperty({
    example: 'veredito-qa',
    description: 'What the gate produces when it passes.',
  })
  entregavel!: string | string[];

  @ApiProperty({
    example: true,
    description:
      "The decision is the user's — direct on click OR delegated by a policy " +
      'they wrote themselves (see RN-071).',
  })
  aprovacaoHumana!: boolean;

  @ApiProperty({ example: 'block', enum: ['block', 'warn'] })
  severidade!: string;
}

export class GatesResponseDto {
  @ApiProperty({ example: 1, description: 'Version of the registry format.' })
  version!: number;

  @ApiProperty({
    type: [GateResumoResponseDto],
    description:
      'Only ACTIVE gates. A `planned` gate describes a future role and should ' +
      'not appear on a screen that says what is happening right now.',
  })
  gates!: GateResumoResponseDto[];
}
