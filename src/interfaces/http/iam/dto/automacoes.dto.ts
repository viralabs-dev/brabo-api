import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** Corpo de `PUT /projects/:id/automacoes/:categoria/:chave` (RN-1421, AT-994). */
export class SetAutomacaoDto {
  @ApiProperty({
    example: false,
    description:
      'Turns the automation on or off. Required: an omitted key is a 400.',
  })
  @IsBoolean()
  ligada!: boolean;
}

export class AutomacaoResponseDto {
  @ApiProperty({ example: 'handoff' })
  categoria!: string;

  @ApiProperty({ example: 'arquiteto->infra' })
  chave!: string;

  @ApiProperty({ example: true })
  ligada!: boolean;

  @ApiProperty({ enum: ['padrao', 'oferta', 'manual'], example: 'padrao' })
  origem!: 'padrao' | 'oferta' | 'manual';

  @ApiProperty({ type: String, nullable: true, example: null })
  userId!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'When the key was last changed; null while it is the default.',
  })
  alteradaEm!: Date | null;
}
