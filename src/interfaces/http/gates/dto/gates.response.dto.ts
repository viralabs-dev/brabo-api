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

  @ApiProperty({ example: 'pr', description: 'Fluxo a que o gate pertence.' })
  fluxo!: string;

  @ApiProperty({ example: 'area-qa', description: 'Quem julga.' })
  dono!: string;

  @ApiProperty({
    example: ['pr-aberta'],
    description: 'O que precisa existir para o gate abrir.',
    type: [String],
  })
  entrada!: string[];

  @ApiProperty({
    example: 'veredito-qa',
    description: 'O que o gate produz quando passa.',
  })
  entregavel!: string | string[];

  @ApiProperty({
    example: true,
    description:
      'A decisão é do usuário — direta no clique OU delegada por política ' +
      'que ele mesmo escreveu (ver RN-071).',
  })
  aprovacaoHumana!: boolean;

  @ApiProperty({ example: 'block', enum: ['block', 'warn'] })
  severidade!: string;
}

export class GatesResponseDto {
  @ApiProperty({ example: 1, description: 'Versão do formato do registro.' })
  version!: number;

  @ApiProperty({
    type: [GateResumoResponseDto],
    description:
      'Só os gates ATIVOS. Gate `planned` descreve papel futuro e não ' +
      'deve aparecer numa tela que diz o que está acontecendo agora.',
  })
  gates!: GateResumoResponseDto[];
}
